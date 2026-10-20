import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import { testDb } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));

it("creates all base tables", async () => {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
  const names = res.rows.map((r) => r.table_name);
  for (const t of ["user", "session", "account", "verification", "workspace", "membership", "document", "job", "company", "extraction_revision", "financial_fact", "source_reference", "extraction_check", "market_point", "market_fetch", "market_connection"]) {
    expect(names).toContain(t);
  }
});

it("is idempotent", async () => {
  const { runMigrations } = await import("../src/migrate.js");
  await expect(runMigrations(db)).resolves.toBeUndefined();
});

it("the job table has run_after, the claim indexes and fillfactor 80", async () => {
  const cols = await db.execute(sql`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'job' and column_name = 'run_after'`);
  expect(cols.rows[0]).toMatchObject({ is_nullable: "NO" });
  expect(String(cols.rows[0]!.column_default)).toContain("now()");
  const idx = await db.execute(sql`select indexname, indexdef from pg_indexes where tablename = 'job'`);
  const names = idx.rows.map((r) => r.indexname);
  expect(names).toContain("job_claimable");
  expect(names).toContain("job_running_lease");
  expect(names).not.toContain("job_state_lease");
  expect(idx.rows.find((r) => r.indexname === "job_claimable")!.indexdef).toContain("WHERE (state = 'queued'");
  const opts = await db.execute(sql`select reloptions from pg_class where relname = 'job'`);
  expect(opts.rows[0]!.reloptions).toContain("fillfactor=80");
});

it("the vector extension is available on the image", async () => {
  const rows = await db.execute(sql`select 1 from pg_available_extensions where name = 'vector'`);
  expect(rows.rows).toHaveLength(1);
});
