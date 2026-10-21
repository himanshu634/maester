import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JobTypes, XbrlEvent, type XbrlClassification } from "@maester/contracts";
import { schema } from "@maester/db";
import type * as Jobs from "@maester/jobs";
import { readVersion, redecidePdfsAfterXbrl } from "@maester/jobs";
import { HttpExtractorClient, type ExtractorClient } from "../src/extractor.js";
import { answersFromPdf, answersFromXbrl } from "../src/jobs/classification-answers.js";
import { documentClassify, writeClassification } from "../src/jobs/document-classify.js";
import { JobFailure } from "../src/jobs/types.js";
import { runJob } from "../src/run.js";
import { createWorkerContext, seedJob, seedWorkspace } from "./context.js";

vi.mock("@maester/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof Jobs>();
  return { ...actual, redecidePdfsAfterXbrl: vi.fn(actual.redecidePdfsAfterXbrl) };
});

const fixture = (name: string) => readFileSync(new URL(`../../../packages/contracts/fixtures/classification/${name}`, import.meta.url), "utf8");
const ANNUAL = fixture("result-annual-report.json");
// The Task 6 stream's classification: an unmapped standalone banking instance of "SYNTHETIC BANK LIMITED", BSE code 500998.
const BANK: XbrlClassification = (() => {
  const url = new URL("../../../packages/contracts/fixtures/xbrl/stream-classify.ndjson", import.meta.url);
  const event = XbrlEvent.parse(JSON.parse(readFileSync(url, "utf8").trim().split("\n").at(-1)!));
  if (event.type !== "classification") throw new Error("not a classification");
  return event.result;
})();
/** A mapped Ind AS instance, consolidated, of the company with BSE code 500999. */
const INDAS: XbrlClassification = {
  ...BANK,
  format: { family: "in-capmkt", kind: "ind_as", id: "in-capmkt/ind_as", mapped: true },
  basis: "consolidated",
  companyNameAsPrinted: "SYNTHETIC CEMENTS LIMITED",
  bseCode: "500999",
  nseSymbol: "SYNCEM",
  isin: "INE999Z01011",
  statementsFound: [{ statement: "income_statement", basis: "consolidated", pages: [] }],
  evidence: [
    { field: "kind", ruleId: "xbrl.family", element: null, context: null, quote: "in-capmkt" },
    { field: "company", ruleId: "xbrl.identity.name", element: "NameOfTheCompany", context: "OneD", quote: "SYNTHETIC CEMENTS LIMITED" },
    { field: "identifier", ruleId: "xbrl.identity.scrip_code", element: "ScripCode", context: "OneD", quote: "500999" },
    { field: "period", ruleId: "xbrl.identity.period_end", element: "DateOfEndOfReportingPeriod", context: "OneD", quote: "2025-09-30" },
  ],
  warnings: [],
};
let xbrlAnswer: () => Promise<XbrlClassification> = async () => INDAS;
let xbrlSeen: { documentId: string; mode: string; bytes: number }[] = [];
const SECRET = "extractor-test-secret";

type Reply = (res: ServerResponse) => void;
let reply: Reply;
let seen: IncomingMessage["headers"][] = [];
let server: Server;
let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
const json = (body: string, status = 200): Reply => (res) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body); };
const withKind = (kind: string, otherType: string | null = null) => {
  const body = JSON.parse(ANNUAL);
  Object.assign(body.result, { kind, otherType, periodEnd: null, periodLabel: null });
  return JSON.stringify(body);
};

beforeAll(async () => {
  server = createServer((req, res) => { req.resume(); req.on("end", () => { seen.push(req.headers); reply(res); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const http = new HttpExtractorClient(url, { kind: "secret", secret: SECRET }, 10_000);
  // PDFs go over HTTP to the local server; an XBRL instance is answered by `xbrlAnswer`, as a fake extractor.
  const extractor = {
    classify: (i: Parameters<ExtractorClient["classify"]>[0]) => http.classify(i),
    extract: (i: Parameters<ExtractorClient["extract"]>[0], on: Parameters<ExtractorClient["extract"]>[1]) => http.extract(i, on),
    xbrlPdfCheck: (i: Parameters<ExtractorClient["xbrlPdfCheck"]>[0]) => http.xbrlPdfCheck(i),
    xbrl: async (i: { instance: Uint8Array; documentId: string; mode: string }) => {
      xbrlSeen.push({ documentId: i.documentId, mode: i.mode, bytes: i.instance.length });
      return xbrlAnswer();
    },
  } as unknown as ExtractorClient;
  ctx = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify }, { extractor });
});
afterAll(async () => { await ctx.close(); await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => {
  seen = [];
  reply = json(ANNUAL);
  xbrlAnswer = async () => INDAS;
  xbrlSeen = [];
  vi.mocked(redecidePdfsAfterXbrl).mockClear();
});

async function seedStored(
  opts: { companies?: string[]; uploadCompany?: boolean; xbrl?: boolean; companyCodes?: Partial<typeof schema.company.$inferInsert>; sizeBytes?: number } = {},
) {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyIds: string[] = [];
  for (const displayName of opts.companies ?? []) {
    const id = crypto.randomUUID();
    await ctx.db.insert(schema.company).values({ id, workspaceId, displayName, country: "IN", createdByUserId: userId, ...opts.companyCodes });
    companyIds.push(id);
  }
  const id = crypto.randomUUID();
  const storageKey = `workspaces/${workspaceId}/documents/${id}/original.${opts.xbrl ? "xml" : "pdf"}`;
  await ctx.db.insert(schema.document).values({
    id, workspaceId, companyId: opts.uploadCompany ? companyIds[0]! : null, originalName: opts.xbrl ? "results.xml" : "ar.pdf", declaredSize: 10,
    declaredMime: opts.xbrl ? "application/xml" : "application/pdf", format: opts.xbrl ? "xbrl" : "pdf", storageKey, state: "stored",
    sizeBytes: opts.sizeBytes ?? 10, intakeState: "identifying", createdByUserId: userId,
  });
  await ctx.store.put(storageKey, new TextEncoder().encode(opts.xbrl ? "<xbrl/>" : "%PDF-1.4 x"), opts.xbrl ? "application/xml" : "application/pdf");
  return { workspaceId, id, companyIds };
}
async function classify(workspaceId: string, docId: string) {
  const jobId = await seedJob(ctx.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: docId });
  const res = await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
  const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
  const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, docId));
  const rows = await ctx.db.select().from(schema.documentClassification).where(eq(schema.documentClassification.documentId, docId));
  return { res, job: job!, doc: doc!, rows };
}

describe("document.classify", () => {
  it("stores the answers with their evidence, matches the company by name and starts the read", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const { job, doc, rows } = await classify(d.workspaceId, d.id);
    expect(seen[0]!["x-extractor-secret"]).toBe(SECRET);
    expect(job.state).toBe("succeeded");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ kind: "annual_report", companyId: d.companyIds[0], setBy: "maester", readsUnderId: row.id, periodEnd: "2026-03-31" });
    expect(row).toMatchObject({ basis: null, isin: null, xbrlFormat: null });
    expect(xbrlSeen).toEqual([]);
    expect(redecidePdfsAfterXbrl).not.toHaveBeenCalled();
    const pdfEvidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(pdfEvidence.every((e) => e.element === null && e.context === null)).toBe(true);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(evidence.map((e) => e.field).sort()).toEqual(["company", "identifier", "kind", "period", "statements"]);
    expect(doc).toMatchObject({ intakeState: "reading", companyId: d.companyIds[0] });
    const read = ctx.dispatcher.enqueued.find((j) => j.subjectId === d.id && j.type === JobTypes.DOCUMENT_EXTRACT);
    expect(read!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${d.id}:${readVersion(row.id)}`);
  });

  it("holds when the company is new or ambiguous", async () => {
    const none = await seedStored();
    expect((await classify(none.workspaceId, none.id)).doc.intakeState).toBe("needs_company");
    const twins = await seedStored({ companies: ["Synthetic Cements Ltd", "Synthetic Cements Limited"] });
    const r = await classify(twins.workspaceId, twins.id);
    expect(r.doc.intakeState).toBe("needs_company");
    expect(r.rows[0]!.readsUnderId).toBeNull();
  });

  it("uses the company given at upload as the investor's answer", async () => {
    const d = await seedStored({ companies: ["Somebody Else Ltd"], uploadCompany: true });
    const { rows, doc } = await classify(d.workspaceId, d.id);
    expect(rows[0]!.companyId).toBe(d.companyIds[0]);
    expect(doc.intakeState).toBe("reading");
    const investor = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.source, "investor"));
    expect(investor.some((e) => e.classificationId === rows[0]!.id && e.field === "company")).toBe(true);
  });

  it("on a re-run, a company Maester matched before is matched again, not taken as the investor's", async () => {
    // The document's company came from Maester's earlier match (rule evidence), not from the investor.
    const d = await seedStored({ companies: ["Somebody Else Ltd", "Synthetic Cements Ltd"], uploadCompany: true });
    const [earlier, matched] = d.companyIds as [string, string];
    const prev = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({
      id: prev, workspaceId: d.workspaceId, documentId: d.id, kind: "annual_report", setBy: "maester", companyId: earlier, createdAt: new Date(Date.now() - 60_000),
    });
    await ctx.db.insert(schema.classificationEvidence).values({
      id: crypto.randomUUID(), workspaceId: d.workspaceId, classificationId: prev, field: "company", source: "rule", ruleId: "company.cover_line", pageIndex: 0, quote: "Somebody Else Ltd", textLayerMatch: true,
    });
    const { rows } = await classify(d.workspaceId, d.id);
    const row = rows.find((r) => r.id !== prev)!;
    expect(row.companyId).toBe(matched);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(evidence.filter((e) => e.source === "investor")).toEqual([]);
  });

  it("on a re-run, a company the investor gave is kept as their answer", async () => {
    const d = await seedStored({ companies: ["Somebody Else Ltd", "Synthetic Cements Ltd"] });
    const [given] = d.companyIds as [string, string];
    const prev = crypto.randomUUID();
    await ctx.db.insert(schema.documentClassification).values({
      id: prev, workspaceId: d.workspaceId, documentId: d.id, kind: "annual_report", setBy: "investor", companyId: given, createdAt: new Date(Date.now() - 60_000),
    });
    await ctx.db.insert(schema.classificationEvidence).values({
      id: crypto.randomUUID(), workspaceId: d.workspaceId, classificationId: prev, field: "company", source: "investor", ruleId: null, pageIndex: null, quote: null, textLayerMatch: null,
    });
    const { rows } = await classify(d.workspaceId, d.id);
    const row = rows.find((r) => r.id !== prev)!;
    expect(row.companyId).toBe(given);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, row.id));
    expect(evidence.filter((e) => e.source === "investor").map((e) => e.field)).toEqual(["company"]);
  });

  it("keeps other documents and holds not_sure", async () => {
    reply = json(withKind("other", "shareholding_pattern"));
    const other = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    expect((await classify(other.workspaceId, other.id)).doc.intakeState).toBe("kept");
    reply = json(withKind("not_sure"));
    const unsure = await seedStored();
    expect((await classify(unsure.workspaceId, unsure.id)).doc.intakeState).toBe("needs_kind");
  });

  it("a permanent error fails the job and marks identify_failed", async () => {
    reply = json(fixture("error-unreadable.json"));
    const d = await seedStored();
    const { job, doc } = await classify(d.workspaceId, d.id);
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "UNREADABLE_PDF" });
    expect(doc.intakeState).toBe("identify_failed");
  });

  it("an unavailable extractor is retried and leaves the document identifying", async () => {
    reply = json("{}", 503);
    const d = await seedStored();
    const { res, job, doc } = await classify(d.workspaceId, d.id);
    expect(res.body.outcome).toBe("retry");
    expect(job.lastErrorCode).toBe("EXTRACTOR_HTTP_503");
    expect(doc.intakeState).toBe("identifying");
  });

  it("an unreadable answer is a permanent INVALID_CLASSIFIER_RESULT", async () => {
    reply = json(JSON.stringify({ type: "result", result: { kind: "brochure" } }));
    const d = await seedStored();
    expect((await classify(d.workspaceId, d.id)).job.lastErrorCode).toBe("INVALID_CLASSIFIER_RESULT");
  });

  it("without an extractor it fails with CLASSIFIER_NOT_CONFIGURED", async () => {
    const bare = await createWorkerContext({ [JobTypes.DOCUMENT_CLASSIFY]: documentClassify });
    try {
      const { workspaceId, userId } = await seedWorkspace(bare.db);
      const id = crypto.randomUUID();
      await bare.db.insert(schema.document).values({
        id, workspaceId, originalName: "a.pdf", declaredSize: 10, declaredMime: "application/pdf",
        storageKey: `workspaces/${workspaceId}/documents/${id}/original.pdf`, state: "stored", intakeState: "identifying", createdByUserId: userId,
      });
      const jobId = await seedJob(bare.db, workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: id });
      await runJob(bare, JobTypes.DOCUMENT_CLASSIFY, jobId);
      const [job] = await bare.db.select().from(schema.job).where(eq(schema.job.id, jobId));
      const [doc] = await bare.db.select().from(schema.document).where(eq(schema.document.id, id));
      expect(job!.lastErrorCode).toBe("CLASSIFIER_NOT_CONFIGURED");
      expect(doc!.intakeState).toBe("identify_failed");
    } finally {
      await bare.close();
    }
  });

  it("writeClassification is idempotent per job", async () => {
    const d = await seedStored();
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    const result = answersFromPdf(JSON.parse(ANNUAL).result);
    const a = await writeClassification(ctx.db, job!, { id: d.id, investorCompanyId: null }, result, null);
    const b = await writeClassification(ctx.db, job!, { id: d.id, investorCompanyId: null }, result, null);
    expect(b.id).toBe(a.id);
    const evidence = await ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, a.id));
    expect(evidence).toHaveLength(5);
  });
  it("re-running a job whose classification was already written still decides the intake", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    await writeClassification(ctx.db, job!, { id: d.id, investorCompanyId: null }, answersFromPdf(JSON.parse(ANNUAL).result), d.companyIds[0]!);
    const [before] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(before!.intakeState).toBe("identifying");
    await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
    const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(doc!.intakeState).toBe("reading");
    expect(ctx.dispatcher.enqueued.filter((j) => j.subjectId === d.id && j.type === JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("re-running a job whose document has since been read leaves it read and starts no read", async () => {
    const d = await seedStored({ companies: ["Synthetic Cements Ltd"] });
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    await writeClassification(ctx.db, job!, { id: d.id, investorCompanyId: null }, answersFromPdf(JSON.parse(ANNUAL).result), d.companyIds[0]!);
    await ctx.db.update(schema.document).set({ intakeState: "read" }).where(eq(schema.document.id, d.id));
    await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
    const [after] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(after!.state).toBe("succeeded");
    expect(doc!.intakeState).toBe("read");
    expect(ctx.dispatcher.enqueued.filter((j) => j.subjectId === d.id)).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
});

describe("document.classify of an XBRL instance", () => {
  const rowEvidence = (classificationId: string) =>
    ctx.db.select().from(schema.classificationEvidence).where(eq(schema.classificationEvidence.classificationId, classificationId));

  it("classifies it as financial results, matches the company by BSE code and decides the intake", async () => {
    const d = await seedStored({ xbrl: true, companies: ["Synthetic Cements Ltd"], companyCodes: { bseCode: "500999" } });
    const { job, doc, rows } = await classify(d.workspaceId, d.id);
    expect(job.state).toBe("succeeded");
    expect(xbrlSeen).toEqual([{ documentId: d.id, mode: "classify", bytes: 7 }]);
    expect(seen).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "financial_results", resultsSpan: "quarter", periodEnd: "2025-09-30", companyId: d.companyIds[0], setBy: "maester", readsUnderId: rows[0]!.id,
    });
    // decideIntake saw this classification: the document took its company and its state.
    expect(doc).toMatchObject({ intakeState: "reading", companyId: d.companyIds[0] });
    expect(redecidePdfsAfterXbrl).toHaveBeenCalledWith(ctx.db, ctx.dispatcher, d.workspaceId);
  });

  it("matches the company by ISIN when no code of it is stored", async () => {
    const d = await seedStored({ xbrl: true, companies: ["Another Name Ltd"], companyCodes: { isin: "INE999Z01011" } });
    const { rows } = await classify(d.workspaceId, d.id);
    expect(rows[0]!.companyId).toBe(d.companyIds[0]);
  });

  it("with no company it is needs_company, and its evidence names the element and context", async () => {
    const d = await seedStored({ xbrl: true });
    const { doc, rows } = await classify(d.workspaceId, d.id);
    expect(doc.intakeState).toBe("needs_company");
    expect(rows[0]!.readsUnderId).toBeNull();
    const evidence = await rowEvidence(rows[0]!.id);
    expect(evidence.find((e) => e.field === "identifier")).toMatchObject({
      source: "rule", ruleId: "xbrl.identity.scrip_code", element: "ScripCode", context: "OneD", pageIndex: null, quote: "500999", textLayerMatch: null,
    });
    expect(evidence.find((e) => e.field === "kind")).toMatchObject({ ruleId: "xbrl.family", element: null, context: null });
    expect(evidence.map((e) => e.field).sort()).toEqual(["company", "identifier", "kind", "period"]);
  });

  it("stores the instance's identity, format and basis, and no model", async () => {
    const d = await seedStored({ xbrl: true });
    const { rows } = await classify(d.workspaceId, d.id);
    expect(rows[0]).toMatchObject({
      isin: "INE999Z01011", xbrlFormat: "in-capmkt/ind_as", basis: "consolidated", rulesVersion: "xbrl-1", model: null, promptVersion: "in-capmkt/ind_as@1",
      bseCode: "500999", nseSymbol: "SYNCEM", cin: null, otherType: null, companyNameAsPrinted: "SYNTHETIC CEMENTS LIMITED",
    });
  });

  it("an unmapped standalone banking instance keeps its format and basis though no statement is found", async () => {
    xbrlAnswer = async () => BANK;
    const d = await seedStored({ xbrl: true });
    const { rows } = await classify(d.workspaceId, d.id);
    expect(rows[0]).toMatchObject({ xbrlFormat: "in-capmkt/banking", basis: "standalone", statementsFound: [], isin: "INE998Z01012" });
    expect(rows[0]!.warnings).toEqual([{ code: "XBRL_FORMAT_UNMAPPED", message: "in-capmkt/banking" }]);
  });

  it("a bank with no printed name is matched by its BSE code", async () => {
    xbrlAnswer = async () => ({ ...BANK, companyNameAsPrinted: null });
    const d = await seedStored({ xbrl: true, companies: ["Synthetic Bank Ltd"], companyCodes: { bseCode: "500998" } });
    const { rows, doc } = await classify(d.workspaceId, d.id);
    expect(rows[0]!.companyId).toBe(d.companyIds[0]);
    expect(doc.intakeState).toBe("reading");
  });

  it("an instance of both bases is held as needs_kind with its warning", async () => {
    xbrlAnswer = async () => ({
      ...INDAS, kind: "not_sure", basis: "unknown", resultsSpan: null, periodEnd: null, periodLabel: null,
      warnings: [{ code: "XBRL_MIXED_BASIS", message: "both" }],
    });
    const d = await seedStored({ xbrl: true, companies: ["Synthetic Cements Ltd"], companyCodes: { bseCode: "500999" } });
    const { doc, rows } = await classify(d.workspaceId, d.id);
    expect(doc.intakeState).toBe("needs_kind");
    expect(rows[0]).toMatchObject({ kind: "not_sure", basis: "unknown", readsUnderId: null });
    expect(rows[0]!.warnings).toEqual([{ code: "XBRL_MIXED_BASIS", message: "both" }]);
  });

  it("is not stopped by the PDF size limit; the extractor's own limit applies", async () => {
    const d = await seedStored({ xbrl: true, sizeBytes: ctx.env.EXTRACT_MAX_BYTES + 1 });
    const { job, rows } = await classify(d.workspaceId, d.id);
    expect(job.state).toBe("succeeded");
    expect(rows).toHaveLength(1);
  });

  it("XBRL_UNREADABLE fails the job without a retry, leaves identify_failed and releases waiting PDFs", async () => {
    xbrlAnswer = async () => { throw new JobFailure("XBRL_UNREADABLE", "the instance could not be read", false); };
    const d = await seedStored({ xbrl: true });
    const { job, doc, res } = await classify(d.workspaceId, d.id);
    expect(res.body.outcome).not.toBe("retry");
    expect(job).toMatchObject({ state: "failed", lastErrorCode: "XBRL_UNREADABLE", attempt: 1 });
    expect(doc.intakeState).toBe("identify_failed");
    expect(redecidePdfsAfterXbrl).toHaveBeenCalledWith(ctx.db, ctx.dispatcher, d.workspaceId);
  });

  it("a retried job whose classification was written decides again and releases waiting PDFs, without asking the extractor", async () => {
    const d = await seedStored({ xbrl: true, companies: ["Synthetic Cements Ltd"] });
    const jobId = await seedJob(ctx.db, d.workspaceId, { type: JobTypes.DOCUMENT_CLASSIFY, subjectType: "document", subjectId: d.id });
    const [job] = await ctx.db.select().from(schema.job).where(eq(schema.job.id, jobId));
    await writeClassification(ctx.db, job!, { id: d.id, investorCompanyId: null }, answersFromXbrl(INDAS), d.companyIds[0]!);
    await runJob(ctx, JobTypes.DOCUMENT_CLASSIFY, jobId);
    const [doc] = await ctx.db.select().from(schema.document).where(eq(schema.document.id, d.id));
    expect(doc!.intakeState).toBe("reading");
    expect(xbrlSeen).toEqual([]);
    expect(redecidePdfsAfterXbrl).toHaveBeenCalledWith(ctx.db, ctx.dispatcher, d.workspaceId);
  });
});
