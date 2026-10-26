import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { closeDb, createDb, type Db } from "../src/client.js";
import { DEFAULT_MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.js";
import { TEST_DATABASE_URL } from "./helpers.js";

/**
 * Migration 0008 renames a rejection code in data. `runMigrations(db, folder)` applies every migration in the folder it
 * is given and every migration names the `public` schema, so a scratch schema would isolate nothing. The test makes a
 * scratch database instead, builds it at 0007 from a copy of the folder whose journal stops there, seeds rows under the
 * old code, applies the real folder and reads the rows back.
 */
const scratchName = `maester_mig_${randomBytes(4).toString("hex")}`;
const urlFor = (database: string) => {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
};

let scratch: Db | undefined;
let created = false;
let folder: string | undefined;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    await admin.query(`create database ${scratchName}`);
    created = true;
  } finally {
    await admin.end();
  }
  folder = await mkdtemp(join(tmpdir(), "maester-mig-"));
  await cp(DEFAULT_MIGRATIONS_FOLDER, folder, { recursive: true });
  scratch = createDb(urlFor(scratchName));
});

afterAll(async () => {
  if (scratch) await closeDb(scratch);
  if (folder) await rm(folder, { recursive: true, force: true });
  if (!created) return;
  const admin = new pg.Client({ connectionString: urlFor("postgres") });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${scratchName} with (force)`);
  } finally {
    await admin.end();
  }
});

it("0008 turns the rejection code NOT_A_PDF into UNSUPPORTED_TYPE and leaves the other codes and rows alone", async () => {
  const db = scratch!;
  const journalPath = join(folder!, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((e) => e.tag === "0007_document_index");
  expect(at).toBeGreaterThan(-1);
  // The real folder holds 0008 straight after 0007, so the cut removes it.
  expect(journal.entries[at + 1]?.tag).toBe("0008_xbrl");
  await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at + 1) }, null, 2));

  await runMigrations(db, folder!);
  const before = await db.execute(sql`select 1 from pg_type where typname = 'document_format'`);
  expect(before.rows).toHaveLength(0);

  const workspaceId = crypto.randomUUID();
  await db.execute(sql`insert into "user" (id, name, email) values ('u1', 'Test', 'u1@example.com')`);
  await db.execute(sql`insert into workspace (id, name, owner_user_id) values (${workspaceId}, 'W', 'u1')`);
  const rows = ["NOT_A_PDF", "NOT_A_PDF", "TOO_LARGE", null].map((code) => ({ id: crypto.randomUUID(), code }));
  for (const [i, r] of rows.entries()) {
    await db.execute(sql`
      insert into document (id, workspace_id, original_name, declared_size, declared_mime, storage_key, state, rejection_code, created_by_user_id)
      values (${r.id}, ${workspaceId}, ${`f${i}`}, 10, 'application/pdf', ${`k/${r.id}`}, ${r.code ? "rejected" : "stored"}::document_state, ${r.code}, 'u1')`);
  }

  await runMigrations(db);

  const after = await db.execute(sql`select id, rejection_code, format from document where workspace_id = ${workspaceId}`);
  const byId = new Map(after.rows.map((r) => [r.id as string, r]));
  expect(byId.get(rows[0]!.id)).toMatchObject({ rejection_code: "UNSUPPORTED_TYPE", format: "pdf" });
  expect(byId.get(rows[1]!.id)).toMatchObject({ rejection_code: "UNSUPPORTED_TYPE", format: "pdf" });
  expect(byId.get(rows[2]!.id)).toMatchObject({ rejection_code: "TOO_LARGE" });
  expect(byId.get(rows[3]!.id)).toMatchObject({ rejection_code: null });
  const left = await db.execute(sql`select count(*)::int as n from document where rejection_code = 'NOT_A_PDF'`);
  expect(left.rows[0]).toEqual({ n: 0 });
});
