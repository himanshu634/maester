import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerDeps } from "../server.js";
import { registerGetFact } from "./get-fact.js";
import { registerGetFilingFacts } from "./get-filing-facts.js";
import { registerGetStatement } from "./get-statement.js";
import { registerListCompanies } from "./list-companies.js";
import { registerListFilings } from "./list-filings.js";
import { registerListMetrics } from "./list-metrics.js";

/** The allow-list: every tool the server registers. All read; a test fails when a tool is added without being named here. */
export const TOOL_NAMES = ["list_companies", "list_filings", "get_statement", "get_filing_facts", "get_fact", "list_metrics"] as const;

export function registerTools(server: McpServer, deps: ServerDeps): void {
  registerListCompanies(server, deps);
  registerListFilings(server, deps);
  registerGetStatement(server, deps);
  registerGetFilingFacts(server, deps);
  registerGetFact(server, deps);
  registerListMetrics(server, deps);
}
