import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrokerClient, BrokerError, builtInDefinitions, DefinitionError, loadDefinitions, parseDefinition, sessionExpiry } from "../src/index.js";

const kite = builtInDefinitions().get("kite")!;
const creds = { apiKey: "kitekey123", apiSecret: "kitesecret456" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const clone = () => JSON.parse(JSON.stringify(kite)) as Record<string, any>;

describe("definitions", () => {
  it("ships Kite, enabled", () => {
    expect([...builtInDefinitions().keys()]).toEqual(["kite"]);
    expect(kite.enabled).toBe(true);
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

describe("sessionExpiry", () => {
  const rule = { kind: "daily", at: "06:00", timeZone: "Asia/Kolkata" } as const;
  it("is 06:00 IST the next morning for a sign-in after 06:00", () => {
    // 09:00 IST on 19 Oct is 03:30 UTC; 06:00 IST on 20 Oct is 00:30 UTC.
    expect(sessionExpiry(rule, new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-20T00:30:00.000Z");
  });
  it("is 06:00 IST the same morning for a sign-in before 06:00", () => {
    // 05:00 IST on 19 Oct is 23:30 UTC on 18 Oct.
    expect(sessionExpiry(rule, new Date("2026-10-18T23:30:00Z")).toISOString()).toBe("2026-10-19T00:30:00.000Z");
  });
  it("counts hours from the sign-in", () => {
    expect(sessionExpiry({ kind: "hours", hours: 24 }, new Date("2026-10-19T03:30:00Z")).toISOString()).toBe("2026-10-20T03:30:00.000Z");
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
