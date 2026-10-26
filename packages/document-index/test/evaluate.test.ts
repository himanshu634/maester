import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  chunksWithoutEmbedding, closeDb, completeRevision, createDb, ensurePersonalWorkspace, insertEmbeddings, runMigrations, schema,
  startOrResumeRevision, writeRange, type Db,
} from "@maester/db";
import { FakeEmbedder, fuse, rankChunks, rankPages } from "../src/index.js";

// A database of its own, so this file never truncates the tables another file's tests are using.
const base = process.env.DATABASE_URL_TEST_DB ?? "postgres://maester:maester@localhost:5433/maester_test_db";
const url = new URL(base);
url.pathname = "/maester_test_evaluate";

let db: Db;
beforeAll(async () => {
  const admin = createDb(base);
  const found = await admin.execute(sql`select 1 from pg_database where datname = 'maester_test_evaluate'`);
  if (found.rows.length === 0) await admin.execute(sql.raw("create database maester_test_evaluate"));
  await closeDb(admin);
  db = createDb(url.toString());
  await runMigrations(db);
});
afterAll(() => closeDb(db));
beforeEach(() =>
  db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user", "waitlist_entry", "rate_limit", "market_point", "market_fetch", "market_connection" CASCADE`),
);

const embedder = new FakeEmbedder();
const MODEL = embedder.model;

async function seedWorkspace() {
  const userId = "u-evaluate";
  await db.insert(schema.user).values({ id: userId, name: "e", email: "e@example.com" });
  const ws = await ensurePersonalWorkspace(db, { userId, userName: "e" });
  return { ws: ws.id, userId };
}

/** A document with one complete revision of `MODEL`: each chunk on its page, embedded from its own text. */
async function seedDocument(ws: string, userId: string, chunks: { text: string; page: number }[]) {
  const documentId = crypto.randomUUID();
  await db.insert(schema.document).values({
    id: documentId, workspaceId: ws, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored", intakeState: "read", createdByUserId: userId,
  });
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({
    id: jobId, workspaceId: ws, type: "document.index", subjectType: "document_index", subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:${MODEL}`, state: "queued",
  });
  const rev = await startOrResumeRevision(db, ws, {
    documentId, jobId,
    versions: { doclingVersion: "2", ocrEngine: "rapidocr", readerOptions: "o", chunkerVersion: "c", tokenizer: MODEL, indexVersion: "1", embeddingModel: MODEL },
  });
  const seqOnPage = new Map<number, number>();
  const inputs = chunks.map((c) => {
    const seq = seqOnPage.get(c.page) ?? 0;
    seqOnPage.set(c.page, seq + 1);
    return { pageNumber: c.page, seq, sectionPath: [], kind: "prose" as const, textSource: "text_layer" as const, text: c.text, tokenCount: 4 };
  });
  await writeRange(db, ws, rev.id, documentId, [{ pageNumber: 1, text: "p", itemsTextLayer: 1, itemsOcr: 0, noneReason: null, sectionPathAfter: [] }], inputs, {
    pageCount: 1, pagesRead: 1, pagesOcr: 0, warnings: [],
  });
  const rows = await chunksWithoutEmbedding(db, ws, rev.id, MODEL, inputs.length);
  const vectors = await embedder.embed(rows.map((r) => r.text), "document");
  await insertEmbeddings(db, ws, MODEL, rows.map((r, i) => ({ chunkId: r.id, embedding: vectors[i]! })));
  await completeRevision(db, ws, rev.id);
  return { documentId, revisionId: rev.id };
}

describe("rankPages", () => {
  it("ranks pages within the given documents only", async () => {
    const { ws, userId } = await seedWorkspace();
    const text = "shared passage about inventory";
    const a = await seedDocument(ws, userId, [{ text, page: 2 }]);
    const b = await seedDocument(ws, userId, [{ text, page: 7 }]);
    const third = await seedDocument(ws, userId, [{ text, page: 4 }]);

    const ranked = await rankPages(db, embedder, { workspaceId: ws, query: text, documentIds: [a.documentId, b.documentId] });
    for (const list of [ranked.vector, ranked.keyword, ranked.hybrid]) {
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.documentId)).not.toContain(third.documentId);
      expect(new Set(list.map((p) => `${p.documentId}:${p.pageNumber}`))).toEqual(new Set([`${a.documentId}:2`, `${b.documentId}:7`]));
    }
  });

  it("hybrid is the whole fusion, chunk by chunk", async () => {
    const { ws, userId } = await seedWorkspace();
    const d = await seedDocument(ws, userId, [
      { text: "alpha first on page three", page: 3 },
      { text: "alpha second on page three", page: 3 },
      { text: "delta on page five", page: 5 },
    ]);
    const ranked = await rankPages(db, embedder, { workspaceId: ws, query: "alpha", documentIds: [d.documentId] });

    // The keyword branch finds the two chunks of page 3 only; the vector branch ranks all three.
    expect(ranked.keyword).toEqual([{ documentId: d.documentId, pageNumber: 3 }, { documentId: d.documentId, pageNumber: 3 }]);
    expect(ranked.vector).toHaveLength(3);
    // Two chunks on one page appear twice, in the order the fusion gives, and nothing is cut.
    expect(ranked.hybrid).toHaveLength(3);
    expect(ranked.hybrid.filter((p) => p.pageNumber === 3)).toHaveLength(2);

    const [queryVector] = await embedder.embed(["alpha"], "query");
    const branches = await rankChunks(db, { workspaceId: ws, model: MODEL, vector: queryVector!, query: "alpha", documentIds: [d.documentId] });
    const pageOf = new Map(
      (await db.execute(sql`select id, page_number from document_chunk where workspace_id = ${ws}`)).rows.map((r) => [String(r.id), Number(r.page_number)]),
    );
    const expected = fuse(branches.vector, branches.keyword).map((f) => ({ documentId: d.documentId, pageNumber: pageOf.get(f.id)! }));
    expect(ranked.hybrid).toEqual(expected);
    expect(ranked.vector).toEqual(branches.vector.map((id) => ({ documentId: d.documentId, pageNumber: pageOf.get(id)! })));
  });

  it("gives nothing for no documents", async () => {
    const { ws } = await seedWorkspace();
    expect(await rankPages(db, embedder, { workspaceId: ws, query: "anything", documentIds: [] })).toEqual({ vector: [], keyword: [], hybrid: [] });
  });
});
