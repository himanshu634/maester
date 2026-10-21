import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobTypes } from "@maester/contracts";
import { getCurrentClassification, loadWorkspaceXbrlDocs, schema, type ClassificationRow } from "@maester/db";
import { decideIntake, readVersion, redecidePdfsAfterXbrl } from "@maester/jobs";
import { documentVerify } from "../src/jobs/document-verify.js";
import { startQueueRunner } from "../src/queue.js";
import { createWorkerContext, seedJob, seedWorkspace, waitFor } from "./context.js";

let ctx: Awaited<ReturnType<typeof createWorkerContext>>;
beforeAll(async () => { ctx = await createWorkerContext({ [JobTypes.DOCUMENT_VERIFY]: documentVerify }); });
afterAll(() => ctx.close());

const PERIOD = "2025-09-30";
type Pair = { statement: "income_statement" | "balance_sheet" | "cash_flow"; basis: "consolidated" | "standalone" | "unknown" };
const BOTH: Pair[] = [
  { statement: "income_statement", basis: "consolidated" },
  { statement: "income_statement", basis: "standalone" },
];
const CONSOLIDATED: Pair[] = [{ statement: "income_statement", basis: "consolidated" }];

type IntakeState = NonNullable<typeof schema.document.$inferInsert.intakeState>;
type DocState = typeof schema.document.$inferInsert.state;

interface Ws { workspaceId: string; userId: string; companyId: string; otherCompanyId: string }

async function seedWs(): Promise<Ws> {
  const { workspaceId, userId } = await seedWorkspace(ctx.db);
  const companyId = crypto.randomUUID();
  const otherCompanyId = crypto.randomUUID();
  await ctx.db.insert(schema.company).values([
    { id: companyId, workspaceId, displayName: `Synthetic Cements ${companyId}`, country: "IN", createdByUserId: userId, bseCode: "500999", nseSymbol: "SYNCEM", isin: "INE999Z01011" },
    { id: otherCompanyId, workspaceId, displayName: `Synthetic Steel ${otherCompanyId}`, country: "IN", createdByUserId: userId, bseCode: "500111" },
  ]);
  return { workspaceId, userId, companyId, otherCompanyId };
}

async function insertDoc(ws: Ws, format: "pdf" | "xbrl", state: DocState, intakeState: IntakeState | null, extra: Partial<typeof schema.document.$inferInsert> = {}) {
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.document).values({
    id, workspaceId: ws.workspaceId, originalName: format === "pdf" ? "results.pdf" : "results.xml", declaredSize: 10,
    declaredMime: format === "pdf" ? "application/pdf" : "application/xml", format,
    storageKey: `workspaces/${ws.workspaceId}/documents/${id}/original.${format === "pdf" ? "pdf" : "xml"}`,
    state, intakeState, createdByUserId: ws.userId, ...extra,
  });
  return id;
}

async function classify(ws: Ws, documentId: string, c: Partial<typeof schema.documentClassification.$inferInsert>): Promise<ClassificationRow> {
  const id = crypto.randomUUID();
  const kind = c.kind ?? "financial_results";
  const reads = (kind === "annual_report" || kind === "financial_results") && !!c.companyId;
  const [row] = await ctx.db.insert(schema.documentClassification).values({
    id, workspaceId: ws.workspaceId, documentId, kind: "financial_results", setBy: "maester", readsUnderId: reads ? id : null,
    createdAt: sql`clock_timestamp()`, ...c,
  }).returning();
  return row!;
}

/** A results PDF of the company for the period, with the statements it prints, still being identified. */
async function addPdf(ws: Ws, opts: { kind?: "financial_results" | "annual_report"; statements?: Pair[]; periodEnd?: string } = {}) {
  const id = await insertDoc(ws, "pdf", "stored", "identifying");
  const row = await classify(ws, id, {
    kind: opts.kind ?? "financial_results", companyId: ws.companyId, periodEnd: opts.periodEnd ?? PERIOD,
    statementsFound: (opts.statements ?? BOTH).map((p) => ({ ...p, pages: [2] })),
  });
  return { id, row };
}

/** An XBRL instance read under its classification, with facts in each pair of `coverage`. */
async function addReadXbrl(ws: Ws, coverage: Pair[], c: Partial<typeof schema.documentClassification.$inferInsert> = {}, extra: Partial<typeof schema.document.$inferInsert> = {}) {
  const id = await insertDoc(ws, "xbrl", "stored", "read", extra);
  const row = await classify(ws, id, { companyId: ws.companyId, periodEnd: PERIOD, bseCode: "500999", ...c });
  await writeXbrlRevision(ws, id, row.id, coverage);
  return { id, row };
}

async function writeXbrlRevision(ws: Ws, documentId: string, classificationId: string, coverage: Pair[]) {
  const jobId = await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_XBRL, subjectType: "document", subjectId: documentId, state: "succeeded" });
  const revisionId = crypto.randomUUID();
  await ctx.db.insert(schema.extractionRevision).values({
    id: revisionId, workspaceId: ws.workspaceId, documentId, jobId, classificationId, source: "xbrl", state: "complete",
    pipelineVersion: "xbrl-1", model: "xbrl-parser-1", promptVersion: "in-capmkt/ind_as@1", pageCount: 0, coverage: { statements: [] },
  });
  if (coverage.length) {
    await ctx.db.insert(schema.financialFact).values(coverage.flatMap((p, i) => [0, 1].map((n) => ({
      id: crypto.randomUUID(), workspaceId: ws.workspaceId, revisionId, companyId: ws.companyId, statement: p.statement, basis: p.basis,
      section: "s", lineOrder: i * 2 + n, reportedLabel: `line ${n}`, isSubtotal: false, periodLabel: "Quarter ended 30 Sep 2025",
      periodEnd: PERIOD, span: "quarter" as const, reportedText: "", valueStatus: "unparsed" as const,
    }))));
  }
}

const docOf = async (id: string) => (await ctx.db.select().from(schema.document).where(eq(schema.document.id, id)))[0]!;
const jobsOf = (id: string, type: string) =>
  ctx.db.select().from(schema.job).where(and(eq(schema.job.subjectId, id), eq(schema.job.type, type)));
const dispatchedFor = (id: string, type: string) => ctx.dispatcher.enqueued.filter((j) => j.subjectId === id && j.type === type);
const decide = (row: ClassificationRow, opts: Parameters<typeof decideIntake>[3] = { read: true }) => decideIntake(ctx.db, ctx.dispatcher, row, opts);

describe("decideIntake with XBRL", () => {
  it("an XBRL document with a read kind and a company gets reading and a document.xbrl job, never document.extract", async () => {
    const ws = await seedWs();
    const id = await insertDoc(ws, "xbrl", "stored", "identifying");
    const row = await classify(ws, id, { companyId: ws.companyId, periodEnd: PERIOD });
    expect(await decide(row)).toBe("reading");
    const [job] = await jobsOf(id, JobTypes.DOCUMENT_XBRL);
    expect(job!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_XBRL}:${id}:${readVersion(row.id)}`);
    expect(dispatchedFor(id, JobTypes.DOCUMENT_XBRL)).toHaveLength(1);
    expect(await jobsOf(id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
  });

  it("a results PDF whose XBRL is still being identified waits, and goes to Gemini once that XBRL fails", async () => {
    const ws = await seedWs();
    const xbrl = await insertDoc(ws, "xbrl", "stored", "identifying");
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("waiting_for_xbrl");
    expect(await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
    expect((await docOf(pdf.id)).intakeState).toBe("waiting_for_xbrl");

    await ctx.db.update(schema.document).set({ intakeState: "identify_failed" }).where(eq(schema.document.id, xbrl));
    expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId)).toBe(1);
    expect((await docOf(pdf.id)).intakeState).toBe("reading");
    const [job] = await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT);
    expect(job!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${pdf.id}:${readVersion(pdf.row.id)}`);
    expect(dispatchedFor(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
  });

  it("a results PDF whose consolidated and standalone XBRL are read is not read by Gemini: read, no document.extract job", async () => {
    const ws = await seedWs();
    await addReadXbrl(ws, [BOTH[0]!], { basis: "consolidated" });
    await addReadXbrl(ws, [BOTH[1]!], { basis: "standalone" });
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("read");
    expect(await docOf(pdf.id)).toMatchObject({ intakeState: "read", companyId: ws.companyId });
    expect(await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
    expect(dispatchedFor(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
  });

  it("a results PDF with only consolidated XBRL is read by Gemini", async () => {
    const ws = await seedWs();
    await addReadXbrl(ws, CONSOLIDATED, { basis: "consolidated" });
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("reading");
    expect(await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
  });

  it("an annual report never waits for results XBRL and is read as today", async () => {
    const ws = await seedWs();
    await insertDoc(ws, "xbrl", "stored", "identifying");
    await addReadXbrl(ws, BOTH, { periodEnd: "2026-03-31" });
    const ar = await addPdf(ws, { kind: "annual_report", periodEnd: "2026-03-31" });
    expect(await decide(ar.row)).toBe("reading");
    expect(await jobsOf(ar.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
  });

  it("the last XBRL settling releases the PDF, whatever order the PDF and the XBRL finish in", async () => {
    type Settle = (ws: Ws, xbrl: string) => Promise<void>;
    const settles: Record<string, { settle: Settle; expected: string }> = {
      read: {
        settle: async (ws, xbrl) => {
          const row = await classify(ws, xbrl, { companyId: ws.companyId, periodEnd: PERIOD });
          await writeXbrlRevision(ws, xbrl, row.id, BOTH);
          await ctx.db.update(schema.document).set({ intakeState: "read" }).where(eq(schema.document.id, xbrl));
        },
        expected: "read",
      },
      read_failed: {
        settle: async (ws, xbrl) => {
          await classify(ws, xbrl, { companyId: ws.companyId, periodEnd: PERIOD });
          await ctx.db.update(schema.document).set({ intakeState: "read_failed" }).where(eq(schema.document.id, xbrl));
        },
        expected: "reading",
      },
      identify_failed: {
        settle: async (_ws, xbrl) => { await ctx.db.update(schema.document).set({ intakeState: "identify_failed" }).where(eq(schema.document.id, xbrl)); },
        expected: "reading",
      },
      kept: {
        settle: async (ws, xbrl) => {
          await classify(ws, xbrl, { kind: "other", otherType: "announcement" });
          await ctx.db.update(schema.document).set({ intakeState: "kept" }).where(eq(schema.document.id, xbrl));
        },
        expected: "reading",
      },
      "confirmed for another company": {
        settle: async (ws, xbrl) => {
          // Still being read, but for another company: it can no longer be this PDF's.
          const row = await classify(ws, xbrl, { companyId: ws.otherCompanyId, periodEnd: PERIOD, setBy: "investor" });
          await decide(row);
          expect((await docOf(xbrl)).intakeState).toBe("reading");
        },
        expected: "reading",
      },
    };
    for (const [name, { settle, expected }] of Object.entries(settles)) {
      // The PDF decides first and waits; the XBRL settles; the release runs.
      const a = await seedWs();
      const xa = await insertDoc(a, "xbrl", "stored", "identifying");
      const pa = await addPdf(a);
      expect(await decide(pa.row), name).toBe("waiting_for_xbrl");
      await settle(a, xa);
      expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, a.workspaceId), name).toBe(1);
      expect((await docOf(pa.id)).intakeState, name).toBe(expected);

      // The XBRL settles first; the PDF decides after.
      const b = await seedWs();
      const xb = await insertDoc(b, "xbrl", "stored", "identifying");
      await settle(b, xb);
      expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, b.workspaceId), name).toBe(0);
      const pb = await addPdf(b);
      expect(await decide(pb.row), name).toBe(expected);

      for (const ws of [a, b]) {
        const waiting = await ctx.db.select().from(schema.document)
          .where(and(eq(schema.document.workspaceId, ws.workspaceId), eq(schema.document.intakeState, "waiting_for_xbrl")));
        expect(waiting, name).toHaveLength(0);
      }
      expect((await jobsOf(pa.id, JobTypes.DOCUMENT_EXTRACT)).length, name).toBe(expected === "reading" ? 1 : 0);
      expect((await jobsOf(pb.id, JobTypes.DOCUMENT_EXTRACT)).length, name).toBe(expected === "reading" ? 1 : 0);
    }
  });

  it("an XBRL stored with a null intake state holds the PDF; it is unsettled, not settled with empty coverage", async () => {
    const ws = await seedWs();
    const xbrl = await insertDoc(ws, "xbrl", "stored", null);
    expect((await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId)).map((x) => [x.documentId, x.state])).toEqual([[xbrl, "unsettled"]]);
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("waiting_for_xbrl");
    expect(await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
  });

  it("an XBRL whose verify failed for good settles: the PDF is released, and the sweeper's final failure releases it too", async () => {
    const ws = await seedWs();
    const failed = await insertDoc(ws, "xbrl", "verifying", null);
    await seedJob(ctx.db, ws.workspaceId, { type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: failed, state: "failed", attempt: 5 });
    expect(await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId)).toEqual([
      { documentId: failed, state: "settled", companyId: null, identity: { cin: null, bseCode: null, nseSymbol: null, isin: null }, periodEnd: null, coverage: [] },
    ]);
    const released = await addPdf(ws);
    expect(await decide(released.row)).toBe("reading");

    const ws2 = await seedWs();
    const verifying = await insertDoc(ws2, "xbrl", "verifying", null);
    await seedJob(ctx.db, ws2.workspaceId, {
      type: JobTypes.DOCUMENT_VERIFY, subjectType: "document", subjectId: verifying, state: "running", attempt: 5, maxAttempts: 5,
      leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const pdf = await addPdf(ws2);
    expect(await decide(pdf.row)).toBe("waiting_for_xbrl");
    const runner = startQueueRunner(ctx, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: async () => async () => {} });
    try {
      await waitFor(async () => (await docOf(pdf.id)).intakeState === "reading", 5_000);
    } finally {
      await runner.stop(1_000);
    }
    const [verify] = await jobsOf(verifying, JobTypes.DOCUMENT_VERIFY);
    expect(verify!.state).toBe("failed");
    const [extract] = await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT);
    expect(dispatchedFor(pdf.id, JobTypes.DOCUMENT_EXTRACT).map((j) => j.id)).toEqual([extract!.id]);
  });

  it("a release that runs while the PDF is deciding does not leave it waiting", async () => {
    const ws = await seedWs();
    const xbrl = await insertDoc(ws, "xbrl", "stored", "identifying");
    const pdf = await addPdf(ws);
    const holder = await ctx.db.$client.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtext('xbrl-wait:' || $1::text))", [ws.workspaceId]);
      const deciding = decide(pdf.row);
      const waiters = async () =>
        (await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted
          and database = (select oid from pg_database where datname = current_database())`)).rows[0]!.n;
      await waitFor(async () => (await waiters()) === 1, 5_000);
      await ctx.db.update(schema.document).set({ intakeState: "identify_failed" }).where(eq(schema.document.id, xbrl));
      const releasing = redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId);
      await waitFor(async () => (await waiters()) === 2, 5_000);
      await holder.query("commit");
      await Promise.all([deciding, releasing]);
    } finally {
      holder.release();
    }
    expect((await docOf(pdf.id)).intakeState).not.toBe("waiting_for_xbrl");
    expect((await docOf(pdf.id)).intakeState).toBe("reading");
  });

  it("a skipped PDF goes back to Gemini when its XBRL is confirmed for another company", async () => {
    const ws = await seedWs();
    const x = await addReadXbrl(ws, BOTH);
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("read");

    // The investor says the instance is another company's: it is read again under that answer.
    const row = await classify(ws, x.id, { companyId: ws.otherCompanyId, periodEnd: PERIOD, setBy: "investor" });
    expect(await decide(row)).toBe("reading");
    expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId)).toBe(1);
    expect((await docOf(pdf.id)).intakeState).toBe("reading");
    expect(dispatchedFor(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(1);
  });

  it("a skipped PDF stays read while new, unidentified XBRL documents of the workspace arrive", async () => {
    const ws = await seedWs();
    await addReadXbrl(ws, BOTH);
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("read");
    await insertDoc(ws, "xbrl", "uploaded", null);
    await insertDoc(ws, "xbrl", "stored", null);
    await insertDoc(ws, "xbrl", "stored", "identifying");
    expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId)).toBe(0);
    expect((await docOf(pdf.id)).intakeState).toBe("read");
    expect(await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT)).toHaveLength(0);
  });

  it("a held XBRL whose ScripCode is the PDF company's BSE code holds the PDF; one with other codes does not", async () => {
    const ws = await seedWs();
    const held = await insertDoc(ws, "xbrl", "stored", "needs_company");
    await classify(ws, held, { companyId: null, bseCode: "500999", periodEnd: PERIOD });
    expect((await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId))[0]).toMatchObject({
      documentId: held, state: "held", companyId: null, identity: { cin: null, bseCode: "500999", nseSymbol: null, isin: null }, periodEnd: PERIOD,
    });
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("waiting_for_xbrl");

    const other = await seedWs();
    const elsewhere = await insertDoc(other, "xbrl", "stored", "needs_company");
    await classify(other, elsewhere, { companyId: null, bseCode: "123456", nseSymbol: "OTHER", isin: "INE000A01010", periodEnd: PERIOD });
    const free = await addPdf(other);
    expect(await decide(free.row)).toBe("reading");
  });

  it("a duplicate XBRL holds nothing and covers nothing", async () => {
    const ws = await seedWs();
    const original = await insertDoc(ws, "xbrl", "stored", "kept");
    await classify(ws, original, { kind: "other", otherType: "announcement" });
    // A copy that somehow carries answers and facts still counts for nothing.
    const copy = await addReadXbrl(ws, BOTH, {}, { duplicateOfDocumentId: original });
    await ctx.db.update(schema.document).set({ intakeState: "duplicate" }).where(eq(schema.document.id, copy.id));
    expect((await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId)).map((x) => x.documentId)).toEqual([original]);
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("reading");
  });

  it("another workspace's XBRL never holds or covers a PDF", async () => {
    const mine = await seedWs();
    const theirs = await seedWs();
    await insertDoc(theirs, "xbrl", "stored", "identifying");
    await addReadXbrl(theirs, BOTH);
    expect(await loadWorkspaceXbrlDocs(ctx.db, mine.workspaceId)).toEqual([]);
    const pdf = await addPdf(mine);
    expect(await decide(pdf.row)).toBe("reading");
  });

  it("loadWorkspaceXbrlDocs: coverage comes from the current revision only, and pending uploads are left out", async () => {
    const ws = await seedWs();
    await insertDoc(ws, "xbrl", "pending_upload", null);
    const x = await addReadXbrl(ws, BOTH);
    // A newer classification that reads again: until its revision is written, the instance covers nothing.
    const again = await classify(ws, x.id, { companyId: ws.companyId, periodEnd: PERIOD, setBy: "investor" });
    expect((await getCurrentClassification(ctx.db, ws.workspaceId, x.id))!.id).toBe(again.id);
    expect(await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId)).toEqual([
      { documentId: x.id, state: "settled", companyId: ws.companyId, identity: { cin: null, bseCode: null, nseSymbol: null, isin: null }, periodEnd: PERIOD, coverage: [] },
    ]);
    await writeXbrlRevision(ws, x.id, again.id, CONSOLIDATED);
    expect((await loadWorkspaceXbrlDocs(ctx.db, ws.workspaceId))[0]!.coverage).toEqual(CONSOLIDATED);
  });

  it("a waiting PDF whose period the investor changed is read, once released, under the classification its answers read under", async () => {
    const ws = await seedWs();
    const xbrl = await insertDoc(ws, "xbrl", "stored", "identifying");
    const pdf = await addPdf(ws);
    expect(await decide(pdf.row)).toBe("waiting_for_xbrl");
    // A period-only change keeps the earlier read (the classification route's `read: false`).
    const changed = await classify(ws, pdf.id, {
      companyId: ws.companyId, periodEnd: "2025-06-30", statementsFound: pdf.row.statementsFound, setBy: "investor", readsUnderId: pdf.row.id,
    });
    expect(await decide(changed, { read: false })).toBeNull();
    await ctx.db.update(schema.document).set({ intakeState: "identify_failed" }).where(eq(schema.document.id, xbrl));
    expect(await redecidePdfsAfterXbrl(ctx.db, ctx.dispatcher, ws.workspaceId)).toBe(1);
    const [job] = await jobsOf(pdf.id, JobTypes.DOCUMENT_EXTRACT);
    expect(job!.idempotencyKey).toBe(`${JobTypes.DOCUMENT_EXTRACT}:${pdf.id}:${readVersion(pdf.row.id)}`);
  });

  it("allowWait false leaves a document alone on a wait plan", async () => {
    const ws = await seedWs();
    await insertDoc(ws, "xbrl", "stored", "identifying");
    const pdf = await addPdf(ws);
    await ctx.db.update(schema.document).set({ intakeState: "read" }).where(eq(schema.document.id, pdf.id));
    expect(await decide(pdf.row, { read: true, onlyFrom: ["read"], allowWait: false })).toBeNull();
    expect(await docOf(pdf.id)).toMatchObject({ intakeState: "read", companyId: null });
  });
});
