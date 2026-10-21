import { describe, expect, it } from "vitest";
import { XBRL_PDF_CHECK_VERSION } from "@maester/contracts";
import { XBRL_PDF_CHECK_VERSION_READ, type ExtractionCheckRow } from "@maester/db";
import { inPdfFor } from "../src/financials/in-pdf.js";

const WS = "00000000-0000-4000-8000-000000000000";
const fact = { id: crypto.randomUUID(), statement: "income_statement" as const, basis: "consolidated" as const };
const pdf = {
  documentId: crypto.randomUUID(),
  classificationId: crypto.randomUUID(),
  statementPages: [
    { statement: "balance_sheet", basis: "consolidated", pages: [7] },
    { statement: "income_statement", basis: "consolidated", pages: [4, 5] },
    { statement: "income_statement", basis: "standalone", pages: [2] },
  ],
};

function row(o: Partial<ExtractionCheckRow> = {}): ExtractionCheckRow {
  return {
    id: crypto.randomUUID(), workspaceId: WS, revisionId: crypto.randomUUID(), checkType: "xbrl_in_pdf", statement: "income_statement", basis: "consolidated",
    section: "Income", periodLabel: "Year ended 31 Mar 2026", subjectLabel: "Revenue from operations", status: "passed", expected: "12345.00", actual: null, detail: "",
    factId: fact.id, pdfDocumentId: pdf.documentId, pdfClassificationId: pdf.classificationId, pageIndex: 4, reason: null, checkVersion: XBRL_PDF_CHECK_VERSION,
    ...o,
  };
}

describe("inPdfFor", () => {
  it("reads the check version the contracts name", () => {
    expect(XBRL_PDF_CHECK_VERSION_READ).toBe(XBRL_PDF_CHECK_VERSION);
  });

  it("with no PDF of the filing is not checked: no_pdf", () => {
    expect(inPdfFor(fact, [row()], null, true)).toEqual({ status: "not_checked", pdfDocumentId: null, pageIndex: null, statementPages: [], reason: "no_pdf" });
  });

  it("with the check turned off is not checked: disabled, whatever rows there are", () => {
    expect(inPdfFor(fact, [row()], pdf, false)).toEqual({
      status: "not_checked", pdfDocumentId: pdf.documentId, pageIndex: null, statementPages: [4, 5], reason: "disabled",
    });
  });

  it("with no row for the PDF's current classification is not checked: not_yet", () => {
    const older = row({ pdfClassificationId: crypto.randomUUID() });
    const otherFact = row({ factId: crypto.randomUUID() });
    expect(inPdfFor(fact, [older, otherFact], pdf, true)).toEqual({
      status: "not_checked", pdfDocumentId: pdf.documentId, pageIndex: null, statementPages: [4, 5], reason: "not_yet",
    });
  });

  it("does not read a row of an older check version: not_yet", () => {
    expect(inPdfFor(fact, [row({ checkVersion: XBRL_PDF_CHECK_VERSION - 1 })], pdf, true)).toMatchObject({ status: "not_checked", reason: "not_yet" });
  });

  it("gives a found value its page", () => {
    expect(inPdfFor(fact, [row()], pdf, true)).toEqual({ status: "passed", pdfDocumentId: pdf.documentId, pageIndex: 4, statementPages: [4, 5], reason: null });
  });

  it("gives a value not found no page, and the statement pages to open", () => {
    expect(inPdfFor(fact, [row({ status: "failed", pageIndex: null })], pdf, true)).toEqual({
      status: "failed", pdfDocumentId: pdf.documentId, pageIndex: null, statementPages: [4, 5], reason: null,
    });
  });

  it("gives the row's reason when it was not checked", () => {
    expect(inPdfFor(fact, [row({ status: "not_checked", pageIndex: null, reason: "scanned" })], pdf, true)).toEqual({
      status: "not_checked", pdfDocumentId: pdf.documentId, pageIndex: null, statementPages: [4, 5], reason: "scanned",
    });
  });

  it("gives no statement pages when the PDF found none for the fact's statement and basis", () => {
    expect(inPdfFor({ ...fact, statement: "cash_flow" }, [], pdf, true)).toMatchObject({ statementPages: [], reason: "not_yet" });
  });
});
