import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCompany } from "@maester/db";
import { EmbedderError, searchChunks, type ServedModelGate } from "@maester/document-index";
import { answered, failed, runTool } from "../errors.js";
import { presentHits, SEARCH_FIGURES_SENTENCE, SearchAnswerSchema } from "../present/search.js";
import type { ServerDeps } from "../server.js";
import { NO_SUCH_COMPANY } from "./list-filings.js";
import { describeTool } from "./rules.js";

export const SEARCH_UNAVAILABLE_SENTENCE = "Search is not available: the embedder is not running or serves another model.";

export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;

/**
 * `gate` is the process's one check that the embedder serves the model the index was built with (null: no embedder).
 * Every failure to search, from no embedder to a model mismatch to the embedder failing on the query, is one sentence.
 */
export function registerSearchFilings(server: McpServer, deps: ServerDeps, gate: ServedModelGate | null): void {
  server.registerTool(
    "search_filings",
    {
      title: "Search filings",
      description: describeTool(
        `Passages from the text of the investor's filings, found by meaning and by words: each with its text, the filing's name and document_id, the company, the page (1-based) or XBRL element, the section path, whether the text came from the text layer or OCR, and the kind (prose or table). Passages are context, not figures: ${SEARCH_FIGURES_SENTENCE} Give company_id to search one company's filings; limit is at most ${MAX_LIMIT} (default ${DEFAULT_LIMIT}).`,
        "If no passage matches, say nothing was found; if search is not available, say so as given; do not answer from memory and do not quote a number from a passage as a figure.",
      ),
      inputSchema: {
        query: z.string().trim().min(1).max(500).describe("What to look for, in words."),
        company_id: z.uuid().optional().describe("A company_id from list_companies; leave out to search every company."),
        limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT).describe(`How many passages, 1 to ${MAX_LIMIT}.`),
      },
      outputSchema: SearchAnswerSchema.shape,
      annotations: { readOnlyHint: true },
    },
    ({ query, company_id, limit }) =>
      runTool("search_filings", deps.logger, async () => {
        const embedder = deps.embedder;
        if (!embedder || !gate) return failed("SEARCH_UNAVAILABLE", SEARCH_UNAVAILABLE_SENTENCE);
        if (company_id !== undefined && !(await getCompany(deps.db, deps.workspace.id, company_id))) return failed("NOT_FOUND", NO_SUCH_COMPANY);
        // The gate is asked on every call until it passes; a failed or mismatched check is not kept.
        if (!(await gate.check()).ok) return failed("SEARCH_UNAVAILABLE", SEARCH_UNAVAILABLE_SENTENCE);
        let hits;
        try {
          hits = await searchChunks(deps.db, embedder, { workspaceId: deps.workspace.id, query, limit, ...(company_id !== undefined ? { companyId: company_id } : {}) });
        } catch (err) {
          // The embedder failed on the query: search is unavailable. Anything else is the database's, and runTool says so.
          if (err instanceof EmbedderError) return failed("SEARCH_UNAVAILABLE", SEARCH_UNAVAILABLE_SENTENCE);
          throw err;
        }
        const n = hits.length;
        const text = n === 0 ? "No passage matched." : `${n} ${n === 1 ? "passage" : "passages"}.`;
        return answered(presentHits(hits), `${text} ${SEARCH_FIGURES_SENTENCE}`, n);
      }),
  );
}
