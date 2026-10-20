import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  STORAGE_DRIVER: z.enum(["gcs", "disk"]).default("gcs"),
  STORAGE_DIR: z.string().default("data/blobs"),
  GCS_BUCKET: z.string().min(1).optional(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),
  GOOGLE_CLOUD_LOCATION: z.string().default("asia-south1"),
  // "local" is the old name of queue: an existing .env may still say it. It is read as queue, so no code sees "local".
  DISPATCH_MODE: z.preprocess((v) => (v === "local" ? "queue" : v), z.enum(["queue", "cloud-tasks"]).default("queue")),
  WORKER_URL: z.url(),
  CLOUD_TASKS_QUEUE: z.string().default("maester-jobs"),
  WORKER_INVOKER_SA: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(300),
  // Google sign-in. An empty string (docker compose passes one when unset) means unset.
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => v || undefined),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => v || undefined),
  // The auth rate limiter runs in production; "on" turns it on elsewhere (its own test does).
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("off"),
  // Proxy addresses or CIDR ranges to skip when reading X-Forwarded-For from the right.
  TRUSTED_PROXIES: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  // Confirmation and reset mail. "console" logs the message; "resend" sends it.
  MAIL_DRIVER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  MAIL_FROM: z.string().optional().transform((v) => v || undefined),
  // The text embedder (TEI) that turns a search query into a vector. Unset: search answers SEARCH_UNAVAILABLE.
  EMBEDDER_URL: z.string().optional().transform((v) => v || undefined).pipe(z.url().optional()),
  EMBEDDING_MODEL: z.string().default("Snowflake/snowflake-arctic-embed-l-v2.0"),
  // 32 bytes, base64. Encrypts saved market data keys. Unset: the Settings routes answer INVALID_STATE and the refresher is off.
  CONNECTIONS_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || (/^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32), "CONNECTIONS_KEY must be 32 bytes, base64"),
});

export type Env = z.infer<typeof EnvSchema>;

/** The warning to log at start when the environment still says DISPATCH_MODE=local, the old name of queue; otherwise null. */
export function dispatchModeWarning(source: NodeJS.ProcessEnv = process.env): string | null {
  return source.DISPATCH_MODE === "local" ? "DISPATCH_MODE=local is now queue; update .env" : null;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  if (parsed.data.STORAGE_DRIVER === "gcs" && !parsed.data.GCS_BUCKET) {
    throw new Error("invalid environment: GCS_BUCKET is required when STORAGE_DRIVER=gcs");
  }
  if (parsed.data.STORAGE_DRIVER === "disk" && parsed.data.NODE_ENV === "production") {
    throw new Error("invalid environment: STORAGE_DRIVER=disk is a local development driver and is refused in production");
  }
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.WORKER_INVOKER_SA) {
    throw new Error("invalid environment: WORKER_INVOKER_SA is required when DISPATCH_MODE=cloud-tasks");
  }
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.GOOGLE_CLOUD_PROJECT) {
    throw new Error("invalid environment: GOOGLE_CLOUD_PROJECT is required when DISPATCH_MODE=cloud-tasks");
  }
  if (Boolean(parsed.data.GOOGLE_CLIENT_ID) !== Boolean(parsed.data.GOOGLE_CLIENT_SECRET)) {
    throw new Error("invalid environment: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together");
  }
  if (parsed.data.NODE_ENV === "production" && !parsed.data.GOOGLE_CLIENT_ID) {
    throw new Error("invalid environment: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.TRUSTED_PROXIES.length === 0) {
    throw new Error("invalid environment: TRUSTED_PROXIES is required in production (the rate limiter cannot tell clients apart without it)");
  }
  if (parsed.data.MAIL_DRIVER === "console" && parsed.data.NODE_ENV === "production") {
    throw new Error("invalid environment: MAIL_DRIVER=console only logs mail and is refused in production");
  }
  if (parsed.data.MAIL_DRIVER === "resend" && (!parsed.data.RESEND_API_KEY || !parsed.data.MAIL_FROM)) {
    throw new Error("invalid environment: RESEND_API_KEY and MAIL_FROM are required when MAIL_DRIVER=resend");
  }
  return parsed.data;
}
