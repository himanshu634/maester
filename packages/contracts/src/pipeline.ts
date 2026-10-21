import { z } from "zod";
import { Uuid } from "./common.js";
import { XbrlFormatKind } from "./xbrl.js";

/** The warnings of a read XBRL revision that the numbers track names, most serious first (the order they are listed in). */
export const XbrlReadWarning = z.enum(["XBRL_ROUNDING_MISSING", "XBRL_ROUNDING_MISMATCH", "XBRL_ELEMENT_UNMAPPED", "XBRL_NIL"]);
export type XbrlReadWarning = z.infer<typeof XbrlReadWarning>;

/**
 * Where one document stands on each of its three tracks, worked out on every read from what is stored: nothing here is
 * kept. `numbers` says which source the figures come from and why a document has none; `text` says how far the index is.
 */
export const DocumentPipeline = z.strictObject({
  stored: z.enum(["done", "now", "failed"]),
  /** `not_needed`: a rejected file or a duplicate, which is never identified. */
  identified: z.enum(["done", "now", "needs_you", "failed", "waiting", "not_needed"]),
  numbers: z.strictObject({
    source: z.enum(["xbrl", "pdf"]).nullable(),
    state: z.enum(["done", "now", "not_needed", "failed", "waiting", "not_read"]),
    /** The XBRL documents that give a PDF its numbers (`not_needed`), or part of them (`done`). */
    coveredByXbrl: z.array(Uuid),
    /** The XBRL documents a PDF waits on (`waiting` for `waiting_for_xbrl`). */
    waitingOn: z.array(Uuid),
    reason: z.enum(["format_unmapped", "not_a_read_kind", "duplicate", "waiting_for_xbrl", "not_identified", "needs_you"]).nullable(),
    /** The kind of an instance Maester reads but has no map for, with `format_unmapped`. */
    format: XbrlFormatKind.nullable(),
    /** An XBRL read that is `done` and whose revision is `partial`: some lines were left out. False for a PDF and for any other state. */
    partial: z.boolean(),
    /** The warnings of the current revision of an XBRL read that is `done`, most serious first; `[]` for a PDF and for any other state. */
    warnings: z.array(XbrlReadWarning),
  }),
  text: z.strictObject({
    /** `not_needed`: a rejected file or a duplicate, which is never indexed. */
    state: z.enum(["done", "now", "partial", "failed", "waiting", "not_needed"]),
    pages: z.number().int().min(0),
    pagesRead: z.number().int().min(0),
    pagesOcr: z.number().int().min(0),
    chunks: z.number().int().min(0),
    /** The distinct XBRL text blocks (elements) among the chunks. */
    xbrlBlocks: z.number().int().min(0),
    /** Index jobs queued before this document's, or null when its job is not queued. */
    ahead: z.number().int().min(0).nullable(),
  }),
});
export type DocumentPipeline = z.infer<typeof DocumentPipeline>;
