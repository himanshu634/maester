/**
 * A filing's two tracks in words: the Numbers line and the Text line of a filing row, from its
 * files' pipelines and its statement sources (spec 2026-10-19 sections 3 to 5; plan Decisions 1,
 * 2, 5, 18 and 19). Free of Svelte and of the page: every function takes what it reads. Counts of
 * files, pages, passages and figures found are counts, not figures, so they are summed here; no
 * figure value is read or computed.
 */
import { documentsContent } from '$lib/content/documents';
import { IN_PDF_RESULT_SHOWN } from './in-pdf';
import type {
	BasisSources,
	FilingFile,
	InPdfCount,
	NumbersState,
	ReportingBasis,
	StatementKind,
	StatementSource,
	StatementSourceReason,
	XbrlFormatKind,
	XbrlReadWarning
} from './types';

const words = documentsContent.tracks;

export type TrackState = 'now' | 'next' | 'done' | 'needs-you' | 'stopped' | 'not-read';

/**
 * One track's two lines. The first is bold only when `needs-you` or `stopped` (Decision 18), and
 * an ink block only in the opened filing while `now`; that is the component's to draw.
 */
export interface TrackWords {
	state: TrackState;
	first: string;
	second: string | null;
}

/** What the page knows that a filing's files cannot say. */
export interface TrackContext {
	/** Whether this page is sending the document's file right now. */
	uploading: (documentId: string) => boolean;
	/** The printed name of a file of the workspace, when the page knows it. */
	nameOf: (documentId: string) => string | null;
}

/** A `pending_upload` that this page is not sending (Decision 5). */
export function abandonedUpload(file: FilingFile, ctx: TrackContext): boolean {
	return file.state === 'pending_upload' && !ctx.uploading(file.documentId);
}

/** The XBRL states a statement's reason waits on: it holds only while an XBRL file of its basis is in one. */
const REASON_HOLDS_WHILE: Partial<Record<StatementSourceReason, NumbersState[]>> = {
	xbrl_not_read_yet: ['now', 'waiting'],
	xbrl_read_failed: ['failed']
};

/**
 * Whether the files say the sources are out of date. The sources come from the last filings read;
 * the open filing's 2 s poll patches the files only. A statement whose reason is
 * `xbrl_not_read_yet` or `xbrl_read_failed` is stale when the files hold an XBRL file of its basis
 * and none of them is still in the state that reason names: that XBRL has been read, or has failed,
 * since. With no XBRL file of the basis among the files, the files say nothing and the sources
 * stand.
 */
export function sourcesStale(files: FilingFile[], sources: BasisSources[]): boolean {
	return sources.some((b) =>
		b.statements.some((s) => {
			const holdsWhile = s.reason === null ? undefined : REASON_HOLDS_WHILE[s.reason];
			if (holdsWhile === undefined) return false;
			const ofBasis = files.filter((f) => f.format === 'xbrl' && f.basis === b.basis);
			return (
				ofBasis.length > 0 && !ofBasis.some((f) => holdsWhile.includes(f.pipeline.numbers.state))
			);
		})
	);
}

/**
 * Whether a PDF's own numbers are needed (Decision 2). Never while an XBRL file of the filing is
 * still being read or waiting: what it covers is not known yet. Never while the sources are stale
 * (`sourcesStale`): what the XBRL covers is not known until the filings are read again, and an
 * unknown is not "nothing comes from XBRL". Then: some statement takes its numbers from this PDF,
 * or nothing at all comes from XBRL, so nothing can cover it.
 */
export function pdfNeeded(file: FilingFile, files: FilingFile[], sources: BasisSources[]): boolean {
	const xbrlBusy = files.some(
		(f) =>
			f.format === 'xbrl' &&
			(f.pipeline.numbers.state === 'now' || f.pipeline.numbers.state === 'waiting')
	);
	if (xbrlBusy || sourcesStale(files, sources)) return false;
	const statements = sources.flatMap((b) => b.statements);
	if (statements.some((s) => s.source === 'pdf' && s.pdfDocumentId === file.documentId))
		return true;
	return !statements.some((s) => s.source === 'xbrl');
}

/**
 * Whether "Read it again" and "Try again" may send a PDF to `extract` (a paid model read): its
 * numbers are needed (`pdfNeeded`), and it is not held back for a free read. A PDF is held back
 * when its only claim on its statements is `xbrl_read_failed` (the API fell back to it because the
 * XBRL could not be read) and a failed XBRL file of each of those bases is in the same send set:
 * the free XBRL read goes alone, and the PDF waits for its outcome.
 */
export function pdfWorthReading(
	file: FilingFile,
	files: FilingFile[],
	sources: BasisSources[]
): boolean {
	if (!pdfNeeded(file, files, sources)) return false;
	const claims = sources.flatMap((b) =>
		b.statements
			.filter((s) => s.source === 'pdf' && s.pdfDocumentId === file.documentId)
			.map((s) => ({ basis: b.basis, reason: s.reason }))
	);
	const heldBack =
		claims.length > 0 &&
		claims.every(
			(claim) =>
				claim.reason === 'xbrl_read_failed' &&
				files.some(
					(f) =>
						f.format === 'xbrl' && f.basis === claim.basis && f.pipeline.numbers.state === 'failed'
				)
		);
	return !heldBack;
}

export function formatWords(kind: XbrlFormatKind): string {
	return words.formats[kind];
}

export function warningWords(warning: XbrlReadWarning): string {
	return words.warnings[warning];
}

const BASIS_ORDER: ReportingBasis[] = ['consolidated', 'standalone', 'unknown'];
const STATEMENT_ORDER: StatementKind[] = ['income_statement', 'balance_sheet', 'cash_flow'];

function basisName(basis: ReportingBasis): string {
	return documentsContent.bases[basis];
}

function sentenceCase(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function inBasisOrder(sources: BasisSources[]): BasisSources[] {
	return BASIS_ORDER.flatMap((basis) => sources.filter((b) => b.basis === basis));
}

/** The statements of `list`, in the order profit and loss, balance sheet, cash flow, comma-joined. */
function statementList(list: StatementSource[]): string {
	return STATEMENT_ORDER.filter((kind) => list.some((s) => s.statement === kind))
		.map((kind) => words.statementNames[kind])
		.join(', ');
}

interface BasisSplit {
	basis: ReportingBasis;
	xbrl: StatementSource[];
	pdf: StatementSource[];
}

function splits(sources: BasisSources[]): BasisSplit[] {
	return inBasisOrder(sources)
		.map((b) => ({
			basis: b.basis,
			xbrl: b.statements.filter((s) => s.source === 'xbrl'),
			pdf: b.statements.filter((s) => s.source === 'pdf')
		}))
		.filter((b) => b.xbrl.length + b.pdf.length > 0);
}

/** Which statements of a basis come from which source, as one comparable string. */
function signature(b: BasisSplit): string {
	return `${statementList(b.xbrl)}|${statementList(b.pdf)}`;
}

/**
 * Where the statements come from, bases kept apart (spec section 3). The same split in every basis
 * is said once; one source per basis is said per basis; otherwise each basis says its own split.
 */
export function splitWords(sources: BasisSources[]): string | null {
	const bases = splits(sources);
	if (bases.length === 0) return null;
	const [first] = bases;
	const sameSplit = bases.every((b) => signature(b) === signature(first));
	if (sameSplit && first.xbrl.length > 0 && first.pdf.length > 0) {
		return words.split.joined(
			words.split.xbrl(statementList(first.xbrl)),
			words.split.pdf(statementList(first.pdf))
		);
	}
	const oneSource = (b: BasisSplit) => b.xbrl.length === 0 || b.pdf.length === 0;
	const parts = bases.map((b, at) => {
		const name = at === 0 ? sentenceCase(basisName(b.basis)) : basisName(b.basis);
		if (oneSource(b)) return words.split.oneSource(name, b.xbrl.length > 0 ? 'xbrl' : 'pdf');
		return words.split.mixed(name, statementList(b.xbrl), statementList(b.pdf));
	});
	return `${parts.join('; ')}.`;
}

interface BasisCheck {
	basis: ReportingBasis;
	found: number;
	checked: number;
	missed: number;
	/** At least one statement of the basis was looked for in the PDF. */
	isChecked: boolean;
	notChecked: InPdfCount['notChecked'];
}

function basisChecks(sources: BasisSources[]): BasisCheck[] {
	return inBasisOrder(sources).flatMap((b) => {
		const xbrl = b.statements.filter((s) => s.source === 'xbrl');
		if (xbrl.length === 0) return [];
		const counts = xbrl.flatMap((s) => (s.inPdf ? [s.inPdf] : []));
		return [
			{
				basis: b.basis,
				found: counts.reduce((sum, c) => sum + c.found, 0),
				checked: counts.reduce((sum, c) => sum + c.checked, 0),
				missed: counts.reduce((sum, c) => sum + c.notFound.length, 0),
				isChecked: counts.some((c) => c.checked > 0),
				notChecked: counts.map((c) => c.notChecked).find((reason) => reason !== null) ?? null
			}
		];
	});
}

/**
 * How many of the XBRL's figures the PDF shows, each XBRL basis counted apart. The rule is keyed
 * on how many XBRL bases there are, never on how many were checked, so an unchecked basis never
 * reads as passed (spec section 3).
 */
export function checkLine(
	sources: BasisSources[],
	shown: boolean = IN_PDF_RESULT_SHOWN
): string | null {
	const bases = basisChecks(sources);
	if (bases.length === 0) return null;
	// While the result is not shown (`IN_PDF_RESULT_SHOWN`), a basis looked for in the PDF reads
	// as not checked.
	if (!shown && bases.every((b) => b.isChecked)) return words.check.resultNotShown;
	if (bases.length === 1) {
		const [only] = bases;
		if (only.isChecked) {
			return only.missed > 0
				? words.check.missed(only.missed)
				: words.check.found(only.found, only.checked);
		}
		return only.notChecked
			? words.check.notChecked[only.notChecked]
			: words.check.notCheckedUnknown;
	}
	const parts = bases.map((b) => {
		const name = basisName(b.basis);
		if (b.isChecked) {
			return shown
				? words.checkBases.found(name, b.found, b.checked)
				: words.checkBases.notChecked(name);
		}
		if (b.notChecked === 'not_yet') return words.checkBases.notYet(name);
		const why = b.notChecked ? words.checkBases.why[b.notChecked] : undefined;
		return why ? words.checkBases.notCheckedWhy(name, why) : words.checkBases.notChecked(name);
	});
	return `${words.checkBases.prefix}${parts.join(', ')}.`;
}

/**
 * A caveat on the numbers of one XBRL file that was read: the first warning, or that part of it
 * was not read. Null for a file not (yet) done and for a clean read.
 */
export function fileCaveat(file: FilingFile): string | null {
	const numbers = file.pipeline.numbers;
	if (numbers.state !== 'done') return null;
	if (!numbers.partial && numbers.warnings.length === 0) return null;
	const [first] = numbers.warnings;
	return first ? warningWords(first) : words.partialRead;
}

/** A partial read is never a clean "done" in words: the first caveat of the XBRL files read. */
function caveat(xbrl: FilingFile[]): string | null {
	for (const file of xbrl) {
		const said = fileCaveat(file);
		if (said !== null) return said;
	}
	return null;
}

function joinLines(...lines: (string | null)[]): string | null {
	const kept = lines.filter((line): line is string => line !== null && line !== '');
	return kept.length > 0 ? kept.join(' ') : null;
}

/** Why a PDF is read as it is: what the XBRL beside it says. */
function pdfReason(xbrl: FilingFile[], sources: BasisSources[]): string | null {
	if (xbrl.length === 0) return words.noXbrl;
	const unmapped = xbrl.find(
		(f) =>
			f.pipeline.numbers.state === 'not_read' && f.pipeline.numbers.reason === 'format_unmapped'
	);
	if (unmapped) return words.unmapped(formatWords(unmapped.pipeline.numbers.format ?? 'unknown'));
	if (xbrl.some((f) => f.pipeline.numbers.state === 'failed')) return words.xbrlUnreadable;
	if (xbrl.some((f) => f.pipeline.numbers.state === 'done')) return splitWords(sources);
	return null;
}

function failedWords(file: FilingFile): string {
	if (file.state !== 'rejected') return words.checkFailed;
	return words.rejected[file.rejectionCode ?? 'OBJECT_MISSING'];
}

/** Everything the Numbers track of a filing says, by the plan's rules (the first row that matches). */
export function numbersTrack(
	files: FilingFile[],
	sources: BasisSources[],
	ctx: TrackContext,
	shown: boolean = IN_PDF_RESULT_SHOWN
): TrackWords {
	const say = (state: TrackState, first: string, second: string | null = null): TrackWords => ({
		state,
		first,
		second
	});
	const xbrl = files.filter((f) => f.format === 'xbrl');
	const pdf = files.filter((f) => f.format === 'pdf');
	const numbers = (f: FilingFile) => f.pipeline.numbers;
	const needed = (f: FilingFile) => pdfNeeded(f, files, sources);

	// Rows 1 to 4: the file itself.
	if (files.some((f) => f.state === 'pending_upload' && ctx.uploading(f.documentId))) {
		return say('now', words.sending);
	}
	if (files.some((f) => abandonedUpload(f, ctx)))
		return say('stopped', words.stopped, words.uploadUnfinished);
	const unstored = files.find((f) => f.pipeline.stored === 'failed');
	if (unstored) return say('stopped', words.stopped, failedWords(unstored));
	if (files.some((f) => f.pipeline.stored === 'now')) return say('now', words.checking);

	// Rows 5 to 8: what it is.
	if (files.length > 0 && files.every((f) => f.intakeState === 'duplicate')) {
		return say('not-read', words.notRead, words.duplicate);
	}
	if (files.some((f) => f.pipeline.identified === 'failed')) {
		return say('stopped', words.stopped, words.identifyFailed);
	}
	if (files.some((f) => f.pipeline.identified === 'now')) return say('now', words.identifying);
	const asking = files.find((f) => f.pipeline.identified === 'needs_you');
	if (asking) {
		return say(
			'needs-you',
			words.needsYou,
			asking.intakeState === 'needs_kind' ? words.sayWhatItIs : words.confirmCompany
		);
	}

	// Rows 9 to 14: the numbers, working rows first.
	if (pdf.some((f) => numbers(f).state === 'failed' && needed(f))) {
		return say('stopped', words.stopped, words.numbersFailed);
	}
	const waitingOnXbrl = pdf.filter(
		(f) => numbers(f).state === 'waiting' && numbers(f).reason === 'waiting_for_xbrl'
	);
	if (xbrl.some((f) => numbers(f).state === 'now')) {
		return say('now', words.fromXbrlNow, waitingOnXbrl.length > 0 ? words.pdfWaitsForIt : null);
	}
	const waitingOn = [...new Set(waitingOnXbrl.flatMap((f) => numbers(f).waitingOn))];
	if (waitingOn.length > 0) {
		return say(
			'next',
			words.waitingForXbrl,
			waitingOn.length === 1
				? words.beingRead(ctx.nameOf(waitingOn[0]))
				: words.manyBeingRead(waitingOn.length)
		);
	}
	if (pdf.some((f) => numbers(f).state === 'now')) {
		return say('now', words.pdfNow, pdfReason(xbrl, sources));
	}
	if (xbrl.some((f) => numbers(f).state === 'waiting')) return say('next', words.fromXbrlNext);
	if (pdf.some((f) => numbers(f).state === 'waiting')) {
		return say('next', words.pdfNext, pdfReason(xbrl, sources));
	}

	// Row 15: nothing works, and an instance failed.
	const failed = xbrl.filter((f) => numbers(f).state === 'failed');
	if (failed.length > 0) {
		const what =
			xbrl.length === 1
				? words.xbrlFailedOne
				: failed.length === 1
					? words.xbrlFailedNamed(failed[0].originalName)
					: words.xbrlFailedMany(failed.length);
		const modelRead = pdf.some((f) => numbers(f).state === 'done' && needed(f));
		return say('stopped', words.stopped, modelRead ? `${what}${words.modelReadPdf}` : what);
	}

	// Rows 16 to 18: read.
	const xbrlDone = xbrl.some((f) => numbers(f).state === 'done');
	if (xbrlDone && pdf.some((f) => numbers(f).state === 'done' && needed(f))) {
		return say('done', words.fromXbrlAndPdfDone, joinLines(splitWords(sources), caveat(xbrl)));
	}
	if (xbrlDone)
		return say('done', words.fromXbrlDone, joinLines(checkLine(sources, shown), caveat(xbrl)));
	if (pdf.some((f) => numbers(f).state === 'done')) {
		return say('done', words.pdfDone, pdfReason(xbrl, sources));
	}

	// Rows 19 and 20: not read at all.
	const unmapped = xbrl.filter(
		(f) => numbers(f).state === 'not_read' && numbers(f).reason === 'format_unmapped'
	);
	if (xbrl.length > 0 && unmapped.length === xbrl.length && pdf.length === 0) {
		return say(
			'not-read',
			words.notReadFromXbrl,
			words.unmapped(formatWords(numbers(unmapped[0]).format ?? 'unknown'))
		);
	}
	if (
		files.length > 0 &&
		files.every((f) => numbers(f).state === 'not_read' && numbers(f).reason === 'not_a_read_kind')
	) {
		return say('not-read', words.notRead, words.keptKind);
	}
	return say('next', words.none);
}

const sum = (list: FilingFile[], pick: (f: FilingFile) => number): number =>
	list.reduce((total, f) => total + pick(f), 0);

/**
 * Everything the Text track of a filing says. It looks at the files that are stored and not
 * duplicates; a duplicate gets no index job, so it never reads "In line".
 */
export function textTrack(
	files: FilingFile[],
	_ctx: TrackContext,
	variant: 'list' | 'opened' = 'list'
): TrackWords {
	const say = (state: TrackState, first: string, second: string | null = null): TrackWords => ({
		state,
		first,
		second
	});
	const text = words.text;
	const own = files.filter(
		(f) =>
			f.state === 'stored' &&
			f.intakeState !== 'duplicate' &&
			f.pipeline.text.state !== 'not_needed'
	);
	const pdf = own.filter((f) => f.format === 'pdf');
	const xbrl = own.filter((f) => f.format === 'xbrl');
	const state = (f: FilingFile) => f.pipeline.text.state;

	const reading = pdf.find((f) => state(f) === 'now');
	if (reading) {
		const t = reading.pipeline.text;
		return say(
			'now',
			t.pages === 0 ? text.readingPages : text.page(t.pagesRead, t.pages),
			text.soFar(t.pagesOcr, t.chunks)
		);
	}
	if (xbrl.some((f) => state(f) === 'now')) return say('now', text.readingXbrl);

	const waiting = own.filter((f) => state(f) === 'waiting');
	if (waiting.length > 0) {
		const ahead = waiting.flatMap((f) =>
			f.pipeline.text.ahead === null ? [] : [f.pipeline.text.ahead]
		);
		const nearest = ahead.length > 0 ? Math.min(...ahead) : null;
		const first =
			nearest === null ? text.inLine : nearest === 0 ? text.nextInLine : text.inLineAhead(nearest);
		return say(
			'next',
			first,
			waiting
				.map((f) =>
					f.format === 'pdf' ? text.waitingPdf(f.pipeline.text.pages) : text.waitingXbrl
				)
				.join(' · ')
		);
	}
	if (own.some((f) => state(f) === 'failed')) return say('stopped', words.stopped, text.stopped);

	if (own.length > 0) {
		const pages = sum(pdf, (f) => f.pipeline.text.pages);
		const ocr = sum(pdf, (f) => f.pipeline.text.pagesOcr);
		const chunks = sum(pdf, (f) => f.pipeline.text.chunks);
		const blocks = sum(xbrl, (f) => f.pipeline.text.xbrlBlocks);
		const first = own.some((f) => state(f) === 'partial') ? text.donePartial : text.done;
		const parts =
			variant === 'opened'
				? [
						[
							pages > 0 ? text.openedPages(pages) : null,
							ocr > 0 ? text.openedOcr(ocr) : null,
							chunks > 0 ? text.listPassages(chunks) : null
						]
							.filter((part) => part !== null)
							.join(', '),
						blocks > 0 ? text.openedNotes(blocks) : null
					]
				: [
						pages > 0 ? text.listPages(pages, ocr) : null,
						chunks > 0 ? text.listPassages(chunks) : null,
						blocks > 0 ? text.listNotes(blocks) : null
					];
		const joined = parts
			.filter((part) => part !== null && part !== '')
			.join(variant === 'opened' ? '; ' : ' · ');
		return say('done', first, joined === '' ? null : joined);
	}
	return say('next', words.none);
}
