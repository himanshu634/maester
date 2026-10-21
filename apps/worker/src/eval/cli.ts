import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { EvalBench, EvalRankings, EvalRequest, EvalSources } from "@maester/contracts";
import { closeDb, createDb, type Db } from "@maester/db";
import { EMBEDDING_MODELS, EmbedderError, TeiEmbedder, servesModel, type Embedder } from "@maester/document-index";
import { loadWorkerEnv, type WorkerEnv } from "../env.js";
import { benchEmbedder, benchTexts } from "./bench.js";
import { cliPath } from "./paths.js";
import { rankQuestions } from "./rank.js";
import { EvalRefusal, buildSources, sourcesLine } from "./sources.js";

type Out = { log: (line: string) => void; error: (line: string) => void };

export type EvalMake = (env: WorkerEnv) => {
  db: Db;
  /** The embedder behind `--embedder-url`, for `model`. */
  embedder: (url: string, model: string) => Embedder;
  close?: () => Promise<void>;
};

const defaultMake: EvalMake = (env) => {
  const db = createDb(env.DATABASE_URL);
  return {
    db,
    embedder: (url, model) => new TeiEmbedder(url, model, { timeoutMs: env.EMBED_TIMEOUT_SECONDS * 1000, retryOnTimeout: false }),
    close: () => closeDb(db),
  };
};

const COMMANDS = ["sources", "rank", "bench"] as const;
type Command = (typeof COMMANDS)[number];
/** The flags each command takes, besides --workspace, --request and --out. */
const FLAGS: Record<Command, string[]> = {
  sources: ["model"],
  rank: ["model", "embedder-url"],
  bench: ["model", "embedder-url", "chunks", "text-model"],
};
const USAGE = "usage: eval <sources|rank|bench> --workspace <id> --request <file> --out <file> [--model <id>] [--embedder-url <url>] [--chunks <n>] [--text-model <id>]";
const DEFAULT_BENCH_CHUNKS = 480;

function readRequest(file: string): EvalRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new EvalRefusal(`--request ${file} could not be read as JSON`);
  }
  const parsed = EvalRequest.safeParse(raw);
  // The issues are named by path only: a question's text is never printed.
  if (!parsed.success) throw new EvalRefusal(`--request is not an eval request: ${parsed.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`);
  return parsed.data;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const knownModel = (model: string): string => {
  if (!Object.hasOwn(EMBEDDING_MODELS, model)) throw new EvalRefusal(`--model ${model} is not one of: ${Object.keys(EMBEDDING_MODELS).join(", ")}`);
  return model;
};

/** Asks the embedder which model it serves, before anything is embedded or written. */
async function requireServed(embedder: Embedder, model: string): Promise<void> {
  let served: string;
  try {
    served = await embedder.servedModel();
  } catch (err) {
    if (err instanceof EmbedderError) throw new EvalRefusal(`--embedder-url did not say which model it serves (${err.code})`);
    throw err;
  }
  if (!servesModel(served, model)) throw new EvalRefusal(`--embedder-url serves ${served}, not ${model}`);
}

/**
 * The CLI: `eval <sources|rank|bench> --workspace <id> --request <file> --out <file> ...`. It measures the index
 * without reading any of its text out: it prints counts, ids, codes and seconds, and `--out` holds ids, pages and
 * timings only. A question's text is in the request file alone. Returns the exit code: 0 done, 1 refused or failed,
 * 2 when a filing the command needs has no revision of the model (`rank` still writes its sources).
 */
export async function runEval(argv: string[], source: NodeJS.ProcessEnv = process.env, out: Out = console, make: EvalMake = defaultMake): Promise<number> {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command as Command)) {
    out.error(USAGE);
    return 1;
  }
  let args;
  try {
    args = parseArgs({
      args: rest,
      options: {
        workspace: { type: "string" },
        request: { type: "string" },
        out: { type: "string" },
        model: { type: "string" },
        "embedder-url": { type: "string" },
        chunks: { type: "string" },
        "text-model": { type: "string" },
      },
      strict: true,
    }).values;
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const allowed = new Set(["workspace", "request", "out", ...FLAGS[command as Command]]);
  const stray = Object.keys(args).find((flag) => !allowed.has(flag));
  if (stray) {
    out.error(`--${stray} is not a flag of ${command}`);
    return 1;
  }
  const { workspace, request: requestPath, out: outPath } = args;
  if (!workspace || !requestPath || !outPath) {
    out.error("--workspace, --request and --out are required");
    return 1;
  }
  if (command !== "sources" && (!args.model || !args["embedder-url"])) {
    out.error(`${command} needs --model and --embedder-url`);
    return 1;
  }
  let chunkLimit = DEFAULT_BENCH_CHUNKS;
  if (args.chunks !== undefined) {
    chunkLimit = /^[0-9]+$/.test(args.chunks) ? Number(args.chunks) : 0;
    if (!Number.isSafeInteger(chunkLimit) || chunkLimit < 1) {
      out.error("--chunks must be a whole number of 1 or more");
      return 1;
    }
  }

  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(source);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const { db, embedder: makeEmbedder, close } = make(env);
  try {
    const model = knownModel(args.model ?? env.EMBEDDING_MODEL);
    const textModel = knownModel(args["text-model"] ?? env.EMBEDDING_MODEL);
    // Before the request is read, any text is embedded or --out is written: an embedder of another model would
    // rank or time the wrong one under this model's name.
    const embedder = command === "sources" ? null : makeEmbedder(args["embedder-url"]!, model);
    if (embedder) await requireServed(embedder, model);
    const request = readRequest(cliPath(requestPath, source));
    const file = cliPath(outPath, source);

    if (command === "sources") {
      const sources = EvalSources.parse(await buildSources(db, workspace, model, request));
      writeJson(file, sources);
      out.log(sourcesLine(sources));
      return 0;
    }

    if (command === "rank") {
      const { rankings, missing } = await rankQuestions(db, embedder!, workspace, request);
      writeJson(file, EvalRankings.parse(rankings));
      if (missing.length > 0) {
        out.error(`no complete or partial revision of ${model} for: ${missing.join(", ")}`);
        return 2;
      }
      out.log(`ranked ${rankings.rankings.length} questions over ${rankings.documents.length} documents`);
      return 0;
    }

    const { texts, missing } = await benchTexts(db, workspace, textModel, request, chunkLimit);
    if (missing.length > 0) {
      out.error(`no complete or partial revision of ${textModel} for: ${missing.join(", ")}`);
      return 2;
    }
    const result = await benchEmbedder(embedder!, texts, env.EMBED_BATCH, request.questions.map((q) => q.query));
    writeJson(file, EvalBench.parse({ version: 1, model, ...result }));
    out.log(`bench ${model}: ${result.chunks} chunks in ${result.seconds.toFixed(1)} s, query median ${result.queryMillisMedian.toFixed(1)} ms`);
    return 0;
  } catch (err) {
    if (err instanceof EvalRefusal) {
      out.error(err.message);
    } else if (err instanceof EmbedderError) {
      out.error(`eval ${command} stopped: the embedder failed (${err.code})`);
    } else {
      // A driver's message holds the query text and its parameters; say only what kind of error it was.
      const code = (err as { code?: unknown }).code;
      out.error(`eval ${command} stopped: ${(err as Error).name}${typeof code === "string" ? ` ${code}` : ""}`);
    }
    return 1;
  } finally {
    await close?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runEval(process.argv.slice(2)));
}
