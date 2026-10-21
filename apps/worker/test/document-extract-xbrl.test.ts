import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes, type ExtractionResult } from "@maester/contracts";
import { schema, type ClassificationRow } from "@maester/db";
import { decideIntake, redecidePdfsAfterXbrl } from "@maester/jobs";
import type { ExtractorClient } from "../src/extractor.js";
import { documentExtract } from "../src/jobs/document-extract.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

const STREAM = readFileSync(new URL("../../../packages/contracts/fixtures/extraction/stream-result.ndjson", import.meta.url), "utf8");
const RESULT = (JSON.parse(STREAM.trim().split("\n").at(-1)!) as { result: ExtractionResult }).result;

/** A fake extractor that counts its paid reads; any other mode is a defect here. */
let extractCalls = 0;
const extractor = {
  extract: async () => {
    extractCalls++;
    return RESULT;
  },
  classify: async () => { throw new Error("classify is not used here"); },
  xbrl: async () => { throw new Error("xbrl is not used here"); },
} as unknown as ExtractorClient;

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext({ [JobTypes.DOCUMENT_EXTRACT]: documentExtract }, { extractor }); });
afterAll(() => ctx.close());
beforeEach(() => { extractCalls = 0; });

const PERIOD = "2025-09-30";
type Pair = { statement: "income_statement"; basis: "consolidated" | "standalone" };
const BOTH: Pair[] = [{ statement: "income_statement", basis: "consolidated" }, { statement: "income_statement", basis: "standalone" }];
type IntakeState = NonNullable<typeof schema.document.$inferInsert.intakeState>;

interface Ws { workspaceId: string; userId: string; companyId: string }

async function seedWs(): Promise<Ws> {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyId = crypto.randomUUID();
  await ctx.db.insert(schema.company).values({ id: companyId, workspaceId, displayName: `Synthetic Cements ${companyId}`, country: "IN", createdByUserId: userId, bseCode: "500999" });
  return { workspaceId, userId, companyId };
}

async function insertDoc(ws: Ws, format: "pdf" | "xbrl", intakeState: IntakeState) {
  const id = crypto.randomUUID();
  const ext = format === "pdf" ? "pdf" : "xml";
  const storageKey = `workspaces/${ws.workspaceId}/documents/${id}/original.${ext}`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId: ws.workspaceId, originalName: `results.${ext}`, declaredSize: 10, declaredMime: format === "pdf" ? "application/pdf" : "application/xml",
    format, storageKey, state: "stored", sizeBytes: 10, intakeState, createdByUserId: ws.userId,
  });
  if (format === "pdf") await ctx.store.put(storageKey, new TextEncoder().encode("%PDF-1.4 x"), "application/pdf");
  return id;
}

async function classify(ws: Ws, documentId: string, c: Partial<typeof schema.documentClassification.$inferInsert> = {}): Promise<ClassificationRow> {
  const id = crypto.randomUUID();
  const [row] = await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId: ws.workspaceId, documentId, kind: "financial_results", setBy: "maester", companyId: ws.companyId, periodEnd: PERIOD,
    readsUnderId: id, createdAt: sql`clock_timestamp()`, ...c,
  }).returning();
  return row!;
}

/** A results PDF decided while no XBRL was in: intake sends it to Gemini with an automatic document.extract job. */
async function pdfSentToRead(ws: Ws, kind: "financial_results" | "annual_report" = "financial_results") {
  const id = await insertDoc(ws, "pdf", "identifying");
  const row = await classify(ws, id, { kind, statementsFound: BOTH.map((p) => ({ ...p, pages: [2] })) });
  expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("reading");
  const [job] = await ctx.db.select().from(schema.job).where(and(eq(schema.job.subjectId, id), eq(schema.job.type, JobTypes.DOCUMENT_EXTRACT)));
  return { id, row, jobId: job!.id };
}

/** An XBRL instance of the company and period, read, with a fact in `pair`. */
async function readXbrl(ws: Ws, pair: Pair) {
  const id = await insertDoc(ws, "xbrl", "read");
  const row = await classify(ws, id, { bseCode: "500999", basis: pair.basis });
  const jobId = await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: id, state: "succeeded" });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId: ws.workspaceId, documentId: id, jobId, classificationId: row.id, source: "xbrl", state: "complete",
    pipelineVersion: "xbrl-1", model: "xbrl-parser-1", promptVersion: "in-capmkt/ind_as@1", pageCount: 0, coverage: { statements: [] },
  });
  await ctx.db.insert(schema.financialFact).values({
    id: crypto.randomUUID(), workspaceId: ws.workspaceId, revisionId, companyId: ws.companyId, statement: pair.statement, basis: pair.basis,
    section: "s", lineOrder: 0, reportedLabel: "line", isSubtotal: false, periodLabel: "Quarter ended 30 Sep 2025",
    periodEnd: PERIOD, span: "quarter", reportedText: "", valueStatus: "unparsed",
  });
  return id;
}

const docOf = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;
const jobOf = async (id: string) => (await ctx.db.select().from(schema.job).where(eq(schema.job.id, id)))[0]!;
const revisionsOf = (id: string) => ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.documentId, id));

describe("document.extract asks the source rule again before a paid read", () => {
  it("a results PDF that XBRL came to cover after the decision is not read: read, no revision, no extractor call", async () => {
    const ws = await seedWs();
    const pdf = await pdfSentToRead(ws);
    for (const pair of BOTH) await readXbrl(ws, pair);

    const res = await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, pdf.jobId);
    expect(res.status).toBe(200);
    expect(extractCalls).toBe(0);
    expect(await jobOf(pdf.jobId)).toMatchObject({ state: "succeeded", result: { outcome: "not_read", plan: "skip" } });
    expect((await docOf(pdf.id)).intakeState).toBe("read");
    expect(await revisionsOf(pdf.id)).toHaveLength(0);
  });

  it("a results PDF whose XBRL is still settling waits, with no extractor call; once that XBRL fails, the same job runs again and reads it", async () => {
    const ws = await seedWs();
    const pdf = await pdfSentToRead(ws);
    const xbrl = await insertDoc(ws, "xbrl", "identifying");

    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, pdf.jobId);
    expect(extractCalls).toBe(0);
    expect(await jobOf(pdf.jobId)).toMatchObject({ state: "succeeded", result: { outcome: "not_read", plan: "wait" } });
    expect((await docOf(pdf.id)).intakeState).toBe("waiting_for_xbrl");

    await ctx.db.update(schema.document).set({ intakeState: "identify_failed" }).where(eq(schema.document.id, xbrl));
    const before = ctx.dispatcher.enqueued.length;
    expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId)).toBe(1);
    expect((await docOf(pdf.id)).intakeState).toBe("reading");
    // The read's key is the stood-down job's: it is queued again and dispatched, not handed back finished.
    expect(await jobOf(pdf.jobId)).toMatchObject({ state: "queued", result: null, finishedAt: null });
    expect(ctx.dispatcher.enqueued.slice(before).map((j) => j.id)).toContain(pdf.jobId);

    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, pdf.jobId);
    expect(extractCalls).toBe(1);
    expect(await jobOf(pdf.jobId)).toMatchObject({ state: "succeeded", result: { outcome: "extracted" } });
    expect((await docOf(pdf.id)).intakeState).toBe("read");
    expect(await revisionsOf(pdf.id)).toHaveLength(1);
  });

  it("a finished read is never queued again by a later decision", async () => {
    const ws = await seedWs();
    const pdf = await pdfSentToRead(ws);
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, pdf.jobId);
    expect(extractCalls).toBe(1);
    expect(await decideIntake(ctx.db, ctx.dispatcher, pdf.row, { read: true })).toBe("reading");
    expect(await jobOf(pdf.jobId)).toMatchObject({ state: "succeeded", result: { outcome: "extracted" } });
  });

  it("a manual re-read is not asked again (the API refuses a covered one), and an annual report is read as before", async () => {
    const ws = await seedWs();
    const results = await pdfSentToRead(ws);
    for (const pair of BOTH) await readXbrl(ws, pair);
    const manual = await seedJob(ctx.db, ws.workspaceId, {
      type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: results.id,
      idempotencyKey: `${JobTypes.DOCUMENT_EXTRACT}:${results.id}:manual-${crypto.randomUUID()}`,
    });
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, manual);
    expect(extractCalls).toBe(1);

    const annual = await pdfSentToRead(ws, "annual_report");
    await runJob(ctx, JobTypes.DOCUMENT_EXTRACT, annual.jobId);
    expect(extractCalls).toBe(2);
    expect((await docOf(annual.id)).intakeState).toBe("read");
  });
});
