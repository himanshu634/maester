import { describe, expect, it } from "vitest";
import { HttpDhanSource, HttpFredSource, ist, MarketSourceError, keepScripRow, nearMonthGold, parseScripMaster } from "../src/index.js";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};
type Json2 = Record<string, unknown>;

/** A clock that only moves when the injected sleep is called. */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; } };
}

describe("ist", () => {
  it("maps a 15:30 IST candle to its IST day", () => {
    expect(ist(Date.parse("2026-10-06T10:00:00Z") / 1000)).toBe("2026-10-06");
    expect(ist(Date.parse("2026-10-05T19:00:00Z") / 1000)).toBe("2026-10-06"); // 00:30 IST next day
  });
});

describe("HttpDhanSource", () => {
  const inst = { securityId: "21", exchangeSegment: "IDX_I", instrument: "INDEX" };
  const make = (fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof HttpDhanSource>[0]> = {}) =>
    new HttpDhanSource({ clientId: "c", accessToken: "t", requestsPerSecond: 4, fetch, sleep: noSleep, ...extra });

  it("parses daily closes into IST days", async () => {
    const t = Date.parse("2026-10-06T00:00:00+05:30") / 1000;
    const dhan = make(async () => json(200, { open: [1], high: [1], low: [1], close: [17.8], volume: [0], timestamp: [t] }));
    expect(await dhan.daily(inst, "2026-10-01", "2026-10-07")).toEqual([{ day: "2026-10-06", value: 17.8 }]);
  });

  it("sends headers and a body whose toDate is the day after `to`", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const dhan = make(async (url, init) => { seen = { url: String(url), init: init! }; return json(200, { close: [], timestamp: [] }); });
    await dhan.daily({ ...inst, expiryCode: 0 }, "2026-09-30", "2026-10-31");
    expect(seen!.url).toBe("https://api.dhan.co/v2/charts/historical");
    expect(seen!.init.method).toBe("POST");
    expect(seen!.init.headers).toMatchObject({ "access-token": "t", "client-id": "c", "content-type": "application/json" });
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      securityId: "21", exchangeSegment: "IDX_I", instrument: "INDEX", expiryCode: 0, oi: false, fromDate: "2026-09-30", toDate: "2026-11-01",
    });
  });

  it("names an expired token (401, DH-901, 807)", async () => {
    for (const res of [() => json(401, { errorCode: "DH-901", errorMessage: "Invalid token" }), () => json(401, {}), () => json(400, { errorCode: "DH-901" }), () => json(400, { errorCode: "807" })]) {
      const dhan = make(async () => res());
      await expect(dhan.daily(inst, "2026-10-01", "2026-10-07")).rejects.toMatchObject({ code: "DHAN_TOKEN_EXPIRED" });
    }
  });

  it("retries the rate limit 3 times with 1, 2 and 4 seconds of backoff, then gives up", async () => {
    let calls = 0;
    const c = clock();
    const dhan = make(async () => { calls++; return json(429, { errorCode: "DH-904" }); }, { sleep: c.sleep, now: c.now });
    const err = await dhan.daily(inst, "2026-10-01", "2026-10-07").catch((e) => e);
    expect(err).toBeInstanceOf(MarketSourceError);
    expect(err.code).toBe("DHAN_RATE_LIMITED");
    expect(calls).toBe(4);
    expect(c.sleeps).toEqual([1000, 2000, 4000]);
  });

  it("retries on DH-904 and 805 in the body and recovers", async () => {
    const answers = [json(400, { errorCode: "805" }), json(200, { close: [5], timestamp: [Date.parse("2026-10-06T00:00:00+05:30") / 1000] })];
    const dhan = make(async () => answers.shift()!);
    expect(await dhan.daily(inst, "2026-10-01", "2026-10-07")).toEqual([{ day: "2026-10-06", value: 5 }]);
  });

  it("raises SOURCE_UNAVAILABLE for other failures and network errors, never naming the token", async () => {
    await expect(make(async () => json(500, { errorCode: "DH-902", errorMessage: "no data plan" })).daily(inst, "a", "2026-10-07")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    const err = await make(async () => { throw new TypeError("fetch failed t"); }).daily(inst, "a", "2026-10-07").catch((e) => e);
    expect(err.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("spaces requests to at most requestsPerSecond", async () => {
    const c = clock();
    const dhan = make(async () => json(200, { close: [], timestamp: [] }), { sleep: c.sleep, now: c.now, requestsPerSecond: 4 });
    await dhan.daily(inst, "a", "2026-10-07");
    await dhan.daily(inst, "a", "2026-10-07");
    await dhan.daily(inst, "a", "2026-10-07");
    expect(c.sleeps).toEqual([250, 250]);
  });

  it("sums open interest over the nearest expiry for the put-call ratio", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const dhan = make(async (url, init) => {
      const body = JSON.parse(init!.body as string);
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/optionchain/expirylist")) return json(200, { status: "success", data: ["2099-01-08", "2099-01-01"] });
      return json(200, { status: "success", data: { last_price: 25000, oc: {
        "24900.000000": { ce: { oi: 100 }, pe: { oi: 300 } },
        "25000.000000": { ce: { oi: 200, last_price: 1 }, pe: { oi: 100 } },
        "25100.000000": { ce: { oi: 100 } },
      } } });
    });
    expect(await dhan.putCallRatio()).toBeCloseTo(400 / 400);
    expect(calls[0]!.body).toEqual({ UnderlyingScrip: 13, UnderlyingSeg: "IDX_I" });
    expect(calls[1]!.url).toBe("https://api.dhan.co/v2/optionchain");
    expect(calls[1]!.body).toEqual({ UnderlyingScrip: 13, UnderlyingSeg: "IDX_I", Expiry: "2099-01-01" });
  });

  it("refuses a put-call ratio when there is no call open interest", async () => {
    const dhan = make(async (url) => String(url).endsWith("expirylist") ? json(200, { data: ["2099-01-01"] }) : json(200, { data: { oc: { "1": { pe: { oi: 5 } } } } }));
    await expect(dhan.putCallRatio()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("reads the profile", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const dhan = make(async (url, init) => { seen = { url: String(url), init: init! }; return json(200, { dhanClientId: "1100003626", tokenValidity: "30/03/2099 15:37", dataPlan: "Active", dataValidity: "2099-12-05 09:37:52.0" }); });
    expect(await dhan.profile()).toEqual({ clientId: "1100003626", tokenExpiresAt: "2099-03-30T10:07:00.000Z", dataPlanActive: true });
    expect(seen!.url).toBe("https://api.dhan.co/v2/profile");
    expect(seen!.init.method).toBe("GET");
    expect(seen!.init.headers).toMatchObject({ "access-token": "t" });
  });

  it("reports a lapsed or missing data plan", async () => {
    const lapsed = make(async () => json(200, { dhanClientId: "1", tokenValidity: "bad", dataPlan: "Deactive" }));
    expect(await lapsed.profile()).toEqual({ clientId: "1", tokenExpiresAt: null, dataPlanActive: false });
    const past = make(async () => json(200, { dhanClientId: "1", dataPlan: "Active", dataValidity: "2000-01-01 00:00:00.0" }), { now: () => Date.parse("2026-10-06T00:00:00Z") });
    expect((await past.profile()).dataPlanActive).toBe(false);
    const missing = make(async () => json(200, { dhanClientId: "1" }));
    expect(await missing.profile()).toEqual({ clientId: "1", tokenExpiresAt: null, dataPlanActive: null });
  });

  it("renews a token, and maps a refusal to DHAN_TOKEN_EXPIRED", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const ok = make(async (url, init) => { seen = { url: String(url), init: init! }; return json(200, { accessToken: "new-token", expiryTime: "2099-03-31T10:07:00" }); });
    const res = await ok.renewToken();
    expect(res.accessToken).toBe("new-token");
    expect(res.expiresAt).toBe("2099-03-31T04:37:00.000Z"); // zone-less, read as IST
    expect(seen!.url).toBe("https://api.dhan.co/v2/RenewToken");
    expect(seen!.init.headers).toMatchObject({ "access-token": "t", dhanClientId: "c" });
    const viaValidity = make(async () => json(200, { accessToken: "n", tokenValidity: "31/03/2099 15:37" }));
    expect((await viaValidity.renewToken()).expiresAt).toBe("2099-03-31T10:07:00.000Z");
    const refused = make(async () => json(400, { errorCode: "DH-906", errorMessage: "cannot renew" }));
    await expect(refused.renewToken()).rejects.toMatchObject({ code: "DHAN_TOKEN_EXPIRED" });
    const noToken = make(async () => json(200, {}));
    await expect(noToken.renewToken()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  const csv = [
    "SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_INSTRUMENT_NAME,SEM_EXPIRY_CODE,SEM_TRADING_SYMBOL,SEM_LOT_UNITS,SEM_CUSTOM_SYMBOL,SEM_EXPIRY_DATE,SEM_STRIKE_PRICE,SEM_OPTION_TYPE,SEM_TICK_SIZE,SEM_EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SEM_SERIES,SM_SYMBOL_NAME",
    "NSE,E,2885,EQUITY,0,RELIANCE,1.0,Reliance Industries,,,,10.0000,NA,ES,EQ,RELIANCE INDUSTRIES LTD",
    "NSE,E,999,EQUITY,0,RELIANCE,1.0,Reliance other series,,,,10.0000,NA,ES,BE,RELIANCE",
    "BSE,E,500325,EQUITY,0,RELIANCE,1.0,Reliance bse,,,,10.0000,NA,ES,A,RELIANCE",
    "NSE,I,13,INDEX,0,NIFTY,1.0,Nifty 50,,,,0.0500,NA,I,NA,Nifty 50",
    'NSE,E,11536,EQUITY,0,TCS,1.0,"Tata Consultancy, Services",,,,10.0000,NA,ES,EQ,TATA CONSULTANCY SERV LT',
    "MCX,M,559933,FUTCOM,0,GOLD-05Feb2027-FUT,100.0,x,2027-02-05 23:30:00,-0.01,XX,1.0,M,FUTCOM,NA,GOLD",
    "MCX,M,495213,FUTCOM,0,GOLD-04Dec2026-FUT,100.0,x,2026-12-04 23:30:00,-0.01,XX,1.0,M,FUTCOM,NA,GOLD",
    "MCX,M,111,FUTCOM,0,GOLD-05Oct2026-FUT,100.0,x,2026-10-05 23:30:00,-0.01,XX,1.0,M,FUTCOM,NA,GOLD",
    "MCX,M,222,FUTCOM,0,GOLDM-04Dec2026-FUT,10.0,x,2026-12-04 23:30:00,-0.01,XX,1.0,M,FUTCOM,NA,GOLDM",
  ].join("\n");

  it("maps NSE equity symbols to security ids from the scrip master, once", async () => {
    let fetches = 0;
    const dhan = make(async (url) => { fetches++; expect(String(url)).toBe("https://images.dhan.co/api-data/api-scrip-master.csv"); return new Response(csv); });
    const ids = await dhan.equityIds();
    expect(ids.get("RELIANCE")).toBe("2885");
    expect(ids.get("TCS")).toBe("11536");
    expect(ids.has("NIFTY")).toBe(false);
    expect(ids.size).toBe(2);
    await dhan.equityIds();
    await dhan.goldContracts();
    expect(fetches).toBe(1);
  });

  it("lists unexpired GOLD futures, earliest first, not GOLDM", async () => {
    const dhan = make(async () => new Response(csv), { now: () => Date.parse("2026-10-06T06:00:00Z") });
    expect(await dhan.goldContracts()).toEqual([
      { securityId: "495213", exchangeSegment: "MCX_COMM", instrument: "FUTCOM", expiry: "2026-12-04" },
      { securityId: "559933", exchangeSegment: "MCX_COMM", instrument: "FUTCOM", expiry: "2027-02-05" },
    ]);
  });

  it("keeps server text, the token and the client id out of error messages", async () => {
    const leak = "tok-SECRET-123 cid-SECRET-9";
    const body = { errorCode: "DH-XXX", errorMessage: leak };
    const cases: [number, Json2, string][] = [
      [401, { ...body, errorCode: "DH-901" }, "DHAN_TOKEN_EXPIRED"],
      [429, { ...body, errorCode: "DH-904" }, "DHAN_RATE_LIMITED"],
      [500, body, "SOURCE_UNAVAILABLE"],
      [500, { errorCode: leak, errorMessage: leak }, "SOURCE_UNAVAILABLE"],
    ];
    for (const [status, b, code] of cases) {
      const dhan = new HttpDhanSource({ clientId: "cid-SECRET-9", accessToken: "tok-SECRET-123", requestsPerSecond: 4, fetch: async () => json(status, b), sleep: noSleep });
      const err = await dhan.daily(inst, "2026-10-01", "2026-10-07").catch((e) => e);
      expect(err.code).toBe(code);
      expect(err.message).not.toContain("SECRET");
    }
    const net = new HttpDhanSource({ clientId: "cid-SECRET-9", accessToken: "tok-SECRET-123", requestsPerSecond: 4, fetch: async () => { throw new TypeError(`fetch failed ${leak}`); }, sleep: noSleep });
    const err = await net.daily(inst, "2026-10-01", "2026-10-07").catch((e) => e);
    expect(err.code).toBe("SOURCE_UNAVAILABLE");
    expect(err.message).not.toContain("SECRET");
  });

  it("does not show the token, client id or key to JSON.stringify", () => {
    const dhan = new HttpDhanSource({ clientId: "cid-SECRET-9", accessToken: "tok-SECRET-123", requestsPerSecond: 4 });
    expect(JSON.stringify(dhan)).not.toContain("SECRET");
    expect(JSON.stringify(new HttpFredSource({ apiKey: "key-SECRET-1" }))).not.toContain("SECRET");
  });

  it("refuses a rate of zero or less", () => {
    for (const requestsPerSecond of [0, -1, Number.NaN]) {
      expect(() => new HttpDhanSource({ clientId: "c", accessToken: "t", requestsPerSecond })).toThrow();
    }
  });

  it("returns daily closes oldest first", async () => {
    const t = (d: string) => Date.parse(`${d}T00:00:00+05:30`) / 1000;
    const dhan = make(async () => json(200, { close: [2, 1], timestamp: [t("2026-10-06"), t("2026-10-05")] }));
    expect((await dhan.daily(inst, "2026-10-01", "2026-10-07")).map((p) => p.day)).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("skips a null strike in the option chain", async () => {
    const dhan = make(async (url) => String(url).endsWith("expirylist") ? json(200, { data: ["2099-01-01"] }) : json(200, { data: { oc: { "1": null, "2": { ce: { oi: 10 }, pe: { oi: 5 } } } } }));
    expect(await dhan.putCallRatio()).toBe(0.5);
  });

  it("puts a timeout on every request", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const dhan = make(async (url, init) => { signals.push(init?.signal); return String(url).endsWith(".csv") ? new Response(csv) : json(200, { close: [], timestamp: [] }); });
    await dhan.daily(inst, "a", "2026-10-07");
    await dhan.equityIds();
    expect(signals).toHaveLength(2);
    expect(signals.every((x) => x instanceof AbortSignal)).toBe(true);
    const timedOut = make(async () => { throw new DOMException("timed out", "TimeoutError"); });
    await expect(timedOut.daily(inst, "a", "2026-10-07")).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE", message: "Dhan could not be reached" });
  });

  it("keeps only the rows it uses from the scrip master", () => {
    const kept = parseScripMaster(csv, keepScripRow);
    expect(kept.every((r) => (r.SEM_SEGMENT === "E" && r.SEM_EXM_EXCH_ID === "NSE") || r.SM_SYMBOL_NAME === "GOLD")).toBe(true);
    expect(kept.length).toBeLessThan(parseScripMaster(csv).length);
  });

  it("raises SOURCE_UNAVAILABLE when the scrip master cannot be downloaded", async () => {
    const dhan = make(async () => new Response("x", { status: 503 }));
    await expect(dhan.equityIds()).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });

  it("nearMonthGold picks the earliest unexpired GOLD contract", () => {
    const rows = parseScripMaster(csv);
    expect(nearMonthGold(rows, "2026-10-06")?.securityId).toBe("495213");
    expect(nearMonthGold(rows, "2026-10-05")?.securityId).toBe("111");
    expect(nearMonthGold(rows, "2030-01-01")).toBeUndefined();
  });
});

describe("HttpFredSource", () => {
  it("skips missing observations", async () => {
    const fred = new HttpFredSource({ apiKey: "k", fetch: async () => json(200, { observations: [{ date: "2026-10-02", value: "." }, { date: "2026-10-05", value: "22.6" }] }) });
    expect(await fred.observations("VIXCLS", "2026-10-01")).toEqual([{ day: "2026-10-05", value: 22.6 }]);
  });

  it("asks for json from the start day", async () => {
    let url = "";
    const fred = new HttpFredSource({ apiKey: "k", fetch: async (u) => { url = String(u); return json(200, { observations: [] }); } });
    await fred.observations("DEXINUS", "2026-09-01");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.stlouisfed.org/fred/series/observations");
    expect(Object.fromEntries(u.searchParams)).toEqual({ series_id: "DEXINUS", api_key: "k", file_type: "json", observation_start: "2026-09-01" });
  });

  it("raises SOURCE_UNAVAILABLE without leaking the key", async () => {
    const bad = new HttpFredSource({ apiKey: "secretkey", fetch: async () => json(400, { error_message: "Bad key" }) });
    const err = await bad.observations("VIXCLS", "2026-10-01").catch((e) => e);
    expect(err).toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(err.message).not.toContain("secretkey");
    const down = new HttpFredSource({ apiKey: "secretkey", fetch: async () => { throw new TypeError("fetch failed https://x?api_key=secretkey"); } });
    const err2 = await down.check().catch((e) => e);
    expect(err2.code).toBe("SOURCE_UNAVAILABLE");
    expect(err2.message).not.toContain("secretkey");
  });

  it("checks a key by reading one VIXCLS observation", async () => {
    let url = "";
    const fred = new HttpFredSource({ apiKey: "k", fetch: async (u) => { url = String(u); return json(200, { observations: [{ date: "2026-10-05", value: "22.6" }] }); } });
    await expect(fred.check()).resolves.toBeUndefined();
    expect(new URL(url).searchParams.get("series_id")).toBe("VIXCLS");
    expect(new URL(url).searchParams.get("limit")).toBe("1");
  });
});
