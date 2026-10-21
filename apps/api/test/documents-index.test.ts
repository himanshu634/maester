import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IndexResponse, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";

type W = { workspaceId: string; userId: string };

async function seedDocument(w: W, over: Partial<typeof schema.document.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId: w.workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${w.workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState: "read", createdByUserId: w.userId, ...over,
  });
  return id;
}

/** A `document.index` job as the verify step names it, in the state given. */
async function seedIndexJob(w: W, documentId: string, state: "queued" | "running" | "succeeded" | "failed" | "cancelled", over: Partial<typeof schema.job.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id, workspaceId: w.workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: "document_index", subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:1:${MODEL}`, state, ...over,
  });
  return id;
}

const post = (ws: string, id: string, cookie?: string) =>
  ctx.app.request(`/v1/workspaces/${ws}/documents/${id}/index`, { method: "POST", headers: cookie ? { cookie } : {} });
const indexJobs = (id: string) =>
  ctx.db.select().from(schema.job).where(and(eq(schema.job.type, "document.index"), eq(schema.job.subjectId, id)));
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("POST /documents/:id/index", () => {
  it("a failed index job is queued again with its attempts given back", async () => {
    const a = await ctx.signUp("index-failed@example.com");
    const docId = await seedDocument(a);
    const failedJobId = await seedIndexJob(a, docId, "failed", { attempt: 5, maxAttempts: 5, lastErrorCode: "INDEXER_NOT_CONFIGURED" });
    const before = ctx.dispatcher.enqueued.length;
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(202);
    expect(IndexResponse.parse(await res.json()).job).toMatchObject({ id: failedJobId, state: "queued" });
    const [row] = await indexJobs(docId);
    expect(row!.maxAttempts).toBe(row!.attempt + 5);
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);
  });

  it("with no index job, one is created under 1:<EMBEDDING_MODEL>", async () => {
    const a = await ctx.signUp("index-create@example.com");
    const docId = await seedDocument(a);
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(202);
    expect(IndexResponse.parse(await res.json()).job).toMatchObject({ type: "document.index", subjectType: "document_index", subjectId: docId, state: "queued" });
    const rows = await indexJobs(docId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: "document_index", idempotencyKey: `document.index:${docId}:1:${MODEL}`, state: "queued" });
  });

  it("a second post answers the job that the first made, and no second job exists", async () => {
    const a = await ctx.signUp("index-twice@example.com");
    const docId = await seedDocument(a);
    const first = IndexResponse.parse(await (await post(a.workspaceId, docId, a.cookie)).json());
    const second = await post(a.workspaceId, docId, a.cookie);
    expect(second.status).toBe(202);
    expect(IndexResponse.parse(await second.json()).job.id).toBe(first.job.id);
    expect(await indexJobs(docId)).toHaveLength(1);
  });

  it("a running index job is answered as it is, and no second job exists", async () => {
    // seed: a stored document with a document.index job, state running
    const a = await ctx.signUp("index-running@example.com");
    const docId = await seedDocument(a);
    const runningJobId = await seedIndexJob(a, docId, "running");
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(202);
    expect(IndexResponse.parse(await res.json()).job).toMatchObject({ id: runningJobId, state: "running" });
    expect(await indexJobs(docId)).toHaveLength(1);
  });

  it("a queued index job is answered as it is", async () => {
    const a = await ctx.signUp("index-queued@example.com");
    const docId = await seedDocument(a);
    const queuedJobId = await seedIndexJob(a, docId, "queued");
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(202);
    expect(IndexResponse.parse(await res.json()).job).toMatchObject({ id: queuedJobId, state: "queued" });
    expect(await indexJobs(docId)).toHaveLength(1);
  });

  it("a succeeded index job gives 409 INVALID_STATE and is left as it is", async () => {
    const a = await ctx.signUp("index-succeeded@example.com");
    const docId = await seedDocument(a);
    await seedIndexJob(a, docId, "succeeded");
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("INVALID_STATE");
    expect((await indexJobs(docId)).map((j) => j.state)).toEqual(["succeeded"]);
  });

  it("a cancelled index job gives 409 INVALID_STATE and stays cancelled", async () => {
    const a = await ctx.signUp("index-cancelled@example.com");
    const docId = await seedDocument(a);
    await seedIndexJob(a, docId, "cancelled");
    const res = await post(a.workspaceId, docId, a.cookie);
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("INVALID_STATE");
    expect((await indexJobs(docId)).map((j) => j.state)).toEqual(["cancelled"]);
  });

  it("a duplicate, or a document not stored, gives 409 INVALID_STATE and no job", async () => {
    // seed: "dup" stored with intake_state duplicate; "up" pending_upload
    const a = await ctx.signUp("index-invalid@example.com");
    const original = await seedDocument(a);
    const dup = await seedDocument(a, { intakeState: "duplicate", duplicateOfDocumentId: original });
    const up = await seedDocument(a, { state: "pending_upload", intakeState: null });
    const rejected = await seedDocument(a, { state: "rejected", rejectionCode: "UNSUPPORTED_TYPE", intakeState: null });
    for (const id of [dup, up, rejected]) {
      const res = await post(a.workspaceId, id, a.cookie);
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("INVALID_STATE");
      expect(await indexJobs(id)).toHaveLength(0);
    }
  });

  it("another workspace's document is 404; signed out is 401", async () => {
    const a = await ctx.signUp("index-auth-a@example.com");
    const b = await ctx.signUp("index-auth-b@example.com");
    const docId = await seedDocument(a);
    expect((await post(b.workspaceId, docId, b.cookie)).status).toBe(404);
    expect((await post(a.workspaceId, docId)).status).toBe(401);
    expect((await post(a.workspaceId, crypto.randomUUID(), a.cookie)).status).toBe(404);
    expect(await indexJobs(docId)).toHaveLength(0);
  });
});
