import { describe, expect, it } from 'vitest';
import type {
	CellCheck,
	CellSource,
	FinancialCell,
	PageSource,
	StatementTable,
	TableUnit,
	XbrlSource
} from './types';
import { IN_PDF_RESULT_SHOWN } from '$lib/documents/in-pdf';
import type { StatementKind } from '$lib/documents/types';
import {
	addsUp,
	cellReason,
	cellText,
	defaultBasis,
	figure,
	filingShort,
	columnFrom,
	fyLabel,
	fromWords,
	fyWords,
	inPdfWords,
	onPage,
	pageWords,
	pdfPageOf,
	restatedWords,
	sourcePage,
	standing,
	unitShort,
	unitWords,
	whereWords,
	xbrlFrom,
	xbrlOpen,
	xbrlUnit,
	yearSources,
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
	source: { kind: 'page', documentId: 'd', pageIndex: 212, pageCount: 286, textLayerMatch: true },
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

const x: XbrlSource = {
	kind: 'xbrl',
	documentId: 'x4',
	originalName: '500999_Q4_FY26_Consolidated.xml',
	element: 'RevenueFromOperations',
	contextId: 'FourD',
	decimals: '-5',
	nil: false,
	periodStart: '2025-04-01',
	span: 'year',
	inPdf: {
		status: 'passed',
		pdfDocumentId: 'p4',
		pageIndex: 4,
		statementPages: [3, 4, 5],
		reason: null
	}
};
const xbrlCell = (over: Partial<FinancialCell> = {}) => cell({ source: x, ...over });
const crore: TableUnit = { label: 'crores', scale: '10000000', currency: 'INR' };
const lakh: TableUnit = { label: 'lakhs', scale: '100000', currency: 'INR' };

describe('an XBRL figure has an element and a file, never a page', () => {
	it('From names the filing and the file, never the context', () => {
		expect(xbrlFrom(x, '2026-03-31')).toEqual({
			text: 'Results for the year to 31 Mar 2026: the XBRL filed with the PDF',
			note: '500999_Q4_FY26_Consolidated.xml · tagged RevenueFromOperations'
		});
		expect(JSON.stringify(xbrlFrom(x, '2026-03-31'))).not.toContain('FourD');
	});

	it('From names the span, and an instant reads "at"', () => {
		const said = (span: XbrlSource['span']) => xbrlFrom({ ...x, span }, '2025-12-31').text;
		expect(said('quarter')).toContain('Results for the quarter to 31 Dec 2025:');
		expect(said('half_year')).toContain('Results for the half year to 31 Dec 2025:');
		expect(said('nine_months')).toContain('Results for the nine months to 31 Dec 2025:');
		expect(said(null)).toBe('Results at 31 Dec 2025: the XBRL filed with the PDF');
	});

	it('From with no PDF stored', () => {
		expect(
			xbrlFrom(
				{
					...x,
					inPdf: { ...x.inPdf, status: 'not_checked', pdfDocumentId: null, reason: 'no_pdf' }
				},
				'2026-03-31'
			).text
		).toBe('Results for the year to 31 Mar 2026: the XBRL file');
	});

	it('Unit: the declaration only when the cell carries one; the precision only where the two places shown agree', () => {
		expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: null })).toBe(
			'₹ crore; rounded to the lakh'
		);
		expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: crore })).toBe(
			'₹ crore, as the filing declares; rounded to the lakh'
		);
		expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-5', declared: lakh })).toBe(
			'₹ crore, converted from ₹ lakh as the filing declares; rounded to the lakh'
		);
		expect(xbrlUnit({ shown: crore, perShare: false, decimals: '-7', declared: null })).toBe(
			'₹ crore'
		);
		expect(xbrlUnit({ shown: crore, perShare: true, decimals: '2', declared: null })).toBe(
			'₹ a share; rounded to the paisa'
		);
		expect(xbrlUnit({ shown: crore, perShare: true, decimals: 'INF', declared: null })).toBe(
			'₹ a share'
		);
		expect(xbrlUnit({ shown: crore, perShare: false, decimals: null, declared: null })).toBe(
			'₹ crore'
		);
		expect(
			xbrlUnit({
				shown: { label: 'millions', scale: '1000000', currency: 'USD' },
				perShare: false,
				decimals: '-4',
				declared: null
			})
		).toBe('USD million');
	});

	it('In the PDF, each outcome, with the result shown', () => {
		expect(inPdfWords(x.inPdf, true)).toEqual({ text: 'Found on page 5 of the results PDF.' });
		expect(inPdfWords({ ...x.inPdf, pageIndex: null }, true)).toEqual({
			text: 'Found on the results PDF’s statement pages (4–6).'
		});
		expect(inPdfWords({ ...x.inPdf, status: 'failed', pageIndex: null }, true)).toEqual({
			strong: 'Not found on the PDF’s statement pages (4–6).',
			text: ' The figure stays as filed in XBRL. Check the PDF yourself.'
		});
		expect(inPdfWords({ ...x.inPdf, status: 'not_checked', reason: 'disabled' }, true).text).toBe(
			'Not checked: the check is turned off.'
		);
	});

	it('In the PDF reads "Not checked" while the result is not shown', () => {
		expect(IN_PDF_RESULT_SHOWN).toBe(false);
		expect(inPdfWords(x.inPdf)).toEqual({ text: 'Not checked' });
		expect(inPdfWords({ ...x.inPdf, status: 'failed', pageIndex: null })).toEqual({
			text: 'Not checked'
		});
		// A figure not checked for its own reason keeps that reason.
		expect(inPdfWords({ ...x.inPdf, status: 'not_checked', reason: 'disabled' }).text).toBe(
			'Not checked: the check is turned off.'
		);
	});

	it('the button: the match page, else where the statement pages start, else none', () => {
		expect(xbrlOpen(x, true)).toEqual({
			documentId: 'p4',
			pageIndex: 4,
			label: 'Open the results PDF at page 5',
			note: 'The page where the check found this figure. The XBRL file itself has no pages.'
		});
		expect(xbrlOpen({ ...x, inPdf: { ...x.inPdf, status: 'failed', pageIndex: null } })).toEqual({
			documentId: 'p4',
			pageIndex: 3,
			label: 'Open the results PDF at page 4',
			note: 'Where the statement pages start. The XBRL file has no pages.'
		});
		expect(
			xbrlOpen({
				...x,
				inPdf: { ...x.inPdf, status: 'not_checked', pageIndex: null, statementPages: [] }
			})
		).toEqual({
			documentId: 'p4',
			pageIndex: null,
			label: 'Open the results PDF',
			note: 'The XBRL file has no pages.'
		});
		expect(xbrlOpen({ ...x, inPdf: { ...x.inPdf, pdfDocumentId: null } })).toBeNull();
	});

	it('the button does not use the found page while the result is not shown', () => {
		expect(xbrlOpen(x)).toEqual({
			documentId: 'p4',
			pageIndex: 3,
			label: 'Open the results PDF at page 4',
			note: 'Where the statement pages start. The XBRL file has no pages.'
		});
	});

	it('an XBRL cell with no figure has a reason of its own, never a page sentence', () => {
		const nil = xbrlCell({ status: 'unparsed', value: null, source: { ...x, nil: true } });
		expect(cellText(nil)).toBe('—');
		expect(cellReason(nil, 'Results, XBRL')).toBe('The XBRL file gives no value for this line.');
		expect(cellReason(xbrlCell({ status: 'unparsed', value: null }), 'Results, XBRL')).toBe(
			'Maester couldn’t read the value the XBRL file gives for this line.'
		);
		expect(cellReason(xbrlCell({ status: 'value', value: null }), 'Results, XBRL')).toBe(
			'The XBRL file doesn’t declare its rounding, so the unit isn’t known.'
		);
		expect(
			cellReason(xbrlCell({ status: 'missing', value: null, source: null }), 'AR 2023–24')
		).toBe('Not printed under this name in AR 2023–24.');
		expect(cellReason(xbrlCell(), 'Results, XBRL')).toBeNull();
		expect(sourcePage(xbrlCell())).toBeNull();
		expect(sourcePage(cell())).toBe(213);
		for (const said of [cellReason(nil, 'x'), pageWords(nil)]) {
			expect(said).not.toMatch(/NaN|page/i);
		}
	});

	it('has no page to open and no text layer to say anything about', () => {
		expect(pdfPageOf(cell())).toEqual({ documentId: 'd', pageIndex: 212 });
		expect(pdfPageOf(xbrlCell())).toBeNull();
		expect(pdfPageOf(cell({ source: null }))).toBeNull();
		expect(onPage(xbrlCell())).toEqual({ text: '—' });
		expect(fromWords(cell(), '2026-03-31')).toBe('Annual report 2025–26, page 213 of 286');
		expect(fromWords(xbrlCell(), '2026-03-31')).toBeNull();
		expect(fromWords(cell({ source: null }), '2026-03-31')).toBeNull();
	});

	it('words where a figure came from, for a page and for an element', () => {
		expect(whereWords(cell())).toBe('annual report, page 213');
		expect(whereWords(xbrlCell())).toBe('XBRL file, element RevenueFromOperations');
		expect(whereWords(cell({ source: null }))).toBe('annual report');
	});

	it('restated: worded by the source that owns the cell, the XBRL value in the table’s unit', () => {
		const fromPage = {
			kind: 'page',
			documentId: 'ar',
			filingPeriodEnd: '2026-03-31',
			pageIndex: 212,
			value: '12100.00',
			printed: '12,100.00'
		} as const;
		expect(restatedWords(xbrlCell({ restated: fromPage }), crore, false)).toBe(
			'Annual report 2025–26 printed 12,100.00 for this year, on page 213. The XBRL filing’s figure is shown.'
		);
		expect(restatedWords(cell({ restated: fromPage }), crore, false)).toBe(
			'Annual report 2025–26 printed 12,100.00 for this year, on page 213. The newer filing’s figure is shown.'
		);
		const fromXbrl = {
			kind: 'xbrl',
			documentId: 'x3',
			filingPeriodEnd: '2026-03-31',
			element: 'RevenueFromOperations',
			value: '12100.5',
			printed: '121005000000'
		} as const;
		expect(restatedWords(xbrlCell({ restated: fromXbrl }), crore, false)).toBe(
			'Annual report 2025–26 filed 12,100.50 ₹ crore for this year in its XBRL file. The newer XBRL filing’s figure is shown.'
		);
		expect(restatedWords(cell({ restated: fromXbrl }), crore, true)).toBe(
			'Annual report 2025–26 filed 12,100.50 ₹ a share for this year in its XBRL file. This filing’s figure is shown.'
		);
		expect(restatedWords(cell(), crore, false)).toBeNull();
	});

	it('a sum that fails on an XBRL total says what the XBRL file gives, never a page', () => {
		const failed: CellCheck = {
			...NO_CHECK,
			role: 'subject',
			status: 'failed',
			checkType: 'subtotal',
			subjectLabel: 'Total income',
			expected: '100.00',
			actual: '99.00'
		};
		expect(addsUp(xbrlCell({ check: failed }))).toEqual({
			strong: 'No.',
			text: 'The lines add up to 99.00; the XBRL file gives 100.00, 1.00 more.'
		});
		const identity: CellCheck = {
			...failed,
			checkType: 'balance_identity',
			subjectLabel: 'Total assets',
			actual: '98.00'
		};
		expect(addsUp(xbrlCell({ check: identity }))).toEqual({
			strong: 'No.',
			text: 'Total assets doesn’t equal equity and liabilities: the XBRL file gives 100.00; equity and liabilities come to 98.00, 2.00 more.'
		});
	});
});

describe('a year from two sources is named; one source names nothing', () => {
	const page: PageSource = {
		kind: 'page',
		documentId: 'ar',
		pageIndex: 212,
		pageCount: 286,
		textLayerMatch: true
	};
	const tableOf = (statement: StatementKind, source: CellSource): StatementTable => ({
		statement,
		basis: 'consolidated',
		unit: crore,
		unplaced: 0,
		leftOut: [],
		columns: [
			{
				periodEnd: '2026-03-31',
				periodLabel: '2025–26',
				documentId: source.documentId,
				filingPeriodEnd: '2026-03-31'
			}
		],
		rows: [
			{
				key: 'r',
				section: '',
				label: 'Line',
				isSubtotal: false,
				perShare: false,
				cells: [cell({ source })]
			}
		]
	});

	it('names the sources of a mixed year', () => {
		expect(
			yearSources(
				[tableOf('income_statement', x), tableOf('balance_sheet', x), tableOf('cash_flow', page)],
				'consolidated'
			)
		).toEqual([
			{
				year: '2025–26',
				words:
					'Profit and loss and balance sheet from the XBRL; cash flow from the annual report, read by Gemini.'
			}
		]);
	});

	it('names nothing when one source covers the year, or the basis has no table', () => {
		expect(
			yearSources([tableOf('income_statement', x), tableOf('cash_flow', x)], 'consolidated')
		).toEqual([]);
		expect(
			yearSources([tableOf('income_statement', x), tableOf('cash_flow', page)], 'standalone')
		).toEqual([]);
	});

	it('says where a column comes from', () => {
		expect(columnFrom(tableOf('cash_flow', page), 0)).toBe('page');
		expect(columnFrom(tableOf('cash_flow', x), 0)).toBe('xbrl');
		const none = tableOf('cash_flow', page);
		none.rows[0]!.cells = [cell({ status: 'missing', value: null, source: null })];
		expect(columnFrom(none, 0)).toBeNull();
	});
});

describe('onPage', () => {
	it('says whether the page’s text holds the figure', () => {
		expect(onPage(cell())).toEqual({ text: 'Found in the page’s text' });
		expect(
			onPage(
				cell({
					source: {
						kind: 'page',
						documentId: 'd',
						pageIndex: 212,
						pageCount: 286,
						textLayerMatch: null
					}
				})
			)
		).toEqual({ text: 'Page 213 is scanned: not checked against its text' });
		expect(
			onPage(
				cell({
					printed: '10,012.30',
					source: {
						kind: 'page',
						documentId: 'd',
						pageIndex: 148,
						pageCount: 286,
						textLayerMatch: false
					}
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
