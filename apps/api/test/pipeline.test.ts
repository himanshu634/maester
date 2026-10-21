import { describe, expect, it } from "vitest";
import { DocumentPipeline } from "@maester/contracts";
import type { ClassificationRow, DocumentRow, JobRow, PipelineInput } from "@maester/db";
import type { PdfNumbersPlan } from "@maester/financial-engine";
import { computePipeline } from "../src/documents/pipeline.js";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-21T00:00:00Z");

function docRow(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: ID(1), workspaceId: ID(100), companyId: null, originalName: "x", declaredSize: 1, declaredMime: "application/pdf", format: "pdf",
    storageKey: "k", contentSha256: null, sizeBytes: null, state: "stored", rejectionCode: null, intakeState: "read",
    duplicateOfDocumentId: null, createdByUserId: "u", createdAt: NOW, updatedAt: NOW, storedAt: NOW, ...over,
  };
}

function classRow(over: Partial<ClassificationRow> = {}): ClassificationRow {
  return {
    id: ID(2), workspaceId: ID(100), documentId: ID(1), kind: "financial_results", otherType: null, resultsSpan: "quarter", periodEnd: "2026-09-30",
    periodLabel: null, companyId: ID(50), companyNameAsPrinted: null, cin: null, bseCode: null, nseSymbol: null, isin: null, xbrlFormat: null,
    basis: null, statementsFound: [], setBy: "maester", setByUserId: null, jobId: null, readsUnderId: null, rulesVersion: null, model: null,
    promptVersion: null, warnings: [], createdAt: NOW, ...over,
  };
}

const job = (state: JobRow["state"]) => ({ state });

function input(over: Partial<PipelineInput> = {}): PipelineInput {
  return {
    document: docRow(), classification: classRow(), revision: null, latestJob: null, xbrlJob: null, indexJob: null, index: null, ahead: null, ...over,
  };
}

const pdfRead = (over: Partial<PipelineInput> = {}) =>
  input({ revision: { id: ID(3), source: "pdf", state: "complete", warnings: [] }, ...over });
const xbrlDoc = (intakeState: DocumentRow["intakeState"], over: Partial<PipelineInput> = {}) =>
  input({ document: docRow({ format: "xbrl", intakeState }), classification: classRow({ xbrlFormat: "in-capmkt/ind_as", basis: "consolidated" }), ...over });
const xbrlRead = (over: Partial<PipelineInput> = {}) =>
  xbrlDoc("read", { revision: { id: ID(3), source: "xbrl", state: "complete", warnings: [] }, ...over });

const numbers = (i: PipelineInput, plan: PdfNumbersPlan | null = null, covering: string[] = []) => computePipeline(i, plan, covering).numbers;

describe("computePipeline: a verify that failed for good, and partial XBRL reads", () => {
  const verifyJob = (state: JobRow["state"], type = "document.verify") => ({ type, state }) as JobRow;

  it("a document whose verify job failed for good is stored failed, not now", () => {
    // input: document state verifying; latest job of subject type document is document.verify, state failed
    const failed = input({ document: docRow({ state: "verifying", intakeState: null }), latestJob: verifyJob("failed") });
    expect(computePipeline(failed, null).stored).toBe("failed");
    expect(computePipeline(input({ document: docRow({ state: "uploaded", intakeState: null }), latestJob: verifyJob("failed") }), null).stored).toBe("failed");
  });

  it("a verify that is queued, running or succeeded, or a failed job of another type, leaves stored as now", () => {
    for (const latestJob of [verifyJob("queued"), verifyJob("running"), verifyJob("succeeded"), verifyJob("failed", "document.classify"), null]) {
      expect(computePipeline(input({ document: docRow({ state: "verifying", intakeState: null }), latestJob }), null).stored).toBe("now");
    }
    // A pending upload has no verify job yet; a stored document is done whatever its latest job did.
    expect(computePipeline(input({ document: docRow({ state: "pending_upload", intakeState: null }), latestJob: verifyJob("failed") }), null).stored).toBe("now");
    expect(computePipeline(input({ latestJob: verifyJob("failed") }), null).stored).toBe("done");
  });

  it("a partial XBRL read says so, with its warnings in order", () => {
    // input: an xbrl document, intake read; current revision source xbrl, state partial, warnings XBRL_ROUNDING_MISSING and XBRL_ELEMENT_UNMAPPED
    const warnings = [
      { code: "XBRL_ELEMENT_UNMAPPED", message: "m" },
      { code: "XBRL_NIL", message: "m" },
      { code: "XBRL_ROUNDING_MISSING", message: "m" },
    ];
    const i = xbrlRead({ revision: { id: ID(3), source: "xbrl", state: "partial", warnings } });
    expect(computePipeline(i, null).numbers).toMatchObject({ source: "xbrl", state: "done", partial: true, warnings: ["XBRL_ROUNDING_MISSING", "XBRL_ELEMENT_UNMAPPED", "XBRL_NIL"] });
    const two = xbrlRead({ revision: { id: ID(3), source: "xbrl", state: "partial", warnings: warnings.slice(0, 1).concat([{ code: "XBRL_ROUNDING_MISSING", message: "m" }]) } });
    expect(computePipeline(two, null).numbers).toMatchObject({ partial: true, warnings: ["XBRL_ROUNDING_MISSING", "XBRL_ELEMENT_UNMAPPED"] });
  });

  it("lists each code once, ignores codes outside the four, and reports a complete read as not partial", () => {
    const rev = (state: "complete" | "partial", codes: string[]) => ({ id: ID(3), source: "xbrl" as const, state, warnings: codes.map((code) => ({ code, message: "m" })) });
    expect(computePipeline(xbrlRead({ revision: rev("partial", ["XBRL_NIL", "XBRL_NIL", "SOMETHING_ELSE"]) }), null).numbers).toMatchObject({ partial: true, warnings: ["XBRL_NIL"] });
    expect(computePipeline(xbrlRead({ revision: rev("complete", []) }), null).numbers).toMatchObject({ partial: false, warnings: [] });
    expect(computePipeline(xbrlRead({ revision: rev("complete", ["XBRL_ROUNDING_MISMATCH"]) }), null).numbers).toMatchObject({ partial: false, warnings: ["XBRL_ROUNDING_MISMATCH"] });
  });

  it("only a done XBRL read carries partial and warnings", () => {
    const partial = { id: ID(3), source: "xbrl" as const, state: "partial" as const, warnings: [{ code: "XBRL_NIL", message: "m" }] };
    expect(computePipeline(xbrlDoc("read_failed", { revision: partial }), null).numbers).toMatchObject({ state: "failed", partial: false, warnings: [] });
    expect(computePipeline(xbrlDoc("read", { revision: partial, xbrlJob: job("running") }), null).numbers).toMatchObject({ state: "now", partial: false, warnings: [] });
  });

  it("a PDF never carries XBRL warnings", () => {
    // input: a pdf document, intake read, a complete Gemini revision
    expect(computePipeline(pdfRead(), { action: "read", coveredBy: [], uncovered: [] }).numbers).toMatchObject({ partial: false, warnings: [] });
    const partialPdf = pdfRead({ revision: { id: ID(3), source: "pdf", state: "partial", warnings: [{ code: "XBRL_NIL", message: "m" }] } });
    expect(computePipeline(partialPdf, null).numbers).toMatchObject({ partial: false, warnings: [] });
  });
});

describe("computePipeline: stored and identified", () => {
  it("stored is done, rejected is failed, and anything else is now", () => {
    expect(computePipeline(input(), null, []).stored).toBe("done");
    expect(computePipeline(input({ document: docRow({ state: "rejected", intakeState: null }) }), null, []).stored).toBe("failed");
    for (const state of ["pending_upload", "uploaded", "verifying"] as const) {
      expect(computePipeline(input({ document: docRow({ state, intakeState: null }) }), null, []).stored).toBe("now");
    }
  });

  it("identified waits for the store, then follows the intake state", () => {
    const at = (state: DocumentRow["state"], intakeState: DocumentRow["intakeState"]) =>
      computePipeline(input({ document: docRow({ state, intakeState }) }), null, []).identified;
    expect(at("uploaded", null)).toBe("waiting");
    expect(at("stored", "identifying")).toBe("now");
    expect(at("stored", "needs_company")).toBe("needs_you");
    expect(at("stored", "needs_kind")).toBe("needs_you");
    expect(at("stored", "identify_failed")).toBe("failed");
    for (const s of ["reading", "read", "read_failed", "kept", "waiting_for_xbrl"] as const) expect(at("stored", s)).toBe("done");
  });

  it("a rejected file and a duplicate are never identified: not_needed, not waiting for ever", () => {
    const at = (over: Partial<DocumentRow>) => computePipeline(input({ document: docRow(over) }), null, []).identified;
    expect(at({ state: "rejected", intakeState: null })).toBe("not_needed");
    expect(at({ intakeState: "duplicate" })).toBe("not_needed");
    expect(at({ intakeState: "read", duplicateOfDocumentId: ID(9) })).toBe("not_needed");
  });

  it("a stored document that verify has not given an intake state yet is identifying now; one stored before intake with a classification is done", () => {
    const at = (i: PipelineInput) => computePipeline(i, null, []).identified;
    expect(at(input({ document: docRow({ intakeState: null }), classification: null }))).toBe("now");
    expect(at(input({ document: docRow({ format: "xbrl", intakeState: null }), classification: null }))).toBe("now");
    expect(at(input({ document: docRow({ intakeState: null }) }))).toBe("done");
  });

  it("every output parses as a DocumentPipeline", () => {
    for (const i of [input(), pdfRead(), xbrlRead(), xbrlDoc("identifying")]) expect(() => DocumentPipeline.parse(computePipeline(i, null, []))).not.toThrow();
  });
});

describe("computePipeline: numbers of an XBRL document", () => {
  const base = { source: "xbrl", coveredByXbrl: [], waitingOn: [], format: null, partial: false, warnings: [] };

  it("reading is now", () => {
    expect(numbers(xbrlDoc("reading"))).toEqual({ ...base, state: "now", reason: null });
  });

  it("a running or queued document.xbrl job is now, even when the document says read or read_failed", () => {
    expect(numbers(xbrlRead({ xbrlJob: job("running") })).state).toBe("now");
    expect(numbers(xbrlDoc("read_failed", { xbrlJob: job("queued") })).state).toBe("now");
    expect(numbers(xbrlRead({ xbrlJob: job("succeeded") })).state).toBe("done");
  });

  it("read_failed is failed", () => {
    expect(numbers(xbrlDoc("read_failed"))).toEqual({ ...base, state: "failed", reason: null });
  });

  it("read is done", () => {
    expect(numbers(xbrlRead())).toEqual({ ...base, state: "done", reason: null });
  });

  it("read with XBRL_FORMAT_UNMAPPED is not_read, format_unmapped, with the instance's kind", () => {
    const i = xbrlDoc("read", {
      classification: classRow({ xbrlFormat: "in-capmkt/banking", basis: "standalone" }),
      revision: { id: ID(3), source: "xbrl", state: "partial", warnings: [{ code: "XBRL_FORMAT_UNMAPPED", message: "no map" }] },
    });
    expect(numbers(i)).toEqual({ ...base, state: "not_read", reason: "format_unmapped", format: "banking" });
  });

  it("other warnings alone leave a read instance done", () => {
    const warn = (code: string) => [{ code, message: "m" }];
    expect(numbers(xbrlRead({ revision: { id: ID(3), source: "xbrl", state: "partial", warnings: warn("XBRL_NIL") } })).state).toBe("done");
  });

  it("not identified yet is waiting, not_identified; a held one waits for the investor", () => {
    expect(numbers(xbrlDoc("identifying"))).toEqual({ ...base, state: "waiting", reason: "not_identified" });
    expect(numbers(xbrlDoc("identify_failed"))).toEqual({ ...base, state: "not_read", reason: "not_identified" });
    expect(numbers(xbrlDoc(null)).reason).toBe("not_identified");
    expect(numbers(xbrlDoc("needs_kind"))).toEqual({ ...base, state: "waiting", reason: "needs_you" });
    expect(numbers(xbrlDoc("needs_company")).reason).toBe("needs_you");
  });

  it("a document not stored yet is waiting, not_identified", () => {
    expect(numbers(xbrlDoc(null, { document: docRow({ format: "xbrl", state: "verifying", intakeState: null }) }))).toMatchObject({ state: "waiting", reason: "not_identified" });
  });

  it("kept is not_read, not_a_read_kind", () => {
    expect(numbers(xbrlDoc("kept"))).toEqual({ ...base, state: "not_read", reason: "not_a_read_kind" });
  });

  it("a duplicate is not_needed, duplicate", () => {
    expect(numbers(xbrlDoc("duplicate"))).toEqual({ ...base, state: "not_needed", reason: "duplicate" });
    expect(numbers(xbrlDoc("read", { document: docRow({ format: "xbrl", intakeState: "read", duplicateOfDocumentId: ID(9) }) }))).toMatchObject({ state: "not_needed", reason: "duplicate" });
  });

  it("a rejected file has no numbers to wait for: not_needed, no reason", () => {
    const rejected = xbrlDoc(null, { document: docRow({ format: "xbrl", state: "rejected", intakeState: null }) });
    expect(numbers(rejected)).toEqual({ ...base, state: "not_needed", reason: null });
  });

  it("an XBRL document ignores the plan and the cover it is given", () => {
    expect(numbers(xbrlRead(), { action: "skip", coveredBy: [ID(7)] }, [ID(7)]).coveredByXbrl).toEqual([]);
  });
});

describe("computePipeline: numbers of a PDF", () => {
  it("waiting_for_xbrl is waiting on the XBRL ids the plan names", () => {
    const i = input({ document: docRow({ intakeState: "waiting_for_xbrl" }) });
    expect(numbers(i, { action: "wait", waitingOn: [ID(7), ID(8)] })).toEqual({
      source: null, state: "waiting", coveredByXbrl: [], waitingOn: [ID(7), ID(8)], reason: "waiting_for_xbrl", format: null, partial: false, warnings: [],
    });
  });

  it("waiting_for_xbrl with a plan that no longer waits names nobody", () => {
    const i = input({ document: docRow({ intakeState: "waiting_for_xbrl" }) });
    expect(numbers(i, { action: "read", coveredBy: [], uncovered: [] }).waitingOn).toEqual([]);
    expect(numbers(i, null).state).toBe("waiting");
  });

  it("a read PDF with no revision is not_needed, from XBRL, covered by the two XBRL documents", () => {
    expect(numbers(input(), { action: "skip", coveredBy: [ID(7), ID(8)] }, [ID(7), ID(8)])).toEqual({
      source: "xbrl", state: "not_needed", coveredByXbrl: [ID(7), ID(8)], waitingOn: [], reason: null, format: null, partial: false, warnings: [],
    });
  });

  it("a skipped PDF keeps its cover while an import runs: the plan waits on a new XBRL document, the cover is the two settled", () => {
    const wait: PdfNumbersPlan = { action: "wait", waitingOn: [ID(9)] };
    expect(numbers(input(), wait, [ID(7), ID(8)])).toEqual({
      source: "xbrl", state: "not_needed", coveredByXbrl: [ID(7), ID(8)], waitingOn: [], reason: null, format: null, partial: false, warnings: [],
    });
  });

  it("reading is now, from the PDF", () => {
    expect(numbers(input({ document: docRow({ intakeState: "reading" }) }))).toEqual({
      source: "pdf", state: "now", coveredByXbrl: [], waitingOn: [], reason: null, format: null, partial: false, warnings: [],
    });
  });

  it("read with a revision is done, from the PDF; a partly covered PDF keeps the ids that cover it", () => {
    expect(numbers(pdfRead())).toMatchObject({ source: "pdf", state: "done", coveredByXbrl: [] });
    expect(numbers(pdfRead(), { action: "read", coveredBy: [ID(7)], uncovered: [] }, [ID(7)])).toMatchObject({ source: "pdf", state: "done", coveredByXbrl: [ID(7)] });
  });

  it("read_failed is failed, from the PDF", () => {
    expect(numbers(input({ document: docRow({ intakeState: "read_failed" }) }))).toMatchObject({ source: "pdf", state: "failed", reason: null });
  });

  it("kept is not_read, not_a_read_kind", () => {
    expect(numbers(input({ document: docRow({ intakeState: "kept" }) }))).toMatchObject({ state: "not_read", reason: "not_a_read_kind", source: null });
  });

  it("needs_company and needs_kind are waiting, needs_you; earlier states are waiting, not_identified", () => {
    for (const s of ["needs_company", "needs_kind"] as const) {
      expect(numbers(input({ document: docRow({ intakeState: s }) }))).toMatchObject({ state: "waiting", reason: "needs_you" });
    }
    for (const s of ["identifying", null] as const) {
      expect(numbers(input({ document: docRow({ intakeState: s }) }))).toMatchObject({ state: "waiting", reason: "not_identified" });
    }
  });

  it("a stored PDF from before intake (no intake state) with a revision is done", () => {
    expect(numbers(pdfRead({ document: docRow({ intakeState: null }) }))).toMatchObject({ source: "pdf", state: "done" });
  });

  it("a duplicate is not_needed, duplicate", () => {
    expect(numbers(input({ document: docRow({ intakeState: "duplicate" }) }))).toMatchObject({ state: "not_needed", reason: "duplicate" });
  });

  it("a rejected file is not_needed with no reason", () => {
    expect(numbers(input({ document: docRow({ state: "rejected", intakeState: null }) }))).toEqual({
      source: null, state: "not_needed", coveredByXbrl: [], waitingOn: [], reason: null, format: null, partial: false, warnings: [],
    });
  });

  it("a PDF whose identification failed is not_read, not_identified: it is not going to be read", () => {
    expect(numbers(input({ document: docRow({ intakeState: "identify_failed" }) }))).toMatchObject({ source: null, state: "not_read", reason: "not_identified" });
  });

  it("a manual re-read shows now: a running or queued document.extract job over a read, failed or kept PDF", () => {
    const extract = (state: JobRow["state"], type = "document.extract") => ({ type, state }) as JobRow;
    for (const intakeState of ["read", "read_failed", "kept"] as const) {
      for (const state of ["running", "queued"] as const) {
        expect(numbers(pdfRead({ document: docRow({ intakeState }), latestJob: extract(state) }))).toMatchObject({ source: "pdf", state: "now", reason: null });
      }
    }
    // The old state stands for a finished job, or a job of another type.
    expect(numbers(pdfRead({ latestJob: extract("succeeded") })).state).toBe("done");
    expect(numbers(pdfRead({ latestJob: extract("running", "document.classify") })).state).toBe("done");
    expect(numbers(pdfRead({ document: docRow({ intakeState: "duplicate" }), latestJob: extract("running") })).state).toBe("not_needed");
  });
});

describe("computePipeline: text", () => {
  const idx = (state: "complete" | "partial" | "building", over: object = {}) => ({
    state, pageCount: 40, pagesRead: 38, pagesOcr: 2, chunks: 30, xbrlBlocks: 0, ...over,
  });
  const text = (i: PipelineInput) => computePipeline(i, null, []).text;

  it("a complete revision is done with its counts; a partial one is partial", () => {
    expect(text(input({ index: idx("complete") }))).toEqual({ state: "done", pages: 40, pagesRead: 38, pagesOcr: 2, chunks: 30, xbrlBlocks: 0, ahead: null });
    expect(text(input({ index: idx("partial"), indexJob: job("succeeded") })).state).toBe("partial");
  });

  it("an XBRL document's blocks are counted", () => {
    expect(text(xbrlRead({ index: idx("complete", { pageCount: null, pagesRead: 0, pagesOcr: 0, chunks: 30, xbrlBlocks: 12 }) }))).toMatchObject({
      state: "done", pages: 0, chunks: 30, xbrlBlocks: 12,
    });
  });

  it("a running job is now; its counts come from the revision being built", () => {
    expect(text(input({ indexJob: job("running"), index: idx("building", { pagesRead: 5, chunks: 4 }) }))).toMatchObject({ state: "now", pagesRead: 5, chunks: 4, ahead: null });
  });

  it("a queued job is waiting, and says how many are ahead of it: third in the queue is two", () => {
    expect(text(input({ indexJob: job("queued"), ahead: 2 }))).toEqual({ state: "waiting", pages: 0, pagesRead: 0, pagesOcr: 0, chunks: 0, xbrlBlocks: 0, ahead: 2 });
    expect(text(input({ indexJob: job("queued"), ahead: 0 })).ahead).toBe(0);
  });

  it("a failed job with no revision is failed; with a revision the revision wins", () => {
    expect(text(input({ indexJob: job("failed") })).state).toBe("failed");
    expect(text(input({ indexJob: job("failed"), index: idx("complete") })).state).toBe("done");
  });

  it("a running job over a complete revision (a rebuild) leaves the finished index done", () => {
    expect(text(input({ indexJob: job("running"), index: idx("complete") })).state).toBe("done");
  });

  it("a rejected file and a duplicate are not_needed: they never get an index job", () => {
    const empty = { pages: 0, pagesRead: 0, pagesOcr: 0, chunks: 0, xbrlBlocks: 0, ahead: null };
    expect(text(input({ document: docRow({ state: "rejected", intakeState: null }) }))).toEqual({ state: "not_needed", ...empty });
    expect(text(input({ document: docRow({ intakeState: "duplicate" }) }))).toEqual({ state: "not_needed", ...empty });
  });

  it("a document whose identification failed still waits for its index: it is indexed whatever it is", () => {
    expect(text(input({ document: docRow({ intakeState: "identify_failed" }), indexJob: job("queued"), ahead: 1 }))).toMatchObject({ state: "waiting", ahead: 1 });
  });

  it("no job is waiting with ahead null", () => {
    expect(text(input())).toEqual({ state: "waiting", pages: 0, pagesRead: 0, pagesOcr: 0, chunks: 0, xbrlBlocks: 0, ahead: null });
  });

  it("an ahead count with no queued job is ignored", () => {
    expect(text(input({ indexJob: job("running"), ahead: 3 })).ahead).toBeNull();
  });
});
