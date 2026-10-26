import { parseArgs } from "node:util";
import { closeDb, createDb, deleteModelRevisions, type Db } from "@maester/db";
import { loadWorkerEnv, type WorkerEnv } from "./env.js";

type Out = { log: (line: string) => void; error: (line: string) => void };

/**
 * The CLI: `index:prune --model <id> [--workspace <id>] [--dry-run]`. Deletes a candidate model's revisions, with
 * their pages, chunks and embeddings; the cached page reads stay. It refuses the live EMBEDDING_MODEL. Prints counts
 * only. Returns the exit code.
 */
export async function runIndexPrune(
  argv: string[],
  source: NodeJS.ProcessEnv = process.env,
  out: Out = console,
  make: (env: WorkerEnv) => { db: Db; close?: () => Promise<void> } = (env) => {
    const db = createDb(env.DATABASE_URL);
    return { db, close: () => closeDb(db) };
  },
): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { model: { type: "string" }, workspace: { type: "string" }, "dry-run": { type: "boolean", default: false } },
      strict: true,
    }).values;
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  if (!args.model) {
    out.error("--model is required");
    return 1;
  }
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(source);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  if (args.model === env.EMBEDDING_MODEL) {
    out.error("--model is the live EMBEDDING_MODEL; pruning it would empty search");
    return 1;
  }
  const { db, close } = make(env);
  try {
    const dryRun = args["dry-run"];
    const n = await deleteModelRevisions(db, { model: args.model, workspaceId: args.workspace, dryRun });
    out.log(`${dryRun ? "dry run: " : ""}revisions ${n.revisions}, chunks ${n.chunks}`);
    return 0;
  } catch {
    // The driver's message holds the query text; say only that it failed.
    out.error("index prune failed: the database could not be read or written");
    return 1;
  } finally {
    await close?.();
  }
}
