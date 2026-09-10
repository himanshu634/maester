import type { Document, Job, Workspace } from "@maester/contracts";
import type { DocumentRow, JobRow, WorkspaceRow } from "@maester/db";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, ownerUserId: row.ownerUserId, locale: row.locale, createdAt: row.createdAt.toISOString() };
}

export function toJob(row: JobRow): Job {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    state: row.state,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    progress: row.progress ?? {},
    result: row.result ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDocument(row: DocumentRow, latestJob: JobRow | null): Document {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    originalName: row.originalName,
    declaredSize: row.declaredSize,
    declaredMime: row.declaredMime,
    state: row.state,
    contentSha256: row.contentSha256,
    sizeBytes: row.sizeBytes,
    rejectionCode: (row.rejectionCode as Document["rejectionCode"]) ?? null,
    createdAt: row.createdAt.toISOString(),
    storedAt: iso(row.storedAt),
    latestJob: latestJob ? toJob(latestJob) : null,
  };
}
