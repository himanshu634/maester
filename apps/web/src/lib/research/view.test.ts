import { describe, expect, it } from 'vitest';
import type { CellCheck, FinancialCell } from './types';
import {
	addsUp,
	cellReason,
	cellText,
	figure,
	filingShort,
	fyLabel,
	onPage,
	standing,
	unitShort,
	unitWords
} from './view';

const NO_CHECK: CellCheck = {
	role: 'none',
	status: null,
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
						subjectLabel: 'Total',
						expected: null,
						actual: null
					}
				})
			)
		).toEqual({ text: 'Not checked' });
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
