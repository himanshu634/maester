import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { getFactWithSource } from "../src/queries/extraction.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function workspaceOf(userId: string) {
  await insertUser(db, userId, `${userId}@example.com`);
  const ws = await ensurePersonalWorkspace(db, { userId, userName: userId });
  const company = crypto.randomUUID();
  await db.insert(schema.company).values({ id: company, workspaceId: ws.id, displayName: "Synthetic Cements Limited", country: "IN", createdByUserId: userId });
  return { ws: ws.id, company, userId };
}
type Seed = Awaited<ReturnType<typeof workspaceOf>>;

async function doc(s: Seed, name: string, format: "pdf" | "xbrl" = "pdf") {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId: s.ws, companyId: s.company, originalName: name, declaredSize: 10, declaredMime: "application/pdf", format,
    storageKey: `workspaces/${s.ws}/documents/${id}/original`, state: "stored", intakeState: "read", createdByUserId: s.userId,
  });
  return id;
}

async function classify(s: Seed, documentId: string, kind: "annual_report" | "financial_results", periodEnd: string, createdAt: Date) {
  const id = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id, workspaceId: s.ws, documentId, kind, periodEnd, setBy: "maester", createdAt });
  return id;
}

async function revision(s: Seed, documentId: string, source: "pdf" | "xbrl", classificationId: string | null, createdAt: Date) {
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({ id: jobId, workspaceId: s.ws, type: "document.extract", subjectType: "document", subjectId: documentId, idempotencyKey: `seed-${jobId}`, state: "succeeded" });
  const id = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id, workspaceId: s.ws, documentId, jobId, classificationId, source, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v", pageCount: 286,
    coverage: { statements: [] }, createdAt,
  });
  return id;
}

async function fact(s: Seed, revisionId: string) {
  const id = crypto.randomUUID();
  await db.insert(schema.financialFact).values({
    id, workspaceId: s.ws, revisionId, companyId: s.company, statement: "income_statement", basis: "consolidated", section: "Income", lineOrder: 0,
    reportedLabel: "Revenue from operations", isSubtotal: false, periodLabel: "Year ended 31 Mar 2026", periodEnd: "2026-03-31", reportedText: "12,345.00",
    reportedValue: "12345.00", valueStatus: "value",
  });
  return id;
}

describe("getFactWithSource", () => {
  it("returns a page fact with its page, the filing and that its revision is current", async () => {
    const a = await workspaceOf("ua");
    const d = await doc(a, "ar-2025-26.pdf");
    const cls = await classify(a, d, "annual_report", "2026-03-31", new Date("2026-10-01T00:00:00Z"));
    await db.update(schema.documentClassification).set({ readsUnderId: cls }).where(eq(schema.documentClassification.id, cls));
    const rev = await revision(a, d, "pdf", cls, new Date("2026-10-02T00:00:00Z"));
    const f = await fact(a, rev);
    await db.insert(schema.sourceReference).values({ id: crypto.randomUUID(), workspaceId: a.ws, factId: f, documentId: d, pageIndex: 212, textLayerMatch: true });
    const got = await getFactWithSource(db, a.ws, f);
    expect(got).not.toBeNull();
    expect(got!.fact.id).toBe(f);
    expect(got!.source).toMatchObject({ pageIndex: 212, documentId: d });
    expect(got!.xbrl).toBeNull();
    expect(got!.documentId).toBe(d);
    expect(got!.companyId).toBe(a.company);
    expect(got!.revision.id).toBe(rev);
    expect(got!.isCurrentRevision).toBe(true);
    expect(got!.filing).toEqual({ originalName: "ar-2025-26.pdf", kind: "annual_report", periodEnd: "2026-03-31", pageCount: 286 });
  });

  it("returns an XBRL fact with its element", async () => {
    const a = await workspaceOf("ua");
    const d = await doc(a, "results.xml", "xbrl");
    const rev = await revision(a, d, "xbrl", null, new Date("2026-10-02T00:00:00Z"));
    const f = await fact(a, rev);
    await db.insert(schema.xbrlSource).values({ id: crypto.randomUUID(), workspaceId: a.ws, factId: f, documentId: d, element: "RevenueFromOperations", contextId: "FourD", decimals: "-5" });
    const got = await getFactWithSource(db, a.ws, f);
    expect(got!.xbrl).toMatchObject({ element: "RevenueFromOperations", contextId: "FourD" });
    expect(got!.source).toBeNull();
    // A document never classified keeps its newest revision as current.
    expect(got!.isCurrentRevision).toBe(true);
    expect(got!.filing).toMatchObject({ kind: null, periodEnd: null });
  });

  it("does not return another workspace's fact, nor an unknown id", async () => {
    const a = await workspaceOf("ua");
    const b = await workspaceOf("ub");
    const d = await doc(a, "ar.pdf");
    const f = await fact(a, await revision(a, d, "pdf", null, new Date("2026-10-02T00:00:00Z")));
    expect(await getFactWithSource(db, a.ws, f)).not.toBeNull();
    expect(await getFactWithSource(db, b.ws, f)).toBeNull();
    expect(await getFactWithSource(db, a.ws, crypto.randomUUID())).toBeNull();
  });

  it("says a fact of a replaced revision is not current", async () => {
    const a = await workspaceOf("ua");
    const d = await doc(a, "ar.pdf");
    const older = await revision(a, d, "pdf", null, new Date("2026-10-01T00:00:00Z"));
    const oldFact = await fact(a, older);
    const newer = await revision(a, d, "pdf", null, new Date("2026-10-03T00:00:00Z"));
    const newFact = await fact(a, newer);
    expect((await getFactWithSource(db, a.ws, oldFact))!.isCurrentRevision).toBe(false);
    expect((await getFactWithSource(db, a.ws, newFact))!.isCurrentRevision).toBe(true);
  });
});
