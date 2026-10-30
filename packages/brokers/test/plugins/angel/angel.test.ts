import { describe, expect, it, vi } from "vitest";
import { BrokerError } from "../../../src/errors.js";
import { readHoldings } from "../../../src/host.js";
import { HOLDINGS_URL, PROFILE_URL, angel, angelHeaders, symbolOf } from "../../../src/plugins/angel/plugin.js";
import { defaultRegistry, plugins } from "../../../src/plugins/index.js";
import { runConformance } from "../../conformance.js";
import errorOther from "./fixtures/error-other.json";
import errorToken from "./fixtures/error-token.json";
import holdings from "./fixtures/holdings.json";
import holdingsEmpty from "./fixtures/holdings-empty.json";
import holdingsStrings from "./fixtures/holdings-strings.json";
import profile from "./fixtures/profile.json";

const creds = { apiKey: "angelkey1" };
const NOW = new Date("2026-10-27T18:20:00Z");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

/** A fetch that answers by URL and records each request's URL and headers. */
function angelFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const answer = answers[url];
    return answer ? json(answer.status ?? 200, answer.body) : json(404, {});
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

/** The read the host makes, against a holdings call that answers `body`. */
const read = (body: unknown, over: { creds?: Record<string, string>; status?: number } = {}) => {
  const { fetch, calls } = angelFetch({ [HOLDINGS_URL]: { status: over.status, body } });
  const lines = readHoldings(angel, { creds: over.creds ?? creds, session: { accessToken: "jwt-abc", accountId: "A1234567" }, now: NOW, fetch });
  return { lines, calls };
};
/** A good answer whose list is `data`. */
const listOf = (...data: unknown[]) => ({ status: true, message: "SUCCESS", errorcode: "", data });
/** One line with only what a read needs, and whatever `over` changes or removes (`undefined` removes). */
const line = (over: Record<string, unknown> = {}) => ({ tradingsymbol: "SBIN-EQ", exchange: "NSE", isin: "INE062A01020", quantity: 10, t1quantity: 0, averageprice: 512.35, ltp: 801.4, ...over });

const SBIN_NSE = { isin: "INE062A01020", symbol: "SBIN", exchange: "NSE", quantity: "10", t1Quantity: "0", averagePrice: "512.35", lastPrice: "801.4" };

runConformance(angel, {
  creds,
  goodReturn: { auth_token: "jwt-abc", feed_token: "feed-1", state: "nonce-1" },
  refusedReturn: { state: "nonce-1" },
  answers: { [PROFILE_URL]: { status: 200, body: profile }, [HOLDINGS_URL]: { status: 200, body: holdings } },
  expectedLines: [
    SBIN_NSE,
    { isin: "INE000Z01011", symbol: "ABC-BE", exchange: "NSE", quantity: "20", t1Quantity: "5", averagePrice: "0", lastPrice: "41.05" },
    { isin: "INE062A01020", symbol: "SBIN", exchange: "BSE", quantity: "2", t1Quantity: "0", averagePrice: "600", lastPrice: "801.25" },
  ],
  signInAt: NOW,
  expectedExpiry: "2026-10-27T18:30:00.000Z",
});

describe("the Angel One holdings read", () => {
  it("reads holdings as printed", async () => {
    expect(await read(holdings).lines).toEqual([
      SBIN_NSE,
      { isin: "INE000Z01011", symbol: "ABC-BE", exchange: "NSE", quantity: "20", t1Quantity: "5", averagePrice: "0", lastPrice: "41.05" },
      { isin: "INE062A01020", symbol: "SBIN", exchange: "BSE", quantity: "2", t1Quantity: "0", averagePrice: "600", lastPrice: "801.25" },
    ]);
  });

  it("reads string figures and tradingSymbol", async () => {
    expect(await read(holdingsStrings).lines).toEqual([
      { isin: "INE002A01018", symbol: "RELIANCE", exchange: "NSE", quantity: "4", t1Quantity: "0", averagePrice: "2450.10", lastPrice: "2511.00" },
    ]);
  });

  it('a missing averageprice is "0" and a missing ltp is null', async () => {
    for (const gone of [undefined, null]) {
      const lines = await read(listOf(line({ averageprice: gone, ltp: gone, t1quantity: gone }))).lines;
      expect(lines, String(gone)).toEqual([{ ...SBIN_NSE, t1Quantity: "0", averagePrice: "0", lastPrice: null }]);
    }
  });

  it("sends the same headers as the profile call, with the key as it is", async () => {
    const { lines, calls } = read(holdings);
    await lines;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HOLDINGS_URL);
    expect(calls[0]?.headers).toEqual(angelHeaders("angelkey1", "jwt-abc"));
    for (const name of ["X-ClientLocalIP", "X-ClientPublicIP", "X-MACAddress"]) expect(Object.keys(calls[0]?.headers ?? {})).not.toContain(name);

    // A key with reserved characters goes into the header exactly as saved (the login URL is where it is encoded).
    const odd = read(holdings, { creds: { apiKey: "ab+c&d" } });
    await odd.lines;
    expect(odd.calls[0]?.headers["X-PrivateKey"]).toBe("ab+c&d");
    expect(odd.calls[0]?.headers).toEqual(angelHeaders("ab+c&d", "jwt-abc"));
  });

  it("keeps a holding bought today", async () => {
    // No shares have settled yet and five are due tomorrow. That is still a holding, with the two quantities kept apart.
    expect(await read(listOf(line({ quantity: 0, t1quantity: 5 }))).lines).toEqual([{ ...SBIN_NSE, quantity: "0", t1Quantity: "5" }]);
  });

  it("an empty account is no lines", async () => {
    expect(await read(holdingsEmpty).lines).toEqual([]);
  });

  it("an empty list is no holdings only when the answer carries no error code", async () => {
    // Silent on the code, or an empty one in either spelling: an account with nothing in it.
    for (const codes of [{}, { errorcode: "" }, { errorCode: "" }, { errorcode: "", errorCode: "" }, { errorcode: null }]) {
      expect(await read({ status: true, message: "SUCCESS", ...codes, data: [] }).lines, JSON.stringify(codes)).toEqual([]);
    }
    // A code beside the empty list says something went wrong, so "no holdings" is not said.
    for (const codes of [{ errorcode: "AB1004" }, { errorCode: "AB1004" }, { errorcode: "", errorCode: "AB1004" }, { errorcode: "AB1004", errorCode: "" }]) {
      for (const flag of [{ status: true }, { success: true }]) {
        const body = { ...flag, message: "SUCCESS", ...codes, data: [] };
        const err = await rejection(read(body).lines);
        expect(err, JSON.stringify(body)).toBeInstanceOf(BrokerError);
        expect(err, JSON.stringify(body)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
        expect((err as BrokerError).message, JSON.stringify(body)).not.toContain("AB1004");
      }
    }
  });

  it("data null or an object is unreadable", async () => {
    for (const data of [null, {}, { holdings: [] }, "none", 0]) {
      const err = await rejection(read({ status: true, message: "SUCCESS", errorcode: "", data }).lines);
      expect(err, JSON.stringify(data)).toBeInstanceOf(BrokerError);
      expect(err, JSON.stringify(data)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
    // An answer with no data at all, and one that is not an object, are no list either.
    for (const body of [{ status: true }, [], null]) expect(await rejection(read(body).lines), JSON.stringify(body)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
  });

  it("a signed-out answer is BROKER_SIGNED_OUT", async () => {
    for (const body of [errorToken, { status: false, errorcode: "AG8002" }, { status: false, errorcode: "AG8003" }]) {
      const err = await rejection(read(body).lines);
      expect(err, JSON.stringify(body)).toBeInstanceOf(BrokerError);
      expect(err, JSON.stringify(body)).toMatchObject({ code: "BROKER_SIGNED_OUT" });
      for (const hidden of ["Invalid Token", "jwt-abc", "angelkey1"]) expect((err as BrokerError).message).not.toContain(hidden);
    }
    const other = await rejection(read(errorOther).lines);
    expect(other).toMatchObject({ code: "BROKER_UNAVAILABLE" });
    for (const hidden of ["Something Went Wrong", "jwt-abc", "angelkey1"]) expect((other as BrokerError).message).not.toContain(hidden);
  });

  it("a 401 or a 403 is BROKER_SIGNED_OUT, and any other failing status is BROKER_UNAVAILABLE", async () => {
    for (const status of [401, 403]) expect(await rejection(read(errorToken, { status }).lines), String(status)).toMatchObject({ code: "BROKER_SIGNED_OUT" });
    for (const status of [500, 502]) expect(await rejection(read(errorOther, { status }).lines), String(status)).toMatchObject({ code: "BROKER_UNAVAILABLE" });
  });

  it("a null symbol fails the read", async () => {
    // Angel One can send `tradingsymbol: null`. One such line is no reason to drop it quietly.
    for (const tradingsymbol of [null, undefined, "", "  "]) {
      const err = await rejection(read(listOf(line(), line({ tradingsymbol, isin: "INE000Z01011" }))).lines);
      expect(err, String(tradingsymbol)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
    // The camel-case spelling of the same field is read when `tradingsymbol` is null or absent. An empty string is not
    // skipped: it is a symbol that is missing, and fails the read (the list above).
    expect(await read(listOf(line({ tradingsymbol: null, tradingSymbol: "SBIN-EQ" }))).lines).toEqual([SBIN_NSE]);
  });

  it("a line with no isin fails the read", async () => {
    // A line with no ISIN fails the whole read; it is never dropped quietly.
    for (const isin of [undefined, null, "", "  ", 4]) {
      const err = await rejection(read(listOf(line(), line({ isin, tradingsymbol: "ABC-BE" }))).lines);
      expect(err, String(isin)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
    expect(await rejection(read(listOf(null)).lines)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
  });

  it("a line with no exchange or a figure that is not a decimal fails the read", async () => {
    expect(await rejection(read(listOf(line({ exchange: undefined }))).lines)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    for (const quantity of [undefined, null, "", "1e3", "NaN", "1,000", true]) {
      expect(await rejection(read(listOf(line({ quantity }))).lines), String(quantity)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
    for (const averageprice of ["ten", "1e3", "", true, {}]) {
      expect(await rejection(read(listOf(line({ averageprice }))).lines), JSON.stringify(averageprice)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
  });

  it("the same isin and exchange twice fails the read", async () => {
    // Two lines for one share (a split by product, say). The plugin does not add them together, because adding
    // is arithmetic; the host refuses the read.
    const err = await rejection(read(listOf(line({ product: "DELIVERY" }), line({ product: "MTF", quantity: 3 }))).lines);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    // The same isin on two exchanges is two holdings, not a repeat.
    expect(await read(listOf(line(), line({ exchange: "BSE", tradingsymbol: "SBIN" }))).lines).toHaveLength(2);
  });

  describe("symbols", () => {
    it("strips -EQ on NSE and nothing else", () => {
      expect(symbolOf("SBIN-EQ", "NSE")).toBe("SBIN");
      expect(symbolOf("ABC-BE", "NSE")).toBe("ABC-BE");
      expect(symbolOf("SBIN", "BSE")).toBe("SBIN");
      expect(symbolOf("SBIN-EQ", "BSE")).toBe("SBIN-EQ");
      // Only a trailing -EQ, and only once.
      expect(symbolOf("SBIN", "NSE")).toBe("SBIN");
      expect(symbolOf("A-EQ-EQ", "NSE")).toBe("A-EQ");
      expect(symbolOf("EQ-SBIN", "NSE")).toBe("EQ-SBIN");
    });
  });
});

describe("Angel One in the default registry", () => {
  it("is registered, switched off", () => {
    // The registry holds a frozen copy, so what is compared is the manifest it holds, not the object.
    expect(plugins).toContain(angel);
    const held = defaultRegistry().get("angel");
    expect(held?.manifest).toMatchObject({
      id: "angel",
      name: "Angel One",
      enabled: false,
      notOfferedReason: "Not offered until Maester has tried a live Angel One sign-in.",
      hosts: ["smartapi.angelone.in", "apiconnect.angelone.in"],
      signedOutStatuses: [401, 403],
      credentialShown: "apiKey",
    });
    expect(held?.manifest.credentials.map((c) => [c.key, c.secret])).toEqual([["apiKey", false]]);
    expect(defaultRegistry().get("kite")).toBeDefined();
  });
});
