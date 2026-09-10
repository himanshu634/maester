import { sql } from "drizzle-orm";
import { closeDb, createDb, runMigrations, schema, type Db } from "@maester/db";
import { MemoryObjectStore } from "@maester/storage";
import { loadWorkerEnv } from "../src/env.js";
import { silentLogger } from "../src/logger.js";
import type { JobHandler } from "../src/jobs/types.js";
import type { WorkerDeps } from "../src/run.js";

export function workerTestEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return loadWorkerEnv({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL_TEST_WORKER ?? "postgres://maester:maester@localhost:5433/maester_test_worker",
    GCS_BUCKET: "test-bucket",
    DISPATCH_MODE: "local",
    DISPATCH_SECRET: "local-dispatch-secret",
    WORKER_URL: "http://localhost:8788",
    LEASE_SECONDS: "600",
    ...overrides,
  });
}

export async function createWorkerContext(handlers: Record<string, JobHandler> = {}) {
  const env = workerTestEnv();
  const db = createDb(env.DATABASE_URL);
  await runMigrations(db);
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
  const store = new MemoryObjectStore();
  const deps: WorkerDeps = { db, store, logger: silentLogger, env, handlers };
  return { ...deps, close: () => closeDb(db) };
}

export async function seedWorkspace(db: Db) {
  const userId = "u-" + crypto.randomUUID();
  await db.insert(schema.user).values({ id: userId, name: "W", email: `${userId}@example.com` });
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: "W", ownerUserId: userId });
  return { userId, workspaceId };
}

export async function seedJob(db: Db, workspaceId: string, overrides: Partial<typeof schema.job.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.job).values({
    id, workspaceId, type: "test.noop", subjectType: "test", subjectId: crypto.randomUUID(),
    idempotencyKey: `k-${id}`, state: "queued", ...overrides,
  });
  return id;
}
