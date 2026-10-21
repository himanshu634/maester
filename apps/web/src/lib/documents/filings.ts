/**
 * The Documents page's view model (spec 2026-10-19 sections 2 to 5 and 7; plan Decisions 5, 10,
 * 12, 17 and 20): the filings read turned into sections by company, each filing's title and
 * tracks, which filing is open and where it goes when its file moves, how a poll and a read merge,
 * and which questions are new. Free of Svelte and of the page: every function takes what it
 * reads. Counts of files and filings are counts, not figures; no figure value is read here.
 */
import { documentsContent } from '$lib/content/documents';
import { shortName } from '$lib/research/summary';
import { fyLabel } from '$lib/research/view';
import { addedAt as addedAtWords, whatItIs } from './intake';
import { dayWords } from './sources';
import {
	abandonedUpload,
	numbersTrack,
	textTrack,
	type TrackContext,
	type TrackWords
} from './tracks';
import type {
	ClassificationKind,
	Company,
	DocumentRecord,
	FilingFile,
	HeldIdentity,
	ReportingBasis,
	ResultsSpan,
	WorkspaceFiling,
	WorkspaceFilings
} from './types';

const copy = documentsContent;
const t = copy.titles;
const q = copy.questions;

/** One filing row: a company's filing, or an unsorted file standing as its own filing. */
export interface FilingView {
	/** The filing's key; `file:<documentId>` for an unsorted file. */
	key: string;
	companyId: string | null;
	title: string;
	files: FilingFile[];
	numbers: TrackWords;
	text: TrackWords;
	settled: boolean;
	addedAt: string;
	/** The filing as read; null for an unsorted file. */
	filing: WorkspaceFiling | null;
}

export interface CompanyGroup {
	/** Null for "Company not known yet". */
	companyId: string | null;
	name: string;
	/** "BSE 500999 · NSE SYNCEM · ISIN …"; empty when none is known. */
	codes: string;
	filings: FilingView[];
}

export interface PageView {
	/** Files that print no identifier and need their company said (spec section 7). */
	unnamed: FilingFile[];
	/** The read's held identities, unchanged. */
	held: HeldIdentity[];
	working: CompanyGroup[];
	done: CompanyGroup[];
	/** "4 filings · 7 files". */
	workingCount: string;
	/** "12 filings". */
	doneCount: string;
	empty: boolean;
}

/** The filing that is open, pinned to one of its documents (Decision 17). */
export interface Opened {
	key: string;
	documentId: string;
	/** That document's file name, kept so the page can name it once it leaves every filing. */
	name: string;
}

export type WaitingAbove =
	| { kind: 'held'; key: string; name: string }
	| { kind: 'unnamed'; documentId: string; name: string };

export interface Question {
	kind: 'company' | 'file';
	aloud: string;
}

/** How many filings of a company Done shows until "Show all". */
export const DONE_SHOWN = 3;

/** A filing's spans from the shortest. */
const SHORTEST_FIRST: ResultsSpan[] = ['quarter', 'half_year', 'nine_months', 'full_year'];
const BASIS_ORDER: ReportingBasis[] = ['consolidated', 'standalone', 'unknown'];
const TEXT_SETTLED = ['done', 'partial', 'failed'];
const NUMBERS_SETTLED = ['done', 'not_needed', 'not_read', 'failed'];

const time = (iso: string) => Date.parse(iso);

function sentenceCase(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The day an instant falls on in the reader's time zone, as "14 Aug 2026". */
function localDay(iso: string): string | null {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	const parts = new Intl.DateTimeFormat('en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '';
	return dayWords(`${part('year')}-${part('month')}-${part('day')}`);
}

/** A filing's title: "Results, quarter to 30 Sep 2026", "Annual report 2025–26", a file name. */
export function filingTitle(f: WorkspaceFiling, files: FilingFile[]): string {
	switch (f.kind) {
		case 'financial_results': {
			const day = dayWords(f.periodEnd);
			if (day === null) return t.resultsNoPeriod;
			const span = SHORTEST_FIRST.find((s) => f.spans.includes(s));
			return span ? t.results(copy.spans[span], day) : t.resultsNoSpan(day);
		}
		case 'annual_report': {
			const day = dayWords(f.periodEnd);
			if (f.periodEnd === null || day === null) return t.annualReportNoPeriod;
			return f.periodEnd.slice(5, 10) === '03-31'
				? t.annualReport(fyLabel(f.periodEnd))
				: t.annualReportYearTo(day);
		}
		case 'other': {
			const type = whatItIs({ kind: 'other', otherType: f.otherType, resultsSpan: null });
			const day = dayWords(f.periodEnd) ?? localDay(f.addedAt);
			return day === null ? type : t.other(type, day);
		}
		case 'not_sure':
			return files[0]?.originalName ?? copy.kinds.not_sure;
	}
}

/**
 * The opened filing's heading: "Synthetic Cements · results, quarter to 30 Sep 2026". A file name
 * keeps its case; with no company, the title alone.
 */
export function filingHeading(
	name: string | null,
	title: string,
	kind: ClassificationKind | null
): string {
	if (name === null) return title;
	const fileName = kind === null || kind === 'not_sure';
	return t.heading(name, fileName ? title : lowerFirst(title));
}

/** "Consolidated and standalone · 3 files · added 14:02"; no bases part when no file states one. */
export function filingMeta(view: FilingView, now: Date = new Date(), timeZone?: string): string {
	const bases = BASIS_ORDER.filter((b) => view.files.some((f) => f.basis === b)).map(
		(b) => copy.bases[b]
	);
	return [
		bases.length > 0 ? sentenceCase(t.bases(bases)) : null,
		t.files(view.files.length),
		t.added(addedAtWords(view.addedAt, now, timeZone))
	]
		.filter((part) => part !== null)
		.join(t.separator);
}

/** "XBRL · 500999_Q2_FY27_Consolidated.xml", with " · Added twice" for a file added again. */
export function fileLine(file: FilingFile): string {
	const line = `${t.format[file.format]}${t.separator}${file.originalName}`;
	const copies = file.duplicates.length;
	return copies > 0 ? `${line}${t.separator}${t.addedTimes(copies + 1)}` : line;
}

export function codesOf(x: Pick<Company, 'bseCode' | 'nseSymbol' | 'isin'>): string {
	const found: [string, string | null][] = [
		['BSE', x.bseCode],
		['NSE', x.nseSymbol],
		['ISIN', x.isin]
	];
	return found
		.flatMap(([label, value]) => (value ? [copy.company.printed(label, value)] : []))
		.join(t.separator);
}

/** A held identity by its codes, the CIN only when it prints no other. */
export function heldCodes(h: HeldIdentity): string {
	const codes = codesOf(h);
	if (codes !== '') return codes;
	return h.cin ? copy.company.printed('CIN', h.cin) : '';
}

function companyFiling(companyId: string, filing: WorkspaceFiling, ctx: TrackContext): FilingView {
	return {
		key: filing.key,
		companyId,
		title: filingTitle(filing, filing.files),
		files: filing.files,
		numbers: numbersTrack(filing.files, filing.sources, ctx),
		text: textTrack(filing.files, ctx),
		settled: filing.settled,
		addedAt: filing.addedAt,
		filing
	};
}

function unsortedFiling(file: FilingFile, ctx: TrackContext): FilingView {
	return {
		key: `file:${file.documentId}`,
		companyId: null,
		title: file.originalName,
		files: [file],
		numbers: numbersTrack([file], [], ctx),
		text: textTrack([file], ctx),
		settled: unsortedSettled(file, ctx),
		addedAt: file.createdAt,
		filing: null
	};
}

/**
 * Whether nothing more can happen to an unsorted file without the investor (Decision 5). Phase 4's
 * `settled` needs `identified` done, so it would leave a file whose identification stopped in
 * Working on for ever; this is the unsorted rule, the first that applies winning.
 */
export function unsortedSettled(file: FilingFile, ctx: TrackContext): boolean {
	const p = file.pipeline;
	if (file.state === 'rejected' || abandonedUpload(file, ctx) || p.stored === 'failed') return true;
	if (ctx.uploading(file.documentId) || p.stored === 'now' || p.identified === 'now') return false;
	// A kept file still indexing stays in Working on, where it is watched.
	if (!TEXT_SETTLED.includes(p.text.state)) return false;
	if (p.identified === 'failed') return true;
	return p.identified === 'done' && NUMBERS_SETTLED.includes(p.numbers.state);
}

function countFilings(groups: CompanyGroup[]): number {
	return groups.reduce((total, g) => total + g.filings.length, 0);
}

function countFiles(groups: CompanyGroup[]): number {
	return groups.reduce((total, g) => total + g.filings.reduce((n, f) => n + f.files.length, 0), 0);
}

/**
 * The page's sections. Company filings go by the server's `settled` and keep the server's order
 * (newest period first), never sorted again; unsorted files go by `unsortedSettled`, newest first,
 * in "Company not known yet", which comes last. A `needs_company` unsorted file goes to `unnamed`.
 */
export function buildView(read: WorkspaceFilings, ctx: TrackContext): PageView {
	const working: CompanyGroup[] = [];
	const done: CompanyGroup[] = [];
	for (const { company, filings } of read.companies) {
		const views = filings.map((filing) => companyFiling(company.id, filing, ctx));
		const group = { companyId: company.id, name: company.displayName, codes: codesOf(company) };
		const workingViews = views.filter((v) => !v.settled);
		const doneViews = views.filter((v) => v.settled);
		if (workingViews.length > 0) working.push({ ...group, filings: workingViews });
		if (doneViews.length > 0) done.push({ ...group, filings: doneViews });
	}

	const loose = [...read.unsorted].sort((a, b) => time(b.createdAt) - time(a.createdAt));
	const unnamed = loose.filter((f) => f.intakeState === 'needs_company');
	const looseViews = loose
		.filter((f) => f.intakeState !== 'needs_company')
		.map((f) => unsortedFiling(f, ctx));
	const unknown = { companyId: null, name: copy.sections.unknownCompany, codes: '' };
	const looseWorking = looseViews.filter((v) => !v.settled);
	const looseDone = looseViews.filter((v) => v.settled);
	if (looseWorking.length > 0) working.push({ ...unknown, filings: looseWorking });
	if (looseDone.length > 0) done.push({ ...unknown, filings: looseDone });

	return {
		unnamed,
		held: read.held,
		working,
		done,
		workingCount: `${t.filings(countFilings(working))}${t.separator}${t.files(countFiles(working))}`,
		doneCount: t.filings(countFilings(done)),
		empty:
			working.length === 0 && done.length === 0 && unnamed.length === 0 && read.held.length === 0
	};
}

const stopped = (f: FilingView) => f.numbers.state === 'stopped' || f.text.state === 'stopped';

/** Done's filings of a company: the newest three, or all of them once expanded. */
export function shownFilings(
	group: CompanyGroup,
	expanded: boolean
): { shown: FilingView[]; hidden: number; hiddenStopped: number } {
	const shown = expanded ? group.filings : group.filings.slice(0, DONE_SHOWN);
	const rest = group.filings.slice(shown.length);
	return { shown, hidden: rest.length, hiddenStopped: rest.filter(stopped).length };
}

/** "Show all 9 filings of Synthetic Cements · 1 stopped", or "Show the newest 3" (Decision 20). */
export function showAllLabel(group: CompanyGroup, expanded: boolean): string {
	if (expanded) return t.showNewest(DONE_SHOWN);
	const { hiddenStopped } = shownFilings(group, false);
	const label = t.showAll(group.filings.length, group.name);
	return hiddenStopped > 0 ? `${label}${t.hiddenStopped(hiddenStopped)}` : label;
}

function allFilings(view: PageView): FilingView[] {
	return [...view.working, ...view.done].flatMap((g) => g.filings);
}

/** Whether a filing lists the document, as a file or as a duplicate of one (spec section 3). */
function holds(filing: FilingView, documentId: string): boolean {
	return filing.files.some((f) => f.documentId === documentId || f.duplicates.includes(documentId));
}

function newest(groups: CompanyGroup[]): FilingView | null {
	let found: FilingView | null = null;
	for (const filing of groups.flatMap((g) => g.filings)) {
		if (found === null || time(filing.addedAt) > time(found.addedAt)) found = filing;
	}
	return found;
}

/**
 * The opened document waits under "Not in your workspace yet": held for its company, or a file
 * that prints no identifier. Null when it is not there.
 */
export function waitingAbove(view: PageView, opened: Opened | null): WaitingAbove | null {
	if (opened === null) return null;
	const held = view.held.find((h) => h.documentIds.includes(opened.documentId));
	if (held) return { kind: 'held', key: held.key, name: opened.name };
	if (view.unnamed.some((f) => f.documentId === opened.documentId)) {
		return { kind: 'unnamed', documentId: opened.documentId, name: opened.name };
	}
	return null;
}

/**
 * The filing to show: the opened key; else the filing that now holds the opened document; else
 * none while that document waits above; else the newest in Working on, then the newest in Done.
 */
export function pickFiling(view: PageView, opened: Opened | null): FilingView | null {
	if (opened !== null) {
		const filings = allFilings(view);
		const byKey = filings.find((f) => f.key === opened.key);
		if (byKey) return byKey;
		const holder = filings.find((f) => holds(f, opened.documentId));
		if (holder) return holder;
		if (waitingAbove(view, opened) !== null) return null;
	}
	return newest(view.working) ?? newest(view.done);
}

/**
 * What stays open after a read: the opened document's place while it waits above, else the filing
 * `pickFiling` finds, pinned to the opened document while it still holds it, else to its first
 * file. The same object comes back when nothing changed, so a re-pin is not a change.
 */
export function pin(view: PageView, opened: Opened | null): Opened | null {
	if (waitingAbove(view, opened) !== null) return opened;
	const found = pickFiling(view, opened);
	if (found === null) return null;
	let next: Opened;
	if (opened !== null && holds(found, opened.documentId)) {
		next = { key: found.key, documentId: opened.documentId, name: opened.name };
	} else {
		const [first] = found.files;
		if (first === undefined) return opened;
		next = { key: found.key, documentId: first.documentId, name: first.originalName };
	}
	const same =
		opened !== null &&
		opened.key === next.key &&
		opened.documentId === next.documentId &&
		opened.name === next.name;
	return same ? opened : next;
}

/** The filing that holds `documentId` now, after the investor's own Change; null when none does. */
export function follow(view: PageView, documentId: string): Opened | null {
	const holder = allFilings(view).find((f) => holds(f, documentId));
	if (!holder) return null;
	const file =
		holder.files.find((f) => f.documentId === documentId) ??
		holder.files.find((f) => f.duplicates.includes(documentId));
	return { key: holder.key, documentId, name: file?.originalName ?? holder.title };
}

/**
 * Whether a polled document changed where it belongs: identified, held, made a duplicate, kept or
 * read. The page then reads the filings once (Decision 12).
 */
export function shapeChanged(
	before: FilingFile,
	after: Pick<DocumentRecord, 'state' | 'intakeState' | 'pipeline'>
): boolean {
	return (
		before.state !== after.state ||
		before.intakeState !== after.intakeState ||
		before.pipeline.identified !== after.pipeline.identified
	);
}

/** The opened filing's stored files whose answers are not loaded, or changed, in file order. */
export function answersWanted(
	filing: FilingView | null,
	answers: Readonly<Record<string, unknown>>,
	changed: ReadonlySet<string>
): string[] {
	if (filing === null) return [];
	return filing.files
		.filter(
			(f) => f.state === 'stored' && (!(f.documentId in answers) || changed.has(f.documentId))
		)
		.map((f) => f.documentId);
}

function filesOf(read: WorkspaceFilings): FilingFile[] {
	return [...read.companies.flatMap((c) => c.filings.flatMap((f) => f.files)), ...read.unsorted];
}

/** Any file still being checked or identified, an abandoned upload left out (Decision 10). */
export function identifying(read: WorkspaceFilings, ctx: TrackContext): boolean {
	return filesOf(read).some(
		(f) =>
			!abandonedUpload(f, ctx) && (f.pipeline.stored === 'now' || f.pipeline.identified === 'now')
	);
}

const liveTrack = (track: TrackWords) =>
	track.state === 'now' || (track.state === 'next' && track.first !== copy.tracks.none);

/** A track is working or in line, or the filing holds a file this page is sending. */
export function filingLive(view: FilingView, ctx: TrackContext): boolean {
	return (
		liveTrack(view.numbers) ||
		liveTrack(view.text) ||
		view.files.some((f) => ctx.uploading(f.documentId))
	);
}

/** Whether the filings read is polled: a live Working on filing other than the opened one. */
export function listWatched(view: PageView, openedKey: string | null, ctx: TrackContext): boolean {
	return view.working.some((g) => g.filings.some((f) => f.key !== openedKey && filingLive(f, ctx)));
}

/**
 * `read` with each file `replace` gives a new copy for swapped, wherever it sits; the parts not
 * touched are the same objects, and `read` itself comes back when nothing is.
 */
function replaceFiles(
	read: WorkspaceFilings,
	replace: (file: FilingFile) => FilingFile | null
): WorkspaceFilings {
	const swapList = (files: FilingFile[]): FilingFile[] => {
		let hit = false;
		const out = files.map((f) => {
			const next = replace(f);
			if (next === null) return f;
			hit = true;
			return next;
		});
		return hit ? out : files;
	};
	let touched = false;
	const companies = read.companies.map((entry) => {
		let entryTouched = false;
		const filings = entry.filings.map((filing) => {
			const files = swapList(filing.files);
			if (files === filing.files) return filing;
			entryTouched = true;
			return { ...filing, files };
		});
		if (!entryTouched) return entry;
		touched = true;
		return { ...entry, filings };
	});
	const unsorted = swapList(read.unsorted);
	if (!touched && unsorted === read.unsorted) return read;
	return { ...read, companies: touched ? companies : read.companies, unsorted };
}

/**
 * A polled document's state, intake state, pipeline and printed name, written into its file
 * wherever it sits. It never moves a file between filings; `shapeChanged` asks for the read that
 * does. The same read comes back when no file matches.
 */
export function applyDocument(read: WorkspaceFilings, doc: DocumentRecord): WorkspaceFilings {
	return replaceFiles(read, (f) =>
		f.documentId === doc.id
			? {
					...f,
					pipeline: doc.pipeline,
					intakeState: doc.intakeState,
					state: doc.state,
					rejectionCode: doc.rejectionCode,
					companyNameAsPrinted: doc.classification?.companyNameAsPrinted ?? null
				}
			: null
	);
}

/** A document this page is sending, as an unsorted file: added, or written in where it is. */
export function withUpload(read: WorkspaceFilings, doc: DocumentRecord): WorkspaceFilings {
	if (filesOf(read).some((f) => f.documentId === doc.id)) return applyDocument(read, doc);
	const file: FilingFile = {
		documentId: doc.id,
		originalName: doc.originalName,
		format: doc.format,
		basis: null,
		createdAt: doc.createdAt,
		state: doc.state,
		rejectionCode: doc.rejectionCode,
		intakeState: doc.intakeState,
		companyNameAsPrinted: doc.classification?.companyNameAsPrinted ?? null,
		duplicates: [],
		pipeline: doc.pipeline
	};
	return { ...read, unsorted: [file, ...read.unsorted] };
}

/**
 * `next`, with `current`'s copies of the files `ids` names: those the open filing's own poll wrote
 * after `next` was asked for, so a read that lands late never puts a file back to an older state.
 */
export function keepFresher(
	current: WorkspaceFilings,
	next: WorkspaceFilings,
	ids: readonly string[]
): WorkspaceFilings {
	if (ids.length === 0) return next;
	const wanted = new Set(ids);
	const fresh = new Map(
		filesOf(current)
			.filter((f) => wanted.has(f.documentId))
			.map((f) => [f.documentId, f])
	);
	return replaceFiles(next, (f) => fresh.get(f.documentId) ?? null);
}

/** Every question the read asks the investor, by a key that stays the same while it is asked. */
export function questionKeys(read: WorkspaceFilings): Map<string, Question> {
	const keys = new Map<string, Question>();
	for (const h of read.held) {
		const who = h.nameAsPrinted ? shortName(h.nameAsPrinted) : heldCodes(h) || q.someCompany;
		keys.set(`held:${h.key}`, { kind: 'company', aloud: q.confirmCompany(who) });
	}
	for (const f of read.unsorted) {
		if (f.intakeState !== 'needs_company') continue;
		keys.set(`doc:${f.documentId}`, {
			kind: 'file',
			aloud: f.companyNameAsPrinted
				? q.isThis(f.originalName, f.companyNameAsPrinted)
				: q.whichCompany(f.originalName)
		});
	}
	for (const f of filesOf(read)) {
		if (f.intakeState === 'needs_kind') {
			keys.set(`doc:${f.documentId}`, { kind: 'file', aloud: q.whatIsIt(f.originalName) });
		}
	}
	return keys;
}

/**
 * The questions not said before: one by name, several as one count ("31 companies and 2 files
 * need you."), none as null. `seen` keeps every key said, so none is said twice.
 */
export function newQuestions(
	seen: ReadonlySet<string>,
	read: WorkspaceFilings
): { aloud: string | null; seen: Set<string> } {
	const keys = questionKeys(read);
	const fresh = [...keys].filter(([key]) => !seen.has(key)).map(([, question]) => question);
	const nextSeen = new Set([...seen, ...keys.keys()]);
	if (fresh.length === 0) return { aloud: null, seen: nextSeen };
	if (fresh.length === 1) return { aloud: fresh[0].aloud, seen: nextSeen };
	const companies = fresh.filter((x) => x.kind === 'company').length;
	const files = fresh.length - companies;
	const parts = [
		companies > 0 ? q.companies(companies) : null,
		files > 0 ? q.files(files) : null
	].filter((part) => part !== null);
	return { aloud: q.many(parts), seen: nextSeen };
}
