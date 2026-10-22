/**
 * Whether the result of the XBRL-in-PDF check (`xbrl_in_pdf`) is shown as a finding. It is off: the check is too weak
 * to show (docs/eval/2026-10-21-xbrl-map-v1.md: 46.7% of the checked facts were not found, mostly from the check's own
 * limits; a figure one unit off passes 16 to 23% of the time; zeros always pass; the sign is never compared). While
 * it is false, every presenter says "not checked" where it would say found or not found. The same switch as the
 * web's `IN_PDF_RESULT_SHOWN`.
 */
export const XBRL_IN_PDF_RESULT_SHOWN = false;
