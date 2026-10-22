import type { TableUnit, XbrlInPdf, XbrlPdfNotChecked } from "@maester/contracts";
import { XBRL_IN_PDF_RESULT_SHOWN } from "./flags.js";

/** The words for a figure's unit and a few states, shared by the presenters. Figures themselves are never touched here. */

export type Unit = { label: string | null; scale: string | null; currency: string | null };

export const toUnit = (unit: TableUnit): Unit => ({ label: unit.label, scale: unit.scale, currency: unit.currency });

/** A per-share row is rupees a share as printed, whatever the table's unit. */
export const perShareUnit = (unit: TableUnit): Unit => ({ label: "rupees a share", scale: "1", currency: unit.currency });

const SCALE_WORDS: Record<string, string> = {
  "1": "",
  "1000": "thousand",
  "100000": "lakh",
  "1000000": "million",
  "10000000": "crore",
  "1000000000": "billion",
};

/** "₹ crore", "₹": the unit in words, from the scale's text (no parsing: the scale is looked up as a string). */
export function unitWords(unit: Unit): string {
  const key = unit.scale === null ? null : unit.scale.replace(/\.0+$/, "");
  const word = key === null ? undefined : SCALE_WORDS[key];
  if (word === undefined) return `the unit printed: ${unit.label ?? "none"}`;
  const currency = !unit.currency || unit.currency === "INR" ? "₹" : unit.currency;
  return word ? `${currency} ${word}` : currency;
}

export const CELL_STATUS_WORDS = {
  value: "value",
  dash: "a dash printed",
  unparsed: "not readable",
  missing: "not printed",
} as const;
export type CellStatusWord = (typeof CELL_STATUS_WORDS)[keyof typeof CELL_STATUS_WORDS];

export const NOT_CHECKED = "not checked";

const NOT_CHECKED_WHY: Record<XbrlPdfNotChecked, string> = {
  no_pdf: "not checked: no PDF of these results in the workspace",
  scanned: "not checked: the PDF's statement pages are scanned",
  no_statement_pages: "not checked: the statement pages were not found in the PDF",
  disabled: "not checked: the check against the PDF is turned off",
  not_yet: "not checked: the check has not run yet",
  no_value: "not checked: the XBRL file gives no value to look for",
  no_unit: "not checked: the XBRL file declares no unit",
};

/** 1-based pages from 0-based indexes: "page 5", "pages 5, 6". */
export function pagesWords(pageIndexes: number[]): string {
  const pages = [...new Set(pageIndexes)].sort((a, b) => a - b).map((i) => i + 1);
  return pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
}

/** The `xbrl_in_pdf` outcome of an XBRL figure in words; "not checked" for any of it while the result is not shown. */
export function inPdfWords(inPdf: XbrlInPdf, shown: boolean = XBRL_IN_PDF_RESULT_SHOWN): string {
  if (!shown) return NOT_CHECKED;
  if (inPdf.status === "passed") {
    return inPdf.pageIndex === null
      ? `found on the results PDF's statement pages (${pagesWords(inPdf.statementPages)})`
      : `found on page ${inPdf.pageIndex + 1} of the results PDF`;
  }
  if (inPdf.status === "failed") return `not found on the results PDF's statement pages (${pagesWords(inPdf.statementPages)})`;
  return NOT_CHECKED_WHY[inPdf.reason ?? "not_yet"];
}

/** The Research list's "Where it stands": a failure first, then work in progress, then read. */
export function standing(c: { annualReportsRead: number; reading: number; failed: number }): string {
  if (c.failed > 0) return `${c.failed} ${c.failed === 1 ? "filing" : "filings"} didn't read`;
  if (c.reading > 0) return `Reading ${c.reading} ${c.reading === 1 ? "filing" : "filings"}`;
  return c.annualReportsRead > 0 ? "Read" : "Nothing read yet";
}

/** The statements and bases as an investor says them, for the sentences a tool gives when it has no table. */
export const STATEMENT_WORDS = { income_statement: "income statement", balance_sheet: "balance sheet", cash_flow: "cash flow statement" } as const;
export const BASIS_WORDS = { consolidated: "consolidated", standalone: "standalone", unknown: "basis not stated" } as const;
