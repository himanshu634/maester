import { z } from "zod";
import { Classification, ClassificationSummary, Evidence, IntakeState } from "./classification.js";
import { IsoTimestamp, Uuid } from "./common.js";
import { Job } from "./job.js";
import { DocumentPipeline } from "./pipeline.js";

export const DocumentState = z.enum(["pending_upload", "uploaded", "verifying", "stored", "rejected"]);
export type DocumentState = z.infer<typeof DocumentState>;

/** What a stored file is: a PDF, or an XBRL instance (XML). */
export const DocumentFormat = z.enum(["pdf", "xbrl"]);
export type DocumentFormat = z.infer<typeof DocumentFormat>;

/** The types an upload may declare: a PDF, or an XBRL instance, which is XML. */
export const UploadMimeType = z.enum(["application/pdf", "application/xml", "text/xml"]);
export type UploadMimeType = z.infer<typeof UploadMimeType>;

/** The format a declared type stands for. The worker still checks the bytes. */
export function formatForMime(mime: UploadMimeType): DocumentFormat {
  return mime === "application/pdf" ? "pdf" : "xbrl";
}

/** `UNSUPPORTED_TYPE`: the file is neither a PDF nor an XBRL instance Maester can read. */
export const RejectionCode = z.enum(["UNSUPPORTED_TYPE", "TOO_LARGE", "OBJECT_MISSING"]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const Document = z.object({
  id: Uuid,
  workspaceId: Uuid,
  companyId: Uuid.nullable(),
  originalName: z.string(),
  declaredSize: z.number().int(),
  declaredMime: z.string(),
  format: DocumentFormat,
  state: DocumentState,
  contentSha256: z.string().length(64).nullable(),
  sizeBytes: z.number().int().nullable(),
  rejectionCode: RejectionCode.nullable(),
  intakeState: IntakeState.nullable(),
  duplicateOfDocumentId: Uuid.nullable(),
  classification: ClassificationSummary.nullable(),
  createdAt: IsoTimestamp,
  storedAt: IsoTimestamp.nullable(),
  latestJob: Job.nullable(),
  pipeline: DocumentPipeline,
});
export type Document = z.infer<typeof Document>;

export const CreateUploadRequest = z.object({
  companyId: Uuid.optional(),
  originalName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: UploadMimeType,
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export const CreateUploadResponse = z.object({
  document: Document,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: IsoTimestamp,
  }),
});
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const FinalizeResponse = z.object({ document: Document, job: Job });
export type FinalizeResponse = z.infer<typeof FinalizeResponse>;

export const DownloadResponse = z.object({ url: z.string(), expiresAt: IsoTimestamp });
export type DownloadResponse = z.infer<typeof DownloadResponse>;

export const ClassificationChanged = z.object({ document: Document, classification: Classification, evidence: z.array(Evidence) });
export type ClassificationChanged = z.infer<typeof ClassificationChanged>;
