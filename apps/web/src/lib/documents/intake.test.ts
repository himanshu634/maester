import { describe, expect, it } from 'vitest';
import {
	addedAt,
	changeFailure,
	checkFile,
	companyAnswer,
	identifiers,
	isLive,
	ladder,
	MAX_UPLOAD_BYTES,
	pickSlip,
	sourceOf,
	stateLabel,
	statementsWords,
	uploadFailure,
	whatItIs
} from './intake';
import { ApiError } from './client';
import type { Classification, DocumentRecord, Evidence, Job } from './types';

function job(type: string, state: Job['state']): Job {
	return { id: `job-${type}-${state}`, type, state, lastErrorCode: null };
}

function doc(over: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		id: 'd-1',
		companyId: null,
		originalName: 'synthetic-cements-ar-2025-26.pdf',
		declaredSize: 1077,
		state: 'stored',
		rejectionCode: null,
		intakeState: 'identifying',
		duplicateOfDocumentId: null,
		classification: null,
		createdAt: '2026-10-05T08:32:00Z',
		latestJob: null,
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
	statementsFound: [{ basis: 'standalone', pages: [1], statement: 'balance_sheet' }],
	setBy: 'maester'
};
const annualEvidence: Evidence[] = [
	{ field: 'kind', source: 'rule', pageIndex: 0, quote: 'Integrated Annual Report 2025-26' },
	{ field: 'company', source: 'rule', pageIndex: 0, quote: 'Synthetic Cements Limited' },
	{ field: 'identifier', source: 'rule', pageIndex: 0, quote: 'CIN: L26940MH2001PLC123456' },
	{
		field: 'period',
		source: 'rule',
		pageIndex: 1,
		quote: 'Standalone Balance Sheet as at 31 March 2026'
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
			words(doc({ state: 'rejected', rejectionCode: 'NOT_A_PDF', intakeState: null }))
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
			['read_failed', 'Couldn’t read the statements']
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
			{ field: 'company', source: 'investor', pageIndex: null, quote: null },
			...annualEvidence
		];
		expect(sourceOf(changed, 'company')).toBe('You said so');
	});

	it('gives the page alone without a quote, and nothing without either', () => {
		expect(sourceOf([{ field: 'kind', source: 'model', pageIndex: 4, quote: null }], 'kind')).toBe(
			'Page 5'
		);
		expect(
			sourceOf([{ field: 'kind', source: 'model', pageIndex: null, quote: 'x' }], 'kind')
		).toBe(null);
		expect(sourceOf(annualEvidence, 'results_span')).toBeNull();
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

describe('checkFile', () => {
	const pdf = (size: number, name = 'ar.pdf', type = 'application/pdf') => ({ name, size, type });

	it('takes a PDF up to 50 MB', () => {
		expect(MAX_UPLOAD_BYTES).toBe(52_428_800);
		expect(checkFile(pdf(MAX_UPLOAD_BYTES))).toBeNull();
		expect(checkFile(pdf(1000, 'AR.PDF', ''))).toBeNull();
	});

	it('refuses a larger file, saying how large it is', () => {
		expect(checkFile(pdf(62 * 1024 * 1024))).toBe(
			'This file is 62 MB. Maester takes PDFs up to 50 MB.'
		);
		expect(checkFile(pdf(MAX_UPLOAD_BYTES + 1))).toBe(
			'This file is 50.1 MB. Maester takes PDFs up to 50 MB.'
		);
	});

	it('refuses anything that is not a PDF, naming what it is when it can', () => {
		expect(
			checkFile(
				pdf(
					1000,
					'notes.docx',
					'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
				)
			)
		).toBe('This is a Word document. Save it as a PDF and add it again.');
		expect(checkFile(pdf(1000, 'scan.jpg', 'image/jpeg'))).toBe(
			'This is a picture. Save it as a PDF and add it again.'
		);
		expect(checkFile(pdf(1000, 'report.pdf.zip', 'application/zip'))).toBe(
			'This isn’t a PDF. Save it as a PDF and add it again.'
		);
		expect(checkFile(pdf(1000, 'ar.pdf', 'text/plain'))).toBe(
			'This isn’t a PDF. Save it as a PDF and add it again.'
		);
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

describe('uploadFailure', () => {
	it('repeats the size limit when the API refuses the size', () => {
		expect(
			uploadFailure(new ApiError(413, 'UPLOAD_TOO_LARGE', 'too large'), { size: 60 * 1024 * 1024 })
		).toEqual({ message: 'This file is 60 MB. Maester takes PDFs up to 50 MB.', signIn: false });
	});

	it('asks a signed-out investor to sign in and add it again', () => {
		expect(uploadFailure(new ApiError(401, 'UNAUTHENTICATED', 'no'), { size: 10 })).toEqual({
			message: 'The upload didn’t finish. Sign in and add it again.',
			signIn: true
		});
		expect(uploadFailure(new ApiError(0, 'NETWORK', 'down'), { size: 10 }).message).toBe(
			'The upload didn’t finish. Check your connection and add it again.'
		);
	});
});
