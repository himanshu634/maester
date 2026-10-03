import { and, eq, sql } from "drizzle-orm";
import { getJob, schema, type Db, type JobRow } from "@maester/db";
import { createJob as createSharedJob, DEFAULT_MAX_ATTEMPTS, JobScopeConflictError, type CreateJobInput } from "@maester/jobs";
import type { Dispatcher } from "../dispatch/index.js";
import { HttpError } from "../errors.js";

export { DEFAULT_MAX_ATTEMPTS };
export const STUCK_QUEUED_MS = 5 * 60 * 1000;

export async function createJob(db: Db, dispatcher: Dispatcher, input: CreateJobInput): Promise<JobRow> {
  try {
    return await createSharedJob(db, dispatcher, input);
  } catch (err) {
    if (err instanceof JobScopeConflictError) throw new HttpError("CONFLICT", err.message);
    throw err;
  }
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
      finishedAt: null,
      progress: {},
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
