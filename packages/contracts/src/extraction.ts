import { z } from "zod";
import { DecimalString, IsoTimestamp, Uuid } from "./common.js";
import { Job } from "./job.js";

export const StatementKind = z.enum(["balance_sheet", "income_statement", "cash_flow"]);
export type StatementKind = z.infer<typeof StatementKind>;
export const ReportingBasis = z.enum(["consolidated", "standalone", "unknown"]);
export type ReportingBasis = z.infer<typeof ReportingBasis>;
export const ValueStatus = z.enum(["value", "dash", "unparsed"]);
export const ExtractionState = z.enum(["complete", "partial"]);
/** The checks the extractor sends to the worker; its Pydantic twin has these two values. */
export const ExtractedCheckType = z.enum(["subtotal", "balance_identity"]);
export type ExtractedCheckType = z.infer<typeof ExtractedCheckType>;
/** The checks the API shows: the extractor's two, and a fact of an XBRL instance looked for in a PDF. */
export const CheckType = z.enum(["subtotal", "balance_identity", "xbrl_in_pdf"]);
export type CheckType = z.infer<typeof CheckType>;
/** The span of a fact's period, in the data layer's words; the classification's `ResultsSpan` says `full_year` for `year`. */
export const FactSpan = z.enum(["quarter", "half_year", "nine_months", "year", "other"]);
export type FactSpan = z.infer<typeof FactSpan>;
export const CheckStatus = z.enum(["passed", "failed", "not_checked"]);
export const IsoDate = z.iso.date();

export const ExtractionWarning = z.object({ code: z.string(), message: z.string() });
export type ExtractionWarning = z.infer<typeof ExtractionWarning>;

export const CoverageEntry = z.object({
  statement: StatementKind,
  basis: ReportingBasis,
  /** 0-based page indexes of the original PDF. */
  pages: z.array(z.number().int().min(0)),
  status: z.enum(["extracted", "failed"]),
  message: z.string().nullish(),
});
export type CoverageEntry = z.infer<typeof CoverageEntry>;

const factFields = {
  statement: StatementKind,
  basis: ReportingBasis,
  section: z.string(),
  lineOrder: z.number().int().min(0),
  reportedLabel: z.string(),
  isSubtotal: z.boolean(),
  componentLabels: z.array(z.string()),
  periodLabel: z.string(),
  periodEnd: IsoDate.nullable(),
  asOfDate: IsoDate.nullable(),
  reportedText: z.string(),
  reportedValue: DecimalString.nullable(),
  valueStatus: ValueStatus,
  unitLabel: z.string().nullable(),
  scaleFactor: DecimalString.nullable(),
  currency: z.string().nullable(),
  normalizedValue: DecimalString.nullable(),
};

const checkFields = {
  statement: StatementKind,
  basis: ReportingBasis,
  section: z.string().nullable(),
  periodLabel: z.string(),
  subjectLabel: z.string(),
  status: CheckStatus,
  expected: DecimalString.nullable(),
  actual: DecimalString.nullable(),
  detail: z.string(),
};

// ---- Extractor wire format (apps/extractor → apps/worker). Mirrored in Pydantic. ----

export const ExtractedFact = z.object({
  ...factFields,
  pageIndex: z.number().int().min(0),
  textLayerMatch: z.boolean().nullable(),
});
export type ExtractedFact = z.infer<typeof ExtractedFact>;

export const ExtractedCheck = z.object({ checkType: ExtractedCheckType, ...checkFields });
export type ExtractedCheck = z.infer<typeof ExtractedCheck>;

export const ExtractionResult = z.object({
  pipelineVersion: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  pageCount: z.number().int().min(1),
  companyNameAsPrinted: z.string().nullable(),
  state: ExtractionState,
  coverage: z.array(CoverageEntry),
  warnings: z.array(ExtractionWarning),
  facts: z.array(ExtractedFact),
  checks: z.array(ExtractedCheck),
});
export type ExtractionResult = z.infer<typeof ExtractionResult>;

/** One line of the extractor's NDJSON response stream. */
export const ExtractorEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), pipelineVersion: z.string(), model: z.string(), promptVersion: z.string() }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("progress"), stage: z.string(), percent: z.number().min(0).max(100) }),
  z.object({ type: z.literal("result"), result: ExtractionResult }),
  z.object({ type: z.literal("error"), code: z.string(), retryable: z.boolean(), message: z.string() }),
]);
export type ExtractorEvent = z.infer<typeof ExtractorEvent>;

// ---- Public API ----

export const ExtractionRevision = z.object({
  id: Uuid,
  documentId: Uuid,
  jobId: Uuid,
  /** What the revision was read from: a PDF through the model, or an XBRL instance through the parser. */
  source: z.enum(["pdf", "xbrl"]),
  state: ExtractionState,
  pipelineVersion: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  pageCount: z.number().int(),
  companyNameAsPrinted: z.string().nullable(),
  coverage: z.array(CoverageEntry),
  warnings: z.array(ExtractionWarning),
  createdAt: IsoTimestamp,
});
export type ExtractionRevision = z.infer<typeof ExtractionRevision>;

export const ExtractionCheck = z.object({ id: Uuid, checkType: CheckType, ...checkFields });
export type ExtractionCheck = z.infer<typeof ExtractionCheck>;

export const DocumentExtraction = z.object({ revision: ExtractionRevision, checks: z.array(ExtractionCheck) });
export type DocumentExtraction = z.infer<typeof DocumentExtraction>;

/** Where a fact was read: a page of a PDF, or an element and context of an XBRL instance. */
export const FactSource = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page"),
    documentId: Uuid,
    /** 0-based page index of the original PDF. */
    pageIndex: z.number().int().min(0),
    /** Whether the printed value was found in the page's text layer; null for a page without one. */
    textLayerMatch: z.boolean().nullable(),
  }),
  z.strictObject({
    kind: z.literal("xbrl"),
    documentId: Uuid,
    element: z.string(),
    contextId: z.string(),
    /** The fact's `decimals` as written: `"INF"` or an integer; null when the instance gave none. */
    decimals: z.string().nullable(),
    /** True when the fact is `xsi:nil`: its value is unknown, never zero. */
    nil: z.boolean(),
  }),
]);
export type FactSource = z.infer<typeof FactSource>;

export const FinancialFact = z.object({
  id: Uuid,
  revisionId: Uuid,
  companyId: Uuid.nullable(),
  ...factFields,
  /** The first day of a duration; null for an instant or when the filing does not say. */
  periodStart: IsoDate.nullable(),
  span: FactSpan.nullable(),
  /** Null only for a fact stored without its source row. */
  source: FactSource.nullable(),
});
export type FinancialFact = z.infer<typeof FinancialFact>;

export const FactsQuery = z.object({ revisionId: Uuid.optional() });
export type FactsQuery = z.infer<typeof FactsQuery>;

export const DocumentFacts = z.object({ revision: ExtractionRevision, facts: z.array(FinancialFact) });
export type DocumentFacts = z.infer<typeof DocumentFacts>;

export const ExtractResponse = z.object({ job: Job });
export type ExtractResponse = z.infer<typeof ExtractResponse>;
