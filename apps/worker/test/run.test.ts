import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { createWorkerApp } from "../src/app.js";
import { JobFailure, type JobHandler } from "../src/jobs/types.js";
import { claimNext } from "../src/lease.js";
import { executeJob, runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => {
  ctx = await createWorkerContext({
    "test.noop": async (_job, c) => {
      await c.progress({ stage: "working", percent: 50 });
      return { done: true };
    },
    "test.fail": async () => {
      throw new Error("handler exploded");
    },
    "test.permanent": async () => {
      throw new JobFailure("NO_STATEMENTS_FOUND", "nothing to extract", false);
    },
    "test.retryable": async () => {
      throw new JobFailure("MODEL_UNAVAILABLE", "try later", true);
    },
  });
});
afterAll(() => ctx.close());

describe("runJob", () => {
  it("runs a handler to success and records progress and result", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.noop" });
    const res = await runJob(ctx, "test.noop", id);
    expect(res.status).toBe(200);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("succeeded");
    expect(row!.result).toEqual({ done: true });
    expect(row!.progress).toEqual({ stage: "working", percent: 50 });
  });

  it("returns 500 and requeues on a non-final failure, then fails on the last attempt", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.fail", maxAttempts: 2 });
    const first = await runJob(ctx, "test.fail", id);
    expect(first.status).toBe(500);
    let [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("queued");
    expect(row!.attempt).toBe(1);
    const second = await runJob(ctx, "test.fail", id);
    expect(second.status).toBe(200);
    [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.state).toBe("failed");
    expect(row!.lastErrorCode).toBe("HANDLER_ERROR");
  });

  it("fails a permanent JobFailure on the first attempt and records its code", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.permanent", maxAttempts: 5 });
    expect((await runJob(ctx, "test.permanent", id)).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "NO_STATEMENTS_FOUND", lastErrorMessage: "nothing to extract" });
  });

  it("requeues a retryable JobFailure with its code", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.retryable", maxAttempts: 5 });
    expect((await runJob(ctx, "test.retryable", id)).status).toBe(500);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row).toMatchObject({ state: "queued", lastErrorCode: "MODEL_UNAVAILABLE" });
  });

  it("acks already-terminal jobs, 409s a held lease, and fails unknown types", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const done = await seedJob(ctx.db, workspaceId, { type: "test.noop", state: "succeeded" });
    expect((await runJob(ctx, "test.noop", done)).status).toBe(200);

    const held = await seedJob(ctx.db, workspaceId, { type: "test.noop", state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) });
    expect((await runJob(ctx, "test.noop", held)).status).toBe(409);

    const unknown = await seedJob(ctx.db, workspaceId, { type: "nope" });
    expect((await runJob(ctx, "nope", unknown)).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, unknown));
    expect(row!.state).toBe("failed");
    expect(row!.lastErrorCode).toBe("UNKNOWN_JOB_TYPE");
  });

  it("missing job id returns 200 ack", async () => {
    expect((await runJob(ctx, "test.noop", crypto.randomUUID())).status).toBe(200);
  });
});

describe("worker app", () => {
  it("rejects a request without the local dispatch secret", async () => {
    const app = createWorkerApp(ctx);
    const res = await app.request("/tasks/test.noop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: crypto.randomUUID() }) });
    expect(res.status).toBe(401);
  });

  it("accepts a request with the local dispatch secret and runs the job", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { type: "test.noop" });
    const app = createWorkerApp(ctx);
    const res = await app.request("/tasks/test.noop", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dispatch-secret": "local-dispatch-secret" },
      body: JSON.stringify({ jobId: id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: id, outcome: "succeeded" });
  });
});

describe("executeJob", () => {
  it("renews the lease on a timer while a quiet handler runs", async () => {
    let seen: Date | null = null;
    const handler: JobHandler = async (job, ctx) => {
      await new Promise((r) => setTimeout(r, 250)); // no heartbeat() call from the handler
      const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, job.id));
      seen = row!.leaseExpiresAt;
      return { ok: true };
    };
    const c = await createWorkerContext({ "test.quiet": handler }); // LEASE_SECONDS 600
    const { workspaceId } = await seedWorkspace(c.db);
    await seedJob(c.db, workspaceId, { type: "test.quiet" });
    const job = (await claimNext(c.db, "test.quiet", 1))!; // claimed with a 1-second lease
    const out = await executeJob(c, job, { heartbeatMs: 50 });
    expect(out.outcome).toBe("succeeded");
    expect(seen!.getTime()).toBeGreaterThan(job.leaseExpiresAt!.getTime() + 60_000); // renewed to LEASE_SECONDS
    await c.close();
  });

  it("reports lease_lost when another worker took the job", async () => {
    const c = await createWorkerContext({
      "test.slow": async (job, ctx) => {
        await ctx.db.update(schema.job).set({ leaseToken: crypto.randomUUID() }).where(eq(schema.job.id, job.id));
        await new Promise((r) => setTimeout(r, 120));
      },
    });
    const { workspaceId } = await seedWorkspace(c.db);
    await seedJob(c.db, workspaceId, { type: "test.slow" });
    const job = (await claimNext(c.db, "test.slow", 600))!;
    expect((await executeJob(c, job, { heartbeatMs: 30 })).outcome).toBe("lease_lost");
    await c.close();
  });
});
