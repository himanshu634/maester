import { describe, expect, it } from 'vitest';
import {
	abandonedUpload,
	formatWords,
	numbersTrack,
	pdfNeeded,
	textTrack,
	warningWords,
	type TrackContext
} from './tracks';
import {
	abandoned,
	basisOf,
	fileOf,
	pdfDone,
	pdfNotNeeded,
	rejected,
	stmt,
	xbrlDone,
	xbrlFailed
} from './testing';
import type { ReportingBasis, StatementSource } from './types';

const ctx: TrackContext = {
	uploading: (id) => id === 'up-1',
	nameOf: (id) => (id === 'x-q2' ? '500999_Q2_FY27_Consolidated.xml' : null)
};
const one = (statements: StatementSource[]) => [basisOf('consolidated', statements)];
const found = (f: number, n: number, notFound: string[] = []) => ({
	found: f,
	checked: n,
	notFound,
	notChecked: null
});
const pdfNow = () => fileOf({ pipeline: { numbers: { source: 'pdf', state: 'now' } } });

describe('the Numbers track', () => {
	it('XBRL reading and the PDF waiting for it (spec §4 row 1)', () => {
		const x = fileOf({
			documentId: 'x-q2',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'now' } }
		});
		const p = fileOf({
			pipeline: {
				numbers: { source: null, state: 'waiting', reason: 'waiting_for_xbrl', waitingOn: ['x-q2'] }
			}
		});
		expect(numbersTrack([x, p], [], ctx)).toEqual({
			state: 'now',
			first: 'From XBRL · reading now',
			second: 'The PDF waits for it, so Gemini reads only what XBRL doesn’t cover.'
		});
	});

	it('a PDF alone, read now (row 2)', () => {
		expect(numbersTrack([pdfNow()], [], ctx)).toEqual({
			state: 'now',
			first: 'Read from the PDF · now',
			second: 'No XBRL for this filing.'
		});
	});

	it('an unmapped banking XBRL and the PDF next (row 3)', () => {
		const x = fileOf({
			format: 'xbrl',
			pipeline: {
				numbers: { source: 'xbrl', state: 'not_read', reason: 'format_unmapped', format: 'banking' }
			}
		});
		const p = fileOf({ pipeline: { numbers: { source: null, state: 'waiting', reason: null } } });
		expect(numbersTrack([x, p], [], ctx)).toEqual({
			state: 'next',
			first: 'Read from the PDF · next',
			second: 'The XBRL is in the banking format, not mapped yet.'
		});
	});

	it('an unmapped XBRL alone is not read from XBRL', () => {
		const x = fileOf({
			format: 'xbrl',
			pipeline: {
				numbers: { source: 'xbrl', state: 'not_read', reason: 'format_unmapped', format: 'nbfc' }
			}
		});
		expect(numbersTrack([x], [], ctx)).toEqual({
			state: 'not-read',
			first: 'Not read from XBRL',
			second: 'The XBRL is in the NBFC format, not mapped yet.'
		});
	});

	it('XBRL done, the PDF not needed, 214 of 214 found in its one basis (row 4)', () => {
		expect(
			numbersTrack(
				[xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])],
				one([stmt({ xbrlDocumentId: 'x1', inPdf: found(214, 214) })]),
				ctx
			)
		).toEqual({
			state: 'done',
			first: 'From XBRL · done',
			second: '214 of 214 figures found in the PDF.'
		});
	});

	it('one figure missed', () => {
		expect(
			numbersTrack(
				[xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])],
				one([stmt({ inPdf: found(213, 214, ['f9']) })]),
				ctx
			).second
		).toBe('1 figure not found in the PDF.');
	});

	it('a partial XBRL read is said after the check, never a clean done', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'done', warnings: ['XBRL_ELEMENT_UNMAPPED'] } }
		});
		expect(
			numbersTrack([x, pdfNotNeeded('p1', ['x1'])], one([stmt({ inPdf: found(214, 214) })]), ctx)
				.second
		).toBe(
			'214 of 214 figures found in the PDF. Some of its lines aren’t mapped yet, so they aren’t read.'
		);
	});

	describe('an XBRL read with no rounding declared and no unit to check the PDF by (row 17)', () => {
		const noUnit = {
			found: 0,
			checked: 0,
			notFound: [],
			notChecked: 'no_unit' as const
		};
		const roundingMissing = (id: string, basis: ReportingBasis = 'consolidated') =>
			fileOf({
				documentId: id,
				format: 'xbrl',
				basis,
				pipeline: {
					numbers: {
						source: 'xbrl',
						state: 'done',
						partial: true,
						warnings: ['XBRL_ROUNDING_MISSING']
					}
				}
			});

		it('one basis: the check line and the caveat each say it once', () => {
			expect(
				numbersTrack([roundingMissing('x1')], one([stmt({ inPdf: noUnit })]), ctx).second
			).toBe(
				'With no unit known, its figures weren’t looked for in the PDF. The XBRL file doesn’t declare its rounding, so its unit isn’t known.'
			);
		});

		it('two bases: the clause names the basis and says its unit isn’t known', () => {
			const sources = [
				basisOf('consolidated', [stmt({ inPdf: found(107, 107) })]),
				basisOf('standalone', [stmt({ xbrlDocumentId: 'xs', inPdf: noUnit })])
			];
			expect(
				numbersTrack([roundingMissing('xc'), roundingMissing('xs', 'standalone')], sources, ctx)
					.second
			).toBe(
				'In the PDF: consolidated 107 of 107 found, standalone not checked: its unit isn’t known. The XBRL file doesn’t declare its rounding, so its unit isn’t known.'
			);
		});
	});

	it('a partial read with no warning still says part was not read', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'done', partial: true } }
		});
		expect(numbersTrack([x], one([stmt({ inPdf: found(5, 5) })]), ctx).second).toBe(
			'5 of 5 figures found in the PDF. Part of the XBRL file wasn’t read.'
		);
	});

	it('XBRL and the PDF split the statements, the same in both bases', () => {
		const split = (basis: ReportingBasis) =>
			basisOf(basis, [
				stmt({ statement: 'income_statement' }),
				stmt({ statement: 'balance_sheet' }),
				stmt({
					statement: 'cash_flow',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'p1',
					pdfPages: [6, 7],
					reason: 'xbrl_lacks_statement'
				})
			]);
		expect(
			numbersTrack(
				[xbrlDone('x1'), pdfDone('p1')],
				[split('consolidated'), split('standalone')],
				ctx
			)
		).toEqual({
			state: 'done',
			first: 'From XBRL and the PDF · done',
			second: 'XBRL: profit and loss, balance sheet. PDF: cash flow.'
		});
	});

	it('consolidated XBRL only: the split follows the bases', () => {
		const sources = [
			basisOf('consolidated', [stmt()]),
			basisOf('standalone', [
				stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'no_xbrl' })
			])
		];
		expect(numbersTrack([xbrlDone('x1'), pdfDone('p1')], sources, ctx).second).toBe(
			'Consolidated from XBRL; standalone from the PDF.'
		);
	});

	it('a split that differs by basis names each basis’s own statements', () => {
		const pdfCash = stmt({
			statement: 'cash_flow',
			source: 'pdf',
			xbrlDocumentId: null,
			pdfDocumentId: 'p1'
		});
		const sources = [
			basisOf('consolidated', [stmt(), stmt({ statement: 'balance_sheet' }), pdfCash]),
			basisOf('standalone', [
				stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'no_xbrl' })
			])
		];
		expect(numbersTrack([xbrlDone('x1'), pdfDone('p1')], sources, ctx).second).toBe(
			'Consolidated: XBRL for profit and loss, balance sheet, the PDF for cash flow; standalone from the PDF.'
		);
	});

	it('a PDF Gemini read before its XBRL, now covered whole, is not a source (Review Focus 1)', () => {
		expect(
			numbersTrack([xbrlDone('x1'), pdfDone('p1')], one([stmt({ inPdf: found(38, 38) })]), ctx)
		).toEqual({
			state: 'done',
			first: 'From XBRL · done',
			second: '38 of 38 figures found in the PDF.'
		});
	});

	it('two bases checked: counted apart, never summed', () => {
		const sources = [
			basisOf('consolidated', [stmt({ inPdf: found(107, 107) })]),
			basisOf('standalone', [stmt({ xbrlDocumentId: 'xs', inPdf: found(106, 107, ['f1']) })])
		];
		expect(
			numbersTrack(
				[xbrlDone('xc'), xbrlDone('xs', 'standalone'), pdfNotNeeded('p1', ['xc', 'xs'])],
				sources,
				ctx
			).second
		).toBe('In the PDF: consolidated 107 of 107 found, standalone 106 of 107 found.');
	});

	it('two XBRL bases, one not checked yet: both named, with the reason', () => {
		const sources = [
			basisOf('consolidated', [stmt({ inPdf: found(107, 107) })]),
			basisOf('standalone', [
				stmt({
					xbrlDocumentId: 'xs',
					inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'not_yet' }
				})
			])
		];
		const files = [xbrlDone('xc'), xbrlDone('xs', 'standalone'), pdfNotNeeded('p1', ['xc', 'xs'])];
		expect(numbersTrack(files, sources, ctx).second).toBe(
			'In the PDF: consolidated 107 of 107 found, standalone not checked yet.'
		);
	});

	it('two XBRL bases, one not checked for a reason, and one with none given', () => {
		const unchecked = (notChecked: 'scanned' | null) =>
			stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked } });
		const sources = [
			basisOf('consolidated', [unchecked('scanned')]),
			basisOf('standalone', [unchecked(null)])
		];
		const files = [xbrlDone('xc'), xbrlDone('xs', 'standalone')];
		expect(numbersTrack(files, sources, ctx).second).toBe(
			'In the PDF: consolidated not checked: its statement pages are scanned, standalone not checked.'
		);
	});

	it('one XBRL basis beside a PDF basis is still one XBRL basis', () => {
		const sources = [
			basisOf('consolidated', [stmt({ inPdf: found(10, 10) })]),
			basisOf('standalone', [
				stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'no_xbrl' })
			])
		];
		expect(numbersTrack([xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])], sources, ctx).second).toBe(
			'10 of 10 figures found in the PDF.'
		);
	});

	it('one basis with nothing to look for says so, never "—"', () => {
		expect(
			numbersTrack(
				[xbrlDone('x1')],
				one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'no_value' } })]),
				ctx
			).second
		).toBe('The XBRL file gives no value to look for in the PDF.');
		expect(numbersTrack([xbrlDone('x1')], one([stmt({ inPdf: null })]), ctx).second).toBe(
			'Not checked against the PDF.'
		);
	});

	it('waiting on an XBRL file elsewhere, named, or counted', () => {
		const waiting = (ids: string[]) =>
			fileOf({
				pipeline: {
					numbers: { source: null, state: 'waiting', reason: 'waiting_for_xbrl', waitingOn: ids }
				}
			});
		expect(numbersTrack([waiting(['x-q2'])], [], ctx)).toEqual({
			state: 'next',
			first: 'Waiting for XBRL',
			second:
				'500999_Q2_FY27_Consolidated.xml is being read. Gemini reads only what it doesn’t cover.'
		});
		expect(numbersTrack([waiting(['x-other'])], [], ctx).second).toBe(
			'An XBRL file is being read. Gemini reads only what it doesn’t cover.'
		);
		expect(numbersTrack([waiting(['x-q2', 'x-q3'])], [], ctx).second).toBe(
			'2 XBRL files are being read. Gemini reads only what they don’t cover.'
		);
	});

	it('an XBRL file waiting to be read is next', () => {
		const x = fileOf({
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'waiting' } }
		});
		expect(numbersTrack([x], [], ctx)).toEqual({
			state: 'next',
			first: 'From XBRL · next',
			second: null
		});
	});

	it('the XBRL failed and Gemini reads the PDF', () => {
		expect(numbersTrack([xbrlFailed('x1'), pdfNow()], [], ctx)).toEqual({
			state: 'now',
			first: 'Read from the PDF · now',
			second: 'The XBRL file couldn’t be read.'
		});
	});

	it('one instance failed and the other read: Stopped, never done (row 15)', () => {
		expect(numbersTrack([xbrlDone('xc'), xbrlFailed('xs', 'standalone')], [], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'xs.xml couldn’t be read.'
		});
		const sources = [
			basisOf('consolidated', [stmt({ xbrlDocumentId: 'xc' })]),
			basisOf('standalone', [
				stmt({
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'p1',
					reason: 'xbrl_read_failed'
				})
			])
		];
		expect(
			numbersTrack([xbrlDone('xc'), xbrlFailed('xs', 'standalone'), pdfDone('p1')], sources, ctx)
		).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'xs.xml couldn’t be read. Gemini read the PDF.'
		});
		expect(numbersTrack([xbrlFailed('x1')], [], ctx).second).toBe(
			'Maester couldn’t read the XBRL file.'
		);
		expect(numbersTrack([xbrlFailed('x1'), xbrlFailed('x2'), xbrlDone('x3')], [], ctx).second).toBe(
			'2 XBRL files couldn’t be read.'
		);
	});

	it('a PDF whose read failed stops the track only while it is still needed', () => {
		const p = fileOf({
			documentId: 'p1',
			pipeline: { numbers: { source: 'pdf', state: 'failed' } }
		});
		expect(
			numbersTrack([xbrlDone('x1'), p], one([stmt({ inPdf: found(38, 38) })]), ctx).state
		).toBe('done');
		expect(
			numbersTrack(
				[p],
				one([
					stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'read_failed' })
				]),
				ctx
			)
		).toEqual({ state: 'stopped', first: 'Stopped', second: 'Maester couldn’t read the numbers.' });
	});

	it('an abandoned upload is stopped; one being sent is "Sending"', () => {
		expect(numbersTrack([abandoned('u1')], [], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'The upload didn’t finish. Add it again.'
		});
		expect(numbersTrack([abandoned('up-1')], [], ctx)).toEqual({
			state: 'now',
			first: 'Sending',
			second: null
		});
	});

	it('a refused file says why', () => {
		expect(numbersTrack([rejected('r1', 'UNSUPPORTED_TYPE')], [], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'Not a PDF or an XBRL file.'
		});
		expect(numbersTrack([rejected('r3', 'TOO_LARGE')], [], ctx).second).toBe('Larger than 50 MB.');
		expect(numbersTrack([rejected('r2', null)], [], ctx).second).toBe('The upload didn’t arrive.');
	});

	it('a failed check of a stored file says so, and its other tracks never decide', () => {
		const f = fileOf({
			state: 'verifying',
			intakeState: null,
			pipeline: { stored: 'failed', identified: 'waiting' }
		});
		expect(numbersTrack([f], [], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'Maester couldn’t check this file.'
		});
	});

	it('a file still being checked', () => {
		const f = fileOf({ state: 'verifying', pipeline: { stored: 'now', identified: 'waiting' } });
		expect(numbersTrack([f], [], ctx)).toEqual({
			state: 'now',
			first: 'Checking the file',
			second: null
		});
	});

	it('a duplicate is settled, and its text never reads "In line"', () => {
		const d = fileOf({
			intakeState: 'duplicate',
			pipeline: {
				numbers: { source: null, state: 'not_read', reason: 'duplicate' },
				text: { state: 'waiting', ahead: null }
			}
		});
		expect(numbersTrack([d], [], ctx)).toEqual({
			state: 'not-read',
			first: 'Not read',
			second: 'You added this file before.'
		});
		expect(textTrack([d], ctx)).toEqual({ state: 'next', first: '—', second: null });
	});

	it('a kept document is not read', () => {
		const k = fileOf({
			intakeState: 'kept',
			pipeline: { numbers: { source: null, state: 'not_read', reason: 'not_a_read_kind' } }
		});
		expect(numbersTrack([k], [], ctx)).toEqual({
			state: 'not-read',
			first: 'Not read',
			second: 'Maester reads annual reports and financial results for now.'
		});
	});

	it('identification: working, stopped, and what needs you', () => {
		const at = (identified: 'now' | 'failed') => fileOf({ pipeline: { identified } });
		expect(numbersTrack([at('now')], [], ctx)).toEqual({
			state: 'now',
			first: 'Working out what it is',
			second: null
		});
		expect(numbersTrack([at('failed')], [], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'Maester couldn’t work out what this is.'
		});
		expect(
			numbersTrack(
				[fileOf({ intakeState: 'needs_kind', pipeline: { identified: 'needs_you' } })],
				[],
				ctx
			)
		).toEqual({ state: 'needs-you', first: 'Needs you', second: 'Say what it is.' });
		expect(
			numbersTrack(
				[fileOf({ intakeState: 'needs_company', pipeline: { identified: 'needs_you' } })],
				[],
				ctx
			).second
		).toBe('Confirm the company.');
	});

	it('nothing known yet is next, with no words', () => {
		expect(numbersTrack([], [], ctx)).toEqual({ state: 'next', first: '—', second: null });
	});
});

describe('pdfNeeded', () => {
	it('follows the sources, never the PDF’s own numbers', () => {
		const p = pdfDone('p1');
		expect(pdfNeeded(p, [xbrlDone('x1'), p], one([stmt()]))).toBe(false);
		expect(
			pdfNeeded(
				p,
				[xbrlDone('x1'), p],
				one([
					stmt(),
					stmt({
						statement: 'cash_flow',
						source: 'pdf',
						xbrlDocumentId: null,
						pdfDocumentId: 'p1'
					})
				])
			)
		).toBe(true);
		expect(pdfNeeded(p, [p], [])).toBe(true);
	});

	it('a failed PDF waits while its XBRL is read: From XBRL, never Stopped (no Try again, no Gemini call)', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'now' } }
		});
		const p = fileOf({
			documentId: 'p1',
			pipeline: { numbers: { source: 'pdf', state: 'failed' } }
		});
		const sources = one([
			stmt({
				source: 'pdf',
				xbrlDocumentId: null,
				pdfDocumentId: 'p1',
				reason: 'xbrl_not_read_yet'
			})
		]);
		expect(pdfNeeded(p, [x, p], sources)).toBe(false);
		expect(numbersTrack([x, p], sources, ctx)).toMatchObject({
			state: 'now',
			first: 'From XBRL · reading now'
		});
	});

	it('is false while an XBRL file waits, whatever the sources say', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'waiting' } }
		});
		const p = pdfDone('p1');
		expect(pdfNeeded(p, [x, p], [])).toBe(false);
	});
});

describe('abandonedUpload', () => {
	it('is a pending upload this page is not sending', () => {
		expect(abandonedUpload(abandoned('u1'), ctx)).toBe(true);
		expect(abandonedUpload(abandoned('up-1'), ctx)).toBe(false);
		expect(abandonedUpload(fileOf({ documentId: 'u2' }), ctx)).toBe(false);
	});
});

describe('the words', () => {
	it('formats and warnings', () => {
		expect(formatWords('banking')).toBe('the banking format');
		expect(formatWords('nbfc')).toBe('the NBFC format');
		expect(formatWords('other_than_ind_as')).toBe('the “other than Ind AS” format');
		expect(formatWords('ind_as')).toBe('the Ind AS format');
		expect(formatWords('unknown')).toBe('a format Maester doesn’t know yet');
		expect(warningWords('XBRL_ROUNDING_MISSING')).toBe(
			'The XBRL file doesn’t declare its rounding, so its unit isn’t known.'
		);
		expect(warningWords('XBRL_ROUNDING_MISMATCH')).toBe(
			'Its rounding doesn’t match the rounding it declares.'
		);
		expect(warningWords('XBRL_ELEMENT_UNMAPPED')).toBe(
			'Some of its lines aren’t mapped yet, so they aren’t read.'
		);
		expect(warningWords('XBRL_NIL')).toBe('Some lines are filed with no value.');
	});
});

describe('the Text track', () => {
	it('page 140 of 286 (spec §4)', () => {
		expect(
			textTrack(
				[
					fileOf({
						pipeline: {
							text: { state: 'now', pages: 286, pagesRead: 140, pagesOcr: 38, chunks: 412 }
						}
					})
				],
				ctx
			)
		).toEqual({
			state: 'now',
			first: 'Page 140 of 286',
			second: '38 pages by OCR · 412 passages so far'
		});
	});

	it('before the page count is known, and with no OCR', () => {
		expect(
			textTrack(
				[
					fileOf({
						pipeline: { text: { state: 'now', pages: 0, pagesRead: 0, pagesOcr: 0, chunks: 1 } }
					})
				],
				ctx
			)
		).toEqual({ state: 'now', first: 'Reading the pages', second: '1 passage so far' });
	});

	it('an XBRL file being read', () => {
		expect(
			textTrack([fileOf({ format: 'xbrl', pipeline: { text: { state: 'now' } } })], ctx)
		).toEqual({ state: 'now', first: 'Reading the XBRL notes', second: null });
	});

	it('in line, 2 ahead; a waiting PDF names no page count (Decision 19)', () => {
		const p = fileOf({ pipeline: { text: { state: 'waiting', ahead: 2, pages: 0 } } });
		const x = fileOf({ format: 'xbrl', pipeline: { text: { state: 'waiting', ahead: 5 } } });
		expect(textTrack([p, x], ctx)).toEqual({
			state: 'next',
			first: 'In line, 2 ahead',
			second: 'PDF · XBRL: its notes'
		});
	});

	it('in line: not queued yet, and next', () => {
		const at = (ahead: number | null) =>
			textTrack([fileOf({ pipeline: { text: { state: 'waiting', ahead, pages: 18 } } })], ctx);
		expect(at(null)).toEqual({ state: 'next', first: 'In line', second: 'PDF: 18 pages' });
		expect(at(0).first).toBe('Next in line');
	});

	it('done, the XBRL counted as notes', () => {
		const files = [
			fileOf({ pipeline: { text: { state: 'done', pages: 22, pagesOcr: 4, chunks: 61 } } }),
			fileOf({ format: 'xbrl', pipeline: { text: { state: 'done', chunks: 30, xbrlBlocks: 12 } } })
		];
		expect(textTrack(files, ctx).second).toBe('22 pages, 4 by OCR · 61 passages · 12 XBRL notes');
		expect(textTrack(files, ctx, 'opened')).toEqual({
			state: 'done',
			first: 'Done',
			second: '22 pages of the PDF, 4 by OCR, 61 passages; 12 notes from the XBRL'
		});
	});

	it('done with one of each, and nothing counted', () => {
		const pdf = fileOf({ pipeline: { text: { state: 'done', pages: 1, pagesOcr: 0, chunks: 1 } } });
		expect(textTrack([pdf], ctx, 'opened').second).toBe('1 page of the PDF, 1 passage');
		const x = fileOf({
			format: 'xbrl',
			pipeline: { text: { state: 'done', xbrlBlocks: 1, chunks: 0 } }
		});
		expect(textTrack([x], ctx).second).toBe('1 XBRL note');
		expect(textTrack([x], ctx, 'opened').second).toBe('1 note from the XBRL');
		const none = fileOf({ format: 'xbrl', pipeline: { text: { state: 'done', xbrlBlocks: 0 } } });
		expect(textTrack([none], ctx)).toEqual({ state: 'done', first: 'Done', second: null });
	});

	it('partial and failed', () => {
		expect(
			textTrack(
				[
					fileOf({
						pipeline: { text: { state: 'partial', pages: 10, pagesOcr: 0, chunks: 20 } }
					})
				],
				ctx
			)
		).toEqual({
			state: 'done',
			first: 'Done, some pages without text',
			second: '10 pages · 20 passages'
		});
		expect(textTrack([fileOf({ pipeline: { text: { state: 'failed' } } })], ctx)).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'The text wasn’t indexed. Your numbers aren’t affected.'
		});
	});

	it('no stored file says nothing, and a refused or unfinished file is no stored file', () => {
		expect(textTrack([], ctx)).toEqual({ state: 'next', first: '—', second: null });
		expect(textTrack([abandoned('u1'), rejected('r1', 'TOO_LARGE')], ctx)).toEqual({
			state: 'next',
			first: '—',
			second: null
		});
	});
});
