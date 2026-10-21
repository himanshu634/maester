import { describe, expect, it } from "vitest";
import type { XbrlInPdf } from "@maester/contracts";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";
import { moveDecimal, normalise, roundTo, stitch, type Filing } from "../src/financials/stitch.js";

const WS = "00000000-0000-4000-8000-000000000000";
type Kind = "income_statement" | "balance_sheet" | "cash_flow";
type Opts = {
  statement?: Kind; basis?: "consolidated" | "standalone"; section?: string; order?: number; subtotal?: boolean; parts?: string[];
  status?: "value" | "dash" | "unparsed"; scale?: string | null; currency?: string; page?: number; match?: boolean | null; dated?: boolean;
};
type Doc = { documentId: string; revisionId: string };

function fact(doc: Doc, label: string, periodEnd: string, printed: string, o: Opts = {}): FactWithSource {
  const scale = o.scale === undefined ? "10000000" : o.scale;
  const status = o.status ?? "value";
  const reported = status === "value" ? printed.replace(/,/g, "").replace(/^\((.*)\)$/, "-$1") : null;
  const statement = o.statement ?? "income_statement";
  const balance = statement === "balance_sheet";
  const dated = o.dated ?? true;
  const id = crypto.randomUUID();
  return {
    fact: {
      id, workspaceId: WS, revisionId: doc.revisionId, companyId: null, statement, basis: o.basis ?? "consolidated",
      section: o.section ?? "Income", lineOrder: o.order ?? 0, reportedLabel: label, isSubtotal: o.subtotal ?? false,
      componentLabels: o.parts ?? [], periodLabel: `Year ended ${periodEnd}`,
      periodEnd: dated && !balance ? periodEnd : null, periodStart: null, span: null, asOfDate: dated && balance ? periodEnd : null,
      reportedText: printed, reportedValue: reported, valueStatus: status, unitLabel: "₹ in crore", scaleFactor: scale,
      currency: o.currency ?? "INR",
      normalizedValue: reported === null || scale === null ? null : moveDecimal(reported, scale.length - 1),
      createdAt: new Date(),
    },
    source: { id: crypto.randomUUID(), workspaceId: WS, factId: id, documentId: doc.documentId, pageIndex: (o.page ?? 213) - 1, textLayerMatch: o.match === undefined ? true : o.match },
    xbrl: null,
  };
}

type XOpts = {
  statement?: Kind; basis?: "consolidated" | "standalone"; section?: string; order?: number; span?: "quarter" | "half_year" | "nine_months" | "year" | null;
  start?: string | null; unit?: string; scale?: string; element?: string; context?: string; decimals?: string | null; nil?: boolean;
};

/** An XBRL fact as `document.xbrl` writes it: a duration with its span and start, or an instant (span null) with its as-of date. */
function xfact(doc: Doc, label: string, periodEnd: string, value: string | null, o: XOpts = {}): FactWithSource {
  const span = o.span === undefined ? "year" : o.span;
  const scale = o.scale ?? "10000000";
  const nil = o.nil ?? false;
  const id = crypto.randomUUID();
  const day = new Date(`${periodEnd}T00:00:00Z`);
  const label_ = `${span === null ? "As at" : "Year ended"} ${day.getUTCDate()} ${day.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${day.getUTCFullYear()}`;
  return {
    fact: {
      id, workspaceId: WS, revisionId: doc.revisionId, companyId: null, statement: o.statement ?? (span === null ? "balance_sheet" : "income_statement"),
      basis: o.basis ?? "consolidated", section: o.section ?? "Income", lineOrder: o.order ?? 0, reportedLabel: label, isSubtotal: false, componentLabels: [],
      periodLabel: label_, periodEnd: span === null ? null : periodEnd, periodStart: span === null ? null : (o.start === undefined ? null : o.start), span,
      asOfDate: span === null ? periodEnd : null, reportedText: nil ? "" : value!, reportedValue: nil ? null : value, valueStatus: nil ? "unparsed" : "value",
      unitLabel: o.unit ?? "₹ crore", scaleFactor: scale, currency: "INR",
      normalizedValue: nil || value === null ? null : moveDecimal(value, scale.length - 1), createdAt: new Date(),
    },
    source: null,
    xbrl: {
      id: crypto.randomUUID(), workspaceId: WS, factId: id, documentId: doc.documentId, element: o.element ?? "RevenueFromOperations", contextId: o.context ?? "FourD",
      decimals: o.decimals === undefined ? "-5" : o.decimals, nil, concept: null, footnoteIds: [], createdAt: new Date(),
    },
  };
}

function check(
  doc: Doc, subject: string, periodEnd: string, status: "passed" | "failed", expected: string, actual: string,
  o: { statement?: Kind; section?: string | null; type?: "subtotal" | "balance_identity" } = {},
): ExtractionCheckRow {
  return {
    id: crypto.randomUUID(), workspaceId: WS, revisionId: doc.revisionId, checkType: o.type ?? "subtotal", statement: o.statement ?? "income_statement",
    basis: "consolidated", section: o.section === undefined ? "Income" : o.section, periodLabel: `Year ended ${periodEnd}`, subjectLabel: subject, status, expected, actual, detail: "",
    factId: null, pdfDocumentId: null, pdfClassificationId: null, pageIndex: null, reason: null, checkVersion: null,
  };
}

const COMPANY = "11111111-1111-4111-8111-111111111111";
type FilingOpts = { source?: "pdf" | "xbrl"; kind?: "annual_report" | "financial_results"; inPdf?: (d: Doc, facts: FactWithSource[]) => Map<string, XbrlInPdf> };

function filing(
  periodEnd: string, build: (d: Doc) => { facts: FactWithSource[]; checks?: ExtractionCheckRow[] }, created = "2026-10-01T00:00:00Z", o: FilingOpts = {},
): Filing {
  const doc = { documentId: crypto.randomUUID(), revisionId: crypto.randomUUID() };
  const { facts, checks = [] } = build(doc);
  const source = o.source ?? "pdf";
  return {
    documentId: doc.documentId, revisionId: doc.revisionId, companyId: COMPANY, source, filingKind: o.kind ?? "annual_report",
    originalName: source === "xbrl" ? "Integrated_Finance_Ind_As_MC.xml" : "ar.pdf",
    periodEnd, revisionCreatedAt: new Date(created), pageCount: source === "xbrl" ? 1 : 286, facts, checks,
    inPdf: o.inPdf ? o.inPdf(doc, facts) : new Map(),
  };
}

/** An XBRL filing (an MCA-style annual instance unless `kind` says results), read before the PDFs unless `created` says otherwise. */
const xfiling = (periodEnd: string, build: (d: Doc) => { facts: FactWithSource[] }, o: FilingOpts & { created?: string } = {}) =>
  filing(periodEnd, build, o.created ?? "2026-09-01T00:00:00Z", { source: "xbrl", ...o });

const pl = (tables: ReturnType<typeof stitch>, basis = "consolidated") =>
  tables.find((t) => t.statement === "income_statement" && t.basis === basis)!;
const row = (t: ReturnType<typeof pl>, label: string, n = 0) => t.rows.filter((r) => r.label === label)[n]!;

describe("moveDecimal", () => {
  it("moves the point exactly, both ways", () => {
    expect(moveDecimal("121054000000", -7)).toBe("12105.4");
    expect(moveDecimal("12105.40", 0)).toBe("12105.4");
    expect(moveDecimal("-12.40", 7)).toBe("-124000000");
    expect(moveDecimal("0.05", -2)).toBe("0.0005");
    expect(moveDecimal("-0.00", 0)).toBe("0");
  });
});

describe("roundTo", () => {
  it("rounds half away from zero, exactly, to places or to tens and hundreds", () => {
    expect(roundTo("12105.4321", 2)).toBe("12105.43");
    expect(roundTo("12105.425", 2)).toBe("12105.43");
    expect(roundTo("-12105.425", 2)).toBe("-12105.43");
    expect(roundTo("1210543.21", 0)).toBe("1210543");
    expect(roundTo("1210550", -2)).toBe("1210600");
    expect(roundTo("1210549.99", -2)).toBe("1210500");
    expect(roundTo("12105.4", 3)).toBe("12105.4");
    expect(roundTo("-0.004", 2)).toBe("0");
  });
});

describe("normalise", () => {
  it("ignores case, punctuation, & and spacing", () => {
    expect(normalise("Depreciation & Amortisation  expense.")).toBe(normalise("depreciation and amortisation expense"));
  });
});

describe("stitch", () => {
  it("takes each year whole from the newest filing that prints it, oldest year first", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2025-03-31", "11,240.75", { page: 198 }), fact(d, "Revenue from operations", "2024-03-31", "10,312.80", { page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40"), fact(d, "Revenue from operations", "2025-03-31", "11,240.75")] }));
    const t = pl(stitch([ar25, ar26]));
    expect(t.columns.map((c) => c.periodEnd)).toEqual(["2024-03-31", "2025-03-31", "2026-03-31"]);
    expect(t.columns.map((c) => c.documentId)).toEqual([ar25.documentId, ar26.documentId, ar26.documentId]);
    expect(row(t, "Revenue from operations").cells.map((c) => c.value)).toEqual(["10312.8", "11240.75", "12105.4"]);
    expect(row(t, "Revenue from operations").cells[2]!.source).toEqual({ kind: "page", documentId: ar26.documentId, pageIndex: 212, pageCount: 286, textLayerMatch: true });
  });

  it("marks a figure restated when an older filing printed something else for that year", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2025-03-31", "2,389.10", { page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2026-03-31", "2,602.15"), fact(d, "Freight and forwarding", "2025-03-31", "2,401.60")] }));
    const cells = row(pl(stitch([ar26, ar25])), "Freight and forwarding").cells;
    expect(cells[0]!.value).toBe("2401.6");
    expect(cells[0]!.restated).toEqual({ kind: "page", documentId: ar25.documentId, filingPeriodEnd: "2025-03-31", pageIndex: 197, value: "2389.1", printed: "2,389.10" });
    expect(cells[1]!.restated).toBeNull();
  });

  it("doesn't mark a figure restated when the older filing printed the same", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.25")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.250")] }));
    expect(row(pl(stitch([ar25, ar26])), "Other income").cells[0]!.restated).toBeNull();
  });

  describe("when the unit changed between filings", () => {
    const REV = "Revenue from operations";
    const LAKH = { scale: "100000" };
    // AR 2024–25 prints in lakh, AR 2025–26 in crore: the table is in crore, and 2024–25 comes from AR 2025–26.
    const lakhThenCrore = (older: string, newer = "12,105.43") => {
      const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, REV, "2025-03-31", older, { ...LAKH, page: 198 })] }));
      const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2026-03-31", "13,040.10"), fact(d, REV, "2025-03-31", newer)] }));
      return { ar25, cell: row(pl(stitch([ar25, ar26])), REV).cells[0]! };
    };
    // AR 2024–25 prints in crore, AR 2025–26 in lakh: the table is in lakh.
    const croreThenLakh = (older: string, newer = "12,10,543.21") => {
      const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, REV, "2025-03-31", older, { page: 198 })] }));
      const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2026-03-31", "13,04,010.00", LAKH), fact(d, REV, "2025-03-31", newer, LAKH)] }));
      return { ar25, cell: row(pl(stitch([ar25, ar26])), REV).cells[0]! };
    };

    it("doesn't mark a year restated when only lakh became crore", () => {
      const { cell } = lakhThenCrore("12,10,543.21");
      expect(cell.value).toBe("12105.43");
      expect(cell.restated).toBeNull();
    });

    it("marks it restated when lakh and crore still differ at the coarser precision", () => {
      const { ar25, cell } = lakhThenCrore("12,10,553.21");
      expect(cell.value).toBe("12105.43");
      expect(cell.restated).toEqual({ kind: "page", documentId: ar25.documentId, filingPeriodEnd: "2025-03-31", pageIndex: 197, value: "12105.5321", printed: "12,10,553.21" });
    });

    it("doesn't mark a year restated when only crore became lakh", () => {
      const { cell } = croreThenLakh("12,105.43");
      expect(cell.value).toBe("1210543.21");
      expect(cell.restated).toBeNull();
    });

    it("marks it restated when crore and lakh still differ at the coarser precision", () => {
      const { ar25, cell } = croreThenLakh("12,105.53");
      expect(cell.restated).toEqual({ kind: "page", documentId: ar25.documentId, filingPeriodEnd: "2025-03-31", pageIndex: 197, value: "1210553", printed: "12,105.53" });
    });

    it("compares whole crore with lakh to the nearest hundred lakh", () => {
      expect(croreThenLakh("12,105").cell.restated).toBeNull();
      expect(croreThenLakh("12,106").cell.restated).not.toBeNull();
    });

    it("rounds the finer figure half up, away from zero for a negative one", () => {
      expect(lakhThenCrore("12,10,542.50").cell.restated).toBeNull();
      expect(lakhThenCrore("12,10,542.49").cell.restated).not.toBeNull();
      expect(lakhThenCrore("(12,10,542.50)", "(12,105.43)").cell.restated).toBeNull();
    });

    it("keeps a trailing zero's precision: 12,105.40 is not 12,105.43", () => {
      expect(lakhThenCrore("12,10,543.21", "12,105.40").cell.restated).toMatchObject({ value: "12105.4321", printed: "12,10,543.21" });
    });

    it("still marks a change of status, whatever the unit", () => {
      const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, REV, "2025-03-31", "-", { ...LAKH, status: "dash", page: 198 })] }));
      const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2025-03-31", "12,105.43")] }));
      expect(row(pl(stitch([ar25, ar26])), REV).cells[0]!.restated).toMatchObject({ value: null, printed: "-" });
    });
  });

  it("matches lines by printed name, ignoring case, punctuation and &", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Depreciation & amortisation expense", "2025-03-31", "742.80")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Depreciation and Amortisation Expense.", "2026-03-31", "806.25")] }));
    const t = pl(stitch([ar25, ar26]));
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.label).toBe("Depreciation and Amortisation Expense.");
  });

  it("keeps a renamed line as two rows, each missing where the other is printed", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding expenses", "2023-03-31", "2,040.10")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2026-03-31", "2,602.15")] }));
    const t = pl(stitch([ar23, ar26]));
    expect(row(t, "Freight and forwarding").cells.map((c) => c.status)).toEqual(["missing", "value"]);
    expect(row(t, "Freight and forwarding expenses").cells.map((c) => c.status)).toEqual(["value", "missing"]);
    expect(row(t, "Freight and forwarding").cells[0]!.value).toBeNull();
  });

  it("orders rows by the newest filing and puts an older-only row after the row before it", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2023-03-31", "9,605.25", { order: 0 }),
      fact(d, "Excise duty", "2023-03-31", "120.00", { order: 1 }),
      fact(d, "Other income", "2023-03-31", "244.75", { order: 2 }),
    ] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { order: 0 }),
      fact(d, "Other income", "2026-03-31", "374.60", { order: 1 }),
    ] }));
    expect(pl(stitch([ar23, ar26])).rows.map((r) => r.label)).toEqual(["Revenue from operations", "Excise duty", "Other income"]);
  });

  it("keeps lines with the same name apart by section and occurrence", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Borrowings", "2026-03-31", "2,410.80", { statement: "balance_sheet", section: "Non-current liabilities", order: 0 }),
      fact(d, "Borrowings", "2026-03-31", "312.45", { statement: "balance_sheet", section: "Current liabilities", order: 1 }),
      fact(d, "Others", "2026-03-31", "10.00", { statement: "balance_sheet", section: "Current liabilities", order: 2 }),
      fact(d, "Others", "2026-03-31", "20.00", { statement: "balance_sheet", section: "Current liabilities", order: 3 }),
    ] }));
    const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
    expect(bs.rows.map((r) => r.cells[0]!.value)).toEqual(["2410.8", "312.45", "10", "20"]);
    expect(new Set(bs.rows.map((r) => r.key)).size).toBe(4);
  });

  it("converts an older filing's lakh to the table's crore", () => {
    const ar23 = filing("2023-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2023-03-31", "9,60,525.00", { scale: "100000" })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40")] }));
    const t = pl(stitch([ar23, ar26]));
    expect(t.unit).toEqual({ label: "₹ in crore", scale: "10000000", currency: "INR" });
    expect(row(t, "Revenue from operations").cells[0]!.value).toBe("9605.25");
  });

  it("reads a per-share line as printed, not scaled by the statement's unit", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [fact(d, "Basic", "2026-03-31", "61.98", { section: "Earnings per equity share (face value ₹10)" })] }));
    const r = row(pl(stitch([ar])), "Basic");
    expect(r.perShare).toBe(true);
    expect(r.cells[0]!.value).toBe("61.98");
  });

  it("reads a line labelled in the singular, \"Earning per share\", as a per-share line", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Earning per share - Basic (₹)", "2025-03-31", "48.60", { scale: "100000", page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Earning per share - Basic (₹)", "2026-03-31", "61.98")] }));
    const r = row(pl(stitch([ar25, ar26])), "Earning per share - Basic (₹)");
    expect(r.perShare).toBe(true);
    expect(r.cells.map((c) => c.value)).toEqual(["48.6", "61.98"]);
  });

  it("matches \"EPS\" only as a word", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Basic EPS", "2026-03-31", "61.98", { order: 0 }),
      fact(d, "Next steps provision", "2026-03-31", "12.00", { order: 1 }),
      fact(d, "Repsol joint venture income", "2026-03-31", "40.00", { order: 2 }),
    ] }));
    expect(pl(stitch([ar])).rows.map((r) => r.perShare)).toEqual([true, false, false]);
  });

  it("leaves out a filing in another currency, and one whose unit can't be converted", () => {
    const usd = filing("2025-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2025-03-31", "1,350.00", { currency: "USD", scale: "1000000" })] }));
    const odd = filing("2024-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2024-03-31", "10.00", { scale: null })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40")] }));
    const t = pl(stitch([usd, odd, ar26]));
    expect(t.columns.map((c) => c.periodEnd)).toEqual(["2026-03-31"]);
    expect(t.leftOut).toEqual([
      { documentId: usd.documentId, reason: "other_currency" },
      { documentId: odd.documentId, reason: "other_unit" },
    ]);
  });

  it("counts figures with no date and leaves them out", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40"), fact(d, "Other income", "2026-03-31", "374.60", { dated: false })] }));
    const t = pl(stitch([ar]));
    expect(t.unplaced).toBe(1);
    expect(t.rows.map((r) => r.label)).toEqual(["Revenue from operations"]);
  });

  it("keeps a statement whose figures have no date as a table with no columns, saying how many", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { dated: false, order: 0 }),
      fact(d, "Other income", "2026-03-31", "374.60", { dated: false, order: 1 }),
    ] }));
    expect(stitch([ar])).toEqual([
      { statement: "income_statement", basis: "consolidated", unit: { label: "₹ in crore", scale: "10000000", currency: "INR" }, columns: [], rows: [], unplaced: 2, leftOut: [] },
    ]);
  });

  it("keeps a filing left out for its currency on a table with no columns", () => {
    const usd = filing("2025-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2025-03-31", "1,350.00", { currency: "USD", scale: "1000000" })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { dated: false })] }));
    const t = pl(stitch([usd, ar26]));
    expect(t.columns).toEqual([]);
    expect(t.unplaced).toBe(1);
    expect(t.leftOut).toEqual([{ documentId: usd.documentId, reason: "other_currency" }]);
  });

  it("gives a subtotal its check, and each of its lines the subtotal's check", () => {
    const ar = filing("2026-03-31", (d) => ({
      facts: [
        fact(d, "Revenue from operations", "2026-03-31", "12,105.40", { order: 0 }),
        fact(d, "Other income", "2026-03-31", "374.60", { order: 1 }),
        fact(d, "Total income", "2026-03-31", "12,480.00", { order: 2, subtotal: true, parts: ["Revenue from operations", "Other income"] }),
        fact(d, "Exceptional items", "2026-03-31", "-", { order: 3, status: "dash" }),
      ],
      checks: [check(d, "Total income", "2026-03-31", "failed", "12480.00", "12489.00")],
    }));
    const t = pl(stitch([ar]));
    expect(row(t, "Total income").cells[0]!.check).toEqual({ role: "subject", status: "failed", checkType: "subtotal", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Other income").cells[0]!.check).toEqual({ role: "component", status: "failed", checkType: "subtotal", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Exceptional items").cells[0]!.check).toEqual({ role: "none", status: null, checkType: null, subjectLabel: null, expected: null, actual: null });
  });

  it("matches a check to its subtotal by section when two subtotals share a name", () => {
    const ar = filing("2026-03-31", (d) => ({
      facts: [
        fact(d, "Total", "2026-03-31", "13,288.00", { statement: "balance_sheet", section: "Non-current assets", subtotal: true, order: 0 }),
        fact(d, "Total", "2026-03-31", "4,292.00", { statement: "balance_sheet", section: "Current assets", subtotal: true, order: 1 }),
      ],
      checks: [
        check(d, "Total", "2026-03-31", "passed", "13288.00", "13288.00", { statement: "balance_sheet", section: "Non-current assets" }),
        check(d, "Total", "2026-03-31", "failed", "4300.00", "4292.00", { statement: "balance_sheet", section: "Current assets" }),
      ],
    }));
    const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
    expect(bs.rows.map((r) => r.cells[0]!.check.status)).toEqual(["passed", "failed"]);
  });

  describe("when total assets has two checks, its section's subtotal and the section-less balance identity", () => {
    const subtotalPassed = (d: Doc) => check(d, "Total assets", "2026-03-31", "passed", "17580.00", "17580.00", { statement: "balance_sheet", section: "Assets" });
    const identityFailed = (d: Doc) =>
      check(d, "Total assets", "2026-03-31", "failed", "17580.00", "17588.00", { statement: "balance_sheet", section: null, type: "balance_identity" });
    const orders = { "passed first": [subtotalPassed, identityFailed], "failed first": [identityFailed, subtotalPassed] };
    for (const [name, order] of Object.entries(orders)) {
      // Changed by the final review's ruling 2: the identity is about the total, so its lines keep their subtotal's check.
      it(`shows the failed identity on total assets, and the passed subtotal on its lines (${name})`, () => {
        const ar = filing("2026-03-31", (d) => ({
          facts: [
            fact(d, "Property, plant and equipment", "2026-03-31", "9,000.00", { statement: "balance_sheet", section: "Assets", order: 0 }),
            fact(d, "Total assets", "2026-03-31", "17,580.00", { statement: "balance_sheet", section: "Assets", order: 1, subtotal: true, parts: ["Property, plant and equipment"] }),
          ],
          checks: order.map((make) => make(d)),
        }));
        const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
        expect(row(bs, "Total assets").cells[0]!.check).toEqual({
          role: "subject", status: "failed", checkType: "balance_identity", subjectLabel: "Total assets", expected: "17580", actual: "17588",
        });
        expect(row(bs, "Property, plant and equipment").cells[0]!.check).toEqual({
          role: "component", status: "passed", checkType: "subtotal", subjectLabel: "Total assets", expected: "17580", actual: "17580",
        });
      });
    }

    it("on a tie in status takes the check that names the section", () => {
      const ar = filing("2026-03-31", (d) => ({
        facts: [fact(d, "Total assets", "2026-03-31", "17,580.00", { statement: "balance_sheet", section: "Assets", subtotal: true })],
        checks: [
          check(d, "Total assets", "2026-03-31", "passed", "1.00", "1.00", { statement: "balance_sheet", section: null, type: "balance_identity" }),
          check(d, "Total assets", "2026-03-31", "passed", "17580.00", "17580.00", { statement: "balance_sheet", section: "Assets" }),
        ],
      }));
      const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
      expect(row(bs, "Total assets").cells[0]!.check).toMatchObject({ status: "passed", checkType: "subtotal", expected: "17580" });
    });

    it("keeps a failed identity off the lines of a sheet whose sums each add up", () => {
      // Cash 100 + Inventory 200 = Total assets 300 adds up; equity 190 + liabilities 100 = 290 adds up; 300 ≠ 290.
      const bsFact = (d: Doc, label: string, printed: string, section: string, order: number, parts?: string[]) =>
        fact(d, label, "2026-03-31", printed, { statement: "balance_sheet", section, order, subtotal: !!parts, parts });
      const ar = filing("2026-03-31", (d) => ({
        facts: [
          bsFact(d, "Cash and cash equivalents", "100.00", "Assets", 0),
          bsFact(d, "Inventories", "200.00", "Assets", 1),
          bsFact(d, "Total assets", "300.00", "Assets", 2, ["Cash and cash equivalents", "Inventories"]),
          bsFact(d, "Equity share capital", "190.00", "Equity and liabilities", 3),
          bsFact(d, "Trade payables", "100.00", "Equity and liabilities", 4),
          bsFact(d, "Total equity and liabilities", "290.00", "Equity and liabilities", 5, ["Equity share capital", "Trade payables"]),
        ],
        checks: [
          check(d, "Total assets", "2026-03-31", "passed", "300.00", "300.00", { statement: "balance_sheet", section: "Assets" }),
          check(d, "Total equity and liabilities", "2026-03-31", "passed", "290.00", "290.00", { statement: "balance_sheet", section: "Equity and liabilities" }),
          check(d, "Total assets", "2026-03-31", "failed", "300.00", "290.00", { statement: "balance_sheet", section: null, type: "balance_identity" }),
        ],
      }));
      const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
      const checkOf = (label: string) => row(bs, label).cells[0]!.check;
      expect(checkOf("Total assets")).toEqual({ role: "subject", status: "failed", checkType: "balance_identity", subjectLabel: "Total assets", expected: "300", actual: "290" });
      for (const line of ["Cash and cash equivalents", "Inventories"]) {
        expect(checkOf(line)).toEqual({ role: "component", status: "passed", checkType: "subtotal", subjectLabel: "Total assets", expected: "300", actual: "300" });
      }
      expect(checkOf("Total equity and liabilities")).toMatchObject({ role: "subject", status: "passed", checkType: "subtotal" });
      expect(checkOf("Trade payables")).toMatchObject({ role: "component", status: "passed", checkType: "subtotal" });
    });

    it("gives a line no check when its total has only the identity", () => {
      const ar = filing("2026-03-31", (d) => ({
        facts: [
          fact(d, "Cash and cash equivalents", "2026-03-31", "100.00", { statement: "balance_sheet", section: "Assets", order: 0 }),
          fact(d, "Total assets", "2026-03-31", "300.00", { statement: "balance_sheet", section: "Assets", order: 1, subtotal: true, parts: ["Cash and cash equivalents"] }),
        ],
        checks: [check(d, "Total assets", "2026-03-31", "failed", "300.00", "290.00", { statement: "balance_sheet", section: null, type: "balance_identity" })],
      }));
      const bs = stitch([ar]).find((t) => t.statement === "balance_sheet")!;
      expect(row(bs, "Cash and cash equivalents").cells[0]!.check).toEqual({ role: "none", status: null, checkType: null, subjectLabel: null, expected: null, actual: null });
    });
  });

  it("keeps a printed dash and an unreadable figure apart from a missing one", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Exceptional items", "2026-03-31", "-", { status: "dash" }),
      fact(d, "Other comprehensive income", "2026-03-31", "(12,4O)", { status: "unparsed", order: 1 }),
    ] }));
    const t = pl(stitch([ar]));
    expect(row(t, "Exceptional items").cells[0]).toMatchObject({ status: "dash", value: null, printed: "-" });
    expect(row(t, "Other comprehensive income").cells[0]).toMatchObject({ status: "unparsed", value: null, printed: "(12,4O)" });
  });

  it("keeps one table per statement and basis that has figures", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Revenue from operations", "2026-03-31", "12,105.40"),
      fact(d, "Revenue from operations", "2026-03-31", "11,482.20", { basis: "standalone" }),
      fact(d, "Total assets", "2026-03-31", "17,580.00", { statement: "balance_sheet" }),
    ] }));
    expect(stitch([ar]).map((t) => `${t.statement}/${t.basis}`)).toEqual(["income_statement/consolidated", "income_statement/standalone", "balance_sheet/consolidated"]);
  });
});

// The XBRL filings below are filingKind "annual_report" (an MCA-style annual instance), so no test answers the open Q4 question.
describe("stitch across sources", () => {
  const REV = "Revenue from operations";
  const passed = (pdfDocumentId: string): XbrlInPdf => ({ status: "passed", pdfDocumentId, pageIndex: 4, statementPages: [4, 5], reason: null });

  it("an annual-report XBRL filing owns a year a newer annual-report PDF also prints, and the column never mixes them", () => {
    const x25 = xfiling("2025-03-31", (d) => ({ facts: [
      xfact(d, REV, "2025-03-31", "11240.75", { order: 0, start: "2024-04-01" }),
      xfact(d, "Other income", "2025-03-31", "312.25", { order: 1, element: "OtherIncome", start: "2024-04-01" }),
    ] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [
      fact(d, REV, "2026-03-31", "12,105.40", { order: 0 }), fact(d, REV, "2025-03-31", "11,240.75", { order: 0 }),
      fact(d, "Other income", "2026-03-31", "374.60", { order: 1 }), fact(d, "Other income", "2025-03-31", "312.25", { order: 1 }),
    ] }));
    for (const input of [[x25, ar26], [ar26, x25]]) {
      const t = pl(stitch(input));
      expect(t.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2025-03-31", x25.documentId], ["2026-03-31", ar26.documentId]]);
      for (const r of t.rows) {
        expect(r.cells[0]!.source).toMatchObject({ kind: "xbrl", documentId: x25.documentId });
        expect(r.cells[1]!.source).toMatchObject({ kind: "page", documentId: ar26.documentId });
      }
      expect(row(t, REV).cells.map((c) => c.value)).toEqual(["11240.75", "12105.4"]);
      expect(row(t, REV).cells[0]!.restated).toBeNull();
    }
  });

  it("a line only the PDF prints stays out of the XBRL-owned column", () => {
    const x25 = xfiling("2025-03-31", (d) => ({ facts: [xfact(d, REV, "2025-03-31", "11240.75")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [
      fact(d, REV, "2026-03-31", "12,105.40", { order: 0 }), fact(d, REV, "2025-03-31", "11,240.75", { order: 0 }),
      fact(d, "Exceptional items", "2026-03-31", "40.00", { order: 1 }), fact(d, "Exceptional items", "2025-03-31", "35.00", { order: 1 }),
    ] }));
    const cells = row(pl(stitch([x25, ar26])), "Exceptional items").cells;
    expect(cells.map((c) => c.status)).toEqual(["missing", "value"]);
    expect(cells[0]).toMatchObject({ value: null, source: null, restated: null });
  });

  it("a year XBRL does not print comes from the PDF", () => {
    const x26 = xfiling("2026-03-31", (d) => ({ facts: [xfact(d, REV, "2026-03-31", "12105.40")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2026-03-31", "12,105.40"), fact(d, REV, "2025-03-31", "11,240.75")] }));
    const t = pl(stitch([ar26, x26]));
    expect(t.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2025-03-31", ar26.documentId], ["2026-03-31", x26.documentId]]);
    expect(row(t, REV).cells.map((c) => c.source?.kind)).toEqual(["page", "xbrl"]);
  });

  it("an XBRL quarter and its half year ending on 30 Sep never sit in an annual table", () => {
    const x = xfiling("2026-03-31", (d) => ({ facts: [
      xfact(d, REV, "2025-09-30", "3010.00", { span: "quarter", start: "2025-07-01", context: "OneD" }),
      xfact(d, REV, "2025-09-30", "5920.00", { span: "half_year", start: "2025-04-01", context: "FourD" }),
      xfact(d, REV, "2026-03-31", "12105.40", { span: "year", start: "2025-04-01" }),
      xfact(d, "Total assets", "2025-09-30", "17000.00", { span: null, context: "OneI", element: "Assets" }),
    ] }));
    const tables = stitch([x]);
    expect(tables.map((t) => `${t.statement}/${t.basis}`)).toEqual(["income_statement/consolidated"]);
    const t = pl(tables);
    expect(t.columns.map((c) => c.periodEnd)).toEqual(["2026-03-31"]);
    expect(row(t, REV).cells.map((c) => c.value)).toEqual(["12105.4"]);
    expect(t.unplaced).toBe(0);
  });

  it("a Q4 results XBRL (filingKind financial_results) with year facts adds no column and owns no year", () => {
    // The open question's default: the annual report's PDF still owns 2025-26.
    const q4 = xfiling("2026-03-31", (d) => ({ facts: [
      xfact(d, REV, "2026-03-31", "3200.00", { span: "quarter", start: "2026-01-01", context: "OneD" }),
      xfact(d, REV, "2026-03-31", "12999.00", { span: "year", start: "2025-04-01" }),
      xfact(d, "Total assets", "2026-03-31", "17000.00", { span: null, context: "OneI", element: "Assets" }),
    ] }), { kind: "financial_results" });
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2026-03-31", "12,105.40")] }));
    const tables = stitch([q4, ar26]);
    expect(tables.map((t) => `${t.statement}/${t.basis}`)).toEqual(["income_statement/consolidated"]);
    const t = pl(tables);
    expect(t.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2026-03-31", ar26.documentId]]);
    expect(row(t, REV).cells[0]).toMatchObject({ value: "12105.4", restated: null, source: { kind: "page" } });
    expect(stitch([q4])).toEqual([]);
  });

  it("a half-year results XBRL with a 30 Sep OneI balance sheet adds no column", () => {
    const h1 = xfiling("2025-09-30", (d) => ({ facts: [
      xfact(d, "Total assets", "2025-09-30", "17000.00", { span: null, context: "OneI", element: "Assets" }),
      xfact(d, "Total assets", "2025-03-31", "16500.00", { span: null, context: "PY_I", element: "Assets" }),
    ] }), { kind: "financial_results" });
    const ar26 = filing("2026-03-31", (d) => ({ facts: [
      fact(d, "Total assets", "2026-03-31", "17,580.00", { statement: "balance_sheet" }),
      fact(d, "Total assets", "2025-03-31", "16,400.00", { statement: "balance_sheet" }),
    ] }));
    const bs = stitch([h1, ar26]).find((t) => t.statement === "balance_sheet")!;
    expect(bs.columns.map((c) => [c.periodEnd, c.documentId])).toEqual([["2025-03-31", ar26.documentId], ["2026-03-31", ar26.documentId]]);
    expect(bs.rows[0]!.cells.map((c) => c.restated)).toEqual([null, null]);
    expect(stitch([h1])).toEqual([]);
  });

  it("an XBRL per-share fact is per share by its unit, whatever its label says", () => {
    const x = xfiling("2026-03-31", (d) => ({ facts: [
      xfact(d, "Basic", "2026-03-31", "61.98", { order: 0, unit: "₹ a share", scale: "1", element: "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", decimals: "INF" }),
      xfact(d, REV, "2026-03-31", "12105.40", { order: 1 }),
      // Labelled as earnings per share, but its unit is crore: not a per-share line.
      xfact(d, "Earnings per share reserve", "2026-03-31", "40.00", { order: 2, element: "OtherEquity" }),
    ] }));
    const t = pl(stitch([x]));
    expect(t.unit).toEqual({ label: "₹ crore", scale: "10000000", currency: "INR" });
    expect(row(t, "Basic")).toMatchObject({ perShare: true, cells: [{ value: "61.98" }] });
    expect(row(t, REV).perShare).toBe(false);
    expect(row(t, "Earnings per share reserve").perShare).toBe(false);
  });

  it("an XBRL cell carries its element, context, decimals and the in-PDF outcome; a page cell carries kind 'page'", () => {
    const pdfId = crypto.randomUUID();
    const x26 = xfiling("2026-03-31", (d) => ({ facts: [
      xfact(d, REV, "2026-03-31", "12105.40", { order: 0, start: "2025-04-01" }),
      xfact(d, "Other income", "2026-03-31", "374.60", { order: 1, element: "OtherIncome", decimals: "-6" }),
    ] }), { inPdf: (_d, facts) => new Map([[facts[0]!.fact.id, passed(pdfId)]]) });
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2025-03-31", "11,240.75", { page: 198, match: null })] }));
    const t = pl(stitch([x26, ar26]));
    expect(row(t, REV).cells[1]!.source).toEqual({
      kind: "xbrl", documentId: x26.documentId, originalName: "Integrated_Finance_Ind_As_MC.xml", element: "RevenueFromOperations", contextId: "FourD",
      decimals: "-5", nil: false, periodStart: "2025-04-01", span: "year", inPdf: passed(pdfId),
    });
    // A fact the route gave no outcome for claims nothing about the PDF.
    expect(row(t, "Other income").cells[1]!.source).toMatchObject({
      kind: "xbrl", element: "OtherIncome", decimals: "-6",
      inPdf: { status: "not_checked", pdfDocumentId: null, pageIndex: null, statementPages: [], reason: "not_yet" },
    });
    expect(row(t, REV).cells[0]!.source).toEqual({ kind: "page", documentId: ar26.documentId, pageIndex: 197, pageCount: 286, textLayerMatch: null });
  });

  describe("XBRL restated against a PDF: the restated variant is the PDF's, at the coarser precision", () => {
    const LAKH = { scale: "100000", unit: "₹ lakh" };
    const pair = (pdfPrinted: string) => {
      const x26 = xfiling("2026-03-31", (d) => ({ facts: [xfact(d, REV, "2026-03-31", "12345.00", LAKH)] }));
      const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, REV, "2026-03-31", pdfPrinted, { scale: "100000", page: 5 })] }));
      return { ar26, cell: row(pl(stitch([ar26, x26])), REV).cells[0]! };
    };

    it("12345.00 lakh against 12,345 lakh is not restated", () => {
      expect(pair("12,345").cell).toMatchObject({ value: "12345", source: { kind: "xbrl" }, restated: null });
    });

    it("12345.00 lakh against 12,346 lakh is restated, with the PDF's page", () => {
      const { ar26, cell } = pair("12,346");
      expect(cell.restated).toEqual({ kind: "page", documentId: ar26.documentId, filingPeriodEnd: "2026-03-31", pageIndex: 4, value: "12346", printed: "12,346" });
    });

    it("an XBRL filing restated by another XBRL filing names its element", () => {
      const older = xfiling("2026-03-31", (d) => ({ facts: [xfact(d, REV, "2026-03-31", "12340.00", LAKH)] }), { created: "2026-08-01T00:00:00Z" });
      const newer = xfiling("2026-03-31", (d) => ({ facts: [xfact(d, REV, "2026-03-31", "12345.00", LAKH)] }));
      const cell = row(pl(stitch([older, newer])), REV).cells[0]!;
      expect(cell.source).toMatchObject({ kind: "xbrl", documentId: newer.documentId });
      expect(cell.restated).toEqual({ kind: "xbrl", documentId: older.documentId, filingPeriodEnd: "2026-03-31", element: "RevenueFromOperations", value: "12340", printed: "12340.00" });
    });
  });

  it("an XBRL fact whose value is nil is '—' with status unparsed and nil true", () => {
    const x = xfiling("2026-03-31", (d) => ({ facts: [xfact(d, REV, "2026-03-31", "12105.40", { order: 0 }), xfact(d, "Other income", "2026-03-31", null, { order: 1, nil: true, element: "OtherIncome" })] }));
    const cell = row(pl(stitch([x])), "Other income").cells[0]!;
    expect(cell).toMatchObject({ status: "unparsed", value: null, source: { kind: "xbrl", element: "OtherIncome", nil: true } });
  });

  it("shows a fact stored without its source row with source null", () => {
    const ar = filing("2026-03-31", (d) => ({ facts: [{ ...fact(d, REV, "2026-03-31", "12,105.40"), source: null }] }));
    expect(row(pl(stitch([ar])), REV).cells[0]).toMatchObject({ status: "value", value: "12105.4", source: null });
  });
});
