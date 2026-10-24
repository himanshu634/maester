import { createHash } from "node:crypto";
import type { BrokerDefinition } from "@maester/contracts";
import { sessionExpiry } from "./expiry.js";
import { at, fill } from "./template.js";

/**
 * - BROKER_UNAVAILABLE: the broker could not be reached or answered with an error of its own.
 * - BROKER_SIGNED_OUT: the broker no longer accepts the session (one of `signedOutStatuses`).
 * - BROKER_REFUSED: the broker turned down the sign-in or the saved key.
 * - BROKER_ANSWER_UNREADABLE: the answer is not the shape the definition describes.
 */
export type BrokerErrorCode = "BROKER_UNAVAILABLE" | "BROKER_SIGNED_OUT" | "BROKER_REFUSED" | "BROKER_ANSWER_UNREADABLE";

/** Its message never carries a credential, a token or the broker's own error text. */
export class BrokerError extends Error {
  constructor(readonly code: BrokerErrorCode, message: string) {
    super(message);
  }
}

export type Credentials = Record<string, string>;
export type BrokerSession = { accessToken: string; accountId: string | null; signedInAt: Date; expiresAt: Date };

/** One holding as the broker reported it. Every figure is a decimal string, as printed in the answer. */
export type BrokerHoldingLine = {
  isin: string;
  symbol: string;
  exchange: string;
  quantity: string;
  t1Quantity: string;
  averagePrice: string;
  lastPrice: string | null;
};

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A JSON number or string as a decimal string. A number keeps the digits JSON printed (the
 * shortest form that reads back the same); an exponent or anything else is unreadable.
 */
function decimal(v: unknown, field: string): string {
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim() : null;
  if (s === null || !DECIMAL.test(s)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", `holding field ${field} is not a decimal`);
  return s;
}
function text(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new BrokerError("BROKER_ANSWER_UNREADABLE", `holding field ${field} is missing`);
  return v.trim();
}

type RedirectSignIn = Extract<BrokerDefinition["signIn"], { kind: "redirect" }>;
type DirectSignIn = Extract<BrokerDefinition["signIn"], { kind: "direct" }>;
type Call = BrokerDefinition["reads"]["holdings"] | RedirectSignIn["session"] | DirectSignIn["session"];

/** The values a holdings read may use: a redirect sign-in's session, or the Settings connection's token and client ID. */
export type ReadSession = { accessToken: string; accountId: string | null } | { accessToken: string; clientId: string };

/**
 * Makes the calls a broker definition describes. It only reads: a definition has no way to
 * describe an order, and every URL must be https on one of the definition's hosts.
 */
export class BrokerClient {
  private readonly fetchFn: typeof globalThis.fetch;
  constructor(readonly def: BrokerDefinition, opts: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}) {
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }
  private readonly timeoutMs: number;

  /** The redirect sign-in; a broker that signs in through Settings has none. */
  private redirect(): RedirectSignIn {
    if (this.def.signIn.kind !== "redirect") throw new Error(`${this.def.id} signs in through a Settings connection, not a redirect`);
    return this.def.signIn;
  }

  /** The broker's login page for this sign-in. `returnUrl` is Maester's address the broker sends the investor back to. */
  loginUrl(creds: Credentials, state: string, returnUrl = ""): string {
    return fill(this.redirect().loginUrl, { ...creds, state, stateQuery: `state=${state}`, returnUrl }, { url: true });
  }

  /** Reads the broker's return: the code, or why there is none. */
  readReturn(query: Record<string, string | undefined>): { code: string; state: string } | { refused: true; state: string | null } {
    const p = this.redirect().returnParams;
    const state = query[p.state] ?? null;
    const code = query[p.code];
    const statusOk = !p.status || query[p.status] === undefined || query[p.status] === (p.success ?? "success");
    if (!state || !code || !statusOk) return { refused: true, state };
    return { code, state };
  }

  /** Exchanges the code from the broker's return for a session. */
  async signIn(creds: Credentials, code: string, now: Date, returnUrl = ""): Promise<BrokerSession> {
    const s = this.redirect().session;
    return this.session(s, await this.call(s, { ...creds, code, returnUrl }, "sign-in"), now);
  }

  /** A direct sign-in: the session call made from Maester with the saved key, plus `{timestamp}` in epoch seconds. */
  async startSession(creds: Credentials, now: Date): Promise<BrokerSession> {
    if (this.def.signIn.kind !== "direct") throw new Error(`${this.def.id} does not sign in directly`);
    const s = this.def.signIn.session;
    const timestamp = String(Math.floor(now.getTime() / 1000));
    // A key that was not approved today can come back as a 200 with no token: that is a refusal.
    return this.session(s, await this.call(s, { ...creds, timestamp }, "sign-in"), now, "BROKER_REFUSED");
  }

  private session(s: RedirectSignIn["session"] | DirectSignIn["session"], body: unknown, now: Date, noToken: BrokerErrorCode = "BROKER_ANSWER_UNREADABLE"): BrokerSession {
    const accessToken = at(body, s.accessToken);
    if (typeof accessToken !== "string" || accessToken === "") throw new BrokerError(noToken, "the sign-in answer has no access token");
    const accountId = s.accountId ? at(body, s.accountId) : null;
    return { accessToken, accountId: typeof accountId === "string" ? accountId : null, signedInAt: now, expiresAt: sessionExpiry(s.expiry, now) };
  }

  /** The holdings in the account, as the broker reports them. */
  async holdings(creds: Credentials, session: ReadSession): Promise<BrokerHoldingLine[]> {
    const h = this.def.reads.holdings;
    const values = "clientId" in session
      ? { ...creds, accessToken: session.accessToken, clientId: session.clientId }
      : { ...creds, accessToken: session.accessToken, accountId: session.accountId ?? "" };
    const body = await this.call(h, values, "holdings");
    const list = h.list === undefined ? body : at(body, h.list);
    if (!Array.isArray(list)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", "the holdings answer has no list");
    const f = h.fields;
    return list.map((item) => ({
      isin: text(at(item, f.isin), "isin"),
      symbol: text(at(item, f.symbol), "symbol"),
      exchange: f.exchange ? text(at(item, f.exchange), "exchange") : h.exchangeIs!,
      quantity: decimal(at(item, f.quantity), "quantity"),
      t1Quantity: f.t1Quantity ? decimal(at(item, f.t1Quantity) ?? 0, "t1Quantity") : "0",
      averagePrice: decimal(at(item, f.averagePrice), "averagePrice"),
      lastPrice: f.lastPrice && at(item, f.lastPrice) != null ? decimal(at(item, f.lastPrice), "lastPrice") : null,
    }));
  }

  private async call(c: Call, values: Record<string, string>, what: string): Promise<unknown> {
    const all = { ...values };
    for (const [name, d] of Object.entries(c.derive)) {
      all[name] = createHash("sha256").update(d.sha256hex.map((k) => all[k] ?? "").join("")).digest("hex");
    }
    const url = new URL(fill(c.url, all, { url: true }));
    if (url.protocol !== "https:" || !this.def.hosts.includes(url.hostname)) {
      throw new BrokerError("BROKER_UNAVAILABLE", `${what}: ${url.hostname} is not a host of ${this.def.id}`);
    }
    const headers: Record<string, string> = Object.fromEntries(Object.entries(c.headers).map(([k, v]) => [k, fill(v, all)]));
    let body: string | undefined;
    if (c.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(Object.fromEntries(Object.entries(c.form).map(([k, v]) => [k, fill(v, all)]))).toString();
    } else if (c.json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(Object.fromEntries(Object.entries(c.json).map(([k, v]) => [k, fill(v, all)])));
    }
    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), { method: c.method, headers, body, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      // A fetch error can carry the URL, and a URL can carry a key: say only that it failed.
      throw new BrokerError("BROKER_UNAVAILABLE", `${what}: ${this.def.name} could not be reached`);
    }
    if (this.def.signedOutStatuses.includes(res.status)) {
      throw new BrokerError(what === "sign-in" ? "BROKER_REFUSED" : "BROKER_SIGNED_OUT", `${what}: ${this.def.name} answered ${res.status}`);
    }
    if (res.status === 400 && what === "sign-in") throw new BrokerError("BROKER_REFUSED", `${what}: ${this.def.name} answered 400`);
    if (res.status !== 200) throw new BrokerError("BROKER_UNAVAILABLE", `${what}: ${this.def.name} answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new BrokerError("BROKER_ANSWER_UNREADABLE", `${what}: ${this.def.name} answered with something that is not JSON`);
    }
  }
}
