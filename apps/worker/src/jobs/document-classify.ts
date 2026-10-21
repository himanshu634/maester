import { and, eq, sql } from "drizzle-orm";
import type { DocumentClassifyResult } from "@maester/contracts";
import { getCurrentClassification, listEvidence, matchCompanies, schema, type ClassificationRow, type Db, type DocumentRow, type JobRow } from "@maester/db";
import { decideIntake, READ_KINDS, redecidePdfsAfterXbrl } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import { answersFromPdf, answersFromXbrl, type ClassificationAnswers } from "./classification-answers.js";
import { readAll } from "./document-extract.js";
import { JobFailure, type FinalFailureDeps, type JobContext, type JobHandler } from "./types.js";

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
  answers: ClassificationAnswers,
  companyId: string | null,
): Promise<ClassificationRow> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.document.id })
      .from(schema.document)
      .where(and(eq(schema.document.id, doc.id), eq(schema.document.workspaceId, job.workspaceId)))
      .for("update");
    const id = crypto.randomUUID();
    const reads = READ_KINDS.has(answers.kind) && companyId !== null;
    const [row] = await tx
      .insert(schema.documentClassification)
      .values({
        id,
        workspaceId: job.workspaceId,
        documentId: doc.id,
        kind: answers.kind,
        otherType: answers.otherType,
        resultsSpan: answers.resultsSpan,
        periodEnd: answers.periodEnd,
        periodLabel: answers.periodLabel,
        companyId,
        companyNameAsPrinted: answers.companyNameAsPrinted,
        cin: answers.cin,
        bseCode: answers.bseCode,
        nseSymbol: answers.nseSymbol,
        isin: answers.isin,
        xbrlFormat: answers.xbrlFormat,
        basis: answers.basis,
        statementsFound: answers.statementsFound,
        setBy: "maester",
        jobId: job.id,
        readsUnderId: reads ? id : null,
        rulesVersion: answers.rulesVersion,
        model: answers.model,
        promptVersion: answers.promptVersion,
        warnings: answers.warnings,
        createdAt: sql`clock_timestamp()`,
      })
      .onConflictDoNothing({ target: schema.documentClassification.jobId })
      .returning();
    if (!row) {
      const [existing] = await tx.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
      return existing!;
    }
    const evidence: (typeof schema.classificationEvidence.$inferInsert)[] = answers.evidence.map((e) => ({
      id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: e.field, source: e.source,
      ruleId: e.ruleId, pageIndex: e.pageIndex, quote: e.quote, textLayerMatch: e.textLayerMatch, element: e.element, context: e.context,
    }));
    if (doc.investorCompanyId) {
      evidence.push({
        id: crypto.randomUUID(), workspaceId: job.workspaceId, classificationId: row.id, field: "company", source: "investor",
        ruleId: null, pageIndex: null, quote: null, textLayerMatch: null, element: null, context: null,
      });
    }
    if (evidence.length) await tx.insert(schema.classificationEvidence).values(evidence);
    return row;
  });
}

async function uniqueMatch(db: Db, workspaceId: string, r: ClassificationAnswers): Promise<string | null> {
  const matches = await matchCompanies(db, workspaceId, {
    cin: r.cin, bseCode: r.bseCode, nseSymbol: r.nseSymbol, isin: r.isin, name: r.companyNameAsPrinted,
  });
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

/** The PDF bytes, or the instance: a PDF is held to the extraction size limit, an instance only to the extractor's own. */
async function loadStored(doc: DocumentRow, ctx: JobContext): Promise<Uint8Array> {
  const isXbrl = doc.format === "xbrl";
  if (!isXbrl && (doc.sizeBytes ?? 0) > ctx.env.EXTRACT_MAX_BYTES) {
    throw new JobFailure("TOO_LARGE_FOR_EXTRACTION", `documents over ${ctx.env.EXTRACT_MAX_BYTES} bytes are not classified`, false);
  }
  try {
    return await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", isXbrl ? "the stored instance is missing" : "the stored PDF is missing", false);
    throw err;
  }
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
  const isXbrl = doc.format === "xbrl";

  const [done] = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.jobId, job.id));
  if (done) {
    // A crash after the write but before the decision left the document identifying; decide again.
    // Only from identifying: a retry after the read started or finished must not move the document back.
    const intakeState = await decideIntake(ctx.db, ctx.dispatcher, done, { read: true, onlyFrom: ["identifying"] });
    if (isXbrl) await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, job.workspaceId);
    return { outcome: "classified", classificationId: done.id, kind: done.kind, intakeState };
  }

  const bytes = await loadStored(doc, ctx);
  await ctx.progress({ stage: "identifying", percent: 0 });
  const answers = isXbrl
    ? answersFromXbrl(await ctx.extractor.xbrl({ instance: bytes, documentId: doc.id, mode: "classify" }, async () => { await ctx.heartbeat(); }))
    : answersFromPdf(await ctx.extractor.classify({ pdf: bytes, documentId: doc.id }));
  const investorCompanyId = await investorCompany(ctx.db, doc);
  const companyId = investorCompanyId ?? (await uniqueMatch(ctx.db, job.workspaceId, answers));
  const row = await writeClassification(ctx.db, job, { id: doc.id, investorCompanyId }, answers, companyId);
  const intakeState = await decideIntake(ctx.db, ctx.dispatcher, row, { read: true });
  // An instance that has settled may release the PDFs that waited for it.
  if (isXbrl) await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, job.workspaceId);
  await ctx.progress({ stage: "identified", percent: 100 });
  ctx.logger.info({ documentId: doc.id, kind: row.kind, format: row.xbrlFormat, intakeState }, "document classified");
  return { outcome: "classified", classificationId: row.id, kind: row.kind, intakeState };
}

export const documentClassify: JobHandler = Object.assign(classify, {
  async onFinalFailure(job: JobRow, { db, dispatcher }: FinalFailureDeps): Promise<void> {
    await db
      .update(schema.document)
      .set({ intakeState: "identify_failed", updatedAt: sql`now()` })
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId), eq(schema.document.intakeState, "identifying")));
    // A failed instance holds no PDF back.
    const [doc] = await db
      .select({ format: schema.document.format })
      .from(schema.document)
      .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, job.workspaceId)));
    if (doc?.format === "xbrl") await redecidePdfsAfterXbrl(db, dispatcher, job.workspaceId);
  },
});
