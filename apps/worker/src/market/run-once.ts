import { createDb, latestMarketFetch, type Db } from "@maester/db";
import { dispatchModeWarning, loadWorkerEnv, type WorkerEnv } from "../env.js";
import { createLogger, type Logger } from "../logger.js";
import { createMarketRefresher } from "./build.js";

type Out = { log: (line: string) => void; error: (line: string) => void };

/** One refresh pass by hand. Returns the exit code: 0 for ok or skipped, 1 for failed or misconfigured. Prints no secret. */
export async function runMarketRefreshOnce(
  source: NodeJS.ProcessEnv = process.env,
  out: Out = console,
  make: (env: WorkerEnv) => { db: Db; logger: Logger } = (env) => ({
    db: createDb(env.DATABASE_URL),
    logger: createLogger(env.LOG_LEVEL),
  }),
): Promise<number> {
  let env: WorkerEnv;
  try {
    env = loadWorkerEnv(source);
  } catch (err) {
    out.error((err as Error).message);
    return 1;
  }
  const dispatchWarning = dispatchModeWarning(source);
  if (dispatchWarning) out.error(dispatchWarning);
  if (!env.CONNECTIONS_KEY) {
    out.error("CONNECTIONS_KEY is not set");
    return 1;
  }
  const { db, logger } = make(env);
  const outcome = await createMarketRefresher(env, db, logger).refresh();
  if (outcome === "skipped") {
    out.log("skipped: another market refresh is already running");
    return 0;
  }
  const run = await latestMarketFetch(db);
  if (!run) {
    out.error("failed: the run was not recorded");
    return 1;
  }
  out.log(`${run.state}${run.errorCode ? ` ${run.errorCode}` : ""}, ${run.pointsWritten} points written`);
  return run.state === "failed" ? 1 : 0;
}
