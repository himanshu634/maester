import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { documentVerify } from "../src/jobs/document-verify.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify }); });
afterAll(() => ctx.close());

async function seedDocument(workspaceId: string, userId: string, state: "uploaded" = "uploaded") {
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "x.pdf", declaredSize: 100, declaredMime: "application/pdf", storageKey, state, createdByUserId: userId,
  });
  return { id, storageKey };
}

async function verify(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_VERIFY, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, docId));
  return { res, job: job!, doc: doc! };
}

describe("document.verify", () => {
  it("stores a valid PDF with its full sha256 and size", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    const bytes = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj << >> endobj\n%%EOF");
    await ctx.store.put(storageKey, bytes, "application/pdf");
    const { res, job, doc } = await verify(workspaceId, id);
    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("stored");
    expect(doc.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(doc.sizeBytes).toBe(bytes.length);
    expect(doc.storedAt).not.toBeNull();
    expect(job.result).toEqual({ outcome: "stored", sha256: doc.contentSha256, sizeBytes: bytes.length });
  });

  it("rejects a non-PDF as NOT_A_PDF and the job still succeeds", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    await ctx.store.put(storageKey, new TextEncoder().encode("hello world"), "text/plain");
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("NOT_A_PDF");
    expect(job.result).toEqual({ outcome: "rejected", code: "NOT_A_PDF" });
  });

  it("rejects a missing object as OBJECT_MISSING", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id } = await seedDocument(workspaceId, userId);
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("OBJECT_MISSING");
  });

  it("rejects an object over the limit as TOO_LARGE", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    const big = new Uint8Array(ctx.env.MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-"), 0);
    await ctx.store.put(storageKey, big, "application/pdf");
    const { doc } = await verify(workspaceId, id);
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("TOO_LARGE");
  });

  it("fails the attempt when the document row is missing", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: crypto.randomUUID(), maxAttempts: 1 });
    const res = await runJob(ctx, JobTypes.DOCUMENT_VERIFY, jobId);
    expect(res.status).toBe(200);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(job!.state).toBe("failed");
  });
});

describe("document.verify idempotent short-circuit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("short-circuits an already-stored document without reading storage", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const id = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
    const sha256 = "a".repeat(64);
    await ctx.db.insert(schema.document).values({
      id,
      workspaceId,
      originalName: "x.pdf",
      declaredSize: 42,
      declaredMime: "application/pdf",
      storageKey,
      state: "stored",
      createdByUserId: userId,
      contentSha256: sha256,
      sizeBytes: 42,
      storedAt: new Date(),
    });
    const spy = vi.spyOn(ctx.store, "readStream");

    const { res, job, doc } = await verify(workspaceId, id);

    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(job.result).toEqual({ outcome: "stored", sha256, sizeBytes: 42 });
    expect(doc.state).toBe("stored");
    expect(doc.contentSha256).toBe(sha256);
    expect(spy).not.toHaveBeenCalled();
  });

  it("short-circuits an already-rejected document without reading storage", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const id = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
    await ctx.db.insert(schema.document).values({
      id,
      workspaceId,
      originalName: "x.pdf",
      declaredSize: 42,
      declaredMime: "application/pdf",
      storageKey,
      state: "rejected",
      createdByUserId: userId,
      rejectionCode: "NOT_A_PDF",
    });
    const spy = vi.spyOn(ctx.store, "readStream");

    const { res, job, doc } = await verify(workspaceId, id);

    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(job.result).toEqual({ outcome: "rejected", code: "NOT_A_PDF" });
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("NOT_A_PDF");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("document.verify storage error handling and streaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates a transient storage error for retry, leaving the document verifying", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id } = await seedDocument(workspaceId, userId);
    vi.spyOn(ctx.store, "readStream").mockRejectedValueOnce(new Error("gcs 503"));
    const jobId = await seedJob(ctx.db, workspaceId, {
      type: JobTypes.DOCUMENT_VERIFY,
      subjectType: "document",
      subjectId: id,
      maxAttempts: 3,
    });

    const res = await runJob(ctx, JobTypes.DOCUMENT_VERIFY, jobId);

    expect(res.status).toBe(500);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(job!.state).toBe("queued");
    expect(job!.attempt).toBe(1);
    expect(job!.lastErrorCode).toBe("HANDLER_ERROR");
    expect(job!.lastErrorMessage).toContain("gcs 503");
    const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, id));
    expect(doc!.state).toBe("verifying");
  });

  it("hashes and sizes correctly when the PDF magic header spans chunk boundaries", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    const chunks = [Buffer.from("%PD"), Buffer.from("F-1.7\n"), Buffer.from("rest of file %%EOF")];
    const full = Buffer.concat(chunks);
    await ctx.store.put(storageKey, full, "application/pdf");
    vi.spyOn(ctx.store, "readStream").mockResolvedValueOnce(Readable.from(chunks));

    const { res, job, doc } = await verify(workspaceId, id);

    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("stored");
    expect(doc.sizeBytes).toBe(full.length);
    expect(doc.contentSha256).toBe(createHash("sha256").update(full).digest("hex"));
  });
});

describe("document.verify hands over to classification", () => {
  it("enqueues document.classify once, even when the extractor is not configured, and marks identifying", async () => {
    const chained = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify });
    try {
      const { workspaceId, userId } = await seedWorkspace(chained.db);
      const id = crypto.randomUUID();
      const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
      await chained.db.insert(schema.document).values({
        id, workspaceId, originalName: "a.pdf", declaredSize: 8, declaredMime: "application/pdf", storageKey, state: "uploaded", createdByUserId: userId,
      });
      await chained.store.put(storageKey, new TextEncoder().encode("%PDF-1.7"), "application/pdf");
      for (let i = 0; i < 2; i++) {
        const jobId = await seedJob(chained.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: id });
        await runJob(chained, JobTypes.DOCUMENT_VERIFY, jobId);
      }
      const classifyJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
      expect(classifyJobs).toHaveLength(1);
      expect(classifyJobs[0]!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_CLASSIFY}:${id}:auto`);
      expect(await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_EXTRACT))).toHaveLength(0);
      const [doc] = await chained.db.select().from(schema.document).where(eq(schema.document.id, id));
      expect(doc!.intakeState).toBe("identifying");
    } finally {
      await chained.close();
    }
  });

  it("marks a second copy of a stored file as a duplicate and does not classify it", async () => {
    const chained = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify });
    try {
      const { workspaceId, userId } = await seedWorkspace(chained.db);
      const ids: string[] = [];
      for (const name of ["first.pdf", "second.pdf"]) {
        const id = crypto.randomUUID();
        const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
        await chained.db.insert(schema.document).values({
          id, workspaceId, originalName: name, declaredSize: 8, declaredMime: "application/pdf", storageKey, state: "uploaded", createdByUserId: userId,
        });
        await chained.store.put(storageKey, new TextEncoder().encode("%PDF-1.7"), "application/pdf");
        const jobId = await seedJob(chained.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: id });
        await runJob(chained, JobTypes.DOCUMENT_VERIFY, jobId);
        ids.push(id);
      }
      const [second] = await chained.db.select().from(schema.document).where(eq(schema.document.id, ids[1]!));
      expect(second).toMatchObject({ intakeState: "duplicate", duplicateOfDocumentId: ids[0] });
      const classifyJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
      expect(classifyJobs.map((j) => j.subjectId)).toEqual([ids[0]]);
    } finally {
      await chained.close();
    }
  });

  it("two copies stored together: only the newer becomes a duplicate", async () => {
    const chained = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify });
    try {
      const { workspaceId, userId } = await seedWorkspace(chained.db);
      const sha = "c".repeat(64);
      const make = async (name: string, createdAt: Date) => {
        const id = crypto.randomUUID();
        await chained.db.insert(schema.document).values({
          id, workspaceId, originalName: name, declaredSize: 8, declaredMime: "application/pdf",
          storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", contentSha256: sha, sizeBytes: 8,
          createdByUserId: userId, createdAt,
        });
        return id;
      };
      const older = await make("older.pdf", new Date(Date.now() - 60_000));
      const newer = await make("newer.pdf", new Date());
      for (const id of [newer, older]) {
        const jobId = await seedJob(chained.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: id });
        await runJob(chained, JobTypes.DOCUMENT_VERIFY, jobId);
      }
      const [n] = await chained.db.select().from(schema.document).where(eq(schema.document.id, newer));
      const [o] = await chained.db.select().from(schema.document).where(eq(schema.document.id, older));
      expect(n).toMatchObject({ intakeState: "duplicate", duplicateOfDocumentId: older });
      expect(o).toMatchObject({ intakeState: "identifying", duplicateOfDocumentId: null });
      const classifyJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
      expect(classifyJobs.map((j) => j.subjectId)).toEqual([older]);
    } finally {
      await chained.close();
    }
  });
});
