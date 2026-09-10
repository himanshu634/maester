import { z } from "zod";
import { RejectionCode } from "./document.js";

export const DocumentVerifyResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("stored"), sha256: z.string().length(64), sizeBytes: z.number().int() }),
  z.object({ outcome: z.literal("rejected"), code: RejectionCode }),
]);
export type DocumentVerifyResult = z.infer<typeof DocumentVerifyResult>;
