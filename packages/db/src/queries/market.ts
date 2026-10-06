import { and, asc, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { marketFetch, marketPoint, type MarketFetchRow, type MarketPointRow, type NewMarketPoint } from "../schema/market.js";

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
