import { describe, expect, it } from 'vitest';
import {
	basisTitle,
	notCheckedWords,
	pagesWords,
	readAgainIds,
	retryIds,
	sourceRows
} from './sources';
import {
	basisOf,
	fileOf,
	filingOf,
	pdfDone,
	pdfNotNeeded,
	stmt,
	xbrlDone,
	xbrlFailed
} from './testing';
import type { ResultsSpan, StatementSource } from './types';

const PARTIAL = 'Part of the XBRL file wasn’t read.';
const XBRL_UNMAPPED_UNKNOWN = 'The XBRL is in a format Maester doesn’t know yet, not mapped yet.';
const one = (statements: StatementSource[]) => [basisOf('consolidated', statements)];
const q2Filing = filingOf({
	kind: 'financial_results',
	periodEnd: '2026-09-30',
	spans: ['quarter', 'half_year'],
	files: [xbrlDone('x-q2c'), fileOf({ documentId: 'pdf-q2', originalName: 'q2.pdf' })]
});
const q2Consolidated = basisOf('consolidated', [
	stmt({
		statement: 'income_statement',
		xbrlDocumentId: 'x-q2c',
		xbrlSpans: ['quarter', 'half_year'],
		inPdf: { found: 38, checked: 38, notFound: [], notChecked: null }
	}),
	stmt({
		statement: 'balance_sheet',
		xbrlDocumentId: 'x-q2c',
		xbrlSpans: [],
		inPdf: { found: 51, checked: 52, notFound: ['f-1'], notChecked: null }
	}),
	stmt({
		statement: 'cash_flow',
		source: 'pdf',
		xbrlDocumentId: null,
		xbrlSpans: [],
		pdfDocumentId: 'pdf-q2',
		pdfPages: [6, 7],
		reason: 'xbrl_lacks_statement'
	})
]);

describe('sourceRows', () => {
	it('the C2 ledger, consolidated', () => {
		const rows = sourceRows(q2Consolidated, q2Filing, [
			{ statement: 'balance_sheet', basis: 'consolidated', pages: [3, 4, 5] }
		]);
		expect(rows.map((r) => [r.label, r.from.text, r.from.note, r.inPdf.text])).toEqual([
			['Profit and loss', 'XBRL · quarter and half year', null, 'Found: 38 of 38'],
			['Balance sheet', 'XBRL · at 30 Sep 2026', null, 'Found: 51 of 52'],
			['Cash flow', 'PDF, read by Gemini · pages 7–8', 'The quarter’s XBRL has no cash flow', '—']
		]);
		expect(rows[1].inPdf).toMatchObject({
			strong: true,
			missed: '1 not found.',
			open: { documentId: 'pdf-q2', pageIndex: 3, label: 'Open the results PDF at page 4' }
		});
		expect(rows[0].inPdf).toMatchObject({ strong: false, missed: null, open: null });
	});

	it('orders the rows profit and loss, balance sheet, cash flow', () => {
		const shuffled = basisOf('consolidated', [...q2Consolidated.statements].reverse());
		expect(sourceRows(shuffled, q2Filing, null).map((r) => r.statement)).toEqual([
			'income_statement',
			'balance_sheet',
			'cash_flow'
		]);
	});

	it('a miss without the PDF’s statement pages has no link', () => {
		const rows = sourceRows(q2Consolidated, q2Filing, null);
		expect(rows[1].inPdf).toMatchObject({ strong: true, missed: '1 not found.', open: null });
	});

	it('the link opens the PDF the statement was checked against, at its own pages', () => {
		const filing = filingOf({
			files: [
				xbrlDone('x1'),
				fileOf({ documentId: 'pdf-old', createdAt: '2026-10-01T08:00:00Z' }),
				fileOf({ documentId: 'pdf-new', createdAt: '2026-10-02T08:00:00Z' })
			]
		});
		const basis = basisOf('consolidated', [
			stmt({
				statement: 'balance_sheet',
				xbrlDocumentId: 'x1',
				pdfDocumentId: 'pdf-new',
				pdfPages: [9, 10],
				inPdf: { found: 5, checked: 6, notFound: ['f-1'], notChecked: null }
			})
		]);
		expect(sourceRows(basis, filing, null)[0].inPdf.open).toEqual({
			documentId: 'pdf-new',
			pageIndex: 9,
			label: 'Open the results PDF at page 10'
		});
		// The classification's pages belong to the oldest PDF, so they are not used for it.
		expect(
			sourceRows(basis, filing, [
				{ statement: 'balance_sheet', basis: 'consolidated', pages: [2] }
			])[0].inPdf.open?.pageIndex
		).toBe(9);
	});

	it('names the shortest span of the filing, and none without one', () => {
		const lacks = (spans: ResultsSpan[]) =>
			sourceRows(
				basisOf('consolidated', [
					stmt({
						statement: 'cash_flow',
						source: 'pdf',
						xbrlDocumentId: null,
						pdfDocumentId: 'pdf-q2',
						reason: 'xbrl_lacks_statement'
					})
				]),
				filingOf({ spans, files: [xbrlDone('x1'), fileOf({ documentId: 'pdf-q2' })] }),
				null
			)[0].from;
		expect(lacks(['nine_months', 'half_year']).note).toBe('The half year’s XBRL has no cash flow');
		expect(lacks(['full_year']).note).toBe('The year’s XBRL has no cash flow');
		expect(lacks(['nine_months']).note).toBe('The nine months’ XBRL has no cash flow');
		expect(lacks([])).toEqual({ text: 'PDF, read by Gemini', note: 'The XBRL has no cash flow' });
	});

	it('unmapped, no XBRL, not in the filing, not read yet, read failed', () => {
		const unmapped = filingOf({
			kind: 'financial_results',
			periodEnd: '2026-09-30',
			spans: ['quarter'],
			files: [
				fileOf({
					format: 'xbrl',
					pipeline: {
						numbers: {
							source: 'xbrl',
							state: 'not_read',
							reason: 'format_unmapped',
							format: 'banking'
						}
					}
				}),
				fileOf({ documentId: 'pdf-q2' })
			]
		});
		const rows = sourceRows(
			basisOf('consolidated', [
				stmt({
					statement: 'income_statement',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					pdfPages: [3],
					reason: 'xbrl_format_unmapped'
				}),
				stmt({
					statement: 'balance_sheet',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					pdfPages: [],
					reason: 'no_xbrl'
				}),
				stmt({
					statement: 'cash_flow',
					source: null,
					xbrlDocumentId: null,
					reason: 'not_in_filing'
				})
			]),
			unmapped,
			null
		);
		expect(rows.map((r) => [r.from.text, r.from.note])).toEqual([
			['PDF, read by Gemini · page 4', 'The XBRL is in the banking format, not mapped yet.'],
			['PDF, read by Gemini', 'No XBRL for this filing.'],
			['Not in this filing', null]
		]);
		const later = sourceRows(
			basisOf('standalone', [
				stmt({
					statement: 'income_statement',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					reason: 'not_read_yet'
				}),
				stmt({
					statement: 'balance_sheet',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					reason: 'read_failed'
				})
			]),
			unmapped,
			null
		);
		expect(later.map((r) => [r.from.text, r.from.note])).toEqual([
			['—', 'Not read yet.'],
			['—', 'The read stopped.']
		]);
	});

	it('a basis whose XBRL failed or is not read yet never reads "Not in this filing"', () => {
		const rows = sourceRows(
			basisOf('standalone', [
				stmt({
					statement: 'income_statement',
					source: null,
					xbrlDocumentId: null,
					reason: 'xbrl_read_failed'
				}),
				stmt({
					statement: 'balance_sheet',
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					pdfPages: [4, 5],
					reason: 'xbrl_read_failed'
				}),
				stmt({
					statement: 'cash_flow',
					source: null,
					xbrlDocumentId: null,
					reason: 'xbrl_not_read_yet'
				})
			]),
			q2Filing,
			null
		);
		expect(rows.map((r) => [r.from.text, r.from.note])).toEqual([
			['—', 'The XBRL file couldn’t be read.'],
			['PDF, read by Gemini · pages 5–6', 'The XBRL file couldn’t be read.'],
			['—', 'Not read yet.']
		]);
	});

	it('a PDF read while its XBRL is not read yet says so', () => {
		const rows = sourceRows(
			basisOf('consolidated', [
				stmt({
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					pdfPages: [1],
					reason: 'xbrl_not_read_yet'
				})
			]),
			q2Filing,
			null
		);
		expect(rows[0].from).toEqual({
			text: 'PDF, read by Gemini · page 2',
			note: 'The XBRL file isn’t read yet.'
		});
	});

	it('an XBRL statement with no spans and no period end is just "XBRL"', () => {
		const rows = sourceRows(
			basisOf('consolidated', [stmt({ xbrlDocumentId: 'x-q2c', xbrlSpans: [] })]),
			filingOf({ periodEnd: null, files: [xbrlDone('x-q2c')] }),
			null
		);
		expect(rows[0].from.text).toBe('XBRL');
	});

	it('lists three or more spans, other periods last', () => {
		const rows = sourceRows(
			basisOf('consolidated', [
				stmt({ xbrlDocumentId: 'x1', xbrlSpans: ['other', 'year', 'quarter'] })
			]),
			filingOf({ files: [xbrlDone('x1')] }),
			null
		);
		expect(rows[0].from.text).toBe('XBRL · quarter, year and other periods');
	});

	it('statements from a partial XBRL read carry its caveat', () => {
		const x = fileOf({
			documentId: 'x-w',
			format: 'xbrl',
			pipeline: {
				numbers: {
					source: 'xbrl',
					state: 'done',
					partial: true,
					warnings: ['XBRL_ROUNDING_MISSING']
				}
			}
		});
		const rows = sourceRows(
			basisOf('consolidated', [stmt({ xbrlDocumentId: 'x-w', xbrlSpans: ['quarter'] })]),
			filingOf({ files: [x] }),
			null
		);
		expect(rows[0].from).toEqual({
			text: 'XBRL · quarter',
			note: 'The XBRL file doesn’t declare its rounding, so its unit isn’t known.'
		});
	});

	it('a partial XBRL read with no warning says part was not read', () => {
		const x = fileOf({
			documentId: 'x-p',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'done', partial: true, warnings: [] } }
		});
		const rows = sourceRows(
			basisOf('consolidated', [stmt({ xbrlDocumentId: 'x-p', xbrlSpans: ['quarter'] })]),
			filingOf({ files: [x] }),
			null
		);
		expect(rows[0].from).toEqual({ text: 'XBRL · quarter', note: PARTIAL });
	});

	it('an unmapped statement names the format of the XBRL file of its own basis', () => {
		const unmapped = (
			id: string,
			basis: 'consolidated' | 'standalone',
			format: 'banking' | 'unknown'
		) =>
			fileOf({
				documentId: id,
				format: 'xbrl',
				basis,
				pipeline: {
					numbers: { source: 'xbrl', state: 'not_read', reason: 'format_unmapped', format }
				}
			});
		const rows = sourceRows(
			basisOf('standalone', [
				stmt({
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'pdf-q2',
					reason: 'xbrl_format_unmapped'
				})
			]),
			filingOf({
				files: [
					unmapped('x-c', 'consolidated', 'banking'),
					unmapped('x-s', 'standalone', 'unknown'),
					fileOf({ documentId: 'pdf-q2' })
				]
			}),
			null
		);
		expect(rows[0].from.note).toBe(XBRL_UNMAPPED_UNKNOWN);
	});

	it('a not-checked statement says why', () => {
		const rows = sourceRows(
			one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'scanned' } })])[0],
			q2Filing,
			null
		);
		expect(rows[0].inPdf.text).toBe(
			'Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.'
		);
		expect(rows[0].inPdf).toMatchObject({ strong: false, missed: null, open: null });
	});

	it('a statement with no unit to check by says its unit isn’t known', () => {
		const rows = sourceRows(
			one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: 'no_unit' } })])[0],
			q2Filing,
			null
		);
		expect(rows[0].inPdf.text).toBe('Not checked: its unit isn’t known.');
	});

	it('an XBRL statement with no count and no reason is "—"', () => {
		const rows = sourceRows(
			one([stmt({ inPdf: { found: 0, checked: 0, notFound: [], notChecked: null } })])[0],
			q2Filing,
			null
		);
		expect(rows[0].inPdf.text).toBe('—');
		expect(rows[0].inPdf.why).toBe('Not known whether the PDF shows these figures.');
	});

	it('every "—" in the ledger carries its reason; a figure that was checked needs none', () => {
		const rows = sourceRows(q2Consolidated, q2Filing, null);
		expect(rows.map((r) => r.inPdf.why)).toEqual([
			null,
			null,
			'Nothing to check: these numbers are read from the PDF.'
		]);
		const nowhere = sourceRows(
			one([
				stmt({ source: null, xbrlDocumentId: null, reason: null }),
				stmt({
					statement: 'cash_flow',
					source: null,
					xbrlDocumentId: null,
					reason: 'not_in_filing'
				})
			])[0],
			q2Filing,
			null
		);
		expect(nowhere.map((r) => [r.from.text, r.from.note, r.inPdf.text, r.inPdf.why])).toEqual([
			[
				'—',
				'Where these numbers come from isn’t known yet.',
				'—',
				'Nothing to check until its numbers are read.'
			],
			['Not in this filing', null, '—', 'Nothing to check: this statement isn’t in this filing.']
		]);
	});
});

describe('readAgainIds', () => {
	it('the XBRL only when it covers the PDF, even a PDF Gemini read first (no Gemini call)', () => {
		const covered = one([stmt({ xbrlDocumentId: 'x1', pdfDocumentId: 'p1' })]);
		expect(readAgainIds([xbrlDone('x1'), pdfNotNeeded('p1', ['x1'])], covered)).toEqual(['x1']);
		// numbers { state: 'done', source: 'pdf' }, read before its XBRL arrived; every statement of
		// `sources` is xbrl (Review Focus 1)
		expect(readAgainIds([xbrlDone('x1'), pdfDone('p1')], covered)).toEqual(['x1']);
	});

	it('a PDF read by Gemini, and both when they split', () => {
		expect(readAgainIds([pdfDone('p1')], [])).toEqual(['p1']);
		const split = one([
			stmt({ xbrlDocumentId: 'x1', pdfDocumentId: 'p1' }),
			stmt({
				statement: 'cash_flow',
				source: 'pdf',
				xbrlDocumentId: null,
				pdfDocumentId: 'p1'
			})
		]);
		expect(readAgainIds([xbrlDone('x1'), pdfDone('p1')], split)).toEqual(['x1', 'p1']);
		const kept = fileOf({
			documentId: 'k1',
			intakeState: 'kept',
			pipeline: { numbers: { source: null, state: 'not_read', reason: 'not_a_read_kind' } }
		});
		expect(readAgainIds([kept], [])).toEqual([]);
	});

	it('a failed XBRL file is read again too, in file order', () => {
		const sources = one([stmt({ xbrlDocumentId: 'x1', pdfDocumentId: 'p1' })]);
		expect(readAgainIds([pdfDone('p1'), xbrlFailed('x2'), xbrlDone('x1')], sources)).toEqual([
			'x2',
			'x1'
		]);
	});

	it('a PDF whose only claim is a failed XBRL read waits: the free XBRL read goes alone', () => {
		const sources = one([
			stmt({
				source: 'pdf',
				xbrlDocumentId: null,
				pdfDocumentId: 'p1',
				reason: 'xbrl_read_failed'
			})
		]);
		expect(readAgainIds([xbrlFailed('x2'), pdfDone('p1')], sources)).toEqual(['x2']);
		// Another basis the PDF owns outright still sends it, with the XBRL.
		const owns = [
			...sources,
			basisOf('standalone', [
				stmt({
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'p1',
					reason: 'xbrl_lacks_statement'
				})
			])
		];
		expect(readAgainIds([xbrlFailed('x2'), pdfDone('p1')], owns)).toEqual(['x2', 'p1']);
		// A failed XBRL file of another basis does not hold the PDF back.
		expect(readAgainIds([xbrlFailed('x2', 'standalone'), pdfDone('p1')], sources)).toEqual([
			'x2',
			'p1'
		]);
		// With no failed XBRL file in the send set, the PDF is the way to the numbers.
		expect(readAgainIds([pdfDone('p1')], sources)).toEqual(['p1']);
	});

	it('two bases, one covered by XBRL and one owned by the PDF, send both', () => {
		const sources = [
			basisOf('consolidated', [stmt({ xbrlDocumentId: 'x1', pdfDocumentId: 'p1' })]),
			basisOf('standalone', [
				stmt({
					source: 'pdf',
					xbrlDocumentId: null,
					pdfDocumentId: 'p1',
					reason: 'xbrl_lacks_statement'
				})
			])
		];
		expect(readAgainIds([xbrlDone('x1'), pdfDone('p1')], sources)).toEqual(['x1', 'p1']);
	});

	it('while an XBRL file of the filing is waiting, nothing is read again', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'waiting' } }
		});
		expect(readAgainIds([x, pdfDone('p1')], [])).toEqual([]);
		expect(
			retryIds(
				[
					x,
					fileOf({ documentId: 'p2', pipeline: { numbers: { source: 'pdf', state: 'failed' } } })
				],
				[],
				'numbers'
			)
		).toEqual([]);
	});

	it('while an XBRL file of the filing is read, a PDF is not read again', () => {
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
		expect(readAgainIds([x, p], sources)).toEqual([]);
	});
});

describe('stale sources (Review Focus 1)', () => {
	// The 2 s poll patches the files only; the sources stay as the last filings read built them.
	// The PDF was read by Gemini before its XBRL arrived; the XBRL has been read since, and the
	// filings read that would rebuild the sources failed.
	const x = fileOf({
		documentId: 'x1',
		format: 'xbrl',
		basis: 'consolidated',
		pipeline: { numbers: { source: 'xbrl', state: 'done' }, text: { state: 'waiting' } }
	});
	const notReadYet = one([
		stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'xbrl_not_read_yet' })
	]);

	it('never sends a PDF whose claim waits on an XBRL read the files say is over', () => {
		expect(readAgainIds([x, pdfDone('p1')], notReadYet)).toEqual(['x1']);
		const failedPdf = fileOf({
			documentId: 'p1',
			pipeline: { numbers: { source: 'pdf', state: 'failed' } }
		});
		expect(retryIds([x, failedPdf], notReadYet, 'numbers')).toEqual([]);
	});

	it('nor a PDF whose claim is a failed XBRL read, once the files say it was read', () => {
		const readFailed = one([
			stmt({ source: 'pdf', xbrlDocumentId: null, pdfDocumentId: 'p1', reason: 'xbrl_read_failed' })
		]);
		expect(readAgainIds([x, pdfDone('p1')], readFailed)).toEqual(['x1']);
	});

	it('an XBRL file that failed after the sources said not read yet leaves coverage unknown', () => {
		expect(readAgainIds([xbrlFailed('x1'), pdfDone('p1')], notReadYet)).toEqual(['x1']);
	});
});

describe('retryIds', () => {
	const failedPdf = fileOf({
		documentId: 'p1',
		pipeline: { numbers: { source: 'pdf', state: 'failed' } }
	});

	it('goes to the files whose track stopped, never to a covered PDF', () => {
		expect(
			retryIds(
				[fileOf({ documentId: 'p2', pipeline: { text: { state: 'failed' } } }), xbrlDone('x1')],
				[],
				'text'
			)
		).toEqual(['p2']);
		expect(
			retryIds(
				[xbrlFailed('x2'), failedPdf],
				one([stmt({ xbrlDocumentId: 'x1', pdfDocumentId: 'p1' })]),
				'numbers'
			)
		).toEqual(['x2']);
		expect(
			retryIds(
				[failedPdf],
				one([
					stmt({
						source: 'pdf',
						xbrlDocumentId: null,
						pdfDocumentId: 'p1',
						reason: 'read_failed'
					})
				]),
				'numbers'
			)
		).toEqual(['p1']);
		expect(
			retryIds([fileOf({ documentId: 'i1', pipeline: { identified: 'failed' } })], [], 'identify')
		).toEqual(['i1']);
	});

	it('a PDF whose only claim is a failed XBRL read is not retried beside the XBRL', () => {
		const sources = one([
			stmt({
				source: 'pdf',
				xbrlDocumentId: null,
				pdfDocumentId: 'p1',
				reason: 'xbrl_read_failed'
			})
		]);
		expect(retryIds([xbrlFailed('x2'), failedPdf], sources, 'numbers')).toEqual(['x2']);
	});

	it('numbers never retries a file whose numbers did not fail', () => {
		expect(
			retryIds([xbrlDone('x1'), pdfDone('p1'), pdfNotNeeded('p2', ['x1'])], [], 'numbers')
		).toEqual([]);
	});

	it('while an XBRL file of the filing is read, a failed PDF is not retried', () => {
		const x = fileOf({
			documentId: 'x1',
			format: 'xbrl',
			pipeline: { numbers: { source: 'xbrl', state: 'now' } }
		});
		const sources = one([
			stmt({
				source: 'pdf',
				xbrlDocumentId: null,
				pdfDocumentId: 'p1',
				reason: 'xbrl_not_read_yet'
			})
		]);
		expect(retryIds([x, failedPdf], sources, 'numbers')).toEqual([]);
	});
});

describe('words', () => {
	it('pagesWords', () => {
		expect([pagesWords([6]), pagesWords([6, 7]), pagesWords([3, 5, 8])]).toEqual([
			'page 7',
			'pages 7–8',
			'pages 4, 6 and 9'
		]);
		expect([pagesWords([2, 3, 4]), pagesWords([8, 3, 5, 3]), pagesWords([])]).toEqual([
			'pages 3–5',
			'pages 4, 6 and 9',
			''
		]);
	});

	it('basisTitle', () => {
		expect([basisTitle('consolidated'), basisTitle('standalone'), basisTitle('unknown')]).toEqual([
			'Consolidated',
			'Standalone',
			'Basis not stated'
		]);
	});

	it('notCheckedWords', () => {
		expect(notCheckedWords('no_pdf')).toBe(
			'Not checked: no PDF of these results is in your documents.'
		);
		expect(notCheckedWords('scanned')).toBe(
			'Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.'
		);
		expect(notCheckedWords('no_statement_pages')).toBe(
			'Not checked: Maester didn’t find the statement pages in the PDF.'
		);
		expect(notCheckedWords('disabled')).toBe('Not checked: the check is turned off.');
		expect(notCheckedWords('no_value')).toBe(
			'Not checked: the XBRL file gives no value to look for.'
		);
		expect(notCheckedWords('not_yet')).toBe('Not checked yet.');
		expect(notCheckedWords('no_unit')).toBe('Not checked: its unit isn’t known.');
	});
});
