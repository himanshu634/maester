import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { GcsObjectStore } from "@maester/storage";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { createDispatcher } from "./dispatch/index.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = new GcsObjectStore(env.GCS_BUCKET);
const auth = createAuth({ db, env });
const dispatcher = createDispatcher(env, logger);

const app = createApp({ env, logger, db, store, auth, dispatcher });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received; closing");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
