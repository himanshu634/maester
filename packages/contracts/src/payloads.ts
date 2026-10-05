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

export const DocumentClassifyResult = z.object({
  outcome: z.literal("classified"),
  classificationId: Uuid,
  kind: ClassificationKind,
  intakeState: IntakeState.nullable(),
});
export type DocumentClassifyResult = z.infer<typeof DocumentClassifyResult>;
