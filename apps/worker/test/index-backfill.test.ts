import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { DOCUMENT_INDEX_SUBJECT, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { indexPipelineVersion } from "@maester/document-index";
import { backfillIndex, requeue, runIndexBackfillOnce } from "../src/index-backfill.js";
import { createWorkerContext, seedWorkspace, workerTestEnv } from "./context.js";

const MODEL = workerTestEnv().EMBEDDING_MODEL;
const VERSION = indexPipelineVersion(MODEL);

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
let workspaceId: string;
let userId: string;

beforeEach(async () => {
  ctx = await createWorkerContext();
  ({ workspaceId, userId } = await seedWorkspace(ctx.db));
});
afterEach(async () => { await ctx.close(); });

async function seedDoc(overrides: Partial<typeof schema.document.$inferInsert> = {}, ws = workspaceId) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId: ws, originalName: "x.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${id}/original.pdf`, state: "stored", createdByUserId: userId, ...overrides,
  });
  return id;
}

async function seedIndexJob(documentId: string, overrides: Partial<typeof schema.job.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id, workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:${VERSION}`, state: "queued", ...overrides,
  });
  return id;
}

async function jobsFor(documentId: string) {
  return ctx.db.select().from(schema.job).where(eq(schema.job.subjectId, documentId));
}

const LEASE = crypto.randomUUID();
const opts = { model: MODEL };

describe("backfillIndex", () => {
  it("gives a stored document with no job one, and dispatches it", async () => {
    const doc = await seedDoc();
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, opts);
    expect(counts).toEqual({ created: 1, requeued: 0, waiting: 0, current: 0 });
    const [job] = await jobsFor(doc);
    expect(job).toMatchObject({ type: JobTypes.DOCUMENT_INDEX, state: "queued", idempotencyKey: `document.index:${doc}:${VERSION}` });
    expect(ctx.dispatcher.enqueued.map((j) => j.id)).toEqual([job!.id]);
  });

  it("queues a failed job again with fresh attempts and run_after now, and notifies", async () => {
    const doc = await seedDoc();
    const id = await seedIndexJob(doc, {
      state: "failed", attempt: 3, maxAttempts: 3, lastErrorCode: "INDEXER_NOT_CONFIGURED",
      leaseToken: LEASE, leaseExpiresAt: new Date(), finishedAt: new Date(), progress: { stage: "reading" },
      runAfter: new Date(Date.now() + 3_600_000),
    });
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, opts);
    expect(counts).toEqual({ created: 0, requeued: 1, waiting: 0, current: 0 });
    const [job] = await jobsFor(doc);
    expect(job).toMatchObject({ id, state: "queued", leaseToken: null, leaseExpiresAt: null, finishedAt: null, progress: {}, maxAttempts: 8 });
    const { rows } = await ctx.db.execute<{ ok: boolean }>(sql`select run_after <= now() as ok from job where id = ${id}`);
    expect(rows[0]!.ok).toBe(true);
    expect(ctx.dispatcher.enqueued.map((j) => j.id)).toEqual([id]);
  });

  it("queues a succeeded job whose index is gone again", async () => {
    const doc = await seedDoc();
    const id = await seedIndexJob(doc, { state: "succeeded", attempt: 1, maxAttempts: 5 });
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, opts);
    expect(counts.requeued).toBe(1);
    expect((await jobsFor(doc))[0]).toMatchObject({ id, state: "queued", maxAttempts: 6 });
  });

  it("leaves a queued or running job alone", async () => {
    const queued = await seedDoc();
    const running = await seedDoc();
    await seedIndexJob(queued);
    await seedIndexJob(running, { state: "running", attempt: 1, leaseToken: LEASE, leaseExpiresAt: new Date(Date.now() + 60_000) });
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, opts);
    expect(counts).toEqual({ created: 0, requeued: 0, waiting: 2, current: 0 });
    expect(ctx.dispatcher.enqueued).toEqual([]);
    expect((await jobsFor(running))[0]).toMatchObject({ state: "running", leaseToken: LEASE });
  });

  it("skips a duplicate, a rejected and an indexed document, counting only the indexed as current", async () => {
    await seedDoc({ intakeState: "duplicate" });
    await seedDoc({ state: "rejected" });
    const indexed = await seedDoc();
    const jobId = await seedIndexJob(indexed, { state: "succeeded" });
    await ctx.db.insert(schema.documentIndexRevision).values({
      id: crypto.randomUUID(), workspaceId, documentId: indexed, jobId, state: "complete", indexVersion: "v", doclingVersion: "d",
      ocrEngine: "o", readerOptions: "r", chunkerVersion: "c", embeddingModel: MODEL,
    });
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, opts);
    expect(counts).toEqual({ created: 0, requeued: 0, waiting: 0, current: 1 });
    expect(await ctx.db.select().from(schema.job)).toHaveLength(1);
    expect(ctx.dispatcher.enqueued).toEqual([]);
  });

  it("does not overwrite a job claimed since it was read", async () => {
    const doc = await seedDoc();
    const id = await seedIndexJob(doc, { state: "failed", attempt: 1, maxAttempts: 1 });
    const [stale] = await jobsFor(doc);
    await ctx.db.update(schema.job).set({ state: "running", leaseToken: LEASE, leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(schema.job.id, id));
    expect(await requeue(ctx.db, ctx.dispatcher, stale!)).toBe(false);
    expect((await jobsFor(doc))[0]).toMatchObject({ state: "running", leaseToken: LEASE });
    expect(ctx.dispatcher.enqueued).toEqual([]);
  });

  it("does not count a document indexed under another model as current", async () => {
    const doc = await seedDoc();
    const jobId = await seedIndexJob(doc, { state: "succeeded" });
    await ctx.db.insert(schema.documentIndexRevision).values({
      id: crypto.randomUUID(), workspaceId, documentId: doc, jobId, state: "complete", indexVersion: "v", doclingVersion: "d",
      ocrEngine: "o", readerOptions: "r", chunkerVersion: "c", embeddingModel: "some-other-model",
    });
    expect(await backfillIndex(ctx.db, ctx.dispatcher, opts)).toEqual({ created: 0, requeued: 1, waiting: 0, current: 0 });
  });

  it("scopes the current count by workspace and document", async () => {
    const other = await seedWorkspace(ctx.db);
    const mine = await seedDoc();
    const mine2 = await seedDoc();
    const theirs = await seedDoc({}, other.workspaceId);
    for (const [doc, ws] of [[mine, workspaceId], [mine2, workspaceId], [theirs, other.workspaceId]] as const) {
      const jobId = crypto.randomUUID();
      await ctx.db.insert(schema.job).values({ id: jobId, workspaceId: ws, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: doc, idempotencyKey: `k-${jobId}`, state: "succeeded" });
      await ctx.db.insert(schema.documentIndexRevision).values({
        id: crypto.randomUUID(), workspaceId: ws, documentId: doc, jobId, state: "complete", indexVersion: "v", doclingVersion: "d",
        ocrEngine: "o", readerOptions: "r", chunkerVersion: "c", embeddingModel: MODEL,
      });
    }
    expect((await backfillIndex(ctx.db, ctx.dispatcher, opts)).current).toBe(3);
    expect((await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, workspaceId })).current).toBe(2);
    expect((await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, documentIds: [mine] })).current).toBe(1);
  });

  it("limits by workspace and by document", async () => {
    const other = await seedWorkspace(ctx.db);
    const a = await seedDoc();
    const b = await seedDoc();
    const c = await seedDoc({}, other.workspaceId);
    expect(await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, workspaceId: other.workspaceId })).toMatchObject({ created: 1 });
    expect(await jobsFor(c)).toHaveLength(1);
    expect(await jobsFor(a)).toHaveLength(0);
    expect(await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, documentIds: [a] })).toMatchObject({ created: 1 });
    expect(await jobsFor(a)).toHaveLength(1);
    expect(await jobsFor(b)).toHaveLength(0);
    expect(await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, documentIds: [] })).toEqual({ created: 0, requeued: 0, waiting: 0, current: 0 });
  });

  it("dry run counts and writes nothing", async () => {
    await seedDoc();
    const failedDoc = await seedDoc();
    const id = await seedIndexJob(failedDoc, { state: "failed", attempt: 1, maxAttempts: 1 });
    const counts = await backfillIndex(ctx.db, ctx.dispatcher, { ...opts, dryRun: true });
    expect(counts).toEqual({ created: 1, requeued: 1, waiting: 0, current: 0 });
    expect(await ctx.db.select().from(schema.job)).toHaveLength(1);
    expect((await jobsFor(failedDoc))[0]).toMatchObject({ id, state: "failed" });
    expect(ctx.dispatcher.enqueued).toEqual([]);
  });

  it("creates nothing the second time", async () => {
    await seedDoc();
    await backfillIndex(ctx.db, ctx.dispatcher, opts);
    ctx.dispatcher.enqueued.length = 0;
    expect(await backfillIndex(ctx.db, ctx.dispatcher, opts)).toEqual({ created: 0, requeued: 0, waiting: 1, current: 0 });
    expect(await ctx.db.select().from(schema.job)).toHaveLength(1);
    expect(ctx.dispatcher.enqueued).toEqual([]);
  });
});

describe("index:backfill CLI", () => {
  const source = { DATABASE_URL: workerTestEnv().DATABASE_URL, WORKER_URL: "http://localhost:8788", NODE_ENV: "test", STORAGE_DRIVER: "disk" } as NodeJS.ProcessEnv;
  const capture = () => {
    const lines = { log: [] as string[], error: [] as string[] };
    return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
  };

  it("prints the four counts and exits 0", async () => {
    const doc = await seedDoc();
    const { lines, out } = capture();
    const code = await runIndexBackfillOnce(["--workspace", workspaceId, "--document", doc, "--dry-run"], source, out, () => ({ db: ctx.db, dispatcher: ctx.dispatcher }));
    expect(code).toBe(0);
    expect(lines.log).toEqual(["dry run: created 1, requeued 0, waiting 0, current 0"]);
    expect(await jobsFor(doc)).toHaveLength(0);
  });

  it("exits 1 with one line free of query text when the database fails", async () => {
    const { lines, out } = capture();
    const db = { select: () => { throw new Error("select * from document where secret"); } } as never;
    let closed = false;
    const code = await runIndexBackfillOnce([], source, out, () => ({ db, dispatcher: ctx.dispatcher, close: async () => { closed = true; } }));
    expect(code).toBe(1);
    expect(lines.error).toHaveLength(1);
    expect(lines.error[0]).not.toContain("select");
    expect(closed).toBe(true);
  });

  it("exits 1 on an unknown flag", async () => {
    const { lines, out } = capture();
    const code = await runIndexBackfillOnce(["--nope"], source, out, () => { throw new Error("must not connect"); });
    expect(code).toBe(1);
    expect(lines.error).toHaveLength(1);
  });
});
