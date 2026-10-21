import { and, asc, eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JobTypes, XBRL_CHECK_SUBJECT } from "@maester/contracts";
import { schema } from "@maester/db";
import { decideIntake, enqueueXbrlPdfChecks, xbrlCheckKeyOf } from "@maester/jobs";
import { documentXbrlCheck } from "../src/jobs/document-xbrl-check.js";
import { documentXbrl } from "../src/jobs/document-xbrl.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob } from "./context.js";
import {
  addDoc, classifyDoc, FakeExtractor, INSTANCE_TEXT, PDF_STATEMENTS, roundingMissingRead, seedXbrlWs, unmappedRead, type XbrlWs,
} from "./xbrl-fixtures.js";

const fake = new FakeExtractor();
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => {
  ctx = await createWorkerContext(
    { [JobTypes.DOCUMENT_XBRL]: documentXbrl, [JobTypes.DOCUMENT_XBRL_CHECK]: documentXbrlCheck },
    { extractor: fake.client },
  );
});
afterAll(() => ctx.close());
beforeEach(() => fake.reset());

const A = "0b6f1c1e-6d1a-4c52-9a53-0f3a2d1f7a01";
const B = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

const jobsOf = (subjectId: string, type: string) =>
  ctx.db.select().from(schema.job).where(and(eq(schema.job.subjectId, subjectId), eq(schema.job.type, type))).orderBy(asc(schema.job.createdAt));
const jobRow = async (id: string) => (await ctx.db.select().from(schema.job).where(eq(schema.job.id, id)))[0]!;
const rowsFor = (pdfClassificationId: string) =>
  ctx.db.select().from(schema.extractionCheck).where(eq(schema.extractionCheck.pdfClassificationId, pdfClassificationId));

/** A results PDF that prints the consolidated statements. */
async function addPdf(ws: XbrlWs) {
  const id = await addDoc(ctx.db, ctx.store, ws, "pdf", { intakeState: "read" });
  const row = await classifyDoc(ctx.db, ws, id, { statementsFound: PDF_STATEMENTS });
  return { id, row };
}

/** An XBRL document read under a new classification, through document.xbrl. Returns its revision. */
async function readXbrl(ws: XbrlWs, xbrlId: string) {
  const row = await classifyDoc(ctx.db, ws, xbrlId, { xbrlFormat: "in-capmkt/ind_as", basis: "consolidated" });
  await decideIntake(ctx.db, ctx.dispatcher, row, { read: true });
  const [job] = (await jobsOf(xbrlId, JobTypes.DOCUMENT_XBRL)).filter((j) => j.idempotencyKey.endsWith(row.id));
  await runJob(ctx, JobTypes.DOCUMENT_XBRL, job!.id);
  const result = (await jobRow(job!.id)).result as { revisionId: string };
  return { row, revisionId: result.revisionId };
}

async function setup(read = fake.read) {
  const ws = await seedXbrlWs(ctx.db);
  const pdf = await addPdf(ws);
  const xbrlId = await addDoc(ctx.db, ctx.store, ws, "xbrl");
  fake.read = read;
  const xbrl = await readXbrl(ws, xbrlId);
  const [check] = await jobsOf(xbrlId, JobTypes.DOCUMENT_XBRL_CHECK);
  return { ws, pdf, xbrlId, xbrl, checkJobId: check?.id ?? null };
}

async function check(jobId: string) {
  await runJob(ctx, JobTypes.DOCUMENT_XBRL_CHECK, jobId);
  return jobRow(jobId);
}

async function recheck(jobId: string) {
  await ctx.db.update(schema.job).set({ state: "queued", attempt: 1, leaseToken: null, leaseExpiresAt: null }).where(eq(schema.job.id, jobId));
  return check(jobId);
}

describe("xbrlCheckKeyOf", () => {
  it("reads the version, the PDF classification and the XBRL revision back from the key", () => {
    expect(xbrlCheckKeyOf(`document.xbrl_check:${crypto.randomUUID()}:v1:pdf-${A}:xbrl-${B}`)).toEqual({ version: 1, pdfClassificationId: A, xbrlRevisionId: B });
    expect(xbrlCheckKeyOf(`document.xbrl_check:${crypto.randomUUID()}:v12:pdf-${A}:xbrl-${B}`)).toMatchObject({ version: 12 });
    expect(xbrlCheckKeyOf(`document.xbrl_check:${crypto.randomUUID()}:1`)).toBeNull();
    expect(xbrlCheckKeyOf(`document.xbrl_check:${crypto.randomUUID()}:v1:pdf-${A}`)).toBeNull();
  });
});

describe("enqueueXbrlPdfChecks", () => {
  it("pairs from either side, once per pair, and leaves out a PDF of another period or company", async () => {
    const { ws, pdf, xbrlId, xbrl } = await setup();
    expect(await enqueueXbrlPdfChecks(ctx.db, ctx.dispatcher, ws.workspaceId, { xbrlDocumentId: xbrlId })).toBe(0);
    expect(await enqueueXbrlPdfChecks(ctx.db, ctx.dispatcher, ws.workspaceId, { pdfDocumentId: pdf.id })).toBe(0);
    const [job, ...more] = await jobsOf(xbrlId, JobTypes.DOCUMENT_XBRL_CHECK);
    expect(more).toHaveLength(0);
    expect(job).toMatchObject({ subjectType: XBRL_CHECK_SUBJECT, idempotencyKey: `${JobTypes.DOCUMENT_XBRL_CHECK}:${xbrlId}:v1:pdf-${pdf.row.id}:xbrl-${xbrl.revisionId}` });

    // A PDF that arrives later is paired from its own side.
    const later = await addPdf(ws);
    expect(await enqueueXbrlPdfChecks(ctx.db, ctx.dispatcher, ws.workspaceId, { pdfDocumentId: later.id })).toBe(1);
    const other = await addDoc(ctx.db, ctx.store, ws, "pdf");
    await classifyDoc(ctx.db, ws, other, { periodEnd: "2025-06-30", statementsFound: PDF_STATEMENTS });
    const annual = await addDoc(ctx.db, ctx.store, ws, "pdf");
    await classifyDoc(ctx.db, ws, annual, { kind: "annual_report" });
    const noCompany = await addDoc(ctx.db, ctx.store, ws, "pdf");
    await classifyDoc(ctx.db, ws, noCompany, { companyId: null, readsUnderId: null });
    for (const id of [other, annual, noCompany]) expect(await enqueueXbrlPdfChecks(ctx.db, ctx.dispatcher, ws.workspaceId, { pdfDocumentId: id })).toBe(0);
    expect(await jobsOf(xbrlId, JobTypes.DOCUMENT_XBRL_CHECK)).toHaveLength(2);
  });

  it("pairs no unmapped revision: it has no facts", async () => {
    const { checkJobId } = await setup(unmappedRead());
    expect(checkJobId).toBeNull();
  });
});

describe("document.xbrl_check", () => {
  it("writes one xbrl_in_pdf row per fact with its page, reason, the XBRL revision and check version 1; twice writes each once", async () => {
    const { ws, pdf, xbrl, checkJobId } = await setup();
    const job = await check(checkJobId!);
    expect(job.state).toBe("succeeded");
    expect(job.result).toEqual({ outcome: "checked", rows: 4 });

    expect(fake.checkRequests).toHaveLength(1);
    const sent = fake.checkRequests[0]!;
    expect(sent.documentId).toBe(pdf.id);
    expect(new TextDecoder().decode(sent.pdf)).toBe("%PDF-1.4 synthetic");
    expect(sent.request.scale).toBe("100000");
    expect(sent.request.places).toBe(2);
    expect(sent.request.statementPages).toEqual(PDF_STATEMENTS);

    const facts = await ctx.db.select().from(schema.financialFact).where(eq(schema.financialFact.revisionId, xbrl.revisionId));
    const byId = new Map(facts.map((f) => [f.id, f]));
    expect(sent.request.facts.map((f) => [byId.get(f.factId)!.reportedLabel, f.value, f.perShare, f.statement, f.basis]).sort()).toEqual([
      ["Basic earnings per share", "12.34", true, "income_statement", "consolidated"],
      ["Cash and cash equivalents at the end of the period", "250000000", false, "cash_flow", "consolidated"],
      ["Other income", null, false, "income_statement", "consolidated"],
      ["Revenue from operations", "1234500000", false, "income_statement", "consolidated"],
    ]);

    const rows = await rowsFor(pdf.row.id);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      const fact = byId.get(r.factId!)!;
      const answer = fake.checkRequests[0]!.request.facts.findIndex((f) => f.factId === r.factId);
      expect(answer).toBeGreaterThanOrEqual(0);
      expect(r).toMatchObject({
        workspaceId: ws.workspaceId, revisionId: xbrl.revisionId, checkType: "xbrl_in_pdf", statement: fact.statement, basis: fact.basis,
        section: fact.section, periodLabel: fact.periodLabel, subjectLabel: fact.reportedLabel, expected: fact.reportedValue, actual: null,
        detail: "", pdfDocumentId: pdf.id, pdfClassificationId: pdf.row.id, checkVersion: 1,
      });
    }
    const label = (r: (typeof rows)[number]) => byId.get(r.factId!)!.reportedLabel;
    const other = rows.find((r) => label(r) === "Other income")!;
    expect([other.status, other.pageIndex, other.reason]).toEqual(["not_checked", null, "no_value"]);
    const answered = rows.filter((r) => r !== other).map((r) => [r.status, r.pageIndex, r.reason]).sort();
    expect(answered).toEqual([["failed", null, null], ["passed", 3, null], ["passed", 3, null]]);

    expect((await recheck(checkJobId!)).result).toEqual({ outcome: "checked", rows: 0 });
    expect(await rowsFor(pdf.row.id)).toHaveLength(4);
  });

  it("a PDF re-classified meanwhile is stale: no call and no row", async () => {
    const { ws, pdf, checkJobId } = await setup();
    await classifyDoc(ctx.db, ws, pdf.id, { setBy: "investor", statementsFound: PDF_STATEMENTS });
    expect((await check(checkJobId!)).result).toEqual({ outcome: "stale", rows: 0 });
    expect(fake.checkRequests).toHaveLength(0);
    expect(await rowsFor(pdf.row.id)).toHaveLength(0);
  });

  it("an XBRL read again under new answers makes the first job stale, gets a new job, and the new facts their own rows; the old rows stay", async () => {
    const { ws, pdf, xbrlId, xbrl, checkJobId } = await setup();
    expect((await check(checkJobId!)).result).toEqual({ outcome: "checked", rows: 4 });

    const second = await readXbrl(ws, xbrlId);
    expect(second.revisionId).not.toBe(xbrl.revisionId);
    const jobs = await jobsOf(xbrlId, JobTypes.DOCUMENT_XBRL_CHECK);
    expect(jobs.map((j) => j.idempotencyKey)).toEqual([
      `${JobTypes.DOCUMENT_XBRL_CHECK}:${xbrlId}:v1:pdf-${pdf.row.id}:xbrl-${xbrl.revisionId}`,
      `${JobTypes.DOCUMENT_XBRL_CHECK}:${xbrlId}:v1:pdf-${pdf.row.id}:xbrl-${second.revisionId}`,
    ]);
    expect((await recheck(checkJobId!)).result).toEqual({ outcome: "stale", rows: 0 });
    expect((await check(jobs[1]!.id)).result).toEqual({ outcome: "checked", rows: 4 });
    const rows = await rowsFor(pdf.row.id);
    expect(rows.filter((r) => r.revisionId === xbrl.revisionId)).toHaveLength(4);
    expect(rows.filter((r) => r.revisionId === second.revisionId)).toHaveLength(4);
  });

  it("an XBRL whose new answers have not been read yet is stale", async () => {
    const { ws, pdf, xbrlId, checkJobId } = await setup();
    await classifyDoc(ctx.db, ws, xbrlId, { setBy: "investor" });
    expect((await check(checkJobId!)).result).toEqual({ outcome: "stale", rows: 0 });
    expect(await rowsFor(pdf.row.id)).toHaveLength(0);
  });

  it("with no rounding declared, the monetary facts are not_checked no_unit without the extractor, and the per-share fact is sent", async () => {
    const { pdf, xbrl, checkJobId } = await setup(roundingMissingRead());
    expect((await check(checkJobId!)).result).toEqual({ outcome: "checked", rows: 4 });
    expect(fake.checkRequests).toHaveLength(1);
    const { request } = fake.checkRequests[0]!;
    expect([request.scale, request.places]).toEqual([null, null]);
    expect(request.facts.map((f) => [f.value, f.perShare])).toEqual([["12.34", true]]);

    const facts = await ctx.db.select().from(schema.financialFact).where(eq(schema.financialFact.revisionId, xbrl.revisionId));
    const perShare = facts.find((f) => f.unitLabel === "₹ a share")!;
    const rows = await rowsFor(pdf.row.id);
    expect(rows.filter((r) => r.factId !== perShare.id).map((r) => [r.status, r.reason, r.checkVersion])).toEqual([
      ["not_checked", "no_unit", 1], ["not_checked", "no_unit", 1], ["not_checked", "no_unit", 1],
    ]);
    expect(rows.find((r) => r.factId === perShare.id)).toMatchObject({ status: "passed", pageIndex: 3, reason: null });
  });

  it("with no rounding and no per-share fact, nothing is sent and every fact is no_unit", async () => {
    const { pdf, checkJobId } = await setup(roundingMissingRead({ perShare: false }));
    expect((await check(checkJobId!)).result).toEqual({ outcome: "checked", rows: 3 });
    expect(fake.checkRequests).toHaveLength(0);
    expect((await rowsFor(pdf.row.id)).map((r) => r.reason)).toEqual(["no_unit", "no_unit", "no_unit"]);
  });

  it("with XBRL_PDF_CHECK=false the job answers disabled and writes no row", async () => {
    const { pdf, checkJobId } = await setup();
    ctx.env.XBRL_PDF_CHECK = false;
    try {
      expect((await check(checkJobId!)).result).toEqual({ outcome: "disabled", rows: 0 });
    } finally {
      ctx.env.XBRL_PDF_CHECK = true;
    }
    expect(fake.checkRequests).toHaveLength(0);
    expect(await rowsFor(pdf.row.id)).toHaveLength(0);
  });

  it("a revision with no facts is not_mapped", async () => {
    const { ws, pdf, xbrlId, xbrl } = await setup(unmappedRead());
    const jobId = await seedJob(ctx.db, ws.workspaceId, {
      type: JobTypes.DOCUMENT_XBRL_CHECK, subjectType: XBRL_CHECK_SUBJECT, subjectId: xbrlId,
      idempotencyKey: `${JobTypes.DOCUMENT_XBRL_CHECK}:${xbrlId}:v1:pdf-${pdf.row.id}:xbrl-${xbrl.revisionId}`,
    });
    expect((await check(jobId)).result).toEqual({ outcome: "not_mapped", rows: 0 });
    expect(fake.checkRequests).toHaveLength(0);
  });

  it("refuses for good a key it cannot read", async () => {
    const { ws, xbrlId } = await setup();
    const jobId = await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_XBRL_CHECK, subjectType: XBRL_CHECK_SUBJECT, subjectId: xbrlId });
    expect(await check(jobId)).toMatchObject({ state: "failed", attempt: 1, lastErrorCode: "INVALID_STATE" });
  });

  it("logs counts by status only: no value, label or byte of the instance or the PDF", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "debug" }, { write: (s: string) => void lines.push(s) });
    const { checkJobId } = await setup();
    await runJob({ ...ctx, logger }, JobTypes.DOCUMENT_XBRL_CHECK, checkJobId!);
    const logged = lines.join("\n");
    expect(logged).toContain("xbrl pdf check stored");
    expect(logged).toMatch(/"passed":2/);
    for (const text of INSTANCE_TEXT) expect(logged).not.toContain(text);
  });
});
