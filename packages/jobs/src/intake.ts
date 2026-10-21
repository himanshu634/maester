import { and, eq, sql } from "drizzle-orm";
import { JobTypes, XBRL_CHECK_SUBJECT, XBRL_PDF_CHECK_VERSION, type IntakeState } from "@maester/contracts";
import {
  companyIdentity, getCurrentClassification, loadWorkspaceXbrlDocs, schema, type ClassificationRow, type Db, type JobRow,
} from "@maester/db";
import { planPdfNumbers, type Basis, type CompanyIdentity, type PdfNumbersInput, type Statement } from "@maester/financial-engine";
import { createJob, maxAttemptsFor } from "./create.js";
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

const NO_IDENTITY: CompanyIdentity = { cin: null, bseCode: null, nseSymbol: null, isin: null };

/**
 * A classification as the source rule sees a results PDF: the one place a classification becomes a `PdfNumbersInput`,
 * for intake's decision and for the pipeline the API shows. Null when it is no results PDF, or has no company to match
 * XBRL by. `identity` is the company's codes (`companyIdentity`); without them the PDF matches by company id alone.
 */
export function pdfNumbersInput(c: ClassificationRow, identity: CompanyIdentity | undefined): PdfNumbersInput | null {
  if (c.kind !== "financial_results" || !c.companyId) return null;
  return {
    companyId: c.companyId,
    companyIdentity: identity ?? NO_IDENTITY,
    kind: "financial_results",
    periodEnd: c.periodEnd,
    // Validated against the contract when written: the statement kinds and bases the engine names.
    statementsFound: c.statementsFound.map((s) => ({ statement: s.statement as Statement, basis: s.basis as Basis })),
  };
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
 * A read job that `document.extract` stood down (`recheckPdfRead` said skip or wait when it ran) owns the read's key,
 * so `createJob` hands it back finished when intake decides to read under the same classification again (the XBRL that
 * held the PDF failed, or was confirmed for another company). Queue it again, with its type's attempts, in the
 * decision's transaction; any other job is returned as it is.
 */
async function rerunStoodDownRead(t: Db, job: JobRow): Promise<JobRow> {
  if (job.type !== JobTypes.DOCUMENT_EXTRACT || job.state !== "succeeded") return job;
  const [again] = await t
    .update(schema.job)
    .set({
      state: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
      maxAttempts: sql`${schema.job.attempt} + ${maxAttemptsFor(job.type)}`,
      result: null,
      finishedAt: null,
      progress: {},
      runAfter: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(schema.job.id, job.id),
        eq(schema.job.workspaceId, job.workspaceId),
        eq(schema.job.state, "succeeded"),
        sql`${schema.job.result}->>'outcome' = 'not_read'`,
      ),
    )
    .returning();
  return again ?? job;
}

/**
 * Before `document.extract` makes a paid read of a results PDF, the source rule again, under the locks `decideIntake`
 * takes (the document row, then the XBRL-wait lock): XBRL that arrived after the decision to read may now cover the
 * PDF, or be still settling. `skip` writes `read` (no revision), `wait` writes `waiting_for_xbrl`; a release that runs
 * later decides it again. Acts only on a PDF whose current answers are `financial_results` with a company and read
 * under `classificationId`. Null: go on with the read.
 */
export async function recheckPdfRead(db: Db, workspaceId: string, documentId: string, classificationId: string): Promise<"skip" | "wait" | null> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const where = and(eq(schema.document.id, documentId), eq(schema.document.workspaceId, workspaceId));
    const [locked] = await tx.select({ format: schema.document.format }).from(schema.document).where(where).for("update");
    if (locked?.format !== "pdf") return null;
    const c = await getCurrentClassification(t, workspaceId, documentId);
    if (!c || c.readsUnderId !== classificationId || c.kind !== "financial_results" || !c.companyId) return null;
    await lockXbrlWait(t, workspaceId);
    const pdf = pdfNumbersInput(c, await companyIdentity(t, workspaceId, c.companyId));
    if (!pdf) return null;
    const plan = planPdfNumbers(pdf, await loadWorkspaceXbrlDocs(t, workspaceId, { companyIds: [c.companyId] }));
    if (plan.action === "read") return null;
    await tx
      .update(schema.document)
      .set({ intakeState: plan.action === "skip" ? "read" : "waiting_for_xbrl", updatedAt: sql`now()` })
      .where(where);
    return plan.action;
  });
}

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
  const pdf = pdfNumbersInput(c, await companyIdentity(t, c.workspaceId, c.companyId));
  if (!pdf) return read;
  // Only XBRL of this company, or of none yet, can wait for or cover this PDF.
  const plan = planPdfNumbers(pdf, await loadWorkspaceXbrlDocs(t, c.workspaceId, { companyIds: [c.companyId] }));
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
    const created = decision.jobType
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
    const job = created ? await rerunStoodDownRead(t, created) : null;
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
 * The `document.xbrl_check` job's version: both sides of the pair, so a new PDF classification or a new XBRL
 * revision (new fact ids) gets its own job, and a retry of the same pair gets the old one.
 */
export const xbrlCheckVersion = (pdfClassificationId: string, xbrlRevisionId: string): string =>
  `v${XBRL_PDF_CHECK_VERSION}:pdf-${pdfClassificationId}:xbrl-${xbrlRevisionId}`;

/** The check version, PDF classification and XBRL revision a `document.xbrl_check` job's key names; null for another key. */
export function xbrlCheckKeyOf(idempotencyKey: string): { version: number; pdfClassificationId: string; xbrlRevisionId: string } | null {
  const match = /:v(\d+):pdf-([0-9a-f-]{36}):xbrl-([0-9a-f-]{36})$/.exec(idempotencyKey);
  return match ? { version: Number.parseInt(match[1]!, 10), pdfClassificationId: match[2]!, xbrlRevisionId: match[3]! } : null;
}

/**
 * Create the `document.xbrl_check` jobs that pair XBRL documents with results PDFs of the same company and
 * period end, from one side. An XBRL document pairs when its current revision (the newest read under its current
 * classification's `reads_under_id`) was read from XBRL and has at least one fact; a PDF pairs when it is stored,
 * not a duplicate, and its current classification is `financial_results`. Company and period end are the current
 * classifications', both known. It always enqueues: the job itself answers `disabled` when the worker's
 * XBRL_PDF_CHECK is off. Returns how many jobs it created (an existing pair's job is not dispatched again).
 */
export async function enqueueXbrlPdfChecks(
  db: Db,
  dispatcher: Dispatcher,
  workspaceId: string,
  by: { xbrlDocumentId: string } | { pdfDocumentId: string },
): Promise<number> {
  const side = "xbrlDocumentId" in by ? sql`x.id = ${by.xbrlDocumentId}` : sql`p.id = ${by.pdfDocumentId}`;
  const { rows } = await db.execute<{ xbrl_document_id: string; xbrl_revision_id: string; pdf_classification_id: string }>(sql`
    select x.id as xbrl_document_id, xr.id as xbrl_revision_id, pc.id as pdf_classification_id
    from document x
    join lateral (
      select dc.company_id, dc.period_end, dc.reads_under_id from document_classification dc
      where dc.workspace_id = x.workspace_id and dc.document_id = x.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) xc on xc.reads_under_id is not null and xc.company_id is not null and xc.period_end is not null
    join lateral (
      select r.id, r.source from extraction_revision r
      where r.workspace_id = x.workspace_id and r.classification_id = xc.reads_under_id
      order by r.created_at desc, r.id desc
      limit 1
    ) xr on xr.source = 'xbrl'
    join document p on p.workspace_id = x.workspace_id and p.format = 'pdf' and p.state = 'stored'
      and p.duplicate_of_document_id is null and p.intake_state is distinct from 'duplicate'
    join lateral (
      select dc.id, dc.kind, dc.company_id, dc.period_end from document_classification dc
      where dc.workspace_id = p.workspace_id and dc.document_id = p.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) pc on pc.kind = 'financial_results' and pc.company_id = xc.company_id and pc.period_end = xc.period_end
    where x.workspace_id = ${workspaceId}
      and x.format = 'xbrl'
      and x.state = 'stored'
      and x.duplicate_of_document_id is null
      and x.intake_state is distinct from 'duplicate'
      and exists (select 1 from financial_fact f where f.workspace_id = x.workspace_id and f.revision_id = xr.id)
      and ${side}
    order by x.created_at, x.id, p.created_at, p.id`);

  // createJob dispatches only the jobs it inserts, so counting dispatches counts the jobs created.
  let created = 0;
  const counting: Dispatcher = {
    enqueue: async (job) => {
      created++;
      await dispatcher.enqueue(job);
    },
  };
  for (const r of rows) {
    await createJob(db, counting, {
      workspaceId,
      type: JobTypes.DOCUMENT_XBRL_CHECK,
      subjectType: XBRL_CHECK_SUBJECT,
      subjectId: r.xbrl_document_id,
      pipelineVersion: xbrlCheckVersion(r.pdf_classification_id, r.xbrl_revision_id),
    });
  }
  return created;
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
