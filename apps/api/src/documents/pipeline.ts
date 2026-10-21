import { XbrlFormatKind, type DocumentPipeline } from "@maester/contracts";
import { companyIdentities, loadPipelineInputs, loadWorkspaceXbrlDocs, type ClassificationRow, type Db, type PipelineInput } from "@maester/db";
import {
  coveringXbrl,
  planPdfNumbers,
  type Basis,
  type CompanyIdentity,
  type PdfNumbersInput,
  type PdfNumbersPlan,
  type Statement,
} from "@maester/financial-engine";

type Numbers = DocumentPipeline["numbers"];

const NO_IDENTITY: CompanyIdentity = { cin: null, bseCode: null, nseSymbol: null, isin: null };

/** A results PDF as the source rule sees it. Null when it is no results PDF, or has no company to match XBRL by. */
export function pdfNumbersInput(c: ClassificationRow | null, identity: CompanyIdentity | undefined): PdfNumbersInput | null {
  if (c?.kind !== "financial_results" || !c.companyId) return null;
  return {
    companyId: c.companyId,
    companyIdentity: identity ?? NO_IDENTITY,
    kind: "financial_results",
    periodEnd: c.periodEnd,
    statementsFound: c.statementsFound.map((s) => ({ statement: s.statement as Statement, basis: s.basis as Basis })),
  };
}

const isDuplicate = ({ document: d }: PipelineInput) => d.intakeState === "duplicate" || d.duplicateOfDocumentId !== null;

/** The kind an instance's format id names (`in-capmkt/banking` is `banking`); `unknown` when the id does not say. */
function formatKind(c: ClassificationRow | null) {
  const parsed = XbrlFormatKind.safeParse(c?.xbrlFormat?.split("/")[1]);
  return parsed.success ? parsed.data : "unknown";
}

function numbers(source: Numbers["source"], state: Numbers["state"], more: Partial<Numbers> = {}): Numbers {
  return { source, state, coveredByXbrl: [], waitingOn: [], reason: null, format: null, ...more };
}

/** An instance's numbers are its own read: the intake state, and whether a read job is running. */
function xbrlNumbers(i: PipelineInput): Numbers {
  const { document: d } = i;
  if (isDuplicate(i)) return numbers("xbrl", "not_read", { reason: "duplicate" });
  if (d.state !== "stored") return numbers("xbrl", "waiting", { reason: "not_identified" });
  if (i.xbrlJob?.state === "running" || i.xbrlJob?.state === "queued") return numbers("xbrl", "now");
  switch (d.intakeState) {
    case "reading":
      return numbers("xbrl", "now");
    case "read_failed":
      return numbers("xbrl", "failed");
    case "read":
      return i.revision?.warnings.some((w) => w.code === "XBRL_FORMAT_UNMAPPED")
        ? numbers("xbrl", "not_read", { reason: "format_unmapped", format: formatKind(i.classification) })
        : numbers("xbrl", "done");
    case "kept":
      return numbers("xbrl", "not_read", { reason: "not_a_read_kind" });
    case "needs_company":
    case "needs_kind":
      return numbers("xbrl", "waiting", { reason: "needs_you" });
    default:
      return numbers("xbrl", "waiting", { reason: "not_identified" });
  }
}

/**
 * A PDF's numbers come from its own read, or from XBRL when the source rule skipped the read. `covering` is the
 * XBRL that covers it, taken apart from the plan: while any XBRL document of the workspace is unsettled the plan
 * waits and names no cover, and a PDF already skipped must keep its link to the XBRL it was skipped for.
 */
function pdfNumbers(i: PipelineInput, plan: PdfNumbersPlan | null, covering: string[]): Numbers {
  const { document: d } = i;
  if (isDuplicate(i)) return numbers(null, "not_read", { reason: "duplicate" });
  if (d.state !== "stored") return numbers(null, "waiting", { reason: "not_identified" });
  switch (d.intakeState) {
    case "waiting_for_xbrl":
      return numbers(null, "waiting", { reason: "waiting_for_xbrl", waitingOn: plan?.action === "wait" ? plan.waitingOn : [] });
    case "reading":
      return numbers("pdf", "now");
    case "read":
      return i.revision ? numbers("pdf", "done", { coveredByXbrl: covering }) : numbers("xbrl", "not_needed", { coveredByXbrl: covering });
    case "read_failed":
      return numbers("pdf", "failed");
    case "kept":
      return numbers(null, "not_read", { reason: "not_a_read_kind" });
    case "needs_company":
    case "needs_kind":
      return numbers(null, "waiting", { reason: "needs_you" });
    case null:
      // Stored before intake existed, with figures: read. With none, verify has not written the intake state yet.
      return i.revision ? numbers("pdf", "done") : numbers(null, "waiting", { reason: "not_identified" });
    default:
      return numbers(null, "waiting", { reason: "not_identified" });
  }
}

function textTrack(i: PipelineInput): DocumentPipeline["text"] {
  const { index, indexJob } = i;
  const counts = {
    pages: index?.pageCount ?? 0,
    pagesRead: index?.pagesRead ?? 0,
    pagesOcr: index?.pagesOcr ?? 0,
    chunks: index?.chunks ?? 0,
    xbrlBlocks: index?.xbrlBlocks ?? 0,
  };
  // A finished index stands even while a rebuild runs or has failed: it is the one the investor can search.
  if (index?.state === "complete") return { state: "done", ...counts, ahead: null };
  if (index?.state === "partial") return { state: "partial", ...counts, ahead: null };
  if (indexJob?.state === "running") return { state: "now", ...counts, ahead: null };
  if (indexJob?.state === "queued") return { state: "waiting", ...counts, ahead: i.ahead };
  if (indexJob?.state === "failed") return { state: "failed", ...counts, ahead: null };
  return { state: "waiting", ...counts, ahead: null };
}

/**
 * Where a document stands on its three tracks, from what is stored. Pure. `plan` is `planPdfNumbers` and `covering` is
 * `coveringXbrl`, both over the same inputs, for a results PDF; pass null and `[]` for any other document.
 */
export function computePipeline(i: PipelineInput, plan: PdfNumbersPlan | null, covering: string[]): DocumentPipeline {
  const { document: d } = i;
  const stored = d.state === "stored";
  const identified: DocumentPipeline["identified"] = !stored
    ? "waiting"
    : d.intakeState === "identifying"
      ? "now"
      : d.intakeState === "needs_company" || d.intakeState === "needs_kind"
        ? "needs_you"
        : d.intakeState === "identify_failed"
          ? "failed"
          : "done";
  return {
    stored: stored ? "done" : d.state === "rejected" ? "failed" : "now",
    identified,
    numbers: d.format === "xbrl" ? xbrlNumbers(i) : pdfNumbers(i, plan, covering),
    text: textTrack(i),
  };
}

export interface DocumentPipelineView {
  /** What was loaded for the document: its newest classification and job come from here, so a list costs no query per row. */
  input: PipelineInput;
  pipeline: DocumentPipeline;
}

/**
 * The pipeline of each document, a fixed number of queries whatever the count. The workspace's XBRL documents are
 * loaded once, only when a results PDF waiting for XBRL or already read is among them, and the plan and the cover
 * of each such PDF are worked out over them in memory.
 */
export async function documentPipelines(db: Db, workspaceId: string, documentIds: string[], embeddingModel: string): Promise<Map<string, DocumentPipelineView>> {
  const inputs = await loadPipelineInputs(db, workspaceId, documentIds, { embeddingModel });
  const needsPlan = [...inputs.values()].filter(
    (i) => i.document.format === "pdf" && (i.document.intakeState === "waiting_for_xbrl" || i.document.intakeState === "read") && pdfNumbersInput(i.classification, undefined),
  );
  const out = new Map<string, DocumentPipelineView>();
  const xbrl = needsPlan.length ? await loadWorkspaceXbrlDocs(db, workspaceId) : [];
  const identities = needsPlan.length
    ? await companyIdentities(db, workspaceId, [...new Set(needsPlan.map((i) => i.classification!.companyId!))])
    : new Map<string, CompanyIdentity>();
  for (const [id, input] of inputs) {
    const pdf = needsPlan.includes(input) ? pdfNumbersInput(input.classification, identities.get(input.classification!.companyId!)) : null;
    const pipeline = pdf ? computePipeline(input, planPdfNumbers(pdf, xbrl), coveringXbrl(pdf, xbrl)) : computePipeline(input, null, []);
    out.set(id, { input, pipeline });
  }
  return out;
}
