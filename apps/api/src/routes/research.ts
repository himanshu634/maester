import { Hono } from "hono";
import type { CompanyStock } from "@maester/contracts";
import { getCompany, getConnection, latestMarketDay, listMarketSeries } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { minusDays, stockFrom } from "../financials/stock.js";
import { uuidParam } from "../middleware/params.js";
import { listResearchCompanies, loadCompanyFinancials } from "../read/index.js";

/** Closes read for the summary: a year and the slack to find the close a year earlier. */
const STOCK_DAYS = 380;

/** `/research`: the Research list. */
export function researchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  r.get("/companies", async (c) => c.json(await listResearchCompanies(deps.db, c.get("workspace").id)));
  return r;
}

/** `/companies/:id/financials` and `/companies/:id/stock`. */
export function companyResearchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/:id/financials", async (c) => {
    const body = await loadCompanyFinancials(deps.db, c.get("workspace").id, uuidParam(c, "id"), { xbrlPdfCheck: deps.env.XBRL_PDF_CHECK });
    if (!body) throw new HttpError("NOT_FOUND", "company not found");
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
