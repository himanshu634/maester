import { describe, expect, it } from "vitest";
import type { CellCheck, CellSource, CompanyFiling, FinancialCell, FinancialColumn, FinancialFact, SearchHit, StatementTable, WorkspaceFilings } from "@maester/contracts";
import { XBRL_IN_PDF_RESULT_SHOWN } from "../src/present/flags.js";
import { inPdfWords } from "../src/present/words.js";
import { checkSentence } from "../src/present/check.js";
import { CellAnswerSchema, StatementAnswerSchema, presentCell, presentTable } from "../src/present/table.js";
import { FactAnswerSchema, inTableFromCell, presentFact } from "../src/present/fact.js";
import { SEARCH_FIGURES_SENTENCE, SearchAnswerSchema, presentHits } from "../src/present/search.js";
import { FilingsAnswerSchema, presentFilings } from "../src/present/filings.js";

const DOC = "11111111-1111-4111-8111-111111111111";
const DOC2 = "22222222-2222-4222-8222-222222222222";
const CO = "33333333-3333-4333-8333-333333333333";
const CO2 = "44444444-4444-4444-8444-444444444444";
const FACT = "55555555-5555-4555-8555-555555555555";
const REV = "66666666-6666-4666-8666-666666666666";

const NO_CHECK: CellCheck = { role: "none", status: null, checkType: null, subjectLabel: null, expected: null, actual: null };
const company = { id: CO, workspaceId: DOC, displayName: "Synthetic Cements Limited", country: "IN", cin: null, bseCode: null, nseSymbol: "SYNC", isin: null, createdAt: "2026-01-01T00:00:00Z" };
const unit = { label: "₹ in crores", scale: "10000000", currency: "INR" };
const column: FinancialColumn = { periodEnd: "2025-03-31", periodLabel: "FY2025", documentId: DOC, filingPeriodEnd: "2025-03-31" };
const filings: CompanyFiling[] = [{ documentId: DOC, originalName: "ar-2025.pdf", kind: "annual_report", periodEnd: "2025-03-31", intakeState: "read", counted: true }];

const pageSource = { kind: "page", documentId: DOC, pageIndex: 212, pageCount: 286, textLayerMatch: true } as const;
const xbrlSource: Extract<CellSource, { kind: "xbrl" }> = {
  kind: "xbrl", documentId: DOC2, originalName: "results.xml", element: "in-capmkt:Revenue", contextId: "ctx1", decimals: "-5", nil: false,
  periodStart: "2024-04-01", span: "year",
  inPdf: { status: "passed", pdfDocumentId: DOC, pageIndex: 4, statementPages: [4, 5], reason: null },
};

const cell = (over: Partial<FinancialCell> = {}): FinancialCell => ({
  status: "value", value: "-1234.50", printed: "(1,234.50)", factId: FACT, revisionId: REV, source: pageSource, check: NO_CHECK, restated: null, ...over,
});

describe("flags", () => {
  it("keeps the XBRL-in-PDF result hidden", () => {
    expect(XBRL_IN_PDF_RESULT_SHOWN).toBe(false);
  });
});

describe("presentCell", () => {
  it("makes the page 1-based and names the pages of the file", () => {
    const out = presentCell(cell(), column, unit, filings);
    expect(out.source).toEqual({ kind: "page", filing: "ar-2025.pdf", document_id: DOC, page: 213, of: 286, text_layer: expect.any(String) });
    expect(CellAnswerSchema.parse(out)).toBeTruthy();
  });

  it("gives an XBRL cell its element, context and decimals and no page", () => {
    const out = presentCell(cell({ source: xbrlSource }), column, unit, filings);
    expect(out.source).toMatchObject({ kind: "xbrl", filing: "results.xml", element: "in-capmkt:Revenue", context: "ctx1", decimals: "-5" });
    expect(out.source).not.toHaveProperty("page");
    expect(CellAnswerSchema.parse(out)).toBeTruthy();
  });

  it("copies decimal strings untouched", () => {
    expect(presentCell(cell({ value: "-1234.50" }), column, unit, filings).value).toBe("-1234.50");
    expect(presentCell(cell({ value: "0.00" }), column, unit, filings).value).toBe("0.00");
  });

  it("says a missing, unreadable and dash cell in words, never zero", () => {
    const missing = presentCell(cell({ status: "missing", value: null, printed: null, factId: null, source: null }), column, unit, filings);
    expect(missing).toMatchObject({ value: null, status: "not printed", reason: "not printed", fact_id: null });
    const unparsed = presentCell(cell({ status: "unparsed", value: null, printed: "1,2x4" }), column, unit, filings);
    expect(unparsed).toMatchObject({ value: null, reason: "not readable", printed: "1,2x4" });
    const dash = presentCell(cell({ status: "dash", value: null, printed: "-" }), column, unit, filings);
    expect(dash).toMatchObject({ value: null, printed: "–", reason: "a dash printed on the page", status: "a dash printed" });
  });

  it("carries the unit, span, period, review state and restated words", () => {
    const out = presentCell(
      cell({ restated: { kind: "page", documentId: DOC2, filingPeriodEnd: "2026-03-31", pageIndex: 9, value: "1200.00", printed: "1,200.00" } }),
      column, unit, filings,
    );
    expect(out).toMatchObject({
      unit_label: "₹ in crores", scale: "10000000", currency: "INR", span: "year", period_end: "2025-03-31", reviewed: "not yet", fact_id: FACT,
    });
    expect(out.restated).toContain("1,200.00");
    expect(out.restated).toContain("page 10");
    expect(presentCell(cell(), column, unit, filings).restated).toBeNull();
  });

  it("says not checked for an XBRL-in-PDF result while the flag is false", () => {
    for (const status of ["passed", "failed"] as const) {
      const src = { ...xbrlSource, inPdf: { ...xbrlSource.inPdf, status } };
      const out = presentCell(cell({ source: src }), column, unit, filings);
      expect(out.source).toMatchObject({ in_pdf: "not checked" });
    }
    expect(inPdfWords(xbrlSource.inPdf, true)).toBe("found on page 5 of the results PDF");
    expect(inPdfWords({ ...xbrlSource.inPdf, status: "failed" }, true)).toContain("not found");
    expect(inPdfWords(xbrlSource.inPdf)).toBe("not checked");
  });
});

describe("checkSentence", () => {
  const check = (over: Partial<CellCheck>): CellCheck => ({ ...NO_CHECK, ...over });
  it("says passed, not checked and no sum", () => {
    expect(checkSentence(check({ role: "subject", status: "passed", checkType: "subtotal" }), "page", unit)).toBe("Adds up");
    expect(checkSentence(check({ role: "subject", status: "not_checked", checkType: "subtotal" }), "page", unit)).toBe(
      "Not checked: a line the sum needs was not found or has no value",
    );
    expect(checkSentence(NO_CHECK, "page", unit)).toBe("No sum covers this line");
  });
  it("says a failed subtotal without the difference", () => {
    expect(
      checkSentence(check({ role: "subject", status: "failed", checkType: "subtotal", subjectLabel: "Total income", expected: "1243.00", actual: "1234.00" }), "page", unit),
    ).toBe("No. The lines add up to 1234.00; the page prints 1243.00. Both figures are in ₹ crore.");
  });
  it("says a component's subject", () => {
    expect(checkSentence(check({ role: "component", status: "passed", checkType: "subtotal", subjectLabel: "Total income" }), "page", unit)).toBe(
      "Part of total income, which adds up",
    );
    expect(checkSentence(check({ role: "component", status: "failed", checkType: "subtotal", subjectLabel: "Total income" }), "page", unit)).toBe(
      "Part of total income, which doesn't add up",
    );
  });
  it("says the balance identity on the total", () => {
    expect(
      checkSentence(check({ role: "subject", status: "failed", checkType: "balance_identity", subjectLabel: "Total assets", expected: "500.00", actual: "490.00" }), "page", unit),
    ).toBe("No. Total assets doesn't equal equity and liabilities: the page prints 500.00; equity and liabilities come to 490.00. Both figures are in ₹ crore.");
  });
  it("names the XBRL file for an XBRL figure", () => {
    expect(
      checkSentence(check({ role: "subject", status: "failed", checkType: "subtotal", expected: "10.00", actual: "9.00" }), "xbrl", unit),
    ).toBe("No. The lines add up to 9.00; the XBRL file gives 10.00. Both figures are in ₹ crore.");
  });
  it("presents every XBRL-in-PDF status as not checked while the flag is false", () => {
    for (const status of ["passed", "failed"] as const) {
      expect(checkSentence(check({ role: "subject", status, checkType: "xbrl_in_pdf" }), "xbrl", unit)).toBe("Not checked");
    }
  });
});

describe("presentTable", () => {
  const table: StatementTable = {
    statement: "income_statement", basis: "consolidated", unit, columns: [column],
    rows: [
      { key: "a", section: "Income", label: "Revenue from operations", isSubtotal: false, perShare: false, cells: [cell()] },
      { key: "b", section: "Per share", label: "Basic EPS", isSubtotal: false, perShare: true, cells: [cell({ value: "12.40" })] },
    ],
    unplaced: 2, leftOut: [{ documentId: DOC2, reason: "other_currency" }],
  };
  it("gives rows as printed lines and cells the table's unit", () => {
    const out = presentTable(company, filings, table);
    expect(StatementAnswerSchema.parse(out)).toBeTruthy();
    expect(out.company).toMatchObject({ id: CO, name: "Synthetic Cements Limited" });
    expect(out.rows[0]).toMatchObject({ line: "as printed; no concept mapping yet", label: "Revenue from operations", section: "Income" });
    expect(out.rows[0]!.cells[0]).toMatchObject({ unit_label: "₹ in crores", scale: "10000000", currency: "INR", span: "year", reviewed: "not yet" });
    expect(out.columns[0]).toMatchObject({ period_end: "2025-03-31", filing: "ar-2025.pdf", document_id: DOC });
    expect(out.note).toBe("Each year comes whole from the newest filing that prints it, so a column never mixes filings.");
    expect(out.left_out).toHaveLength(1);
    expect(out.undated_figures).toBe(2);
  });
  it("labels a per-share row in rupees a share, not the table's unit", () => {
    const out = presentTable(company, filings, table);
    expect(out.rows[1]!.cells[0]).toMatchObject({ value: "12.40", unit_label: "rupees a share", scale: "1", currency: "INR" });
  });
});

describe("presentFact", () => {
  const fact: FinancialFact = {
    id: FACT, revisionId: REV, companyId: CO, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 1,
    reportedLabel: "Revenue from operations", isSubtotal: false, componentLabels: [], periodLabel: "FY2025", periodEnd: "2025-03-31", asOfDate: null,
    reportedText: "(1,234.50)", reportedValue: "-1234.50", valueStatus: "value", unitLabel: "₹ in crores", scaleFactor: "10000000", currency: "INR",
    normalizedValue: "-12345000000.00", periodStart: "2024-04-01", span: "year", source: { kind: "page", documentId: DOC, pageIndex: 212, textLayerMatch: true },
  };
  const filing = { name: "ar-2025.pdf", documentId: DOC, kind: "annual_report", periodEnd: "2025-03-31", pageCount: 286 };
  it("gives the figure beside its own unit, and the citation", () => {
    const out = presentFact(fact, filing, { check: "Adds up", superseded: null, inTable: null });
    expect(FactAnswerSchema.parse(out)).toBeTruthy();
    expect(out).toMatchObject({
      reported_value: "-1234.50", printed: "(1,234.50)", unit_label: "₹ in crores", scale: "10000000", currency: "INR",
      basis: "consolidated", span: "year", period_start: "2024-04-01", period_end: "2025-03-31", reviewed: "not yet", in_table: null, superseded: null,
    });
    expect(out.source).toMatchObject({ kind: "page", page: 213, of: 286, filing: "ar-2025.pdf", document_id: DOC });
    expect(out.filing).toMatchObject({ name: "ar-2025.pdf", kind: "annual_report" });
  });
  it("carries in_table.value only beside in_table.unit", () => {
    const inTable = inTableFromCell({ ...presentCell(cell({ value: "-123.45" }), column, unit, filings), fact_id: FACT });
    const out = presentFact(fact, filing, { check: "Adds up", superseded: null, inTable });
    expect(out.in_table).toMatchObject({ shown: true, value: "-123.45", unit: { label: "₹ in crores", scale: "10000000", currency: "INR" } });
    expect(FactAnswerSchema.parse(out)).toBeTruthy();
  });
  it("says an unknown value in words, never zero", () => {
    const out = presentFact({ ...fact, valueStatus: "dash", reportedValue: null, reportedText: "-" }, filing, { check: "Adds up", superseded: "A newer read replaced this one.", inTable: null });
    expect(out).toMatchObject({ reported_value: null, reason: "a dash printed on the page", superseded: "A newer read replaced this one." });
  });
  it("gives an XBRL fact its element and context", () => {
    const out = presentFact({ ...fact, source: { kind: "xbrl", documentId: DOC2, element: "e", contextId: "c", decimals: "-5", nil: false } }, filing, { check: "Adds up", superseded: null, inTable: null });
    expect(out.source).toMatchObject({ kind: "xbrl", element: "e", context: "c", decimals: "-5" });
    expect(out.source).not.toHaveProperty("page");
  });
});

describe("presentHits", () => {
  const hit: SearchHit = {
    documentId: DOC, documentName: "ar-2025.pdf", companyId: CO, companyName: "Synthetic Cements Limited", pageNumber: 7, element: null,
    sectionPath: ["Directors’ report"], textSource: "ocr", kind: "prose", text: "Revenue grew 12% to 1,234 crore.", vectorRank: 1, keywordRank: null,
  };
  it("copies the 1-based page and carries the fixed figures sentence", () => {
    const out = presentHits([hit]);
    expect(SearchAnswerSchema.parse(out)).toBeTruthy();
    expect(out.figures).toBe("Passages are context. A number in a passage is not a figure Maester has read or checked; use get_statement or get_fact for figures.");
    expect(out.figures).toBe(SEARCH_FIGURES_SENTENCE);
    expect(out.passages[0]).toMatchObject({ page: 7, filing: "ar-2025.pdf", document_id: DOC, text: hit.text });
  });
});

describe("presentFilings", () => {
  const filingsIn: WorkspaceFilings = {
    companies: [
      {
        company,
        filings: [
          {
            key: "k", kind: "financial_results", otherType: null, periodEnd: "2025-03-31", spans: ["full_year"], settled: true, addedAt: "2026-01-01T00:00:00Z",
            files: [],
            sources: [
              {
                basis: "consolidated",
                statements: [
                  {
                    statement: "income_statement", source: "xbrl", xbrlDocumentId: DOC2, xbrlSpans: ["year"], pdfDocumentId: DOC, pdfPages: [4], reason: null,
                    inPdf: { found: 10, checked: 12, notFound: [FACT], notChecked: null },
                  },
                  { statement: "cash_flow", source: null, xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: null, pdfPages: [], reason: "not_in_filing", inPdf: null },
                ],
              },
            ],
          },
        ],
      },
      { company: { ...company, id: CO2, displayName: "Other Limited" }, filings: [] },
    ],
    held: [],
    unsorted: [],
  };
  it("keeps only the asked company and says the XBRL-in-PDF counts are not checked", () => {
    const out = presentFilings(filingsIn, CO);
    expect(FilingsAnswerSchema.parse(out)).toBeTruthy();
    expect(out.companies).toHaveLength(1);
    const st = out.companies[0]!.filings[0]!.sources[0]!.statements;
    expect(st[0]).toMatchObject({ source: "xbrl", pdf_pages: [5], in_pdf: "not checked" });
    expect(st[1]).toMatchObject({ source: null, reason: expect.stringContaining("doesn't") });
    expect(JSON.stringify(out)).not.toContain("10 of 12");
  });
  it("lists every company with no filter", () => {
    expect(presentFilings(filingsIn, null).companies).toHaveLength(2);
  });
});

describe("fix wave: words a reader can act on", () => {
  it("keeps the reason of an XBRL-in-PDF check that never ran, flag or no flag", () => {
    const never = { ...xbrlSource.inPdf, status: "not_checked" as const, pageIndex: null, reason: "disabled" as const };
    expect(inPdfWords(never)).toBe("not checked: the check against the PDF is turned off");
    expect(inPdfWords({ ...xbrlSource.inPdf, status: "passed" })).toBe("not checked");
  });

  it("names rupees a share for a per-share figure, not the table's unit", () => {
    const perShare = { label: "rupees a share", scale: "1", currency: "INR" };
    const failed: CellCheck = { ...NO_CHECK, role: "subject", status: "failed", checkType: "subtotal", expected: "12.40", actual: "12.00" };
    expect(checkSentence(failed, "page", perShare)).toBe("No. The lines add up to 12.00; the page prints 12.40. Both figures are in rupees a share.");
    expect(checkSentence(failed, "xbrl", { label: "₹ a share", scale: "1", currency: "INR" })).toContain("in rupees a share.");
  });

  it("names the other filing, its page and both units when a year was restated", () => {
    const restated = presentCell(
      cell({ restated: { kind: "page", documentId: DOC2, filingPeriodEnd: "2026-03-31", pageIndex: 86, value: "2389.1", printed: "2,389.10" } }),
      column, unit, filings,
    );
    expect(restated.restated).toBe(
      `Another filing for the period ending 2026-03-31 (document_id ${DOC2}) printed 2,389.10 for this year on page 87, in its own unit; that is 2389.1 in this table's unit (₹ crore). This table shows this column's filing's figure.`,
    );
  });

  const fact: FinancialFact = {
    id: FACT, revisionId: REV, companyId: CO, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 1,
    reportedLabel: "Revenue from operations", isSubtotal: false, componentLabels: [], periodLabel: "Quarter ended 31.03.2026", periodEnd: "2026-03-31", asOfDate: null,
    reportedText: "640.25", reportedValue: "640.25", valueStatus: "value", unitLabel: "₹ in crores", scaleFactor: "10000000", currency: "INR",
    normalizedValue: "6402500000", periodStart: null, span: null, source: { kind: "page", documentId: DOC, pageIndex: 2, textLayerMatch: true },
  };
  const filing = { name: "results.pdf", documentId: DOC, kind: "financial_results", periodEnd: "2026-03-31", pageCount: 6 };

  it("says why a PDF fact has no span, and never works one out from the label", () => {
    const out = presentFact(fact, filing, { check: "No sum covers this line", superseded: null, inTable: null });
    expect(out).toMatchObject({ span: null, period_start: null, check: "No sum covers this line" });
    expect(out.span_reason).toMatch(/^The read did not record the span or the period start/);
    expect(FactAnswerSchema.parse(out)).toBeTruthy();
    const balance = presentFact({ ...fact, periodEnd: null, asOfDate: "2026-03-31" }, filing, { check: "Adds up", superseded: null, inTable: null });
    expect(balance.span_reason).toBe("A balance on one day (as_of_date), so it has no span or period start.");
  });

  it("ties an XBRL fact's in_pdf to the flag: wire the fact's own outcome before the result is shown", () => {
    // fact.ts writes "not checked" for an XBRL fact's in_pdf. That is right only while the result is hidden.
    expect(XBRL_IN_PDF_RESULT_SHOWN).toBe(false);
  });
});
