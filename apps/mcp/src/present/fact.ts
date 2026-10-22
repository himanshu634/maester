import { z } from "zod";
import type { FinancialFact } from "@maester/contracts";
import { CELL_STATUS_WORDS, type Unit } from "./words.js";
import { SourceSchema, UnitSchema, type CellAnswer, type SourceAnswer } from "./table.js";

/** The filing a fact was read from: what a citation names. Independent of the database's row types. */
export type FactFiling = { name: string; documentId: string; kind: string | null; periodEnd: string | null; pageCount: number };

/** The statement table's own cell for a fact's line and year, or why no table cell is this fact. */
export const InTableSchema = z.union([
  z.object({ shown: z.literal(true), value: z.string().nullable(), unit: UnitSchema, check: z.string(), restated: z.string().nullable() }),
  z.object({ shown: z.literal(false), note: z.string() }),
]);
export type InTableAnswer = z.infer<typeof InTableSchema>;

export const inTableFromCell = (cell: CellAnswer): InTableAnswer => ({
  shown: true,
  value: cell.value,
  unit: { label: cell.unit_label, scale: cell.scale, currency: cell.currency } satisfies Unit,
  check: cell.check,
  restated: cell.restated,
});
export const notInTable = (note: string): InTableAnswer => ({ shown: false, note });

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
  status: z.enum(["value", "a dash printed", "not readable", "not printed"]),
  reason: z.string().nullable(),
  reported_value: z.string().nullable(),
  printed: z.string(),
  unit_label: z.string().nullable(),
  scale: z.string().nullable(),
  currency: z.string().nullable(),
  filing: z.object({ name: z.string(), document_id: z.string(), kind: z.string().nullable(), period_end: z.string().nullable() }),
  source: SourceSchema.nullable(),
  superseded: z.string().nullable(),
  in_table: InTableSchema.nullable(),
  reviewed: z.literal("not yet"),
});
export type FactAnswer = z.infer<typeof FactAnswerSchema>;

function source(fact: FinancialFact, filing: FactFiling): SourceAnswer | null {
  const s = fact.source;
  if (!s) return null;
  if (s.kind === "xbrl") {
    return { kind: "xbrl", filing: filing.name, document_id: s.documentId, element: s.element, context: s.contextId, decimals: s.decimals, in_pdf: "not checked" };
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

function reason(fact: FinancialFact): string | null {
  if (fact.valueStatus === "dash") return "a dash printed on the page";
  if (fact.valueStatus === "unparsed") return "not readable";
  if (fact.reportedValue !== null) return null;
  return fact.source?.kind === "xbrl" && fact.source.nil ? "the XBRL file gives no value" : "no value";
}

/** Everything a citation needs for one fact, in the filing's own unit; `reported_value` is copied, never parsed. */
export function presentFact(fact: FinancialFact, filing: FactFiling, extra: { superseded: string | null; inTable: InTableAnswer | null }): FactAnswer {
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
    status: CELL_STATUS_WORDS[fact.valueStatus],
    reason: reason(fact),
    reported_value: fact.valueStatus === "value" ? fact.reportedValue : null,
    printed: fact.reportedText,
    unit_label: fact.unitLabel,
    scale: fact.scaleFactor,
    currency: fact.currency,
    filing: { name: filing.name, document_id: filing.documentId, kind: filing.kind, period_end: filing.periodEnd },
    source: source(fact, filing),
    superseded: extra.superseded,
    in_table: extra.inTable,
    reviewed: "not yet",
  };
}
