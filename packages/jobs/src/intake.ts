import { and, eq, sql } from "drizzle-orm";
import { JobTypes, type IntakeState } from "@maester/contracts";
import { schema, type ClassificationRow, type Db } from "@maester/db";
import { createJob } from "./create.js";
import type { Dispatcher } from "./dispatch.js";

export const READ_KINDS: ReadonlySet<string> = new Set(["annual_report", "financial_results"]);

/** The read job's version names the classification it reads under, so each answer set reads once. */
export const readVersion = (classificationId: string): string => `classification-${classificationId}`;

export function classificationIdOfReadJob(idempotencyKey: string): string | null {
  const match = /:classification-([0-9a-f-]{36})$/.exec(idempotencyKey);
  return match ? match[1]! : null;
}

/**
 * Turn a classification into the document's next step: read it, hold it for the
 * investor or keep it. The state is written before the read is enqueued, so a
 * fast read can never be overwritten by "reading". With `read: false` a read
 * kind with a company keeps whatever state it had (only the period or span changed).
 */
export async function decideIntake(db: Db, dispatcher: Dispatcher, c: ClassificationRow, opts: { read: boolean }): Promise<IntakeState | null> {
  let state: IntakeState | null;
  if (c.kind === "not_sure") state = "needs_kind";
  else if (c.kind === "other") state = "kept";
  else if (!c.companyId) state = "needs_company";
  else state = opts.read ? "reading" : null;

  await db
    .update(schema.document)
    .set({ companyId: c.companyId, ...(state ? { intakeState: state } : {}), updatedAt: sql`now()` })
    .where(and(eq(schema.document.id, c.documentId), eq(schema.document.workspaceId, c.workspaceId)));

  if (state === "reading") {
    await createJob(db, dispatcher, {
      workspaceId: c.workspaceId,
      type: JobTypes.DOCUMENT_EXTRACT,
      subjectType: "document",
      subjectId: c.documentId,
      pipelineVersion: readVersion(c.id),
    });
  }
  return state;
}
