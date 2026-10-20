import { z } from "zod";
import { EMBEDDING_MODELS } from "@maester/document-index";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8788),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["gcs", "disk"]).default("gcs"),
  STORAGE_DIR: z.string().default("data/blobs"),
  GCS_BUCKET: z.string().min(1).optional(),
  // "local" is the old name of queue: an existing .env may still say it. It is read as queue, so no code sees "local".
  DISPATCH_MODE: z.preprocess((v) => (v === "local" ? "queue" : v), z.enum(["queue", "cloud-tasks"]).default("queue")),
  WORKER_URL: z.url(),
  API_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  LEASE_SECONDS: z.coerce.number().int().default(600),
  // Milliseconds between timer renewals of a running job's lease.
  JOB_HEARTBEAT_MS: z.coerce.number().int().positive().default(15000),
  // Jobs of one type run at once, over the defaults in queue.ts: "document.extract=3,document.verify=8".
  JOB_CONCURRENCY: z.string().optional(),
  // Milliseconds an idle claim loop waits before asking again when no job_ready notification comes.
  JOB_POLL_MS: z.coerce.number().int().positive().default(1000),
  // Milliseconds between sweeps that give back jobs whose lease ran out.
  JOB_SWEEP_MS: z.coerce.number().int().positive().default(30000),
  // Extraction (apps/extractor). Unset EXTRACTOR_URL disables chaining document.extract after verify.
  EXTRACTOR_URL: z.url().optional(),
  EXTRACTOR_AUTH: z.enum(["secret", "oidc"]).default("secret"),
  EXTRACTOR_SECRET: z.string().optional(),
  // Seconds one extraction request may take, with its whole stream. Thirty minutes: a long annual report takes that.
  EXTRACT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  EXTRACT_MAX_BYTES: z.coerce.number().int().positive().default(52428800),
  // Indexing (apps/indexer, the embedder). Unset INDEXER_URL or EMBEDDER_URL: document.index fails INDEXER_NOT_CONFIGURED.
  INDEXER_URL: z.url().optional(),
  INDEXER_SECRET: z.string().optional(),
  EMBEDDER_URL: z.url().optional(),
  EMBEDDING_MODEL: z
    .string()
    .default("Snowflake/snowflake-arctic-embed-l-v2.0")
    .refine((v) => Object.hasOwn(EMBEDDING_MODELS, v), `EMBEDDING_MODEL must be one of: ${Object.keys(EMBEDDING_MODELS).join(", ")}`),
  // Pages read in one call to the indexer.
  INDEX_PAGE_RANGE: z.coerce.number().int().positive().default(20),
  // Seconds the whole document.index job may take.
  INDEX_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(7200),
  // Chunks embedded in one call to the embedder: at most the embedder's --max-client-batch-size (32 in docker-compose.yml).
  EMBED_BATCH: z.coerce.number().int().positive().max(32, "EMBED_BATCH must be at most 32, the embedder's --max-client-batch-size").default(16),
  // Seconds one call to the embedder may take. A call that times out is not sent again within the job's attempt:
  // the embedder keeps working on it, so a second call would only queue behind it.
  EMBED_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  // Pages one document may send to OCR.
  OCR_PAGE_BUDGET: z.coerce.number().int().min(0).default(400),
  // Needed only to enqueue follow-up jobs through Cloud Tasks.
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default("asia-south1"),
  CLOUD_TASKS_QUEUE: z.string().default("maester-jobs"),
  WORKER_INVOKER_SA: z.string().optional(),
  TASK_DISPATCH_DEADLINE_SECONDS: z.coerce.number().int().positive().default(1800),
  // 32 bytes, base64. Encrypts saved market data keys. Unset: the Settings routes answer INVALID_STATE and the refresher is off.
  CONNECTIONS_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || (/^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32), "CONNECTIONS_KEY must be 32 bytes, base64"),
  // Market mood: Dhan Data API calls per second (the limit is 5), and minutes between refreshes.
  DHAN_REQUESTS_PER_SECOND: z.coerce.number().positive().max(5).default(4),
  MARKET_REFRESH_MINUTES: z.coerce.number().int().positive().default(30),
});
export type WorkerEnv = z.infer<typeof Schema>;

/** The warning to log at start when the environment still says DISPATCH_MODE=local, the old name of queue; otherwise null. */
export function dispatchModeWarning(source: NodeJS.ProcessEnv = process.env): string | null {
  return source.DISPATCH_MODE === "local" ? "DISPATCH_MODE=local is now queue; update .env" : null;
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.STORAGE_DRIVER === "gcs" && !parsed.data.GCS_BUCKET) throw new Error("GCS_BUCKET required when STORAGE_DRIVER=gcs");
  if (parsed.data.STORAGE_DRIVER === "disk" && parsed.data.NODE_ENV === "production")
    throw new Error("STORAGE_DRIVER=disk is a local development driver and is refused in production");
  // A renewal that comes later than the lease lets a sweep hand a running job to another worker.
  if (parsed.data.JOB_HEARTBEAT_MS * 2 > parsed.data.LEASE_SECONDS * 1000)
    throw new Error("JOB_HEARTBEAT_MS must be at most half of LEASE_SECONDS, so one missed renewal does not lose the lease");
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.API_SERVICE_ACCOUNT_EMAIL) throw new Error("API_SERVICE_ACCOUNT_EMAIL required when DISPATCH_MODE=cloud-tasks");
  if (parsed.data.EXTRACTOR_URL) {
    if (parsed.data.EXTRACTOR_AUTH === "secret" && !parsed.data.EXTRACTOR_SECRET) throw new Error("EXTRACTOR_SECRET required when EXTRACTOR_AUTH=secret");
    if (parsed.data.DISPATCH_MODE === "cloud-tasks" && (!parsed.data.GOOGLE_CLOUD_PROJECT || !parsed.data.WORKER_INVOKER_SA))
      throw new Error("GOOGLE_CLOUD_PROJECT and WORKER_INVOKER_SA required to enqueue extraction when DISPATCH_MODE=cloud-tasks");
  }
  if (parsed.data.INDEXER_URL && !parsed.data.INDEXER_SECRET) throw new Error("INDEXER_SECRET required when INDEXER_URL is set");
  return parsed.data;
}
