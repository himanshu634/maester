import { and, eq, lt, or, sql } from "drizzle-orm";
import { schema, type Db, type JobProgressJson, type JobRow } from "@maester/db";

export async function acquireLease(db: Db, jobId: string, leaseSeconds: number): Promise<JobRow | null> {
  const leaseToken = crypto.randomUUID();
  const [row] = await db
    .update(schema.job)
    .set({
      state: "running",
      leaseToken,
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds}::int)`,
      attempt: sql`${schema.job.attempt} + 1`,
      startedAt: sql`coalesce(${schema.job.startedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        or(eq(schema.job.state, "queued"), and(eq(schema.job.state, "running"), lt(schema.job.leaseExpiresAt, sql`now()`))),
      ),
    )
    .returning();
  return row ?? null;
}

export async function writeProgress(db: Db, jobId: string, leaseToken: string, progress: JobProgressJson): Promise<void> {
  await db
    .update(schema.job)
    .set({ progress, updatedAt: sql`now()` })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.leaseToken, leaseToken)));
}

export async function completeJob(db: Db, jobId: string, leaseToken: string, result: unknown): Promise<boolean> {
  const rows = await db
    .update(schema.job)
    .set({ state: "succeeded", result, leaseToken: null, leaseExpiresAt: null, finishedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.leaseToken, leaseToken)))
    .returning({ id: schema.job.id });
  return rows.length === 1;
}

export async function failAttempt(
  db: Db,
  job: JobRow,
  leaseToken: string,
  err: { code: string; message: string },
  final: boolean,
): Promise<void> {
  await db
    .update(schema.job)
    .set({
      state: final ? "failed" : "queued",
      lastErrorCode: err.code,
      lastErrorMessage: err.message.slice(0, 2000),
      leaseToken: null,
      leaseExpiresAt: null,
      finishedAt: final ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(schema.job.id, job.id), eq(schema.job.leaseToken, leaseToken)));
}
