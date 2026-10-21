import { Hono } from "hono";
import type { CompanyFinancials, CompanyStock, ResearchCompanies } from "@maester/contracts";
import {
  getCompany, getConnection, getCurrentRevision, latestMarketDay, listChecksForRevisions, listCompanies, listCompanyFilings,
  listFactsWithSourcesForRevisions, listMarketSeries, listXbrlPdfChecks, type CompanyFilingRow,
} from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { inPdfFor, type FilingPdf } from "../financials/in-pdf.js";
import { stitch, type Filing } from "../financials/stitch.js";
import { minusDays, stockFrom } from "../financials/stock.js";
import { uuidParam } from "../middleware/params.js";
import { toCompany } from "../serialize.js";

/** Most companies the Research list shows: the API's largest page. Personal use keeps far fewer. */
const COMPANY_LIMIT = 100;
/** Closes read for the summary: a year and the slack to find the close a year earlier. */
const STOCK_DAYS = 380;

const counts = (kind: string | null, intakeState: string | null) => kind === "annual_report" && intakeState === "read";

/**
 * The results PDF an XBRL filing of this company is checked against, paired as `enqueueXbrlPdfChecks` pairs them: a
 * stored PDF, not a duplicate, whose current classification is `financial_results` with the filing's period end (the
 * company is the list's). The newest when there are several; null with none, or when the filing has no period end.
 */
function filingPdfOf(filings: CompanyFilingRow[], periodEnd: string | null): FilingPdf | null {
  if (periodEnd === null) return null;
  const pdf = filings.find(
    (f) =>
      f.format === "pdf" && f.state === "stored" && f.duplicateOfDocumentId === null && f.intakeState !== "duplicate" &&
      f.kind === "financial_results" && f.periodEnd === periodEnd && f.classificationId !== null,
  );
  return pdf ? { documentId: pdf.documentId, classificationId: pdf.classificationId!, statementPages: pdf.statementsFound } : null;
}

/** `/research`: the Research list. */
export function researchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/companies", async (c) => {
    const ws = c.get("workspace").id;
    const [page, filings] = await Promise.all([listCompanies(deps.db, ws, { limit: COMPANY_LIMIT }), listCompanyFilings(deps.db, ws)]);
    const items = page.items
      .map((company) => {
        const mine = filings.filter((f) => f.companyId === company.id);
        const read = mine.filter((f) => counts(f.kind, f.intakeState));
        const latest = read.map((f) => f.periodEnd).filter((d): d is string => d !== null).sort().at(-1) ?? null;
        return {
          company: toCompany(company),
          annualReportsRead: read.length,
          latestPeriodEnd: latest,
          reading: mine.filter((f) => f.intakeState === "identifying" || f.intakeState === "reading").length,
          failed: mine.filter((f) => f.intakeState === "identify_failed" || f.intakeState === "read_failed").length,
        };
      })
      .sort((a, b) => a.company.displayName.localeCompare(b.company.displayName));
    const body: ResearchCompanies = { items };
    return c.json(body);
  });
  return r;
}

/** `/companies/:id/financials` and `/companies/:id/stock`. */
export function companyResearchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/financials", async (c) => {
    const ws = c.get("workspace").id;
    const company = await getCompany(deps.db, ws, uuidParam(c, "id"));
    if (!company) throw new HttpError("NOT_FOUND", "company not found");
    const filings = await listCompanyFilings(deps.db, ws, company.id);
    // Annual reports only. `annualSlotOf` in stitch is the guard on what fills a year; this keeps results out of the list too.
    const inputs: Filing[] = [];
    for (const f of filings.filter((x) => counts(x.kind, x.intakeState))) {
      // The filing's own kind, not assumed from the filter above, so the source rule's guard holds if the filter widens.
      const filingKind = f.kind === "annual_report" || f.kind === "financial_results" ? f.kind : null;
      const revision = await getCurrentRevision(deps.db, ws, f.documentId);
      if (!revision || !filingKind) continue;
      inputs.push({
        documentId: f.documentId, revisionId: revision.id, companyId: f.companyId, source: revision.source, filingKind,
        originalName: f.originalName, periodEnd: f.periodEnd, revisionCreatedAt: revision.createdAt, pageCount: revision.pageCount,
        facts: [], checks: [], inPdf: new Map(),
      });
    }
    const ids = inputs.map((i) => i.revisionId);
    const [facts, checks] = await Promise.all([listFactsWithSourcesForRevisions(deps.db, ws, ids), listChecksForRevisions(deps.db, ws, ids)]);
    for (const input of inputs) {
      input.facts = facts.filter((f) => f.fact.revisionId === input.revisionId);
      input.checks = checks.filter((k) => k.revisionId === input.revisionId);
    }
    const xbrlInputs = inputs.filter((i) => i.source === "xbrl");
    const pdfChecks = await listXbrlPdfChecks(deps.db, ws, xbrlInputs.flatMap((i) => i.facts.map((f) => f.fact.id)));
    for (const input of xbrlInputs) {
      const pdf = filingPdfOf(filings, input.periodEnd);
      for (const f of input.facts) input.inPdf.set(f.fact.id, inPdfFor(f.fact, pdfChecks, pdf, deps.env.XBRL_PDF_CHECK));
    }
    const body: CompanyFinancials = {
      company: toCompany(company),
      filings: filings.map((f) => ({
        documentId: f.documentId, originalName: f.originalName, kind: f.kind, periodEnd: f.periodEnd, intakeState: f.intakeState,
        counted: inputs.some((i) => i.documentId === f.documentId),
      })),
      tables: stitch(inputs),
    };
    return c.json(body);
  });

  r.get("/:id/stock", async (c) => {
    const company = await getCompany(deps.db, c.get("workspace").id, uuidParam(c, "id"));
    if (!company) throw new HttpError("NOT_FOUND", "company not found");
    const none = { source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] };
    const symbol = company.nseSymbol;
    if (!symbol) {
      const body: CompanyStock = { state: "no_symbol", symbol: null, ...none };
      return c.json(body);
    }
    const series = `eq:${symbol}`;
    const last = await latestMarketDay(deps.db, series);
    if (!last) {
      const dhan = await getConnection(deps.db, "dhan");
      const body: CompanyStock = { state: dhan ? "not_tracked" : "not_connected", symbol, ...none };
      return c.json(body);
    }
    const points = (await listMarketSeries(deps.db, [series], minusDays(last, STOCK_DAYS)))[series] ?? [];
    const body: CompanyStock = stockFrom(symbol, points.map((p) => ({ day: p.day, value: p.value, source: p.source })));
    return c.json(body);
  });

  return r;
}
