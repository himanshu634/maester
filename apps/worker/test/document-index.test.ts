import { Writable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_INDEX_SUBJECT, JobTypes, type ChunkRequest, type IndexerEvent, type IndexerVersions, type RangePage, type RangeRead,
} from "@maester/contracts";
import { schema, type JobRow } from "@maester/db";
import type * as DbModule from "@maester/db";

/** Make the next writes to the index fail as Postgres would: page text, a cached read or a vector it refuses. */
const poison = vi.hoisted(() => ({ writeRange: 0, writeRangeCode: null as string | null, putPageRead: 0, insertEmbeddings: 0 }));
vi.mock("@maester/db", async (importOriginal) => {
  const db = await importOriginal<typeof DbModule>();
  return {
    ...db,
    writeRange: async (...args: Parameters<typeof db.writeRange>) => {
      if (poison.writeRangeCode) {
        const code = poison.writeRangeCode;
        poison.writeRangeCode = null;
        throw new Error(code);
      }
      if (poison.writeRange > 0) {
        poison.writeRange -= 1;
        // A NUL past the worker's cleaning: Postgres refuses it in text (22021), and drizzle's message lists the params.
        args[4] = args[4].map((page, i) => (i === 0 ? { ...page, text: `${page.text}\u0000` } : page));
      }
      return db.writeRange(...args);
    },
    putPageRead: async (...args: Parameters<typeof db.putPageRead>) => {
      if (poison.putPageRead > 0) {
        poison.putPageRead -= 1;
        const read = args[3] as { pages: { text: string }[] };
        args[3] = { ...read, pages: read.pages.map((page, i) => (i === 0 ? { ...page, text: `${page.text}\u0000` } : page)) };
      }
      return db.putPageRead(...args);
    },
    insertEmbeddings: async (...args: Parameters<typeof db.insertEmbeddings>) => {
      if (poison.insertEmbeddings > 0) {
        poison.insertEmbeddings -= 1;
        args[3] = args[3].map((row) => ({ ...row, embedding: row.embedding.slice(1) }));
      }
      return db.insertEmbeddings(...args);
    },
  };
});
import { EmbedderError, FakeEmbedder, indexPipelineVersion, type Embedder } from "@maester/document-index";
import type { IndexerClient, IndexInput, IndexResult } from "../src/indexer.js";
import { documentIndex } from "../src/jobs/document-index.js";
import { JobFailure } from "../src/jobs/types.js";
import { runJob, type WorkerDeps } from "../src/run.js";
import { createWorkerContext, seedWorkspace } from "./context.js";

const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";
const VERSIONS: IndexerVersions = {
  doclingVersion: "2.134.0",
  ocrEngine: "rapidocr-onnxruntime 3.9.2",
  readerOptions: "table=accurate;cell_matching=true;ocr=rapidocr",
  chunkerVersion: "1",
  tokenizer: MODEL,
};

/** The sentence a page holds; the logs test looks for it. */
const sentence = (page: number, n: number) =>
  `The synthetic mill ran at full capacity, line ${n} of page ${page}.${n === 2 ? " Dispatches rose in the quarter." : ""}`;

type FakeDoc = {
  pageCount: number;
  headings?: Record<number, string>;
  scanned?: boolean;
  /** Pages read with no text, and why. */
  empty?: Record<number, RangePage["noneReason"]>;
  /** A page whose text and heading carry U+0000, as a broken ToUnicode map gives. */
  nulOn?: number;
  /** A page the fake leaves out of its answer. */
  skip?: number;
};
type Failure = { code: string; retryable: boolean; message: string; times: number };

/**
 * Reads a seeded "document" one range at a time. The section path of a range comes only from the
 * `sectionPathBefore` it is sent and the headings inside its own range, which travel in the read,
 * so `chunk` rebuilds pages and chunks from the cached read alone.
 */
class FakeIndexer implements IndexerClient {
  indexCalls: { first: number; last: number; ocrPagesLeft: number; sectionPathBefore: string[] }[] = [];
  chunkCalls: { first: number; last: number; sectionPathBefore: string[] }[] = [];
  versionsValue: IndexerVersions = VERSIONS;
  /** The versions the `started` event reports, when they differ from `versions()`. */
  startedVersions: IndexerVersions | null = null;
  private failures = new Map<number, Failure>();

  constructor(private readonly doc: FakeDoc) {}

  /** The next `times` calls for the range starting at `first` end with an indexer `error` event. */
  failOn(first: number, times = 1, err: Partial<Omit<Failure, "times">> = {}): void {
    this.failures.set(first, { code: "INDEX_FAILED", retryable: true, message: "Docling stopped.", ...err, times });
  }

  resetCalls(): void {
    this.indexCalls = [];
    this.chunkCalls = [];
  }

  versionsCalls = 0;

  async versions(): Promise<IndexerVersions> {
    this.versionsCalls += 1;
    return this.versionsValue;
  }

  async index(input: IndexInput, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    this.indexCalls.push({ first: input.firstPage, last: input.lastPage, ocrPagesLeft: input.ocrPagesLeft, sectionPathBefore: input.sectionPathBefore });
    await this.maybeFail(input.firstPage, onEvent);
    const last = Math.min(input.lastPage, this.doc.pageCount);
    const ocrOn = input.ocrPagesLeft > 0;
    const pages: RangePage[] = [];
    const headings: Record<string, string> = {};
    for (let p = input.firstPage; p <= last; p++) {
      if (p === this.doc.skip) continue;
      const nul = p === this.doc.nulOn ? "\u0000" : "";
      const text = `${sentence(p, 1)}${nul}\n${sentence(p, 2)}`;
      if (this.doc.headings?.[p]) headings[String(p)] = this.doc.headings[p]! + nul;
      if (this.doc.empty?.[p]) pages.push({ pageNumber: p, text: "", itemsTextLayer: 0, itemsOcr: 0, noneReason: this.doc.empty[p]! });
      else if (!this.doc.scanned) pages.push({ pageNumber: p, text, itemsTextLayer: 2, itemsOcr: 0, noneReason: null });
      else if (ocrOn) pages.push({ pageNumber: p, text, itemsTextLayer: 0, itemsOcr: 2, noneReason: null });
      else pages.push({ pageNumber: p, text: "", itemsTextLayer: 0, itemsOcr: 0, noneReason: "OCR_BUDGET" });
    }
    const read: RangeRead = {
      firstPage: input.firstPage, lastPage: last, pageCount: this.doc.pageCount, ocrOn, versions: this.versionsValue,
      document: { headings }, itemSources: {}, pages,
    };
    return this.emit(read, input.sectionPathBefore, onEvent, read);
  }

  async chunk(request: ChunkRequest, _signal: AbortSignal, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    this.chunkCalls.push({ first: request.read.firstPage, last: request.read.lastPage, sectionPathBefore: request.sectionPathBefore });
    await this.maybeFail(request.read.firstPage, onEvent);
    return this.emit(request.read, request.sectionPathBefore, onEvent, null);
  }

  private async maybeFail(first: number, onEvent: (e: IndexerEvent) => Promise<void>): Promise<void> {
    const f = this.failures.get(first);
    if (!f || f.times <= 0) return;
    f.times -= 1;
    await onEvent({ type: "error", code: f.code, retryable: f.retryable, message: f.message });
    // HttpIndexerClient turns an error event into a JobFailure carrying the indexer's own message.
    throw new JobFailure(f.code, f.message, f.retryable);
  }

  private async emit(read: RangeRead, before: string[], onEvent: (e: IndexerEvent) => Promise<void>, resultRead: RangeRead | null): Promise<IndexResult> {
    const started = {
      type: "started" as const, versions: this.startedVersions ?? this.versionsValue,
      pageCount: read.pageCount, firstPage: read.firstPage, lastPage: read.lastPage,
    };
    await onEvent(started);
    await onEvent({ type: "heartbeat" });
    const headings = read.document.headings as Record<string, string>;
    let path = before;
    const pages: IndexResult["pages"] = [];
    const chunks: IndexResult["chunks"] = [];
    for (const page of read.pages) {
      const heading = headings[String(page.pageNumber)];
      if (heading) path = [heading];
      pages.push({ type: "page", ...page, sectionPathAfter: path });
      page.text.split("\n").filter(Boolean).forEach((text, seq) => {
        chunks.push({
          type: "chunk", pageNumber: page.pageNumber, seq, kind: "prose", textSource: page.itemsOcr > 0 ? "ocr" : "text_layer",
          sectionPath: path, basis: null, text, tokenCount: 12,
        });
      });
    }
    for (const e of [...pages, ...chunks]) await onEvent(e);
    return { started, pages, chunks, read: resultRead, ocrPages: resultRead ? read.pages.filter((p) => p.itemsOcr > 0).length : 0 };
  }
}

/** A FakeEmbedder that counts its calls and can be told which call fails. */
class CountingEmbedder implements Embedder {
  readonly model = MODEL;
  readonly inner = new FakeEmbedder(MODEL);
  calls: string[][] = [];
  failCall: number | null = null;
  /** Runs at each call, with the call's number from 1. */
  onCall: ((n: number) => void) | null = null;

  servedModel(): Promise<string> {
    return this.inner.servedModel();
  }

  async embed(texts: string[], kind: "query" | "document"): Promise<number[][]> {
    this.calls.push(texts);
    this.onCall?.(this.calls.length);
    if (this.calls.length === this.failCall) this.inner.fail(1);
    return this.inner.embed(texts, kind);
  }

  texts(): number {
    return this.calls.reduce((n, c) => n + c.length, 0);
  }
}

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;

beforeAll(async () => {
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_INDEX]: documentIndex });
});
afterAll(async () => {
  await ctx.close();
});

async function seedDocument(opts: { intakeState?: "duplicate" | "identifying"; put?: boolean } = {}) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf", storageKey, state: "stored",
    sizeBytes: 10, contentSha256: crypto.randomUUID().replaceAll("-", ""), intakeState: opts.intakeState ?? "identifying", createdByUserId: userId,
  });
  if (opts.put !== false) await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  return { workspaceId, id };
}

async function seedIndexJob(doc: { workspaceId: string; id: string }, key = indexPipelineVersion(MODEL)) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id, workspaceId: doc.workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: doc.id,
    idempotencyKey: `document.index:${doc.id}:${key}`, state: "queued",
  });
  return id;
}

type Run = { indexer?: IndexerClient | null; embedder?: Embedder | null; env?: Partial<WorkerDeps["env"]>; logger?: WorkerDeps["logger"] };

async function run(jobId: string, opts: Run): Promise<JobRow> {
  const deps: WorkerDeps = {
    ...ctx,
    indexer: opts.indexer === undefined ? null : opts.indexer,
    embedder: opts.embedder === undefined ? null : opts.embedder,
    env: { ...ctx.env, ...opts.env },
    logger: opts.logger ?? ctx.logger,
  };
  await runJob(deps, JobTypes.DOCUMENT_INDEX, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  return job!;
}

const revisionsOf = (documentId: string) =>
  ctx.db.select().from(schema.documentIndexRevision).where(eq(schema.documentIndexRevision.documentId, documentId));

const currentOf = async (documentId: string) =>
  (await revisionsOf(documentId)).filter((r) => r.state === "complete" || r.state === "partial");

const pagesOf = (revisionId: string) =>
  ctx.db.select().from(schema.documentPage).where(eq(schema.documentPage.revisionId, revisionId)).orderBy(schema.documentPage.pageNumber);

const chunksOf = (revisionId: string) =>
  ctx.db.select().from(schema.documentChunk).where(eq(schema.documentChunk.revisionId, revisionId));

async function embeddedCount(revisionId: string): Promise<number> {
  const { rows } = await ctx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from chunk_embedding e join document_chunk c on c.id = e.chunk_id where c.revision_id = ${revisionId} and e.model = ${MODEL}`,
  );
  return rows[0]!.n;
}

async function pageReadsOf(workspaceId: string) {
  return ctx.db.select().from(schema.pageRead).where(eq(schema.pageRead.workspaceId, workspaceId)).orderBy(schema.pageRead.firstPage);
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

const ranges = (calls: { first: number; last: number }[]) => calls.map((c) => [c.first, c.last]);

describe("document.index", () => {
  it("indexes a 45-page document in three ranges and completes the revision", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45 });
    const embedder = new CountingEmbedder();

    const job = await run(jobId, { indexer, embedder });

    expect(job.state).toBe("succeeded");
    expect(ranges(indexer.indexCalls)).toEqual([[1, 20], [21, 40], [41, 45]]);
    expect(indexer.chunkCalls).toEqual([]);
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "complete", pageCount: 45, pagesRead: 45, pagesOcr: 0, warnings: [], jobId });
    expect((await pagesOf(revision!.id)).map((p) => p.pageNumber)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    const chunks = await chunksOf(revision!.id);
    expect(chunks).toHaveLength(90);
    expect(await embeddedCount(revision!.id)).toBe(90);
    expect(embedder.calls.every((c) => c.length <= ctx.env.EMBED_BATCH)).toBe(true);
    expect(job.result).toEqual({ outcome: "indexed", revisionId: revision!.id, state: "complete", pages: 45, chunks: 90, ocrPages: 0 });
    expect(job.progress).toEqual({ stage: "indexed", percent: 100 });
    expect((await pageReadsOf(doc.workspaceId)).map((r) => [r.firstPage, r.lastPage])).toEqual([[1, 20], [21, 40], [41, 45]]);
  });

  it("a failure in the third range keeps the first two and the next attempt starts at page 41", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45 });
    indexer.failOn(41, 1);
    const embedder = new CountingEmbedder();

    const first = await run(jobId, { indexer, embedder });
    expect(first).toMatchObject({ state: "queued", lastErrorCode: "INDEX_FAILED" });
    const [building] = await revisionsOf(doc.id);
    expect(building).toMatchObject({ state: "building", pagesRead: 40 });
    expect(await pagesOf(building!.id)).toHaveLength(40);

    indexer.resetCalls();
    const second = await run(jobId, { indexer, embedder });
    expect(second.state).toBe("succeeded");
    expect(ranges(indexer.indexCalls)).toEqual([[41, 45]]);
    expect(indexer.chunkCalls).toEqual([]);
    const revisions = await revisionsOf(doc.id);
    expect(revisions.map((r) => r.id)).toEqual([building!.id]);
    expect(revisions[0]).toMatchObject({ state: "complete", pagesRead: 45 });
    const pages = await pagesOf(building!.id);
    expect(pages.map((p) => p.pageNumber)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(await chunksOf(building!.id)).toHaveLength(90);
    expect(await embeddedCount(building!.id)).toBe(90);
  });

  it("an embedder failure leaves the revision building, and the retry embeds only what is missing without reading again", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45 });
    const embedder = new CountingEmbedder();
    // 40 + 40 + 10 chunks in batches of 16: calls 1–3, 4–6 and 7. The last call fails, after every range is stored.
    embedder.failCall = 7;

    const first = await run(jobId, { indexer, embedder });
    expect(first).toMatchObject({ state: "queued", lastErrorCode: "EMBEDDING_FAILED" });
    const [revision] = await revisionsOf(doc.id);
    expect(revision!.state).toBe("building");
    expect(await pagesOf(revision!.id)).toHaveLength(45);
    expect(await embeddedCount(revision!.id)).toBe(80);

    indexer.resetCalls();
    embedder.calls = [];
    embedder.failCall = null;
    const second = await run(jobId, { indexer, embedder });
    expect(second.state).toBe("succeeded");
    expect(indexer.indexCalls).toEqual([]);
    expect(indexer.chunkCalls).toEqual([]);
    expect(embedder.texts()).toBe(10);
    expect(embedder.calls.flat().every((t) => /of page 4[1-5]\./.test(t))).toBe(true);
    expect((await revisionsOf(doc.id))[0]!.state).toBe("complete");
    expect(await embeddedCount(revision!.id)).toBe(90);
  });

  it("embeds the longest chunks of a batch first and embeds the section path with the text", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 3, headings: { 1: "Directors' report" } });
    const embedder = new CountingEmbedder();
    const job = await run(jobId, { indexer, embedder, env: { EMBED_BATCH: 2 } });
    expect(job.state).toBe("succeeded");
    const texts = embedder.calls.flat();
    expect(texts).toHaveLength(6);
    expect(texts.every((t) => t.startsWith("Directors' report\nThe synthetic mill"))).toBe(true);
    expect(embedder.calls.every((c) => c.length <= 2)).toBe(true);
    const lengths = texts.map((t) => t.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it("a rebuild reuses the page read cache: no page is read again", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 45 });
    const embedder = new CountingEmbedder();
    await run(await seedIndexJob(doc), { indexer, embedder });
    const [r1] = await revisionsOf(doc.id);

    indexer.resetCalls();
    const job2 = await run(await seedIndexJob(doc, `rebuild:${indexPipelineVersion(MODEL)}`), { indexer, embedder });

    expect(job2.state).toBe("succeeded");
    expect(indexer.indexCalls).toEqual([]);
    expect(ranges(indexer.chunkCalls)).toEqual([[1, 20], [21, 40], [41, 45]]);
    const revisions = await revisionsOf(doc.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.id).not.toBe(r1!.id);
    expect(revisions[0]).toMatchObject({ state: "complete", pagesRead: 45 });
    expect(await chunksOf(revisions[0]!.id)).toHaveLength(90);
    expect(await embeddedCount(revisions[0]!.id)).toBe(90);
    expect(await pageReadsOf(doc.workspaceId)).toHaveLength(3);
  });

  it("the section path carries across a range boundary and across a resume", async () => {
    const headings = { 1: "Directors' report", 19: "Notes to accounts" };
    const embedder = new CountingEmbedder();

    const straight = await seedDocument();
    const a = new FakeIndexer({ pageCount: 45, headings });
    await run(await seedIndexJob(straight), { indexer: a, embedder });
    expect(a.indexCalls[1]!.sectionPathBefore).toEqual(["Notes to accounts"]);

    const resumed = await seedDocument();
    const b = new FakeIndexer({ pageCount: 45, headings });
    b.failOn(21, 1);
    const jobId = await seedIndexJob(resumed);
    expect((await run(jobId, { indexer: b, embedder })).state).toBe("queued");
    b.resetCalls();
    expect((await run(jobId, { indexer: b, embedder })).state).toBe("succeeded");
    expect(b.indexCalls.map((c) => [c.first, c.sectionPathBefore])).toEqual([[21, ["Notes to accounts"]], [41, ["Notes to accounts"]]]);

    for (const doc of [straight, resumed]) {
      const [revision] = await revisionsOf(doc.id);
      const pages = await pagesOf(revision!.id);
      expect(pages.filter((p) => p.pageNumber >= 19 && p.pageNumber <= 25).map((p) => p.sectionPathAfter)).toEqual(
        Array.from({ length: 7 }, () => ["Notes to accounts"]),
      );
      expect(pages[17]!.sectionPathAfter).toEqual(["Directors' report"]);
      const page21 = (await chunksOf(revision!.id)).filter((c) => c.pageNumber === 21);
      expect(page21).toHaveLength(2);
      expect(page21.every((c) => c.sectionPath.join("|") === "Notes to accounts" && c.headingText === "Notes to accounts")).toBe(true);
    }
  });

  it("past OCR_PAGE_BUDGET the indexer is told no budget is left, and the revision is partial", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45, scanned: true });
    const job = await run(jobId, { indexer, embedder: new CountingEmbedder(), env: { OCR_PAGE_BUDGET: 30 } });

    expect(job.state).toBe("succeeded");
    expect(indexer.indexCalls.map((c) => c.ocrPagesLeft)).toEqual([30, 10, 0]);
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "partial", warnings: ["OCR_BUDGET"], pagesOcr: 40, pagesRead: 45 });
    const pages = await pagesOf(revision!.id);
    expect(pages.filter((p) => p.noneReason === "OCR_BUDGET").map((p) => p.pageNumber)).toEqual([41, 42, 43, 44, 45]);
    expect(pages.filter((p) => p.noneReason === null)).toHaveLength(40);
    expect(job.result).toMatchObject({ state: "partial", pages: 45, chunks: 80, ocrPages: 40 });
  });

  it("a page Docling could not read makes the revision partial; a blank page does not", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 25, empty: { 4: "NO_TEXT", 22: "PAGE_UNREADABLE" } });
    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });
    expect(job.state).toBe("succeeded");
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "partial", warnings: ["PAGE_UNREADABLE"], pagesRead: 25 });
    const pages = await pagesOf(revision!.id);
    expect(pages.filter((p) => p.noneReason !== null).map((p) => [p.pageNumber, p.noneReason])).toEqual([[4, "NO_TEXT"], [22, "PAGE_UNREADABLE"]]);
    expect(job.result).toMatchObject({ state: "partial", pages: 25, chunks: 46 });
    // The read of pages 21–25 holds the failed page, so it is not cached: a later build reads it again.
    expect((await pageReadsOf(doc.workspaceId)).map((r) => [r.firstPage, r.lastPage])).toEqual([[1, 20]]);

    const blank = await seedDocument();
    await run(await seedIndexJob(blank), { indexer: new FakeIndexer({ pageCount: 5, empty: { 2: "NO_TEXT" } }), embedder: new CountingEmbedder() });
    expect((await revisionsOf(blank.id))[0]).toMatchObject({ state: "complete", warnings: [] });
  });

  it("a range read with OCR off for the budget is not cached, so a rebuild reads it again with OCR", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 45, scanned: true });
    const embedder = new CountingEmbedder();
    await run(await seedIndexJob(doc), { indexer, embedder, env: { OCR_PAGE_BUDGET: 30 } });
    expect((await pageReadsOf(doc.workspaceId)).map((r) => [r.firstPage, r.lastPage])).toEqual([[1, 20], [21, 40]]);

    indexer.resetCalls();
    const job2 = await run(await seedIndexJob(doc, `rebuild:${indexPipelineVersion(MODEL)}`), { indexer, embedder, env: { OCR_PAGE_BUDGET: 400 } });

    expect(job2.state).toBe("succeeded");
    expect(ranges(indexer.chunkCalls)).toEqual([[1, 20], [21, 40]]);
    expect(indexer.indexCalls.map((c) => [c.first, c.last, c.ocrPagesLeft])).toEqual([[41, 45, 360]]);
    expect((await pageReadsOf(doc.workspaceId)).map((r) => [r.firstPage, r.lastPage])).toEqual([[1, 20], [21, 40], [41, 45]]);
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "complete", warnings: [], pagesOcr: 45 });
  });

  it("while a rebuild builds, the older complete revision is still the current one", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 45 });
    const embedder = new CountingEmbedder();
    await run(await seedIndexJob(doc), { indexer, embedder });
    const [r1] = await currentOf(doc.id);

    indexer.failOn(21, 1);
    const job2 = await seedIndexJob(doc, `rebuild:${indexPipelineVersion(MODEL)}`);
    expect((await run(job2, { indexer, embedder })).state).toBe("queued");
    expect((await currentOf(doc.id)).map((r) => r.id)).toEqual([r1!.id]);
    const building = (await revisionsOf(doc.id)).filter((r) => r.state === "building");
    expect(building).toHaveLength(1);
    expect(await pagesOf(building[0]!.id)).toHaveLength(20);

    expect((await run(job2, { indexer, embedder })).state).toBe("succeeded");
    const revisions = await revisionsOf(doc.id);
    expect(revisions.map((r) => [r.id, r.state])).toEqual([[building[0]!.id, "complete"]]);
  });

  it("a job whose revision is already complete returns its summary without calling the indexer", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 5 });
    const embedder = new CountingEmbedder();
    const done = await run(jobId, { indexer, embedder });
    // A crash after the revision completed but before the job was marked: the job runs again.
    await ctx.db.update(schema.job).set({ state: "queued", result: null }).where(eq(schema.job.id, jobId));
    indexer.resetCalls();
    embedder.calls = [];
    indexer.versionsValue = { ...VERSIONS, doclingVersion: "9.9.9" };

    const again = await run(jobId, { indexer, embedder });
    expect(again.state).toBe("succeeded");
    expect(again.result).toEqual(done.result);
    expect(indexer.indexCalls).toEqual([]);
    expect(embedder.calls).toEqual([]);
    expect((await revisionsOf(doc.id)).map((r) => r.state)).toEqual(["complete"]);
  });

  it("indexer versions that change mid-job fail INDEXER_VERSIONS_CHANGED, and the next attempt replaces the revision", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45 });
    const embedder = new CountingEmbedder();
    indexer.failOn(21, 1);
    expect((await run(jobId, { indexer, embedder })).state).toBe("queued");
    const [old] = await revisionsOf(doc.id);

    const changed = { ...VERSIONS, chunkerVersion: "2" };
    indexer.startedVersions = changed;
    const second = await run(jobId, { indexer, embedder });
    expect(second).toMatchObject({ state: "queued", lastErrorCode: "INDEXER_VERSIONS_CHANGED" });

    indexer.versionsValue = changed;
    indexer.startedVersions = null;
    indexer.resetCalls();
    expect((await run(jobId, { indexer, embedder })).state).toBe("succeeded");
    // Only the chunker changed, so the cached read of pages 1–20 is chunked again rather than read.
    expect(ranges(indexer.chunkCalls)).toEqual([[1, 20]]);
    expect(ranges(indexer.indexCalls)).toEqual([[21, 40], [41, 45]]);
    const revisions = await revisionsOf(doc.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.id).not.toBe(old!.id);
    expect(revisions[0]).toMatchObject({ state: "complete", chunkerVersion: "2" });
  });

  it("an indexer whose tokenizer is not EMBEDDING_MODEL's fails INDEXER_MODEL_MISMATCH and is not retried", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 5 });
    indexer.versionsValue = { ...VERSIONS, tokenizer: "some/other-model" };
    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INDEXER_MODEL_MISMATCH" });
    expect(indexer.indexCalls).toEqual([]);
    expect(await revisionsOf(doc.id)).toEqual([]);
  });

  it("a job for another model fails INDEX_MODEL_NOT_SERVED and is not retried", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 5 });
    const job = await run(await seedIndexJob(doc, indexPipelineVersion("Qwen/Qwen3-Embedding-0.6B")), { indexer, embedder: new CountingEmbedder() });
    expect(job.idempotencyKey).toBe(`document.index:${doc.id}:1:Qwen/Qwen3-Embedding-0.6B`);
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INDEX_MODEL_NOT_SERVED" });
    expect(await revisionsOf(doc.id)).toEqual([]);
    expect(indexer.indexCalls).toEqual([]);
    expect(indexer.chunkCalls).toEqual([]);
    expect(indexer.versionsCalls).toBe(0);
  });

  it("an embedder that serves another model fails INDEXER_MODEL_MISMATCH and stores nothing", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 5 });
    const embedder = new FakeEmbedder(MODEL, { serves: "/models/embed/Qwen/Qwen3-Embedding-0.6B" });
    const job = await run(await seedIndexJob(doc), { indexer, embedder });
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INDEXER_MODEL_MISMATCH" });
    expect(job.lastErrorMessage).toBe(`the embedder serves /models/embed/Qwen/Qwen3-Embedding-0.6B, not EMBEDDING_MODEL`);
    expect(await revisionsOf(doc.id)).toEqual([]);
    expect(indexer.indexCalls).toEqual([]);
    const { rows } = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from chunk_embedding where workspace_id = ${doc.workspaceId}`);
    expect(rows[0]!.n).toBe(0);
  });

  it("an embedder that cannot say which model it serves fails EMBEDDING_FAILED and is retried", async () => {
    const doc = await seedDocument();
    const embedder = new FakeEmbedder(MODEL);
    embedder.servedModel = async () => {
      throw new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not say which model it serves.");
    };
    const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 5 }), embedder });
    expect(job).toMatchObject({ state: "queued", attempt: 1, lastErrorCode: "EMBEDDING_FAILED" });
    expect(await revisionsOf(doc.id)).toEqual([]);
  });

  it("with no indexer configured the job fails INDEXER_NOT_CONFIGURED at once and is not retried", async () => {
    const doc = await seedDocument();
    const noIndexer = await run(await seedIndexJob(doc), { indexer: null, embedder: new CountingEmbedder() });
    expect(noIndexer).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INDEXER_NOT_CONFIGURED" });
    const noEmbedder = await run(await seedIndexJob(doc, "2:x"), { indexer: new FakeIndexer({ pageCount: 5 }), embedder: null });
    expect(noEmbedder).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INDEXER_NOT_CONFIGURED" });
    expect(await revisionsOf(doc.id)).toEqual([]);
  });

  it("a duplicate document is refused", async () => {
    const doc = await seedDocument({ intakeState: "duplicate" });
    const indexer = new FakeIndexer({ pageCount: 5 });
    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INVALID_STATE" });
    expect(indexer.indexCalls).toEqual([]);
    expect(await revisionsOf(doc.id)).toEqual([]);
  });

  it("a stored PDF that is gone fails OBJECT_MISSING and is not retried", async () => {
    const doc = await seedDocument({ put: false });
    const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 5 }), embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "OBJECT_MISSING" });
  });

  it("a page refused by Postgres fails with its SQLSTATE and no page text in the job or the logs, and the retry stores it", async () => {
    const { logger, output } = captureLogs();
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 25 });
    const embedder = new CountingEmbedder();
    poison.writeRange = 1;

    const first = await run(jobId, { indexer, embedder, logger });
    expect(first).toMatchObject({ state: "queued", lastErrorCode: "HANDLER_ERROR" });
    expect(first.lastErrorMessage).toBe("storing pages 1-20 failed (SQLSTATE 22021)");
    expect(output()).toContain("SQLSTATE 22021");
    expect(output()).not.toMatch(/synthetic mill/i);

    expect((await run(jobId, { indexer, embedder, logger })).state).toBe("succeeded");
    expect(output()).not.toMatch(/synthetic mill/i);
    const [revision] = await revisionsOf(doc.id);
    expect(await pagesOf(revision!.id)).toHaveLength(25);
  });

  it("a read Postgres refuses to cache fails with its SQLSTATE only", async () => {
    const doc = await seedDocument();
    poison.putPageRead = 1;
    const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 5 }), embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "queued", lastErrorCode: "HANDLER_ERROR", lastErrorMessage: "caching the read on pages 1-20 failed (SQLSTATE 22P05)" });
  });

  it("vectors Postgres refuses fail with the SQLSTATE only, never the vectors", async () => {
    const { logger, output } = captureLogs();
    const doc = await seedDocument();
    poison.insertEmbeddings = 1;
    const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 5 }), embedder: new CountingEmbedder(), logger });
    expect(job.lastErrorCode).toBe("HANDLER_ERROR");
    expect(job.lastErrorMessage).toMatch(/^storing embeddings failed \(SQLSTATE \w+\)$/);
    expect(output()).not.toMatch(/\[-?0\.\d+/);
  });

  it("a query's own code is kept when a write is refused", async () => {
    const doc = await seedDocument();
    poison.writeRangeCode = "REVISION_NOT_BUILDING";
    const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 5 }), embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "queued", lastErrorCode: "REVISION_NOT_BUILDING", lastErrorMessage: "REVISION_NOT_BUILDING storing pages 1-20" });
  });

  it("U+0000 is taken out of page text, chunk text, section paths and the cached read", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 5, headings: { 3: "Notes to accounts" }, nulOn: 3 });
    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });
    expect(job.state).toBe("succeeded");
    const [revision] = await revisionsOf(doc.id);
    const page3 = (await pagesOf(revision!.id))[2]!;
    expect(page3.text).toBe(`${sentence(3, 1)}\n${sentence(3, 2)}`);
    expect(page3.sectionPathAfter).toEqual(["Notes to accounts"]);
    const chunks = (await chunksOf(revision!.id)).filter((c) => c.pageNumber === 3);
    expect(chunks.map((c) => c.text).sort()).toEqual([sentence(3, 1), sentence(3, 2)].sort());
    expect(chunks.every((c) => c.sectionPath[0] === "Notes to accounts")).toBe(true);
    const [read] = await pageReadsOf(doc.workspaceId);
    expect(JSON.stringify(read!.read)).not.toContain("\\u0000");
    expect((read!.read as { document: { headings: Record<string, string> } }).document.headings["3"]).toBe("Notes to accounts");
  });

  it("the first range of a short document is cached under its real bounds, found again by a resume and by a rebuild", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 5 });
    const embedder = new CountingEmbedder();
    poison.writeRange = 1;
    expect((await run(jobId, { indexer, embedder })).state).toBe("queued");
    expect(ranges(indexer.indexCalls)).toEqual([[1, 20]]);
    expect((await pageReadsOf(doc.workspaceId)).map((r) => [r.firstPage, r.lastPage])).toEqual([[1, 5]]);

    // The resume: the revision has no page count yet, so it is taken from the cached read.
    indexer.resetCalls();
    expect((await run(jobId, { indexer, embedder })).state).toBe("succeeded");
    expect(indexer.indexCalls).toEqual([]);
    expect(ranges(indexer.chunkCalls)).toEqual([[1, 5]]);

    indexer.resetCalls();
    expect((await run(await seedIndexJob(doc, `rebuild:${indexPipelineVersion(MODEL)}`), { indexer, embedder })).state).toBe("succeeded");
    expect(indexer.indexCalls).toEqual([]);
    expect(ranges(indexer.chunkCalls)).toEqual([[1, 5]]);
    expect(await pageReadsOf(doc.workspaceId)).toHaveLength(1);
  });

  it("an answer that is not exactly the pages asked for fails INVALID_INDEXER_RESULT and is not retried", async () => {
    const doc = await seedDocument();
    const indexer = new FakeIndexer({ pageCount: 5, skip: 3 });
    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INVALID_INDEXER_RESULT" });
    const [revision] = await revisionsOf(doc.id);
    expect(await pagesOf(revision!.id)).toEqual([]);
    expect(await pageReadsOf(doc.workspaceId)).toEqual([]);
  });

  /** A cached read of the document under other reader versions: only its page count is ever used. */
  async function seedOtherRead(doc: { workspaceId: string; id: string }, pageCount: number, doclingVersion: string, createdAt: Date) {
    const [row] = await ctx.db.select({ sha: schema.document.contentSha256 }).from(schema.document).where(eq(schema.document.id, doc.id));
    await ctx.db.insert(schema.pageRead).values({
      id: crypto.randomUUID(), workspaceId: doc.workspaceId, contentSha256: row!.sha!, firstPage: 1, lastPage: Math.min(20, pageCount),
      doclingVersion, ocrEngine: VERSIONS.ocrEngine, readerOptions: VERSIONS.readerOptions, read: { pageCount }, createdAt,
    });
  }
  const currentReads = async (workspaceId: string) =>
    (await pageReadsOf(workspaceId)).filter((r) => r.doclingVersion === VERSIONS.doclingVersion).map((r) => [r.firstPage, r.lastPage]);

  it("a page count too low from the newest other cached read is corrected by the indexer, and the cut range is read again", async () => {
    const doc = await seedDocument();
    // The newest row wins, whatever order the rows went in.
    await seedOtherRead(doc, 15, "docling=old-2", new Date("2026-10-02T00:00:00Z"));
    await seedOtherRead(doc, 60, "docling=old-1", new Date("2026-10-01T00:00:00Z"));
    const indexer = new FakeIndexer({ pageCount: 45 });

    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });

    expect(job.state).toBe("succeeded");
    expect(ranges(indexer.indexCalls)).toEqual([[1, 15], [1, 20], [21, 40], [41, 45]]);
    const [revision] = await revisionsOf(doc.id);
    expect(revision).toMatchObject({ state: "complete", pageCount: 45, pagesRead: 45 });
    expect((await pagesOf(revision!.id)).map((p) => p.pageNumber)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(await chunksOf(revision!.id)).toHaveLength(90);
    // The read cut at page 15 is not cached.
    expect(await currentReads(doc.workspaceId)).toEqual([[1, 20], [21, 40], [41, 45]]);
  });

  it("a page count too high from another cached read is corrected without reading the range again", async () => {
    const doc = await seedDocument();
    await seedOtherRead(doc, 60, "docling=old", new Date("2026-10-01T00:00:00Z"));
    const indexer = new FakeIndexer({ pageCount: 45 });

    const job = await run(await seedIndexJob(doc), { indexer, embedder: new CountingEmbedder() });

    expect(job.state).toBe("succeeded");
    expect(ranges(indexer.indexCalls)).toEqual([[1, 20], [21, 40], [41, 45]]);
    expect((await revisionsOf(doc.id))[0]).toMatchObject({ state: "complete", pageCount: 45, pagesRead: 45 });
    expect(await currentReads(doc.workspaceId)).toEqual([[1, 20], [21, 40], [41, 45]]);
  });

  it("a page count that changes once pages are stored fails INVALID_INDEXER_RESULT and is not retried", async () => {
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45 });
    indexer.failOn(21, 1);
    expect((await run(jobId, { indexer, embedder: new CountingEmbedder() })).state).toBe("queued");
    const [building] = await revisionsOf(doc.id);
    expect(building).toMatchObject({ state: "building", pageCount: 45, pagesRead: 20 });

    const other = new FakeIndexer({ pageCount: 50 });
    const job = await run(jobId, { indexer: other, embedder: new CountingEmbedder() });

    expect(job).toMatchObject({ state: "failed", attempt: 2, lastErrorCode: "INVALID_INDEXER_RESULT" });
    expect(job.lastErrorMessage).toBe("the indexer counted 50 pages, not 45, on pages 21-40");
    expect(ranges(other.indexCalls)).toEqual([[21, 40]]);
    const [after] = await revisionsOf(doc.id);
    expect(after).toMatchObject({ id: building!.id, state: "building", pageCount: 45, pagesRead: 20 });
    expect(await pagesOf(after!.id)).toHaveLength(20);
    expect(await currentReads(doc.workspaceId)).toEqual([[1, 20]]);
  });

  it("the job's deadline covers embedding: past it, the next batch is not sent and the job fails INDEX_TIMEOUT", async () => {
    const doc = await seedDocument();
    const embedder = new CountingEmbedder();
    // The first embedder call takes the whole INDEX_TIMEOUT_SECONDS.
    embedder.onCall = (n) => {
      if (n === 1) vi.setSystemTime(Date.now() + (ctx.env.INDEX_TIMEOUT_SECONDS + 1) * 1000);
    };
    try {
      const job = await run(await seedIndexJob(doc), { indexer: new FakeIndexer({ pageCount: 3 }), embedder, env: { EMBED_BATCH: 2 } });
      expect(job).toMatchObject({ state: "queued", lastErrorCode: "INDEX_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
    expect(embedder.calls).toHaveLength(1);
    const [revision] = await revisionsOf(doc.id);
    expect(revision!.state).toBe("building");
    expect(await embeddedCount(revision!.id)).toBe(2);
  });

  it("no page or chunk text reaches the logs", async () => {
    const { logger, output: logged } = captureLogs();
    const doc = await seedDocument();
    const jobId = await seedIndexJob(doc);
    const indexer = new FakeIndexer({ pageCount: 45, headings: { 1: "Synthetic heading of the mill" } });
    // The indexer's own error message can quote the page; it must not be logged or stored.
    indexer.failOn(21, 1, { message: `could not chunk: ${sentence(21, 1)}` });
    const embedder = new CountingEmbedder();

    const first = await run(jobId, { indexer, embedder, logger });
    expect(first).toMatchObject({ state: "queued", lastErrorCode: "INDEX_FAILED" });
    expect(first.lastErrorMessage).not.toContain("synthetic mill");
    expect((await run(jobId, { indexer, embedder, logger })).state).toBe("succeeded");

    const output = logged();
    expect(output).toContain("index range stored");
    expect(output).toContain(doc.id);
    expect(output).not.toMatch(/synthetic mill/i);
    expect(output).not.toContain("Synthetic heading");
  });
});
