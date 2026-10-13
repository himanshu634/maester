import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConnection, latestMarketDay, latestMarketFetch, listMarketSeries, saveConnection } from "@maester/db";
import {
  decryptSecret, encryptSecret, INDIA_VIX, MarketSourceError, NIFTY_50,
  type DailyPoint, type DhanSource, type FredSource, type GoldContract, type Instrument,
} from "@maester/market";
import { MarketRefresher } from "../src/market/refresh.js";
import { createWorkerContext } from "./context.js";

const KEY = Buffer.alloc(32, 7);
const GOLD: GoldContract = { securityId: "495213", exchangeSegment: "MCX_COMM", instrument: "FUTCOM", expiry: "2026-12-04" };
const IDS = new Map([["RELIANCE", "2885"], ["TCS", "11536"]]);

/** 2026-10-06 is a Tuesday; 12:00Z is 17:30 IST, after the close. */
const TUESDAY_EVENING = new Date("2026-10-06T12:00:00Z");

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Weekdays from `from` to `to`, inclusive. */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

type DailyCall = { securityId: string; from: string; to: string };

/** A Dhan that has a close for every weekday up to `lastDay`, with each instrument's own shape. */
class FakeDhan implements DhanSource {
  dailyCalls: DailyCall[] = [];
  pcrCalls = 0;
  equityIdCalls = 0;
  renewCalls = 0;
  goldCalls = 0;
  ids = IDS;
  /** Security id → the last day Dhan has a close for it, when that is before `lastDay`. */
  lagging = new Map<string, string>();
  /** Security ids whose daily() fails with SOURCE_UNAVAILABLE. */
  unavailable = new Set<string>();
  failDaily: MarketSourceError | null = null;
  renewResult: { accessToken: string; expiresAt: string | null } | MarketSourceError = { accessToken: "renewed-token-abcd9999", expiresAt: "2026-10-07T12:00:00.000Z" };
  constructor(public lastDay: string, public goldFrom = "2026-01-01") {}

  async daily(inst: Instrument, from: string, to: string): Promise<DailyPoint[]> {
    this.dailyCalls.push({ securityId: inst.securityId, from, to });
    if (this.failDaily) throw this.failDaily;
    if (this.unavailable.has(inst.securityId)) throw new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan answered 400 DH-905");
    const start = inst.securityId === GOLD.securityId && from < this.goldFrom ? this.goldFrom : from;
    const last = this.lagging.get(inst.securityId) ?? this.lastDay;
    const end = to < last ? to : last;
    const shape: Record<string, (i: number) => number> = {
      [NIFTY_50.securityId]: (i) => 20_000 + i,
      [INDIA_VIX.securityId]: (i) => 12 + (i % 7),
      [GOLD.securityId]: (i) => 70_000 + 3 * i,
      "2885": (i) => 1000 + i, // rising
      "11536": (i) => 5000 - i, // falling
    };
    const f = shape[inst.securityId] ?? ((i: number) => 1000 + i);
    return weekdays(start, end).map((day) => ({ day, value: f(Date.parse(day) / 86_400_000) }));
  }
  async putCallRatio(): Promise<number> {
    this.pcrCalls++;
    return 0.92;
  }
  async equityIds(): Promise<Map<string, string>> {
    this.equityIdCalls++;
    return this.ids;
  }
  async goldContracts(): Promise<GoldContract[]> {
    this.goldCalls++;
    return [GOLD];
  }
  async profile(): Promise<{ clientId: string; tokenExpiresAt: string | null; dataPlanActive: boolean | null }> {
    return { clientId: "1000000001", tokenExpiresAt: null, dataPlanActive: true };
  }
  async renewToken(): Promise<{ accessToken: string; expiresAt: string | null }> {
    this.renewCalls++;
    if (this.renewResult instanceof MarketSourceError) throw this.renewResult;
    return this.renewResult;
  }
  callsFor(inst: { securityId: string }): DailyCall[] {
    return this.dailyCalls.filter((c) => c.securityId === inst.securityId);
  }
}

class FakeFred implements FredSource {
  calls: { seriesId: string; from: string }[] = [];
  fail: MarketSourceError | null = null;
  constructor(public lastDay: string) {}
  async observations(seriesId: string, from: string): Promise<DailyPoint[]> {
    this.calls.push({ seriesId, from });
    if (this.fail) throw this.fail;
    return weekdays(from, this.lastDay).map((day, i) => ({ day, value: seriesId === "VIXCLS" ? 15 + (i % 5) : 83 + i / 1000 }));
  }
  async check(): Promise<void> {}
}

function recordingLogger() {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _enc, done) { lines.push(String(chunk)); done(); } });
  return { logger: pino({ level: "debug" }, stream), lines };
}

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeEach(async () => { ctx = await createWorkerContext(); });
afterEach(() => ctx.close());

function refresher(opts: {
  dhan?: FakeDhan | null; fred?: FakeFred | null; now?: Date; members?: string[];
  connectionsKey?: Buffer | null; logger?: pino.Logger; sources?: () => Promise<{ dhan: DhanSource | null; fred: FredSource | null }>;
}) {
  const dhan = opts.dhan === undefined ? new FakeDhan("2026-10-06") : opts.dhan;
  const fred = opts.fred === undefined ? new FakeFred("2026-10-05") : opts.fred;
  const now = opts.now ?? TUESDAY_EVENING;
  return new MarketRefresher({
    db: ctx.db,
    sources: opts.sources ?? (async () => ({ dhan, fred })),
    connectionsKey: opts.connectionsKey ?? null,
    members: opts.members ?? ["RELIANCE", "TCS"],
    logger: opts.logger ?? ctx.logger,
    now: () => now,
  });
}

async function seedDhan(overrides: { expiresAt?: Date | null; lastErrorCode?: string | null } = {}) {
  await saveConnection(ctx.db, {
    provider: "dhan", clientId: "1000000001", secretCiphertext: encryptSecret("old-token-1234", KEY), secretLast4: "1234",
    expiresAt: overrides.expiresAt === undefined ? new Date("2026-10-07T09:00:00Z") : overrides.expiresAt,
    checkedAt: new Date("2026-10-06T09:00:00Z"), savedByUserId: null, lastErrorCode: overrides.lastErrorCode ?? null,
  });
}

async function seedFred(lastErrorCode: string | null = null) {
  await saveConnection(ctx.db, {
    provider: "fred", clientId: null, secretCiphertext: encryptSecret("fred-key-5678", KEY), secretLast4: "5678",
    expiresAt: null, checkedAt: new Date("2026-10-06T09:00:00Z"), savedByUserId: null, lastErrorCode,
  });
}

describe("MarketRefresher", () => {
  it("backfills 4 years on the first run", async () => {
    const dhan = new FakeDhan("2026-10-06");
    const fred = new FakeFred("2026-10-05");
    const { logger, lines } = recordingLogger();
    expect(await refresher({ dhan, fred, logger }).refresh()).toBe("ran");

    for (const inst of [NIFTY_50, INDIA_VIX, { securityId: "2885" }, { securityId: "11536" }]) {
      expect(dhan.callsFor(inst)).toEqual([{ securityId: inst.securityId, from: "2022-10-06", to: "2026-10-06" }]);
    }
    // MCX is still trading at 17:30 IST, so gold stops at yesterday's settled close.
    expect(dhan.callsFor(GOLD)).toEqual([{ securityId: GOLD.securityId, from: "2022-10-06", to: "2026-10-05" }]);
    expect(fred.calls).toEqual([{ seriesId: "VIXCLS", from: "2022-10-06" }, { seriesId: "DEXINUS", from: "2022-10-06" }]);

    const keys = ["nifty50", "india_vix", "gold_mcx", "eq:RELIANCE", "eq:TCS", "n500_above_200d_pct", "n500_net_highs_pct", "us_vix", "usd_inr", "nifty_pcr_oi"];
    const stored = await listMarketSeries(ctx.db, keys, "2000-01-01");
    for (const key of keys) expect(stored[key]!.length, key).toBeGreaterThan(0);
    // Worked out in chunks, with no day lost between them.
    const niftyDays = stored.nifty50!.map((p) => p.day);
    expect(stored.n500_above_200d_pct!.map((p) => p.day)).toEqual(niftyDays.slice(niftyDays.indexOf(stored.n500_above_200d_pct![0]!.day)));
    expect(stored.nifty50![0]).toMatchObject({ day: "2022-10-06", source: "Dhan · NSE close" });
    expect(stored.gold_mcx![0]).toMatchObject({ day: "2026-01-01", source: "Dhan · MCX gold future" });
    expect(stored.us_vix![0]!.source).toBe("FRED · Cboe VIX close");
    expect(stored.usd_inr![0]!.source).toBe("FRED · Federal Reserve noon rate, New York");
    expect(stored["eq:TCS"]![0]!.source).toBe("Dhan · NSE close");
    expect(stored.nifty_pcr_oi).toEqual([expect.objectContaining({ day: "2026-10-06", value: 0.92, source: "Dhan · NSE option chain, nearest expiry" })]);

    // One member rising, one falling: half above the average, one high and one low.
    const above = stored.n500_above_200d_pct!;
    expect(above.at(-1)).toMatchObject({ day: "2026-10-06", value: 50, source: "Worked out from Dhan · NSE closes" });
    expect(stored.n500_net_highs_pct!.at(-1)).toMatchObject({ day: "2026-10-06", value: 0 });
    // Not before a member has 200 closes.
    expect(above[0]!.day > "2023-07-01").toBe(true);

    const run = await latestMarketFetch(ctx.db);
    expect(run).toMatchObject({ state: "ok", errorCode: null });
    expect(run!.pointsWritten).toBeGreaterThan(0);
    expect(lines.join("")).toContain("gold history starts 2026-01-01");
  });

  it("fetches only from the last stored day on a later run", async () => {
    await refresher({ dhan: new FakeDhan("2026-10-06"), now: TUESDAY_EVENING }).refresh();

    const wednesday = new Date("2026-10-07T12:00:00Z");
    const dhan = new FakeDhan("2026-10-07");
    const fred = new FakeFred("2026-10-06");
    await refresher({ dhan, fred, now: wednesday }).refresh();

    expect(dhan.callsFor(NIFTY_50)).toEqual([{ securityId: NIFTY_50.securityId, from: "2026-10-06", to: "2026-10-07" }]);
    expect(dhan.callsFor(INDIA_VIX)[0]!.from).toBe("2026-10-06");
    expect(dhan.callsFor(GOLD)[0]).toMatchObject({ from: "2026-10-06", to: "2026-10-06" }); // the day after the last gold day, up to yesterday
    expect(dhan.callsFor({ securityId: "2885" })[0]!.from).toBe("2026-10-06");
    expect(fred.calls).toEqual([{ seriesId: "VIXCLS", from: "2026-10-05" }, { seriesId: "DEXINUS", from: "2026-10-05" }]);
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-07");
    expect(await latestMarketDay(ctx.db, "nifty_pcr_oi")).toBe("2026-10-07");
  });

  it("does not fetch members again when the Nifty has no new day", async () => {
    await refresher({}).refresh();
    const dhan = new FakeDhan("2026-10-06");
    await refresher({ dhan }).refresh();
    expect(dhan.equityIdCalls).toBe(0);
    expect(dhan.goldCalls).toBe(0);
    expect(dhan.callsFor({ securityId: "2885" })).toEqual([]);
    expect(dhan.callsFor(NIFTY_50)).toHaveLength(1);
  });

  it("works out breadth for days a stopped pass left behind", async () => {
    // The first pass stores the Nifty, then stops on the members.
    const first = new FakeDhan("2026-10-06");
    first.equityIds = async () => { throw new MarketSourceError("DHAN_RATE_LIMITED", "Dhan rate limit reached"); };
    await refresher({ dhan: first }).refresh();
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-06");
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBeNull();

    const dhan = new FakeDhan("2026-10-06");
    await refresher({ dhan }).refresh();
    expect(dhan.callsFor({ securityId: "2885" })).toHaveLength(1);
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-06");
  });

  it("leaves out a member Dhan will not answer for, and still stores breadth and the put–call ratio", async () => {
    const dhan = new FakeDhan("2026-10-06");
    dhan.unavailable.add("11536");
    const { logger, lines } = recordingLogger();
    await refresher({ dhan, logger }).refresh();
    expect(await latestMarketDay(ctx.db, "eq:RELIANCE")).toBe("2026-10-06");
    expect(await latestMarketDay(ctx.db, "eq:TCS")).toBeNull();
    const above = (await listMarketSeries(ctx.db, ["n500_above_200d_pct"], "2026-10-06")).n500_above_200d_pct;
    expect(above).toEqual([expect.objectContaining({ day: "2026-10-06", value: 100 })]);
    expect(await latestMarketDay(ctx.db, "nifty_pcr_oi")).toBe("2026-10-06");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "ok" });
    expect(lines.filter((l) => l.includes("did not answer for"))).toHaveLength(1);
  });

  it("holds breadth back when too many members fail", async () => {
    const dhan = new FakeDhan("2026-10-06");
    dhan.unavailable.add("11536").add("2885");
    await refresher({ dhan }).refresh();
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBeNull();
    expect(await latestMarketDay(ctx.db, "nifty_pcr_oi")).toBe("2026-10-06");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("holds back a new breadth day too few members have a close for, then fetches only the missing ones", async () => {
    const symbols = Array.from({ length: 10 }, (_, i) => `S${i}`);
    const ids = new Map(symbols.map((sym, i) => [sym, `9${i}`]));
    const first = new FakeDhan("2026-10-06");
    first.ids = ids;
    await refresher({ dhan: first, members: symbols }).refresh();
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-06");

    const wednesday = new Date("2026-10-07T12:00:00Z");
    const thin = new FakeDhan("2026-10-07");
    thin.ids = ids;
    thin.lagging.set("99", "2026-10-06"); // 1 of 10 members has no close yet
    const { logger, lines } = recordingLogger();
    await refresher({ dhan: thin, members: symbols, now: wednesday, logger }).refresh();
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-07");
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-06");
    expect(await latestMarketDay(ctx.db, "n500_net_highs_pct")).toBe("2026-10-06");
    expect(lines.join("")).toContain("breadth for 2026-10-07 held back: 9 of 10 members have a close");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "ok" });

    const later = new FakeDhan("2026-10-07");
    later.ids = ids;
    await refresher({ dhan: later, members: symbols, now: new Date("2026-10-07T12:30:00Z") }).refresh();
    expect(later.dailyCalls.filter((c) => c.securityId.startsWith("9")).map((c) => c.securityId)).toEqual(["99"]);
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-07");
  });

  it("stores the put–call ratio once a session day, only after 15:45 IST", async () => {
    // 15:30 IST: before the close; today's partial close is not fetched either.
    const dhan = new FakeDhan("2026-10-06");
    await refresher({ dhan, now: new Date("2026-10-06T10:00:00Z") }).refresh();
    expect(dhan.pcrCalls).toBe(0);
    expect(dhan.callsFor(NIFTY_50)[0]!.to).toBe("2026-10-05");
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-05");

    // 15:50 IST: after it.
    const later = new FakeDhan("2026-10-06");
    await refresher({ dhan: later, now: new Date("2026-10-06T10:20:00Z") }).refresh();
    expect(later.pcrCalls).toBe(1);
    const again = new FakeDhan("2026-10-06");
    await refresher({ dhan: again, now: new Date("2026-10-06T11:00:00Z") }).refresh();
    expect(again.pcrCalls).toBe(0);
    expect((await listMarketSeries(ctx.db, ["nifty_pcr_oi"], "2000-01-01")).nifty_pcr_oi).toHaveLength(1);
  });

  it("does not store a put–call ratio on a day with no session", async () => {
    const saturday = new Date("2026-10-10T12:00:00Z");
    const dhan = new FakeDhan("2026-10-10");
    await refresher({ dhan, now: saturday }).refresh();
    expect(dhan.pcrCalls).toBe(0);
    expect(await latestMarketDay(ctx.db, "nifty_pcr_oi")).toBeNull();
  });

  it("stops the Dhan part on an expired token, keeps FRED's points and marks the connection", async () => {
    await seedDhan();
    const dhan = new FakeDhan("2026-10-06");
    dhan.failDaily = new MarketSourceError("DHAN_TOKEN_EXPIRED", "Dhan refused the access token");
    expect(await refresher({ dhan }).refresh()).toBe("ran");

    expect(dhan.dailyCalls).toHaveLength(1);
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_TOKEN_EXPIRED" });
    expect(await latestMarketDay(ctx.db, "us_vix")).toBe("2026-10-05");
    expect((await getConnection(ctx.db, "dhan"))!.lastErrorCode).toBe("DHAN_TOKEN_EXPIRED");
  });

  it("marks a refused FRED key and still runs Dhan", async () => {
    await seedFred();
    const fred = new FakeFred("2026-10-05");
    fred.fail = new MarketSourceError("FRED_KEY_REFUSED", "FRED refused the API key (400)");
    await refresher({ fred }).refresh();
    expect((await getConnection(ctx.db, "fred"))!.lastErrorCode).toBe("FRED_KEY_REFUSED");
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-06");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "FRED_KEY_REFUSED" });
  });

  it("clears each provider's error after a good call, including a missing data plan once daily works", async () => {
    await seedDhan({ lastErrorCode: "DHAN_NO_DATA_PLAN" });
    await seedFred("FRED_KEY_REFUSED");
    await refresher({}).refresh();
    expect((await getConnection(ctx.db, "dhan"))!.lastErrorCode).toBeNull();
    expect((await getConnection(ctx.db, "fred"))!.lastErrorCode).toBeNull();
  });

  it("skips while another run is in progress, making no calls", async () => {
    await ctx.db.execute(sql`insert into market_fetch (id, state) values (${crypto.randomUUID()}::uuid, 'running')`);
    let asked = 0;
    const r = refresher({ sources: async () => { asked++; return { dhan: null, fred: null }; } });
    expect(await r.refresh()).toBe("skipped");
    expect(asked).toBe(0);
  });

  it("records a source that is not connected, so the page can send the investor to Settings", async () => {
    await refresher({ dhan: null }).refresh();
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_NOT_CONNECTED" });
    expect(await latestMarketDay(ctx.db, "us_vix")).toBe("2026-10-05");
    expect(await latestMarketDay(ctx.db, "nifty50")).toBeNull();

    await refresher({ fred: null }).refresh();
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "FRED_NOT_CONNECTED" });
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-06");

    await refresher({ dhan: null, fred: null }).refresh();
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_NOT_CONNECTED" });
  });

  it("records a lapsed Data API subscription and marks the Dhan connection with it", async () => {
    await seedDhan();
    const dhan = new FakeDhan("2026-10-06");
    dhan.failDaily = new MarketSourceError("DHAN_NO_DATA_PLAN", "Dhan answered 500 DH-902");
    await refresher({ dhan }).refresh();
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_NO_DATA_PLAN" });
    expect((await getConnection(ctx.db, "dhan"))!.lastErrorCode).toBe("DHAN_NO_DATA_PLAN");
  });

  it("carries on to breadth when gold fails, and records the failure", async () => {
    const dhan = new FakeDhan("2026-10-06");
    dhan.unavailable.add(GOLD.securityId);
    await refresher({ dhan, members: ["RELIANCE", "TCS"] }).refresh();
    expect(await latestMarketDay(ctx.db, "gold_mcx")).toBeNull();
    expect(await latestMarketDay(ctx.db, "nifty_pcr_oi")).not.toBeNull();
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-06");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "SOURCE_UNAVAILABLE" });
  });

  it("reads gold only up to yesterday until MCX has closed for the day", async () => {
    const dhan = new FakeDhan("2026-10-06");
    await refresher({ dhan }).refresh(); // 17:30 IST on 6 Oct: MCX is still trading
    expect(await latestMarketDay(ctx.db, "gold_mcx")).toBe("2026-10-05");
    expect(await latestMarketDay(ctx.db, "nifty50")).toBe("2026-10-06");
    await refresher({ dhan, now: new Date("2026-10-06T18:40:00Z") }).refresh(); // 00:10 IST on 7 Oct
    expect(await latestMarketDay(ctx.db, "gold_mcx")).toBe("2026-10-06");
  });

  it("finishes the run failed when the saved connections cannot be read", async () => {
    const r = refresher({ sources: async () => { throw new Error("the saved dhan connection could not be decrypted; save it again in Settings"); } });
    expect(await r.refresh()).toBe("ran");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "UNKNOWN" });
  });

  it("finishes the run failed when the clock throws, never leaving it running", async () => {
    const r = new MarketRefresher({
      db: ctx.db, sources: async () => ({ dhan: null, fred: null }), connectionsKey: null, members: [], logger: ctx.logger,
      now: () => { throw new Error("no clock"); },
    });
    expect(await r.refresh()).toBe("ran");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "UNKNOWN" });
  });

  it("skips members and breadth when the member list is missing", async () => {
    const dhan = new FakeDhan("2026-10-06");
    const { logger, lines } = recordingLogger();
    await refresher({ dhan, members: [], logger }).refresh();
    expect(dhan.equityIdCalls).toBe(0);
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBeNull();
    expect(lines.join("")).toContain("nifty500.csv not found; breadth skipped");
    expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "ok" });
  });

  it("leaves out a member with no Dhan id, saying so once", async () => {
    const dhan = new FakeDhan("2026-10-06");
    const { logger, lines } = recordingLogger();
    await refresher({ dhan, members: ["RELIANCE", "TCS", "NOTLISTED", "ALSONOT"], logger }).refresh();
    const said = lines.filter((l) => l.includes("no Dhan id"));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("NOTLISTED");
    expect(await latestMarketDay(ctx.db, "n500_above_200d_pct")).toBe("2026-10-06");
  });

  describe("renewing the Dhan token", () => {
    it("renews a token within 6 hours of expiry, saves it encrypted and uses it for the rest of the pass", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T16:00:00Z"), lastErrorCode: "DHAN_NO_DATA_PLAN" });
      const before = new FakeDhan("2026-10-06");
      const after = new FakeDhan("2026-10-06");
      let asked = 0;
      const { logger, lines } = recordingLogger();
      const r = refresher({
        connectionsKey: KEY, logger,
        sources: async () => { asked++; return { dhan: asked === 1 ? before : after, fred: null }; },
      });
      await r.refresh();

      expect(before.renewCalls).toBe(1);
      expect(before.dailyCalls).toEqual([]);
      expect(after.dailyCalls.length).toBeGreaterThan(0);
      const row = (await getConnection(ctx.db, "dhan"))!;
      expect(decryptSecret(row.secretCiphertext, KEY)).toBe("renewed-token-abcd9999");
      expect(row).toMatchObject({ clientId: "1000000001", secretLast4: "9999" });
      expect(row.expiresAt!.toISOString()).toBe("2026-10-07T12:00:00.000Z");
      // daily() then proved the data plan, so the code is cleared after the renewal kept it.
      expect(row.lastErrorCode).toBeNull();
      expect(lines.join("")).not.toContain("renewed-token-abcd9999");
      expect(lines.join("")).toContain("Dhan token renewed");
    });

    it("fails the run when the renewed token cannot be loaded", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      let asked = 0;
      await refresher({ connectionsKey: KEY, sources: async () => (++asked === 1 ? { dhan, fred: null } : { dhan: null, fred: null }) }).refresh();
      expect(dhan.dailyCalls).toEqual([]);
      expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "UNKNOWN", errorMessage: "renewed token could not be loaded" });
    });

    it("marks the token expired when the renewed one cannot be saved, logging no token", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      await ctx.db.execute(sql`alter table market_connection add constraint test_refuse_renewal check (secret_last4 <> '9999')`);
      try {
        const dhan = new FakeDhan("2026-10-06");
        const { logger, lines } = recordingLogger();
        await refresher({ dhan, connectionsKey: KEY, logger }).refresh();
        expect(dhan.dailyCalls).toEqual([]);
        expect(lines.join("")).toContain("renewed Dhan token could not be saved; save a new one in Settings");
        expect(lines.join("")).not.toContain("renewed-token-abcd9999");
        expect((await getConnection(ctx.db, "dhan"))!.lastErrorCode).toBe("DHAN_TOKEN_EXPIRED");
        expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_TOKEN_EXPIRED" });
      } finally {
        await ctx.db.execute(sql`alter table market_connection drop constraint test_refuse_renewal`);
      }
    });

    it("assumes 24 hours when Dhan sends no expiry", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      dhan.renewResult = { accessToken: "renewed-token-noexp", expiresAt: null };
      await refresher({ dhan, connectionsKey: KEY }).refresh();
      const row = (await getConnection(ctx.db, "dhan"))!;
      expect(row.expiresAt!.toISOString()).toBe(new Date(TUESDAY_EVENING.getTime() + 24 * 3_600_000).toISOString());
    });

    it("leaves a token with more than 6 hours alone", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-07T09:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      await refresher({ dhan, connectionsKey: KEY }).refresh();
      expect(dhan.renewCalls).toBe(0);
    });

    it("does not renew without the connections key", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      await refresher({ dhan, connectionsKey: null }).refresh();
      expect(dhan.renewCalls).toBe(0);
    });

    it("marks the connection and stops Dhan when the renewal is refused", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      dhan.renewResult = new MarketSourceError("DHAN_TOKEN_EXPIRED", "Dhan refused the request");
      await refresher({ dhan, connectionsKey: KEY }).refresh();
      expect(dhan.dailyCalls).toEqual([]);
      expect((await getConnection(ctx.db, "dhan"))!.lastErrorCode).toBe("DHAN_TOKEN_EXPIRED");
      expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "failed", errorCode: "DHAN_TOKEN_EXPIRED" });
    });

    it("carries on with the current token when the renewal does not answer", async () => {
      await seedDhan({ expiresAt: new Date("2026-10-06T13:00:00Z") });
      const dhan = new FakeDhan("2026-10-06");
      dhan.renewResult = new MarketSourceError("SOURCE_UNAVAILABLE", "Dhan could not be reached");
      await refresher({ dhan, connectionsKey: KEY }).refresh();
      expect(dhan.dailyCalls.length).toBeGreaterThan(0);
      expect(decryptSecret((await getConnection(ctx.db, "dhan"))!.secretCiphertext, KEY)).toBe("old-token-1234");
      expect(await latestMarketFetch(ctx.db)).toMatchObject({ state: "ok" });
    });
  });
});
