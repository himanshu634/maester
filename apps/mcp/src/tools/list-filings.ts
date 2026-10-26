import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadWorkspaceFilings } from "@maester/api/read";
import { getCompany } from "@maester/db";
import { answered, failed, runTool } from "../errors.js";
import { FilingsAnswerSchema, presentFilings } from "../present/filings.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

/** One sentence for a missing company and for another workspace's, so the two cannot be told apart. */
export const NO_SUCH_COMPANY = "No company with that id in this workspace. Use list_companies for the ids.";

export function registerListFilings(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "list_filings",
    {
      title: "List filings",
      description: describeTool(
        "The workspace's filings by company: each filing's kind, period and files (PDF, XBRL), how far each file was read, which source owns each statement and basis, and why a source was left out. Give company_id to see one company's filings.",
        "If a company has no filings, or a statement has no source, say so with the reason given; do not read a figure from a filing that is not listed as read.",
      ),
      inputSchema: { company_id: z.uuid().optional().describe("A company_id from list_companies; leave out for every company.") },
      outputSchema: FilingsAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ company_id }) =>
      runTool("list_filings", deps.logger, async () => {
        if (company_id !== undefined && !(await getCompany(deps.db, deps.workspace.id, company_id))) return failed("NOT_FOUND", NO_SUCH_COMPANY);
        const loaded = await loadWorkspaceFilings(deps.db, deps.workspace.id, { embeddingModel: deps.settings.embeddingModel, xbrlPdfCheck: deps.settings.xbrlPdfCheck });
        const answer = presentFilings(loaded, company_id ?? null);
        const filings = answer.companies.reduce((n, c) => n + c.filings.length, 0);
        const text = `${filings} ${filings === 1 ? "filing" : "filings"} across ${answer.companies.length} ${answer.companies.length === 1 ? "company" : "companies"}.`;
        return answered(answer, answer.unsorted.length > 0 ? `${text} ${answer.unsorted.length} not sorted to a company yet.` : text, filings);
      }),
  );
}
