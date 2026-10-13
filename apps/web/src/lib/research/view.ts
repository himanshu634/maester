/**
 * Words and numbers for the Research pages. Pure, so it is tested without Svelte. Figures use
 * Indian grouping and a real minus; pages are counted from 1; unknown is "—" with its reason.
 */
import { researchContent as copy } from '$lib/content/research';
import type { FinancialCell, ResearchCompany, TableUnit } from './types';

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
	const expected = Number(c.expected);
	const actual = Number(c.actual);
	const diff = figure(String(Math.abs(expected - actual).toFixed(2)));
	return {
		strong: copy.words.failed.strong,
		text: copy.words.failed.text(
			figure(c.expected ?? '0'),
			figure(c.actual ?? '0'),
			diff,
			actual > expected
		)
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
