import type { CellCheck, CellSource, FinancialCell, FinancialColumn, FinancialRow, Restated, StatementTable, XbrlInPdf } from "@maester/contracts";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";
import { annualSlotOf, rankSlotCandidates, type FilingKind, type SlotCandidate } from "@maester/financial-engine";

/**
 * Puts a company's years together from the facts of its read annual reports, PDF or XBRL
 * (docs/superpowers/specs/2026-10-13-company-financials-design.md, "The table").
 * A fact fills the annual table only when the source rule gives it an annual slot (`annualSlotOf`): a results
 * filing adds nothing, and an XBRL quarter, year to date or off-date instant never shares a year's column.
 * Each column comes whole from the one filing that owns its period by the source rule (`rankSlotCandidates`:
 * XBRL first, then the newest filing), so a column never mixes filings; another filing that printed a different
 * figure for the same line and year marks the cell restated (compared at the coarser of the two printed
 * precisions, so a change of unit alone is not a restatement). Lines match across filings by printed name.
 * Pure: no database.
 */

export type Filing = {
  documentId: string;
  /** The revision the facts are of. */
  revisionId: string;
  companyId: string;
  /** What the revision was read from. */
  source: "pdf" | "xbrl";
  filingKind: FilingKind;
  /** The document's file name: an XBRL cell names it, since an instance has no page to open. */
  originalName: string;
  /** The filing's own period end (its classification's): the newest filing is the latest. */
  periodEnd: string | null;
  revisionCreatedAt: Date;
  pageCount: number;
  facts: FactWithSource[];
  checks: ExtractionCheckRow[];
  /** XBRL facts only: each fact's check against its results PDF, by fact id. */
  inPdf: Map<string, XbrlInPdf>;
};

const STATEMENTS = ["income_statement", "balance_sheet", "cash_flow"] as const;
const BASES = ["consolidated", "standalone", "unknown"] as const;
/** Earnings per share, singular or plural, "equity" or not, or "EPS" as a word. Matched on normalised text. */
const PER_SHARE = /earnings? per (equity )?share|\beps\b/;
/** The unit `document.xbrl` gives a per-share fact: an XBRL fact is per share by its unit alone, whatever its label. */
const PER_SHARE_UNIT = "₹ a share";
/** An XBRL fact the route gave no check outcome for: nothing is claimed about the PDF. */
const NOT_YET: XbrlInPdf = { status: "not_checked", pdfDocumentId: null, pageIndex: null, statementPages: [], reason: "not_yet" };

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Moves the decimal point `places` to the right (negative: to the left). Exact; trims trailing zeros. */
export function moveDecimal(value: string, places: number): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m) throw new Error(`not a decimal: ${value}`);
  const [, sign, int = "", frac = ""] = m;
  let digits = BigInt(int + frac || "0");
  let scale = frac.length - places;
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  const s = digits.toString().padStart(scale + 1, "0");
  let out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return sign && digits !== 0n ? `-${out}` : out;
}

/**
 * Rounds a decimal string half away from zero to `decimals` places; a negative `decimals` rounds to tens,
 * hundreds and so on. Exact, like `moveDecimal`, and trims trailing zeros the same way.
 */
export function roundTo(value: string, decimals: number): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m) throw new Error(`not a decimal: ${value}`);
  const [, sign, int = "", frac = ""] = m;
  const drop = frac.length - decimals;
  if (drop <= 0) return moveDecimal(value, 0);
  const unit = 10n ** BigInt(drop);
  const digits = BigInt(int + frac || "0");
  const kept = digits / unit + (2n * (digits % unit) >= unit ? 1n : 0n);
  return moveDecimal(`${sign}${kept}`, -decimals);
}

/** Decimal places as written: "12105.40" has 2. */
function places(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

/** The exponent of a power-of-ten scale ("10000000" → 7); null for anything else. */
function exponent(scale: string | null): number | null {
  if (scale === null) return null;
  const m = /^1(0*)(?:\.0*)?$/.exec(scale);
  return m ? m[1]!.length : null;
}

function newestFirst(a: Filing, b: Filing): number {
  const pa = a.periodEnd ?? "";
  const pb = b.periodEnd ?? "";
  if (pa !== pb) return pa < pb ? 1 : -1;
  return b.revisionCreatedAt.getTime() - a.revisionCreatedAt.getTime();
}

/** The candidate a filing is for the source rule's ranking of one period. */
const candidateOf = (f: Filing): SlotCandidate => ({
  revisionId: f.revisionId,
  documentId: f.documentId,
  source: f.source,
  filingPeriodEnd: f.periodEnd,
  revisionCreatedAt: f.revisionCreatedAt.toISOString(),
});

const dateOf = (f: FactWithSource) => f.fact.periodEnd ?? f.fact.asOfDate;

/** An XBRL fact is per share when its unit says so exactly; a PDF fact when its section or label names earnings per share. */
const perShare = (f: FactWithSource, filing: Filing) =>
  filing.source === "xbrl"
    ? f.fact.unitLabel === PER_SHARE_UNIT
    : PER_SHARE.test(normalise(f.fact.section)) || PER_SHARE.test(normalise(f.fact.reportedLabel));

/**
 * Whether a fact goes into the annual table: when the source rule gives it an annual slot, or, for a fact of an
 * annual filing with no date to place it by, to be counted as unplaced. A results filing adds nothing at all.
 */
function admitted(f: FactWithSource, filing: Filing): boolean {
  const slot = annualSlotOf(
    { companyId: filing.companyId, kind: filing.filingKind, source: filing.source, periodEnd: filing.periodEnd },
    { statement: f.fact.statement, basis: f.fact.basis, span: f.fact.span, periodEnd: f.fact.periodEnd, asOfDate: f.fact.asOfDate },
  );
  return slot !== null || (filing.filingKind !== "financial_results" && dateOf(f) === null);
}

type Unit = { label: string | null; scale: string | null; currency: string | null };

/** How to bring a filing's figures into the table's unit, or why it can't. */
function converter(facts: FactWithSource[], filing: Filing, unit: Unit): { move: number | null; reason: "other_currency" | "other_unit" | null } {
  const plain = facts.filter((f) => !perShare(f, filing));
  const currency = plain.find((f) => f.fact.currency)?.fact.currency ?? null;
  if (currency && unit.currency && currency !== unit.currency) return { move: null, reason: "other_currency" };
  // A filing with no unit (scale null) is not "the same unit" as a table that has one.
  const scale = plain.length > 0 ? plain[0]!.fact.scaleFactor : unit.scale;
  if (scale === unit.scale) return { move: 0, reason: null };
  const from = exponent(scale);
  const to = exponent(unit.scale);
  if (from === null || to === null) return { move: null, reason: "other_unit" };
  return { move: from - to, reason: null };
}

const NO_CHECK: CellCheck = { role: "none", status: null, checkType: null, subjectLabel: null, expected: null, actual: null };

type Placed = { filing: Filing; move: number; byKey: Map<string, FactWithSource>; keys: string[] };

/**
 * The line a fact is printed on, as the table matches lines across filings: its section and printed name, normalised.
 * A row's key is this, then "|n" for the n-th line of that name in one filing.
 */
export const lineOf = (fact: { section: string; reportedLabel: string }): string => `${normalise(fact.section)}|${normalise(fact.reportedLabel)}`;

function keyed(facts: FactWithSource[]): { byKey: Map<string, FactWithSource>; keys: string[] } {
  const seen = new Map<string, number>();
  const byKey = new Map<string, FactWithSource>();
  const keys: string[] = [];
  for (const f of [...facts].sort((a, b) => a.fact.lineOrder - b.fact.lineOrder)) {
    const base = lineOf(f.fact);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = `${base}|${n}`;
    byKey.set(key, f);
    keys.push(key);
  }
  return { byKey, keys };
}

/** Failed outranks not checked, which outranks passed: a figure is never shown cleaner than its worst check. */
const SEVERITY: Record<ExtractionCheckRow["status"], number> = { failed: 2, not_checked: 1, passed: 0 };

/**
 * A fact's arithmetic check, from its own revision's `checks`: the check whose subject is this line, else its subtotal's
 * sum when the line is one of that subtotal's components. `siblings` are the facts printed beside it (same statement,
 * basis and day); `move` places `expected` and `actual` in the reader's unit (0: the filing's own). The one matching rule
 * for both the statement table and a fact read on its own.
 */
export function checkFor(f: FactWithSource, checks: readonly ExtractionCheckRow[], siblings: readonly FactWithSource[], move: number): CellCheck {
  // A check names its section when it has one: two subtotals called "Total" are told apart by it. A check with no
  // section (the balance identity) covers every section, so total assets can have two checks: the worst status
  // wins, and on a tie the check that names the section exactly, so the result never depends on array order.
  const index = (subject: string, section: string, types: readonly ExtractionCheckRow["checkType"][]) => {
    let best: ExtractionCheckRow | undefined;
    for (const c of checks) {
      if (
        !types.includes(c.checkType) ||
        c.statement !== f.fact.statement ||
        c.basis !== f.fact.basis ||
        (c.section !== null && normalise(c.section) !== normalise(section)) ||
        normalise(c.periodLabel) !== normalise(f.fact.periodLabel) ||
        normalise(c.subjectLabel) !== normalise(subject)
      ) {
        continue;
      }
      if (!best) {
        best = c;
        continue;
      }
      const worse = SEVERITY[c.status] - SEVERITY[best.status];
      if (worse > 0 || (worse === 0 && best.section === null && c.section !== null)) best = c;
    }
    return best;
  };
  const rescale = (v: string | null) => (v === null ? null : moveDecimal(v, move));
  const own = index(f.fact.reportedLabel, f.fact.section, ["subtotal", "balance_identity"]);
  if (own) {
    return { role: "subject", status: own.status, checkType: own.checkType, subjectLabel: own.subjectLabel, expected: rescale(own.expected), actual: rescale(own.actual) };
  }
  const label = normalise(f.fact.reportedLabel);
  const parent = siblings.find(
    (s) => s.fact.isSubtotal && normalise(s.fact.section) === normalise(f.fact.section) && s.fact.componentLabels.some((l) => normalise(l) === label),
  );
  // A line takes only its subtotal's own sum. The balance identity compares the total with equity and
  // liabilities, which says nothing about whether this line is right.
  const theirs = parent ? index(parent.fact.reportedLabel, parent.fact.section, ["subtotal"]) : undefined;
  if (parent && theirs) {
    return { role: "component", status: theirs.status, checkType: "subtotal", subjectLabel: parent.fact.reportedLabel, expected: rescale(theirs.expected), actual: rescale(theirs.actual) };
  }
  return NO_CHECK;
}

/**
 * One fact's check in its filing's own unit, from its revision's facts and checks: the siblings are grouped as the table
 * groups them (same statement, basis and day), so a fact read on its own gets the check its table cell would.
 */
export function factCheck(f: FactWithSource, revisionFacts: readonly FactWithSource[], checks: readonly ExtractionCheckRow[]): CellCheck {
  const day = dateOf(f);
  const siblings = revisionFacts.filter((s) => s.fact.statement === f.fact.statement && s.fact.basis === f.fact.basis && dateOf(s) === day);
  return checkFor(f, checks, siblings, 0);
}

function valueOf(f: FactWithSource, placed: Placed, unit: Unit): string | null {
  const { move } = placed;
  if (f.fact.valueStatus !== "value" || f.fact.reportedValue === null) return null;
  if (perShare(f, placed.filing)) return moveDecimal(f.fact.reportedValue, 0);
  if (move === 0) return moveDecimal(f.fact.reportedValue, 0);
  const to = exponent(unit.scale);
  if (f.fact.normalizedValue !== null && to !== null) return moveDecimal(f.fact.normalizedValue, -to);
  return null;
}

/**
 * How finely a figure is known in the table's unit: its printed decimals, less the places its decimal point
 * moved ("12,10,543.21" lakh is 12105.4321 crore: 4 places). Negative when it is known only to tens or more
 * (whole crore moved into lakh). A per-share figure never moves.
 */
function precisionOf(f: FactWithSource, placed: Placed): number {
  return places(f.fact.reportedValue ?? "") - (perShare(f, placed.filing) ? 0 : placed.move);
}

/**
 * Whether two filings printed the same figure: both brought to the coarser of their two precisions first, so
 * a line printed in lakh one year and in crore the next is not "restated" by the extra decimals alone.
 */
function sameFigure(a: string | null, aPlaces: number, b: string | null, bPlaces: number): boolean {
  if (a === null || b === null) return a === b;
  const coarser = Math.min(aPlaces, bPlaces);
  return roundTo(a, coarser) === roundTo(b, coarser);
}

/** Where a cell's figure was read, by its filing's source; null for a fact stored without its source row. */
function sourceOf(f: FactWithSource, filing: Filing): CellSource | null {
  if (filing.source === "xbrl") {
    if (!f.xbrl) return null;
    return {
      kind: "xbrl", documentId: f.xbrl.documentId, originalName: filing.originalName, element: f.xbrl.element, contextId: f.xbrl.contextId,
      decimals: f.xbrl.decimals, nil: f.xbrl.nil, periodStart: f.fact.periodStart, span: f.fact.span, inPdf: filing.inPdf.get(f.fact.id) ?? NOT_YET,
    };
  }
  if (!f.source) return null;
  return { kind: "page", documentId: f.source.documentId, pageIndex: f.source.pageIndex, pageCount: filing.pageCount, textLayerMatch: f.source.textLayerMatch };
}

/**
 * What another filing printed for the cell, by that filing's source: its page, or its XBRL element. Null when the
 * other fact was stored without its source row, since there is then nowhere to point to.
 */
function restatedOf(g: FactWithSource, other: Placed, value: string | null): Restated | null {
  const { documentId, periodEnd: filingPeriodEnd } = other.filing;
  if (other.filing.source === "xbrl") {
    return g.xbrl ? { kind: "xbrl", documentId, filingPeriodEnd, element: g.xbrl.element, value, printed: g.fact.reportedText } : null;
  }
  return g.source ? { kind: "page", documentId, filingPeriodEnd, pageIndex: g.source.pageIndex, value, printed: g.fact.reportedText } : null;
}

function cellOf(f: FactWithSource, placed: Placed, unit: Unit, siblings: FactWithSource[]): FinancialCell {
  return {
    status: f.fact.valueStatus,
    value: valueOf(f, placed, unit),
    printed: f.fact.reportedText,
    factId: f.fact.id,
    revisionId: f.fact.revisionId,
    source: sourceOf(f, placed.filing),
    check: checkFor(f, placed.filing.checks, siblings, placed.move),
    restated: null,
  };
}

/** One period's filings, owner first, by the source rule: XBRL first, then the newer filing period and revision. */
function ranked(placed: Placed[]): Placed[] {
  const byRevision = new Map(placed.map((p) => [p.filing.revisionId, p]));
  return rankSlotCandidates(placed.map((p) => candidateOf(p.filing))).map((c) => byRevision.get(c.revisionId)!);
}

const MISSING: FinancialCell = { status: "missing", value: null, printed: null, factId: null, revisionId: null, source: null, check: NO_CHECK, restated: null };

function stitchOne(ordered: Filing[], statement: (typeof STATEMENTS)[number], basis: (typeof BASES)[number]): StatementTable | null {
  const mine = ordered
    .map((filing) => ({
      filing,
      facts: filing.facts.filter((f) => f.fact.statement === statement && f.fact.basis === basis && admitted(f, filing)),
    }))
    .filter((x) => x.facts.length > 0);
  if (mine.length === 0) return null;

  const head = mine[0]!.facts.find((f) => !perShare(f, mine[0]!.filing)) ?? mine[0]!.facts[0]!;
  const unit: Unit = { label: head.fact.unitLabel, scale: head.fact.scaleFactor, currency: head.fact.currency };

  let unplaced = 0;
  const leftOut: StatementTable["leftOut"] = [];
  /** period → filings that print it, owner first once ranked. */
  const byPeriod = new Map<string, Placed[]>();
  for (const { filing, facts } of mine) {
    const { move, reason } = converter(facts, filing, unit);
    if (move === null) {
      leftOut.push({ documentId: filing.documentId, reason: reason! });
      continue;
    }
    const groups = new Map<string, FactWithSource[]>();
    for (const f of facts) {
      const day = dateOf(f);
      if (!day) {
        unplaced++;
        continue;
      }
      groups.set(day, [...(groups.get(day) ?? []), f]);
    }
    for (const [day, group] of groups) {
      const placed = byPeriod.get(day) ?? [];
      placed.push({ filing, move, ...keyed(group) });
      byPeriod.set(day, placed);
    }
  }
  // Read, but nothing to place by year: a table with no columns still says how many figures were left out.
  if (byPeriod.size === 0) return { statement, basis, unit, columns: [], rows: [], unplaced, leftOut };
  for (const [day, placed] of byPeriod) byPeriod.set(day, ranked(placed));

  const periods = [...byPeriod.keys()].sort();
  const owners = periods.map((p) => byPeriod.get(p)![0]!);

  // Rows: the newest owner's order first; an older-only key goes in after the key before it.
  const order: string[] = [];
  const meta = new Map<string, { section: string; label: string; isSubtotal: boolean; perShare: boolean }>();
  for (const owner of [...owners].reverse()) {
    let after = -1;
    for (const key of owner.keys) {
      const at = order.indexOf(key);
      if (at >= 0) {
        after = at;
        continue;
      }
      order.splice(after + 1, 0, key);
      after += 1;
      const f = owner.byKey.get(key)!;
      meta.set(key, { section: f.fact.section, label: f.fact.reportedLabel, isSubtotal: f.fact.isSubtotal, perShare: perShare(f, owner.filing) });
    }
  }

  const columns: FinancialColumn[] = owners.map((owner, i) => {
    const any = owner.byKey.values().next().value!;
    return { periodEnd: periods[i]!, periodLabel: any.fact.periodLabel, documentId: owner.filing.documentId, filingPeriodEnd: owner.filing.periodEnd };
  });

  const rows: FinancialRow[] = order.map((key) => {
    const m = meta.get(key)!;
    const cells = periods.map((period, i) => {
      const owner = owners[i]!;
      const f = owner.byKey.get(key);
      if (!f) return MISSING;
      const cell = cellOf(f, owner, unit, [...owner.byKey.values()]);
      for (const other of byPeriod.get(period)!.slice(1)) {
        const g = other.byKey.get(key);
        if (!g) continue;
        const theirs = valueOf(g, other, unit);
        const same = sameFigure(cell.value, precisionOf(f, owner), theirs, precisionOf(g, other));
        if (g.fact.valueStatus !== f.fact.valueStatus || !same) cell.restated = restatedOf(g, other, theirs);
        break;
      }
      return cell;
    });
    return { key, section: m.section, label: m.label, isSubtotal: m.isSubtotal, perShare: m.perShare, cells };
  });

  return { statement, basis, unit, columns, rows, unplaced, leftOut };
}

export function stitch(filings: Filing[]): StatementTable[] {
  // Newest filing first: it sets each table's unit. Who owns a period is the source rule's ranking, not this order.
  const ordered = [...filings].sort(newestFirst);
  const tables: StatementTable[] = [];
  for (const statement of STATEMENTS) {
    for (const basis of BASES) {
      const table = stitchOne(ordered, statement, basis);
      if (table) tables.push(table);
    }
  }
  return tables;
}
