import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace } from "../src/queries/workspaces.js";
import { listChecksForRevisions, listCompanyFilings, listFactsWithSourcesForRevisions } from "../src/queries/research.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function setup() {
  await insertUser(db, "u1", "u1@example.com");
  const ws = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
  const company = crypto.randomUUID();
  await db.insert(schema.company).values({ id: company, workspaceId: ws.id, displayName: "Synthetic Cements Limited", country: "IN", createdByUserId: "u1" });
  return { ws: ws.id, company };
}

async function doc(ws: string, companyId: string | null, name: string, intakeState: "read" | "kept" | null = "read") {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId: ws, companyId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${ws}/documents/${id}/original.pdf`, state: "stored", intakeState, createdByUserId: "u1",
  });
  return id;
}

describe("listCompanyFilings", () => {
  it("lists a company's documents with their current classification", async () => {
    const { ws, company } = await setup();
    const a = await doc(ws, company, "ar-2025-26.pdf");
    await doc(ws, null, "loose.pdf");
    await db.insert(schema.documentClassification).values({ id: crypto.randomUUID(), workspaceId: ws, documentId: a, kind: "other", setBy: "maester", createdAt: new Date("2026-10-01T00:00:00Z") });
    await db.insert(schema.documentClassification).values({ id: crypto.randomUUID(), workspaceId: ws, documentId: a, kind: "annual_report", periodEnd: "2026-03-31", setBy: "investor", createdAt: new Date("2026-10-02T00:00:00Z") });
    const rows = await listCompanyFilings(db, ws, company);
    expect(rows).toEqual([expect.objectContaining({ documentId: a, companyId: company, originalName: "ar-2025-26.pdf", intakeState: "read", kind: "annual_report", periodEnd: "2026-03-31" })]);
    expect(await listCompanyFilings(db, ws)).toHaveLength(1);
  });

  it("returns a document never classified with no kind", async () => {
    const { ws, company } = await setup();
    await doc(ws, company, "old.pdf", null);
    expect(await listCompanyFilings(db, ws, company)).toEqual([expect.objectContaining({ kind: null, periodEnd: null, intakeState: null })]);
  });
});

describe("facts and checks for several revisions", () => {
  it("returns nothing for no revisions", async () => {
    const { ws } = await setup();
    expect(await listFactsWithSourcesForRevisions(db, ws, [])).toEqual([]);
    expect(await listChecksForRevisions(db, ws, [])).toEqual([]);
  });
});
