/**
 * Words and numbers for the Research pages. Pure, so it is tested without Svelte. Figures use
 * Indian grouping and a real minus; pages are counted from 1; unknown is "—" with its reason.
 */
import { researchContent as copy } from '$lib/content/research';
import { IN_PDF_RESULT_SHOWN } from '$lib/documents/in-pdf';
import { notCheckedWords, pagesWords } from '$lib/documents/sources';
import type { ReportingBasis, StatementKind } from '$lib/documents/types';
import type {
	CompanyFiling,
	FinancialCell,
	PageSource,
	ResearchCompany,
	StatementTable,
	TableUnit,
	XbrlInPdf,
	XbrlSource
} from './types';

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const twoDecimals = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** "2025–26" for a year to 31 March; "Year to 31 Dec 2025" for any other year end. */
export function fyLabel(periodEnd: string): string {
	const [y, m, d] = periodEnd.split('-').map(Number) as [number, number, number];
	if (m === 3 && d === 31) return `${y - 1}–${String(y % 100).padStart(2, '0')}`;
	return `Year to ${d} ${MONTHS[m - 1]} ${y}`;
}

/** A year inside a sentence: "2025–26", or "the year to 31 Dec 2025" for any other year end. */
export function fyWords(periodEnd: string): string {
	const [y, m, d] = periodEnd.split('-').map(Number) as [number, number, number];
	if (m === 3 && d === 31) return fyLabel(periodEnd);
	return `the year to ${d} ${MONTHS[m - 1]} ${y}`;
}

/** The years the counted annual reports cover, newest first, each named once. */
export function yearsRead(filings: Pick<CompanyFiling, 'counted' | 'periodEnd'>[]): string[] {
	const ends = filings.filter((f) => f.counted && f.periodEnd).map((f) => f.periodEnd as string);
	return [...new Set(ends)].sort().reverse().map(fyLabel);
}

/**
 * The basis the company page opens its profit and loss on: consolidated if it has years, then any
 * basis with years, then one whose figures had no date (so its note shows), then consolidated.
 */
export function defaultBasis(
	tables: Pick<StatementTable, 'statement' | 'basis' | 'columns'>[]
): ReportingBasis {
	const pl = tables.filter((t) => t.statement === 'income_statement');
	const placed = pl.filter((t) => t.columns.length > 0);
	for (const set of [placed, pl]) {
		if (set.some((t) => t.basis === 'consolidated')) return 'consolidated';
		if (set[0]) return set[0].basis;
	}
	return 'consolidated';
}

export const filingShort = (periodEnd: string | null) =>
	periodEnd ? `AR ${fyLabel(periodEnd)}` : 'An annual report';
export const filingLong = (periodEnd: string | null) =>
	periodEnd ? `Annual report ${fyLabel(periodEnd)}` : 'An annual report';

/** A decimal string as a table figure: "1,23,456.50", "−12.40". */
export function figure(value: string): string {
	const n = Number(value);
	const body = twoDecimals.format(Math.abs(n));
	return n < 0 && body !== '0.00' ? MINUS + body : body;
}

const SCALE_WORDS: Record<string, [string, string]> = {
	'1': ['', ''],
	'1000': ['thousand', 'k'],
	'100000': ['lakh', 'lakh'],
	'1000000': ['million', 'mn'],
	'10000000': ['crore', 'cr'],
	'1000000000': ['billion', 'bn']
};

function currencyWord(currency: string | null): string {
	return !currency || currency === 'INR' ? '₹' : currency;
}

/** "₹ crore", "USD million", "₹"; an unknown scale names the printed unit. */
export function unitWords(unit: TableUnit): string {
	const scale = unit.scale ? String(Number(unit.scale)) : null;
	const words = scale ? SCALE_WORDS[scale] : undefined;
	if (!words) return `the unit printed: ${unit.label ?? 'none'}`;
	return words[0] ? `${currencyWord(unit.currency)} ${words[0]}` : currencyWord(unit.currency);
}

/** The short unit after a headline figure: "cr", "lakh", "mn"; "" for rupees. */
export function unitShort(unit: TableUnit): string {
	const scale = unit.scale ? String(Number(unit.scale)) : null;
	return (scale && SCALE_WORDS[scale]?.[1]) || '';
}

export function cellText(cell: FinancialCell): string {
	if (cell.status === 'value' && cell.value !== null) return figure(cell.value);
	if (cell.status === 'dash') return '–';
	return '—';
}

/** The 1-based page of a cell read from a page of a PDF; null for any other cell. */
export function sourcePage(cell: FinancialCell): number | null {
	const s = cell.source;
	return s && s.kind === 'page' ? s.pageIndex + 1 : null;
}

/** Why a cell shows no figure, for the figure panel and for screen readers; null when it does. */
export function cellReason(cell: FinancialCell, filing: string): string | null {
	if (cell.status === 'missing') return copy.words.missing(filing);
	const unread = cell.status === 'dash' || cell.status === 'unparsed' || cell.value === null;
	// An XBRL figure has no page to name, so it never falls through to the page words.
	const s = cell.source;
	if (s?.kind === 'xbrl') {
		if (!unread) return null;
		if (s.nil) return copy.words.xbrlNil;
		return cell.status === 'unparsed' ? copy.words.xbrlUnparsed : copy.words.xbrlNoRounding;
	}
	const page = sourcePage(cell) ?? 0;
	if (cell.status === 'dash') return copy.words.dash(page);
	if (unread) return copy.words.unparsed(page);
	return null;
}

/** The page source of a cell, or null for a cell with none or one read from an XBRL file. */
const pageSourceOf = (cell: FinancialCell): PageSource | null =>
	cell.source?.kind === 'page' ? cell.source : null;

export const pageWords = (cell: FinancialCell) => {
	const s = cell.source;
	if (!s) return '—';
	return s.kind === 'xbrl' ? s.element : copy.words.page(s.pageIndex + 1, s.pageCount);
};

/** Where a figure was read from, for the price to earnings note: its page or its XBRL element. */
export function whereWords(cell: FinancialCell): string {
	const s = cell.source;
	if (!s) return copy.words.whereUnknown;
	return s.kind === 'xbrl'
		? copy.words.whereXbrl(s.element)
		: copy.words.wherePage(s.pageIndex + 1);
}

/** The panel's From row for a figure read from a page: the filing and the page (of how many); null otherwise. */
export function fromWords(cell: FinancialCell, filingPeriodEnd: string | null): string | null {
	const s = pageSourceOf(cell);
	if (!s) return null;
	return copy.panel.from(
		filingLong(filingPeriodEnd),
		copy.words.page(s.pageIndex + 1, s.pageCount).toLowerCase()
	);
}

/** An ISO date as "31 Mar 2026". */
function dayWords(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The panel's From row for an XBRL figure: the results and the file they were filed in, then the
 * file's name and the element as a muted note. Never the context. `periodEnd` is the column's year end.
 */
export function xbrlFrom(source: XbrlSource, periodEnd: string): { text: string; note: string } {
	const words = copy.panel.xbrlFrom;
	const day = dayWords(periodEnd);
	// An instant (a balance sheet figure) has no span.
	const span =
		source.span === null ? null : (words.spans[source.span as keyof typeof words.spans] ?? null);
	const period = source.span === null ? words.instant(day) : words.period(span ?? 'period', day);
	return {
		text: source.inPdf.pdfDocumentId === null ? words.alone(period) : words.withPdf(period),
		note: words.note(source.originalName, source.element)
	};
}

/** A scale's exponent read from its digits as text: "10000000" is a 1 and 7 zeros, so 7. Null when it is no power of ten. */
function scaleExponent(scale: string | null): number | null {
	return scale !== null && /^10*$/.test(scale) ? scale.length - 1 : null;
}

const isRupee = (unit: TableUnit) => !unit.currency || unit.currency === 'INR';

/**
 * The unit of an XBRL figure. `declared` is the unit the XBRL file declares, when the cell carries
 * one (it does not yet): "as the filing declares", or "converted from" when it differs from the
 * shown one. The rounding is said only where it agrees with the two places the table shows.
 */
export function xbrlUnit(input: {
	shown: TableUnit;
	perShare: boolean;
	decimals: string | null;
	declared: TableUnit | null;
}): string {
	const { shown, perShare, decimals, declared } = input;
	const words = copy.panel.xbrlUnit;
	let said = perShare
		? words.perShare(isRupee(shown) ? '₹' : (shown.currency ?? ''))
		: unitWords(shown);
	if (declared) {
		const same = declared.scale === shown.scale && isRupee(declared) === isRupee(shown);
		said += same ? words.declared : words.converted(unitWords(declared));
	}
	// The two places shown: the shown scale's exponent (0 on a per-share row) plus `decimals` is 2.
	const exponent = perShare ? 0 : scaleExponent(shown.scale);
	if (isRupee(shown) && exponent !== null && decimals !== null && /^-?\d+$/.test(decimals)) {
		const word = words.roundedTo[decimals];
		if (word && exponent + parseInt(decimals, 10) === 2) said += words.rounded(word);
	}
	return said;
}

/**
 * The panel's Restated row, worded by which source owns the cell, never by "newer": an XBRL
 * filing owns its slot over a newer PDF. The other filing is named as an annual report, which is
 * true while only annual reports reach the table.
 */
export function restatedWords(
	cell: FinancialCell,
	unit: TableUnit,
	perShare: boolean
): string | null {
	const r = cell.restated;
	if (!r) return null;
	const own = cell.source?.kind === 'xbrl' ? 'xbrl' : 'page';
	const filing = filingLong(r.filingPeriodEnd);
	if (r.kind === 'xbrl') {
		const unitSaid = perShare ? copy.statements.perShareUnit : unitWords(unit);
		const value = r.value === null ? '—' : figure(r.value);
		return copy.panel.restatedXbrl(filing, value, unitSaid) + copy.panel.restatedShown.xbrl[own];
	}
	return (
		copy.panel.restated(filing, r.printed, r.pageIndex + 1) + copy.panel.restatedShown.page[own]
	);
}

/** The PDF page the panel opens, or null when the figure is not on a page of a PDF. */
export function pdfPageOf(cell: FinancialCell): { documentId: string; pageIndex: number } | null {
	const s = pageSourceOf(cell);
	return s ? { documentId: s.documentId, pageIndex: s.pageIndex } : null;
}

export type Words = { strong?: string; text: string };

export function onPage(cell: FinancialCell): Words {
	const s = pageSourceOf(cell);
	if (!s) return { text: '—' };
	if (s.textLayerMatch === true) return { text: copy.words.found };
	if (s.textLayerMatch === null) return { text: copy.words.scanned(s.pageIndex + 1) };
	return {
		strong: copy.words.notFound.strong,
		text: copy.words.notFound.text(cell.printed ?? '')
	};
}

export function addsUp(cell: FinancialCell): Words {
	const c = cell.check;
	if (c.role === 'none' || c.status === null) return { text: copy.words.noSum };
	if (c.status === 'not_checked') return { text: copy.words.notChecked };
	if (c.role === 'component')
		return { text: copy.words.partOf(c.subjectLabel ?? '', c.status === 'passed') };
	if (c.status === 'passed') return { text: copy.words.adds };
	// `expected` is the total as the page prints it; `actual` is what its lines add up to, or for the
	// balance identity what equity and liabilities come to.
	const page = c.expected === null ? null : Number(c.expected);
	const other = c.actual === null ? null : Number(c.actual);
	const difference =
		page === null || other === null ? null : figure(String(Math.abs(page - other).toFixed(2)));
	const printed = c.expected === null ? '—' : figure(c.expected);
	const reached = c.actual === null ? '—' : figure(c.actual);
	const more = page !== null && other !== null && page > other;
	// The total is what the page prints, or for an XBRL figure what the XBRL file gives.
	const xbrl = cell.source?.kind === 'xbrl';
	if (c.checkType === 'balance_identity') {
		const subject = (c.subjectLabel ?? 'Total assets').toLowerCase();
		const said = xbrl ? copy.words.identityFailedXbrl : copy.words.identityFailed;
		return {
			strong: said.strong,
			text: said.text(
				subject.charAt(0).toUpperCase() + subject.slice(1),
				printed,
				reached,
				difference,
				more
			)
		};
	}
	const said = xbrl ? copy.words.failedXbrl : copy.words.failed;
	return { strong: said.strong, text: said.text(reached, printed, difference, more) };
}

/** "4–6", "4, 6 and 9": the pages, without the word "pages". */
const bareLabel = (pages: number[]) => pagesWords(pages).replace(/^pages? /, '');

/** The `xbrl_in_pdf` outcome of an XBRL figure, in words. */
export function inPdfWords(inPdf: XbrlInPdf, shown: boolean = IN_PDF_RESULT_SHOWN): Words {
	const words = copy.panel.inPdf;
	// `IN_PDF_RESULT_SHOWN` is off: a figure that was looked for reads as not checked.
	if (!shown && inPdf.status !== 'not_checked') return { text: words.resultNotShown };
	if (inPdf.status === 'passed') {
		return {
			text:
				inPdf.pageIndex === null
					? words.foundOnStatements(bareLabel(inPdf.statementPages))
					: words.foundOnPage(inPdf.pageIndex + 1)
		};
	}
	if (inPdf.status === 'failed') {
		return {
			strong: words.notFound(bareLabel(inPdf.statementPages)),
			text: words.notFoundDetail
		};
	}
	return { text: notCheckedWords(inPdf.reason ?? 'not_yet') };
}

/**
 * The link to the results PDF for an XBRL figure: the page the check found it on, else where the
 * statement pages start, else the PDF as a whole. Null with no PDF of the filing stored.
 * `pageIndex` is 0-based.
 */
export function xbrlOpen(
	source: XbrlSource,
	shown: boolean = IN_PDF_RESULT_SHOWN
): { documentId: string; pageIndex: number | null; label: string; note: string } | null {
	const { inPdf } = source;
	const words = copy.panel.xbrlOpen;
	if (inPdf.pdfDocumentId === null) return null;
	const documentId = inPdf.pdfDocumentId;
	// With the result off, the page the check found is not used: the link falls back to the
	// statement pages.
	if (shown && inPdf.status === 'passed' && inPdf.pageIndex !== null) {
		return {
			documentId,
			pageIndex: inPdf.pageIndex,
			label: words.atPage(inPdf.pageIndex + 1),
			note: words.foundNote
		};
	}
	if (inPdf.statementPages.length > 0) {
		const first = Math.min(...inPdf.statementPages);
		return {
			documentId,
			pageIndex: first,
			label: words.atPage(first + 1),
			note: words.statementsNote
		};
	}
	return { documentId, pageIndex: null, label: words.plain, note: words.plainNote };
}

/** What a column's cells are read from: an XBRL file, a page of a PDF, or neither (nothing read). */
export function columnFrom(table: StatementTable, c: number): 'xbrl' | 'page' | null {
	for (const row of table.rows) {
		const kind = row.cells[c]?.source?.kind;
		if (kind) return kind;
	}
	return null;
}

const STATEMENT_ORDER: StatementKind[] = ['income_statement', 'balance_sheet', 'cash_flow'];

/** "a and b", "a, b and c". */
function joinList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The years of a basis whose statements come from different sources, newest first, each with the
 * statements grouped by source. A year that comes from one source names nothing.
 */
export function yearSources(
	tables: StatementTable[],
	basis: ReportingBasis
): { year: string; words: string }[] {
	const words = copy.statements.yearSources;
	const own = tables
		.filter((t) => t.basis === basis)
		.sort((a, b) => STATEMENT_ORDER.indexOf(a.statement) - STATEMENT_ORDER.indexOf(b.statement));
	const years = new Map<string, { xbrl: StatementKind[]; page: StatementKind[] }>();
	for (const table of own) {
		table.columns.forEach((col, c) => {
			const kind = columnFrom(table, c);
			if (!kind) return;
			const entry = years.get(col.periodEnd) ?? { xbrl: [], page: [] };
			entry[kind].push(table.statement);
			years.set(col.periodEnd, entry);
		});
	}
	const out: { year: string; words: string }[] = [];
	for (const [periodEnd, from] of [...years].sort(([a], [b]) => (a < b ? 1 : -1))) {
		if (from.xbrl.length === 0 || from.page.length === 0) continue;
		const groups = [
			{ statements: from.xbrl, source: words.xbrl },
			{ statements: from.page, source: words.page }
		].sort(
			(a, b) =>
				Math.min(...a.statements.map((k) => STATEMENT_ORDER.indexOf(k))) -
				Math.min(...b.statements.map((k) => STATEMENT_ORDER.indexOf(k)))
		);
		const said = groups.map((g, i) => {
			const list = joinList(g.statements.map((k) => copy.statements.kinds[k].toLowerCase()));
			// Only the first clause starts a sentence.
			return words.from(i === 0 ? list.charAt(0).toUpperCase() + list.slice(1) : list, g.source);
		});
		out.push({ year: fyLabel(periodEnd), words: `${said.join('; ')}.` });
	}
	return out;
}

/** The list's "Where it stands": a failure first, then work in progress, then read. */
export function standing(
	c: Pick<ResearchCompany, 'annualReportsRead' | 'reading' | 'failed'>
): string {
	if (c.failed > 0) return copy.standing.failed(c.failed);
	if (c.reading > 0) return copy.standing.reading(c.reading);
	return c.annualReportsRead > 0 ? copy.standing.read : copy.standing.nothing;
}

export const readFrom = (n: number) => copy.reports(n);
