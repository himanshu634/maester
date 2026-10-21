import { Hono } from "hono";
import { z } from "zod";
import type { SearchResults } from "@maester/contracts";
import { EmbedderError, searchChunks, servesModel } from "@maester/document-index";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { validate } from "../validation.js";

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  company: z.uuid().optional(),
});

const UNAVAILABLE = "Search is not available right now.";

export function searchRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();
  // Set once the embedder has said it serves the model it is labelled with. It lives in this route instance, next to
  // the embedder it was checked against. A check that failed or did not match is not kept, so the next search asks
  // again: TEI can start after the API (its health check has a 120 s start period), so there is no check at start-up.
  let embedderChecked = false;

  r.get("/", validate("query", SearchQuery), async (c) => {
    const { q, limit, company } = c.req.valid("query");
    if (!deps.embedder) throw new HttpError("SEARCH_UNAVAILABLE", UNAVAILABLE);
    try {
      if (!embedderChecked) {
        // Arctic and Qwen both answer 1024 values, so the length of a vector cannot tell them apart.
        const served = await deps.embedder.servedModel();
        if (!servesModel(served, deps.embedder.model)) {
          // The query is never logged: only the code and what the embedder serves.
          deps.logger.warn({ traceId: c.get("traceId"), code: "EMBEDDER_MODEL_MISMATCH", served }, "search: the embedder serves another model");
          throw new HttpError("SEARCH_UNAVAILABLE", UNAVAILABLE);
        }
        embedderChecked = true;
      }
      const items = await searchChunks(deps.db, deps.embedder, {
        workspaceId: c.get("workspace").id,
        query: q,
        limit,
        ...(company ? { companyId: company } : {}),
      });
      return c.json({ items } satisfies SearchResults);
    } catch (err) {
      if (err instanceof EmbedderError) {
        // The query is never logged: only the code and the trace.
        deps.logger.warn({ traceId: c.get("traceId"), code: err.code }, "search: embedder failed");
        throw new HttpError("SEARCH_UNAVAILABLE", UNAVAILABLE);
      }
      throw err;
    }
  });

  return r;
}
