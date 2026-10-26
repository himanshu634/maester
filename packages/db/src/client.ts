import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { parse } from "pg-connection-string";
import * as schema from "./schema/index.js";

export type Db = ReturnType<typeof createDb>;

export type CreateDbOptions = {
  /** Every transaction on the pool is read-only: a write fails with Postgres code 25006. For a reader that must never write. */
  readOnly?: boolean;
  /** Most connections the pool holds; 10 when not given. */
  max?: number;
};

const READ_ONLY = "-c default_transaction_read_only=on";

/**
 * The pool's settings. A read-only pool keeps any `?options=` the URL carries and adds the read-only setting after
 * them, so the URL can neither drop it nor turn it off (Postgres takes the last `-c` for a setting). pg itself lets the
 * URL's `options` replace an explicit one, so the URL is parsed here, as pg would parse it, and passed without it.
 */
export function poolConfig(connectionString: string, opts: CreateDbOptions = {}): pg.PoolConfig {
  const max = opts.max ?? 10;
  if (!opts.readOnly) return { connectionString, max };
  const { options, ...parsed } = parse(connectionString);
  const merged = typeof options === "string" && options.trim() !== "" ? `${options} ${READ_ONLY}` : READ_ONLY;
  return { ...(parsed as pg.PoolConfig), options: merged, max };
}

export function createDb(connectionString: string, opts: CreateDbOptions = {}) {
  const pool = new pg.Pool(poolConfig(connectionString, opts));
  return drizzle(pool, { schema });
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end();
}
