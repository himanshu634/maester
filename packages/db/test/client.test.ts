import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb, poolConfig } from "../src/client.js";
import { TEST_DATABASE_URL, testDb } from "./helpers.js";

const setup = await testDb();
const writable = createDb(TEST_DATABASE_URL, { max: 2 });
const readOnly = createDb(TEST_DATABASE_URL, { readOnly: true, max: 2 });
afterAll(async () => {
  await closeDb(writable);
  await closeDb(readOnly);
  await closeDb(setup);
});

const insert = (db: typeof writable, email: string) =>
  db.execute(sql`INSERT INTO waitlist_entry (email, status, source) VALUES (${email}, 'pending', 'admin')`);

describe("createDb", () => {
  it("writes through a default pool", async () => {
    await insert(writable, "default-pool@example.com");
    const rows = await writable.execute(sql`SELECT email FROM waitlist_entry WHERE email = 'default-pool@example.com'`);
    expect(rows.rows).toHaveLength(1);
  });

  it("refuses a write through a read-only pool, and still reads", async () => {
    // 25006: read_only_sql_transaction.
    await expect(insert(readOnly, "read-only-pool@example.com")).rejects.toMatchObject({ cause: { code: "25006" } });
    const rows = await readOnly.execute(sql`SELECT email FROM waitlist_entry WHERE email = 'default-pool@example.com'`);
    expect(rows.rows).toHaveLength(1);
  });

  it("keeps a read-only pool read-only when the URL carries its own options, even one that turns it off", async () => {
    const url = `${TEST_DATABASE_URL}?options=${encodeURIComponent("-c statement_timeout=5000 -c default_transaction_read_only=off")}`;
    const db = createDb(url, { readOnly: true, max: 1 });
    try {
      const ro = await db.execute(sql`SHOW default_transaction_read_only`);
      expect(ro.rows[0]).toEqual({ default_transaction_read_only: "on" });
      // The URL's own setting still applies.
      const timeout = await db.execute(sql`SHOW statement_timeout`);
      expect(timeout.rows[0]).toEqual({ statement_timeout: "5s" });
      await expect(insert(db, "options-url@example.com")).rejects.toMatchObject({ cause: { code: "25006" } });
    } finally {
      await closeDb(db);
    }
  });

  it("passes a writable pool's URL through untouched", async () => {
    const url = `${TEST_DATABASE_URL}?options=${encodeURIComponent("-c statement_timeout=5000")}`;
    expect(poolConfig(url)).toEqual({ connectionString: url, max: 10 });
  });
});
