import { describe, expect, it } from 'vitest';
import {
	addedAt,
	changeFailure,
	companyAnswer,
	companyCandidates,
	identifiers,
	kindSaveLabel,
	normalizeCompanyName,
	sourceOf,
	statementsWords,
	whatItIs
} from './intake';
import { ApiError } from './client';
import type { Classification, Company, Evidence } from './types';

/** The answers the local stack gave for a synthetic annual report (rules only, no model). */
const annualReport: Classification = {
	id: 'c-1',
	documentId: 'd-1',
	kind: 'annual_report',
	otherType: null,
	resultsSpan: null,
	periodEnd: '2026-03-31',
	periodLabel: 'As at 31 March 2026',
	companyId: null,
	companyNameAsPrinted: 'Synthetic Cements Limited',
	cin: 'L26940MH2001PLC123456',
	bseCode: null,
	nseSymbol: null,
	isin: null,
	statementsFound: [{ basis: 'standalone', pages: [1], statement: 'balance_sheet' }],
	setBy: 'maester'
};
const annualEvidence: Evidence[] = [
	{
		field: 'kind',
		source: 'rule',
		pageIndex: 0,
		quote: 'Integrated Annual Report 2025-26',
		textLayerMatch: true,
		element: null,
		context: null
	},
	{
		field: 'company',
		source: 'rule',
		pageIndex: 0,
		quote: 'Synthetic Cements Limited',
		textLayerMatch: true,
		element: null,
		context: null
	},
	{
		field: 'identifier',
		source: 'rule',
		pageIndex: 0,
		quote: 'CIN: L26940MH2001PLC123456',
		textLayerMatch: true,
		element: null,
		context: null
	},
	{
		field: 'period',
		source: 'rule',
		pageIndex: 1,
		quote: 'Standalone Balance Sheet as at 31 March 2026',
		textLayerMatch: true,
		element: null,
		context: null
	}
];

describe('whatItIs', () => {
	it('names the kind, the type and the span in plain words', () => {
		expect(whatItIs(null)).toBe('—');
		expect(whatItIs({ kind: 'annual_report', otherType: null, resultsSpan: null })).toBe(
			'Annual report'
		);
		expect(whatItIs({ kind: 'financial_results', otherType: null, resultsSpan: 'quarter' })).toBe(
			'Financial results, quarter'
		);
		expect(whatItIs({ kind: 'financial_results', otherType: null, resultsSpan: null })).toBe(
			'Financial results'
		);
		expect(whatItIs({ kind: 'other', otherType: 'shareholding_pattern', resultsSpan: null })).toBe(
			'Shareholding pattern'
		);
		expect(whatItIs({ kind: 'other', otherType: 'shareholder_notice', resultsSpan: null })).toBe(
			'Notice to shareholders'
		);
		expect(whatItIs({ kind: 'other', otherType: null, resultsSpan: null })).toBe(
			'Other company document'
		);
		expect(whatItIs({ kind: 'not_sure', otherType: null, resultsSpan: null })).toBe('Not sure');
	});
});

describe('sourceOf', () => {
	it('quotes the page an answer came from, counting pages from 1', () => {
		expect(sourceOf(annualEvidence, 'kind')).toBe('Page 1: “Integrated Annual Report 2025-26”');
		expect(sourceOf(annualEvidence, 'period')).toBe(
			'Page 2: “Standalone Balance Sheet as at 31 March 2026”'
		);
	});

	it('says so when the answer is the investor’s', () => {
		const changed: Evidence[] = [
			{
				field: 'company',
				source: 'investor',
				pageIndex: null,
				quote: null,
				textLayerMatch: null,
				element: null,
				context: null
			},
			...annualEvidence
		];
		expect(sourceOf(changed, 'company')).toBe('You said so');
	});

	it('gives the page alone without a quote, and nothing without either', () => {
		expect(
			sourceOf(
				[
					{
						field: 'kind',
						source: 'model',
						pageIndex: 4,
						quote: null,
						textLayerMatch: true,
						element: null,
						context: null
					}
				],
				'kind'
			)
		).toBe('Page 5');
		expect(
			sourceOf(
				[
					{
						field: 'kind',
						source: 'model',
						pageIndex: null,
						quote: 'x',
						textLayerMatch: true,
						element: null,
						context: null
					}
				],
				'kind'
			)
		).toBe(null);
		expect(sourceOf(annualEvidence, 'results_span')).toBeNull();
	});

	it('marks a quote that was not found in the page’s text layer as read from a scan', () => {
		expect(
			sourceOf(
				[
					{
						field: 'period',
						source: 'model',
						pageIndex: 2,
						quote: 'Year ended',
						textLayerMatch: null,
						element: null,
						context: null
					}
				],
				'period'
			)
		).toBe('Page 3 (scanned): “Year ended”');
		expect(
			sourceOf(
				[
					{
						field: 'period',
						source: 'model',
						pageIndex: 2,
						quote: 'Year ended',
						textLayerMatch: false,
						element: null,
						context: null
					}
				],
				'period'
			)
		).toBe('Page 3: “Year ended”');
	});
});

describe('sourceOf for XBRL evidence', () => {
	it('names the element and its value in place of a page', () => {
		const evidence: Evidence[] = [
			{
				field: 'identifier',
				source: 'rule',
				pageIndex: null,
				quote: '500999',
				textLayerMatch: null,
				element: 'ScripCode',
				context: 'OneD'
			}
		];
		expect(sourceOf(evidence, 'identifier')).toBe('ScripCode 500999');
	});

	it('names the element alone without a quote, and keeps the page form for a PDF', () => {
		expect(
			sourceOf(
				[
					{
						field: 'period',
						source: 'rule',
						pageIndex: null,
						quote: null,
						textLayerMatch: null,
						element: 'DateOfEndOfReportingPeriod',
						context: null
					}
				],
				'period'
			)
		).toBe('DateOfEndOfReportingPeriod');
		expect(sourceOf(annualEvidence, 'kind')).toBe('Page 1: “Integrated Annual Report 2025-26”');
	});
});

describe('normalizeCompanyName', () => {
	it('ignores case, punctuation, a leading “the” and a trailing limited', () => {
		expect(normalizeCompanyName('The Synthetic Cements Ltd.')).toBe('synthetic cements');
		expect(normalizeCompanyName('SYNTHETIC CEMENTS LIMITED')).toBe('synthetic cements');
		expect(normalizeCompanyName('Synthetic Cements Pvt. Ltd')).toBe('synthetic cements');
		expect(normalizeCompanyName('Synthetic Cements Private Limited')).toBe('synthetic cements');
		expect(normalizeCompanyName('Harbour & Sons')).toBe('harbour and sons');
	});
});

describe('companyCandidates', () => {
	const company = (over: Partial<Company> & { id: string; displayName: string }): Company => ({
		country: 'IN',
		cin: null,
		bseCode: null,
		nseSymbol: null,
		isin: null,
		...over
	});
	const cement = company({
		id: 'co-1',
		displayName: 'Synthetic Cements Limited',
		cin: 'L26940MH2001PLC123456'
	});
	const cementCopy = company({ id: 'co-2', displayName: 'The Synthetic Cements Ltd' });
	const listed = company({ id: 'co-3', displayName: 'Coastal Power', bseCode: '500123' });
	const other = company({ id: 'co-4', displayName: 'Meridian Bank', nseSymbol: 'MERIDIAN' });

	it('matches the ISIN with the exchange codes, after the CIN and before the name', () => {
		const isinCo = company({ id: 'co-5', displayName: 'Unrelated Name', isin: 'INE123A01012' });
		const byIsin = { ...annualReport, cin: null, isin: 'INE123A01012' };
		expect(companyCandidates(byIsin, [cement, isinCo]).map((c) => c.id)).toEqual(['co-5']);
		// A CIN match wins over an ISIN match.
		expect(
			companyCandidates({ ...byIsin, cin: 'L26940MH2001PLC123456' }, [isinCo, cement]).map(
				(c) => c.id
			)
		).toEqual(['co-1']);
		// An ISIN joins the BSE and NSE codes in one step: any of them matches.
		expect(
			companyCandidates({ ...byIsin, bseCode: '500123' }, [listed, isinCo]).map((c) => c.id)
		).toEqual(['co-3', 'co-5']);
		// An ISIN match wins over a name match.
		expect(
			companyCandidates({ ...byIsin, companyNameAsPrinted: 'The Synthetic Cements Ltd' }, [
				cementCopy,
				isinCo
			]).map((c) => c.id)
		).toEqual(['co-5']);
	});

	it('matches the printed CIN first', () => {
		expect(companyCandidates(annualReport, [other, cementCopy, cement]).map((c) => c.id)).toEqual([
			'co-1'
		]);
	});

	it('then the exchange codes', () => {
		const printed = { ...annualReport, cin: null, bseCode: '500123', nseSymbol: 'MERIDIAN' };
		expect(companyCandidates(printed, [cement, listed, other]).map((c) => c.id)).toEqual([
			'co-3',
			'co-4'
		]);
	});

	it('then the name, normalised, and every company that shares it', () => {
		const printed = { ...annualReport, cin: 'L99999MH2001PLC999999' };
		expect(companyCandidates(printed, [cement, cementCopy, other]).map((c) => c.id)).toEqual([
			'co-1',
			'co-2'
		]);
	});

	it('finds none for a company not in the workspace', () => {
		const printed = { ...annualReport, cin: null, companyNameAsPrinted: 'Quill Software Limited' };
		expect(companyCandidates(printed, [cement, other])).toEqual([]);
		expect(companyCandidates({ ...printed, companyNameAsPrinted: null }, [cement])).toEqual([]);
	});
});

describe('kindSaveLabel', () => {
	it('promises a read only for the kinds Maester reads', () => {
		expect(kindSaveLabel('annual_report')).toBe('Save and read it');
		expect(kindSaveLabel('financial_results')).toBe('Save and read it');
		expect(kindSaveLabel('other')).toBe('Save');
		expect(kindSaveLabel(null)).toBe('Save and read it');
	});
});

describe('statementsWords', () => {
	it('lists each statement with its basis', () => {
		expect(statementsWords(annualReport.statementsFound)).toBe('Balance sheet (standalone)');
		expect(
			statementsWords([
				{ statement: 'balance_sheet', basis: 'consolidated', pages: [40] },
				{ statement: 'income_statement', basis: 'consolidated', pages: [41] }
			])
		).toBe('Balance sheet (consolidated), Profit and loss (consolidated)');
		expect(statementsWords([])).toBe('—');
	});
});

describe('identifiers', () => {
	it('lists the ISIN after NSE', () => {
		expect(
			identifiers(
				{ cin: null, bseCode: '500999', nseSymbol: 'SYNCEM', isin: 'INE999Z01011' },
				[]
			).map((i) => i.label)
		).toEqual(['BSE', 'NSE', 'ISIN']);
	});

	it('lists the identifiers printed on the filing with their pages', () => {
		expect(identifiers(annualReport, annualEvidence)).toEqual([
			{ label: 'CIN', value: 'L26940MH2001PLC123456', page: 1 }
		]);
		expect(identifiers({ ...annualReport, cin: null, nseSymbol: 'SYNCEM' }, [])).toEqual([
			{ label: 'NSE', value: 'SYNCEM', page: null }
		]);
	});
});

describe('companyAnswer', () => {
	it('adds the company as printed, in India, with the identifiers that are well formed', () => {
		expect(companyAnswer(annualReport)).toEqual({
			new: {
				displayName: 'Synthetic Cements Limited',
				country: 'IN',
				cin: 'L26940MH2001PLC123456'
			}
		});
		expect(
			companyAnswer(
				{ ...annualReport, cin: 'not-a-cin', bseCode: '500123', nseSymbol: 'syn' },
				'  Other Name '
			)
		).toEqual({ new: { displayName: 'Other Name', country: 'IN', bseCode: '500123' } });
	});
});

describe('addedAt', () => {
	const now = new Date('2026-10-05T12:00:00Z');

	it('gives the time for today and the date before that', () => {
		expect(addedAt('2026-10-05T08:32:00Z', now, 'Asia/Kolkata')).toBe('14:02');
		expect(addedAt('2026-10-02T08:32:00Z', now, 'Asia/Kolkata')).toBe('2 Oct, 14:02');
	});
});

describe('changeFailure', () => {
	it('reloads after the answers changed elsewhere', () => {
		const stale = new ApiError(409, 'CONFLICT', 'changed', [
			{ path: 'basedOn', message: 'not current' }
		]);
		expect(changeFailure(stale)).toEqual({
			message: 'These answers changed since you opened them. Here is the latest.',
			reload: true
		});
	});

	it('explains a company clash without reloading', () => {
		const clash = new ApiError(409, 'CONFLICT', 'exists', [
			{ path: 'company.new', message: 'already exists' }
		]);
		expect(changeFailure(clash)).toEqual({
			message:
				'You already have a company with this name or number. Pick it from your companies instead.',
			reload: false
		});
	});

	it('says when nothing changed, and when the answer was not accepted', () => {
		expect(changeFailure(new ApiError(400, 'VALIDATION_FAILED', 'nothing changed')).message).toBe(
			'That is already the answer. Nothing was changed.'
		);
		expect(changeFailure(new ApiError(400, 'VALIDATION_FAILED', 'bad cin')).message).toBe(
			'Maester couldn’t save that answer. Check it and try again.'
		);
		expect(changeFailure(new ApiError(0, 'NETWORK', 'down')).message).toBe(
			'That didn’t reach Maester. Check your connection and try again.'
		);
		expect(changeFailure(new Error('boom')).message).toBe('That didn’t save. Try again.');
	});
});
