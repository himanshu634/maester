import { and, eq } from "drizzle-orm";
import { schema, type Db, type JobRow } from "@maester/db";
import type { Dispatcher } from "./dispatch.js";

export const DEFAULT_MAX_ATTEMPTS = 5;

/** The idempotency key already belongs to a job in another workspace. */
export class JobScopeConflictError extends Error {
  constructor() {
    super("job exists in another scope");
    this.name = "JobScopeConflictError";
  }
}

export interface CreateJobInput {
  workspaceId: string;
  type: string;
  subjectType: string;
  subjectId: string;
  /** Distinguishes runs of the same job type on the same subject; defaults to "1". */
  pipelineVersion?: string;
}

/**
 * Insert a queued job and dispatch it, or return the existing job with the
 * same idempotency key (`type:subjectId:pipelineVersion`) without dispatching again.
 */
export async function createJob(db: Db, dispatcher: Dispatcher, input: CreateJobInput): Promise<JobRow> {
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
  if (!existing[0]) throw new JobScopeConflictError();
  return existing[0];
}
