import { serve } from "@hono/node-server";
import { createDb } from "@maester/db";
import { GcsObjectStore } from "@maester/storage";
import { createWorkerApp } from "./app.js";
import { loadWorkerEnv } from "./env.js";
import { handlers } from "./jobs/index.js";
import { createLogger } from "./logger.js";

const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL);
const db = createDb(env.DATABASE_URL);
const store = new GcsObjectStore(env.GCS_BUCKET);
const app = createWorkerApp({ db, store, logger, env, handlers });

serve({ fetch: app.fetch, port: env.PORT }, (info) => logger.info({ port: info.port }, "worker listening"));
