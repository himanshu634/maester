import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  SaveBrokerRequest, type BrokerAccount, type BrokerDefinition, type BrokerSummary, type HoldingRow, type HoldingsSnapshot,
} from "@maester/contracts";
import {
  createBrokerLoginState, finishHoldingRead, forgetBrokerCredentials, getBrokerConnection, getBrokerConnectionById, latestCloses, latestHoldings, listBrokerConnections,
  markBrokerError, readStartedSince, saveBrokerCredentials, saveBrokerSession, startHoldingRead, takeBrokerLoginState,
  type BrokerConnectionRow, type HoldingReadRow, type LatestHoldings,
} from "@maester/db";
import { BrokerClient, BrokerError, builtInDefinitions, loadDefinitions } from "@maester/brokers";
import { HOLDINGS_CALCULATIONS, holdingQuantity, holdingsSnapshot } from "@maester/financial-engine";
import { decryptSecret, encryptSecret } from "@maester/market";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { validate } from "../validation.js";

const LOGIN_STATE_MS = 10 * 60_000;
/** "Read again" more often than this is refused, so a double click is one read. */
const READ_GAP_MS = 10_000;

/** The definitions: the built-in ones, then any in BROKER_DEFINITIONS_DIR, which replace them by id. */
export function brokerDefinitions(deps: AppDeps): Map<string, BrokerDefinition> {
  if (deps.brokerDefinitions) return deps.brokerDefinitions;
  const dir = deps.env.BROKER_DEFINITIONS_DIR;
  return loadDefinitions(dir ? [dir] : [], builtInDefinitions());
}

function needKey(deps: AppDeps): Buffer {
  if (!deps.env.CONNECTIONS_KEY) throw new HttpError("INVALID_STATE", "CONNECTIONS_KEY is not set");
  return Buffer.from(deps.env.CONNECTIONS_KEY, "base64");
}

const returnUrl = (deps: AppDeps, id: string) => new URL(`/v1/brokers/${id}/return`, deps.env.BETTER_AUTH_URL).toString();

function summary(deps: AppDeps, d: BrokerDefinition): BrokerSummary {
  return {
    id: d.id, name: d.name, enabled: d.enabled, notOfferedReason: d.notOfferedReason ?? null, copy: d.copy,
    credentials: d.credentials.map((c) => ({ key: c.key, label: c.label, ...(c.hint ? { hint: c.hint } : {}), secret: c.secret, minLength: c.minLength, maxLength: c.maxLength })),
    returnUrl: returnUrl(deps, d.id),
  };
}

function accountOf(def: BrokerDefinition, row: BrokerConnectionRow, latest: { lastRead: HoldingReadRow | null; lastOk: HoldingReadRow | null }, now: Date): BrokerAccount {
  const expired = row.tokenExpiresAt !== null && row.tokenExpiresAt <= now;
  let state: BrokerAccount["state"];
  if (row.lastErrorCode === "BROKER_SIGNED_OUT" || (row.signedInAt && (!row.tokenCiphertext || expired))) state = "signed_out";
  else if (row.lastErrorCode) state = "failing";
  else if (row.tokenCiphertext) state = "signed_in";
  else state = "saved";
  return {
    broker: def.id, name: def.name, state, accountId: row.accountId, keyLast4: row.keyLast4,
    savedAt: row.savedAt.toISOString(),
    signedInAt: row.signedInAt?.toISOString() ?? null,
    signedOutAt: state === "signed_out" && expired ? row.tokenExpiresAt!.toISOString() : null,
    lastReadAt: latest.lastOk?.finishedAt?.toISOString() ?? null,
    lastReadCount: latest.lastOk?.lineCount ?? null,
    errorCode: state === "failing" ? row.lastErrorCode : latest.lastRead?.state === "failed" && state !== "signed_out" ? latest.lastRead.errorCode : null,
  };
}

/** Errors from the broker, by code only: the broker's own text could echo a key. */
function logBrokerError(deps: AppDeps, broker: string, err: unknown, what: string): string {
  const code = err instanceof BrokerError ? err.code : "BROKER_UNAVAILABLE";
  deps.logger.warn({ broker, code, errName: err instanceof Error ? err.name : typeof err }, `broker ${what} failed`);
  return code;
}

/** Reads one account's holdings and keeps the read, good or failed. The account's error is set from it. */
async function readHoldings(deps: AppDeps, def: BrokerDefinition, row: BrokerConnectionRow, fetchFn: typeof fetch | undefined): Promise<void> {
  const key = needKey(deps);
  if (!row.credentialsCiphertext || !row.tokenCiphertext) throw new HttpError("INVALID_STATE", "sign in first");
  const creds = JSON.parse(decryptSecret(row.credentialsCiphertext, key)) as Record<string, string>;
  const accessToken = decryptSecret(row.tokenCiphertext, key);
  const readId = await startHoldingRead(deps.db, row.id);
  try {
    const lines = await new BrokerClient(def, { fetch: fetchFn }).holdings(creds, { accessToken, accountId: row.accountId });
    await finishHoldingRead(deps.db, readId, { ok: true, lines });
  } catch (err) {
    const code = logBrokerError(deps, def.id, err, "read");
    await finishHoldingRead(deps.db, readId, { ok: false, errorCode: code });
    await markBrokerError(deps.db, row.id, code);
  }
}

/** /v1/brokers: what brokers there are, and the address a broker's login page sends the investor back to. */
export function brokerCatalogRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const defs = brokerDefinitions(deps);

  r.get("/", (c) => c.json({ items: [...defs.values()].map((d) => summary(deps, d)) }));

  r.get("/:broker/return", async (c) => {
    const back = (q: Record<string, string>) => c.redirect(new URL(`/terminal/holdings?${new URLSearchParams(q)}`, deps.env.BETTER_AUTH_URL).toString(), 302);
    const def = defs.get(c.req.param("broker"));
    if (!def) throw new HttpError("NOT_FOUND", "broker not found");
    const client = new BrokerClient(def, { fetch: deps.brokerFetch });
    const ret = client.readReturn(c.req.query());
    const state = ret.state ? await takeBrokerLoginState(deps.db, ret.state, new Date()) : null;
    if (!state || state.userId !== c.get("user").id) return back({ broker: def.id, error: "SIGN_IN_EXPIRED" });
    if ("refused" in ret) return back({ broker: def.id, error: "SIGN_IN_CANCELLED" });

    const key = needKey(deps);
    const row = await getBrokerConnectionById(deps.db, state.connectionId);
    if (!row?.credentialsCiphertext) return back({ broker: def.id, error: "SIGN_IN_EXPIRED" });
    const creds = JSON.parse(decryptSecret(row.credentialsCiphertext, key)) as Record<string, string>;
    let session;
    try {
      session = await client.signIn(creds, ret.code, new Date());
    } catch (err) {
      return back({ broker: def.id, error: logBrokerError(deps, def.id, err, "sign-in") });
    }
    await saveBrokerSession(deps.db, row.id, { accountId: session.accountId, tokenCiphertext: encryptSecret(session.accessToken, key), signedInAt: session.signedInAt, tokenExpiresAt: session.expiresAt });
    const fresh = (await getBrokerConnectionById(deps.db, row.id))!;
    await readHoldings(deps, def, fresh, deps.brokerFetch);
    return back({ broker: def.id, signedIn: "1" });
  });

  return r;
}

/** /v1/workspaces/:ws/brokers: the workspace's broker accounts. */
export function brokerAccountRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const defs = brokerDefinitions(deps);
  const def = (id: string) => {
    const d = defs.get(id);
    if (!d) throw new HttpError("NOT_FOUND", "broker not found");
    return d;
  };

  r.use("*", async (_c, next) => {
    needKey(deps);
    await next();
  });

  r.get("/", async (c) => c.json({ items: await accounts(deps, defs, c.get("workspace").id) }));

  r.put("/:broker", validate("json", SaveBrokerRequest), async (c) => {
    const d = def(c.req.param("broker"));
    if (!d.enabled) throw new HttpError("INVALID_STATE", "this broker is not offered");
    const given = c.req.valid("json").credentials;
    const fields = d.credentials.flatMap((f) => {
      const v = given[f.key];
      if (!v) return [{ path: `credentials.${f.key}`, message: `Enter the ${f.label}.` }];
      if (v.length < f.minLength || v.length > f.maxLength) return [{ path: `credentials.${f.key}`, message: `That doesn’t look like a ${d.name} ${f.label}.` }];
      return [];
    });
    if (fields.length) throw new HttpError("VALIDATION_FAILED", "request validation failed", fields);
    const creds = Object.fromEntries(d.credentials.map((f) => [f.key, given[f.key]!]));
    await saveBrokerCredentials(deps.db, {
      workspaceId: c.get("workspace").id, broker: d.id, credentialsCiphertext: encryptSecret(JSON.stringify(creds), needKey(deps)),
      keyLast4: creds[d.credentialShown]!.slice(-4), savedByUserId: c.get("user").id,
    });
    return c.json(await account(deps, defs, c.get("workspace").id, d.id));
  });

  r.post("/:broker/sign-in", async (c) => {
    const d = def(c.req.param("broker"));
    if (!d.enabled) throw new HttpError("INVALID_STATE", "this broker is not offered");
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, d.id);
    if (!row?.credentialsCiphertext) throw new HttpError("INVALID_STATE", "save the key first");
    const creds = JSON.parse(decryptSecret(row.credentialsCiphertext, needKey(deps))) as Record<string, string>;
    const nonce = randomBytes(24).toString("base64url");
    await createBrokerLoginState(deps.db, { nonce, connectionId: row.id, userId: c.get("user").id, expiresAt: new Date(Date.now() + LOGIN_STATE_MS) });
    return c.json({ url: new BrokerClient(d).loginUrl(creds, nonce) });
  });

  r.post("/:broker/read", async (c) => {
    const d = def(c.req.param("broker"));
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, d.id);
    if (!row?.credentialsCiphertext) throw new HttpError("NOT_FOUND", "account not found");
    if (await readStartedSince(deps.db, row.id, new Date(Date.now() - READ_GAP_MS))) throw new HttpError("RATE_LIMITED", "a read just ran");
    await readHoldings(deps, d, row, deps.brokerFetch);
    return c.json(await account(deps, defs, c.get("workspace").id, d.id));
  });

  r.delete("/:broker", async (c) => {
    const d = def(c.req.param("broker"));
    const row = await getBrokerConnection(deps.db, c.get("workspace").id, d.id);
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

/** The workspace's connected accounts (a disconnected one keeps its row and reads, but is not listed). */
async function accounts(deps: AppDeps, defs: Map<string, BrokerDefinition>, workspaceId: string): Promise<BrokerAccount[]> {
  const rows = (await listBrokerConnections(deps.db, workspaceId)).filter((r) => r.credentialsCiphertext && defs.has(r.broker));
  const latest = await currentReads(deps, rows);
  const now = new Date();
  return rows.map((row, i) => accountOf(defs.get(row.broker)!, row, latest[i]!, now));
}
async function account(deps: AppDeps, defs: Map<string, BrokerDefinition>, workspaceId: string, broker: string): Promise<BrokerAccount> {
  const found = (await accounts(deps, defs, workspaceId)).find((a) => a.broker === broker);
  if (!found) throw new HttpError("NOT_FOUND", "account not found");
  return found;
}

/** /v1/workspaces/:ws/holdings: every holding across the connected accounts, valued at Maester's NSE close. */
export function holdingsRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  const defs = brokerDefinitions(deps);

  r.get("/", async (c) => {
    needKey(deps);
    const workspaceId = c.get("workspace").id;
    const rows = (await listBrokerConnections(deps.db, workspaceId)).filter((row) => row.credentialsCiphertext && defs.has(row.broker));
    const latest = await currentReads(deps, rows);
    const now = new Date();
    const accts = rows.map((row, i) => accountOf(defs.get(row.broker)!, row, latest[i]!, now));

    type Group = { isin: string; symbol: string; exchange: string; parts: HoldingRow["parts"] };
    const groups = new Map<string, Group>();
    rows.forEach((row, i) => {
      const read = latest[i]!;
      if (!read.lastOk) return;
      const stale = accts[i]!.state !== "signed_in";
      for (const l of read.lines) {
        const g = groups.get(l.isin) ?? { isin: l.isin, symbol: l.symbol, exchange: l.exchange, parts: [] };
        // An NSE listing names the symbol Maester has closes for; prefer it over a BSE one.
        if (l.exchange === "NSE") Object.assign(g, { symbol: l.symbol, exchange: l.exchange });
        g.parts.push({
          broker: row.broker, accountId: row.accountId, quantity: holdingQuantity([l]).toString(), averagePrice: l.averagePrice,
          readAt: read.lastOk.finishedAt!.toISOString(), stale,
        });
        groups.set(l.isin, g);
      }
    });

    const list = [...groups.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const closes = await latestCloses(deps.db, list.filter((g) => g.exchange === "NSE").map((g) => g.symbol));
    const inputs = list.map((g) => ({
      isin: g.isin,
      close: g.exchange === "NSE" ? closes[g.symbol]?.value ?? null : null,
      parts: rows.flatMap((_row, i) => latest[i]!.lines.filter((l) => l.isin === g.isin).map((l) => ({ quantity: l.quantity, t1Quantity: l.t1Quantity, averagePrice: l.averagePrice }))),
    }));
    const computed = holdingsSnapshot(inputs);
    const out: HoldingsSnapshot = {
      accounts: accts,
      rows: list.map((g, i) => {
        const r0 = computed.rows[i]!;
        const close = g.exchange === "NSE" ? closes[g.symbol] : undefined;
        return {
          isin: g.isin, symbol: g.symbol, exchange: g.exchange, parts: g.parts,
          quantity: r0.quantity, cost: r0.cost, value: r0.value, weight: r0.weight, unknown: r0.unknown,
          close: close ? { value: close.value, day: close.day, source: close.source } : null,
        };
      }),
      totals: computed.totals,
      closeDay: Object.values(closes).map((c0) => c0.day).sort().at(-1) ?? null,
      calculations: HOLDINGS_CALCULATIONS.map(({ id, version }) => ({ id, version })),
    };
    return c.json(out);
  });

  return r;
}
