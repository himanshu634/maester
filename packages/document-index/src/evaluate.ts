import { sql } from "drizzle-orm";
import type { Db } from "@maester/db";
import { EmbedderError, type Embedder } from "./embedder.js";
import { fuse, rankChunks } from "./search.js";

/** A chunk's place in a filing: the document and the PDF page, counted from 1. */
export interface ChunkPage {
  documentId: string;
  pageNumber: number;
}

/**
 * The pages of each branch's ranking for a query, within `documentIds` and the embedder's model, one entry per chunk
 * in rank order (a page with two chunks is listed twice). The branches are the product's own (`rankChunks`), run as a
 * filtered search runs them, and `hybrid` is `fuse` of the two in full, so it has up to 100 entries. A chunk with no
 * page (a future XBRL chunk) cannot answer a question about a page and is left out of the lists.
 */
export async function rankPages(
  db: Db,
  embedder: Embedder,
  input: { workspaceId: string; query: string; documentIds: string[] },
): Promise<{ vector: ChunkPage[]; keyword: ChunkPage[]; hybrid: ChunkPage[] }> {
  const [vector] = await embedder.embed([input.query], "query");
  if (!vector) throw new EmbedderError("EMBEDDING_FAILED", false, "The embedder returned no vector.");
  const ranked = await rankChunks(db, {
    workspaceId: input.workspaceId, model: embedder.model, vector, query: input.query, documentIds: input.documentIds,
  });
  const hybrid = fuse(ranked.vector, ranked.keyword).map((f) => f.id);

  const ids = [...new Set([...ranked.vector, ...ranked.keyword])];
  const pages = new Map<string, ChunkPage | null>();
  if (ids.length > 0) {
    const { rows } = await db.execute(
      sql`select id, document_id, page_number from document_chunk
        where workspace_id = ${input.workspaceId} and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
    for (const r of rows) {
      pages.set(String(r.id), r.page_number === null ? null : { documentId: String(r.document_id), pageNumber: Number(r.page_number) });
    }
  }
  const pagesOf = (chunkIds: string[]): ChunkPage[] =>
    chunkIds.flatMap((id) => {
      const page = pages.get(id);
      // A chunk the branches found is gone: a rebuild finished between the two reads, and the ranking is no longer the one measured.
      if (page === undefined) throw new Error("A ranked chunk was removed while its pages were read; run the ranking again.");
      return page === null ? [] : [page];
    });
  return { vector: pagesOf(ranked.vector), keyword: pagesOf(ranked.keyword), hybrid: pagesOf(hybrid) };
}
