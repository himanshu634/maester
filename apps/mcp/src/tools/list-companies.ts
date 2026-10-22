import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listResearchCompanies } from "@maester/api/read";
import type { ResearchCompanies } from "@maester/contracts";
import { answered, runTool } from "../errors.js";
import type { ServerDeps } from "../server.js";
import { standing } from "../present/words.js";
import { describeTool } from "./rules.js";

export const CompaniesAnswerSchema = z.object({
  companies: z.array(
    z.object({
      company_id: z.string(),
      name: z.string(),
      nse_symbol: z.string().nullable(),
      bse_code: z.string().nullable(),
      cin: z.string().nullable(),
      annual_reports_read: z.number().int().min(0),
      latest_period_end: z.string().nullable(),
      /** Where it stands, in words: "Read", "Reading 1 filing", "1 filing didn't read", "Nothing read yet". */
      state: z.string(),
    }),
  ),
});
export type CompaniesAnswer = z.infer<typeof CompaniesAnswerSchema>;

export function presentCompanies(list: ResearchCompanies): CompaniesAnswer {
  return {
    companies: list.items.map((i) => ({
      company_id: i.company.id,
      name: i.company.displayName,
      nse_symbol: i.company.nseSymbol,
      bse_code: i.company.bseCode,
      cin: i.company.cin,
      annual_reports_read: i.annualReportsRead,
      latest_period_end: i.latestPeriodEnd,
      state: standing(i),
    })),
  };
}

export function registerListCompanies(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "list_companies",
    {
      title: "List companies",
      description: describeTool(
        "The workspace's companies: id, name, NSE symbol, BSE code, CIN, how many annual reports were read, the latest period end read, and where each stands in words. Use the company_id in the other tools.",
        "If the list is empty, tell the investor that no company is in the workspace yet and that adding a filing in Documents creates one; do not guess a company.",
      ),
      outputSchema: CompaniesAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    () =>
      runTool("list_companies", deps.logger, async () => {
        const answer = presentCompanies(await listResearchCompanies(deps.db, deps.workspace.id));
        const n = answer.companies.length;
        return answered(answer, n === 0 ? "No companies in this workspace." : `${n} ${n === 1 ? "company" : "companies"}.`, n);
      }),
  );
}
