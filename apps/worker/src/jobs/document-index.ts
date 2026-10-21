import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { RangeRead, contextualize, type ChunkTextResponse, type IndexerEvent, type IndexerVersions } from "@maester/contracts";
import {
  chunksWithoutEmbedding, completeRevision, getPageRead, insertEmbeddings, lastStoredPage, putPageRead, schema, startOrResumeRevision,
  writeRange, type ChunkInput, type Db, type IndexRevisionRow, type IndexVersions, type PageInput, type PageReadKey,
} from "@maester/db";
import { EmbedderError, INDEX_PIPELINE_VERSION, type Embedder } from "@maester/document-index";
import { ObjectNotFoundError } from "@maester/storage";
import type { IndexResult } from "../indexer.js";
import { readAll } from "./document-extract.js";
import { JobFailure, type JobContext, type JobHandler } from "./types.js";

export type DocumentIndexResult = {
  outcome: "indexed";
  revisionId: string;
  state: "complete" | "partial";
  pages: number;
  chunks: number;
  ocrPages: number;
};

/** Page none reasons that make the revision partial; NO_TEXT (a blank page) is not one. */
const WARNING_CODES = new Set(["OCR_FAILED", "OCR_BUDGET", "PAGE_UNREADABLE"]);

/** Chunks fetched per round of embedding, in batches of EMBED_BATCH. */
const EMBED_ROUND_BATCHES = 8;

const INDEXER_FIELDS = ["doclingVersion", "ocrEngine", "readerOptions", "chunkerVersion", "tokenizer"] as const;

function sameVersions(a: IndexerVersions, b: IndexerVersions): boolean {
  return INDEXER_FIELDS.every((f) => a[f] === b[f]);
}

/**
 * A failure of the indexer, kept to its code: an `error` event's message is written by the indexer
 * and may quote the page, and the runner logs and stores a failure's message.
 */
function indexerFailure(err: unknown, what: string): unknown {
  if (err instanceof JobFailure) return new JobFailure(err.code, `the indexer failed with ${err.code} ${what}`, err.retryable);
  return err;
}

/** The codes the index queries in @maester/db throw; they carry no text. */
const QUERY_CODES = new Set(["INDEX_REVISION_NOT_FOUND", "REVISION_DOCUMENT_MISMATCH", "REVISION_NOT_BUILDING", "CHUNK_NOT_IN_WORKSPACE"]);

/**
 * A write that failed. A query's own code is kept (retried: a revision deleted by another job's
 * completion is started again). Any other error may quote the page text or the vectors in its
 * parameters (drizzle's message lists them), so it is kept to its SQLSTATE.
 */
function writeFailure(err: unknown, what: string): Error {
  if (err instanceof Error && QUERY_CODES.has(err.message) && err.cause === undefined) {
    return new JobFailure(err.message, `${err.message} ${what}`, true);
  }
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const state = typeof e.cause?.code === "string" ? e.cause.code : typeof e.code === "string" ? e.code : null;
  return new Error(`${what} failed${state ? ` (SQLSTATE ${state})` : ""}`, { cause: err });
}

/** Postgres refuses U+0000 in text and in jsonb; a PDF with a broken ToUnicode map can still produce it. */
const clean = (text: string): string => text.replaceAll("\u0000", "");
const cleanPath = (path: string[]): string[] => path.map(clean);

/** Every string of a JSON value, keys included, without U+0000. */
function cleanJson(value: unknown): unknown {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.map(cleanJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [clean(k), cleanJson(v)]));
  }
  return value;
}

/** Page numbers must be exactly first..last; anything else is not a read of the range asked for. */
function checkPages(result: IndexResult, first: number, last: number, where: string): void {
  const numbers = result.pages.map((p) => p.pageNumber);
  const exact = numbers.length === last - first + 1 && numbers.every((n, i) => n === first + i);
  const chunksInside = result.chunks.every((c) => c.pageNumber >= first && c.pageNumber <= last);
  if (!exact || !chunksInside) {
    throw new JobFailure("INVALID_INDEXER_RESULT", `the indexer did not answer with exactly pages ${first}-${last} ${where}`, false);
  }
}

/** The page count of this file from the newest cached read of it in the workspace; null when none is cached. */
async function cachedPageCount(db: Db, workspaceId: string, contentSha256: string): Promise<number | null> {
  const [row] = await db
    .select({ pageCount: sql<number | null>`(${schema.pageRead.read} ->> 'pageCount')::int` })
    .from(schema.pageRead)
    .where(and(eq(schema.pageRead.workspaceId, workspaceId), eq(schema.pageRead.contentSha256, contentSha256)))
    .orderBy(desc(schema.pageRead.createdAt), desc(schema.pageRead.id))
    .limit(1);
  return row?.pageCount ?? null;
}

async function summary(db: Db, revision: IndexRevisionRow): Promise<DocumentIndexResult> {
  const [pages] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documentPage)
    .where(and(eq(schema.documentPage.workspaceId, revision.workspaceId), eq(schema.documentPage.revisionId, revision.id)));
  const [chunks] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documentChunk)
    .where(and(eq(schema.documentChunk.workspaceId, revision.workspaceId), eq(schema.documentChunk.revisionId, revision.id)));
  return {
    outcome: "indexed",
    revisionId: revision.id,
    state: revision.state as "complete" | "partial",
    pages: pages!.n,
    chunks: chunks!.n,
    ocrPages: revision.pagesOcr,
  };
}

/** Embeds the revision's chunks that have no vector for the model yet, longest first within each round. */
async function embedPending(ctx: JobContext, embedder: Embedder, revision: IndexRevisionRow, checkTime: () => void): Promise<number> {
  const batch = ctx.env.EMBED_BATCH;
  let embedded = 0;
  for (;;) {
    const pending = await chunksWithoutEmbedding(ctx.db, revision.workspaceId, revision.id, revision.embeddingModel, batch * EMBED_ROUND_BATCHES);
    if (pending.length === 0) return embedded;
    const inputs = pending
      .map((c) => ({ id: c.id, text: contextualize(c.sectionPath, c.text) }))
      .sort((a, b) => b.text.length - a.text.length);
    for (let i = 0; i < inputs.length; i += batch) {
      checkTime();
      const part = inputs.slice(i, i + batch);
      let vectors: number[][];
      try {
        vectors = await embedder.embed(part.map((c) => c.text), "document");
      } catch (err) {
        if (err instanceof EmbedderError) throw new JobFailure("EMBEDDING_FAILED", `the embedder failed with ${err.code}`, true);
        throw err;
      }
      if (vectors.length !== part.length) {
        throw new JobFailure("EMBEDDING_FAILED", `the embedder answered ${vectors.length} vectors for ${part.length} chunks`, true);
      }
      try {
        await insertEmbeddings(ctx.db, revision.workspaceId, revision.embeddingModel, part.map((c, j) => ({ chunkId: c.id, embedding: vectors[j]! })));
      } catch (err) {
        throw writeFailure(err, "storing embeddings");
      }
      embedded += part.length;
      await ctx.heartbeat();
    }
  }
}

/**
 * An XBRL instance's text blocks as an index revision: the extractor's `text` mode gives the blocks, the indexer cuts
 * them with the embedding model's tokenizer. There is no page and no reader, so the revision's reader versions are
 * "none" and its reader options name the text version; its chunks have no page, their element and text_source
 * 'xbrl'. A retry after an embedder failure finds the revision (same versions) and the chunks already stored, and
 * writes none twice: a chunk's (revision, page, seq) is unique, and the cut is the same each time.
 */
async function indexXbrl(
  job: { id: string; workspaceId: string },
  ctx: JobContext,
  doc: typeof schema.document.$inferSelect,
  clock: { startedAt: number; signal: () => AbortSignal; checkTime: () => void },
): Promise<DocumentIndexResult> {
  const { extractor, indexer, embedder } = ctx;
  if (!extractor) throw new JobFailure("EXTRACTOR_NOT_CONFIGURED", "EXTRACTOR_URL is not set on the worker", false);
  if (!indexer || !embedder) throw new JobFailure("INDEXER_NOT_CONFIGURED", "INDEXER_URL or EMBEDDER_URL is not set on the worker", false);
  const model = ctx.env.EMBEDDING_MODEL;
  const ws = job.workspaceId;
  if (embedder.model !== model) {
    throw new JobFailure("INDEXER_MODEL_MISMATCH", "the embedder's model is not EMBEDDING_MODEL", false);
  }

  let instance: Uint8Array;
  try {
    instance = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored instance is missing", false);
    throw err;
  }

  await ctx.progress({ stage: "reading", percent: 0 });
  clock.checkTime();
  const text = await extractor.xbrl({ instance, documentId: doc.id, mode: "text" }, async () => {
    await ctx.heartbeat();
  });
  await ctx.heartbeat();
  let chunked: ChunkTextResponse;
  try {
    chunked = await indexer.chunkText(
      {
        blocks: text.blocks.map(({ element, heading, text: body }) => ({ element, heading, text: body })),
        basis: text.basis === "unknown" ? null : text.basis,
        embeddingModel: model,
      },
      clock.signal(),
    );
  } catch (err) {
    throw indexerFailure(err, "on text chunks");
  }
  const versions = chunked.versions;
  if (versions.tokenizer !== model) {
    throw new JobFailure("INDEXER_MODEL_MISMATCH", "the indexer's tokenizer is not EMBEDDING_MODEL", false);
  }
  const indexVersions: IndexVersions = {
    doclingVersion: "none",
    ocrEngine: "none",
    readerOptions: `xbrl-text=${text.textVersion}`,
    chunkerVersion: versions.chunkerVersion,
    tokenizer: versions.tokenizer,
    indexVersion: INDEX_PIPELINE_VERSION,
    embeddingModel: model,
  };

  let revision: IndexRevisionRow;
  try {
    revision = await startOrResumeRevision(ctx.db, ws, { documentId: doc.id, jobId: job.id, versions: indexVersions });
  } catch (err) {
    const code = (err as Error).message;
    if (code === "DOCUMENT_NOT_FOUND" || code === "JOB_NOT_FOR_DOCUMENT") throw new JobFailure("INVALID_STATE", code, false);
    throw err;
  }
  if (revision.state !== "building") return summary(ctx.db, revision);
  const log = ctx.logger.child({ documentId: doc.id, revisionId: revision.id });

  const chunkRows: ChunkInput[] = chunked.chunks.map((c) => ({
    pageNumber: null, element: clean(c.element), seq: c.seq, sectionPath: cleanPath(c.sectionPath), kind: c.kind, textSource: "xbrl",
    basis: c.basis, text: clean(c.text), tokenCount: c.tokenCount,
  }));
  try {
    await writeRange(ctx.db, ws, revision.id, doc.id, [], chunkRows, { pageCount: 0, pagesRead: 0, pagesOcr: 0, warnings: [] });
  } catch (err) {
    throw writeFailure(err, "storing the text chunks");
  }
  await ctx.heartbeat();
  await ctx.progress({ stage: "reading", percent: 50 });
  const embedded = await embedPending(ctx, embedder, revision, clock.checkTime);
  const completed = await completeRevision(ctx.db, ws, revision.id);
  await ctx.progress({ stage: "indexed", percent: 100 });
  const result = await summary(ctx.db, completed);
  log.info(
    { state: result.state, blocks: text.blocks.length, chunks: result.chunks, embedded, seconds: (Date.now() - clock.startedAt) / 1000 },
    "xbrl text indexed",
  );
  return result;
}

async function index(job: { id: string; workspaceId: string; subjectId: string }, ctx: JobContext): Promise<DocumentIndexResult> {
  const { indexer, embedder } = ctx;
  if (!indexer || !embedder) throw new JobFailure("INDEXER_NOT_CONFIGURED", "INDEXER_URL or EMBEDDER_URL is not set on the worker", false);
  const startedAt = Date.now();
  const deadline = startedAt + ctx.env.INDEX_TIMEOUT_SECONDS * 1000;
  const timeLeft = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) throw new JobFailure("INDEX_TIMEOUT", `the index job ran past ${ctx.env.INDEX_TIMEOUT_SECONDS} seconds`, true);
    return left;
  };
  const signal = (): AbortSignal => AbortSignal.timeout(timeLeft());
  const checkTime = (): void => void timeLeft();
  const model = ctx.env.EMBEDDING_MODEL;
  const ws = job.workspaceId;

  const [doc] = await ctx.db
    .select()
    .from(schema.document)
    .where(and(eq(schema.document.id, job.subjectId), eq(schema.document.workspaceId, ws)))
    .limit(1);
  if (!doc) throw new JobFailure("INVALID_STATE", `document ${job.subjectId} not found in workspace ${ws}`, false);
  if (doc.state !== "stored") throw new JobFailure("INVALID_STATE", `document is ${doc.state}; only stored documents are indexed`, false);
  if (doc.intakeState === "duplicate") throw new JobFailure("INVALID_STATE", "a duplicate document gets no index", false);

  // A crash after the revision completed but before the job was marked: return what was built,
  // without asking the indexer, whose versions may have moved on since.
  const [done] = await ctx.db
    .select()
    .from(schema.documentIndexRevision)
    .where(and(eq(schema.documentIndexRevision.workspaceId, ws), eq(schema.documentIndexRevision.jobId, job.id)));
  if (done && done.state !== "building") return summary(ctx.db, done);

  if (doc.format === "xbrl") return indexXbrl(job, ctx, doc, { startedAt, signal, checkTime });

  let pdf: Uint8Array;
  try {
    pdf = await readAll(ctx.store, doc.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new JobFailure("OBJECT_MISSING", "the stored PDF is missing", false);
    throw err;
  }
  const sha256 = doc.contentSha256 ?? createHash("sha256").update(pdf).digest("hex");

  let versions: IndexerVersions;
  try {
    versions = await indexer.versions();
  } catch (err) {
    throw indexerFailure(err, "on versions");
  }
  if (versions.tokenizer !== model || embedder.model !== model) {
    throw new JobFailure("INDEXER_MODEL_MISMATCH", "the indexer's tokenizer or the embedder's model is not EMBEDDING_MODEL", false);
  }
  const indexVersions: IndexVersions = { ...versions, indexVersion: INDEX_PIPELINE_VERSION, embeddingModel: model };

  let revision: IndexRevisionRow;
  try {
    revision = await startOrResumeRevision(ctx.db, ws, { documentId: doc.id, jobId: job.id, versions: indexVersions });
  } catch (err) {
    const code = (err as Error).message;
    if (code === "DOCUMENT_NOT_FOUND" || code === "JOB_NOT_FOR_DOCUMENT") throw new JobFailure("INVALID_STATE", code, false);
    throw err;
  }
  if (revision.state !== "building") return summary(ctx.db, revision);
  const log = ctx.logger.child({ documentId: doc.id, revisionId: revision.id });

  const range = ctx.env.INDEX_PAGE_RANGE;
  const last = await lastStoredPage(ctx.db, ws, revision.id);
  const next = last ? last.pageNumber + 1 : 1;
  let path = last?.sectionPathAfter ?? [];
  // Cache keys are clamped to the page count, so the page count is wanted before the first range: from the
  // revision once a range is stored, else from the newest cached read of this file. With neither, nothing of the
  // file is cached, and the first range is read without a cache lookup.
  // That count is an assumption until the indexer reports its own (`started.pageCount`), checked after each range.
  let pageCount = revision.pageCount ?? (await cachedPageCount(ctx.db, ws, sha256));
  let pagesStored = last !== null;
  let recounted = false;
  let pagesRead = revision.pagesRead;
  let pagesOcr = revision.pagesOcr;
  const onEvent = async (_event: IndexerEvent): Promise<void> => {
    await ctx.heartbeat();
  };
  const percent = (pagesDone: number): number => (pageCount && pageCount > 0 ? Math.floor((Math.min(pagesDone, pageCount) / pageCount) * 90) : 0);
  await ctx.progress({ stage: "reading", percent: percent(next - 1) });

  // Ranges sit at fixed multiples of INDEX_PAGE_RANGE from page 1, so a retry or a rebuild asks for the same cache keys.
  // When every page is stored (a retry after an embedder failure), no range is read.
  const pending = (first: number): boolean => pageCount === null || (next <= pageCount && first <= pageCount);
  for (let first = Math.floor((next - 1) / range) * range + 1; pending(first); first += range) {
    const rangeStartedAt = Date.now();
    let lastPage = pageCount === null ? first + range - 1 : Math.min(first + range - 1, pageCount);
    let where = `on pages ${first}-${lastPage}`;
    const keyFor = (last: number): PageReadKey => ({
      contentSha256: sha256, firstPage: first, lastPage: last,
      doclingVersion: versions.doclingVersion, ocrEngine: versions.ocrEngine, readerOptions: versions.readerOptions,
    });
    const stored = pageCount === null ? null : await getPageRead(ctx.db, ws, keyFor(lastPage));
    const parsed = stored ? RangeRead.safeParse(stored) : null;
    const cached = parsed?.success ? parsed.data : null;

    let result: IndexResult;
    try {
      result = cached
        ? await indexer.chunk({ read: cached, sectionPathBefore: path, embeddingModel: model }, signal(), onEvent)
        : await indexer.index(
            {
              pdf, documentId: doc.id, firstPage: first, lastPage, sectionPathBefore: path,
              ocrPagesLeft: Math.max(0, ctx.env.OCR_PAGE_BUDGET - pagesOcr), signal: signal(),
            },
            onEvent,
          );
    } catch (err) {
      throw indexerFailure(err, where);
    }
    if (!sameVersions(result.started.versions, versions)) {
      throw new JobFailure("INDEXER_VERSIONS_CHANGED", `the indexer's versions changed ${where}`, true);
    }
    if (pageCount !== null && result.started.pageCount !== pageCount) {
      // The assumed count came from the revision or from a cached read under another key. Before any page is
      // stored, the indexer's count is trusted, once. After, the stored ranges were cut to the old count, so the
      // revision cannot be finished from this file; a second recount means the counts do not settle.
      if (pagesStored || recounted) {
        throw new JobFailure("INVALID_INDEXER_RESULT", `the indexer counted ${result.started.pageCount} pages, not ${pageCount}, ${where}`, false);
      }
      recounted = true;
      pageCount = result.started.pageCount;
      try {
        await writeRange(ctx.db, ws, revision.id, doc.id, [], [], { pageCount, pagesRead, pagesOcr, warnings: [] });
      } catch (err) {
        throw writeFailure(err, `storing the page count ${where}`);
      }
      const rangeLast = Math.min(first + range - 1, pageCount);
      // An answer cut short by a count that was too low is not this range's read, and is neither cached nor stored:
      // the range is asked for again with its real bounds.
      if (result.started.firstPage !== first || result.started.lastPage !== rangeLast) {
        first -= range;
        continue;
      }
      lastPage = rangeLast;
      where = `on pages ${first}-${lastPage}`;
    }
    pageCount ??= cached?.pageCount ?? result.read?.pageCount ?? result.started.pageCount;
    const clampedLast = Math.min(lastPage, pageCount);
    checkPages(result, first, clampedLast, where);
    // Not cached: a read made with OCR off for the budget (a later build with budget left reads it with OCR), and
    // a read with a page Docling failed on (the failure may pass; it must not be frozen into the cache).
    if (!cached && result.read?.ocrOn && !result.read.pages.some((p) => p.noneReason === "PAGE_UNREADABLE")) {
      try {
        await putPageRead(ctx.db, ws, keyFor(clampedLast), cleanJson(result.read) as Record<string, unknown>);
      } catch (err) {
        throw writeFailure(err, `caching the read ${where}`);
      }
    }

    const pages = result.pages.filter((p) => p.pageNumber >= next);
    const chunks = result.chunks.filter((c) => c.pageNumber >= next);
    const pageRows: PageInput[] = pages.map((p) => ({
      pageNumber: p.pageNumber,
      text: clean(p.text),
      itemsTextLayer: p.itemsTextLayer,
      itemsOcr: p.itemsOcr,
      noneReason: p.noneReason,
      sectionPathAfter: cleanPath(p.sectionPathAfter),
    }));
    const chunkRows: ChunkInput[] = chunks.map((c) => ({
      pageNumber: c.pageNumber, seq: c.seq, sectionPath: cleanPath(c.sectionPath), kind: c.kind, textSource: c.textSource,
      basis: c.basis, text: clean(c.text), tokenCount: c.tokenCount,
    }));
    const ocrPages = pages.filter((p) => p.itemsOcr > 0 || p.noneReason === "OCR_FAILED").length;
    pagesRead += pages.length;
    pagesOcr += ocrPages;
    const warnings = [...new Set(pages.map((p) => p.noneReason).filter((r): r is NonNullable<typeof r> => r !== null && WARNING_CODES.has(r)))];
    try {
      await writeRange(ctx.db, ws, revision.id, doc.id, pageRows, chunkRows, { pageCount, pagesRead, pagesOcr, warnings });
    } catch (err) {
      throw writeFailure(err, `storing pages ${first}-${lastPage}`);
    }
    if (pageRows.length > 0) pagesStored = true;
    if (result.pages.length > 0) path = cleanPath(result.pages[result.pages.length - 1]!.sectionPathAfter);
    await ctx.heartbeat();
    await ctx.progress({ stage: "reading", percent: percent(clampedLast) });
    const embedded = await embedPending(ctx, embedder, revision, checkTime);
    log.info(
      {
        firstPage: first, lastPage, cached: cached !== null, pages: pages.length, chunks: chunks.length, ocrPages, embedded,
        seconds: (Date.now() - rangeStartedAt) / 1000,
      },
      "index range stored",
    );
  }

  // A retry after an embedder failure finds every page stored and only vectors missing.
  await embedPending(ctx, embedder, revision, checkTime);
  const completed = await completeRevision(ctx.db, ws, revision.id);
  await ctx.progress({ stage: "indexed", percent: 100 });
  const result = await summary(ctx.db, completed);
  log.info(
    { state: result.state, pages: result.pages, chunks: result.chunks, ocrPages: result.ocrPages, warnings: completed.warnings, seconds: (Date.now() - startedAt) / 1000 },
    "document indexed",
  );
  return result;
}

export const documentIndex: JobHandler = index;
