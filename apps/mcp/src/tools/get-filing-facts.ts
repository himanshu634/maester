import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { factCheck, toFact } from "@maester/api/read";
import { ReportingBasis } from "@maester/contracts";
import { getCurrentClassification, getCurrentRevision, getDocument, listChecks, listFactsWithSources } from "@maester/db";
import { answered, failed, runTool } from "../errors.js";
import { checkSentence } from "../present/check.js";
import { FactAnswerSchema, presentFact } from "../present/fact.js";
import { NO_FACTS, NOT_READ_WORDS } from "../present/words.js";
import type { ServerDeps } from "../server.js";
import { describeTool } from "./rules.js";

export const NO_SUCH_DOCUMENT = "No document with that id in this workspace. Use list_filings for the document ids.";

/** A document that has a current read but stands elsewhere now: its figures are the last finished read's, and this says so. */
const SINCE_WORDS: Record<string, string> = {
  reading: "Maester is reading this document again; these figures are from the last finished read.",
  read_failed: "The last read of this document failed; these figures are from the read before it.",
  identifying: "Maester is working out again what this document is; these figures are from the last finished read.",
  waiting_for_xbrl: "This document waits for its XBRL file; these figures are from the last finished read.",
};

export const FilingFactsAnswerSchema = z.object({
  document: z.object({
    document_id: z.string(),
    name: z.string(),
    kind: z.string().nullable(),
    period_end: z.string().nullable(),
    /** The original's document_id when this document is a copy of it. */
    duplicate_of: z.string().nullable(),
  }),
  facts: z.array(FactAnswerSchema),
  /** Where the document stands, in words: why there are no facts, or that the facts are an earlier read's; null otherwise. */
  note: z.string().nullable(),
});

export function registerGetFilingFacts(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "get_filing_facts",
    {
      title: "Get a filing's facts",
      description: describeTool(
        "The facts read from one filing's current read, as printed in that one filing, each with its unit, basis, period start and end, span (year, quarter, half_year, nine_months; or null with span_reason in words), its source (filing and page, or XBRL element) and its own check in a sentence. This is how to reach a results filing's quarter, half-year and nine-month figures. Filter by statement and by basis (consolidated, standalone, or unknown for a filing that does not state its basis). in_table is not worked out here; use get_fact for it.",
        "If the document is kept, not read, or has no facts, say the note as given; do not read a figure from a document that has none.",
      ),
      inputSchema: {
        document_id: z.uuid().describe("A document_id from list_filings."),
        statement: z.enum(["income_statement", "balance_sheet", "cash_flow"]).optional(),
        basis: ReportingBasis.optional().describe("consolidated, standalone, or unknown: the filing does not state its basis."),
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
        const document = {
          document_id: doc.id,
          name: doc.originalName,
          kind: classification?.kind ?? null,
          period_end: classification?.periodEnd ?? null,
          duplicate_of: doc.duplicateOfDocumentId ?? null,
        };
        const state = doc.intakeState;
        // A kept document has no figures even if a read exists; any other state has them once there is a current read.
        if (state === "kept" || !revision) {
          const note = (state !== null ? NOT_READ_WORDS[state] : undefined) ?? NO_FACTS;
          return answered({ document, facts: [], note }, note, 0);
        }
        const filing = { name: doc.originalName, documentId: doc.id, kind: document.kind, periodEnd: document.period_end, pageCount: revision.pageCount };
        const [rows, checks] = await Promise.all([listFactsWithSources(deps.db, ws, revision.id), listChecks(deps.db, ws, revision.id)]);
        const facts = rows
          .filter((r) => (statement === undefined || r.fact.statement === statement) && (basis === undefined || r.fact.basis === basis))
          .map((r) => {
            const f = toFact(r);
            const check = checkSentence(factCheck(r, rows, checks), f.source?.kind ?? null, { label: f.unitLabel, scale: f.scaleFactor, currency: f.currency });
            return presentFact(f, filing, { check, superseded: null, inTable: null });
          });
        const since = state !== null ? (SINCE_WORDS[state] ?? null) : null;
        const note = rows.length === 0 ? NO_FACTS : since;
        const text = `${facts.length} ${facts.length === 1 ? "fact" : "facts"} from ${doc.originalName}.${since ? ` ${since}` : ""}`;
        return answered({ document, facts, note }, text, facts.length);
      }),
  );
}
