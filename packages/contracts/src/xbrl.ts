import { z } from "zod";

/** Version of the `xbrl_in_pdf` check. It is in the check job's key and on each row, so a corrected check writes a new set. */
export const XBRL_PDF_CHECK_VERSION = 1;

/** The taxonomy family of an instance: SEBI's `in-capmkt` or BSE's `in-bse-fin`. */
export const XbrlFormatFamily = z.enum(["in-capmkt", "in-bse-fin"]);
export type XbrlFormatFamily = z.infer<typeof XbrlFormatFamily>;

/** What an instance reports: Ind AS, banking, NBFC or "other than Ind AS" results, or a shape Maester cannot tell. */
export const XbrlFormatKind = z.enum(["ind_as", "banking", "nbfc", "other_than_ind_as", "unknown"]);
export type XbrlFormatKind = z.infer<typeof XbrlFormatKind>;

/** The format of one instance. `id` is `<family>/<kind>`; `mapped` is true when an element map reads this format. */
export const XbrlFormat = z.object({
  family: XbrlFormatFamily.nullable(),
  kind: XbrlFormatKind,
  id: z.string().nullable(),
  mapped: z.boolean(),
});
export type XbrlFormat = z.infer<typeof XbrlFormat>;

/**
 * Why the numbers of an XBRL instance were not looked for in a PDF. `no_unit`: the instance declares no rounding, so a
 * monetary value has no scale to look for.
 */
export const XbrlPdfNotChecked = z.enum(["no_pdf", "scanned", "no_statement_pages", "disabled", "no_value", "no_unit", "not_yet"]);
export type XbrlPdfNotChecked = z.infer<typeof XbrlPdfNotChecked>;
