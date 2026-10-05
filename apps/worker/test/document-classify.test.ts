import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { readVersion } from "@maester/jobs";
import { HttpExtractorClient } from "../src/extractor.js";
import { documentClassify, writeClassification } from "../src/jobs/document-classify.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/classification/${name}`, import.meta.url), "utf8");
const ANNUAL = fixture("result-annual-report.json");
const SECRET = "extractor-test-secret";

type Reply = (res: ServerResponse) => void;
let reply: Reply;
let seen: IncomingMessage["headers"][] = [];
let server: Server;
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
const json = (body: string, status = 200): Reply => (res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body); };
const withKind = (kind: string, otherType: string | null = null) => {
  const body = JSON.parse(ANNUAL);
  Object.assign(body.result, { kind, otherType, periodEnd: null, periodLabel: null });
  return JSON.stringify(body);
};

beforeAll(async () => {
  server = createServer((req, res) => { req.resume(); req.on("end", () => { seen.push(req.headers); reply(res); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify }, { extractor: new HttpExtractorClient(url, { kind: "secret", secret: SECRET }, 10_000) });
});
afterAll(async () => { await ctx.close(); await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => { seen = []; reply = json(ANNUAL); });

async function seedStored(opts: { companies?: string[]; uploadCompany?: boolean } = {}) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyIds: string[] = [];
  for (const displayName of opts.companies ?? []) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.company).values({ id, workspaceId, displayName, country: "IN", createdByUserId: userId });
    companyIds.push(id);
  }
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.pdf`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, companyId: opts.uploadCompany ? companyIds[0]! : null, originalName: "ar.pdf", declaredSize: 10,
    declaredMime: "application/pdf", storageKey, state: "stored", sizeBytes: 10, intakeState: "identifying", createdByUserId: userId,
  });
  await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  return { workspaceId, id, companyIds };
}
async function classify(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, docId));
  const rows = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, docId));
  return { res, job: job!, doc: doc!, rows };
}

describe("document.classify", () => {
  it("stores the answers with their evidence, matches the company by name and starts the read", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const { job, doc, rows } = await classify(d.workspaceId, d.id);
    expect(seen[0]!["x-extractor-secret"]).toBe(SECRET);
    expect(job.state).toBe("succeeded");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ kind: "annual_report", companyId: d.companyIds[0], setBy: "maester", readsUnderId: row.id, periodEnd: "2026-03-31" });
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(evidence.map((e) => e.field).sort()).toEqual(["company", "identifier", "kind", "period", "statements"]);
    expect(doc).toMatchObject({ intakeState: "reading", companyId: d.companyIds[0] });
    const read = ctx.dispatcher.enqueued.find((j) => j.subjectId === d.id && j.type === JobTypes.DOCUMENT_EXTRACT);
    expect(read!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${d.id}:${readVersion(row.id)}`);
  });

  it("holds when the company is new or ambiguous", async () => {
    const none = await seedStored();
    expect((await classify(none.workspaceId, none.id)).doc.intakeState).toBe("needs_company");
    const twins = await seedStored({ companies: ["Synthetic Cements Ltd", "Synthetic Cements Limited"] });
    const r = await classify(twins.workspaceId, twins.id);
    expect(r.doc.intakeState).toBe("needs_company");
    expect(r.rows[0]!.readsUnderId).toBeNull();
  });

  it("uses the company given at upload as the investor's answer", async () => {
    const d = await seedStored({ companies: ["Somebody Else Ltd"], uploadCompany: true });
    const { rows, doc } = await classify(d.workspaceId, d.id);
    expect(rows[0]!.companyId).toBe(d.companyIds[0]);
    expect(doc.intakeState).toBe("reading");
    const investor = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.source, "investor"));
    expect(investor.some((e) => e.classificationId === rows[0]!.id && e.field === "company")).toBe(true);
  });

  it("keeps other documents and holds not_sure", async () => {
    reply = json(withKind("other", "shareholding_pattern"));
    const other = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    expect((await classify(other.workspaceId, other.id)).doc.intakeState).toBe("kept");
    reply = json(withKind("not_sure"));
    const unsure = await seedStored();
    expect((await classify(unsure.workspaceId, unsure.id)).doc.intakeState).toBe("needs_kind");
  });

  it("a permanent error fails the job and marks identify_failed", async () => {
    reply = json(fixture("error-unreadable.json"));
    const d = await seedStored();
    const { job, doc } = await classify(d.workspaceId, d.id);
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "UNREADABLE_PDF" });
    expect(doc.intakeState).toBe("identify_failed");
  });

  it("an unavailable extractor is retried and leaves the document identifying", async () => {
    reply = json("{}", 503);
    const d = await seedStored();
    const { res, job, doc } = await classify(d.workspaceId, d.id);
    expect(res.body.outcome).toBe("retry");
    expect(job.lastErrorCode).toBe("EXTRACTOR_HTTP_503");
    expect(doc.intakeState).toBe("identifying");
  });

  it("an unreadable answer is a permanent INVALID_CLASSIFIER_RESULT", async () => {
    reply = json(JSON.stringify({ type: "result", result: { kind: "brochure" } }));
    const d = await seedStored();
    expect((await classify(d.workspaceId, d.id)).job.lastErrorCode).toBe("INVALID_CLASSIFIER_RESULT");
  });

  it("without an extractor it fails with CLASSIFIER_NOT_CONFIGURED", async () => {
    const bare = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify });
    try {
      const { workspaceId, userId } = await seedWorkspace(bare.db);
      const id = crypto.randomUUID();
      await bare.db.insert(schema.document).values({
        id, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
        storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState: "identifying", createdByUserId: userId,
      });
      const jobId = await seedJob(bare.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: id });
      await runJob(bare, JobTypes.DOCUMENT_CLASSIFY, jobId);
      const [job] = await bare.db.select().from(schema.job).where(eq(schema.job.id, jobId));
      const [doc] = await bare.db.select().from(schema.document).where(eq(schema.document.id, id));
      expect(job!.lastErrorCode).toBe("CLASSIFIER_NOT_CONFIGURED");
      expect(doc!.intakeState).toBe("identify_failed");
    } finally {
      await bare.close();
    }
  });

  it("writeClassification is idempotent per job", async () => {
    const d = await seedStored();
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    const result = JSON.parse(ANNUAL).result;
    const a = await writeClassification(ctx.db, job!, { id: d.id, companyId: null }, result, null);
    const b = await writeClassification(ctx.db, job!, { id: d.id, companyId: null }, result, null);
    expect(b.id).toBe(a.id);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, a.id));
    expect(evidence).toHaveLength(5);
  });
  it("re-running a job whose classification was already written still decides the intake", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    await writeClassification(ctx.db, job!, { id: d.id, companyId: null }, JSON.parse(ANNUAL).result, d.companyIds[0]!);
    const [before] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(before!.intakeState).toBe("identifying");
    await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
    const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(doc!.intakeState).toBe("reading");
    expect(ctx.dispatcher.enqueued.filter((j) => j.subjectId === d.id && j.type === JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });
});
