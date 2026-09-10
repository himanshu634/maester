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
  GCS_BUCKET: z.string().min(1),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().default("asia-south1"),
  DISPATCH_MODE: z.enum(["local", "cloud-tasks"]).default("local"),
  WORKER_URL: z.url(),
  DISPATCH_SECRET: z.string().optional(),
  CLOUD_TASKS_QUEUE: z.string().default("maester-jobs"),
  WORKER_INVOKER_SA: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().default(52428800),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(900),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(300),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  if (parsed.data.DISPATCH_MODE === "local" && !parsed.data.DISPATCH_SECRET) {
    throw new Error("invalid environment: DISPATCH_SECRET is required when DISPATCH_MODE=local");
  }
  if (parsed.data.DISPATCH_MODE === "cloud-tasks" && !parsed.data.WORKER_INVOKER_SA) {
    throw new Error("invalid environment: WORKER_INVOKER_SA is required when DISPATCH_MODE=cloud-tasks");
  }
  return parsed.data;
}
