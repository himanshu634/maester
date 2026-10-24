/**
 * Where each statement of a filing gets its numbers, per basis, in words (spec 2026-10-19 section
 * 5, board C2), and which files the "Read it again" and "Try again" buttons act on (plan Decision
 * 2). Free of Svelte and of the page: every function takes what it reads. Counts of figures found
 * are counts, not figures; no figure value is read or computed here.
 *
 * The one rule that costs money: a PDF is sent to `extract` (a paid model read) only when the
 * filing's statement `sources` say its numbers are needed (`pdfNeeded`), never because the PDF's
 * own `numbers` say `done` or `failed`. A PDF the model read before its XBRL arrived still says
 * `source: pdf`, `done`, after XBRL owns every one of its slots. One more case holds a needed PDF
 * back (`pdfWorthReading`): a PDF whose only claim is `xbrl_read_failed` or `xbrl_format_unmapped`,
 * beside a failed XBRL file, or one whose kind has a map now, of that basis in the same send set.
 * The free XBRL read goes alone. And no PDF is sent while
 * the files say the sources are stale (`sourcesStale`): the open filing's poll patches the files,
 * never the sources, so an XBRL file read since the last filings read leaves its coverage unknown.
 */
import { documentsContent } from '$lib/content/documents';
import { IN_PDF_RESULT_SHOWN } from './in-pdf';
import { fileCaveat, formatWords, pdfWorthReading, unmappedNowMapped } from './tracks';
import type {
	BasisSources,
	FactSpan,
	FilingFile,
	ReportingBasis,
	ResultsSpan,
	StatementFound,
	StatementKind,
	StatementSource,
	WorkspaceFiling,
	XbrlPdfNotChecked
} from './types';

const words = documentsContent.sources;
const trackWords = documentsContent.tracks;

export interface SourceRow {
	statement: StatementKind;
	label: string;
	from: { text: string; note: string | null };
	inPdf: {
		text: string;
		/** Why `text` is "—", read out after it but not drawn; null when it is not "—". */
		why: string | null;
		/** A check missed something: said in bold. */
		strong: boolean;
		missed: string | null;
		/** Opens the results PDF where the statement pages start. `pageIndex` is 0-based. */
		open: { documentId: string; pageIndex: number; label: string } | null;
	};
}

const STATEMENT_ORDER: StatementKind[] = ['income_statement', 'balance_sheet', 'cash_flow'];
const SPAN_ORDER: FactSpan[] = ['quarter', 'half_year', 'nine_months', 'year', 'other'];
/** A filing's spans from the shortest. */
const SHORTEST_FIRST: ResultsSpan[] = ['quarter', 'half_year', 'nine_months', 'full_year'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function basisTitle(basis: ReportingBasis): string {
	return words.basisTitle[basis];
}

export function notCheckedWords(reason: XbrlPdfNotChecked): string {
	return words.notChecked[reason];
}

/** 0-based pages in, 1-based words out: "page 7", "pages 7–8" (a run), "pages 4, 6 and 9". */
export function pagesWords(pages: number[]): string {
	const sorted = [...new Set(pages)].sort((a, b) => a - b).map((page) => page + 1);
	if (sorted.length === 0) return '';
	if (sorted.length === 1) return words.page(sorted[0]);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	if (last - first === sorted.length - 1) return words.pagesRun(first, last);
	return words.pagesList(sorted.slice(0, -1).join(', '), last);
}

/** "a and b", "a, b and c". */
export function joinList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** An ISO date as "30 Sep 2026"; null when it is not one. */
export function dayWords(iso: string | null): string | null {
	const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!match) return null;
	const month = MONTHS[parseInt(match[2], 10) - 1];
	return month ? `${parseInt(match[3], 10)} ${month} ${match[1]}` : null;
}

function xbrlText(statement: StatementSource, filing: WorkspaceFiling): string {
	const spans = SPAN_ORDER.filter((span) => statement.xbrlSpans.includes(span));
	if (spans.length > 0) return words.xbrlSpans(joinList(spans.map((span) => words.spans[span])));
	const day = dayWords(filing.periodEnd);
	return day === null ? words.xbrl : words.xbrlAt(day);
}

function pdfText(statement: StatementSource): string {
	const pages = pagesWords(statement.pdfPages);
	return pages === '' ? words.pdf : words.pdfPages(pages);
}

/** Why a statement is read from the PDF: what the filing's XBRL says. */
function pdfNote(
	statement: StatementSource,
	basis: ReportingBasis,
	filing: WorkspaceFiling
): string | null {
	switch (statement.reason) {
		case 'xbrl_lacks_statement': {
			const shortest = SHORTEST_FIRST.find((span) => filing.spans.includes(span)) ?? null;
			return words.lacks(
				trackWords.statementNames[statement.statement],
				shortest === null ? null : words.possessive[shortest]
			);
		}
		case 'xbrl_format_unmapped': {
			const xbrl = filing.files.find((f) => f.format === 'xbrl' && f.basis === basis);
			return trackWords.unmapped(formatWords(xbrl?.pipeline.numbers.format ?? 'unknown'));
		}
		case 'no_xbrl':
			return words.noXbrl;
		case 'xbrl_read_failed':
			return words.xbrlReadFailed;
		case 'xbrl_not_read_yet':
			return words.xbrlNotReadYet;
		default:
			return null;
	}
}

function fromOf(
	statement: StatementSource,
	basis: ReportingBasis,
	filing: WorkspaceFiling
): { text: string; note: string | null } {
	if (statement.source !== 'xbrl') {
		if (statement.reason === 'not_read_yet') return { text: words.none, note: words.notReadYet };
		if (statement.reason === 'read_failed') return { text: words.none, note: words.readStopped };
	}
	if (statement.source === 'xbrl') {
		const file = filing.files.find((f) => f.documentId === statement.xbrlDocumentId);
		return { text: xbrlText(statement, filing), note: file ? fileCaveat(file) : null };
	}
	if (statement.source === 'pdf') {
		return { text: pdfText(statement), note: pdfNote(statement, basis, filing) };
	}
	// Nowhere. Only `not_in_filing` says it is absent: a failed or unread XBRL never does.
	switch (statement.reason) {
		case 'not_in_filing':
			return { text: words.notInFiling, note: null };
		case 'xbrl_read_failed':
			return { text: words.none, note: words.xbrlReadFailed };
		case 'xbrl_not_read_yet':
			return { text: words.none, note: words.notReadYet };
		default:
			return { text: words.none, note: words.fromUnknown };
	}
}

function inPdfOf(
	statement: StatementSource,
	basis: ReportingBasis,
	filing: WorkspaceFiling,
	pdfStatements: StatementFound[] | null,
	shown: boolean
): SourceRow['inPdf'] {
	const count = statement.inPdf;
	const dash = (why: string) => ({
		text: words.none,
		why,
		strong: false,
		missed: null,
		open: null
	});
	if (count === null) {
		if (statement.source === 'pdf') return dash(words.inPdfWhy.pdf);
		return dash(
			statement.reason === 'not_in_filing' ? words.inPdfWhy.notInFiling : words.inPdfWhy.notRead
		);
	}
	if (count.checked === 0) {
		if (count.notChecked === null) return dash(words.inPdfWhy.unknown);
		return {
			text: notCheckedWords(count.notChecked),
			why: null,
			strong: false,
			missed: null,
			open: null
		};
	}
	if (!shown) {
		// `IN_PDF_RESULT_SHOWN` is off: no found count, no miss, no link from a miss.
		return { text: words.resultNotShown, why: null, strong: false, missed: null, open: null };
	}
	const text = words.found(count.found, count.checked);
	if (count.notFound.length === 0)
		return { text, why: null, strong: false, missed: null, open: null };

	// The API checked the statement against the PDF that prints it; follow that PDF and its pages.
	// Only a statement with no such PDF falls back to the filing's stored PDF and the classification.
	const own = statement.pdfDocumentId !== null;
	const pages = own
		? statement.pdfPages
		: (pdfStatements?.find((s) => s.statement === statement.statement && s.basis === basis)
				?.pages ?? []);
	const pdf = own
		? filing.files.find((f) => f.documentId === statement.pdfDocumentId && f.state === 'stored')
		: filing.files.find(
				(f) => f.format === 'pdf' && f.state === 'stored' && f.intakeState !== 'duplicate'
			);
	const open =
		pdf && pages.length > 0
			? {
					documentId: pdf.documentId,
					pageIndex: Math.min(...pages),
					label: words.openPdf(Math.min(...pages) + 1)
				}
			: null;
	return { text, why: null, strong: true, missed: words.missed(count.notFound.length), open };
}

/**
 * One row per statement of a basis, in the order profit and loss, balance sheet, cash flow.
 * `pdfStatements` is the filing's PDF classification's `statementsFound`, once it has loaded.
 */
export function sourceRows(
	basis: BasisSources,
	filing: WorkspaceFiling,
	pdfStatements: StatementFound[] | null,
	shown: boolean = IN_PDF_RESULT_SHOWN
): SourceRow[] {
	return STATEMENT_ORDER.flatMap((kind) =>
		basis.statements
			.filter((s) => s.statement === kind)
			.map((s) => ({
				statement: kind,
				label: documentsContent.statements[kind],
				from: fromOf(s, basis.basis, filing),
				inPdf: inPdfOf(s, basis.basis, filing, pdfStatements, shown)
			}))
	);
}

/**
 * The files "Read it again" sends to `extract`, in file order: XBRL files whose numbers are done or
 * failed (a free read), or not read for want of a map that exists now (`unmappedNowMapped`), and PDFs whose
 * numbers are done or failed AND that the filing's sources still need (`pdfWorthReading`). Never a PDF
 * the XBRL covers, whatever its own `numbers.source` says: that would be a paid model call for numbers
 * XBRL already owns. An unsorted file passes `sources` `[]`.
 */
export function readAgainIds(files: FilingFile[], sources: BasisSources[]): string[] {
	return files
		.filter((f) => {
			if (unmappedNowMapped(f)) return true;
			const state = f.pipeline.numbers.state;
			if (state !== 'done' && state !== 'failed') return false;
			return f.format === 'xbrl' || pdfWorthReading(f, files, sources);
		})
		.map((f) => f.documentId);
}

/**
 * The files a stopped track's "Try again" acts on. `identify` goes to `classify`, `numbers` to
 * `extract` (XBRL files, and PDFs the sources still need, never a covered one), `text` to `index`.
 */
export function retryIds(
	files: FilingFile[],
	sources: BasisSources[],
	track: 'identify' | 'numbers' | 'text'
): string[] {
	const stopped = (f: FilingFile): boolean => {
		switch (track) {
			case 'identify':
				return f.pipeline.identified === 'failed';
			case 'text':
				return f.pipeline.text.state === 'failed';
			case 'numbers':
				return (
					f.pipeline.numbers.state === 'failed' &&
					(f.format === 'xbrl' || pdfWorthReading(f, files, sources))
				);
		}
	};
	return files.filter(stopped).map((f) => f.documentId);
}
