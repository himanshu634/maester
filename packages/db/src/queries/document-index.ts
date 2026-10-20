import { and, asc, desc, eq, inArray, ne, notExists, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  chunkEmbedding, documentChunk, documentIndexRevision, documentPage, pageRead, type IndexRevisionRow,
} from "../schema/document-index.js";
import { document, job, type JobRow } from "../schema/platform.js";

// These mirror the wire types in @maester/contracts (document-index.ts). @maester/db does not
// depend on contracts, so the query inputs are plain types of the same shape.

/** What the indexer reports about how it read a document, plus the index's own versions. */
export type IndexVersions = {
  doclingVersion: string;
  ocrEngine: string;
  readerOptions: string;
  chunkerVersion: string;
  /** The model id whose tokenizer the indexer loaded. */
  tokenizer: string;
  indexVersion: string;
  embeddingModel: string;
};

export type PageInput = {
  pageNumber: number;
  text: string;
  itemsTextLayer: number | null;
  itemsOcr: number | null;
  noneReason: "NO_TEXT" | "OCR_FAILED" | "OCR_BUDGET" | null;
  sectionPathAfter: string[];
};

export type ChunkInput = {
  pageNumber: number | null;
  element?: string | null;
  seq: number;
  sectionPath: string[];
  kind: "prose" | "table";
  textSource: "text_layer" | "ocr" | "mixed" | "xbrl";
  basis?: "consolidated" | "standalone" | null;
  text: string;
  tokenCount: number;
};

export type RangeCounts = { pageCount: number | null; pagesRead: number; pagesOcr: number; warnings: string[] };

/** The key of a cached range read. */
export type PageReadKey = {
  contentSha256: string;
  firstPage: number;
  lastPage: number;
  doclingVersion: string;
  ocrEngine: string;
  readerOptions: string;
};

/** A `RangeRead` from @maester/contracts, stored as jsonb. */
export type RangeReadJson = Record<string, unknown>;

/** Rows per insert statement, to stay under Postgres's bind parameter limit. */
const INSERT_BATCH = 500;

const PARTIAL_WARNINGS = ["OCR_FAILED", "OCR_BUDGET", "PAGE_UNREADABLE"];

function versionsMatch(row: IndexRevisionRow, v: IndexVersions): boolean {
  return (
    row.indexVersion === v.indexVersion && row.doclingVersion === v.doclingVersion && row.ocrEngine === v.ocrEngine &&
    row.readerOptions === v.readerOptions && row.chunkerVersion === v.chunkerVersion && row.embeddingModel === v.embeddingModel
  );
}

/**
 * The job's revision when it was built with these versions; when the versions differ the old
 * revision is deleted (with its pages, chunks and embeddings) and a new one is started for the job.
 */
export async function startOrResumeRevision(
  db: Db,
  workspaceId: string,
  input: { documentId: string; jobId: string; versions: IndexVersions },
): Promise<IndexRevisionRow> {
  const { documentId, jobId, versions: v } = input;
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select({ id: document.id })
      .from(document)
      .where(and(eq(document.workspaceId, workspaceId), eq(document.id, documentId)));
    if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
    const [jobRow] = await tx
      .select({ subjectId: job.subjectId })
      .from(job)
      .where(and(eq(job.workspaceId, workspaceId), eq(job.id, jobId)));
    if (!jobRow || jobRow.subjectId !== documentId) throw new Error("JOB_NOT_FOR_DOCUMENT");
    const [existing] = await tx
      .select()
      .from(documentIndexRevision)
      .where(and(eq(documentIndexRevision.workspaceId, workspaceId), eq(documentIndexRevision.jobId, jobId)))
      .for("update");
    if (existing) {
      if (versionsMatch(existing, v)) return existing;
      await tx.delete(documentIndexRevision).where(eq(documentIndexRevision.id, existing.id));
    }
    const [row] = await tx
      .insert(documentIndexRevision)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        documentId,
        jobId,
        state: "building",
        indexVersion: v.indexVersion,
        doclingVersion: v.doclingVersion,
        ocrEngine: v.ocrEngine,
        readerOptions: v.readerOptions,
        chunkerVersion: v.chunkerVersion,
        embeddingModel: v.embeddingModel,
      })
      .returning();
    return row!;
  });
}

/**
 * Stores one range's pages and chunks and the revision's counts, in one transaction. A page or a
 * chunk already stored is left as it is, so writing a range twice changes nothing. The heading
 * text is the section path joined by a space, written here so callers pass only the path.
 */
export async function writeRange(
  db: Db,
  workspaceId: string,
  revisionId: string,
  documentId: string,
  pages: PageInput[],
  chunks: ChunkInput[],
  counts: RangeCounts,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [rev] = await tx
      .select()
      .from(documentIndexRevision)
      .where(and(eq(documentIndexRevision.workspaceId, workspaceId), eq(documentIndexRevision.id, revisionId)))
      .for("update");
    if (!rev) throw new Error("INDEX_REVISION_NOT_FOUND");
    if (rev.documentId !== documentId) throw new Error("REVISION_DOCUMENT_MISMATCH");
    if (rev.state !== "building") throw new Error("REVISION_NOT_BUILDING");

    for (let i = 0; i < pages.length; i += INSERT_BATCH) {
      await tx
        .insert(documentPage)
        .values(
          pages.slice(i, i + INSERT_BATCH).map((p) => ({
            id: crypto.randomUUID(),
            workspaceId,
            revisionId,
            pageNumber: p.pageNumber,
            text: p.text,
            itemsTextLayer: p.itemsTextLayer,
            itemsOcr: p.itemsOcr,
            noneReason: p.noneReason,
            sectionPathAfter: p.sectionPathAfter,
          })),
        )
        .onConflictDoNothing();
    }
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      await tx
        .insert(documentChunk)
        .values(
          chunks.slice(i, i + INSERT_BATCH).map((c) => ({
            id: crypto.randomUUID(),
            workspaceId,
            revisionId,
            documentId,
            pageNumber: c.pageNumber,
            element: c.element ?? null,
            seq: c.seq,
            sectionPath: c.sectionPath,
            kind: c.kind,
            textSource: c.textSource,
            basis: c.basis ?? null,
            headingText: c.sectionPath.join(" "),
            text: c.text,
            tokenCount: c.tokenCount,
          })),
        )
        .onConflictDoNothing();
    }

    const warnings = [...new Set([...rev.warnings, ...counts.warnings])].sort();
    await tx
      .update(documentIndexRevision)
      .set({ pageCount: counts.pageCount, pagesRead: counts.pagesRead, pagesOcr: counts.pagesOcr, warnings })
      .where(eq(documentIndexRevision.id, revisionId));
  });
}

/** The highest page stored for the revision and the section path in force after it, to resume from. */
export async function lastStoredPage(
  db: Db,
  workspaceId: string,
  revisionId: string,
): Promise<{ pageNumber: number; sectionPathAfter: string[] } | null> {
  const [row] = await db
    .select({ pageNumber: documentPage.pageNumber, sectionPathAfter: documentPage.sectionPathAfter })
    .from(documentPage)
    .where(and(eq(documentPage.workspaceId, workspaceId), eq(documentPage.revisionId, revisionId)))
    .orderBy(desc(documentPage.pageNumber))
    .limit(1);
  return row ?? null;
}

/** Chunks of the revision with no embedding for the model, in page and sequence order. */
export async function chunksWithoutEmbedding(
  db: Db,
  workspaceId: string,
  revisionId: string,
  model: string,
  limit: number,
): Promise<{ id: string; sectionPath: string[]; text: string }[]> {
  return db
    .select({ id: documentChunk.id, sectionPath: documentChunk.sectionPath, text: documentChunk.text })
    .from(documentChunk)
    .where(
      and(
        eq(documentChunk.workspaceId, workspaceId),
        eq(documentChunk.revisionId, revisionId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(chunkEmbedding)
            .where(and(eq(chunkEmbedding.chunkId, documentChunk.id), eq(chunkEmbedding.model, model))),
        ),
      ),
    )
    .orderBy(asc(documentChunk.pageNumber), asc(documentChunk.seq))
    .limit(limit);
}

/** Stores embeddings for chunks of this workspace; one already stored for the model is left as it is. */
export async function insertEmbeddings(
  db: Db,
  workspaceId: string,
  model: string,
  rows: { chunkId: string; embedding: number[] }[],
): Promise<void> {
  if (rows.length === 0) return;
  const ids = [...new Set(rows.map((r) => r.chunkId))];
  const owned = await db
    .select({ id: documentChunk.id })
    .from(documentChunk)
    .where(and(eq(documentChunk.workspaceId, workspaceId), inArray(documentChunk.id, ids)));
  if (owned.length !== ids.length) throw new Error("CHUNK_NOT_IN_WORKSPACE");
  for (let i = 0; i < rows.length; i += 100) {
    await db
      .insert(chunkEmbedding)
      .values(rows.slice(i, i + 100).map((r) => ({ chunkId: r.chunkId, model, workspaceId, embedding: r.embedding })))
      .onConflictDoNothing();
  }
}

/**
 * Makes the revision the document's current one for its model: in one transaction the document's
 * other revisions for the model are deleted, then the revision is marked partial when a page hit
 * the OCR budget or failed, else complete.
 */
export async function completeRevision(db: Db, workspaceId: string, revisionId: string): Promise<IndexRevisionRow> {
  return db.transaction(async (tx) => {
    const [rev] = await tx
      .select()
      .from(documentIndexRevision)
      .where(and(eq(documentIndexRevision.workspaceId, workspaceId), eq(documentIndexRevision.id, revisionId)))
      .for("update");
    if (!rev) throw new Error("INDEX_REVISION_NOT_FOUND");
    await tx
      .delete(documentIndexRevision)
      .where(
        and(
          eq(documentIndexRevision.workspaceId, workspaceId),
          eq(documentIndexRevision.documentId, rev.documentId),
          eq(documentIndexRevision.embeddingModel, rev.embeddingModel),
          ne(documentIndexRevision.id, revisionId),
        ),
      );
    const state = rev.warnings.some((w) => PARTIAL_WARNINGS.includes(w)) ? "partial" : "complete";
    const [row] = await tx
      .update(documentIndexRevision)
      .set({ state, completedAt: sql`now()` })
      .where(eq(documentIndexRevision.id, revisionId))
      .returning();
    return row!;
  });
}

export async function getPageRead(db: Db, workspaceId: string, key: PageReadKey): Promise<RangeReadJson | null> {
  const [row] = await db
    .select({ read: pageRead.read })
    .from(pageRead)
    .where(
      and(
        eq(pageRead.workspaceId, workspaceId),
        eq(pageRead.contentSha256, key.contentSha256),
        eq(pageRead.firstPage, key.firstPage),
        eq(pageRead.lastPage, key.lastPage),
        eq(pageRead.doclingVersion, key.doclingVersion),
        eq(pageRead.ocrEngine, key.ocrEngine),
        eq(pageRead.readerOptions, key.readerOptions),
      ),
    )
    .limit(1);
  return row?.read ?? null;
}

export async function putPageRead(db: Db, workspaceId: string, key: PageReadKey, read: RangeReadJson): Promise<void> {
  await db
    .insert(pageRead)
    .values({ id: crypto.randomUUID(), workspaceId, ...key, read })
    .onConflictDoNothing();
}

/**
 * Stored documents with no complete or partial revision for the model, each with its
 * `document.index` job of this pipeline version when one exists. A duplicate gets no index; a
 * stored document from before intake (null intake state) is included.
 */
export async function documentsNeedingIndex(
  db: Db,
  input: { workspaceId?: string; documentIds?: string[]; model: string; pipelineVersion: string },
): Promise<{ documentId: string; workspaceId: string; job: JobRow | null }[]> {
  if (input.documentIds && input.documentIds.length === 0) return [];
  const rows = await db
    .select({ documentId: document.id, workspaceId: document.workspaceId, job })
    .from(document)
    .leftJoin(
      job,
      and(
        eq(job.workspaceId, document.workspaceId),
        eq(job.idempotencyKey, sql`'document.index:' || ${document.id}::text || ':' || ${input.pipelineVersion}::text`),
      ),
    )
    .where(
      and(
        eq(document.state, "stored"),
        sql`${document.intakeState} is distinct from 'duplicate'`,
        input.workspaceId ? eq(document.workspaceId, input.workspaceId) : undefined,
        input.documentIds ? inArray(document.id, input.documentIds) : undefined,
        notExists(
          db
            .select({ one: sql`1` })
            .from(documentIndexRevision)
            .where(
              and(
                eq(documentIndexRevision.documentId, document.id),
                eq(documentIndexRevision.embeddingModel, input.model),
                inArray(documentIndexRevision.state, ["complete", "partial"]),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(document.createdAt), asc(document.id));
  return rows;
}
