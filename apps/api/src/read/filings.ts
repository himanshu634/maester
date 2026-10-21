import type { WorkspaceFilings } from "@maester/contracts";
import { listFilingRows, loadXbrlFilingData, type Db } from "@maester/db";
import { buildFilings } from "../documents/filings.js";
import { documentPipelines } from "../documents/pipeline.js";

/** The workspace's files by company and filing: the body of `GET /v1/workspaces/:ws/filings`. */
export async function loadWorkspaceFilings(
  db: Db,
  workspaceId: string,
  opts: { embeddingModel: string; xbrlPdfCheck: boolean },
): Promise<WorkspaceFilings> {
  const { documentIds, companies } = await listFilingRows(db, workspaceId);
  const views = [...(await documentPipelines(db, workspaceId, documentIds, opts.embeddingModel)).values()];
  const revisionIds = views.flatMap(({ input }) => (input.revision?.source === "xbrl" ? [input.revision.id] : []));
  const { facts, revisionCreatedAt, checks } = await loadXbrlFilingData(db, workspaceId, revisionIds);
  return buildFilings({
    companies,
    files: views.map(({ input, pipeline }) => ({ input, pipeline })),
    facts,
    revisionCreatedAt,
    checks,
    xbrlPdfCheck: opts.xbrlPdfCheck,
  });
}
