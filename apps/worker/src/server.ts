import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { createWorkerApp } from "./app.js";
import { createDispatcher } from "./dispatch.js";
import { loadWorkerEnv } from "./env.js";
import { HttpExtractorClient } from "./extractor.js";
import { handlers } from "./jobs/index.js";
import { createLogger } from "./logger.js";
import { createStore } from "./store.js";

const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = createStore(env);
const dispatcher = createDispatcher(env, logger);
const extractor = env.EXTRACTOR_URL
  ? new HttpExtractorClient(
      env.EXTRACTOR_URL,
      env.EXTRACTOR_AUTH === "oidc" ? { kind: "oidc" } : { kind: "secret", secret: env.EXTRACTOR_SECRET! },
      env.EXTRACTOR_TIMEOUT_SECONDS * 1000,
    )
  : null;
if (!extractor) logger.info("EXTRACTOR_URL is not set; documents are verified but not extracted");
const app = createWorkerApp({ db, store, logger, env, handlers, dispatcher, extractor });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  logger.info({ port: info.port }, "worker listening"),
);

process.on("SIGTERM", () => {
  logger.info("SIGTERM received; closing");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
