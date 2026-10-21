/**
 * Adding several files at once, kept free of Svelte so it can be tested: what was chosen (files,
 * a folder, or a drop of either), which files can go and why the rest cannot, sending the rest a
 * few at a time through the upload flow, and what the drop strip says about a batch.
 *
 * A file is a PDF (.pdf) or an XBRL instance (.xml); the server checks the XML is XBRL.
 */
import { documentsContent as copy } from '$lib/content/documents';
import { ApiError } from './client';
import { MAX_UPLOAD_BYTES } from './intake';

/** How many files are sent at once. */
export const SEND_AT_ONCE = 4;

/** A chosen file and where it sat: "bse-xbrl/2025/ar.pdf" from a folder, "ar.pdf" otherwise. */
export interface Picked {
	file: File;
	path: string;
}

/** A file that was not added, by name, and why, in the words the page shows. */
export interface Refusal {
	name: string;
	reason: string;
}

/** Why a batch stopped before every file was tried: the rest would fail the same way. */
export type Stop = 'signed-out' | 'offline';

/** A batch once every file in it is settled. */
export interface Outcome {
	/** Files chosen, not counting system files a folder carries. */
	total: number;
	/** The folder they came from, when they all came from one. */
	folder: string | null;
	sent: number;
	/** Files refused in the browser or by the API, each by name. */
	refused: Refusal[];
	/** Files never tried because the batch stopped. */
	unsent: number;
	stopped: Stop | null;
}

// --- What was chosen ------------------------------------------------------------------------

/** Files a folder carries that nobody chose: Finder's and Explorer's own. */
const SYSTEM_FILE = /^(\..*|thumbs\.db|desktop\.ini|icon\r)$/i;

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Files from a picker: `webkitRelativePath` is set for a folder pick and empty otherwise.
 * System files inside a folder are left out, so a folder of PDFs is not "1 file wasn't added".
 */
export function pickedFrom(files: Iterable<File>): Picked[] {
	return keepChosen(
		Array.from(files, (file) => ({ file, path: file.webkitRelativePath || file.name }))
	);
}

function keepChosen(picked: Picked[]): Picked[] {
	return picked.filter(({ path }) => !path.includes('/') || !SYSTEM_FILE.test(baseName(path)));
}

/** The one folder every file came from, or null. */
export function folderOf(picked: Picked[]): string | null {
	if (picked.length === 0) return null;
	const first = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : null);
	const folder = first(picked[0].path);
	return folder && picked.every(({ path }) => first(path) === folder) ? folder : null;
}

/** The name the page shows: the path inside the folder, so two "ar.pdf" can be told apart. */
export function shownName(item: Picked, folder: string | null): string {
	return folder ? item.path.slice(folder.length + 1) : item.path;
}

/** The parts of the File and Directory Entries API a drop uses; real entries satisfy it. */
export interface DropEntry {
	isFile: boolean;
	isDirectory: boolean;
	fullPath: string;
	file?(success: (file: File) => void, failure?: (error: unknown) => void): void;
	createReader?(): {
		readEntries(success: (entries: DropEntry[]) => void, failure?: (error: unknown) => void): void;
	};
}

/**
 * Every file under what was dropped, folders walked all the way down. The entries must be taken
 * from the drop event before it returns; walking them may take as long as it needs.
 */
export async function walkEntries(entries: DropEntry[]): Promise<Picked[]> {
	const picked: Picked[] = [];
	async function walk(entry: DropEntry) {
		if (entry.isFile && entry.file) {
			const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
			picked.push({ file, path: entry.fullPath.replace(/^\//, '') });
		} else if (entry.isDirectory && entry.createReader) {
			const reader = entry.createReader();
			// A reader hands over a folder in pieces (about 100 at a time) until it hands over none.
			for (;;) {
				const some = await new Promise<DropEntry[]>((resolve, reject) =>
					reader.readEntries(resolve, reject)
				);
				if (some.length === 0) break;
				for (const child of some) await walk(child);
			}
		}
	}
	for (const entry of entries) await walk(entry);
	return keepChosen(picked);
}

// --- Checked in the browser -----------------------------------------------------------------

const MIB = 1024 * 1024;

/** "62 MB", or "50.1 MB" when rounding would hide that it is over the limit. */
export function megabytes(size: number): string {
	const whole = Math.round(size / MIB);
	if (whole * MIB > MAX_UPLOAD_BYTES) return `${whole} MB`;
	return `${(Math.ceil((size / MIB) * 10) / 10).toFixed(1)} MB`;
}

const FILE_KINDS: [RegExp, keyof typeof copy.refusals.kinds][] = [
	[/\.(docx?|odt|rtf|pages)$/i, 'word'],
	[/\.(xlsx?|ods|csv|numbers)$/i, 'spreadsheet'],
	[/\.(pptx?|odp|key)$/i, 'presentation'],
	[/\.(jpe?g|png|gif|heic|heif|tiff?|webp|bmp)$/i, 'picture']
];

/**
 * Why a file cannot go, from its name, type and size, or null when it may. A PDF is a .pdf whose
 * type is PDF (or that the browser left untyped); an XBRL instance is a .xml whose type is XML
 * (or untyped). The first bytes are checked by `screen`.
 */
export function checkFile(file: { name: string; size: number; type: string }): string | null {
	const said = copy.refusals;
	const pdfName = /\.pdf$/i.test(file.name);
	const pdfType = file.type === 'application/pdf' || file.type === '';
	const xmlName = /\.xml$/i.test(file.name);
	const xmlType = ['application/xml', 'text/xml', ''].includes(file.type);
	if (!(pdfName && pdfType) && !(xmlName && xmlType)) {
		const known = FILE_KINDS.find(([pattern]) => pattern.test(file.name));
		return known ? said.notPdfKnown(said.kinds[known[1]]) : said.notPdf;
	}
	if (file.size === 0) return said.empty;
	if (file.size > MAX_UPLOAD_BYTES) return said.tooLarge(megabytes(file.size));
	return null;
}

/** How far into a file a PDF's "%PDF-" header may start. */
export const HEAD_BYTES = 1024;

/** True when the first bytes hold a PDF header. */
export function looksLikePdf(head: Uint8Array): boolean {
	const text = String.fromCharCode(...head.subarray(0, HEAD_BYTES));
	return text.includes('%PDF-');
}

/**
 * True when the first bytes, after an optional byte order mark and whitespace, start with "<".
 * Decoded as UTF-8, so a UTF-8 mark is skipped; a UTF-16 file has NULs between its characters,
 * is not found here, and is refused.
 */
export function looksLikeXml(head: Uint8Array): boolean {
	const text = new TextDecoder('utf-8').decode(head.subarray(0, HEAD_BYTES));
	return /^\uFEFF?\s*</.test(text);
}

/** Reads a file's first bytes. */
export type HeadReader = (file: File) => Promise<Uint8Array>;

export const readHead: HeadReader = async (file) =>
	new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());

/** The files that may go, and the rest by name with why. A refused file is never sent. */
export async function screen(
	picked: Picked[],
	folder: string | null,
	read: HeadReader = readHead
): Promise<{ accepted: Picked[]; refused: Refusal[] }> {
	const accepted: Picked[] = [];
	const refused: Refusal[] = [];
	for (const item of picked) {
		let reason = checkFile(item.file);
		if (!reason) {
			try {
				const head = await read(item.file);
				if (/\.xml$/i.test(item.file.name)) {
					if (!looksLikeXml(head)) reason = copy.refusals.notXmlInside;
				} else if (!looksLikePdf(head)) reason = copy.refusals.notPdfInside;
			} catch {
				reason = copy.refusals.unreadable;
			}
		}
		if (reason) refused.push({ name: shownName(item, folder), reason });
		else accepted.push(item);
	}
	return { accepted, refused };
}

// --- Sending --------------------------------------------------------------------------------

/** Why the API did not take a file, in the same words as the browser's checks. */
export function sendFailure(
	error: unknown,
	file: { size: number }
): { reason: string; stop: Stop | null } {
	const said = copy.refusals;
	if (error instanceof ApiError) {
		switch (error.code) {
			case 'UPLOAD_TOO_LARGE':
				return { reason: said.tooLarge(megabytes(file.size)), stop: null };
			case 'UNSUPPORTED_MEDIA_TYPE':
				return { reason: said.notPdf, stop: null };
			case 'UNAUTHENTICATED':
				return { reason: said.signedOut, stop: 'signed-out' };
			case 'NETWORK':
				return { reason: said.offline, stop: 'offline' };
		}
	}
	return { reason: said.unfinished, stop: null };
}

/**
 * Send the accepted files, `SEND_AT_ONCE` at a time, each through `send`, and say after each
 * one how many are settled. Every XBRL instance goes before any PDF, each kind in the order
 * chosen, so a results PDF whose instances are already in is not given to a paid read. A
 * refusal that would refuse the rest too (signed out, offline) stops the batch: files already
 * started finish, nothing new starts.
 */
export async function sendAll(
	accepted: Picked[],
	folder: string | null,
	send: (item: Picked) => Promise<unknown>,
	onSettled: (settled: number) => void = () => {}
): Promise<Pick<Outcome, 'sent' | 'refused' | 'unsent' | 'stopped'>> {
	let next = 0;
	let settled = 0;
	let sent = 0;
	let stopped: Stop | null = null;
	const refused: { at: number; refusal: Refusal }[] = [];
	// The order sent, as positions in the order chosen: what is reported stays in the order chosen.
	const positions = accepted.map((_, at) => at);
	const isXml = (at: number) => /\.xml$/i.test(accepted[at].file.name);
	const queue = [...positions.filter(isXml), ...positions.filter((at) => !isXml(at))];

	async function lane() {
		while (!stopped && next < queue.length) {
			const at = queue[next++];
			const item = accepted[at];
			try {
				await send(item);
				sent += 1;
			} catch (error) {
				const failure = sendFailure(error, item.file);
				refused.push({ at, refusal: { name: shownName(item, folder), reason: failure.reason } });
				stopped ??= failure.stop;
			}
			settled += 1;
			onSettled(settled);
		}
	}

	await Promise.all(Array.from({ length: Math.min(SEND_AT_ONCE, accepted.length) }, lane));
	return {
		sent,
		// In the order the files were chosen, not the order they failed in.
		refused: refused.sort((a, b) => a.at - b.at).map(({ refusal }) => refusal),
		unsent: accepted.length - settled,
		stopped
	};
}

// --- What the strip says --------------------------------------------------------------------

/** The line in the box while files are sent: the file being sent counts as one of them. */
export function sendingLine(settled: number, accepted: Picked[], folder: string | null): string {
	if (accepted.length === 1) return copy.drop.sendingOne(shownName(accepted[0], folder));
	return copy.drop.sending(Math.min(settled + 1, accepted.length), accepted.length, folder);
}

/** Said once when a batch starts. */
export function startAloud(accepted: Picked[], folder: string | null): string {
	return accepted.length === 1
		? copy.drop.sendingOneAloud(shownName(accepted[0], folder))
		: copy.drop.sendingAloud(accepted.length);
}

/** How many files were not added: refused, plus those never tried. */
export const notAdded = (outcome: Outcome) => outcome.refused.length + outcome.unsent;

/** The line left in the box once a batch is done, or null when nothing was sent. */
export function sentLine(outcome: Outcome): string | null {
	return outcome.sent > 0 ? copy.drop.sent(outcome.sent, outcome.folder) : null;
}

/** Said once when a batch ends: what was sent and how many were not added. */
export function endAloud(outcome: Outcome): string {
	const missed = notAdded(outcome);
	if (outcome.sent === 0) return refusedTitle(outcome);
	const sent = copy.drop.sent(outcome.sent, null);
	return missed === 0 ? sent : `${sent} ${copy.drop.notAddedAloud(missed)}`;
}

/** The refusal Notice's first line: "3 of the 806 files weren’t added." */
export function refusedTitle(outcome: Outcome): string {
	return copy.drop.refusedTitle(notAdded(outcome), outcome.total);
}
