import { sql } from "drizzle-orm";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { Db, JobRow } from "@maester/db";
import { JobFailure, type JobHandler } from "../src/jobs/types.js";
import { DEFAULT_CONCURRENCY, parseConcurrency, pgListen, startQueueRunner } from "../src/queue.js";
import { countState, createWorkerContext, seedJob, seedWorkspace, waitFor } from "./context.js";

const noListen = async () => async () => {};

function captureLogger() {
  const lines: { level: number; msg: string; [k: string]: unknown }[] = [];
  const logger = pino({ level: "debug" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
  return { logger, lines };
}

/** A db whose first `failures` calls to `method` throw, as if the database were down. */
function flakyDb(db: Db, method: "update", failures: number): Db {
  let left = failures;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === method && left > 0) {
        left--;
        return () => {
          throw new Error("connection refused");
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("queue runner", () => {
  it("never runs more jobs of a type at once than its limit, and finishes them all", async () => {
    let now = 0, peak = 0, reported = 0;
    let runner: ReturnType<typeof startQueueRunner> | undefined;
    const handler: JobHandler = async () => {
      now++;
      peak = Math.max(peak, now);
      reported = Math.max(reported, runner?.running()["test.limited"] ?? 0);
      await new Promise((r) => setTimeout(r, 40));
      now--;
    };
    const c = await createWorkerContext({ "test.limited": handler });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await Promise.all(Array.from({ length: 20 }, () => seedJob(c.db, workspaceId, { type: "test.limited" })));
      runner = startQueueRunner(c, { concurrency: { "test.limited": 2 }, pollMs: 20, sweepMs: 60_000, listen: noListen });
      await waitFor(async () => (await countState(c.db, "succeeded", "test.limited")) === 20, 10_000);
      await runner.stop(1_000);
      expect(peak).toBe(2);
      expect(reported).toBe(2);
      expect(runner.running()).toEqual({ "test.limited": 0 });
    } finally {
      await runner?.stop(1_000);
      await c.close();
    }
  });

  it("a notification wakes an idle loop before the poll would", async () => {
    let fire: (t: string) => void = () => {};
    const c = await createWorkerContext({ "test.wake": async () => {} });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 60_000, sweepMs: 60_000, listen: async (onReady) => { fire = onReady; return async () => {}; } });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await new Promise((r) => setTimeout(r, 50));
      await seedJob(c.db, workspaceId, { type: "test.wake" });
      fire("test.unknown"); // a type this worker has no loop for is ignored
      fire("test.wake");
      await waitFor(async () => (await countState(c.db, "succeeded", "test.wake")) === 1, 2_000);
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("a job left running by a dead worker is swept and run again", async () => {
    const c = await createWorkerContext({ "test.orphan": async () => ({ ok: true }) });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "test.orphan", state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
      await c.db.execute(sql`update job set run_after = now() where type = 'test.orphan'`); // backoff skipped for the test
      await waitFor(async () => {
        await c.db.execute(sql`update job set run_after = now() where type = 'test.orphan' and state = 'queued'`);
        return (await countState(c.db, "succeeded", "test.orphan")) === 1;
      }, 5_000);
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("a job swept with its attempts spent is failed and its handler's final-failure hook runs", async () => {
    const finals: JobRow[] = [];
    const handler: JobHandler = Object.assign(async () => {}, { onFinalFailure: async (job: JobRow) => void finals.push(job) });
    const throwing: JobHandler = Object.assign(async () => {}, { onFinalFailure: async () => { throw new Error("hook broke"); } });
    const { logger, lines } = captureLogger();
    const c = await createWorkerContext({ "test.spent": handler, "test.spent.hook": throwing }, { logger });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      const expired = { state: "running" as const, attempt: 5, maxAttempts: 5, leaseExpiresAt: new Date(Date.now() - 1_000) };
      const id = await seedJob(c.db, workspaceId, { type: "test.spent", leaseToken: crypto.randomUUID(), ...expired });
      await seedJob(c.db, workspaceId, { type: "test.spent.hook", leaseToken: crypto.randomUUID(), ...expired });
      await waitFor(() => finals.length === 1 && lines.some((l) => l.msg === "final-failure hook failed"), 5_000);
      expect(finals[0]!.id).toBe(id);
      expect(finals[0]!.lastErrorCode).toBe("LEASE_EXPIRED");
      expect(await countState(c.db, "failed", "test.spent")).toBe(1);
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("a claim that throws is logged and the loop carries on after the poll interval", async () => {
    const { logger, lines } = captureLogger();
    const c = await createWorkerContext({ "test.flaky": async () => {} }, { logger });
    const runner = startQueueRunner({ ...c, db: flakyDb(c.db, "update", 2) }, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "test.flaky" });
      await waitFor(async () => (await countState(c.db, "succeeded", "test.flaky")) === 1, 5_000);
      expect(lines.filter((l) => l.msg === "claim failed")).toHaveLength(2);
      expect(lines.find((l) => l.msg === "claim failed")).toMatchObject({ type: "test.flaky", err: "connection refused" });
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("a job whose execution rejects is logged, never unhandled, and the loop goes on", async () => {
    const { logger, lines } = captureLogger();
    const c = await createWorkerContext({}, { logger });
    // The claim's update passes; the handler throws; failAttempt's update throws, so executeJob rejects.
    let updates = 0;
    const db = new Proxy(c.db, {
      get(target, prop, receiver) {
        if (prop === "update" && ++updates === 2) return () => { throw new Error("db gone"); };
        return Reflect.get(target, prop, receiver);
      },
    });
    const handlers: Record<string, JobHandler> = { "test.reject": async () => { throw new JobFailure("BOOM", "boom", false); } };
    const { workspaceId } = await seedWorkspace(c.db);
    await seedJob(c.db, workspaceId, { type: "test.reject" });
    await seedJob(c.db, workspaceId, { type: "test.reject" });
    const runner = startQueueRunner({ ...c, db, handlers }, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
    try {
      await waitFor(() => lines.some((l) => l.msg === "job execution threw"), 5_000);
      await waitFor(async () => (await countState(c.db, "failed", "test.reject")) === 1, 5_000);
      expect(lines.find((l) => l.msg === "job execution threw")).toMatchObject({ type: "test.reject", err: "db gone" });
      expect(runner.running()).toEqual({ "test.reject": 0 });
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("stop claims nothing more, waits for running jobs, and gives up after the grace period", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let started = 0;
    const c = await createWorkerContext({ "test.slow": async () => { started++; await gate; } });
    const runner = startQueueRunner(c, { concurrency: { "test.slow": 1 }, pollMs: 20, sweepMs: 60_000, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await Promise.all(Array.from({ length: 3 }, () => seedJob(c.db, workspaceId, { type: "test.slow" })));
      await waitFor(() => started === 1, 5_000);
      const t0 = Date.now();
      await runner.stop(100); // the job is still held at the gate: stop resolves anyway, and gives its lease back
      expect(Date.now() - t0).toBeLessThan(1_000);
      expect(runner.running()).toEqual({ "test.slow": 1 });
      expect(await countState(c.db, "queued", "test.slow")).toBe(3);
      release();
      await waitFor(() => runner.running()["test.slow"] === 0, 5_000);
      // The released job's late finish is fenced out by its old token: nothing more ran and nothing succeeded.
      expect(started).toBe(1);
      expect(await countState(c.db, "succeeded", "test.slow")).toBe(0);
      expect(await countState(c.db, "queued", "test.slow")).toBe(3);
    } finally {
      release();
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("stop(500) waits for a 200 ms job to finish", async () => {
    let started = 0, finished = 0;
    const c = await createWorkerContext({ "test.short": async () => { started++; await new Promise((r) => setTimeout(r, 200)); finished++; } });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "test.short" });
      await waitFor(() => started === 1, 5_000);
      const t0 = Date.now();
      await runner.stop(500);
      expect(finished).toBe(1);
      expect(Date.now() - t0).toBeLessThan(500);
      expect(await countState(c.db, "succeeded", "test.short")).toBe(1);
    } finally {
      await runner.stop(1_000);
      await c.close();
    }
  });

  it("stop(500) gives up at about 500 ms on a 2 s job and gives it back with its attempt restored", async () => {
    let started = 0, finished = 0;
    const c = await createWorkerContext({ "test.long": async () => { started++; await new Promise((r) => setTimeout(r, 2_000)); finished++; } });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 60_000, listen: noListen });
    try {
      const { workspaceId } = await seedWorkspace(c.db);
      await seedJob(c.db, workspaceId, { type: "test.long" });
      await waitFor(() => started === 1, 5_000);
      const t0 = Date.now();
      await runner.stop(500);
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(450);
      expect(took).toBeLessThan(1_000);
      expect(finished).toBe(0);
      const job = async () => (await c.db.execute<{ state: string; attempt: number; lease_token: string | null; lease_expires_at: Date | null; ready: boolean }>(
        sql`select state, attempt, lease_token, lease_expires_at, run_after <= now() as ready from job where type = 'test.long'`,
      )).rows[0]!;
      expect(await job()).toEqual({ state: "queued", attempt: 0, lease_token: null, lease_expires_at: null, ready: true });
      // The handler still finishes in this process, but its old token no longer completes the job.
      await waitFor(() => finished === 1, 5_000);
      await waitFor(() => runner.running()["test.long"] === 0, 5_000);
      expect(await job()).toMatchObject({ state: "queued", attempt: 0 });
    } finally {
      await waitFor(() => finished === 1, 5_000);
      await c.close();
    }
  });

  it("stop wakes loops mid-sleep and closes the listener", async () => {
    let closed = false;
    const c = await createWorkerContext({ "test.idle": async () => {} });
    const runner = startQueueRunner(c, { concurrency: {}, pollMs: 60_000, sweepMs: 60_000, listen: async () => async () => { closed = true; } });
    try {
      await new Promise((r) => setTimeout(r, 50));
      const t0 = Date.now();
      await runner.stop(5_000);
      expect(Date.now() - t0).toBeLessThan(1_000);
      expect(closed).toBe(true);
    } finally {
      await c.close();
    }
  });
});

describe("parseConcurrency", () => {
  it("parseConcurrency applies overrides over defaults and refuses bad values", () => {
    expect(parseConcurrency("document.extract=3", ["document.extract", "document.verify", "test.x"])).toEqual({ "document.extract": 3, "document.verify": 4, "test.x": 1 });
    expect(() => parseConcurrency("document.extract=0", ["document.extract"])).toThrow();
    expect(() => parseConcurrency("document.extract=two", ["document.extract"])).toThrow();
  });

  it("uses the defaults when unset, reads several overrides, and refuses malformed entries", () => {
    expect(DEFAULT_CONCURRENCY).toEqual({ "document.verify": 4, "document.classify": 2, "document.extract": 2 });
    expect(parseConcurrency(undefined, ["document.classify", "test.x"])).toEqual({ "document.classify": 2, "test.x": 1 });
    expect(parseConcurrency(" document.extract=3 , document.verify=8 ", ["document.extract", "document.verify"])).toEqual({ "document.extract": 3, "document.verify": 8 });
    expect(() => parseConcurrency("document.extract=1.5", ["document.extract"])).toThrow();
    expect(() => parseConcurrency("document.extract=-2", ["document.extract"])).toThrow();
    expect(() => parseConcurrency("document.extract", ["document.extract"])).toThrow();
    expect(() => parseConcurrency("document.extrct=3", ["document.extract"])).toThrow(/document\.extrct/);
  });
});

describe("pgListen", () => {
  it("hears job_ready, and hears it again after its connection is killed", async () => {
    const c = await createWorkerContext();
    const name = `qtest-${crypto.randomUUID().slice(0, 8)}`;
    const url = c.env.DATABASE_URL + (c.env.DATABASE_URL.includes("?") ? "&" : "?") + `application_name=${name}`;
    const pids = async () => (await c.db.execute<{ pid: number }>(sql`select pid from pg_stat_activity where application_name = ${name}`)).rows.map((r) => r.pid);
    const { logger, lines } = captureLogger();
    const heard: string[] = [];
    const close = await pgListen(url, logger)((type) => heard.push(type));
    try {
      await c.db.execute(sql`select pg_notify('job_ready', 'test.real')`);
      await waitFor(() => heard.includes("test.real"), 2_000);

      const before = await pids();
      expect(before).toHaveLength(1);
      await c.db.execute(sql`select pg_terminate_backend(${before[0]!})`);
      // Notify until the reconnected listener hears it, rather than sleeping a fixed time.
      await waitFor(async () => {
        await c.db.execute(sql`select pg_notify('job_ready', 'test.real.again')`);
        return heard.includes("test.real.again");
      }, 10_000, 200);
      expect(lines.some((l) => l.msg === "job listener lost; reconnecting" && l.retryInMs === 1_000)).toBe(true);
      const after = await pids();
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(before[0]);
    } finally {
      await close();
    }
    await waitFor(async () => (await pids()).length === 0, 5_000);
    await c.close();
  });

  it("resolves when the database is unreachable, keeps retrying, and stops when closed", async () => {
    const { logger, lines } = captureLogger();
    const close = await pgListen("postgres://maester:maester@127.0.0.1:1/none", logger)(() => {});
    expect(lines.filter((l) => l.msg === "job listener lost; reconnecting")).toHaveLength(1);
    await close();
    await new Promise((r) => setTimeout(r, 1_200));
    expect(lines.filter((l) => l.msg === "job listener lost; reconnecting")).toHaveLength(1);
  });
});
