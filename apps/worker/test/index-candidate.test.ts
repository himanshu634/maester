import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DOCUMENT_INDEX_SUBJECT, JobTypes, type ChunkRequest, type IndexerEvent, type IndexerVersions, type RangeRead,
} from "@maester/contracts";
import { deleteModelRevisions, schema } from "@maester/db";
import { FakeEmbedder, indexPipelineVersion, type Embedder } from "@maester/document-index";
import { runIndexCandidate } from "../src/index-candidate.js";
import type { IndexerClient, IndexInput, IndexResult } from "../src/indexer.js";
import { handlers } from "../src/jobs/index.js";
import { DEFAULT_CONCURRENCY, startQueueRunner } from "../src/queue.js";
import type { WorkerDeps } from "../src/run.js";
import { createWorkerContext, seedWorkspace, workerTestEnv } from "./context.js";

const ARCTIC = "Snowflake/snowflake-arctic-embed-l-v2.0";
const QWEN = "Qwen/Qwen3-Embedding-0.6B";
const VERSIONS: IndexerVersions = {
  doclingVersion: "2.134.0", ocrEngine: "rapidocr-onnxruntime 3.9.2", readerOptions: "table=accurate;cell_matching=true;ocr=rapidocr",
  chunkerVersion: "1", tokenizer: QWEN,
};
const PAGES = 3;

/** Reads a three-page document, one chunk a page; `chunk` rebuilds the same from a cached read. */
class CandidateIndexer implements IndexerClient {
  indexCalls = 0;
  chunkCalls = 0;
  constructor(private readonly tokenizer = QWEN) {}

  async versions(): Promise<IndexerVersions> {
    return { ...VERSIONS, tokenizer: this.tokenizer };
  }

  async index(input: IndexInput, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    this.indexCalls += 1;
    const last = Math.min(input.lastPage, PAGES);
    const pages = Array.from({ length: last - input.firstPage + 1 }, (_, i) => ({
      pageNumber: input.firstPage + i, text: `Synthetic page ${input.firstPage + i}.`, itemsTextLayer: 1, itemsOcr: 0, noneReason: null,
    }));
    const read: RangeRead = {
      firstPage: input.firstPage, lastPage: last, pageCount: PAGES, ocrOn: true, versions: await this.versions(),
      document: {}, itemSources: {}, pages,
    };
    return this.emit(read, onEvent, read);
  }

  async chunk(request: ChunkRequest, _signal: AbortSignal, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult> {
    this.chunkCalls += 1;
    return this.emit(request.read, onEvent, null);
  }

  private async emit(read: RangeRead, onEvent: (e: IndexerEvent) => Promise<void>, resultRead: RangeRead | null): Promise<IndexResult> {
    const started = { type: "started" as const, versions: read.versions, pageCount: read.pageCount, firstPage: read.firstPage, lastPage: read.lastPage };
    await onEvent(started);
    const pages = read.pages.map((p) => ({ type: "page" as const, ...p, sectionPathAfter: [] }));
    const chunks = read.pages.map((p) => ({
      type: "chunk" as const, pageNumber: p.pageNumber, seq: 0, kind: "prose" as const, textSource: "text_layer" as const,
      sectionPath: [], basis: null, text: p.text, tokenCount: 4,
    }));
    return { started, pages, chunks, read: resultRead, ocrPages: 0 };
  }
}

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
let workspaceId: string;
let userId: string;
let dir: string;

beforeEach(async () => {
  ctx = await createWorkerContext();
  ({ workspaceId, userId } = await seedWorkspace(ctx.db));
  dir = mkdtempSync(path.join(tmpdir(), "index-candidate-"));
});
afterEach(async () => {
  await ctx.close();
});

const source = {
  DATABASE_URL: workerTestEnv().DATABASE_URL, WORKER_URL: "http://localhost:8788", NODE_ENV: "test", STORAGE_DRIVER: "disk",
  LOG_LEVEL: "silent", INDEXER_SECRET: "test-secret",
} as NodeJS.ProcessEnv;

/** A stored document with its PDF and a complete arctic revision, as the live worker leaves it. */
async function seedIndexedDoc(tag: string) {
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  const contentSha256 = tag.repeat(64);
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf", storageKey, state: "stored",
    sizeBytes: 10, contentSha256, intakeState: "read", createdByUserId: userId,
  });
  await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id: jobId, workspaceId, type: JobTypes.DOCUMENT_INDEX, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: id,
    idempotencyKey: `document.index:${id}:${indexPipelineVersion(ARCTIC)}`, state: "succeeded",
  });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.documentIndexRevision).values({
    id: revisionId, workspaceId, documentId: id, jobId, state: "complete", indexVersion: "1", doclingVersion: VERSIONS.doclingVersion,
    ocrEngine: VERSIONS.ocrEngine, readerOptions: VERSIONS.readerOptions, chunkerVersion: "1", embeddingModel: ARCTIC,
  });
  return { id, contentSha256, filing: `synthetic-co/ar-${tag}`, revisionId };
}

function writeRequest(docs: { filing: string; contentSha256: string }[]): string {
  const file = path.join(dir, "request.json");
  writeFileSync(file, JSON.stringify({
    version: 1,
    documents: docs.map((d) => ({ filing: d.filing, sha256: d.contentSha256 })),
    questions: [{ id: "q001", query: "Who audits the company?", scope: docs.map((d) => d.filing) }],
  }));
  return file;
}

function capture() {
  const lines = { log: [] as string[], error: [] as string[] };
  return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
}

function maker(opts: { embedder?: Embedder; indexer?: IndexerClient } = {}) {
  const runners: WorkerDeps[] = [];
  const envs: WorkerDeps["env"][] = [];
  const make = (env: WorkerDeps["env"]) => {
    envs.push(env);
    return {
      db: ctx.db, store: ctx.store, dispatcher: ctx.dispatcher,
      indexer: opts.indexer ?? new CandidateIndexer(), embedder: opts.embedder ?? new FakeEmbedder(QWEN),
      startRunner: ((deps, runnerOpts) => {
        runners.push(deps);
        return startQueueRunner(deps, runnerOpts);
      }) as typeof startQueueRunner,
    };
  };
  return { make, runners, envs };
}

const run = (argv: string[], make: ReturnType<typeof maker>["make"], out = capture().out) =>
  runIndexCandidate(argv, source, out, make, { pollMs: 50 });

const args = (request: string, model = QWEN) => ["--workspace", workspaceId, "--model", model, "--request", request];

const revisionsOf = (documentId: string) =>
  ctx.db.select().from(schema.documentIndexRevision).where(eq(schema.documentIndexRevision.documentId, documentId));

const evalJobs = () => ctx.db.select().from(schema.job).where(eq(schema.job.type, JobTypes.DOCUMENT_INDEX_EVAL));

async function qwenRevision(documentId: string) {
  const [rev] = await ctx.db
    .select()
    .from(schema.documentIndexRevision)
    .where(and(eq(schema.documentIndexRevision.documentId, documentId), eq(schema.documentIndexRevision.embeddingModel, QWEN)));
  return rev;
}

describe("index:candidate", () => {
  it("refuses the live model", async () => {
    const doc = await seedIndexedDoc("a");
    const { lines, out } = capture();
    const { make } = maker();
    expect(await run(args(writeRequest([doc]), ARCTIC), make, out)).toBe(1);
    expect(lines.error).toEqual(["--model is the live EMBEDDING_MODEL; the worker indexes it"]);
    expect(await evalJobs()).toEqual([]);
  });

  it("refuses a model that is not in the registry", async () => {
    const doc = await seedIndexedDoc("a");
    const { lines, out } = capture();
    expect(await run(args(writeRequest([doc]), "someone/unknown-model"), maker().make, out)).toBe(1);
    expect(lines.error).toHaveLength(1);
    expect(await evalJobs()).toEqual([]);
  });

  it("refuses an embedder that serves another model", async () => {
    const doc = await seedIndexedDoc("a");
    const { lines, out } = capture();
    const { make } = maker({ embedder: new FakeEmbedder(QWEN, { serves: "/models/embed/voyageai/voyage-4-nano" }) });
    expect(await run(args(writeRequest([doc])), make, out)).toBe(1);
    expect(lines.error).toEqual([`--embedder-url serves /models/embed/voyageai/voyage-4-nano, not ${QWEN}`]);
    expect(await evalJobs()).toEqual([]);
  });

  it("refuses an indexer that loaded another tokenizer", async () => {
    const doc = await seedIndexedDoc("a");
    const { lines, out } = capture();
    expect(await run(args(writeRequest([doc])), maker({ indexer: new CandidateIndexer(ARCTIC) }).make, out)).toBe(1);
    expect(lines.error).toEqual([`--indexer-url loaded the tokenizer of ${ARCTIC}, not ${QWEN}`]);
    expect(await evalJobs()).toEqual([]);
  });

  it("refuses a request whose document is not stored in the workspace", async () => {
    const doc = await seedIndexedDoc("a");
    const { lines, out } = capture();
    const missing = { filing: "synthetic-co/ar-missing", contentSha256: "f".repeat(64) };
    expect(await run(args(writeRequest([doc, missing])), maker().make, out)).toBe(1);
    expect(lines.error).toEqual(["not stored in the workspace: synthetic-co/ar-missing"]);
    expect(await evalJobs()).toEqual([]);
  });

  it("builds the candidate's revisions and leaves the live ones", async () => {
    const a = await seedIndexedDoc("a");
    const b = await seedIndexedDoc("b");
    const { lines, out } = capture();
    const { make, envs } = maker();
    expect(await run(args(writeRequest([a, b])), make, out)).toBe(0);
    expect(lines.log).toEqual(["indexed 2, failed 0"]);
    expect(envs[0]).toMatchObject({ EMBEDDING_MODEL: QWEN, INDEXER_URL: "http://indexer-candidate:8791", EMBEDDER_URL: "http://embedder-candidate" });

    for (const doc of [a, b]) {
      const revisions = await revisionsOf(doc.id);
      expect(revisions.find((r) => r.embeddingModel === ARCTIC)).toMatchObject({ id: doc.revisionId, state: "complete" });
      const qwen = await qwenRevision(doc.id);
      expect(qwen).toMatchObject({ state: "complete", embeddingModel: QWEN, indexVersion: "1", pagesRead: PAGES });
      const { rows } = await ctx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from chunk_embedding e join document_chunk c on c.id = e.chunk_id where c.revision_id = ${qwen!.id} and e.model = ${QWEN}`,
      );
      expect(rows[0]!.n).toBe(PAGES);
    }
    expect((await evalJobs()).map((j) => j.idempotencyKey).sort()).toEqual(
      [a, b].map((d) => `document.index.eval:${d.id}:1:${QWEN}`).sort(),
    );
    expect((await evalJobs()).every((j) => j.state === "succeeded" && j.subjectType === DOCUMENT_INDEX_SUBJECT)).toBe(true);
  });

  it("takes the URLs it is given", async () => {
    const a = await seedIndexedDoc("a");
    const { make, envs } = maker();
    const argv = [...args(writeRequest([a])), "--embedder-url", "http://localhost:9001", "--indexer-url", "http://localhost:9002"];
    expect(await run(argv, make)).toBe(0);
    expect(envs[0]).toMatchObject({ EMBEDDER_URL: "http://localhost:9001", INDEXER_URL: "http://localhost:9002" });
  });

  it("queues a failed eval job again", async () => {
    const a = await seedIndexedDoc("a");
    const b = await seedIndexedDoc("b");
    const failedId = crypto.randomUUID();
    await ctx.db.insert(schema.job).values({
      id: failedId, workspaceId, type: JobTypes.DOCUMENT_INDEX_EVAL, subjectType: DOCUMENT_INDEX_SUBJECT, subjectId: a.id,
      idempotencyKey: `document.index.eval:${a.id}:${indexPipelineVersion(QWEN)}`, state: "failed", attempt: 5, maxAttempts: 5,
      lastErrorCode: "EMBEDDING_FAILED", finishedAt: new Date(),
    });
    const { lines, out } = capture();
    expect(await run(args(writeRequest([a, b])), maker().make, out)).toBe(0);
    expect(lines.log).toEqual(["indexed 2, failed 0"]);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, failedId));
    expect(job!.state).toBe("succeeded");
    expect(await qwenRevision(a.id)).toMatchObject({ state: "complete", jobId: failedId });
  });

  it("after a prune, a rerun rebuilds", async () => {
    const a = await seedIndexedDoc("a");
    const b = await seedIndexedDoc("b");
    const request = writeRequest([a, b]);
    const first = capture();
    expect(await run(args(request), maker().make, first.out)).toBe(0);
    expect(first.lines.log).toEqual(["indexed 2, failed 0"]);

    expect(await deleteModelRevisions(ctx.db, { model: QWEN })).toMatchObject({ revisions: 2 });
    expect(await qwenRevision(a.id)).toBeUndefined();

    const second = capture();
    const indexer = new CandidateIndexer();
    expect(await run(args(request), maker({ indexer }).make, second.out)).toBe(0);
    expect(second.lines.log).toEqual(["indexed 2, failed 0"]);
    for (const doc of [a, b]) expect(await qwenRevision(doc.id)).toMatchObject({ state: "complete" });
    // The page reads were kept, so the rebuild chunks them again and reads nothing.
    expect(indexer.indexCalls).toBe(0);
    expect(indexer.chunkCalls).toBe(2);
    expect(await evalJobs()).toHaveLength(2);
  });

  it("names the failures and exits 1", async () => {
    const a = await seedIndexedDoc("a");
    const b = await seedIndexedDoc("b");
    await ctx.db.update(schema.document).set({ storageKey: `workspaces/${workspaceId}/documents/${b.id}/gone.pdf` }).where(eq(schema.document.id, b.id));
    const { lines, out } = capture();
    expect(await run(args(writeRequest([a, b])), maker().make, out)).toBe(1);
    expect(lines.log).toEqual(["indexed 1, failed 1 (OBJECT_MISSING: 1)"]);
  });

  it("builds no extractor and runs no other type", async () => {
    const a = await seedIndexedDoc("a");
    const { make, runners } = maker();
    expect(await run(args(writeRequest([a])), make)).toBe(0);
    expect(runners).toHaveLength(1);
    expect(runners[0]!.extractor).toBeNull();
    expect(Object.keys(runners[0]!.handlers)).toEqual(["document.index.eval"]);
    expect(runners[0]!.env.EMBEDDING_MODEL).toBe(QWEN);
  });

  it("the live worker never claims an eval job", () => {
    expect(Object.keys(handlers)).not.toContain("document.index.eval");
    expect(Object.keys(DEFAULT_CONCURRENCY)).not.toContain("document.index.eval");
  });
});
