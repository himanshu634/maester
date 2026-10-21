import { describe, expect, it } from 'vitest';
import {
	checkFile,
	endAloud,
	folderOf,
	looksLikePdf,
	looksLikeXml,
	pickedFrom,
	refusedTitle,
	screen,
	SEND_AT_ONCE,
	sendAll,
	sendFailure,
	sendingLine,
	sentLine,
	shownName,
	startAloud,
	walkEntries,
	type DropEntry,
	type Outcome,
	type Picked
} from './batch';
import { ApiError } from './client';
import { MAX_UPLOAD_BYTES } from './intake';

const PDF_HEAD = new TextEncoder().encode('%PDF-1.7\n');

function file(name: string, size = 1000, type = 'application/pdf', relative = ''): File {
	const made = new File([], name, { type });
	Object.defineProperty(made, 'size', { value: size });
	Object.defineProperty(made, 'webkitRelativePath', { value: relative });
	return made;
}

const pick = (path: string, size = 1000, type = 'application/pdf'): Picked => ({
	file: file(path.slice(path.lastIndexOf('/') + 1), size, type),
	path
});

function outcome(over: Partial<Outcome> = {}): Outcome {
	return { total: 12, folder: null, sent: 12, refused: [], unsent: 0, stopped: null, ...over };
}

/** A promise settled from outside, so a test decides when each upload finishes. */
function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('pickedFrom and folderOf', () => {
	it('keeps each file’s place in the folder, and leaves out the folder’s system files', () => {
		const picked = pickedFrom([
			file('ar.pdf', 10, 'application/pdf', 'bse/2025/ar.pdf'),
			file('.DS_Store', 10, '', 'bse/.DS_Store'),
			file('Thumbs.db', 10, '', 'bse/2025/Thumbs.db'),
			file('q2.pdf', 10, 'application/pdf', 'bse/q2.pdf')
		]);
		expect(picked.map((item) => item.path)).toEqual(['bse/2025/ar.pdf', 'bse/q2.pdf']);
		expect(folderOf(picked)).toBe('bse');
		expect(shownName(picked[0], 'bse')).toBe('2025/ar.pdf');
	});

	it('names no folder for loose files or files from two folders', () => {
		expect(folderOf(pickedFrom([file('a.pdf'), file('b.pdf')]))).toBeNull();
		expect(folderOf([pick('one/a.pdf'), pick('two/b.pdf')])).toBeNull();
		expect(folderOf([pick('one/a.pdf'), pick('b.pdf')])).toBeNull();
		expect(folderOf([])).toBeNull();
	});

	it('keeps a loose file whatever its name', () => {
		expect(pickedFrom([file('.hidden.pdf')])).toHaveLength(1);
	});
});

describe('walkEntries', () => {
	const fileEntry = (fullPath: string): DropEntry => ({
		isFile: true,
		isDirectory: false,
		fullPath,
		file: (success) => success(file(fullPath.slice(fullPath.lastIndexOf('/') + 1)))
	});
	/** A folder whose reader hands over its children in pieces of `piece`, then none. */
	const folderEntry = (fullPath: string, children: DropEntry[], piece = 2): DropEntry => ({
		isFile: false,
		isDirectory: true,
		fullPath,
		createReader: () => {
			let at = 0;
			return {
				readEntries: (success) => {
					success(children.slice(at, at + piece));
					at += piece;
				}
			};
		}
	});

	it('walks a dropped folder all the way down, reading until the reader hands over none', async () => {
		const dropped = [
			folderEntry('/bse', [
				fileEntry('/bse/a.pdf'),
				fileEntry('/bse/.DS_Store'),
				folderEntry('/bse/2025', [fileEntry('/bse/2025/b.pdf')]),
				fileEntry('/bse/c.pdf'),
				fileEntry('/bse/d.pdf')
			]),
			fileEntry('/loose.pdf')
		];
		const picked = await walkEntries(dropped);
		expect(picked.map((item) => item.path)).toEqual([
			'bse/a.pdf',
			'bse/2025/b.pdf',
			'bse/c.pdf',
			'bse/d.pdf',
			'loose.pdf'
		]);
	});
});

describe('checkFile', () => {
	it('takes a PDF up to 50 MB', () => {
		expect(
			checkFile({ name: 'ar.pdf', size: MAX_UPLOAD_BYTES, type: 'application/pdf' })
		).toBeNull();
		expect(checkFile({ name: 'AR.PDF', size: 1000, type: '' })).toBeNull();
	});

	it('takes an XBRL instance: a .xml typed as XML, or left untyped', () => {
		expect(checkFile({ name: 'q2.xml', size: 10, type: 'text/xml' })).toBeNull();
		expect(checkFile({ name: 'q2.xml', size: 10, type: 'application/xml' })).toBeNull();
		expect(checkFile({ name: 'Q2.XML', size: 10, type: '' })).toBeNull();
	});

	it('refuses an .xml of the wrong type, an empty one and one over the limit', () => {
		expect(checkFile({ name: 'q2.xml', size: 10, type: 'application/pdf' })).toBe(
			'Not a PDF or an XBRL file.'
		);
		expect(checkFile({ name: 'q2.xml', size: 0, type: 'text/xml' })).toBe('The file is empty.');
		expect(checkFile({ name: 'q2.xml', size: MAX_UPLOAD_BYTES + 1, type: 'text/xml' })).toBe(
			'50.1 MB, over the 50 MB limit.'
		);
	});

	it('refuses a file that is empty or over the limit, saying how large it is', () => {
		expect(checkFile({ name: 'ar.pdf', size: 0, type: 'application/pdf' })).toBe(
			'The file is empty.'
		);
		expect(checkFile({ name: 'ar.pdf', size: 62 * 1024 * 1024, type: 'application/pdf' })).toBe(
			'62 MB, over the 50 MB limit.'
		);
		expect(checkFile({ name: 'ar.pdf', size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf' })).toBe(
			'50.1 MB, over the 50 MB limit.'
		);
	});

	it('refuses anything that is not a PDF, naming what it is when it can', () => {
		expect(checkFile({ name: 'notes.docx', size: 10, type: 'application/msword' })).toBe(
			'A Word document, not a PDF.'
		);
		expect(checkFile({ name: 'scan.jpg', size: 10, type: 'image/jpeg' })).toBe(
			'A picture, not a PDF.'
		);
		expect(checkFile({ name: 'report.pdf.zip', size: 10, type: 'application/zip' })).toBe(
			'Not a PDF or an XBRL file.'
		);
		expect(checkFile({ name: 'ar.pdf', size: 10, type: 'text/plain' })).toBe(
			'Not a PDF or an XBRL file.'
		);
	});
});

describe('looksLikePdf', () => {
	it('finds the PDF header in the first bytes, even after a little junk', () => {
		expect(looksLikePdf(PDF_HEAD)).toBe(true);
		expect(looksLikePdf(new TextEncoder().encode('\n\n%PDF-1.4'))).toBe(true);
		expect(looksLikePdf(new TextEncoder().encode('PK\u0003\u0004'))).toBe(false);
		expect(looksLikePdf(new Uint8Array())).toBe(false);
	});
});

describe('looksLikeXml', () => {
	it('is true when the first bytes, after a BOM and whitespace, start with <', () => {
		const bytes = (text: string) => new TextEncoder().encode(text);
		expect(looksLikeXml(bytes('\uFEFF\n<?xml'))).toBe(true);
		expect(looksLikeXml(bytes('  \r\n\t<xbrl'))).toBe(true);
		expect(looksLikeXml(bytes('%PDF'))).toBe(false);
		expect(looksLikeXml(bytes('   '))).toBe(false);
		expect(looksLikeXml(new Uint8Array())).toBe(false);
	});
});

describe('screen', () => {
	it('lets through the PDFs and names every other file with why, in the order chosen', async () => {
		const picked = [
			pick('bse/a.pdf'),
			pick('bse/b.xml', 10, 'text/xml'),
			pick('bse/fake.pdf'),
			pick('bse/fake.xml', 10, 'text/xml'),
			pick('bse/empty.pdf', 0),
			pick('bse/c.pdf')
		];
		const read = async (f: File) => {
			if (f.name === 'fake.pdf') return new TextEncoder().encode('<html>');
			if (f.name === 'fake.xml') return PDF_HEAD;
			if (f.name === 'b.xml') return new TextEncoder().encode('<?xml version="1.0"?>');
			return PDF_HEAD;
		};
		const { accepted, refused } = await screen(picked, 'bse', read);
		expect(accepted.map((item) => item.path)).toEqual(['bse/a.pdf', 'bse/b.xml', 'bse/c.pdf']);
		expect(refused).toEqual([
			{ name: 'fake.pdf', reason: 'Named .pdf, but not a PDF inside.' },
			{ name: 'fake.xml', reason: 'Named .xml, but not XML inside.' },
			{ name: 'empty.pdf', reason: 'The file is empty.' }
		]);
	});

	it('refuses a file the device would not let it read', async () => {
		const { refused } = await screen([pick('a.pdf')], null, () => Promise.reject(new Error('no')));
		expect(refused).toEqual([
			{ name: 'a.pdf', reason: 'Your device wouldn’t let Maester read it.' }
		]);
	});
});

describe('sendFailure', () => {
	it('gives the API’s refusals the browser’s words', () => {
		const size = { size: 60 * 1024 * 1024 };
		expect(sendFailure(new ApiError(413, 'UPLOAD_TOO_LARGE', 'x'), size)).toEqual({
			reason: '60 MB, over the 50 MB limit.',
			stop: null
		});
		expect(sendFailure(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'x'), size).reason).toBe(
			'Not a PDF or an XBRL file.'
		);
		expect(sendFailure(new Error('boom'), size)).toEqual({
			reason: 'The upload didn’t finish. Add it again.',
			stop: null
		});
	});

	it('stops the batch when signed out or offline', () => {
		expect(sendFailure(new ApiError(401, 'UNAUTHENTICATED', 'x'), { size: 1 }).stop).toBe(
			'signed-out'
		);
		expect(sendFailure(new ApiError(0, 'NETWORK', 'x'), { size: 1 }).stop).toBe('offline');
	});
});

describe('sendAll', () => {
	const many = (count: number) => Array.from({ length: count }, (_, i) => pick(`f${i}.pdf`));

	it('sends at most four at a time, and every file settles once', async () => {
		expect(SEND_AT_ONCE).toBe(4);
		const pending = new Map<string, ReturnType<typeof deferred>>();
		const started: string[] = [];
		let inFlight = 0;
		let most = 0;
		const settled: number[] = [];
		const done = sendAll(
			many(10),
			null,
			(item) => {
				started.push(item.path);
				inFlight += 1;
				most = Math.max(most, inFlight);
				const wait = deferred();
				pending.set(item.path, wait);
				return wait.promise.finally(() => (inFlight -= 1));
			},
			(count) => settled.push(count)
		);
		await flush();
		expect(started).toHaveLength(4);
		while (pending.size > 0) {
			const [path, wait] = pending.entries().next().value!;
			pending.delete(path);
			wait.resolve();
			await flush();
		}
		const result = await done;
		expect(most).toBe(4);
		expect(new Set(started).size).toBe(10);
		expect(settled).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(result).toEqual({ sent: 10, refused: [], unsent: 0, stopped: null });
	});

	it('sends every XBRL file before any PDF, each kind in the order chosen, and names refusals in the order chosen', async () => {
		const chosen = ['a.pdf', 'q1.xml', 'b.pdf', 'q2.XML', 'c.pdf', 'd.pdf', 'q3.xml'].map((p) =>
			pick(p)
		);
		const started: string[] = [];
		const result = await sendAll(chosen, null, async (item) => {
			started.push(item.path);
			if (item.path === 'q3.xml' || item.path === 'a.pdf')
				throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'x');
		});
		expect(started).toEqual(['q1.xml', 'q2.XML', 'q3.xml', 'a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
		expect(result.refused.map((r) => r.name)).toEqual(['a.pdf', 'q3.xml']);
		expect(result.sent).toBe(5);
	});

	it('names each file the API refused, in the order chosen, and carries on', async () => {
		const result = await sendAll(many(5), null, async (item) => {
			if (item.path === 'f3.pdf' || item.path === 'f1.pdf')
				throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'x');
		});
		expect(result).toEqual({
			sent: 3,
			refused: [
				{ name: 'f1.pdf', reason: 'Not a PDF or an XBRL file.' },
				{ name: 'f3.pdf', reason: 'Not a PDF or an XBRL file.' }
			],
			unsent: 0,
			stopped: null
		});
	});

	it('starts nothing new once signed out, and counts the files never tried', async () => {
		const tried: string[] = [];
		const result = await sendAll(many(20), null, async (item) => {
			tried.push(item.path);
			if (item.path === 'f0.pdf') throw new ApiError(401, 'UNAUTHENTICATED', 'x');
		});
		// Four started at once; f0 stopped the batch; the other three finished what they had.
		expect(tried).toEqual(['f0.pdf', 'f1.pdf', 'f2.pdf', 'f3.pdf']);
		expect(result.stopped).toBe('signed-out');
		expect(result.sent).toBe(3);
		expect(result.refused).toEqual([{ name: 'f0.pdf', reason: 'Not sent: you’re signed out.' }]);
		expect(result.unsent).toBe(16);
	});

	it('sends nothing for an empty batch', async () => {
		expect(await sendAll([], null, async () => {})).toEqual({
			sent: 0,
			refused: [],
			unsent: 0,
			stopped: null
		});
	});
});

describe('what the strip says', () => {
	it('counts the file being sent, and names a lone file', () => {
		const twelve = Array.from({ length: 12 }, (_, i) => pick(`bse-xbrl/f${i}.pdf`));
		expect(sendingLine(0, twelve, 'bse-xbrl')).toBe('Sending 1 of 12 files from bse-xbrl…');
		expect(sendingLine(2, twelve, 'bse-xbrl')).toBe('Sending 3 of 12 files from bse-xbrl…');
		expect(sendingLine(12, twelve, null)).toBe('Sending 12 of 12 files…');
		expect(sendingLine(0, [pick('ar.pdf')], null)).toBe('Sending ar.pdf…');
		expect(startAloud(twelve, 'bse-xbrl')).toBe('Sending 12 files.');
		expect(startAloud([pick('ar.pdf')], null)).toBe('Sending ar.pdf.');
	});

	it('says what was sent, from where, and how many were not added', () => {
		expect(sentLine(outcome({ folder: 'bse-xbrl' }))).toBe('12 files sent from bse-xbrl.');
		expect(sentLine(outcome({ total: 1, sent: 1 }))).toBe('1 file sent.');
		expect(sentLine(outcome({ sent: 0 }))).toBeNull();
		expect(endAloud(outcome())).toBe('12 files sent.');
		const two = [
			{ name: 'a.xml', reason: 'x' },
			{ name: 'b.xml', reason: 'x' }
		];
		expect(endAloud(outcome({ sent: 10, refused: two }))).toBe('10 files sent. 2 weren’t added.');
		expect(endAloud(outcome({ sent: 11, refused: two.slice(1) }))).toBe(
			'11 files sent. 1 wasn’t added.'
		);
	});

	it('titles the refusal Notice against every file chosen, with the singulars', () => {
		const one = [{ name: 'a.xml', reason: 'x' }];
		expect(refusedTitle(outcome({ total: 1, sent: 0, refused: one }))).toBe(
			'The file wasn’t added.'
		);
		expect(refusedTitle(outcome({ total: 806, sent: 805, refused: one }))).toBe(
			'1 of the 806 files wasn’t added.'
		);
		expect(refusedTitle(outcome({ total: 806, sent: 200, refused: one, unsent: 605 }))).toBe(
			'606 of the 806 files weren’t added.'
		);
		expect(
			refusedTitle(
				outcome({
					total: 2,
					sent: 0,
					refused: [...one, { name: 'b.xml', reason: 'x' }]
				})
			)
		).toBe('None of the 2 files were added.');
		expect(endAloud(outcome({ total: 2, sent: 0, refused: [...one, ...one] }))).toBe(
			'None of the 2 files were added.'
		);
	});
});
