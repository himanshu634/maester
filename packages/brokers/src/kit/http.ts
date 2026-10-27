import type { BrokerManifest } from "@maester/contracts";
import { BrokerError } from "../errors.js";

/** `sign-in`: a refusal means the key or code was turned down. `read`: it means the broker signed Maester out. */
export type HttpPhase = "sign-in" | "read";

/** The only way a plugin reaches a broker: it can read and sign in, and nothing else. */
export type BrokerHttp = {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  post(url: string, init: { headers?: Record<string, string>; form?: Record<string, string>; json?: unknown }): Promise<unknown>;
};

/**
 * An HTTP client locked to one broker. Every URL must be https on one of `manifest.hosts` and is
 * checked before anything is sent; no redirect is followed; a call times out after `timeoutMs`
 * (20 s). It answers with the parsed JSON body of a 200 and otherwise throws a `BrokerError`
 * whose message names only the phase and the broker, never the URL, a key or what the broker said.
 */
export function createBrokerHttp(manifest: BrokerManifest, opts: { phase: HttpPhase; fetch?: typeof globalThis.fetch; timeoutMs?: number }): BrokerHttp {
  const { phase } = opts;
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(method: "GET" | "POST", url: string, headers: Record<string, string>, body?: string): Promise<unknown> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new BrokerError("BROKER_UNAVAILABLE", `${phase}: ${manifest.name} was given an address that is not a URL`);
    }
    if (target.protocol !== "https:" || !manifest.hosts.includes(target.hostname)) {
      throw new BrokerError("BROKER_UNAVAILABLE", `${phase}: ${manifest.name} was given an address it does not use`);
    }
    let res: Response;
    try {
      res = await fetchFn(target.toString(), { method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    } catch {
      // A fetch error can carry the URL, and a URL can carry a key: say only that it failed.
      throw new BrokerError("BROKER_UNAVAILABLE", `${phase}: ${manifest.name} could not be reached`);
    }
    if (manifest.signedOutStatuses.includes(res.status)) {
      throw new BrokerError(phase === "sign-in" ? "BROKER_REFUSED" : "BROKER_SIGNED_OUT", `${phase}: ${manifest.name} answered ${res.status}`);
    }
    if (res.status === 400 && phase === "sign-in") throw new BrokerError("BROKER_REFUSED", `${phase}: ${manifest.name} answered 400`);
    if (res.status !== 200) throw new BrokerError("BROKER_UNAVAILABLE", `${phase}: ${manifest.name} answered ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new BrokerError("BROKER_ANSWER_UNREADABLE", `${phase}: ${manifest.name} answered with something that is not JSON`);
    }
  }

  return {
    get: (url, init) => call("GET", url, { ...init?.headers }),
    async post(url, init) {
      if (init.form !== undefined && init.json !== undefined) throw new Error("a call has a form or a JSON body, not both");
      const headers = { ...init.headers };
      if (init.form !== undefined) {
        return await call("POST", url, { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, new URLSearchParams(init.form).toString());
      }
      if (init.json !== undefined) return await call("POST", url, { ...headers, "Content-Type": "application/json" }, JSON.stringify(init.json));
      return await call("POST", url, headers);
    },
  };
}
