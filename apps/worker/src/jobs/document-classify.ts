import { and, eq, sql } from "drizzle-orm";
import type { ClassificationResult, DocumentClassifyResult } from "@maester/contracts";
import { getCurrentClassification, listEvidence, matchCompanies, schema, type ClassificationRow, type Db, type DocumentRow, type JobRow } from "@maester/db";
import { decideIntake, READ_KINDS } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import { readAll } from "./document-extract.js";
import { JobFailure, type JobContext, type JobHandler } from "./types.js";

/**
 * Store one classifier answer as an immutable classification with its evidence,
 * in one transaction. Unique per job, so a retry after a crash writes nothing new.
 * A company the investor gave is recorded as their answer. The document row is
 * locked first and the row stamped with the commit-ordered clock, so the
 * classification written last is always the current one.
 */
export async function writeClassification(
  db: Db,
  job: JobRow,
  doc: { id: string; investorCompanyId: string | null },
  result: ClassificationResult,
  companyId: string | null,
): Promise<ClassificationRow> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.document.id })
      .from(schema.document)
      .where(and(eq(schema.document.id, doc.id), eq(schema.document.workspaceId, job.workspaceId)))
      .for("update");
    const id = crypto.randomUUID();
    const reads = READ_KINDS.has(result.kind) && companyId !== null;
    const [row] = await tx
      .insert(schema.documentClassification)
      .values({
        id,
        workspaceId: job.workspaceId,
        documentId: doc.id,
        kind: result.kind,
        otherType: result.otherType,
        resultsSpan: result.resultsSpan,
        periodEnd: result.periodEnd,
        periodLabel: result.periodLabel,
        companyId,
        companyNameAsPrinted: result.companyNameAsPrinted,
        cin: result.cin,
        bseCode: result.bseCode,
        nseSymbol: result.nseSymbol,
        statementsFound: result.statementsFound,
        setBy: "maester",
        jobId: job.id,
        readsUnderId: reads ? id : null,
        rulesVersion: result.rulesVersion,
        model: result.model,
        promptVersion: result.promptVersion,
        warnings: result.warnings,
        createdAt: sql`clock_timestamp()`,
      })
      .onConflictDoNothing({ target: schema.documentClassification.jobId })
      .returning();
    if (!row) {
      const [existing] = await tx.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
      return existing!;
    }
    const evidence: (typeof schema.classificationEvidence.$inferInsert)[] = result.evidence.map((e) => ({
      id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: e.field, source: e.source,
      ruleId: e.ruleId, pageIndex: e.pageIndex, quote: e.quote, textLayerMatch: e.textLayerMatch,
    }));
    if (doc.investorCompanyId) {
      evidence.push({
        id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: "company", source: "investor",
        ruleId: null, pageIndex: null, quote: null, textLayerMatch: null,
      });
    }
    if (evidence.length) await tx.insert(schema.classificationEvidence).values(evidence);
    return row;
  });
}

async function uniqueMatch(db: Db, workspaceId: string, r: ClassificationResult): Promise<string | null> {
  const matches = await matchCompanies(db, workspaceId, { cin: r.cin, bseCode: r.bseCode, nseSymbol: r.nseSymbol, name: r.companyNameAsPrinted });
  return matches.length === 1 ? matches[0]!.id : null;
}

/**
 * The company the investor gave, if any. Once the document has answers, they say:
 * the current company counts only when its evidence is the investor's. Before the
 * first answers, a company on the document was given at upload.
 */
async function investorCompany(db: Db, doc: DocumentRow): Promise<string | null> {
  const current = await getCurrentClassification(db, doc.workspaceId, doc.id);
  if (!current) return doc.companyId;
  if (!current.companyId) return null;
  const evidence = await listEvidence(db, doc.workspaceId, current.id);
  return evidence.some((e) => e.field === "company" && e.source === "investor") ? current.companyId : null;
}

async function classify(job: JobRow, ctx: JobContext): Promise<DocumentClassifyResult> {
  if (!ctx.extractor) throw new JobFailure("CLASSIFIER_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);
  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)))
    .limit(1);
  if (!doc) throw new JobFailure("DOCUMENT_NOT_FOUND", `document ${job.subjectId} not found in workspace ${job.workspaceId}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are classified`, false);

  const [done] = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
  if (done) {
    // A crash after the write but before the decision left the document identifying; decide again.
    // Only from identifying: a retry after the read started or finished must not move the document back.
    const intakeState = await decideIntake(ctx.db, ctx.dispatcher, done, { read: true, onlyFrom: ["identifying"] });
    return { outcome: "classified", classificationId: done.id, kind: done.kind, intakeState };
  }

  if ((doc.sizeBytes ?? 0) > ctx.env.EXTRACT_MAX_BYTES) {
    throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", `documents over ${ctx.env.EXTRACT_MAX_BYTES} bytes are not classified`, false);
  }
  let pdf: Uint8Array;
  try {
    pdf = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored PDF is missing", false);
    throw err;
  }

  await ctx.progress({ stage: "identifying", percent: 0 });
  const result = await ctx.extractor.classify({ pdf, documentId: doc.id });
  const investorCompanyId = await investorCompany(ctx.db, doc);
  const companyId = investorCompanyId ?? (await uniqueMatch(ctx.db, job.workspaceId, result));
  const row = await writeClassification(ctx.db, job, { id: doc.id, investorCompanyId }, result, companyId);
  const intakeState = await decideIntake(ctx.db, ctx.dispatcher, row, { read: true });
  await ctx.progress({ stage: "identified", percent: 100 });
  ctx.logger.info({ documentId: doc.id, kind: row.kind, intakeState }, "document classified");
  return { outcome: "classified", classificationId: row.id, kind: row.kind, intakeState };
}

export const documentClassify: JobHandler = Object.assign(classify, {
  async onFinalFailure(job: JobRow, db: Db): Promise<void> {
    await db
      .update(schema.document)
      .set({ intakeState: "identify_failed", updatedAt: sql`now()` })
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId), eq(schema.document.intakeState, "identifying")));
  },
});
