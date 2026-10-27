import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrokerClient, BrokerError, builtInDefinitions, DefinitionError, loadDefinitions, parseDefinition } from "../src/index.js";

const kite = builtInDefinitions().get("kite")!;
const dhan = builtInDefinitions().get("dhan")!;
const creds = { apiKey: "kitekey123", apiSecret: "kitesecret456" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
// A loose copy to break on purpose; the parser is what checks it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (from: unknown = kite) => JSON.parse(JSON.stringify(from)) as Record<string, any>;

describe("definitions", () => {
  it("ships Kite, Dhan, Upstox and Groww enabled, and ICICI Direct switched off", () => {
    expect([...builtInDefinitions().keys()]).toEqual(["kite", "dhan", "upstox", "groww", "icici"]);
    expect(builtInDefinitions().get("upstox")!.enabled).toBe(true);
    expect(kite.enabled).toBe(true);
    expect(dhan.enabled).toBe(true);
    expect(dhan.signIn).toEqual({ kind: "settings-connection", provider: "dhan" });
  });

  it("refuses a settings-connection definition that also asks for a key", () => {
    const d = clone(dhan);
    d.credentials = [{ key: "apiKey", label: "API key", secret: false }];
    expect(() => parseDefinition(d, "x.json")).toThrow(/asks for no credentials/);
  });

  it("refuses a settings-connection definition with a credentialShown", () => {
    const d = clone(dhan);
    d.credentialShown = "apiKey";
    expect(() => parseDefinition(d, "x.json")).toThrow(/has no credentialShown/);
  });

  it("refuses a settings-connection provider Maester has no connection for", () => {
    const d = clone(dhan);
    d.signIn.provider = "fred-plus";
    expect(() => parseDefinition(d, "x.json")).toThrow(/signIn/);
  });

  it("lets a settings-connection read use only the token and the client ID", () => {
    const d = clone(dhan);
    d.reads.holdings.headers["access-token"] = "{accountId}";
    expect(() => parseDefinition(d, "x.json")).toThrow(/unknown placeholder \{accountId\}/);
  });

  it("refuses a redirect definition with no credentials", () => {
    const d = clone();
    d.credentials = [];
    expect(() => parseDefinition(d, "x.json")).toThrow(/needs at least one credential/);
  });

  it("refuses a redirect definition without a credentialShown", () => {
    const d = clone();
    delete d.credentialShown;
    expect(() => parseDefinition(d, "x.json")).toThrow(/credentialShown/);
  });

  it("refuses a placeholder the call has no value for", () => {
    const d = clone();
    d.reads.holdings.headers.Authorization = "token {apiKey}:{password}";
    expect(() => parseDefinition(d, "x.json")).toThrow(/unknown placeholder \{password\}/);
  });

  it("refuses a URL on a host the definition does not name", () => {
    const d = clone();
    d.reads.holdings.url = "https://evil.example/holdings";
    expect(() => parseDefinition(d, "x.json")).toThrow(/evil.example is not one of the definition's hosts/);
  });

  it("refuses a URL that is not https", () => {
    const d = clone();
    d.signIn.session.url = "http://api.kite.trade/session/token";
    expect(() => parseDefinition(d, "x.json")).toThrow(/not https/);
  });

  it("refuses a login URL without the state", () => {
    const d = clone();
    d.signIn.loginUrl = "https://kite.zerodha.com/connect/login?v=3&api_key={apiKey}";
    expect(() => parseDefinition(d, "x.json")).toThrow(DefinitionError);
  });

  it("lets a folder replace a built-in definition by id", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "brokers-"));
    writeFileSync(path.join(dir, "kite.json"), JSON.stringify({ ...clone(), enabled: false, notOfferedReason: "Switched off here." }));
    const defs = loadDefinitions([dir], builtInDefinitions());
    expect(defs.get("kite")?.enabled).toBe(false);
  });
});

describe("BrokerClient for Kite", () => {
  it("builds the login URL with the key and the state sent back as redirect_params", () => {
    const url = new URL(new BrokerClient(kite).loginUrl(creds, "nonce-1"));
    expect(url.origin + url.pathname).toBe("https://kite.zerodha.com/connect/login");
    expect(url.searchParams.get("api_key")).toBe("kitekey123");
    expect(url.searchParams.get("redirect_params")).toBe("state=nonce-1");
  });

  it("reads the return", () => {
    const c = new BrokerClient(kite);
    expect(c.readReturn({ request_token: "rt", state: "s", status: "success" })).toEqual({ code: "rt", state: "s" });
    expect(c.readReturn({ state: "s", status: "cancelled" })).toEqual({ refused: true, state: "s" });
  });

  it("signs in with SHA-256(api_key + request_token + api_secret)", async () => {
    const fetch = vi.fn(async () => json(200, { status: "success", data: { access_token: "tok", user_id: "AB1234" } }));
    const s = await new BrokerClient(kite, { fetch }).signIn(creds, "rt", new Date("2026-10-19T03:30:00Z"));
    expect(s).toMatchObject({ accessToken: "tok", accountId: "AB1234" });
    expect(s.expiresAt.toISOString()).toBe("2026-10-20T00:30:00.000Z");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.kite.trade/session/token");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("checksum")).toBe(createHash("sha256").update("kitekey123rtkitesecret456").digest("hex"));
    expect(form.get("api_secret")).toBeNull();
  });

  it("reads holdings as decimal strings, as printed", async () => {
    const fetch = vi.fn(async () =>
      json(200, { status: "success", data: [{ tradingsymbol: "HDFCBANK", exchange: "NSE", isin: "INE040A01034", quantity: 120, t1_quantity: 0, average_price: 1512.4, last_price: 1742.6 }] }),
    );
    const lines = await new BrokerClient(kite, { fetch }).holdings(creds, { accessToken: "tok", accountId: "AB1234" });
    expect(lines).toEqual([{ isin: "INE040A01034", symbol: "HDFCBANK", exchange: "NSE", quantity: "120", t1Quantity: "0", averagePrice: "1512.4", lastPrice: "1742.6" }]);
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("token kitekey123:tok");
  });

  it("says the broker signed Maester out on a 403", async () => {
    const fetch = vi.fn(async () => json(403, { status: "error", error_type: "TokenException", message: "secret detail" }));
    const err = await new BrokerClient(kite, { fetch }).holdings(creds, { accessToken: "tok", accountId: null }).catch((e) => e);
    expect(err).toBeInstanceOf(BrokerError);
    expect(err.code).toBe("BROKER_SIGNED_OUT");
    expect(err.message).not.toContain("secret detail");
  });

  it("refuses an answer whose figure is not a decimal", async () => {
    const fetch = vi.fn(async () => json(200, { data: [{ tradingsymbol: "X", exchange: "NSE", isin: "INE1", quantity: "ten", average_price: 1 }] }));
    const err = await new BrokerClient(kite, { fetch }).holdings(creds, { accessToken: "tok", accountId: null }).catch((e) => e);
    expect(err.code).toBe("BROKER_ANSWER_UNREADABLE");
  });

  it("never says the key or token when the broker can't be reached", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED https://api.kite.trade/?api_key=kitekey123");
    });
    const err = await new BrokerClient(kite, { fetch }).holdings(creds, { accessToken: "tok", accountId: null }).catch((e) => e);
    expect(err.code).toBe("BROKER_UNAVAILABLE");
    expect(err.message).not.toContain("kitekey123");
  });
});

// Groww's calls, from its own docs (24 Oct 2026): groww.in/trade-api/docs/curl (the token call)
// and /curl/portfolio (holdings). The answers below follow the documented shapes.
describe("BrokerClient for Groww", () => {
  const groww = builtInDefinitions().get("groww")!;
  const gcreds = { apiKey: "growwkey123", apiSecret: "growwsecret456" };

  it("signs in from Maester with the key and SHA-256(secret + timestamp), as strings in JSON", async () => {
    const fetch = vi.fn(async () => json(200, { token: "tok", tokenRefId: "ref-1", sessionName: "s", expiry: "2026-10-25T06:00:00", isActive: true }));
    const now = new Date("2026-10-24T03:30:00Z");
    const s = await new BrokerClient(groww, { fetch }).startSession(gcreds, now);
    expect(s).toMatchObject({ accessToken: "tok", accountId: null });
    // Signed in 09:00 IST: it lasts until 06:00 IST the next morning.
    expect(s.expiresAt.toISOString()).toBe("2026-10-25T00:30:00.000Z");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groww.in/v1/token/api/access");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)).toMatchObject({ Authorization: "Bearer growwkey123", "Content-Type": "application/json" });
    const ts = String(Math.floor(now.getTime() / 1000));
    expect(JSON.parse(init.body as string)).toEqual({
      key_type: "approval",
      checksum: createHash("sha256").update(`growwsecret456${ts}`).digest("hex"),
      timestamp: ts,
    });
    expect(init.body as string).not.toContain("growwsecret456");
  });

  it("calls a 200 with no token a refusal: the key was not approved today", async () => {
    const fetch = vi.fn(async () => json(200, { isActive: false }));
    const err = await new BrokerClient(groww, { fetch }).startSession(gcreds, new Date()).catch((e) => e);
    expect(err.code).toBe("BROKER_REFUSED");
  });

  it("reads holdings from payload.holdings, on NSE since Groww names no exchange", async () => {
    const fetch = vi.fn(async () =>
      json(200, { status: "SUCCESS", payload: { holdings: [{ isin: "INE154A01025", trading_symbol: "ITC", quantity: 150, average_price: 438, t1_quantity: 0, pledge_quantity: 0 }] } }),
    );
    const lines = await new BrokerClient(groww, { fetch }).holdings(gcreds, { accessToken: "tok", accountId: null });
    expect(lines).toEqual([{ isin: "INE154A01025", symbol: "ITC", exchange: "NSE", quantity: "150", t1Quantity: "0", averagePrice: "438", lastPrice: null }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groww.in/v1/holdings/user");
    expect((init.headers as Record<string, string>)).toMatchObject({ Authorization: "Bearer tok", "X-API-VERSION": "1.0" });
  });
});

// ICICI Direct's Breeze calls, from its own docs (api.icicidirect.com/breezeapi/documents, 24 Oct
// 2026) and its official Python SDK: GET with a JSON body, every call signed with
// SHA-256(timestamp + body + secret), demat holdings joined to portfolio holdings on stock_code.
describe("BrokerClient for ICICI Direct", () => {
  const icici = builtInDefinitions().get("icici")!;
  const icreds = { apiKey: "iciciappkey", apiSecret: "icicisecret789" };
  const now = () => new Date("2026-10-24T10:23:56.789Z");
  type Sent = { url: string; headers: Record<string, string>; body: string };

  it("ships switched off, saying why", () => {
    expect(icici.enabled).toBe(false);
    expect(icici.notOfferedReason).toMatch(/nothing back that Maester can check/);
  });

  it("joins demat holdings to portfolio holdings on stock code, signing each call", async () => {
    const sent: Sent[] = [];
    const getWithBody = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      sent.push({ url, headers: init.headers, body: init.body });
      if (url.endsWith("/dematholdings")) {
        return json(200, { Success: [
          { stock_code: "HDFBAN", stock_ISIN: "INE040A01034", quantity: "40", demat_total_bulk_quantity: "40", demat_avail_quantity: "40", blocked_quantity: "0", demat_allocated_quantity: "0" },
          { stock_code: "LARTOU", stock_ISIN: "INE018A01030", quantity: "10", demat_total_bulk_quantity: "10", demat_avail_quantity: "10", blocked_quantity: "0", demat_allocated_quantity: "0" },
        ], Status: 200, Error: null });
      }
      return json(200, { Success: [{ stock_code: "HDFBAN", exchange_code: "NSE", quantity: "40", average_price: "1450.00", current_market_price: "1742.60" }], Status: 200, Error: null });
    });
    const fetch = vi.fn();
    const lines = await new BrokerClient(icici, { fetch, getWithBody, now }).holdings(icreds, { accessToken: "c2Vzc2lvbg==", accountId: "U1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual([
      { isin: "INE040A01034", symbol: "HDFBAN", exchange: "ICICI", quantity: "40", t1Quantity: "0", averagePrice: "1450.00", lastPrice: "1742.60" },
      // No portfolio line for it: the cost is not known, said as 0, which the engine reads as unknown.
      { isin: "INE018A01030", symbol: "LARTOU", exchange: "ICICI", quantity: "10", t1Quantity: "0", averagePrice: "0", lastPrice: null },
    ]);
    expect(sent.map((s) => s.url)).toEqual([
      "https://api.icicidirect.com/breezeapi/api/v1/dematholdings",
      "https://api.icicidirect.com/breezeapi/api/v1/portfolioholdings",
    ]);
    const ts = "2026-10-24T10:23:56.000Z";
    for (const s of sent) {
      expect(s.headers).toMatchObject({ "X-Timestamp": ts, "X-AppKey": "iciciappkey", "X-SessionToken": "c2Vzc2lvbg==", "Content-Type": "application/json" });
      expect(s.headers["X-Checksum"]).toBe(`token ${createHash("sha256").update(ts + s.body + "icicisecret789").digest("hex")}`);
      expect(JSON.stringify(s)).not.toContain("icicisecret789");
    }
    expect(sent[0]!.body).toBe("{}");
    expect(JSON.parse(sent[1]!.body)).toEqual({ exchange_code: "NSE", from_date: "", to_date: "", stock_code: "", portfolio_type: "" });
  });

  it("refuses a body that holds the body's own signature", () => {
    const d = clone(icici);
    d.reads.holdings.json = { sig: "{checksum}" };
    expect(() => parseDefinition(d, "x.json")).toThrow(/unknown placeholder \{checksum\}/);
  });

  it("refuses holdings with no average price anywhere", () => {
    const d = clone(icici);
    delete d.reads.holdings.join.fields.averagePrice;
    expect(() => parseDefinition(d, "x.json")).toThrow(/average price/);
  });
});

// Upstox's calls, from its own docs (24 Oct 2026): upstox.com/developer/api-documentation/authentication,
// /get-token and /get-holdings. The answers below follow the documented shapes.
describe("BrokerClient for Upstox", () => {
  const upstox = builtInDefinitions().get("upstox")!;
  const ucreds = { apiKey: "upkey123", apiSecret: "upsecret456" };
  const back = "https://maester.example/v1/brokers/upstox/return";

  it("builds the login URL with the key, Maester's redirect URL and the state", () => {
    const url = new URL(new BrokerClient(upstox).loginUrl(ucreds, "nonce-1", back));
    expect(url.origin + url.pathname).toBe("https://api.upstox.com/v2/login/authorization/dialog");
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: "code", client_id: "upkey123", redirect_uri: back, state: "nonce-1" });
  });

  it("reads the return: the code and the state, unchanged", () => {
    expect(new BrokerClient(upstox).readReturn({ code: "c1", state: "nonce-1" })).toEqual({ code: "c1", state: "nonce-1" });
    expect(new BrokerClient(upstox).readReturn({ state: "nonce-1" })).toEqual({ refused: true, state: "nonce-1" });
  });

  it("exchanges the code with the secret and the same redirect URL; the token lasts until 03:30", async () => {
    const fetch = vi.fn(async () => json(200, { email: "x@example.com", user_id: "7ABC12", access_token: "tok", extended_token: "ext" }));
    const s = await new BrokerClient(upstox, { fetch }).signIn(ucreds, "c1", new Date("2026-10-24T14:30:00Z"), back);
    expect(s).toMatchObject({ accessToken: "tok", accountId: "7ABC12" });
    // Signed in 20:00 IST on 24 Oct: it lasts until 03:30 IST on 25 Oct = 22:00 UTC on 24 Oct.
    expect(s.expiresAt.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.upstox.com/v2/login/authorization/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      code: "c1", client_id: "upkey123", client_secret: "upsecret456", redirect_uri: back, grant_type: "authorization_code",
    });
  });

  it("reads long-term holdings with the bearer token", async () => {
    const fetch = vi.fn(async () =>
      json(200, { status: "success", data: [{ isin: "INE528G01035", trading_symbol: "YESBANK", tradingsymbol: "YESBANK", exchange: "NSE", quantity: 36, t1_quantity: 0, average_price: 18.75, last_price: 17.05 }] }),
    );
    const lines = await new BrokerClient(upstox, { fetch }).holdings(ucreds, { accessToken: "tok", accountId: "7ABC12" });
    expect(lines).toEqual([{ isin: "INE528G01035", symbol: "YESBANK", exchange: "NSE", quantity: "36", t1Quantity: "0", averagePrice: "18.75", lastPrice: "17.05" }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.upstox.com/v2/portfolio/long-term-holdings");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refuses a definition that names no exchange for holdings", () => {
    const d = clone(upstox);
    delete d.reads.holdings.fields.exchange;
    expect(() => parseDefinition(d, "x.json")).toThrow(/exchangeIs/);
  });

  it("says Upstox signed Maester out on a 401", async () => {
    const fetch = vi.fn(async () => json(401, { status: "error", errors: [{ message: "Invalid token" }] }));
    const err = await new BrokerClient(upstox, { fetch }).holdings(ucreds, { accessToken: "tok", accountId: null }).catch((e) => e);
    expect(err.code).toBe("BROKER_SIGNED_OUT");
  });
});

describe("BrokerClient for Dhan", () => {
  const session = { accessToken: "dhan-token", clientId: "1100012345" };

  it("reads holdings from the top-level array with the Settings token and client ID", async () => {
    const fetch = vi.fn(async () =>
      json(200, [{ exchange: "ALL", tradingSymbol: "HDFCBANK", securityId: "1333", isin: "INE040A01034", totalQty: 30, dpQty: 30, t1Qty: 0, availableQty: 30, collateralQty: 0, avgCostPrice: 1498.25 }]),
    );
    const lines = await new BrokerClient(dhan, { fetch }).holdings({}, session);
    expect(lines).toEqual([{ isin: "INE040A01034", symbol: "HDFCBANK", exchange: "ALL", quantity: "30", t1Quantity: "0", averagePrice: "1498.25", lastPrice: null }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.dhan.co/v2/holdings");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ "access-token": "dhan-token", "client-id": "1100012345" });
  });

  it("takes totalQty as the quantity and adds no T+1 on top", async () => {
    // totalQty is dpQty + t1Qty (25 settled + 5 pending = 30). holding_quantity adds t1Quantity to
    // quantity, so mapping t1Qty as well would count the 5 twice (35).
    const fetch = vi.fn(async () => json(200, [{ exchange: "NSE", tradingSymbol: "TCS", isin: "INE467B01029", totalQty: 30, dpQty: 25, t1Qty: 5, avgCostPrice: 3510 }]));
    const [line] = await new BrokerClient(dhan, { fetch }).holdings({}, session);
    expect(line).toMatchObject({ quantity: "30", t1Quantity: "0" });
  });

  it("says Dhan signed Maester out on a 401", async () => {
    const fetch = vi.fn(async () => json(401, { errorType: "Invalid_Authentication", errorCode: "DH-901", errorMessage: "secret detail" }));
    const err = await new BrokerClient(dhan, { fetch }).holdings({}, session).catch((e) => e);
    expect(err.code).toBe("BROKER_SIGNED_OUT");
    expect(err.message).not.toContain("secret detail");
  });

  it("has no login page or sign-in", () => {
    const c = new BrokerClient(dhan);
    expect(() => c.loginUrl({}, "s")).toThrow(/Settings connection/);
    expect(() => c.readReturn({})).toThrow(/Settings connection/);
  });
});
