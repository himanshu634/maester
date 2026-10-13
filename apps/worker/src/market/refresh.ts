import {
  finishMarketFetch, getConnection, latestMarketDay, listMarketSeries, listMarketValuesByPrefix, markConnectionError,
  saveConnection, startMarketFetch, upsertMarketPoints, type Db, type MarketConnectionProvider,
} from "@maester/db";
import {
  encryptSecret, INDIA_VIX, ist, MarketSourceError, NIFTY_50,
  type DailyPoint, type DhanSource, type FredSource, type GoldContract, type Instrument,
} from "@maester/market";
import type { Logger } from "../logger.js";
import { breadthOn } from "./breadth.js";

export type MarketSources = { dhan: DhanSource | null; fred: FredSource | null };

export type MarketRefresherDeps = {
  db: Db;
  /** Reads the saved connections on each pass, so a key saved in Settings is used with no restart. */
  sources: () => Promise<MarketSources>;
  /** CONNECTIONS_KEY, to store a renewed Dhan token. Renewal is skipped when null. */
  connectionsKey: Buffer | null;
  /** Nifty 500 symbols; empty when nifty500.csv is missing. */
  members: string[];
  logger: Logger;
  now?: () => Date;
  backfillYears?: number;
};

// Source labels stored with each point; the page shows them.
const NSE_CLOSE = "Dhan · NSE close";
const GOLD_LABEL = "Dhan · MCX gold future";
const PCR_LABEL = "Dhan · NSE option chain, nearest expiry";
const BREADTH_LABEL = "Worked out from Dhan · NSE closes";
const FRED_SERIES = [
  { id: "VIXCLS", series: "us_vix", label: "FRED · Cboe VIX close" },
  { id: "DEXINUS", series: "usd_inr", label: "FRED · Federal Reserve noon rate, New York" },
] as const;

const HOUR_MS = 3_600_000;
/** A Dhan token is renewed when it has less than this left. */
const RENEW_WITHIN_MS = 6 * HOUR_MS;
/** Dhan tokens last 24 hours; assumed when a renewal names no expiry. */
const TOKEN_LIFE_MS = 24 * HOUR_MS;
/** 15:45 IST, in minutes after midnight: the day's close and option chain are settled. */
const AFTER_CLOSE_MINUTES = 15 * 60 + 45;
/** Calendar days of member closes loaded before the first day needing breadth (252 sessions and holidays). */
const BREADTH_LOOKBACK_DAYS = 400;
/** Share of members that may fail in a pass before breadth is held back (at least 1 may). */
const MAX_MEMBER_FAILURE_SHARE = 0.05;
/** A new breadth day waits until this share of the members with a close on the session before have one on it. */
const MIN_MEMBER_COVERAGE = 0.95;
/** Breadth days worked out per query of member closes, to cap memory on a backfill. */
const BREADTH_CHUNK_DAYS = 250;

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minus(day: string, years: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

type Failure = { provider: MarketConnectionProvider | null; code: string; message: string };

/** Failures that stop the whole Dhan part: every later call would fail the same way. */
const STOPS_DHAN = new Set(["DHAN_TOKEN_EXPIRED", "DHAN_RATE_LIMITED", "DHAN_NO_DATA_PLAN"]);
const stopsDhan = (err: unknown) => err instanceof MarketSourceError && STOPS_DHAN.has(err.code);

/** 23:55 IST: MCX has closed, so today's gold candle is final. */
const MCX_CLOSED_MINUTES = 23 * 60 + 55;

/** One pass: what it has written so far and the clock it runs on. */
class Pass {
  written = 0;
  /** IST calendar day. */
  readonly today: string;
  readonly afterClose: boolean;
  /** The last day whose close is settled: today after 15:45 IST, otherwise yesterday. */
  readonly lastClose: string;
  /** The last day whose MCX gold close is settled: today after the MCX close, otherwise yesterday. */
  readonly goldUntil: string;
  readonly backfillFrom: string;
  private cleared = new Set<MarketConnectionProvider>();
  private goldList: Promise<GoldContract[]> | undefined;

  constructor(private readonly deps: MarketRefresherDeps, readonly now: Date) {
    const istMs = now.getTime() + 19_800_000;
    this.today = ist(now.getTime() / 1000);
    const minutes = Math.floor((istMs % 86_400_000) / 60_000);
    this.afterClose = minutes >= AFTER_CLOSE_MINUTES;
    this.lastClose = this.afterClose ? this.today : addDays(this.today, -1);
    this.goldUntil = minutes >= MCX_CLOSED_MINUTES ? this.today : addDays(this.today, -1);
    this.backfillFrom = minus(this.today, deps.backfillYears ?? 4);
  }

  async store(series: string, points: DailyPoint[], source: string): Promise<void> {
    if (points.length === 0) return;
    this.written += await upsertMarketPoints(this.deps.db, points.map((p) => ({ series, day: p.day, value: p.value, source })));
  }

  /** The scrip master's gold contracts, read at most once a pass. */
  goldContracts(dhan: DhanSource): Promise<GoldContract[]> {
    this.goldList ??= dhan.goldContracts();
    return this.goldList;
  }

  /** After a provider's first good call in a pass, clears what it said last time. */
  async answered(provider: MarketConnectionProvider): Promise<void> {
    if (this.cleared.has(provider)) return;
    this.cleared.add(provider);
    await markConnectionError(this.deps.db, provider, null);
  }
}

export class MarketRefresher {
  constructor(private readonly deps: MarketRefresherDeps) {}

  async refresh(): Promise<"ran" | "skipped"> {
    const { db, logger } = this.deps;
    const runId = await startMarketFetch(db);
    if (!runId) return "skipped";
    let pass: Pass | null = null;
    const failures: Failure[] = [];
    try {
      pass = new Pass(this.deps, this.deps.now?.() ?? new Date());
      const sources = await this.deps.sources();
      // Not connected is recorded, so the page can send the investor to Settings.
      if (!sources.dhan) failures.push({ provider: "dhan", code: "DHAN_NOT_CONNECTED", message: "Dhan is not connected" });
      if (!sources.fred) failures.push({ provider: "fred", code: "FRED_NOT_CONNECTED", message: "FRED is not connected" });
      if (sources.fred) {
        try {
          await this.fred(pass, sources.fred);
        } catch (err) {
          failures.push(await this.failed("fred", err));
        }
      }
      if (sources.dhan) {
        try {
          await this.dhan(pass, sources.dhan, failures);
        } catch (err) {
          failures.push(await this.failed("dhan", err));
        }
      }
    } catch (err) {
      failures.push(await this.failed(null, err));
    }
    // An expired Dhan token is what the page tells the person about, so it wins.
    const failure = failures.find((f) => f.provider === "dhan") ?? failures[0];
    const written = pass?.written ?? 0;
    try {
      await finishMarketFetch(db, runId, failure
        ? { state: "failed", pointsWritten: written, errorCode: failure.code, errorMessage: failure.message.slice(0, 500) }
        : { state: "ok", pointsWritten: written });
    } catch (err) {
      logger.error({ message: (err as Error).message }, "market refresh could not record its run");
    }
    return "ran";
  }

  /** Logs the failure by code and message only, and marks the connection when the source refused its key. */
  private async failed(provider: MarketConnectionProvider | null, err: unknown): Promise<Failure> {
    const code = err instanceof MarketSourceError ? err.code : "UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    this.deps.logger.warn({ provider, code, message }, "market refresh failed");
    try {
      if (provider === "dhan" && (code === "DHAN_TOKEN_EXPIRED" || code === "DHAN_NO_DATA_PLAN")) await markConnectionError(this.deps.db, "dhan", code);
      if (provider === "fred" && code === "FRED_KEY_REFUSED") await markConnectionError(this.deps.db, "fred", code);
    } catch (markErr) {
      this.deps.logger.error({ provider, message: (markErr as Error).message }, "market refresh could not mark the connection");
    }
    return { provider, code, message };
  }

  private async fred(pass: Pass, fred: FredSource): Promise<void> {
    for (const s of FRED_SERIES) {
      const from = (await latestMarketDay(this.deps.db, s.series)) ?? pass.backfillFrom;
      const points = await fred.observations(s.id, from);
      await pass.answered("fred");
      await pass.store(s.series, points, s.label);
    }
  }

  /**
   * The Dhan part. A failure in gold or the option chain is recorded and the pass carries on to
   * breadth; a token, rate-limit or subscription failure stops the Dhan part.
   */
  private async dhan(pass: Pass, initial: DhanSource, failures: Failure[]): Promise<void> {
    const dhan = await this.renewIfDue(pass, initial);
    await this.dhanSeries(pass, dhan, "nifty50", NIFTY_50);
    await this.dhanSeries(pass, dhan, "india_vix", INDIA_VIX);
    // The option chain is live only, so it goes before the long member loop.
    for (const step of [() => this.gold(pass, dhan), () => this.putCallRatio(pass, dhan)]) {
      try {
        await step();
      } catch (err) {
        if (stopsDhan(err)) throw err;
        failures.push(await this.failed("dhan", err));
      }
    }
    await this.breadth(pass, dhan);
  }

  /**
   * Renews the Dhan token when it has less than 6 hours left, stores the new one at once and
   * returns a source built with it (renewal expires the old token). Throws only when Dhan
   * refuses the token; any other failure carries on with the current one.
   */
  private async renewIfDue(pass: Pass, dhan: DhanSource): Promise<DhanSource> {
    const { db, connectionsKey, logger } = this.deps;
    if (!connectionsKey) return dhan;
    const row = await getConnection(db, "dhan");
    if (!row?.clientId || !row.expiresAt || row.expiresAt.getTime() - pass.now.getTime() > RENEW_WITHIN_MS) return dhan;

    let renewed: { accessToken: string; expiresAt: string | null };
    try {
      renewed = await dhan.renewToken();
    } catch (err) {
      if (err instanceof MarketSourceError && err.code === "DHAN_TOKEN_EXPIRED") throw err;
      logger.warn({ code: err instanceof MarketSourceError ? err.code : "UNKNOWN" }, "Dhan token renewal failed; carrying on with the current token");
      return dhan;
    }
    const expiresAt = renewed.expiresAt ? new Date(renewed.expiresAt) : new Date(pass.now.getTime() + TOKEN_LIFE_MS);
    try {
      await saveConnection(db, {
        provider: "dhan",
        clientId: row.clientId,
        secretCiphertext: encryptSecret(renewed.accessToken, connectionsKey),
        secretLast4: renewed.accessToken.slice(-4),
        expiresAt,
        checkedAt: pass.now,
        savedByUserId: row.savedByUserId,
        // A renewal proves the token, not the Data API subscription.
        lastErrorCode: row.lastErrorCode === "DHAN_NO_DATA_PLAN" ? "DHAN_NO_DATA_PLAN" : null,
      });
    } catch {
      // The old token is expired now and the new one is lost; Settings has to ask for a new one.
      // Nothing from the error is logged: it may carry the query's parameters.
      logger.error("renewed Dhan token could not be saved; save a new one in Settings");
      throw new MarketSourceError("DHAN_TOKEN_EXPIRED", "the renewed Dhan token could not be saved");
    }
    logger.info({ expiresAt: expiresAt.toISOString() }, "Dhan token renewed");
    const renewedSource = (await this.deps.sources()).dhan;
    if (!renewedSource) throw new Error("renewed token could not be loaded");
    return renewedSource;
  }

  /** Fetches from the last stored day (or the backfill start) to the last settled close. */
  private async dhanSeries(pass: Pass, dhan: DhanSource, series: string, inst: Instrument): Promise<void> {
    const from = (await latestMarketDay(this.deps.db, series)) ?? pass.backfillFrom;
    if (from > pass.lastClose) return;
    const points = await dhan.daily(inst, from, pass.lastClose);
    await pass.answered("dhan"); // a good daily() also proves the Data API subscription
    await pass.store(series, points.filter((p) => p.day <= pass.lastClose), NSE_CLOSE);
  }

  /**
   * The near-month MCX gold future, from the day after the last stored day. Expired contracts are
   * not in the scrip master, so a backfill holds only the current contract's own history.
   */
  private async gold(pass: Pass, dhan: DhanSource): Promise<void> {
    const { db, logger } = this.deps;
    const latest = await latestMarketDay(db, "gold_mcx");
    // Gold is read only at or before Nifty days; skip the scrip master download when the Nifty has nothing newer.
    const nifty = await latestMarketDay(db, "nifty50");
    if (latest && (!nifty || nifty <= latest)) return;
    // MCX trades into the evening: today's candle is read only once it is final.
    const from = latest ? addDays(latest, 1) : pass.backfillFrom;
    if (from > pass.goldUntil) return;
    const [contract] = await pass.goldContracts(dhan);
    if (!contract) {
      logger.warn("no unexpired MCX gold contract in the scrip master; gold skipped");
      return;
    }
    const points = (await dhan.daily(contract, from, pass.goldUntil)).filter((p) => p.day <= pass.goldUntil);
    await pass.answered("dhan");
    if (!latest && points[0]) logger.info(`gold history starts ${points[0].day}`);
    await pass.store("gold_mcx", points, GOLD_LABEL);
  }

  /**
   * Member closes and the two breadth series, for every stored Nifty day after the last breadth
   * day. Keyed on breadth rather than on this pass's new Nifty days, so a pass that stopped
   * part-way, or a member list added later, is caught up on the next pass. A new day that too few
   * members have a close for yet is held back, with the days after it, until a later pass.
   */
  private async breadth(pass: Pass, dhan: DhanSource): Promise<void> {
    const { db, logger, members } = this.deps;
    if (members.length === 0) {
      logger.info("nifty500.csv not found; breadth skipped");
      return;
    }
    const lastBreadth = await latestMarketDay(db, "n500_above_200d_pct");
    // From the last breadth day itself, so the first new day has its previous session.
    const sessions = ((await listMarketSeries(db, ["nifty50"], lastBreadth ?? "0001-01-01")).nifty50 ?? []).map((p) => p.day);
    const days = lastBreadth ? sessions.filter((d) => d > lastBreadth) : sessions;
    const lastDay = days.at(-1);
    if (!lastDay) return;

    const ids = await dhan.equityIds();
    const unknown: string[] = [];
    const failed: string[] = [];
    let withIds = 0;
    for (const symbol of members) {
      const securityId = ids.get(symbol);
      if (!securityId) {
        unknown.push(symbol);
        continue;
      }
      withIds++;
      const series = `eq:${symbol}`;
      const latest = await latestMarketDay(db, series);
      // Only members still missing a close for the newest day are asked again.
      if (latest && latest >= lastDay) continue;
      const from = latest ?? pass.backfillFrom;
      let points: DailyPoint[];
      try {
        points = await dhan.daily({ securityId, exchangeSegment: "NSE_EQ", instrument: "EQUITY" }, from, pass.lastClose);
      } catch (err) {
        // A token or rate-limit failure stops the pass; one symbol Dhan will not answer for does not.
        if (stopsDhan(err)) throw err;
        failed.push(symbol);
        continue;
      }
      await pass.answered("dhan");
      await pass.store(series, points.filter((p) => p.day <= pass.lastClose), NSE_CLOSE);
    }
    if (unknown.length) logger.warn({ count: unknown.length, symbols: unknown.slice(0, 50) }, "Nifty 500 members with no Dhan id; left out of breadth");
    if (failed.length) logger.warn({ count: failed.length, symbols: failed.slice(0, 50) }, "Nifty 500 members Dhan did not answer for; left out of breadth this pass");
    // Breadth from a thin set of members would be stored and never worked out again, so too many failures stop it.
    if (failed.length > Math.max(1, Math.floor(withIds * MAX_MEMBER_FAILURE_SHARE))) {
      throw new MarketSourceError("SOURCE_UNAVAILABLE", `Dhan did not answer for ${failed.length} of ${withIds} Nifty 500 members`);
    }

    const wanted = new Set(members.map((s) => `eq:${s}`));
    const previous = new Map(sessions.slice(1).map((d, k) => [d, sessions[k]!]));
    for (let start = 0; start < days.length; start += BREADTH_CHUNK_DAYS) {
      let chunk = days.slice(start, start + BREADTH_CHUNK_DAYS);
      const stored = await listMarketValuesByPrefix(db, "eq:", addDays(chunk[0]!, -BREADTH_LOOKBACK_DAYS), chunk.at(-1)!);
      const closes = new Map(Object.entries(stored).filter(([series]) => wanted.has(series)));
      // Only days added after stored breadth are checked; a backfill is worked out as it stands.
      const held = lastBreadth ? chunk.findIndex((d) => this.thin(closes, d, previous.get(d))) : -1;
      if (held >= 0) chunk = chunk.slice(0, held);
      const result = breadthOn(closes, chunk);
      await pass.store("n500_above_200d_pct", result.flatMap((r) => (r.above200 === null ? [] : [{ day: r.day, value: r.above200 }])), BREADTH_LABEL);
      await pass.store("n500_net_highs_pct", result.flatMap((r) => (r.netHighs === null ? [] : [{ day: r.day, value: r.netHighs }])), BREADTH_LABEL);
      if (held >= 0) break;
    }
  }

  /**
   * True when fewer than 95% of the members with a close on the previous session have one on
   * `day` (Dhan can publish the index candle before every member's), and logs it.
   */
  private thin(closes: Map<string, DailyPoint[]>, day: string, previous: string | undefined): boolean {
    if (!previous) return false;
    let had = 0;
    let have = 0;
    for (const points of closes.values()) {
      const days = new Set(points.slice(-BREADTH_LOOKBACK_DAYS).map((p) => p.day));
      if (!days.has(previous)) continue;
      had++;
      if (days.has(day)) have++;
    }
    if (had === 0 || have >= had * MIN_MEMBER_COVERAGE) return false;
    this.deps.logger.info(`breadth for ${day} held back: ${have} of ${had} members have a close`);
    return true;
  }

  /**
   * Dhan's option chain is live only, so the ratio is stored once a day, after 15:45 IST, on a day
   * the Nifty has a close for (which leaves out weekends and holidays).
   */
  private async putCallRatio(pass: Pass, dhan: DhanSource): Promise<void> {
    const { db } = this.deps;
    if (!pass.afterClose) return;
    if ((await latestMarketDay(db, "nifty50")) !== pass.today) return;
    if ((await latestMarketDay(db, "nifty_pcr_oi")) === pass.today) return;
    const ratio = await dhan.putCallRatio();
    await pass.store("nifty_pcr_oi", [{ day: pass.today, value: ratio }], PCR_LABEL);
  }
}
