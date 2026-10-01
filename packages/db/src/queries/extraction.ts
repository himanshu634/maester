import { and, asc, desc, eq } from "drizzle-orm";
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

export async function listChecks(db: Db, workspaceId: string, revisionId: string): Promise<ExtractionCheckRow[]> {
  return db
    .select()
    .from(extractionCheck)
    .where(and(eq(extractionCheck.workspaceId, workspaceId), eq(extractionCheck.revisionId, revisionId)))
    .orderBy(asc(extractionCheck.statement), asc(extractionCheck.basis), asc(extractionCheck.subjectLabel), asc(extractionCheck.periodLabel));
}

export type FactWithSource = { fact: FinancialFactRow; source: SourceReferenceRow };

/** A revision's facts in statement order, each with its source reference. */
export async function listFactsWithSources(db: Db, workspaceId: string, revisionId: string): Promise<FactWithSource[]> {
  return db
    .select({ fact: financialFact, source: sourceReference })
    .from(financialFact)
    .innerJoin(sourceReference, eq(sourceReference.factId, financialFact.id))
    .where(and(eq(financialFact.workspaceId, workspaceId), eq(financialFact.revisionId, revisionId)))
    .orderBy(asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
}
