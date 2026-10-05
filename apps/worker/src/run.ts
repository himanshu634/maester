import { eq } from "drizzle-orm";
import { schema, type Db } from "@maester/db";
import type { Dispatcher } from "@maester/jobs";
import type { ObjectStore } from "@maester/storage";
import type { WorkerEnv } from "./env.js";
import type { ExtractorClient } from "./extractor.js";
import { JobFailure, type JobHandler } from "./jobs/types.js";
import { acquireLease, completeJob, failAttempt, renewLease, writeProgress } from "./lease.js";
import type { Logger } from "./logger.js";

export interface WorkerDeps {
  db: Db;
  store: ObjectStore;
  logger: Logger;
  env: WorkerEnv;
  handlers: Record<string, JobHandler>;
  dispatcher: Dispatcher;
  extractor: ExtractorClient | null;
}

/** Minimum gap between lease renewals triggered by heartbeat(). */
export const HEARTBEAT_THROTTLE_MS = 5_000;

export type RunResult = { status: 200 | 409 | 500; body: { jobId: string; outcome: string } };

export async function runJob(deps: WorkerDeps, type: string, jobId: string): Promise<RunResult> {
  const log = deps.logger.child({ jobId, type });
  const [existing] = await deps.db.select().from(schema.job).where(eq(schema.job.id, jobId)).limit(1);
  if (!existing) {
    log.warn("job not found; acking");
    return { status: 200, body: { jobId, outcome: "missing" } };
  }
  if (existing.state === "succeeded" || existing.state === "failed" || existing.state === "cancelled") {
    return { status: 200, body: { jobId, outcome: existing.state } };
  }

  const job = await acquireLease(deps.db, jobId, deps.env.LEASE_SECONDS);
  if (!job) {
    log.info("lease held elsewhere");
    return { status: 409, body: { jobId, outcome: "lease_held" } };
  }
  const leaseToken = job.leaseToken!;
  const startedAt = Date.now();

  const handler = deps.handlers[job.type];
  if (!handler) {
    await failAttempt(deps.db, job, leaseToken, { code: "UNKNOWN_JOB_TYPE", message: `no handler for ${job.type}` }, true);
    log.error("unknown job type");
    return { status: 200, body: { jobId, outcome: "failed" } };
  }

  try {
    log.info({ attempt: job.attempt }, "job started");
    let lastRenewal = Date.now();
    const result = await handler(job, {
      db: deps.db,
      store: deps.store,
      logger: log,
      env: deps.env,
      dispatcher: deps.dispatcher,
      extractor: deps.extractor,
      progress: (p) => writeProgress(deps.db, job.id, leaseToken, p),
      heartbeat: async () => {
        if (Date.now() - lastRenewal < HEARTBEAT_THROTTLE_MS) return;
        lastRenewal = Date.now();
        await renewLease(deps.db, job.id, leaseToken, deps.env.LEASE_SECONDS);
      },
    });
    const ok = await completeJob(deps.db, job.id, leaseToken, result ?? null);
    log.info({ durationMs: Date.now() - startedAt, ok }, "job succeeded");
    return { status: 200, body: { jobId, outcome: ok ? "succeeded" : "lease_lost" } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof JobFailure ? err.code : "HANDLER_ERROR";
    const permanent = err instanceof JobFailure && !err.retryable;
    const final = permanent || job.attempt >= job.maxAttempts;
    await failAttempt(deps.db, job, leaseToken, { code, message }, final);
    if (final && handler.onFinalFailure) {
      try {
        await handler.onFinalFailure(job, deps.db);
      } catch (hookErr) {
        log.error({ err: (hookErr as Error).message }, "final-failure hook failed");
      }
    }
    log.error({ durationMs: Date.now() - startedAt, attempt: job.attempt, final, code, err: message }, "job attempt failed");
    return final ? { status: 200, body: { jobId, outcome: "failed" } } : { status: 500, body: { jobId, outcome: "retry" } };
  }
}
