import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeRevision, schema, startOrResumeRevision, writeRange, type IndexVersions, type PageInput } from "@maester/db";
import { cliPath } from "../src/eval/paths.js";
import { pageSource, resolveEvalDocuments } from "../src/eval/resolve.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0";
const VERSIONS: IndexVersions = {
  doclingVersion: "2.134.0", ocrEngine: "rapidocr-onnxruntime 3.9.2", readerOptions: "table=accurate;cell_matching=true;ocr=rapidocr",
  chunkerVersion: "1", tokenizer: MODEL, indexVersion: "1", embeddingModel: MODEL,
};

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => {
  ctx = await createWorkerContext();
});
afterAll(async () => {
  await ctx.close();
});

const sha = (c: string) => c.repeat(64);

async function seedDoc(workspaceId: string, userId: string, contentSha256: string, over: Partial<typeof schema.document.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", contentSha256, intakeState: "read",
    createdByUserId: userId, ...over,
  });
  return id;
}

async function revision(workspaceId: string, documentId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: "document.index", subjectType: "document_index", subjectId: documentId });
  return startOrResumeRevision(ctx.db, workspaceId, { documentId, jobId, versions: VERSIONS });
}

const page = (pageNumber: number, itemsTextLayer: number | null, itemsOcr: number | null): PageInput => ({
  pageNumber, text: "", itemsTextLayer, itemsOcr, noneReason: null, sectionPathAfter: [],
});

describe("resolveEvalDocuments", () => {
  it("resolveEvalDocuments maps a duplicate to its original, a document of another workspace to nothing, and gives page sources", async () => {
    const a = await seedWorkspace(ctx.db);
    const b = await seedWorkspace(ctx.db);

    const read = await seedDoc(a.workspaceId, a.userId, sha("1"));
    const rev = await revision(a.workspaceId, read);
    const chunk = (pageNumber: number, seq: number) => ({
      pageNumber, seq, sectionPath: [], kind: "prose" as const, textSource: "text_layer" as const, text: `c${pageNumber}.${seq}`, tokenCount: 3,
    });
    await writeRange(
      ctx.db, a.workspaceId, rev.id, read,
      [page(1, 3, 0), page(2, 0, 3), page(3, 2, 1), page(4, 0, 0)],
      [chunk(1, 0), chunk(1, 1), chunk(2, 0), chunk(3, 0), chunk(3, 1)],
      { pageCount: 4, pagesRead: 4, pagesOcr: 2, warnings: [] },
    );
    await completeRevision(ctx.db, a.workspaceId, rev.id);

    // The duplicate is older than its original here, so only the intake state can tell them apart.
    const original = crypto.randomUUID();
    await seedDoc(a.workspaceId, a.userId, sha("2"), { intakeState: "duplicate", createdAt: new Date(Date.now() - 60_000) });
    await seedDoc(a.workspaceId, a.userId, sha("2"), { id: original });
    await seedDoc(b.workspaceId, b.userId, sha("3"));
    const building = await seedDoc(a.workspaceId, a.userId, sha("4"));
    await revision(a.workspaceId, building);

    const docs = await resolveEvalDocuments(ctx.db, a.workspaceId, MODEL, [
      { filing: "co/ar-1", sha256: sha("1") },
      { filing: "co/ar-2", sha256: sha("2") },
      { filing: "co/ar-3", sha256: sha("3") },
      { filing: "co/ar-4", sha256: sha("4") },
    ]);

    expect(docs[0]).toEqual({
      filing: "co/ar-1", sha256: sha("1"), documentId: read, revisionId: rev.id, state: "complete",
      versions: { indexVersion: "1", doclingVersion: VERSIONS.doclingVersion, ocrEngine: VERSIONS.ocrEngine, readerOptions: VERSIONS.readerOptions, chunkerVersion: "1" },
      chunks: 5,
      pages: [{ page: 1, source: "text_layer" }, { page: 2, source: "ocr" }, { page: 3, source: "mixed" }, { page: 4, source: "none" }],
    });
    expect(docs[1]).toEqual({ filing: "co/ar-2", sha256: sha("2"), documentId: original, revisionId: null, state: null, versions: null, chunks: 0, pages: [] });
    expect(docs[2]).toEqual({ filing: "co/ar-3", sha256: sha("3"), documentId: null, revisionId: null, state: null, versions: null, chunks: 0, pages: [] });
    expect(docs[3]).toMatchObject({ filing: "co/ar-4", documentId: building, revisionId: null, state: null, versions: null, chunks: 0, pages: [] });

    // Another model's revision is not this model's.
    const other = await resolveEvalDocuments(ctx.db, a.workspaceId, "Qwen/Qwen3-Embedding-0.6B", [{ filing: "co/ar-1", sha256: sha("1") }]);
    expect(other[0]).toMatchObject({ documentId: read, revisionId: null, chunks: 0, pages: [] });
  });

  it("pageSource reads null counts as none", () => {
    expect(pageSource(null, null)).toBe("none");
    expect(pageSource(4, null)).toBe("text_layer");
    expect(pageSource(null, 4)).toBe("ocr");
  });
});

describe("cliPath", () => {
  it("cliPath resolves against the folder pnpm started in", () => {
    expect(cliPath("data/x.json", { INIT_CWD: "/repo" })).toBe("/repo/data/x.json");
    expect(cliPath("/abs/x.json", { INIT_CWD: "/repo" })).toBe("/abs/x.json");
    expect(cliPath("x.json", {})).toBe(path.resolve(process.cwd(), "x.json"));
  });
});
