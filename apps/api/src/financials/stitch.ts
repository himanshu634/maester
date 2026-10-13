import type { CellCheck, FinancialCell, FinancialColumn, FinancialRow, StatementTable } from "@maester/contracts";
import type { ExtractionCheckRow, FactWithSource } from "@maester/db";

/**
 * Puts a company's years together from the facts of its read annual reports
 * (docs/superpowers/specs/2026-10-13-company-financials-design.md, "The table").
 * Each column comes whole from the newest filing that prints its period, so every column
 * adds up; an older filing that printed a different figure for the same line and year marks
 * the cell restated. Lines match across filings by printed name. Pure: no database.
 */

export type Filing = {
  documentId: string;
  /** The filing's own period end (its classification's): the newest filing is the latest. */
  periodEnd: string | null;
  revisionCreatedAt: Date;
  pageCount: number;
  facts: FactWithSource[];
  checks: ExtractionCheckRow[];
};

const STATEMENTS = ["income_statement", "balance_sheet", "cash_flow"] as const;
const BASES = ["consolidated", "standalone", "unknown"] as const;
const PER_SHARE = /earnings per (equity )?share|\beps\b/;

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

const dateOf = (f: FactWithSource) => f.fact.periodEnd ?? f.fact.asOfDate;
const perShare = (f: FactWithSource) => PER_SHARE.test(normalise(f.fact.section)) || PER_SHARE.test(normalise(f.fact.reportedLabel));

type Unit = { label: string | null; scale: string | null; currency: string | null };

/** How to bring a filing's figures into the table's unit, or why it can't. */
function converter(facts: FactWithSource[], unit: Unit): { move: number | null; reason: "other_currency" | "other_unit" | null } {
  const plain = facts.filter((f) => !perShare(f));
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

const NO_CHECK: CellCheck = { role: "none", status: null, subjectLabel: null, expected: null, actual: null };

type Placed = { filing: Filing; move: number; byKey: Map<string, FactWithSource>; keys: string[] };

function keyed(facts: FactWithSource[]): { byKey: Map<string, FactWithSource>; keys: string[] } {
  const seen = new Map<string, number>();
  const byKey = new Map<string, FactWithSource>();
  const keys: string[] = [];
  for (const f of [...facts].sort((a, b) => a.fact.lineOrder - b.fact.lineOrder)) {
    const base = `${normalise(f.fact.section)}|${normalise(f.fact.reportedLabel)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = `${base}|${n}`;
    byKey.set(key, f);
    keys.push(key);
  }
  return { byKey, keys };
}

function checkFor(f: FactWithSource, filing: Filing, siblings: FactWithSource[], move: number): CellCheck {
  // A check names its section when it has one: two subtotals called "Total" are told apart by it.
  const index = (subject: string, section: string) =>
    filing.checks.find(
      (c) =>
        c.statement === f.fact.statement &&
        c.basis === f.fact.basis &&
        (c.section === null || normalise(c.section) === normalise(section)) &&
        normalise(c.periodLabel) === normalise(f.fact.periodLabel) &&
        normalise(c.subjectLabel) === normalise(subject),
    );
  const rescale = (v: string | null) => (v === null ? null : moveDecimal(v, move));
  const own = index(f.fact.reportedLabel, f.fact.section);
  if (own) return { role: "subject", status: own.status, subjectLabel: own.subjectLabel, expected: rescale(own.expected), actual: rescale(own.actual) };
  const label = normalise(f.fact.reportedLabel);
  const parent = siblings.find(
    (s) => s.fact.isSubtotal && normalise(s.fact.section) === normalise(f.fact.section) && s.fact.componentLabels.some((l) => normalise(l) === label),
  );
  const theirs = parent ? index(parent.fact.reportedLabel, parent.fact.section) : undefined;
  if (parent && theirs) {
    return { role: "component", status: theirs.status, subjectLabel: parent.fact.reportedLabel, expected: rescale(theirs.expected), actual: rescale(theirs.actual) };
  }
  return NO_CHECK;
}

function valueOf(f: FactWithSource, move: number, unit: Unit): string | null {
  if (f.fact.valueStatus !== "value" || f.fact.reportedValue === null) return null;
  if (perShare(f)) return moveDecimal(f.fact.reportedValue, 0);
  if (move === 0) return moveDecimal(f.fact.reportedValue, 0);
  const to = exponent(unit.scale);
  if (f.fact.normalizedValue !== null && to !== null) return moveDecimal(f.fact.normalizedValue, -to);
  return null;
}

function cellOf(f: FactWithSource, placed: Placed, unit: Unit, siblings: FactWithSource[]): FinancialCell {
  return {
    status: f.fact.valueStatus,
    value: valueOf(f, placed.move, unit),
    printed: f.fact.reportedText,
    factId: f.fact.id,
    revisionId: f.fact.revisionId,
    source: { documentId: f.source.documentId, pageIndex: f.source.pageIndex, pageCount: placed.filing.pageCount, textLayerMatch: f.source.textLayerMatch },
    check: checkFor(f, placed.filing, siblings, placed.move),
    restated: null,
  };
}

const MISSING: FinancialCell = { status: "missing", value: null, printed: null, factId: null, revisionId: null, source: null, check: NO_CHECK, restated: null };

function stitchOne(ordered: Filing[], statement: (typeof STATEMENTS)[number], basis: (typeof BASES)[number]): StatementTable | null {
  const mine = ordered
    .map((filing) => ({ filing, facts: filing.facts.filter((f) => f.fact.statement === statement && f.fact.basis === basis) }))
    .filter((x) => x.facts.length > 0);
  if (mine.length === 0) return null;

  const head = mine[0]!.facts.find((f) => !perShare(f)) ?? mine[0]!.facts[0]!;
  const unit: Unit = { label: head.fact.unitLabel, scale: head.fact.scaleFactor, currency: head.fact.currency };

  let unplaced = 0;
  const leftOut: StatementTable["leftOut"] = [];
  /** period → filings that print it, newest first. */
  const byPeriod = new Map<string, Placed[]>();
  for (const { filing, facts } of mine) {
    const { move, reason } = converter(facts, unit);
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
  if (byPeriod.size === 0) return null;

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
      meta.set(key, { section: f.fact.section, label: f.fact.reportedLabel, isSubtotal: f.fact.isSubtotal, perShare: perShare(f) });
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
        const theirs = valueOf(g, other.move, unit);
        if (g.fact.valueStatus !== f.fact.valueStatus || theirs !== cell.value) {
          cell.restated = { documentId: other.filing.documentId, filingPeriodEnd: other.filing.periodEnd, pageIndex: g.source.pageIndex, value: theirs, printed: g.fact.reportedText };
        }
        break;
      }
      return cell;
    });
    return { key, section: m.section, label: m.label, isSubtotal: m.isSubtotal, perShare: m.perShare, cells };
  });

  return { statement, basis, unit, columns, rows, unplaced, leftOut };
}

export function stitch(filings: Filing[]): StatementTable[] {
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
