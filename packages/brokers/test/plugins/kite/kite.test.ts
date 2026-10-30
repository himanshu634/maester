import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BrokerError } from "../../../src/errors.js";
import { completeSignIn, loginUrlFor, readHoldings } from "../../../src/host.js";
import { kite } from "../../../src/plugins/kite/plugin.js";
import { defaultRegistry, plugins } from "../../../src/plugins/index.js";
import { runConformance } from "../../conformance.js";
import holdings from "./fixtures/holdings.json";
import holdingsBadFigure from "./fixtures/holdings-bad-figure.json";
import session from "./fixtures/session.json";
import signedOut from "./fixtures/signed-out.json";

const creds = { apiKey: "kitekey123", apiSecret: "kitesecret456" };
const SESSION_URL = "https://api.kite.trade/session/token";
const HOLDINGS_URL = "https://api.kite.trade/portfolio/holdings";
const RETURN_URL = "https://app.test/v1/brokers/kite/return";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sent = (fetch: ReturnType<typeof vi.fn>, call = 0) => fetch.mock.calls[call] as unknown as [string, RequestInit];
const read = (fetch: typeof globalThis.fetch, over: Partial<{ creds: Record<string, string>; accountId: string | null }> = {}) =>
  readHoldings(kite, { creds: over.creds ?? creds, session: { accessToken: "tok", accountId: over.accountId ?? null }, now: new Date("2026-10-19T03:30:00Z"), fetch });
const signIn = (fetch: typeof globalThis.fetch, now = new Date("2026-10-19T03:30:00Z")) =>
  completeSignIn(kite, { creds, payload: { requestToken: "rt" }, returnUrl: RETURN_URL, now, fetch });

runConformance(kite, {
  creds,
  goodReturn: { request_token: "rt", state: "nonce-1", status: "success" },
  refusedReturn: { state: "nonce-1", status: "cancelled" },
  answers: { [SESSION_URL]: { status: 200, body: session }, [HOLDINGS_URL]: { status: 200, body: holdings } },
  expectedLines: [{ isin: "INE040A01034", symbol: "HDFCBANK", exchange: "NSE", quantity: "120", t1Quantity: "0", averagePrice: "1512.4", lastPrice: "1742.6" }],
  signInAt: new Date("2026-10-19T03:30:00Z"),
  expectedExpiry: "2026-10-20T00:30:00.000Z",
});

describe("the Kite plugin", () => {
  it("is in the default registry", () => {
    expect(plugins).toContain(kite);
    expect(defaultRegistry().get("kite")).toBeDefined();
    expect(defaultRegistry().get("kite")?.manifest).toMatchObject({ name: "Zerodha", enabled: true, hosts: ["kite.zerodha.com", "api.kite.trade"], signedOutStatuses: [403], credentialShown: "apiKey" });
    expect(defaultRegistry().get("kite")?.manifest.credentials.map((c) => [c.key, c.secret])).toEqual([["apiKey", false], ["apiSecret", true]]);
  });

  describe("login", () => {
    it("builds the login URL with the key and the state sent back as redirect_params", () => {
      const url = loginUrlFor(kite, { creds, state: "nonce-1", returnUrl: RETURN_URL });
      // The exact address Kite's login expects: the key and "state=<nonce>" are URL-encoded, nothing else is added.
      expect(url).toBe("https://kite.zerodha.com/connect/login?v=3&api_key=kitekey123&redirect_params=state%3Dnonce-1");
      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe("https://kite.zerodha.com/connect/login");
      expect(parsed.searchParams.get("api_key")).toBe("kitekey123");
      expect(parsed.searchParams.get("redirect_params")).toBe("state=nonce-1");
    });

    it("URL-encodes a key that has characters a URL does not allow", () => {
      const url = loginUrlFor(kite, { creds: { ...creds, apiKey: "a b&c=d'e" }, state: "n 1", returnUrl: RETURN_URL });
      expect(url).toBe("https://kite.zerodha.com/connect/login?v=3&api_key=a%20b%26c%3Dd'e&redirect_params=state%3Dn%201");
      expect(new URL(url).searchParams.get("api_key")).toBe("a b&c=d'e");
    });
  });

  describe("the return", () => {
    it("reads the request token and the state from a good return", () => {
      expect(kite.signIn.readReturn({ request_token: "rt", state: "s", status: "success" })).toEqual({ state: "s", payload: { requestToken: "rt" } });
    });

    it("accepts a return with no status parameter", () => {
      expect(kite.signIn.readReturn({ request_token: "rt", state: "s" })).toEqual({ state: "s", payload: { requestToken: "rt" } });
    });

    it('refuses a return whose status is "cancelled"', () => {
      expect(kite.signIn.readReturn({ request_token: "rt", state: "s", status: "cancelled" })).toEqual({ state: "s", refused: true });
      expect(kite.signIn.readReturn({ state: "s", status: "cancelled" })).toEqual({ state: "s", refused: true });
    });

    it("refuses a return with no request token or an empty one, and keeps the state it was given", () => {
      expect(kite.signIn.readReturn({ state: "s", status: "success" })).toEqual({ state: "s", refused: true });
      expect(kite.signIn.readReturn({ request_token: "", state: "s", status: "success" })).toEqual({ state: "s", refused: true });
    });

    it("refuses a return with no state or an empty one, and says there was none", () => {
      expect(kite.signIn.readReturn({ request_token: "rt", status: "success" })).toEqual({ state: null, refused: true });
      expect(kite.signIn.readReturn({ request_token: "rt", state: "", status: "success" })).toEqual({ state: "", refused: true });
    });
  });

  describe("sign-in", () => {
    it("signs in with SHA-256(api_key + request_token + api_secret)", async () => {
      const fetch = vi.fn(async () => json(200, session));
      const got = await signIn(fetch);
      expect(got).toMatchObject({ accessToken: "tok", accountId: "AB1234", signedInAt: new Date("2026-10-19T03:30:00Z") });
      expect(got.expiresAt.toISOString()).toBe("2026-10-20T00:30:00.000Z");
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = sent(fetch);
      expect(url).toBe(SESSION_URL);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.headers).toMatchObject({ "X-Kite-Version": "3", "Content-Type": "application/x-www-form-urlencoded" });
      const form = new URLSearchParams(init.body as string);
      expect([...form.keys()]).toEqual(["api_key", "request_token", "checksum"]);
      expect(form.get("api_key")).toBe("kitekey123");
      expect(form.get("request_token")).toBe("rt");
      expect(form.get("checksum")).toBe(sha256("kitekey123rtkitesecret456"));
      // The secret is only ever hashed.
      expect(form.get("api_secret")).toBeNull();
      expect(init.body as string).not.toContain("kitesecret456");
      expect(JSON.stringify(init.headers)).not.toContain("kitesecret456");
    });

    it("lasts until 06:00 Asia/Kolkata: the next morning after 06:00, the same morning before it", async () => {
      const fetch = vi.fn(async () => json(200, session));
      // 09:00 in Kolkata on the 19th.
      expect((await signIn(fetch, new Date("2026-10-19T03:30:00Z"))).expiresAt.toISOString()).toBe("2026-10-20T00:30:00.000Z");
      // 03:30 in Kolkata on the 20th: 06:00 that day is still ahead.
      expect((await signIn(fetch, new Date("2026-10-19T22:00:00Z"))).expiresAt.toISOString()).toBe("2026-10-20T00:30:00.000Z");
    });

    it("keeps no account when the answer names none, and refuses an answer with no access token", async () => {
      const noUser = await signIn(vi.fn(async () => json(200, { status: "success", data: { access_token: "tok" } })));
      expect(noUser).toMatchObject({ accessToken: "tok", accountId: null });
      for (const body of [{ status: "success", data: {} }, { status: "success", data: { access_token: "" } }, { status: "success", data: { access_token: 42 } }, { data: null }, {}]) {
        const err = await rejection(signIn(vi.fn(async () => json(200, body))));
        expect(err, JSON.stringify(body)).toBeInstanceOf(BrokerError);
        expect(err, JSON.stringify(body)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
    });

    it("says the sign-in was refused on a 403 or a 400, without the broker's words", async () => {
      for (const status of [403, 400]) {
        const err = await rejection(signIn(vi.fn(async () => json(status, signedOut))));
        expect(err).toMatchObject({ code: "BROKER_REFUSED" });
        expect((err as BrokerError).message).not.toContain("secret detail");
      }
    });
  });

  describe("holdings", () => {
    it("reads holdings as decimal strings, as printed", async () => {
      const fetch = vi.fn(async () => json(200, holdings));
      const lines = await read(fetch, { accountId: "AB1234" });
      expect(lines).toEqual([{ isin: "INE040A01034", symbol: "HDFCBANK", exchange: "NSE", quantity: "120", t1Quantity: "0", averagePrice: "1512.4", lastPrice: "1742.6" }]);
      const [url, init] = sent(fetch);
      expect(url).toBe(HOLDINGS_URL);
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.headers).toEqual({ "X-Kite-Version": "3", Authorization: "token kitekey123:tok" });
    });

    it("keeps every digit a figure prints, as a string", async () => {
      const body = { data: [{ tradingsymbol: "ITC", exchange: "BSE", isin: "INE154A01025", quantity: "150.50", t1_quantity: 2, average_price: 438.0, last_price: "0.10" }] };
      const [line] = await read(vi.fn(async () => json(200, body)));
      // A JSON number keeps the digits JSON printed; a string is kept as it is.
      expect(line).toEqual({ isin: "INE154A01025", symbol: "ITC", exchange: "BSE", quantity: "150.50", t1Quantity: "2", averagePrice: "438", lastPrice: "0.10" });
    });

    it("takes a missing T+1 quantity as 0 and a missing or null last price as none", async () => {
      const body = {
        data: [
          { tradingsymbol: "A", exchange: "NSE", isin: "INE000000001", quantity: 1, average_price: 10 },
          { tradingsymbol: "B", exchange: "NSE", isin: "INE000000002", quantity: 2, t1_quantity: null, average_price: 20, last_price: null },
        ],
      };
      const lines = await read(vi.fn(async () => json(200, body)));
      expect(lines.map((l) => [l.t1Quantity, l.lastPrice])).toEqual([["0", null], ["0", null]]);
    });

    it("takes an absent or null average price as none, never 0, and keeps the other lines", async () => {
      for (const average_price of [undefined, null]) {
        const body = {
          data: [
            { tradingsymbol: "A", exchange: "NSE", isin: "INE000000001", quantity: 1, average_price },
            { tradingsymbol: "B", exchange: "NSE", isin: "INE000000002", quantity: 2, average_price: 20.5 },
          ],
        };
        const lines = await read(vi.fn(async () => json(200, body)));
        expect(lines.map((l) => [l.isin, l.averagePrice]), String(average_price)).toEqual([["INE000000001", null], ["INE000000002", "20.5"]]);
      }
    });

    it("keeps an average price printed as 0 as \"0\", as printed", async () => {
      for (const average_price of [0, "0", "0.00"]) {
        const body = { data: [{ tradingsymbol: "A", exchange: "NSE", isin: "INE000000001", quantity: 1, average_price }] };
        const [line] = await read(vi.fn(async () => json(200, body)));
        expect(line?.averagePrice, JSON.stringify(average_price)).toBe(String(average_price));
      }
    });

    it("still refuses an average price that is present but not a decimal", async () => {
      for (const average_price of ["ten", "1e3", "", "1,5", true, {}]) {
        const body = { data: [{ tradingsymbol: "A", exchange: "NSE", isin: "INE000000001", quantity: 1, average_price }] };
        expect(await rejection(read(vi.fn(async () => json(200, body)))), JSON.stringify(average_price)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
    });

    it("gives no lines for a list with nothing in it", async () => {
      expect(await read(vi.fn(async () => json(200, { status: "success", data: [] })))).toEqual([]);
    });

    it("says the broker signed Maester out on a 403", async () => {
      const fetch = vi.fn(async () => json(403, signedOut));
      const err = await rejection(read(fetch));
      expect(err).toBeInstanceOf(BrokerError);
      expect((err as BrokerError).code).toBe("BROKER_SIGNED_OUT");
      expect((err as BrokerError).message).not.toContain("secret detail");
    });

    it("treats any other failing status as the broker being unavailable", async () => {
      for (const status of [401, 500, 502]) {
        expect(await rejection(read(vi.fn(async () => json(status, signedOut))))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
      }
    });

    it("refuses an answer whose figure is not a decimal", async () => {
      const err = await rejection(read(vi.fn(async () => json(200, holdingsBadFigure))));
      expect((err as BrokerError).code).toBe("BROKER_ANSWER_UNREADABLE");
      for (const quantity of ["1e3", "NaN", "", "1,000", null, true]) {
        const body = { data: [{ tradingsymbol: "X", exchange: "NSE", isin: "INE1", quantity, average_price: 1 }] };
        expect(await rejection(read(vi.fn(async () => json(200, body)))), String(quantity)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
    });

    it("refuses an answer with no list, and a line missing its ISIN, symbol or exchange", async () => {
      for (const body of [{}, { status: "success" }, { data: null }, { data: {} }, { data: "none" }, [], null]) {
        expect(await rejection(read(vi.fn(async () => json(200, body)))), JSON.stringify(body)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
      const line = { tradingsymbol: "X", exchange: "NSE", isin: "INE000000001", quantity: 1, average_price: 1 };
      for (const key of ["tradingsymbol", "exchange", "isin"]) {
        const body = { data: [{ ...line, [key]: undefined }] };
        expect(await rejection(read(vi.fn(async () => json(200, body)))), key).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
      expect(await rejection(read(vi.fn(async () => json(200, { data: [null] }))))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    });

    it("never says the key or token when the broker can't be reached", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("connect ECONNREFUSED https://api.kite.trade/?api_key=kitekey123");
      });
      const err = await rejection(read(fetch));
      expect((err as BrokerError).code).toBe("BROKER_UNAVAILABLE");
      expect((err as BrokerError).message).toBe("read: Zerodha could not be reached");
    });
  });
});
