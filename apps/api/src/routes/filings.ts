import { Hono } from "hono";
import type { WorkspaceFilings } from "@maester/contracts";
import { listFilingRows, loadXbrlFilingData } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { buildFilings } from "../documents/filings.js";
import { documentPipelines } from "../documents/pipeline.js";

/** `GET /v1/workspaces/:ws/filings`: the workspace's files by company and filing. */
export function filingRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  r.get("/", async (c) => {
    const ws = c.get("workspace").id;
    const { documentIds, companies } = await listFilingRows(deps.db, ws);
    const views = [...(await documentPipelines(deps.db, ws, documentIds, deps.env.EMBEDDING_MODEL)).values()];
    const revisionIds = views.flatMap(({ input }) => (input.revision?.source === "xbrl" ? [input.revision.id] : []));
    const { facts, revisionCreatedAt, checks } = await loadXbrlFilingData(deps.db, ws, revisionIds);
    const body: WorkspaceFilings = buildFilings({
      companies,
      files: views.map(({ input, pipeline }) => ({ input, pipeline })),
      facts,
      revisionCreatedAt,
      checks,
      xbrlPdfCheck: deps.env.XBRL_PDF_CHECK,
    });
    return c.json(body);
  });

  return r;
}
