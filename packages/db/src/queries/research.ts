import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../client.js";
import { documentClassification } from "../schema/classification.js";
import { extractionCheck, financialFact, sourceReference, type ExtractionCheckRow } from "../schema/extraction.js";
import { document } from "../schema/platform.js";
import type { FactWithSource } from "./extraction.js";

export type CompanyFilingRow = {
  documentId: string;
  companyId: string;
  originalName: string;
  intakeState: (typeof document.$inferSelect)["intakeState"];
  kind: (typeof documentClassification.$inferSelect)["kind"] | null;
  periodEnd: string | null;
  createdAt: Date;
};

/**
 * Documents filed under a company (all companies when `companyId` is left out), newest first,
 * each with its current classification's kind and period. The company is the document's own
 * `company_id`: a fact's copy of it is only what it was when the fact was read.
 */
export async function listCompanyFilings(db: Db, workspaceId: string, companyId?: string): Promise<CompanyFilingRow[]> {
  const docs = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), companyId ? eq(document.companyId, companyId) : isNotNull(document.companyId)))
    .orderBy(desc(document.createdAt), desc(document.id));
  if (docs.length === 0) return [];
  const classifications = await db
    .select({ documentId: documentClassification.documentId, kind: documentClassification.kind, periodEnd: documentClassification.periodEnd })
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), inArray(documentClassification.documentId, docs.map((d) => d.id))))
    .orderBy(desc(documentClassification.createdAt), desc(documentClassification.id));
  const current = new Map<string, (typeof classifications)[number]>();
  for (const c of classifications) if (!current.has(c.documentId)) current.set(c.documentId, c);
  return docs.map((d) => ({
    documentId: d.id,
    companyId: d.companyId!,
    originalName: d.originalName,
    intakeState: d.intakeState,
    kind: current.get(d.id)?.kind ?? null,
    periodEnd: current.get(d.id)?.periodEnd ?? null,
    createdAt: d.createdAt,
  }));
}

/** Facts of several revisions, each with its source, in statement order. */
export async function listFactsWithSourcesForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<FactWithSource[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select({ fact: financialFact, source: sourceReference })
    .from(financialFact)
    .innerJoin(sourceReference, eq(sourceReference.factId, financialFact.id))
    .where(and(eq(financialFact.workspaceId, workspaceId), inArray(financialFact.revisionId, revisionIds)))
    .orderBy(asc(financialFact.revisionId), asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
}

export async function listChecksForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<ExtractionCheckRow[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select()
    .from(extractionCheck)
    .where(and(eq(extractionCheck.workspaceId, workspaceId), inArray(extractionCheck.revisionId, revisionIds)));
}
