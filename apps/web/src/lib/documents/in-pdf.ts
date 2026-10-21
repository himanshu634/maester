/**
 * Whether the web shows the result of the XBRL-in-PDF check (`xbrl_in_pdf`): how many of an XBRL
 * file's figures were found on the PDF's statement pages, and the pages they were found on.
 *
 * It is off. The check is too weak to show as a finding (docs/eval/2026-10-21-xbrl-map-v1.md): 46.7%
 * of the checked facts were not found, mostly from the check's own limits; a figure one unit off
 * passes 16 to 23% of the time; zeros always pass; the sign is never compared. Until the check has
 * a version whose decoy pass rate is under the gate in that report, every screen says "Not checked"
 * where it would say found or not found. Turn it on by setting this to `true`; the found and
 * not-found words stay in the code and the copy. The API keeps sending the counts unchanged.
 */
export const IN_PDF_RESULT_SHOWN = false;
