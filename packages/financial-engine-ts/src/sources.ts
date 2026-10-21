/**
 * The source rule: which revision owns a statement slot, which facts may fill an annual column, and
 * whether a results PDF is read, skipped or held for XBRL. Version 1.
 *
 * Pure: no I/O, no clock, no numbers. Dates are ISO strings compared as text, so every date is
 * `YYYY-MM-DD` and every timestamp is UTC in the `Date.prototype.toISOString()` shape
 * (`2026-05-01T09:00:00.000Z`); a mix of shapes would misorder. The Python twin is
 * `maester_eval.source_rule`, and both are tested against `fixtures/source-rule.json`.
 */

export const SOURCE_RULE_VERSION = 1;

export type FilingKind = "annual_report" | "financial_results";
export type Basis = "consolidated" | "standalone" | "unknown";
export type Statement = "income_statement" | "balance_sheet" | "cash_flow";
export type Span = "quarter" | "half_year" | "nine_months" | "year" | "other";
export type Source = "xbrl" | "pdf";

/** One column of one statement: a duration (`span` set) or an instant (`span` null). */
export interface Slot {
  companyId: string;
  filingKind: FilingKind;
  statement: Statement;
  basis: Basis;
  periodEnd: string;
  span: Span | null;
}

export function slotKey(s: Slot): string {
  return [s.companyId, s.filingKind, s.statement, s.basis, s.periodEnd, s.span ?? "instant"].join("|");
}

/** A revision that prints a slot. */
export interface SlotCandidate {
  revisionId: string;
  documentId: string;
  source: Source;
  filingPeriodEnd: string | null;
  revisionCreatedAt: string;
}

/** Descending text order: the larger string first. Plain `<`, never locale collation, so the Python twin agrees. */
function newerFirst(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}

function ownerFirst(a: SlotCandidate, b: SlotCandidate): number {
  if (a.source !== b.source) return a.source === "xbrl" ? -1 : 1;
  if (a.filingPeriodEnd !== b.filingPeriodEnd) {
    if (a.filingPeriodEnd === null) return 1;
    if (b.filingPeriodEnd === null) return -1;
    return newerFirst(a.filingPeriodEnd, b.filingPeriodEnd);
  }
  if (a.revisionCreatedAt !== b.revisionCreatedAt) return newerFirst(a.revisionCreatedAt, b.revisionCreatedAt);
  return newerFirst(a.revisionId, b.revisionId);
}

/**
 * The candidates for one slot, owner first: XBRL before PDF, then the newer filing period (null last),
 * then the newer revision, then the larger revision id. The input is not reordered.
 */
export function rankSlotCandidates(cs: SlotCandidate[]): SlotCandidate[] {
  return [...cs].sort(ownerFirst);
}

export function slotOwner(cs: SlotCandidate[]): SlotCandidate | null {
  return rankSlotCandidates(cs)[0] ?? null;
}

export interface AnnualFiling {
  companyId: string;
  kind: FilingKind;
  source: Source;
  periodEnd: string | null;
}

export interface AnnualFact {
  statement: Statement;
  basis: Basis;
  span: Span | null;
  periodEnd: string | null;
  asOfDate: string | null;
}

/**
 * The annual-table slot a fact fills, or null when it fills none. The one place the investor's open Q4
 * question is answered: a results filing's full-year facts do not fill an annual column.
 *
 * 1. A `financial_results` filing gives null.
 * 2. A PDF fact gives its slot at its period end, else its as-of date (comparative years included);
 *    with neither, there is nothing to key it by, and it gives null.
 * 3. An XBRL fact gives its slot when its span is `year`, or when it is an instant on the filing's own
 *    period end (both known). Anything else gives null: an instance holds no comparatives, and a quarter
 *    or a year to date that ends on the year's last day never shares its column.
 */
export function annualSlotOf(filing: AnnualFiling, fact: AnnualFact): Slot | null {
  if (filing.kind === "financial_results") return null;
  const slot = (periodEnd: string | null): Slot | null =>
    periodEnd === null
      ? null
      : { companyId: filing.companyId, filingKind: "annual_report", statement: fact.statement, basis: fact.basis, periodEnd, span: fact.span };
  if (filing.source === "pdf") return slot(fact.periodEnd ?? fact.asOfDate);
  if (fact.span === "year") return slot(fact.periodEnd);
  if (fact.span === null && fact.asOfDate !== null && fact.asOfDate === filing.periodEnd) return slot(fact.asOfDate);
  return null;
}

export interface CompanyIdentity {
  cin: string | null;
  bseCode: string | null;
  nseSymbol: string | null;
  isin: string | null;
}

export interface StatementBasis {
  statement: Statement;
  basis: Basis;
}

/** An XBRL document of the workspace, as the source rule sees it. */
export interface XbrlDocInput {
  documentId: string;
  state: "unsettled" | "held" | "settled";
  companyId: string | null;
  identity: CompanyIdentity;
  periodEnd: string | null;
  /** The statements and bases with facts in its current mapped revision; empty when unmapped, failed or not read. */
  coverage: StatementBasis[];
}

/** A PDF whose numbers may come from XBRL instead. */
export interface PdfNumbersInput {
  companyId: string;
  companyIdentity: CompanyIdentity;
  kind: FilingKind;
  periodEnd: string | null;
  statementsFound: StatementBasis[];
}

export type PdfNumbersPlan =
  | { action: "wait"; waitingOn: string[] }
  | { action: "skip"; coveredBy: string[] }
  | { action: "read"; coveredBy: string[]; uncovered: StatementBasis[] };

const IDENTITY_CODES = ["cin", "bseCode", "nseSymbol", "isin"] as const;

/** Rule 2: an XBRL document that may yet turn out to be this PDF's company and period. Codes match exactly. */
function couldMatch(pdf: PdfNumbersInput, x: XbrlDocInput): boolean {
  const company =
    x.companyId === pdf.companyId ||
    (x.companyId === null &&
      (IDENTITY_CODES.every((k) => x.identity[k] === null) ||
        IDENTITY_CODES.some((k) => x.identity[k] !== null && x.identity[k] === pdf.companyIdentity[k])));
  return company && (x.periodEnd === null || x.periodEnd === pdf.periodEnd);
}

/** A pair XBRL can cover: basis `unknown` never is. */
const coverable = (p: StatementBasis) => p.basis !== "unknown";
const samePair = (a: StatementBasis, b: StatementBasis) => a.statement === b.statement && a.basis === b.basis;

/** Settled XBRL of the PDF's company and (known) period. */
function settledOfSameFiling(pdf: PdfNumbersInput, xbrl: XbrlDocInput[]): XbrlDocInput[] {
  return xbrl.filter((x) => x.state === "settled" && x.companyId === pdf.companyId && pdf.periodEnd !== null && x.periodEnd === pdf.periodEnd);
}

function isCovered(p: StatementBasis, by: XbrlDocInput[]): boolean {
  return coverable(p) && by.some((x) => x.coverage.some((c) => coverable(c) && samePair(c, p)));
}

/**
 * Rule 4 alone: the ids, in input order, of the settled XBRL documents of the PDF's company and period
 * whose coverage holds at least one of the PDF's statement pairs (basis `unknown` never matches). A null
 * period end matches nothing. Unsettled and held documents are ignored.
 */
export function coveringXbrl(pdf: PdfNumbersInput, xbrl: XbrlDocInput[]): string[] {
  return settledOfSameFiling(pdf, xbrl)
    .filter((x) => pdf.statementsFound.some((p) => isCovered(p, [x])))
    .map((x) => x.documentId);
}

/**
 * Whether a PDF's numbers are read, skipped because XBRL covers them, or held for XBRL that could match.
 *
 * 1. An annual report, or a PDF with no period end, is read with nothing covered.
 * 2. An XBRL document could match when its company is the PDF's (or unknown, with an all-null identity or
 *    a code shared with the PDF company's) and its period is the PDF's (or unknown).
 * 3. Any unsettled or held one that could match: wait, on those, in input order.
 * 4. Settled XBRL of the same company and period covers its coverage pairs; basis `unknown` never is.
 * 5. Statements found, and every one covered: skip.
 * 6. Otherwise read, naming the covering documents and the uncovered pairs.
 */
export function planPdfNumbers(pdf: PdfNumbersInput, xbrl: XbrlDocInput[]): PdfNumbersPlan {
  if (pdf.kind === "annual_report" || pdf.periodEnd === null) {
    return { action: "read", coveredBy: [], uncovered: [...pdf.statementsFound] };
  }
  const waitingOn = xbrl.filter((x) => x.state !== "settled" && couldMatch(pdf, x)).map((x) => x.documentId);
  if (waitingOn.length > 0) return { action: "wait", waitingOn };
  const settled = settledOfSameFiling(pdf, xbrl);
  const uncovered = pdf.statementsFound.filter((p) => !isCovered(p, settled));
  const coveredBy = coveringXbrl(pdf, xbrl);
  if (pdf.statementsFound.length > 0 && uncovered.length === 0) return { action: "skip", coveredBy };
  return { action: "read", coveredBy, uncovered };
}
