import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";
import { CountryCode } from "./company.js";
import { ExtractionWarning, IsoDate, ReportingBasis, StatementKind } from "./extraction.js";
import { Job } from "./job.js";

export const ClassificationKind = z.enum(["annual_report", "financial_results", "other", "not_sure"]);
export type ClassificationKind = z.infer<typeof ClassificationKind>;
export const OtherType = z.enum([
  "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
  "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]);
export type OtherType = z.infer<typeof OtherType>;
export const ResultsSpan = z.enum(["quarter", "half_year", "nine_months", "full_year"]);
export type ResultsSpan = z.infer<typeof ResultsSpan>;
export const EvidenceField = z.enum(["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]);
export type EvidenceField = z.infer<typeof EvidenceField>;
export const IntakeState = z.enum([
  "identifying", "duplicate", "needs_company", "needs_kind", "kept", "reading", "read", "identify_failed", "read_failed",
]);
export type IntakeState = z.infer<typeof IntakeState>;
/** A company's corporate identity number as printed on Indian filings. */
export const Cin = z.string().regex(/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, "a 21-character CIN");
export const BseCode = z.string().regex(/^\d{6}$/, "a six-digit BSE code");
export const NseSymbol = z.string().regex(/^[A-Z][A-Z0-9&-]{0,19}$/, "an NSE symbol");

// ---- Extractor wire format (POST /v1/classify). Mirrors pdf_financial_qa.classify.contracts. ----
export const ClassifierEvidence = z.object({
  field: EvidenceField,
  source: z.enum(["rule", "model"]),
  ruleId: z.string().nullable(),
  pageIndex: z.number().int().min(0),
  quote: z.string().min(1).max(300),
  textLayerMatch: z.boolean().nullable(),
});
export const StatementFound = z.object({ statement: StatementKind, basis: ReportingBasis, pages: z.array(z.number().int().min(0)) });
export type StatementFound = z.infer<typeof StatementFound>;
export const ClassificationResult = z.object({
  rulesVersion: z.string(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  pageCount: z.number().int().min(1),
  kind: ClassificationKind,
  otherType: OtherType.nullable(),
  resultsSpan: ResultsSpan.nullable(),
  periodEnd: IsoDate.nullable(),
  periodLabel: z.string().nullable(),
  companyNameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  statementsFound: z.array(StatementFound),
  evidence: z.array(ClassifierEvidence),
  warnings: z.array(ExtractionWarning),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;
export const ClassifyResponse = z.discriminatedUnion("type", [
  z.object({ type: z.literal("result"), result: ClassificationResult }),
  z.object({ type: z.literal("error"), code: z.string(), retryable: z.boolean(), message: z.string() }),
]);
export type ClassifyResponse = z.infer<typeof ClassifyResponse>;

// ---- API shapes ----
export const Evidence = z.object({
  field: EvidenceField,
  source: z.enum(["rule", "model", "investor"]),
  ruleId: z.string().nullable(),
  pageIndex: z.number().int().min(0).nullable(),
  quote: z.string().nullable(),
  textLayerMatch: z.boolean().nullable(),
});
export type Evidence = z.infer<typeof Evidence>;
export const Classification = z.object({
  id: Uuid,
  documentId: Uuid,
  kind: ClassificationKind,
  otherType: OtherType.nullable(),
  resultsSpan: ResultsSpan.nullable(),
  periodEnd: IsoDate.nullable(),
  periodLabel: z.string().nullable(),
  companyId: Uuid.nullable(),
  companyNameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  statementsFound: z.array(StatementFound),
  setBy: z.enum(["maester", "investor"]),
  readsUnderId: Uuid.nullable(),
  warnings: z.array(ExtractionWarning),
  createdAt: IsoTimestamp,
});
export type Classification = z.infer<typeof Classification>;
export const ClassificationSummary = Classification.pick({
  id: true, kind: true, otherType: true, resultsSpan: true, periodLabel: true, companyId: true, companyNameAsPrinted: true, setBy: true,
});
export type ClassificationSummary = z.infer<typeof ClassificationSummary>;
export const DocumentClassification = z.object({ classification: Classification, evidence: z.array(Evidence) });
export type DocumentClassification = z.infer<typeof DocumentClassification>;

export const ChangeClassificationRequest = z
  .object({
    basedOn: Uuid,
    kind: z.enum(["annual_report", "financial_results", "other"]).optional(),
    otherType: OtherType.nullable().optional(),
    resultsSpan: ResultsSpan.nullable().optional(),
    periodEnd: IsoDate.nullable().optional(),
    periodLabel: z.string().trim().min(1).max(200).nullable().optional(),
    company: z
      .union([
        z.object({ id: Uuid }),
        z.object({
          new: z.object({
            displayName: z.string().trim().min(1).max(200),
            country: CountryCode,
            cin: Cin.optional(),
            bseCode: BseCode.optional(),
            nseSymbol: NseSymbol.optional(),
          }),
        }),
      ])
      .optional(),
  })
  .refine(
    (r) => [r.kind, r.otherType, r.resultsSpan, r.periodEnd, r.periodLabel, r.company].some((v) => v !== undefined),
    { message: "change at least one answer" },
  );
export type ChangeClassificationRequest = z.infer<typeof ChangeClassificationRequest>;

export const ClassifyJobResponse = z.object({ job: Job });
export type ClassifyJobResponse = z.infer<typeof ClassifyJobResponse>;
