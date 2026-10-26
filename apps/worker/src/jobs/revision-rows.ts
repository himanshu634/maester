import type { ExtractedCheck, ExtractedFact } from "@maester/contracts";
import { getCurrentClassification, schema, type Db, type JobRow } from "@maester/db";
import { classificationIdOfReadJob } from "@maester/jobs";

/** Rows go in this many to an insert, to stay under the driver's parameter limit. */
export const INSERT_BATCH = 500;

/** The part of a fact that a PDF read and an XBRL read both give. */
export type RevisionFact = Omit<ExtractedFact, "pageIndex" | "textLayerMatch">;

/** The `financial_fact` row for one fact of a revision. An XBRL read adds `periodStart` and `span`. */
export function factRow(workspaceId: string, revisionId: string, companyId: string | null, id: string, f: RevisionFact) {
  return {
    id,
    workspaceId,
    revisionId,
    companyId,
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
  };
}

/** Write a read's own checks to its revision, in batches. */
export async function insertRevisionChecks(tx: Db, workspaceId: string, revisionId: string, checks: ExtractedCheck[]): Promise<void> {
  for (let i = 0; i < checks.length; i += INSERT_BATCH) {
    await tx.insert(schema.extractionCheck).values(
      checks.slice(i, i + INSERT_BATCH).map((c) => ({
        id: crypto.randomUUID(),
        workspaceId,
        revisionId,
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
}

/** The classification a read job is for: the one in its key, else the one the document's current answers read under. */
export async function readClassificationId(db: Db, job: JobRow, documentId: string): Promise<string | null> {
  return classificationIdOfReadJob(job.idempotencyKey) ?? (await getCurrentClassification(db, job.workspaceId, documentId))?.readsUnderId ?? null;
}
