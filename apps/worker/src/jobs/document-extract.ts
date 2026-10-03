import { and, eq } from "drizzle-orm";
import type { DocumentExtractResult, ExtractionResult } from "@maester/contracts";
import { schema, type Db, type ExtractionRevisionRow, type JobRow } from "@maester/db";
import { ObjectNotFoundError, type ObjectStore } from "@maester/storage";
import { JobFailure, type JobHandler } from "./types.js";

const INSERT_BATCH = 500;

async function readAll(store: ObjectStore, key: string): Promise<Uint8Array> {
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
  const facts = await db.select({ id: schema.financialFact.id }).from(schema.financialFact).where(eq(schema.financialFact.revisionId, revision.id));
  const failed = await db
    .select({ id: schema.extractionCheck.id })
    .from(schema.extractionCheck)
    .where(and(eq(schema.extractionCheck.revisionId, revision.id), eq(schema.extractionCheck.status, "failed")));
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
): Promise<DocumentExtractResult> {
  return db.transaction(async (tx) => {
    const [revision] = await tx
      .insert(schema.extractionRevision)
      .values({
        id: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        documentId: document.id,
        jobId: job.id,
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
      const [existing] = await tx.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.jobId, job.id));
      return existingSummary(tx as unknown as Db, existing!);
    }

    const facts = result.facts.map((f) => ({ id: crypto.randomUUID(), source: f }));
    for (let i = 0; i < facts.length; i += INSERT_BATCH) {
      const batch = facts.slice(i, i + INSERT_BATCH);
      await tx.insert(schema.financialFact).values(
        batch.map(({ id, source: f }) => ({
          id,
          workspaceId: job.workspaceId,
          revisionId: revision.id,
          companyId: document.companyId,
          statement: f.statement,
          basis: f.basis,
          section: f.section,
          lineOrder: f.lineOrder,
          reportedLabel: f.reportedLabel,
          isSubtotal: f.isSubtotal,
          componentLabels: f.componentLabels,
          periodLabel: f.periodLabel,
          periodEnd: f.periodEnd,
          asOfDate: f.asOfDate,
          reportedText: f.reportedText,
          reportedValue: f.reportedValue,
          valueStatus: f.valueStatus,
          unitLabel: f.unitLabel,
          scaleFactor: f.scaleFactor,
          currency: f.currency,
          normalizedValue: f.normalizedValue,
        })),
      );
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
    for (let i = 0; i < result.checks.length; i += INSERT_BATCH) {
      await tx.insert(schema.extractionCheck).values(
        result.checks.slice(i, i + INSERT_BATCH).map((c) => ({
          id: crypto.randomUUID(),
          workspaceId: job.workspaceId,
          revisionId: revision.id,
          checkType: c.checkType,
          statement: c.statement,
          basis: c.basis,
          section: c.section,
          periodLabel: c.periodLabel,
          subjectLabel: c.subjectLabel,
          status: c.status,
          expected: c.expected,
          actual: c.actual,
          detail: c.detail,
        })),
      );
    }
    return summary(revision, facts.length, result.checks.filter((c) => c.status === "failed").length);
  });
}

export const documentExtract: JobHandler = async (job, ctx) => {
  if (!ctx.extractor) throw new JobFailure("EXTRACTOR_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);

  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new JobFailure("DOCUMENT_NOT_FOUND", `document ${job.subjectId} not found in workspace ${job.workspaceId}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are extracted`, false);

  const [done] = await ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.jobId, job.id));
  if (done) return existingSummary(ctx.db, done);

  if ((doc.sizeBytes ?? 0) > ctx.env.EXTRACT_MAX_BYTES) {
    throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", `documents over ${ctx.env.EXTRACT_MAX_BYTES} bytes are not extracted`, false);
  }
  const company = doc.companyId
    ? (await ctx.db.select().from(schema.company).where(eq(schema.company.id, doc.companyId)).limit(1))[0]
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

  const written = await writeRevision(ctx.db, job, doc, result);
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: doc.id, ...written }, "extraction stored");
  return written;
};
