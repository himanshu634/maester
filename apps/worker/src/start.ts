import { and, eq, notInArray, sql } from "drizzle-orm";
import { schema, type Db } from "@maester/db";
import type { WorkerEnv } from "./env.js";
import type { JobHandler } from "./jobs/types.js";
import type { Logger } from "./logger.js";
import { parseConcurrency, pgListen, type QueueRunnerOptions } from "./queue.js";

/** The queue runner's options from the environment. Throws on a bad JOB_CONCURRENCY, so start-up fails with its message. */
export function buildQueueOptions(env: WorkerEnv, handlers: Record<string, JobHandler>, logger: Logger): QueueRunnerOptions {
  return {
    concurrency: parseConcurrency(env.JOB_CONCURRENCY, Object.keys(handlers)),
    pollMs: env.JOB_POLL_MS,
    sweepMs: env.JOB_SWEEP_MS,
    listen: pgListen(env.DATABASE_URL, logger),
  };
}

/** Logs once per type that has queued jobs but no handler in this worker: the type and the count only. */
export async function logUnhandledQueued(db: Db, handlerTypes: string[], logger: Logger): Promise<{ type: string; count: number }[]> {
  const rows = await db
    .select({ type: schema.job.type, count: sql<number>`count(*)::int` })
    .from(schema.job)
    .where(handlerTypes.length ? and(eq(schema.job.state, "queued"), notInArray(schema.job.type, handlerTypes)) : eq(schema.job.state, "queued"))
    .groupBy(schema.job.type);
  for (const row of rows) logger.warn({ type: row.type, count: row.count }, "queued jobs of a type this worker has no handler for");
  return rows;
}
