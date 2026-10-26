import { XBRL_PDF_CHECK_VERSION, XbrlPdfNotChecked, type XbrlInPdf } from "@maester/contracts";
import type { ExtractionCheckRow, FinancialFactRow } from "@maester/db";

/** The results PDF an XBRL filing is checked against: its document, its current classification and the pages it found. */
export type FilingPdf = {
  documentId: string;
  classificationId: string;
  statementPages: { statement: string; basis: string; pages: number[] }[];
};

/**
 * Whether an XBRL fact's value was found on its results PDF (`xbrl_in_pdf`), first rule that applies:
 * 1. no PDF of the filing: not checked, `no_pdf`;
 * 2. the check turned off (`XBRL_PDF_CHECK=false`): not checked, `disabled`;
 * 3. no row for this fact, the PDF's current classification and the current check version: not checked, `not_yet`;
 * 4. otherwise the row's status, page and reason.
 * `statementPages` are the PDF's pages for the fact's statement and basis (empty with no PDF), so the screen can open
 * the PDF where they start. Pure: the rows come from `listXbrlPdfChecks`.
 */
export function inPdfFor(
  fact: Pick<FinancialFactRow, "id" | "statement" | "basis">,
  checks: ExtractionCheckRow[],
  pdf: FilingPdf | null,
  enabled: boolean,
): XbrlInPdf {
  if (pdf === null) return { status: "not_checked", pdfDocumentId: null, pageIndex: null, statementPages: [], reason: "no_pdf" };
  const statementPages = pdf.statementPages.find((s) => s.statement === fact.statement && s.basis === fact.basis)?.pages ?? [];
  const notChecked = (reason: XbrlPdfNotChecked): XbrlInPdf => ({ status: "not_checked", pdfDocumentId: pdf.documentId, pageIndex: null, statementPages, reason });
  if (!enabled) return notChecked("disabled");
  const row = checks.find(
    (c) =>
      c.checkType === "xbrl_in_pdf" &&
      c.factId === fact.id &&
      c.pdfClassificationId === pdf.classificationId &&
      c.checkVersion === XBRL_PDF_CHECK_VERSION,
  );
  if (!row) return notChecked("not_yet");
  const reason = row.reason === null ? null : XbrlPdfNotChecked.safeParse(row.reason);
  return {
    status: row.status,
    pdfDocumentId: pdf.documentId,
    pageIndex: row.pageIndex,
    statementPages,
    // A reason this API does not know is not passed on as one it does.
    reason: reason?.success ? reason.data : null,
  };
}
