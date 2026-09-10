import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { GcsObjectStore } from "@maester/storage";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = new GcsObjectStore(env.GCS_BUCKET);

const app = createApp({ env, logger, db, store, auth: null, dispatcher: null });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});
