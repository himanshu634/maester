import { Writable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DOCUMENT_INDEX_SUBJECT, JobTypes, type XbrlTextResult, type ChunkTextRequest, type ChunkTextResponse, type IndexerVersions,
} from "@maester/contracts";
import { schema, type JobRow } from "@maester/db";
import { FakeEmbedder, indexPipelineVersion, searchChunks, type Embedder } from "@maester/document-index";
import type { ExtractorClient, XbrlRequest } from "../src/extractor.js";
import type { IndexerClient } from "../src/indexer.js";
import { documentIndex } from "../src/jobs/document-index.js";
import { JobFailure } from "../src/jobs/types.js";
import { runJob, type WorkerDeps } from "../src/run.js";
import { createWorkerContext, seedWorkspace } from "./context.js";

const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";
/** What the indexer reports for XBRL text: its own chunker and tokenizer. The reader fields are the PDF reader's. */
const VERSIONS: IndexerVersions = {
  doclingVersion: "2.134.0",
  ocrEngine: "rapidocr-onnxruntime 3.9.2",
  readerOptions: "table=accurate;cell_matching=true;ocr=rapidocr",
  chunkerVersion: "1",
  tokenizer: MODEL,
};

const NOTES = "DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock";
const SEGMENTS = "DisclosureOfNotesOnSegmentsExplanatoryTextBlock";
const AUDIT_SENTENCE = "The results were reviewed by the audit committee.";
const SEGMENT_TABLE = "Segment | Plants\nCement | Two\nSteel | One";

const TEXT: XbrlTextResult = {
  textVersion: "1",
  basis: "consolidated",
  blocks: [
    { element: NOTES, contextId: "OneD", heading: "Disclosure of notes on financial results", text: `${AUDIT_SENTENCE}\n\nThe plants ran all quarter.` },
    { element: SEGMENTS, contextId: "OneD", heading: "Segment information", text: SEGMENT_TABLE },
  ],
};

/** Answers `text` mode with the next result, or throws it. */
class FakeExtractor {
  text: XbrlTextResult | JobFailure = TEXT;
  calls: XbrlRequest<"text">[] = [];

  readonly client: ExtractorClient = {
    extract: async () => { throw new Error("no extract in these tests"); },
    classify: async () => { throw new Error("no classify in these tests"); },
    xbrl: (async (input: XbrlRequest<"text">, onEvent: (e: { type: "heartbeat" }) => Promise<void>) => {
      if (input.mode !== "text") throw new Error(`no ${input.mode} in these tests`);
      this.calls.push(input);
      await onEvent({ type: "heartbeat" });
      if (this.text instanceof JobFailure) throw this.text;
      return structuredClone(this.text);
    }) as unknown as ExtractorClient["xbrl"],
    xbrlPdfCheck: async () => { throw new Error("no pdf check in these tests"); },
  };
}

/** Chunks as the indexer does in outline: a paragraph a chunk, a table paragraph a table; the heading is the path. */
class FakeIndexer implements IndexerClient {
  requests: ChunkTextRequest[] = [];
  versionsValue: IndexerVersions = VERSIONS;
  /** What `chunkText` fails with, once. */
  failWith: JobFailure | null = null;

  async versions(): Promise<IndexerVersions> {
    return this.versionsValue;
  }

  async index(): Promise<never> {
    throw new Error("a text index reads no PDF");
  }

  async chunk(): Promise<never> {
    throw new Error("a text index chunks no read");
  }

  async chunkText(request: ChunkTextRequest): Promise<ChunkTextResponse> {
    this.requests.push(structuredClone(request));
    if (this.failWith) {
      const failure = this.failWith;
      this.failWith = null;
      throw failure;
    }
    const chunks: ChunkTextResponse["chunks"] = [];
    for (const block of request.blocks) {
      for (const paragraph of block.text.split(/\n\s*\n/).filter((p) => p.trim())) {
        chunks.push({
          element: block.element, seq: chunks.length, sectionPath: [block.heading], basis: request.basis, text: paragraph,
          kind: paragraph.split("\n").every((l) => l.includes(" | ")) ? "table" : "prose",
          tokenCount: paragraph.split(/\s+/).length + block.heading.split(/\s+/).length,
        });
      }
    }
    return { versions: this.versionsValue, chunks };
  }
}

/** A FakeEmbedder that counts its calls and can be told which call fails. */
class CountingEmbedder implements Embedder {
  readonly model = MODEL;
  readonly inner = new FakeEmbedder(MODEL);
  calls: string[][] = [];
  failCall: number | null = null;

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    this.calls.push(texts);
    if (this.calls.length === this.failCall) this.inner.fail(1);
    return this.inner.embed(texts, kind);
  }
}

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;

beforeAll(async () => {
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_INDEX]: documentIndex });
});
afterAll(async () => {
  await ctx.close();
});

async function seedDocument(opts: { put?: boolean } = {}) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.xml`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "results.xml", declaredSize: 10, declaredMime: "application/xml", format: "xbrl", storageKey,
    state: "stored", sizeBytes: 10, contentSha256: crypto.randomUUID().replaceAll("-", ""), intakeState: "read", createdByUserId: userId,
  });
  if (opts.put !== false) await ctx.store.put(storageKey, new TextEncoder().encode("<xbrl>synthetic</xbrl>"), "application/xml");
  return { workspaceId, id };
}

async function seedIndexJob(doc: { workspaceId: string; id: string }) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id, workspaceId: doc.workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: doc.id,
    idempotencyKey: `document.index:${doc.id}:${indexPipelineVersion(MODEL)}`, state: "queued",
  });
  return id;
}

type Run = {
  extractor?: ExtractorClient | null;
  indexer?: IndexerClient | null;
  embedder?: Embedder | null;
  logger?: WorkerDeps["logger"];
};

async function run(jobId: string, opts: Run): Promise<JobRow> {
  const deps: WorkerDeps = {
    ...ctx,
    extractor: opts.extractor === undefined ? null : opts.extractor,
    indexer: opts.indexer === undefined ? null : opts.indexer,
    embedder: opts.embedder === undefined ? null : opts.embedder,
    logger: opts.logger ?? ctx.logger,
  };
  await runJob(deps, JobTypes.DOCUMENT_INDEX, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  return job!;
}

const revisionsOf = (documentId: string) =>
  ctx.db.select().from(schema.documentIndexRevision).where(eq(schema.documentIndexRevision.documentId, documentId));

const chunksOf = (revisionId: string) =>
  ctx.db.select().from(schema.documentChunk).where(eq(schema.documentChunk.revisionId, revisionId)).orderBy(schema.documentChunk.seq);

async function embeddedCount(revisionId: string): Promise<number> {
  const { rows } = await ctx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from chunk_embedding e join document_chunk c on c.id = e.chunk_id where c.revision_id = ${revisionId} and e.model = ${MODEL}`,
  );
  return rows[0]!.n;
}

function captureLogs() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: pino({ level: "debug" }, sink), output: () => lines.join("") };
}

describe("document.index on an XBRL document", () => {
  it("indexes the text blocks into a complete revision: no page, an element, text_source xbrl, every chunk embedded", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const extractor = new FakeExtractor();
    const indexer = new FakeIndexer();
    const embedder = new CountingEmbedder();

    const job = await run(jobId, { extractor: extractor.client, indexer, embedder });

    expect(job.state).toBe("succeeded");
    expect(extractor.calls).toHaveLength(1);
    expect(extractor.calls[0]).toMatchObject({ documentId: doc.id, mode: "text" });
    expect(indexer.requests).toEqual([{ blocks: TEXT.blocks.map(({ element, heading, text }) => ({ element, heading, text })), basis: "consolidated", embeddingModel: MODEL }]);

    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({
      state: "complete", jobId, doclingVersion: "none", ocrEngine: "none", readerOptions: "xbrl-text=1",
      chunkerVersion: "1", embeddingModel: MODEL, pageCount: 0, pagesRead: 0, pagesOcr: 0, warnings: [],
    });
    expect(await ctx.db.select().from(schema.documentPage).where(eq(schema.documentPage.revisionId, revision!.id))).toEqual([]);
    const chunks = await chunksOf(revision!.id);
    expect(chunks.map((c) => [c.seq, c.element, c.kind, c.pageNumber, c.textSource, c.basis, c.sectionPath])).toEqual([
      [0, NOTES, "prose", null, "xbrl", "consolidated", ["Disclosure of notes on financial results"]],
      [1, NOTES, "prose", null, "xbrl", "consolidated", ["Disclosure of notes on financial results"]],
      [2, SEGMENTS, "table", null, "xbrl", "consolidated", ["Segment information"]],
    ]);
    expect(chunks.map((c) => c.text)).toEqual([AUDIT_SENTENCE, "The plants ran all quarter.", SEGMENT_TABLE]);
    expect(await embeddedCount(revision!.id)).toBe(3);
    expect(job.result).toEqual({ outcome: "indexed", revisionId: revision!.id, state: "complete", pages: 0, chunks: 3, ocrPages: 0 });
    expect(job.progress).toEqual({ stage: "indexed", percent: 100 });
  });

  it("a search for a word in a block finds it with no page and its element", async () => {
    const doc = await seedDocument();
    const embedder = new FakeEmbedder(MODEL);
    await run(await seedIndexJob(doc), { extractor: new FakeExtractor().client, indexer: new FakeIndexer(), embedder });

    const hits = await searchChunks(ctx.db, embedder, { workspaceId: doc.workspaceId, query: "committee" });

    expect(hits[0]).toMatchObject({
      documentId: doc.id, pageNumber: null, element: NOTES, textSource: "xbrl", kind: "prose", text: AUDIT_SENTENCE,
      sectionPath: ["Disclosure of notes on financial results"],
    });
    expect(hits[0]!.keywordRank).toBe(1);
    const table = await searchChunks(ctx.db, embedder, { workspaceId: doc.workspaceId, query: "Cement" });
    expect(table[0]).toMatchObject({ pageNumber: null, element: SEGMENTS, kind: "table" });
  });

  it("an embedder failure leaves the revision building, and the retry writes no chunk twice and embeds them all", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const extractor = new FakeExtractor();
    const indexer = new FakeIndexer();
    const embedder = new CountingEmbedder();
    embedder.failCall = 1;

    const first = await run(jobId, { extractor: extractor.client, indexer, embedder });
    expect(first).toMatchObject({ state: "queued", lastErrorCode: "EMBEDDING_FAILED" });
    const [building] = await revisionsOf(doc.id);
    expect(building).toMatchObject({ state: "building" });
    expect(await chunksOf(building!.id)).toHaveLength(3);
    expect(await embeddedCount(building!.id)).toBe(0);

    const second = await run(jobId, { extractor: extractor.client, indexer, embedder });
    expect(second.state).toBe("succeeded");
    const revisions = await revisionsOf(doc.id);
    expect(revisions.map((r) => r.id)).toEqual([building!.id]);
    expect(revisions[0]).toMatchObject({ state: "complete" });
    const chunks = await chunksOf(building!.id);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(await embeddedCount(building!.id)).toBe(3);
  });

  it("a document with no text block completes a revision with no chunks", async () => {
    const doc = await seedDocument();
    const extractor = new FakeExtractor();
    extractor.text = { textVersion: "1", basis: "standalone", blocks: [] };
    const embedder = new CountingEmbedder();

    const job = await run(await seedIndexJob(doc), { extractor: extractor.client, indexer: new FakeIndexer(), embedder });

    expect(job.state).toBe("succeeded");
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "complete", pageCount: 0 });
    expect(await chunksOf(revision!.id)).toEqual([]);
    expect(embedder.calls).toEqual([]);
    expect(job.result).toMatchObject({ outcome: "indexed", state: "complete", pages: 0, chunks: 0 });
  });

  it("an instance that states no basis sends none, and the chunks carry none", async () => {
    const doc = await seedDocument();
    const extractor = new FakeExtractor();
    extractor.text = { ...TEXT, basis: "unknown" };
    const indexer = new FakeIndexer();

    await run(await seedIndexJob(doc), { extractor: extractor.client, indexer, embedder: new CountingEmbedder() });

    expect(indexer.requests[0]!.basis).toBeNull();
    const [revision] = await revisionsOf(doc.id);
    expect((await chunksOf(revision!.id)).map((c) => c.basis)).toEqual([null, null, null]);
  });

  it("a rebuild replaces the document's earlier revision for the model", async () => {
    const doc = await seedDocument();
    const embedder = new CountingEmbedder();
    await run(await seedIndexJob(doc), { extractor: new FakeExtractor().client, indexer: new FakeIndexer(), embedder });
    const again = new FakeExtractor();
    again.text = { ...TEXT, blocks: [TEXT.blocks[0]!] };
    const second = await ctx.db.insert(schema.job).values({
      id: crypto.randomUUID(), workspaceId: doc.workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT,
      subjectId: doc.id, idempotencyKey: `document.index:${doc.id}:rebuild`, state: "queued",
    }).returning();

    await run(second[0]!.id, { extractor: again.client, indexer: new FakeIndexer(), embedder });

    const revisions = await revisionsOf(doc.id);
    expect(revisions).toHaveLength(1);
    expect((await chunksOf(revisions[0]!.id)).map((c) => c.element)).toEqual([NOTES, NOTES]);
  });

  it("fails EXTRACTOR_NOT_CONFIGURED, not retried, with no extractor", async () => {
    const doc = await seedDocument();
    const job = await run(await seedIndexJob(doc), { extractor: null, indexer: new FakeIndexer(), embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "EXTRACTOR_NOT_CONFIGURED" });
    expect(await revisionsOf(doc.id)).toEqual([]);
  });

  it("fails INDEXER_NOT_CONFIGURED, not retried, with no indexer or no embedder", async () => {
    const doc = await seedDocument();
    const extractor = new FakeExtractor();
    expect(await run(await seedIndexJob(doc), { extractor: extractor.client, indexer: null, embedder: new CountingEmbedder() }))
      .toMatchObject({ state: "failed", lastErrorCode: "INDEXER_NOT_CONFIGURED" });
    const other = await seedDocument();
    expect(await run(await seedIndexJob(other), { extractor: extractor.client, indexer: new FakeIndexer(), embedder: null }))
      .toMatchObject({ state: "failed", lastErrorCode: "INDEXER_NOT_CONFIGURED" });
    expect(extractor.calls).toEqual([]);
  });

  it("fails INDEXER_MODEL_MISMATCH, not retried, when the indexer says its tokenizer is for another model, or answers with one", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer();
    indexer.failWith = new JobFailure("INDEXER_MODEL_MISMATCH", "tokenizer", false);
    const refused = await run(await seedIndexJob(doc), { extractor: new FakeExtractor().client, indexer, embedder: new CountingEmbedder() });
    expect(refused).toMatchObject({ state: "failed", lastErrorCode: "INDEXER_MODEL_MISMATCH" });

    const other = await seedDocument();
    const wrong = new FakeIndexer();
    wrong.versionsValue = { ...VERSIONS, tokenizer: "other/model" };
    const answered = await run(await seedIndexJob(other), { extractor: new FakeExtractor().client, indexer: wrong, embedder: new CountingEmbedder() });
    expect(answered).toMatchObject({ state: "failed", lastErrorCode: "INDEXER_MODEL_MISMATCH" });
    expect(await revisionsOf(other.id)).toEqual([]);
  });

  it("fails OBJECT_MISSING when the stored instance is gone, and keeps the extractor's own failure code", async () => {
    const gone = await seedDocument({ put: false });
    const extractor = new FakeExtractor();
    expect(await run(await seedIndexJob(gone), { extractor: extractor.client, indexer: new FakeIndexer(), embedder: new CountingEmbedder() }))
      .toMatchObject({ state: "failed", lastErrorCode: "OBJECT_MISSING" });
    expect(extractor.calls).toEqual([]);

    const doc = await seedDocument();
    extractor.text = new JobFailure("XBRL_UNREADABLE", "The instance could not be read.", false);
    expect(await run(await seedIndexJob(doc), { extractor: extractor.client, indexer: new FakeIndexer(), embedder: new CountingEmbedder() }))
      .toMatchObject({ state: "failed", lastErrorCode: "XBRL_UNREADABLE" });
  });

  it("puts no document text in the logs, in a failure's stored message or in the job result", async () => {
    const doc = await seedDocument();
    const logs = captureLogs();
    const indexer = new FakeIndexer();
    indexer.failWith = new JobFailure("INDEX_FAILED", `Docling stopped at ${AUDIT_SENTENCE}`, true);
    const failed = await run(await seedIndexJob(doc), { extractor: new FakeExtractor().client, indexer, embedder: new CountingEmbedder(), logger: logs.logger });
    expect(failed.lastErrorMessage ?? "").not.toContain("audit committee");
    const jobId = failed.id;
    const done = await run(jobId, { extractor: new FakeExtractor().client, indexer, embedder: new CountingEmbedder(), logger: logs.logger });
    expect(done.state).toBe("succeeded");
    for (const text of ["audit committee", "Cement", "plants ran", "Segment information"]) {
      expect(logs.output()).not.toContain(text);
      expect(JSON.stringify(done.result)).not.toContain(text);
    }
  });
});
