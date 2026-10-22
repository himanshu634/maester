import type { Db } from "@maester/db";
import type { Logger } from "./logger.js";
import { SettingsError } from "./settings.js";

/**
 * Refuses to serve unless the database says the session is read-only. `createDb` asks for it on every connection; this
 * is the check that it held (a pooler that drops startup options, say). A miss names DATABASE_URL, the setting to fix.
 */
export async function assertReadOnly(db: Db): Promise<void> {
  const res = await db.$client.query<{ default_transaction_read_only: string }>("SHOW default_transaction_read_only");
  if (res.rows[0]?.default_transaction_read_only !== "on") {
    throw new SettingsError("DATABASE_URL", "the database session is not read-only, so the server will not start; connect to Postgres directly, not through a pooler that drops startup options");
  }
}

/**
 * Keeps a lost idle connection (a Postgres restart, say) from ending the process: pg emits it on the pool, and with no
 * listener Node throws it. The pool drops that client; the next tool call connects again or answers UNAVAILABLE. Only the
 * SQLSTATE is logged, never the message.
 */
export function watchPool(db: Db, logger: Logger): void {
  db.$client.on("error", (err: Error & { code?: unknown }) => {
    logger.warn({ sqlstate: typeof err.code === "string" ? err.code : null }, "database connection lost");
  });
}
