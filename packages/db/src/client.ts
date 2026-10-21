import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

export type CreateDbOptions = {
  /** Every transaction on the pool is read-only: a write fails with Postgres code 25006. For a reader that must never write. */
  readOnly?: boolean;
  /** Most connections the pool holds; 10 when not given. */
  max?: number;
};

export function createDb(connectionString: string, opts: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ...(opts.readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
  });
  return drizzle(pool, { schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
