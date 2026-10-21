/**
 * The API's document shapes, as far as the Documents page reads them. apps/web is a standalone
 * project and cannot import @maester/contracts, so these mirror (a subset of) its schemas:
 *
 * - packages/contracts/src/document.ts (Document, CreateUploadResponse, FinalizeResponse,
 *   ClassificationChanged)
 * - packages/contracts/src/classification.ts (Classification, ClassificationSummary, Evidence,
 *   IntakeState, ChangeClassificationRequest, the kind and type enums)
 * - packages/contracts/src/company.ts (Company)
 * - packages/contracts/src/job.ts (Job)
 * - packages/contracts/src/pipeline.ts (DocumentPipeline, XbrlReadWarning)
 * - packages/contracts/src/filings.ts (WorkspaceFilings and what it holds, ConfirmCompanyRequest
 *   and Response)
 * - packages/contracts/src/xbrl.ts (XbrlFormatKind, XbrlPdfNotChecked)
 * - packages/contracts/src/common.ts and workspace.ts (ApiError, paginated lists, Me)
 *
 * Only the fields this page uses are copied. When a contract changes, change it here too.
 */

export type DocumentState = 'pending_upload' | 'uploaded' | 'verifying' | 'stored' | 'rejected';
export type RejectionCode = 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'OBJECT_MISSING';

export type IntakeState =
	| 'identifying'
	| 'duplicate'
	| 'needs_company'
	| 'needs_kind'
	| 'kept'
	| 'reading'
	| 'read'
	| 'identify_failed'
	| 'read_failed'
	| 'waiting_for_xbrl';

export type ClassificationKind = 'annual_report' | 'financial_results' | 'other' | 'not_sure';
/** The kinds an investor can give; "not sure" is Maester's answer only. */
export type ChosenKind = Exclude<ClassificationKind, 'not_sure'>;

export const OTHER_TYPES = [
	'shareholding_pattern',
	'shareholder_notice',
	'board_meeting',
	'investor_presentation',
	'earnings_call',
	'governance_filing',
	'announcement',
	'offer_document',
	'unlisted_type'
] as const;
export type OtherType = (typeof OTHER_TYPES)[number];

export const RESULTS_SPANS = ['quarter', 'half_year', 'nine_months', 'full_year'] as const;
export type ResultsSpan = (typeof RESULTS_SPANS)[number];

export type EvidenceField =
	'kind' | 'other_type' | 'company' | 'identifier' | 'period' | 'results_span' | 'statements';

export type StatementKind = 'balance_sheet' | 'income_statement' | 'cash_flow';
export type ReportingBasis = 'consolidated' | 'standalone' | 'unknown';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Job {
	id: string;
	type: string;
	state: JobState;
	lastErrorCode: string | null;
}

export interface ClassificationSummary {
	id: string;
	kind: ClassificationKind;
	otherType: OtherType | null;
	resultsSpan: ResultsSpan | null;
	periodLabel: string | null;
	companyId: string | null;
	companyNameAsPrinted: string | null;
	setBy: 'maester' | 'investor';
}

export interface StatementFound {
	statement: StatementKind;
	basis: ReportingBasis;
	/** 0-based page indexes. */
	pages: number[];
}

export interface Classification extends ClassificationSummary {
	documentId: string;
	periodEnd: string | null;
	cin: string | null;
	bseCode: string | null;
	nseSymbol: string | null;
	/** From an XBRL instance's ISIN; null for a PDF. */
	isin: string | null;
	statementsFound: StatementFound[];
}

export interface Evidence {
	field: EvidenceField;
	source: 'rule' | 'model' | 'investor';
	/** 0-based; null for the investor's own answers. */
	pageIndex: number | null;
	quote: string | null;
	/** Whether the quote was found in the page's text layer; null when the page has none (a scan). */
	textLayerMatch: boolean | null;
	/** The XBRL element the answer was read from; null for a PDF. */
	element: string | null;
	/** The XBRL context that element was read in; null for a PDF. */
	context: string | null;
}

export interface DocumentClassification {
	classification: Classification;
	evidence: Evidence[];
}

/** What a stored file is: a PDF, or an XBRL instance (XML). */
export type DocumentFormat = 'pdf' | 'xbrl';

/** The span a fact or a filing covers (packages/contracts/src/extraction.ts). */
export type FactSpan = 'quarter' | 'half_year' | 'nine_months' | 'year' | 'other';

/** The kind of an XBRL instance (packages/contracts/src/xbrl.ts). */
export type XbrlFormatKind = 'ind_as' | 'banking' | 'nbfc' | 'other_than_ind_as' | 'unknown';

/** Why an XBRL statement's facts were not looked for on the filing's PDF. */
export type XbrlPdfNotChecked =
	'no_pdf' | 'scanned' | 'no_statement_pages' | 'disabled' | 'no_value' | 'no_unit' | 'not_yet';

/** The warnings of a read XBRL revision, most serious first. */
export type XbrlReadWarning =
	'XBRL_ELEMENT_UNMAPPED' | 'XBRL_ROUNDING_MISSING' | 'XBRL_ROUNDING_MISMATCH' | 'XBRL_NIL';

/** The values of `numbers.state` in packages/contracts/src/pipeline.ts, all of them. */
export type NumbersState = 'done' | 'now' | 'not_needed' | 'failed' | 'waiting' | 'not_read';

export type NumbersReason =
	| 'format_unmapped'
	| 'not_a_read_kind'
	| 'duplicate'
	| 'waiting_for_xbrl'
	| 'not_identified'
	| 'needs_you';

/** Where one document stands on each of its tracks (packages/contracts/src/pipeline.ts). */
export interface DocumentPipeline {
	stored: 'done' | 'now' | 'failed';
	identified: 'done' | 'now' | 'needs_you' | 'failed' | 'waiting' | 'not_needed';
	numbers: {
		source: 'xbrl' | 'pdf' | null;
		state: NumbersState;
		/** The XBRL documents that give a PDF its numbers (`not_needed`), or part of them (`done`). */
		coveredByXbrl: string[];
		/** The XBRL documents a PDF waits on. */
		waitingOn: string[];
		reason: NumbersReason | null;
		/** The kind of an instance Maester reads but has no map for, with `format_unmapped`. */
		format: XbrlFormatKind | null;
		/** An XBRL read that is `done` with some lines left out. */
		partial: boolean;
		warnings: XbrlReadWarning[];
	};
	text: {
		state: 'done' | 'now' | 'partial' | 'failed' | 'waiting' | 'not_needed';
		pages: number;
		pagesRead: number;
		pagesOcr: number;
		chunks: number;
		xbrlBlocks: number;
		/** Index jobs queued before this document's, or null when its job is not queued. */
		ahead: number | null;
	};
}

export interface DocumentRecord {
	id: string;
	companyId: string | null;
	originalName: string;
	declaredSize: number;
	format: DocumentFormat;
	state: DocumentState;
	rejectionCode: RejectionCode | null;
	intakeState: IntakeState | null;
	duplicateOfDocumentId: string | null;
	classification: ClassificationSummary | null;
	createdAt: string;
	latestJob: Job | null;
	pipeline: DocumentPipeline;
}

export interface Company {
	id: string;
	displayName: string;
	country: string;
	cin: string | null;
	bseCode: string | null;
	nseSymbol: string | null;
	isin: string | null;
}

export interface Page<T> {
	items: T[];
	nextCursor: string | null;
}

export interface Me {
	user: { id: string; name: string; email: string };
	workspaces: { id: string; name: string }[];
}

export interface UploadTarget {
	method: 'PUT';
	url: string;
	headers: Record<string, string>;
	expiresAt: string;
}

export interface CreateUploadResponse {
	document: DocumentRecord;
	upload: UploadTarget;
}

export interface FinalizeResponse {
	document: DocumentRecord;
	job: Job;
}

export type CompanyAnswer =
	| { id: string }
	| {
			new: {
				displayName: string;
				country: string;
				cin?: string;
				bseCode?: string;
				nseSymbol?: string;
			};
	  };

export interface ChangeClassificationRequest {
	basedOn: string;
	kind?: ChosenKind;
	otherType?: OtherType | null;
	resultsSpan?: ResultsSpan | null;
	company?: CompanyAnswer;
}

export interface ClassificationChanged extends DocumentClassification {
	document: DocumentRecord;
}

/** Why a statement's numbers do not come from XBRL, or from nowhere (contracts filings.ts). */
export type StatementSourceReason =
	| 'xbrl_lacks_statement'
	| 'xbrl_format_unmapped'
	| 'no_xbrl'
	| 'not_in_filing'
	| 'not_read_yet'
	| 'read_failed'
	| 'xbrl_read_failed'
	| 'xbrl_not_read_yet';

/** How many of an XBRL statement's facts were found on the filing's PDF. */
export interface InPdfCount {
	found: number;
	checked: number;
	/** Fact ids. */
	notFound: string[];
	notChecked: XbrlPdfNotChecked | null;
}

/** Where one statement of one basis in a filing gets its numbers. */
export interface StatementSource {
	statement: StatementKind;
	source: 'xbrl' | 'pdf' | null;
	xbrlDocumentId: string | null;
	xbrlSpans: FactSpan[];
	pdfDocumentId: string | null;
	/** 0-based pages of the PDF that print the statement. */
	pdfPages: number[];
	reason: StatementSourceReason | null;
	inPdf: InPdfCount | null;
}

export interface BasisSources {
	basis: ReportingBasis;
	statements: StatementSource[];
}

/** One file of a filing, or an unsorted file, whatever its document state. */
export interface FilingFile {
	documentId: string;
	originalName: string;
	format: DocumentFormat;
	/** An XBRL instance's basis; null for a PDF. */
	basis: ReportingBasis | null;
	createdAt: string;
	state: DocumentState;
	rejectionCode: RejectionCode | null;
	intakeState: IntakeState | null;
	/** The company name the current classification prints; null when it prints none. */
	companyNameAsPrinted: string | null;
	/** Ids of the files that are copies of this one. */
	duplicates: string[];
	pipeline: DocumentPipeline;
}

/** One filing of one company: the files for one kind and period end. */
export interface WorkspaceFiling {
	key: string;
	kind: ClassificationKind;
	otherType: OtherType | null;
	/** An ISO date (YYYY-MM-DD). */
	periodEnd: string | null;
	spans: ResultsSpan[];
	files: FilingFile[];
	sources: BasisSources[];
	settled: boolean;
	addedAt: string;
}

/** Files held for a company, grouped by the identity they print. */
export interface HeldIdentity {
	key: string;
	nameAsPrinted: string | null;
	cin: string | null;
	bseCode: string | null;
	isin: string | null;
	nseSymbol: string | null;
	files: number;
	filings: number;
	documentIds: string[];
	/** The ids of the workspace's companies it could be. */
	matches: string[];
}

export interface WorkspaceFilings {
	companies: { company: Company; filings: WorkspaceFiling[] }[];
	held: HeldIdentity[];
	unsorted: FilingFile[];
}

export interface ConfirmCompanyRequest {
	identity: { cin?: string; bseCode?: string; isin?: string; nseSymbol?: string };
	company:
		| { id: string }
		| {
				new: {
					displayName: string;
					country: string;
					cin?: string;
					bseCode?: string;
					isin?: string;
					nseSymbol?: string;
				};
		  };
}

export interface ConfirmCompanyResponse {
	companyId: string;
	confirmed: number;
}

export type ErrorCode =
	| 'UNAUTHENTICATED'
	| 'FORBIDDEN'
	| 'NOT_FOUND'
	| 'VALIDATION_FAILED'
	| 'CONFLICT'
	| 'UPLOAD_TOO_LARGE'
	| 'UNSUPPORTED_MEDIA_TYPE'
	| 'INVALID_STATE'
	| 'RATE_LIMITED'
	| 'INTERNAL';

export interface FieldError {
	path: string;
	message: string;
}
