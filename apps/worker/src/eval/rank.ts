import type { EvalRankings, EvalRequest, PageRef } from "@maester/contracts";
import type { Db } from "@maester/db";
import { rankPages, type ChunkPage, type Embedder } from "@maester/document-index";
import { EvalRefusal, buildSources } from "./sources.js";

/**
 * Ranks each question with the product's own branches (`rankPages`), within its scope's documents, and names the pages
 * by filing. When a document in some question's scope has no revision for the model, nothing is ranked: `rankings` is
 * empty and `missing` names those filings, so a filing that was never indexed is not scored as "not retrieved".
 */
export async function rankQuestions(
  db: Db,
  embedder: Embedder,
  workspaceId: string,
  request: EvalRequest,
): Promise<{ rankings: EvalRankings; missing: string[] }> {
  const sources = await buildSources(db, workspaceId, embedder.model, request);
  const byFiling = new Map(sources.documents.map((d) => [d.filing, d]));
  const scopes = request.questions.map((q) => ({
    question: q,
    documents: q.scope.map((filing) => {
      const doc = byFiling.get(filing);
      if (!doc) throw new EvalRefusal(`question ${q.id} names ${filing}, which is not a document of the request`);
      return doc;
    }),
  }));

  const missing = [...new Set(scopes.flatMap((s) => s.documents).filter((d) => d.revisionId === null).map((d) => d.filing))];
  if (missing.length > 0) return { rankings: { ...sources, rankings: [] }, missing };

  const rankings: EvalRankings["rankings"] = [];
  for (const { question, documents } of scopes) {
    // Two filings of one file (a duplicate upload) are one document: its pages are named by the first filing in the scope.
    const filingOf = new Map<string, string>();
    for (const d of documents) if (!filingOf.has(d.documentId!)) filingOf.set(d.documentId!, d.filing);
    const ranked = await rankPages(db, embedder, { workspaceId, query: question.query, documentIds: [...filingOf.keys()] });
    const refs = (pages: ChunkPage[]): PageRef[] => pages.map((p) => ({ filing: filingOf.get(p.documentId)!, page: p.pageNumber }));
    rankings.push({ questionId: question.id, vector: refs(ranked.vector), keyword: refs(ranked.keyword), hybrid: refs(ranked.hybrid) });
  }
  return { rankings: { ...sources, rankings }, missing: [] };
}
