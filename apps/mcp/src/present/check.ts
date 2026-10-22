import type { CellCheck, CellSource } from "@maester/contracts";
import { XBRL_IN_PDF_RESULT_SHOWN } from "./flags.js";

const NOT_CHECKED = "Not checked";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A cell's arithmetic check as a sentence, in the figure panel's words but without the difference: the server does not
 * work figures out, and the agent must not either. `expected` is the total as the filing prints it, `actual` what its
 * lines (or, for the balance identity, equity and liabilities) add up to; both are copied as given.
 */
export function checkSentence(check: CellCheck, source: CellSource | null): string {
  if (check.role === "none" || check.status === null) return "No sum covers this line";
  if (check.status === "not_checked") return NOT_CHECKED;
  if (check.checkType === "xbrl_in_pdf") {
    if (!XBRL_IN_PDF_RESULT_SHOWN) return NOT_CHECKED;
    return check.status === "passed" ? "Found on the results PDF's statement pages" : "Not found on the results PDF's statement pages";
  }
  const subject = (check.subjectLabel ?? "").toLowerCase();
  if (check.role === "component") return `Part of ${subject}, which ${check.status === "passed" ? "adds up" : "doesn't add up"}`;
  if (check.status === "passed") return "Adds up";
  const said = check.expected ?? "—";
  const reached = check.actual ?? "—";
  const where = source?.kind === "xbrl" ? "the XBRL file gives" : "the page prints";
  if (check.checkType === "balance_identity") {
    const name = cap((check.subjectLabel ?? "Total assets").toLowerCase());
    return `No. ${name} doesn't equal equity and liabilities: ${where} ${said}; equity and liabilities come to ${reached}.`;
  }
  return `No. The lines add up to ${reached}; ${where} ${said}.`;
}
