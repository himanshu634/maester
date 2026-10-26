import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { listChecks, listFactsWithSources, listXbrlPdfChecks, XBRL_PDF_CHECK_VERSION_READ } from "../src/queries/extraction.js";
import { listChecksForRevisions, listCompanyFilings, listFactsWithSourcesForRevisions } from "../src/queries/research.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function setup() {
  await insertUser(db, "u1", "u1@example.com");
  const ws = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
  const company = crypto.randomUUID();
  await db.insert(schema.company).values({ id: company, workspaceId: ws.id, displayName: "Synthetic Cements Limited", country: "IN", createdByUserId: "u1" });
  return { ws: ws.id, company };
}

async function doc(ws: string, companyId: string | null, name: string, intakeState: "read" | "kept" | null = "read") {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId: ws, companyId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${id}/original.pdf`, state: "stored", intakeState, createdByUserId: "u1",
  });
  return id;
}

describe("listCompanyFilings", () => {
  it("lists a company's documents with their current classification", async () => {
    const { ws, company } = await setup();
    const a = await doc(ws, company, "ar-2025-26.pdf");
    await doc(ws, null, "loose.pdf");
    await db.insert(schema.documentClassification).values({ id: crypto.randomUUID(), workspaceId: ws, documentId: a, kind: "other", setBy: "maester", createdAt: new Date("2026-10-01T00:00:00Z") });
    const current = crypto.randomUUID();
    const found = [{ statement: "income_statement", basis: "consolidated", pages: [212] }];
    await db.insert(schema.documentClassification).values({ id: current, workspaceId: ws, documentId: a, kind: "annual_report", periodEnd: "2026-03-31", statementsFound: found, setBy: "investor", createdAt: new Date("2026-10-02T00:00:00Z") });
    const rows = await listCompanyFilings(db, ws, company);
    expect(rows).toEqual([expect.objectContaining({
      documentId: a, companyId: company, originalName: "ar-2025-26.pdf", format: "pdf", state: "stored", duplicateOfDocumentId: null, intakeState: "read",
      classificationId: current, kind: "annual_report", periodEnd: "2026-03-31", statementsFound: found,
    })]);
    expect(await listCompanyFilings(db, ws)).toHaveLength(1);
  });

  it("returns a document never classified with no kind", async () => {
    const { ws, company } = await setup();
    await doc(ws, company, "old.pdf", null);
    expect(await listCompanyFilings(db, ws, company)).toEqual([expect.objectContaining({ classificationId: null, kind: null, periodEnd: null, statementsFound: [], intakeState: null })]);
  });
});

describe("facts and checks for several revisions", () => {
  it("returns nothing for no revisions", async () => {
    const { ws } = await setup();
    expect(await listFactsWithSourcesForRevisions(db, ws, [])).toEqual([]);
    expect(await listChecksForRevisions(db, ws, [])).toEqual([]);
  });
});

async function revision(ws: string, documentId: string, source: "pdf" | "xbrl") {
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({ id: jobId, workspaceId: ws, type: "document.extract", subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded" });
  const id = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id, workspaceId: ws, documentId, jobId, source, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v", pageCount: 1, coverage: { statements: [] },
  });
  return id;
}

async function fact(ws: string, revisionId: string, label: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.financialFact).values({
    id, workspaceId: ws, revisionId, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 0, reportedLabel: label,
    isSubtotal: false, periodLabel: "Year ended 31 Mar 2026", periodEnd: "2026-03-31", reportedText: "12345.00", reportedValue: "12345.00", valueStatus: "value",
  });
  return id;
}

async function xbrlCheck(ws: string, revisionId: string, factId: string, pdf: { documentId: string; classificationId: string }, checkVersion: number) {
  const id = crypto.randomUUID();
  await db.insert(schema.extractionCheck).values({
    id, workspaceId: ws, revisionId, checkType: "xbrl_in_pdf", statement: "income_statement", basis: "consolidated", section: "Income", periodLabel: "Year ended 31 Mar 2026",
    subjectLabel: "Revenue from operations", status: "passed", expected: "12345.00", detail: "", factId, pdfDocumentId: pdf.documentId,
    pdfClassificationId: pdf.classificationId, pageIndex: 4, checkVersion,
  });
  return id;
}

async function subtotalCheck(ws: string, revisionId: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.extractionCheck).values({
    id, workspaceId: ws, revisionId, checkType: "subtotal", statement: "income_statement", basis: "consolidated", section: "Income", periodLabel: "Year ended 31 Mar 2026",
    subjectLabel: "Total income", status: "passed", expected: "1", actual: "1", detail: "",
  });
  return id;
}

async function pdfOfFiling(ws: string, company: string) {
  const documentId = await doc(ws, company, "results.pdf");
  const classificationId = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id: classificationId, workspaceId: ws, documentId, kind: "financial_results", periodEnd: "2026-03-31", setBy: "maester" });
  return { documentId, classificationId };
}

describe("facts with their page or XBRL source", () => {
  it("returns an XBRL fact with its xbrl row and no page source, from both queries", async () => {
    const { ws, company } = await setup();
    const x = await doc(ws, company, "results.xml");
    const rev = await revision(ws, x, "xbrl");
    const factId = await fact(ws, rev, "Revenue from operations");
    await db.insert(schema.xbrlSource).values({
      id: crypto.randomUUID(), workspaceId: ws, factId, documentId: x, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5", concept: "revenue_from_operations",
    });
    for (const rows of [await listFactsWithSources(db, ws, rev), await listFactsWithSourcesForRevisions(db, ws, [rev])]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]!.fact.id).toBe(factId);
      expect(rows[0]!.source).toBeNull();
      expect(rows[0]!.xbrl).toMatchObject({ factId, documentId: x, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5", nil: false });
    }
  });

  it("returns a PDF fact with its page source and no xbrl row, and a fact with neither with both null", async () => {
    const { ws, company } = await setup();
    const p = await doc(ws, company, "ar.pdf");
    const rev = await revision(ws, p, "pdf");
    const factId = await fact(ws, rev, "Revenue from operations");
    await db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId: p, pageIndex: 212, textLayerMatch: true });
    const bare = await fact(ws, rev, "Other income");
    for (const rows of [await listFactsWithSources(db, ws, rev), await listFactsWithSourcesForRevisions(db, ws, [rev])]) {
      const byId = new Map(rows.map((r) => [r.fact.id, r]));
      expect(byId.get(factId)!.source).toMatchObject({ documentId: p, pageIndex: 212, textLayerMatch: true });
      expect(byId.get(factId)!.xbrl).toBeNull();
      expect(byId.get(bare)!.source).toBeNull();
      expect(byId.get(bare)!.xbrl).toBeNull();
    }
  });
});

describe("xbrl_in_pdf rows", () => {
  it("are left out of a revision's own checks, and listXbrlPdfChecks reads them at the current check version only", async () => {
    const { ws, company } = await setup();
    const x = await doc(ws, company, "results.xml");
    const rev = await revision(ws, x, "xbrl");
    const factId = await fact(ws, rev, "Revenue from operations");
    const pdf = await pdfOfFiling(ws, company);
    const own = await subtotalCheck(ws, rev);
    const current = await xbrlCheck(ws, rev, factId, pdf, XBRL_PDF_CHECK_VERSION_READ);
    await xbrlCheck(ws, rev, factId, pdf, XBRL_PDF_CHECK_VERSION_READ - 1);

    expect((await listChecks(db, ws, rev)).map((c) => c.id)).toEqual([own]);
    expect((await listChecksForRevisions(db, ws, [rev])).map((c) => c.id)).toEqual([own]);
    expect((await listXbrlPdfChecks(db, ws, [factId])).map((c) => c.id)).toEqual([current]);
    expect(await listXbrlPdfChecks(db, ws, [])).toEqual([]);
  });

  it("are read in their own workspace only", async () => {
    const { ws, company } = await setup();
    const x = await doc(ws, company, "results.xml");
    const rev = await revision(ws, x, "xbrl");
    const factId = await fact(ws, rev, "Revenue from operations");
    await xbrlCheck(ws, rev, factId, await pdfOfFiling(ws, company), XBRL_PDF_CHECK_VERSION_READ);
    await insertUser(db, "u2", "u2@example.com");
    const other = await ensurePersonalWorkspace(db, { userId: "u2", userName: "Bo" });
    expect(await listXbrlPdfChecks(db, other.id, [factId])).toEqual([]);
  });
});
