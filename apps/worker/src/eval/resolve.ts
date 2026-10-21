import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { EvalDocument, EvalDocumentRef, PageSource } from "@maester/contracts";
import { schema, type Db } from "@maester/db";

/** Where a page's text came from, by its items' sources. A count the indexer did not give is read as none. */
export function pageSource(itemsTextLayer: number | null, itemsOcr: number | null): PageSource {
  const layer = (itemsTextLayer ?? 0) > 0;
  const ocr = (itemsOcr ?? 0) > 0;
  if (layer && ocr) return "mixed";
  if (layer) return "text_layer";
  if (ocr) return "ocr";
  return "none";
}

const unresolved = (): Pick<EvalDocument, "revisionId" | "state" | "versions" | "chunks" | "pages"> => ({
  revisionId: null, state: null, versions: null, chunks: 0, pages: [],
});

/**
 * Each filing of the request as the workspace holds it for `model`: the stored document with that sha256 that is
 * not a duplicate (so a duplicate upload resolves to its original), then that document's complete or partial
 * revision for the model, with its versions, its chunk count and where each page's text came from. A filing the
 * workspace has not stored, or one with no such revision, keeps nulls.
 */
export async function resolveEvalDocuments(db: Db, workspaceId: string, model: string, refs: EvalDocumentRef[]): Promise<EvalDocument[]> {
  const out: EvalDocument[] = [];
  for (const ref of refs) {
    const [doc] = await db
      .select({ id: schema.document.id })
      .from(schema.document)
      .where(
        and(
          eq(schema.document.workspaceId, workspaceId),
          eq(schema.document.contentSha256, ref.sha256),
          eq(schema.document.state, "stored"),
          sql`${schema.document.intakeState} is distinct from 'duplicate'`,
        ),
      )
      .orderBy(asc(schema.document.createdAt), asc(schema.document.id))
      .limit(1);
    if (!doc) {
      out.push({ filing: ref.filing, sha256: ref.sha256, documentId: null, ...unresolved() });
      continue;
    }
    const [rev] = await db
      .select()
      .from(schema.documentIndexRevision)
      .where(
        and(
          eq(schema.documentIndexRevision.workspaceId, workspaceId),
          eq(schema.documentIndexRevision.documentId, doc.id),
          eq(schema.documentIndexRevision.embeddingModel, model),
          inArray(schema.documentIndexRevision.state, ["complete", "partial"]),
        ),
      )
      .limit(1);
    if (!rev) {
      out.push({ filing: ref.filing, sha256: ref.sha256, documentId: doc.id, ...unresolved() });
      continue;
    }
    const [chunks] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.documentChunk)
      .where(and(eq(schema.documentChunk.workspaceId, workspaceId), eq(schema.documentChunk.revisionId, rev.id)));
    const pages = await db
      .select({ page: schema.documentPage.pageNumber, itemsTextLayer: schema.documentPage.itemsTextLayer, itemsOcr: schema.documentPage.itemsOcr })
      .from(schema.documentPage)
      .where(and(eq(schema.documentPage.workspaceId, workspaceId), eq(schema.documentPage.revisionId, rev.id)))
      .orderBy(asc(schema.documentPage.pageNumber));
    out.push({
      filing: ref.filing,
      sha256: ref.sha256,
      documentId: doc.id,
      revisionId: rev.id,
      state: rev.state as "complete" | "partial",
      versions: {
        indexVersion: rev.indexVersion,
        doclingVersion: rev.doclingVersion,
        ocrEngine: rev.ocrEngine,
        readerOptions: rev.readerOptions,
        chunkerVersion: rev.chunkerVersion,
      },
      chunks: chunks!.n,
      pages: pages.map((p) => ({ page: p.page, source: pageSource(p.itemsTextLayer, p.itemsOcr) })),
    });
  }
  return out;
}
