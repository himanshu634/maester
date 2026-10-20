import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { indexPipelineVersion } from "@maester/document-index";
import { DOCUMENT_INDEX_SUBJECT, JobTypes } from "@maester/contracts";
import { closeDb, createDb, documentsNeedingIndex, schema, type Db, type JobRow } from "@maester/db";
import { createJob, maxAttemptsFor, type Dispatcher } from "@maester/jobs";
import { createDispatcher } from "./dispatch.js";
import { loadWorkerEnv, type WorkerEnv } from "./env.js";
import { createLogger, type Logger } from "./logger.js";

export interface BackfillOptions {
  workspaceId?: string;
  documentIds?: string[];
  model: string;
  dryRun?: boolean;
}

export interface BackfillCounts {
  /** Documents that had no index job: one is created. */
  created: number;
  /** Documents whose index job failed (or succeeded but left no index): queued again. */
  requeued: number;
  /** Documents whose index job is queued or running: left alone. */
  waiting: number;
  /** Documents that already have a current index: left alone. */
  current: number;
}

/** Queue the job again with a manual retry's terms (as the API's retry does), then wake the queue. */
async function requeue(db: Db, dispatcher: Dispatcher, job: JobRow): Promise<void> {
  const [updated] = await db
    .update(schema.job)
    .set({
      state: "queued",
      leaseToken: null,
      leaseExpiresAt: null,
      maxAttempts: sql`${schema.job.attempt} + ${maxAttemptsFor(job.type)}`,
      finishedAt: null,
      progress: {},
      runAfter: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.job.id, job.id))
    .returning();
  if (updated) await dispatcher.enqueue(updated);
}

/**
 * Enqueue `document.index` for every stored document with no current index, or queue its job
 * again when it failed. It only enqueues; the worker's queue loop runs the work. A document with a
 * current index (a complete or partial revision for the model) is counted and not touched.
 */
export async function backfillIndex(db: Db, dispatcher: Dispatcher, opts: BackfillOptions): Promise<BackfillCounts> {
  const pipelineVersion = indexPipelineVersion(opts.model);
  const needing = await documentsNeedingIndex(db, {
    workspaceId: opts.workspaceId,
    documentIds: opts.documentIds,
    model: opts.model,
    pipelineVersion,
  });
  const counts: BackfillCounts = { created: 0, requeued: 0, waiting: 0, current: 0 };
  for (const { documentId, workspaceId, job } of needing) {
    if (!job) {
      counts.created++;
      if (!opts.dryRun) {
        await createJob(db, dispatcher, {
          workspaceId,
          type: JobTypes.DOCUMENT_INDEX,
          subjectType: DOCUMENT_INDEX_SUBJECT,
          subjectId: documentId,
          pipelineVersion,
        });
      }
    } else if (job.state === "queued" || job.state === "running") {
      counts.waiting++;
    } else {
      counts.requeued++;
      if (!opts.dryRun) await requeue(db, dispatcher, job);
    }
  }
  counts.current = await countCurrent(db, opts, needing.length);
  return counts;
}

/** Stored non-duplicate documents in scope that the query left out: asking for a model nothing is indexed under lists them all. */
async function countCurrent(db: Db, opts: BackfillOptions, needing: number): Promise<number> {
  const all = await documentsNeedingIndex(db, { ...opts, pipelineVersion: "", model: "none" });
  return Math.max(0, all.length - needing);
}

type Out = { log: (line: string) => void; error: (line: string) => void };

/** The CLI: `index:backfill [--workspace <id>] [--document <id>]... [--dry-run]`. Returns the exit code. Prints counts only. */
export async function runIndexBackfillOnce(
  argv: string[],
  source: NodeJS.ProcessEnv = process.env,
  out: Out = console,
  make: (env: WorkerEnv) => { db: Db; dispatcher: Dispatcher; close?: () => Promise<void> } = (env) => {
    const db = createDb(env.DATABASE_URL);
    const logger: Logger = createLogger(env.LOG_LEVEL);
    return { db, dispatcher: createDispatcher(env, logger, db), close: () => closeDb(db) };
  },
): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        workspace: { type: "string" },
        document: { type: "string", multiple: true },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
    }).values;
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(source);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const { db, dispatcher, close } = make(env);
  try {
    const counts = await backfillIndex(db, dispatcher, {
      workspaceId: args.workspace,
      documentIds: args.document,
      model: env.EMBEDDING_MODEL,
      dryRun: args["dry-run"],
    });
    out.log(`${args["dry-run"] ? "dry run: " : ""}created ${counts.created}, requeued ${counts.requeued}, waiting ${counts.waiting}, current ${counts.current}`);
    return 0;
  } finally {
    await close?.();
  }
}
