import { and, eq, sql } from "drizzle-orm";
import type { DocumentExtractNotRead, DocumentExtractResult, ExtractionResult } from "@maester/contracts";
import { getCurrentClassification, schema, type Db, type ExtractionRevisionRow, type JobRow } from "@maester/db";
import { classificationIdOfReadJob, recheckPdfRead } from "@maester/jobs";
import { ObjectNotFoundError, type ObjectStore } from "@maester/storage";
import { INSERT_BATCH, factRow, insertRevisionChecks, readClassificationId } from "./revision-rows.js";
import { JobFailure, type FinalFailureDeps, type JobContext, type JobHandler } from "./types.js";

export async function readAll(store: ObjectStore, key: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of await store.readStream(key)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function summary(revision: ExtractionRevisionRow, factCount: number, failedChecks: number): DocumentExtractResult {
  return { outcome: "extracted", revisionId: revision.id, state: revision.state, factCount, failedChecks };
}

async function existingSummary(db: Db, revision: ExtractionRevisionRow): Promise<DocumentExtractResult> {
  const facts = await db
    .select({ id: schema.financialFact.id })
    .from(schema.financialFact)
    .where(and(eq(schema.financialFact.workspaceId, revision.workspaceId), eq(schema.financialFact.revisionId, revision.id)));
  const failed = await db
    .select({ id: schema.extractionCheck.id })
    .from(schema.extractionCheck)
    .where(
      and(
        eq(schema.extractionCheck.workspaceId, revision.workspaceId),
        eq(schema.extractionCheck.revisionId, revision.id),
        eq(schema.extractionCheck.status, "failed"),
      ),
    );
  return summary(revision, facts.length, failed.length);
}

/**
 * Write one extraction result as an immutable revision, in a single transaction.
 * The revision is unique per job, so a retry after a crash that followed the
 * commit finds the revision and writes nothing.
 */
export async function writeRevision(
  db: Db,
  job: JobRow,
  document: { id: string; companyId: string | null },
  result: ExtractionResult,
  classificationId: string | null,
): Promise<DocumentExtractResult> {
  return db.transaction(async (tx) => {
    const [revision] = await tx
      .insert(schema.extractionRevision)
      .values({
        id: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        documentId: document.id,
        jobId: job.id,
        classificationId,
        state: result.state,
        pipelineVersion: result.pipelineVersion,
        model: result.model,
        promptVersion: result.promptVersion,
        pageCount: result.pageCount,
        companyNameAsPrinted: result.companyNameAsPrinted,
        coverage: { statements: result.coverage },
        warnings: result.warnings,
      })
      .onConflictDoNothing({ target: schema.extractionRevision.jobId })
      .returning();
    if (!revision) {
      const [existing] = await tx
        .select()
        .from(schema.extractionRevision)
        .where(and(eq(schema.extractionRevision.workspaceId, job.workspaceId), eq(schema.extractionRevision.jobId, job.id)));
      return existingSummary(tx as unknown as Db, existing!);
    }

    const facts = result.facts.map((f) => ({ id: crypto.randomUUID(), source: f }));
    for (let i = 0; i < facts.length; i += INSERT_BATCH) {
      const batch = facts.slice(i, i + INSERT_BATCH);
      await tx.insert(schema.financialFact).values(batch.map(({ id, source: f }) => factRow(job.workspaceId, revision.id, document.companyId, id, f)));
      await tx.insert(schema.sourceReference).values(
        batch.map(({ id, source: f }) => ({
          id: crypto.randomUUID(),
          workspaceId: job.workspaceId,
          factId: id,
          documentId: document.id,
          pageIndex: f.pageIndex,
          textLayerMatch: f.textLayerMatch,
        })),
      );
    }
    await insertRevisionChecks(tx as unknown as Db, job.workspaceId, revision.id, result.checks);
    return summary(revision, facts.length, result.checks.filter((c) => c.status === "failed").length);
  });
}

/** Mark the document only when this read is the one its current answers point at. */
export async function setIntakeIfCurrent(db: Db, workspaceId: string, documentId: string, classificationId: string | null, state: "read" | "read_failed"): Promise<void> {
  if (!classificationId) return;
  const current = await getCurrentClassification(db, workspaceId, documentId);
  if (current?.readsUnderId !== classificationId) return;
  await db
    .update(schema.document)
    .set({ intakeState: state, updatedAt: sql`now()` })
    .where(and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspaceId)));
}

async function extract(job: JobRow, ctx: JobContext): Promise<DocumentExtractResult | DocumentExtractNotRead> {
  if (!ctx.extractor) throw new JobFailure("EXTRACTOR_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);

  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new JobFailure("DOCUMENT_NOT_FOUND", `document ${job.subjectId} not found in workspace ${job.workspaceId}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are extracted`, false);
  // An XBRL instance's numbers come from document.xbrl, never from a paid model read.
  if (doc.format === "xbrl") throw new JobFailure("INVALID_STATE", "document is an XBRL instance; document.xbrl reads it", false);

  const [done] = await ctx.db
    .select()
    .from(schema.extractionRevision)
    .where(and(eq(schema.extractionRevision.workspaceId, job.workspaceId), eq(schema.extractionRevision.jobId, job.id)));
  if (done) {
    // A crash after the revision committed but before the document was marked; mark it again (idempotent).
    await setIntakeIfCurrent(ctx.db, job.workspaceId, doc.id, done.classificationId, "read");
    return existingSummary(ctx.db, done);
  }

  // An automatic read was decided before XBRL dropped with the PDF may have come in: ask the source rule again, so a
  // results PDF that XBRL covers, or may yet, is never given to a paid read. A manual re-read is checked by the API.
  const automatic = classificationIdOfReadJob(job.idempotencyKey);
  if (automatic) {
    const plan = await recheckPdfRead(ctx.db, job.workspaceId, doc.id, automatic);
    if (plan) {
      ctx.logger.info({ documentId: doc.id, plan }, "extraction not needed");
      return { outcome: "not_read", plan };
    }
  }

  if ((doc.sizeBytes ?? 0) > ctx.env.EXTRACT_MAX_BYTES) {
    throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", `documents over ${ctx.env.EXTRACT_MAX_BYTES} bytes are not extracted`, false);
  }
  const company = doc.companyId
    ? (
        await ctx.db
          .select()
          .from(schema.company)
          .where(and(eq(schema.company.id, doc.companyId), eq(schema.company.workspaceId, job.workspaceId)))
          .limit(1)
      )[0]
    : undefined;

  let pdf: Uint8Array;
  try {
    pdf = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored PDF is missing", false);
    throw err;
  }

  await ctx.progress({ stage: "extracting", percent: 0 });
  const result = await ctx.extractor.extract({ pdf, documentId: doc.id, companyName: company?.displayName ?? null }, async (event) => {
    await ctx.heartbeat();
    if (event.type === "progress") await ctx.progress({ stage: event.stage, percent: event.percent });
  });

  const classificationId = await readClassificationId(ctx.db, job, doc.id);
  const written = await writeRevision(ctx.db, job, doc, result, classificationId);
  await setIntakeIfCurrent(ctx.db, job.workspaceId, doc.id, classificationId, "read");
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: doc.id, ...written }, "extraction stored");
  return written;
}

export const documentExtract: JobHandler = Object.assign(extract, {
  async onFinalFailure(job: JobRow, { db }: FinalFailureDeps): Promise<void> {
    // A stray extract of an instance was never its read: document.xbrl's outcome stands.
    const [doc] = await db
      .select({ format: schema.document.format })
      .from(schema.document)
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
      .limit(1);
    if (doc?.format === "xbrl") return;
    const classificationId = await readClassificationId(db, job, job.subjectId);
    await setIntakeIfCurrent(db, job.workspaceId, job.subjectId, classificationId, "read_failed");
  },
});
