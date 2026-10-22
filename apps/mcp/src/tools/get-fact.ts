import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadCompanyFinancials, toFact } from "@maester/api/read";
import type { FinancialFact } from "@maester/contracts";
import { getFactWithSource, type FactLookup } from "@maester/db";
import { answered, failed, runTool } from "../errors.js";
import { FactAnswerSchema, inTableFromCell, notInTable, presentFact, type InTableAnswer } from "../present/fact.js";
import { presentTable } from "../present/table.js";
import { BASIS_WORDS, STATEMENT_WORDS } from "../present/words.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

export const NO_SUCH_FACT = "No fact with that id in this workspace. Use get_statement or get_filing_facts for fact ids.";
export const SUPERSEDED = "A newer read of this filing replaced this one. This figure is kept as it was read; the filing's current figures are under get_filing_facts for the same document.";

/** The statement table's own cell for this fact, or in words why no cell is this fact. Never recomputes a cell. */
async function inTableFor(deps: ServerDeps, lookup: FactLookup, fact: FinancialFact, superseded: boolean): Promise<InTableAnswer> {
  if (lookup.filing.kind === "financial_results") {
    return notInTable("No table shows results yet: the statement tables are built from annual reports, and this fact is from a results filing.");
  }
  if (superseded) return notInTable("No table shows it: this fact is from an earlier read of the filing, and the tables use the current read.");
  if (lookup.companyId === null) return notInTable("No table shows it: the filing is not attached to a company.");
  const fin = await loadCompanyFinancials(deps.db, deps.workspace.id, lookup.companyId, { xbrlPdfCheck: deps.settings.xbrlPdfCheck });
  const table = fin?.tables.find((t) => t.statement === fact.statement && t.basis === fact.basis);
  if (!fin || !table) {
    return notInTable(`No table shows it: no ${BASIS_WORDS[fact.basis]} ${STATEMENT_WORDS[fact.statement]} of this company is built from an annual report yet.`);
  }
  const answer = presentTable(fin.company, fin.filings, table);
  for (const row of answer.rows) {
    const cell = row.cells.find((c) => c.fact_id === fact.id);
    if (cell) return inTableFromCell(cell);
  }
  const day = fact.periodEnd ?? fact.asOfDate;
  if (day === null) return notInTable("No table shows it: the fact has no date to place it in a year.");
  const column = table.columns.find((c) => c.periodEnd === day);
  if (!column) return notInTable(`No table shows it: no column of the ${STATEMENT_WORDS[fact.statement]} holds ${day}.`);
  if (column.documentId !== lookup.documentId) {
    const owner = fin.filings.find((f) => f.documentId === column.documentId)?.originalName ?? "another filing";
    return notInTable(`No table shows this fact. The ${day} column of the table comes whole from ${owner}, which prints that year, so the table does not use this filing's figure.`);
  }
  return notInTable(`No table shows this fact: the table's columns are whole years, and this fact covers ${fact.span ?? "another span"}.`);
}

export function registerGetFact(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "get_fact",
    {
      title: "Get a fact",
      description: describeTool(
        "Everything a citation needs for one fact: the line as printed, reported_value and printed in the filing's own unit (unit_label, scale, currency), basis, period start and end, span, the filing (name, kind, period) and its source (page of N, or XBRL element and context). When the fact is the cell its statement table shows, in_table gives the table's value with its own unit, the check and whether it was restated; otherwise in_table says which filing fills that year, or that no table shows results yet. Each value is beside its own unit: never compare reported_value with in_table.value.",
        "If the id is not in this workspace the answer is NOT_FOUND; do not guess a figure. If superseded is set, tell the investor the figure is from an earlier read.",
      ),
      inputSchema: { fact_id: z.uuid().describe("A fact_id from get_statement or get_filing_facts.") },
      outputSchema: FactAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ fact_id }) =>
      runTool("get_fact", deps.logger, async () => {
        const lookup = await getFactWithSource(deps.db, deps.workspace.id, fact_id);
        if (!lookup) return failed("NOT_FOUND", NO_SUCH_FACT);
        const fact = toFact(lookup);
        const superseded = !lookup.isCurrentRevision;
        const filing = { name: lookup.filing.originalName, documentId: lookup.documentId, kind: lookup.filing.kind, periodEnd: lookup.filing.periodEnd, pageCount: lookup.filing.pageCount };
        const answer = presentFact(fact, filing, { superseded: superseded ? SUPERSEDED : null, inTable: await inTableFor(deps, lookup, fact, superseded) });
        return answered(answer, `${answer.line}, ${answer.period_label}, from ${filing.name}.`, 1);
      }),
  );
}
