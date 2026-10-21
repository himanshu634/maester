import type { HeldIdentity } from "@maester/contracts";
import { normalizeCompanyName, type CompanyRow } from "@maester/db";

/** A document held for a company, as `groupHeld` sees it: what it prints. */
export interface HeldRow {
  documentId: string;
  kind: string;
  periodEnd: string | null;
  nameAsPrinted: string | null;
  cin: string | null;
  bseCode: string | null;
  isin: string | null;
  nseSymbol: string | null;
}

const TOKEN_PREFIX = { cin: "cin", bseCode: "bse", isin: "isin", nseSymbol: "nse" } as const;
type Code = keyof typeof TOKEN_PREFIX;
const CODES = Object.keys(TOKEN_PREFIX) as Code[];

/** The value printed most often, the smaller one on a tie; null when none is printed. Plain `<`, so the order never depends on a locale. */
function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) if (best === null || n > counts.get(best)! || (n === counts.get(best) && v < best)) best = v;
  return best;
}

/**
 * The workspace's companies a group of documents could be, as `matchCompanies` finds them for one document: those with
 * a CIN the group prints, else those sharing any printed BSE code, NSE symbol or ISIN, else those whose name, with
 * case, punctuation, a leading "the" and a trailing "limited" ignored, is the printed one. Companies come oldest first.
 */
function matchAmong(companies: CompanyRow[], group: HeldRow[], name: string | null): string[] {
  const printed = (code: Code) => new Set(group.map((r) => r[code]).filter((v): v is string => v !== null));
  const oldestFirst = [...companies].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const pick = (hit: (c: CompanyRow) => boolean) => oldestFirst.filter(hit).map((c) => c.id);

  const cins = printed("cin");
  const byCin = pick((c) => c.cin !== null && cins.has(c.cin));
  if (byCin.length) return byCin;

  const bse = printed("bseCode");
  const nse = printed("nseSymbol");
  const isin = printed("isin");
  const byCode = pick((c) => (c.bseCode !== null && bse.has(c.bseCode)) || (c.nseSymbol !== null && nse.has(c.nseSymbol)) || (c.isin !== null && isin.has(c.isin)));
  if (byCode.length) return byCode;

  if (!name) return [];
  const wanted = normalizeCompanyName(name);
  return pick((c) => normalizeCompanyName(c.displayName) === wanted);
}

/**
 * Groups the documents held for a company by the identity they print. Documents that share any identifier value (CIN,
 * BSE code, ISIN or NSE symbol) are one group, however the sharing chains. A document that prints no identifier is
 * left out: it is unsorted. The key is the group's identifiers, sorted and joined (`bse:500999|isin:INE999Z01011`);
 * the name and each code shown are the ones printed most often. `filings` counts distinct kind and period end.
 * Largest group first, then by key. Pure.
 */
export function groupHeld(rows: HeldRow[], companies: CompanyRow[]): HeldIdentity[] {
  const tokensOf = (r: HeldRow) => CODES.filter((c) => r[c] !== null).map((c) => `${TOKEN_PREFIX[c]}:${r[c]}`);
  const parent = new Map<string, string>();
  const find = (t: string): string => {
    const p = parent.get(t) ?? t;
    if (p === t) return t;
    const root = find(p);
    parent.set(t, root);
    return root;
  };
  for (const r of rows) {
    const [first, ...rest] = tokensOf(r);
    if (first === undefined) continue;
    if (!parent.has(first)) parent.set(first, first);
    for (const t of rest) {
      if (!parent.has(t)) parent.set(t, t);
      parent.set(find(t), find(first));
    }
  }

  const groups = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const first = tokensOf(r)[0];
    if (first === undefined) continue;
    const root = find(first);
    const group = groups.get(root);
    if (group) group.push(r);
    else groups.set(root, [r]);
  }

  return [...groups.values()]
    .map((group): HeldIdentity => {
      const key = [...new Set(group.flatMap(tokensOf))].sort().join("|");
      const nameAsPrinted = mostCommon(group.map((r) => r.nameAsPrinted));
      return {
        key,
        nameAsPrinted,
        cin: mostCommon(group.map((r) => r.cin)),
        bseCode: mostCommon(group.map((r) => r.bseCode)),
        isin: mostCommon(group.map((r) => r.isin)),
        nseSymbol: mostCommon(group.map((r) => r.nseSymbol)),
        files: group.length,
        filings: new Set(group.map((r) => `${r.kind}|${r.periodEnd}`)).size,
        documentIds: group.map((r) => r.documentId),
        matches: matchAmong(companies, group, nameAsPrinted),
      };
    })
    .sort((a, b) => b.files - a.files || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
