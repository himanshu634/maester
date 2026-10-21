import { z } from "zod";
import { IsoTimestamp, Uuid } from "./common.js";
import { BseCode, Cin, ClassificationKind, Isin, IntakeState, NseSymbol, OtherType, ResultsSpan } from "./classification.js";
import { Company, CreateCompanyRequest } from "./company.js";
import { DocumentFormat, DocumentState, RejectionCode } from "./document.js";
import { FactSpan, IsoDate, ReportingBasis, StatementKind } from "./extraction.js";
import { DocumentPipeline } from "./pipeline.js";
import { XbrlPdfNotChecked } from "./xbrl.js";

/**
 * Why a statement's numbers do not come from XBRL, or from nowhere. `xbrl_lacks_statement`: an instance of the basis has
 * facts but none for this statement. `xbrl_format_unmapped`: the instance is a format Maester reads but has no map for.
 * `no_xbrl`: no instance of the basis. `not_in_filing`: neither source has the statement. `not_read_yet` and
 * `read_failed`: the PDF that prints it is not read, or its read failed. `xbrl_read_failed` and `xbrl_not_read_yet`: the
 * filing holds an instance of the basis, and its read failed or has not finished, so its statements are not known; they
 * stand where `no_xbrl` or `not_in_filing` would.
 */
export const StatementSourceReason = z.enum([
  "xbrl_lacks_statement",
  "xbrl_format_unmapped",
  "no_xbrl",
  "not_in_filing",
  "not_read_yet",
  "read_failed",
  "xbrl_read_failed",
  "xbrl_not_read_yet",
]);
export type StatementSourceReason = z.infer<typeof StatementSourceReason>;

/** How many of an XBRL statement's facts were found on the filing's PDF. `notFound` are fact ids. */
export const InPdfCount = z.strictObject({
  found: z.number().int().min(0),
  checked: z.number().int().min(0),
  notFound: z.array(Uuid),
  notChecked: XbrlPdfNotChecked.nullable(),
});
export type InPdfCount = z.infer<typeof InPdfCount>;

/** Where one statement of one basis in a filing gets its numbers. */
export const StatementSource = z.strictObject({
  statement: StatementKind,
  source: z.enum(["xbrl", "pdf"]).nullable(),
  xbrlDocumentId: Uuid.nullable(),
  /** The distinct spans of the statement's XBRL facts. An instant-only statement (the balance sheet) has none. */
  xbrlSpans: z.array(FactSpan),
  pdfDocumentId: Uuid.nullable(),
  /** 0-based pages of the PDF that print the statement. */
  pdfPages: z.array(z.number().int().min(0)),
  reason: StatementSourceReason.nullable(),
  inPdf: InPdfCount.nullable(),
});
export type StatementSource = z.infer<typeof StatementSource>;

export const BasisSources = z.strictObject({ basis: ReportingBasis, statements: z.array(StatementSource) });
export type BasisSources = z.infer<typeof BasisSources>;

/**
 * One file of a filing, or an unsorted file, whatever its document `state`: a refused file (`rejected`, with its
 * `rejectionCode`) and an upload not finished (`pending_upload`) are listed too. A duplicate is not a file: its id sits
 * under the original's `duplicates`.
 */
export const FilingFile = z.strictObject({
  documentId: Uuid,
  originalName: z.string(),
  format: DocumentFormat,
  /** An XBRL instance's basis; null for a PDF. */
  basis: ReportingBasis.nullable(),
  createdAt: IsoTimestamp,
  state: DocumentState,
  rejectionCode: RejectionCode.nullable(),
  intakeState: IntakeState.nullable(),
  /** The company name the current classification prints; null without a classification or when it prints none. */
  companyNameAsPrinted: z.string().nullable(),
  duplicates: z.array(Uuid),
  pipeline: DocumentPipeline,
});
export type FilingFile = z.infer<typeof FilingFile>;

/** One filing of one company: the files for one kind and period end, with where each statement's numbers come from. */
export const WorkspaceFiling = z.strictObject({
  key: z.string(),
  kind: ClassificationKind,
  otherType: OtherType.nullable(),
  periodEnd: IsoDate.nullable(),
  spans: z.array(ResultsSpan),
  files: z.array(FilingFile),
  sources: z.array(BasisSources),
  settled: z.boolean(),
  addedAt: IsoTimestamp,
});
export type WorkspaceFiling = z.infer<typeof WorkspaceFiling>;

/** Files held for a company, grouped by the identity they print. `matches` are the workspace's companies it could be. */
export const HeldIdentity = z.strictObject({
  key: z.string(),
  nameAsPrinted: z.string().nullable(),
  cin: z.string().nullable(),
  bseCode: z.string().nullable(),
  isin: z.string().nullable(),
  nseSymbol: z.string().nullable(),
  files: z.number().int().min(0),
  filings: z.number().int().min(0),
  documentIds: z.array(Uuid),
  matches: z.array(Uuid),
});
export type HeldIdentity = z.infer<typeof HeldIdentity>;

export const WorkspaceFilings = z.strictObject({
  companies: z.array(z.strictObject({ company: Company, filings: z.array(WorkspaceFiling) })),
  held: z.array(HeldIdentity),
  unsorted: z.array(FilingFile),
});
export type WorkspaceFilings = z.infer<typeof WorkspaceFilings>;

const Codes = { cin: Cin.optional(), bseCode: BseCode.optional(), isin: Isin.optional(), nseSymbol: NseSymbol.optional() };

/** Confirms a printed identity once: every held file printing any of these identifiers goes to the company. */
export const ConfirmCompanyRequest = z.strictObject({
  identity: z.strictObject(Codes).refine((i) => Object.values(i).some(Boolean), "at least one identifier"),
  company: z.union([z.strictObject({ id: Uuid }), z.strictObject({ new: CreateCompanyRequest.extend(Codes) })]),
});
export type ConfirmCompanyRequest = z.infer<typeof ConfirmCompanyRequest>;

export const ConfirmCompanyResponse = z.strictObject({ companyId: Uuid, confirmed: z.number().int().min(0) });
export type ConfirmCompanyResponse = z.infer<typeof ConfirmCompanyResponse>;
