import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentExtraction, DocumentFacts, ExtractResponse, JobTypes, XBRL_PDF_CHECK_VERSION } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

async function seedDocument(workspaceId: string, userId: string, companyId: string, state: "stored" | "uploaded" = "stored") {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId, companyId, originalName: "fy26.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state, createdByUserId: userId,
  });
  return id;
}

async function seedRevision(workspaceId: string, documentId: string, companyId: string, createdAt: Date, value: string) {
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id: jobId, workspaceId, type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: documentId,
    idempotencyKey: `seed-${jobId}`, state: "succeeded",
  });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId, documentId, jobId, state: "complete", pipelineVersion: "extract-1", model: "m",
    promptVersion: "p", pageCount: 3, companyNameAsPrinted: "Synthetic", createdAt,
    coverage: { statements: [{ statement: "balance_sheet", basis: "consolidated", pages: [1], status: "extracted" }] },
  });
  const factId = crypto.randomUUID();
  await ctx.db.insert(schema.financialFact).values({
    id: factId, workspaceId, revisionId, companyId, statement: "balance_sheet", basis: "consolidated", section: "Assets",
    lineOrder: 0, reportedLabel: "Total assets", isSubtotal: true, componentLabels: ["Cash"], periodLabel: "As at 31 March 2026",
    asOfDate: "2026-03-31", reportedText: value, reportedValue: value, valueStatus: "value", unitLabel: "crores",
    scaleFactor: "10000000", currency: "INR", normalizedValue: `${value}0000000`,
  });
  await ctx.db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId, factId, documentId, pageIndex: 1, textLayerMatch: true });
  await ctx.db.insert(schema.extractionCheck).values({
    id: crypto.randomUUID(), workspaceId, revisionId, checkType: "subtotal", statement: "balance_sheet", basis: "consolidated",
    section: "Assets", periodLabel: "As at 31 March 2026", subjectLabel: "Total assets", status: "passed",
    expected: value, actual: value, detail: "components sum to the subtotal",
  });
  return revisionId;
}

/** An XBRL document read into a revision with one fact, its xbrl_source row and one of its own sums. */
async function seedXbrl(workspaceId: string, userId: string, companyId: string) {
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId, companyId, originalName: "results.xml", declaredSize: 10, declaredMime: "application/xml", format: "xbrl",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original.xml`, state: "stored", createdByUserId: userId,
  });
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({
    id: jobId, workspaceId, type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded",
  });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId, documentId, jobId, source: "xbrl", state: "complete", pipelineVersion: "xbrl-1", model: "xbrl-parser-1",
    promptVersion: "in-capmkt/ind_as@1", pageCount: 1, companyNameAsPrinted: "Synthetic", coverage: { statements: [] },
  });
  const factId = crypto.randomUUID();
  await ctx.db.insert(schema.financialFact).values({
    id: factId, workspaceId, revisionId, companyId, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 0,
    reportedLabel: "Revenue from operations", isSubtotal: false, periodLabel: "Year ended 31 Mar 2026", periodEnd: "2026-03-31", periodStart: "2025-04-01",
    span: "year", reportedText: "12105.40", reportedValue: "12105.40", valueStatus: "value", unitLabel: "₹ crore", scaleFactor: "10000000", currency: "INR",
    normalizedValue: "121054000000",
  });
  await ctx.db.insert(schema.xbrlSource).values({
    id: crypto.randomUUID(), workspaceId, factId, documentId, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5", concept: "revenue_from_operations",
  });
  await ctx.db.insert(schema.extractionCheck).values({
    id: crypto.randomUUID(), workspaceId, revisionId, checkType: "subtotal", statement: "income_statement", basis: "consolidated", section: "Income",
    periodLabel: "Year ended 31 Mar 2026", subjectLabel: "Total income", status: "passed", expected: "1", actual: "1", detail: "",
  });
  return { documentId, revisionId, factId };
}

describe("extraction endpoints of an XBRL document", () => {
  it("gives each fact its XBRL source, with its span and period start", async () => {
    const a = await ctx.signUp("xx1@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie);
    const x = await seedXbrl(a.workspaceId, a.userId, companyId);
    const facts = DocumentFacts.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${x.documentId}/facts`, { headers: { cookie: a.cookie } })).json());
    expect(facts.revision.source).toBe("xbrl");
    expect(facts.facts[0]).toMatchObject({ span: "year", periodStart: "2025-04-01", periodEnd: "2026-03-31" });
    expect(facts.facts[0]!.source).toEqual({ kind: "xbrl", documentId: x.documentId, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5", nil: false });
  });

  it("answers the same extraction before and after a document.xbrl_check job writes its xbrl_in_pdf rows", async () => {
    const a = await ctx.signUp("xx2@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie);
    const x = await seedXbrl(a.workspaceId, a.userId, companyId);
    const url = `/v1/workspaces/${a.workspaceId}/documents/${x.documentId}/extraction`;
    const before = DocumentExtraction.parse(await (await ctx.app.request(url, { headers: { cookie: a.cookie } })).json());
    expect(before.revision.source).toBe("xbrl");
    expect(before.checks.map((c) => c.checkType)).toEqual(["subtotal"]);

    // The rows as document.xbrl_check writes them: on the XBRL revision, one per fact and PDF classification.
    const pdf = await seedDocument(a.workspaceId, a.userId, companyId);
    const pdfClassificationId = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: pdfClassificationId, workspaceId: a.workspaceId, documentId: pdf, kind: "financial_results", periodEnd: "2026-03-31", companyId, setBy: "maester" });
    await ctx.db.insert(schema.extractionCheck).values({
      id: crypto.randomUUID(), workspaceId: a.workspaceId, revisionId: x.revisionId, checkType: "xbrl_in_pdf", statement: "income_statement", basis: "consolidated",
      section: "Income", periodLabel: "Year ended 31 Mar 2026", subjectLabel: "Revenue from operations", status: "failed", expected: "12105.40", detail: "",
      factId: x.factId, pdfDocumentId: pdf, pdfClassificationId, pageIndex: null, checkVersion: XBRL_PDF_CHECK_VERSION,
    });
    const after = DocumentExtraction.parse(await (await ctx.app.request(url, { headers: { cookie: a.cookie } })).json());
    expect(after).toEqual(before);
  });
});

describe("extraction endpoints", () => {
  it("returns the latest revision, its checks and facts with page sources; an older revision on request", async () => {
    const a = await ctx.signUp("x1@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie);
    const docId = await seedDocument(a.workspaceId, a.userId, companyId);
    const older = await seedRevision(a.workspaceId, docId, companyId, new Date("2026-09-01T00:00:00Z"), "100");
    const newer = await seedRevision(a.workspaceId, docId, companyId, new Date("2026-09-02T00:00:00Z"), "200");
    const base = `/v1/workspaces/${a.workspaceId}/documents/${docId}`;

    const extraction = DocumentExtraction.parse(await (await ctx.app.request(`${base}/extraction`, { headers: { cookie: a.cookie } })).json());
    expect(extraction.revision.id).toBe(newer);
    expect(extraction.revision.coverage[0]!.pages).toEqual([1]);
    expect(extraction.checks).toHaveLength(1);

    const facts = DocumentFacts.parse(await (await ctx.app.request(`${base}/facts`, { headers: { cookie: a.cookie } })).json());
    expect(facts.revision.id).toBe(newer);
    expect(facts.facts[0]!.reportedValue).toBe("200");
    expect(facts.facts[0]!.asOfDate).toBe("2026-03-31");
    expect(facts.revision.source).toBe("pdf");
    expect(facts.facts[0]).toMatchObject({ span: null, periodStart: null });
    expect(facts.facts[0]!.source).toEqual({ kind: "page", documentId: docId, pageIndex: 1, textLayerMatch: true });

    const old = DocumentFacts.parse(await (await ctx.app.request(`${base}/facts?revisionId=${older}`, { headers: { cookie: a.cookie } })).json());
    expect(old.facts[0]!.reportedValue).toBe("100");
  });

  it("is 404 before any extraction and across workspaces", async () => {
    const a = await ctx.signUp("x2@example.com");
    const b = await ctx.signUp("x3@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie);
    const docId = await seedDocument(a.workspaceId, a.userId, companyId);
    expect((await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/extraction`, { headers: { cookie: a.cookie } })).status).toBe(404);

    const revisionId = await seedRevision(a.workspaceId, docId, companyId, new Date(), "1");
    expect((await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${docId}/facts`, { headers: { cookie: b.cookie } })).status).toBe(404);
    const otherDoc = await seedDocument(a.workspaceId, a.userId, companyId);
    const wrongDoc = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${otherDoc}/facts?revisionId=${revisionId}`, { headers: { cookie: a.cookie } });
    expect(wrongDoc.status).toBe(404);
  });

  it("enqueues a new extract job per request, only for stored documents", async () => {
    const a = await ctx.signUp("x4@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie);
    const stored = await seedDocument(a.workspaceId, a.userId, companyId);
    const pending = await seedDocument(a.workspaceId, a.userId, companyId, "uploaded");
    const extract = (id: string) =>
      ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${id}/extract`, {
        method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" },
      });

    const first = await extract(stored);
    expect(first.status).toBe(202);
    const second = await extract(stored);
    const j1 = ExtractResponse.parse(await first.json()).job;
    const j2 = ExtractResponse.parse(await second.json()).job;
    expect(j1.type).toBe(JobTypes.DOCUMENT_EXTRACT);
    expect(j1.id).not.toBe(j2.id);
    expect(ctx.dispatcher.enqueued.filter((j) => j.subjectId === stored)).toHaveLength(2);

    expect((await extract(pending)).status).toBe(409);
    const rows = await ctx.db.select().from(schema.job).where(eq(schema.job.subjectId, pending));
    expect(rows).toHaveLength(0);
  });
});
