import { z } from "zod";
import type { FinancialFact } from "@maester/contracts";
import { CELL_STATUS_WORDS, NOT_CHECKED, type Unit } from "./words.js";
import { Decimal, SourceSchema, UnitSchema, type CellAnswer, type SourceAnswer } from "./table.js";

/** The filing a fact was read from: what a citation names. Independent of the database's row types. */
export type FactFiling = { name: string; documentId: string; kind: string | null; periodEnd: string | null; pageCount: number };

/**
 * The statement table's cell for a fact's line and year, or why no table cell is this fact. `fact_id` is the cell's own
 * fact: this one, or (for a fact of an earlier read) the current read's; with `shown: false`, the fact the table shows
 * there instead, when there is one.
 */
export const InTableSchema = z.union([
  z.object({
    shown: z.literal(true),
    fact_id: z.string(),
    value: Decimal.nullable(),
    unit: UnitSchema,
    check: z.string(),
    restated: z.string().nullable(),
  }),
  z.object({ shown: z.literal(false), note: z.string(), fact_id: z.string().nullable() }),
]);
export type InTableAnswer = z.infer<typeof InTableSchema>;

export const inTableFromCell = (cell: CellAnswer & { fact_id: string }): InTableAnswer => ({
  shown: true,
  fact_id: cell.fact_id,
  value: cell.value,
  unit: { label: cell.unit_label, scale: cell.scale, currency: cell.currency } satisfies Unit,
  check: cell.check,
  restated: cell.restated,
});
export const notInTable = (note: string, factId: string | null = null): InTableAnswer => ({ shown: false, note, fact_id: factId });

export const FactAnswerSchema = z.object({
  fact_id: z.string(),
  document_id: z.string(),
  company_id: z.string().nullable(),
  statement: z.string(),
  basis: z.string(),
  section: z.string(),
  line: z.string(),
  is_subtotal: z.boolean(),
  period_label: z.string(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  as_of_date: z.string().nullable(),
  span: z.string().nullable(),
  /** Why span or period_start is null, in words; null when both are known. */
  span_reason: z.string().nullable(),
  status: z.enum(["value", "a dash printed", "not readable", "not printed"]),
  reason: z.string().nullable(),
  reported_value: z.string().nullable(),
  printed: z.string(),
  unit_label: z.string().nullable(),
  scale: z.string().nullable(),
  currency: z.string().nullable(),
  filing: z.object({ name: z.string(), document_id: z.string(), kind: z.string().nullable(), period_end: z.string().nullable() }),
  source: SourceSchema.nullable(),
  /** The fact's own arithmetic check in a sentence, from its filing's read; "No sum covers this line" when none does. */
  check: z.string(),
  superseded: z.string().nullable(),
  in_table: InTableSchema.nullable(),
  reviewed: z.literal("not yet"),
});
export type FactAnswer = z.infer<typeof FactAnswerSchema>;

function source(fact: FinancialFact, filing: FactFiling): SourceAnswer | null {
  const s = fact.source;
  if (!s) return null;
  if (s.kind === "xbrl") {
    // The fact alone carries no check against its results PDF (get_statement's cell does). While the result is hidden
    // the two agree; a test fails when XBRL_IN_PDF_RESULT_SHOWN turns on, so this is wired to the outcome first.
    return { kind: "xbrl", filing: filing.name, document_id: s.documentId, element: s.element, context: s.contextId, decimals: s.decimals, in_pdf: NOT_CHECKED };
  }
  return {
    kind: "page",
    filing: filing.name,
    document_id: s.documentId,
    page: s.pageIndex + 1,
    of: filing.pageCount,
    text_layer:
      s.textLayerMatch === true
        ? "the printed value is in the page's text"
        : s.textLayerMatch === false
          ? "the printed value is not in the page's text"
          : "the page is scanned, so it is not checked against its text",
  };
}

/**
 * Why the span or the period start is null. Never worked out from the label: the label is shown as printed, and the
 * agent is told not to read a span from it either.
 */
function spanReason(fact: FinancialFact): string | null {
  if (fact.span === null && fact.periodEnd === null && fact.asOfDate !== null) return "A balance on one day (as_of_date), so it has no span or period start.";
  if (fact.span === null) {
    return "The read did not record the span or the period start of this figure; period_label gives the period as printed. Do not work a span out from the label.";
  }
  if (fact.periodStart === null && fact.span !== "year") return "The read did not record the period start; span and period_end give the period.";
  if (fact.periodStart === null) return "The read did not record the period start; it is a year ending on period_end.";
  return null;
}

function reason(fact: FinancialFact): string | null {
  if (fact.valueStatus === "dash") return "a dash printed on the page";
  if (fact.valueStatus === "unparsed") return "not readable";
  if (fact.reportedValue !== null) return null;
  return fact.source?.kind === "xbrl" && fact.source.nil ? "the XBRL file gives no value" : "no value";
}

/** Everything a citation needs for one fact, in the filing's own unit; `reported_value` is copied, never parsed. */
export function presentFact(
  fact: FinancialFact,
  filing: FactFiling,
  extra: { check: string; superseded: string | null; inTable: InTableAnswer | null },
): FactAnswer {
  return {
    fact_id: fact.id,
    document_id: filing.documentId,
    company_id: fact.companyId,
    statement: fact.statement,
    basis: fact.basis,
    section: fact.section,
    line: fact.reportedLabel,
    is_subtotal: fact.isSubtotal,
    period_label: fact.periodLabel,
    period_start: fact.periodStart,
    period_end: fact.periodEnd,
    as_of_date: fact.asOfDate,
    span: fact.span,
    span_reason: spanReason(fact),
    status: CELL_STATUS_WORDS[fact.valueStatus],
    reason: reason(fact),
    reported_value: fact.valueStatus === "value" ? fact.reportedValue : null,
    printed: fact.reportedText,
    unit_label: fact.unitLabel,
    scale: fact.scaleFactor,
    currency: fact.currency,
    filing: { name: filing.name, document_id: filing.documentId, kind: filing.kind, period_end: filing.periodEnd },
    source: source(fact, filing),
    check: extra.check,
    superseded: extra.superseded,
    in_table: extra.inTable,
    reviewed: "not yet",
  };
}
