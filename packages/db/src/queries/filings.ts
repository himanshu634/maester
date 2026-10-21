import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { extractionCheck, extractionRevision, financialFact, type ExtractionCheckRow } from "../schema/extraction.js";
import { company, document, type CompanyRow } from "../schema/platform.js";
import { XBRL_PDF_CHECK_VERSION_READ } from "./extraction.js";

/**
 * What the filings route lists: the id of every document of the workspace that is a file (not an upload that was never
 * finalised), duplicates and rejected files included, and every company of the workspace, oldest first. Two queries.
 * A company with no file is listed too: a held identity may match it.
 */
export async function listFilingRows(db: Db, workspaceId: string): Promise<{ documentIds: string[]; companies: CompanyRow[] }> {
  const docs = await db
    .select({ id: document.id })
    .from(document)
    .where(and(eq(document.workspaceId, workspaceId), ne(document.state, "pending_upload")))
    .orderBy(asc(document.createdAt), asc(document.id));
  const companies = await db.select().from(company).where(eq(company.workspaceId, workspaceId)).orderBy(asc(company.createdAt), asc(company.id));
  return { documentIds: docs.map((d) => d.id), companies };
}

/** A fact of an XBRL revision as the filings route needs it: where it sits, never its value. */
export interface XbrlFilingFact {
  id: string;
  revisionId: string;
  statement: "balance_sheet" | "income_statement" | "cash_flow";
  basis: "consolidated" | "standalone" | "unknown";
  span: "quarter" | "half_year" | "nine_months" | "year" | "other" | null;
}

export interface XbrlFilingData {
  facts: XbrlFilingFact[];
  /** When each revision was written, for the source rule's tie-break. */
  revisionCreatedAt: Map<string, Date>;
  /** The `xbrl_in_pdf` rows of these revisions at the current check version, whatever PDF they were checked against. */
  checks: ExtractionCheckRow[];
}

/**
 * The facts' places, the revisions' times and the PDF checks of XBRL revisions, three queries whatever the number of
 * revisions. Everything is taken by revision id (an `xbrl_in_pdf` row carries the revision of the fact it checks), so the
 * number of bound parameters is the number of revisions, not of facts. Scoped to the workspace.
 */
export async function loadXbrlFilingData(db: Db, workspaceId: string, revisionIds: string[]): Promise<XbrlFilingData> {
  const ids = [...new Set(revisionIds)];
  if (ids.length === 0) return { facts: [], revisionCreatedAt: new Map(), checks: [] };
  const facts = await db
    .select({ id: financialFact.id, revisionId: financialFact.revisionId, statement: financialFact.statement, basis: financialFact.basis, span: financialFact.span })
    .from(financialFact)
    .where(and(eq(financialFact.workspaceId, workspaceId), inArray(financialFact.revisionId, ids)))
    .orderBy(asc(financialFact.revisionId), asc(financialFact.statement), asc(financialFact.basis), asc(financialFact.lineOrder), asc(financialFact.id));
  const revisions = await db
    .select({ id: extractionRevision.id, createdAt: extractionRevision.createdAt })
    .from(extractionRevision)
    .where(and(eq(extractionRevision.workspaceId, workspaceId), inArray(extractionRevision.id, ids)));
  const checks = await db
    .select()
    .from(extractionCheck)
    .where(
      and(
        eq(extractionCheck.workspaceId, workspaceId),
        eq(extractionCheck.checkType, "xbrl_in_pdf"),
        eq(extractionCheck.checkVersion, XBRL_PDF_CHECK_VERSION_READ),
        inArray(extractionCheck.revisionId, ids),
      ),
    );
  return { facts, revisionCreatedAt: new Map(revisions.map((r) => [r.id, r.createdAt])), checks };
}

/** The identifiers a held document may print; `confirm` matches any of the ones given. */
export interface PrintedIdentity {
  cin?: string | undefined;
  bseCode?: string | undefined;
  isin?: string | undefined;
  nseSymbol?: string | undefined;
}

/**
 * Locks, in the caller's transaction, the workspace's documents that wait for a company (`needs_company`, not duplicates)
 * whose current classification has no company and prints any of the identifiers given, exactly. Oldest first, so two
 * confirms lock in one order. Run in a transaction: the lock lasts until it ends. The match is made on the row as it was
 * read, so the caller reads each document's current classification again once it holds the lock.
 */
export async function lockHeldDocuments(db: Db, workspaceId: string, identity: PrintedIdentity): Promise<{ documentId: string; format: "pdf" | "xbrl" }[]> {
  const printed = [
    identity.cin ? sql`c.cin = ${identity.cin}` : undefined,
    identity.bseCode ? sql`c.bse_code = ${identity.bseCode}` : undefined,
    identity.isin ? sql`c.isin = ${identity.isin}` : undefined,
    identity.nseSymbol ? sql`c.nse_symbol = ${identity.nseSymbol}` : undefined,
  ].filter((p) => p !== undefined);
  if (printed.length === 0) return [];
  const { rows } = await db.execute<{ id: string; format: "pdf" | "xbrl" }>(sql`
    select d.id, d.format::text as format
    from document d
    join lateral (
      select dc.company_id, dc.cin, dc.bse_code, dc.isin, dc.nse_symbol
      from document_classification dc
      where dc.workspace_id = d.workspace_id and dc.document_id = d.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) c on true
    where d.workspace_id = ${workspaceId}
      and d.intake_state = 'needs_company'
      and d.duplicate_of_document_id is null
      and c.company_id is null
      and (${sql.join(printed, sql` or `)})
    order by d.created_at, d.id
    for update of d`);
  return rows.map((r) => ({ documentId: r.id, format: r.format }));
}
