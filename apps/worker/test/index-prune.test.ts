import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chunksWithoutEmbedding, completeRevision, insertEmbeddings, putPageRead, schema, startOrResumeRevision, writeRange, type IndexVersions,
} from "@maester/db";
import { runIndexPrune } from "../src/index-prune.js";
import { createWorkerContext, seedJob, seedWorkspace, workerTestEnv } from "./context.js";

const ARCTIC = "Snowflake/snowflake-arctic-embed-l-v2.0";
const QWEN = "Qwen/Qwen3-Embedding-0.6B";
const versions = (model: string): IndexVersions => ({
  doclingVersion: "2.134.0", ocrEngine: "rapidocr-onnxruntime 3.9.2", readerOptions: "opts", chunkerVersion: "1", tokenizer: model,
  indexVersion: "1", embeddingModel: model,
});
const unit = (i: number): number[] => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeEach(async () => {
  ctx = await createWorkerContext();
});
afterEach(async () => {
  await ctx.close();
});

const source = {
  DATABASE_URL: workerTestEnv().DATABASE_URL, WORKER_URL: "http://localhost:8788", NODE_ENV: "test", STORAGE_DRIVER: "disk", LOG_LEVEL: "silent",
} as NodeJS.ProcessEnv;

function capture() {
  const lines = { log: [] as string[], error: [] as string[] };
  return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
}

/** A complete revision of `model` with `chunks` embedded chunks. */
async function seedRevision(workspaceId: string, documentId: string, model: string, chunks: number) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: "document.index", subjectType: "document_index", subjectId: documentId });
  const rev = await startOrResumeRevision(ctx.db, workspaceId, { documentId, jobId, versions: versions(model) });
  await writeRange(
    ctx.db, workspaceId, rev.id, documentId,
    [{ pageNumber: 1, text: "p", itemsTextLayer: 1, itemsOcr: 0, noneReason: null, sectionPathAfter: [] }],
    Array.from({ length: chunks }, (_, seq) => ({
      pageNumber: 1, seq, sectionPath: [], kind: "prose" as const, textSource: "text_layer" as const, text: `c${seq}`, tokenCount: 1,
    })),
    { pageCount: 1, pagesRead: 1, pagesOcr: 0, warnings: [] },
  );
  const pending = await chunksWithoutEmbedding(ctx.db, workspaceId, rev.id, model, chunks);
  await insertEmbeddings(ctx.db, workspaceId, model, pending.map((c, i) => ({ chunkId: c.id, embedding: unit(i) })));
  return completeRevision(ctx.db, workspaceId, rev.id);
}

async function seed() {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const docs: string[] = [];
  for (let i = 0; i < 2; i++) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.document).values({
      id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
      storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState: "read", createdByUserId: userId,
    });
    await seedRevision(workspaceId, id, ARCTIC, 2);
    await seedRevision(workspaceId, id, QWEN, 3);
    docs.push(id);
  }
  await putPageRead(ctx.db, workspaceId, {
    contentSha256: "a".repeat(64), firstPage: 1, lastPage: 20, doclingVersion: "2.134.0", ocrEngine: "rapidocr-onnxruntime 3.9.2", readerOptions: "opts",
  }, { pages: [] });
  return { workspaceId, docs };
}

/** Revisions, pages, chunks and embeddings of each model, and the page reads. */
async function census() {
  const n = async (q: ReturnType<typeof sql>) => (await ctx.db.execute<{ n: number }>(q)).rows[0]!.n;
  const of = async (model: string) => ({
    revisions: await n(sql`select count(*)::int as n from document_index_revision where embedding_model = ${model}`),
    pages: await n(sql`select count(*)::int as n from document_page p join document_index_revision r on r.id = p.revision_id where r.embedding_model = ${model}`),
    chunks: await n(sql`select count(*)::int as n from document_chunk c join document_index_revision r on r.id = c.revision_id where r.embedding_model = ${model}`),
    embeddings: await n(sql`select count(*)::int as n from chunk_embedding where model = ${model}`),
  });
  return {
    arctic: await of(ARCTIC),
    qwen: await of(QWEN),
    arcticIds: (await ctx.db.execute<{ id: string }>(sql`select id from document_index_revision where embedding_model = ${ARCTIC} order by id`)).rows,
    pageReads: await n(sql`select count(*)::int as n from page_read`),
  };
}

describe("index:prune", () => {
  it("prunes one model and nothing else", async () => {
    await seed();
    const before = await census();
    expect(before.qwen).toEqual({ revisions: 2, pages: 2, chunks: 6, embeddings: 6 });
    const { lines, out } = capture();
    expect(await runIndexPrune(["--model", QWEN], source, out, () => ({ db: ctx.db }))).toBe(0);
    expect(lines.log).toEqual(["revisions 2, chunks 6"]);
    const after = await census();
    expect(after.qwen).toEqual({ revisions: 0, pages: 0, chunks: 0, embeddings: 0 });
    expect(after.arctic).toEqual(before.arctic);
    expect(after.arcticIds).toEqual(before.arcticIds);
    expect(after.pageReads).toBe(before.pageReads);
  });

  it("prunes one workspace only when one is named", async () => {
    const a = await seed();
    await seed();
    const { lines, out } = capture();
    expect(await runIndexPrune(["--model", QWEN, "--workspace", a.workspaceId], source, out, () => ({ db: ctx.db }))).toBe(0);
    expect(lines.log).toEqual(["revisions 2, chunks 6"]);
    expect((await census()).qwen.revisions).toBe(2);
  });

  it("refuses the live model", async () => {
    await seed();
    const before = await census();
    const { lines, out } = capture();
    expect(await runIndexPrune(["--model", ARCTIC], source, out, () => ({ db: ctx.db }))).toBe(1);
    expect(lines.error).toEqual(["--model is the live EMBEDDING_MODEL; pruning it would empty search"]);
    expect(await census()).toEqual(before);
  });

  it("a dry run deletes nothing", async () => {
    await seed();
    const before = await census();
    const { lines, out } = capture();
    expect(await runIndexPrune(["--model", QWEN, "--dry-run"], source, out, () => ({ db: ctx.db }))).toBe(0);
    expect(lines.log).toEqual(["dry run: revisions 2, chunks 6"]);
    expect(await census()).toEqual(before);
  });

  it("exits 1 with no model", async () => {
    const { lines, out } = capture();
    expect(await runIndexPrune([], source, out, () => { throw new Error("must not connect"); })).toBe(1);
    expect(lines.error).toHaveLength(1);
  });
});
