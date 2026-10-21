import { describe, expect, it } from "vitest";
import { WorkspaceFilings, XBRL_PDF_CHECK_VERSION, type DocumentPipeline } from "@maester/contracts";
import type { ClassificationRow, CompanyRow, DocumentRow, ExtractionCheckRow, PipelineInput, PipelineRevision, XbrlFilingFact } from "@maester/db";
import { buildFilings, type FilingFileInput, type FilingsInput } from "../src/documents/filings.js";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const WS = ID(100);
const T0 = new Date("2026-10-01T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const Q2 = "2025-09-30";
const COMPANY = ID(50);

function company(n: number, displayName: string, over: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: ID(50 + n), workspaceId: WS, displayName, country: "IN", cin: null, bseCode: null, nseSymbol: null, isin: null,
    createdByUserId: "u", createdAt: at(n), updatedAt: at(n), ...over,
  };
}

const PIPELINE: DocumentPipeline = {
  stored: "done",
  identified: "done",
  numbers: { source: null, state: "done", coveredByXbrl: [], waitingOn: [], reason: null, format: null },
  text: { state: "done", pages: 0, pagesRead: 0, pagesOcr: 0, chunks: 0, xbrlBlocks: 0, ahead: null },
};
const numbersState = (state: DocumentPipeline["numbers"]["state"]): DocumentPipeline => ({ ...PIPELINE, numbers: { ...PIPELINE.numbers, state } });

const ALL = (basis: "consolidated" | "standalone") =>
  [
    { statement: "income_statement", basis, pages: [3, 4] },
    { statement: "balance_sheet", basis, pages: [5] },
    { statement: "cash_flow", basis, pages: [6] },
  ] as const;

interface FileOpts {
  format?: "pdf" | "xbrl";
  at?: number;
  companyId?: string | null;
  doc?: Partial<DocumentRow>;
  /** null: no classification at all. */
  cls?: Partial<ClassificationRow> | null;
  revision?: PipelineRevision | null;
  pipeline?: DocumentPipeline;
}

function file(n: number, o: FileOpts = {}): FilingFileInput {
  const format = o.format ?? "pdf";
  const document: DocumentRow = {
    id: ID(n), workspaceId: WS, companyId: null, originalName: `file-${n}.${format === "pdf" ? "pdf" : "xml"}`, declaredSize: 1,
    declaredMime: format === "pdf" ? "application/pdf" : "text/xml", format, storageKey: `k${n}`, contentSha256: null, sizeBytes: null,
    state: "stored", rejectionCode: null, intakeState: "read", duplicateOfDocumentId: null, createdByUserId: "u", createdAt: at(o.at ?? n),
    updatedAt: at(n), storedAt: at(n), ...o.doc,
  };
  const classification: ClassificationRow | null =
    o.cls === null
      ? null
      : {
          id: ID(1000 + n), workspaceId: WS, documentId: ID(n), kind: "financial_results", otherType: null, resultsSpan: null, periodEnd: Q2,
          periodLabel: null, companyId: o.companyId === undefined ? COMPANY : o.companyId, companyNameAsPrinted: null, cin: null, bseCode: null,
          nseSymbol: null, isin: null, xbrlFormat: format === "xbrl" ? "in-capmkt/ind_as" : null, basis: null, statementsFound: [], setBy: "maester",
          setByUserId: null, jobId: null, readsUnderId: null, rulesVersion: null, model: null, promptVersion: null, warnings: [], createdAt: at(n),
          ...o.cls,
        };
  const input: PipelineInput = {
    document, classification, revision: o.revision ?? null, latestJob: null, xbrlJob: null, indexJob: null, index: null, ahead: null,
  };
  return { input, pipeline: o.pipeline ?? PIPELINE };
}

const xbrlRev = (n: number, warnings: PipelineRevision["warnings"] = []): PipelineRevision => ({ id: ID(2000 + n), source: "xbrl", state: "complete", warnings });
const pdfRev = (n: number): PipelineRevision => ({ id: ID(2000 + n), source: "pdf", state: "complete", warnings: [] });

let factSeq = 10_000;
const facts = (revision: PipelineRevision, statement: XbrlFilingFact["statement"], basis: XbrlFilingFact["basis"], spans: XbrlFilingFact["span"][]): XbrlFilingFact[] =>
  spans.map((span) => ({ id: ID(factSeq++), revisionId: revision.id, statement, basis, span }));

const rep = <T,>(n: number, v: T) => Array.from({ length: n }, () => v);

function check(fact: XbrlFilingFact, pdfDocumentId: string, pdfClassificationId: string, o: Partial<ExtractionCheckRow> = {}): ExtractionCheckRow {
  return {
    id: crypto.randomUUID(), workspaceId: WS, revisionId: fact.revisionId, checkType: "xbrl_in_pdf", statement: fact.statement, basis: fact.basis,
    section: null, periodLabel: "p", subjectLabel: "s", status: "passed", expected: null, actual: null, detail: "", factId: fact.id, pdfDocumentId,
    pdfClassificationId, pageIndex: 3, reason: null, checkVersion: XBRL_PDF_CHECK_VERSION, ...o,
  };
}

function build(over: Partial<FilingsInput> & { files: FilingFileInput[] }) {
  return buildFilings({ companies: [company(0, "Synthetic Cements Limited")], facts: [], checks: [], revisionCreatedAt: new Map(), xbrlPdfCheck: true, ...over });
}

const onlyFiling = (r: WorkspaceFilings) => {
  expect(r.companies).toHaveLength(1);
  expect(r.companies[0]!.filings).toHaveLength(1);
  return r.companies[0]!.filings[0]!;
};
const statementOf = (f: WorkspaceFilings["companies"][number]["filings"][number], basis: string, statement: string) =>
  f.sources.find((s) => s.basis === basis)!.statements.find((s) => s.statement === statement)!;

/** The Q2 filing: a PDF that found every statement on both bases, and a consolidated and a standalone instance. */
function q2(opts: { cashFlow?: boolean } = {}) {
  const cashFlow = opts.cashFlow ?? true;
  const pdf = file(1, { cls: { resultsSpan: "half_year", statementsFound: [...ALL("consolidated"), ...ALL("standalone")] as never }, pipeline: numbersState("not_needed") });
  const cons = file(2, { format: "xbrl", cls: { resultsSpan: "quarter", basis: "consolidated" }, revision: xbrlRev(2) });
  const stand = file(3, { format: "xbrl", cls: { resultsSpan: "quarter", basis: "standalone" }, revision: xbrlRev(3) });
  const all: XbrlFilingFact[] = [];
  for (const [f, basis] of [[cons, "consolidated"], [stand, "standalone"]] as const) {
    const rev = f.input.revision!;
    all.push(
      ...facts(rev, "income_statement", basis, [...rep<XbrlFilingFact["span"]>(19, "quarter"), ...rep<XbrlFilingFact["span"]>(19, "half_year")]),
      ...facts(rev, "balance_sheet", basis, rep(5, null)),
      ...(cashFlow ? facts(rev, "cash_flow", basis, rep(4, "half_year")) : []),
    );
  }
  return { pdf, cons, stand, files: [pdf, cons, stand], facts: all };
}

describe("buildFilings: sources", () => {
  it("a Q2 filing with a PDF and two instances is one filing of three files, with XBRL under both bases", () => {
    const { pdf, files, facts: fs } = q2();
    const consPnl = fs.filter((f) => f.statement === "income_statement" && f.basis === "consolidated");
    const checks = consPnl.map((f) => check(f, pdf.input.document.id, pdf.input.classification!.id));
    const result = build({ files, facts: fs, checks });
    expect(() => WorkspaceFilings.parse(result)).not.toThrow();
    const filing = onlyFiling(result);
    expect(filing.files).toHaveLength(3);
    expect(filing.key).toBe(`${COMPANY}:financial_results:${Q2}`);
    expect(filing.sources.map((s) => s.basis)).toEqual(["consolidated", "standalone"]);
    for (const basis of ["consolidated", "standalone"] as const) {
      const xbrlId = files.find((f) => f.input.classification!.basis === basis)!.input.document.id;
      expect(statementOf(filing, basis, "income_statement")).toMatchObject({ source: "xbrl", xbrlDocumentId: xbrlId, xbrlSpans: ["quarter", "half_year"], reason: null });
      expect(statementOf(filing, basis, "balance_sheet")).toMatchObject({ source: "xbrl", xbrlDocumentId: xbrlId, xbrlSpans: [], reason: null });
      expect(statementOf(filing, basis, "cash_flow")).toMatchObject({ source: "xbrl", xbrlDocumentId: xbrlId, xbrlSpans: ["half_year"], reason: null });
    }
    const pnl = statementOf(filing, "consolidated", "income_statement");
    expect(pnl.inPdf).toEqual({ found: 38, checked: 38, notFound: [], notChecked: null });
    expect(pnl.pdfDocumentId).toBe(pdf.input.document.id);
    expect(pnl.pdfPages).toEqual([3, 4]);
    expect(statementOf(filing, "standalone", "income_statement").inPdf).toEqual({ found: 0, checked: 0, notFound: [], notChecked: "not_yet" });
    expect(filing.spans).toEqual(["quarter", "half_year"]);
    expect(filing.settled).toBe(true);
  });

  it("lists the statements in the order the Research toggle has them, every basis with all three", () => {
    const { files, facts: fs } = q2();
    const filing = onlyFiling(build({ files, facts: fs }));
    for (const s of filing.sources) expect(s.statements.map((x) => x.statement)).toEqual(["income_statement", "balance_sheet", "cash_flow"]);
  });

  it("counts the facts not found in the PDF by id, and reports a check that did not run", () => {
    const { pdf, files, facts: fs } = q2();
    const pnl = fs.filter((f) => f.statement === "income_statement" && f.basis === "consolidated");
    const cls = pdf.input.classification!.id;
    const checks = [
      ...pnl.slice(0, 30).map((f) => check(f, pdf.input.document.id, cls)),
      ...pnl.slice(30, 33).map((f) => check(f, pdf.input.document.id, cls, { status: "failed", pageIndex: null })),
      ...pnl.slice(33).map((f) => check(f, pdf.input.document.id, cls, { status: "not_checked", pageIndex: null, reason: "scanned" })),
    ];
    const inPdf = statementOf(onlyFiling(build({ files, facts: fs, checks })), "consolidated", "income_statement").inPdf!;
    expect(inPdf.found).toBe(30);
    expect(inPdf.checked).toBe(33);
    expect(inPdf.notFound).toEqual(pnl.slice(30, 33).map((f) => f.id));
    expect(inPdf.notChecked).toBe("scanned");
  });

  it("says disabled when the check is turned off, and no_pdf when the filing has no PDF", () => {
    const { files, facts: fs, cons, stand } = q2();
    expect(statementOf(onlyFiling(build({ files, facts: fs, xbrlPdfCheck: false })), "consolidated", "income_statement").inPdf!.notChecked).toBe("disabled");
    const noPdf = onlyFiling(build({ files: [cons, stand], facts: fs }));
    expect(statementOf(noPdf, "consolidated", "income_statement")).toMatchObject({ pdfDocumentId: null, pdfPages: [], inPdf: { notChecked: "no_pdf" } });
  });

  it("a Q1 filing whose instances have no cash flow takes the cash flow from the PDF, saying the XBRL lacks it", () => {
    const { pdf, files, facts: fs } = q2({ cashFlow: false });
    pdf.pipeline = numbersState("done");
    const filing = onlyFiling(build({ files, facts: fs }));
    for (const basis of ["consolidated", "standalone"]) {
      expect(statementOf(filing, basis, "cash_flow")).toMatchObject({
        source: "pdf", xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: pdf.input.document.id, pdfPages: [6], reason: "xbrl_lacks_statement", inPdf: null,
      });
      expect(statementOf(filing, basis, "income_statement").source).toBe("xbrl");
    }
  });

  it("a standalone banking instance with a two-basis PDF is unmapped under standalone and has no XBRL under consolidated", () => {
    const pdf = file(1, { cls: { statementsFound: [...ALL("consolidated"), ...ALL("standalone")] as never }, revision: pdfRev(1), pipeline: numbersState("done") });
    const bank = file(2, {
      format: "xbrl", cls: { basis: "standalone", xbrlFormat: "in-capmkt/banking" }, revision: xbrlRev(2, [{ code: "XBRL_FORMAT_UNMAPPED", message: "no map" }]),
      pipeline: numbersState("not_read"),
    });
    const filing = onlyFiling(build({ files: [pdf, bank] }));
    for (const statement of ["income_statement", "balance_sheet", "cash_flow"]) {
      expect(statementOf(filing, "standalone", statement)).toMatchObject({ source: "pdf", reason: "xbrl_format_unmapped", pdfDocumentId: pdf.input.document.id });
      expect(statementOf(filing, "consolidated", statement)).toMatchObject({ source: "pdf", reason: "no_xbrl" });
    }
    expect(filing.files.find((f) => f.documentId === bank.input.document.id)!.basis).toBe("standalone");
    expect(filing.files.find((f) => f.documentId === pdf.input.document.id)!.basis).toBeNull();
  });

  it("an unmapped instance stays unmapped while its read job runs (the pipeline says now)", () => {
    const pdf = file(1, { cls: { statementsFound: [...ALL("standalone")] as never }, revision: pdfRev(1) });
    const bank = file(2, {
      format: "xbrl", cls: { basis: "standalone" }, revision: xbrlRev(2, [{ code: "XBRL_FORMAT_UNMAPPED", message: "no map" }]), pipeline: numbersState("now"),
    });
    expect(statementOf(onlyFiling(build({ files: [pdf, bank] })), "standalone", "income_statement").reason).toBe("xbrl_format_unmapped");
  });

  it("gives a statement neither source has not_in_filing, with every field empty", () => {
    const pdf = file(1, { cls: { statementsFound: [{ statement: "income_statement", basis: "consolidated", pages: [2] }] }, revision: pdfRev(1) });
    const filing = onlyFiling(build({ files: [pdf] }));
    expect(statementOf(filing, "consolidated", "cash_flow")).toEqual({
      statement: "cash_flow", source: null, xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: null, pdfPages: [], reason: "not_in_filing", inPdf: null,
    });
  });

  it("says not_read_yet for a PDF that is not read, and read_failed for one whose read failed", () => {
    const found = [...ALL("consolidated")] as never;
    for (const [state, reason] of [["waiting", "not_read_yet"], ["now", "not_read_yet"], ["failed", "read_failed"]] as const) {
      const pdf = file(1, { cls: { statementsFound: found }, pipeline: numbersState(state) });
      expect(statementOf(onlyFiling(build({ files: [pdf] })), "consolidated", "income_statement")).toMatchObject({ source: "pdf", reason });
    }
  });

  it("lets XBRL own a statement the PDF also prints, and takes the newer of two instances of one basis", () => {
    const pdf = file(1, { cls: { statementsFound: [...ALL("consolidated")] as never }, pipeline: numbersState("done"), revision: pdfRev(1) });
    const older = file(2, { format: "xbrl", at: 2, cls: { basis: "consolidated" }, revision: xbrlRev(2) });
    const newer = file(3, { format: "xbrl", at: 3, cls: { basis: "consolidated" }, revision: xbrlRev(3) });
    const fs = [...facts(older.input.revision!, "income_statement", "consolidated", ["year"]), ...facts(newer.input.revision!, "income_statement", "consolidated", ["quarter"])];
    const revisionCreatedAt = new Map([[older.input.revision!.id, at(2)], [newer.input.revision!.id, at(3)]]);
    const s = statementOf(onlyFiling(build({ files: [pdf, older, newer], facts: fs, revisionCreatedAt })), "consolidated", "income_statement");
    expect(s).toMatchObject({ source: "xbrl", xbrlDocumentId: newer.input.document.id, xbrlSpans: ["quarter"] });
  });

  it("orders spans quarter, half year, nine months, year, other", () => {
    const x = file(1, { format: "xbrl", cls: { basis: "consolidated" }, revision: xbrlRev(1) });
    const fs = facts(x.input.revision!, "income_statement", "consolidated", ["other", "year", "nine_months", "half_year", "quarter", "quarter"]);
    expect(statementOf(onlyFiling(build({ files: [x], facts: fs })), "consolidated", "income_statement").xbrlSpans).toEqual(["quarter", "half_year", "nine_months", "year", "other"]);
  });

  it("gives a filing with no statements and no instance no sources", () => {
    expect(onlyFiling(build({ files: [file(1, { cls: { kind: "annual_report" }, revision: pdfRev(1) })] })).sources).toEqual([]);
  });
});

describe("buildFilings: grouping", () => {
  it("puts a duplicate under its original and nowhere else", () => {
    const orig = file(1, { cls: { statementsFound: [] } });
    const dup = file(2, { cls: null, doc: { intakeState: "duplicate", duplicateOfDocumentId: ID(1), state: "stored" } });
    const result = build({ files: [orig, dup] });
    const filing = onlyFiling(result);
    expect(filing.files).toHaveLength(1);
    expect(filing.files[0]!.duplicates).toEqual([ID(2)]);
    expect(result.unsorted).toEqual([]);
    expect(result.held).toEqual([]);
  });

  it("puts duplicates of a file in the unsorted list under that file, in the order they were added", () => {
    const orig = file(1, { cls: { companyId: null, kind: "other" }, doc: { intakeState: "kept" } });
    const d2 = file(3, { cls: null, doc: { intakeState: "duplicate", duplicateOfDocumentId: ID(1) } });
    const d1 = file(2, { cls: null, doc: { intakeState: "duplicate", duplicateOfDocumentId: ID(1) } });
    const result = build({ files: [orig, d2, d1] });
    expect(result.unsorted.map((f) => f.documentId)).toEqual([ID(1)]);
    expect(result.unsorted[0]!.duplicates).toEqual([ID(2), ID(3)]);
  });

  it("drops a duplicate whose original is not listed", () => {
    const result = build({ files: [file(2, { cls: null, doc: { intakeState: "duplicate", duplicateOfDocumentId: ID(99) } })] });
    expect(result.unsorted).toEqual([]);
    expect(result.companies[0]!.filings).toEqual([]);
  });

  it("is not settled while a PDF waits, and settled once every file has stopped", () => {
    const waiting = file(1, { doc: { intakeState: "waiting_for_xbrl" }, pipeline: numbersState("waiting") });
    expect(onlyFiling(build({ files: [waiting] })).settled).toBe(false);
    for (const [identified, numbers, text, settled] of [
      ["done", "done", "done", true],
      ["done", "not_needed", "partial", true],
      ["done", "not_read", "failed", true],
      ["done", "failed", "done", true],
      ["now", "done", "done", false],
      ["needs_you", "done", "done", false],
      ["done", "now", "done", false],
      ["done", "waiting", "done", false],
      ["done", "done", "now", false],
      ["done", "done", "waiting", false],
    ] as const) {
      const pipeline: DocumentPipeline = { ...PIPELINE, identified, numbers: { ...PIPELINE.numbers, state: numbers }, text: { ...PIPELINE.text, state: text } };
      expect(onlyFiling(build({ files: [file(1, { pipeline })] })).settled).toBe(settled);
    }
    const mixed = [file(1), file(2, { pipeline: numbersState("now") })];
    expect(onlyFiling(build({ files: mixed })).settled).toBe(false);
  });

  it("makes one filing of a PDF classified half year and its instance classified quarter for one period end", () => {
    const pdf = file(1, { cls: { resultsSpan: "half_year" } });
    const x = file(2, { format: "xbrl", cls: { resultsSpan: "quarter", basis: "consolidated" } });
    const filing = onlyFiling(build({ files: [pdf, x] }));
    expect(filing.files).toHaveLength(2);
    expect(filing.spans).toEqual(["quarter", "half_year"]);
  });

  it("makes two filings of a board meeting outcome and an investor presentation of one day, keyed by their type", () => {
    const a = file(1, { cls: { kind: "other", otherType: "board_meeting" }, doc: { intakeState: "kept" } });
    const b = file(2, { cls: { kind: "other", otherType: "investor_presentation" }, doc: { intakeState: "kept" } });
    const c = file(3, { cls: { kind: "other", otherType: "board_meeting" }, doc: { intakeState: "kept" } });
    const filings = build({ files: [a, b, c] }).companies[0]!.filings;
    expect(filings.map((f) => f.key).sort()).toEqual([`${COMPANY}:other:board_meeting:${Q2}`, `${COMPANY}:other:investor_presentation:${Q2}`]);
    const board = filings.find((f) => f.otherType === "board_meeting")!;
    expect(board.files.map((f) => f.documentId)).toEqual([ID(1), ID(3)]);
    expect(filings.find((f) => f.kind === "other" && f.otherType === "investor_presentation")!.files).toHaveLength(1);
  });

  it("gives a file with no period its own filing, keyed by its document", () => {
    const a = file(1, { cls: { periodEnd: null, kind: "other", otherType: "announcement" }, doc: { intakeState: "kept" } });
    const b = file(2, { cls: { periodEnd: null, kind: "annual_report" } });
    const filings = build({ files: [a, b] }).companies[0]!.filings;
    expect(filings.map((f) => f.key).sort()).toEqual([`${COMPANY}:annual_report:${ID(2)}`, `${COMPANY}:other:announcement:${ID(1)}`]);
    expect(filings.every((f) => f.periodEnd === null)).toBe(true);
  });

  it("keeps the same period of two kinds, or of two companies, in separate filings", () => {
    const other = company(1, "Another Limited");
    const files = [file(1), file(2, { cls: { kind: "annual_report" } }), file(3, { companyId: other.id })];
    const result = build({ files, companies: [company(0, "Synthetic Cements Limited"), other] });
    expect(result.companies.map((c) => c.filings.length)).toEqual([1, 2]);
  });

  it("orders filings newest period end first with no period last, and companies by name, listing a company with no filing", () => {
    const zed = company(1, "Zed Limited");
    const alpha = company(2, "alpha Limited");
    const empty = company(3, "Beta Limited");
    const files = [
      file(1, { cls: { periodEnd: "2025-06-30" } }),
      file(2, { cls: { periodEnd: "2025-09-30" } }),
      file(3, { cls: { periodEnd: null, kind: "other", otherType: "announcement" }, doc: { intakeState: "kept" } }),
      file(4, { companyId: zed.id }),
    ];
    const result = build({ files, companies: [zed, alpha, empty, company(0, "Synthetic Cements Limited")] });
    expect(result.companies.map((c) => c.company.displayName)).toEqual(["alpha Limited", "Beta Limited", "Synthetic Cements Limited", "Zed Limited"]);
    const synthetic = result.companies.find((c) => c.company.displayName === "Synthetic Cements Limited")!;
    expect(synthetic.filings.map((f) => f.periodEnd)).toEqual([Q2, "2025-06-30", null]);
  });

  it("lists the files of a filing by when they were added, and the filing as added when its first file was", () => {
    const filing = onlyFiling(build({ files: [file(1, { at: 30 }), file(2, { at: 10 }), file(3, { at: 20 })] }));
    expect(filing.files.map((f) => f.documentId)).toEqual([ID(2), ID(3), ID(1)]);
    expect(filing.addedAt).toBe(at(10).toISOString());
  });
});

describe("buildFilings: held and unsorted", () => {
  it("holds the files that need a company by the identity they print, and keeps them out of unsorted", () => {
    const held = (n: number, cls: Partial<ClassificationRow>) => file(n, { companyId: null, doc: { intakeState: "needs_company" }, cls });
    const files = [
      held(1, { bseCode: "500999", companyNameAsPrinted: "Synthetic Cements Limited" }),
      held(2, { bseCode: "500999", companyNameAsPrinted: "Synthetic Cements Limited" }),
      held(3, { bseCode: "500999", cin: "L12345MH1990PLC123456", periodEnd: "2025-06-30" }),
      held(4, {}),
    ];
    const result = build({ files, companies: [company(0, "Synthetic Cements Limited", { bseCode: "500999" })] });
    expect(result.held).toHaveLength(1);
    expect(result.held[0]).toMatchObject({ key: "bse:500999|cin:L12345MH1990PLC123456", files: 3, filings: 2, documentIds: [ID(1), ID(2), ID(3)], matches: [ID(50)] });
    expect(result.unsorted.map((f) => f.documentId)).toEqual([ID(4)]);
    expect(result.companies[0]!.filings).toEqual([]);
  });

  it("sends files with no company that are not held, and files with no classification, to unsorted", () => {
    const files = [
      file(1, { companyId: null, cls: { kind: "other", otherType: "announcement", bseCode: "500999" }, doc: { intakeState: "kept" } }),
      file(2, { cls: null, doc: { intakeState: null, state: "verifying" } }),
      file(3, { cls: null, doc: { intakeState: null, state: "stored", companyId: COMPANY } }),
    ];
    const result = build({ files });
    expect(result.unsorted.map((f) => f.documentId)).toEqual([ID(1), ID(2), ID(3)]);
    expect(result.held).toEqual([]);
  });

  it("every result parses as a WorkspaceFilings", () => {
    const { files, facts: fs } = q2();
    expect(() => WorkspaceFilings.parse(build({ files, facts: fs }))).not.toThrow();
    expect(() => WorkspaceFilings.parse(build({ files: [] }))).not.toThrow();
  });
});
