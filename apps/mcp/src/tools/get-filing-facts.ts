import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toFact } from "@maester/api/read";
import { getCurrentClassification, getCurrentRevision, getDocument, listFactsWithSources } from "@maester/db";
import { answered, failed, runTool } from "../errors.js";
import { FactAnswerSchema, presentFact } from "../present/fact.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

export const NO_SUCH_DOCUMENT = "No document with that id in this workspace. Use list_filings for the document ids.";

/** Why a document has no figures, in words, by where it stands. */
const NOT_READ_WORDS: Record<string, string> = {
  kept: "This document is kept, not read: Maester has no figures from it.",
  duplicate: "This document is a copy of another one in the workspace, so Maester did not read it. Use the original's document_id.",
  identifying: "This document is not read yet: Maester is still working out what it is.",
  reading: "This document is not read yet: Maester is reading it.",
  waiting_for_xbrl: "This document is not read yet: it waits for its XBRL file.",
  needs_company: "This document is not read yet: the investor has to confirm which company it belongs to.",
  needs_kind: "This document is not read yet: the investor has to say what kind of document it is.",
  identify_failed: "This document did not read: Maester could not work out what it is.",
  read_failed: "This document did not read: reading it failed.",
};
const NO_FACTS = "This document has no figures read from it.";

export const FilingFactsAnswerSchema = z.object({
  document: z.object({ document_id: z.string(), name: z.string(), kind: z.string().nullable(), period_end: z.string().nullable() }),
  facts: z.array(FactAnswerSchema),
  /** The reason there are no facts, in words; null when there are some or when a filter left none. */
  note: z.string().nullable(),
});

export function registerGetFilingFacts(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "get_filing_facts",
    {
      title: "Get a filing's facts",
      description: describeTool(
        "The facts read from one filing's current read, as printed in that one filing, each with its unit, basis, period start and end, span (year, quarter, half_year, nine_months), and source (filing and page, or XBRL element). This is how to reach a results filing's quarter, half-year and nine-month figures. Filter by statement and basis when you need one. in_table is not worked out here; use get_fact for it.",
        "If the document is kept, not read, or has no facts, say the note as given; do not read a figure from a document that has none.",
      ),
      inputSchema: {
        document_id: z.uuid().describe("A document_id from list_filings."),
        statement: z.enum(["income_statement", "balance_sheet", "cash_flow"]).optional(),
        basis: z.enum(["consolidated", "standalone"]).optional(),
      },
      outputSchema: FilingFactsAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ document_id, statement, basis }) =>
      runTool("get_filing_facts", deps.logger, async () => {
        const ws = deps.workspace.id;
        const doc = await getDocument(deps.db, ws, document_id);
        if (!doc) return failed("NOT_FOUND", NO_SUCH_DOCUMENT);
        const [revision, classification] = await Promise.all([getCurrentRevision(deps.db, ws, doc.id), getCurrentClassification(deps.db, ws, doc.id)]);
        const document = { document_id: doc.id, name: doc.originalName, kind: classification?.kind ?? null, period_end: classification?.periodEnd ?? null };
        // A kept document has no figures even if a read exists; any other state has them once there is a current read.
        if (doc.intakeState === "kept" || !revision) {
          const note = (doc.intakeState !== null ? NOT_READ_WORDS[doc.intakeState] : undefined) ?? NO_FACTS;
          return answered({ document, facts: [], note }, note, 0);
        }
        const filing = { name: doc.originalName, documentId: doc.id, kind: document.kind, periodEnd: document.period_end, pageCount: revision.pageCount };
        const rows = await listFactsWithSources(deps.db, ws, revision.id);
        const facts = rows
          .map(toFact)
          .filter((f) => (statement === undefined || f.statement === statement) && (basis === undefined || f.basis === basis))
          .map((f) => presentFact(f, filing, { superseded: null, inTable: null }));
        const text = `${facts.length} ${facts.length === 1 ? "fact" : "facts"} from ${doc.originalName}.`;
        return answered({ document, facts, note: facts.length === 0 && rows.length === 0 ? NO_FACTS : null }, text, facts.length);
      }),
  );
}
