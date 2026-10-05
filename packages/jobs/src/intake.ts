import { and, eq, sql } from "drizzle-orm";
import { JobTypes, type IntakeState } from "@maester/contracts";
import { getCurrentClassification, schema, type ClassificationRow, type Db } from "@maester/db";
import { createJob } from "./create.js";
import type { Dispatcher } from "./dispatch.js";

export const READ_KINDS: ReadonlySet<string> = new Set(["annual_report", "financial_results"]);

/** The read job's version names the classification it reads under, so each answer set reads once. */
export const readVersion = (classificationId: string): string => `classification-${classificationId}`;

export function classificationIdOfReadJob(idempotencyKey: string): string | null {
  const match = /:classification-([0-9a-f-]{36})$/.exec(idempotencyKey);
  return match ? match[1]! : null;
}

/** Inserts the job row only; the caller dispatches it once the transaction has committed. */
const HOLD: Dispatcher = { enqueue: async () => {} };

export interface DecideOptions {
  /** Start a read for a read kind with a company; false keeps the state (only the period or span changed). */
  read: boolean;
  /** Act only when the document is in one of these states, so a retry never moves it backwards. */
  onlyFrom?: IntakeState[];
}

/**
 * Turn a classification into the document's next step: read it, hold it for the
 * investor or keep it. Applied only while `c` is the document's current
 * classification: under a lock on the document row, so a newer answer written
 * meanwhile wins. The company, the state and the read job are written in one
 * transaction; the read is dispatched after it commits, so a fast read can never
 * be overwritten by "reading" and never runs ahead of its own row.
 * Returns the state written, or null when nothing changed.
 */
export async function decideIntake(db: Db, dispatcher: Dispatcher, c: ClassificationRow, opts: DecideOptions): Promise<IntakeState | null> {
  let state: IntakeState | null;
  if (c.kind === "not_sure") state = "needs_kind";
  else if (c.kind === "other") state = "kept";
  else if (!c.companyId) state = "needs_company";
  else state = opts.read ? "reading" : null;

  const decided = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const where = and(eq(schema.document.id, c.documentId), eq(schema.document.workspaceId, c.workspaceId));
    const [locked] = await tx.select({ intakeState: schema.document.intakeState }).from(schema.document).where(where).for("update");
    if (!locked) return null;
    if ((await getCurrentClassification(t, c.workspaceId, c.documentId))?.id !== c.id) return null;
    if (opts.onlyFrom && (locked.intakeState === null || !opts.onlyFrom.includes(locked.intakeState))) return null;

    await tx
      .update(schema.document)
      .set({ companyId: c.companyId, ...(state ? { intakeState: state } : {}), updatedAt: sql`now()` })
      .where(where);
    const job =
      state === "reading"
        ? await createJob(t, HOLD, {
            workspaceId: c.workspaceId,
            type: JobTypes.DOCUMENT_EXTRACT,
            subjectType: "document",
            subjectId: c.documentId,
            pipelineVersion: readVersion(c.id),
          })
        : null;
    return { job };
  });
  if (!decided) return null;
  // Dispatching a job that already existed is harmless: the worker acks a finished job.
  if (decided.job) await dispatcher.enqueue(decided.job);
  return state;
}
