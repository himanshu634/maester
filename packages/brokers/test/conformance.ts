import { BrokerManifest } from "@maester/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrokerError } from "../src/errors.js";
import { completeSignIn, loginUrlFor, readHoldings } from "../src/host.js";
import type { BrokerHoldingLine, BrokerPlugin, BrokerSession, Credentials } from "../src/plugin.js";
import { createRegistry } from "../src/registry.js";

/** One recorded answer: the status and the JSON body a broker sent. */
export type Answer = { status: number; body: unknown };

/**
 * What a plugin's test hands the suite, all of it recorded or made up for the test.
 * - `creds`: the fields the manifest asks for, with fake values.
 * - `goodReturn`: the query the broker sends the investor back with after a good sign-in, `state` included.
 * - `refusedReturn`: the query when the investor turned the sign-in down.
 * - `answers`: every broker call a good sign-in and a good read make, by its full URL.
 * - `expectedLines`: the holdings the answers print, as decimal strings exactly as printed.
 * - `signInAt` and `expectedExpiry`: a fixed sign-in time and the ISO time the session must stop at.
 */
export type ConformanceFixtures = {
  creds: Credentials;
  goodReturn: Record<string, string>;
  refusedReturn: Record<string, string>;
  answers: Record<string, Answer>;
  expectedLines: BrokerHoldingLine[];
  signInAt: Date;
  expectedExpiry: string;
};

const NONCE = "nonce-Zk3_9";
const RETURN_URL = "https://app.test/v1/brokers/return";
/** What the suite makes a broker say in its error answers. It must never reach an error message. */
const BROKER_TEXT = "CONFORMANCE-BROKER-TEXT";

const reply = (a: Answer) => new Response(JSON.stringify(a.body), { status: a.status, headers: { "Content-Type": "application/json" } });
const rejection = async (run: () => Promise<unknown>): Promise<unknown> => run().then(() => null, (e: unknown) => e);

/** A `fetch` that answers from a table and records every URL it is asked for, whatever the answer. */
function broker(answers: Record<string, Answer>) {
  const table = new Map(Object.entries(answers).map(([url, answer]) => [new URL(url).toString(), answer]));
  const urls: string[] = [];
  const unexpected: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const asked = String(url);
    urls.push(asked);
    const answer = table.get(asked);
    if (!answer) {
      unexpected.push(asked);
      throw new Error("the plugin called a URL that no fixture answers");
    }
    return reply(answer);
  });
  return { fetch, urls, unexpected };
}

/** A broker that cannot be reached, and whose network error carries the key, as a real one can. */
function unreachable(secrets: string[]) {
  return vi.fn(async (url: string | URL | Request) => {
    throw new Error(`connect ECONNREFUSED ${String(url)} ${secrets.join(" ")}`);
  });
}

/** Whether `value` is in `message`. A short value counts only as a whole word, so a token "tok" is not found inside "token". */
function leaks(message: string, value: string): boolean {
  if (value.length >= 8) return message.includes(value);
  return new RegExp(`(?<![A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(message);
}

/**
 * The checks every broker plugin must pass (spec §14.1). They drive the plugin through the host
 * functions the API calls, with a fake `fetch`, so what is tested is what runs. A plugin's own test
 * file calls this with its recorded answers, and adds its own cases for what is particular to it.
 */
export function runConformance(plugin: BrokerPlugin, f: ConformanceFixtures): void {
  describe(`${plugin.manifest.id} conformance`, () => {
    const globalFetch = vi.fn(async () => {
      throw new Error("the global fetch was used");
    });
    beforeEach(() => {
      vi.stubGlobal("fetch", globalFetch);
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      globalFetch.mockClear();
    });

    /** The plugin as the API holds it: the registry's copy, with the manifest's defaults filled in. */
    const registered = (): BrokerPlugin => createRegistry([plugin]).get(plugin.manifest.id)!;
    const all = (answer: Answer): Record<string, Answer> => Object.fromEntries(Object.keys(f.answers).map((url) => [url, answer]));
    const secrets = (): string[] => Object.values(f.creds);

    /** A good return, a good sign-in and the session it gives, through the host. */
    async function goodSession(p: BrokerPlugin, answers: Record<string, Answer> = f.answers): Promise<{ session: BrokerSession; urls: string[]; unexpected: string[] }> {
      const read = p.signIn.readReturn(f.goodReturn);
      if ("refused" in read) throw new Error("the good return was read as refused");
      const { fetch, urls, unexpected } = broker(answers);
      const session = await completeSignIn(p, { creds: f.creds, payload: read.payload, returnUrl: RETURN_URL, now: f.signInAt, fetch });
      return { session, urls, unexpected };
    }
    const reading = (p: BrokerPlugin, session: BrokerSession, fetch: typeof globalThis.fetch) =>
      readHoldings(p, { creds: f.creds, session: { accessToken: session.accessToken, accountId: session.accountId }, now: f.signInAt, fetch });

    it("is accepted by the registry, with a manifest that parses", () => {
      expect(BrokerManifest.safeParse(plugin.manifest).success).toBe(true);
      expect(createRegistry([plugin]).has(plugin.manifest.id)).toBe(true);
    });

    it("builds a login URL that is https on a manifest host, carries the nonce and holds no secret", () => {
      const p = registered();
      const url = loginUrlFor(p, { creds: f.creds, state: NONCE, returnUrl: RETURN_URL });
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(p.manifest.hosts).toContain(parsed.hostname);
      // The nonce can sit in a parameter of its own or inside another (Kite's redirect_params), encoded or not.
      expect([...parsed.searchParams.values()].some((value) => value.includes(NONCE))).toBe(true);
      for (const field of p.manifest.credentials.filter((c) => c.secret)) {
        const value = f.creds[field.key]!;
        expect(url, `the login URL carries ${field.key}`).not.toContain(value);
        expect(url, `the login URL carries ${field.key}, encoded`).not.toContain(encodeURIComponent(value));
      }
    });

    it("reads a good return into its state and a payload, and a refused return as refused, with its state", () => {
      const p = registered();
      const good = p.signIn.readReturn(f.goodReturn);
      expect("refused" in good).toBe(false);
      expect(good.state).toBe(f.goodReturn.state);
      expect(good).toHaveProperty("payload");
      // A refusal still gives back the state it came with, so the host can use up that sign-in.
      expect(p.signIn.readReturn(f.refusedReturn)).toMatchObject({ refused: true, state: f.refusedReturn.state ?? null });
    });

    it("refuses a return that has the good return's state and nothing else: no code, no token", () => {
      const p = registered();
      expect(f.goodReturn.state, "the good return has no state").toBeTruthy();
      expect(p.signIn.readReturn({ state: f.goodReturn.state })).toMatchObject({ refused: true, state: f.goodReturn.state });
    });

    it("makes every call through ctx.http, over https, to a manifest host", async () => {
      const p = registered();
      const { session, urls: signInUrls, unexpected } = await goodSession(p);
      const read = broker(f.answers);
      await reading(p, session, read.fetch);
      expect(signInUrls.length, "the sign-in made no call").toBeGreaterThan(0);
      expect(read.urls.length, "the read made no call").toBeGreaterThan(0);
      expect(unexpected).toEqual([]);
      expect(read.unexpected).toEqual([]);
      for (const asked of [...signInUrls, ...read.urls]) {
        const url = new URL(asked);
        expect(url.protocol, asked).toBe("https:");
        expect(p.manifest.hosts, asked).toContain(url.hostname);
      }
      expect(globalFetch).not.toHaveBeenCalled();
    });

    it("reads the holdings exactly as the fixture prints them", async () => {
      const p = registered();
      const { session } = await goodSession(p);
      const lines = await reading(p, session, broker(f.answers).fetch);
      expect(lines).toEqual(f.expectedLines);
    });

    it("gives a session that stops when the fixture says", async () => {
      const { session } = await goodSession(registered());
      expect(session.signedInAt).toEqual(f.signInAt);
      expect(session.expiresAt.toISOString()).toBe(f.expectedExpiry);
      expect(session.accessToken.trim()).not.toBe("");
    });

    it("says signed out on a read and refused on a sign-in, for every signed-out status", async () => {
      const p = registered();
      expect(p.manifest.signedOutStatuses.length).toBeGreaterThan(0);
      const { session } = await goodSession(p);
      const payload = (p.signIn.readReturn(f.goodReturn) as { payload: Record<string, string> }).payload;
      for (const status of p.manifest.signedOutStatuses) {
        const out = all({ status, body: { status: "error", message: BROKER_TEXT } });
        const onRead = await rejection(() => reading(p, session, broker(out).fetch));
        expect(onRead, `a ${status} on a read`).toBeInstanceOf(BrokerError);
        expect(onRead, `a ${status} on a read`).toMatchObject({ code: "BROKER_SIGNED_OUT" });
        const onSignIn = await rejection(() => completeSignIn(p, { creds: f.creds, payload, returnUrl: RETURN_URL, now: f.signInAt, fetch: broker(out).fetch }));
        expect(onSignIn, `a ${status} on a sign-in`).toBeInstanceOf(BrokerError);
        expect(onSignIn, `a ${status} on a sign-in`).toMatchObject({ code: "BROKER_REFUSED" });
      }
    });

    it("calls an answer of the wrong shape unreadable, never an empty list and never a crash", async () => {
      const p = registered();
      const { session } = await goodSession(p);
      const wrong = all({ status: 200, body: {} });

      const onRead = await rejection(() => reading(p, session, broker(wrong).fetch));
      expect(onRead, "a read of `{}` gave an answer").toBeInstanceOf(BrokerError);
      expect(onRead).toMatchObject({ code: "BROKER_ANSWER_UNREADABLE" });

      // A sign-in whose token comes in the return (Angel One's shape) can take `{}` for a profile it does not need.
      // Any sign-in that does give a session must still hold a token; everything else must be unreadable.
      const payload = (p.signIn.readReturn(f.goodReturn) as { payload: Record<string, string> }).payload;
      let outcome: unknown;
      try {
        outcome = await completeSignIn(p, { creds: f.creds, payload, returnUrl: RETURN_URL, now: f.signInAt, fetch: broker(wrong).fetch });
      } catch (e) {
        outcome = e;
      }
      if (outcome instanceof BrokerError) expect(outcome.code).toBe("BROKER_ANSWER_UNREADABLE");
      else expect((outcome as BrokerSession).accessToken.trim()).not.toBe("");
    });

    it("keeps credentials, the token and the broker's own words out of every error message", async () => {
      const p = registered();
      const { session } = await goodSession(p);
      const payload = (p.signIn.readReturn(f.goodReturn) as { payload: Record<string, string> }).payload;
      const hidden = [...secrets(), session.accessToken, BROKER_TEXT];
      const errors: unknown[] = [];
      const signIn = (fetch: typeof globalThis.fetch) => rejection(() => completeSignIn(p, { creds: f.creds, payload, returnUrl: RETURN_URL, now: f.signInAt, fetch }));
      const read = (fetch: typeof globalThis.fetch) => rejection(() => reading(p, session, fetch));

      const failures = [
        ...p.manifest.signedOutStatuses.map((status) => all({ status, body: { status: "error", message: BROKER_TEXT } })),
        all({ status: 500, body: { status: "error", message: BROKER_TEXT } }),
        all({ status: 200, body: { status: "error", message: BROKER_TEXT } }),
        all({ status: 200, body: {} }),
      ];
      for (const answers of failures) errors.push(await signIn(broker(answers).fetch), await read(broker(answers).fetch));
      // A broker that cannot be reached: the network error itself names the URL, the key and the token.
      const down = unreachable(hidden);
      const onSignIn = await signIn(down);
      const onRead = await read(down);
      expect(onSignIn).toMatchObject({ code: "BROKER_UNAVAILABLE" });
      expect(onRead).toMatchObject({ code: "BROKER_UNAVAILABLE" });
      errors.push(onSignIn, onRead);

      const failed = errors.filter((e): e is BrokerError => e instanceof BrokerError);
      expect(failed.length, "no error was thrown at all").toBeGreaterThan(0);
      for (const err of failed) {
        for (const value of hidden) expect(leaks(err.message, value), `"${err.message}" holds a value it must not`).toBe(false);
      }
    });
  });
}
