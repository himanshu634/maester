import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import { loadPipelineInputs } from "../src/queries/pipeline.js";
import * as schema from "../src/schema/index.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

const MODEL = "test-model";
const opts = { embeddingModel: MODEL };
const at = (s: string) => new Date(`2026-10-${s}Z`);

async function seedWorkspace(tag: string) {
  const userId = `u-${tag}`;
  await insertUser(db, userId, `${tag}@example.com`);
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: tag, ownerUserId: userId });
  return { workspaceId, userId };
}

async function seedDoc(
  w: { workspaceId: string; userId: string },
  over: Partial<typeof schema.document.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  const format = over.format ?? "pdf";
  await db.insert(schema.document).values({
    id, workspaceId: w.workspaceId, originalName: "a", declaredSize: 10, declaredMime: format === "pdf" ? "application/pdf" : "text/xml", format,
    storageKey: `workspaces/${w.workspaceId}/documents/${id}/original.${format === "pdf" ? "pdf" : "xml"}`, state: "stored", intakeState: "read",
    createdByUserId: w.userId, ...over,
  });
  return id;
}

async function seedClassification(workspaceId: string, documentId: string, createdAt: Date, over: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id, workspaceId, documentId, kind: "financial_results", setBy: "maester", createdAt, ...over });
  return id;
}

async function seedJob(
  workspaceId: string, type: string, documentId: string,
  over: Partial<typeof schema.job.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await db.insert(schema.job).values({
    id, workspaceId, type, subjectType: type === "document.index" ? "document_index" : "document", subjectId: documentId,
    idempotencyKey: `${type}:${documentId}:${id}`, state: "succeeded", ...over,
  });
  return id;
}

async function seedRevision(
  workspaceId: string, documentId: string, classificationId: string | null, createdAt: Date,
  over: Partial<typeof schema.extractionRevision.$inferInsert> = {},
) {
  const jobId = await seedJob(workspaceId, "document.extract", documentId);
  const id = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id, workspaceId, documentId, jobId, classificationId, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v", pageCount: 1,
    coverage: { statements: [] }, createdAt, ...over,
  });
  return id;
}

async function seedIndex(
  workspaceId: string, documentId: string, chunks: { element?: string | null; textSource: "text_layer" | "xbrl" }[],
  over: Partial<typeof schema.documentIndexRevision.$inferInsert> = {},
) {
  const jobId = await seedJob(workspaceId, "document.index", documentId);
  const id = crypto.randomUUID();
  await db.insert(schema.documentIndexRevision).values({
    id, workspaceId, documentId, jobId, state: "complete", indexVersion: "1", doclingVersion: "d", ocrEngine: "o", readerOptions: "r",
    chunkerVersion: "c", embeddingModel: MODEL, pageCount: 40, pagesRead: 38, pagesOcr: 2, ...over,
  });
  if (chunks.length) {
    await db.insert(schema.documentChunk).values(
      chunks.map((c, seq) => ({
        id: crypto.randomUUID(), workspaceId, revisionId: id, documentId, pageNumber: c.element ? null : 1, element: c.element ?? null, seq,
        sectionPath: ["S"], kind: "prose" as const, textSource: c.textSource, headingText: "S", text: `t${seq}`, tokenCount: 1,
      })),
    );
  }
  return id;
}

describe("loadPipelineInputs", () => {
  it("counts the chunks of an XBRL revision with 12 text blocks in 30 chunks", async () => {
    const w = await seedWorkspace("a");
    const doc = await seedDoc(w, { format: "xbrl" });
    // 30 chunks over 12 elements: the first 6 elements hold 3 chunks each, the others 2.
    const chunks = Array.from({ length: 30 }, (_, i) => ({ element: `Block${i < 18 ? Math.floor(i / 3) : 6 + Math.floor((i - 18) / 2)}`, textSource: "xbrl" as const }));
    await seedIndex(w.workspaceId, doc, chunks, { pageCount: null, pagesRead: 0, pagesOcr: 0 });
    const got = (await loadPipelineInputs(db, w.workspaceId, [doc], opts)).get(doc)!;
    expect(got.index).toEqual({ state: "complete", pageCount: null, pagesRead: 0, pagesOcr: 0, chunks: 30, xbrlBlocks: 12 });
  });

  it("counts a PDF's chunks and no blocks, and a mixed document's blocks only from xbrl chunks", async () => {
    const w = await seedWorkspace("a");
    const pdf = await seedDoc(w);
    await seedIndex(w.workspaceId, pdf, Array.from({ length: 5 }, () => ({ textSource: "text_layer" as const })));
    const mixed = await seedDoc(w, { format: "xbrl" });
    await seedIndex(w.workspaceId, mixed, [
      { element: "A", textSource: "xbrl" }, { element: "A", textSource: "xbrl" }, { element: "B", textSource: "text_layer" },
    ]);
    const got = await loadPipelineInputs(db, w.workspaceId, [pdf, mixed], opts);
    expect(got.get(pdf)!.index).toMatchObject({ chunks: 5, xbrlBlocks: 0, pageCount: 40, pagesRead: 38, pagesOcr: 2 });
    expect(got.get(mixed)!.index).toMatchObject({ chunks: 3, xbrlBlocks: 1 });
  });

  it("takes the index of the embedding model asked for, the finished one before one being built, and none for a document with no index", async () => {
    const w = await seedWorkspace("a");
    const doc = await seedDoc(w);
    const other = await seedDoc(w);
    const bare = await seedDoc(w);
    await seedIndex(w.workspaceId, doc, [{ textSource: "text_layer" }], { embeddingModel: "other-model" });
    expect((await loadPipelineInputs(db, w.workspaceId, [doc], opts)).get(doc)!.index).toBeNull();
    await seedIndex(w.workspaceId, doc, [{ textSource: "text_layer" }, { textSource: "text_layer" }], { state: "partial", createdAt: at("01T00:00:00") });
    await seedIndex(w.workspaceId, doc, [{ textSource: "text_layer" }], { state: "building", createdAt: at("02T00:00:00") });
    await seedIndex(w.workspaceId, other, [{ textSource: "text_layer" }, { textSource: "text_layer" }, { textSource: "text_layer" }], { state: "building" });
    const got = await loadPipelineInputs(db, w.workspaceId, [doc, other, bare], opts);
    expect(got.get(doc)!.index).toMatchObject({ state: "partial", chunks: 2 });
    expect(got.get(other)!.index).toMatchObject({ state: "building", chunks: 3 });
    expect(got.get(bare)!.index).toBeNull();
  });

  it("returns the document, its newest classification and its newest jobs by kind", async () => {
    const w = await seedWorkspace("a");
    const doc = await seedDoc(w, { format: "xbrl" });
    await seedClassification(w.workspaceId, doc, at("01T00:00:00"), { kind: "not_sure" });
    const newest = await seedClassification(w.workspaceId, doc, at("02T00:00:00"), { xbrlFormat: "in-capmkt/banking" });
    await seedJob(w.workspaceId, "document.xbrl", doc, { state: "failed", createdAt: at("01T00:00:00") });
    await seedJob(w.workspaceId, "document.xbrl", doc, { state: "running", createdAt: at("03T00:00:00") });
    const lastDocJob = await seedJob(w.workspaceId, "document.classify", doc, { state: "succeeded", createdAt: at("04T00:00:00") });
    await seedJob(w.workspaceId, "document.index", doc, { state: "failed", createdAt: at("01T00:00:00") });
    await seedJob(w.workspaceId, "document.index", doc, { state: "running", createdAt: at("02T00:00:00") });
    const got = (await loadPipelineInputs(db, w.workspaceId, [doc], opts)).get(doc)!;
    expect(got.document.id).toBe(doc);
    expect(got.classification).toMatchObject({ id: newest, xbrlFormat: "in-capmkt/banking" });
    expect(got.latestJob!.id).toBe(lastDocJob);
    expect(got.xbrlJob).toEqual({ state: "running" });
    expect(got.indexJob).toEqual({ state: "running" });
    expect(got.ahead).toBeNull();
  });

  it("a document with no classification, job or revision loads with nulls", async () => {
    const w = await seedWorkspace("a");
    const doc = await seedDoc(w, { state: "uploaded", intakeState: null });
    expect((await loadPipelineInputs(db, w.workspaceId, [doc], opts)).get(doc)).toEqual({
      document: expect.objectContaining({ id: doc }), classification: null, revision: null, latestJob: null, xbrlJob: null, indexJob: null, index: null, ahead: null,
    });
  });

  it("the current revision follows reads_under_id, as getCurrentRevision does, with its source and warnings", async () => {
    const w = await seedWorkspace("a");
    const legacy = await seedDoc(w);
    const legacyRev = await seedRevision(w.workspaceId, legacy, null, at("01T00:00:00"));
    await seedRevision(w.workspaceId, legacy, null, at("01T00:00:00"), { createdAt: at("02T00:00:00") });

    const doc = await seedDoc(w, { format: "xbrl" });
    const first = crypto.randomUUID();
    await db.insert(schema.documentClassification).values({ id: first, workspaceId: w.workspaceId, documentId: doc, kind: "financial_results", setBy: "maester", readsUnderId: first, createdAt: at("01T00:00:00") });
    await seedRevision(w.workspaceId, doc, first, at("01T01:00:00"));
    const read = await seedRevision(w.workspaceId, doc, first, at("01T02:00:00"), { source: "xbrl", state: "partial", warnings: [{ code: "XBRL_FORMAT_UNMAPPED", message: "m" }] });
    await seedClassification(w.workspaceId, doc, at("02T00:00:00"), { readsUnderId: first, periodLabel: "x" });

    const held = await seedDoc(w);
    await seedClassification(w.workspaceId, held, at("01T00:00:00"), { kind: "other", otherType: "announcement" });
    await seedRevision(w.workspaceId, held, null, at("01T00:00:00"));

    const got = await loadPipelineInputs(db, w.workspaceId, [legacy, doc, held], opts);
    expect(got.get(legacy)!.revision!.id).not.toBe(legacyRev);
    expect(got.get(legacy)!.revision).toMatchObject({ source: "pdf", state: "complete", warnings: [] });
    expect(got.get(doc)!.revision).toEqual({ id: read, source: "xbrl", state: "partial", warnings: [{ code: "XBRL_FORMAT_UNMAPPED", message: "m" }] });
    expect(got.get(held)!.revision).toBeNull();
  });

  it("says how many queued index jobs are ahead, in the order the worker claims them", async () => {
    const w = await seedWorkspace("a");
    const docs = [await seedDoc(w), await seedDoc(w), await seedDoc(w), await seedDoc(w), await seedDoc(w)];
    // Claim order is run_after, then created_at: docs[1] is ready first although docs[0] is older; docs[2] ties docs[0] on run_after and is newer.
    await seedJob(w.workspaceId, "document.index", docs[0]!, { state: "queued", runAfter: at("01T00:00:10"), createdAt: at("01T00:00:00") });
    await seedJob(w.workspaceId, "document.index", docs[1]!, { state: "queued", runAfter: at("01T00:00:05"), createdAt: at("01T00:00:04") });
    await seedJob(w.workspaceId, "document.index", docs[2]!, { state: "queued", runAfter: at("01T00:00:10"), createdAt: at("01T00:00:03") });
    await seedJob(w.workspaceId, "document.index", docs[3]!, { state: "running", runAfter: at("01T00:00:01"), createdAt: at("01T00:00:01") });
    await seedJob(w.workspaceId, "document.xbrl", docs[4]!, { state: "queued", runAfter: at("01T00:00:00"), createdAt: at("01T00:00:00") });
    const got = await loadPipelineInputs(db, w.workspaceId, docs, opts);
    expect(docs.map((d) => got.get(d)!.ahead)).toEqual([1, 0, 2, null, null]);
    expect(got.get(docs[3]!)!.indexJob).toEqual({ state: "running" });
  });

  it("never reads another workspace's documents, jobs or indexes", async () => {
    const a = await seedWorkspace("a");
    const b = await seedWorkspace("b");
    const docA = await seedDoc(a);
    const docB = await seedDoc(b);
    // B's queued jobs are older than A's, and would count as ahead if they were read.
    await seedJob(b.workspaceId, "document.index", docB, { state: "queued", runAfter: at("01T00:00:00"), createdAt: at("01T00:00:00") });
    await seedJob(a.workspaceId, "document.index", docA, { state: "queued", runAfter: at("02T00:00:00"), createdAt: at("02T00:00:00") });
    await seedIndex(b.workspaceId, docB, [{ textSource: "text_layer" }]);
    await seedClassification(b.workspaceId, docB, at("01T00:00:00"));

    const forA = await loadPipelineInputs(db, a.workspaceId, [docA, docB], opts);
    expect([...forA.keys()]).toEqual([docA]);
    expect(forA.get(docA)!.ahead).toBe(0);

    // B's id with A's workspace finds nothing at all, even though B's rows exist.
    const crossed = await loadPipelineInputs(db, a.workspaceId, [docB], opts);
    expect(crossed.size).toBe(0);
    const own = (await loadPipelineInputs(db, b.workspaceId, [docB], opts)).get(docB)!;
    expect(own.index).toMatchObject({ chunks: 1 });
    expect(own.classification).not.toBeNull();
  });

  it("runs the same number of queries for 50 documents as for 1", async () => {
    const w = await seedWorkspace("a");
    const docs: string[] = [];
    for (let i = 0; i < 50; i++) {
      const d = await seedDoc(w, { format: i % 2 ? "xbrl" : "pdf" });
      docs.push(d);
      const c = await seedClassification(w.workspaceId, d, at("01T00:00:00"), { readsUnderId: null });
      await seedRevision(w.workspaceId, d, c, at("01T00:00:00"));
      await seedJob(w.workspaceId, "document.xbrl", d);
      await seedJob(w.workspaceId, "document.index", d, { state: "queued" });
      await seedIndex(w.workspaceId, d, [{ element: "E", textSource: "xbrl" }]);
    }
    const counted = async (ids: string[]) => {
      const pool = db.$client;
      const original = pool.query.bind(pool);
      let n = 0;
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        n += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        const got = await loadPipelineInputs(db, w.workspaceId, ids, opts);
        expect(got.size).toBe(ids.length);
      } finally {
        (pool as { query: unknown }).query = original;
      }
      return n;
    };
    const one = await counted(docs.slice(0, 1));
    const fifty = await counted(docs);
    expect(one).toBeGreaterThan(0);
    expect(fifty).toBe(one);
    expect(fifty).toBeLessThanOrEqual(7);
  });

  it("asks nothing for no documents", async () => {
    const w = await seedWorkspace("a");
    expect((await loadPipelineInputs(db, w.workspaceId, [], opts)).size).toBe(0);
  });
});
