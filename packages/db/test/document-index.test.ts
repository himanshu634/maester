import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import {
  chunksWithoutEmbedding, completeRevision, documentsNeedingIndex, getPageRead, insertEmbeddings, lastStoredPage,
  putPageRead, startOrResumeRevision, writeRange, type ChunkInput, type IndexVersions, type PageInput,
} from "../src/queries/document-index.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

const MODEL = "test-model";
const PIPELINE = "1:test-model";
const versions: IndexVersions = {
  doclingVersion: "2.0.0", ocrEngine: "rapidocr", readerOptions: "opts-1", chunkerVersion: "chunker-1",
  tokenizer: MODEL, indexVersion: "1", embeddingModel: MODEL,
};

const unit = (i: number): number[] => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));
const toVector = (v: number[]) => `[${v.join(",")}]`;

async function seedWorkspace(tag: string) {
  const userId = `u-${tag}`;
  await insertUser(db, userId, `${tag}@example.com`);
  const ws = await ensurePersonalWorkspace(db, { userId, userName: tag });
  return { ws: ws.id, userId };
}

async function seedDocument(
  ws: string, userId: string, over: { state?: "stored" | "uploaded"; intakeState?: "duplicate" | "read" | null } = {},
) {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId: ws, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${id}/original.pdf`, state: over.state ?? "stored",
    intakeState: over.intakeState === undefined ? "read" : over.intakeState, createdByUserId: userId,
  });
  return id;
}

async function seedJob(ws: string, documentId: string, pipelineVersion = PIPELINE) {
  const id = crypto.randomUUID();
  await db.insert(schema.job).values({
    id, workspaceId: ws, type: "document.index", subjectType: "document_index", subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:${pipelineVersion}`, state: "queued",
  });
  return id;
}

const page = (n: number, path: string[] = []): PageInput => ({
  pageNumber: n, text: `page ${n}`, itemsTextLayer: 3, itemsOcr: 0, noneReason: null, sectionPathAfter: path,
});
const chunk = (n: number, seq: number, over: Partial<ChunkInput> = {}): ChunkInput => ({
  pageNumber: n, seq, sectionPath: ["Directors report"], kind: "prose", textSource: "text_layer",
  text: `chunk ${n}.${seq}`, tokenCount: 4, ...over,
});
const counts = { pageCount: 10, pagesRead: 2, pagesOcr: 0, warnings: [] as string[] };

async function newRevision(ws: string, documentId: string, v = versions) {
  const jobId = await seedJob(ws, documentId, `${PIPELINE}-${crypto.randomUUID()}`);
  return startOrResumeRevision(db, ws, { documentId, jobId, versions: v });
}

/** A revision with `n` embedded chunks, current for the document. */
async function seedIndexedChunks(ws: string, userId: string, n: number) {
  const documentId = await seedDocument(ws, userId);
  const rev = await newRevision(ws, documentId);
  await writeRange(db, ws, rev.id, documentId, [page(1)], Array.from({ length: n }, (_, i) => chunk(1, i)), counts);
  const rows = await chunksWithoutEmbedding(db, ws, rev.id, MODEL, n);
  await insertEmbeddings(db, ws, MODEL, rows.map((r, i) => ({ chunkId: r.id, embedding: unit(i) })));
  return { documentId, rev };
}

const count = async (table: string) =>
  Number((await db.execute(sql.raw(`select count(*)::int as n from "${table}"`))).rows[0]!.n);

describe("document index", () => {
  it("the bare nearest-neighbour query can use the HNSW index (Task 10 checks the real search query)", async () => {
    const { ws, userId } = await seedWorkspace("a");
    await seedIndexedChunks(ws, userId, 30);
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute(sql`explain select chunk_id from chunk_embedding order by embedding::halfvec(1024) <=> ${toVector(unit(1))}::halfvec(1024) limit 50`);
    });
    expect(JSON.stringify(plan.rows)).toContain("chunk_embedding_hnsw");
  });

  it("tsv uses the simple configuration, so a company name and a CIN are not stemmed", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    await writeRange(db, ws, rev.id, documentId, [page(1)], [
      chunk(1, 0, { sectionPath: ["Synthetic Cements"], text: "CIN L26942GJ1981PLC004717 is printed here" }),
      chunk(1, 1, { sectionPath: [], text: "Cements are produced in kilns" }),
    ], counts);
    const find = async (q: string) =>
      (await db.execute(sql`select text from document_chunk where tsv @@ websearch_to_tsquery('simple', ${q})`)).rows.map((r) => r.text);
    expect(await find("Synthetic Cements")).toEqual(["CIN L26942GJ1981PLC004717 is printed here"]);
    expect(await find("L26942GJ1981PLC004717")).toHaveLength(1);
    // "simple" does not stem: "cement" does not match "Cements".
    expect(await find("cement")).toHaveLength(0);
  });

  it("writeRange stores the heading text as the section path joined by a space", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    await writeRange(db, ws, rev.id, documentId, [page(1)], [chunk(1, 0, { sectionPath: ["Notes", "Note 4"] })], counts);
    const r = await db.execute(sql`select heading_text from document_chunk`);
    expect(r.rows[0]!.heading_text).toBe("Notes Note 4");
  });

  it("writeRange twice writes each page and chunk once", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    const run = () =>
      writeRange(db, ws, rev.id, documentId, [page(1), page(2, ["A"])], [chunk(1, 0), chunk(2, 0), chunk(2, 1)],
        { pageCount: 10, pagesRead: 2, pagesOcr: 1, warnings: ["OCR_BUDGET"] });
    await run();
    await run();
    expect(await count("document_page")).toBe(2);
    expect(await count("document_chunk")).toBe(3);
    const r = await db.execute(sql`select page_count, pages_read, pages_ocr, warnings from document_index_revision`);
    expect(r.rows[0]).toMatchObject({ page_count: 10, pages_read: 2, pages_ocr: 1, warnings: ["OCR_BUDGET"] });
  });

  it("writeRange merges warnings across ranges", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    await writeRange(db, ws, rev.id, documentId, [page(1)], [], { ...counts, warnings: ["OCR_FAILED"] });
    await writeRange(db, ws, rev.id, documentId, [page(2)], [], { ...counts, pagesRead: 4, warnings: ["OCR_BUDGET", "OCR_FAILED"] });
    const r = await db.execute(sql`select pages_read, warnings from document_index_revision`);
    expect(r.rows[0]).toMatchObject({ pages_read: 4, warnings: ["OCR_BUDGET", "OCR_FAILED"] });
  });

  it("lastStoredPage returns the highest page and its section path, or null", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    expect(await lastStoredPage(db, ws, rev.id)).toBeNull();
    await writeRange(db, ws, rev.id, documentId, [page(2, ["B"]), page(1, ["A"])], [], counts);
    expect(await lastStoredPage(db, ws, rev.id)).toEqual({ pageNumber: 2, sectionPathAfter: ["B"] });
  });

  it("chunksWithoutEmbedding lists by page and seq, and not the embedded ones", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    await writeRange(db, ws, rev.id, documentId, [page(1), page(2)], [chunk(2, 0), chunk(1, 1), chunk(1, 0)], counts);
    const all = await chunksWithoutEmbedding(db, ws, rev.id, MODEL, 10);
    expect(all.map((c) => c.text)).toEqual(["chunk 1.0", "chunk 1.1", "chunk 2.0"]);
    expect(all[0]!.sectionPath).toEqual(["Directors report"]);
    await insertEmbeddings(db, ws, MODEL, [{ chunkId: all[0]!.id, embedding: unit(0) }]);
    await insertEmbeddings(db, ws, MODEL, [{ chunkId: all[0]!.id, embedding: unit(1) }]); // on conflict do nothing
    expect(await count("chunk_embedding")).toBe(1);
    expect((await chunksWithoutEmbedding(db, ws, rev.id, MODEL, 1)).map((c) => c.text)).toEqual(["chunk 1.1"]);
    expect(await chunksWithoutEmbedding(db, ws, rev.id, "other-model", 10)).toHaveLength(3);
  });

  it("startOrResumeRevision resumes the job's revision and replaces it when the versions changed", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const jobId = await seedJob(ws, documentId);
    const first = await startOrResumeRevision(db, ws, { documentId, jobId, versions });
    expect(first.state).toBe("building");
    await writeRange(db, ws, first.id, documentId, [page(1)], [chunk(1, 0)], counts);
    const again = await startOrResumeRevision(db, ws, { documentId, jobId, versions });
    expect(again.id).toBe(first.id);
    expect(await count("document_chunk")).toBe(1);
    const changed = await startOrResumeRevision(db, ws, { documentId, jobId, versions: { ...versions, chunkerVersion: "chunker-2" } });
    expect(changed.id).not.toBe(first.id);
    expect(changed.chunkerVersion).toBe("chunker-2");
    expect(await count("document_index_revision")).toBe(1);
    expect(await count("document_chunk")).toBe(0);
    expect(await count("document_page")).toBe(0);
  });

  it("completeRevision swaps in one transaction and leaves one current revision per document and model", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const { documentId, rev: r1 } = await seedIndexedChunks(ws, userId, 2);
    const done1 = await completeRevision(db, ws, r1.id);
    expect(done1.state).toBe("complete");
    const r2 = await newRevision(ws, documentId);
    await writeRange(db, ws, r2.id, documentId, [page(1)], [chunk(1, 0)], counts);
    const other = await newRevision(ws, documentId, { ...versions, embeddingModel: "other-model" });
    const stateOf = async () =>
      Object.fromEntries((await db.execute(sql`select id, state from document_index_revision`)).rows.map((r) => [r.id, r.state]));
    expect(await stateOf()).toEqual({ [r1.id]: "complete", [r2.id]: "building", [other.id]: "building" });
    expect(await count("chunk_embedding")).toBe(2);
    const done2 = await completeRevision(db, ws, r2.id);
    expect(done2.state).toBe("complete");
    expect(done2.completedAt).not.toBeNull();
    const ids = (await db.execute(sql`select id from document_index_revision`)).rows.map((r) => r.id);
    expect(ids.sort()).toEqual([r2.id, other.id].sort());
    // R1's pages, chunks and embeddings went with it.
    expect(await count("document_chunk")).toBe(1);
    expect(await count("chunk_embedding")).toBe(0);
  });

  it("completeRevision marks the revision partial when a page hit the OCR budget", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    await writeRange(db, ws, rev.id, documentId, [page(1)], [], { ...counts, warnings: ["OCR_BUDGET"] });
    expect((await completeRevision(db, ws, rev.id)).state).toBe("partial");
    const rev2 = await newRevision(ws, documentId);
    await writeRange(db, ws, rev2.id, documentId, [page(1)], [], { ...counts, warnings: ["OCR_FAILED"] });
    expect((await completeRevision(db, ws, rev2.id)).state).toBe("partial");
    const rev3 = await newRevision(ws, documentId);
    await writeRange(db, ws, rev3.id, documentId, [page(1)], [], { ...counts, warnings: ["PAGE_UNREADABLE"] });
    expect((await completeRevision(db, ws, rev3.id)).state).toBe("partial");
    const rev4 = await newRevision(ws, documentId);
    await writeRange(db, ws, rev4.id, documentId, [page(1)], [], { ...counts, warnings: ["SOMETHING_ELSE"] });
    expect((await completeRevision(db, ws, rev4.id)).state).toBe("complete");
  });

  it("a second complete revision for the same document and model is refused by document_index_current", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const r1 = await newRevision(ws, documentId);
    await completeRevision(db, ws, r1.id);
    const r2 = await newRevision(ws, documentId);
    await expect(
      db.update(schema.documentIndexRevision).set({ state: "complete" }).where(sql`id = ${r2.id}`),
    ).rejects.toThrow();
    // Another model is its own index.
    const r3 = await newRevision(ws, documentId, { ...versions, embeddingModel: "other-model" });
    await expect(completeRevision(db, ws, r3.id)).resolves.toMatchObject({ state: "complete" });
  });

  it("page_read caches a range read once per key", async () => {
    const { ws } = await seedWorkspace("a");
    const key = { contentSha256: "abc", firstPage: 1, lastPage: 20, doclingVersion: "2.0.0", ocrEngine: "rapidocr", readerOptions: "o" };
    expect(await getPageRead(db, ws, key)).toBeNull();
    await putPageRead(db, ws, key, { firstPage: 1, pages: [] });
    await putPageRead(db, ws, key, { firstPage: 99 });
    expect(await getPageRead(db, ws, key)).toEqual({ firstPage: 1, pages: [] });
    expect(await getPageRead(db, ws, { ...key, lastPage: 40 })).toBeNull();
    expect(await getPageRead(db, ws, { ...key, ocrEngine: "other" })).toBeNull();
  });

  it("documentsNeedingIndex skips duplicates, unstored documents and documents with a current revision, and reports the existing job", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const needs = await seedDocument(ws, userId);
    const withJob = await seedDocument(ws, userId);
    const jobId = await seedJob(ws, withJob);
    await seedJob(ws, withJob, "1:other-model"); // a job of another pipeline version is not reported
    await seedDocument(ws, userId, { intakeState: "duplicate" });
    await seedDocument(ws, userId, { state: "uploaded", intakeState: null });
    const indexed = await seedDocument(ws, userId);
    await completeRevision(db, ws, (await newRevision(ws, indexed)).id);
    const partialDoc = await seedDocument(ws, userId);
    const pr = await newRevision(ws, partialDoc);
    await writeRange(db, ws, pr.id, partialDoc, [page(1)], [], { ...counts, warnings: ["OCR_BUDGET"] });
    await completeRevision(db, ws, pr.id);
    const building = await seedDocument(ws, userId);
    await newRevision(ws, building);
    const otherModel = await seedDocument(ws, userId);
    await completeRevision(db, ws, (await newRevision(ws, otherModel, { ...versions, embeddingModel: "m2" })).id);

    const rows = await documentsNeedingIndex(db, { workspaceId: ws, model: MODEL, pipelineVersion: PIPELINE });
    expect(rows.map((r) => r.documentId).sort()).toEqual([needs, withJob, building, otherModel].sort());
    expect(rows.find((r) => r.documentId === needs)!.job).toBeNull();
    expect(rows.find((r) => r.documentId === withJob)!.job?.id).toBe(jobId);
    expect(rows.every((r) => r.workspaceId === ws)).toBe(true);

    const only = await documentsNeedingIndex(db, { workspaceId: ws, documentIds: [needs, indexed], model: MODEL, pipelineVersion: PIPELINE });
    expect(only.map((r) => r.documentId)).toEqual([needs]);
    expect(await documentsNeedingIndex(db, { documentIds: [], model: MODEL, pipelineVersion: PIPELINE })).toEqual([]);
  });

  it("documentsNeedingIndex includes a stored document whose intake_state is null", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const id = await seedDocument(ws, userId, { intakeState: null });
    const rows = await documentsNeedingIndex(db, { model: MODEL, pipelineVersion: PIPELINE });
    expect(rows.map((r) => r.documentId)).toEqual([id]);
  });

  it("no query returns another workspace's rows", async () => {
    const a = await seedWorkspace("a");
    const b = await seedWorkspace("b");
    const { documentId, rev } = await seedIndexedChunks(b.ws, b.userId, 2);
    await putPageRead(db, b.ws, { contentSha256: "x", firstPage: 1, lastPage: 2, doclingVersion: "d", ocrEngine: "o", readerOptions: "r" }, { k: 1 });
    expect(await lastStoredPage(db, a.ws, rev.id)).toBeNull();
    expect(await chunksWithoutEmbedding(db, a.ws, rev.id, MODEL, 10)).toEqual([]);
    expect(await getPageRead(db, a.ws, { contentSha256: "x", firstPage: 1, lastPage: 2, doclingVersion: "d", ocrEngine: "o", readerOptions: "r" })).toBeNull();
    const need = await documentsNeedingIndex(db, { workspaceId: a.ws, model: "m3", pipelineVersion: PIPELINE });
    expect(need).toEqual([]);
    await expect(completeRevision(db, a.ws, rev.id)).rejects.toThrow("INDEX_REVISION_NOT_FOUND");
    await expect(writeRange(db, a.ws, rev.id, documentId, [page(9)], [], counts)).rejects.toThrow("INDEX_REVISION_NOT_FOUND");
    const chunkId = (await db.execute(sql`select id from document_chunk limit 1`)).rows[0]!.id as string;
    await expect(insertEmbeddings(db, a.ws, MODEL, [{ chunkId, embedding: unit(5) }])).rejects.toThrow("CHUNK_NOT_IN_WORKSPACE");
    // Workspace A cannot resume or replace B's revision through B's job.
    const jobB = (await db.execute(sql`select job_id from document_index_revision where id = ${rev.id}`)).rows[0]!.job_id as string;
    const docA = await seedDocument(a.ws, a.userId);
    await expect(startOrResumeRevision(db, a.ws, { documentId: docA, jobId: jobB, versions })).rejects.toThrow();
    await expect(
      startOrResumeRevision(db, a.ws, { documentId: docA, jobId: jobB, versions: { ...versions, chunkerVersion: "chunker-2" } }),
    ).rejects.toThrow();
    const after = await db.execute(sql`select id, chunker_version, workspace_id from document_index_revision`);
    expect(after.rows).toEqual([{ id: rev.id, chunker_version: versions.chunkerVersion, workspace_id: b.ws }]);
    expect(await count("document_chunk")).toBe(2);
  });

  it("writeRange refuses another document's id and a revision that is not building", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    const otherDoc = await seedDocument(ws, userId);
    await expect(writeRange(db, ws, rev.id, otherDoc, [page(1)], [chunk(1, 0)], counts)).rejects.toThrow("REVISION_DOCUMENT_MISMATCH");
    expect(await count("document_chunk")).toBe(0);
    await completeRevision(db, ws, rev.id);
    await expect(writeRange(db, ws, rev.id, documentId, [page(1)], [chunk(1, 0)], counts)).rejects.toThrow("REVISION_NOT_BUILDING");
    expect(await count("document_page")).toBe(0);
  });

  it("startOrResumeRevision refuses a document outside the workspace and a job for another document", async () => {
    const a = await seedWorkspace("a");
    const b = await seedWorkspace("b");
    const docA = await seedDocument(a.ws, a.userId);
    const docA2 = await seedDocument(a.ws, a.userId);
    const docB = await seedDocument(b.ws, b.userId);
    const jobA = await seedJob(a.ws, docA);
    await expect(startOrResumeRevision(db, a.ws, { documentId: docB, jobId: jobA, versions })).rejects.toThrow("DOCUMENT_NOT_FOUND");
    await expect(startOrResumeRevision(db, a.ws, { documentId: docA2, jobId: jobA, versions })).rejects.toThrow("JOB_NOT_FOR_DOCUMENT");
    expect(await count("document_index_revision")).toBe(0);
  });

  it("a chunk with no page number is unique per revision and seq", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const documentId = await seedDocument(ws, userId);
    const rev = await newRevision(ws, documentId);
    const xbrl = chunk(1, 0, { pageNumber: null, textSource: "xbrl" });
    await writeRange(db, ws, rev.id, documentId, [], [xbrl], counts);
    await writeRange(db, ws, rev.id, documentId, [], [xbrl], counts);
    expect(await count("document_chunk")).toBe(1);
  });
});
