import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { schema, type ClassificationRow } from "@maester/db";
import { classificationIdOfReadJob, decideIntake, readVersion } from "@maester/jobs";
import { createWorkerContext, seedWorkspace } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext(); });
afterAll(() => ctx.close());

async function seed(c: Partial<typeof schema.documentClassification.$inferInsert>, intakeState: "identifying" | "read" = "identifying") {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyId = crypto.randomUUID();
  await ctx.db.insert(schema.company).values({ id: companyId, workspaceId, displayName: `Co ${companyId}`, country: "IN", createdByUserId: userId });
  const documentId = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id: documentId, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${documentId}/original.pdf`, state: "stored", intakeState, createdByUserId: userId,
  });
  const id = crypto.randomUUID();
  const [row] = await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId, documentId, kind: "annual_report", setBy: "maester", ...c,
    ...(c.companyId === "SET" ? { companyId } : {}),
  }).returning();
  return { row: row as ClassificationRow, documentId, companyId };
}
const doc = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;

describe("decideIntake", () => {
  it("a read kind with a company starts the read, keyed by the classification", async () => {
    const { row, documentId, companyId } = await seed({ companyId: "SET" });
    const before = ctx.dispatcher.enqueued.length;
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("reading");
    const job = ctx.dispatcher.enqueued.at(-1)!;
    expect(ctx.dispatcher.enqueued.length).toBe(before + 1);
    expect(job.type).toBe(JobTypes.DOCUMENT_EXTRACT);
    expect(job.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${documentId}:${readVersion(row.id)}`);
    expect(classificationIdOfReadJob(job.idempotencyKey)).toBe(row.id);
    expect(await doc(documentId)).toMatchObject({ intakeState: "reading", companyId });
  });

  it("a read kind without a company holds for the investor", async () => {
    const { row, documentId } = await seed({});
    const before = ctx.dispatcher.enqueued.length;
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: true })).toBe("needs_company");
    expect(ctx.dispatcher.enqueued.length).toBe(before);
    expect((await doc(documentId)).intakeState).toBe("needs_company");
  });

  it("other is kept and not_sure waits for the investor", async () => {
    const other = await seed({ kind: "other", otherType: "announcement" });
    expect(await decideIntake(ctx.db, ctx.dispatcher, other.row, { read: true })).toBe("kept");
    const unsure = await seed({ kind: "not_sure" });
    expect(await decideIntake(ctx.db, ctx.dispatcher, unsure.row, { read: true })).toBe("needs_kind");
  });

  it("read: false leaves a read document as it is", async () => {
    const { row, documentId } = await seed({ companyId: "SET" }, "read");
    expect(await decideIntake(ctx.db, ctx.dispatcher, row, { read: false })).toBeNull();
    expect((await doc(documentId)).intakeState).toBe("read");
  });

  it("classificationIdOfReadJob ignores other keys", () => {
    expect(classificationIdOfReadJob("document.extract:x:auto")).toBeNull();
    expect(classificationIdOfReadJob("document.extract:x:manual-1")).toBeNull();
  });
});
