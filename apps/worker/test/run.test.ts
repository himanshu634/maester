import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { createWorkerApp } from "../src/app.js";
import { runJob } from "../src/run.js";
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
