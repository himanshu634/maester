import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { ensurePersonalWorkspace, getWorkspaceForUser, listWorkspacesForUser } from "../src/queries/workspaces.js";
import { getDocument, listDocuments } from "../src/queries/documents.js";
import { getJob, getLatestJobForSubject } from "../src/queries/jobs.js";
import { insertUser, testDb, truncateAll } from "./helpers.js";

const db = await testDb();
afterAll(() => closeDb(db));
beforeEach(() => truncateAll(db));

async function seedDoc(workspaceId: string, userId: string, name: string, createdAt: Date) {
  const id = crypto.randomUUID();
  await db.insert(schema.document).values({
    id, workspaceId, originalName: name, declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "pending_upload",
    createdByUserId: userId, createdAt, updatedAt: createdAt,
  });
  return id;
}

describe("workspaces", () => {
  it("ensurePersonalWorkspace creates once and is idempotent", async () => {
    await insertUser(db, "u1", "u1@example.com");
    const w1 = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    const w2 = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    expect(w1.id).toBe(w2.id);
    expect(w1.name).toBe("Ada's workspace");
    const list = await listWorkspacesForUser(db, "u1");
    expect(list).toHaveLength(1);
    const found = await getWorkspaceForUser(db, "u1", w1.id);
    expect(found?.membership.role).toBe("owner");
  });

  it("getWorkspaceForUser returns null for a non-member", async () => {
    await insertUser(db, "u1", "u1@example.com");
    await insertUser(db, "u2", "u2@example.com");
    const w = await ensurePersonalWorkspace(db, { userId: "u1", userName: "Ada" });
    expect(await getWorkspaceForUser(db, "u2", w.id)).toBeNull();
  });
});

describe("documents", () => {
  it("scoped get and cursor list never cross workspaces", async () => {
    await insertUser(db, "u1", "u1@example.com");
    await insertUser(db, "u2", "u2@example.com");
    const wa = await ensurePersonalWorkspace(db, { userId: "u1", userName: "A" });
    const wb = await ensurePersonalWorkspace(db, { userId: "u2", userName: "B" });
    const base = Date.now();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await seedDoc(wa.id, "u1", `a${i}.pdf`, new Date(base + i * 1000)));
    const foreign = await seedDoc(wb.id, "u2", "b.pdf", new Date(base));

    expect(await getDocument(db, wa.id, foreign)).toBeNull();
    expect((await getDocument(db, wa.id, ids[0]!))?.originalName).toBe("a0.pdf");

    const page1 = await listDocuments(db, wa.id, { limit: 2 });
    expect(page1.items.map((d) => d.originalName)).toEqual(["a2.pdf", "a1.pdf"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listDocuments(db, wa.id, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((d) => d.originalName)).toEqual(["a0.pdf"]);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("jobs", () => {
  it("getJob is scoped and latest job for subject picks newest", async () => {
    await insertUser(db, "u1", "u1@example.com");
    const w = await ensurePersonalWorkspace(db, { userId: "u1", userName: "A" });
    const docId = await seedDoc(w.id, "u1", "a.pdf", new Date());
    const mk = async (key: string, createdAt: Date) => {
      const id = crypto.randomUUID();
      await db.insert(schema.job).values({ id, workspaceId: w.id, type: "document.verify", subjectType: "document", subjectId: docId, idempotencyKey: key, state: "queued", createdAt, updatedAt: createdAt });
      return id;
    };
    const j1 = await mk("k1", new Date(Date.now() - 5000));
    const j2 = await mk("k2", new Date());
    expect((await getJob(db, w.id, j1))?.id).toBe(j1);
    expect(await getJob(db, crypto.randomUUID(), j1)).toBeNull();
    expect((await getLatestJobForSubject(db, w.id, "document", docId))?.id).toBe(j2);
  });
});
