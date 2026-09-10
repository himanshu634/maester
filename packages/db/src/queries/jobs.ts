import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { job, type JobRow } from "../schema/platform.js";

export async function getJob(db: Db, workspaceId: string, id: string): Promise<JobRow | null> {
  const rows = await db.select().from(job).where(and(eq(job.workspaceId, workspaceId), eq(job.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function getLatestJobForSubject(
  db: Db,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(job)
    .where(and(eq(job.workspaceId, workspaceId), eq(job.subjectType, subjectType), eq(job.subjectId, subjectId)))
    .orderBy(desc(job.createdAt), desc(job.id))
    .limit(1);
  return rows[0] ?? null;
}
