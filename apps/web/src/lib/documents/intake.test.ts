import { describe, expect, it } from 'vitest';
import {
	addedAt,
	changeFailure,
	companyAnswer,
	companyCandidates,
	identifiers,
	isLive,
	kindSaveLabel,
	anyLive,
	canReadAgain,
	mergeList,
	normalizeCompanyName,
	ladder,
	pickSlip,
	sourceOf,
	stateLabel,
	statementsWords,
	whatItIs
} from './intake';
import { ApiError } from './client';
import { pipe } from './testing';
import type { Classification, Company, DocumentRecord, Evidence, Job, NumbersState } from './types';

function job(type: string, state: Job['state']): Job {
	return { id: `job-${type}-${state}`, type, state, lastErrorCode: null };
}

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		id: 'd-1',
		companyId: null,
		originalName: 'synthetic-cements-ar-2025-26.pdf',
		format: 'pdf',
		declaredSize: 1077,
		state: 'stored',
		rejectionCode: null,
		intakeState: 'identifying',
		duplicateOfDocumentId: null,
		classification: null,
		createdAt: '2026-10-05T08:32:00Z',
		latestJob: null,
		pipeline: pipe(),
		...over
	};
}

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

const words = (d: DocumentRecord, opts?: { uploading?: boolean }) =>
	ladder(d, opts).map((step) => step.status);

describe('ladder', () => {
	it('names the four steps in order', () => {
		expect(ladder(doc()).map((step) => step.label)).toEqual([
			'Uploaded',
			'Worked out what it is',
			'Reading the statements',
			'Ready'
		]);
	});

	it('follows a file from upload to ready', () => {
		expect(words(doc({ state: 'pending_upload', intakeState: null }), { uploading: true })).toEqual(
			['now', 'next', 'next', 'next']
		);
		expect(words(doc({ state: 'verifying', intakeState: null }))).toEqual([
			'now',
			'next',
			'next',
			'next'
		]);
		expect(words(doc({ intakeState: null }))).toEqual(['done', 'now', 'next', 'next']);
		expect(words(doc({ intakeState: 'identifying' }))).toEqual(['done', 'now', 'next', 'next']);
		expect(words(doc({ intakeState: 'reading' }))).toEqual(['done', 'done', 'now', 'next']);
		expect(words(doc({ intakeState: 'read' }))).toEqual(['done', 'done', 'done', 'done']);
	});

	it('shows a PDF waiting for its XBRL as Next on reading the statements', () => {
		expect(words(doc({ intakeState: 'waiting_for_xbrl' }))).toEqual([
			'done',
			'done',
			'next',
			'next'
		]);
	});

	it('shows a re-read of an XBRL document, which runs document.xbrl, as Now on reading', () => {
		const again = doc({
			format: 'xbrl',
			intakeState: 'read',
			latestJob: job('document.xbrl', 'running')
		});
		expect(words(again)).toEqual(['done', 'done', 'now', 'next']);
		expect(stateLabel(again)).toBe('Reading the statements');
		expect(isLive(again)).toBe(true);
		const failedAgain = doc({
			format: 'xbrl',
			intakeState: 'read_failed',
			latestJob: job('document.xbrl', 'queued')
		});
		expect(words(failedAgain)).toEqual(['done', 'done', 'now', 'next']);
	});

	it('stops at the step that needs the investor', () => {
		for (const intakeState of ['needs_company', 'needs_kind', 'duplicate'] as const) {
			expect(words(doc({ intakeState }))).toEqual(['done', 'needs-you', 'next', 'next']);
		}
	});

	it('says which step stopped', () => {
		expect(words(doc({ intakeState: 'identify_failed' }))).toEqual([
			'done',
			'stopped',
			'next',
			'next'
		]);
		expect(words(doc({ intakeState: 'read_failed' }))).toEqual(['done', 'done', 'stopped', 'next']);
		expect(
			words(doc({ state: 'rejected', rejectionCode: 'UNSUPPORTED_TYPE', intakeState: null }))
		).toEqual(['stopped', 'next', 'next', 'next']);
		expect(words(doc({ state: 'pending_upload', intakeState: null }))).toEqual([
			'stopped',
			'next',
			'next',
			'next'
		]);
	});

	it('marks a kept document as not read', () => {
		expect(words(doc({ intakeState: 'kept' }))).toEqual(['done', 'done', 'not-read', 'not-read']);
	});

	it('shows a read started again as reading, though the document still says it failed', () => {
		const again = doc({
			intakeState: 'read_failed',
			latestJob: job('document.extract', 'running')
		});
		expect(words(again)).toEqual(['done', 'done', 'now', 'next']);
		expect(stateLabel(again)).toBe('Reading the statements');
		expect(isLive(again)).toBe(true);
	});
});

describe('stateLabel', () => {
	it('puts every intake state in plain words', () => {
		const cases: [DocumentRecord['intakeState'], string][] = [
			['identifying', 'Working out what it is'],
			['reading', 'Reading the statements'],
			['read', 'Ready'],
			['kept', 'Kept, not read'],
			['needs_company', 'Needs you: confirm the company'],
			['needs_kind', 'Needs you: what is it?'],
			['duplicate', 'Added before'],
			['identify_failed', 'Couldn’t work out what it is'],
			['read_failed', 'Couldn’t read the statements'],
			['waiting_for_xbrl', 'Waiting for its XBRL file.']
		];
		for (const [intakeState, label] of cases) {
			expect(stateLabel(doc({ intakeState }))).toBe(label);
		}
	});

	it('names the upload steps and what went wrong with the file', () => {
		const pending = doc({ state: 'pending_upload', intakeState: null });
		expect(stateLabel(pending, { uploading: true })).toBe('Uploading');
		expect(stateLabel(pending)).toBe('Upload didn’t finish');
		expect(stateLabel(doc({ state: 'uploaded', intakeState: null }))).toBe('Checking the file');
		expect(
			stateLabel(
				doc({
					state: 'verifying',
					intakeState: null,
					latestJob: job('document.verify', 'failed')
				})
			)
		).toBe('Couldn’t check the file');
		expect(
			stateLabel(doc({ state: 'rejected', rejectionCode: 'TOO_LARGE', intakeState: null }))
		).toBe('Too large');
	});
});

describe('isLive', () => {
	it('keeps polling a PDF waiting for its XBRL, so its release shows without a reload', () => {
		expect(isLive(doc({ intakeState: 'waiting_for_xbrl' }))).toBe(true);
	});

	it('polls only while work is running', () => {
		expect(isLive(doc({ state: 'uploaded', intakeState: null }))).toBe(true);
		expect(isLive(doc({ intakeState: 'identifying' }))).toBe(true);
		expect(isLive(doc({ intakeState: 'reading' }))).toBe(true);
		for (const intakeState of [
			'needs_company',
			'needs_kind',
			'duplicate',
			'kept',
			'read',
			'identify_failed',
			'read_failed'
		] as const) {
			expect(isLive(doc({ intakeState }))).toBe(false);
		}
		expect(isLive(doc({ state: 'pending_upload', intakeState: null }))).toBe(false);
		expect(isLive(doc({ state: 'rejected', intakeState: null }))).toBe(false);
	});
});

describe('pickSlip', () => {
	const read = doc({ id: 'read', intakeState: 'read', createdAt: '2026-10-05T10:00:00Z' });
	const needs = doc({
		id: 'needs',
		intakeState: 'needs_company',
		createdAt: '2026-10-05T09:00:00Z'
	});
	const failed = doc({
		id: 'failed',
		intakeState: 'read_failed',
		createdAt: '2026-10-05T08:00:00Z'
	});
	const abandoned = doc({
		id: 'abandoned',
		state: 'pending_upload',
		intakeState: null,
		createdAt: '2026-10-05T11:00:00Z'
	});

	it('opens the newest document that is not settled', () => {
		expect(pickSlip([failed, read, needs, abandoned])?.id).toBe('needs');
	});

	it('opens the one the investor asked for', () => {
		expect(pickSlip([read, needs], 'read')?.id).toBe('read');
	});

	it('falls back to the newest document when everything is settled', () => {
		const kept = doc({ id: 'kept', intakeState: 'kept', createdAt: '2026-10-05T09:30:00Z' });
		expect(pickSlip([kept, read])?.id).toBe('read');
		expect(pickSlip([])).toBeNull();
	});
});

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

describe('canReadAgain', () => {
	const pipeline = (state: NumbersState) => pipe({ numbers: { state } });

	it('is false for a PDF whose numbers come from its XBRL files', () => {
		expect(canReadAgain(doc({ intakeState: 'read', pipeline: pipeline('not_needed') }))).toBe(
			false
		);
	});

	it('is true for a read PDF whose numbers it read itself', () => {
		expect(canReadAgain(doc({ intakeState: 'read', pipeline: pipeline('done') }))).toBe(true);
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

describe('anyLive', () => {
	it('is true while a document other than the ones left out is being worked on', () => {
		const reading = doc({ id: 'reading', intakeState: 'reading' });
		const kept = doc({ id: 'kept', intakeState: 'kept' });
		expect(anyLive([kept, reading], [])).toBe(true);
		expect(anyLive([kept, reading], ['reading'])).toBe(false);
		expect(anyLive([kept], [null])).toBe(false);
		expect(anyLive([], [])).toBe(false);
	});
});

describe('mergeList', () => {
	const older = doc({ id: 'slip', intakeState: 'needs_company' });
	const newer = doc({ id: 'slip', intakeState: 'reading' });
	const other = doc({ id: 'other', intakeState: 'identifying' });
	const otherNow = doc({ id: 'other', intakeState: 'needs_kind' });
	const sending = doc({ id: 'sending', state: 'pending_upload', intakeState: null });

	it('takes the list’s copies, in the list’s order', () => {
		expect(mergeList([other], [otherNow], [])).toEqual([otherNow]);
	});

	it('keeps the copies it is told to keep, which are fresher than the list', () => {
		const merged = mergeList([newer, other], [older, otherNow], ['slip']);
		expect(merged.map((d) => d.intakeState)).toEqual(['reading', 'needs_kind']);
	});

	it('keeps documents the list does not have, after it', () => {
		expect(mergeList([sending, other], [otherNow], []).map((d) => d.id)).toEqual([
			'other',
			'sending'
		]);
	});
});
