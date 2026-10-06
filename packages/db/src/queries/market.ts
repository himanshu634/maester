import { and, asc, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  marketConnection, marketFetch, marketPoint,
  type MarketConnectionProvider, type MarketConnectionRow, type MarketFetchRow, type MarketPointRow, type NewMarketPoint,
} from "../schema/market.js";

const CHUNK = 1000;

export async function upsertMarketPoints(db: Db, rows: NewMarketPoint[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(marketPoint).values(rows.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [marketPoint.series, marketPoint.day],
      set: { value: sql`excluded.value`, source: sql`excluded.source`, fetchedAt: sql`now()` },
    });
  }
  return rows.length;
}

function group(rows: MarketPointRow[], keys: string[] = []): Record<string, MarketPointRow[]> {
  const out: Record<string, MarketPointRow[]> = Object.fromEntries(keys.map((k) => [k, []]));
  for (const row of rows) (out[row.series] ??= []).push(row);
  return out;
}

export async function listMarketSeries(db: Db, series: string[], fromDay: string): Promise<Record<string, MarketPointRow[]>> {
  if (series.length === 0) return {};
  const rows = await db.select().from(marketPoint)
    .where(and(inArray(marketPoint.series, series), gte(marketPoint.day, fromDay)))
    .orderBy(asc(marketPoint.series), asc(marketPoint.day));
  return group(rows, series);
}

export async function listMarketSeriesByPrefix(db: Db, prefix: string, fromDay: string): Promise<Record<string, MarketPointRow[]>> {
  const rows = await db.select().from(marketPoint)
    .where(and(like(marketPoint.series, `${prefix}%`), gte(marketPoint.day, fromDay)))
    .orderBy(asc(marketPoint.series), asc(marketPoint.day));
  return group(rows);
}

/** Day and value only, for series starting with `prefix`, from `fromDay` to `toDay` inclusive, oldest first. */
export async function listMarketValuesByPrefix(db: Db, prefix: string, fromDay: string, toDay: string): Promise<Record<string, { day: string; value: number }[]>> {
  const rows = await db.select({ series: marketPoint.series, day: marketPoint.day, value: marketPoint.value }).from(marketPoint)
    .where(and(like(marketPoint.series, `${prefix}%`), gte(marketPoint.day, fromDay), lte(marketPoint.day, toDay)))
    .orderBy(asc(marketPoint.series), asc(marketPoint.day));
  const out: Record<string, { day: string; value: number }[]> = {};
  for (const r of rows) (out[r.series] ??= []).push({ day: r.day, value: r.value });
  return out;
}

export async function latestMarketDay(db: Db, series: string): Promise<string | null> {
  const [row] = await db.select({ day: sql<string | null>`max(${marketPoint.day})` }).from(marketPoint).where(eq(marketPoint.series, series));
  return row?.day ?? null;
}

/** Starts a run unless another started less than an hour ago is still running. Returns its id, or null. */
export async function startMarketFetch(db: Db): Promise<string | null> {
  const id = crypto.randomUUID();
  const res = await db.execute(sql`
    insert into market_fetch (id, state)
    select ${id}::uuid, 'running'
    where not exists (select 1 from market_fetch where state = 'running' and started_at > now() - interval '1 hour')
    returning id`);
  return res.rows.length ? id : null;
}

export async function finishMarketFetch(db: Db, id: string, outcome: { state: "ok" | "failed"; pointsWritten: number; errorCode?: string; errorMessage?: string }): Promise<void> {
  await db.update(marketFetch).set({
    state: outcome.state, finishedAt: new Date(), pointsWritten: outcome.pointsWritten,
    errorCode: outcome.errorCode ?? null, errorMessage: outcome.errorMessage ?? null,
  }).where(eq(marketFetch.id, id));
}

export async function latestMarketFetch(db: Db): Promise<MarketFetchRow | null> {
  const [row] = await db.select().from(marketFetch).orderBy(desc(marketFetch.startedAt)).limit(1);
  return row ?? null;
}

export async function getConnection(db: Db, provider: MarketConnectionProvider): Promise<MarketConnectionRow | null> {
  const [row] = await db.select().from(marketConnection).where(eq(marketConnection.provider, provider));
  return row ?? null;
}

/** Saved connections, Dhan first. */
export async function listConnections(db: Db): Promise<MarketConnectionRow[]> {
  return db.select().from(marketConnection).orderBy(asc(marketConnection.provider));
}

export type SaveConnection = Pick<MarketConnectionRow, "provider" | "clientId" | "secretCiphertext" | "secretLast4" | "expiresAt" | "checkedAt" | "savedByUserId"> & {
  /** What the save's own check found, e.g. "DHAN_NO_DATA_PLAN". Default null: a save clears the last error. */
  lastErrorCode?: string | null;
};

/** Inserts or replaces a provider's connection, setting last_error_code (null unless given) and saved_at to now. */
export async function saveConnection(db: Db, row: SaveConnection): Promise<MarketConnectionRow> {
  const values = { ...row, lastErrorCode: row.lastErrorCode ?? null, savedAt: new Date() };
  const [saved] = await db.insert(marketConnection).values(values).onConflictDoUpdate({
    target: marketConnection.provider,
    set: {
      clientId: values.clientId, secretCiphertext: values.secretCiphertext, secretLast4: values.secretLast4,
      expiresAt: values.expiresAt, checkedAt: values.checkedAt, lastErrorCode: values.lastErrorCode, savedAt: values.savedAt, savedByUserId: values.savedByUserId,
    },
  }).returning();
  return saved!;
}

/** True when a row was removed. */
export async function deleteConnection(db: Db, provider: MarketConnectionProvider): Promise<boolean> {
  const rows = await db.delete(marketConnection).where(eq(marketConnection.provider, provider)).returning({ provider: marketConnection.provider });
  return rows.length > 0;
}

/** For the refresher: records what the source said on its last call (null after a good call). */
export async function markConnectionError(db: Db, provider: MarketConnectionProvider, code: string | null): Promise<void> {
  await db.update(marketConnection).set({ lastErrorCode: code }).where(eq(marketConnection.provider, provider));
}

/** When each source's readings were last stored, from market_point.source ("Dhan · …", "FRED · …"). */
export async function lastMarketReads(db: Db): Promise<Record<MarketConnectionProvider, Date | null>> {
  const [row] = await db.select({
    dhan: sql<string | null>`max(${marketPoint.fetchedAt}) filter (where ${marketPoint.source} like 'Dhan ·%')`,
    fred: sql<string | null>`max(${marketPoint.fetchedAt}) filter (where ${marketPoint.source} like 'FRED ·%')`,
  }).from(marketPoint);
  const at = (v: string | null | undefined) => (v ? new Date(v) : null);
  return { dhan: at(row?.dhan), fred: at(row?.fred) };
}
