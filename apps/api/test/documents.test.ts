import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreateUploadResponse, Document, DocumentPipeline, ExtractResponse, FinalizeResponse, JobTypes, paginated } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const post = (cookie: string, body: unknown) => ({
  method: "POST",
  headers: { cookie, "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify(body),
});

const companies = new Map<string, string>();
async function companyFor(ws: string, cookie: string) {
  if (!companies.has(ws)) companies.set(ws, await ctx.createCompany(ws, cookie));
  return companies.get(ws)!;
}

async function createUpload(ws: string, cookie: string, size = 1234, originalName = "fy24.pdf") {
  const companyId = await companyFor(ws, cookie);
  const res = await ctx.app.request(`/v1/workspaces/${ws}/documents/uploads`, post(cookie, { companyId, originalName, size, mimeType: "application/pdf" }));
  return { status: res.status, body: await res.json() };
}

describe("documents", () => {
  it("creates an upload with a signed PUT bound to size and type", async () => {
    const a = await ctx.signUp("d1@example.com");
    const { status, body } = await createUpload(a.workspaceId, a.cookie);
    expect(status).toBe(201);
    const parsed = CreateUploadResponse.parse(body);
    expect(parsed.document.state).toBe("pending_upload");
    expect(parsed.upload.headers["Content-Length"]).toBe("1234");
    expect(parsed.upload.url).toBe(`memory://upload/workspaces/${a.workspaceId}/documents/${parsed.document.id}/original.pdf`);
  });

  it("rejects oversize and non-pdf uploads with stable codes", async () => {
    const a = await ctx.signUp("d2@example.com");
    const big = await createUpload(a.workspaceId, a.cookie, 52428801);
    expect(big.status).toBe(413);
    expect((big.body as { error: { code: string } }).error.code).toBe("UPLOAD_TOO_LARGE");
    const companyId = await companyFor(a.workspaceId, a.cookie);
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { companyId, originalName: "x.png", size: 5, mimeType: "image/png" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; fields: { path: string; message: string }[] } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fields[0]!.path).toBe("mimeType");
  });

  it("accepts an XML upload: format xbrl and a key that ends original.xml", async () => {
    const a = await ctx.signUp("d9@example.com");
    for (const mimeType of ["text/xml", "application/xml"]) {
      const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { originalName: "results.xml", size: 321, mimeType }));
      expect(res.status).toBe(201);
      const parsed = CreateUploadResponse.parse(await res.json());
      expect(parsed.document).toMatchObject({ format: "xbrl", declaredMime: mimeType });
      expect(parsed.upload.url).toBe(`memory://upload/workspaces/${a.workspaceId}/documents/${parsed.document.id}/original.xml`);
      const [row] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, parsed.document.id));
      expect(row).toMatchObject({ format: "xbrl", storageKey: expect.stringMatching(/\/original\.xml$/) });
    }
  });

  it("gives a PDF upload format pdf and refuses application/zip with VALIDATION_FAILED", async () => {
    const a = await ctx.signUp("d10@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    expect(CreateUploadResponse.parse(body).document.format).toBe("pdf");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { originalName: "x.zip", size: 5, mimeType: "application/zip" }));
    expect(res.status).toBe(400);
    const err = (await res.json()) as { error: { code: string; fields: { path: string }[] } };
    expect(err.error.code).toBe("VALIDATION_FAILED");
    expect(err.error.fields[0]!.path).toBe("mimeType");
  });

  it("extract on an xbrl document creates a document.xbrl job, not document.extract", async () => {
    const a = await ctx.signUp("d11@example.com");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/uploads`, post(a.cookie, { originalName: "r.xml", size: 10, mimeType: "text/xml" }));
    const docId = CreateUploadResponse.parse(await res.json()).document.id;
    await ctx.db.update(schema.document).set({ state: "stored" }).where(eq(schema.document.id, docId));
    const extract = () => ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/extract`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
    const first = await extract();
    expect(first.status).toBe(202);
    const second = await extract();
    const j1 = ExtractResponse.parse(await first.json()).job;
    const j2 = ExtractResponse.parse(await second.json()).job;
    expect(j1.type).toBe(JobTypes.DOCUMENT_XBRL);
    expect(j1.id).not.toBe(j2.id);
    const rows = await ctx.db.select().from(schema.job).where(eq(schema.job.subjectId, docId));
    expect(rows.map((r) => r.type)).toEqual([JobTypes.DOCUMENT_XBRL, JobTypes.DOCUMENT_XBRL]);
    expect(rows.every((r) => r.idempotencyKey.includes(":manual-"))).toBe(true);
  });

  describe("extract on a results PDF that XBRL covers", () => {
    type Pair = { statement: "income_statement"; basis: "consolidated" | "standalone" };
    const BOTH: Pair[] = [{ statement: "income_statement", basis: "consolidated" }, { statement: "income_statement", basis: "standalone" }];

    /** A stored results PDF printing both bases, and a read XBRL instance of its company and period with facts in `coverage`. */
    async function seedCovered(email: string, coverage: Pair[]) {
      const a = await ctx.signUp(email);
      const { body } = await createUpload(a.workspaceId, a.cookie);
      const pdfId = (body as { document: { id: string } }).document.id;
      const companyId = await companyFor(a.workspaceId, a.cookie);
      const [user] = await ctx.db.select().from(schema.user).where(eq(schema.user.email, email));
      await ctx.db.update(schema.document).set({ state: "stored", intakeState: "read", companyId }).where(eq(schema.document.id, pdfId));
      const pdfClass = crypto.randomUUID();
      await ctx.db.insert(schema.documentClassification).values({
        id: pdfClass, workspaceId: a.workspaceId, documentId: pdfId, kind: "financial_results", companyId, periodEnd: "2025-09-30",
        statementsFound: BOTH.map((p) => ({ ...p, pages: [2] })), setBy: "maester", readsUnderId: pdfClass,
      });
      const xbrlId = crypto.randomUUID();
      await ctx.db.insert(schema.document).values({
        id: xbrlId, workspaceId: a.workspaceId, companyId, originalName: "r.xml", declaredSize: 10, declaredMime: "text/xml", format: "xbrl",
        storageKey: `workspaces/${a.workspaceId}/documents/${xbrlId}/original.xml`, state: "stored", intakeState: "read", createdByUserId: user!.id,
      });
      const xbrlClass = crypto.randomUUID();
      await ctx.db.insert(schema.documentClassification).values({
        id: xbrlClass, workspaceId: a.workspaceId, documentId: xbrlId, kind: "financial_results", companyId, periodEnd: "2025-09-30", setBy: "maester", readsUnderId: xbrlClass,
      });
      const jobId = crypto.randomUUID();
      await ctx.db.insert(schema.job).values({
        id: jobId, workspaceId: a.workspaceId, type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: xbrlId, idempotencyKey: `k-${jobId}`, state: "succeeded",
      });
      const revisionId = crypto.randomUUID();
      await ctx.db.insert(schema.extractionRevision).values({
        id: revisionId, workspaceId: a.workspaceId, documentId: xbrlId, jobId, classificationId: xbrlClass, source: "xbrl", state: "complete",
        pipelineVersion: "xbrl-1", model: "xbrl-parser-1", promptVersion: "in-capmkt/ind_as@1", pageCount: 0, coverage: { statements: [] },
      });
      await ctx.db.insert(schema.financialFact).values(coverage.map((p, i) => ({
        id: crypto.randomUUID(), workspaceId: a.workspaceId, revisionId, companyId, statement: p.statement, basis: p.basis, section: "s", lineOrder: i,
        reportedLabel: "line", isSubtotal: false, periodLabel: "Quarter ended 30 Sep 2025", periodEnd: "2025-09-30", span: "quarter" as const,
        reportedText: "", valueStatus: "unparsed" as const,
      })));
      const extract = () => ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${pdfId}/extract`, { method: "POST", headers: { cookie: a.cookie, origin: "http://localhost" } });
      const extractJobs = async () =>
        (await ctx.db.select().from(schema.job).where(eq(schema.job.subjectId, pdfId))).filter((j) => j.type === JobTypes.DOCUMENT_EXTRACT);
      return { extract, extractJobs, a, pdfId, xbrlId, companyId, userId: user!.id };
    }

    it("a skipped results PDF answers 409 INVALID_STATE and creates no document.extract job", async () => {
      const { extract, extractJobs } = await seedCovered("d12@example.com", BOTH);
      const res = await extract();
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; message: string } };
      expect(err.error.code).toBe("INVALID_STATE");
      expect(err.error.message).toContain("numbers come from XBRL");
      expect(await extractJobs()).toHaveLength(0);
    });

    it("the covered PDF's pipeline names the XBRL that covers it, and keeps it while another instance is still being identified", async () => {
      const { a, pdfId, xbrlId, companyId, userId } = await seedCovered("d14@example.com", BOTH);
      const get = async (id: string) =>
        Document.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${id}`, { headers: { cookie: a.cookie } })).json());

      expect((await get(pdfId)).pipeline.numbers).toEqual({
        source: "xbrl", state: "not_needed", coveredByXbrl: [xbrlId], waitingOn: [], reason: null, format: null, partial: false, warnings: [],
      });
      expect((await get(xbrlId)).pipeline.numbers).toMatchObject({ source: "xbrl", state: "done", reason: null });

      // A folder import is running: a new instance is still being identified, so the plan for the PDF waits and names no cover.
      const importing = crypto.randomUUID();
      await ctx.db.insert(schema.document).values({
        id: importing, workspaceId: a.workspaceId, companyId, originalName: "n.xml", declaredSize: 10, declaredMime: "text/xml", format: "xbrl",
        storageKey: `workspaces/${a.workspaceId}/documents/${importing}/original.xml`, state: "stored", intakeState: "identifying", createdByUserId: userId,
      });
      expect((await get(pdfId)).pipeline.numbers).toMatchObject({ source: "xbrl", state: "not_needed", coveredByXbrl: [xbrlId], waitingOn: [] });
      expect((await get(importing)).pipeline.numbers).toMatchObject({ state: "waiting", reason: "not_identified" });
    });

    it("another company's XBRL neither covers a PDF nor holds it: only the PDF's own company and instances of none yet count", async () => {
      const { a, pdfId, xbrlId, userId } = await seedCovered("d18@example.com", BOTH);
      const otherCompany = crypto.randomUUID();
      await ctx.db.insert(schema.company).values({ id: otherCompany, workspaceId: a.workspaceId, displayName: "Synthetic Steel", country: "IN", createdByUserId: userId });
      const strangers = [crypto.randomUUID(), crypto.randomUUID()];
      for (const [n, id] of strangers.entries()) {
        await ctx.db.insert(schema.document).values({
          id, workspaceId: a.workspaceId, companyId: otherCompany, originalName: `o${n}.xml`, declaredSize: 10, declaredMime: "text/xml", format: "xbrl",
          storageKey: `workspaces/${a.workspaceId}/documents/${id}/original.xml`, state: "stored", intakeState: n === 0 ? "identifying" : "read", createdByUserId: userId,
        });
      }
      const get = async (id: string) =>
        Document.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${id}`, { headers: { cookie: a.cookie } })).json());
      expect((await get(pdfId)).pipeline.numbers).toMatchObject({ source: "xbrl", state: "not_needed", coveredByXbrl: [xbrlId], waitingOn: [] });
      // Waiting: it names its own company's unsettled instance only, never the stranger's.
      await ctx.db.update(schema.document).set({ intakeState: "identifying" }).where(eq(schema.document.id, xbrlId));
      await ctx.db.update(schema.document).set({ intakeState: "waiting_for_xbrl" }).where(eq(schema.document.id, pdfId));
      expect((await get(pdfId)).pipeline.numbers).toMatchObject({ state: "waiting", reason: "waiting_for_xbrl", waitingOn: [xbrlId] });
    });

    it("a manual re-read of a results PDF shows now, from the PDF, until the job finishes", async () => {
      const { extract, a, pdfId } = await seedCovered("d19@example.com", [BOTH[0]!]);
      const get = async () =>
        Document.parse(await (await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${pdfId}`, { headers: { cookie: a.cookie } })).json());
      expect((await get()).pipeline.numbers.state).toBe("not_needed");
      expect((await extract()).status).toBe(202);
      expect((await get()).pipeline.numbers).toMatchObject({ source: "pdf", state: "now", reason: null });
      await ctx.db.update(schema.job).set({ state: "succeeded" }).where(eq(schema.job.subjectId, pdfId));
      expect((await get()).pipeline.numbers.state).toBe("not_needed");
    });

    it("a PDF waiting for XBRL names the instances it waits on", async () => {
      const { a, pdfId, xbrlId } = await seedCovered("d15@example.com", BOTH);
      await ctx.db.update(schema.document).set({ intakeState: "identifying" }).where(eq(schema.document.id, xbrlId));
      await ctx.db.update(schema.document).set({ intakeState: "waiting_for_xbrl" }).where(eq(schema.document.id, pdfId));
      const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${pdfId}`, { headers: { cookie: a.cookie } });
      expect(Document.parse(await res.json()).pipeline.numbers).toMatchObject({
        source: null, state: "waiting", reason: "waiting_for_xbrl", waitingOn: [xbrlId], coveredByXbrl: [],
      });
    });

    it("a results PDF the XBRL covers only in part gets a document.extract job, as today", async () => {
      const { extract, extractJobs } = await seedCovered("d13@example.com", [BOTH[0]!]);
      const res = await extract();
      expect(res.status).toBe(202);
      expect(ExtractResponse.parse(await res.json()).job.type).toBe(JobTypes.DOCUMENT_EXTRACT);
      expect(await extractJobs()).toHaveLength(1);
    });
  });

  it("finalize requires the object to exist, enqueues verify, and is idempotent", async () => {
    const a = await ctx.signUp("d3@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = (body as { document: { id: string } }).document.id;
    const key = `workspaces/${a.workspaceId}/documents/${docId}/original.pdf`;

    const missing = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("INVALID_STATE");

    await ctx.store.put(key, new TextEncoder().encode("%PDF-1.4"), "application/pdf");
    const first = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(first.status).toBe(200);
    const f = FinalizeResponse.parse(await first.json());
    expect(f.document.state).toBe("uploaded");
    expect(f.job.type).toBe(JobTypes.DOCUMENT_VERIFY);
    expect(ctx.dispatcher.enqueued.some((j) => j.id === f.job.id)).toBe(true);

    const second = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/finalize`, post(a.cookie, {}));
    expect(second.status).toBe(200);
    expect(FinalizeResponse.parse(await second.json()).job.id).toBe(f.job.id);
  });

  it("every item of the list carries a pipeline that parses as a DocumentPipeline", async () => {
    const a = await ctx.signUp("d16@example.com");
    for (let i = 0; i < 3; i++) await createUpload(a.workspaceId, a.cookie);
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents`, { headers: { cookie: a.cookie } });
    const body = (await res.json()) as { items: { pipeline: unknown; state: string }[] };
    expect(body.items).toHaveLength(3);
    for (const item of body.items) {
      expect(DocumentPipeline.parse(item.pipeline)).toMatchObject({
        stored: "now", identified: "waiting", numbers: { state: "waiting", reason: "not_identified" }, text: { state: "waiting", ahead: null },
      });
    }
  });

  it("list is paginated and scoped; detail is 404 across workspaces", async () => {
    const a = await ctx.signUp("d4@example.com");
    const b = await ctx.signUp("d5@example.com");
    for (let i = 0; i < 3; i++) await createUpload(a.workspaceId, a.cookie);
    await createUpload(b.workspaceId, b.cookie);

    const p1 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2`, { headers: { cookie: a.cookie } });
    const page = paginated(Document).parse(await p1.json());
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const p2 = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents?limit=2&cursor=${page.nextCursor}`, { headers: { cookie: a.cookie } });
    expect(paginated(Document).parse(await p2.json()).items).toHaveLength(1);

    const foreign = await ctx.app.request(`/v1/workspaces/${b.workspaceId}/documents/${page.items[0]!.id}`, { headers: { cookie: b.cookie } });
    expect(foreign.status).toBe(404);
  });

  it("malformed :id returns 404, not 500", async () => {
    const a = await ctx.signUp("d7@example.com");
    const res = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/not-a-uuid`, { headers: { cookie: a.cookie } });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("sanitises the original name but keeps unicode", async () => {
    const a = await ctx.signUp("d8@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie, 1234, "वार्षिक-रिपोर्ट/2024.pdf");
    const parsed = CreateUploadResponse.parse(body);
    expect(parsed.document.originalName).toBe("वार्षिक-रिपोर्ट_2024.pdf");
  });

  it("download is only available once stored", async () => {
    const a = await ctx.signUp("d6@example.com");
    const { body } = await createUpload(a.workspaceId, a.cookie);
    const docId = (body as { document: { id: string } }).document.id;
    const notYet = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(notYet.status).toBe(409);
    await ctx.db.update(schema.document).set({ state: "stored" }).where(eq(schema.document.id, docId));
    const ok = await ctx.app.request(`/v1/workspaces/${a.workspaceId}/documents/${docId}/download`, { headers: { cookie: a.cookie } });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain("memory://download/");
  });
});
