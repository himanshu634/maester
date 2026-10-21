import { z } from "zod";
import { Uuid } from "./common.js";
import { ClassificationKind, IntakeState } from "./classification.js";
import { RejectionCode } from "./document.js";
import { ExtractionState } from "./extraction.js";

export const DocumentVerifyResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("stored"), sha256: z.string().length(64), sizeBytes: z.number().int() }),
  z.object({ outcome: z.literal("rejected"), code: RejectionCode }),
]);
export type DocumentVerifyResult = z.infer<typeof DocumentVerifyResult>;

export const DocumentExtractResult = z.object({
  outcome: z.literal("extracted"),
  revisionId: Uuid,
  state: ExtractionState,
  factCount: z.number().int(),
  failedChecks: z.number().int(),
});
export type DocumentExtractResult = z.infer<typeof DocumentExtractResult>;

/**
 * An automatic `document.extract` of a results PDF that stood down before any model call, because the source rule,
 * asked again, said XBRL covers it (`skip`: the PDF is `read` with no revision) or may yet (`wait`: `waiting_for_xbrl`).
 */
export const DocumentExtractNotRead = z.object({
  outcome: z.literal("not_read"),
  plan: z.enum(["skip", "wait"]),
});
export type DocumentExtractNotRead = z.infer<typeof DocumentExtractNotRead>;

export const DocumentClassifyResult = z.object({
  outcome: z.literal("classified"),
  classificationId: Uuid,
  kind: ClassificationKind,
  intakeState: IntakeState.nullable(),
});
export type DocumentClassifyResult = z.infer<typeof DocumentClassifyResult>;

/** What `document.xbrl` wrote: the revision, its facts, its own failed checks (never `xbrl_in_pdf`) and the format read. */
export const DocumentXbrlResult = z.object({
  outcome: z.literal("read"),
  revisionId: Uuid,
  state: ExtractionState,
  factCount: z.number().int(),
  failedChecks: z.number().int(),
  format: z.string().nullable(),
  mapped: z.boolean(),
});
export type DocumentXbrlResult = z.infer<typeof DocumentXbrlResult>;

/**
 * What `document.xbrl_check` did, with the rows it wrote. `stale`: the XBRL revision or the PDF classification in its
 * key is no longer current. `disabled`: the worker's XBRL_PDF_CHECK is off. `not_mapped`: the revision has no facts.
 */
export const DocumentXbrlCheckResult = z.object({
  outcome: z.enum(["checked", "stale", "disabled", "not_mapped"]),
  rows: z.number().int(),
});
export type DocumentXbrlCheckResult = z.infer<typeof DocumentXbrlCheckResult>;
