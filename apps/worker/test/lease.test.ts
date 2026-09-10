import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { acquireLease, completeJob, failAttempt } from "../src/lease.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext(); });
afterAll(() => ctx.close());

describe("lease", () => {
  it("only one of many concurrent acquirers wins", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const results = await Promise.all(Array.from({ length: 8 }, () => acquireLease(ctx.db, id, 600)));
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.state).toBe("running");
    expect(winners[0]!.attempt).toBe(1);
    expect(winners[0]!.leaseToken).toBeTruthy();
  });

  it("an expired lease can be re-acquired", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { state: "running", leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1000), attempt: 1 });
    const row = await acquireLease(ctx.db, id, 600);
    expect(row?.attempt).toBe(2);
  });

  it("completeJob only succeeds with the matching lease token", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const row = (await acquireLease(ctx.db, id, 600))!;
    expect(await completeJob(ctx.db, id, crypto.randomUUID(), { ok: true })).toBe(false);
    expect(await completeJob(ctx.db, id, row.leaseToken!, { ok: true })).toBe(true);
    const [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("succeeded");
    expect(after!.result).toEqual({ ok: true });
    expect(after!.finishedAt).not.toBeNull();
  });

  it("failAttempt requeues when not final and fails when final", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const row = (await acquireLease(ctx.db, id, 600))!;
    await failAttempt(ctx.db, row, row.leaseToken!, { code: "E1", message: "boom" }, false);
    let [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("queued");
    expect(after!.lastErrorCode).toBe("E1");
    expect(after!.leaseToken).toBeNull();

    const row2 = (await acquireLease(ctx.db, id, 600))!;
    await failAttempt(ctx.db, row2, row2.leaseToken!, { code: "E2", message: "boom again" }, true);
    [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(after!.state).toBe("failed");
    expect(after!.lastErrorCode).toBe("E2");
    expect(after!.finishedAt).not.toBeNull();
  });
});
