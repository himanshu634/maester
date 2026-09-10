import { sql } from "drizzle-orm";
import { createDb, type Db } from "../src/client.js";
import { runMigrations } from "../src/migrate.js";
import * as schema from "../src/schema/index.js";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgres://maester:maester@localhost:5433/maester_test";

export async function testDb(): Promise<Db> {
  const db = createDb(TEST_DATABASE_URL);
  await runMigrations(db);
  await truncateAll(db);
  return db;
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "job", "document", "membership", "workspace", "session", "account", "verification", "user" CASCADE`);
}

export async function insertUser(db: Db, id: string, email: string) {
  await db.insert(schema.user).values({ id, name: "Test " + id, email });
}
