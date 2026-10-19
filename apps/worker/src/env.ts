import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8788),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(["gcs", "disk"]).default("gcs"),
  STORAGE_DIR: z.string().default("data/blobs"),
  GCS_BUCKET: z.string().min(1).optional(),
  DISPATCH_MODE: z.enum(["local", "cloud-tasks"]).default("local"),
  DISPATCH_SECRET: z.string().optional(),
  WORKER_URL: z.url(),
  API_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  LEASE_SECONDS: z.coerce.number().int().default(600),
  // Milliseconds between timer renewals of a running job's lease.
  JOB_HEARTBEAT_MS: z.coerce.number().int().positive().default(15000),
  // Extraction (apps/extractor). Unset EXTRACTOR_URL disables chaining document.extract after verify.
  EXTRACTOR_URL: z.url().optional(),
  EXTRACTOR_AUTH: z.enum(["secret", "oidc"]).default("secret"),
  EXTRACTOR_SECRET: z.string().optional(),
  EXTRACTOR_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  EXTRACT_MAX_BYTES: z.coerce.number().int().positive().default(52428800),
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

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = Schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.STORAGE_DRIVER === "gcs" && !parsed.data.GCS_BUCKET) throw new Error("GCS_BUCKET required when STORAGE_DRIVER=gcs");
  if (parsed.data.STORAGE_DRIVER === "disk" && parsed.data.NODE_ENV === "production")
    throw new Error("STORAGE_DRIVER=disk is a local development driver and is refused in production");
  if (parsed.data.DISPATCH_MODE === "local" && !parsed.data.DISPATCH_SECRET) throw new Error("DISPATCH_SECRET required when DISPATCH_MODE=local");
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.API_SERVICE_ACCOUNT_EMAIL) throw new Error("API_SERVICE_ACCOUNT_EMAIL required when DISPATCH_MODE=cloud-tasks");
  if (parsed.data.EXTRACTOR_URL) {
    if (parsed.data.EXTRACTOR_AUTH === "secret" && !parsed.data.EXTRACTOR_SECRET) throw new Error("EXTRACTOR_SECRET required when EXTRACTOR_AUTH=secret");
    if (parsed.data.DISPATCH_MODE === "cloud-tasks" && (!parsed.data.GOOGLE_CLOUD_PROJECT || !parsed.data.WORKER_INVOKER_SA))
      throw new Error("GOOGLE_CLOUD_PROJECT and WORKER_INVOKER_SA required to enqueue extraction when DISPATCH_MODE=cloud-tasks");
  }
  return parsed.data;
}
