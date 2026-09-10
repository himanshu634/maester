import { JobTypes } from "@maester/contracts";
import { documentVerify } from "./document-verify.js";
import type { JobHandler } from "./types.js";

export const handlers: Record<string, JobHandler> = {
  [JobTypes.DOCUMENT_VERIFY]: documentVerify,
};
