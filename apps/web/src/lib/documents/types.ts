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
 * - packages/contracts/src/pipeline.ts (DocumentPipeline, the numbers track only)
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

/** The values of `numbers.state` in packages/contracts/src/pipeline.ts, all of them. */
export type NumbersState = 'done' | 'now' | 'not_needed' | 'failed' | 'waiting' | 'not_read';

/** The part of the API's DocumentPipeline the page reads: where the document's numbers come from. */
export interface DocumentPipeline {
	numbers: {
		state: NumbersState;
		/** The XBRL documents that give a PDF its numbers (`not_needed`), or part of them (`done`). */
		coveredByXbrl: string[];
	};
}

export interface DocumentRecord {
	id: string;
	companyId: string | null;
	originalName: string;
	declaredSize: number;
	/** What the stored file is: a PDF, or an XBRL instance (XML). */
	format: 'pdf' | 'xbrl';
	state: DocumentState;
	rejectionCode: RejectionCode | null;
	intakeState: IntakeState | null;
	duplicateOfDocumentId: string | null;
	classification: ClassificationSummary | null;
	createdAt: string;
	latestJob: Job | null;
	pipeline?: DocumentPipeline;
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
