import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { JobTypes, type DocumentVerifyResult, type RejectionCode } from "@maester/contracts";
import { findStoredDuplicate, schema, type JobRow } from "@maester/db";
import { createJob } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import type { JobContext, JobHandler } from "./types.js";

/**
 * Hand a stored document to intake: a second copy of a stored file is marked a
 * duplicate; anything else is classified. Keyed "auto", so a verify retry never
 * enqueues twice, and a classify job runs even without an extractor (it then
 * fails with CLASSIFIER_NOT_CONFIGURED, which the investor sees).
 */
async function chainIntake(job: JobRow, ctx: JobContext, sha256: string): Promise<void> {
  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc || doc.intakeState === "duplicate") return;
  let intakeState = doc.intakeState;
  if (intakeState === null) {
    const untouched = and(eq(schema.document.id, doc.id), eq(schema.document.workspaceId, job.workspaceId), isNull(schema.document.intakeState));
    const duplicate = await findStoredDuplicate(ctx.db, job.workspaceId, doc.id, sha256);
    if (duplicate) {
      await ctx.db
        .update(schema.document)
        .set({ intakeState: "duplicate", duplicateOfDocumentId: duplicate.id, updatedAt: sql`now()` })
        .where(untouched);
      ctx.logger.info({ documentId: doc.id, duplicateOf: duplicate.id }, "duplicate document");
      return;
    }
    await ctx.db.update(schema.document).set({ intakeState: "identifying", updatedAt: sql`now()` }).where(untouched);
    intakeState = "identifying";
  }
  if (intakeState !== "identifying") return;
  const next = await createJob(ctx.db, ctx.dispatcher, {
    workspaceId: job.workspaceId,
    type: JobTypes.DOCUMENT_CLASSIFY,
    subjectType: "document",
    subjectId: job.subjectId,
    pipelineVersion: "auto",
  });
  ctx.logger.info({ documentId: job.subjectId, classifyJobId: next.id }, "classification enqueued");
}

const PDF_MAGIC = Buffer.from("%PDF-");

export const documentVerify: JobHandler = async (job, ctx) => {
  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new Error(`document ${job.subjectId} not found in workspace ${job.workspaceId}`);
  if (doc.state === "stored") {
    await chainIntake(job, ctx, doc.contentSha256!);
    return { outcome: "stored", sha256: doc.contentSha256!, sizeBytes: doc.sizeBytes! } satisfies DocumentVerifyResult;
  }
  if (doc.state === "rejected") {
    return { outcome: "rejected", code: doc.rejectionCode as RejectionCode } satisfies DocumentVerifyResult;
  }

  await ctx.db.update(schema.document).set({ state: "verifying", updatedAt: sql`now()` }).where(eq(schema.document.id, doc.id));
  await ctx.progress({ stage: "hashing", percent: 0 });

  const reject = async (code: RejectionCode): Promise<DocumentVerifyResult> => {
    await ctx.db
      .update(schema.document)
      .set({ state: "rejected", rejectionCode: code, updatedAt: sql`now()` })
      .where(eq(schema.document.id, doc.id));
    ctx.logger.info({ documentId: doc.id, code }, "document rejected");
    return { outcome: "rejected", code };
  };

  let stream;
  try {
    stream = await ctx.store.readStream(doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return reject("OBJECT_MISSING");
    throw err;
  }

  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buf.length;
    if (size > ctx.env.MAX_UPLOAD_BYTES) {
      stream.destroy();
      return reject("TOO_LARGE");
    }
    if (head.length < PDF_MAGIC.length) head = Buffer.concat([head, buf]).subarray(0, PDF_MAGIC.length);
    hash.update(buf);
  }
  if (!head.equals(PDF_MAGIC)) return reject("NOT_A_PDF");

  const sha256 = hash.digest("hex");
  await ctx.db
    .update(schema.document)
    .set({ state: "stored", contentSha256: sha256, sizeBytes: size, storedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.document.id, doc.id));
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: doc.id, sizeBytes: size }, "document stored");
  await chainIntake(job, ctx, sha256);
  return { outcome: "stored", sha256, sizeBytes: size } satisfies DocumentVerifyResult;
};
