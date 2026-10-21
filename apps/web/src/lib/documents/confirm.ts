/**
 * The Documents page's "Not in your workspace yet" section (spec 2026-10-19 section 7; plan
 * Decisions 5 and 7): one row per printed company identity, its request and its words. Free of
 * Svelte. Counts of files and filings are counts, not figures.
 *
 * One match rule: the API names the workspace's companies each identity could be (`matches`, by
 * CIN, then BSE, NSE and ISIN, then name, as the confirm route checks them) and this module only
 * looks those ids up. A group bridged by an ISIN may span two BSE codes and then needs one confirm
 * per code (phase 4 open item); each such row is shown as the API groups it, never merged here.
 */
import { documentsContent } from '$lib/content/documents';
import { shortName } from '$lib/research/summary';
import { ApiError } from './client';
import { codesOf, heldCodes } from './filings';
import { BSE, CIN, ISIN, NSE, type Failure } from './intake';
import type {
	Company,
	ConfirmCompanyRequest,
	ConfirmCompanyResponse,
	FilingFile,
	HeldIdentity
} from './types';

const copy = documentsContent;
const c = copy.confirm;
const sep = copy.titles.separator;

/** How many companies the section lists until "Show all". */
export const CONFIRM_SHOWN = 4;

export interface ConfirmRow {
	identity: HeldIdentity;
	/** The printed name, or the codes when it prints none. */
	title: string;
	/** "BSE 532999 · NSE COASTBANK · ISIN INE999Z01011 · CIN …", each part only when set. */
	codes: string;
	/** "9 filings · 26 files". */
	counts: string;
	/** "Add Coastline Bank", or "Add this company" with no name. */
	addLabel: string;
	/** `pick` when companies already added match what is printed. */
	mode: 'add' | 'pick';
	/** True on the first row only: the screen's one primary action. */
	primary: boolean;
	matches: Company[];
}

function rowOf(identity: HeldIdentity, companies: Company[], primary: boolean): ConfirmRow {
	const matches = identity.matches.flatMap((id) => companies.find((co) => co.id === id) ?? []);
	const printed = [codesOf(identity), identity.cin ? copy.company.printed('CIN', identity.cin) : '']
		.filter((part) => part !== '')
		.join(sep);
	return {
		identity,
		title: identity.nameAsPrinted ?? (heldCodes(identity) || copy.questions.someCompany),
		codes: printed,
		counts: [copy.titles.filings(identity.filings), copy.titles.files(identity.files)].join(sep),
		addLabel: identity.nameAsPrinted ? c.add(shortName(identity.nameAsPrinted)) : c.addUnnamed,
		mode: matches.length > 0 ? 'pick' : 'add',
		primary,
		matches
	};
}

/** The rows to show (four, or all once expanded) and how many are left out. */
export function confirmRows(
	held: HeldIdentity[],
	companies: Company[],
	expanded: boolean
): { rows: ConfirmRow[]; more: number } {
	const shown = expanded ? held : held.slice(0, CONFIRM_SHOWN);
	return {
		rows: shown.map((identity, i) => rowOf(identity, companies, i === 0)),
		more: held.length - shown.length
	};
}

/**
 * The rows to draw. Until the companies read has settled, a row cannot know whether it matches
 * one of them (it reads as an add), so none is drawn.
 */
export function rowsToDraw(rows: ConfirmRow[], companiesLoaded: boolean): ConfirmRow[] {
	return companiesLoaded ? rows : [];
}

/**
 * Whether an unnamed file's "Say which company" is the screen's filled button: only the first
 * one, only while there are no confirm rows, and only while its form is closed (an open form
 * holds the filled button instead).
 */
export function openerFilled(at: { rows: number; index: number; open: boolean }): boolean {
	return at.rows === 0 && at.index === 0 && !at.open;
}

/** "31 companies. Their 214 files wait until you confirm each company, once." */
export function sectionLede(held: HeldIdentity[]): string {
	return c.lede(
		held.length,
		held.reduce((sum, h) => sum + h.files, 0)
	);
}

/**
 * The confirm request: only the identifiers that pass the API's checks go (a malformed one would
 * refuse the whole request), and a new company carries them too.
 */
export function confirmRequest(
	identity: HeldIdentity,
	choice: { id: string } | { name: string }
): ConfirmCompanyRequest {
	const codes = {
		...(identity.cin && CIN.test(identity.cin) ? { cin: identity.cin } : {}),
		...(identity.bseCode && BSE.test(identity.bseCode) ? { bseCode: identity.bseCode } : {}),
		...(identity.isin && ISIN.test(identity.isin) ? { isin: identity.isin } : {}),
		...(identity.nseSymbol && NSE.test(identity.nseSymbol) ? { nseSymbol: identity.nseSymbol } : {})
	};
	return {
		identity: codes,
		company:
			'id' in choice
				? { id: choice.id }
				: { new: { displayName: choice.name.trim(), country: 'IN', ...codes } }
	};
}

/** What is said once the investor's confirm lands. */
export function confirmedAloud(
	name: string,
	isNew: boolean,
	response: ConfirmCompanyResponse
): string {
	if (response.confirmed === 0) return c.nothingWaiting;
	return isNew ? c.added(name, response.confirmed) : c.confirmed(name, response.confirmed);
}

/** What to say when a confirm was refused; a clash reads the companies again to open the picker. */
export function confirmFailure(error: unknown): Failure {
	const said = copy.changeFailed;
	if (!(error instanceof ApiError)) return { message: said.other, reload: false };
	switch (error.code) {
		case 'CONFLICT':
			return { message: said.companyClash, reload: true };
		case 'UNAUTHENTICATED':
			return { message: said.signedOut, reload: false };
		case 'NETWORK':
			return { message: said.offline, reload: false };
		case 'VALIDATION_FAILED':
			return { message: said.invalid, reload: false };
		default:
			return { message: said.other, reload: false };
	}
}

/** The Notice of an unsorted file that needs its company said (action: "Say which company"). */
export function unnamedNotice(file: FilingFile): { title: string; detail: string } {
	return file.companyNameAsPrinted
		? {
				title: c.unnamedWithName(file.originalName, file.companyNameAsPrinted),
				detail: c.unnamedWithNameDetail
			}
		: { title: c.unnamedNoName(file.originalName), detail: c.unnamedNoNameDetail };
}
