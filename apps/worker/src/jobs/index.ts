import { JobTypes } from "@maester/contracts";
import { documentExtract } from "./document-extract.js";
import { documentVerify } from "./document-verify.js";
import type { JobHandler } from "./types.js";

export const handlers: Record<string, JobHandler> = {
  [JobTypes.DOCUMENT_VERIFY]: documentVerify,
  [JobTypes.DOCUMENT_EXTRACT]: documentExtract,
};
