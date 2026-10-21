import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  extractionCheck,
  extractionRevision,
  financialFact,
  sourceReference,
  type ExtractionCheckRow,
  type ExtractionRevisionRow,
  type FinancialFactRow,
  type SourceReferenceRow,
} from "../schema/extraction.js";
import { xbrlSource, type XbrlSourceRow } from "../schema/xbrl.js";

/**
 * The `xbrl_in_pdf` check version this package reads. It mirrors `XBRL_PDF_CHECK_VERSION` in @maester/contracts, which
 * @maester/db does not depend on; apps/api's in-pdf test fails when the two differ.
 */
export const XBRL_PDF_CHECK_VERSION_READ = 1;

/** The newest revision of a document, which is its current one. */
export async function getLatestRevision(db: Db, workspaceId: string, documentId: string): Promise<ExtractionRevisionRow | null> {
  const rows = await db
    .select()
    .from(extractionRevision)
    .where(and(eq(extractionRevision.workspaceId, workspaceId), eq(extractionRevision.documentId, documentId)))
    .orderBy(desc(extractionRevision.createdAt), desc(extractionRevision.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRevision(db: Db, workspaceId: string, documentId: string, revisionId: string): Promise<ExtractionRevisionRow | null> {
  const rows = await db
    .select()
    .from(extractionRevision)
    .where(
      and(
        eq(extractionRevision.workspaceId, workspaceId),
        eq(extractionRevision.documentId, documentId),
        eq(extractionRevision.id, revisionId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** A revision's own arithmetic checks. `xbrl_in_pdf` rows, which arrive later with a PDF, are left out: see `listXbrlPdfChecks`. */
export async function listChecks(db: Db, workspaceId: string, revisionId: string): Promise<ExtractionCheckRow[]> {
  return db
    .select()
    .from(extractionCheck)
    .where(and(eq(extractionCheck.workspaceId, workspaceId), eq(extractionCheck.revisionId, revisionId), ne(extractionCheck.checkType, "xbrl_in_pdf")))
    .orderBy(asc(extractionCheck.statement), asc(extractionCheck.basis), asc(extractionCheck.subjectLabel), asc(extractionCheck.periodLabel));
}

/** A fact with where it was read: `source` for a page of a PDF, `xbrl` for an XBRL element; both null when neither row was stored. */
export type FactWithSource = { fact: FinancialFactRow; source: SourceReferenceRow | null; xbrl: XbrlSourceRow | null };

/** A revision's facts in statement order, each with its page or XBRL source. */
export async function listFactsWithSources(db: Db, workspaceId: string, revisionId: string): Promise<FactWithSource[]> {
  return db
    .select({ fact: financialFact, source: sourceReference, xbrl: xbrlSource })
    .from(financialFact)
    .leftJoin(sourceReference, and(eq(sourceReference.factId, financialFact.id), eq(sourceReference.workspaceId, financialFact.workspaceId)))
    .leftJoin(xbrlSource, and(eq(xbrlSource.factId, financialFact.id), eq(xbrlSource.workspaceId, financialFact.workspaceId)))
    .where(and(eq(financialFact.workspaceId, workspaceId), eq(financialFact.revisionId, revisionId)))
    .orderBy(asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
}

/**
 * The `xbrl_in_pdf` rows of these XBRL facts, at the current check version only (a corrected check writes a new set
 * beside the old). The one reader of those rows.
 */
export async function listXbrlPdfChecks(db: Db, workspaceId: string, factIds: string[]): Promise<ExtractionCheckRow[]> {
  if (factIds.length === 0) return [];
  return db
    .select()
    .from(extractionCheck)
    .where(
      and(
        eq(extractionCheck.workspaceId, workspaceId),
        eq(extractionCheck.checkType, "xbrl_in_pdf"),
        eq(extractionCheck.checkVersion, XBRL_PDF_CHECK_VERSION_READ),
        inArray(extractionCheck.factId, factIds),
      ),
    );
}
