import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerError } from "../src/errors.js";
import { completeSignIn, loginUrlFor, readHoldings, toBrokerError } from "../src/host.js";
import type { BrokerPlugin } from "../src/plugin.js";
import { fakePlugin } from "./fake-plugin.js";

const NOW = new Date("2026-10-27T05:00:00Z");
const creds = { apiKey: "KEY123" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rejection = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
const line = { isin: "INE002A01018", symbol: "RELIANCE", exchange: "NSE", quantity: "10", t1Quantity: "0", averagePrice: "2400.5", lastPrice: "2500" };
/** The fake plugin, with a holdings read of the test's own. */
const reading = (holdings: BrokerPlugin["reads"]["holdings"]): BrokerPlugin => {
  const plugin = fakePlugin();
  return { ...plugin, reads: { holdings } };
};
const session = { accessToken: "TOKEN456", accountId: "AB1234" };
const NOW_SESSION = { ...session, signedInAt: NOW, expiresAt: NOW };

afterEach(() => vi.unstubAllGlobals());

describe("loginUrlFor", () => {
  it("returns the plugin's address as it is, once it is https on a manifest host", () => {
    expect(loginUrlFor(fakePlugin(), { creds, state: "nonce1", returnUrl: "https://app.test/return" })).toBe("https://broker.test/login?key=KEY123&state=nonce1");
  });

  it("refuses a plugin URL on another host, over http, on another port, with a user name or password, or that is not a URL, without naming it", () => {
    for (const url of [
      "https://evil.test/login?key=KEY123", "http://broker.test/login?key=KEY123", "https://broker.test.evil.test/login?key=KEY123", "not a url?key=KEY123",
      "https://broker.test:8443/login?key=KEY123", "https://user:pw@broker.test/login?key=KEY123", "https://KEY123@broker.test/login",
    ]) {
      const plugin = fakePlugin();
      const bad = { ...plugin, signIn: { ...plugin.signIn, loginUrl: () => url } };
      const err = (() => {
        try {
          return loginUrlFor(bad, { creds, state: "s", returnUrl: "" });
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(BrokerError);
      expect((err as BrokerError).code).toBe("BROKER_UNAVAILABLE");
      expect((err as BrokerError).message).toBe("sign-in: Fake broker gave a login address it does not use");
      expect((err as BrokerError).message).not.toContain("KEY123");
    }
  });

  it("turns a throw from the plugin into a BrokerError that says nothing of it", () => {
    const plugin = fakePlugin();
    const throws = {
      ...plugin,
      signIn: {
        ...plugin.signIn,
        loginUrl: () => {
          throw new Error("could not build https://broker.test/login?key=SECRET-xyz");
        },
      },
    };
    expect(() => loginUrlFor(throws, { creds, state: "s", returnUrl: "" })).toThrow(expect.objectContaining({ code: "BROKER_UNAVAILABLE", message: "the broker call failed" }));
  });
});

describe("toBrokerError", () => {
  it("passes a BrokerError through and turns anything else into BROKER_UNAVAILABLE", () => {
    const own = new BrokerError("BROKER_SIGNED_OUT", "read: Fake broker answered 403");
    expect(toBrokerError(own)).toBe(own);
    for (const thrown of [new Error("SECRET-xyz"), new TypeError("SECRET-xyz"), "SECRET-xyz", { message: "SECRET-xyz" }, null, undefined]) {
      const err = toBrokerError(thrown);
      expect(err).toBeInstanceOf(BrokerError);
      expect(err.code).toBe("BROKER_UNAVAILABLE");
      expect(err.message).toBe("the broker call failed");
      expect(err.cause).toBeUndefined();
    }
  });
});

describe("completeSignIn", () => {
  it("signs in through ctx.http, in the sign-in phase, and gives the session", async () => {
    const fetch = vi.fn(async () => json(200, { data: { id: "AB1234" } }));
    const got = await completeSignIn(fakePlugin(), { creds, payload: { token: "TOKEN456" }, returnUrl: "https://app.test/return", now: NOW, fetch });
    expect(got).toEqual({ accessToken: "TOKEN456", accountId: "AB1234", signedInAt: NOW, expiresAt: new Date("2026-10-27T18:30:00Z") });
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://broker.test/profile");
    expect(init).toMatchObject({ method: "GET", redirect: "error", headers: { Authorization: "Bearer TOKEN456" } });
  });

  it("refuses an empty access token", async () => {
    const fetch = vi.fn(async () => json(200, { data: { id: "AB1234" } }));
    const err = await rejection(completeSignIn(fakePlugin(), { creds, payload: { token: "" }, returnUrl: "", now: NOW, fetch }));
    expect(err).toBeInstanceOf(BrokerError);
    expect((err as BrokerError).code).toBe("BROKER_ANSWER_UNREADABLE");

    // A session that has no token at all, or one that is not a session, is the same.
    const plugin = fakePlugin();
    for (const junk of [{ ...NOW_SESSION, accessToken: "   " }, { ...NOW_SESSION, accessToken: undefined }, null, undefined]) {
      const odd = { ...plugin, signIn: { ...plugin.signIn, complete: async () => junk as never } };
      expect(await rejection(completeSignIn(odd, { creds, payload: {}, returnUrl: "", now: NOW, fetch }))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
  });

  it("refuses a session whose account, times or expiry are not a session's", async () => {
    const fetch = vi.fn(async () => json(200, { data: { id: "AB1234" } }));
    const plugin = fakePlugin();
    const LATER = new Date(NOW.getTime() + 3_600_000);
    const odd = (session: unknown): BrokerPlugin => ({ ...plugin, signIn: { ...plugin.signIn, complete: async () => session as never } });
    const cases: [string, unknown][] = [
      ["an Invalid Date expiry", { ...NOW_SESSION, expiresAt: new Date("not a date") }],
      ["an Invalid Date sign-in", { ...NOW_SESSION, signedInAt: new Date(Number.NaN), expiresAt: LATER }],
      ["an expiry that is a string", { ...NOW_SESSION, expiresAt: LATER.toISOString() }],
      ["no expiry", { accessToken: "TOKEN456", accountId: "AB1234", signedInAt: NOW }],
      ["a numeric account", { ...NOW_SESSION, accountId: 1234, expiresAt: LATER }],
      ["an account left out", { accessToken: "TOKEN456", signedInAt: NOW, expiresAt: LATER }],
      ["an expiry before the sign-in", { ...NOW_SESSION, expiresAt: new Date(NOW.getTime() - 1) }],
      ["an expiry at the sign-in", { ...NOW_SESSION, expiresAt: new Date(NOW.getTime()) }],
      ["a string", "TOKEN456"],
    ];
    for (const [what, session] of cases) {
      const err = await rejection(completeSignIn(odd(session), { creds, payload: {}, returnUrl: "", now: NOW, fetch }));
      expect(err, what).toBeInstanceOf(BrokerError);
      expect(err, what).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      expect((err as BrokerError).message, what).not.toContain("TOKEN456");
    }
  });

  it("gives a new session of the four fields, with nothing else the plugin returned", async () => {
    const plugin = fakePlugin();
    const LATER = new Date(NOW.getTime() + 3_600_000);
    const theirs = { accessToken: "TOKEN456", accountId: null, signedInAt: NOW, expiresAt: LATER, apiSecret: "SECRET-xyz" };
    const extra = { ...plugin, signIn: { ...plugin.signIn, complete: async () => theirs as never } };
    const got = await completeSignIn(extra, { creds, payload: {}, returnUrl: "", now: NOW });
    expect(got).toEqual({ accessToken: "TOKEN456", accountId: null, signedInAt: NOW, expiresAt: LATER });
    expect(Object.keys(got).sort()).toEqual(["accessToken", "accountId", "expiresAt", "signedInAt"]);
    expect(got).not.toBe(theirs);
    // The times are copies too: a plugin that changes its Date afterwards changes nothing the host keeps.
    expect(got.expiresAt).not.toBe(LATER);
    expect(got.signedInAt).not.toBe(NOW);
  });

  it("keeps what the broker said out of the error, and keeps the code of one the kit threw", async () => {
    const refused = await rejection(completeSignIn(fakePlugin(), { creds, payload: { token: "TOKEN456" }, returnUrl: "", now: NOW, fetch: vi.fn(async () => json(403, { message: "key SECRET-xyz is bad" })) }));
    expect(refused).toMatchObject({ code: "BROKER_REFUSED" });
    expect((refused as BrokerError).message).not.toContain("SECRET-xyz");

    const plugin = fakePlugin();
    const throws = {
      ...plugin,
      signIn: {
        ...plugin.signIn,
        complete: async () => {
          throw new Error("exchange failed for TOKEN456 at https://broker.test/profile");
        },
      },
    };
    const plain = await rejection(completeSignIn(throws, { creds, payload: {}, returnUrl: "", now: NOW }));
    expect(plain).toMatchObject({ code: "BROKER_UNAVAILABLE", message: "the broker call failed" });
  });
});

describe("readHoldings", () => {
  it("reads through ctx.http, in the read phase, and gives the parsed lines", async () => {
    const fetch = vi.fn(async () => json(200, { data: [{ ...line, lastPrice: null }, { ...line, isin: "INE009A01021", symbol: "INFY", quantity: 5 }] }));
    const lines = await readHoldings(fakePlugin(), { creds, session, now: NOW, fetch });
    expect(lines).toEqual([
      { ...line, lastPrice: null },
      { ...line, isin: "INE009A01021", symbol: "INFY", quantity: "5" },
    ]);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://broker.test/holdings");
    expect(init).toMatchObject({ method: "GET", headers: { Authorization: "Bearer TOKEN456" } });

    // A 403 on a read is the broker signing Maester out.
    const out = await rejection(readHoldings(fakePlugin(), { creds, session, now: NOW, fetch: vi.fn(async () => json(403, {})) }));
    expect(out).toMatchObject({ code: "BROKER_SIGNED_OUT" });
  });

  it("returns only the parsed fields of a line, so a plugin cannot add to what is stored", async () => {
    const lines = await readHoldings(reading(async () => [{ ...line, token: "TOKEN456" } as never]), { creds, session, now: NOW });
    expect(lines).toEqual([line]);
    expect(Object.keys(lines[0]!).sort()).toEqual(["averagePrice", "exchange", "isin", "lastPrice", "quantity", "symbol", "t1Quantity"]);
  });

  it('turns a plain Error carrying "SECRET-xyz" into BROKER_UNAVAILABLE without the text', async () => {
    const throws = reading(async () => {
      throw new Error("SECRET-xyz");
    });
    const err = await rejection(readHoldings(throws, { creds, session, now: NOW }));
    expect(err).toBeInstanceOf(BrokerError);
    expect((err as BrokerError).code).toBe("BROKER_UNAVAILABLE");
    expect((err as BrokerError).message).toBe("the broker call failed");
    expect(String(err)).not.toContain("SECRET-xyz");
    expect((err as BrokerError).stack).not.toContain("SECRET-xyz");
    expect((err as BrokerError).cause).toBeUndefined();

    // A throw before the first await, and one that is not an Error at all, leave the same way.
    const sync = { ...fakePlugin(), reads: { holdings: () => { throw new Error("SECRET-xyz"); } } } as BrokerPlugin;
    expect(await rejection(readHoldings(sync, { creds, session, now: NOW }))).toMatchObject({ code: "BROKER_UNAVAILABLE", message: "the broker call failed" });
    expect(await rejection(readHoldings(reading(() => Promise.reject("SECRET-xyz")), { creds, session, now: NOW }))).toMatchObject({ message: "the broker call failed" });
  });

  it("refuses a line with quantity 1e3", async () => {
    for (const quantity of ["1e3", "1E3", "NaN", "Infinity", "", "1,000", " 10"]) {
      const err = await rejection(readHoldings(reading(async () => [{ ...line, quantity }]), { creds, session, now: NOW }));
      expect(err, quantity).toBeInstanceOf(BrokerError);
      expect(err, quantity).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    }
    // A figure that is a JSON number, not a decimal string, is refused as well.
    expect(await rejection(readHoldings(reading(async () => [{ ...line, quantity: 1000 } as never]), { creds, session, now: NOW }))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    expect(await rejection(readHoldings(reading(async () => [{ ...line, lastPrice: undefined } as never]), { creds, session, now: NOW }))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
  });

  it("refuses the same isin and exchange twice", async () => {
    const twice = reading(async () => [line, { ...line, quantity: "3" }]);
    const err = await rejection(readHoldings(twice, { creds, session, now: NOW }));
    expect(err).toBeInstanceOf(BrokerError);
    expect((err as BrokerError).code).toBe("BROKER_ANSWER_UNREADABLE");
    expect((err as BrokerError).message).not.toContain(line.isin);

    // The same isin on another exchange is two holdings.
    const two = await readHoldings(reading(async () => [line, { ...line, exchange: "BSE" }]), { creds, session, now: NOW });
    expect(two.map((l) => l.exchange)).toEqual(["NSE", "BSE"]);
  });

  it("refuses an answer that is not a list", async () => {
    const err = await rejection(readHoldings(reading(async () => ({ holdings: [line] }) as never), { creds, session, now: NOW }));
    expect(err).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    expect(await readHoldings(reading(async () => []), { creds, session, now: NOW })).toEqual([]);
  });
});

describe("a plugin's calls", () => {
  it("only reach fetch through ctx.http", async () => {
    const global = vi.fn(async () => json(200, {}));
    vi.stubGlobal("fetch", global);
    const urls: string[] = [];
    const fetch = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return String(url).endsWith("/profile") ? json(200, { data: { id: "AB1234" } }) : json(200, { data: [line] });
    });
    const plugin = fakePlugin();

    await completeSignIn(plugin, { creds, payload: { token: "TOKEN456" }, returnUrl: "", now: NOW, fetch });
    await readHoldings(plugin, { creds, session, now: NOW, fetch });

    expect(urls).toEqual(["https://broker.test/profile", "https://broker.test/holdings"]);
    expect(urls.every((u) => new URL(u).protocol === "https:" && new URL(u).hostname === "broker.test")).toBe(true);
    expect(global).not.toHaveBeenCalled();
  });

  it("are refused before fetch when they go to another host", async () => {
    const fetch = vi.fn(async () => json(200, { data: [] }));
    const plugin = fakePlugin({ hosts: ["elsewhere.test"] });
    const err = await rejection(readHoldings(plugin, { creds, session, now: NOW, fetch }));
    expect(err).toMatchObject({ code: "BROKER_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
