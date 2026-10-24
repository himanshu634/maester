import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BrokerDefinition } from "@maester/contracts";
import { placeholders } from "./template.js";

export class DefinitionError extends Error {}

/**
 * Checks what the schema cannot: every placeholder names a value that exists where it is used,
 * and every URL is https on one of the definition's own hosts.
 */
export function checkDefinition(def: BrokerDefinition): void {
  const fail = (why: string) => {
    throw new DefinitionError(`broker definition ${def.id}: ${why}`);
  };
  const creds = def.credentials.map((c) => c.key);
  if (new Set(creds).size !== creds.length) fail("two credentials share a key");
  if (def.signIn.kind === "redirect" || def.signIn.kind === "direct") {
    if (creds.length === 0) fail(`a ${def.signIn.kind} sign-in needs at least one credential`);
    if (def.credentialShown === undefined || !creds.includes(def.credentialShown)) fail(`credentialShown "${def.credentialShown ?? ""}" is not a credential`);
  } else {
    // The token comes from Settings; a definition that also asks for a key would keep a second copy.
    if (creds.length > 0) fail("a settings-connection sign-in asks for no credentials");
    if (def.credentialShown !== undefined) fail("a settings-connection sign-in has no credentialShown");
  }

  // Every call may use the time, as epoch seconds or ISO; only derive and headers may use the body.
  const CLOCK = ["timestamp", "isoTimestamp"];
  const call = (where: string, c: { url: string; headers: Record<string, string>; form?: Record<string, string>; json?: Record<string, string>; derive: Record<string, { sha256hex: string[] }> }, given: string[]) => {
    if (c.form && c.json) fail(`${where}: a call sends a form or a JSON body, not both`);
    const known = [...given, ...CLOCK];
    for (const k of creds) if (CLOCK.includes(k) || k === "body") fail(`credential "${k}" hides another value`);
    const signsBody = Object.entries(c.derive).filter(([, d]) => d.sha256hex.includes("body")).map(([name]) => name);
    for (const [name, d] of Object.entries(c.derive)) {
      if (known.includes(name) || name === "body") fail(`${where}: derived value "${name}" hides another value`);
      for (const input of d.sha256hex) if (!known.includes(input) && input !== "body") fail(`${where}: derived value "${name}" uses unknown "${input}"`);
    }
    const all = [...known, ...Object.keys(c.derive)];
    // The body cannot hold the body, or a value worked out from it.
    const before = all.filter((p) => !signsBody.includes(p));
    for (const t of [c.url, ...Object.values(c.form ?? {}), ...Object.values(c.json ?? {})]) {
      for (const p of placeholders(t)) if (!before.includes(p)) fail(`${where}: unknown placeholder {${p}}`);
    }
    for (const t of Object.values(c.headers)) for (const p of placeholders(t)) if (!all.includes(p) && p !== "body") fail(`${where}: unknown placeholder {${p}}`);
    checkUrl(where, c.url);
  };
  const checkUrl = (where: string, template: string) => {
    let url: URL;
    try {
      url = new URL(template.replace(/\{[A-Za-z0-9]+\}/g, "x"));
    } catch {
      return fail(`${where}: the URL does not parse`);
    }
    if (url.protocol !== "https:") fail(`${where}: the URL is not https`);
    if (!def.hosts.includes(url.hostname)) fail(`${where}: ${url.hostname} is not one of the definition's hosts`);
  };

  if (def.signIn.kind === "redirect") {
    const { loginUrl, session } = def.signIn;
    for (const p of placeholders(loginUrl)) if (![...creds, "state", "stateQuery", "returnUrl"].includes(p)) fail(`loginUrl: unknown placeholder {${p}}`);
    checkUrl("loginUrl", loginUrl);
    if (!placeholders(loginUrl).some((p) => p === "state" || p === "stateQuery")) fail("loginUrl must carry {state} or {stateQuery}");
    call("session", session, [...creds, "code", "returnUrl"]);
    call("holdings", def.reads.holdings, [...creds, "accessToken", "accountId"]);
  } else if (def.signIn.kind === "direct") {
    call("session", def.signIn.session, creds);
    call("holdings", def.reads.holdings, [...creds, "accessToken", "accountId"]);
  } else {
    call("holdings", def.reads.holdings, ["accessToken", "clientId"]);
  }

  const h = def.reads.holdings;
  if (h.join) call("holdings join", h.join, def.signIn.kind === "settings-connection" ? ["accessToken", "clientId"] : [...creds, "accessToken", "accountId"]);
  if (!h.fields.averagePrice && !h.join?.fields.averagePrice) fail("holdings: name the average price field, in the holdings or in their join");
  if (!h.fields.exchange && !h.exchangeIs) fail("holdings: name the exchange field, or say which exchange in exchangeIs");
  if (h.fields.exchange && h.exchangeIs) fail("holdings: name the exchange field or exchangeIs, not both");
}

/** Parses and checks one definition. Throws a DefinitionError naming the file and what is wrong. */
export function parseDefinition(json: unknown, source: string): BrokerDefinition {
  const parsed = BrokerDefinition.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DefinitionError(`${source}: ${first?.path.join(".") || "(root)"}: ${first?.message}`);
  }
  checkDefinition(parsed.data);
  return parsed.data;
}

/**
 * Loads every `*.json` in each folder, in order, over `base`. A later definition replaces an earlier
 * one with the same id, so a deployment can override or switch off a built-in broker.
 */
export function loadDefinitions(dirs: string[], base: Map<string, BrokerDefinition> = new Map()): Map<string, BrokerDefinition> {
  const out = new Map(base);
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const full = path.join(dir, file);
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(full, "utf8"));
      } catch {
        throw new DefinitionError(`${full}: not JSON`);
      }
      const def = parseDefinition(json, full);
      out.set(def.id, def);
    }
  }
  return out;
}
