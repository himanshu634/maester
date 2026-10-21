import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvalBench, EvalRankings, EvalSources } from "@maester/contracts";
import {
  chunksWithoutEmbedding, completeRevision, insertEmbeddings, schema, startOrResumeRevision, writeRange, type IndexVersions, type PageInput,
} from "@maester/db";
import { FakeEmbedder, contextualize, type Embedder } from "@maester/document-index";
import { benchEmbedder } from "../src/eval/bench.js";
import { runEval } from "../src/eval/cli.js";
import { cliPath } from "../src/eval/paths.js";
import { pageSource, resolveEvalDocuments } from "../src/eval/resolve.js";
import { createWorkerContext, seedJob, seedWorkspace, workerTestEnv } from "./context.js";

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

// ---- the eval command and the bench ----

const ARCTIC_ID = MODEL;
const QWEN_ID = "Qwen/Qwen3-Embedding-0.6B";
const SERVES_QWEN = "/models/embed/Qwen/Qwen3-Embedding-0.6B";
const FILING_NEW = "aether-industries/ar-2024-25";
const FILING_OLD = "aether-industries/ar-2023-24";
const requestFile = fileURLToPath(new URL("../../../packages/contracts/fixtures/eval/request.json", import.meta.url));
const request = JSON.parse(readFileSync(requestFile, "utf8")) as { documents: { filing: string; sha256: string }[] };
const shaOf = (filing: string) => request.documents.find((d) => d.filing === filing)!.sha256;

const source = {
  DATABASE_URL: workerTestEnv().DATABASE_URL, WORKER_URL: "http://localhost:8788", NODE_ENV: "test", STORAGE_DRIVER: "disk", LOG_LEVEL: "silent",
} as NodeJS.ProcessEnv;

function capture() {
  const lines = { log: [] as string[], error: [] as string[] };
  return { lines, out: { log: (l: string) => lines.log.push(l), error: (l: string) => lines.error.push(l) } };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maester-eval-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
const fresh = (name: string) => path.join(dir, `${crypto.randomUUID()}-${name}`);

/** A stored document of `contentSha256` with a complete revision of `model`, each chunk embedded from its own text. */
async function seedIndexed(
  workspaceId: string, userId: string, contentSha256: string, chunks: { page: number; text: string; sectionPath?: string[] }[], model = ARCTIC_ID,
) {
  const documentId = await seedDoc(workspaceId, userId, contentSha256);
  const jobId = await seedJob(ctx.db, workspaceId, { type: "document.index", subjectType: "document_index", subjectId: documentId });
  const rev = await startOrResumeRevision(ctx.db, workspaceId, { documentId, jobId, versions: { ...VERSIONS, tokenizer: model, embeddingModel: model } });
  const seq = new Map<number, number>();
  const inputs = chunks.map((c) => {
    const n = seq.get(c.page) ?? 0;
    seq.set(c.page, n + 1);
    return { pageNumber: c.page, seq: n, sectionPath: c.sectionPath ?? [], kind: "prose" as const, textSource: "text_layer" as const, text: c.text, tokenCount: 4 };
  });
  await writeRange(ctx.db, workspaceId, rev.id, documentId, [page(1, 1, 0)], inputs, { pageCount: 1, pagesRead: 1, pagesOcr: 0, warnings: [] });
  const rows = await chunksWithoutEmbedding(ctx.db, workspaceId, rev.id, model, inputs.length);
  const vectors = await new FakeEmbedder(model).embed(rows.map((r) => r.text), "document");
  await insertEmbeddings(ctx.db, workspaceId, model, rows.map((r, i) => ({ chunkId: r.id, embedding: vectors[i]! })));
  await completeRevision(ctx.db, workspaceId, rev.id);
  return documentId;
}

/** The CLI on the test database, with `embedder` standing in for the one `--embedder-url` names. */
async function run(argv: string[], embedder: Embedder = new FakeEmbedder(ARCTIC_ID)) {
  const { lines, out } = capture();
  const code = await runEval(argv, source, out, () => ({ db: ctx.db, embedder: () => embedder }));
  return { code, ...lines };
}

describe("eval rank", () => {
  it("rank prints the questions and documents it ranked", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const newId = await seedIndexed(workspaceId, userId, shaOf(FILING_NEW), [
      { page: 2, text: "Revenue grew on higher volumes" },
      { page: 3, text: "What did the auditors say about internal financial controls?" },
    ]);
    await seedIndexed(workspaceId, userId, shaOf(FILING_OLD), [{ page: 5, text: "Kilns ran at ninety percent" }]);
    const outFile = fresh("rankings.json");

    const r = await run(["rank", "--workspace", workspaceId, "--request", requestFile, "--out", outFile, "--model", ARCTIC_ID, "--embedder-url", "http://embedder"]);
    expect(r).toMatchObject({ code: 0, log: ["ranked 1 questions over 2 documents"], error: [] });

    const written = readFileSync(outFile, "utf8");
    // A question's text is in the request file only.
    expect(written).not.toContain("auditors");
    const rankings = EvalRankings.parse(JSON.parse(written));
    expect(rankings.model).toBe(ARCTIC_ID);
    expect(rankings.documents.map((d) => d.filing)).toEqual([FILING_NEW, FILING_OLD]);
    expect(rankings.documents[0]).toMatchObject({ documentId: newId, chunks: 2 });
    const [q] = rankings.rankings;
    expect(q!.questionId).toBe("q001");
    // The fake vectors carry no meaning, but the chunk that equals the query is the nearest of all, in both its branches.
    expect(q!.vector[0]).toEqual({ filing: FILING_NEW, page: 3 });
    expect(q!.keyword[0]).toEqual({ filing: FILING_NEW, page: 3 });
    expect(q!.hybrid[0]).toEqual({ filing: FILING_NEW, page: 3 });
    expect(q!.vector).toHaveLength(3);
    expect(q!.hybrid).toHaveLength(3);
    expect(q!.vector.map((p) => p.filing).sort()).toEqual([FILING_OLD, FILING_NEW, FILING_NEW]);
  });

  it("rank exits 2 and writes no rankings when a scope document has no revision for the model", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    await seedIndexed(workspaceId, userId, shaOf(FILING_NEW), [{ page: 3, text: "internal financial controls" }]);
    await seedDoc(workspaceId, userId, shaOf(FILING_OLD)); // stored, never indexed
    const outFile = fresh("rankings.json");

    const r = await run(["rank", "--workspace", workspaceId, "--request", requestFile, "--out", outFile, "--model", ARCTIC_ID, "--embedder-url", "http://embedder"]);
    expect(r.code).toBe(2);
    expect(r.log).toEqual([]);
    expect(r.error.join("\n")).toContain(FILING_OLD);
    expect(r.error.join("\n")).not.toContain(FILING_NEW);
    expect(r.error.join("\n")).not.toContain("auditors");

    const written = EvalRankings.parse(JSON.parse(readFileSync(outFile, "utf8")));
    expect(written.rankings).toEqual([]);
    expect(written.documents.map((d) => [d.filing, d.revisionId === null])).toEqual([[FILING_NEW, false], [FILING_OLD, true]]);
  });

  it("rank and bench refuse an embedder that serves another model", async () => {
    const { workspaceId } = await seedWorkspace(ctx.db);
    const wrong = new FakeEmbedder(ARCTIC_ID, { serves: SERVES_QWEN });
    for (const command of ["rank", "bench"]) {
      const outFile = fresh(`${command}.json`);
      const r = await run(
        [command, "--workspace", workspaceId, "--request", requestFile, "--out", outFile, "--model", ARCTIC_ID, "--embedder-url", "http://embedder"],
        wrong,
      );
      expect(r.code).toBe(1);
      expect(r.error).toEqual([`--embedder-url serves ${SERVES_QWEN}, not ${ARCTIC_ID}`]);
      expect(existsSync(outFile)).toBe(false);
    }
  });
});

describe("eval sources", () => {
  it("sources prints counts and writes the documents as the workspace holds them", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    await seedIndexed(workspaceId, userId, shaOf(FILING_NEW), [{ page: 1, text: "a" }, { page: 2, text: "b" }, { page: 2, text: "c" }]);
    await seedDoc(workspaceId, userId, shaOf(FILING_OLD));
    const outFile = fresh("sources.json");

    const r = await run(["sources", "--workspace", workspaceId, "--request", requestFile, "--out", outFile]);
    expect(r).toMatchObject({ code: 0, log: ["sources 2 documents, 1 with a current revision, 3 chunks"], error: [] });
    const sources = EvalSources.parse(JSON.parse(readFileSync(outFile, "utf8")));
    expect(sources.model).toBe(ARCTIC_ID); // the default is EMBEDDING_MODEL
    expect(sources.documents.map((d) => d.chunks)).toEqual([3, 0]);
    expect("rankings" in sources).toBe(false);
  });
});

describe("eval bench", () => {
  it("bench embeds the same first chunks of the text model's revisions, whatever the model measured", async () => {
    const { workspaceId, userId } = await seedWorkspace(ctx.db);
    const chunk = (doc: string, i: number) => ({ page: 1 + Math.floor(i / 2), text: `${doc} chunk ${i} ${"x".repeat(i)}`, sectionPath: i % 2 === 0 ? ["Heading"] : [] });
    const first = Array.from({ length: 20 }, (_, i) => chunk("new", i));
    const second = Array.from({ length: 20 }, (_, i) => chunk("old", i));
    await seedIndexed(workspaceId, userId, shaOf(FILING_NEW), first);
    await seedIndexed(workspaceId, userId, shaOf(FILING_OLD), second);
    const outFile = fresh("bench.json");
    const qwen = new FakeEmbedder(QWEN_ID);
    const seen: { texts: string[]; kind: string }[] = [];
    const recording: Embedder = {
      model: QWEN_ID,
      servedModel: () => qwen.servedModel(),
      embed: (texts, kind) => (seen.push({ texts, kind }), qwen.embed(texts, kind)),
    };

    const r = await run(
      ["bench", "--workspace", workspaceId, "--request", requestFile, "--out", outFile, "--model", QWEN_ID, "--embedder-url", "http://embedder", "--chunks", "30"],
      recording,
    );
    expect(r.code).toBe(0);
    // The default batch is 16: the first batch is the warm-up, so 14 of the 30 chunks are timed.
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatch(new RegExp(`^bench ${QWEN_ID}: 14 chunks in [0-9.e-]+ s, query median [0-9.e-]+ ms$`));
    const bench = EvalBench.parse(JSON.parse(readFileSync(outFile, "utf8")));
    expect(bench).toMatchObject({ model: QWEN_ID, batch: 16, chunks: 14, warmupChunks: 16, queries: 1 });

    // The texts are the first 30 chunks in document order, page order and seq order, contextualized.
    const expected = [...first, ...second].slice(0, 30).map((c) => contextualize(c.sectionPath, c.text));
    const documents = seen.filter((s) => s.kind === "document").flatMap((s) => s.texts);
    expect([...documents].sort()).toEqual([...expected].sort());
    // Each question is sent alone, as a query.
    expect(seen.filter((s) => s.kind === "query")).toEqual([{ texts: ["What did the auditors say about internal financial controls?"], kind: "query" }]);
  });
});

describe("benchEmbedder", () => {
  /** An embedder whose clock advances 1000 ms for each call to embed. */
  function ticking() {
    let now = 0;
    const fake = new FakeEmbedder();
    const embedder: Embedder = {
      model: fake.model,
      servedModel: () => fake.servedModel(),
      embed: async (texts, kind) => {
        now += 1000;
        return fake.embed(texts, kind);
      },
    };
    return { embedder, clock: () => now };
  }
  const texts = (n: number) => Array.from({ length: n }, (_, i) => `text ${i}`);

  it("bench leaves the warm-up out", async () => {
    const { embedder, clock } = ticking();
    expect(await benchEmbedder(embedder, texts(48), 16, ["a", "b", "c"], clock)).toEqual({
      batch: 16, chunks: 32, warmupChunks: 16, seconds: 2, queries: 3, queryMillisMedian: 1000,
    });
  });

  it("bench runs on the default clock", async () => {
    const r = await benchEmbedder(new FakeEmbedder(), texts(48), 16, ["q"]);
    expect(Number.isFinite(r.seconds) && r.seconds >= 0).toBe(true);
    expect(Number.isFinite(r.queryMillisMedian) && r.queryMillisMedian >= 0).toBe(true);
    expect(r).toMatchObject({ batch: 16, chunks: 32, warmupChunks: 16, queries: 1 });
  });

  it("sends the longest texts first and takes the median of an even number of queries as their mean", async () => {
    const sent: string[][] = [];
    const fake = new FakeEmbedder();
    let now = 0;
    // The clock moves 500 ms for each document call and 10, then 30 ms for the two query calls.
    let queryCall = 0;
    const embedder: Embedder = {
      model: fake.model,
      servedModel: () => fake.servedModel(),
      embed: async (t, kind) => {
        sent.push(t);
        now += kind === "document" ? 500 : [10, 30][queryCall++]!;
        return fake.embed(t, kind);
      },
    };
    const r = await benchEmbedder(embedder, ["aa", "b", "cccc", "ddd"], 2, ["q1", "q2"], () => now);
    expect(sent.slice(0, 2)).toEqual([["cccc", "ddd"], ["aa", "b"]]);
    expect(r).toEqual({ batch: 2, chunks: 2, warmupChunks: 2, seconds: 0.5, queries: 2, queryMillisMedian: 20 });
  });

  it("refuses texts that fit in the warm-up batch alone", async () => {
    await expect(benchEmbedder(new FakeEmbedder(), texts(16), 16, ["q"])).rejects.toThrow(/more than one batch/);
  });
});
