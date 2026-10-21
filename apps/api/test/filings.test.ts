import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceFilings, XBRL_PDF_CHECK_VERSION, JobTypes } from "@maester/contracts";
import { schema } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

const url = (ws: string) => `/v1/workspaces/${ws}/filings`;
type W = { workspaceId: string; userId: string };

/** One filing: a results PDF that read, an instance of the same company and period that read with facts, and the instance's checks. */
async function seedFiling(w: W, companyId: string, periodEnd: string) {
  const pdf = crypto.randomUUID();
  const xbrl = crypto.randomUUID();
  for (const [id, format] of [[pdf, "pdf"], [xbrl, "xbrl"]] as const) {
    await ctx.db.insert(schema.document).values({
      id, workspaceId: w.workspaceId, companyId, originalName: `r.${format}`, declaredSize: 10, declaredMime: format === "pdf" ? "application/pdf" : "text/xml", format,
      storageKey: `workspaces/${w.workspaceId}/documents/${id}/original.${format}`, state: "stored", intakeState: "read", createdByUserId: w.userId,
    });
  }
  const pdfClass = crypto.randomUUID();
  const xbrlClass = crypto.randomUUID();
  await ctx.db.insert(schema.documentClassification).values([
    {
      id: pdfClass, workspaceId: w.workspaceId, documentId: pdf, kind: "financial_results", companyId, periodEnd, resultsSpan: "half_year", setBy: "maester",
      statementsFound: [{ statement: "income_statement", basis: "consolidated", pages: [2] }, { statement: "cash_flow", basis: "consolidated", pages: [4] }], readsUnderId: pdfClass,
    },
    {
      id: xbrlClass, workspaceId: w.workspaceId, documentId: xbrl, kind: "financial_results", companyId, periodEnd, resultsSpan: "quarter", setBy: "maester",
      basis: "consolidated", xbrlFormat: "in-capmkt/ind_as", readsUnderId: xbrlClass,
    },
  ]);
  const revision = async (documentId: string, classificationId: string, source: "pdf" | "xbrl") => {
    const jobId = crypto.randomUUID();
    await ctx.db.insert(schema.job).values({
      id: jobId, workspaceId: w.workspaceId, type: source === "pdf" ? JobTypes.DOCUMENT_EXTRACT : JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: documentId,
      idempotencyKey: `k-${jobId}`, state: "succeeded",
    });
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.extractionRevision).values({
      id, workspaceId: w.workspaceId, documentId, jobId, classificationId, source, state: "complete", pipelineVersion: "p", model: "m", promptVersion: "v", pageCount: 1,
      coverage: { statements: [] },
    });
    return id;
  };
  await revision(pdf, pdfClass, "pdf");
  const rev = await revision(xbrl, xbrlClass, "xbrl");
  const facts = (["income_statement", "balance_sheet"] as const).flatMap((statement) =>
    [0, 1, 2].map((i) => ({
      id: crypto.randomUUID(), workspaceId: w.workspaceId, revisionId: rev, companyId, statement, basis: "consolidated" as const, section: "s", lineOrder: i, reportedLabel: "line",
      isSubtotal: false, periodLabel: "p", periodEnd, span: statement === "balance_sheet" ? null : ("quarter" as const), reportedText: "", valueStatus: "unparsed" as const,
    })),
  );
  await ctx.db.insert(schema.financialFact).values(facts);
  await ctx.db.insert(schema.extractionCheck).values(
    facts.map((f) => ({
      id: crypto.randomUUID(), workspaceId: w.workspaceId, revisionId: rev, checkType: "xbrl_in_pdf" as const, statement: f.statement, basis: f.basis, periodLabel: "p",
      subjectLabel: "line", status: "passed" as const, detail: "", factId: f.id, pdfDocumentId: pdf, pdfClassificationId: pdfClass, pageIndex: 2, checkVersion: XBRL_PDF_CHECK_VERSION,
    })),
  );
  return { pdf, xbrl };
}

async function seedCompany(w: W, name: string) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.company).values({ id, workspaceId: w.workspaceId, displayName: name, country: "IN", createdByUserId: w.userId });
  return id;
}

/** `filings` filings, a held file, two unclassified files and a duplicate: the same mix whatever `filings` is. */
async function seedMix(w: W, filings: number) {
  const companyId = await seedCompany(w, "Synthetic Cements Limited");
  const first = await seedFiling(w, companyId, "2025-09-30");
  for (let i = 1; i < filings; i++) await seedFiling(w, companyId, new Date(Date.UTC(2000, 0, 1 + i)).toISOString().slice(0, 10));
  const held = crypto.randomUUID();
  const loose = crypto.randomUUID();
  const loose2 = crypto.randomUUID();
  const dup = crypto.randomUUID();
  for (const [id, intakeState, over] of [
    [held, "needs_company", {}],
    [loose, null, { state: "verifying" as const }],
    [loose2, null, { state: "uploaded" as const }],
    [dup, "duplicate", { duplicateOfDocumentId: first.pdf }],
  ] as const) {
    await ctx.db.insert(schema.document).values({
      id, workspaceId: w.workspaceId, originalName: "x.pdf", declaredSize: 10, declaredMime: "application/pdf", storageKey: `workspaces/${w.workspaceId}/documents/${id}/original.pdf`,
      state: "stored", intakeState, createdByUserId: w.userId, ...over,
    });
  }
  await ctx.db.insert(schema.documentClassification).values({
    id: crypto.randomUUID(), workspaceId: w.workspaceId, documentId: held, kind: "financial_results", periodEnd: "2025-09-30", setBy: "maester", bseCode: "500999",
    companyNameAsPrinted: "Held Limited",
  });
  return { companyId, ...first, held, loose, loose2, dup };
}

describe("GET /filings", () => {
  it("needs a session, and answers 404 for another user's workspace", async () => {
    const a = await ctx.signUp("filings-auth-a@example.com");
    const b = await ctx.signUp("filings-auth-b@example.com");
    expect((await ctx.app.request(url(a.workspaceId))).status).toBe(401);
    expect((await ctx.app.request(url(a.workspaceId), { headers: { cookie: b.cookie } })).status).toBe(404);
  });

  it("answers a body that parses as WorkspaceFilings, with the filing, the held group, the loose file and the duplicate in place", async () => {
    const a = await ctx.signUp("filings-body@example.com");
    const seeded = await seedMix(a, 1);
    const res = await ctx.app.request(url(a.workspaceId), { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const body = WorkspaceFilings.parse(await res.json());

    expect(body.companies).toHaveLength(1);
    expect(body.companies[0]!.company).toMatchObject({ id: seeded.companyId, isin: null });
    const [filing] = body.companies[0]!.filings;
    expect(body.companies[0]!.filings).toHaveLength(1);
    expect(filing).toMatchObject({ kind: "financial_results", periodEnd: "2025-09-30", spans: ["quarter", "half_year"], settled: false });
    expect(filing!.files.map((f) => f.documentId).sort()).toEqual([seeded.pdf, seeded.xbrl].sort());
    expect(filing!.files.find((f) => f.documentId === seeded.pdf)!.duplicates).toEqual([seeded.dup]);
    const consolidated = filing!.sources.find((s) => s.basis === "consolidated")!;
    expect(consolidated.statements.find((s) => s.statement === "income_statement")).toMatchObject({
      source: "xbrl", xbrlDocumentId: seeded.xbrl, xbrlSpans: ["quarter"], pdfDocumentId: seeded.pdf, pdfPages: [2], inPdf: { found: 3, checked: 3, notFound: [], notChecked: null },
    });
    expect(consolidated.statements.find((s) => s.statement === "balance_sheet")).toMatchObject({ source: "xbrl", xbrlSpans: [] });
    expect(consolidated.statements.find((s) => s.statement === "cash_flow")).toMatchObject({ source: "pdf", reason: "xbrl_lacks_statement", pdfPages: [4] });

    expect(body.held).toHaveLength(1);
    expect(body.held[0]).toMatchObject({ key: "bse:500999", files: 1, filings: 1, documentIds: [seeded.held], matches: [] });
    expect(body.unsorted.map((f) => f.documentId).sort()).toEqual([seeded.loose, seeded.loose2].sort());
    expect(body.unsorted[0]!.pipeline.stored).toBe("now");
  });

  it("never shows another workspace's files", async () => {
    const a = await ctx.signUp("filings-iso-a@example.com");
    const b = await ctx.signUp("filings-iso-b@example.com");
    await seedMix(b, 1);
    const body = WorkspaceFilings.parse(await (await ctx.app.request(url(a.workspaceId), { headers: { cookie: a.cookie } })).json());
    expect(body).toEqual({ companies: [], held: [], unsorted: [] });
  });

  it("answers a workspace with nothing in it", async () => {
    const a = await ctx.signUp("filings-empty@example.com");
    const res = await ctx.app.request(url(a.workspaceId), { headers: { cookie: a.cookie } });
    expect(WorkspaceFilings.parse(await res.json())).toEqual({ companies: [], held: [], unsorted: [] });
  });

  it("runs the same queries for 100 documents as for a few of the same mix", async () => {
    const small = await ctx.signUp("filings-count-small@example.com");
    const large = await ctx.signUp("filings-count-large@example.com");
    await seedMix(small, 1);
    await seedMix(large, 48);
    const counted = async (w: { workspaceId: string; cookie: string }) => {
      const pool = ctx.db.$client;
      const original = pool.query.bind(pool);
      let n = 0;
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        n += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        const res = await ctx.app.request(url(w.workspaceId), { headers: { cookie: w.cookie } });
        expect(res.status).toBe(200);
        return { n, body: WorkspaceFilings.parse(await res.json()) };
      } finally {
        (pool as { query: unknown }).query = original;
      }
    };
    const one = await counted(small);
    const many = await counted(large);
    expect(many.body.companies[0]!.filings).toHaveLength(48);
    // 48 filings of two files, a held file, two loose files and a duplicate: 100 documents, every one placed once.
    const { companies, held, unsorted } = many.body;
    const files = [...companies.flatMap((c) => c.filings.flatMap((f) => f.files)), ...unsorted];
    const placed = files.length + held.reduce((n, h) => n + h.files, 0) + files.reduce((n, f) => n + f.duplicates.length, 0);
    expect(companies[0]!.filings.reduce((n, f) => n + f.files.length, 0)).toBe(96);
    expect(placed).toBe(100);
    expect(one.n).toBeGreaterThan(0);
    expect(many.n).toBe(one.n);
    expect(many.n).toBeLessThanOrEqual(30);
  });
});
