import type { GoldContract } from "./sources.js";
import { MCX_GOLD_NAME } from "./instruments.js";

/** One scrip master row, keyed by the CSV column names (SEM_EXM_EXCH_ID, SEM_SEGMENT, ...). */
export type ScripRow = Record<string, string>;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseScripMaster(csv: string): ScripRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitLine(lines[0] ?? "").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: ScripRow = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

/** NSE cash equity, EQ series: trading symbol → security id. */
export function equityIdsFrom(rows: ScripRow[]): Map<string, string> {
  const ids = new Map<string, string>();
  for (const r of rows) {
    if (r.SEM_EXM_EXCH_ID === "NSE" && r.SEM_SEGMENT === "E" && r.SEM_INSTRUMENT_NAME === "EQUITY" && r.SEM_SERIES === "EQ" && r.SEM_TRADING_SYMBOL && r.SEM_SMST_SECURITY_ID) {
      ids.set(r.SEM_TRADING_SYMBOL, r.SEM_SMST_SECURITY_ID);
    }
  }
  return ids;
}

/** Unexpired MCX GOLD futures (a contract is live through its expiry day), earliest expiry first. */
export function goldContractsFrom(rows: ScripRow[], today: string): GoldContract[] {
  return rows
    .filter((r) => r.SEM_EXM_EXCH_ID === "MCX" && r.SEM_SEGMENT === "M" && r.SEM_INSTRUMENT_NAME === "FUTCOM" && r.SM_SYMBOL_NAME === MCX_GOLD_NAME && r.SEM_SMST_SECURITY_ID)
    .map((r) => ({ securityId: r.SEM_SMST_SECURITY_ID!, exchangeSegment: "MCX_COMM", instrument: "FUTCOM", expiry: (r.SEM_EXPIRY_DATE ?? "").slice(0, 10) }))
    .filter((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.expiry) && c.expiry >= today)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** The earliest unexpired GOLD futures contract, or undefined when the master lists none. */
export function nearMonthGold(rows: ScripRow[], today: string): GoldContract | undefined {
  return goldContractsFrom(rows, today)[0];
}
