import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompanyFinancials, CompanyStock, JobTypes, ResearchCompanies } from "@maester/contracts";
import { schema, upsertMarketPoints } from "@maester/db";
import { moveDecimal } from "../src/financials/stitch.js";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

type Line = { label: string; period: string; printed: string; page?: number; section?: string; order?: number };

/** A read annual report for a company: document, classification read under itself, revision, facts. */
async function seedFiling(ws: string, userId: string, companyId: string, periodEnd: string, lines: Line[], opts: { kind?: "annual_report" | "financial_results"; intakeState?: "read" | "kept" } = {}) {
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId: ws, companyId, originalName: `ar-${periodEnd}.pdf`, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${documentId}/original.pdf`, state: "stored", intakeState: opts.intakeState ?? "read", createdByUserId: userId,
  });
  const classificationId = crypto.randomUUID();
  await ctx.db.insert(schema.documentClassification).values({
    id: classificationId, workspaceId: ws, documentId, kind: opts.kind ?? "annual_report", periodEnd, periodLabel: `Year ended ${periodEnd}`,
    companyId, setBy: "maester", statementsFound: [],
  });
  await ctx.db.update(schema.documentClassification).set({ readsUnderId: classificationId }).where(eq(schema.documentClassification.id, classificationId));
  const jobId = crypto.randomUUID();
  await ctx.db.insert(schema.job).values({ id: jobId, workspaceId: ws, type: JobTypes.DOCUMENT_EXTRACT, subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded" });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId: ws, documentId, jobId, classificationId, state: "complete", pipelineVersion: "extract-1", model: "m", promptVersion: "p",
    pageCount: 286, companyNameAsPrinted: "Synthetic Cements Limited", coverage: { statements: [] },
  });
  for (const line of lines) {
    const factId = crypto.randomUUID();
    const reported = line.printed.replace(/,/g, "");
    await ctx.db.insert(schema.financialFact).values({
      id: factId, workspaceId: ws, revisionId, companyId, statement: "income_statement", basis: "consolidated", section: line.section ?? "Income",
      lineOrder: line.order ?? 0, reportedLabel: line.label, isSubtotal: false, componentLabels: [], periodLabel: `Year ended ${line.period}`,
      periodEnd: line.period, reportedText: line.printed, reportedValue: reported, valueStatus: "value", unitLabel: "₹ in crore",
      scaleFactor: "10000000", currency: "INR", normalizedValue: moveDecimal(reported, 7),
    });
    await ctx.db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: ws, factId, documentId, pageIndex: (line.page ?? 213) - 1, textLayerMatch: true });
  }
  return documentId;
}

describe("GET /companies/:id/financials", () => {
  it("stitches the company's read annual reports, newest filing per year", async () => {
    const a = await ctx.signUp("fin-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const ar25 = await seedFiling(a.workspaceId, a.userId, company, "2025-03-31", [{ label: "Freight and forwarding", period: "2025-03-31", printed: "2,389.10", page: 198 }]);
    const ar26 = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", [
      { label: "Freight and forwarding", period: "2026-03-31", printed: "2,602.15" },
      { label: "Freight and forwarding", period: "2025-03-31", printed: "2,401.60" },
    ]);
    await seedFiling(a.workspaceId, a.userId, company, "2026-06-30", [{ label: "Freight and forwarding", period: "2026-06-30", printed: "700.00" }], { kind: "financial_results" });
    await seedFiling(a.workspaceId, a.userId, company, "2024-03-31", [{ label: "Freight and forwarding", period: "2024-03-31", printed: "2,180.45" }], { intakeState: "kept" });

    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/financials`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const body = CompanyFinancials.parse(await res.json());
    expect(body.filings).toHaveLength(4);
    expect(body.filings.filter((f) => f.counted).map((f) => f.documentId).sort()).toEqual([ar25, ar26].sort());
    const t = body.tables.find((x) => x.statement === "income_statement" && x.basis === "consolidated")!;
    expect(t.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2025-03-31", ar26], ["2026-03-31", ar26]]);
    expect(t.rows[0]!.cells[0]).toMatchObject({ value: "2401.6", restated: { documentId: ar25, value: "2389.1", pageIndex: 197 } });
  });

  it("keeps a figure's printed decimals through the database, so 2,401.60 is not read as 2,401.6", async () => {
    // Restated compares at the coarser printed precision: a trimmed trailing zero would hide this change.
    const a = await ctx.signUp("fin-e@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const ar25 = await seedFiling(a.workspaceId, a.userId, company, "2025-03-31", [{ label: "Other income", period: "2025-03-31", printed: "2,401.60", page: 198 }]);
    await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", [{ label: "Other income", period: "2025-03-31", printed: "2,401.63" }]);
    const body = CompanyFinancials.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/financials`, { headers: { cookie: a.cookie } })).json());
    expect(body.tables[0]!.rows[0]!.cells[0]).toMatchObject({ value: "2401.63", restated: { documentId: ar25, value: "2401.6", printed: "2,401.60" } });
  });

  it("is not found in another workspace", async () => {
    const a = await ctx.signUp("fin-b@example.com");
    const b = await ctx.signUp("fin-c@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/companies/${company}/financials`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });

  it("has no tables when nothing is read", async () => {
    const a = await ctx.signUp("fin-d@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const body = CompanyFinancials.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/financials`, { headers: { cookie: a.cookie } })).json());
    expect(body.tables).toEqual([]);
    expect(body.filings).toEqual([]);
  });
});

describe("GET /research/companies", () => {
  it("counts each company's read annual reports and its latest year", async () => {
    const a = await ctx.signUp("list-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const empty = await ctx.createCompany(a.workspaceId, a.cookie, "Harbour Cements Limited");
    await seedFiling(a.workspaceId, a.userId, company, "2025-03-31", []);
    await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const body = ResearchCompanies.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/research/companies`, { headers: { cookie: a.cookie } })).json());
    expect(body.items.map((i) => [i.company.displayName, i.annualReportsRead, i.latestPeriodEnd])).toEqual([
      ["Harbour Cements Limited", 0, null],
      ["Synthetic Cements Limited", 2, "2026-03-31"],
    ]);
    expect(body.items.find((i) => i.company.id === empty)!.reading).toBe(0);
  });
});

describe("GET /companies/:id/stock", () => {
  async function companyWith(email: string, symbol: string | null) {
    const a = await ctx.signUp(email);
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    if (symbol) await ctx.db.update(schema.company).set({ nseSymbol: symbol }).where(eq(schema.company.id, company));
    const read = async () => CompanyStock.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/companies/${company}/stock`, { headers: { cookie: a.cookie } })).json());
    return { read };
  }

  it("says there's no symbol", async () => {
    expect((await (await companyWith("stock-a@example.com", null)).read()).state).toBe("no_symbol");
  });

  it("says Dhan isn't connected when there are no closes and no connection", async () => {
    expect((await (await companyWith("stock-b@example.com", "NOCLOSE")).read()).state).toBe("not_connected");
  });

  it("says the share isn't tracked when Dhan is connected but there are no closes", async () => {
    await ctx.db.insert(schema.marketConnection).values({ provider: "dhan", clientId: "1000000001", secretCiphertext: "x", secretLast4: "9f3c", checkedAt: new Date() }).onConflictDoNothing();
    expect((await (await companyWith("stock-c@example.com", "NOTN500")).read()).state).toBe("not_tracked");
  });

  it("summarises the stored closes", async () => {
    await upsertMarketPoints(ctx.db, [
      { series: "eq:SYNCEM", day: "2026-10-09", value: 1272.2, source: "Dhan · NSE close" },
      { series: "eq:SYNCEM", day: "2026-10-10", value: 1284.5, source: "Dhan · NSE close" },
    ]);
    const s = await (await companyWith("stock-d@example.com", "SYNCEM")).read();
    expect(s).toMatchObject({ state: "ok", symbol: "SYNCEM", last: { day: "2026-10-10", value: 1284.5 }, previous: { day: "2026-10-09", value: 1272.2 }, source: "Dhan · NSE close" });
  });
});

describe("GET /documents/:id/file", () => {
  it("redirects to the stored PDF and is not cached", async () => {
    const a = await ctx.signUp("file-a@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const doc = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${doc}/file`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is a conflict while the document is not stored", async () => {
    const a = await ctx.signUp("file-d@example.com");
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.document).values({
      id, workspaceId: a.workspaceId, originalName: "pending.pdf", declaredSize: 10, declaredMime: "application/pdf",
      storageKey: `workspaces/${a.workspaceId}/documents/${id}/original.pdf`, state: "pending_upload", createdByUserId: a.userId,
    });
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${id}/file`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");
  });

  it("is not found in another workspace", async () => {
    const a = await ctx.signUp("file-b@example.com");
    const b = await ctx.signUp("file-c@example.com");
    const company = await ctx.createCompany(a.workspaceId, a.cookie);
    const doc = await seedFiling(a.workspaceId, a.userId, company, "2026-03-31", []);
    const res = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${doc}/file`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });
});
