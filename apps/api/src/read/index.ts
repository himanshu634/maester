/** The read loaders the API's routes and `apps/mcp` share. Nothing here imports Hono or the app. */
export { listResearchCompanies } from "./companies.js";
export { loadWorkspaceFilings } from "./filings.js";
export { loadCompanyFinancials } from "./financials.js";
// The table's own check and line rules, so a fact read on its own is matched as its table cell would be.
export { factCheck, lineOf } from "../financials/stitch.js";
export { toCompany, toFact, toRevision } from "../serialize.js";
