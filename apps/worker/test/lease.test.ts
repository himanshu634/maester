import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { acquireLease, backoffSeconds, claimNext, completeJob, failAttempt, releaseLease, renewLease, sweepExpired } from "../src/lease.js";
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

  it("renewLease extends the lease only for the holder", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId);
    const held = (await acquireLease(ctx.db, id, 5))!;
    expect(await renewLease(ctx.db, id, crypto.randomUUID(), 600)).toBe(false);
    expect(await renewLease(ctx.db, id, held.leaseToken!, 600)).toBe(true);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row!.leaseExpiresAt!.getTime() - held.leaseExpiresAt!.getTime()).toBeGreaterThan(500_000);
  });

  it("releaseLease gives a held job back with its attempt restored, only for the holder", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { runAfter: new Date(Date.now() - 60_000) });
    const held = (await acquireLease(ctx.db, id, 600))!;
    expect(held.attempt).toBe(1);
    expect(await releaseLease(ctx.db, id, crypto.randomUUID())).toBe(false);
    const [untouched] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(untouched).toMatchObject({ state: "running", attempt: 1, leaseToken: held.leaseToken });
    expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(true);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row).toMatchObject({ state: "queued", attempt: 0, leaseToken: null, leaseExpiresAt: null });
    expect(Math.abs(row!.runAfter.getTime() - Date.now())).toBeLessThan(5_000);
    expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(false);
    // A job no longer running is left alone, even with its old token.
    await ctx.db.update(schema.job).set({ state: "succeeded", leaseToken: held.leaseToken }).where(eq(schema.job.id, id));
    expect(await releaseLease(ctx.db, id, held.leaseToken!)).toBe(false);
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

  it("claimNext gives each of many concurrent claimers a different job, and none twice", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const ids = await Promise.all(Array.from({ length: 5 }, () => seedJob(ctx.db, workspaceId, { type: "test.claim" })));
    const claimed = await Promise.all(Array.from({ length: 8 }, () => claimNext(ctx.db, "test.claim", 600)));
    const got = claimed.filter(Boolean).map((j) => j!.id);
    expect(new Set(got).size).toBe(5);
    expect(got.sort()).toEqual(ids.sort());
  });

  it("claimNext returns a typed row: Date fields, camelCase, attempt and lease set", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    await seedJob(ctx.db, workspaceId, { type: "test.typed" });
    const job = (await claimNext(ctx.db, "test.typed", 600))!;
    expect(job.state).toBe("running");
    expect(job.attempt).toBe(1);
    expect(job.leaseToken).toBeTruthy();
    expect(job.leaseExpiresAt).toBeInstanceOf(Date);
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(job.runAfter).toBeInstanceOf(Date);
  });

  it("claimNext skips a job whose run_after is in the future and jobs of other types", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    await seedJob(ctx.db, workspaceId, { type: "test.later", runAfter: new Date(Date.now() + 60_000) });
    await seedJob(ctx.db, workspaceId, { type: "test.other" });
    expect(await claimNext(ctx.db, "test.later", 600)).toBeNull();
  });

  it("claimNext takes the earliest run_after first", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const late = await seedJob(ctx.db, workspaceId, { type: "test.order", runAfter: new Date(Date.now() - 1_000) });
    const early = await seedJob(ctx.db, workspaceId, { type: "test.order", runAfter: new Date(Date.now() - 60_000) });
    expect((await claimNext(ctx.db, "test.order", 600))!.id).toBe(early);
    expect((await claimNext(ctx.db, "test.order", 600))!.id).toBe(late);
  });

  it("backoffSeconds doubles from 30 s and stops at 900 s, with at most 20% jitter", () => {
    expect(backoffSeconds(1, () => 0)).toBe(30);
    expect(backoffSeconds(2, () => 0)).toBe(60);
    expect(backoffSeconds(6, () => 0)).toBe(900);
    expect(backoffSeconds(9, () => 0)).toBe(900);
    expect(backoffSeconds(1, () => 1)).toBe(36);
  });

  it("a retryable failure puts the job back with run_after in the future", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    await seedJob(ctx.db, workspaceId, { type: "test.fail" });
    const job = (await claimNext(ctx.db, "test.fail", 600))!;
    await failAttempt(ctx.db, job, job.leaseToken!, { code: "X", message: "x" }, false);
    const [row] = await ctx.db.execute(sql`select state, run_after > now() + interval '25 seconds' as later from job where id = ${job.id}`).then((r) => r.rows);
    expect(row).toMatchObject({ state: "queued", later: true });
  });

  it("sweepExpired requeues a running job whose lease expired, with backoff", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
    const out = await sweepExpired(ctx.db, ["test.noop"]);
    expect(out.requeued.map((j) => j.id)).toContain(id);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row).toMatchObject({ state: "queued", leaseToken: null, lastErrorCode: "LEASE_EXPIRED" });
    expect(row!.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
  });

  it("sweepExpired fails a job whose attempts are spent", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const id = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 5, maxAttempts: 5, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
    const out = await sweepExpired(ctx.db, ["test.noop"]);
    expect(out.failed.map((j) => j.id)).toContain(id);
    const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
    expect(row).toMatchObject({ state: "failed", leaseToken: null, leaseExpiresAt: null, lastErrorCode: "LEASE_EXPIRED" });
    expect(row!.finishedAt).not.toBeNull();
  });

  it("sweepExpired touches only the types it is given", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const expired = () => ({ state: "running" as const, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
    const mine = await seedJob(ctx.db, workspaceId, { type: "test.mine", ...expired(), attempt: 5, maxAttempts: 5 });
    const other = await seedJob(ctx.db, workspaceId, { type: "test.other", ...expired(), attempt: 5, maxAttempts: 5 });
    const otherRetry = await seedJob(ctx.db, workspaceId, { type: "test.other", ...expired(), attempt: 1 });
    const out = await sweepExpired(ctx.db, ["test.mine"]);
    expect(out.failed.map((j) => j.id)).toEqual([mine]);
    expect(out.requeued).toEqual([]);
    for (const id of [other, otherRetry]) {
      const [row] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, id));
      expect(row!.state).toBe("running");
    }
  });

  it("sweepExpired leaves live leases and queued jobs alone", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const live = await seedJob(ctx.db, workspaceId, { state: "running", attempt: 1, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) });
    const queued = await seedJob(ctx.db, workspaceId);
    const out = await sweepExpired(ctx.db, ["test.noop"]);
    expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(live);
    expect([...out.requeued, ...out.failed].map((j) => j.id)).not.toContain(queued);
  });

  it("sweepExpired backs off by each job's own attempt count", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const expired = () => ({ state: "running" as const, leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000) });
    const first = await seedJob(ctx.db, workspaceId, { ...expired(), attempt: 1 });
    const third = await seedJob(ctx.db, workspaceId, { ...expired(), attempt: 3 });
    await sweepExpired(ctx.db, ["test.noop"]);
    const [a] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, first));
    const [b] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, third));
    // attempt 1 waits 30-36 s, attempt 3 waits 120-144 s
    expect(a!.runAfter.getTime()).toBeLessThan(Date.now() + 50_000);
    expect(b!.runAfter.getTime()).toBeGreaterThan(Date.now() + 100_000);
  });
});
