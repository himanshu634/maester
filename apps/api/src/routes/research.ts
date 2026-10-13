import { Hono } from "hono";
import type { CompanyFinancials, CompanyStock, ResearchCompanies } from "@maester/contracts";
import {
  getCompany, getConnection, getCurrentRevision, latestMarketDay, listChecksForRevisions, listCompanies, listCompanyFilings,
  listFactsWithSourcesForRevisions, listMarketSeries,
} from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { stitch, type Filing } from "../financials/stitch.js";
import { minusDays, stockFrom } from "../financials/stock.js";
import { uuidParam } from "../middleware/params.js";
import { toCompany } from "../serialize.js";

/** Most companies the Research list shows: the API's largest page. Personal use keeps far fewer. */
const COMPANY_LIMIT = 100;
/** Closes read for the summary: a year and the slack to find the close a year earlier. */
const STOCK_DAYS = 380;

const counts = (kind: string | null, intakeState: string | null) => kind === "annual_report" && intakeState === "read";

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
    const inputs: (Filing & { revisionId: string })[] = [];
    for (const f of filings.filter((x) => counts(x.kind, x.intakeState))) {
      const revision = await getCurrentRevision(deps.db, ws, f.documentId);
      if (!revision) continue;
      inputs.push({ documentId: f.documentId, periodEnd: f.periodEnd, revisionCreatedAt: revision.createdAt, pageCount: revision.pageCount, facts: [], checks: [], revisionId: revision.id });
    }
    const ids = inputs.map((i) => i.revisionId);
    const [facts, checks] = await Promise.all([listFactsWithSourcesForRevisions(deps.db, ws, ids), listChecksForRevisions(deps.db, ws, ids)]);
    for (const input of inputs) {
      input.facts = facts.filter((f) => f.fact.revisionId === input.revisionId);
      input.checks = checks.filter((k) => k.revisionId === input.revisionId);
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
