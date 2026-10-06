import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Connection, ConnectionList } from "@maester/contracts";
import { getConnection, listConnections, markConnectionError, saveConnection, upsertMarketPoints } from "@maester/db";
import { decryptSecret, loadConnections, MarketSourceError, type DhanSource, type FredSource } from "@maester/market";
import { createTestContext, type TestContext } from "./context.js";

// Distinctive values, so a leak anywhere is easy to find.
const TOKEN = "ZZdhanTokenLEAKcheck-0123456789-wxyz";
const CLIENT = "1100223344";
const FRED_KEY = "zzfredkeyleakcheck0123456789qrst"; // 32 of [a-z0-9]
const KEY = randomBytes(32);

type DhanAnswer = Awaited<ReturnType<DhanSource["profile"]>> | MarketSourceError;
let dhanAnswer: DhanAnswer;
let fredAnswer: MarketSourceError | null;
const calls = { dhan: [] as { clientId: string; accessToken: string }[], fred: [] as string[] };

const unused = () => { throw new Error("not used by the connection check"); };
const marketSources = {
  dhan(creds: { clientId: string; accessToken: string }): DhanSource {
    calls.dhan.push(creds);
    return {
      daily: unused, putCallRatio: unused, equityIds: unused, goldContracts: unused, renewToken: unused,
      profile: async () => { if (dhanAnswer instanceof Error) throw dhanAnswer; return dhanAnswer; },
    };
  },
  fred(apiKey: string): FredSource {
    calls.fred.push(apiKey);
    return { observations: unused, check: async () => { if (fredAnswer) throw fredAnswer; } };
  },
};

const logLines: string[] = [];
const logger = pino({ level: "trace" }, new Writable({ write(chunk, _enc, done) { logLines.push(String(chunk)); done(); } }));

let ctx: TestContext;
let cookie: string;
let userId: string;
beforeAll(async () => {
  ctx = await createTestContext({ CONNECTIONS_KEY: KEY.toString("base64") }, { marketSources, logger });
  ({ cookie, userId } = await ctx.signUp("connections@example.com"));
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE TABLE "market_connection", "market_point"`);
  dhanAnswer = { clientId: CLIENT, tokenExpiresAt: "2026-11-05T18:30:00.000Z", dataPlanActive: true };
  fredAnswer = null;
  calls.dhan = [];
  calls.fred = [];
  logLines.length = 0;
});

const headers = () => ({ cookie, "content-type": "application/json", origin: "http://localhost" });
const putDhan = (body: unknown) => ctx.app.request("/v1/settings/connections/dhan", { method: "PUT", headers: headers(), body: JSON.stringify(body) });
const putFred = (body: unknown) => ctx.app.request("/v1/settings/connections/fred", { method: "PUT", headers: headers(), body: JSON.stringify(body) });
const list = async () => ConnectionList.parse(await (await ctx.app.request("/v1/settings/connections", { headers: { cookie } })).json());

/** Reads the body once, checks it holds no secret, and returns it parsed. */
async function clean(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const s of [TOKEN, FRED_KEY]) expect(text).not.toContain(s);
  return JSON.parse(text) as unknown;
}
function logsClean() {
  for (const line of logLines) for (const s of [TOKEN, FRED_KEY]) expect(line).not.toContain(s);
}
type ErrBody = { error: { code: string; message: string; fields?: { path: string; message: string }[] } };

describe("settings connections", () => {
  it("lists both as not connected at first, Dhan first", async () => {
    const { items } = await list();
    expect(items.map((c) => [c.provider, c.state])).toEqual([["dhan", "not_connected"], ["fred", "not_connected"]]);
    expect(items[0]).toMatchObject({ clientId: null, last4: null, expiresAt: null, checkedAt: null, lastRead: null, notice: null });
  });

  it("saves a Dhan token Dhan accepts, keeps it encrypted, and never sends it back", async () => {
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(200);
    const saved = Connection.parse(await clean(res));
    expect(saved).toMatchObject({ provider: "dhan", state: "connected", clientId: CLIENT, last4: "wxyz", expiresAt: "2026-11-05T18:30:00.000Z", notice: null });
    expect(saved.checkedAt).not.toBeNull();
    expect(calls.dhan).toEqual([{ clientId: CLIENT, accessToken: TOKEN }]);

    const listRes = await ctx.app.request("/v1/settings/connections", { headers: { cookie } });
    const { items } = ConnectionList.parse(await clean(listRes));
    expect(items[0]).toMatchObject({ state: "connected", last4: "wxyz", expiresAt: "2026-11-05T18:30:00.000Z" });
    expect(items[1]!.state).toBe("not_connected");

    const row = (await getConnection(ctx.db, "dhan"))!;
    expect(row.secretCiphertext).not.toContain(TOKEN);
    expect(decryptSecret(row.secretCiphertext, KEY)).toBe(TOKEN);
    expect(row.savedByUserId).toBe(userId);
    expect(loadConnections(await listConnections(ctx.db), KEY)).toEqual({ dhan: { clientId: CLIENT, accessToken: TOKEN }, fred: null });
    logsClean();
  });

  it("saves with a notice when the Data API subscription is off", async () => {
    dhanAnswer = { clientId: CLIENT, tokenExpiresAt: null, dataPlanActive: false };
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(200);
    expect(Connection.parse(await clean(res))).toMatchObject({ state: "connected", notice: "DATA_PLAN_INACTIVE" });
    expect(await getConnection(ctx.db, "dhan")).not.toBeNull();
  });

  it("answers 400 on accessToken when Dhan refuses the token, and keeps nothing", async () => {
    dhanAnswer = new MarketSourceError("DHAN_TOKEN_EXPIRED", "Dhan refused the access token");
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(400);
    const body = (await clean(res)) as ErrBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields).toEqual([{ path: "accessToken", message: "Dhan said this token isn’t valid." }]);
    expect(await getConnection(ctx.db, "dhan")).toBeNull();
    logsClean();
  });

  it("answers 503 when Dhan does not answer, and keeps nothing", async () => {
    dhanAnswer = new MarketSourceError("SOURCE_UNAVAILABLE", `Dhan could not be reached ${TOKEN}`);
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(503);
    expect((await clean(res)) as ErrBody).toMatchObject({ error: { code: "INTERNAL", message: "SOURCE_UNAVAILABLE" } });
    expect(await getConnection(ctx.db, "dhan")).toBeNull();
    logsClean();
  });

  it("answers 429 when Dhan rate-limits the check, and keeps nothing", async () => {
    dhanAnswer = new MarketSourceError("DHAN_RATE_LIMITED", "Dhan rate limit reached");
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(429);
    expect(((await clean(res)) as ErrBody).error.code).toBe("RATE_LIMITED");
    expect(await getConnection(ctx.db, "dhan")).toBeNull();
  });

  it("answers 400 on clientId when the token belongs to another client, and keeps nothing", async () => {
    dhanAnswer = { clientId: "9999999999", tokenExpiresAt: null, dataPlanActive: true };
    const res = await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    expect(res.status).toBe(400);
    expect(((await clean(res)) as ErrBody).error.fields).toEqual([{ path: "clientId", message: "This token belongs to another Dhan client ID." }]);
    expect(await getConnection(ctx.db, "dhan")).toBeNull();
  });

  it("checks the request shape before calling Dhan, without echoing the token", async () => {
    const long = `${TOKEN}${"x".repeat(4100)}`;
    const res = await putDhan({ clientId: CLIENT, accessToken: long });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(TOKEN);
    expect((await putDhan({ clientId: "", accessToken: TOKEN })).status).toBe(400);
    expect(calls.dhan).toEqual([]);
  });

  it("saves a FRED key FRED accepts", async () => {
    const res = await putFred({ apiKey: FRED_KEY });
    expect(res.status).toBe(200);
    expect(Connection.parse(await clean(res))).toMatchObject({ provider: "fred", state: "connected", clientId: null, last4: "qrst", expiresAt: null });
    expect(calls.fred).toEqual([FRED_KEY]);
    const row = (await getConnection(ctx.db, "fred"))!;
    expect(decryptSecret(row.secretCiphertext, KEY)).toBe(FRED_KEY);
    logsClean();
  });

  it("answers 400 for a FRED key that is not 32 lower-case letters and digits, before any call", async () => {
    const upper = FRED_KEY.toUpperCase();
    const res = await putFred({ apiKey: upper });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(upper);
    expect((await putFred({ apiKey: "short" })).status).toBe(400);
    expect(calls.fred).toEqual([]);
    expect(await getConnection(ctx.db, "fred")).toBeNull();
  });

  it("answers 503 when FRED does not answer, and keeps nothing", async () => {
    fredAnswer = new MarketSourceError("SOURCE_UNAVAILABLE", "FRED answered 400");
    const res = await putFred({ apiKey: FRED_KEY });
    expect(res.status).toBe(503);
    expect(((await clean(res)) as ErrBody).error.message).toBe("SOURCE_UNAVAILABLE");
    expect(await getConnection(ctx.db, "fred")).toBeNull();
    logsClean();
  });

  it("deletes a connection, and answers 404 for an unknown provider", async () => {
    await putFred({ apiKey: FRED_KEY });
    const del = await ctx.app.request("/v1/settings/connections/fred", { method: "DELETE", headers: headers() });
    expect(del.status).toBe(204);
    expect(await getConnection(ctx.db, "fred")).toBeNull();
    expect((await ctx.app.request("/v1/settings/connections/fred", { method: "DELETE", headers: headers() })).status).toBe(204);
    expect((await ctx.app.request("/v1/settings/connections/other", { method: "DELETE", headers: headers() })).status).toBe(404);
  });

  it("lists a Dhan token past its expiry as expired", async () => {
    await saveConnection(ctx.db, {
      provider: "dhan", clientId: CLIENT, secretCiphertext: "x", secretLast4: "wxyz",
      expiresAt: new Date(Date.now() - 60_000), checkedAt: new Date(), savedByUserId: null,
    });
    expect((await list()).items[0]!.state).toBe("expired");
  });

  it("lists a Dhan token Dhan last refused as expired, and another error as failing", async () => {
    await saveConnection(ctx.db, {
      provider: "dhan", clientId: CLIENT, secretCiphertext: "x", secretLast4: "wxyz",
      expiresAt: new Date(Date.now() + 86_400_000), checkedAt: new Date(), savedByUserId: null,
    });
    await markConnectionError(ctx.db, "dhan", "DHAN_TOKEN_EXPIRED");
    expect((await list()).items[0]!.state).toBe("expired");
    await markConnectionError(ctx.db, "dhan", "SOURCE_UNAVAILABLE");
    expect((await list()).items[0]!.state).toBe("failing");
  });

  it("gives the last time readings from each source were stored", async () => {
    await putDhan({ clientId: CLIENT, accessToken: TOKEN });
    await upsertMarketPoints(ctx.db, [{ series: "india_vix", day: "2026-10-06", value: 17, source: "Dhan · NSE close" }]);
    const { items } = await list();
    expect(items[0]!.lastRead).not.toBeNull();
    expect(items[1]!.lastRead).toBeNull();
  });

  it("needs a session", async () => {
    expect((await ctx.app.request("/v1/settings/connections")).status).toBe(401);
    const put = await ctx.app.request("/v1/settings/connections/dhan", {
      method: "PUT", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ clientId: CLIENT, accessToken: TOKEN }),
    });
    expect(put.status).toBe(401);
    expect(calls.dhan).toEqual([]);
  });
});

describe("settings connections without CONNECTIONS_KEY", () => {
  let bare: TestContext;
  let bareCookie: string;
  beforeAll(async () => {
    bare = await createTestContext({}, { marketSources });
    ({ cookie: bareCookie } = await bare.signUp("nokey@example.com"));
  });
  afterAll(() => bare.close());

  it("answers 409 INVALID_STATE on every route, after the session check", async () => {
    expect((await bare.app.request("/v1/settings/connections")).status).toBe(401);
    const reqs: [string, string, unknown?][] = [
      ["GET", "/v1/settings/connections"],
      ["PUT", "/v1/settings/connections/dhan", { clientId: CLIENT, accessToken: TOKEN }],
      ["PUT", "/v1/settings/connections/fred", { apiKey: FRED_KEY }],
      ["DELETE", "/v1/settings/connections/dhan"],
    ];
    for (const [method, path, body] of reqs) {
      const res = await bare.app.request(path, {
        method, headers: { cookie: bareCookie, "content-type": "application/json", origin: "http://localhost" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(res.status).toBe(409);
      expect((await clean(res)) as ErrBody).toMatchObject({ error: { code: "INVALID_STATE", message: "CONNECTIONS_KEY is not set" } });
    }
    expect(calls.dhan).toEqual([]);
  });
});
