import {
  finishMarketFetch, getConnection, latestMarketDay, listMarketSeries, listMarketSeriesByPrefix, markConnectionError,
  saveConnection, startMarketFetch, upsertMarketPoints, type Db, type MarketConnectionProvider,
} from "@maester/db";
import {
  encryptSecret, INDIA_VIX, ist, MarketSourceError, NIFTY_50,
  type DailyPoint, type DhanSource, type FredSource, type Instrument,
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

/** One pass: what it has written so far and the clock it runs on. */
class Pass {
  written = 0;
  /** IST calendar day. */
  readonly today: string;
  readonly afterClose: boolean;
  /** The last day whose close is settled: today after 15:45 IST, otherwise yesterday. */
  readonly lastClose: string;
  readonly backfillFrom: string;
  private cleared = new Set<MarketConnectionProvider>();

  constructor(private readonly deps: MarketRefresherDeps, readonly now: Date) {
    const istMs = now.getTime() + 19_800_000;
    this.today = ist(now.getTime() / 1000);
    const minutes = Math.floor((istMs % 86_400_000) / 60_000);
    this.afterClose = minutes >= AFTER_CLOSE_MINUTES;
    this.lastClose = this.afterClose ? this.today : addDays(this.today, -1);
    this.backfillFrom = minus(this.today, deps.backfillYears ?? 4);
  }

  async store(series: string, points: DailyPoint[], source: string): Promise<void> {
    if (points.length === 0) return;
    this.written += await upsertMarketPoints(this.deps.db, points.map((p) => ({ series, day: p.day, value: p.value, source })));
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
    const pass = new Pass(this.deps, this.deps.now?.() ?? new Date());
    const failures: Failure[] = [];
    try {
      const sources = await this.deps.sources();
      if (sources.fred) {
        try {
          await this.fred(pass, sources.fred);
        } catch (err) {
          failures.push(await this.failed("fred", err));
        }
      }
      if (sources.dhan) {
        try {
          await this.dhan(pass, sources.dhan);
        } catch (err) {
          failures.push(await this.failed("dhan", err));
        }
      }
    } catch (err) {
      failures.push(await this.failed(null, err));
    }
    // An expired Dhan token is what the page tells the person about, so it wins.
    const failure = failures.find((f) => f.provider === "dhan") ?? failures[0];
    try {
      await finishMarketFetch(db, runId, failure
        ? { state: "failed", pointsWritten: pass.written, errorCode: failure.code, errorMessage: failure.message.slice(0, 500) }
        : { state: "ok", pointsWritten: pass.written });
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
      if (provider === "dhan" && code === "DHAN_TOKEN_EXPIRED") await markConnectionError(this.deps.db, "dhan", code);
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

  private async dhan(pass: Pass, initial: DhanSource): Promise<void> {
    const dhan = await this.renewIfDue(pass, initial);
    if (!dhan) return;
    await this.dhanSeries(pass, dhan, "nifty50", NIFTY_50);
    await this.dhanSeries(pass, dhan, "india_vix", INDIA_VIX);
    await this.gold(pass, dhan);
    await this.breadth(pass, dhan);
    await this.putCallRatio(pass, dhan);
  }

  /**
   * Renews the Dhan token when it has less than 6 hours left, stores the new one at once and
   * returns a source built with it (renewal expires the old token). Throws only when Dhan
   * refuses the token; any other failure carries on with the current one.
   */
  private async renewIfDue(pass: Pass, dhan: DhanSource): Promise<DhanSource | null> {
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
    logger.info({ expiresAt: expiresAt.toISOString() }, "Dhan token renewed");
    return (await this.deps.sources()).dhan;
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
    const [contract] = await dhan.goldContracts();
    if (!contract) {
      logger.warn("no unexpired MCX gold contract in the scrip master; gold skipped");
      return;
    }
    const latest = await latestMarketDay(db, "gold_mcx");
    const from = latest ? addDays(latest, 1) : pass.backfillFrom;
    if (from > pass.lastClose) return;
    const points = (await dhan.daily(contract, from, pass.lastClose)).filter((p) => p.day <= pass.lastClose);
    await pass.answered("dhan");
    if (!latest && points[0]) logger.info(`gold history starts ${points[0].day}`);
    await pass.store("gold_mcx", points, GOLD_LABEL);
  }

  /**
   * Member closes and the two breadth series, for every stored Nifty day after the last breadth
   * day. Keyed on breadth rather than on this pass's new Nifty days, so a pass that stopped
   * part-way, or a member list added later, is caught up on the next pass.
   */
  private async breadth(pass: Pass, dhan: DhanSource): Promise<void> {
    const { db, logger, members } = this.deps;
    if (members.length === 0) {
      logger.info("nifty500.csv not found; breadth skipped");
      return;
    }
    const lastBreadth = await latestMarketDay(db, "n500_above_200d_pct");
    const nifty = (await listMarketSeries(db, ["nifty50"], lastBreadth ? addDays(lastBreadth, 1) : "0001-01-01")).nifty50 ?? [];
    const days = nifty.map((p) => p.day);
    const lastDay = days.at(-1);
    if (!lastDay) return;

    const ids = await dhan.equityIds();
    const unknown: string[] = [];
    for (const symbol of members) {
      const securityId = ids.get(symbol);
      if (!securityId) {
        unknown.push(symbol);
        continue;
      }
      const series = `eq:${symbol}`;
      const latest = await latestMarketDay(db, series);
      if (latest && latest >= lastDay) continue;
      const from = latest ?? pass.backfillFrom;
      const points = await dhan.daily({ securityId, exchangeSegment: "NSE_EQ", instrument: "EQUITY" }, from, pass.lastClose);
      await pass.answered("dhan");
      await pass.store(series, points.filter((p) => p.day <= pass.lastClose), NSE_CLOSE);
    }
    if (unknown.length) logger.warn({ count: unknown.length, symbols: unknown.slice(0, 50) }, "Nifty 500 members with no Dhan id; left out of breadth");

    const wanted = new Set(members.map((s) => `eq:${s}`));
    const stored = await listMarketSeriesByPrefix(db, "eq:", addDays(days[0]!, -BREADTH_LOOKBACK_DAYS));
    const closes = new Map(Object.entries(stored).filter(([series]) => wanted.has(series)));
    const result = breadthOn(closes, days);
    await pass.store("n500_above_200d_pct", result.flatMap((r) => (r.above200 === null ? [] : [{ day: r.day, value: r.above200 }])), BREADTH_LABEL);
    await pass.store("n500_net_highs_pct", result.flatMap((r) => (r.netHighs === null ? [] : [{ day: r.day, value: r.netHighs }])), BREADTH_LABEL);
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
