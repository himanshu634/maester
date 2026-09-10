import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { decodeCursor, encodeCursor } from "../pagination.js";
import { document, type DocumentRow } from "../schema/platform.js";

export async function getDocument(db: Db, workspaceId: string, id: string): Promise<DocumentRow | null> {
  const rows = await db.select().from(document).where(and(eq(document.workspaceId, workspaceId), eq(document.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function listDocuments(
  db: Db,
  workspaceId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: DocumentRow[]; nextCursor: string | null }> {
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;
  const where = cursor
    ? and(
        eq(document.workspaceId, workspaceId),
        or(lt(document.createdAt, cursor.createdAt), and(eq(document.createdAt, cursor.createdAt), lt(document.id, cursor.id))),
      )
    : eq(document.workspaceId, workspaceId);
  const rows = await db
    .select()
    .from(document)
    .where(where)
    .orderBy(desc(document.createdAt), desc(document.id))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > opts.limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  return { items, nextCursor };
}

export const documentUpdatedNow = sql`now()`;
