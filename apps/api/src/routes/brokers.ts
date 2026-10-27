import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  SaveBrokerRequest, type BrokerAccount, type BrokerManifest, type BrokerSummary, type HoldingsSnapshot,
} from "@maester/contracts";
import {
  clearBrokerError, createBrokerLoginState, finishHoldingRead, forgetBrokerCredentials, getBrokerConnection, getBrokerConnectionById, latestCloses, latestHoldings,
  listBrokerConnections, markBrokerError, readStartedSince, saveBrokerCredentials, saveBrokerSession, startHoldingRead, takeBrokerLoginState,
  type BrokerConnectionRow, type HoldingReadRow, type LatestHoldings,
} from "@maester/db";
import {
  completeSignIn, defaultRegistry, loginUrlFor, readHoldings, toBrokerError, type BrokerPlugin, type BrokerRegistry, type ReturnRead,
} from "@maester/brokers";
import { HOLDINGS_CALCULATIONS, holdingsSnapshot, type HoldingPartInput } from "@maester/financial-engine";
import { decryptSecret, encryptSecret } from "@maester/market";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { validate } from "../validation.js";

const LOGIN_STATE_MS = 10 * 60_000;
/** "Read again" more often than this is refused, so a double click is one read. */
const READ_GAP_MS = 10_000;

/** The broker plugins: the ones the app was given, else every plugin compiled in. */
export function brokerRegistry(deps: AppDeps): BrokerRegistry {
  return deps.brokerRegistry ?? defaultRegistry();
}

function needKey(deps: AppDeps): Buffer {
  if (!deps.env.CONNECTIONS_KEY) throw new HttpError("INVALID_STATE", "CONNECTIONS_KEY is not set");
  return Buffer.from(deps.env.CONNECTIONS_KEY, "base64");
}

const returnUrl = (deps: AppDeps, id: string) => new URL(`/v1/brokers/${id}/return`, deps.env.BETTER_AUTH_URL).toString();

/** What the page is told about a broker. Each field is picked by name, so nothing else in a manifest (its hosts) reaches the page. */
function summary(deps: AppDeps, m: BrokerManifest): BrokerSummary {
  return {
    id: m.id, name: m.name, enabled: m.enabled, notOfferedReason: m.notOfferedReason ?? null, copy: m.copy,
    credentials: m.credentials.map((c) => ({ key: c.key, label: c.label, ...(c.hint ? { hint: c.hint } : {}), secret: c.secret, minLength: c.minLength, maxLength: c.maxLength })),
    signIn: { kind: "redirect" },
    returnUrl: returnUrl(deps, m.id),
  };
}

type Latest = { lastRead: HoldingReadRow | null; lastOk: HoldingReadRow | null };

function accountOf(m: BrokerManifest, row: BrokerConnectionRow, latest: Latest, now: Date): BrokerAccount {
  const expired = row.tokenExpiresAt !== null && row.tokenExpiresAt <= now;
  let state: BrokerAccount["state"];
  if (row.lastErrorCode === "BROKER_SIGNED_OUT" || (row.signedInAt && (!row.tokenCiphertext || expired))) state = "signed_out";
  else if (row.lastErrorCode) state = "failing";
  else if (row.tokenCiphertext) state = "signed_in";
  else state = "saved";
  const expiredAt = state === "signed_out" && expired ? row.tokenExpiresAt : null;
  return {
    broker: m.id, name: m.name, state, accountId: row.accountId, keyLast4: row.keyLast4,
    savedAt: row.savedAt.toISOString(),
    signedInAt: row.signedInAt?.toISOString() ?? null,
    signedOutAt: expiredAt?.toISOString() ?? null,
    lastReadAt: latest.lastOk?.finishedAt?.toISOString() ?? null,
    lastReadCount: latest.lastOk?.lineCount ?? null,
    // A sign-out the account has since got past (a new sign-in) is not said again.
    errorCode: state === "failing"
      ? row.lastErrorCode
      : latest.lastRead?.state === "failed" && state !== "signed_out" && latest.lastRead.errorCode !== "BROKER_SIGNED_OUT" ? latest.lastRead.errorCode : null,
  };
}

/**
 * A broker call that failed, logged by broker and code alone: the error's name, message and stack
 * are left out, because a broker's own text, a URL or a query value could be in them.
 */
function logBrokerError(deps: AppDeps, broker: string, err: unknown, what: "sign-in" | "read"): string {
  const { code } = toBrokerError(err);
  deps.logger.warn({ broker, code }, `broker ${what} failed`);
  return code;
}

/** The fields the investor saved, decrypted for one call to the broker. */
const credentialsOf = (ciphertext: string, key: Buffer) => JSON.parse(decryptSecret(ciphertext, key)) as Record<string, string>;

/**
 * Reads one account's holdings through its plugin, with the token the account holds, and keeps
 * the read, good or failed. The account's error is set from it, and a good read clears it.
 */
async function readAccount(deps: AppDeps, plugin: BrokerPlugin, row: BrokerConnectionRow): Promise<void> {
  const key = needKey(deps);
  if (!row.credentialsCiphertext) throw new HttpError("INVALID_STATE", "add the account first");
  if (!row.tokenCiphertext) throw new HttpError("INVALID_STATE", "sign in first");
  const creds = credentialsOf(row.credentialsCiphertext, key);
  const session = { accessToken: decryptSecret(row.tokenCiphertext, key), accountId: row.accountId };
  const readId = await startHoldingRead(deps.db, row.id);
  try {
    const lines = await readHoldings(plugin, { creds, session, now: new Date(), fetch: deps.brokerFetch });
    await finishHoldingRead(deps.db, readId, { ok: true, lines });
    if (row.lastErrorCode) await clearBrokerError(deps.db, row.id);
  } catch (err) {
    const code = logBrokerError(deps, plugin.manifest.id, err, "read");
    await finishHoldingRead(deps.db, readId, { ok: false, errorCode: code });
    await markBrokerError(deps.db, row.id, code);
  }
}

/** /v1/brokers: what brokers there are, and the address a broker's login page sends the investor back to. */
export function brokerCatalogRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const registry = brokerRegistry(deps);

  r.get("/", (c) => c.json({ items: [...registry.values()].map((p) => summary(deps, p.manifest)) }));

  // Nothing from the query is logged here: the return can carry a token or a code.
  r.get("/:broker/return", async (c) => {
    const back = (q: Record<string, string>) => c.redirect(new URL(`/terminal/holdings?${new URLSearchParams(q)}`, deps.env.BETTER_AUTH_URL).toString(), 302);
    const plugin = registry.get(c.req.param("broker"));
    if (!plugin) throw new HttpError("NOT_FOUND", "broker not found");
    const id = plugin.manifest.id;
    let ret: ReturnRead;
    try {
      ret = plugin.signIn.readReturn(c.req.query());
    } catch (err) {
      return back({ broker: id, error: logBrokerError(deps, id, err, "sign-in") });
    }
    const state = ret.state ? await takeBrokerLoginState(deps.db, ret.state, new Date()) : null;
    if (!state || state.userId !== c.get("user").id) return back({ broker: id, error: "SIGN_IN_EXPIRED" });
    if ("refused" in ret) return back({ broker: id, error: "SIGN_IN_CANCELLED" });

    const key = needKey(deps);
    const row = await getBrokerConnectionById(deps.db, state.connectionId);
    if (!row?.credentialsCiphertext) return back({ broker: id, error: "SIGN_IN_EXPIRED" });
    const creds = credentialsOf(row.credentialsCiphertext, key);
    let session;
    try {
      session = await completeSignIn(plugin, { creds, payload: ret.payload, returnUrl: returnUrl(deps, id), now: new Date(), fetch: deps.brokerFetch });
    } catch (err) {
      return back({ broker: id, error: logBrokerError(deps, id, err, "sign-in") });
    }
    await saveBrokerSession(deps.db, row.id, { accountId: session.accountId, tokenCiphertext: encryptSecret(session.accessToken, key), signedInAt: session.signedInAt, tokenExpiresAt: session.expiresAt });
    const fresh = (await getBrokerConnectionById(deps.db, row.id))!;
    await readAccount(deps, plugin, fresh);
    return back({ broker: id, signedIn: "1" });
  });

  return r;
}

/** /v1/workspaces/:ws/brokers: the workspace's broker accounts. */
export function brokerAccountRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const registry = brokerRegistry(deps);
  const pluginOf = (id: string) => {
    const p = registry.get(id);
    if (!p) throw new HttpError("NOT_FOUND", "broker not found");
    return p;
  };
  /** A switched-off plugin takes no new key and no new sign-in; an account it already has still lists and reads. */
  const offered = (id: string) => {
    const p = pluginOf(id);
    if (!p.manifest.enabled) throw new HttpError("INVALID_STATE", "this broker is not offered");
    return p;
  };

  r.use("*", async (_c, next) => {
    needKey(deps);
    await next();
  });

  r.get("/", async (c) => c.json({ items: await accounts(deps, registry, c.get("workspace").id) }));

  r.put("/:broker", validate("json", SaveBrokerRequest), async (c) => {
    const { manifest: m } = offered(c.req.param("broker"));
    const given = c.req.valid("json").credentials;
    const fields = m.credentials.flatMap((f) => {
      const v = given[f.key];
      if (!v) return [{ path: `credentials.${f.key}`, message: `Enter the ${f.label}.` }];
      if (v.length < f.minLength || v.length > f.maxLength) return [{ path: `credentials.${f.key}`, message: `That doesn’t look like a ${m.name} ${f.label}.` }];
      return [];
    });
    if (fields.length) throw new HttpError("VALIDATION_FAILED", "request validation failed", fields);
    const creds = Object.fromEntries(m.credentials.map((f) => [f.key, given[f.key]!]));
    await saveBrokerCredentials(deps.db, {
      workspaceId: c.get("workspace").id, broker: m.id, credentialsCiphertext: encryptSecret(JSON.stringify(creds), needKey(deps)),
      keyLast4: creds[m.credentialShown]!.slice(-4), savedByUserId: c.get("user").id,
    });
    return c.json(await account(deps, registry, c.get("workspace").id, m.id));
  });

  r.post("/:broker/sign-in", async (c) => {
    const plugin = offered(c.req.param("broker"));
    const id = plugin.manifest.id;
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, id);
    if (!row?.credentialsCiphertext) throw new HttpError("INVALID_STATE", "save the key first");
    const creds = credentialsOf(row.credentialsCiphertext, needKey(deps));
    const nonce = randomBytes(24).toString("base64url");
    let url: string;
    try {
      url = loginUrlFor(plugin, { creds, state: nonce, returnUrl: returnUrl(deps, id) });
    } catch (err) {
      logBrokerError(deps, id, err, "sign-in");
      throw new HttpError("INTERNAL", "the broker's sign-in could not start");
    }
    await createBrokerLoginState(deps.db, { nonce, connectionId: row.id, userId: c.get("user").id, expiresAt: new Date(Date.now() + LOGIN_STATE_MS) });
    return c.json({ url });
  });

  r.post("/:broker/read", async (c) => {
    const plugin = pluginOf(c.req.param("broker"));
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, plugin.manifest.id);
    if (!row?.credentialsCiphertext) throw new HttpError("NOT_FOUND", "account not found");
    if (await readStartedSince(deps.db, row.id, new Date(Date.now() - READ_GAP_MS))) throw new HttpError("RATE_LIMITED", "a read just ran");
    await readAccount(deps, plugin, row);
    return c.json(await account(deps, registry, c.get("workspace").id, plugin.manifest.id));
  });

  r.delete("/:broker", async (c) => {
    const plugin = pluginOf(c.req.param("broker"));
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, plugin.manifest.id);
    if (!row?.credentialsCiphertext) throw new HttpError("NOT_FOUND", "account not found");
    await forgetBrokerCredentials(deps.db, row.id);
    return c.body(null, 204);
  });

  return r;
}

/**
 * Each account's latest reads, leaving out any made before its key was last saved: a key saved
 * after a disconnect starts the account afresh, so reads from before it do not come back.
 */
async function currentReads(deps: AppDeps, rows: BrokerConnectionRow[]): Promise<LatestHoldings[]> {
  const latest = await latestHoldings(deps.db, rows.map((r) => r.id));
  return latest.map((l, i) => {
    const savedAt = rows[i]!.savedAt;
    const fresh = (r: HoldingReadRow | null) => (r && r.startedAt >= savedAt ? r : null);
    const lastOk = fresh(l.lastOk);
    return { connectionId: l.connectionId, lastRead: fresh(l.lastRead), lastOk, lines: lastOk ? l.lines : [] };
  });
}

/**
 * The workspace's connected accounts. A disconnected one keeps its row and reads, but is not
 * listed; nor is one whose broker is no longer in the registry, whose key is never decrypted.
 */
async function connectedRows(deps: AppDeps, registry: BrokerRegistry, workspaceId: string): Promise<BrokerConnectionRow[]> {
  return (await listBrokerConnections(deps.db, workspaceId)).filter((r) => r.credentialsCiphertext && registry.has(r.broker));
}
async function accounts(deps: AppDeps, registry: BrokerRegistry, workspaceId: string): Promise<BrokerAccount[]> {
  const rows = await connectedRows(deps, registry, workspaceId);
  const latest = await currentReads(deps, rows);
  const now = new Date();
  return rows.map((row, i) => accountOf(registry.get(row.broker)!.manifest, row, latest[i]!, now));
}
async function account(deps: AppDeps, registry: BrokerRegistry, workspaceId: string, broker: string): Promise<BrokerAccount> {
  const found = (await accounts(deps, registry, workspaceId)).find((a) => a.broker === broker);
  if (!found) throw new HttpError("NOT_FOUND", "account not found");
  return found;
}

/** /v1/workspaces/:ws/holdings: every holding across the connected accounts, valued at Maester's NSE close. */
export function holdingsRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const registry = brokerRegistry(deps);

  r.get("/", async (c) => {
    needKey(deps);
    const rows = await connectedRows(deps, registry, c.get("workspace").id);
    const latest = await currentReads(deps, rows);
    const now = new Date();
    const accts = rows.map((row, i) => accountOf(registry.get(row.broker)!.manifest, row, latest[i]!, now));

    // One group per ISIN; each line is keyed by its account (the broker, one account per broker), so
    // the engine merges a broker's NSE and BSE lines for the same ISIN into one part.
    type Line = HoldingPartInput & { account: string };
    type Group = { isin: string; symbol: string; exchange: string; lines: Line[] };
    const groups = new Map<string, Group>();
    const readOf = new Map<string, { accountId: string | null; readAt: string; stale: boolean }>();
    rows.forEach((row, i) => {
      const read = latest[i]!;
      if (!read.lastOk) return;
      readOf.set(row.broker, { accountId: accts[i]!.accountId, readAt: read.lastOk.finishedAt!.toISOString(), stale: accts[i]!.state !== "signed_in" });
      for (const l of read.lines) {
        const g = groups.get(l.isin) ?? { isin: l.isin, symbol: l.symbol, exchange: l.exchange, lines: [] };
        // An NSE listing names the symbol Maester has closes for; prefer it over a BSE one.
        if (l.exchange === "NSE") Object.assign(g, { symbol: l.symbol, exchange: l.exchange });
        g.lines.push({ account: row.broker, quantity: l.quantity, t1Quantity: l.t1Quantity, averagePrice: l.averagePrice });
        groups.set(l.isin, g);
      }
    });

    const list = [...groups.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const closes = await latestCloses(deps.db, list.filter((g) => g.exchange === "NSE").map((g) => g.symbol));
    const computed = holdingsSnapshot(list.map((g) => ({ isin: g.isin, close: g.exchange === "NSE" ? closes[g.symbol]?.value ?? null : null, parts: g.lines })));
    const out: HoldingsSnapshot = {
      accounts: accts,
      rows: list.map((g, i) => {
        const r0 = computed.rows[i]!;
        const close = g.exchange === "NSE" ? closes[g.symbol] : undefined;
        return {
          isin: g.isin, symbol: g.symbol, exchange: g.exchange,
          parts: r0.parts.map((p) => {
            const read = readOf.get(p.account!)!;
            return {
              broker: p.account!, accountId: read.accountId, quantity: p.quantity, averagePrice: p.averagePrice,
              cost: p.cost, value: p.value, gain: p.gain, gainPercent: p.gainPercent, readAt: read.readAt, stale: read.stale,
            };
          }),
          quantity: r0.quantity, cost: r0.cost, value: r0.value, weight: r0.weight, gain: r0.gain, gainPercent: r0.gainPercent, unknown: r0.unknown,
          close: close ? { value: close.value, day: close.day, source: close.source } : null,
        };
      }),
      totals: computed.totals,
      accountTotals: accts.flatMap((a) => {
        const t = computed.accounts.find((x) => x.account === a.broker);
        if (!t) return [];
        return [{
          broker: a.broker, knownValue: t.knownValue, priced: t.priced, count: t.count, cost: t.cost, costed: t.costed,
          gain: t.gain, gainCovers: t.gainCovers, gainPercent: t.gainPercent,
        }];
      }),
      closeDay: Object.values(closes).map((c0) => c0.day).sort().at(-1) ?? null,
      calculations: HOLDINGS_CALCULATIONS.map(({ id, version }) => ({ id, version })),
    };
    return c.json(out);
  });

  return r;
}
