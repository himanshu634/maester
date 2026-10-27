import { BrokerHoldingLine } from "@maester/contracts";
import { BrokerError } from "./errors.js";
import { createBrokerHttp } from "./kit/http.js";
import type { BrokerSession, Credentials, BrokerPlugin } from "./plugin.js";

/**
 * Anything a plugin throws that is not a `BrokerError` becomes `BROKER_UNAVAILABLE` with a fixed
 * message. A plain error can carry a URL, a key or the broker's own words, so nothing of it is
 * copied: not the message, not the stack, not as a `cause`.
 */
export function toBrokerError(err: unknown): BrokerError {
  return err instanceof BrokerError ? err : new BrokerError("BROKER_UNAVAILABLE", "the broker call failed");
}

function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * The broker's login page for one sign-in. The plugin builds the address, and the host checks it
 * before it goes to the browser: it must parse, be https and be on one of the manifest's hosts.
 * The answer is the plugin's own string, unchanged, once it passes. The message of a refusal
 * names neither the address nor the host, because the address carries the key.
 */
export function loginUrlFor(p: BrokerPlugin, ctx: { creds: Credentials; state: string; returnUrl: string }): string {
  let url: unknown;
  try {
    url = p.signIn.loginUrl(ctx);
  } catch (err) {
    throw toBrokerError(err);
  }
  const target = parseUrl(url);
  if (typeof url !== "string" || target === null || target.protocol !== "https:" || !p.manifest.hosts.includes(target.hostname)) {
    throw new BrokerError("BROKER_UNAVAILABLE", `sign-in: ${p.manifest.name} gave a login address it does not use`);
  }
  return url;
}

/**
 * Turns the broker's return into a session, with calls made only through an `http` locked to the
 * plugin's hosts (phase `sign-in`). A session with no access token is `BROKER_ANSWER_UNREADABLE`.
 * Every throw leaves as a `BrokerError`.
 */
export async function completeSignIn(
  p: BrokerPlugin,
  ctx: { creds: Credentials; payload: Record<string, string>; returnUrl: string; now: Date; fetch?: typeof globalThis.fetch },
): Promise<BrokerSession> {
  const http = createBrokerHttp(p.manifest, { phase: "sign-in", fetch: ctx.fetch });
  let session: BrokerSession;
  try {
    session = await p.signIn.complete({ creds: ctx.creds, payload: ctx.payload, returnUrl: ctx.returnUrl, http, now: ctx.now });
  } catch (err) {
    throw toBrokerError(err);
  }
  if (typeof session?.accessToken !== "string" || session.accessToken.trim() === "") {
    throw new BrokerError("BROKER_ANSWER_UNREADABLE", `sign-in: ${p.manifest.name} gave no access token`);
  }
  return session;
}

/**
 * Reads the holdings with calls made only through an `http` locked to the plugin's hosts (phase
 * `read`). Every line is parsed with `BrokerHoldingLine`, so a figure that is not a decimal string
 * fails the read, and the lines kept are the parsed ones, with nothing a plugin added besides. An
 * (isin, exchange) pair that appears twice also fails it, before it can reach the table's primary
 * key. Every throw leaves as a `BrokerError`.
 */
export async function readHoldings(
  p: BrokerPlugin,
  ctx: { creds: Credentials; session: { accessToken: string; accountId: string | null }; now: Date; fetch?: typeof globalThis.fetch },
): Promise<BrokerHoldingLine[]> {
  const http = createBrokerHttp(p.manifest, { phase: "read", fetch: ctx.fetch });
  let answer: unknown;
  try {
    answer = await p.reads.holdings({ creds: ctx.creds, session: ctx.session, http, now: ctx.now });
  } catch (err) {
    throw toBrokerError(err);
  }
  if (!Array.isArray(answer)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", `read: ${p.manifest.name} gave holdings that are not a list`);
  const seen = new Set<string>();
  const lines: BrokerHoldingLine[] = [];
  for (const raw of answer) {
    const line = BrokerHoldingLine.safeParse(raw);
    if (!line.success) throw new BrokerError("BROKER_ANSWER_UNREADABLE", `read: ${p.manifest.name} gave a holding line that is not valid`);
    const key = JSON.stringify([line.data.isin, line.data.exchange]);
    if (seen.has(key)) throw new BrokerError("BROKER_ANSWER_UNREADABLE", `read: ${p.manifest.name} gave the same holding twice`);
    seen.add(key);
    lines.push(line.data);
  }
  return lines;
}
