import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";

export const JobTypes = {
  DOCUMENT_VERIFY: "document.verify",
  DOCUMENT_CLASSIFY: "document.classify",
  DOCUMENT_EXTRACT: "document.extract",
  DOCUMENT_INDEX: "document.index",
  DOCUMENT_XBRL: "document.xbrl",
  DOCUMENT_XBRL_CHECK: "document.xbrl_check",
} as const;
/** The job subject type for `document.index`; the subject id is the document id. */
export const DOCUMENT_INDEX_SUBJECT = "document_index";
/** The job subject type for `document.xbrl_check`; the subject id is the XBRL document id. */
export const XBRL_CHECK_SUBJECT = "xbrl_pdf_check";
export type JobType = (typeof JobTypes)[keyof typeof JobTypes];

export const JobState = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobState = z.infer<typeof JobState>;

export const JobProgress = z.object({
  stage: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgress>;

export const Job = z.object({
  id: Uuid,
  workspaceId: Uuid,
  type: z.string(),
  subjectType: z.string(),
  subjectId: Uuid,
  state: JobState,
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  progress: JobProgress,
  result: z.unknown().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: IsoTimestamp,
  startedAt: IsoTimestamp.nullable(),
  finishedAt: IsoTimestamp.nullable(),
  updatedAt: IsoTimestamp,
});
export type Job = z.infer<typeof Job>;
