import { describe, expect, it } from 'vitest';
import type {
	CompanyFinancials,
	CompanyStock,
	FinancialCell,
	FinancialRow,
	StatementTable
} from './types';
import { longDay, shortName, summarize } from './summary';

const NO = {
	role: 'none',
	status: null,
	subjectLabel: null,
	expected: null,
	actual: null
} as const;
const v = (value: string | null, page = 213): FinancialCell => ({
	status: value === null ? 'missing' : 'value',
	value,
	printed: value,
	factId: 'f',
	revisionId: 'r',
	source:
		value === null
			? null
			: { documentId: 'd26', pageIndex: page - 1, pageCount: 286, textLayerMatch: true },
	check: NO,
	restated: null
});
const r = (
	label: string,
	a: string | null,
	b: string | null,
	over: Partial<FinancialRow> = {}
): FinancialRow => ({
	key: label,
	section: 'Income',
	label,
	isSubtotal: false,
	perShare: false,
	cells: [v(a), v(b)],
	...over
});
function pl(
	rows: FinancialRow[],
	basis: 'consolidated' | 'standalone' = 'consolidated'
): StatementTable {
	return {
		statement: 'income_statement',
		basis,
		unit: { label: '₹ in crore', scale: '10000000', currency: 'INR' },
		columns: [
			{
				periodEnd: '2025-03-31',
				periodLabel: 'Year ended 31 March 2025',
				documentId: 'd26',
				filingPeriodEnd: '2026-03-31'
			},
			{
				periodEnd: '2026-03-31',
				periodLabel: 'Year ended 31 March 2026',
				documentId: 'd26',
				filingPeriodEnd: '2026-03-31'
			}
		],
		rows,
		unplaced: 0,
		leftOut: []
	};
}
const company = {
	id: 'c',
	workspaceId: 'w',
	displayName: 'Synthetic Cements Limited',
	country: 'IN',
	cin: null,
	bseCode: null,
	nseSymbol: 'SYNCEM',
	createdAt: ''
};
const canvas = (
	rows = [
		r('Revenue from operations', '11240.75', '12105.4'),
		r('Profit for the year', '1144', '1459', { isSubtotal: true }),
		r('Basic', '48.6', '61.98', { section: 'Earnings per equity share (₹)', perShare: true })
	]
): CompanyFinancials => ({ company, filings: [], tables: [pl(rows)] });
const stock: CompanyStock = {
	state: 'ok',
	symbol: 'SYNCEM',
	source: 'Dhan · NSE close',
	last: { day: '2026-10-09', value: 1284.5 },
	previous: { day: '2026-10-08', value: 1272.2 },
	yearAgo: { day: '2025-10-09', value: 1085 },
	low: { day: '2026-01-12', value: 1021.15 },
	high: { day: '2026-09-24', value: 1342.8 },
	series: [
		{ day: '2026-10-08', value: 1272.2 },
		{ day: '2026-10-09', value: 1284.5 }
	]
};
const noPrices = {
	last: null,
	previous: null,
	yearAgo: null,
	low: null,
	high: null,
	series: []
};

describe('shortName and longDay', () => {
	it('drops a trailing Limited and names the day', () => {
		expect(shortName('Synthetic Cements Limited')).toBe('Synthetic Cements');
		expect(shortName('Kestrel Power Ltd.')).toBe('Kestrel Power');
		expect(longDay('2026-10-09')).toBe('Friday 9 October');
	});
});

describe('summarize', () => {
	it('writes the canvas sentence and figures', () => {
		const s = summarize({ financials: canvas(), stock, stockFailed: false });
		expect(s.sentence).toBe(
			'Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier. In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore.'
		);
		expect(s.figures.map((f) => f.value)).toEqual([
			'₹1,284.50',
			'₹1,021.15 – 1,342.80',
			'20.7',
			'₹1,459 cr'
		]);
		expect(s.figures[0]!.change).toBe('+12.30 (+0.97%) on the day');
		expect(s.figures[0]!.note).toBe('NSE close, Friday 9 Oct. From your Dhan data.');
		expect(s.figures[1]!.rulerPct).toBe(82);
		expect(s.figures[2]!.note).toBe(
			'1,284.50 ÷ 61.98, the basic earnings per share for 2025–26 (annual report, page 213).'
		);
		expect(s.figures[3]!.change).toBe('+27.5% on 2024–25');
		expect(s.epsCell).toEqual({ tableIndex: 0, row: 2, col: 1 });
	});

	it('uses the printed earnings per share, not a scaled one', () => {
		const s = summarize({ financials: canvas(), stock, stockFailed: false });
		expect(Number(s.figures[2]!.value)).toBeCloseTo(1284.5 / 61.98, 1);
	});

	it('shows the business figures with no price, each price figure saying why', () => {
		const s = summarize({
			financials: canvas(),
			stock: { ...stock, state: 'not_tracked', ...noPrices },
			stockFailed: false
		});
		expect(s.figures.slice(0, 3).map((f) => [f.value, f.reason])).toEqual([
			[null, 'Maester keeps prices for Nifty 500 shares only, and this isn’t one.'],
			[null, 'Needs the year’s closes.'],
			[null, 'Needs a price.']
		]);
		expect(s.figures[3]!.value).toBe('₹1,459 cr');
		expect(s.sentence).toBe(
			'In 2025–26 Synthetic Cements’ revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore.'
		);
	});

	it('points to Settings when Dhan isn’t connected', () => {
		const s = summarize({
			financials: canvas(),
			stock: { ...stock, state: 'not_connected', ...noPrices },
			stockFailed: false
		});
		expect(s.figures[0]).toMatchObject({
			value: null,
			reason: 'Connect Dhan in Settings to see prices.',
			settingsLink: true
		});
	});

	it('says a loss in words, with no percentage against a loss', () => {
		const s = summarize({
			financials: canvas([
				r('Revenue from operations', '11240.75', '10105.4'),
				r('Profit for the year', '-120', '-310', { isSubtotal: true }),
				r('Basic', '-5.1', '-13.17', { section: 'Earnings per share', perShare: true })
			]),
			stock,
			stockFailed: false
		});
		expect(s.sentence).toContain(
			'In 2025–26 its revenue fell 10.1% to ₹10,105 crore and it made a loss of ₹310 crore, against a loss of ₹120 crore the year before.'
		);
		expect(s.figures[2]).toMatchObject({
			value: null,
			reason: 'The company made a loss in 2025–26, so there’s no price to earnings.'
		});
		expect(s.figures[3]!.change).toBeNull();
	});

	it('says why price to earnings is missing when no earnings per share was read', () => {
		const s = summarize({
			financials: canvas([
				r('Revenue from operations', '11240.75', '12105.4'),
				r('Profit for the year', '1144', '1459', { isSubtotal: true })
			]),
			stock,
			stockFailed: false
		});
		expect(s.figures[2]).toMatchObject({
			value: null,
			reason: 'The filing’s earnings per share wasn’t read.'
		});
	});

	it('leaves out what it doesn’t know, and never writes a sentence from nothing', () => {
		const s = summarize({ financials: null, stock: null, stockFailed: true });
		expect(s.sentence).toBeNull();
		expect(s.figures.map((f) => f.value)).toEqual([null, null, null, null]);
		expect(s.figures[0]!.reason).toBe('The prices didn’t load.');
	});
});
