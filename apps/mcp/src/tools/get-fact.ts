import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { factCheck, lineOf, loadCompanyFinancials, toFact } from "@maester/api/read";
import type { FinancialFact } from "@maester/contracts";
import { getFactWithSource, listChecks, listFactsWithSources, type FactLookup } from "@maester/db";
import { answered, failed, runTool } from "../errors.js";
import { checkSentence } from "../present/check.js";
import { FactAnswerSchema, inTableFromCell, notInTable, presentFact, type InTableAnswer } from "../present/fact.js";
import { presentTable } from "../present/table.js";
import { BASIS_WORDS, dayWords, NO_FACTS, NOT_READ_WORDS, STATEMENT_WORDS } from "../present/words.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

export const NO_SUCH_FACT = "No fact with that id in this workspace. Use get_statement or get_filing_facts for fact ids.";

/** Whether the fact's read is the filing's current one, was replaced by a newer read, or no read of it is current. */
type ReadState = { kind: "current" } | { kind: "replaced"; at: Date } | { kind: "none"; why: string };

function readState(lookup: FactLookup): ReadState {
  const current = lookup.currentRevision;
  if (current === null) return { kind: "none", why: (lookup.intakeState !== null ? NOT_READ_WORDS[lookup.intakeState] : undefined) ?? NO_FACTS };
  if (current.id === lookup.revision.id) return { kind: "current" };
  return { kind: "replaced", at: current.createdAt };
}

function supersededWords(state: ReadState): string | null {
  if (state.kind === "current") return null;
  if (state.kind === "replaced") {
    return `Read again on ${dayWords(state.at)}. This figure is kept as the earlier read gave it; in_table gives the current read's figure for this line and year when the table shows one, and get_filing_facts gives the whole current read.`;
  }
  return `This figure is from an earlier read, and no read of this filing is current now. ${state.why}`;
}

const LEFT_OUT_WHY = { other_currency: "it reports in another currency", other_unit: "its unit is one Maester cannot convert" } as const;

/**
 * The statement table's own cell for this fact, or in words why no cell is this fact. Never recomputes a cell: a cell
 * is found by its fact id, or by the column of the fact's day and the row of its line (the table's own line rule).
 */
async function inTableFor(deps: ServerDeps, lookup: FactLookup, fact: FinancialFact, state: ReadState): Promise<InTableAnswer> {
  if (lookup.filing.kind === "financial_results") {
    return notInTable("No table shows results yet: the statement tables are built from annual reports, and this fact is from a results filing.");
  }
  if (state.kind === "none") return notInTable("No table shows it: no read of this filing is current, so the tables do not use it.");
  if (lookup.companyId === null) return notInTable("No table shows it: the filing is not attached to a company.");
  const fin = await loadCompanyFinancials(deps.db, deps.workspace.id, lookup.companyId, { xbrlPdfCheck: deps.settings.xbrlPdfCheck });
  const table = fin?.tables.find((t) => t.statement === fact.statement && t.basis === fact.basis);
  if (!fin || !table) {
    return notInTable(`No table shows it: no ${BASIS_WORDS[fact.basis]} ${STATEMENT_WORDS[fact.statement]} of this company is built from an annual report yet.`);
  }
  const answer = presentTable(fin.company, fin.filings, table);
  for (const row of answer.rows) {
    const cell = row.cells.find((c) => c.fact_id === fact.id);
    if (cell) return inTableFromCell({ ...cell, fact_id: fact.id });
  }
  const leftOut = table.leftOut.find((l) => l.documentId === lookup.documentId);
  if (leftOut) return notInTable(`No table shows it: the table leaves this filing out, because ${LEFT_OUT_WHY[leftOut.reason]}.`);
  const day = fact.periodEnd ?? fact.asOfDate;
  if (day === null) return notInTable("No table shows it: the fact has no date to place it in a year.");
  if (fact.span !== null && fact.span !== "year") {
    return notInTable(`No table shows this fact: the table's columns are whole years, and this fact covers a ${fact.span.replace("_", " ")}.`);
  }
  const col = table.columns.findIndex((c) => c.periodEnd === day);
  if (col < 0) return notInTable(`No table shows it: no column of the ${STATEMENT_WORDS[fact.statement]} holds ${day}.`);
  const column = table.columns[col]!;
  // The table's row for this line: a line printed twice under one name in one section is not told apart here.
  const line = `${lineOf(fact)}|`;
  const rows = table.rows.flatMap((r, i) => (r.key.startsWith(line) ? [i] : []));
  const there = rows.length === 1 ? answer.rows[rows[0]!]!.cells[col] : undefined;
  const thereId = there?.fact_id ?? null;
  if (column.documentId !== lookup.documentId) {
    const owner = fin.filings.find((f) => f.documentId === column.documentId)?.originalName ?? "another filing";
    const which = thereId ? ` The table's figure for this line is fact ${thereId}.` : "";
    return notInTable(`No table shows this fact. The ${day} column of the table comes whole from ${owner}, which prints that year, so the table does not use this filing's figure.${which}`, thereId);
  }
  if (state.kind === "replaced") {
    if (there && thereId) return inTableFromCell({ ...there, fact_id: thereId });
    return notInTable(
      rows.length > 1
        ? `No table shows it: the current read prints this line more than once in its section, so the table's cell for it is not told apart here. Use get_statement.`
        : `No table shows it: the current read of this filing prints no line by this name for ${day}.`,
    );
  }
  if (fact.span === null) return notInTable("No table shows this fact: the read did not record its span, and the table's columns are whole years.");
  return notInTable(`No table shows this fact: the ${day} column does not hold it.`);
}

export function registerGetFact(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "get_fact",
    {
      title: "Get a fact",
      description: describeTool(
        "Everything a citation needs for one fact: the line as printed, reported_value and printed in the filing's own unit (unit_label, scale, currency), basis, period start and end, span (or span_reason when it is not recorded), the filing (name, kind, period), its source (page of N, or XBRL element and context) and its own check in a sentence. When the fact is the cell its statement table shows, in_table gives the table's value with its own unit, the check and whether it was restated; otherwise in_table says which filing fills that year (with that cell's fact_id), or that no table shows results yet. Each value is beside its own unit: never compare reported_value with in_table.value.",
        "If the id is not in this workspace the answer is NOT_FOUND; do not guess a figure. If superseded is set, tell the investor the figure is from an earlier read, as the sentence says.",
      ),
      inputSchema: { fact_id: z.uuid().describe("A fact_id from get_statement or get_filing_facts.") },
      outputSchema: FactAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ fact_id }) =>
      runTool("get_fact", deps.logger, async () => {
        const ws = deps.workspace.id;
        const lookup = await getFactWithSource(deps.db, ws, fact_id);
        if (!lookup) return failed("NOT_FOUND", NO_SUCH_FACT);
        const fact = toFact(lookup);
        const state = readState(lookup);
        const [siblings, checks] = await Promise.all([listFactsWithSources(deps.db, ws, lookup.revision.id), listChecks(deps.db, ws, lookup.revision.id)]);
        const unit = { label: fact.unitLabel, scale: fact.scaleFactor, currency: fact.currency };
        const check = checkSentence(factCheck(lookup, siblings, checks), fact.source?.kind ?? null, unit);
        const filing = { name: lookup.filing.originalName, documentId: lookup.documentId, kind: lookup.filing.kind, periodEnd: lookup.filing.periodEnd, pageCount: lookup.filing.pageCount };
        const answer = presentFact(fact, filing, { check, superseded: supersededWords(state), inTable: await inTableFor(deps, lookup, fact, state) });
        return answered(answer, `${answer.line}, ${answer.period_label}, from ${filing.name}.`, 1);
      }),
  );
}
