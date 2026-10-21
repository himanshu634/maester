import pg from "pg";
import type { JobRow } from "@maester/db";
import { claimNext, releaseLease, sweepExpired } from "./lease.js";
import type { Logger } from "./logger.js";
import { executeJob, type WorkerDeps } from "./run.js";

/** Jobs of a type one worker runs at once, unless JOB_CONCURRENCY says otherwise. Any other type runs one at a time. */
export const DEFAULT_CONCURRENCY: Readonly<Record<string, number>> = Object.freeze({
  "document.verify": 4,
  "document.classify": 2,
  "document.extract": 2,
  "document.index": 1,
  "document.xbrl": 2,
  "document.xbrl_check": 2,
});

/** Opens a wake-up source; calls onReady(type) when a job of that type may be ready. Resolves to its close function. */
export type Listen = (onReady: (type: string) => void) => Promise<() => Promise<void>>;

export interface QueueRunnerOptions {
  concurrency: Record<string, number>;
  pollMs: number;
  sweepMs: number;
  listen: Listen;
}

export interface QueueRunner {
  /**
   * Stop claiming at once, then wait up to graceMs for running jobs. A job still running after that is given
   * back (`releaseLease`: queued, its attempt restored), so a restart costs it no attempt. Resolves even if
   * some handlers are still running.
   */
  stop(graceMs: number): Promise<void>;
  /** Jobs running now, by type. */
  running(): Record<string, number>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Limits for `types`: the defaults, then "type=limit,type=limit" over them. A limit must be a whole number of at least 1. */
export function parseConcurrency(spec: string | undefined, types: string[]): Record<string, number> {
  const limits = Object.fromEntries(types.map((t) => [t, DEFAULT_CONCURRENCY[t] ?? 1]));
  const entries = (spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const m = /^([^=\s]+)\s*=\s*(\S+)$/.exec(entry);
    if (!m) throw new Error(`JOB_CONCURRENCY: "${entry}" is not type=limit`);
    const type = m[1]!, raw = m[2]!;
    if (!types.includes(type)) throw new Error(`JOB_CONCURRENCY: this worker has no job type ${type}`);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`JOB_CONCURRENCY: the limit for ${type} must be a whole number of at least 1, not "${raw}"`);
    limits[type] = Number(raw);
  }
  return limits;
}

/**
 * One claim loop per handled job type. A loop claims while its type runs fewer jobs than its limit,
 * starting each without waiting for it; with nothing to claim it sleeps until the poll interval passes,
 * a notification for its type arrives or one of its jobs finishes. A sweep gives back expired leases.
 */
export function startQueueRunner(deps: WorkerDeps, opts: QueueRunnerOptions): QueueRunner {
  const log = deps.logger.child({ component: "queue" });
  const types = Object.keys(deps.handlers);
  const handled = new Set(types);
  const inFlight: Record<string, number> = Object.fromEntries(types.map((t) => [t, 0]));
  const jobs = new Set<Promise<void>>();
  // The lease of each job running in this process, so stop can give back the ones still running after the grace.
  const held = new Map<string, string>();
  const wakers = new Map<string, () => void>();
  const pendingWake = new Set<string>();
  const sleepers = new Set<() => void>();
  let stopped = false;

  // A wake that comes while the loop is busy (mid-claim) is kept, so its next sleep returns at once.
  const wake = (type: string) => {
    const waker = wakers.get(type);
    if (waker) waker();
    else pendingWake.add(type);
  };

  // Wait up to ms. A wake for the type ends a wakeable sleep early; stop ends any sleep.
  const sleep = (type: string, ms: number, wakeable: boolean) =>
    new Promise<void>((resolve) => {
      if (stopped || (wakeable && pendingWake.delete(type))) return resolve();
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        if (wakers.get(type) === done) wakers.delete(type);
        resolve();
      };
      const timer = setTimeout(done, ms);
      sleepers.add(done);
      if (wakeable) wakers.set(type, done);
    });

  const start = (job: JobRow) => {
    inFlight[job.type] = (inFlight[job.type] ?? 0) + 1;
    held.set(job.id, job.leaseToken!);
    const run: Promise<void> = executeJob(deps, job)
      .then(() => undefined)
      .catch((err: unknown) => log.error({ type: job.type, jobId: job.id, err: message(err) }, "job execution threw"))
      .finally(() => {
        inFlight[job.type] = (inFlight[job.type] ?? 1) - 1;
        held.delete(job.id);
        jobs.delete(run);
        wake(job.type);
      });
    jobs.add(run);
  };

  const loop = async (type: string) => {
    const limit = opts.concurrency[type] ?? DEFAULT_CONCURRENCY[type] ?? 1;
    while (!stopped) {
      if ((inFlight[type] ?? 0) >= limit) {
        await sleep(type, opts.pollMs, true);
        continue;
      }
      let job: JobRow | null;
      try {
        job = await claimNext(deps.db, type, deps.env.LEASE_SECONDS);
      } catch (err) {
        log.error({ type, err: message(err) }, "claim failed");
        await sleep(type, opts.pollMs, false);
        continue;
      }
      // A claim already sent when stop was called still runs its job, so its lease is not left to expire.
      if (job) start(job);
      else await sleep(type, opts.pollMs, true);
    }
  };

  const sweep = async () => {
    try {
      const { requeued, failed } = await sweepExpired(deps.db);
      if (requeued.length || failed.length) {
        log.warn({ requeued: requeued.length, failed: failed.length, jobIds: [...requeued, ...failed].map((j) => j.id) }, "expired leases swept");
      }
      for (const job of failed) {
        try {
          await deps.handlers[job.type]?.onFinalFailure?.(job, { db: deps.db, dispatcher: deps.dispatcher });
        } catch (err) {
          log.error({ type: job.type, jobId: job.id, err: message(err) }, "final-failure hook failed");
        }
      }
    } catch (err) {
      log.error({ err: message(err) }, "sweep failed");
    }
  };
  let sweepTimer: NodeJS.Timeout | undefined;
  let sweeping: Promise<void> = Promise.resolve();
  const scheduleSweep = () => {
    if (stopped) return;
    sweepTimer = setTimeout(() => {
      sweeping = sweep().finally(scheduleSweep);
    }, opts.sweepMs);
  };

  const listening = opts
    .listen((type) => {
      if (!stopped && handled.has(type)) wake(type);
    })
    .catch((err: unknown) => {
      log.error({ err: message(err) }, "job listener did not start; polling only");
      return null;
    });
  const loops = types.map((type) => loop(type).catch((err: unknown) => log.error({ type, err: message(err) }, "claim loop stopped")));
  scheduleSweep();
  log.info({ types: Object.fromEntries(types.map((t) => [t, opts.concurrency[t] ?? DEFAULT_CONCURRENCY[t] ?? 1])) }, "queue runner started");

  let shutdown: Promise<void> | undefined;
  const running = () => ({ ...inFlight });
  return {
    running,
    async stop(graceMs) {
      stopped = true;
      clearTimeout(sweepTimer);
      for (const done of [...sleepers]) done();
      shutdown ??= (async () => {
        await Promise.allSettled(loops);
        await sweeping;
        const close = await listening;
        if (close) await close().catch((err: unknown) => log.error({ err: message(err) }, "closing the job listener failed"));
      })();
      let graceTimer: NodeJS.Timeout | undefined;
      const grace = new Promise<void>((resolve) => (graceTimer = setTimeout(resolve, graceMs)));
      await Promise.race([shutdown.then(() => Promise.allSettled([...jobs])), grace]);
      clearTimeout(graceTimer);
      if (!held.size) return;
      const left = [...held];
      const released = await Promise.all(
        left.map(([jobId, leaseToken]) =>
          releaseLease(deps.db, jobId, leaseToken).catch((err: unknown) => {
            log.error({ jobId, err: message(err) }, "could not give back the lease of a running job");
            return false;
          }),
        ),
      );
      log.warn(
        { running: running(), released: left.filter((_, i) => released[i]).map(([jobId]) => jobId), kept: left.filter((_, i) => !released[i]).map(([jobId]) => jobId) },
        "stopped with jobs still running; gave their leases back",
      );
    },
  };
}

/** The Postgres wake-up source: LISTEN job_ready on a dedicated connection, reconnecting after 1 s doubling to 30 s. */
export function pgListen(connectionString: string, logger: Logger): Listen {
  return async (onReady) => {
    const log = logger.child({ component: "job-listener" });
    let closed = false;
    let current: pg.Client | null = null;
    let retryMs = 1_000;
    let retryTimer: NodeJS.Timeout | undefined;

    // error and end both fire when a connection dies; only the first, on the current client, reconnects.
    const lost = (client: pg.Client, reason: string) => {
      if (client !== current) return;
      current = null;
      client.end().catch(() => {});
      if (closed) return;
      const wait = retryMs;
      retryMs = Math.min(retryMs * 2, 30_000);
      log.warn({ err: reason, retryInMs: wait }, "job listener lost; reconnecting");
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        connecting = connect();
      }, wait);
    };

    const connect = async () => {
      if (closed) return;
      const client = new pg.Client({ connectionString, application_name: "maester-job-listener", connectionTimeoutMillis: 10_000 });
      current = client;
      client.on("error", (err) => lost(client, err.message));
      client.on("end", () => lost(client, "connection ended"));
      client.on("notification", (n) => {
        if (n.channel === "job_ready" && n.payload) onReady(n.payload);
      });
      try {
        await client.connect();
        await client.query("LISTEN job_ready");
        if (client === current) {
          retryMs = 1_000;
          log.info("listening for job_ready");
        }
      } catch (err) {
        lost(client, message(err));
      }
    };

    // A database that is down at start does not hold this up: the first failure goes to the retry schedule.
    let connecting = connect();
    await connecting;
    return async () => {
      closed = true;
      clearTimeout(retryTimer);
      await connecting;
      const client = current;
      current = null;
      if (client) await client.end().catch(() => {});
    };
  };
}
