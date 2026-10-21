/**
 * What the Documents page says about one file's answers, kept free of Svelte so it can be tested:
 * what Maester read it as and the page each answer came from, the company it could be, and what
 * to say when a change is refused. Where a filing stands is in `tracks.ts` and `filings.ts`; what
 * is wrong with a file before it is sent is in `batch.ts`.
 */
import { documentsContent as copy } from '$lib/content/documents';
import { ApiError } from './client';
import type {
	ChosenKind,
	Classification,
	ClassificationSummary,
	Company,
	CompanyAnswer,
	Evidence,
	EvidenceField,
	StatementFound
} from './types';

/** The API's upload limit (MAX_UPLOAD_BYTES, 50 MiB) for each file, stated before any is chosen. */
export const MAX_UPLOAD_BYTES = 52_428_800;

/** How often the opened filing asks for its own documents while Maester works on it. */
export const POLL_MS = 2_000;

/** How often the filings are read again while another filing in Working on is live. */
export const LIST_POLL_MS = 5_000;

/** What it is, in plain words: "Annual report", "Financial results, quarter", "Board meeting". */
export function whatItIs(
	answer: Pick<ClassificationSummary, 'kind' | 'otherType' | 'resultsSpan'> | null
): string {
	if (!answer) return '—';
	switch (answer.kind) {
		case 'financial_results':
			return answer.resultsSpan
				? `${copy.kinds.financial_results}, ${copy.spans[answer.resultsSpan]}`
				: copy.kinds.financial_results;
		case 'other':
			return answer.otherType ? copy.otherTypes[answer.otherType] : copy.kinds.other;
		default:
			return copy.kinds[answer.kind];
	}
}

/**
 * Where an answer came from: "Page 3: “Annual Report 2025–26”" for an answer read from the
 * filing (pages counted from 1), "ScripCode 500999" for one read from an XBRL file (its element
 * and value), "You said so" for the investor's, or null when there is nothing to point at. Never
 * a confidence.
 */
export function sourceOf(evidence: Evidence[], field: EvidenceField): string | null {
	const forField = evidence.filter((e) => e.field === field);
	if (forField.some((e) => e.source === 'investor')) return copy.filing.youSaidSo;
	const fromElement = forField.find((e) => e.element !== null);
	if (fromElement?.element) return copy.filing.fromElement(fromElement.element, fromElement.quote);
	const found = forField.find((e) => e.pageIndex !== null);
	if (!found || found.pageIndex === null) return null;
	const page =
		found.textLayerMatch === null && found.source !== 'investor'
			? copy.filing.scannedPage(found.pageIndex + 1)
			: `Page ${found.pageIndex + 1}`;
	return found.quote ? `${page}: “${found.quote}”` : page;
}

/** "Balance sheet (standalone), Profit and loss (standalone)", or "—" when none was found. */
export function statementsWords(found: StatementFound[]): string {
	if (found.length === 0) return '—';
	return found.map((s) => `${copy.statements[s.statement]} (${copy.bases[s.basis]})`).join(', ');
}

/** The period as the filing states it, else its end date, else unknown. */
export function periodWords(answer: Pick<Classification, 'periodLabel' | 'periodEnd'>): string {
	if (answer.periodLabel) return answer.periodLabel;
	if (answer.periodEnd) {
		const date = new Date(`${answer.periodEnd}T00:00:00Z`);
		const formatted = new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(date);
		return `To ${formatted}`;
	}
	return '—';
}

export interface PrintedIdentifier {
	label: 'CIN' | 'BSE' | 'NSE' | 'ISIN';
	value: string;
	/** 1-based page it was printed on, when the evidence says. */
	page: number | null;
}

/** The identifiers printed on the filing, each with the page it was found on. */
export function identifiers(
	answer: Pick<Classification, 'cin' | 'bseCode' | 'nseSymbol' | 'isin'>,
	evidence: Evidence[]
): PrintedIdentifier[] {
	const found: [PrintedIdentifier['label'], string | null][] = [
		['CIN', answer.cin],
		['BSE', answer.bseCode],
		['NSE', answer.nseSymbol],
		['ISIN', answer.isin]
	];
	return found.flatMap(([label, value]) => {
		if (!value) return [];
		const source = evidence.find(
			(e) => e.field === 'identifier' && e.pageIndex !== null && e.quote?.includes(value)
		);
		return [{ label, value, page: source?.pageIndex != null ? source.pageIndex + 1 : null }];
	});
}

// The API's own checks (packages/contracts/src/classification.ts): an identifier that does not
// match is left out rather than sent and refused.
export const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
export const BSE = /^\d{6}$/;
export const NSE = /^[A-Z][A-Z0-9&-]{0,19}$/;
export const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * The answer that adds the company as printed (or under `name`), in India, carrying the
 * identifiers printed on the filing that are well formed.
 */
export function companyAnswer(
	answer: Pick<Classification, 'companyNameAsPrinted' | 'cin' | 'bseCode' | 'nseSymbol'>,
	name?: string
): CompanyAnswer {
	const displayName = (name ?? answer.companyNameAsPrinted ?? '').trim();
	return {
		new: {
			displayName,
			country: 'IN',
			...(answer.cin && CIN.test(answer.cin) ? { cin: answer.cin } : {}),
			...(answer.bseCode && BSE.test(answer.bseCode) ? { bseCode: answer.bseCode } : {}),
			...(answer.nseSymbol && NSE.test(answer.nseSymbol) ? { nseSymbol: answer.nseSymbol } : {})
		}
	};
}

/**
 * A company name reduced to what identifies it: case, punctuation, a leading "the" and a trailing
 * "ltd", "limited" or "pvt ltd" ignored. Mirrors normalizeCompanyName in
 * packages/db/src/queries/classification.ts, so the page finds the companies the worker found.
 */
export function normalizeCompanyName(name: string): string {
	return name
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9 ]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^the /, '')
		.replace(/ (?:pvt |private )?(?:ltd|limited)$/, '');
}

/**
 * The workspace's companies this filing could belong to, as the worker matches them
 * (matchCompanies in packages/db): by the printed CIN, else any of the exchange codes and the
 * ISIN, else the name.
 * Several matches are why a document holds for the investor even when the company is known.
 */
export function companyCandidates(
	answer: Pick<Classification, 'companyNameAsPrinted' | 'cin' | 'bseCode' | 'nseSymbol' | 'isin'>,
	companies: Company[]
): Company[] {
	if (answer.cin) {
		const byCin = companies.filter((c) => c.cin === answer.cin);
		if (byCin.length) return byCin;
	}
	if (answer.bseCode || answer.nseSymbol || answer.isin) {
		const byCode = companies.filter(
			(c) =>
				(!!answer.bseCode && c.bseCode === answer.bseCode) ||
				(!!answer.nseSymbol && c.nseSymbol === answer.nseSymbol) ||
				(!!answer.isin && c.isin === answer.isin)
		);
		if (byCode.length) return byCode;
	}
	if (!answer.companyNameAsPrinted) return [];
	const wanted = normalizeCompanyName(answer.companyNameAsPrinted);
	return companies.filter((c) => normalizeCompanyName(c.displayName) === wanted);
}

/** The button that saves "what is it?": only the kinds Maester reads promise a read. */
export function kindSaveLabel(kind: ChosenKind | null): string {
	return kind === 'other' ? copy.kind.saveKept : copy.kind.save;
}

/** "14:02" for today, "2 Oct, 14:02" before that, in the reader's time zone. */
export function addedAt(iso: string, now: Date = new Date(), timeZone?: string): string {
	const date = new Date(iso);
	const day = (d: Date) =>
		new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone }).format(d);
	const time = new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(date);
	if (day(date) === day(now)) return time;
	const dayMonth = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		timeZone
	}).format(date);
	return `${dayMonth}, ${time}`;
}

export interface Failure {
	message: string;
	/** The answers moved on elsewhere: load the latest and show them. */
	reload: boolean;
}

/** What to say when a change to the answers was refused, and whether to load the latest. */
export function changeFailure(error: unknown): Failure {
	const said = copy.changeFailed;
	if (!(error instanceof ApiError)) return { message: said.other, reload: false };
	switch (error.code) {
		case 'CONFLICT':
			if (error.names('company.new')) return { message: said.companyClash, reload: false };
			return error.names('basedOn')
				? { message: said.changed, reload: true }
				: { message: said.moved, reload: true };
		case 'INVALID_STATE':
		case 'NOT_FOUND':
			return { message: said.moved, reload: true };
		case 'VALIDATION_FAILED':
			return {
				message: error.message === 'nothing changed' ? said.nothing : said.invalid,
				reload: false
			};
		case 'UNAUTHENTICATED':
			return { message: said.signedOut, reload: false };
		case 'NETWORK':
			return { message: said.offline, reload: false };
		default:
			return { message: said.other, reload: false };
	}
}
