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
  return parsed.data;
}
