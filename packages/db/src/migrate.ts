import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_FOLDER = resolve(here, "../drizzle");

export async function runMigrations(db: Db, folder = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
