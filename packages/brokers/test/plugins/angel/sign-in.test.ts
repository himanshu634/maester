import { describe, expect, it, vi } from "vitest";
import { BrokerError } from "../../../src/errors.js";
import { completeSignIn, loginUrlFor } from "../../../src/host.js";
import { PROFILE_URL, angel, angelHeaders } from "../../../src/plugins/angel/plugin.js";
import errorOther from "./fixtures/error-other.json";
import errorToken from "./fixtures/error-token.json";
import profile from "./fixtures/profile.json";

const creds = { apiKey: "angelkey1" };
const RETURN_URL = "https://m.test/r";
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
const signIn = (fetch: typeof globalThis.fetch, now = NOW) => completeSignIn(angel, { creds, payload: { authToken: "jwt-abc" }, returnUrl: RETURN_URL, now, fetch });

describe("the Angel One sign-in", () => {
  describe("login", () => {
    it("builds the publisher-login URL", () => {
      expect(loginUrlFor(angel, { creds, state: "nonce-1", returnUrl: RETURN_URL })).toBe("https://smartapi.angelone.in/publisher-login?api_key=angelkey1&state=nonce-1");
    });

    it("encodes the key and the state", () => {
      const url = loginUrlFor(angel, { creds: { apiKey: "ab+c&d" }, state: "n/1=", returnUrl: RETURN_URL });
      expect(url).toBe("https://smartapi.angelone.in/publisher-login?api_key=ab%2Bc%26d&state=n%2F1%3D");
      expect(new URL(url).searchParams.get("api_key")).toBe("ab+c&d");
      expect(new URL(url).searchParams.get("state")).toBe("n/1=");
    });

    it("says the key is missing, without a value, when the host has none", () => {
      expect(() => loginUrlFor(angel, { creds: {}, state: "s", returnUrl: RETURN_URL })).toThrow(expect.objectContaining({ code: "BROKER_UNAVAILABLE", message: "the saved apiKey is missing" }));
    });
  });

  describe("the return", () => {
    it("reads a return with state", () => {
      const got = angel.signIn.readReturn({ auth_token: "jwt-abc", feed_token: "feed-1", state: "nonce-1" });
      expect(got).toEqual({ state: "nonce-1", payload: { authToken: "jwt-abc" } });
      // Maester streams nothing, so the feed token is not kept.
      expect(JSON.stringify(got)).not.toContain("feed-1");
    });

    it("reads a return without state as state null", () => {
      const withState = { auth_token: "jwt-abc" };
      for (const query of [withState, { ...withState, state: "" }, { ...withState, state: "  " }]) {
        expect(angel.signIn.readReturn(query), JSON.stringify(query)).toEqual({ state: null, payload: { authToken: "jwt-abc" } });
      }
    });

    it("trims the state and the token", () => {
      expect(angel.signIn.readReturn({ auth_token: " jwt-abc ", state: " nonce-1 " })).toEqual({ state: "nonce-1", payload: { authToken: "jwt-abc" } });
    });

    it("refuses a return without auth_token, and keeps the state it was given", () => {
      for (const query of [{ state: "nonce-1" }, { auth_token: "", state: "nonce-1" }, { auth_token: "  ", state: "nonce-1" }]) {
        expect(angel.signIn.readReturn(query), JSON.stringify(query)).toEqual({ state: "nonce-1", refused: true });
      }
      expect(angel.signIn.readReturn({})).toEqual({ state: null, refused: true });
    });
  });

  describe("complete", () => {
    it("checks the token with one getProfile call", async () => {
      const { fetch, calls } = angelFetch({ [PROFILE_URL]: { body: profile } });
      const got = await signIn(fetch);
      expect(got).toEqual({ accessToken: "jwt-abc", accountId: "A1234567", signedInAt: NOW, expiresAt: new Date("2026-10-27T18:30:00.000Z") });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(PROFILE_URL);
      expect(calls[0]?.headers).toEqual(angelHeaders("angelkey1", "jwt-abc"));
      for (const name of ["X-ClientLocalIP", "X-ClientPublicIP", "X-MACAddress"]) expect(Object.keys(calls[0]?.headers ?? {})).not.toContain(name);
    });

    it("sends the headers Angel One asks for, with the key and the token unencoded", () => {
      expect(angelHeaders("ab+c&d", "jwt.a+b")).toEqual({
        Authorization: "Bearer jwt.a+b",
        "X-PrivateKey": "ab+c&d",
        "X-UserType": "USER",
        "X-SourceID": "WEB",
        Accept: "application/json",
        "Content-Type": "application/json",
      });
    });

    it("expires at the next midnight after a sign-in just past midnight", async () => {
      const { fetch } = angelFetch({ [PROFILE_URL]: { body: profile } });
      // 00:10 in Kolkata on the 28th: that day's midnight has passed, so the next one is the 29th at 00:00.
      const got = await signIn(fetch, new Date("2026-10-27T18:40:00Z"));
      expect(got.expiresAt.toISOString()).toBe("2026-10-28T18:30:00.000Z");
    });

    it("refuses a token Angel One refuses", async () => {
      const refused = await rejection(signIn(angelFetch({ [PROFILE_URL]: { body: errorToken } }).fetch));
      expect(refused).toBeInstanceOf(BrokerError);
      expect(refused).toMatchObject({ code: "BROKER_REFUSED", message: "sign-in: Angel One answered AG8001" });
      expect(await rejection(signIn(angelFetch({ [PROFILE_URL]: { body: errorOther } }).fetch))).toMatchObject({ code: "BROKER_UNAVAILABLE" });
      expect(await rejection(signIn(angelFetch({ [PROFILE_URL]: { body: { status: true, data: {} } } }).fetch))).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
    });

    it("refuses a profile with no usable client code", async () => {
      for (const data of [null, "", { clientcode: "" }, { clientcode: "  " }, { clientcode: 1234567 }]) {
        const err = await rejection(signIn(angelFetch({ [PROFILE_URL]: { body: { status: true, data } } }).fetch));
        expect(err, JSON.stringify(data)).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });
      }
    });

    it("says the token is refused on a 401 or a 403, without the broker's words", async () => {
      for (const status of [401, 403]) {
        const err = await rejection(signIn(angelFetch({ [PROFILE_URL]: { status, body: errorToken } }).fetch));
        expect(err).toMatchObject({ code: "BROKER_REFUSED" });
        expect((err as BrokerError).message).not.toContain("Invalid Token");
      }
    });

    it("never says the key or the token when Angel One can't be reached", async () => {
      const fetch = vi.fn(async () => {
        throw new Error("connect ECONNREFUSED https://apiconnect.angelone.in/ jwt-abc angelkey1");
      });
      const err = await rejection(signIn(fetch as unknown as typeof globalThis.fetch));
      expect(err).toMatchObject({ code: "BROKER_UNAVAILABLE", message: "sign-in: Angel One could not be reached" });
    });
  });
});
