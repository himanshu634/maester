import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@maester/db";
import { createHarness, textOf, type Harness } from "./harness.js";

let h: Harness;
let co: string;
let ar2025: string; // PDF, page 198
let ar2026: string; // XBRL, restates 2025
let results: string; // financial results, quarter to 2026-06-30
let kept: string;
let otherDoc: string;
let otherCo: string;

beforeAll(async () => {
  h = await createHarness();
  const { workspace, userId } = h.a;
  co = h.a.companies.synthetic!;
  ar2025 = await h.seedFiling(workspace.id, userId, co, "2025-03-31", [{ label: "Freight and forwarding", period: "2025-03-31", printed: "2,389.10", page: 198 }], { name: "AR 2025" });
  ar2026 = await h.seedFiling(
    workspace.id, userId, co, "2026-03-31",
    [
      { label: "Freight and forwarding", period: "2025-03-31", printed: "2,400.00", order: 0 },
      { label: "Freight and forwarding", period: "2026-03-31", printed: "2,602.15", order: 0 },
      { label: "Other income", period: "2026-03-31", printed: "88.50", order: 1 },
    ],
    { source: "xbrl", name: "AR 2026" },
  );
  results = await h.seedFiling(
    workspace.id, userId, co, "2026-06-30",
    [{ label: "Freight and forwarding", period: "2026-06-30", printed: "640.25", span: "quarter", periodStart: "2026-04-01" }],
    { source: "xbrl", kind: "financial_results", name: "Results Q1 FY27" },
  );
  kept = await h.seedFiling(workspace.id, userId, co, "2026-03-31", [], { intakeState: "kept", name: "Notes.pdf" });
  otherCo = h.b.companies.other!;
  otherDoc = await h.seedFiling(h.b.workspace.id, h.b.userId, otherCo, "2026-03-31", [{ label: "Freight and forwarding", period: "2026-03-31", printed: "1.00" }], { name: "Other AR" });
});
afterAll(() => h.close());

const call = (name: string, args: Record<string, unknown>) => h.client.callTool({ name, arguments: args });
type Cell = Record<string, unknown>;
type Statement = {
  table: null | {
    columns: { period_end: string; filing: string | null }[];
    rows: { label: string; cells: Cell[] }[];
    unit: { label: string; scale: string; currency: string };
  };
  answer: string;
  read_bases: string[];
};

async function factIdOf(documentId: string, label: string, period: string): Promise<string> {
  const res = await call("get_filing_facts", { document_id: documentId });
  const facts = (res.structuredContent as { facts: { fact_id: string; line: string; period_end: string }[] }).facts;
  return facts.find((f) => f.line === label && f.period_end === period)!.fact_id;
}

describe("get_statement", () => {
  it("gives one table, oldest column first, each cell with its lineage", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement", basis: "consolidated" });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as Statement;
    expect(body.table!.columns.map((c) => c.period_end)).toEqual(["2025-03-31", "2026-03-31"]);
    expect(body.table!.columns.map((c) => c.filing)).toEqual(["AR 2026", "AR 2026"]);
    const freight = body.table!.rows.find((r) => r.label === "Freight and forwarding")!;
    expect(freight.cells[1]).toMatchObject({
      value: "2602.15", period_end: "2026-03-31", span: "year", unit_label: "₹ in crore", scale: "10000000", currency: "INR", reviewed: "not yet",
      source: { kind: "xbrl", filing: "AR 2026", element: "RevenueFromOperations", context: "FourD" },
    });
    expect(freight.cells[1]!.fact_id).toEqual(expect.any(String));
    expect(freight.cells[1]!.check).toEqual(expect.any(String));
    // The 2025 figure of AR 2026 differs from the one AR 2025 printed, and the cell says so in words.
    expect(freight.cells[0]).toMatchObject({ value: "2400" });
    expect(String(freight.cells[0]!.restated)).toContain("2,389.10");
    expect(JSON.stringify(res)).not.toContain("Other Workspace");
  });

  it("says a line another year does not print is not printed, never zero", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement", basis: "consolidated" });
    const other = (res.structuredContent as Statement).table!.rows.find((r) => r.label === "Other income")!;
    expect(other.cells[0]).toMatchObject({ value: null, status: "not printed", reason: "not printed", source: null, fact_id: null });
  });

  it("keeps only the columns inside from and to", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement", basis: "consolidated", from: "2026-01-01" });
    const body = res.structuredContent as Statement;
    expect(body.table!.columns.map((c) => c.period_end)).toEqual(["2026-03-31"]);
    expect(body.table!.rows.every((r) => r.cells.length === 1)).toBe(true);
    const upTo = await call("get_statement", { company_id: co, statement: "income_statement", basis: "consolidated", to: "2025-12-31" });
    expect((upTo.structuredContent as Statement).table!.columns.map((c) => c.period_end)).toEqual(["2025-03-31"]);
  });

  it("answers in words when the basis has no table, naming the bases that exist", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement", basis: "standalone" });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as Statement;
    expect(body.table).toBeNull();
    expect(body.answer).toBe("No standalone income statement has been read for this company. Read: consolidated.");
    expect(body.read_bases).toEqual(["consolidated"]);
    expect(textOf(res)).toBe(body.answer);
  });

  it("answers in words when no annual report has been read", async () => {
    const res = await call("get_statement", { company_id: h.a.companies.harbour, statement: "income_statement", basis: "consolidated" });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as Statement).answer).toBe("No annual report of this company has been read yet.");
    expect((res.structuredContent as Statement).table).toBeNull();
  });

  it("answers NOT_FOUND for another workspace's company, the same as for a missing one", async () => {
    const other = await call("get_statement", { company_id: otherCo, statement: "income_statement", basis: "consolidated" });
    const missing = await call("get_statement", { company_id: crypto.randomUUID(), statement: "income_statement", basis: "consolidated" });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toMatch(/^NOT_FOUND: /);
    expect(textOf(other)).toBe(textOf(missing));
    expect(other.structuredContent).toBeUndefined();
  });

  it("requires a basis, so the two never mix", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/Input validation error/);
  });

  it("refuses a range that ends before it starts", async () => {
    const res = await call("get_statement", { company_id: co, statement: "income_statement", basis: "consolidated", from: "2026-01-01", to: "2025-01-01" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^INVALID_INPUT: /);
  });
});

describe("get_filing_facts", () => {
  type Facts = { document: { document_id: string; name: string; kind: string | null }; facts: Cell[]; note: string | null };

  it("returns a results filing's facts with span and period start", async () => {
    const res = await call("get_filing_facts", { document_id: results });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as Facts;
    expect(body.document).toMatchObject({ document_id: results, name: "Results Q1 FY27", kind: "financial_results" });
    expect(body.facts).toHaveLength(1);
    expect(body.facts[0]).toMatchObject({
      line: "Freight and forwarding", span: "quarter", period_start: "2026-04-01", period_end: "2026-06-30", reported_value: "640.25", unit_label: "₹ in crore",
      basis: "consolidated", statement: "income_statement", reviewed: "not yet",
      source: { kind: "xbrl", element: "RevenueFromOperations" },
    });
  });

  it("gives an annual report's facts as printed in that one filing, with 1-based pages", async () => {
    const res = await call("get_filing_facts", { document_id: ar2025 });
    const fact = (res.structuredContent as Facts).facts[0]!;
    expect(fact).toMatchObject({ reported_value: "2389.10", printed: "2,389.10", source: { kind: "page", page: 198, of: 286, filing: "AR 2025" } });
  });

  it("filters by statement and basis", async () => {
    const none = await call("get_filing_facts", { document_id: ar2026, statement: "balance_sheet" });
    expect((none.structuredContent as Facts).facts).toHaveLength(0);
    const standalone = await call("get_filing_facts", { document_id: ar2026, basis: "standalone" });
    expect((standalone.structuredContent as Facts).facts).toHaveLength(0);
    const some = await call("get_filing_facts", { document_id: ar2026, statement: "income_statement", basis: "consolidated" });
    expect((some.structuredContent as Facts).facts).toHaveLength(3);
  });

  it("answers in words for a document that is kept, not read", async () => {
    const res = await call("get_filing_facts", { document_id: kept });
    expect(res.isError).toBeFalsy();
    const body = res.structuredContent as Facts;
    expect(body.facts).toEqual([]);
    expect(body.note).toBe("This document is kept, not read: Maester has no figures from it.");
    expect(textOf(res)).toBe(body.note);
  });

  it("answers NOT_FOUND for another workspace's document, the same as for a missing one", async () => {
    const other = await call("get_filing_facts", { document_id: otherDoc });
    const missing = await call("get_filing_facts", { document_id: crypto.randomUUID() });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toMatch(/^NOT_FOUND: /);
    expect(textOf(other)).toBe(textOf(missing));
  });
});

describe("get_fact", () => {
  it("gives an XBRL fact its element, its own value and the table's value, each with its unit", async () => {
    const id = await factIdOf(ar2026, "Freight and forwarding", "2026-03-31");
    const res = await call("get_fact", { fact_id: id });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      fact_id: id, document_id: ar2026, company_id: co, reported_value: "2602.15", printed: "2,602.15", unit_label: "₹ in crore", scale: "10000000", currency: "INR",
      basis: "consolidated", statement: "income_statement", span: "year", period_end: "2026-03-31", superseded: null, reviewed: "not yet",
      filing: { name: "AR 2026", document_id: ar2026, kind: "annual_report", period_end: "2026-03-31" },
      source: { kind: "xbrl", element: "RevenueFromOperations", context: "FourD", decimals: "-5" },
      in_table: { shown: true, value: "2602.15", unit: { label: "₹ in crore", scale: "10000000", currency: "INR" } },
    });
  });

  it("gives a PDF fact its 1-based page and says which filing fills the year when a newer one restates it", async () => {
    const id = await factIdOf(ar2025, "Freight and forwarding", "2025-03-31");
    const res = await call("get_fact", { fact_id: id });
    const body = res.structuredContent as { source: unknown; in_table: { shown: boolean; note: string }; reported_value: string };
    expect(body.reported_value).toBe("2389.10");
    expect(body.source).toMatchObject({ kind: "page", page: 198, of: 286, filing: "AR 2025" });
    expect(body.in_table.shown).toBe(false);
    expect(body.in_table.note).toContain("AR 2026");
    expect(body.in_table.note).toContain("2025-03-31");
  });

  it("says no table shows results yet for a results fact", async () => {
    const id = await factIdOf(results, "Freight and forwarding", "2026-06-30");
    const res = await call("get_fact", { fact_id: id });
    const body = res.structuredContent as { in_table: { shown: boolean; note: string }; span: string; period_start: string; filing: { kind: string } };
    expect(body).toMatchObject({ span: "quarter", period_start: "2026-04-01", filing: { kind: "financial_results" } });
    expect(body.in_table.shown).toBe(false);
    expect(body.in_table.note).toMatch(/^No table shows results yet/);
  });

  it("sets superseded on a fact of a revision that was read again", async () => {
    const id = await factIdOf(ar2025, "Freight and forwarding", "2025-03-31");
    // A re-read: a second revision under the same classification, newer than the first.
    const old = await h.db.query.extractionRevision.findFirst({ where: (r, { eq }) => eq(r.documentId, ar2025) });
    const jobId = crypto.randomUUID();
    await h.db.insert(schema.job).values({
      id: jobId, workspaceId: h.a.workspace.id, type: "document.extract", subjectType: "document", subjectId: ar2025, idempotencyKey: `reread-${jobId}`, state: "succeeded", createdAt: new Date(Date.now() + 60_000),
    });
    await h.db.insert(schema.extractionRevision).values({ ...old!, id: crypto.randomUUID(), jobId, createdAt: new Date(Date.now() + 60_000) });
    try {
      const res = await call("get_fact", { fact_id: id });
      const body = res.structuredContent as { superseded: string | null; in_table: { shown: boolean } };
      expect(body.superseded).toMatch(/^A newer read of this filing replaced this one/);
      expect(body.in_table.shown).toBe(false);
    } finally {
      await h.db.$client.query(`DELETE FROM extraction_revision WHERE job_id = $1`, [jobId]);
      await h.db.$client.query(`DELETE FROM job WHERE id = $1`, [jobId]);
    }
  });

  it("answers NOT_FOUND for another workspace's fact, the same as for a missing one", async () => {
    const fact = await h.db.query.financialFact.findFirst({ where: (f, { eq }) => eq(f.workspaceId, h.b.workspace.id) });
    const other = await call("get_fact", { fact_id: fact!.id });
    const missing = await call("get_fact", { fact_id: crypto.randomUUID() });
    expect(other.isError).toBe(true);
    expect(textOf(other)).toMatch(/^NOT_FOUND: /);
    expect(textOf(other)).toBe(textOf(missing));
    expect(other.structuredContent).toBeUndefined();
  });
});
