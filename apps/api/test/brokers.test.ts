import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrokerAccount, BrokerList, HoldingsSnapshot } from "@maester/contracts";
import { getBrokerConnection, upsertMarketPoints } from "@maester/db";
import { decryptSecret } from "@maester/market";
import { createTestContext, type TestContext } from "./context.js";

// Distinctive values, so a leak anywhere is easy to find.
const API_KEY = "kiteKEYleak123";
const API_SECRET = "kiteSECRETleak456";
const TOKEN = "kiteTOKENleak789";
const KEY = randomBytes(32);

type Answer = { status: number; body: unknown };
let session: Answer;
let holdings: Answer;
const calls: { url: string; init: RequestInit }[] = [];
const json = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
const brokerFetch = (async (url: string | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  if (String(url) === "https://api.kite.trade/session/token") return json(session);
  if (String(url) === "https://api.kite.trade/portfolio/holdings") return json(holdings);
  throw new Error(`unexpected ${String(url)}`);
}) as typeof fetch;

const logLines: string[] = [];
const logger = pino({ level: "trace" }, new Writable({ write(chunk, _enc, done) { logLines.push(String(chunk)); done(); } }));

let ctx: TestContext;
let cookie: string;
let ws: string;
beforeAll(async () => {
  ctx = await createTestContext({ CONNECTIONS_KEY: KEY.toString("base64") }, { brokerFetch, logger });
  ({ cookie, workspaceId: ws } = await ctx.signUp("brokers@example.com"));
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE TABLE "broker_connection", "broker_login_state", "holding_read", "holding_line", "market_point" CASCADE`);
  session = { status: 200, body: { status: "success", data: { access_token: TOKEN, user_id: "AB1234" } } };
  holdings = {
    status: 200,
    body: { status: "success", data: [
      { tradingsymbol: "HDFCBANK", exchange: "NSE", isin: "INE040A01034", quantity: 120, t1_quantity: 0, average_price: 1512.4, last_price: 1745 },
      { tradingsymbol: "TITAN", exchange: "NSE", isin: "INE280A01028", quantity: 10, t1_quantity: 5, average_price: 3350, last_price: 3500 },
    ] },
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
  for (const line of logLines) for (const s of [API_KEY, API_SECRET, TOKEN]) expect(line).not.toContain(s);
}
/** Saves the key, starts a sign-in and comes back from Zerodha with a code. */
async function signIn(query: Record<string, string> = { request_token: "rt-1", status: "success", action: "login" }) {
  expect((await save()).status).toBe(200);
  const start = (await (await ctx.app.request(`${base()}/brokers/kite/sign-in`, { method: "POST", headers: headers() })).json()) as { url: string };
  const state = new URLSearchParams(new URL(start.url).searchParams.get("redirect_params")!).get("state")!;
  return ctx.app.request(`/v1/brokers/kite/return?${new URLSearchParams({ ...query, state })}`, { headers: { cookie } });
}

describe("GET /v1/brokers", () => {
  it("lists Kite from its JSON definition, with no calls in it", async () => {
    const res = await ctx.app.request("/v1/brokers", { headers: { cookie } });
    const body = BrokerList.parse(await res.json());
    expect(body.items.map((b) => b.id)).toEqual(["kite"]);
    expect(body.items[0]).toMatchObject({ name: "Zerodha", enabled: true, returnUrl: "http://localhost/v1/brokers/kite/return" });
    expect(JSON.stringify(body)).not.toContain("api.kite.trade");
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
    expect(snap.totals).toEqual({ knownValue: "209112.00", priced: 1, count: 2, cost: "231738.00", costed: 2, unrealizedGain: "27624.00", gainCovers: 1 });
    expect(snap.closeDay).toBe("2026-10-16");
    expect(snap.rows[1]?.parts[0]).toMatchObject({ broker: "kite", accountId: "AB1234", quantity: "15", stale: false });
  });
});
