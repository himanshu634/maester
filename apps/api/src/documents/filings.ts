import type {
  BasisSources,
  DocumentPipeline,
  FilingFile,
  InPdfCount,
  ResultsSpan,
  StatementSource,
  WorkspaceFiling,
  WorkspaceFilings,
  XbrlPdfNotChecked,
} from "@maester/contracts";
import type { ClassificationRow, CompanyRow, ExtractionCheckRow, PipelineInput, XbrlFilingFact } from "@maester/db";
import { slotOwner, type SlotCandidate } from "@maester/financial-engine";
import { inPdfFor, type FilingPdf } from "../financials/in-pdf.js";
import { toCompany } from "../serialize.js";
import { groupHeld, type HeldRow } from "./held.js";

/** A stored document with what the pipeline view loaded for it and its pipeline. */
export interface FilingFileInput {
  input: PipelineInput;
  pipeline: DocumentPipeline;
}

export interface FilingsInput {
  companies: CompanyRow[];
  /** Every document of the workspace that is a file, duplicates included (they are put under their originals). */
  files: FilingFileInput[];
  /** The facts of the XBRL documents' current revisions: where they sit, never their values. */
  facts: XbrlFilingFact[];
  /** When each XBRL revision was written. A revision with no entry is dated by its document. */
  revisionCreatedAt: Map<string, Date>;
  /** `xbrl_in_pdf` rows of those revisions at the current check version. */
  checks: ExtractionCheckRow[];
  /** `XBRL_PDF_CHECK`: false makes every check `disabled`. */
  xbrlPdfCheck: boolean;
}

type Statement = StatementSource["statement"];
type Basis = BasisSources["basis"];
type FactSpan = StatementSource["xbrlSpans"][number];

/** The order the Research page toggles statements in. */
const STATEMENTS: readonly Statement[] = ["income_statement", "balance_sheet", "cash_flow"];
const BASES: readonly Basis[] = ["consolidated", "standalone", "unknown"];
const RESULTS_SPANS: readonly ResultsSpan[] = ["quarter", "half_year", "nine_months", "full_year"];
/** `other` last: a duration that is no whole number of months of 3, 6, 9 or 12. */
const FACT_SPANS: readonly FactSpan[] = ["quarter", "half_year", "nine_months", "year", "other"];
const UNMAPPED = "XBRL_FORMAT_UNMAPPED";

/** Plain `<`, so no order depends on a locale. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byAdded = (a: FilingFileInput, b: FilingFileInput) =>
  a.input.document.createdAt.getTime() - b.input.document.createdAt.getTime() || cmp(a.input.document.id, b.input.document.id);

const isDuplicate = ({ input: { document: d } }: FilingFileInput) => d.intakeState === "duplicate" || d.duplicateOfDocumentId !== null;
/** Adds to the list at `key`, creating it first; copying the list per add would make a long list of facts quadratic. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
const sortedBy =<T,>(xs: T[], order: readonly T[]) => order.filter((x) => xs.includes(x));

interface Context {
  factsByRevision: Map<string, XbrlFilingFact[]>;
  checksByFact: Map<string, ExtractionCheckRow[]>;
  revisionCreatedAt: Map<string, Date>;
  xbrlPdfCheck: boolean;
}

/** An XBRL instance of a filing, with the facts of its current revision when that revision was read from XBRL. */
interface Instance {
  file: FilingFileInput;
  basis: Basis | null;
  facts: XbrlFilingFact[];
  unmapped: boolean;
}

function instanceOf(file: FilingFileInput, ctx: Context): Instance {
  const { revision, classification } = file.input;
  const read = revision?.source === "xbrl" ? revision : null;
  return {
    file,
    basis: classification?.basis ?? null,
    facts: read ? (ctx.factsByRevision.get(read.id) ?? []) : [],
    unmapped: read?.warnings.some((w) => w.code === UNMAPPED) ?? false,
  };
}

const foundIn = (c: ClassificationRow | null, statement: Statement, basis: Basis) =>
  (c?.statementsFound ?? []).find((s) => s.statement === statement && s.basis === basis);

/** The reason most facts were not checked, the first one seen on a tie; null when all were. */
function sharedReason(reasons: XbrlPdfNotChecked[]): XbrlPdfNotChecked | null {
  const counts = new Map<XbrlPdfNotChecked, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: XbrlPdfNotChecked | null = null;
  for (const [r, n] of counts) if (best === null || n > counts.get(best)!) best = r;
  return best;
}

/**
 * Adds up `inPdfFor` over a statement's facts: `found` passed, `checked` passed or failed, `notFound` the failed ids. A
 * fact that was not checked gives `notChecked` its reason, the commonest one when facts differ. A value is never read.
 */
function countInPdf(facts: XbrlFilingFact[], pdf: FilingPdf | null, ctx: Context): InPdfCount {
  let found = 0;
  let checked = 0;
  const notFound: string[] = [];
  const notChecked: XbrlPdfNotChecked[] = [];
  for (const fact of facts) {
    const r = inPdfFor(fact, ctx.checksByFact.get(fact.id) ?? [], pdf, ctx.xbrlPdfCheck);
    if (r.status === "passed") {
      found++;
      checked++;
    } else if (r.status === "failed") {
      checked++;
      notFound.push(fact.id);
    } else {
      notChecked.push(r.reason ?? "not_yet");
    }
  }
  return { found, checked, notFound, notChecked: sharedReason(notChecked) };
}

function candidate(file: FilingFileInput, revisionId: string, source: SlotCandidate["source"], createdAt: Date): SlotCandidate {
  return {
    revisionId,
    documentId: file.input.document.id,
    source,
    filingPeriodEnd: file.input.classification?.periodEnd ?? null,
    revisionCreatedAt: createdAt.toISOString(),
  };
}

/**
 * Where each statement of each basis in a filing gets its numbers. The bases are those the filing's XBRL instances state
 * and its PDFs found statements for, consolidated, standalone, then unknown; each lists all three statements.
 * For a statement, `slotOwner` ranks the instances that have facts of it against the PDFs that print it (XBRL first,
 * then the newer revision), so two instances of one basis give the newer one:
 * - XBRL owns it: `xbrlSpans` are the distinct spans of its facts (none for an instant statement) and `inPdf` counts how
 *   many of them the check found on the filing's PDF;
 * - a PDF owns it: the reason XBRL does not, taken from the PDF's pipeline first (read failed, not read yet), then
 *   from the instances of that basis (has facts but not this statement, unmapped format, none);
 * - neither: `not_in_filing`.
 * `pdfDocumentId` and `pdfPages` name the PDF that prints the statement, whichever source owns it.
 */
function sourcesOf(files: FilingFileInput[], ctx: Context): BasisSources[] {
  const pdfs = files.filter((f) => f.input.document.format === "pdf");
  const instances = files.filter((f) => f.input.document.format === "xbrl").map((f) => instanceOf(f, ctx));
  const bases = sortedBy(
    [
      ...instances.flatMap((i) => (i.basis ? [i.basis] : [])),
      ...pdfs.flatMap((p) => (p.input.classification?.statementsFound ?? []).map((s) => s.basis as Basis)),
    ],
    BASES,
  );
  // The PDF a statement is checked against when no PDF prints it: the newest one that has a classification.
  const anyPdf = [...pdfs].sort(byAdded).reverse().find((p) => p.input.classification);

  return [...new Set(bases)].map((basis) => ({
    basis,
    statements: STATEMENTS.map((statement): StatementSource => {
      const withFacts = instances
        .map((i) => ({ i, facts: i.facts.filter((f) => f.statement === statement && f.basis === basis) }))
        .filter((x) => x.facts.length > 0);
      const printing = pdfs.filter((p) => foundIn(p.input.classification, statement, basis));

      const pdfOwner = slotOwner(printing.map((p) => candidate(p, p.input.revision?.id ?? p.input.document.id, "pdf", p.input.document.createdAt)));
      const pdf = printing.find((p) => p.input.document.id === pdfOwner?.documentId) ?? null;
      const pdfPages = pdf ? (foundIn(pdf.input.classification, statement, basis)?.pages ?? []) : [];
      const owner = slotOwner([
        ...withFacts.map(({ i }) => {
          const revisionId = i.file.input.revision!.id;
          return candidate(i.file, revisionId, "xbrl", ctx.revisionCreatedAt.get(revisionId) ?? i.file.input.document.createdAt);
        }),
        ...(pdfOwner ? [pdfOwner] : []),
      ]);

      const empty = { xbrlDocumentId: null, xbrlSpans: [], pdfDocumentId: pdf?.input.document.id ?? null, pdfPages, inPdf: null };
      if (!owner) return { statement, source: null, ...empty, reason: "not_in_filing" };

      if (owner.source === "xbrl") {
        const { facts } = withFacts.find(({ i }) => i.file.input.document.id === owner.documentId)!;
        const checkPdf = pdf ?? anyPdf ?? null;
        return {
          statement,
          source: "xbrl",
          xbrlDocumentId: owner.documentId,
          xbrlSpans: sortedBy(
            facts.flatMap((f) => (f.span ? [f.span] : [])),
            FACT_SPANS,
          ),
          pdfDocumentId: pdf?.input.document.id ?? null,
          pdfPages,
          reason: null,
          inPdf: countInPdf(
            facts,
            checkPdf?.input.classification
              ? { documentId: checkPdf.input.document.id, classificationId: checkPdf.input.classification.id, statementPages: checkPdf.input.classification.statementsFound }
              : null,
            ctx,
          ),
        };
      }

      // A PDF owns the statement only when one prints it.
      const numbers = pdf!.pipeline.numbers.state;
      const ofBasis = instances.filter((i) => i.basis === basis);
      const reason: StatementSource["reason"] =
        numbers === "failed"
          ? "read_failed"
          : numbers !== "done" && numbers !== "not_needed"
            ? "not_read_yet"
            : ofBasis.some((i) => i.facts.length > 0)
              ? "xbrl_lacks_statement"
              : ofBasis.some((i) => i.unmapped)
                ? "xbrl_format_unmapped"
                : "no_xbrl";
      return { statement, source: "pdf", ...empty, reason };
    }),
  }));
}

/** Settled: every file has stopped on all three tracks, so nothing here will change by itself. */
function settledOf(files: FilingFileInput[]): boolean {
  return files.every(({ pipeline: p }) => p.identified === "done" && ["done", "not_needed", "not_read", "failed"].includes(p.numbers.state) && ["done", "partial", "failed"].includes(p.text.state));
}

function toFile(f: FilingFileInput, duplicates: Map<string, string[]>): FilingFile {
  const { document: d, classification } = f.input;
  return {
    documentId: d.id,
    originalName: d.originalName,
    format: d.format,
    basis: d.format === "xbrl" ? (classification?.basis ?? null) : null,
    createdAt: d.createdAt.toISOString(),
    intakeState: d.intakeState,
    duplicates: duplicates.get(d.id) ?? [],
    pipeline: f.pipeline,
  };
}

/** The key of a filing: its company, kind and period end; a kept `other` document also by its type; a file with no period end by itself. */
function filingKey(companyId: string, c: ClassificationRow): string {
  const period = c.periodEnd ?? c.documentId;
  return c.kind === "other" ? `${companyId}:other:${c.otherType ?? "unlisted_type"}:${period}` : `${companyId}:${c.kind}:${period}`;
}

/**
 * The workspace's files by company and filing, with where each statement's numbers come from. Pure.
 * - A file with a company and a classification is grouped by `filingKey`; the filing's period end is its files'.
 * - A duplicate is not a file: its id is under its original's `duplicates` (and a duplicate whose original is not
 *   listed is dropped). It is never held, unsorted or counted in `settled`.
 * - A file that needs a company goes to `held` by the identity it prints (`groupHeld`); one printing no identifier goes
 *   to `unsorted`, as does any other file with no company or no classification.
 * - Order: companies by name (all of the workspace's, with or without filings); filings newest period end first, none
 *   last, then by key; a filing's files and the unsorted files by when they were added, then id; `spans` quarter, half
 *   year, nine months, full year. A filing is added when its first file was.
 */
export function buildFilings(input: FilingsInput): WorkspaceFilings {
  const ctx: Context = {
    factsByRevision: new Map(),
    checksByFact: new Map(),
    revisionCreatedAt: input.revisionCreatedAt,
    xbrlPdfCheck: input.xbrlPdfCheck,
  };
  for (const f of input.facts) push(ctx.factsByRevision, f.revisionId, f);
  for (const c of input.checks) if (c.factId) push(ctx.checksByFact, c.factId, c);

  const files = input.files.filter((f) => !isDuplicate(f)).sort(byAdded);
  const listed = new Set(files.map((f) => f.input.document.id));
  const duplicates = new Map<string, string[]>();
  for (const d of input.files.filter(isDuplicate).sort(byAdded)) {
    const original = d.input.document.duplicateOfDocumentId;
    if (original && listed.has(original)) push(duplicates, original, d.input.document.id);
  }

  const grouped = new Map<string, { companyId: string; files: FilingFileInput[] }>();
  const loose: FilingFileInput[] = [];
  for (const f of files) {
    const c = f.input.classification;
    if (c?.companyId) {
      const key = filingKey(c.companyId, c);
      const group = grouped.get(key) ?? { companyId: c.companyId, files: [] };
      group.files.push(f);
      grouped.set(key, group);
    } else {
      loose.push(f);
    }
  }

  const heldRows: HeldRow[] = loose.flatMap((f) => {
    const c = f.input.classification;
    return c && f.input.document.intakeState === "needs_company"
      ? [{ documentId: c.documentId, kind: c.kind, periodEnd: c.periodEnd, nameAsPrinted: c.companyNameAsPrinted, cin: c.cin, bseCode: c.bseCode, isin: c.isin, nseSymbol: c.nseSymbol }]
      : [];
  });
  const held = groupHeld(heldRows, input.companies);
  const isHeld = new Set(held.flatMap((h) => h.documentIds));

  const filingsOf = new Map<string, WorkspaceFiling[]>();
  for (const [key, { companyId, files: group }] of grouped) {
    const c = group[0]!.input.classification!;
    const spans = group.flatMap((f) => (f.input.classification?.resultsSpan ? [f.input.classification.resultsSpan] : []));
    const filing: WorkspaceFiling = {
      key,
      kind: c.kind,
      otherType: c.kind === "other" ? (c.otherType ?? "unlisted_type") : null,
      periodEnd: c.periodEnd,
      spans: sortedBy(spans, RESULTS_SPANS),
      files: group.map((f) => toFile(f, duplicates)),
      sources: sourcesOf(group, ctx),
      settled: settledOf(group),
      addedAt: group[0]!.input.document.createdAt.toISOString(),
    };
    push(filingsOf, companyId, filing);
  }

  const newestFirst = (a: WorkspaceFiling, b: WorkspaceFiling) =>
    a.periodEnd === b.periodEnd ? cmp(a.key, b.key) : a.periodEnd === null ? 1 : b.periodEnd === null ? -1 : cmp(b.periodEnd, a.periodEnd);

  return {
    companies: [...input.companies]
      .sort((a, b) => cmp(a.displayName.toLowerCase(), b.displayName.toLowerCase()) || cmp(a.id, b.id))
      .map((company) => ({ company: toCompany(company), filings: (filingsOf.get(company.id) ?? []).sort(newestFirst) })),
    held,
    unsorted: loose.filter((f) => !isHeld.has(f.input.document.id)).map((f) => toFile(f, duplicates)),
  };
}
