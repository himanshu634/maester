import { loadEnv, type Env } from "../src/env.js";

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? "postgres://maester:maester@localhost:5433/maester_test",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    BETTER_AUTH_URL: "http://localhost",
    ALLOWED_ORIGINS: "http://localhost,http://localhost:5173",
    GCS_BUCKET: "test-bucket",
    GOOGLE_CLOUD_PROJECT: "test-project",
    DISPATCH_MODE: "local",
    WORKER_URL: "http://localhost:8788",
    DISPATCH_SECRET: "local-dispatch-secret",
    ...overrides,
  });
}
