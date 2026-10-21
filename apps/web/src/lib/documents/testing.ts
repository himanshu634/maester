/**
 * Builders for the tests of the Documents page: whole API shapes from a few words each. Only
 * `*.test.ts` files import this module, so none of it ships. Every default is a stored PDF with
 * every track done; a test names only what it is about.
 */
import type {
	BasisSources,
	Company,
	DocumentPipeline,
	DocumentRecord,
	FilingFile,
	HeldIdentity,
	RejectionCode,
	ReportingBasis,
	StatementSource,
	WorkspaceFiling,
	WorkspaceFilings
} from './types';

/** `T` with every field optional, all the way down. Arrays are given whole. */
export type DeepPartial<T> = T extends readonly unknown[]
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Overlay `over` on `base`: objects merge key by key; arrays and scalars replace. */
function merge<T>(base: T, over: DeepPartial<T> | undefined): T {
	if (over === undefined) return base;
	if (!isRecord(base) || !isRecord(over)) return over as T;
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(over)) {
		if (value !== undefined) out[key] = merge(base[key], value as DeepPartial<unknown>);
	}
	return out as T;
}

/** A pipeline of a stored PDF whose three tracks are all done. */
export function pipe(over: DeepPartial<DocumentPipeline> = {}): DocumentPipeline {
	return merge<DocumentPipeline>(
		{
			stored: 'done',
			identified: 'done',
			numbers: {
				source: 'pdf',
				state: 'done',
				coveredByXbrl: [],
				waitingOn: [],
				reason: null,
				format: null,
				partial: false,
				warnings: []
			},
			text: {
				state: 'done',
				pages: 10,
				pagesRead: 10,
				pagesOcr: 0,
				chunks: 20,
				xbrlBlocks: 0,
				ahead: null
			}
		},
		over
	);
}

/** Ids handed out in order, `doc-1`, `doc-2`, …, when a builder is given none. */
let nextId = 0;

type FileOver = Omit<Partial<FilingFile>, 'pipeline'> & {
	pipeline?: DeepPartial<DocumentPipeline>;
};

export function fileOf(over: FileOver = {}): FilingFile {
	const { pipeline, ...rest } = over;
	const documentId = rest.documentId ?? `doc-${++nextId}`;
	const format = rest.format ?? 'pdf';
	return {
		documentId,
		originalName: `${documentId}.${format === 'xbrl' ? 'xml' : 'pdf'}`,
		format,
		basis: 'consolidated',
		createdAt: '2026-10-19T08:32:00Z',
		state: 'stored',
		rejectionCode: null,
		intakeState: 'read',
		companyNameAsPrinted: null,
		duplicates: [],
		...rest,
		pipeline: pipe(pipeline)
	};
}

export function filingOf(over: Partial<WorkspaceFiling> = {}): WorkspaceFiling {
	return {
		key: 'co-1:annual_report:2026-03-31',
		kind: 'annual_report',
		otherType: null,
		periodEnd: '2026-03-31',
		spans: [],
		files: [],
		sources: [],
		settled: true,
		addedAt: '2026-10-19T08:32:00Z',
		...over
	};
}

export function companyOf(over: Partial<Company> = {}): Company {
	return {
		id: 'co-1',
		displayName: 'Synthetic Cements Limited',
		country: 'IN',
		cin: null,
		bseCode: null,
		nseSymbol: null,
		isin: null,
		...over
	};
}

export function heldOf(over: Partial<HeldIdentity> = {}): HeldIdentity {
	return {
		key: 'held-1',
		nameAsPrinted: 'Meridian Foods Limited',
		cin: null,
		bseCode: null,
		isin: null,
		nseSymbol: null,
		files: 1,
		filings: 1,
		documentIds: ['doc-1'],
		matches: [],
		...over
	};
}

export function docOf(over: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		id: 'd-1',
		companyId: null,
		originalName: 'synthetic-cements-ar-2025-26.pdf',
		declaredSize: 1077,
		format: 'pdf',
		state: 'stored',
		rejectionCode: null,
		intakeState: 'read',
		duplicateOfDocumentId: null,
		classification: null,
		createdAt: '2026-10-19T08:32:00Z',
		latestJob: null,
		pipeline: pipe(),
		...over
	};
}

/** A filings read; empty lists unless a test gives some. */
export function readWith(over: Partial<WorkspaceFilings> = {}): WorkspaceFilings {
	return { companies: [], held: [], unsorted: [], ...over };
}

/** An XBRL statement source: the income statement from one XBRL file, a quarter, no PDF. */
export function stmt(over: Partial<StatementSource> = {}): StatementSource {
	return {
		statement: 'income_statement',
		source: 'xbrl',
		xbrlDocumentId: 'doc-1',
		xbrlSpans: ['quarter'],
		pdfDocumentId: null,
		pdfPages: [],
		reason: null,
		inPdf: null,
		...over
	};
}

export function basisOf(basis: ReportingBasis, statements: StatementSource[]): BasisSources {
	return { basis, statements };
}

/** An XBRL file whose numbers are read. */
export function xbrlDone(id: string, basis: ReportingBasis = 'consolidated'): FilingFile {
	return fileOf({
		documentId: id,
		format: 'xbrl',
		basis,
		pipeline: { numbers: { source: 'xbrl', state: 'done' } }
	});
}

/** An XBRL file whose read failed. */
export function xbrlFailed(id: string, basis: ReportingBasis = 'consolidated'): FilingFile {
	return fileOf({
		documentId: id,
		format: 'xbrl',
		basis,
		intakeState: 'read_failed',
		pipeline: { numbers: { source: 'xbrl', state: 'failed' } }
	});
}

/** A PDF that gave its own numbers. */
export function pdfDone(id: string): FilingFile {
	return fileOf({ documentId: id, pipeline: { numbers: { source: 'pdf', state: 'done' } } });
}

/** A PDF whose numbers come from XBRL files, so it has none to read. */
export function pdfNotNeeded(id: string, coveredBy: string[]): FilingFile {
	return fileOf({
		documentId: id,
		pipeline: { numbers: { source: 'xbrl', state: 'not_needed', coveredByXbrl: coveredBy } }
	});
}

/** A file the API refused. */
export function rejected(id: string, code: RejectionCode | null): FilingFile {
	return fileOf({
		documentId: id,
		state: 'rejected',
		rejectionCode: code,
		intakeState: null,
		pipeline: { stored: 'failed', identified: 'waiting' }
	});
}

/** An upload that never finished. */
export function abandoned(id: string): FilingFile {
	return fileOf({
		documentId: id,
		state: 'pending_upload',
		intakeState: null,
		pipeline: { stored: 'now', identified: 'waiting', text: { state: 'waiting', ahead: null } }
	});
}
