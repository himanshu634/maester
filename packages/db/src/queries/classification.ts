import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import type { Db } from "../client.js";
import { classificationEvidence, documentClassification, type ClassificationRow, type EvidenceRow } from "../schema/classification.js";
import { extractionRevision, type ExtractionRevisionRow } from "../schema/extraction.js";
import { company, document, type CompanyRow, type DocumentRow } from "../schema/platform.js";
import { getLatestRevision } from "./extraction.js";

export async function getCurrentClassification(db: Db, workspaceId: string, documentId: string): Promise<ClassificationRow | null> {
  const rows = await db
    .select()
    .from(documentClassification)
    .where(and(eq(documentClassification.workspaceId, workspaceId), eq(documentClassification.documentId, documentId)))
    .orderBy(desc(documentClassification.createdAt), desc(documentClassification.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listEvidence(db: Db, workspaceId: string, classificationId: string): Promise<EvidenceRow[]> {
  return db
    .select()
    .from(classificationEvidence)
    .where(and(eq(classificationEvidence.workspaceId, workspaceId), eq(classificationEvidence.classificationId, classificationId)))
    .orderBy(asc(classificationEvidence.field), asc(classificationEvidence.pageIndex), asc(classificationEvidence.id));
}

/**
 * A document's current figures: the newest revision read under the current
 * classification's `readsUnderId`. A document never classified (uploaded before
 * intake) keeps its newest revision.
 */
export async function getCurrentRevision(db: Db, workspaceId: string, documentId: string): Promise<ExtractionRevisionRow | null> {
  const current = await getCurrentClassification(db, workspaceId, documentId);
  if (!current) return getLatestRevision(db, workspaceId, documentId);
  if (!current.readsUnderId) return null;
  const rows = await db
    .select()
    .from(extractionRevision)
    .where(and(eq(extractionRevision.workspaceId, workspaceId), eq(extractionRevision.classificationId, current.readsUnderId)))
    .orderBy(desc(extractionRevision.createdAt), desc(extractionRevision.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Case, punctuation, a leading "the" and Ltd/Limited/Pvt Ltd do not tell companies apart. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/ (?:pvt |private )?(?:ltd|limited)$/, " limited");
}

/** Companies a document's identity points at: by CIN, else exchange code, else name. */
export async function matchCompanies(
  db: Db,
  workspaceId: string,
  ids: { cin?: string | null; bseCode?: string | null; nseSymbol?: string | null; name?: string | null },
): Promise<CompanyRow[]> {
  if (ids.cin) {
    const rows = await db.select().from(company).where(and(eq(company.workspaceId, workspaceId), eq(company.cin, ids.cin)));
    if (rows.length) return rows;
  }
  const codes = [
    ids.bseCode ? eq(company.bseCode, ids.bseCode) : undefined,
    ids.nseSymbol ? eq(company.nseSymbol, ids.nseSymbol) : undefined,
  ].filter((c) => c !== undefined);
  if (codes.length) {
    const rows = await db.select().from(company).where(and(eq(company.workspaceId, workspaceId), or(...codes)));
    if (rows.length) return rows;
  }
  if (!ids.name) return [];
  const wanted = normalizeCompanyName(ids.name);
  const rows = await db.select().from(company).where(eq(company.workspaceId, workspaceId)).orderBy(asc(company.createdAt));
  return rows.filter((c) => normalizeCompanyName(c.displayName) === wanted);
}

export async function findStoredDuplicate(db: Db, workspaceId: string, documentId: string, sha256: string): Promise<DocumentRow | null> {
  const rows = await db
    .select()
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), eq(document.contentSha256, sha256), eq(document.state, "stored"), ne(document.id, documentId)))
    .orderBy(asc(document.createdAt), asc(document.id))
    .limit(1);
  return rows[0] ?? null;
}
