import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  brokerConnection, brokerLoginState, holdingLine, holdingRead,
  type BrokerConnectionRow, type BrokerLoginStateRow, type HoldingLineRow, type HoldingReadRow, type NewHoldingLine,
} from "../schema/brokers.js";
import { marketPoint } from "../schema/market.js";

/** The workspace's account at one broker, or null. */
export async function getBrokerConnection(db: Db, workspaceId: string, broker: string): Promise<BrokerConnectionRow | null> {
  const [row] = await db.select().from(brokerConnection).where(and(eq(brokerConnection.workspaceId, workspaceId), eq(brokerConnection.broker, broker)));
  return row ?? null;
}

/** The workspace's broker accounts, oldest first. */
export async function listBrokerConnections(db: Db, workspaceId: string): Promise<BrokerConnectionRow[]> {
  return db.select().from(brokerConnection).where(eq(brokerConnection.workspaceId, workspaceId)).orderBy(asc(brokerConnection.savedAt));
}

/** Saves new credentials. A new key ends any sign-in made with the old one. */
export async function saveBrokerCredentials(
  db: Db,
  v: { workspaceId: string; broker: string; credentialsCiphertext: string; keyLast4: string; savedByUserId: string },
): Promise<BrokerConnectionRow> {
  const cleared = { tokenCiphertext: null, signedInAt: null, tokenExpiresAt: null, lastErrorCode: null };
  const [row] = await db.insert(brokerConnection)
    .values({ id: crypto.randomUUID(), ...v, ...cleared })
    .onConflictDoUpdate({
      target: [brokerConnection.workspaceId, brokerConnection.broker],
      set: { credentialsCiphertext: v.credentialsCiphertext, keyLast4: v.keyLast4, savedByUserId: v.savedByUserId, savedAt: sql`now()`, ...cleared },
    })
    .returning();
  return row!;
}

/** Disconnect: forgets the credentials and the token, keeps the account and what it read. */
export async function forgetBrokerCredentials(db: Db, id: string): Promise<void> {
  await db.update(brokerConnection).set({ credentialsCiphertext: null, keyLast4: null, tokenCiphertext: null, tokenExpiresAt: null, lastErrorCode: null }).where(eq(brokerConnection.id, id));
}

/** Keeps the session from a sign-in. */
export async function saveBrokerSession(
  db: Db,
  id: string,
  s: { accountId: string | null; tokenCiphertext: string; signedInAt: Date; tokenExpiresAt: Date },
): Promise<void> {
  await db.update(brokerConnection).set({ ...s, lastErrorCode: null }).where(eq(brokerConnection.id, id));
}

/** Marks the account; BROKER_SIGNED_OUT also drops the token, which no longer works. */
export async function markBrokerError(db: Db, id: string, code: string): Promise<void> {
  const signedOut = code === "BROKER_SIGNED_OUT";
  await db.update(brokerConnection).set({ lastErrorCode: code, ...(signedOut ? { tokenCiphertext: null } : {}) }).where(eq(brokerConnection.id, id));
}

export async function createBrokerLoginState(db: Db, row: BrokerLoginStateRow): Promise<void> {
  await db.insert(brokerLoginState).values(row);
}

/** Takes a login nonce once: it is deleted whether or not it is still valid. Null if gone or expired. */
export async function takeBrokerLoginState(db: Db, nonce: string, now: Date): Promise<BrokerLoginStateRow | null> {
  const [row] = await db.delete(brokerLoginState).where(eq(brokerLoginState.nonce, nonce)).returning();
  if (!row || row.expiresAt <= now) return null;
  return row;
}

export async function startHoldingRead(db: Db, connectionId: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(holdingRead).values({ id, connectionId, state: "running" });
  return id;
}

/** Ends a read: ok with its lines (written together), or failed with a code. */
export async function finishHoldingRead(
  db: Db,
  id: string,
  result: { ok: true; lines: Omit<NewHoldingLine, "readId">[] } | { ok: false; errorCode: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (result.ok && result.lines.length) await tx.insert(holdingLine).values(result.lines.map((l) => ({ ...l, readId: id })));
    await tx.update(holdingRead).set(
      result.ok ? { state: "ok", finishedAt: sql`now()`, lineCount: result.lines.length } : { state: "failed", finishedAt: sql`now()`, errorCode: result.errorCode },
    ).where(eq(holdingRead.id, id));
  });
}

export type LatestHoldings = { connectionId: string; lastRead: HoldingReadRow | null; lastOk: HoldingReadRow | null; lines: HoldingLineRow[] };

/** Per account: its latest finished read, and its latest good read with that read's lines. */
export async function latestHoldings(db: Db, connectionIds: string[]): Promise<LatestHoldings[]> {
  if (connectionIds.length === 0) return [];
  const reads = await db.select().from(holdingRead)
    .where(and(inArray(holdingRead.connectionId, connectionIds), sql`${holdingRead.state} <> 'running'`))
    .orderBy(desc(holdingRead.startedAt));
  const out: LatestHoldings[] = [];
  for (const connectionId of connectionIds) {
    const mine = reads.filter((r) => r.connectionId === connectionId);
    const lastOk = mine.find((r) => r.state === "ok") ?? null;
    const lines = lastOk ? await db.select().from(holdingLine).where(eq(holdingLine.readId, lastOk.id)) : [];
    out.push({ connectionId, lastRead: mine[0] ?? null, lastOk, lines });
  }
  return out;
}

/** True when a read for the account started within `ms`; used to refuse a burst of reads. */
export async function readStartedSince(db: Db, connectionId: string, since: Date): Promise<boolean> {
  const [row] = await db.select({ id: holdingRead.id }).from(holdingRead).where(and(eq(holdingRead.connectionId, connectionId), gt(holdingRead.startedAt, since))).limit(1);
  return Boolean(row);
}

/**
 * The latest stored NSE close for each symbol (series "eq:<SYMBOL>"). The value is the text
 * Postgres prints for the stored double, so no JavaScript float passes through on the way.
 */
export async function latestCloses(db: Db, symbols: string[]): Promise<Record<string, { day: string; value: string; source: string }>> {
  if (symbols.length === 0) return {};
  const series = symbols.map((s) => `eq:${s}`);
  const rows = await db.selectDistinctOn([marketPoint.series], {
    series: marketPoint.series, day: marketPoint.day, value: sql<string>`${marketPoint.value}::text`, source: marketPoint.source,
  }).from(marketPoint).where(inArray(marketPoint.series, series)).orderBy(marketPoint.series, desc(marketPoint.day));
  return Object.fromEntries(rows.map((r) => [r.series.slice(3), { day: r.day, value: r.value, source: r.source }]));
}
