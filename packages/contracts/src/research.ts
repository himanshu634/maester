import { z } from "zod";
import { DecimalString, Uuid } from "./common.js";
import { Company } from "./company.js";
import { ClassificationKind, IntakeState } from "./classification.js";
import { IsoDate, ReportingBasis, StatementKind } from "./extraction.js";

/**
 * A company's statements put together across its read annual reports, and its NSE closes.
 * Read by the Research pages (docs/superpowers/specs/2026-10-13-company-financials-design.md).
 */

/** Read; a dash printed on the page; printed but not readable; or not printed by this column's filing. */
export const CellStatus = z.enum(["value", "dash", "unparsed", "missing"]);
export type CellStatus = z.infer<typeof CellStatus>;

/** The arithmetic check covering a figure: as the subtotal itself, as one of its lines, or none. */
export const CellCheck = z.object({
  role: z.enum(["subject", "component", "none"]),
  status: z.enum(["passed", "failed", "not_checked"]).nullable(),
  /** The subtotal the check is about, as printed. */
  subjectLabel: z.string().nullable(),
  /** The subtotal as the page prints it, in the table's unit. */
  expected: DecimalString.nullable(),
  /** What the subtotal's lines add up to, in the table's unit. */
  actual: DecimalString.nullable(),
});
export type CellCheck = z.infer<typeof CellCheck>;

export const CellSource = z.object({
  documentId: Uuid,
  /** 0-based page index of the original PDF. */
  pageIndex: z.number().int().min(0),
  pageCount: z.number().int().min(1),
  /** Whether the printed value was found in the page's text layer; null for a page without one. */
  textLayerMatch: z.boolean().nullable(),
});
export type CellSource = z.infer<typeof CellSource>;

/** What an older filing printed for the same line and year, when it differs. */
export const Restated = z.object({
  documentId: Uuid,
  filingPeriodEnd: IsoDate.nullable(),
  pageIndex: z.number().int().min(0),
  value: DecimalString.nullable(),
  printed: z.string(),
});
export type Restated = z.infer<typeof Restated>;

export const FinancialCell = z.object({
  status: CellStatus,
  /** In the table's unit, or rupees a share on a per-share row. Null unless status is "value". */
  value: DecimalString.nullable(),
  printed: z.string().nullable(),
  factId: Uuid.nullable(),
  revisionId: Uuid.nullable(),
  source: CellSource.nullable(),
  check: CellCheck,
  restated: Restated.nullable(),
});
export type FinancialCell = z.infer<typeof FinancialCell>;

export const FinancialRow = z.object({
  /** Stable within its table: normalised section, label and occurrence. */
  key: z.string(),
  section: z.string(),
  label: z.string(),
  isSubtotal: z.boolean(),
  /** Earnings per share and the like: values are as printed, rupees a share. */
  perShare: z.boolean(),
  /** One cell per column, in column order. */
  cells: z.array(FinancialCell),
});
export type FinancialRow = z.infer<typeof FinancialRow>;

export const FinancialColumn = z.object({
  periodEnd: IsoDate,
  periodLabel: z.string(),
  /** The filing the whole column comes from. */
  documentId: Uuid,
  filingPeriodEnd: IsoDate.nullable(),
});
export type FinancialColumn = z.infer<typeof FinancialColumn>;

export const TableUnit = z.object({ label: z.string().nullable(), scale: DecimalString.nullable(), currency: z.string().nullable() });
export type TableUnit = z.infer<typeof TableUnit>;

export const StatementTable = z.object({
  statement: StatementKind,
  basis: ReportingBasis,
  unit: TableUnit,
  /** Oldest period first. */
  columns: z.array(FinancialColumn),
  rows: z.array(FinancialRow),
  /** Figures with no date to place them by. */
  unplaced: z.number().int().min(0),
  /** Filings left out of this table, and why. */
  leftOut: z.array(z.object({ documentId: Uuid, reason: z.enum(["other_currency", "other_unit"]) })),
});
export type StatementTable = z.infer<typeof StatementTable>;

export const CompanyFiling = z.object({
  documentId: Uuid,
  originalName: z.string(),
  kind: ClassificationKind.nullable(),
  periodEnd: IsoDate.nullable(),
  intakeState: IntakeState.nullable(),
  /** True when its figures are in the tables: a read annual report. */
  counted: z.boolean(),
});
export type CompanyFiling = z.infer<typeof CompanyFiling>;

export const CompanyFinancials = z.object({ company: Company, filings: z.array(CompanyFiling), tables: z.array(StatementTable) });
export type CompanyFinancials = z.infer<typeof CompanyFinancials>;

export const StockPoint = z.object({ day: IsoDate, value: z.number() });
export type StockPoint = z.infer<typeof StockPoint>;

export const CompanyStock = z.object({
  state: z.enum(["ok", "no_symbol", "not_connected", "not_tracked"]),
  symbol: z.string().nullable(),
  /** "Dhan · NSE close". */
  source: z.string().nullable(),
  last: StockPoint.nullable(),
  previous: StockPoint.nullable(),
  /** The close on or before the same day a year earlier. */
  yearAgo: StockPoint.nullable(),
  low: StockPoint.nullable(),
  high: StockPoint.nullable(),
  /** The last 365 days of closes, oldest first. */
  series: z.array(StockPoint),
});
export type CompanyStock = z.infer<typeof CompanyStock>;

export const ResearchCompany = z.object({
  company: Company,
  annualReportsRead: z.number().int().min(0),
  latestPeriodEnd: IsoDate.nullable(),
  /** Filings being identified or read now. */
  reading: z.number().int().min(0),
  /** Filings that couldn't be identified or read. */
  failed: z.number().int().min(0),
});
export type ResearchCompany = z.infer<typeof ResearchCompany>;

export const ResearchCompanies = z.object({ items: z.array(ResearchCompany) });
export type ResearchCompanies = z.infer<typeof ResearchCompanies>;
