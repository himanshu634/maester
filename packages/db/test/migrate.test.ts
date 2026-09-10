import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import { testDb } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));

it("creates all base tables", async () => {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
  const names = res.rows.map((r) => r.table_name);
  for (const t of ["user", "session", "account", "verification", "workspace", "membership", "document", "job"]) {
    expect(names).toContain(t);
  }
});

it("is idempotent", async () => {
  const { runMigrations } = await import("../src/migrate.js");
  await expect(runMigrations(db)).resolves.toBeUndefined();
});
