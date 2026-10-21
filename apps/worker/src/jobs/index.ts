import { JobTypes } from "@maester/contracts";
import { documentClassify } from "./document-classify.js";
import { documentExtract } from "./document-extract.js";
import { documentIndex } from "./document-index.js";
import { documentVerify } from "./document-verify.js";
import { documentXbrlCheck } from "./document-xbrl-check.js";
import { documentXbrl } from "./document-xbrl.js";
import type { JobHandler } from "./types.js";

export const handlers: Record<string, JobHandler> = {
  [JobTypes.DOCUMENT_VERIFY]: documentVerify,
  [JobTypes.DOCUMENT_CLASSIFY]: documentClassify,
  [JobTypes.DOCUMENT_EXTRACT]: documentExtract,
  [JobTypes.DOCUMENT_INDEX]: documentIndex,
  [JobTypes.DOCUMENT_XBRL]: documentXbrl,
  [JobTypes.DOCUMENT_XBRL_CHECK]: documentXbrlCheck,
};
