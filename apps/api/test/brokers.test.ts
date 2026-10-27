import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrokerAccount, BrokerList, HoldingsSnapshot } from "@maester/contracts";
import { createRegistry, type BrokerRegistry } from "@maester/brokers";
import { fakePlugin } from "@maester/brokers/testing";
import { finishHoldingRead, getBrokerConnection, saveBrokerCredentials, saveBrokerSession, startHoldingRead, upsertMarketPoints } from "@maester/db";
import { decryptSecret, encryptSecret } from "@maester/market";
import { createTestContext, type TestContext } from "./context.js";

// Distinctive values, so a leak anywhere is easy to find.
const API_KEY = "fakeKEYleak123";
const TOKEN = "fakeTOKENleak789";
const KITE_KEY = "kiteKEYleak123";
const KITE_SECRET = "kiteSECRETleak456";
const KITE_TOKEN = "kiteTOKENleak789";
const KEY = randomBytes(32);

type Answer = { status: number; body: unknown };
let profile: Answer;
let holdings: Answer;
let kiteSession: Answer;
let kiteHoldings: Answer;
const calls: { url: string; init: RequestInit }[] = [];
const json = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
const brokerFetch = (async (url: string | URL, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  if (String(url) === "https://broker.test/profile") return json(profile);
  if (String(url) === "https://broker.test/holdings") return json(holdings);
  if (String(url) === "https://api.kite.trade/session/token") return json(kiteSession);
  if (String(url) === "https://api.kite.trade/portfolio/holdings") return json(kiteHoldings);
  throw new Error(`unexpected ${String(url)}`);
}) as typeof fetch;

const logLines: string[] = [];
const logger = pino({ level: "trace" }, new Writable({ write(chunk, _enc, done) { logLines.push(String(chunk)); done(); } }));

// Each describe below that needs another registry opens its own context, and a context empties the
// users and workspaces when it opens, so those describes come last and sign up again.
let ctx: TestContext;
let cookie: string;
let ws: string;
let userId: string;
async function open(brokerRegistry?: BrokerRegistry) {
  ctx = await createTestContext({ CONNECTIONS_KEY: KEY.toString("base64") }, { brokerFetch, logger, ...(brokerRegistry ? { brokerRegistry } : {}) });
  ({ cookie, workspaceId: ws, userId } = await ctx.signUp("brokers@example.com"));
}

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE TABLE "broker_connection", "broker_login_state", "holding_read", "holding_line", "market_point" CASCADE`);
  profile = { status: 200, body: { data: { id: "AB1234" } } };
  holdings = {
    status: 200,
    body: { data: [
      { isin: "INE040A01034", symbol: "HDFCBANK", exchange: "NSE", quantity: 120, t1Quantity: 0, averagePrice: 1512.4, lastPrice: 1745 },
      { isin: "INE280A01028", symbol: "TITAN", exchange: "NSE", quantity: 10, t1Quantity: 5, averagePrice: 3350, lastPrice: 3500 },
    ] },
  };
  kiteSession = { status: 200, body: { status: "success", data: { access_token: KITE_TOKEN, user_id: "ZK0001" } } };
  kiteHoldings = {
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
const save = () => ctx.app.request(`${base()}/brokers/fake`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: { apiKey: API_KEY } }) });
const startSignIn = () => ctx.app.request(`${base()}/brokers/fake/sign-in`, { method: "POST", headers: headers() });
const list = async () => ((await (await ctx.app.request(`${base()}/brokers`, { headers: { cookie } })).json()) as { items: BrokerAccount[] }).items;
async function clean(res: Response, secrets: string[] = [TOKEN]): Promise<unknown> {
  const text = await res.text();
  for (const s of secrets) expect(text).not.toContain(s);
  return JSON.parse(text) as unknown;
}
function logsClean(secrets: string[] = [API_KEY, TOKEN]) {
  for (const line of logLines) for (const s of secrets) expect(line).not.toContain(s);
}
/** Moves the reads so far, and the save before them, a minute back, so the next read is not refused as too soon. */
async function ageReads() {
  await ctx.db.execute(sql`UPDATE holding_read SET started_at = started_at - interval '1 minute'`);
  await ctx.db.execute(sql`UPDATE broker_connection SET saved_at = saved_at - interval '1 minute'`);
}
/** The state nonce in a sign-in's login address. */
async function issuedState(): Promise<string> {
  const start = (await (await startSignIn()).json()) as { url: string };
  return new URL(start.url).searchParams.get("state")!;
}
/** Saves the key, starts a sign-in and comes back from the fake broker's page with its query (a token, by default). */
async function signIn(query: Record<string, string> = { token: TOKEN }) {
  expect((await save()).status).toBe(200);
  const state = await issuedState();
  const res = await ctx.app.request(`/v1/brokers/fake/return?${new URLSearchParams({ ...query, state })}`, { headers: { cookie } });
  expect(res.headers.get("location") ?? "").not.toContain(TOKEN);
  return res;
}
/** An account added and signed in earlier, written straight to the tables: for a broker a route can no longer add. */
async function insertAccount(broker: string, opts: { credentials?: string; token?: string } = {}) {
  const row = await saveBrokerCredentials(ctx.db, {
    workspaceId: ws, broker, credentialsCiphertext: opts.credentials ?? encryptSecret(JSON.stringify({ apiKey: API_KEY }), KEY), keyLast4: API_KEY.slice(-4), savedByUserId: userId,
  });
  if (opts.token) {
    await saveBrokerSession(ctx.db, row.id, { accountId: "AB1234", tokenCiphertext: encryptSecret(opts.token, KEY), signedInAt: new Date(), tokenExpiresAt: new Date(Date.now() + 3_600_000) });
  }
  return row;
}

describe("with a broker plugin from the registry", () => {
  beforeAll(() => open(createRegistry([fakePlugin()])));
  afterAll(() => ctx.close());

  describe("connecting", () => {
    it("keeps the key encrypted and names it by its last 4", async () => {
      const res = await save();
      const account = BrokerAccount.parse(await clean(res, [TOKEN]));
      expect(account).toMatchObject({ broker: "fake", name: "Fake broker", state: "saved", keyLast4: API_KEY.slice(-4) });
      const row = await getBrokerConnection(ctx.db, ws, "fake");
      expect(row?.credentialsCiphertext).not.toContain(API_KEY);
      expect(JSON.parse(decryptSecret(row!.credentialsCiphertext!, KEY))).toEqual({ apiKey: API_KEY });
    });

    it("asks for each credential the manifest names", async () => {
      const res = await ctx.app.request(`${base()}/brokers/fake`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: {} }) });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { fields: { path: string }[] } }).error.fields.map((f) => f.path)).toEqual(["credentials.apiKey"]);
    });

    it("signs in, reads the holdings and sends the investor back to Holdings", async () => {
      const res = await signIn();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&signedIn=1");
      const row = await getBrokerConnection(ctx.db, ws, "fake");
      expect(row).toMatchObject({ accountId: "AB1234" });
      expect(decryptSecret(row!.tokenCiphertext!, KEY)).toBe(TOKEN);
      expect(calls.map((c) => c.url)).toEqual(["https://broker.test/profile", "https://broker.test/holdings"]);
      expect(calls[1]!.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
      expect((await list())[0]).toMatchObject({ broker: "fake", state: "signed_in", accountId: "AB1234", lastReadCount: 2 });
      logsClean();
    });

    it("refuses a return whose state was not issued, or was used already", async () => {
      const res = await signIn();
      expect(res.headers.get("location")).toContain("signedIn=1");
      const unknown = await ctx.app.request(`/v1/brokers/fake/return?token=${TOKEN}&state=not-issued`, { headers: { cookie } });
      expect(unknown.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=SIGN_IN_EXPIRED");
      const state = await issuedState();
      const first = await ctx.app.request(`/v1/brokers/fake/return?token=${TOKEN}&state=${state}`, { headers: { cookie } });
      expect(first.headers.get("location")).toContain("signedIn=1");
      const replay = await ctx.app.request(`/v1/brokers/fake/return?token=${TOKEN}&state=${state}`, { headers: { cookie } });
      expect(replay.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=SIGN_IN_EXPIRED");
    });

    it("refuses a return with no state, and calls the broker for nothing", async () => {
      expect((await save()).status).toBe(200);
      await issuedState();
      const res = await ctx.app.request(`/v1/brokers/fake/return?token=${TOKEN}`, { headers: { cookie } });
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=SIGN_IN_EXPIRED");
      expect(calls).toHaveLength(0);
      expect((await getBrokerConnection(ctx.db, ws, "fake"))?.tokenCiphertext).toBeNull();
    });

    it("refuses a return whose state another person started", async () => {
      const someone = await ctx.signUp("someone-else@example.com");
      const theirs = { cookie: someone.cookie, "content-type": "application/json", origin: "http://localhost" };
      await ctx.app.request(`/v1/workspaces/${someone.workspaceId}/brokers/fake`, { method: "PUT", headers: theirs, body: JSON.stringify({ credentials: { apiKey: API_KEY } }) });
      const start = (await (await ctx.app.request(`/v1/workspaces/${someone.workspaceId}/brokers/fake/sign-in`, { method: "POST", headers: theirs })).json()) as { url: string };
      const state = new URL(start.url).searchParams.get("state")!;
      const res = await ctx.app.request(`/v1/brokers/fake/return?token=${TOKEN}&state=${state}`, { headers: { cookie } });
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=SIGN_IN_EXPIRED");
      expect(calls).toHaveLength(0);
    });

    it("says when the broker refused the sign-in, and keeps no token", async () => {
      profile = { status: 403, body: { message: `bad ${TOKEN}` } };
      const res = await signIn();
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=BROKER_REFUSED");
      expect((await getBrokerConnection(ctx.db, ws, "fake"))?.tokenCiphertext).toBeNull();
      logsClean();
    });

    it("says when the investor cancelled on the broker's page", async () => {
      const res = await signIn({});
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=SIGN_IN_CANCELLED");
      expect(calls).toHaveLength(0);
    });

    it("logs no query value from the return route", async () => {
      profile = { status: 403, body: { message: "refused" } };
      expect((await save()).status).toBe(200);
      const state = await issuedState();
      const query = new URLSearchParams({ token: TOKEN, state, extra: "QUERYleak999" });
      const res = await ctx.app.request(`/v1/brokers/fake/return?${query}`, { headers: { cookie } });
      expect(res.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=fake&error=BROKER_REFUSED");
      await ctx.app.request(`/v1/brokers/fake/return?${new URLSearchParams({ token: TOKEN, state: "unknownSTATEleak", extra: "QUERYleak999" })}`, { headers: { cookie } });
      // The failure is logged, by broker and code alone.
      const failed = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === "broker sign-in failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ broker: "fake", code: "BROKER_REFUSED" });
      expect(Object.keys(failed[0]!).sort()).toEqual(["broker", "code", "hostname", "level", "msg", "pid", "time"]);
      logsClean([API_KEY, TOKEN, state, "unknownSTATEleak", "QUERYleak999"]);
    });

    it("marks the account signed out when the broker refuses the token, and keeps the last read", async () => {
      await signIn();
      await ageReads();
      holdings = { status: 403, body: { message: `bad ${TOKEN}` } };
      const res = await ctx.app.request(`${base()}/brokers/fake/read`, { method: "POST", headers: headers() });
      expect(BrokerAccount.parse(await res.json())).toMatchObject({ state: "signed_out", lastReadCount: 2 });
      const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
      expect(snap.rows).toHaveLength(2);
      expect(snap.rows.every((r) => r.parts.every((p) => p.stale))).toBe(true);
      const failed = logLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.msg === "broker read failed");
      expect(failed).toEqual([expect.objectContaining({ broker: "fake", code: "BROKER_SIGNED_OUT" })]);
      logsClean();
    });

    it("refuses a second read within seconds", async () => {
      await signIn();
      const res = await ctx.app.request(`${base()}/brokers/fake/read`, { method: "POST", headers: headers() });
      expect(res.status).toBe(429);
    });

    it("has broker routes that sign in and read, and none that writes to a broker", () => {
      // A plugin can sign in and read, and nothing else; the routes are the other half of that rule (spec §6).
      // "ALL" is middleware; a route with a validator is registered twice, so the set dedupes it.
      const routes = new Set(ctx.app.routes.filter((r) => r.method !== "ALL" && /\/(brokers|holdings)/.test(r.path)).map((r) => `${r.method} ${r.path}`));
      expect([...routes].sort()).toEqual([
        "DELETE /v1/workspaces/:ws/brokers/:broker",
        "GET /v1/brokers",
        "GET /v1/brokers/:broker/return",
        "GET /v1/workspaces/:ws/brokers",
        "GET /v1/workspaces/:ws/holdings",
        "POST /v1/workspaces/:ws/brokers/:broker/read",
        "POST /v1/workspaces/:ws/brokers/:broker/sign-in",
        "PUT /v1/workspaces/:ws/brokers/:broker",
      ]);
    });

    it("has no sign-in from Maester itself", async () => {
      expect((await save()).status).toBe(200);
      expect((await ctx.app.request(`${base()}/brokers/fake/session`, { method: "POST", headers: headers() })).status).toBe(404);
      expect(calls).toHaveLength(0);
    });

    it("disconnects: forgets the key, and the account leaves the page", async () => {
      await signIn();
      expect((await ctx.app.request(`${base()}/brokers/fake`, { method: "DELETE", headers: headers() })).status).toBe(204);
      expect((await getBrokerConnection(ctx.db, ws, "fake"))?.credentialsCiphertext).toBeNull();
      const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
      expect(snap).toMatchObject({ accounts: [], rows: [] });
      // Saving a key again starts afresh: the reads from before do not come back.
      expect((await save()).status).toBe(200);
      const again = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
      expect(again.rows).toEqual([]);
      expect(again.accounts[0]).toMatchObject({ state: "saved", lastReadAt: null });
    });
  });

  describe("a broker that left the registry", () => {
    it("lists accounts and holdings without a row whose broker left the registry", async () => {
      await signIn();
      // Dhan's account from before plugins, under a key this API cannot decrypt: it must not even try.
      const dhan = await insertAccount("dhan", { credentials: encryptSecret("{}", randomBytes(32)) });
      const readId = await startHoldingRead(ctx.db, dhan.id);
      await finishHoldingRead(ctx.db, readId, { ok: true, lines: [{ isin: "INE154A01025", symbol: "ITC", exchange: "ALL", quantity: "150", t1Quantity: "0", averagePrice: "438", lastPrice: null }] });
      expect((await list()).map((a) => a.broker)).toEqual(["fake"]);
      const res = await ctx.app.request(`${base()}/holdings`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const snap = HoldingsSnapshot.parse(await res.json());
      expect(snap.accounts.map((a) => a.broker)).toEqual(["fake"]);
      expect(snap.rows.map((r) => r.isin)).not.toContain("INE154A01025");
      expect(snap.rows.flatMap((r) => r.parts.map((p) => p.broker))).toEqual(["fake", "fake"]);
      expect((await ctx.app.request(`${base()}/brokers/dhan/read`, { method: "POST", headers: headers() })).status).toBe(404);
      expect((await ctx.app.request(`${base()}/brokers/dhan`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials: {} }) })).status).toBe(404);
    });

    it("answers 404 for the return of a broker not in the registry", async () => {
      const res = await ctx.app.request(`/v1/brokers/dhan/return?state=x&code=y`, { headers: { cookie } });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
      expect(calls).toHaveLength(0);
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
        { broker: "fake", accountId: "AB1234", quantity: "120", averagePrice: "1512.4", cost: "181488.00", value: "209112.00", gain: "27624.00", gainPercent: "15.2", readAt: expect.any(String), stale: false },
      ]);
      expect(snap.rows[1]?.parts[0]).toMatchObject({ broker: "fake", accountId: "AB1234", quantity: "15", cost: "50250.00", value: null, gain: null, stale: false });
      // The fake broker's totals: value 209,112.00 (1 of 2 priced); cost 181,488 + 50,250 = 231,738.00; gain 27,624.00 over 1.
      expect(snap.accountTotals).toEqual([
        { broker: "fake", knownValue: "209112.00", priced: 1, count: 2, cost: "231738.00", costed: 2, gain: "27624.00", gainCovers: 1, gainPercent: "15.2" },
      ]);
    });

    it("makes one part of a broker's NSE and BSE lines for the same share", async () => {
      holdings = {
        status: 200,
        body: { data: [
          { isin: "INE040A01034", symbol: "HDFCBANK", exchange: "NSE", quantity: 100, t1Quantity: 0, averagePrice: 1500, lastPrice: 1745 },
          { isin: "INE040A01034", symbol: "HDFCBANK", exchange: "BSE", quantity: 20, t1Quantity: 0, averagePrice: 1600, lastPrice: 1745 },
        ] },
      };
      await upsertMarketPoints(ctx.db, [{ series: "eq:HDFCBANK", day: "2026-10-16", value: 1742.6, source: "Dhan · NSE close" }]);
      await signIn();
      const snap = HoldingsSnapshot.parse(await clean(await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })));
      // 100 @ 1500 + 20 @ 1600 = 150,000 + 32,000 = 182,000.00 for 120; average 182,000 / 120 = 1,516.666… → 1516.67.
      // Value 120 × 1742.60 = 209,112.00; gain 27,112.00; 27,112 / 182,000 = 0.148967 → 14.9.
      expect(snap.rows).toHaveLength(1);
      expect(snap.rows[0]?.parts).toEqual([
        { broker: "fake", accountId: "AB1234", quantity: "120", averagePrice: "1516.67", cost: "182000.00", value: "209112.00", gain: "27112.00", gainPercent: "14.9", readAt: expect.any(String), stale: false },
      ]);
    });
  });
});

describe("Kite through the default registry", () => {
  beforeAll(() => open());
  afterAll(() => ctx.close());

  const saveKite = (credentials: Record<string, string> = { apiKey: KITE_KEY, apiSecret: KITE_SECRET }) =>
    ctx.app.request(`${base()}/brokers/kite`, { method: "PUT", headers: headers(), body: JSON.stringify({ credentials }) });

  it("GET /v1/brokers lists the default registry's brokers", async () => {
    const res = await ctx.app.request("/v1/brokers", { headers: { cookie } });
    const text = await res.text();
    const body = BrokerList.parse(JSON.parse(text));
    expect(body.items.map((b) => b.id)).toEqual(["kite"]);
    expect(body.items[0]).toMatchObject({
      name: "Zerodha", enabled: true, notOfferedReason: null, signIn: { kind: "redirect" }, returnUrl: "http://localhost/v1/brokers/kite/return",
      credentials: [{ key: "apiKey", label: "API key", secret: false, minLength: 6, maxLength: 64 }, { key: "apiSecret", label: "API secret", secret: true, minLength: 6, maxLength: 128 }],
    });
    for (const b of body.items) expect(b.signIn).toEqual({ kind: "redirect" });
    // No call reaches the page: not the hosts, not the addresses.
    expect(text).not.toContain("api.kite.trade");
    expect(text).not.toContain("kite.zerodha.com");
    expect(text).not.toContain("hosts");
  });

  it("asks for each credential the manifest names", async () => {
    const res = await saveKite({ apiKey: KITE_KEY });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { fields: { path: string }[] } }).error.fields.map((f) => f.path)).toEqual(["credentials.apiSecret"]);
  });

  it("Kite through the default registry: save, sign in, return and read", async () => {
    const saved = await saveKite();
    expect(BrokerAccount.parse(await clean(saved, [KITE_SECRET]))).toMatchObject({ broker: "kite", name: "Zerodha", state: "saved", keyLast4: KITE_KEY.slice(-4) });

    const start = (await (await ctx.app.request(`${base()}/brokers/kite/sign-in`, { method: "POST", headers: headers() })).json()) as { url: string };
    const login = new URL(start.url);
    expect(`${login.origin}${login.pathname}`).toBe("https://kite.zerodha.com/connect/login");
    expect(login.searchParams.get("v")).toBe("3");
    expect(login.searchParams.get("api_key")).toBe(KITE_KEY);
    expect(start.url).not.toContain(KITE_SECRET);
    const state = new URLSearchParams(login.searchParams.get("redirect_params")!).get("state")!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const back = await ctx.app.request(`/v1/brokers/kite/return?${new URLSearchParams({ request_token: "rt-1", action: "login", status: "success", state })}`, { headers: { cookie } });
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("http://localhost/terminal/holdings?broker=kite&signedIn=1");

    expect(calls.map((c) => [c.init.method, c.url])).toEqual([["POST", "https://api.kite.trade/session/token"], ["GET", "https://api.kite.trade/portfolio/holdings"]]);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      api_key: KITE_KEY, request_token: "rt-1", checksum: createHash("sha256").update(`${KITE_KEY}rt-1${KITE_SECRET}`).digest("hex"),
    });
    expect(calls[0]!.init.headers).toMatchObject({ "X-Kite-Version": "3" });
    expect(String(calls[0]!.init.body)).not.toContain(KITE_SECRET);
    expect(calls[1]!.init.headers).toMatchObject({ "X-Kite-Version": "3", Authorization: `token ${KITE_KEY}:${KITE_TOKEN}` });

    const row = await getBrokerConnection(ctx.db, ws, "kite");
    expect(row).toMatchObject({ accountId: "ZK0001" });
    expect(decryptSecret(row!.tokenCiphertext!, KEY)).toBe(KITE_TOKEN);
    // Zerodha signs every app out at 06:00 in Kolkata (00:30 UTC), the next one after the sign-in.
    expect(row!.tokenExpiresAt!.getUTCHours()).toBe(0);
    expect(row!.tokenExpiresAt!.getUTCMinutes()).toBe(30);
    expect(row!.tokenExpiresAt!.getTime() - Date.now()).toBeGreaterThan(0);
    expect(row!.tokenExpiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    expect((await list())[0]).toMatchObject({ broker: "kite", state: "signed_in", accountId: "ZK0001", lastReadCount: 2 });

    await ageReads();
    calls.length = 0;
    const read = await ctx.app.request(`${base()}/brokers/kite/read`, { method: "POST", headers: headers() });
    expect(BrokerAccount.parse(await clean(read, [KITE_SECRET, KITE_TOKEN]))).toMatchObject({ state: "signed_in", lastReadCount: 2, errorCode: null });
    expect(calls.map((c) => c.url)).toEqual(["https://api.kite.trade/portfolio/holdings"]);

    // Zerodha's 403 on a read is its daily sign-out.
    await ageReads();
    kiteHoldings = { status: 403, body: { status: "error", error_type: "TokenException", message: `bad ${KITE_TOKEN}` } };
    const out = await ctx.app.request(`${base()}/brokers/kite/read`, { method: "POST", headers: headers() });
    expect(BrokerAccount.parse(await out.json())).toMatchObject({ state: "signed_out", lastReadCount: 2 });
    logsClean([KITE_KEY, KITE_SECRET, KITE_TOKEN]);
  });
});

describe("a plugin switched off while an account exists", () => {
  beforeAll(() => open(createRegistry([fakePlugin({ enabled: false, notOfferedReason: "Not offered for now." })])));
  afterAll(() => ctx.close());

  it("refuses PUT and sign-in for a switched-off plugin, but lists and reads the account it already has", async () => {
    await insertAccount("fake", { token: TOKEN });

    const put = await save();
    expect(put.status).toBe(409);
    expect(((await put.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
    // The refusal comes before the save: saving again would have dropped the token.
    const row = await getBrokerConnection(ctx.db, ws, "fake");
    expect(decryptSecret(row!.tokenCiphertext!, KEY)).toBe(TOKEN);

    const start = await startSignIn();
    expect(start.status).toBe(409);
    expect(((await start.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
    expect((await ctx.db.execute(sql`SELECT count(*)::int AS n FROM broker_login_state`)).rows[0]).toEqual({ n: 0 });
    expect(calls).toHaveLength(0);

    const catalog = BrokerList.parse(await (await ctx.app.request("/v1/brokers", { headers: { cookie } })).json());
    expect(catalog.items).toEqual([expect.objectContaining({ id: "fake", enabled: false, notOfferedReason: "Not offered for now." })]);

    expect(await list()).toEqual([expect.objectContaining({ broker: "fake", state: "signed_in", accountId: "AB1234" })]);
    const read = await ctx.app.request(`${base()}/brokers/fake/read`, { method: "POST", headers: headers() });
    expect(read.status).toBe(200);
    expect(BrokerAccount.parse(await clean(read))).toMatchObject({ broker: "fake", state: "signed_in", lastReadCount: 2, errorCode: null });
    expect(calls.map((c) => c.url)).toEqual(["https://broker.test/holdings"]);
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    const snap = HoldingsSnapshot.parse(await (await ctx.app.request(`${base()}/holdings`, { headers: { cookie } })).json());
    expect(snap.rows.map((r) => r.symbol)).toEqual(["HDFCBANK", "TITAN"]);
    logsClean();
  });
});
