/**
 * What the Documents page says about a document, kept free of Svelte so it can be tested:
 * where it stands (the stage ladder and a plain-words state), whether it is still being worked
 * on, which one the slip opens, what Maester read it as and the page each answer came from,
 * and what is wrong with a file before it is sent.
 */
import { documentsContent as copy } from '$lib/content/documents';
import { ApiError } from './client';
import type {
	Classification,
	ClassificationSummary,
	CompanyAnswer,
	DocumentRecord,
	Evidence,
	EvidenceField,
	StatementFound
} from './types';

/** The API's upload limit (MAX_UPLOAD_BYTES, 50 MiB), stated before a file is chosen. */
export const MAX_UPLOAD_BYTES = 52_428_800;

/** How often an open slip asks again while Maester is working on its document. */
export const POLL_MS = 2_000;

export type StepStatus = 'done' | 'now' | 'next' | 'needs-you' | 'stopped' | 'not-read';

export interface Step {
	label: string;
	status: StepStatus;
	/** The status as a word: the ladder never shows state by colour. */
	word: string;
}

export interface ViewOptions {
	/** This page is sending the file's bytes right now. */
	uploading?: boolean;
}

function running(doc: DocumentRecord, type: string): boolean {
	const job = doc.latestJob;
	return !!job && job.type === type && (job.state === 'queued' || job.state === 'running');
}

function verifyFailed(doc: DocumentRecord): boolean {
	return doc.latestJob?.type === 'document.verify' && doc.latestJob.state === 'failed';
}

/** A read or identification started again, while the document still shows the last outcome. */
const readingAgain = (doc: DocumentRecord) =>
	(doc.intakeState === 'read' || doc.intakeState === 'read_failed') &&
	running(doc, 'document.extract');
const identifyingAgain = (doc: DocumentRecord) =>
	doc.intakeState === 'identify_failed' && running(doc, 'document.classify');

function statuses(doc: DocumentRecord, opts: ViewOptions): StepStatus[] {
	switch (doc.state) {
		case 'pending_upload':
			return [opts.uploading ? 'now' : 'stopped', 'next', 'next', 'next'];
		case 'uploaded':
		case 'verifying':
			return [verifyFailed(doc) ? 'stopped' : 'now', 'next', 'next', 'next'];
		case 'rejected':
			return ['stopped', 'next', 'next', 'next'];
	}
	if (readingAgain(doc)) return ['done', 'done', 'now', 'next'];
	if (identifyingAgain(doc)) return ['done', 'now', 'next', 'next'];
	switch (doc.intakeState) {
		case null:
		case 'identifying':
			return ['done', 'now', 'next', 'next'];
		case 'duplicate':
		case 'needs_company':
		case 'needs_kind':
			return ['done', 'needs-you', 'next', 'next'];
		case 'identify_failed':
			return ['done', 'stopped', 'next', 'next'];
		case 'kept':
			return ['done', 'done', 'not-read', 'not-read'];
		case 'reading':
			return ['done', 'done', 'now', 'next'];
		case 'read':
			return ['done', 'done', 'done', 'done'];
		case 'read_failed':
			return ['done', 'done', 'stopped', 'next'];
	}
}

/** The stage ladder: Uploaded, Worked out what it is, Reading the statements, Ready. */
export function ladder(doc: DocumentRecord, opts: ViewOptions = {}): Step[] {
	return statuses(doc, opts).map((status, index) => ({
		label: copy.slip.steps[index],
		status,
		word: copy.slip.step[status]
	}));
}

/** Where a document stands, in plain words, for the Earlier list and the status line. */
export function stateLabel(doc: DocumentRecord, opts: ViewOptions = {}): string {
	const states = copy.states;
	switch (doc.state) {
		case 'pending_upload':
			return opts.uploading ? states.uploading : states.uploadUnfinished;
		case 'uploaded':
		case 'verifying':
			return verifyFailed(doc) ? states.checkFailed : states.checking;
		case 'rejected':
			return states.rejected[doc.rejectionCode ?? 'OBJECT_MISSING'];
	}
	if (readingAgain(doc)) return states.reading;
	if (identifyingAgain(doc) || doc.intakeState === null) return states.identifying;
	return states[doc.intakeState];
}

/** Maester is working on it, so an open slip asks again until it stops. */
export function isLive(doc: DocumentRecord): boolean {
	switch (doc.state) {
		case 'pending_upload':
		case 'rejected':
			return false;
		case 'uploaded':
		case 'verifying':
			return !verifyFailed(doc);
	}
	return (
		doc.intakeState === null ||
		doc.intakeState === 'identifying' ||
		doc.intakeState === 'reading' ||
		readingAgain(doc) ||
		identifyingAgain(doc)
	);
}

/**
 * A document the slip should open by itself: anything Maester is still working on or that
 * needs the investor. Read and kept documents are settled. An upload that never finished or a
 * refused file cannot be acted on from here, so it never takes the slip by itself either.
 */
function wantsSlip(doc: DocumentRecord): boolean {
	if (doc.state === 'pending_upload' || doc.state === 'rejected') return false;
	if (verifyFailed(doc) && doc.state !== 'stored') return false;
	return doc.intakeState !== 'read' && doc.intakeState !== 'kept';
}

const newestFirst = (a: DocumentRecord, b: DocumentRecord) =>
	Date.parse(b.createdAt) - Date.parse(a.createdAt);

/**
 * Which document the slip shows: the one the investor opened, else the newest that is not
 * settled, else the newest of all, else none.
 */
export function pickSlip(docs: DocumentRecord[], opened?: string | null): DocumentRecord | null {
	if (opened) {
		const chosen = docs.find((doc) => doc.id === opened);
		if (chosen) return chosen;
	}
	const sorted = [...docs].sort(newestFirst);
	return sorted.find(wantsSlip) ?? sorted[0] ?? null;
}

/** What it is, in plain words: "Annual report", "Financial results, quarter", "Board meeting". */
export function whatItIs(
	answer: Pick<ClassificationSummary, 'kind' | 'otherType' | 'resultsSpan'> | null
): string {
	if (!answer) return '—';
	switch (answer.kind) {
		case 'financial_results':
			return answer.resultsSpan
				? `${copy.kinds.financial_results}, ${copy.spans[answer.resultsSpan]}`
				: copy.kinds.financial_results;
		case 'other':
			return answer.otherType ? copy.otherTypes[answer.otherType] : copy.kinds.other;
		default:
			return copy.kinds[answer.kind];
	}
}

/**
 * Where an answer came from: "Page 3: “Annual Report 2025–26”" for an answer read from the
 * filing (pages counted from 1), "You said so" for the investor's, or null when there is no page
 * to point at. Never a confidence.
 */
export function sourceOf(evidence: Evidence[], field: EvidenceField): string | null {
	const forField = evidence.filter((e) => e.field === field);
	if (forField.some((e) => e.source === 'investor')) return copy.slip.youSaidSo;
	const found = forField.find((e) => e.pageIndex !== null);
	if (!found || found.pageIndex === null) return null;
	const page = `Page ${found.pageIndex + 1}`;
	return found.quote ? `${page}: “${found.quote}”` : page;
}

/** "Balance sheet (standalone), Profit and loss (standalone)", or "—" when none was found. */
export function statementsWords(found: StatementFound[]): string {
	if (found.length === 0) return '—';
	return found.map((s) => `${copy.statements[s.statement]} (${copy.bases[s.basis]})`).join(', ');
}

/** The period as the filing states it, else its end date, else unknown. */
export function periodWords(answer: Pick<Classification, 'periodLabel' | 'periodEnd'>): string {
	if (answer.periodLabel) return answer.periodLabel;
	if (answer.periodEnd) {
		const date = new Date(`${answer.periodEnd}T00:00:00Z`);
		const formatted = new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(date);
		return `To ${formatted}`;
	}
	return '—';
}

export interface PrintedIdentifier {
	label: 'CIN' | 'BSE' | 'NSE';
	value: string;
	/** 1-based page it was printed on, when the evidence says. */
	page: number | null;
}

/** The identifiers printed on the filing, each with the page it was found on. */
export function identifiers(
	answer: Pick<Classification, 'cin' | 'bseCode' | 'nseSymbol'>,
	evidence: Evidence[]
): PrintedIdentifier[] {
	const found: [PrintedIdentifier['label'], string | null][] = [
		['CIN', answer.cin],
		['BSE', answer.bseCode],
		['NSE', answer.nseSymbol]
	];
	return found.flatMap(([label, value]) => {
		if (!value) return [];
		const source = evidence.find(
			(e) => e.field === 'identifier' && e.pageIndex !== null && e.quote?.includes(value)
		);
		return [{ label, value, page: source?.pageIndex != null ? source.pageIndex + 1 : null }];
	});
}

// The API's own checks (packages/contracts/src/classification.ts): an identifier that does not
// match is left out rather than sent and refused.
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const BSE = /^\d{6}$/;
const NSE = /^[A-Z][A-Z0-9&-]{0,19}$/;

/**
 * The answer that adds the company as printed (or under `name`), in India, carrying the
 * identifiers printed on the filing that are well formed.
 */
export function companyAnswer(
	answer: Pick<Classification, 'companyNameAsPrinted' | 'cin' | 'bseCode' | 'nseSymbol'>,
	name?: string
): CompanyAnswer {
	const displayName = (name ?? answer.companyNameAsPrinted ?? '').trim();
	return {
		new: {
			displayName,
			country: 'IN',
			...(answer.cin && CIN.test(answer.cin) ? { cin: answer.cin } : {}),
			...(answer.bseCode && BSE.test(answer.bseCode) ? { bseCode: answer.bseCode } : {}),
			...(answer.nseSymbol && NSE.test(answer.nseSymbol) ? { nseSymbol: answer.nseSymbol } : {})
		}
	};
}

const MIB = 1024 * 1024;

/** "62 MB", or "50.1 MB" when rounding would hide that it is over the limit. */
function megabytes(size: number): string {
	const whole = Math.round(size / MIB);
	if (whole * MIB > MAX_UPLOAD_BYTES) return `${whole} MB`;
	return `${(Math.ceil((size / MIB) * 10) / 10).toFixed(1)} MB`;
}

const FILE_KINDS: [RegExp, keyof typeof copy.precheck.fileKinds][] = [
	[/\.(docx?|odt|rtf|pages)$/i, 'word'],
	[/\.(xlsx?|ods|csv|numbers)$/i, 'spreadsheet'],
	[/\.(pptx?|odp|key)$/i, 'presentation'],
	[/\.(jpe?g|png|gif|heic|heif|tiff?|webp|bmp)$/i, 'picture']
];

/**
 * What is wrong with a file before it is sent, in the words the page shows, or null when it can
 * go. A PDF is a .pdf whose type is PDF (or that the browser left untyped).
 */
export function checkFile(file: { name: string; size: number; type: string }): string | null {
	const pdfName = /\.pdf$/i.test(file.name);
	const pdfType = file.type === 'application/pdf' || file.type === '';
	if (!pdfName || !pdfType) {
		const known = FILE_KINDS.find(([pattern]) => pattern.test(file.name));
		return known
			? copy.precheck.notPdfKnown(copy.precheck.fileKinds[known[1]])
			: copy.precheck.notPdf;
	}
	if (file.size > MAX_UPLOAD_BYTES) return copy.precheck.tooLarge(megabytes(file.size));
	return null;
}

/** "14:02" for today, "2 Oct, 14:02" before that, in the reader's time zone. */
export function addedAt(iso: string, now: Date = new Date(), timeZone?: string): string {
	const date = new Date(iso);
	const day = (d: Date) =>
		new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone }).format(d);
	const time = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(date);
	if (day(date) === day(now)) return time;
	const dayMonth = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		timeZone
	}).format(date);
	return `${dayMonth}, ${time}`;
}

export interface Failure {
	message: string;
	/** The answers moved on elsewhere: load the latest and show them. */
	reload: boolean;
}

/** What to say when a change to the answers was refused, and whether to load the latest. */
export function changeFailure(error: unknown): Failure {
	const said = copy.changeFailed;
	if (!(error instanceof ApiError)) return { message: said.other, reload: false };
	switch (error.code) {
		case 'CONFLICT':
			if (error.names('company.new')) return { message: said.companyClash, reload: false };
			return error.names('basedOn')
				? { message: said.changed, reload: true }
				: { message: said.moved, reload: true };
		case 'INVALID_STATE':
		case 'NOT_FOUND':
			return { message: said.moved, reload: true };
		case 'VALIDATION_FAILED':
			return {
				message: error.message === 'nothing changed' ? said.nothing : said.invalid,
				reload: false
			};
		case 'UNAUTHENTICATED':
			return { message: said.signedOut, reload: false };
		case 'NETWORK':
			return { message: said.offline, reload: false };
		default:
			return { message: said.other, reload: false };
	}
}

/** What to say when an upload did not finish, and whether signing in again is the way out. */
export function uploadFailure(
	error: unknown,
	file: { size: number }
): { message: string; signIn: boolean } {
	const said = copy.uploadFailed;
	if (error instanceof ApiError) {
		if (error.code === 'UPLOAD_TOO_LARGE')
			return { message: copy.precheck.tooLarge(megabytes(file.size)), signIn: false };
		if (error.code === 'UNAUTHENTICATED') return { message: said.signedOut, signIn: true };
		if (error.code === 'NETWORK') return { message: said.offline, signIn: false };
	}
	return { message: said.other, signIn: false };
}
