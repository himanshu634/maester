import { and, eq, sql } from "drizzle-orm";
import { JobTypes, type IntakeState } from "@maester/contracts";
import {
  companyIdentity, getCurrentClassification, loadWorkspaceXbrlDocs, schema, type ClassificationRow, type Db,
} from "@maester/db";
import { planPdfNumbers, type Basis, type FilingKind, type Statement } from "@maester/financial-engine";
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

/**
 * Serialises, per workspace, a PDF's decision to wait for XBRL against the release that follows an XBRL
 * document settling: whichever runs second sees what the first committed, so no PDF is left waiting.
 * Always taken after the document's row lock, never before one.
 */
async function lockXbrlWait(db: Db, workspaceId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('xbrl-wait:' || ${workspaceId}::text))`);
}

export interface DecideOptions {
  /** Start a read for a read kind with a company; false keeps the state (only the period or span changed). */
  read: boolean;
  /** Act only when the document is in one of these states (`waiting_for_xbrl` and `read` included), so a retry never moves it backwards. */
  onlyFrom?: IntakeState[];
  /** False: a results PDF whose plan is to wait for XBRL is left as it is. Default true. */
  allowWait?: boolean;
}

type Decision = { state: IntakeState | null; jobType: string | null };

/**
 * A read kind with a company. An XBRL instance is read by `document.xbrl`. A PDF follows the source rule:
 * it waits for XBRL that may yet cover it, is not read when XBRL covers every statement it prints (`read`,
 * no job), and is read by `document.extract` otherwise. Runs inside the decision's transaction: a results
 * PDF takes the workspace's XBRL-wait lock before it reads the XBRL documents, so read-committed shows it
 * every XBRL state committed before the lock was granted. Null: change nothing.
 */
async function readDecision(t: Db, c: ClassificationRow & { companyId: string }, format: "pdf" | "xbrl", allowWait: boolean): Promise<Decision | null> {
  if (format === "xbrl") return { state: "reading", jobType: JobTypes.DOCUMENT_XBRL };
  const read: Decision = { state: "reading", jobType: JobTypes.DOCUMENT_EXTRACT };
  // An annual report is never skipped or held, so it needs no XBRL documents.
  if (c.kind !== "financial_results") return read;
  await lockXbrlWait(t, c.workspaceId);
  const plan = planPdfNumbers(
    {
      companyId: c.companyId,
      companyIdentity: await companyIdentity(t, c.workspaceId, c.companyId),
      kind: c.kind as FilingKind,
      periodEnd: c.periodEnd,
      // Validated against the contract when written: the statement kinds and bases the engine names.
      statementsFound: c.statementsFound.map((s) => ({ statement: s.statement as Statement, basis: s.basis as Basis })),
    },
    await loadWorkspaceXbrlDocs(t, c.workspaceId),
  );
  if (plan.action === "wait") return allowWait ? { state: "waiting_for_xbrl", jobType: null } : null;
  if (plan.action === "skip") return { state: "read", jobType: null };
  return read;
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
  const decided = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const where = and(eq(schema.document.id, c.documentId), eq(schema.document.workspaceId, c.workspaceId));
    const [locked] = await tx
      .select({ intakeState: schema.document.intakeState, format: schema.document.format })
      .from(schema.document)
      .where(where)
      .for("update");
    if (!locked) return null;
    if ((await getCurrentClassification(t, c.workspaceId, c.documentId))?.id !== c.id) return null;
    if (opts.onlyFrom && (locked.intakeState === null || !opts.onlyFrom.includes(locked.intakeState))) return null;

    let decision: Decision | null;
    if (c.kind === "not_sure") decision = { state: "needs_kind", jobType: null };
    else if (c.kind === "other") decision = { state: "kept", jobType: null };
    else if (!c.companyId) decision = { state: "needs_company", jobType: null };
    else if (!opts.read) decision = { state: null, jobType: null };
    else decision = await readDecision(t, { ...c, companyId: c.companyId }, locked.format, opts.allowWait ?? true);
    if (!decision) return null;

    await tx
      .update(schema.document)
      .set({ companyId: c.companyId, ...(decision.state ? { intakeState: decision.state } : {}), updatedAt: sql`now()` })
      .where(where);
    const job = decision.jobType
      ? await createJob(t, HOLD, {
          workspaceId: c.workspaceId,
          type: decision.jobType,
          subjectType: "document",
          subjectId: c.documentId,
          // The classification the read is for. It is `c` itself whenever `c` asked for a read; an investor's
          // period-only change keeps the earlier one, and a PDF released from waiting is read under that.
          pipelineVersion: readVersion(c.readsUnderId ?? c.id),
        })
      : null;
    return { state: decision.state, job, format: locked.format };
  });
  if (!decided) return null;
  // Dispatching a job that already existed is harmless: the worker acks a finished job.
  if (decided.job) await dispatcher.enqueue(decided.job);
  if (decided.format === "pdf" && c.kind === "financial_results") {
    await enqueueXbrlPdfChecks(db, dispatcher, c.workspaceId, { pdfDocumentId: c.documentId });
  }
  return decided.state;
}

/**
 * Create the `document.xbrl_check` jobs that pair XBRL documents with results PDFs of the same company and
 * period, from one side. Returns how many it created. Task 13 writes the body; until then it creates none.
 */
export async function enqueueXbrlPdfChecks(
  _db: Db,
  _dispatcher: Dispatcher,
  _workspaceId: string,
  _by: { xbrlDocumentId: string } | { pdfDocumentId: string },
): Promise<number> {
  return 0;
}

/**
 * Decide again, after an XBRL document has settled (stored, rejected, kept or failed), every PDF of the
 * workspace that waits for XBRL, and every PDF that XBRL covered (`read` with no revision under its current
 * read), so an XBRL confirmed for another company sends it back to Gemini. The list is taken under the
 * XBRL-wait lock, so a decision to wait still in flight commits first and is listed. Each PDF then gets its
 * own decision, which takes the lock itself; no transaction is nested. A covered PDF acts only on a `read`
 * plan, so a finished PDF never goes back to waiting while a folder imports. Returns how many changed state.
 */
export async function redecidePdfsAfterXbrl(db: Db, dispatcher: Dispatcher, workspaceId: string): Promise<number> {
  const listed = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await lockXbrlWait(t, workspaceId);
    const { rows } = await t.execute<{ id: string; intake_state: "waiting_for_xbrl" | "read" }>(sql`
      select d.id, d.intake_state::text as intake_state
      from document d
      left join lateral (
        select dc.reads_under_id from document_classification dc
        where dc.workspace_id = d.workspace_id and dc.document_id = d.id
        order by dc.created_at desc, dc.id desc
        limit 1
      ) c on true
      where d.workspace_id = ${workspaceId}
        and d.format = 'pdf'
        and (
          d.intake_state = 'waiting_for_xbrl'
          or (
            d.intake_state = 'read'
            and c.reads_under_id is not null
            and not exists (
              select 1 from extraction_revision r
              where r.workspace_id = d.workspace_id and r.classification_id = c.reads_under_id
            )
          )
        )
      order by d.created_at, d.id`);
    return rows;
  });

  let changed = 0;
  for (const { id, intake_state: from } of listed) {
    const current = await getCurrentClassification(db, workspaceId, id);
    if (!current) continue;
    const opts: DecideOptions =
      from === "waiting_for_xbrl" ? { read: true, onlyFrom: ["waiting_for_xbrl"] } : { read: true, onlyFrom: ["read"], allowWait: false };
    const state = await decideIntake(db, dispatcher, current, opts);
    if (state !== null && state !== from) changed++;
  }
  return changed;
}
