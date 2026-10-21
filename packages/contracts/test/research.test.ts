import { describe, expect, it } from "vitest";
import { CellCheck, CellSource, CompanyFinancials, CompanyStock, Restated, ResearchCompanies } from "../src/index.js";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const company = { id: ID, workspaceId: ID, displayName: "Synthetic Cements Limited", country: "IN", cin: null, bseCode: null, nseSymbol: "SYNCEM", isin: null, createdAt: "2026-10-13T10:00:00.000Z" };

describe("research contracts", () => {
  it("parses a company's financials with one stitched cell", () => {
    const body = CompanyFinancials.parse({
      company,
      filings: [{ documentId: ID, originalName: "ar-2025-26.pdf", kind: "annual_report", periodEnd: "2026-03-31", intakeState: "read", counted: true }],
      tables: [{
        statement: "income_statement", basis: "consolidated",
        unit: { label: "₹ in crore", scale: "10000000", currency: "INR" },
        columns: [{ periodEnd: "2026-03-31", periodLabel: "Year ended 31 March 2026", documentId: ID, filingPeriodEnd: "2026-03-31" }],
        rows: [{
          key: "income|revenue from operations|0", section: "Income", label: "Revenue from operations", isSubtotal: false, perShare: false,
          cells: [{
            status: "value", value: "12105.4", printed: "12,105.40", factId: ID, revisionId: ID,
            source: { kind: "page", documentId: ID, pageIndex: 212, pageCount: 286, textLayerMatch: true },
            check: { role: "component", status: "passed", checkType: "subtotal", subjectLabel: "Total income", expected: "12480", actual: "12480" },
            restated: null,
          }],
        }],
        unplaced: 0, leftOut: [],
      }],
    });
    expect(body.tables[0]!.rows[0]!.cells[0]!.source).toMatchObject({ kind: "page", pageIndex: 212 });
  });

  it("parses a table with no columns, whose figures had no date", () => {
    const body = CompanyFinancials.parse({
      company, filings: [],
      tables: [{ statement: "balance_sheet", basis: "standalone", unit: { label: null, scale: null, currency: null }, columns: [], rows: [], unplaced: 42, leftOut: [] }],
    });
    expect(body.tables[0]!.unplaced).toBe(42);
  });

  it("refuses a check of an unknown type", () => {
    const check = { role: "subject", status: "failed", checkType: "made_up", subjectLabel: "Total assets", expected: "300", actual: "290" };
    expect(() => CellCheck.parse(check)).toThrow();
    expect(CellCheck.parse({ ...check, checkType: "balance_identity" }).checkType).toBe("balance_identity");
  });

  describe("CellSource", () => {
    const page = { kind: "page", documentId: ID, pageIndex: 212, pageCount: 286, textLayerMatch: true };
    const xbrl = {
      kind: "xbrl", documentId: ID, originalName: "Integrated_Finance_Ind_As_MC.xml", element: "RevenueFromOperations", contextId: "FourD",
      decimals: "-5", nil: false, periodStart: "2025-04-01", span: "year",
      inPdf: { status: "passed", pdfDocumentId: ID, pageIndex: 4, statementPages: [4, 5], reason: null },
    };

    it("parses a page cell and an XBRL cell", () => {
      expect(CellSource.parse(page).kind).toBe("page");
      expect(CellSource.parse(xbrl)).toEqual(xbrl);
    });

    it("refuses a page variant without pageIndex", () => {
      const noPage: Record<string, unknown> = { ...page };
      delete noPage.pageIndex;
      expect(() => CellSource.parse(noPage)).toThrow();
    });

    it("refuses an XBRL variant with a pageIndex", () => {
      expect(() => CellSource.parse({ ...xbrl, pageIndex: 4 })).toThrow();
    });

    it("refuses an XBRL variant with an unknown not-checked reason", () => {
      expect(() => CellSource.parse({ ...xbrl, inPdf: { ...xbrl.inPdf, status: "not_checked", reason: "made_up" } })).toThrow();
    });
  });

  it("parses a restated figure from a page or an XBRL element, and refuses a page one with an element", () => {
    const base = { documentId: ID, filingPeriodEnd: "2026-03-31", value: "12346", printed: "12,346" };
    expect(Restated.parse({ kind: "page", ...base, pageIndex: 3 }).kind).toBe("page");
    expect(Restated.parse({ kind: "xbrl", ...base, element: "RevenueFromOperations" }).kind).toBe("xbrl");
    expect(() => Restated.parse({ kind: "page", ...base, pageIndex: 3, element: "RevenueFromOperations" })).toThrow();
    expect(() => Restated.parse({ kind: "xbrl", ...base, element: "RevenueFromOperations", pageIndex: 3 })).toThrow();
  });

  it("parses a stock with no price", () => {
    const stock = CompanyStock.parse({ state: "not_tracked", symbol: "HARBOUR", source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] });
    expect(stock.state).toBe("not_tracked");
  });

  it("parses the company list", () => {
    const list = ResearchCompanies.parse({ items: [{ company, annualReportsRead: 3, latestPeriodEnd: "2026-03-31", reading: 0, failed: 0 }] });
    expect(list.items).toHaveLength(1);
  });

  it("refuses an unknown stock state", () => {
    expect(() => CompanyStock.parse({ state: "maybe", symbol: null, source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] })).toThrow();
  });
});
