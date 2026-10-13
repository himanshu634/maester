import { describe, expect, it } from "vitest";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";
import { moveDecimal, normalise, stitch, type Filing } from "../src/financials/stitch.js";

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
      periodEnd: dated && !balance ? periodEnd : null, asOfDate: dated && balance ? periodEnd : null,
      reportedText: printed, reportedValue: reported, valueStatus: status, unitLabel: "₹ in crore", scaleFactor: scale,
      currency: o.currency ?? "INR",
      normalizedValue: reported === null || scale === null ? null : moveDecimal(reported, scale.length - 1),
      createdAt: new Date(),
    },
    source: { id: crypto.randomUUID(), workspaceId: WS, factId: id, documentId: doc.documentId, pageIndex: (o.page ?? 213) - 1, textLayerMatch: o.match === undefined ? true : o.match },
  };
}

function check(doc: Doc, subject: string, periodEnd: string, status: "passed" | "failed", expected: string, actual: string, o: { statement?: Kind; section?: string } = {}): ExtractionCheckRow {
  return {
    id: crypto.randomUUID(), workspaceId: WS, revisionId: doc.revisionId, checkType: "subtotal", statement: o.statement ?? "income_statement",
    basis: "consolidated", section: o.section ?? "Income", periodLabel: `Year ended ${periodEnd}`, subjectLabel: subject, status, expected, actual, detail: "",
  };
}

function filing(periodEnd: string, build: (d: Doc) => { facts: FactWithSource[]; checks?: ExtractionCheckRow[] }, created = "2026-10-01T00:00:00Z"): Filing {
  const doc = { documentId: crypto.randomUUID(), revisionId: crypto.randomUUID() };
  const { facts, checks = [] } = build(doc);
  return { documentId: doc.documentId, periodEnd, revisionCreatedAt: new Date(created), pageCount: 286, facts, checks };
}

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
    expect(row(t, "Revenue from operations").cells[2]!.source).toEqual({ documentId: ar26.documentId, pageIndex: 212, pageCount: 286, textLayerMatch: true });
  });

  it("marks a figure restated when an older filing printed something else for that year", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2025-03-31", "2,389.10", { page: 198 })] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Freight and forwarding", "2026-03-31", "2,602.15"), fact(d, "Freight and forwarding", "2025-03-31", "2,401.60")] }));
    const cells = row(pl(stitch([ar26, ar25])), "Freight and forwarding").cells;
    expect(cells[0]!.value).toBe("2401.6");
    expect(cells[0]!.restated).toEqual({ documentId: ar25.documentId, filingPeriodEnd: "2025-03-31", pageIndex: 197, value: "2389.1", printed: "2,389.10" });
    expect(cells[1]!.restated).toBeNull();
  });

  it("doesn't mark a figure restated when the older filing printed the same", () => {
    const ar25 = filing("2025-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.25")] }));
    const ar26 = filing("2026-03-31", (d) => ({ facts: [fact(d, "Other income", "2025-03-31", "312.250")] }));
    expect(row(pl(stitch([ar25, ar26])), "Other income").cells[0]!.restated).toBeNull();
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
    expect(row(t, "Total income").cells[0]!.check).toEqual({ role: "subject", status: "failed", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Other income").cells[0]!.check).toEqual({ role: "component", status: "failed", subjectLabel: "Total income", expected: "12480", actual: "12489" });
    expect(row(t, "Exceptional items").cells[0]!.check).toEqual({ role: "none", status: null, subjectLabel: null, expected: null, actual: null });
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
