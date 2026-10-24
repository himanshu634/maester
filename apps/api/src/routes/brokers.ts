import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import {
  SaveBrokerRequest, type BrokerAccount, type BrokerDefinition, type BrokerSummary, type HoldingsSnapshot,
} from "@maester/contracts";
import {
  clearBrokerError, createBrokerLoginState, finishHoldingRead, forgetBrokerCredentials, getBrokerConnection, getBrokerConnectionById, getConnection, latestCloses, latestHoldings,
  listBrokerConnections, markBrokerError, readStartedSince, saveBrokerCredentials, saveBrokerSession, startHoldingRead, takeBrokerLoginState,
  type BrokerConnectionRow, type HoldingReadRow, type LatestHoldings, type MarketConnectionRow,
} from "@maester/db";
import { BrokerClient, BrokerError, builtInDefinitions, loadDefinitions, type ReadSession } from "@maester/brokers";
import { HOLDINGS_CALCULATIONS, holdingsSnapshot, type HoldingPartInput } from "@maester/financial-engine";
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
    signIn: d.signIn.kind === "redirect" ? { kind: "redirect" } : { kind: d.signIn.kind, provider: d.signIn.provider },
    returnUrl: d.signIn.kind === "redirect" ? returnUrl(deps, d.id) : null,
  };
}

/**
 * Settings connections are global to the install, but holdings are personal: an account uses the
 * connection only while it holds the token of the person who added the account. A token saved
 * by someone else is not theirs, so the account reads nothing with it.
 */
function connectionOf(conn: MarketConnectionRow | null | undefined, savedByUserId: string | null): MarketConnectionRow | null {
  return conn?.clientId && savedByUserId !== null && conn.savedByUserId === savedByUserId ? conn : null;
}

/** The Settings connection each settings-connection broker signs in through, by provider (null: not connected). */
type SettingsConnections = Map<string, MarketConnectionRow | null>;
async function settingsConnections(deps: AppDeps, defs: Iterable<BrokerDefinition>): Promise<SettingsConnections> {
  const out: SettingsConnections = new Map();
  for (const d of defs) {
    if (d.signIn.kind === "settings-connection" && !out.has(d.signIn.provider)) out.set(d.signIn.provider, await getConnection(deps.db, d.signIn.provider));
  }
  return out;
}

type Latest = { lastRead: HoldingReadRow | null; lastOk: HoldingReadRow | null };

/**
 * A settings-connection account stands where its Settings connection stands. It is signed out
 * when Settings has no token, the token has expired or the market worker found it refused, or
 * when the broker refused the token Settings holds now (a read that failed signed-out after the
 * token was saved or renewed; a token saved since is a new one, so that refusal no longer holds).
 */
function settingsState(row: BrokerConnectionRow, latest: Latest, conn: MarketConnectionRow | null, now: Date): { state: BrokerAccount["state"]; expiredAt: Date | null } {
  const expiredAt = conn?.expiresAt && conn.expiresAt <= now ? conn.expiresAt : null;
  const refused = conn !== null && latest.lastRead?.errorCode === "BROKER_SIGNED_OUT" && latest.lastRead.startedAt >= conn.savedAt;
  if (!conn || expiredAt || conn.lastErrorCode === "DHAN_TOKEN_EXPIRED" || refused) return { state: "signed_out", expiredAt };
  // DHAN_NO_DATA_PLAN on the connection is about the Data API; holdings come from the free Trading API.
  if (row.lastErrorCode && row.lastErrorCode !== "BROKER_SIGNED_OUT") return { state: "failing", expiredAt: null };
  return { state: "signed_in", expiredAt: null };
}

function accountOf(def: BrokerDefinition, row: BrokerConnectionRow, latest: Latest, now: Date, conns: SettingsConnections): BrokerAccount {
  let state: BrokerAccount["state"];
  let expiredAt: Date | null;
  let accountId = row.accountId;
  if (def.signIn.kind === "settings-connection") {
    const conn = connectionOf(conns.get(def.signIn.provider), row.savedByUserId);
    ({ state, expiredAt } = settingsState(row, latest, conn, now));
    accountId = conn?.clientId ?? null;
  } else {
    const expired = row.tokenExpiresAt !== null && row.tokenExpiresAt <= now;
    if (row.lastErrorCode === "BROKER_SIGNED_OUT" || (row.signedInAt && (!row.tokenCiphertext || expired))) state = "signed_out";
    else if (row.lastErrorCode) state = "failing";
    else if (row.tokenCiphertext) state = "signed_in";
    else state = "saved";
    expiredAt = state === "signed_out" && expired ? row.tokenExpiresAt : null;
  }
  return {
    broker: def.id, name: def.name, state, accountId, keyLast4: row.keyLast4,
    savedAt: row.savedAt.toISOString(),
    signedInAt: row.signedInAt?.toISOString() ?? null,
    signedOutAt: expiredAt?.toISOString() ?? null,
    lastReadAt: latest.lastOk?.finishedAt?.toISOString() ?? null,
    lastReadCount: latest.lastOk?.lineCount ?? null,
    // A sign-out the account has since got past (a new sign-in, a renewed Settings token) is not said again.
    errorCode: state === "failing"
      ? row.lastErrorCode
      : latest.lastRead?.state === "failed" && state !== "signed_out" && latest.lastRead.errorCode !== "BROKER_SIGNED_OUT" ? latest.lastRead.errorCode : null,
  };
}

/** Errors from the broker, by code only: the broker's own text could echo a key. */
function logBrokerError(deps: AppDeps, broker: string, err: unknown, what: string): string {
  const code = err instanceof BrokerError ? err.code : "BROKER_UNAVAILABLE";
  deps.logger.warn({ broker, code, errName: err instanceof Error ? err.name : typeof err }, `broker ${what} failed`);
  return code;
}

/**
 * Reads one account's holdings and keeps the read, good or failed. The account's error is set
 * from it, and a good read clears it. A settings-connection account reads with the token Settings
 * holds at that moment, since a renewal ends the one before.
 */
async function readHoldings(deps: AppDeps, def: BrokerDefinition, row: BrokerConnectionRow, fetchFn: typeof fetch | undefined): Promise<void> {
  const key = needKey(deps);
  if (!row.credentialsCiphertext) throw new HttpError("INVALID_STATE", "add the account first");
  const creds = JSON.parse(decryptSecret(row.credentialsCiphertext, key)) as Record<string, string>;
  let session: ReadSession;
  if (def.signIn.kind === "settings-connection") {
    const conn = connectionOf(await getConnection(deps.db, def.signIn.provider), row.savedByUserId);
    if (!conn?.clientId) throw new HttpError("INVALID_STATE", `connect ${def.name} in Settings first`);
    session = { accessToken: decryptSecret(conn.secretCiphertext, key), clientId: conn.clientId };
  } else {
    if (!row.tokenCiphertext) throw new HttpError("INVALID_STATE", "sign in first");
    session = { accessToken: decryptSecret(row.tokenCiphertext, key), accountId: row.accountId };
  }
  const readId = await startHoldingRead(deps.db, row.id);
  try {
    const lines = await new BrokerClient(def, { fetch: fetchFn }).holdings(creds, session);
    await finishHoldingRead(deps.db, readId, { ok: true, lines });
    if (row.lastErrorCode) await clearBrokerError(deps.db, row.id);
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
    if (!def || def.signIn.kind !== "redirect") throw new HttpError("NOT_FOUND", "broker not found");
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
    if (d.signIn.kind === "settings-connection") {
      // Nothing to save: the account uses the Settings connection, so it is added and read at once.
      const conn = connectionOf(await getConnection(deps.db, d.signIn.provider), c.get("user").id);
      if (!conn) throw new HttpError("INVALID_STATE", `connect ${d.name} in Settings first`);
      const row = await saveBrokerCredentials(deps.db, {
        workspaceId: c.get("workspace").id, broker: d.id, credentialsCiphertext: encryptSecret("{}", needKey(deps)), keyLast4: null, savedByUserId: c.get("user").id,
      });
      await readHoldings(deps, d, row, deps.brokerFetch);
      return c.json(await account(deps, defs, c.get("workspace").id, d.id));
    }
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
      keyLast4: creds[d.credentialShown!]!.slice(-4), savedByUserId: c.get("user").id,
    });
    return c.json(await account(deps, defs, c.get("workspace").id, d.id));
  });

  r.post("/:broker/sign-in", async (c) => {
    const d = def(c.req.param("broker"));
    if (!d.enabled) throw new HttpError("INVALID_STATE", "this broker is not offered");
    if (d.signIn.kind !== "redirect") throw new HttpError("INVALID_STATE", `${d.name} signs in through Settings`);
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
  const conns = await settingsConnections(deps, rows.map((r) => defs.get(r.broker)!));
  const now = new Date();
  return rows.map((row, i) => accountOf(defs.get(row.broker)!, row, latest[i]!, now, conns));
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
    const conns = await settingsConnections(deps, rows.map((r) => defs.get(r.broker)!));
    const now = new Date();
    const accts = rows.map((row, i) => accountOf(defs.get(row.broker)!, row, latest[i]!, now, conns));

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
        const { account: _account, ...figures } = t;
        return [{ broker: a.broker, ...figures }];
      }),
      closeDay: Object.values(closes).map((c0) => c0.day).sort().at(-1) ?? null,
      calculations: HOLDINGS_CALCULATIONS.map(({ id, version }) => ({ id, version })),
    };
    return c.json(out);
  });

  return r;
}
