import { describe, expect, it } from 'vitest';
import type { ReportingBasis } from '$lib/documents/types';
import type {
	CompanyFinancials,
	CompanyStock,
	FinancialCell,
	FinancialRow,
	StatementTable,
	TableUnit
} from './types';
import { longDay, shortDay, shortName, summarize } from './summary';

const NO = {
	role: 'none',
	status: null,
	checkType: null,
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
const CRORE: TableUnit = { label: '₹ in crore', scale: '10000000', currency: 'INR' };
function pl(
	rows: FinancialRow[],
	basis: ReportingBasis = 'consolidated',
	unit: TableUnit = CRORE,
	ends: [string, string] = ['2025-03-31', '2026-03-31']
): StatementTable {
	return {
		statement: 'income_statement',
		basis,
		unit,
		columns: ends.map((periodEnd) => ({
			periodEnd,
			periodLabel: `Year ended ${periodEnd}`,
			documentId: 'd26',
			filingPeriodEnd: ends[1]
		})),
		rows,
		unplaced: 0,
		leftOut: []
	};
}
const counted = {
	documentId: 'd26',
	originalName: 'ar-2025-26.pdf',
	kind: 'annual_report' as const,
	periodEnd: '2026-03-31',
	intakeState: 'read' as const,
	counted: true
};
const company = {
	id: 'c',
	workspaceId: 'w',
	displayName: 'Synthetic Cements Limited',
	country: 'IN',
	cin: null,
	bseCode: null,
	nseSymbol: 'SYNCEM',
	isin: null,
	createdAt: ''
};
const canvas = (
	rows = [
		r('Revenue from operations', '11240.75', '12105.4'),
		r('Profit for the year', '1144', '1459', { isSubtotal: true }),
		r('Basic', '48.6', '61.98', { section: 'Earnings per equity share (₹)', perShare: true })
	],
	basis: ReportingBasis = 'consolidated',
	unit: TableUnit = CRORE
): CompanyFinancials => ({ company, filings: [counted], tables: [pl(rows, basis, unit)] });
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

	it('names the month the way the tables do, never Sept', () => {
		expect(shortDay('2026-09-24')).toBe('24 Sep');
		expect(shortDay('2026-10-09')).toBe('9 Oct');
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
			[
				null,
				'Maester has no closes for this share yet. It keeps prices for Nifty 500 shares, from your Dhan data.'
			],
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

	it('names the earnings per share figure as used only when price to earnings is worked out', () => {
		const loss = canvas([
			r('Revenue from operations', '11240.75', '10105.4'),
			r('Profit for the year', '-120', '-310', { isSubtotal: true }),
			r('Basic', '-5.1', '-13.17', { section: 'Earnings per share', perShare: true })
		]);
		expect(summarize({ financials: canvas(), stock, stockFailed: false }).epsCell).toEqual({
			tableIndex: 0,
			row: 2,
			col: 1
		});
		const notTracked = { ...stock, state: 'not_tracked' as const, ...noPrices };
		const notConnected = { ...stock, state: 'not_connected' as const, ...noPrices };
		expect(
			summarize({ financials: canvas(), stock: notTracked, stockFailed: false }).epsCell
		).toBeNull();
		expect(
			summarize({ financials: canvas(), stock: notConnected, stockFailed: false }).epsCell
		).toBeNull();
		expect(summarize({ financials: canvas(), stock: null, stockFailed: true }).epsCell).toBeNull();
		expect(summarize({ financials: loss, stock, stockFailed: false }).epsCell).toBeNull();
	});

	it('leaves out what it doesn’t know, and never writes a sentence from nothing', () => {
		const s = summarize({ financials: null, stock: null, stockFailed: true });
		expect(s.sentence).toBeNull();
		expect(s.figures.map((f) => f.value)).toEqual([null, null, null, null]);
		expect(s.figures[0]!.reason).toBe('The prices didn’t load.');
	});

	describe('what it will not guess', () => {
		const pricePart =
			'Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier.';
		const rev = r('Revenue from operations', '11240.75', '12105.4');
		const profit = r('Profit for the year', '1144', '1459', { isSubtotal: true });
		const basic = r('Basic', '48.6', '61.98', { section: 'Earnings per share', perShare: true });

		it('writes no amounts when the table’s scale is unknown, and says why', () => {
			const unit = { label: '₹ in crore', scale: null, currency: 'INR' };
			const s = summarize({
				financials: canvas([rev, profit, basic], 'consolidated', unit),
				stock,
				stockFailed: false
			});
			expect(s.sentence).toBe(pricePart);
			expect(s.figures[3]).toMatchObject({
				value: null,
				reason: 'The statement’s unit isn’t one Maester can name.',
				change: null,
				note: null
			});
			// Earnings per share is per share, so price to earnings still works.
			expect(s.figures[2]!.value).toBe('20.7');
			const none = summarize({
				financials: canvas([rev, profit, basic], 'consolidated', unit),
				stock: null,
				stockFailed: true
			});
			expect(none.sentence).toBeNull();
		});

		it('writes no amounts for a table that is not in rupees', () => {
			const unit = { label: 'USD in million', scale: '1000000', currency: 'USD' };
			const s = summarize({
				financials: canvas([rev, profit, basic], 'consolidated', unit),
				stock,
				stockFailed: false
			});
			expect(s.sentence).toBe(pricePart);
			expect(s.figures[3]).toMatchObject({
				value: null,
				reason: 'The statement’s unit isn’t one Maester can name.'
			});
		});

		it('takes revenue from the newest year only, never an older one', () => {
			const s = summarize({
				financials: canvas([r('Revenue from operations', '11240.75', null), profit, basic]),
				stock,
				stockFailed: false
			});
			expect(s.sentence).toBe(`${pricePart} In 2025–26 its profit grew 27.5% to ₹1,459 crore.`);
			expect(s.figures[3]!.value).toBe('₹1,459 cr');
			expect(s.figures[3]!.note).toBe('Consolidated.');
		});

		it('says the profit line wasn’t found, and keeps the revenue clause', () => {
			const s = summarize({
				financials: canvas([
					rev,
					r('Profit for the year from continuing operations', '1144', '1459'),
					basic
				]),
				stock,
				stockFailed: false
			});
			expect(s.sentence).toBe(`${pricePart} In 2025–26 its revenue grew 7.7% to ₹12,105 crore.`);
			expect(s.figures[3]).toMatchObject({
				value: null,
				reason: 'Profit wasn’t found in the statement.'
			});
		});

		it('says there is no annual report only when there is no profit and loss at all', () => {
			const s = summarize({
				financials: { company, filings: [], tables: [] },
				stock,
				stockFailed: false
			});
			expect(s.figures[3]!.reason).toBe('No annual report read yet.');
		});

		it('takes earnings per share from the newest year only', () => {
			const s = summarize({
				financials: canvas([
					rev,
					profit,
					r('Basic', '48.6', null, { section: 'Earnings per share', perShare: true })
				]),
				stock,
				stockFailed: false
			});
			expect(s.figures[2]).toMatchObject({
				value: null,
				reason: 'The filing’s earnings per share wasn’t read.'
			});
			expect(s.epsCell).toBeNull();
		});

		it('names a basis that is not stated', () => {
			const s = summarize({
				financials: canvas([rev, profit, basic], 'unknown'),
				stock,
				stockFailed: false
			});
			expect(s.figures[3]!.note).toMatch(/^Basis not stated\./);
			const standalone = summarize({
				financials: canvas([rev, profit, basic], 'standalone'),
				stock,
				stockFailed: false
			});
			expect(standalone.figures[3]!.note).toMatch(/^Standalone\./);
		});
	});
});

describe('the lines summarize reads', () => {
	const pricePart =
		'Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier.';
	const rev = r('Revenue from operations', '11240.75', '12105.4');
	const profit = r('Profit for the year', '1144', '1459', { isSubtotal: true });
	const basic = r('Basic', '48.6', '61.98', { section: 'Earnings per share', perShare: true });
	const run = (rows: FinancialRow[]) =>
		summarize({ financials: canvas(rows), stock, stockFailed: false });

	it.each([
		'Profit (Loss) for the period (XI + XIV)',
		'Profit for the year (VII-VIII)',
		'Net Profit after tax',
		'Profit after tax (PAT)',
		'Profit/(loss) for the year',
		'XV. Profit for the period'
	])('finds the profit line printed as “%s”', (label) => {
		const s = run([rev, r(label, '1144', '1459'), basic]);
		expect(s.figures[3]!.value).toBe('₹1,459 cr');
	});

	it.each([
		'I. Revenue from operations',
		'Revenue from Operations (Note 25)',
		'(a) Revenue from operations',
		'1. Revenue from operations'
	])('finds the revenue line printed as “%s”', (label) => {
		const s = run([r(label, '11240.75', '12105.4'), profit, basic]);
		expect(s.sentence).toBe(
			`${pricePart} In 2025–26 its revenue grew 7.7% to ₹12,105 crore and its profit grew 27.5% to ₹1,459 crore.`
		);
	});

	it('skips a line only an older filing prints, and takes the one in the newest year', () => {
		const s = run([
			r('Profit for the period', '1144', null),
			rev,
			r('Profit for the year', null, '1459'),
			basic
		]);
		expect(s.figures[3]!.value).toBe('₹1,459 cr');
	});

	it('takes the earnings per share printed for the newest year, after a split renamed it', () => {
		const s = run([
			rev,
			profit,
			r('Basic', '48.6', null, {
				section: 'Earnings per equity share (face value ₹10)',
				perShare: true
			}),
			r('Basic', null, '12.4', {
				section: 'Earnings per equity share (face value ₹2)',
				perShare: true
			})
		]);
		expect(s.figures[2]!.value).toBe('103.6');
		expect(s.epsCell).toEqual({ tableIndex: 0, row: 3, col: 1 });
		expect(s.figures[2]!.note).toBe(
			'1,284.50 ÷ 12.40, the basic earnings per share for 2025–26 (annual report, page 213).'
		);
	});

	it('says “the earnings per share” when the line isn’t the basic one', () => {
		const s = run([
			rev,
			profit,
			r('Earning per share (₹)', '48.6', '61.98', { section: 'Income', perShare: true })
		]);
		expect(s.figures[2]!.note).toBe(
			'1,284.50 ÷ 61.98, the earnings per share for 2025–26 (annual report, page 213).'
		);
	});

	it('names the element, not a page, when the earnings per share came from an XBRL file', () => {
		const eps = r('Basic', '48.6', '61.98', {
			section: 'Earnings per equity share',
			perShare: true
		});
		const xbrl = eps.cells.map((c) =>
			c.source
				? {
						...c,
						source: {
							kind: 'xbrl' as const,
							documentId: 'x',
							originalName: '500999_AR.xml',
							element: 'BasicEarningsLossPerShareFromContinuingOperations',
							contextId: 'OneD',
							decimals: '2',
							nil: false,
							periodStart: '2025-04-01',
							span: 'year' as const
						}
					}
				: c
		);
		const s = run([rev, profit, { ...eps, cells: xbrl }]);
		expect(s.figures[2]!.note).toBe(
			'1,284.50 ÷ 61.98, the basic earnings per share for 2025–26 (XBRL file, element BasicEarningsLossPerShareFromContinuingOperations).'
		);
		expect(s.figures[2]!.note).not.toMatch(/NaN|page/);
	});

	it('works out no price to earnings for a filing in another currency', () => {
		const unit = { label: 'USD in million', scale: '1000000', currency: 'USD' };
		const s = summarize({
			financials: canvas([rev, profit, basic], 'consolidated', unit),
			stock,
			stockFailed: false
		});
		expect(s.figures[2]).toMatchObject({
			value: null,
			reason: 'The filing reports in another currency.'
		});
		expect(s.epsCell).toBeNull();
	});
});

describe('a statement read with no figures placed by year', () => {
	const noColumns = (basis: ReportingBasis = 'consolidated'): StatementTable => ({
		...pl([], basis),
		columns: [],
		unplaced: 42
	});

	it('says the profit and loss has no figures it could place, not that nothing was read', () => {
		const s = summarize({
			financials: { company, filings: [counted], tables: [noColumns()] },
			stock,
			stockFailed: false
		});
		expect(s.figures[3]!.reason).toBe(
			'The profit and loss has no figures Maester could place by year.'
		);
		expect(s.figures[2]!.reason).toBe(
			'The profit and loss has no figures Maester could place by year.'
		);
		expect(s.sentence).toBe(
			'Synthetic Cements closed at ₹1,284.50 on Friday 9 October, 18.4% higher than a year earlier.'
		);
	});

	it('says no annual report was read only when none is counted', () => {
		const s = summarize({
			financials: { company, filings: [{ ...counted, counted: false }], tables: [] },
			stock,
			stockFailed: false
		});
		expect(s.figures[3]!.reason).toBe('No annual report read yet.');
	});

	it('uses the standalone profit and loss when the consolidated one has no columns', () => {
		const rows = [
			r('Revenue from operations', '11240.75', '12105.4'),
			r('Profit for the year', '1144', '1459')
		];
		const s = summarize({
			financials: {
				company,
				filings: [counted],
				tables: [noColumns('consolidated'), pl(rows, 'standalone')]
			},
			stock,
			stockFailed: false
		});
		expect(s.figures[3]!.value).toBe('₹1,459 cr');
		expect(s.figures[3]!.note).toMatch(/^Standalone\./);
	});
});

describe('the sentence’s wording', () => {
	const noPrice = { ...stock, state: 'not_tracked' as const, ...noPrices };
	const loss = [
		r('Profit for the year', '-120', '-310', { isSubtotal: true }),
		r('Basic', '-5.1', '-13.17', { section: 'Earnings per share', perShare: true })
	];

	it('names the company when a loss opens the sentence', () => {
		const s = summarize({ financials: canvas(loss), stock: noPrice, stockFailed: false });
		expect(s.sentence).toBe(
			'In 2025–26 Synthetic Cements made a loss of ₹310 crore, against a loss of ₹120 crore the year before.'
		);
	});

	it('says “it” after the price sentence', () => {
		const s = summarize({ financials: canvas(loss), stock, stockFailed: false });
		expect(s.sentence).toContain(
			'higher than a year earlier. In 2025–26 it made a loss of ₹310 crore'
		);
	});

	it('writes a year that doesn’t end in March in lower case mid-sentence', () => {
		const rows = [
			r('Revenue from operations', '11240.75', '12105.4'),
			r('Profit for the year', '1144', '1459'),
			r('Basic', '48.6', '61.98', { section: 'Earnings per share', perShare: true })
		];
		const financials: CompanyFinancials = {
			company,
			filings: [counted],
			tables: [pl(rows, 'consolidated', CRORE, ['2024-12-31', '2025-12-31'])]
		};
		const s = summarize({ financials, stock, stockFailed: false });
		expect(s.sentence).toContain(
			'In the year to 31 Dec 2025 its revenue grew 7.7% to ₹12,105 crore'
		);
		expect(s.figures[3]!.label).toBe('Profit for the year to 31 Dec 2025');
		expect(s.figures[3]!.change).toBe('+27.5% on the year to 31 Dec 2024');
		expect(s.figures[2]!.note).toBe(
			'1,284.50 ÷ 61.98, the basic earnings per share for the year to 31 Dec 2025 (annual report, page 213).'
		);
	});
});

describe('when the statements didn’t load', () => {
	it('keeps the prices, and says why each business figure is unknown', () => {
		const s = summarize({ financials: null, financialsFailed: true, stock, stockFailed: false });
		expect(s.figures.map((f) => f.value)).toEqual([
			'₹1,284.50',
			'₹1,021.15 – 1,342.80',
			null,
			null
		]);
		expect(s.figures[2]!.reason).toBe('The statements didn’t load.');
		expect(s.figures[3]!.reason).toBe('The statements didn’t load.');
	});
});
