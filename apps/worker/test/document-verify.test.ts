import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
