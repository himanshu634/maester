import { and, asc, eq } from "drizzle-orm";
import { contextualize, type EvalBench, type EvalRequest } from "@maester/contracts";
import { schema, type Db } from "@maester/db";
import type { Embedder } from "@maester/document-index";
import { resolveEvalDocuments } from "./resolve.js";
import { EvalRefusal } from "./sources.js";

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Times an embedder. The texts go longest first, `batch` at a time, as "document"; the first batch is a warm-up and is
 * not timed, so `chunks` counts the timed ones. Each query is then sent alone as a "query", and the median of their
 * times is kept. The default clock is wrapped: an unbound `performance.now` throws `ERR_INVALID_THIS` on Node 22.
 */
export async function benchEmbedder(
  embedder: Embedder,
  texts: string[],
  batch: number,
  queries: string[],
  clock: () => number = () => performance.now(),
): Promise<Omit<EvalBench, "version" | "model">> {
  if (texts.length <= batch) {
    throw new EvalRefusal(`The bench needs more than one batch of texts to time anything: ${texts.length} texts, batches of ${batch}.`);
  }
  const ordered = [...texts].sort((a, b) => b.length - a.length);
  const batches: string[][] = [];
  for (let i = 0; i < ordered.length; i += batch) batches.push(ordered.slice(i, i + batch));

  await embedder.embed(batches[0]!, "document");
  const start = clock();
  for (const b of batches.slice(1)) await embedder.embed(b, "document");
  const seconds = (clock() - start) / 1000;

  const times: number[] = [];
  for (const query of queries) {
    const t = clock();
    await embedder.embed([query], "query");
    times.push(clock() - t);
  }
  return {
    batch,
    chunks: ordered.length - batches[0]!.length,
    warmupChunks: batches[0]!.length,
    seconds,
    queries: queries.length,
    queryMillisMedian: median(times),
  };
}

/**
 * The first `limit` chunks of the request's documents in `model`'s revisions, contextualized as they are embedded:
 * documents in the request's order, then page, then `seq`, so every model measured on one text model embeds the same
 * texts. `missing` names the filings with no revision; with any, no texts are read, so a set never depends on which
 * filings happened to be indexed.
 */
export async function benchTexts(
  db: Db,
  workspaceId: string,
  model: string,
  request: EvalRequest,
  limit: number,
): Promise<{ texts: string[]; missing: string[] }> {
  const docs = await resolveEvalDocuments(db, workspaceId, model, request.documents);
  const missing = docs.filter((d) => d.revisionId === null).map((d) => d.filing);
  if (missing.length > 0) return { texts: [], missing };

  const texts: string[] = [];
  // Two filings of one file (a duplicate upload) are one revision, read once.
  for (const revisionId of new Set(docs.map((d) => d.revisionId!))) {
    if (texts.length >= limit) break;
    const rows = await db
      .select({ sectionPath: schema.documentChunk.sectionPath, text: schema.documentChunk.text })
      .from(schema.documentChunk)
      .where(and(eq(schema.documentChunk.workspaceId, workspaceId), eq(schema.documentChunk.revisionId, revisionId)))
      .orderBy(asc(schema.documentChunk.pageNumber), asc(schema.documentChunk.seq))
      .limit(limit - texts.length);
    for (const r of rows) texts.push(contextualize(r.sectionPath, r.text));
  }
  return { texts, missing: [] };
}
