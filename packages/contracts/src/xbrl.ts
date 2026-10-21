import { z } from "zod";
import { EvidenceField, ResultsSpan, StatementFound } from "./classification.js";
import { DecimalString, Uuid } from "./common.js";
import {
  CheckStatus,
  ExtractedCheck,
  ExtractedFact,
  ExtractionState,
  ExtractionWarning,
  FactSpan,
  IsoDate,
  ReportingBasis,
  StatementKind,
} from "./extraction.js";

/** Version of the `xbrl_in_pdf` check. It is in the check job's key and on each row, so a corrected check writes a new set. */
export const XBRL_PDF_CHECK_VERSION = 1;

/** The taxonomy family of an instance: SEBI's `in-capmkt` or BSE's `in-bse-fin`. */
export const XbrlFormatFamily = z.enum(["in-capmkt", "in-bse-fin"]);
export type XbrlFormatFamily = z.infer<typeof XbrlFormatFamily>;

/** What an instance reports: Ind AS, banking, NBFC or "other than Ind AS" results, or a shape Maester cannot tell. */
export const XbrlFormatKind = z.enum(["ind_as", "banking", "nbfc", "other_than_ind_as", "unknown"]);
export type XbrlFormatKind = z.infer<typeof XbrlFormatKind>;

/** The format of one instance. `id` is `<family>/<kind>`; `mapped` is true when an element map reads this format. */
export const XbrlFormat = z.object({
  family: XbrlFormatFamily.nullable(),
  kind: XbrlFormatKind,
  id: z.string().nullable(),
  mapped: z.boolean(),
});
export type XbrlFormat = z.infer<typeof XbrlFormat>;

/**
 * Why the numbers of an XBRL instance were not looked for in a PDF. `no_unit`: the instance declares no rounding, so a
 * monetary value has no scale to look for.
 */
export const XbrlPdfNotChecked = z.enum(["no_pdf", "scanned", "no_statement_pages", "disabled", "no_value", "no_unit", "not_yet"]);
export type XbrlPdfNotChecked = z.infer<typeof XbrlPdfNotChecked>;

// ---- The extractor's /v1/xbrl wire format (apps/extractor → apps/worker). Mirrored in Pydantic. ----

/** Where one answer of an XBRL classification came from: the element and context it was read from, and what it said. */
export const XbrlEvidence = z.object({
  field: EvidenceField,
  ruleId: z.string(),
  element: z.string().nullable(),
  context: z.string().nullable(),
  quote: z.string().min(1).max(300),
});
export type XbrlEvidence = z.infer<typeof XbrlEvidence>;

/** What an instance is, answered from its own facts with no model. */
export const XbrlClassification = z.object({
  parserVersion: z.string(),
  mapVersion: z.string(),
  format: XbrlFormat,
  kind: z.enum(["financial_results", "not_sure"]),
  resultsSpan: ResultsSpan.nullable(),
  periodEnd: IsoDate.nullable(),
  periodLabel: z.string().nullable(),
  companyNameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  isin: z.string().nullable(),
  basis: ReportingBasis,
  audited: z.boolean().nullable(),
  statementsFound: z.array(StatementFound),
  evidence: z.array(XbrlEvidence),
  warnings: z.array(ExtractionWarning),
});
export type XbrlClassification = z.infer<typeof XbrlClassification>;

/** A fact of an instance: an extracted fact with no page, and with where in the instance it was read. */
export const XbrlFact = ExtractedFact.omit({ pageIndex: true, textLayerMatch: true }).extend({
  span: FactSpan.nullable(),
  periodStart: IsoDate.nullable(),
  element: z.string(),
  contextId: z.string(),
  decimals: z.string().nullable(),
  nil: z.boolean(),
  concept: z.string().nullable(),
});
export type XbrlFact = z.infer<typeof XbrlFact>;

/** The unit the instance declares (`LevelOfRounding`): its word, label, how many rupees one unit holds, and its `decimals`. */
export const XbrlRounding = z.object({
  word: z.string(),
  unitLabel: z.string(),
  scale: DecimalString,
  exponent: z.number().int(),
});
export type XbrlRounding = z.infer<typeof XbrlRounding>;

export const XbrlReadResult = z.object({
  pipelineVersion: z.literal("xbrl-1"),
  model: z.literal("xbrl-parser-1"),
  promptVersion: z.string(),
  format: XbrlFormat,
  basis: ReportingBasis,
  state: ExtractionState,
  rounding: XbrlRounding.nullable(),
  coarsestDecimals: z.number().int().nullable(),
  finestDecimals: z.number().int().nullable(),
  warnings: z.array(ExtractionWarning),
  facts: z.array(XbrlFact),
  checks: z.array(ExtractedCheck),
});
export type XbrlReadResult = z.infer<typeof XbrlReadResult>;

export const XbrlTextBlock = z.object({ element: z.string(), contextId: z.string(), heading: z.string(), text: z.string() });
export type XbrlTextBlock = z.infer<typeof XbrlTextBlock>;

export const XbrlTextResult = z.object({
  textVersion: z.literal("1"),
  basis: ReportingBasis,
  blocks: z.array(XbrlTextBlock),
});
export type XbrlTextResult = z.infer<typeof XbrlTextResult>;

export const XbrlMode = z.enum(["classify", "read", "text"]);
export type XbrlMode = z.infer<typeof XbrlMode>;

/** One line of the extractor's NDJSON response stream from `/v1/xbrl`. */
export const XbrlEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), parserVersion: z.string(), mapVersion: z.string(), mode: XbrlMode }),
  z.object({ type: z.literal("heartbeat") }),
  z.object({ type: z.literal("classification"), result: XbrlClassification }),
  z.object({ type: z.literal("read"), result: XbrlReadResult }),
  z.object({ type: z.literal("text"), result: XbrlTextResult }),
  z.object({ type: z.literal("error"), code: z.string(), retryable: z.boolean(), message: z.string() }),
]);
export type XbrlEvent = z.infer<typeof XbrlEvent>;

/**
 * The request of `/v1/xbrl/pdf-check`. `scale` is the scale factor the revision's monetary facts share (null when the
 * instance declares no rounding), and `places` the places the statement is printed to, null with `scale`. A fact's
 * `value` is its normalized value, in full rupees.
 */
export const XbrlPdfCheckRequest = z.object({
  scale: DecimalString.nullable(),
  places: z.number().int().min(0).nullable(),
  statementPages: z.array(StatementFound),
  facts: z.array(
    z.object({
      factId: Uuid,
      value: DecimalString.nullable(),
      perShare: z.boolean(),
      statement: StatementKind,
      basis: ReportingBasis,
    }),
  ),
});
export type XbrlPdfCheckRequest = z.infer<typeof XbrlPdfCheckRequest>;

/** The answer of `/v1/xbrl/pdf-check`. A check of another version fails the parse, so no row is written under the wrong one. */
export const XbrlPdfCheckResult = z.object({
  checkVersion: z.literal(XBRL_PDF_CHECK_VERSION),
  results: z.array(
    z.object({
      factId: Uuid,
      status: CheckStatus,
      pageIndex: z.number().int().min(0).nullable(),
      reason: XbrlPdfNotChecked.nullable(),
    }),
  ),
});
export type XbrlPdfCheckResult = z.infer<typeof XbrlPdfCheckResult>;
