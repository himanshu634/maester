import { and, asc, eq } from "drizzle-orm";
import { XBRL_PDF_CHECK_VERSION, XbrlPdfCheckRequest, type DocumentXbrlCheckResult, type XbrlPdfCheckResult } from "@maester/contracts";
import { getCurrentClassification, getCurrentRevision, schema, type FinancialFactRow, type JobRow } from "@maester/db";
import { xbrlCheckKeyOf } from "@maester/jobs";
import { ObjectNotFoundError } from "@maester/storage";
import { readAll } from "./document-extract.js";
import { JobFailure, type JobContext, type JobHandler } from "./types.js";

const INSERT_BATCH = 500;
const PER_SHARE = "₹ a share";
const ROUNDING_MISSING = "XBRL_ROUNDING_MISSING";

/** One fact's answer, from the extractor or written here, with the check version it was given under. */
type Answer = XbrlPdfCheckResult["results"][number] & { checkVersion: number };

/** Digits after the point of a decimal string as Postgres `numeric` returns it ("12345.00" has 2). Never a float. */
const placesOf = (value: string): number => {
  const point = value.indexOf(".");
  return point < 0 ? 0 : value.length - point - 1;
};

/**
 * The unit the PDF is searched in. `scale` is the scale factor the monetary facts share, null when the read
 * found no declared rounding (or the facts do not agree on one). `places` is the fewest places among the monetary
 * facts' reported values: the read pads every value to max(0, finest decimals − rounding exponent) and never
 * rounds, so the fewest is that padding. Null with `scale`, or when no monetary fact has a value.
 */
export function unitOf(facts: FinancialFactRow[], warnings: { code: string }[]): { scale: string | null; places: number | null } {
  if (warnings.some((w) => w.code === ROUNDING_MISSING)) return { scale: null, places: null };
  const monetary = facts.filter((f) => f.unitLabel !== PER_SHARE);
  const scales = new Set(monetary.map((f) => f.scaleFactor));
  const [scale] = [...scales];
  if (scales.size !== 1 || scale === null || scale === undefined) return { scale: null, places: null };
  const places = monetary.flatMap((f) => (f.reportedValue === null ? [] : [placesOf(f.reportedValue)]));
  return { scale, places: places.length ? Math.min(...places) : null };
}

async function check(job: JobRow, ctx: JobContext): Promise<DocumentXbrlCheckResult> {
  const key = xbrlCheckKeyOf(job.idempotencyKey);
  if (!key) throw new JobFailure("INVALID_STATE", "the job key names no PDF classification and XBRL revision", false);
  const ws = job.workspaceId;

  // Stale: the XBRL document has been read again (or has new answers not read yet), or the PDF has new answers.
  if ((await getCurrentRevision(ctx.db, ws, job.subjectId))?.id !== key.xbrlRevisionId) return { outcome: "stale", rows: 0 };
  const [pdfClassification] = await ctx.db
    .select()
    .from(schema.documentClassification)
    .where(and(eq(schema.documentClassification.id, key.pdfClassificationId), eq(schema.documentClassification.workspaceId, ws)))
    .limit(1);
  if (!pdfClassification) return { outcome: "stale", rows: 0 };
  if ((await getCurrentClassification(ctx.db, ws, pdfClassification.documentId))?.id !== pdfClassification.id) return { outcome: "stale", rows: 0 };

  const [revision] = await ctx.db
    .select()
    .from(schema.extractionRevision)
    .where(and(eq(schema.extractionRevision.id, key.xbrlRevisionId), eq(schema.extractionRevision.workspaceId, ws)));
  const facts = await ctx.db
    .select()
    .from(schema.financialFact)
    .where(and(eq(schema.financialFact.revisionId, key.xbrlRevisionId), eq(schema.financialFact.workspaceId, ws)))
    .orderBy(asc(schema.financialFact.statement), asc(schema.financialFact.basis), asc(schema.financialFact.lineOrder), asc(schema.financialFact.id));
  if (!revision || facts.length === 0) return { outcome: "not_mapped", rows: 0 };

  if (!ctx.env.XBRL_PDF_CHECK) return { outcome: "disabled", rows: 0 };

  const { scale, places } = unitOf(facts, revision.warnings);
  // With no unit, a monetary value has nothing to be looked for as: answered here, without the extractor.
  const unitless = (f: FinancialFactRow) => scale === null && f.unitLabel !== PER_SHARE;
  const answers: Answer[] = facts
    .filter(unitless)
    .map((f) => ({ factId: f.id, status: "not_checked", pageIndex: null, reason: "no_unit", checkVersion: XBRL_PDF_CHECK_VERSION }));
  const toSend = facts.filter((f) => !unitless(f));

  if (toSend.length > 0) {
    if (!ctx.extractor) throw new JobFailure("EXTRACTOR_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);
    const [pdf] = await ctx.db
      .select()
      .from(schema.document)
      .where(and(eq(schema.document.id, pdfClassification.documentId), eq(schema.document.workspaceId, ws)))
      .limit(1);
    if (!pdf || pdf.state !== "stored") throw new JobFailure("INVALID_STATE", "the results PDF is not stored", false);
    let bytes: Uint8Array;
    try {
      bytes = await readAll(ctx.store, pdf.storageKey);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored PDF is missing", false);
      throw err;
    }
    const request = XbrlPdfCheckRequest.parse({
      scale,
      places,
      statementPages: pdfClassification.statementsFound,
      facts: toSend.map((f) => ({
        factId: f.id,
        value: f.normalizedValue,
        perShare: f.unitLabel === PER_SHARE,
        statement: f.statement,
        basis: f.basis,
      })),
    });
    await ctx.progress({ stage: "checking", percent: 0 });
    const result = await ctx.extractor.xbrlPdfCheck({ pdf: bytes, documentId: pdf.id, request });
    const sent = new Set(toSend.map((f) => f.id));
    for (const r of result.results) {
      // An answer for a fact not sent is not ours to write.
      if (!sent.has(r.factId)) continue;
      sent.delete(r.factId);
      answers.push({ factId: r.factId, status: r.status, pageIndex: r.pageIndex, reason: r.reason, checkVersion: result.checkVersion });
    }
  }

  const byId = new Map(facts.map((f) => [f.id, f]));
  let rows = 0;
  for (let i = 0; i < answers.length; i += INSERT_BATCH) {
    const inserted = await ctx.db
      .insert(schema.extractionCheck)
      .values(
        answers.slice(i, i + INSERT_BATCH).map((a) => {
          const f = byId.get(a.factId)!;
          return {
            id: crypto.randomUUID(),
            workspaceId: ws,
            revisionId: key.xbrlRevisionId,
            checkType: "xbrl_in_pdf" as const,
            status: a.status,
            statement: f.statement,
            basis: f.basis,
            section: f.section,
            periodLabel: f.periodLabel,
            subjectLabel: f.reportedLabel,
            expected: f.reportedValue,
            actual: null,
            detail: "",
            factId: f.id,
            pdfDocumentId: pdfClassification.documentId,
            pdfClassificationId: pdfClassification.id,
            pageIndex: a.pageIndex,
            reason: a.reason,
            checkVersion: a.checkVersion,
          };
        }),
      )
      // The unique index (fact, PDF classification, check version) is partial: no target, so any conflict skips the row.
      .onConflictDoNothing()
      .returning({ id: schema.extractionCheck.id });
    rows += inserted.length;
  }

  const counts: Record<string, number> = {};
  for (const a of answers) counts[a.status] = (counts[a.status] ?? 0) + 1;
  await ctx.progress({ stage: "stored", percent: 100 });
  ctx.logger.info({ documentId: job.subjectId, pdfDocumentId: pdfClassification.documentId, rows, ...counts }, "xbrl pdf check stored");
  return { outcome: "checked", rows };
}

export const documentXbrlCheck: JobHandler = check;
