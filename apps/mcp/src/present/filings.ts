import { z } from "zod";
import type { FilingFile, InPdfCount, StatementSourceReason, WorkspaceFilings } from "@maester/contracts";
import { XBRL_IN_PDF_RESULT_SHOWN } from "./flags.js";
import { inPdfWords, NOT_CHECKED } from "./words.js";

/**
 * A statement's XBRL-in-PDF counts in words. A check that never ran says why; the counts of one that ran are "not
 * checked" while the result is not shown.
 */
function inPdfCountWords(inPdf: InPdfCount | null, pdfDocumentId: string | null, pdfPages: number[], shown: boolean = XBRL_IN_PDF_RESULT_SHOWN): string {
  if (inPdf === null) return NOT_CHECKED;
  if (inPdf.notChecked !== null) return inPdfWords({ status: "not_checked", pdfDocumentId, pageIndex: null, statementPages: pdfPages, reason: inPdf.notChecked }, shown);
  if (!shown) return NOT_CHECKED;
  return `${inPdf.found} of ${inPdf.checked} figures found on the results PDF's statement pages`;
}

const REASON_WORDS: Record<StatementSourceReason, string> = {
  xbrl_lacks_statement: "the XBRL file has facts but none for this statement",
  xbrl_format_unmapped: "Maester reads this XBRL format but has no map for it yet",
  no_xbrl: "there is no XBRL file for this basis",
  not_in_filing: "the filing doesn't have this statement",
  not_read_yet: "the PDF that prints it is not read yet",
  read_failed: "the PDF that prints it did not read",
  xbrl_read_failed: "the XBRL file did not read",
  xbrl_not_read_yet: "the XBRL file is not read yet",
};

const NUMBERS_WORDS = { done: "read", now: "being read", not_needed: "not needed", failed: "did not read", waiting: "waiting", not_read: "not read" } as const;
const TEXT_WORDS = { done: "indexed", now: "being indexed", partial: "partly indexed", failed: "did not index", waiting: "waiting", not_needed: "not needed" } as const;

export const FilingsAnswerSchema = z.object({
  companies: z.array(
    z.object({
      company_id: z.string(),
      name: z.string(),
      filings: z.array(
        z.object({
          kind: z.string(),
          other_type: z.string().nullable(),
          period_end: z.string().nullable(),
          spans: z.array(z.string()),
          settled: z.boolean(),
          files: z.array(
            z.object({ document_id: z.string(), name: z.string(), format: z.string(), basis: z.string().nullable(), numbers: z.string(), text: z.string(), stored: z.string() }),
          ),
          sources: z.array(
            z.object({
              basis: z.string(),
              statements: z.array(
                z.object({
                  statement: z.string(),
                  source: z.enum(["xbrl", "pdf"]).nullable(),
                  xbrl_document_id: z.string().nullable(),
                  pdf_document_id: z.string().nullable(),
                  /** 1-based. */
                  pdf_pages: z.array(z.number().int().min(1)),
                  reason: z.string().nullable(),
                  in_pdf: z.string(),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
  unsorted: z.array(z.object({ document_id: z.string(), name: z.string(), numbers: z.string(), text: z.string() })),
});
export type FilingsAnswer = z.infer<typeof FilingsAnswerSchema>;

const fileWords = (f: FilingFile) => ({
  numbers: NUMBERS_WORDS[f.pipeline.numbers.state],
  text:
    f.pipeline.text.state === "partial"
      ? `partly indexed (${f.pipeline.text.pagesRead} of ${f.pipeline.text.pages} pages)`
      : TEXT_WORDS[f.pipeline.text.state],
});

/** The filings, optionally of one company. The XBRL-in-PDF counts are said as "not checked" while the result is not shown. */
export function presentFilings(filings: WorkspaceFilings, companyId: string | null): FilingsAnswer {
  return {
    companies: filings.companies
      .filter((c) => companyId === null || c.company.id === companyId)
      .map(({ company, filings: fs }) => ({
        company_id: company.id,
        name: company.displayName,
        filings: fs.map((f) => ({
          kind: f.kind,
          other_type: f.otherType,
          period_end: f.periodEnd,
          spans: f.spans,
          settled: f.settled,
          files: f.files.map((file) => ({
            document_id: file.documentId,
            name: file.originalName,
            format: file.format,
            basis: file.basis,
            ...fileWords(file),
            stored: file.state,
          })),
          sources: f.sources.map((b) => ({
            basis: b.basis,
            statements: b.statements.map((s) => ({
              statement: s.statement,
              source: s.source,
              xbrl_document_id: s.xbrlDocumentId,
              pdf_document_id: s.pdfDocumentId,
              pdf_pages: s.pdfPages.map((p) => p + 1),
              reason: s.reason === null ? null : REASON_WORDS[s.reason],
              in_pdf: inPdfCountWords(s.inPdf, s.pdfDocumentId, s.pdfPages),
            })),
          })),
        })),
      })),
    unsorted: companyId === null ? filings.unsorted.map((f) => ({ document_id: f.documentId, name: f.originalName, ...fileWords(f) })) : [],
  };
}
