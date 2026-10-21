import { describe, expect, it } from 'vitest';
import type { CellCheck, CellSource, FinancialCell, StatementTable } from './types';
import {
	addsUp,
	cellReason,
	cellText,
	defaultBasis,
	figure,
	filingShort,
	fyLabel,
	fromWords,
	fyWords,
	onPage,
	pageWords,
	pdfPageOf,
	restatedWords,
	standing,
	unitShort,
	unitWords,
	whereWords,
	yearsRead
} from './view';

const NO_CHECK: CellCheck = {
	role: 'none',
	status: null,
	checkType: null,
	subjectLabel: null,
	expected: null,
	actual: null
};
const cell = (over: Partial<FinancialCell> = {}): FinancialCell => ({
	status: 'value',
	value: '12105.4',
	printed: '12,105.40',
	factId: 'f',
	revisionId: 'r',
	source: { documentId: 'd', pageIndex: 212, pageCount: 286, textLayerMatch: true },
	check: NO_CHECK,
	restated: null,
	...over
});

describe('fyLabel', () => {
	it('names an Indian financial year, and any other year end by its date', () => {
		expect(fyLabel('2026-03-31')).toBe('2025–26');
		expect(fyLabel('2000-03-31')).toBe('1999–00');
		expect(fyLabel('2025-12-31')).toBe('Year to 31 Dec 2025');
	});
	it('names a year mid-sentence in lower case', () => {
		expect(fyWords('2026-03-31')).toBe('2025–26');
		expect(fyWords('2025-12-31')).toBe('the year to 31 Dec 2025');
	});
	it('names a filing by its year', () => {
		expect(filingShort('2026-03-31')).toBe('AR 2025–26');
		expect(filingShort(null)).toBe('An annual report');
	});
});

describe('figure', () => {
	it('groups the Indian way with two decimals and a real minus', () => {
		expect(figure('12105.4')).toBe('12,105.40');
		expect(figure('123456.5')).toBe('1,23,456.50');
		expect(figure('-12.4')).toBe('−12.40');
		expect(figure('0')).toBe('0.00');
	});
});

describe('units', () => {
	it('names the table unit in words', () => {
		expect(unitWords({ label: '₹ in crore', scale: '10000000', currency: 'INR' })).toBe('₹ crore');
		expect(unitWords({ label: 'Rs. in lakhs', scale: '100000', currency: 'INR' })).toBe('₹ lakh');
		expect(unitWords({ label: '$ in millions', scale: '1000000', currency: 'USD' })).toBe(
			'USD million'
		);
		expect(unitWords({ label: 'Rupees', scale: '1', currency: 'INR' })).toBe('₹');
		expect(unitWords({ label: 'odd', scale: null, currency: null })).toBe('the unit printed: odd');
		expect(unitShort({ label: '₹ in crore', scale: '10000000', currency: 'INR' })).toBe('cr');
	});
});

describe('cells', () => {
	it('shows a dash as printed and unknown as —, with the reason', () => {
		expect(cellText(cell())).toBe('12,105.40');
		expect(cellText(cell({ status: 'dash', value: null, printed: '-' }))).toBe('–');
		expect(cellText(cell({ status: 'missing', value: null, source: null }))).toBe('—');
		expect(cellReason(cell({ status: 'missing', value: null, source: null }), 'AR 2023–24')).toBe(
			'Not printed under this name in AR 2023–24.'
		);
		expect(cellReason(cell({ status: 'dash', value: null }), 'AR 2025–26')).toBe(
			'A dash printed on page 213. Maester doesn’t read it as zero.'
		);
		expect(cellReason(cell({ status: 'unparsed', value: null }), 'AR 2025–26')).toBe(
			'Maester couldn’t read what page 213 prints here.'
		);
		expect(cellReason(cell(), 'AR 2025–26')).toBeNull();
	});
});

const XBRL_SOURCE: CellSource = {
	kind: 'xbrl',
	documentId: 'x',
	originalName: '500999_Q2.xml',
	element: 'RevenueFromOperations',
	contextId: 'OneD',
	decimals: '-5',
	nil: false,
	periodStart: '2025-07-01',
	span: 'quarter'
};

describe('an XBRL source has an element and no page', () => {
	it('names the element, never a page, in the reasons and the page words', () => {
		const nil = cell({ status: 'unparsed', value: null, source: { ...XBRL_SOURCE, nil: true } });
		expect(cellReason(nil, 'Q2 2025–26')).toBe(
			'The XBRL file marks RevenueFromOperations as nil. Maester doesn’t read it as zero.'
		);
		const unread = cell({ status: 'unparsed', value: null, source: XBRL_SOURCE });
		expect(cellReason(unread, 'Q2 2025–26')).toBe(
			'Maester couldn’t read the value of RevenueFromOperations in the XBRL file.'
		);
		expect(cellReason(cell({ source: XBRL_SOURCE }), 'Q2 2025–26')).toBeNull();
		expect(pageWords(cell({ source: XBRL_SOURCE }))).toBe('RevenueFromOperations');
		for (const said of [cellReason(nil, 'x'), cellReason(unread, 'x'), pageWords(nil)]) {
			expect(said).not.toMatch(/NaN|page/i);
		}
	});

	it('says what the panel’s From and Restated rows say, for a page and for an element', () => {
		expect(fromWords(cell(), '2026-03-31')).toBe('Annual report 2025–26, page 213 of 286');
		expect(fromWords(cell({ source: XBRL_SOURCE }), '2026-03-31')).toBe(
			'Annual report 2025–26, element RevenueFromOperations'
		);
		expect(fromWords(cell({ source: null }), '2026-03-31')).toBeNull();
		const restated = {
			documentId: 'd',
			filingPeriodEnd: '2025-03-31',
			value: '1',
			printed: '11,000'
		};
		expect(restatedWords({ ...restated, pageIndex: 100 })).toContain('on page 101');
		const fromXbrl = restatedWords({ ...restated, kind: 'xbrl', element: 'RevenueFromOperations' });
		expect(fromXbrl).toContain('in the element RevenueFromOperations');
		expect(fromXbrl).not.toMatch(/NaN|page/i);
	});

	it('offers a PDF to open at a page only for a page source', () => {
		expect(pdfPageOf(cell())).toEqual({ documentId: 'd', pageIndex: 212 });
		expect(pdfPageOf(cell({ source: XBRL_SOURCE }))).toBeNull();
		expect(pdfPageOf(cell({ source: null }))).toBeNull();
	});

	it('has no text layer to say anything about', () => {
		expect(onPage(cell({ source: XBRL_SOURCE }))).toEqual({ text: '—' });
	});

	it('words where a figure came from, for a page and for an element', () => {
		expect(whereWords(cell())).toBe('annual report, page 213');
		expect(whereWords(cell({ source: XBRL_SOURCE }))).toBe(
			'XBRL file, element RevenueFromOperations'
		);
		expect(whereWords(cell({ source: null }))).toBe('annual report');
	});
});

describe('onPage', () => {
	it('says whether the page’s text holds the figure', () => {
		expect(onPage(cell())).toEqual({ text: 'Found in the page’s text' });
		expect(
			onPage(
				cell({
					source: { documentId: 'd', pageIndex: 212, pageCount: 286, textLayerMatch: null }
				})
			)
		).toEqual({ text: 'Page 213 is scanned: not checked against its text' });
		expect(
			onPage(
				cell({
					printed: '10,012.30',
					source: { documentId: 'd', pageIndex: 148, pageCount: 286, textLayerMatch: false }
				})
			)
		).toEqual({ strong: 'Not found.', text: 'The page’s text doesn’t contain 10,012.30.' });
	});
});

describe('addsUp', () => {
	it('says what the check found, in the table unit', () => {
		expect(addsUp(cell())).toEqual({ text: 'No sum covers this line' });
		expect(
			addsUp(
				cell({
					check: {
						role: 'component',
						status: 'passed',
						checkType: 'subtotal',
						subjectLabel: 'Total income',
						expected: '12480',
						actual: '12480'
					}
				})
			)
		).toEqual({ text: 'Part of total income, which adds up' });
		expect(
			addsUp(
				cell({
					check: {
						role: 'subject',
						status: 'passed',
						checkType: 'subtotal',
						subjectLabel: 'Total income',
						expected: '12480',
						actual: '12480'
					}
				})
			)
		).toEqual({ text: 'Adds up' });
		expect(
			addsUp(
				cell({
					check: {
						role: 'subject',
						status: 'failed',
						checkType: 'subtotal',
						subjectLabel: 'Total expenses',
						expected: '10012.3',
						actual: '10021.3'
					}
				})
			)
		).toEqual({
			strong: 'No.',
			text: 'The lines add up to 10,021.30; the page prints 10,012.30, 9.00 less.'
		});
		expect(
			addsUp(
				cell({
					check: {
						role: 'subject',
						status: 'failed',
						checkType: 'subtotal',
						subjectLabel: 'Total income',
						expected: '12489',
						actual: '12480'
					}
				})
			)
		).toEqual({
			strong: 'No.',
			text: 'The lines add up to 12,480.00; the page prints 12,489.00, 9.00 more.'
		});
		expect(
			addsUp(
				cell({
					check: {
						role: 'subject',
						status: 'failed',
						checkType: 'subtotal',
						subjectLabel: 'Total income',
						expected: null,
						actual: '12480'
					}
				})
			)
		).toEqual({ strong: 'No.', text: 'The lines add up to 12,480.00; the page prints —.' });
		expect(
			addsUp(
				cell({
					check: {
						role: 'subject',
						status: 'not_checked',
						checkType: 'subtotal',
						subjectLabel: 'Total',
						expected: null,
						actual: null
					}
				})
			)
		).toEqual({ text: 'Not checked' });
	});
});

describe('addsUp for the balance identity', () => {
	const identity = (status: 'passed' | 'failed', expected: string | null, actual: string | null) =>
		cell({
			check: {
				role: 'subject',
				status,
				checkType: 'balance_identity',
				subjectLabel: 'TOTAL ASSETS',
				expected,
				actual
			}
		});

	it('says total assets doesn’t equal equity and liabilities, not that lines don’t add up', () => {
		expect(addsUp(identity('failed', '300', '290'))).toEqual({
			strong: 'No.',
			text: 'Total assets doesn’t equal equity and liabilities: the page prints 300.00; equity and liabilities come to 290.00, 10.00 more.'
		});
		expect(addsUp(identity('failed', '17580', '17588'))).toEqual({
			strong: 'No.',
			text: 'Total assets doesn’t equal equity and liabilities: the page prints 17,580.00; equity and liabilities come to 17,588.00, 8.00 less.'
		});
		expect(addsUp(identity('failed', '300', null))).toEqual({
			strong: 'No.',
			text: 'Total assets doesn’t equal equity and liabilities: the page prints 300.00; equity and liabilities come to —.'
		});
	});

	it('says a passed identity adds up', () => {
		expect(addsUp(identity('passed', '300', '300'))).toEqual({ text: 'Adds up' });
	});
});

describe('yearsRead', () => {
	it('names each year once, newest first, and only counted filings', () => {
		expect(
			yearsRead([
				{ counted: true, periodEnd: '2025-03-31' },
				{ counted: true, periodEnd: '2026-03-31' },
				{ counted: true, periodEnd: '2026-03-31' },
				{ counted: true, periodEnd: null },
				{ counted: false, periodEnd: '2024-03-31' }
			])
		).toEqual(['2025–26', '2024–25']);
	});
});

describe('defaultBasis', () => {
	const t = (
		basis: StatementTable['basis'],
		placed: boolean,
		statement: StatementTable['statement'] = 'income_statement'
	) => ({ statement, basis, columns: placed ? [{}] : [] }) as unknown as StatementTable;

	it('opens the consolidated profit and loss when it has years', () => {
		expect(defaultBasis([t('standalone', true), t('consolidated', true)])).toBe('consolidated');
	});

	it('opens a basis with years before one whose figures had no date', () => {
		expect(defaultBasis([t('consolidated', false), t('standalone', true)])).toBe('standalone');
	});

	it('still opens a profit and loss with no years when it is all there is', () => {
		expect(defaultBasis([t('standalone', false), t('consolidated', true, 'balance_sheet')])).toBe(
			'standalone'
		);
		expect(defaultBasis([])).toBe('consolidated');
	});
});

describe('standing', () => {
	it('puts a failure first, then reading, then read', () => {
		expect(standing({ annualReportsRead: 2, reading: 1, failed: 1 })).toBe('1 filing didn’t read');
		expect(standing({ annualReportsRead: 2, reading: 1, failed: 0 })).toBe('Reading 1 filing');
		expect(standing({ annualReportsRead: 2, reading: 0, failed: 0 })).toBe('Read');
		expect(standing({ annualReportsRead: 0, reading: 0, failed: 0 })).toBe('Nothing read yet');
	});
});
