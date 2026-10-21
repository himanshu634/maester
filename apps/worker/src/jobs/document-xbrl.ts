import { and, eq, sql } from "drizzle-orm";
import type { DocumentXbrlResult, XbrlReadResult } from "@maester/contracts";
import { schema, type Db, type ExtractionRevisionRow, type JobRow } from "@maester/db";
import { enqueueXbrlPdfChecks, redecidePdfsAfterXbrl, type Dispatcher } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import { readAll, setIntakeIfCurrent } from "./document-extract.js";
import { INSERT_BATCH, factRow, insertRevisionChecks, readClassificationId } from "./revision-rows.js";
import { JobFailure, type FinalFailureDeps, type JobContext, type JobHandler } from "./types.js";

/**
 * The revision's format, read back from its prompt version `<format id>@<map version>`: `@-` is a format no map
 * reads, and `unknown` an instance in no family. The first write and a retry that finds the revision both answer
 * from it, so they always agree.
 */
function formatOf(revision: ExtractionRevisionRow): { format: string | null; mapped: boolean } {
  const at = revision.promptVersion.lastIndexOf("@");
  const id = at < 0 ? revision.promptVersion : revision.promptVersion.slice(0, at);
  return { format: id === "unknown" || id === "" ? null : id, mapped: at >= 0 && revision.promptVersion.slice(at + 1) !== "-" };
}

/** The revision's facts and its own failed sums and balance identities; `xbrl_in_pdf` rows written later never count. */
async function summary(db: Db, revision: ExtractionRevisionRow): Promise<DocumentXbrlResult> {
  const { rows } = await db.execute<{ facts: number; failed: number }>(sql`
    select
      (select count(*)::int from financial_fact f where f.workspace_id = ${revision.workspaceId} and f.revision_id = ${revision.id}) as facts,
      (select count(*)::int from extraction_check c
        where c.workspace_id = ${revision.workspaceId} and c.revision_id = ${revision.id}
          and c.status = 'failed' and c.check_type in ('subtotal', 'balance_identity')) as failed`);
  return {
    outcome: "read",
    revisionId: revision.id,
    state: revision.state,
    factCount: rows[0]!.facts,
    failedChecks: rows[0]!.failed,
    ...formatOf(revision),
  };
}

/** One coverage entry per statement and basis that has facts, in the order the read gives them. No page: XBRL has none. */
function coverageOf(result: XbrlReadResult) {
  const seen = new Map<string, { statement: string; basis: string; pages: number[]; status: string }>();
  for (const f of result.facts) {
    const key = `${f.statement}:${f.basis}`;
    if (!seen.has(key)) seen.set(key, { statement: f.statement, basis: f.basis, pages: [], status: "extracted" });
  }
  return [...seen.values()];
}

/**
 * Write one XBRL read as an immutable revision (`source 'xbrl'`, no pages), in a single transaction: each fact with
 * its span and period start and one `xbrl_source` row (element, context, decimals, nil, the map's concept), never a
 * `source_reference`; then the read's own checks. Values go in as the decimal strings the read gives. Unique per job,
 * so a retry after a crash that followed the commit finds the revision and writes nothing.
 */
export async function writeXbrlRevision(
  db: Db,
  job: JobRow,
  doc: { id: string; companyId: string | null },
  result: XbrlReadResult,
  classificationId: string | null,
): Promise<DocumentXbrlResult> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [revision] = await tx
      .insert(schema.extractionRevision)
      .values({
        id: crypto.randomUUID(),
        workspaceId: job.workspaceId,
        documentId: doc.id,
        jobId: job.id,
        classificationId,
        source: "xbrl",
        state: result.state,
        pipelineVersion: result.pipelineVersion,
        model: result.model,
        promptVersion: result.promptVersion,
        pageCount: 0,
        companyNameAsPrinted: null,
        coverage: { statements: coverageOf(result) },
        warnings: result.warnings,
      })
      .onConflictDoNothing({ target: schema.extractionRevision.jobId })
      .returning();
    if (!revision) {
      const [existing] = await tx
        .select()
        .from(schema.extractionRevision)
        .where(and(eq(schema.extractionRevision.jobId, job.id), eq(schema.extractionRevision.workspaceId, job.workspaceId)));
      return summary(t, existing!);
    }

    const facts = result.facts.map((f) => ({ id: crypto.randomUUID(), fact: f }));
    for (let i = 0; i < facts.length; i += INSERT_BATCH) {
      const batch = facts.slice(i, i + INSERT_BATCH);
      await tx
        .insert(schema.financialFact)
        .values(batch.map(({ id, fact: f }) => ({ ...factRow(job.workspaceId, revision.id, doc.companyId, id, f), periodStart: f.periodStart, span: f.span })));
      await tx.insert(schema.xbrlSource).values(
        batch.map(({ id, fact: f }) => ({
          id: crypto.randomUUID(),
          workspaceId: job.workspaceId,
          factId: id,
          documentId: doc.id,
          element: f.element,
          contextId: f.contextId,
          decimals: f.decimals,
          nil: f.nil,
          concept: f.concept,
        })),
      );
    }
    await insertRevisionChecks(t, job.workspaceId, revision.id, result.checks);
    return summary(t, revision);
  });
}

/** After the read is marked: pair it with the results PDFs it may check, then release the PDFs that waited for it. */
async function settle(db: Db, dispatcher: Dispatcher, workspaceId: string, documentId: string): Promise<void> {
  await enqueueXbrlPdfChecks(db, dispatcher, workspaceId, { xbrlDocumentId: documentId });
  await redecidePdfsAfterXbrl(db, dispatcher, workspaceId);
}

async function read(job: JobRow, ctx: JobContext): Promise<DocumentXbrlResult> {
  if (!ctx.extractor) throw new JobFailure("EXTRACTOR_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);

  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new JobFailure("INVALID_STATE", `document ${job.subjectId} not found in workspace ${job.workspaceId}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are read`, false);
  if (doc.duplicateOfDocumentId !== null || doc.intakeState === "duplicate") {
    throw new JobFailure("INVALID_STATE", "document is a duplicate; its original is read", false);
  }
  if (doc.format !== "xbrl") throw new JobFailure("INVALID_STATE", `document is ${doc.format}; document.xbrl reads XBRL instances only`, false);

  const classificationId = await readClassificationId(ctx.db, job, job.subjectId);
  const [done] = await ctx.db
    .select()
    .from(schema.extractionRevision)
    .where(and(eq(schema.extractionRevision.jobId, job.id), eq(schema.extractionRevision.workspaceId, job.workspaceId)));
  if (done) {
    // A crash after the revision committed: mark the document, pair and release again (each is idempotent).
    await setIntakeIfCurrent(ctx.db, job.workspaceId, doc.id, done.classificationId, "read");
    await settle(ctx.db, ctx.dispatcher, job.workspaceId, doc.id);
    return summary(ctx.db, done);
  }

  let instance: Uint8Array;
  try {
    instance = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored instance is missing", false);
    throw err;
  }

  await ctx.progress({ stage: "reading", percent: 0 });
  const result = await ctx.extractor.xbrl({ instance, documentId: doc.id, mode: "read" }, async () => {
    await ctx.heartbeat();
  });
  const written = await writeXbrlRevision(ctx.db, job, doc, result, classificationId);
  // Marked before the release: a document still `reading` is unsettled, and would hold its PDFs back.
  await setIntakeIfCurrent(ctx.db, job.workspaceId, doc.id, classificationId, "read");
  await settle(ctx.db, ctx.dispatcher, job.workspaceId, doc.id);
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: doc.id, ...written }, "xbrl read stored");
  return written;
}

export const documentXbrl: JobHandler = Object.assign(read, {
  async onFinalFailure(job: JobRow, { db, dispatcher }: FinalFailureDeps): Promise<void> {
    // A stray read of a PDF was never that PDF's read.
    const [doc] = await db
      .select({ format: schema.document.format })
      .from(schema.document)
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
      .limit(1);
    if (doc?.format !== "xbrl") return;
    await setIntakeIfCurrent(db, job.workspaceId, job.subjectId, await readClassificationId(db, job, job.subjectId), "read_failed");
    // A failed instance holds no PDF back.
    await redecidePdfsAfterXbrl(db, dispatcher, job.workspaceId);
  },
});
