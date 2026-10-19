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

/** Seconds to wait before a failed attempt runs again: 30 s doubling to 900 s, plus up to 20% jitter. */
export function backoffSeconds(attempt: number, random: () => number = Math.random): number {
  return Math.min(900, 30 * 2 ** (attempt - 1)) * (1 + 0.2 * random());
}

/**
 * Take the oldest ready job of one type, in one statement. SKIP LOCKED lets concurrent
 * claimers pass over a row another claimer holds instead of waiting on it.
 */
export async function claimNext(db: Db, type: string, leaseSeconds: number): Promise<JobRow | null> {
  const [row] = await db
    .update(schema.job)
    .set({
      state: "running",
      leaseToken: crypto.randomUUID(),
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds}::int)`,
      attempt: sql`${schema.job.attempt} + 1`,
      startedAt: sql`coalesce(${schema.job.startedAt}, now())`,
      updatedAt: sql`now()`,
    })
    .where(
      sql`${schema.job.id} = (
        select ${schema.job.id} from ${schema.job}
        where ${schema.job.type} = ${type} and ${schema.job.state} = 'queued' and ${schema.job.runAfter} <= now()
        order by ${schema.job.runAfter}, ${schema.job.createdAt}
        for update skip locked
        limit 1
      )`,
    )
    .returning();
  return row ?? null;
}

/** Push the lease expiry forward while a long handler is still working. */
export async function renewLease(db: Db, jobId: string, leaseToken: string, leaseSeconds: number): Promise<boolean> {
  const rows = await db
    .update(schema.job)
    .set({ leaseExpiresAt: sql`now() + make_interval(secs => ${leaseSeconds}::int)`, updatedAt: sql`now()` })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.leaseToken, leaseToken)))
    .returning({ id: schema.job.id });
  return rows.length === 1;
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
      ...(final ? {} : { runAfter: sql`now() + make_interval(secs => ${backoffSeconds(job.attempt)}::double precision)` }),
      updatedAt: sql`now()`,
    })
    .where(and(eq(schema.job.id, job.id), eq(schema.job.leaseToken, leaseToken)));
}

/**
 * Give back every job whose lease ran out (a worker died or stalled). One statement per
 * outcome, each guarded by `lease_expires_at < now()`, so a job renewed meanwhile is untouched.
 * The backoff is worked out in SQL from each row's own attempt, with the same formula and
 * jitter as `backoffSeconds`: least(900, 30 * 2^(attempt-1)) * (1 + 0.2 * random()).
 */
export async function sweepExpired(db: Db): Promise<{ requeued: JobRow[]; failed: JobRow[] }> {
  const expired = and(eq(schema.job.state, "running"), lt(schema.job.leaseExpiresAt, sql`now()`));
  const cleared = { leaseToken: null, leaseExpiresAt: null, lastErrorCode: "LEASE_EXPIRED", updatedAt: sql`now()` };
  const requeued = await db
    .update(schema.job)
    .set({
      ...cleared,
      state: "queued",
      runAfter: sql`now() + make_interval(secs => least(900, 30 * power(2, greatest(${schema.job.attempt} - 1, 0))) * (1 + 0.2 * random()))`,
    })
    .where(and(expired, sql`${schema.job.attempt} < ${schema.job.maxAttempts}`))
    .returning();
  const failed = await db
    .update(schema.job)
    .set({ ...cleared, state: "failed", finishedAt: sql`now()` })
    .where(and(expired, sql`${schema.job.attempt} >= ${schema.job.maxAttempts}`))
    .returning();
  return { requeued, failed };
}
