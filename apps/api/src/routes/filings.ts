import { Hono } from "hono";
import type { AppDeps, AppEnv } from "../app.js";
import { loadWorkspaceFilings } from "../read/index.js";

/** `GET /v1/workspaces/:ws/filings`: the workspace's files by company and filing. */
export function filingRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const body = await loadWorkspaceFilings(deps.db, c.get("workspace").id, {
      embeddingModel: deps.env.EMBEDDING_MODEL,
      xbrlPdfCheck: deps.env.XBRL_PDF_CHECK,
    });
    return c.json(body);
  });

  return r;
}
