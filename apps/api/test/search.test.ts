import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SearchResults } from "@maester/contracts";
import {
  chunksWithoutEmbedding, completeRevision, insertEmbeddings, schema, startOrResumeRevision, writeRange,
} from "@maester/db";
import { EmbedderError, FakeEmbedder, type Embedder } from "@maester/document-index";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { silentLogger } from "../src/logger.js";
import { createTestContext, type TestContext } from "./context.js";

const embedder = new FakeEmbedder();
const logged: string[] = [];
const logger = pino({ level: "debug" }, { write: (line: string) => { logged.push(line); } });
let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext({}, { embedder, logger }); });
afterAll(() => ctx.close());

const search = (ws: string, cookie: string | null, qs: string) =>
  ctx.app.request(`/v1/workspaces/${ws}/search${qs}`, { headers: cookie ? { cookie } : {} });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

async function seedIndex(ws: string, userId: string, companyId: string | null, texts: string[]) {
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId: ws, companyId, originalName: "ar-2025.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored", intakeState: "read", createdByUserId: userId,
  });
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id: jobId, workspaceId: ws, type: "document.index", subjectType: "document_index", subjectId: documentId,
    idempotencyKey: `document.index:${documentId}:${embedder.model}`, state: "queued",
  });
  const model = embedder.model;
  const rev = await startOrResumeRevision(ctx.db, ws, {
    documentId, jobId,
    versions: { doclingVersion: "2", ocrEngine: "rapidocr", readerOptions: "o", chunkerVersion: "c", tokenizer: model, indexVersion: "1", embeddingModel: model },
  });
  await writeRange(
    ctx.db, ws, rev.id, documentId,
    [{ pageNumber: 3, text: "p", itemsTextLayer: 1, itemsOcr: 0, noneReason: null, sectionPathAfter: [] }],
    texts.map((text, seq) => ({ pageNumber: 3, seq, sectionPath: ["Directors report", "Outlook"], kind: "prose" as const, textSource: "text_layer" as const, text, tokenCount: 4 })),
    { pageCount: 3, pagesRead: 1, pagesOcr: 0, warnings: [] },
  );
  const rows = await chunksWithoutEmbedding(ctx.db, ws, rev.id, model, texts.length);
  const vectors = await embedder.embed(rows.map((r) => r.text), "document");
  await insertEmbeddings(ctx.db, ws, model, rows.map((r, i) => ({ chunkId: r.id, embedding: vectors[i]! })));
  await completeRevision(ctx.db, ws, rev.id);
  return documentId;
}

describe("GET /v1/workspaces/:ws/search", () => {
  it("answers 401 when signed out", async () => {
    const a = await ctx.signUp("s1@example.com");
    expect((await search(a.workspaceId, null, "?q=x")).status).toBe(401);
  });

  it("answers 404 NOT_FOUND for a workspace the user is not a member of", async () => {
    const a = await ctx.signUp("s2@example.com");
    const b = await ctx.signUp("s3@example.com");
    const res = await search(b.workspaceId, a.cookie, "?q=x");
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("NOT_FOUND");
  });

  it("rejects an empty, blank or too long q, a bad limit and a bad company with 400", async () => {
    const a = await ctx.signUp("s4@example.com");
    for (const qs of ["", "?q=", "?q=%20%20", `?q=${"x".repeat(501)}`, "?q=x&limit=0", "?q=x&limit=51", "?q=x&limit=abc", "?q=x&company=nope"]) {
      const res = await search(a.workspaceId, a.cookie, qs);
      expect(res.status, qs).toBe(400);
      expect(await code(res)).toBe("VALIDATION_FAILED");
    }
  });

  it("answers 503 SEARCH_UNAVAILABLE when the embedder fails, and logs no query", async () => {
    const a = await ctx.signUp("s5@example.com");
    embedder.fail(1, new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not answer."));
    const res = await search(a.workspaceId, a.cookie, "?q=secret+query");
    expect(res.status).toBe(503);
    expect(await code(res)).toBe("SEARCH_UNAVAILABLE");
    expect(logged.join("\n")).toContain("EMBEDDER_UNAVAILABLE");
    expect(logged.join("\n")).not.toContain("secret");
  });

  it("answers 503 SEARCH_UNAVAILABLE when no embedder is configured", async () => {
    const a = await ctx.signUp("s6@example.com");
    const bare = createApp({ env: ctx.env, logger: silentLogger, db: ctx.db, auth: createAuth({ db: ctx.db, env: ctx.env, mailer: ctx.mailer, logger: silentLogger }), store: ctx.store, dispatcher: ctx.dispatcher, embedder: null });
    const res = await bare.request(`/v1/workspaces/${a.workspaceId}/search?q=x`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(503);
    expect(await code(res)).toBe("SEARCH_UNAVAILABLE");
  });

  it("answers 500 INTERNAL on a failed statement and logs neither the query nor its parameters", async () => {
    const a = await ctx.signUp("s8@example.com");
    const wrong = { model: embedder.model, embed: async () => [[0.1, 0.2, 0.3]], servedModel: async () => embedder.model };
    const app = createApp({ env: ctx.env, logger, db: ctx.db, auth: createAuth({ db: ctx.db, env: ctx.env, mailer: ctx.mailer, logger: silentLogger }), store: ctx.store, dispatcher: ctx.dispatcher, embedder: wrong });
    logged.length = 0;
    const res = await app.request(`/v1/workspaces/${a.workspaceId}/search?q=confidential+phrase`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("INTERNAL");
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain("confidential");
  });

  const QWEN_FOLDER = "/models/embed/Qwen/Qwen3-Embedding-0.6B";
  const appWith = (e: Embedder) =>
    createApp({ env: ctx.env, logger, db: ctx.db, auth: createAuth({ db: ctx.db, env: ctx.env, mailer: ctx.mailer, logger: silentLogger }), store: ctx.store, dispatcher: ctx.dispatcher, embedder: e });

  it("answers 503 SEARCH_UNAVAILABLE when the embedder serves another model, and logs no query", async () => {
    const a = await ctx.signUp("s9@example.com");
    // The shared app has already seen its embedder match; that must not carry over to another app and embedder.
    expect((await search(a.workspaceId, a.cookie, "?q=warm")).status).toBe(200);
    const other = new FakeEmbedder(embedder.model, { serves: QWEN_FOLDER });
    const embed = vi.spyOn(other, "embed");
    logged.length = 0;
    const res = await appWith(other).request(`/v1/workspaces/${a.workspaceId}/search?q=confidential+phrase`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(503);
    expect(await code(res)).toBe("SEARCH_UNAVAILABLE");
    expect(embed).not.toHaveBeenCalled();
    const lines = logged.map((l) => JSON.parse(l) as Record<string, unknown>);
    const mismatch = lines.filter((l) => l.code === "EMBEDDER_MODEL_MISMATCH");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ level: 40, served: QWEN_FOLDER });
    expect(logged.join("\n")).not.toContain("confidential");
  });

  it("asks which model the embedder serves until one answer matches, then not again", async () => {
    const a = await ctx.signUp("s10@example.com");
    const asked: number[] = [];
    const flaky: Embedder = {
      model: embedder.model,
      embed: (texts, kind) => embedder.embed(texts, kind),
      servedModel: async () => {
        asked.push(asked.length + 1);
        if (asked.length === 1) return QWEN_FOLDER;
        if (asked.length === 2) throw new EmbedderError("EMBEDDER_UNAVAILABLE", true, "The embedder did not say which model it serves.");
        return `/models/embed/${embedder.model}`;
      },
    };
    const app = appWith(flaky);
    const get = (q: string) => app.request(`/v1/workspaces/${a.workspaceId}/search?q=${q}`, { headers: { cookie: a.cookie } });
    expect((await get("one")).status).toBe(503);
    expect((await get("two")).status).toBe(503);
    expect(asked).toEqual([1, 2]);
    expect((await get("three")).status).toBe(200);
    expect((await get("four")).status).toBe(200);
    expect(asked).toEqual([1, 2, 3]);
  });

  it("returns hits with page, section path, text source and both ranks, and no figure field", async () => {
    const a = await ctx.signUp("s7@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const documentId = await seedIndex(a.workspaceId, a.userId, companyId, ["Revenue grew on higher volumes", "The board met six times"]);
    const res = await search(a.workspaceId, a.cookie, "?q=The%20board%20met%20six%20times&limit=5");
    expect(res.status).toBe(200);
    const body = SearchResults.parse(await res.json());
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toEqual({
      documentId, documentName: "ar-2025.pdf", companyId, companyName: "Synthetic Cements Limited", pageNumber: 3, element: null,
      sectionPath: ["Directors report", "Outlook"], textSource: "text_layer", kind: "prose", text: "The board met six times",
      vectorRank: 1, keywordRank: 1,
    });
    expect(body.items[1]!.keywordRank).toBeNull();
    expect(Object.keys(body.items[0]!)).not.toContain("value");
    const filtered = SearchResults.parse(await (await search(a.workspaceId, a.cookie, `?q=board&company=${crypto.randomUUID()}`)).json());
    expect(filtered.items).toEqual([]);
  });
});
