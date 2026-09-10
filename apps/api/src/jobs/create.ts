import { and, eq, sql } from "drizzle-orm";
import { getJob, schema, type Db, type JobRow } from "@maester/db";
import type { Dispatcher } from "../dispatch/index.js";
import { HttpError } from "../errors.js";

export const DEFAULT_MAX_ATTEMPTS = 5;
export const STUCK_QUEUED_MS = 5 * 60 * 1000;

export async function createJob(
  db: Db,
  dispatcher: Dispatcher,
  input: { workspaceId: string; type: string; subjectType: string; subjectId: string; pipelineVersion?: string },
): Promise<JobRow> {
  const idempotencyKey = `${input.type}:${input.subjectId}:${input.pipelineVersion ?? "1"}`;
  const inserted = await db
    .insert(schema.job)
    .values({
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      idempotencyKey,
      state: "queued",
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
    })
    .onConflictDoNothing({ target: schema.job.idempotencyKey })
    .returning();

  if (inserted[0]) {
    await dispatcher.enqueue(inserted[0]);
    return inserted[0];
  }
  const existing = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.idempotencyKey, idempotencyKey), eq(schema.job.workspaceId, input.workspaceId)))
    .limit(1);
  if (!existing[0]) throw new HttpError("CONFLICT", "job exists in another scope");
  return existing[0];
}

export async function retryJob(db: Db, dispatcher: Dispatcher, workspaceId: string, jobId: string): Promise<JobRow> {
  const current = await getJob(db, workspaceId, jobId);
  if (!current) throw new HttpError("NOT_FOUND", "job not found");
  const stuckBefore = new Date(Date.now() - STUCK_QUEUED_MS);
  const [updated] = await db
    .update(schema.job)
    .set({
      state: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
      maxAttempts: sql`${schema.job.attempt} + ${DEFAULT_MAX_ATTEMPTS}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        eq(schema.job.workspaceId, workspaceId),
        sql`(${schema.job.state} = 'failed' OR (${schema.job.state} = 'queued' AND ${schema.job.updatedAt} < ${stuckBefore}))`,
      ),
    )
    .returning();
  if (!updated) throw new HttpError("INVALID_STATE", `job is ${current.state} and cannot be retried`);
  await dispatcher.enqueue(updated);
  return updated;
}
