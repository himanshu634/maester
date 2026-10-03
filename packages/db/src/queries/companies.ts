import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { decodeCursor, encodeCursor } from "../pagination.js";
import { company, type CompanyRow } from "../schema/platform.js";

export async function getCompany(db: Db, workspaceId: string, id: string): Promise<CompanyRow | null> {
  const rows = await db.select().from(company).where(and(eq(company.workspaceId, workspaceId), eq(company.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listCompanies(
  db: Db,
  workspaceId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: CompanyRow[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const where = cursor
    ? and(
        eq(company.workspaceId, workspaceId),
        or(lt(company.createdAt, cursor.createdAt), and(eq(company.createdAt, cursor.createdAt), lt(company.id, cursor.id))),
      )
    : eq(company.workspaceId, workspaceId);
  const rows = await db
    .select()
    .from(company)
    .where(where)
    .orderBy(desc(company.createdAt), desc(company.id))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > opts.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { items, nextCursor };
}
