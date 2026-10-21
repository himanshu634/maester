import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inArray } from "drizzle-orm";
import { DOCUMENT_INDEX_SUBJECT, EvalRequest, JobTypes } from "@maester/contracts";
import { closeDb, createDb, documentsNeedingIndex, schema, type Db, type JobRow } from "@maester/db";
import {
  EMBEDDING_MODELS, EmbedderError, INDEX_PIPELINE_VERSION, TeiEmbedder, indexPipelineVersion, servesModel, type Embedder,
} from "@maester/document-index";
import { createJob, QueueNotifier, type Dispatcher } from "@maester/jobs";
import type { ObjectStore } from "@maester/storage";
import { loadWorkerEnv, type WorkerEnv } from "./env.js";
import { cliPath } from "./eval/paths.js";
import { resolveEvalDocuments } from "./eval/resolve.js";
import { requeue } from "./index-backfill.js";
import { HttpIndexerClient, type IndexerClient } from "./indexer.js";
import { documentIndex } from "./jobs/document-index.js";
import { JobFailure } from "./jobs/types.js";
import { createLogger } from "./logger.js";
import { startQueueRunner, type QueueRunner } from "./queue.js";
import { createStore } from "./store.js";

const DEFAULT_EMBEDDER_URL = "http://embedder-candidate";
const DEFAULT_INDEXER_URL = "http://indexer-candidate:8791";
/** Milliseconds the runner's stop waits for a running job before giving its lease back, as the worker's own stop does. */
const STOP_GRACE_MS = 25_000;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

type Out = { log: (line: string) => void; error: (line: string) => void };

export type CandidateMake = (env: WorkerEnv) => {
  db: Db;
  store: ObjectStore;
  dispatcher: Dispatcher;
  indexer: IndexerClient;
  embedder: Embedder;
  startRunner?: typeof startQueueRunner;
  close?: () => Promise<void>;
};

/**
 * The candidate's own clients. The dispatcher only wakes queue runners, never Cloud Tasks: an eval job sent to the
 * live worker would fail there as a type it has no handler for. This command's runner claims its jobs by polling.
 */
const defaultMake: CandidateMake = (env) => {
  const db = createDb(env.DATABASE_URL);
  return {
    db,
    store: createStore(env),
    dispatcher: new QueueNotifier(db),
    indexer: new HttpIndexerClient(env.INDEXER_URL!, env.INDEXER_SECRET!, env.EMBEDDING_MODEL),
    embedder: new TeiEmbedder(env.EMBEDDER_URL!, env.EMBEDDING_MODEL, { timeoutMs: env.EMBED_TIMEOUT_SECONDS * 1000, retryOnTimeout: false }),
    close: () => closeDb(db),
  };
};

/** A refusal the command prints as it is: it names flags, models, codes and filing ids, never document text. */
class Refusal extends Error {}

function readRequest(file: string): EvalRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Refusal(`--request ${file} could not be read as JSON`);
  }
  const parsed = EvalRequest.safeParse(raw);
  // The issues are named by path only: a question's text is never printed.
  if (!parsed.success) throw new Refusal(`--request is not an eval request: ${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
  return parsed.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The CLI: `index:candidate --workspace <id> --model <id> --request <file> [--embedder-url <url>] [--indexer-url <url>]`.
 * Builds a candidate model's index for the request's documents, beside the live one: `document.index.eval` jobs,
 * which the live worker has no handler for, run here by a queue runner of their own with the candidate's indexer and
 * embedder and no extractor, so nothing calls a paid model. Prints counts and codes only. Returns the exit code: 0
 * only when every job succeeded.
 */
export async function runIndexCandidate(
  argv: string[],
  source: NodeJS.ProcessEnv = process.env,
  out: Out = console,
  make: CandidateMake = defaultMake,
  opts: { pollMs?: number } = {},
): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        workspace: { type: "string" },
        model: { type: "string" },
        request: { type: "string" },
        "embedder-url": { type: "string", default: DEFAULT_EMBEDDER_URL },
        "indexer-url": { type: "string", default: DEFAULT_INDEXER_URL },
      },
      strict: true,
    }).values;
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const { workspace, model, request: requestPath } = args;
  if (!workspace || !model || !requestPath) {
    out.error("--workspace, --model and --request are required");
    return 1;
  }

  let live: WorkerEnv;
  let env: WorkerEnv;
  let request: EvalRequest;
  try {
    live = loadWorkerEnv(source);
    if (!Object.hasOwn(EMBEDDING_MODELS, model)) {
      throw new Refusal(`--model ${model} is not one of: ${Object.keys(EMBEDDING_MODELS).join(", ")}`);
    }
    if (model === live.EMBEDDING_MODEL) throw new Refusal("--model is the live EMBEDDING_MODEL; the worker indexes it");
    request = readRequest(cliPath(requestPath, source));
    env = loadWorkerEnv({ ...source, EMBEDDING_MODEL: model, INDEXER_URL: args["indexer-url"], EMBEDDER_URL: args["embedder-url"] });
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }

  const { db, store, dispatcher, indexer, embedder, startRunner = startQueueRunner, close } = make(env);
  let runner: QueueRunner | null = null;
  try {
    // Before any job is made: an embedder or an indexer of another model would build a revision under the wrong name.
    let served: string;
    try {
      served = await embedder.servedModel();
    } catch (err) {
      if (err instanceof EmbedderError) throw new Refusal(`--embedder-url did not say which model it serves (${err.code})`);
      throw err;
    }
    if (!servesModel(served, model)) throw new Refusal(`--embedder-url serves ${served}, not ${model}`);
    let tokenizer: string;
    try {
      tokenizer = (await indexer.versions()).tokenizer;
    } catch (err) {
      if (err instanceof JobFailure) throw new Refusal(`--indexer-url did not answer its versions (${err.code})`);
      throw err;
    }
    if (tokenizer !== model) throw new Refusal(`--indexer-url loaded the tokenizer of ${tokenizer}, not ${model}`);

    const docs = await resolveEvalDocuments(db, workspace, model, request.documents);
    const missing = docs.filter((d) => d.documentId === null).map((d) => d.filing);
    if (missing.length) throw new Refusal(`not stored in the workspace: ${missing.join(", ")}`);
    // Two filings of one file (a duplicate upload) resolve to one document, and get one job.
    const documentIds = [...new Set(docs.map((d) => d.documentId!))];

    const pipelineVersion = indexPipelineVersion(model);
    const jobIds: string[] = [];
    for (const documentId of documentIds) {
      const job: JobRow = await createJob(db, dispatcher, {
        workspaceId: workspace,
        type: JobTypes.DOCUMENT_INDEX_EVAL,
        subjectType: DOCUMENT_INDEX_SUBJECT,
        subjectId: documentId,
        pipelineVersion,
      });
      jobIds.push(job.id);
      // A job that failed, or that succeeded but whose revision was pruned since, runs again so a later
      // measurement can rebuild. documentsNeedingIndex's own job field matches document.index keys only.
      const rebuild =
        job.state === "failed" ||
        (job.state === "succeeded" &&
          (await documentsNeedingIndex(db, { workspaceId: workspace, documentIds: [documentId], model, pipelineVersion, indexVersion: INDEX_PIPELINE_VERSION })).length > 0);
      if (rebuild) await requeue(db, dispatcher, job);
    }

    runner = startRunner(
      {
        db, store, logger: createLogger(env.LOG_LEVEL), env, dispatcher,
        handlers: { [JobTypes.DOCUMENT_INDEX_EVAL]: documentIndex },
        extractor: null, indexer, embedder,
      },
      {
        concurrency: { [JobTypes.DOCUMENT_INDEX_EVAL]: 1 },
        pollMs: env.JOB_POLL_MS,
        sweepMs: env.JOB_SWEEP_MS,
        // No wake-ups: the runner's own poll finds the jobs, and a finished job wakes it for the next.
        listen: async () => async () => {},
      },
    );

    let rows: Pick<JobRow, "state" | "lastErrorCode">[];
    for (;;) {
      rows = await db
        .select({ state: schema.job.state, lastErrorCode: schema.job.lastErrorCode })
        .from(schema.job)
        .where(inArray(schema.job.id, jobIds));
      if (rows.every((r) => TERMINAL.has(r.state))) break;
      await sleep(opts.pollMs ?? 5_000);
    }

    const failed = rows.filter((r) => r.state !== "succeeded");
    const codes = new Map<string, number>();
    for (const r of failed) codes.set(r.lastErrorCode ?? r.state, (codes.get(r.lastErrorCode ?? r.state) ?? 0) + 1);
    const detail = failed.length ? ` (${[...codes].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => `${c}: ${n}`).join(", ")})` : "";
    out.log(`indexed ${rows.length - failed.length}, failed ${failed.length}${detail}`);
    return failed.length === 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof Refusal) {
      out.error(err.message);
    } else {
      // A driver's message holds the query text and its parameters; say only what kind of error it was.
      const code = (err as { code?: unknown }).code;
      out.error(`index:candidate stopped: ${(err as Error).name}${typeof code === "string" ? ` ${code}` : ""}`);
    }
    return 1;
  } finally {
    if (runner) await runner.stop(STOP_GRACE_MS);
    await close?.();
  }
}
