import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb, createDb, ensurePersonalWorkspace, completeRevision, insertEmbeddings, chunksWithoutEmbedding,
  runMigrations, schema, startOrResumeRevision, writeRange, type ChunkInput, type Db,
} from "@maester/db";
import { SearchHit } from "@maester/contracts";
import { FakeEmbedder, fuse, searchChunks, vectorBranchSql } from "../src/index.js";

// A database of its own, so this file never truncates the tables another package's tests are using.
const base = process.env.DATABASE_URL_TEST_DB ?? "postgres://maester:maester@localhost:5433/maester_test_db";
const url = new URL(base);
url.pathname = "/maester_test_search";

let db: Db;
beforeAll(async () => {
  const admin = createDb(base);
  const found = await admin.execute(sql`select 1 from pg_database where datname = 'maester_test_search'`);
  if (found.rows.length === 0) await admin.execute(sql.raw("create database maester_test_search"));
  await closeDb(admin);
  db = createDb(url.toString());
  await runMigrations(db);
});
afterAll(() => closeDb(db));
beforeEach(() => truncate());

const truncate = () =>
  db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user", "waitlist_entry", "rate_limit", "market_point", "market_fetch", "market_connection" CASCADE`);

const embedder = new FakeEmbedder();
const MODEL = embedder.model;

async function seedWorkspace(tag: string) {
  const userId = `u-${tag}`;
  await db.insert(schema.user).values({ id: userId, name: tag, email: `${tag}@example.com` });
  const ws = await ensurePersonalWorkspace(db, { userId, userName: tag });
  return { ws: ws.id, userId };
}

async function seedCompany(ws: string, userId: string, displayName: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.company).values({ id, workspaceId: ws, displayName, country: "IN", createdByUserId: userId });
  return id;
}

interface Seeded { documentId: string; chunkIds: string[] }

/** One document with the given chunks, embedded with `model` (the text itself is embedded, so a query equal to a chunk's text finds it first). */
async function seedDocument(
  ws: string, userId: string,
  opts: { name?: string; companyId?: string; chunks: { text: string; sectionPath?: string[]; pageNumber?: number }[]; state?: "complete" | "building"; model?: string },
): Promise<Seeded> {
  const model = opts.model ?? MODEL;
  const documentId = crypto.randomUUID();
  await db.insert(schema.document).values({
    id: documentId, workspaceId: ws, companyId: opts.companyId ?? null, originalName: opts.name ?? "ar.pdf", declaredSize: 10,
    declaredMime: "application/pdf", storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored",
    intakeState: "read", createdByUserId: userId,
  });
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({
    id: jobId, workspaceId: ws, type: "document.index", subjectType: "document_index", subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:${model}`, state: "queued",
  });
  const rev = await startOrResumeRevision(db, ws, {
    documentId, jobId,
    versions: { doclingVersion: "2", ocrEngine: "rapidocr", readerOptions: "o", chunkerVersion: "c", tokenizer: model, indexVersion: "1", embeddingModel: model },
  });
  const inputs: ChunkInput[] = opts.chunks.map((c, i) => ({
    pageNumber: c.pageNumber ?? 1, seq: i, sectionPath: c.sectionPath ?? [], kind: "prose", textSource: "text_layer", text: c.text, tokenCount: 4,
  }));
  await writeRange(db, ws, rev.id, documentId, [{ pageNumber: 1, text: "p", itemsTextLayer: 1, itemsOcr: 0, noneReason: null, sectionPathAfter: [] }], inputs, {
    pageCount: 1, pagesRead: 1, pagesOcr: 0, warnings: [],
  });
  const rows = await chunksWithoutEmbedding(db, ws, rev.id, model, inputs.length);
  const vectors = await embedder.embed(rows.map((r) => r.text), "document");
  await insertEmbeddings(db, ws, model, rows.map((r, i) => ({ chunkId: r.id, embedding: vectors[i]! })));
  if ((opts.state ?? "complete") === "complete") await completeRevision(db, ws, rev.id);
  return { documentId, chunkIds: rows.map((r) => r.id) };
}

describe("fuse", () => {
  it("scores 1/(k+rank) per branch, from rank 1, and orders by the sum", () => {
    // vector: a b c; keyword: c a d. k = 60.
    const out = fuse(["a", "b", "c"], ["c", "a", "d"]);
    const s = (r: number) => 1 / (60 + r);
    expect(out.map((o) => o.id)).toEqual(["a", "c", "b", "d"]);
    expect(out[0]!.score).toBeCloseTo(s(1) + s(2), 12);
    expect(out[1]!.score).toBeCloseTo(s(3) + s(1), 12);
    expect(out[2]!.score).toBeCloseTo(s(2), 12);
    expect(out[3]!.score).toBeCloseTo(s(3), 12);
    expect(out.map((o) => [o.vectorRank, o.keywordRank])).toEqual([[1, 2], [3, 1], [2, null], [null, 3]]);
  });

  it("ranks a chunk found by both branches above one found by one", () => {
    const out = fuse(["x", "both"], ["both", "y"]);
    expect(out[0]!.id).toBe("both");
  });

  it("breaks a tie by the better vector rank", () => {
    // v1 (vector only) and k1 (keyword only) have equal scores: the vector hit wins.
    expect(fuse(["v1"], ["k1"]).map((o) => o.id)).toEqual(["v1", "k1"]);
    // a: vector 1, keyword 2; b: vector 2, keyword 1. Equal scores; a has the better vector rank.
    expect(fuse(["a", "b"], ["b", "a"]).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("counts the first place of an id repeated in one ranking", () => {
    expect(fuse(["a", "a"], []).map((o) => [o.id, o.vectorRank])).toEqual([["a", 1]]);
  });
});

describe("searchChunks", () => {
  it("returns the nearest chunk first and carries where it came from", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const co = await seedCompany(ws, userId, "Synthetic Cements Limited");
    const d = await seedDocument(ws, userId, {
      name: "ar-2025.pdf", companyId: co,
      chunks: [
        { text: "Revenue grew on higher volumes", sectionPath: ["Directors report"], pageNumber: 4 },
        { text: "The board met six times", sectionPath: ["Governance"], pageNumber: 9 },
        { text: "Kilns ran at ninety percent", pageNumber: 12 },
      ],
    });
    const hits = await searchChunks(db, embedder, { workspaceId: ws, query: "The board met six times" });
    expect(hits[0]).toMatchObject({
      documentId: d.documentId, documentName: "ar-2025.pdf", companyId: co, companyName: "Synthetic Cements Limited",
      pageNumber: 9, element: null, sectionPath: ["Governance"], textSource: "text_layer", kind: "prose",
      text: "The board met six times", vectorRank: 1,
    });
    expect(hits[0]!.keywordRank).toBe(1);
    for (const h of hits) expect(SearchHit.parse(h)).toEqual(h);
  });

  it("ranks a chunk found by both branches above one found by one", async () => {
    const { ws, userId } = await seedWorkspace("a");
    await seedDocument(ws, userId, {
      chunks: [
        { text: "alpha beta" },
        { text: "gamma delta" },
        { text: "epsilon zeta" },
      ],
    });
    // The query matches the first chunk's words and (as a vector) nothing exactly: the keyword branch finds one chunk, the vector branch all three.
    const hits = await searchChunks(db, embedder, { workspaceId: ws, query: "alpha" });
    expect(hits[0]!.text).toBe("alpha beta");
    expect(hits[0]!.keywordRank).toBe(1);
    expect(hits[0]!.vectorRank).not.toBeNull();
    expect(hits.slice(1).every((h) => h.keywordRank === null)).toBe(true);
  });

  it("never returns a chunk of a building revision, of another model or of another workspace", async () => {
    const a = await seedWorkspace("a");
    const b = await seedWorkspace("b");
    const text = "shared passage about inventory";
    const ok = await seedDocument(a.ws, a.userId, { chunks: [{ text }] });
    await seedDocument(a.ws, a.userId, { chunks: [{ text }], state: "building" });
    await seedDocument(a.ws, a.userId, { chunks: [{ text }], model: "other-model" });
    await seedDocument(b.ws, b.userId, { chunks: [{ text }] });
    const hits = await searchChunks(db, embedder, { workspaceId: a.ws, query: text });
    expect(hits.map((h) => h.documentId)).toEqual([ok.documentId]);
  });

  it("filters by company and by documents, and runs without the index when filtered", async () => {
    const { ws, userId } = await seedWorkspace("a");
    const c1 = await seedCompany(ws, userId, "One Limited");
    const c2 = await seedCompany(ws, userId, "Two Limited");
    const d1 = await seedDocument(ws, userId, { companyId: c1, chunks: [{ text: "ledger of one" }] });
    const d2 = await seedDocument(ws, userId, { companyId: c2, chunks: [{ text: "ledger of two" }] });
    const all = await searchChunks(db, embedder, { workspaceId: ws, query: "ledger" });
    expect(new Set(all.map((h) => h.documentId))).toEqual(new Set([d1.documentId, d2.documentId]));
    const only1 = await searchChunks(db, embedder, { workspaceId: ws, query: "ledger", companyId: c1 });
    expect(only1.map((h) => h.documentId)).toEqual([d1.documentId]);
    const byDoc = await searchChunks(db, embedder, { workspaceId: ws, query: "ledger", documentIds: [d2.documentId] });
    expect(byDoc.map((h) => h.documentId)).toEqual([d2.documentId]);
    expect(await searchChunks(db, embedder, { workspaceId: ws, query: "ledger", documentIds: [] })).toEqual([]);
    // A company of another workspace gives nothing.
    const other = await seedWorkspace("b");
    expect(await searchChunks(db, embedder, { workspaceId: other.ws, query: "ledger", companyId: c1 })).toEqual([]);
  });

  it("finds a CIN and a company name exactly as printed", async () => {
    const { ws, userId } = await seedWorkspace("a");
    await seedDocument(ws, userId, {
      chunks: [
        { text: "Corporate Identity Number L26942GJ1981PLC004717", sectionPath: ["Corporate information"] },
        { text: "Registered office of Synthetic Cements Limited" },
        { text: "Unrelated paragraph about the weather" },
      ],
    });
    // The fake vectors carry no meaning, so a hit with a keyword rank of 1 proves the keyword branch found it.
    const cin = await searchChunks(db, embedder, { workspaceId: ws, query: "L26942GJ1981PLC004717" });
    expect(cin.find((h) => h.keywordRank === 1)!.text).toContain("L26942GJ1981PLC004717");
    const name = await searchChunks(db, embedder, { workspaceId: ws, query: "Synthetic Cements Limited" });
    expect(name.find((h) => h.keywordRank === 1)!.text).toContain("Synthetic Cements Limited");
    // A query of only stop characters gives no keyword rows and does not fail.
    const none = await searchChunks(db, embedder, { workspaceId: ws, query: "!!! ---" });
    expect(none.every((h) => h.keywordRank === null)).toBe(true);
  });

  it("cuts a limit of 60 to 50 and defaults to 10", async () => {
    const { ws, userId } = await seedWorkspace("a");
    await seedDocument(ws, userId, { chunks: Array.from({ length: 70 }, (_, i) => ({ text: `row ${i} of the schedule` })) });
    expect(await searchChunks(db, embedder, { workspaceId: ws, query: "schedule", limit: 60 })).toHaveLength(50);
    expect(await searchChunks(db, embedder, { workspaceId: ws, query: "schedule" })).toHaveLength(10);
  });
});

describe("the vector branch's plan", () => {
  async function plan(over: { companyId?: string }) {
    const { ws, userId } = await seedWorkspace("p");
    const co = await seedCompany(ws, userId, "Plan Limited");
    await seedDocument(ws, userId, { companyId: co, chunks: Array.from({ length: 40 }, (_, i) => ({ text: `chunk number ${i}` })) });
    const [vector] = await embedder.embed(["chunk number 3"], "query");
    const stmt = vectorBranchSql({ workspaceId: ws, model: MODEL, vector: vector!, ...(over.companyId === "yes" ? { companyId: co } : {}) });
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      return tx.execute(sql`explain ${stmt}`);
    });
    return JSON.stringify(result.rows);
  }

  it("unfiltered, uses chunk_embedding_hnsw", async () => {
    expect(await plan({})).toContain("chunk_embedding_hnsw");
  });

  it("filtered by company, does not use chunk_embedding_hnsw", async () => {
    expect(await plan({ companyId: "yes" })).not.toContain("chunk_embedding_hnsw");
  });
});
