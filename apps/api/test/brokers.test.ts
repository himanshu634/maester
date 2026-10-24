import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrokerAccount, BrokerList, HoldingsSnapshot } from "@maester/contracts";
import { getBrokerConnection, saveConnection, upsertMarketPoints } from "@maester/db";
import { decryptSecret, encryptSecret } from "@maester/market";
import { createTestContext, type TestContext } from "./context.js";

// Distinctive values, so a leak anywhere is easy to find.
const API_KEY = "kiteKEYleak123";
const API_SECRET = "kiteSECRETleak456";
const TOKEN = "kiteTOKENleak789";
const DHAN_TOKEN = "dhanTOKENleak321";
const DHAN_CLIENT = "1100012345";
const KEY = randomBytes(32);

type Answer = { status: number; body: unknown };
let session: Answer;
let holdings: Answer;
let dhanHoldings: Answer;
let growwSession: Answer = { status: 200, body: { token: "growwTOKENleak555", isActive: true } };
const calls: { url: string; init: RequestInit }[] = [];
const json = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
const brokerFetch = (async (url: string | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  if (String(url) === "https://api.kite.trade/session/token") return json(session);
  if (String(url) === "https://api.kite.trade/portfolio/holdings") return json(holdings);
  if (String(url) === "https://api.dhan.co/v2/holdings") return json(dhanHoldings);
  if (String(url) === "https://api.groww.in/v1/token/api/access") return json(growwSession);
  if (String(url) === "https://api.groww.in/v1/holdings/user") return json({ status: 200, body: { status: "SUCCESS", payload: { holdings: [{ isin: "INE154A01025", trading_symbol: "ITC", quantity: 150, average_price: 438, t1_quantity: 0 }] } } });
  throw new Error(`unexpected ${String(url)}`);
}) as typeof fetch;

const logLines: string[] = [];
const logger = pino({ level: "trace" }, new Writable({ write(chunk, _enc, done) { logLines.push(String(chunk)); done(); } }));

let ctx: TestContext;
let cookie: string;
let ws: string;
let userId: string;
let other: { cookie: string; userId: string; workspaceId: string };
beforeAll(async () => {
  ctx = await createTestContext({ CONNECTIONS_KEY: KEY.toString("base64") }, { brokerFetch, logger });
  ({ cookie, workspaceId: ws, userId } = await ctx.signUp("brokers@example.com"));
  other = await ctx.signUp("someone-else@example.com");
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE TABLE "broker_connection", "broker_login_state", "holding_read", "holding_line", "market_point", "market_connection" CASCADE`);
  session = { status: 200, body: { status: "success", data: { access_token: TOKEN, user_id: "AB1234" } } };
  holdings = {
    status: 200,
    body: { status: "success", data: [
      { tradingsymbol: "HDFCBANK", exchange: "NSE", isin: "INE040A01034", quantity: 120, t1_quantity: 0, average_price: 1512.4, last_price: 1745 },
      { tradingsymbol: "TITAN", exchange: "NSE", isin: "INE280A01028", quantity: 10, t1_quantity: 5, average_price: 3350, last_price: 3500 },
    ] },
  };
  dhanHoldings = {
    status: 200,
    body: [
      { exchange: "ALL", tradingSymbol: "HDFCBANK", securityId: "1333", isin: "INE040A01034", totalQty: 30, dpQty: 30, t1Qty: 0, availableQty: 30, collateralQty: 0, avgCostPrice: 1498.25 },
    ],
  };
  calls.length = 0;
  logLines.length = 0;
});

const headers = () => ({ cookie, "content-type": "application/json", origin: "http://localhost" });
const base = () => `/v1/workspaces/${ws}`;
const save = () => ctx.app.request(`${base()}/brokers/kite`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: { apiKey: API_KEY, apiSecret: API_SECRET } }) });
async function clean(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const s of [API_SECRET, TOKEN]) expect(text).not.toContain(s);
  return JSON.parse(text) as unknown;
}
function logsClean() {
  for (const line of logLines) for (const s of [API_KEY, API_SECRET, TOKEN, DHAN_TOKEN]) expect(line).not.toContain(s);
}
/** Dhan as Settings saves it: a client ID and a token, encrypted under the same key. */
async function connectDhanInSettings(token = DHAN_TOKEN, expiresAt: Date | null = new Date(Date.now() + 20 * 3_600_000), savedByUserId: string = userId) {
  await saveConnection(ctx.db, {
    provider: "dhan", clientId: DHAN_CLIENT, secretCiphertext: encryptSecret(token, KEY), secretLast4: token.slice(-4),
    expiresAt, checkedAt: new Date(), savedByUserId,
  });
}
/** Moves the reads so far, and the save before them, a minute back, so the next read is not refused as too soon. */
async function ageReads() {
  await ctx.db.execute(sql`UPDATE holding_read SET started_at = started_at - interval '1 minute'`);
  await ctx.db.execute(sql`UPDATE broker_connection SET saved_at = saved_at - interval '1 minute'`);
}
const addDhan = () => ctx.app.request(`${base()}/brokers/dhan`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: {} }) });
/** Saves the key, starts a sign-in and comes back from Zerodha with a code. */
async function signIn(query: Record<string, string> = { request_token: "rt-1", status: "success", action: "login" }) {
  expect((await save()).status).toBe(200);
  const start = (await (await ctx.app.request(`${base()}/brokers/kite/sign-in`, { method: "POST", headers: headers() })).json()) as { url: string };
  const state = new URLSearchParams(new URL(start.url).searchParams.get("redirect_params")!).get("state")!;
  return ctx.app.request(`/v1/brokers/kite/return?${new URLSearchParams({ ...query, state })}`, { headers: { cookie } });
}

describe("GET /v1/brokers", () => {
  it("lists the brokers from their JSON definitions, with no calls in them", async () => {
    const res = await ctx.app.request("/v1/brokers", { headers: { cookie } });
    const body = BrokerList.parse(await res.json());
    expect(body.items.map((b) => b.id)).toEqual(["kite", "dhan", "upstox", "groww"]);
    expect(body.items[3]).toMatchObject({ name: "Groww", signIn: { kind: "direct" }, returnUrl: null });
    expect(body.items[2]).toMatchObject({ name: "Upstox", signIn: { kind: "redirect" }, returnUrl: "http://localhost/v1/brokers/upstox/return" });
    expect(JSON.stringify(body)).not.toContain("api.upstox.com");
    expect(body.items[0]).toMatchObject({ name: "Zerodha", enabled: true, signIn: { kind: "redirect" }, returnUrl: "http://localhost/v1/brokers/kite/return" });
    expect(body.items[1]).toMatchObject({ name: "Dhan", enabled: true, credentials: [], signIn: { kind: "settings-connection", provider: "dhan" }, returnUrl: null });
    expect(JSON.stringify(body)).not.toContain("api.kite.trade");
    expect(JSON.stringify(body)).not.toContain("api.dhan.co");
  });
});

describe("connecting Kite", () => {
  it("keeps the key encrypted and names it by its last 4", async () => {
    const res = await save();
    const account = BrokerAccount.parse(await clean(res));
    expect(account).toMatchObject({ broker: "kite", state: "saved", keyLast4: API_KEY.slice(-4) });
    const row = await getBrokerConnection(ctx.db, ws, "kite");
    expect(row?.credentialsCiphertext).not.toContain(API_SECRET);
    expect(JSON.parse(decryptSecret(row!.credentialsCiphertext!, KEY))).toEqual({ apiKey: API_KEY, apiSecret: API_SECRET });
  });

  it("asks for each credential the definition names", async () => {
    const res = await ctx.app.request(`${base()}/brokers/kite`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: { apiKey: API_KEY } }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { fields: { path: string }[] } }).error.fields.map((f) => f.path)).toEqual(["credentials.apiSecret"]);
  });

  it("signs in, reads the holdings and sends the investor back to Holdings", async () => {
    const res = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=kite&signedIn=1");
    const row = await getBrokerConnection(ctx.db, ws, "kite");
    expect(row).toMatchObject({ accountId: "AB1234" });
    expect(decryptSecret(row!.tokenCiphertext!, KEY)).toBe(TOKEN);
    expect(calls.map((c) => c.url)).toEqual(["https://api.kite.trade/session/token", "https://api.kite.trade/portfolio/holdings"]);
    const accounts = (await (await ctx.app.request(`${base()}/brokers`, { headers: { cookie } })).json()) as { items: BrokerAccount[] };
    expect(accounts.items[0]).toMatchObject({ state: "signed_in", accountId: "AB1234", lastReadCount: 2 });
    logsClean();
  });

  it("refuses a return whose state was not issued, or was used already", async () => {
    await signIn();
    const replay = await ctx.app.request(`/v1/brokers/kite/return?request_token=rt-2&status=success&state=not-issued`, { headers: { cookie } });
    expect(replay.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=kite&error=SIGN_IN_EXPIRED");
  });

  it("says when Zerodha refused the sign-in, and keeps no token", async () => {
    session = { status: 403, body: { status: "error", error_type: "TokenException", message: `bad ${API_KEY}` } };
    const res = await signIn();
    expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=kite&error=BROKER_REFUSED");
    expect((await getBrokerConnection(ctx.db, ws, "kite"))?.tokenCiphertext).toBeNull();
    logsClean();
  });

  it("says when the investor cancelled on Zerodha's page", async () => {
    const res = await signIn({ status: "cancelled" });
    expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=kite&error=SIGN_IN_CANCELLED");
    expect(calls).toHaveLength(0);
  });

  it("marks the account signed out when Zerodha refuses the token, and keeps the last read", async () => {
    await signIn();
    await ctx.db.execute(sql`UPDATE holding_read SET started_at = started_at - interval '1 minute'`);
    await ctx.db.execute(sql`UPDATE broker_connection SET saved_at = saved_at - interval '1 minute'`);
    holdings = { status: 403, body: { status: "error", error_type: "TokenException" } };
    const res = await ctx.app.request(`${base()}/brokers/kite/read`, { method: "POST", headers: headers() });
    expect(BrokerAccount.parse(await res.json())).toMatchObject({ state: "signed_out", lastReadCount: 2 });
    const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
    expect(snap.rows).toHaveLength(2);
    expect(snap.rows.every((r) => r.parts.every((p) => p.stale))).toBe(true);
  });

  it("refuses a second read within seconds", async () => {
    await signIn();
    const res = await ctx.app.request(`${base()}/brokers/kite/read`, { method: "POST", headers: headers() });
    expect(res.status).toBe(429);
  });

  it("disconnects: forgets the key, and the account leaves the page", async () => {
    await signIn();
    expect((await ctx.app.request(`${base()}/brokers/kite`, { method: "DELETE", headers: headers() })).status).toBe(204);
    expect((await getBrokerConnection(ctx.db, ws, "kite"))?.credentialsCiphertext).toBeNull();
    const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
    expect(snap).toMatchObject({ accounts: [], rows: [] });
    // Saving a key again starts afresh: the reads from before do not come back.
    expect((await save()).status).toBe(200);
    const again = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
    expect(again.rows).toEqual([]);
    expect(again.accounts[0]).toMatchObject({ state: "saved", lastReadAt: null });
  });
});

describe("GET /holdings", () => {
  it("values each holding at Maester's NSE close, and leaves one with no close unknown", async () => {
    await upsertMarketPoints(ctx.db, [{ series: "eq:HDFCBANK", day: "2026-10-16", value: 1742.6, source: "Dhan · NSE close" }]);
    await signIn();
    const snap = HoldingsSnapshot.parse(await clean(await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })));
    // HDFC Bank: 120 × 1742.60 = 209,112.00; cost 120 × 1512.40 = 181,488.00.
    // Titan: 10 + 5 on T+1 = 15; cost 15 × 3350 = 50,250.00; no close, so no value.
    expect(snap.rows.map((r) => [r.symbol, r.quantity, r.cost, r.value, r.weight, r.unknown])).toEqual([
      ["HDFCBANK", "120", "181488.00", "209112.00", "100.0", []],
      ["TITAN", "15", "50250.00", null, null, ["NO_CLOSE"]],
    ]);
    // Gain on HDFC Bank 209,112 − 181,488 = 27,624.00; 27,624 / 181,488 = 0.152208 → 15.2. Titan has no gain.
    expect(snap.rows.map((r) => [r.symbol, r.gain, r.gainPercent])).toEqual([["HDFCBANK", "27624.00", "15.2"], ["TITAN", null, null]]);
    expect(snap.totals).toEqual({ knownValue: "209112.00", priced: 1, count: 2, cost: "231738.00", costed: 2, unrealizedGain: "27624.00", gainCovers: 1, gainPercent: "15.2" });
    expect(snap.closeDay).toBe("2026-10-16");
    expect(snap.rows[0]?.parts).toEqual([
      { broker: "kite", accountId: "AB1234", quantity: "120", averagePrice: "1512.4", cost: "181488.00", value: "209112.00", gain: "27624.00", gainPercent: "15.2", readAt: expect.any(String), stale: false },
    ]);
    expect(snap.rows[1]?.parts[0]).toMatchObject({ broker: "kite", accountId: "AB1234", quantity: "15", cost: "50250.00", value: null, gain: null, stale: false });
    // Zerodha's totals: value 209,112.00 (1 of 2 priced); cost 181,488 + 50,250 = 231,738.00; gain 27,624.00 over 1.
    expect(snap.accountTotals).toEqual([
      { broker: "kite", knownValue: "209112.00", priced: 1, count: 2, cost: "231738.00", costed: 2, gain: "27624.00", gainCovers: 1, gainPercent: "15.2" },
    ]);
  });

  it("makes one part of a broker's NSE and BSE lines for the same share", async () => {
    holdings = {
      status: 200,
      body: { status: "success", data: [
        { tradingsymbol: "HDFCBANK", exchange: "NSE", isin: "INE040A01034", quantity: 100, t1_quantity: 0, average_price: 1500, last_price: 1745 },
        { tradingsymbol: "HDFCBANK", exchange: "BSE", isin: "INE040A01034", quantity: 20, t1_quantity: 0, average_price: 1600, last_price: 1745 },
      ] },
    };
    await upsertMarketPoints(ctx.db, [{ series: "eq:HDFCBANK", day: "2026-10-16", value: 1742.6, source: "Dhan · NSE close" }]);
    await signIn();
    const snap = HoldingsSnapshot.parse(await clean(await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })));
    // 100 @ 1500 + 20 @ 1600 = 150,000 + 32,000 = 182,000.00 for 120; average 182,000 / 120 = 1,516.666… → 1516.67.
    // Value 120 × 1742.60 = 209,112.00; gain 27,112.00; 27,112 / 182,000 = 0.148967 → 14.9.
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]?.parts).toEqual([
      { broker: "kite", accountId: "AB1234", quantity: "120", averagePrice: "1516.67", cost: "182000.00", value: "209112.00", gain: "27112.00", gainPercent: "14.9", readAt: expect.any(String), stale: false },
    ]);
  });
});

describe("signing in to Groww from Maester", () => {
  const GROWW_KEY = "growwKEYleak111";
  const GROWW_SECRET = "growwSECRETleak222";
  const saveGroww = () =>
    ctx.app.request(`${base()}/brokers/groww`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: { apiKey: GROWW_KEY, apiSecret: GROWW_SECRET } }) });
  const start = () => ctx.app.request(`${base()}/brokers/groww/session`, { method: "POST", headers: headers() });

  it("signs in with the saved key once it is approved, and reads at once", async () => {
    growwSession = { status: 200, body: { token: "growwTOKENleak555", isActive: true } };
    expect((await saveGroww()).status).toBe(200);
    const res = await start();
    expect(res.status).toBe(200);
    expect(BrokerAccount.parse(await res.json())).toMatchObject({ broker: "groww", state: "signed_in", lastReadCount: 1, errorCode: null });
    const call = calls.find((c) => c.url === "https://api.groww.in/v1/token/api/access")!;
    expect(String(call.init.body)).not.toContain(GROWW_SECRET);
    const row = await getBrokerConnection(ctx.db, ws, "groww");
    expect(decryptSecret(row!.tokenCiphertext!, KEY)).toBe("growwTOKENleak555");
    for (const line of logLines) for (const s of [GROWW_KEY, GROWW_SECRET, "growwTOKENleak555"]) expect(line).not.toContain(s);
  });

  it("keeps a refusal as the account's error, and says nothing of the broker's own text", async () => {
    growwSession = { status: 200, body: { isActive: false, message: "secret detail" } };
    expect((await saveGroww()).status).toBe(200);
    const account = BrokerAccount.parse(await (await start()).json());
    expect(account).toMatchObject({ broker: "groww", state: "failing", errorCode: "BROKER_REFUSED" });
    expect(JSON.stringify(account)).not.toContain("secret detail");
  });

  it("is refused for a broker that signs in on its own page", async () => {
    expect((await save()).status).toBe(200);
    expect((await ctx.app.request(`${base()}/brokers/kite/session`, { method: "POST", headers: headers() })).status).toBe(409);
  });
});

describe("connecting Dhan through Settings", () => {
  it("is refused until Dhan is connected in Settings", async () => {
    const res = await addDhan();
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
    expect(await getBrokerConnection(ctx.db, ws, "dhan")).toBeNull();
  });

  it("adds the account with no key and no sign-in, and reads at once with the Settings token", async () => {
    await connectDhanInSettings();
    const res = await addDhan();
    expect(res.status).toBe(200);
    const account = BrokerAccount.parse(await res.json());
    expect(account).toMatchObject({ broker: "dhan", state: "signed_in", accountId: DHAN_CLIENT, keyLast4: null, lastReadCount: 1, errorCode: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.dhan.co/v2/holdings");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.headers).toMatchObject({ "access-token": DHAN_TOKEN, "client-id": DHAN_CLIENT });
    const row = await getBrokerConnection(ctx.db, ws, "dhan");
    expect(row?.tokenCiphertext).toBeNull();
    expect(JSON.parse(decryptSecret(row!.credentialsCiphertext!, KEY))).toEqual({});
    logsClean();
  });

  it("reads only the holdings of the person who saved the token in Settings", async () => {
    await connectDhanInSettings();
    const res = await ctx.app.request(`/v1/workspaces/${other.workspaceId}/brokers/dhan`, {
      method: "PUT", headers: { cookie: other.cookie, "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ credentials: {} }),
    });
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("is signed out, and reads nothing, once someone else's token replaces the owner's in Settings", async () => {
    await connectDhanInSettings();
    await addDhan();
    await ageReads();
    await connectDhanInSettings("otherPERSONtoken111", undefined, other.userId);
    calls.length = 0;
    const list = (await (await ctx.app.request(`${base()}/brokers`, { headers: { cookie } })).json()) as { items: BrokerAccount[] };
    expect(list.items[0]).toMatchObject({ state: "signed_out", accountId: null });
    expect((await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("has no sign-in to start or return from", async () => {
    await connectDhanInSettings();
    await addDhan();
    expect((await ctx.app.request(`${base()}/brokers/dhan/sign-in`, { method: "POST", headers: headers() })).status).toBe(409);
    expect((await ctx.app.request(`/v1/brokers/dhan/return?state=x&code=y`, { headers: { cookie } })).status).toBe(404);
  });

  it("reads with the token Settings holds now, after the worker renews it", async () => {
    await connectDhanInSettings();
    await addDhan();
    await ageReads();
    await connectDhanInSettings("dhanRENEWEDtoken654");
    calls.length = 0;
    expect((await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).status).toBe(200);
    expect(calls[0]!.init.headers).toMatchObject({ "access-token": "dhanRENEWEDtoken654" });
  });

  it("is signed out when the Settings token has expired, and its holdings are marked stale", async () => {
    await connectDhanInSettings();
    await addDhan();
    await ctx.db.execute(sql`UPDATE market_connection SET expires_at = now() - interval '1 hour'`);
    const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
    expect(snap.accounts[0]).toMatchObject({ broker: "dhan", state: "signed_out" });
    expect(snap.accounts[0]!.signedOutAt).not.toBeNull();
    expect(snap.rows[0]!.parts[0]).toMatchObject({ broker: "dhan", stale: true });
  });

  it("is signed out when Dhan refuses the token, and back once Settings has a new one", async () => {
    await connectDhanInSettings();
    await addDhan();
    await ageReads();
    await ctx.db.execute(sql`UPDATE market_connection SET saved_at = saved_at - interval '2 minutes'`);
    dhanHoldings = { status: 401, body: { errorType: "Invalid_Authentication", errorCode: "DH-901", errorMessage: `bad ${DHAN_TOKEN}` } };
    const refused = BrokerAccount.parse(await (await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).json());
    expect(refused).toMatchObject({ state: "signed_out", lastReadCount: 1 });
    // Settings saves a new token: the refusal was of the old one.
    await connectDhanInSettings("dhanNEWtoken987");
    const list = (await (await ctx.app.request(`${base()}/brokers`, { headers: { cookie } })).json()) as { items: BrokerAccount[] };
    expect(list.items[0]).toMatchObject({ state: "signed_in", errorCode: null });
    logsClean();
  });

  it("recovers from a failed read on the next good one", async () => {
    await connectDhanInSettings();
    await addDhan();
    await ageReads();
    dhanHoldings = { status: 500, body: {} };
    const failed = BrokerAccount.parse(await (await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).json());
    expect(failed).toMatchObject({ state: "failing", errorCode: "BROKER_UNAVAILABLE" });
    await ageReads();
    dhanHoldings = { status: 200, body: [] };
    const ok = BrokerAccount.parse(await (await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).json());
    expect(ok).toMatchObject({ state: "signed_in", errorCode: null, lastReadCount: 0 });
  });

  it("puts Dhan's holdings beside Zerodha's, one row per ISIN", async () => {
    await upsertMarketPoints(ctx.db, [{ series: "eq:HDFCBANK", day: "2026-10-16", value: 1742.6, source: "Dhan · NSE close" }]);
    await signIn();
    await connectDhanInSettings();
    await addDhan();
    const snap = HoldingsSnapshot.parse(await clean(await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })));
    expect(snap.accounts.map((a) => [a.broker, a.state])).toEqual([["kite", "signed_in"], ["dhan", "signed_in"]]);
    const hdfc = snap.rows.find((r) => r.isin === "INE040A01034")!;
    // Zerodha's NSE listing names the symbol; Dhan prints "ALL" for a demat holding.
    expect(hdfc).toMatchObject({ symbol: "HDFCBANK", exchange: "NSE" });
    expect(hdfc.parts.map((p) => [p.broker, p.accountId, p.quantity, p.stale])).toEqual([["kite", "AB1234", "120", false], ["dhan", DHAN_CLIENT, "30", false]]);
    // 120 + 30 = 150 shares. Cost 120 × 1512.40 + 30 × 1498.25 = 181,488.00 + 44,947.50 = 226,435.50.
    // Value 150 × 1742.60 = 261,390.00.
    expect([hdfc.quantity, hdfc.cost, hdfc.value]).toEqual(["150", "226435.50", "261390.00"]);
    logsClean();
  });
});
