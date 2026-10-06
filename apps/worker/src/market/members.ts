import { readFileSync } from "node:fs";

/** Splits one CSV line, honouring double quotes ("" inside quotes is a quote). */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/**
 * The Nifty 500 members: the `Symbol` column of the constituents CSV downloaded by hand from
 * niftyindices.com (see apps/worker/data/README.md). An empty list when the file is not there.
 */
export function readMembers(path: string | URL): string[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a byte-order mark
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift();
  if (!header) return [];
  const col = fields(header).findIndex((h) => h.toLowerCase() === "symbol");
  if (col < 0) throw new Error("the Nifty 500 list has no Symbol column");
  const symbols = lines.map((l) => fields(l)[col] ?? "").filter((s) => s !== "");
  return [...new Set(symbols)];
}
