import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes, XBRL_CHECK_SUBJECT } from "@maester/contracts";
import { getCurrentRevision, schema, type ClassificationRow } from "@maester/db";
import { decideIntake, readVersion } from "@maester/jobs";
import { documentXbrl, writeXbrlRevision } from "../src/jobs/document-xbrl.js";
import { JobFailure } from "../src/jobs/types.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob } from "./context.js";
import {
  addDoc, classifyDoc, FakeExtractor, failedSumRead, INSTANCE_TEXT, PDF_STATEMENTS, PERIOD, READ_RESULT, seedXbrlWs, unmappedRead, type XbrlWs,
} from "./xbrl-fixtures.js";

const fake = new FakeExtractor();
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => {
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_XBRL]: documentXbrl }, { extractor: fake.client });
});
afterAll(() => ctx.close());
beforeEach(() => fake.reset());

const docOf = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;
const jobsOf = (subjectId: string, type: string) =>
  ctx.db.select().from(schema.job).where(and(eq(schema.job.subjectId, subjectId), eq(schema.job.type, type)));
const revisionsOf = (documentId: string) => ctx.db.select().from(schema.extractionRevision).where(eq(schema.extractionRevision.documentId, documentId));

/** An XBRL document classified for the company and period, with its document.xbrl job created by decideIntake. */
async function addXbrl(ws: XbrlWs, c: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = await addDoc(ctx.db, ctx.store, ws, "xbrl");
  const row = await classifyDoc(ctx.db, ws, id, { xbrlFormat: "in-capmkt/ind_as", basis: "consolidated", ...c });
  expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("reading");
  const [job] = await jobsOf(id, JobTypes.DOCUMENT_XBRL);
  return { id, row, jobId: job!.id };
}

async function addResultsPdf(ws: XbrlWs, extra: Partial<typeof schema.document.$inferInsert> = {}) {
  const id = await addDoc(ctx.db, ctx.store, ws, "pdf", { intakeState: "read", ...extra });
  const row = await classifyDoc(ctx.db, ws, id, { statementsFound: PDF_STATEMENTS });
  return { id, row };
}

async function run(jobId: string) {
  await runJob(ctx, JobTypes.DOCUMENT_XBRL, jobId);
  return (await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId)))[0]!;
}

/** Run a job again as a retry would: back to queued, an attempt left. */
async function rerun(jobId: string) {
  await ctx.db.update(schema.job).set({ state: "queued", attempt: 1, leaseToken: null, leaseExpiresAt: null }).where(eq(schema.job.id, jobId));
  return run(jobId);
}

describe("document.xbrl", () => {
  it("reads an instance into one xbrl revision: page_count 0, xbrl_source per fact, no source_reference, the checks, the document read", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    const job = await run(x.jobId);

    expect(job.state).toBe("succeeded");
    expect(job.progress).toEqual({ stage: "stored", percent: 100 });
    expect(fake.readCalls).toBe(1);
    const [revision, ...more] = await revisionsOf(x.id);
    expect(more).toHaveLength(0);
    expect(revision).toMatchObject({
      source: "xbrl", pageCount: 0, classificationId: x.row.id, state: "complete", pipelineVersion: "xbrl-1", model: "xbrl-parser-1",
      promptVersion: "in-capmkt/ind_as@1", companyNameAsPrinted: null, warnings: READ_RESULT.warnings,
    });
    expect(revision!.coverage.statements).toEqual([
      { statement: "income_statement", basis: "consolidated", pages: [], status: "extracted" },
      { statement: "cash_flow", basis: "consolidated", pages: [], status: "extracted" },
    ]);
    expect(job.result).toEqual({ outcome: "read", revisionId: revision!.id, state: "complete", factCount: 4, failedChecks: 0, format: "in-capmkt/ind_as", mapped: true });

    const facts = await ctx.db
      .select({ fact: schema.financialFact, source: schema.xbrlSource })
      .from(schema.financialFact)
      .leftJoin(schema.xbrlSource, eq(schema.xbrlSource.factId, schema.financialFact.id))
      .where(eq(schema.financialFact.revisionId, revision!.id))
      .orderBy(schema.financialFact.lineOrder);
    expect(facts.map((f) => [f.fact.reportedValue, f.fact.normalizedValue, f.fact.valueStatus, f.fact.span, f.fact.periodStart])).toEqual([
      ["12345.00", "1234500000", "value", "quarter", "2025-07-01"],
      [null, null, "unparsed", "quarter", "2025-07-01"],
      ["12.34", "12.34", "value", "quarter", "2025-07-01"],
      ["2500.00", "250000000", "value", "half_year", "2025-04-01"],
    ]);
    expect(facts.every((f) => f.fact.companyId === ws.companyId)).toBe(true);
    expect(facts.map((f) => f.source && [f.source.documentId, f.source.element, f.source.contextId, f.source.decimals, f.source.nil, f.source.concept])).toEqual([
      [x.id, "RevenueFromOperations", "OneD", "-3", false, "revenue_from_operations"],
      [x.id, "OtherIncome", "OneD", "-5", true, "other_income"],
      [x.id, "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INF", false, "eps_basic"],
      [x.id, "CashAndCashEquivalentsCashFlowStatement", "OneI", "-5", false, "cash_at_end_of_period"],
    ]);
    const { rows: refs } = await ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from source_reference s join financial_fact f on f.id = s.fact_id where f.revision_id = ${revision!.id}`);
    expect(refs[0]!.n).toBe(0);

    const checks = await ctx.db.select().from(schema.extractionCheck).where(eq(schema.extractionCheck.revisionId, revision!.id));
    expect(checks.map((c) => [c.checkType, c.subjectLabel, c.status, c.detail])).toEqual([["subtotal", "Total income", "not_checked", "no value: OtherIncome"]]);
    expect((await docOf(x.id)).intakeState).toBe("read");
    expect(await getCurrentRevision(ctx.db, ws.workspaceId, x.id)).toMatchObject({ id: revision!.id });
  });

  it("a retry after a crash that followed the commit writes nothing new, marks the document read and calls no extractor", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, x.jobId));
    const doc = await docOf(x.id);
    const written = await writeXbrlRevision(ctx.db, job!, { id: doc.id, companyId: ws.companyId }, READ_RESULT, x.row.id);
    expect((await docOf(x.id)).intakeState).toBe("reading");

    const after = await run(x.jobId);
    expect(after).toMatchObject({ state: "succeeded", result: written });
    expect(fake.readCalls).toBe(0);
    expect(await revisionsOf(x.id)).toHaveLength(1);
    expect((await docOf(x.id)).intakeState).toBe("read");
    const { rows } = await ctx.db.execute<{ facts: number; sources: number }>(sql`
      select (select count(*)::int from financial_fact where revision_id = ${written.revisionId}) as facts,
             (select count(*)::int from xbrl_source s join financial_fact f on f.id = s.fact_id where f.revision_id = ${written.revisionId}) as sources`);
    expect(rows[0]).toEqual({ facts: 4, sources: 4 });
  });

  it("failedChecks counts the revision's own failed sums, never xbrl_in_pdf rows that came later", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    fake.read = failedSumRead();
    const first = await run(x.jobId);
    expect(first.result).toMatchObject({ failedChecks: 1 });
    const revisionId = (first.result as { revisionId: string }).revisionId;
    const pdf = await addResultsPdf(ws);
    const [fact] = await ctx.db.select().from(schema.financialFact).where(eq(schema.financialFact.revisionId, revisionId)).limit(1);
    await ctx.db.insert(schema.extractionCheck).values({
      id: crypto.randomUUID(), workspaceId: ws.workspaceId, revisionId, checkType: "xbrl_in_pdf", statement: "income_statement",
      basis: "consolidated", periodLabel: "p", subjectLabel: "s", status: "failed", detail: "", factId: fact!.id,
      pdfDocumentId: pdf.id, pdfClassificationId: pdf.row.id, checkVersion: 1,
    });
    const again = await rerun(x.jobId);
    expect(again.result).toEqual(first.result);
  });

  it("an unmapped read writes a revision with no facts and the warning; the document is read and the result says mapped: false", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws, { xbrlFormat: "in-capmkt/banking" });
    fake.read = unmappedRead();
    const job = await run(x.jobId);
    const [revision] = await revisionsOf(x.id);
    expect(revision).toMatchObject({ source: "xbrl", promptVersion: "in-capmkt/banking@-", coverage: { statements: [] } });
    expect(revision!.warnings.map((w) => w.code)).toEqual(["XBRL_FORMAT_UNMAPPED"]);
    expect(await ctx.db.select().from(schema.financialFact).where(eq(schema.financialFact.revisionId, revision!.id))).toHaveLength(0);
    expect(job.result).toEqual({ outcome: "read", revisionId: revision!.id, state: "complete", factCount: 0, failedChecks: 0, format: "in-capmkt/banking", mapped: false });
    expect((await docOf(x.id)).intakeState).toBe("read");
    // The same answer when a retry finds the revision.
    expect((await rerun(x.jobId)).result).toEqual(job.result);
  });

  it("XBRL_UNREADABLE fails at once with read_failed, and a PDF waiting for the instance is released to Gemini", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    const pdfId = await addDoc(ctx.db, ctx.store, ws, "pdf");
    const pdfRow = await classifyDoc(ctx.db, ws, pdfId, { statementsFound: PDF_STATEMENTS });
    expect(await decideIntake(ctx.db, ctx.dispatcher, pdfRow, { read: true })).toBe("waiting_for_xbrl");

    fake.read = new JobFailure("XBRL_UNREADABLE", "the instance could not be read", false);
    const job = await run(x.jobId);
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "XBRL_UNREADABLE" });
    expect(await revisionsOf(x.id)).toHaveLength(0);
    expect((await docOf(x.id)).intakeState).toBe("read_failed");
    expect((await docOf(pdfId)).intakeState).toBe("reading");
    const [extract] = await jobsOf(pdfId, JobTypes.DOCUMENT_EXTRACT);
    expect(extract!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${pdfId}:${readVersion(pdfRow.id)}`);
  });

  it("a final failure of a superseded read leaves the document as it is", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    await classifyDoc(ctx.db, ws, x.id, { setBy: "investor" });
    fake.read = new JobFailure("XBRL_UNREADABLE", "the instance could not be read", false);
    await run(x.jobId);
    expect((await docOf(x.id)).intakeState).toBe("reading");
  });

  it("the read releases a PDF that waited for it: covered, the PDF is read with no Gemini job", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    const pdfId = await addDoc(ctx.db, ctx.store, ws, "pdf");
    const pdfRow = await classifyDoc(ctx.db, ws, pdfId, { statementsFound: PDF_STATEMENTS });
    expect(await decideIntake(ctx.db, ctx.dispatcher, pdfRow, { read: true })).toBe("waiting_for_xbrl");
    await run(x.jobId);
    expect((await docOf(pdfId)).intakeState).toBe("read");
    expect(await jobsOf(pdfId, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
  });

  it("a stored results PDF of the same company and period gets one document.xbrl_check job; a retry of the read adds none", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const pdf = await addResultsPdf(ws);
    const elsewhere = await addResultsPdf(ws, {});
    await ctx.db.update(schema.documentClassification).set({ periodEnd: "2025-06-30" }).where(eq(schema.documentClassification.id, elsewhere.row.id));
    await addResultsPdf(ws, { duplicateOfDocumentId: pdf.id, intakeState: "duplicate" });
    const x = await addXbrl(ws);
    const job = await run(x.jobId);
    const revisionId = (job.result as { revisionId: string }).revisionId;

    const checks = await jobsOf(x.id, JobTypes.DOCUMENT_XBRL_CHECK);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      subjectType: XBRL_CHECK_SUBJECT, subjectId: x.id, workspaceId: ws.workspaceId, maxAttempts: 5,
      idempotencyKey: `${JobTypes.DOCUMENT_XBRL_CHECK}:${x.id}:v1:pdf-${pdf.row.id}:xbrl-${revisionId}`,
    });
    expect(ctx.dispatcher.enqueued.filter((j) => j.id === checks[0]!.id)).toHaveLength(1);

    await rerun(x.jobId);
    expect(await jobsOf(x.id, JobTypes.DOCUMENT_XBRL_CHECK)).toHaveLength(1);
    expect(ctx.dispatcher.enqueued.filter((j) => j.id === checks[0]!.id)).toHaveLength(1);
  });

  it("after a period-only change, the read is written under the classification it reads under and marks the document read", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws, { periodEnd: "2025-06-30" });
    // The investor corrects the period only: the new answers keep reading under the first classification.
    const changed: ClassificationRow = await classifyDoc(ctx.db, ws, x.id, { setBy: "investor", periodEnd: PERIOD, readsUnderId: x.row.id });
    expect(await decideIntake(ctx.db, ctx.dispatcher, changed, { read: false })).toBeNull();
    const pdf = await addResultsPdf(ws);

    const job = await run(x.jobId);
    expect(job.state).toBe("succeeded");
    const [revision] = await revisionsOf(x.id);
    expect(revision!.classificationId).toBe(x.row.id);
    expect((await docOf(x.id)).intakeState).toBe("read");
    expect(await getCurrentRevision(ctx.db, ws.workspaceId, x.id)).toMatchObject({ id: revision!.id });
    // The check pairs by the current answers' period.
    const [check] = await jobsOf(x.id, JobTypes.DOCUMENT_XBRL_CHECK);
    expect(check!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_XBRL_CHECK}:${x.id}:v1:pdf-${pdf.row.id}:xbrl-${revision!.id}`);
  });

  it("refuses for good a document that is missing, not stored, a duplicate or a PDF, without calling the extractor", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const notStored = await addDoc(ctx.db, ctx.store, ws, "xbrl", { state: "verifying" });
    const original = await addDoc(ctx.db, ctx.store, ws, "xbrl");
    const duplicate = await addDoc(ctx.db, ctx.store, ws, "xbrl", { duplicateOfDocumentId: original, intakeState: "duplicate" });
    const pdf = await addDoc(ctx.db, ctx.store, ws, "pdf");
    for (const subjectId of [crypto.randomUUID(), notStored, duplicate, pdf]) {
      const jobId = await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId });
      expect(await run(jobId)).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INVALID_STATE" });
    }
    expect(fake.readCalls).toBe(0);
    // A stray read of a PDF never marks it read_failed.
    expect((await docOf(pdf)).intakeState).toBe("identifying");
  });

  it("fails for good with OBJECT_MISSING when the stored instance is gone", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    await ctx.db.update(schema.document).set({ storageKey: `workspaces/${ws.workspaceId}/documents/${x.id}/gone.xml` }).where(eq(schema.document.id, x.id));
    expect(await run(x.jobId)).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "OBJECT_MISSING" });
    expect(fake.readCalls).toBe(0);
    expect((await docOf(x.id)).intakeState).toBe("read_failed");
  });

  it("no value, label or byte of the instance reaches the logs", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "debug" }, { write: (s: string) => void lines.push(s) });
    const ws = await seedXbrlWs(ctx.db);
    const x = await addXbrl(ws);
    await addResultsPdf(ws);
    await runJob({ ...ctx, logger }, JobTypes.DOCUMENT_XBRL, x.jobId);
    const logged = lines.join("\n");
    expect(logged).toContain("xbrl read stored");
    for (const text of INSTANCE_TEXT) expect(logged).not.toContain(text);
  });
});

describe("document.xbrl without an extractor", () => {
  it("fails for good with EXTRACTOR_NOT_CONFIGURED", async () => {
    const ws = await seedXbrlWs(ctx.db);
    const id = await addDoc(ctx.db, ctx.store, ws, "xbrl");
    const jobId = await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: id });
    await runJob({ ...ctx, extractor: null }, JobTypes.DOCUMENT_XBRL, jobId);
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(job).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "EXTRACTOR_NOT_CONFIGURED" });
  });
});
