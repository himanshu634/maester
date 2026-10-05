import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClassificationChanged, ClassifyJobResponse, DocumentClassification, JobTypes, type Document } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const send = (method: string, cookie: string, body?: unknown) => ({
  method, headers: { cookie, "content-type": "application/json", origin: "http://localhost" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function seedDocument(workspaceId: string, userId: string, intakeState: "needs_company" | "read" | "kept" = "needs_company") {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId, originalName: "ar.pdf", declaredSize: 10, declaredMime: "application/pdf",
    storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState, createdByUserId: userId,
  });
  return id;
}
async function seedClassification(workspaceId: string, documentId: string, values: Partial<typeof schema.documentClassification.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId, documentId, kind: "annual_report", setBy: "maester", companyNameAsPrinted: "Synthetic Cements Limited",
    cin: "L26940MH2001PLC123456", periodLabel: "Year ended 31 March 2026", periodEnd: "2026-03-31",
    statementsFound: [{ statement: "balance_sheet", basis: "standalone", pages: [2] }], ...values,
  });
  for (const [field, quote] of [["kind", "Annual Report 2025-26"], ["company", "Synthetic Cements Limited"], ["identifier", "CIN: L26940MH2001PLC123456"], ["statements", "Standalone Balance Sheet as at 31 March 2026"]] as const) {
    await ctx.db.insert(schema.classificationEvidence).values({ id: crypto.randomUUID(), workspaceId, classificationId: id, field, source: "rule", ruleId: `r.${field}`, pageIndex: 0, quote, textLayerMatch: true });
  }
  return id;
}
const url = (ws: string, id: string, tail = "classification") => `/v1/workspaces/${ws}/documents/${id}/${tail}`;

describe("upload without a company", () => {
  it("creates a pending document with no company", async () => {
    const { cookie, workspaceId } = await ctx.signUp("nocompany@example.com");
    const res = await ctx.app.request(`/v1/workspaces/${workspaceId}/documents/uploads`, send("POST", cookie, { originalName: "x.pdf", size: 10, mimeType: "application/pdf" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { document: Document };
    expect(body.document).toMatchObject({ companyId: null, intakeState: null, classification: null });
  });
});

describe("classification", () => {
  it("reads the current classification with its evidence, scoped to the workspace", async () => {
    const a = await ctx.signUp("read-a@example.com");
    const b = await ctx.signUp("read-b@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    expect((await ctx.app.request(url(a.workspaceId, doc), { headers: { cookie: a.cookie } })).status).toBe(404);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const body = DocumentClassification.parse(await res.json());
    expect(body.classification).toMatchObject({ id: cid, kind: "annual_report", cin: "L26940MH2001PLC123456" });
    expect(body.evidence).toHaveLength(4);
    expect((await ctx.app.request(url(b.workspaceId, doc), { headers: { cookie: b.cookie } })).status).toBe(404);
    const listed = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents`, { headers: { cookie: a.cookie } });
    const items = ((await listed.json()) as { items: Document[] }).items;
    expect(items.find((d) => d.id === doc)!.classification).toMatchObject({ id: cid, kind: "annual_report" });
  });

  it("rejects a stale basedOn with 409", async () => {
    const a = await ctx.signUp("stale@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const old = await seedClassification(a.workspaceId, doc, { createdAt: new Date(Date.now() - 60_000) });
    await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: old, kind: "other" }));
    expect(res.status).toBe(409);
  });

  it("confirming a new company creates it with its identifiers and starts the read", async () => {
    const a = await ctx.signUp("newco@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, {
      basedOn: cid, company: { new: { displayName: "Synthetic Cements Limited", country: "IN", cin: "L26940MH2001PLC123456" } },
    }));
    expect(res.status).toBe(200);
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification).toMatchObject({ setBy: "investor", readsUnderId: body.classification.id });
    expect(body.document.intakeState).toBe("reading");
    const [company] = await ctx.db.select().from(schema.company).where(eq(schema.company.id, body.classification.companyId!));
    expect(company!.cin).toBe("L26940MH2001PLC123456");
    expect(body.evidence.find((e) => e.field === "company")!.source).toBe("investor");
    expect(body.evidence.find((e) => e.field === "statements")!.source).toBe("rule");
    expect(body.evidence.some((e) => e.field === "identifier")).toBe(false);
    const read = ctx.dispatcher.enqueued.find((j) => j.subjectId === doc && j.type === JobTypes.DOCUMENT_EXTRACT);
    expect(read!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${doc}:classification-${body.classification.id}`);
  });

  it("a company name that already exists is a 409", async () => {
    const a = await ctx.signUp("clash@example.com");
    await ctx.createCompany(a.workspaceId, a.cookie, "Synthetic Cements Limited");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, {
      basedOn: cid, company: { new: { displayName: "Synthetic Cements Limited", country: "IN" } },
    }));
    expect(res.status).toBe(409);
  });

  it("changing only the period keeps the read and its figures", async () => {
    const a = await ctx.signUp("period@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Period Co Limited");
    const doc = await seedDocument(a.workspaceId, a.userId, "read");
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: a.workspaceId, documentId: doc, kind: "annual_report", setBy: "maester", companyId, readsUnderId: cid });
    const before = ctx.dispatcher.enqueued.length;
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, periodLabel: "Year ended 31 March 2026", periodEnd: "2026-03-31" }));
    expect(res.status).toBe(200);
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification.readsUnderId).toBe(cid);
    expect(body.document.intakeState).toBe("read");
    expect(ctx.dispatcher.enqueued.length).toBe(before);
  });

  it("changing the kind to other keeps the document and its figures stop being current", async () => {
    const a = await ctx.signUp("toother@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Other Co Limited");
    const doc = await seedDocument(a.workspaceId, a.userId, "read");
    const cid = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({ id: cid, workspaceId: a.workspaceId, documentId: doc, kind: "annual_report", setBy: "maester", companyId, readsUnderId: cid });
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, kind: "other", otherType: "investor_presentation" }));
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification).toMatchObject({ kind: "other", otherType: "investor_presentation", readsUnderId: null });
    expect(body.document.intakeState).toBe("kept");
    expect((await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${doc}/facts`, { headers: { cookie: a.cookie } })).status).toBe(404);
  });

  it("changing the kind away from financial_results leaves no results_span evidence", async () => {
    const a = await ctx.signUp("span@example.com");
    const companyId = await ctx.createCompany(a.workspaceId, a.cookie, "Span Co Limited");
    const doc = await seedDocument(a.workspaceId, a.userId, "read");
    const cid = await seedClassification(a.workspaceId, doc, { kind: "financial_results", resultsSpan: "quarter", companyId });
    await ctx.db.insert(schema.classificationEvidence).values({ id: crypto.randomUUID(), workspaceId: a.workspaceId, classificationId: cid, field: "results_span", source: "rule", ruleId: "r.span", pageIndex: 0, quote: "Quarter ended", textLayerMatch: true });
    const res = await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, kind: "annual_report" }));
    expect(res.status).toBe(200);
    const body = ClassificationChanged.parse(await res.json());
    expect(body.classification.resultsSpan).toBeNull();
    expect(body.evidence.some((e) => e.field === "results_span")).toBe(false);
    expect(body.evidence.find((e) => e.field === "kind")!.source).toBe("investor");
  });

  it("refuses not_sure and an empty change", async () => {
    const a = await ctx.signUp("refuse@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId);
    const cid = await seedClassification(a.workspaceId, doc);
    expect((await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid, kind: "not_sure" }))).status).toBe(400);
    expect((await ctx.app.request(url(a.workspaceId, doc), send("POST", a.cookie, { basedOn: cid }))).status).toBe(400);
  });

  it("re-running classification enqueues a fresh job and marks identifying", async () => {
    const a = await ctx.signUp("rerun@example.com");
    const doc = await seedDocument(a.workspaceId, a.userId, "kept");
    const res = await ctx.app.request(url(a.workspaceId, doc, "classify"), send("POST", a.cookie, {}));
    expect(res.status).toBe(202);
    const { job } = ClassifyJobResponse.parse(await res.json());
    expect(job.type).toBe(JobTypes.DOCUMENT_CLASSIFY);
    const [d] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, doc));
    expect(d!.intakeState).toBe("identifying");
  });
});
