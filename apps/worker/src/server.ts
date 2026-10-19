import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { createWorkerApp } from "./app.js";
import { createDispatcher } from "./dispatch.js";
import { dispatchModeWarning, loadWorkerEnv } from "./env.js";
import { HttpExtractorClient } from "./extractor.js";
import { handlers } from "./jobs/index.js";
import { createLogger } from "./logger.js";
import { createMarketRefresher } from "./market/build.js";
import { startMarketSchedule } from "./market/schedule.js";
import { startQueueRunner, type QueueRunner, type QueueRunnerOptions } from "./queue.js";
import type { WorkerDeps } from "./run.js";
import { buildQueueOptions, logJobBacklog, logUnhandledQueued } from "./start.js";
import { createStore } from "./store.js";

const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL);
const dispatchWarning = dispatchModeWarning();
if (dispatchWarning) logger.warn(dispatchWarning);
const db = createDb(env.DATABASE_URL);
const store = createStore(env);
const dispatcher = createDispatcher(env, logger, db);
const extractor = env.EXTRACTOR_URL
  ? new HttpExtractorClient(
      env.EXTRACTOR_URL,
      env.EXTRACTOR_AUTH === "oidc" ? { kind: "oidc" } : { kind: "secret", secret: env.EXTRACTOR_SECRET! },
      env.EXTRACT_TIMEOUT_SECONDS * 1000,
    )
  : null;
if (!extractor) logger.info("EXTRACTOR_URL is not set; documents are verified but not extracted");
const deps: WorkerDeps = { db, store, logger, env, handlers, dispatcher, extractor };

// In queue mode the worker pulls its own jobs. A bad JOB_CONCURRENCY stops start-up here, before anything runs.
let queueOptions: QueueRunnerOptions | null = null;
if (env.DISPATCH_MODE === "queue") {
  try {
    queueOptions = buildQueueOptions(env, handlers, logger);
  } catch (err) {
    logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "worker cannot start");
    process.exit(1);
  }
}
const app = createWorkerApp(deps);

let stopMarketSchedule = () => {};
if (env.CONNECTIONS_KEY) {
  stopMarketSchedule = startMarketSchedule(createMarketRefresher(env, db, logger), env.MARKET_REFRESH_MINUTES, logger);
} else {
  logger.info("CONNECTIONS_KEY is not set; market mood is not refreshed");
}

let runner: QueueRunner | null = null;
if (queueOptions) {
  // Asked before the runner starts, so the counts are close to the backlog the first claims take. Not awaited: a slow database does not hold up start.
  logJobBacklog(db, logger).catch((err: unknown) =>
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "could not count queued and running jobs"),
  );
  runner = startQueueRunner(deps, queueOptions);
  logUnhandledQueued(db, Object.keys(handlers), logger).catch((err: unknown) =>
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "could not count queued jobs with no handler"),
  );
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  logger.info({ port: info.port }, "worker listening"),
);

// Docker gives the container 30 s (stop_grace_period) before SIGKILL: 25 s for running jobs, the rest to close.
// A job still running after the grace keeps its lease until it expires; a sweep then gives it back.
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "stopping: no new jobs; waiting for running ones");
  setTimeout(() => process.exit(0), 28_000).unref();
  if (runner) await runner.stop(25_000);
  stopMarketSchedule();
  logger.info("stopped; closing the server");
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
