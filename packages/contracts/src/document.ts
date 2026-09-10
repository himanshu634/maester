import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";
import { Job } from "./job.js";

export const DocumentState = z.enum(["pending_upload", "uploaded", "verifying", "stored", "rejected"]);
export type DocumentState = z.infer<typeof DocumentState>;

export const RejectionCode = z.enum(["NOT_A_PDF", "TOO_LARGE", "OBJECT_MISSING"]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const Document = z.object({
  id: Uuid,
  workspaceId: Uuid,
  originalName: z.string(),
  declaredSize: z.number().int(),
  declaredMime: z.string(),
  state: DocumentState,
  contentSha256: z.string().length(64).nullable(),
  sizeBytes: z.number().int().nullable(),
  rejectionCode: RejectionCode.nullable(),
  createdAt: IsoTimestamp,
  storedAt: IsoTimestamp.nullable(),
  latestJob: Job.nullable(),
});
export type Document = z.infer<typeof Document>;

export const CreateUploadRequest = z.object({
  originalName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.literal("application/pdf"),
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
