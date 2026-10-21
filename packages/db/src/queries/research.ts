import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { Db } from "../client.js";
import { documentClassification, type StatementsFoundJson } from "../schema/classification.js";
import { extractionCheck, financialFact, sourceReference, type ExtractionCheckRow } from "../schema/extraction.js";
import { document } from "../schema/platform.js";
import { xbrlSource } from "../schema/xbrl.js";
import type { FactWithSource } from "./extraction.js";

export type CompanyFilingRow = {
  documentId: string;
  companyId: string;
  originalName: string;
  format: (typeof document.$inferSelect)["format"];
  state: (typeof document.$inferSelect)["state"];
  duplicateOfDocumentId: string | null;
  intakeState: (typeof document.$inferSelect)["intakeState"];
  /** The current classification; null, with no kind, period or statements, for a document never classified. */
  classificationId: string | null;
  kind: (typeof documentClassification.$inferSelect)["kind"] | null;
  periodEnd: string | null;
  statementsFound: StatementsFoundJson;
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
    .select({
      id: documentClassification.id,
      documentId: documentClassification.documentId,
      kind: documentClassification.kind,
      periodEnd: documentClassification.periodEnd,
      statementsFound: documentClassification.statementsFound,
    })
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), inArray(documentClassification.documentId, docs.map((d) => d.id))))
    .orderBy(desc(documentClassification.createdAt), desc(documentClassification.id));
  const current = new Map<string, (typeof classifications)[number]>();
  for (const c of classifications) if (!current.has(c.documentId)) current.set(c.documentId, c);
  return docs.map((d) => ({
    documentId: d.id,
    companyId: d.companyId!,
    originalName: d.originalName,
    format: d.format,
    state: d.state,
    duplicateOfDocumentId: d.duplicateOfDocumentId,
    intakeState: d.intakeState,
    classificationId: current.get(d.id)?.id ?? null,
    kind: current.get(d.id)?.kind ?? null,
    periodEnd: current.get(d.id)?.periodEnd ?? null,
    statementsFound: current.get(d.id)?.statementsFound ?? [],
    createdAt: d.createdAt,
  }));
}

/** Facts of several revisions, each with its page or XBRL source (both null when neither was stored), in statement order. */
export async function listFactsWithSourcesForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<FactWithSource[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select({ fact: financialFact, source: sourceReference, xbrl: xbrlSource })
    .from(financialFact)
    .leftJoin(sourceReference, and(eq(sourceReference.factId, financialFact.id), eq(sourceReference.workspaceId, financialFact.workspaceId)))
    .leftJoin(xbrlSource, and(eq(xbrlSource.factId, financialFact.id), eq(xbrlSource.workspaceId, financialFact.workspaceId)))
    .where(and(eq(financialFact.workspaceId, workspaceId), inArray(financialFact.revisionId, revisionIds)))
    .orderBy(asc(financialFact.revisionId), asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
}

/** The revisions' own arithmetic checks; `xbrl_in_pdf` rows are read by `listXbrlPdfChecks` alone. */
export async function listChecksForRevisions(db: Db, workspaceId: string, revisionIds: string[]): Promise<ExtractionCheckRow[]> {
  if (revisionIds.length === 0) return [];
  return db
    .select()
    .from(extractionCheck)
    .where(and(eq(extractionCheck.workspaceId, workspaceId), inArray(extractionCheck.revisionId, revisionIds), ne(extractionCheck.checkType, "xbrl_in_pdf")));
}
