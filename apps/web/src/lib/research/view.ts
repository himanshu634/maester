/**
 * Words and numbers for the Research pages. Pure, so it is tested without Svelte. Figures use
 * Indian grouping and a real minus; pages are counted from 1; unknown is "—" with its reason.
 */
import { researchContent as copy } from '$lib/content/research';
import type { ReportingBasis } from '$lib/documents/types';
import type {
	CompanyFiling,
	FinancialCell,
	ResearchCompany,
	StatementTable,
	TableUnit
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

/** Why a cell shows no figure, for the figure panel and for screen readers; null when it does. */
export function cellReason(cell: FinancialCell, filing: string): string | null {
	const page = cell.source ? cell.source.pageIndex + 1 : 0;
	if (cell.status === 'missing') return copy.words.missing(filing);
	if (cell.status === 'dash') return copy.words.dash(page);
	if (cell.status === 'unparsed' || cell.value === null) return copy.words.unparsed(page);
	return null;
}

export const pageWords = (cell: FinancialCell) =>
	cell.source ? copy.words.page(cell.source.pageIndex + 1, cell.source.pageCount) : '—';

export type Words = { strong?: string; text: string };

export function onPage(cell: FinancialCell): Words {
	const s = cell.source;
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
	if (c.checkType === 'balance_identity') {
		const subject = (c.subjectLabel ?? 'Total assets').toLowerCase();
		return {
			strong: copy.words.identityFailed.strong,
			text: copy.words.identityFailed.text(
				subject.charAt(0).toUpperCase() + subject.slice(1),
				printed,
				reached,
				difference,
				more
			)
		};
	}
	return {
		strong: copy.words.failed.strong,
		text: copy.words.failed.text(reached, printed, difference, more)
	};
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
