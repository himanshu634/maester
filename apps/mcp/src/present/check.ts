import type { CellCheck } from "@maester/contracts";
import { XBRL_IN_PDF_RESULT_SHOWN } from "./flags.js";
import { unitWords, type Unit } from "./words.js";

const NOT_CHECKED = "Not checked";
/** Every arithmetic check the reader writes as not checked lacks a line it needs, or that line's value. */
const ARITHMETIC_NOT_CHECKED = "Not checked: a line the sum needs was not found or has no value";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A figure's arithmetic check as a sentence, in the figure panel's words but without the difference: the server does not
 * work figures out, and the agent must not either. `expected` is the total as the filing gives it, `actual` what its
 * lines (or, for the balance identity, equity and liabilities) add up to; both are copied as given, in `unit`, which the
 * sentence names. `source` is where the figure was read: a page of a PDF or an XBRL file.
 */
export function checkSentence(check: CellCheck, source: "page" | "xbrl" | null, unit: Unit): string {
  if (check.role === "none" || check.status === null) return "No sum covers this line";
  if (check.checkType === "xbrl_in_pdf") {
    if (!XBRL_IN_PDF_RESULT_SHOWN || check.status === "not_checked") return NOT_CHECKED;
    return check.status === "passed" ? "Found on the results PDF's statement pages" : "Not found on the results PDF's statement pages";
  }
  if (check.status === "not_checked") {
    return check.role === "component" ? `Part of ${(check.subjectLabel ?? "").toLowerCase()}, which is not checked: a line its sum needs was not found or has no value` : ARITHMETIC_NOT_CHECKED;
  }
  const subject = (check.subjectLabel ?? "").toLowerCase();
  if (check.role === "component") return `Part of ${subject}, which ${check.status === "passed" ? "adds up" : "doesn't add up"}`;
  if (check.status === "passed") return "Adds up";
  const said = check.expected ?? "—";
  const reached = check.actual ?? "—";
  const where = source === "xbrl" ? "the XBRL file gives" : "the page prints";
  const inUnit = ` Both figures are in ${unitWords(unit)}.`;
  if (check.checkType === "balance_identity") {
    const name = cap((check.subjectLabel ?? "Total assets").toLowerCase());
    return `No. ${name} doesn't equal equity and liabilities: ${where} ${said}; equity and liabilities come to ${reached}.${inUnit}`;
  }
  return `No. The lines add up to ${reached}; ${where} ${said}.${inUnit}`;
}
