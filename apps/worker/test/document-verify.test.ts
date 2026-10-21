import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { indexPipelineVersion } from "@maester/document-index";
import * as jobs from "@maester/jobs";
import { documentVerify } from "../src/jobs/document-verify.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

// The stub's body is Task 12's; here it is a spy that calls through.
vi.mock("@maester/jobs", async (importOriginal) => {
  const original = await importOriginal<typeof jobs>();
  return { ...original, redecidePdfsAfterXbrl: vi.fn(original.redecidePdfsAfterXbrl) };
});

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

  it("rejects a non-PDF as UNSUPPORTED_TYPE and the job still succeeds", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    await ctx.store.put(storageKey, new TextEncoder().encode("hello world"), "text/plain");
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("UNSUPPORTED_TYPE");
    expect(job.result).toEqual({ outcome: "rejected", code: "UNSUPPORTED_TYPE" });
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
      rejectionCode: "UNSUPPORTED_TYPE",
    });
    const spy = vi.spyOn(ctx.store, "readStream");

    const { res, job, doc } = await verify(workspaceId, id);

    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(job.result).toEqual({ outcome: "rejected", code: "UNSUPPORTED_TYPE" });
    expect(doc.state).toBe("rejected");
    expect(doc.rejectionCode).toBe("UNSUPPORTED_TYPE");
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
      const indexJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_INDEX));
      expect(indexJobs).toHaveLength(1);
      expect(indexJobs[0]).toMatchObject({ subjectType: "document_index", subjectId: id, workspaceId });
      expect(indexJobs[0]!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_INDEX}:${id}:${indexPipelineVersion(chained.env.EMBEDDING_MODEL)}`);
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
      const indexJobs = await chained.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_INDEX));
      expect(indexJobs.map((j) => j.subjectId)).toEqual([ids[0]]);
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

const INSTANCE = `<?xml version="1.0" encoding="UTF-8"?>
<!--IFIndAs V1.0 (07-10-2025)-->
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"><xbrli:context id="OneD"/></xbrli:xbrl>`;

async function seedXbrl(workspaceId: string, userId: string, name = "r.xml") {
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.xml`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: name, declaredSize: 100, declaredMime: "application/xml", format: "xbrl", storageKey, state: "uploaded", createdByUserId: userId,
  });
  return { id, storageKey };
}

describe("document.verify of XBRL", () => {
  afterEach(() => {
    vi.mocked(jobs.redecidePdfsAfterXbrl).mockClear();
  });

  it("stores an instance and creates its classify and index jobs", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedXbrl(workspaceId, userId);
    const bytes = new TextEncoder().encode(INSTANCE);
    await ctx.store.put(storageKey, bytes, "application/xml");
    const { job, doc } = await verify(workspaceId, id);
    expect(job.state).toBe("succeeded");
    expect(doc).toMatchObject({ state: "stored", format: "xbrl", intakeState: "identifying", sizeBytes: bytes.length });
    expect(doc.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const classify = await ctx.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_CLASSIFY));
    expect(classify.filter((j) => j.subjectId === id)).toHaveLength(1);
    const index = await ctx.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_INDEX));
    expect(index.filter((j) => j.subjectId === id)).toHaveLength(1);
    expect(jobs.redecidePdfsAfterXbrl).not.toHaveBeenCalled();
  });

  it("sniffs the head of an instance that is larger than the sniff window", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedXbrl(workspaceId, userId);
    const filler = "<xbrli:context id=\"c\"/>".repeat(Math.ceil((ctx.env.XBRL_SNIFF_BYTES * 2) / 22));
    const bytes = new TextEncoder().encode(INSTANCE.replace("</xbrli:xbrl>", `${filler}</xbrli:xbrl>`));
    expect(bytes.length).toBeGreaterThan(ctx.env.XBRL_SNIFF_BYTES);
    await ctx.store.put(storageKey, bytes, "application/xml");
    const { doc } = await verify(workspaceId, id);
    expect(doc).toMatchObject({ state: "stored", sizeBytes: bytes.length });
    expect(doc.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("rejects a .xml document that holds a PDF as UNSUPPORTED_TYPE and settles it for the PDFs waiting on XBRL", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedXbrl(workspaceId, userId);
    await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.7\nrest"), "application/xml");
    const { doc, job } = await verify(workspaceId, id);
    expect(doc).toMatchObject({ state: "rejected", rejectionCode: "UNSUPPORTED_TYPE" });
    expect(job.result).toEqual({ outcome: "rejected", code: "UNSUPPORTED_TYPE" });
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledTimes(1);
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledWith(ctx.db, ctx.dispatcher, workspaceId);
  });

  it("rejects a PDF document that holds XML as UNSUPPORTED_TYPE and does not redecide", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedDocument(workspaceId, userId);
    await ctx.store.put(storageKey, new TextEncoder().encode(INSTANCE), "application/pdf");
    const { doc } = await verify(workspaceId, id);
    expect(doc).toMatchObject({ state: "rejected", rejectionCode: "UNSUPPORTED_TYPE" });
    expect(jobs.redecidePdfsAfterXbrl).not.toHaveBeenCalled();
  });

  it("rejects an instance with a DOCTYPE as UNSUPPORTED_TYPE", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const { id, storageKey } = await seedXbrl(workspaceId, userId);
    const hostile = INSTANCE.replace("<xbrli:xbrl", `<!DOCTYPE xbrli:xbrl [<!ENTITY a "aaaa">]><xbrli:xbrl`);
    await ctx.store.put(storageKey, new TextEncoder().encode(hostile), "application/xml");
    const { doc } = await verify(workspaceId, id);
    expect(doc).toMatchObject({ state: "rejected", rejectionCode: "UNSUPPORTED_TYPE" });
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledTimes(1);
  });

  it("marks a second copy of an instance a duplicate: no classify, no index job, and the PDFs are redecided", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const ids: string[] = [];
    for (const name of ["one.xml", "two.xml"]) {
      const { id, storageKey } = await seedXbrl(workspaceId, userId, name);
      await ctx.store.put(storageKey, new TextEncoder().encode(INSTANCE), "application/xml");
      await verify(workspaceId, id);
      ids.push(id);
    }
    const [second] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, ids[1]!));
    expect(second).toMatchObject({ intakeState: "duplicate", duplicateOfDocumentId: ids[0] });
    const mine = (type: string) => ctx.db.select().from(schema.job).where(eq(schema.job.type, type)).then((rows) => rows.filter((j) => ids.includes(j.subjectId)).map((j) => j.subjectId));
    expect(await mine(JobTypes.DOCUMENT_CLASSIFY)).toEqual([ids[0]]);
    expect(await mine(JobTypes.DOCUMENT_INDEX)).toEqual([ids[0]]);
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledTimes(1);
  });

  it("onFinalFailure on an xbrl document redecides the PDFs with the worker's dispatcher; on a PDF it does nothing", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const x = await seedXbrl(workspaceId, userId);
    const p = await seedDocument(workspaceId, userId);
    const jobFor = async (subjectId: string) =>
      (await ctx.db.select().from(schema.job).where(eq(schema.job.id, await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId }))))[0]!;
    const deps = { db: ctx.db, dispatcher: ctx.dispatcher };
    await documentVerify.onFinalFailure!(await jobFor(p.id), deps);
    expect(jobs.redecidePdfsAfterXbrl).not.toHaveBeenCalled();
    await documentVerify.onFinalFailure!(await jobFor(x.id), deps);
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledTimes(1);
    expect(jobs.redecidePdfsAfterXbrl).toHaveBeenCalledWith(ctx.db, ctx.dispatcher, workspaceId);
  });
});
