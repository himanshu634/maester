import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { HttpExtractorClient } from "../src/extractor.js";
import { documentExtract, writeRevision } from "../src/jobs/document-extract.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/extraction/${name}`, import.meta.url), "utf8");
const RESULT_STREAM = fixture("stream-result.ndjson");
const RESULT_LINE = JSON.parse(RESULT_STREAM.trim().split("\n").at(-1)!) as { result: Parameters<typeof writeRevision>[3] };
const SECRET = "extractor-test-secret";

type Reply = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void | Promise<void>;
let reply: Reply;
let seen: { headers: IncomingMessage["headers"]; body: Buffer }[] = [];
let server: Server;
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;

const streamLines = (lines: string, status = 200): Reply => (_req, res) => {
  res.writeHead(status, { "content-type": "application/x-ndjson" });
  res.end(lines);
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ headers: req.headers, body });
      void reply(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ctx = await createWorkerContext(
    { [JobTypes.DOCUMENT_EXTRACT]: documentExtract },
    { extractor: new HttpExtractorClient(url, { kind: "secret", secret: SECRET }, 10_000) },
  );
});
afterAll(async () => {
  await ctx.close();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  seen = [];
  reply = streamLines(RESULT_STREAM);
});

async function seedStoredDocument(opts: { sizeBytes?: number; put?: boolean } = {}) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyId = crypto.randomUUID();
  await ctx.db.insert(schema.company).values({ id: companyId, workspaceId, displayName: "Synthetic Industries Ltd", country: "IN", createdByUserId: userId });
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, companyId, originalName: "fy26.pdf", declaredSize: 10, declaredMime: "application/pdf", storageKey,
    state: "stored", sizeBytes: opts.sizeBytes ?? 10, createdByUserId: userId,
  });
  if (opts.put !== false) await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  return { workspaceId, companyId, id };
}

async function extract(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  return { res, job: job! };
}

describe("document.extract", () => {
  it("streams the PDF to the extractor and stores an immutable revision with facts, sources and checks", async () => {
    const doc = await seedStoredDocument();
    const { res, job } = await extract(doc.workspaceId, doc.id);

    expect(res.status).toBe(200);
    expect(job.state).toBe("succeeded");
    expect(job.progress).toEqual({ stage: "stored", percent: 100 });
    expect(seen[0]!.headers["x-extractor-secret"]).toBe(SECRET);
    expect(seen[0]!.headers["x-document-id"]).toBe(doc.id);
    expect(decodeURIComponent(seen[0]!.headers["x-company-name"] as string)).toBe("Synthetic Industries Ltd");
    expect(seen[0]!.body.toString()).toBe("%PDF-1.4 x");

    const [revision] = await ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.jobId, job.id));
    expect(revision).toMatchObject({ documentId: doc.id, state: "partial", pageCount: 120, model: "gemini-2.5-pro" });
    expect(revision!.coverage.statements).toHaveLength(2);
    expect(revision!.warnings[0]!.code).toBe("CORRECTION_REJECTED");
    expect(job.result).toEqual({ outcome: "extracted", revisionId: revision!.id, state: "partial", factCount: 4, failedChecks: 0 });

    const facts = await ctx.db
      .select({ fact: schema.financialFact, source: schema.sourceReference })
      .from(schema.financialFact)
      .innerJoin(schema.sourceReference, eq(schema.sourceReference.factId, schema.financialFact.id))
      .where(eq(schema.financialFact.revisionId, revision!.id))
      .orderBy(schema.financialFact.lineOrder);
    expect(facts.map((f) => f.fact.reportedValue)).toEqual(["123456.50", "-2500", null, "120956.5"]);
    expect(facts[0]!.fact.normalizedValue).toBe("1234565000000.00");
    expect(facts[0]!.fact.asOfDate).toBe("2026-03-31");
    expect(facts[0]!.fact.companyId).toBe(doc.companyId);
    expect(facts.map((f) => [f.source.pageIndex, f.source.textLayerMatch])).toEqual([[4, true], [5, null], [4, true], [4, false]]);

    const checks = await ctx.db.select().from(schema.extractionCheck).where(eq(schema.extractionCheck.revisionId, revision!.id));
    expect(checks.map((c) => c.status).sort()).toEqual(["not_checked", "passed"]);
  });

  it("does not write a second revision when the same job runs again", async () => {
    const doc = await seedStoredDocument();
    const jobId = await seedJob(ctx.db, doc.workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: doc.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    const first = await writeRevision(ctx.db, job!, doc, RESULT_LINE.result);
    const second = await writeRevision(ctx.db, job!, doc, RESULT_LINE.result);
    expect(second).toEqual(first);
    const revisions = await ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.documentId, doc.id));
    expect(revisions).toHaveLength(1);
    const facts = await ctx.db.select().from(schema.financialFact).where(eq(schema.financialFact.revisionId, first.revisionId));
    expect(facts).toHaveLength(4);
  });

  it("fails permanently on a non-retryable extractor error and keeps its code", async () => {
    reply = streamLines(fixture("stream-error.ndjson"));
    const doc = await seedStoredDocument();
    const { job } = await extract(doc.workspaceId, doc.id);
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "NO_STATEMENTS_FOUND" });
    expect(await ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.documentId, doc.id))).toHaveLength(0);
  });

  it("requeues on a retryable extractor error", async () => {
    reply = streamLines('{"type":"error","code":"MODEL_UNAVAILABLE","retryable":true,"message":"try later"}\n');
    const doc = await seedStoredDocument();
    const { res, job } = await extract(doc.workspaceId, doc.id);
    expect(res.status).toBe(500);
    expect(job).toMatchObject({ state: "queued", lastErrorCode: "MODEL_UNAVAILABLE" });
  });

  it("treats a stream that ends without a result as retryable", async () => {
    reply = streamLines('{"type":"started","pipelineVersion":"p","model":"m","promptVersion":"v"}\n{"type":"heartbeat"}\n');
    const doc = await seedStoredDocument();
    const { job } = await extract(doc.workspaceId, doc.id);
    expect(job).toMatchObject({ state: "queued", lastErrorCode: "EXTRACTOR_STREAM_INTERRUPTED" });
  });

  it("fails permanently on an unreadable result", async () => {
    reply = streamLines('{"type":"result","result":{"facts":"nope"}}\n');
    const doc = await seedStoredDocument();
    const { job } = await extract(doc.workspaceId, doc.id);
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "INVALID_EXTRACTOR_RESULT" });
  });

  it("maps HTTP refusals and outages", async () => {
    const doc = await seedStoredDocument();
    reply = streamLines("{}", 401);
    expect((await extract(doc.workspaceId, doc.id)).job).toMatchObject({ state: "failed", lastErrorCode: "EXTRACTOR_UNAUTHORIZED" });
    reply = streamLines("{}", 413);
    expect((await extract(doc.workspaceId, doc.id)).job).toMatchObject({ state: "failed", lastErrorCode: "TOO_LARGE_FOR_EXTRACTION" });
    reply = streamLines("{}", 503);
    expect((await extract(doc.workspaceId, doc.id)).job).toMatchObject({ state: "queued", lastErrorCode: "EXTRACTOR_HTTP_503" });
  });

  it("refuses oversized and missing documents without calling the extractor", async () => {
    const big = await seedStoredDocument({ sizeBytes: 31457281 });
    expect((await extract(big.workspaceId, big.id)).job).toMatchObject({ state: "failed", lastErrorCode: "TOO_LARGE_FOR_EXTRACTION" });
    const missing = await seedStoredDocument({ put: false });
    expect((await extract(missing.workspaceId, missing.id)).job).toMatchObject({ state: "failed", lastErrorCode: "OBJECT_MISSING" });
    expect(seen).toHaveLength(0);
  });

  it("relays progress to the job and renews the lease while the stream runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    reply = async (_req, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write('{"type":"started","pipelineVersion":"p","model":"m","promptVersion":"v"}\n{"type":"progress","stage":"locate","percent":20}\n');
      await gate;
      res.end(RESULT_STREAM.trim().split("\n").at(-1) + "\n");
    };
    const doc = await seedStoredDocument();
    const jobId = await seedJob(ctx.db, doc.workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: doc.id });
    const running = runJob(ctx, JobTypes.DOCUMENT_EXTRACT, jobId);

    let row = (await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId)))[0]!;
    for (let i = 0; i < 100 && row.progress.stage !== "locate"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      row = (await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId)))[0]!;
    }
    expect(row.progress).toEqual({ stage: "locate", percent: 20 });
    release();
    expect((await running).status).toBe(200);
  });
});

describe("document.extract without an extractor", () => {
  it("fails permanently with EXTRACTOR_NOT_CONFIGURED", async () => {
    const bare = await createWorkerContext({ [JobTypes.DOCUMENT_EXTRACT]: documentExtract });
    try {
      const { workspaceId } = await seedWorkspace(bare.db);
      const jobId = await seedJob(bare.db, workspaceId, { type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: crypto.randomUUID() });
      await runJob(bare, JobTypes.DOCUMENT_EXTRACT, jobId);
      const [job] = await bare.db.select().from(schema.job).where(eq(schema.job.id, jobId));
      expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "EXTRACTOR_NOT_CONFIGURED" });
    } finally {
      await bare.close();
    }
  });
});
