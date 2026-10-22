import { z } from "zod";
import type { Company, CompanyFiling, FinancialCell, FinancialColumn, StatementTable, TableUnit } from "@maester/contracts";
import { checkSentence } from "./check.js";
import { CELL_STATUS_WORDS, inPdfWords, perShareUnit, toUnit, unitWords, type Unit } from "./words.js";

/** The statement answer of `get_statement`: pure, from the contract's table. Decimal strings are copied, never parsed. */

export const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const UnitSchema = z.object({ label: z.string().nullable(), scale: Decimal.nullable(), currency: z.string().nullable() });

export const SourceSchema = z.union([
  z.object({
    kind: z.literal("page"),
    filing: z.string().nullable(),
    document_id: z.string(),
    /** 1-based. */
    page: z.number().int().min(1),
    of: z.number().int().min(1),
    text_layer: z.string(),
  }),
  z.object({
    kind: z.literal("xbrl"),
    filing: z.string(),
    document_id: z.string(),
    element: z.string(),
    context: z.string(),
    decimals: z.string().nullable(),
    in_pdf: z.string(),
  }),
]);
export type SourceAnswer = z.infer<typeof SourceSchema>;

export const CellAnswerSchema = z.object({
  fact_id: z.string().nullable(),
  period_end: z.string(),
  period: z.string(),
  span: z.literal("year"),
  value: Decimal.nullable(),
  printed: z.string().nullable(),
  status: z.enum(["value", "a dash printed", "not readable", "not printed"]),
  reason: z.string().nullable(),
  unit_label: z.string().nullable(),
  scale: Decimal.nullable(),
  currency: z.string().nullable(),
  source: SourceSchema.nullable(),
  check: z.string(),
  restated: z.string().nullable(),
  reviewed: z.literal("not yet"),
});
export type CellAnswer = z.infer<typeof CellAnswerSchema>;

export const StatementAnswerSchema = z.object({
  company: z.object({ id: z.string(), name: z.string() }),
  statement: z.string(),
  basis: z.string(),
  unit: UnitSchema,
  columns: z.array(
    z.object({ period_end: z.string(), label: z.string(), filing: z.string().nullable(), document_id: z.string(), filing_period_end: z.string().nullable() }),
  ),
  rows: z.array(
    z.object({
      line: z.string(),
      label: z.string(),
      section: z.string(),
      is_subtotal: z.boolean(),
      per_share: z.boolean(),
      cells: z.array(CellAnswerSchema),
    }),
  ),
  note: z.string(),
  undated_figures: z.number().int().min(0),
  left_out: z.array(z.object({ filing: z.string().nullable(), document_id: z.string(), reason: z.string() })),
});
export type StatementAnswer = z.infer<typeof StatementAnswerSchema>;

export const LINE_AS_PRINTED = "as printed; no concept mapping yet";
export const TABLE_NOTE = "Each year comes whole from the newest filing that prints it, so a column never mixes filings.";

const LEFT_OUT_WHY = {
  other_currency: "the filing reports in another currency",
  other_unit: "the filing's unit is one Maester cannot convert",
} as const;

const filingName = (filings: CompanyFiling[], documentId: string) => filings.find((f) => f.documentId === documentId)?.originalName ?? null;

function sourceAnswer(cell: FinancialCell, filings: CompanyFiling[]): SourceAnswer | null {
  const s = cell.source;
  if (!s) return null;
  if (s.kind === "xbrl") {
    return { kind: "xbrl", filing: s.originalName, document_id: s.documentId, element: s.element, context: s.contextId, decimals: s.decimals, in_pdf: inPdfWords(s.inPdf) };
  }
  return {
    kind: "page",
    filing: filingName(filings, s.documentId),
    document_id: s.documentId,
    page: s.pageIndex + 1,
    of: s.pageCount,
    text_layer:
      s.textLayerMatch === true
        ? "the printed value is in the page's text"
        : s.textLayerMatch === false
          ? "the printed value is not in the page's text"
          : "the page is scanned, so it is not checked against its text",
  };
}

function reasonFor(cell: FinancialCell): string | null {
  if (cell.status === "missing") return "not printed";
  if (cell.status === "unparsed") return "not readable";
  if (cell.status === "dash") return "a dash printed on the page";
  if (cell.value !== null) return null;
  return cell.source?.kind === "xbrl" && cell.source.nil ? "the XBRL file gives no value" : "no value could be placed in the table's unit";
}

/**
 * What another filing printed for the same line and year, in words, and which figure this table shows. Each figure is
 * named with its unit: as printed in that filing's own unit, and the same figure in this table's unit.
 */
function restatedWords(cell: FinancialCell, unit: Unit, filings: CompanyFiling[]): string | null {
  const r = cell.restated;
  if (!r) return null;
  const name = filingName(filings, r.documentId);
  const period = r.filingPeriodEnd ? ` for the period ending ${r.filingPeriodEnd}` : "";
  const filing = `${name ? `The filing ${name}` : "Another filing"}${period} (document_id ${r.documentId})`;
  const inTable = r.value === null ? "no figure in this table's unit" : `${r.value} in this table's unit (${unitWords(unit)})`;
  const shown = " This table shows this column's filing's figure.";
  if (r.kind === "xbrl") return `${filing} filed ${inTable} for this year in its XBRL file, element ${r.element}.${shown}`;
  return `${filing} printed ${r.printed} for this year on page ${r.pageIndex + 1}, in its own unit; that is ${inTable}.${shown}`;
}

export function presentCell(cell: FinancialCell, column: FinancialColumn, unit: TableUnit | Unit, filings: CompanyFiling[]): CellAnswer {
  const u: Unit = { label: unit.label, scale: unit.scale, currency: unit.currency };
  return {
    fact_id: cell.factId,
    period_end: column.periodEnd,
    period: column.periodLabel,
    span: "year",
    value: cell.status === "value" ? cell.value : null,
    printed: cell.status === "dash" ? "–" : cell.printed,
    status: CELL_STATUS_WORDS[cell.status],
    reason: reasonFor(cell),
    unit_label: u.label,
    scale: u.scale,
    currency: u.currency,
    source: sourceAnswer(cell, filings),
    check: checkSentence(cell.check, cell.source?.kind ?? null, u),
    restated: restatedWords(cell, u, filings),
    reviewed: "not yet",
  };
}

export function presentTable(company: Company, filings: CompanyFiling[], table: StatementTable): StatementAnswer {
  return {
    company: { id: company.id, name: company.displayName },
    statement: table.statement,
    basis: table.basis,
    unit: toUnit(table.unit),
    columns: table.columns.map((c) => ({
      period_end: c.periodEnd,
      label: c.periodLabel,
      filing: filingName(filings, c.documentId),
      document_id: c.documentId,
      filing_period_end: c.filingPeriodEnd,
    })),
    rows: table.rows.map((row) => {
      const unit = row.perShare ? perShareUnit(table.unit) : table.unit;
      return {
        line: LINE_AS_PRINTED,
        label: row.label,
        section: row.section,
        is_subtotal: row.isSubtotal,
        per_share: row.perShare,
        cells: row.cells.flatMap((cell, i) => {
          const column = table.columns[i];
          return column ? [presentCell(cell, column, unit, filings)] : [];
        }),
      };
    }),
    note: TABLE_NOTE,
    undated_figures: table.unplaced,
    left_out: table.leftOut.map((l) => ({ filing: filingName(filings, l.documentId), document_id: l.documentId, reason: LEFT_OUT_WHY[l.reason] })),
  };
}
