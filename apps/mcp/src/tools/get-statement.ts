import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCompanyFinancials } from "@maester/api/read";
import { IsoDate, type StatementTable } from "@maester/contracts";
import { answered, failed, runTool } from "../errors.js";
import { presentTable, StatementAnswerSchema } from "../present/table.js";
import { BASIS_WORDS, STATEMENT_WORDS } from "../present/words.js";
import type { ServerDeps } from "../server.js";
import { NO_SUCH_COMPANY } from "./list-filings.js";
import { describeTool } from "./rules.js";

export const NO_ANNUAL_REPORT = "No annual report of this company has been read yet.";

/** The table, or null with the sentence that says why there is none; `read_bases` lists what this statement does have. */
export const StatementToolAnswerSchema = z.object({
  table: StatementAnswerSchema.nullable(),
  answer: z.string(),
  read_bases: z.array(z.string()),
});

/** Keeps the columns whose period end is inside [from, to] (ISO dates compare as text), and the matching cell of every row. */
function trimmed(table: StatementTable, from: string | undefined, to: string | undefined): StatementTable {
  const keep = table.columns.map((c) => (from === undefined || c.periodEnd >= from) && (to === undefined || c.periodEnd <= to));
  return {
    ...table,
    columns: table.columns.filter((_, i) => keep[i]),
    rows: table.rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => keep[i]) })),
  };
}

export function registerGetStatement(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "get_statement",
    {
      title: "Get a statement",
      description: describeTool(
        "One statement of one company as a table: income_statement, balance_sheet or cash_flow, on one basis (consolidated or standalone, never mixed). Columns are years, oldest first; each year comes whole from the newest filing that prints it. Every cell carries its fact_id, source (filing and page, or XBRL element), unit, period_end, span, check and review state: cite the fact_id and source, and copy value as given. Give from and/or to (ISO dates) to keep only the years whose period end falls between them.",
        "If table is null, say the answer sentence as given (no annual report read, or the basis has no table and which bases do); do not fill the gap from another basis or from memory.",
      ),
      inputSchema: {
        company_id: z.uuid().describe("A company_id from list_companies."),
        statement: z.enum(["income_statement", "balance_sheet", "cash_flow"]),
        basis: z.enum(["consolidated", "standalone"]).describe("Required: consolidated and standalone figures are never mixed in one answer."),
        from: IsoDate.optional().describe("Earliest period end to keep, as YYYY-MM-DD."),
        to: IsoDate.optional().describe("Latest period end to keep, as YYYY-MM-DD."),
      },
      outputSchema: StatementToolAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ company_id, statement, basis, from, to }) =>
      runTool("get_statement", deps.logger, async () => {
        if (from !== undefined && to !== undefined && from > to) return failed("INVALID_INPUT", "from is after to: no year can fall between them.");
        const fin = await loadCompanyFinancials(deps.db, deps.workspace.id, company_id, { xbrlPdfCheck: deps.settings.xbrlPdfCheck });
        if (!fin) return failed("NOT_FOUND", NO_SUCH_COMPANY);
        const none = (answer: string, readBases: string[] = []) => answered({ table: null, answer, read_bases: readBases }, answer, 0);
        if (!fin.filings.some((f) => f.counted)) return none(NO_ANNUAL_REPORT);
        const readBases = fin.tables.filter((t) => t.statement === statement).map((t) => BASIS_WORDS[t.basis]);
        const table = fin.tables.find((t) => t.statement === statement && t.basis === basis);
        if (!table) {
          const read = readBases.length > 0 ? ` Read: ${readBases.join(", ")}.` : "";
          return none(`No ${BASIS_WORDS[basis]} ${STATEMENT_WORDS[statement]} has been read for this company.${read}`, readBases);
        }
        const answer = presentTable(fin.company, fin.filings, trimmed(table, from, to));
        const years = answer.columns.length;
        const name = `${BASIS_WORDS[basis]} ${STATEMENT_WORDS[statement]}`;
        const text =
          years === 0
            ? `${name}: ${table.columns.length > 0 ? "no year falls in that range." : "no figure has a date to place it by."}`
            : `${name}: ${years} ${years === 1 ? "year" : "years"}, ${answer.columns[0]!.period_end} to ${answer.columns[years - 1]!.period_end}, ${answer.rows.length} lines.`;
        return answered({ table: answer, answer: text, read_bases: readBases }, text, answer.rows.length);
      }),
  );
}
