import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createDb } from "../src/client.js";
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
});
