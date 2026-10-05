import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import {
  findStoredDuplicate, getCurrentClassification, getCurrentRevision, listEvidence, matchCompanies, normalizeCompanyName,
} from "../src/queries/classification.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function seed() {
  await insertUser(db, "u1", "u1@example.com");
  const workspaceId = crypto.randomUUID();
  await db.insert(schema.workspace).values({ id: workspaceId, name: "W", ownerUserId: "u1" });
  const documentId = crypto.randomUUID();
  await db.insert(schema.document).values({
    id: documentId, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original.pdf`, state: "stored", contentSha256: "a".repeat(64),
    createdByUserId: "u1",
  });
  return { workspaceId, documentId };
}

async function classification(workspaceId: string, documentId: string, createdAt: Date, extra: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await db.insert(schema.documentClassification).values({ id, workspaceId, documentId, kind: "annual_report", setBy: "maester", createdAt, ...extra });
  return id;
}

async function revision(workspaceId: string, documentId: string, classificationId: string | null, createdAt: Date) {
  const jobId = crypto.randomUUID();
  await db.insert(schema.job).values({ id: jobId, workspaceId, type: "document.extract", subjectType: "document", subjectId: documentId, idempotencyKey: `k-${jobId}`, state: "succeeded" });
  const id = crypto.randomUUID();
  await db.insert(schema.extractionRevision).values({
    id, workspaceId, documentId, jobId, classificationId, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v",
    pageCount: 1, coverage: { statements: [] }, createdAt,
  });
  return id;
}

describe("classification queries", () => {
  it("the newest classification is current, and evidence belongs to it", async () => {
    const { workspaceId, documentId } = await seed();
    await classification(workspaceId, documentId, new Date("2026-10-01T00:00:00Z"));
    const newer = await classification(workspaceId, documentId, new Date("2026-10-02T00:00:00Z"), { kind: "other", otherType: "announcement" });
    await db.insert(schema.classificationEvidence).values({ id: crypto.randomUUID(), workspaceId, classificationId: newer, field: "kind", source: "rule", ruleId: "title.press_release", pageIndex: 0, quote: "Press Release", textLayerMatch: true });
    expect((await getCurrentClassification(db, workspaceId, documentId))!.id).toBe(newer);
    expect((await listEvidence(db, workspaceId, newer)).map((e) => e.quote)).toEqual(["Press Release"]);
    expect(await getCurrentClassification(db, crypto.randomUUID(), documentId)).toBeNull();
  });

  it("current figures follow reads_under_id; no classification falls back to the newest revision", async () => {
    const { workspaceId, documentId } = await seed();
    expect(await getCurrentRevision(db, workspaceId, documentId)).toBeNull();
    const legacy = await revision(workspaceId, documentId, null, new Date("2026-09-01T00:00:00Z"));
    expect((await getCurrentRevision(db, workspaceId, documentId))!.id).toBe(legacy);
    const first = crypto.randomUUID();
    await db.insert(schema.documentClassification).values({ id: first, workspaceId, documentId, kind: "annual_report", setBy: "maester", readsUnderId: first, createdAt: new Date("2026-10-01T00:00:00Z") });
    const read = await revision(workspaceId, documentId, first, new Date("2026-10-01T01:00:00Z"));
    await classification(workspaceId, documentId, new Date("2026-10-02T00:00:00Z"), { readsUnderId: first, periodLabel: "Year ended 31 March 2026" });
    expect((await getCurrentRevision(db, workspaceId, documentId))!.id).toBe(read);
    await classification(workspaceId, documentId, new Date("2026-10-03T00:00:00Z"), { kind: "other", otherType: "announcement" });
    expect(await getCurrentRevision(db, workspaceId, documentId)).toBeNull();
  });

  it("normalizes company names", () => {
    expect(normalizeCompanyName("The Synthetic Cements Ltd.")).toBe("synthetic cements limited");
    expect(normalizeCompanyName("SYNTHETIC CEMENTS LIMITED")).toBe("synthetic cements limited");
    expect(normalizeCompanyName("Synthetic & Sons Pvt. Ltd")).toBe("synthetic and sons limited");
  });

  it("matches by CIN, then exchange code, then name; ambiguity returns every candidate", async () => {
    const { workspaceId } = await seed();
    const add = async (displayName: string, extra: Partial<typeof schema.company.$inferInsert> = {}) => {
      const id = crypto.randomUUID();
      await db.insert(schema.company).values({ id, workspaceId, displayName, country: "IN", createdByUserId: "u1", ...extra });
      return id;
    };
    const cem = await add("Synthetic Cements Ltd", { cin: "L26940MH2001PLC123456" });
    const pow = await add("Synthetic Power Limited", { bseCode: "532123" });
    await add("Twin Foods Ltd");
    await add("Twin Foods Limited");
    expect((await matchCompanies(db, workspaceId, { cin: "L26940MH2001PLC123456", name: "Other" })).map((c) => c.id)).toEqual([cem]);
    expect((await matchCompanies(db, workspaceId, { bseCode: "532123" })).map((c) => c.id)).toEqual([pow]);
    expect((await matchCompanies(db, workspaceId, { name: "SYNTHETIC CEMENTS LIMITED" })).map((c) => c.id)).toEqual([cem]);
    expect(await matchCompanies(db, workspaceId, { name: "Twin Foods Limited" })).toHaveLength(2);
    expect(await matchCompanies(db, workspaceId, { name: "Nobody Limited" })).toEqual([]);
    expect(await matchCompanies(db, crypto.randomUUID(), { cin: "L26940MH2001PLC123456" })).toEqual([]);
  });

  it("finds the older stored copy of the same content, and the oldest copy finds none", async () => {
    const { workspaceId, documentId } = await seed();
    const second = crypto.randomUUID();
    await db.insert(schema.document).values({
      id: second, workspaceId, originalName: "b.pdf", declaredSize: 10, declaredMime: "application/pdf",
      storageKey: `workspaces/${workspaceId}/documents/${second}/original.pdf`, state: "stored", contentSha256: "a".repeat(64), createdByUserId: "u1",
    });
    expect((await findStoredDuplicate(db, workspaceId, second, "a".repeat(64)))!.id).toBe(documentId);
    expect(await findStoredDuplicate(db, workspaceId, documentId, "a".repeat(64))).toBeNull();
    expect(await findStoredDuplicate(db, workspaceId, documentId, "b".repeat(64))).toBeNull();
  });

  it("refuses two companies with the same CIN in one workspace", async () => {
    const { workspaceId } = await seed();
    const values = { workspaceId, country: "IN", createdByUserId: "u1", cin: "L26940MH2001PLC123456" };
    await db.insert(schema.company).values({ id: crypto.randomUUID(), displayName: "A Ltd", ...values });
    await expect(db.insert(schema.company).values({ id: crypto.randomUUID(), displayName: "B Ltd", ...values })).rejects.toThrow();
  });
});
