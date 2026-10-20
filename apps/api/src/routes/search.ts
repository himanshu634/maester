import { Hono } from "hono";
import { z } from "zod";
import type { SearchResults } from "@maester/contracts";
import { EmbedderError, searchChunks } from "@maester/document-index";
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

  r.get("/", validate("query", SearchQuery), async (c) => {
    const { q, limit, company } = c.req.valid("query");
    if (!deps.embedder) throw new HttpError("SEARCH_UNAVAILABLE", UNAVAILABLE);
    try {
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
