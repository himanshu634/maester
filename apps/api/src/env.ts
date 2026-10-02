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
  DISPATCH_MODE: z.enum(["local", "cloud-tasks"]).default("local"),
  WORKER_URL: z.url(),
  DISPATCH_SECRET: z.string().optional(),
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
});

export type Env = z.infer<typeof EnvSchema>;

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
  if (parsed.data.DISPATCH_MODE === "local" && !parsed.data.DISPATCH_SECRET) {
    throw new Error("invalid environment: DISPATCH_SECRET is required when DISPATCH_MODE=local");
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
  return parsed.data;
}
