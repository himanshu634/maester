import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
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

it("the document index: the vector extension, five tables, HNSW on halfvec, GIN full-text, one current revision", async () => {
  const ext = await db.execute(sql`select extversion from pg_extension where extname = 'vector'`);
  expect(ext.rows).toHaveLength(1);
  const tables = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
  const names = tables.rows.map((r) => r.table_name);
  for (const t of ["document_index_revision", "document_page", "document_chunk", "chunk_embedding", "page_read"]) {
    expect(names).toContain(t);
  }
  const idx = await db.execute(sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`);
  const def = (n: string) => String(idx.rows.find((r) => r.indexname === n)?.indexdef);
  expect(def("chunk_embedding_hnsw")).toContain("halfvec_cosine_ops");
  expect(def("chunk_embedding_hnsw")).toContain("hnsw");
  expect(def("document_chunk_tsv")).toContain("USING gin");
  expect(def("document_index_current")).toContain("UNIQUE");
  expect(def("document_index_current")).toMatch(/WHERE .*(complete|partial)/);
});

/** Drizzle wraps a driver error as `Failed query: ...`; the unique violation and its index name are on the cause. */
const uniqueViolation = (constraint: string) => ({ cause: { code: "23505", constraint } });

/** A workspace with a user, a stored document, a classification, a revision and one fact: what the 0008 columns hang on. */
async function seedFact() {
  const userId = `u-${crypto.randomUUID()}`;
  await db.insert(schema.user).values({ id: userId, name: "Test", email: `${userId}@example.com` });
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: "W", ownerUserId: userId });
  const documentId = crypto.randomUUID();
  await db.insert(schema.document).values({
    id: documentId, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original`, state: "stored", createdByUserId: userId,
  });
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({
    id: jobId, workspaceId, type: "document.xbrl", subjectType: "document", subjectId: documentId, idempotencyKey: `k-${jobId}`, state: "succeeded",
  });
  const revisionId = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId, documentId, jobId, state: "complete", pipelineVersion: "xbrl-1", model: "xbrl-parser-1",
    promptVersion: "in-capmkt/ind_as@1", pageCount: 1, coverage: { statements: [] },
  });
  const factId = crypto.randomUUID();
  await db.insert(schema.financialFact).values({
    id: factId, workspaceId, revisionId, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 0,
    reportedLabel: "Revenue", isSubtotal: false, periodLabel: "Year ended 31 Mar 2026", reportedText: "1.00", valueStatus: "value",
  });
  return { userId, workspaceId, documentId, revisionId, factId };
}

async function seedPdfClassification(workspaceId: string, documentId: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id, workspaceId, documentId, kind: "financial_results", setBy: "maester" });
  return id;
}

const xbrlSourceRow = (s: { workspaceId: string; documentId: string; factId: string }) => ({
  id: crypto.randomUUID(), workspaceId: s.workspaceId, factId: s.factId, documentId: s.documentId,
  element: "RevenueFromOperations", contextId: "OneD",
});

it("a document inserted without a format is a pdf, and a revision without a source is read from a pdf", async () => {
  const s = await seedFact();
  const doc = await db.execute(sql`select format from document where id = ${s.documentId}`);
  expect(doc.rows[0]!.format).toBe("pdf");
  const rev = await db.execute(sql`select source from extraction_revision where id = ${s.revisionId}`);
  expect(rev.rows[0]!.source).toBe("pdf");
  const [row] = await db.select({ format: schema.document.format }).from(schema.document).where(sql`id = ${s.documentId}`);
  expect(row!.format).toBe("pdf");
});

it("a fact has a nullable span and period start, and the span is one of five words", async () => {
  const s = await seedFact();
  const before = await db.execute(sql`select span, period_start from financial_fact where id = ${s.factId}`);
  expect(before.rows[0]).toEqual({ span: null, period_start: null });
  await db.execute(sql`update financial_fact set span = 'year', period_start = '2025-04-01' where id = ${s.factId}`);
  await expect(db.execute(sql`update financial_fact set span = 'full_year' where id = ${s.factId}`)).rejects.toThrow();
  const enumValues = await db.execute(sql`select unnest(enum_range(null::fact_span)) as v`);
  expect(enumValues.rows.map((r) => r.v)).toEqual(["quarter", "half_year", "nine_months", "year", "other"]);
});

it("xbrl_source holds one row per fact, and its defaults are no nil and no footnotes", async () => {
  const s = await seedFact();
  await db.insert(schema.xbrlSource).values({ ...xbrlSourceRow(s), decimals: "-5", concept: "revenue" });
  const [row] = await db.select().from(schema.xbrlSource).where(sql`fact_id = ${s.factId}`);
  expect(row).toMatchObject({ nil: false, footnoteIds: [], decimals: "-5", concept: "revenue", element: "RevenueFromOperations", contextId: "OneD" });
  await expect(db.insert(schema.xbrlSource).values(xbrlSourceRow(s))).rejects.toMatchObject(uniqueViolation("xbrl_source_fact"));
});

it("extraction_check_xbrl_pdf: one row per fact, PDF classification and check version", async () => {
  const s = await seedFact();
  const pdfClassificationId = await seedPdfClassification(s.workspaceId, s.documentId);
  const check = (over: Partial<typeof schema.extractionCheck.$inferInsert> = {}) => ({
    id: crypto.randomUUID(), workspaceId: s.workspaceId, revisionId: s.revisionId, checkType: "xbrl_in_pdf" as const,
    statement: "income_statement" as const, basis: "consolidated" as const, periodLabel: "Year ended 31 Mar 2026", subjectLabel: "Revenue",
    status: "passed" as const, detail: "found", factId: s.factId, pdfDocumentId: s.documentId, pdfClassificationId, pageIndex: 2, checkVersion: 1,
    ...over,
  });
  await db.insert(schema.extractionCheck).values(check());
  await expect(db.insert(schema.extractionCheck).values(check())).rejects.toMatchObject(uniqueViolation("extraction_check_xbrl_pdf"));
  // Another check version is a new set beside the old one.
  await db.insert(schema.extractionCheck).values(check({ checkVersion: 2 }));
  // A row with no PDF classification (the revision's own arithmetic checks) is outside the index.
  const own = check({ checkType: "subtotal", pdfClassificationId: null, pdfDocumentId: null, pageIndex: null, checkVersion: null });
  await db.insert(schema.extractionCheck).values(own);
  await db.insert(schema.extractionCheck).values({ ...own, id: crypto.randomUUID() });
  const idx = await db.execute(sql`select indexdef from pg_indexes where indexname = 'extraction_check_xbrl_pdf'`);
  expect(String(idx.rows[0]!.indexdef)).toContain("UNIQUE");
  expect(String(idx.rows[0]!.indexdef)).toMatch(/WHERE \(?\(?pdf_classification_id IS NOT NULL/);
  const byPdf = await db.execute(sql`select indexname from pg_indexes where indexname = 'extraction_check_pdf_document'`);
  expect(byPdf.rows).toHaveLength(1);
  const one = await db.execute(sql`select reason from extraction_check where fact_id = ${s.factId} and check_version = 1`);
  expect(one.rows[0]).toEqual({ reason: null });
});

it("company_workspace_isin refuses a second company with the ISIN in one workspace and allows it in another", async () => {
  const a = await seedFact();
  const b = await seedFact();
  const company = (workspaceId: string, userId: string, displayName: string, isin: string | null) => ({
    id: crypto.randomUUID(), workspaceId, displayName, country: "IN", createdByUserId: userId, isin,
  });
  await db.insert(schema.company).values(company(a.workspaceId, a.userId, "A Ltd", "INE246F01010"));
  await expect(db.insert(schema.company).values(company(a.workspaceId, a.userId, "B Ltd", "INE246F01010"))).rejects.toMatchObject(uniqueViolation("company_workspace_isin"));
  await db.insert(schema.company).values(company(b.workspaceId, b.userId, "A Ltd", "INE246F01010"));
  // A company with no ISIN does not collide with another with none.
  await db.insert(schema.company).values(company(a.workspaceId, a.userId, "C Ltd", null));
  await db.insert(schema.company).values(company(a.workspaceId, a.userId, "D Ltd", null));
});

it("a classification and its evidence carry the XBRL columns, all nullable", async () => {
  const s = await seedFact();
  const id = await seedPdfClassification(s.workspaceId, s.documentId);
  const [row] = await db.select().from(schema.documentClassification).where(sql`id = ${id}`);
  expect(row).toMatchObject({ isin: null, xbrlFormat: null, basis: null });
  await db.insert(schema.classificationEvidence).values({
    id: crypto.randomUUID(), workspaceId: s.workspaceId, classificationId: id, field: "identifier", source: "rule",
    ruleId: "xbrl.isin", element: "ISIN", context: "OneD",
  });
  const [ev] = await db.select().from(schema.classificationEvidence).where(sql`classification_id = ${id}`);
  expect(ev).toMatchObject({ element: "ISIN", context: "OneD", pageIndex: null, quote: null });
});

it("the document_workspace_intake index exists", async () => {
  const idx = await db.execute(sql`select indexdef from pg_indexes where indexname = 'document_workspace_intake'`);
  expect(String(idx.rows[0]!.indexdef)).toContain("(workspace_id, intake_state)");
});

it("the new intake state and check type are in their enums", async () => {
  const intake = await db.execute(sql`select unnest(enum_range(null::intake_state)) as v`);
  expect(intake.rows.map((r) => r.v)).toContain("waiting_for_xbrl");
  const checks = await db.execute(sql`select unnest(enum_range(null::check_type)) as v`);
  expect(checks.rows.map((r) => r.v)).toContain("xbrl_in_pdf");
});
