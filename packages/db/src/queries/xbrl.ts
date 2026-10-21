import { and, eq, inArray, sql } from "drizzle-orm";
import type { Basis, CompanyIdentity, Statement, XbrlDocInput } from "@maester/financial-engine";
import type { Db } from "../client.js";
import { company } from "../schema/platform.js";

const NO_IDENTITY: CompanyIdentity = { cin: null, bseCode: null, nseSymbol: null, isin: null };

/** A company's codes, as the source rule matches them; all null for a company not in the workspace. */
export async function companyIdentity(db: Db, workspaceId: string, companyId: string): Promise<CompanyIdentity> {
  const [row] = await db
    .select({ cin: company.cin, bseCode: company.bseCode, nseSymbol: company.nseSymbol, isin: company.isin })
    .from(company)
    .where(and(eq(company.workspaceId, workspaceId), eq(company.id, companyId)))
    .limit(1);
  return row ?? { ...NO_IDENTITY };
}

/** `companyIdentity` for several companies in one query; a company not in the workspace has no entry. */
export async function companyIdentities(db: Db, workspaceId: string, companyIds: string[]): Promise<Map<string, CompanyIdentity>> {
  if (companyIds.length === 0) return new Map();
  const rows = await db
    .select({ id: company.id, cin: company.cin, bseCode: company.bseCode, nseSymbol: company.nseSymbol, isin: company.isin })
    .from(company)
    .where(and(eq(company.workspaceId, workspaceId), inArray(company.id, companyIds)));
  return new Map(rows.map(({ id, ...identity }) => [id, identity]));
}

type XbrlDocRow = {
  id: string;
  state: string;
  intake_state: string | null;
  doc_company_id: string | null;
  classification_id: string | null;
  company_id: string | null;
  cin: string | null;
  bse_code: string | null;
  nse_symbol: string | null;
  isin: string | null;
  period_end: string | null;
  verify_state: string | null;
};

/** The first rule that matches; see `loadWorkspaceXbrlDocs`. */
function settleState(r: XbrlDocRow): XbrlDocInput["state"] {
  if (r.verify_state === "failed") return "settled";
  if (r.state === "uploaded" || r.state === "verifying") return "unsettled";
  if (r.state === "stored" && r.intake_state === null) return "unsettled";
  if (r.intake_state === "identifying" || r.intake_state === "reading") return "unsettled";
  if (r.intake_state === "needs_company" || r.intake_state === "needs_kind") return "held";
  return "settled";
}

/**
 * The workspace's XBRL documents as the source rule sees them, oldest first, in two queries whatever
 * their number. Duplicates and `pending_upload` documents are left out. State, by the first rule that matches:
 * 1. the latest `document.verify` job failed (it leaves the document `uploaded` or `verifying`): settled;
 * 2. `uploaded` or `verifying`: unsettled;
 * 3. `stored` with no intake state yet (between verify's two writes): unsettled;
 * 4. `identifying` or `reading`: unsettled;
 * 5. `needs_company` or `needs_kind`: held;
 * 6. anything else (read, read_failed, identify_failed, kept, rejected): settled.
 * Company, codes and period come from the current classification (before one, the company given at upload).
 * Coverage is the distinct statement and basis of the facts of the current revision, as `getCurrentRevision`
 * picks it, when that revision was read from XBRL.
 */
export async function loadWorkspaceXbrlDocs(db: Db, workspaceId: string): Promise<XbrlDocInput[]> {
  const { rows } = await db.execute<XbrlDocRow>(sql`
    select d.id, d.state::text as state, d.intake_state::text as intake_state, d.company_id as doc_company_id,
           c.id as classification_id, c.company_id, c.cin, c.bse_code, c.nse_symbol, c.isin, c.period_end::text as period_end,
           v.state::text as verify_state
    from document d
    left join lateral (
      select dc.id, dc.company_id, dc.cin, dc.bse_code, dc.nse_symbol, dc.isin, dc.period_end
      from document_classification dc
      where dc.workspace_id = d.workspace_id and dc.document_id = d.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) c on true
    left join lateral (
      select j.state from job j
      where j.workspace_id = d.workspace_id and j.type = 'document.verify' and j.subject_type = 'document' and j.subject_id = d.id
      order by j.created_at desc, j.id desc
      limit 1
    ) v on true
    where d.workspace_id = ${workspaceId}
      and d.format = 'xbrl'
      and d.state <> 'pending_upload'
      and d.duplicate_of_document_id is null
      and d.intake_state is distinct from 'duplicate'
    order by d.created_at, d.id`);
  if (rows.length === 0) return [];

  // The current revision of each classified document: the newest read under its classification's `reads_under_id`.
  const { rows: pairs } = await db.execute<{ document_id: string; statement: Statement; basis: Basis }>(sql`
    select distinct d.id as document_id, f.statement::text as statement, f.basis::text as basis
    from document d
    join lateral (
      select dc.reads_under_id from document_classification dc
      where dc.workspace_id = d.workspace_id and dc.document_id = d.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) c on c.reads_under_id is not null
    join lateral (
      select r.id, r.source from extraction_revision r
      where r.workspace_id = d.workspace_id and r.classification_id = c.reads_under_id
      order by r.created_at desc, r.id desc
      limit 1
    ) r on r.source = 'xbrl'
    join financial_fact f on f.workspace_id = d.workspace_id and f.revision_id = r.id
    where d.workspace_id = ${workspaceId}
      and d.format = 'xbrl'
      and d.state <> 'pending_upload'
      and d.duplicate_of_document_id is null
      and d.intake_state is distinct from 'duplicate'
    order by 1, 2, 3`);
  const coverage = new Map<string, XbrlDocInput["coverage"]>();
  for (const p of pairs) {
    const list = coverage.get(p.document_id) ?? [];
    list.push({ statement: p.statement, basis: p.basis });
    coverage.set(p.document_id, list);
  }

  return rows.map((r) => ({
    documentId: r.id,
    state: settleState(r),
    companyId: r.classification_id === null ? r.doc_company_id : r.company_id,
    identity: { cin: r.cin, bseCode: r.bse_code, nseSymbol: r.nse_symbol, isin: r.isin },
    periodEnd: r.period_end,
    coverage: coverage.get(r.id) ?? [],
  }));
}
