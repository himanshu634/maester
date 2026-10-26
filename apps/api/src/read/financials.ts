import type { CompanyFinancials } from "@maester/contracts";
import {
  getCompany, getCurrentRevision, listChecksForRevisions, listCompanyFilings, listFactsWithSourcesForRevisions, listXbrlPdfChecks,
  type CompanyFilingRow, type Db,
} from "@maester/db";
import { inPdfFor, type FilingPdf } from "../financials/in-pdf.js";
import { stitch, type Filing } from "../financials/stitch.js";
import { toCompany } from "../serialize.js";

export const counts = (kind: string | null, intakeState: string | null) => kind === "annual_report" && intakeState === "read";

/**
 * The results PDF an XBRL filing of this company is checked against, paired as `enqueueXbrlPdfChecks` pairs them: a
 * stored PDF, not a duplicate, whose current classification is `financial_results` with the filing's period end (the
 * company is the list's). The newest when there are several; null with none, or when the filing has no period end.
 */
export function filingPdfOf(filings: CompanyFilingRow[], periodEnd: string | null): FilingPdf | null {
  if (periodEnd === null) return null;
  const pdf = filings.find(
    (f) =>
      f.format === "pdf" && f.state === "stored" && f.duplicateOfDocumentId === null && f.intakeState !== "duplicate" &&
      f.kind === "financial_results" && f.periodEnd === periodEnd && f.classificationId !== null,
  );
  return pdf ? { documentId: pdf.documentId, classificationId: pdf.classificationId!, statementPages: pdf.statementsFound } : null;
}

/** A company's stitched statements: the body of `GET /companies/:id/financials`. Null when the company is not in the workspace. */
export async function loadCompanyFinancials(
  db: Db,
  workspaceId: string,
  companyId: string,
  opts: { xbrlPdfCheck: boolean },
): Promise<CompanyFinancials | null> {
  const company = await getCompany(db, workspaceId, companyId);
  if (!company) return null;
  const filings = await listCompanyFilings(db, workspaceId, company.id);
  // Annual reports only. `annualSlotOf` in stitch is the guard on what fills a year; this keeps results out of the list too.
  const inputs: Filing[] = [];
  for (const f of filings.filter((x) => counts(x.kind, x.intakeState))) {
    // The filing's own kind, not assumed from the filter above, so the source rule's guard holds if the filter widens.
    const filingKind = f.kind === "annual_report" || f.kind === "financial_results" ? f.kind : null;
    const revision = await getCurrentRevision(db, workspaceId, f.documentId);
    if (!revision || !filingKind) continue;
    inputs.push({
      documentId: f.documentId, revisionId: revision.id, companyId: f.companyId, source: revision.source, filingKind,
      originalName: f.originalName, periodEnd: f.periodEnd, revisionCreatedAt: revision.createdAt, pageCount: revision.pageCount,
      facts: [], checks: [], inPdf: new Map(),
    });
  }
  const ids = inputs.map((i) => i.revisionId);
  const [facts, checks] = await Promise.all([listFactsWithSourcesForRevisions(db, workspaceId, ids), listChecksForRevisions(db, workspaceId, ids)]);
  for (const input of inputs) {
    input.facts = facts.filter((f) => f.fact.revisionId === input.revisionId);
    input.checks = checks.filter((k) => k.revisionId === input.revisionId);
  }
  const xbrlInputs = inputs.filter((i) => i.source === "xbrl");
  const pdfChecks = await listXbrlPdfChecks(db, workspaceId, xbrlInputs.flatMap((i) => i.facts.map((f) => f.fact.id)));
  for (const input of xbrlInputs) {
    const pdf = filingPdfOf(filings, input.periodEnd);
    for (const f of input.facts) input.inPdf.set(f.fact.id, inPdfFor(f.fact, pdfChecks, pdf, opts.xbrlPdfCheck));
  }
  return {
    company: toCompany(company),
    filings: filings.map((f) => ({
      documentId: f.documentId, originalName: f.originalName, kind: f.kind, periodEnd: f.periodEnd, intakeState: f.intakeState,
      counted: inputs.some((i) => i.documentId === f.documentId),
    })),
    tables: stitch(inputs),
  };
}
