import { describe, expect, it } from 'vitest';
import {
	answersWanted,
	applyDocument,
	buildView,
	fileLine,
	filingHeading,
	filingLive,
	filingMeta,
	filingTitle,
	follow,
	identifying,
	keepFresher,
	listWatched,
	newQuestions,
	pickFiling,
	pin,
	questionKeys,
	shapeChanged,
	showAllLabel,
	shownFilings,
	unsortedSettled,
	waitingAbove,
	withUpload,
	type CompanyGroup,
	type FilingView
} from './filings';
import type { TrackContext, TrackState, TrackWords } from './tracks';
import {
	abandoned,
	companyOf,
	docOf,
	fileOf,
	filingOf,
	heldOf,
	pipe,
	readWith,
	rejected
} from './testing';

const ctx: TrackContext = { uploading: (id) => id === 'up-1', nameOf: () => null };
const co = companyOf({
	id: 'co-1',
	displayName: 'Synthetic Cements',
	bseCode: '500999',
	nseSymbol: 'SYNCEM'
});
const words = (state: TrackState, first = 'x'): TrackWords => ({ state, first, second: null });
/** A FilingView by hand, for the rules that take one. */
const fv = (over: Partial<FilingView> = {}): FilingView => ({
	key: 'k',
	companyId: 'co-1',
	title: 't',
	files: [],
	numbers: words('done'),
	text: words('done'),
	settled: true,
	addedAt: '2026-10-19T08:32:00Z',
	filing: null,
	...over
});

describe('words for a filing', () => {
	it('titles', () => {
		expect(
			filingTitle(
				filingOf({
					kind: 'financial_results',
					spans: ['half_year', 'quarter'],
					periodEnd: '2026-09-30'
				}),
				[]
			)
		).toBe('Results, quarter to 30 Sep 2026');
		expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2026-03-31' }), [])).toBe(
			'Annual report 2025–26'
		);
		expect(filingTitle(filingOf({ kind: 'annual_report', periodEnd: '2025-12-31' }), [])).toBe(
			'Annual report, year to 31 Dec 2025'
		);
		expect(
			filingTitle(
				filingOf({ kind: 'other', otherType: 'investor_presentation', periodEnd: '2026-08-14' }),
				[]
			)
		).toBe('Investor presentation, 14 Aug 2026');
		expect(
			filingTitle(filingOf({ kind: 'not_sure', periodEnd: null }), [
				fileOf({ originalName: 'scan-0042.pdf' })
			])
		).toBe('scan-0042.pdf');
	});

	it('results with no span, results with no period, and an other filing dated by when it was added', () => {
		expect(
			filingTitle(filingOf({ kind: 'financial_results', spans: [], periodEnd: '2026-09-30' }), [])
		).toBe('Results to 30 Sep 2026');
		expect(
			filingTitle(filingOf({ kind: 'financial_results', spans: ['quarter'], periodEnd: null }), [])
		).toBe('Results, period not stated');
		expect(
			filingTitle(
				filingOf({
					kind: 'other',
					otherType: 'board_meeting',
					periodEnd: null,
					addedAt: '2026-08-14T12:00:00Z'
				}),
				[],
				'UTC'
			)
		).toBe('Board meeting, 14 Aug 2026');
	});

	it('an other filing dated by when it was added takes the day in the time zone given', () => {
		const late = filingOf({
			key: 'co-1:other:board_meeting',
			kind: 'other',
			otherType: 'board_meeting',
			periodEnd: null,
			addedAt: '2026-08-14T20:00:00Z'
		});
		expect(filingTitle(late, [], 'America/New_York')).toBe('Board meeting, 14 Aug 2026');
		expect(filingTitle(late, [], 'Asia/Kolkata')).toBe('Board meeting, 15 Aug 2026');
		const read = readWith({ companies: [{ company: co, filings: [late] }] });
		expect(buildView(read, ctx, 'America/New_York').done[0].filings[0].title).toBe(
			'Board meeting, 14 Aug 2026'
		);
	});

	it('heading and meta', () => {
		const q2 = filingOf({
			key: 'co-1:financial_results:2026-09-30',
			kind: 'financial_results',
			periodEnd: '2026-09-30',
			spans: ['quarter', 'half_year'],
			settled: true,
			addedAt: '2026-10-19T08:32:00Z',
			files: [
				fileOf({ basis: 'consolidated' }),
				fileOf({ format: 'xbrl', basis: 'consolidated' }),
				fileOf({ format: 'xbrl', basis: 'standalone' })
			]
		});
		const q2View = buildView(readWith({ companies: [{ company: co, filings: [q2] }] }), ctx).done[0]
			.filings[0];
		expect(
			filingHeading('Synthetic Cements', 'Results, quarter to 30 Sep 2026', 'financial_results')
		).toBe('Synthetic Cements · results, quarter to 30 Sep 2026');
		expect(filingMeta(q2View, new Date('2026-10-19T12:00:00Z'), 'Asia/Kolkata')).toBe(
			'Consolidated and standalone · 3 files · added 14:02'
		);
	});

	it('a heading keeps a file name as it is, and has no company part without a company', () => {
		expect(filingHeading('Synthetic Cements', 'Scan-0042.pdf', 'not_sure')).toBe(
			'Synthetic Cements · Scan-0042.pdf'
		);
		expect(filingHeading(null, 'Scan-0042.pdf', null)).toBe('Scan-0042.pdf');
		expect(filingHeading(null, 'Annual report 2025–26', 'annual_report')).toBe(
			'Annual report 2025–26'
		);
	});

	it('meta leaves the bases out when no file states one, and counts one file', () => {
		const view = fv({ files: [fileOf({ basis: null })] });
		expect(filingMeta(view, new Date('2026-10-19T12:00:00Z'), 'Asia/Kolkata')).toBe(
			'1 file · added 14:02'
		);
	});

	it('a duplicate is "Added twice" on the first copy', () => {
		expect(fileLine(fileOf({ originalName: 'ar.pdf', duplicates: ['d9'] }))).toBe(
			'PDF · ar.pdf · Added twice'
		);
		expect(
			fileLine(fileOf({ originalName: '500999_Q2.xml', format: 'xbrl', duplicates: ['d8', 'd9'] }))
		).toBe('XBRL · 500999_Q2.xml · Added 3 times');
		expect(fileLine(fileOf({ originalName: 'ar.pdf' }))).toBe('PDF · ar.pdf');
	});
});

describe('buildView', () => {
	it('sections: settled to Done, unsettled to Working on, needs_company with no code to the Notices', () => {
		const view = buildView(
			readWith({
				companies: [
					{
						company: co,
						filings: [
							filingOf({ key: 'a', settled: true, files: [fileOf()] }),
							filingOf({ key: 'b', settled: false, files: [fileOf(), fileOf(), fileOf()] })
						]
					}
				],
				unsorted: [
					fileOf({
						documentId: 'm1',
						originalName: 'meridian-q2.pdf',
						intakeState: 'needs_company',
						pipeline: { identified: 'needs_you' }
					})
				]
			}),
			ctx
		);
		expect(view.done.map((g) => [g.name, g.codes, g.filings.map((f) => f.key)])).toEqual([
			['Synthetic Cements', 'BSE 500999 · NSE SYNCEM', ['a']]
		]);
		expect(view.working.map((g) => g.filings.map((f) => f.key))).toEqual([['b']]);
		expect(view.unnamed.map((f) => f.documentId)).toEqual(['m1']);
		expect(view).toMatchObject({
			workingCount: '1 filing · 3 files',
			doneCount: '1 filing',
			empty: false
		});
		expect(buildView(readWith(), ctx).empty).toBe(true);
	});

	it('a company with no filing in a section is left out of it; the codes carry an ISIN', () => {
		const withIsin = companyOf({ id: 'co-3', displayName: 'Kestrel Power', isin: 'INE000A01010' });
		const view = buildView(
			readWith({
				companies: [
					{ company: companyOf({ id: 'co-2', displayName: 'Empty Co' }), filings: [] },
					{ company: withIsin, filings: [filingOf({ key: 'k', files: [fileOf()] })] }
				]
			}),
			ctx
		);
		expect(view.working).toEqual([]);
		expect(view.done.map((g) => [g.companyId, g.codes])).toEqual([['co-3', 'ISIN INE000A01010']]);
		expect(view.workingCount).toBe('0 filings · 0 files');
	});

	it('the counts read in plurals', () => {
		const view = buildView(
			readWith({
				companies: [
					{
						company: co,
						filings: [
							filingOf({ key: 'w1', settled: false, files: [fileOf()] }),
							filingOf({ key: 'w2', settled: false, files: [fileOf()] }),
							filingOf({ key: 'd1', files: [fileOf()] }),
							filingOf({ key: 'd2', files: [fileOf()] })
						]
					}
				]
			}),
			ctx
		);
		expect([view.workingCount, view.doneCount]).toEqual(['2 filings · 2 files', '2 filings']);
	});

	it('unsorted files are their own filings, newest first, under "Company not known yet", last', () => {
		const view = buildView(
			readWith({
				companies: [
					{ company: co, filings: [filingOf({ key: 'a', settled: false, files: [fileOf()] })] }
				],
				unsorted: [
					fileOf({
						documentId: 'n1',
						originalName: 'first.pdf',
						createdAt: '2026-10-18T08:00:00Z',
						intakeState: 'needs_kind',
						pipeline: { identified: 'needs_you' }
					}),
					fileOf({
						documentId: 'n2',
						originalName: 'second.pdf',
						createdAt: '2026-10-19T08:00:00Z',
						intakeState: 'identifying',
						pipeline: { identified: 'now' }
					})
				]
			}),
			ctx
		);
		expect(view.working.map((g) => g.name)).toEqual(['Synthetic Cements', 'Company not known yet']);
		const unknown = view.working[1];
		expect(unknown).toMatchObject({ companyId: null, codes: '' });
		expect(unknown.filings.map((f) => [f.key, f.title, f.filing, f.addedAt])).toEqual([
			['file:n2', 'second.pdf', null, '2026-10-19T08:00:00Z'],
			['file:n1', 'first.pdf', null, '2026-10-18T08:00:00Z']
		]);
		expect(unknown.filings[1].numbers.state).toBe('needs-you');
	});

	it('a refused file and an abandoned upload go to Done, not Working on, after a reload', () => {
		const view = buildView(
			readWith({ unsorted: [rejected('r1', 'UNSUPPORTED_TYPE'), abandoned('u1')] }),
			ctx
		);
		expect(view.working).toEqual([]);
		expect(view.done[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
		expect(view.done[0].filings.map((f) => f.key).sort()).toEqual(['file:r1', 'file:u1']);
		expect(view.done[0].filings.map((f) => f.numbers.state)).toEqual(['stopped', 'stopped']);
	});

	it('identification stopped goes to Done; a kept file still indexing stays in Working on', () => {
		const kept = { source: null, state: 'not_read', reason: 'not_a_read_kind' } as const;
		const stopped = fileOf({
			documentId: 'b1',
			originalName: 'broken.xml',
			format: 'xbrl',
			intakeState: 'identify_failed',
			pipeline: {
				identified: 'failed',
				numbers: { source: 'xbrl', state: 'waiting', reason: 'not_identified' }
			}
		});
		const indexing = fileOf({
			documentId: 'k1',
			intakeState: 'kept',
			pipeline: { numbers: kept, text: { state: 'now', pages: 286, pagesRead: 140 } }
		});
		const indexed = fileOf({ documentId: 'k2', intakeState: 'kept', pipeline: { numbers: kept } });
		const view = buildView(readWith({ unsorted: [stopped, indexing, indexed] }), ctx);
		expect(view.done[0].filings.map((f) => f.key).sort()).toEqual(['file:b1', 'file:k2']);
		expect(view.working[0].filings.map((f) => f.key)).toEqual(['file:k1']);
		const b1 = view.done[0].filings.find((f) => f.key === 'file:b1');
		expect(b1?.numbers).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'Maester couldn’t work out what this is.'
		});
	});

	it('a file whose check failed sits in Done under "Company not known yet", stopped, with why', () => {
		const failed = fileOf({
			documentId: 'v1',
			state: 'verifying',
			intakeState: null,
			pipeline: {
				stored: 'failed',
				identified: 'waiting',
				numbers: { source: null, state: 'waiting', reason: 'not_identified' },
				text: { state: 'waiting' }
			}
		});
		const view = buildView(readWith({ unsorted: [failed] }), ctx);
		expect(view.working).toEqual([]);
		expect(view.done).toHaveLength(1);
		expect(view.done[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
		expect(view.done[0].filings.map((f) => f.key)).toEqual(['file:v1']);
		expect(view.done[0].filings[0].numbers).toEqual({
			state: 'stopped',
			first: 'Stopped',
			second: 'Maester couldn’t check this file.'
		});
	});

	it('a file this page is sending stays in Working on', () => {
		const view = buildView(readWith({ unsorted: [abandoned('up-1')] }), ctx);
		expect(view.done).toEqual([]);
		expect(view.working[0]).toMatchObject({ companyId: null, name: 'Company not known yet' });
	});

	it('held is the read’s, unchanged', () => {
		const held = [heldOf({ key: 'bse:532999' })];
		const view = buildView(readWith({ held }), ctx);
		expect(view.held).toBe(held);
		expect(view.empty).toBe(false);
	});
});

describe('unsortedSettled', () => {
	it('a failed check is settled; a file still checked or identified is not', () => {
		expect(
			unsortedSettled(fileOf({ state: 'verifying', pipeline: { stored: 'failed' } }), ctx)
		).toBe(true);
		expect(unsortedSettled(fileOf({ state: 'verifying', pipeline: { stored: 'now' } }), ctx)).toBe(
			false
		);
		expect(unsortedSettled(fileOf({ pipeline: { identified: 'now' } }), ctx)).toBe(false);
	});

	it('identified, with numbers settled and text indexed, is settled; text still waiting is not', () => {
		expect(unsortedSettled(fileOf(), ctx)).toBe(true);
		expect(unsortedSettled(fileOf({ pipeline: { text: { state: 'partial' } } }), ctx)).toBe(true);
		expect(unsortedSettled(fileOf({ pipeline: { text: { state: 'waiting' } } }), ctx)).toBe(false);
		expect(
			unsortedSettled(fileOf({ pipeline: { numbers: { state: 'now', source: 'pdf' } } }), ctx)
		).toBe(false);
	});
});

describe('Done collapses', () => {
	it('Done shows the newest 3 of 9, and names a stopped one it hides', () => {
		const nine: CompanyGroup = {
			companyId: 'co-1',
			name: 'Synthetic Cements',
			codes: '',
			filings: Array.from({ length: 9 }, (_, i) =>
				fv({ key: `f${i}`, numbers: words(i === 7 ? 'stopped' : 'done') })
			)
		};
		expect(shownFilings(nine, false)).toMatchObject({ hidden: 6, hiddenStopped: 1 });
		expect(shownFilings(nine, false).shown.map((f) => f.key)).toEqual(['f0', 'f1', 'f2']);
		expect(showAllLabel(nine, false)).toBe('Show all 9 filings of Synthetic Cements · 1 stopped');
		expect(showAllLabel(nine, true)).toBe('Show the newest 3');
	});

	it('expanded shows every filing and hides none; a stopped Text track counts as stopped', () => {
		const five: CompanyGroup = {
			companyId: 'co-1',
			name: 'Synthetic Cements',
			codes: '',
			filings: Array.from({ length: 5 }, (_, i) => fv({ key: `f${i}` }))
		};
		expect(shownFilings(five, true)).toMatchObject({ hidden: 0, hiddenStopped: 0 });
		expect(shownFilings(five, true).shown).toHaveLength(5);
		expect(showAllLabel(five, false)).toBe('Show all 5 filings of Synthetic Cements');
		const textStopped = { ...five, filings: [...five.filings, fv({ text: words('stopped') })] };
		expect(shownFilings(textStopped, false).hiddenStopped).toBe(1);
	});
});

describe('the opened filing', () => {
	it('the open filing follows its document when the filing key changes', () => {
		const read = readWith({
			companies: [
				{
					company: co,
					filings: [
						filingOf({
							key: 'co-1:financial_results:2026-09-30',
							settled: false,
							files: [fileOf({ documentId: 'd1' })]
						})
					]
				}
			]
		});
		expect(
			pickFiling(buildView(read, ctx), { key: 'file:d1', documentId: 'd1', name: 'd1.pdf' })?.key
		).toBe('co-1:financial_results:2026-09-30');
	});

	it('a document made a duplicate opens its first copy’s filing', () => {
		const read = readWith({
			companies: [
				{
					company: co,
					filings: [
						filingOf({
							key: 'co-1:annual_report:2026-03-31',
							files: [fileOf({ documentId: 'orig', duplicates: ['d1'] })]
						})
					]
				}
			]
		});
		expect(pin(buildView(read, ctx), { key: 'file:d1', documentId: 'd1', name: 'ar.pdf' })).toEqual(
			{ key: 'co-1:annual_report:2026-03-31', documentId: 'd1', name: 'ar.pdf' }
		);
	});

	it('a document that becomes held or unnamed keeps the open filing on it, never an unrelated one', () => {
		const unrelated = {
			company: companyOf({ id: 'co-2' }),
			filings: [
				filingOf({
					key: 'co-2:annual_report:2026-03-31',
					settled: false,
					files: [fileOf({ documentId: 'z1' })]
				})
			]
		};
		const opened = { key: 'file:d1', documentId: 'd1', name: 'coast-q2.xml' };
		const held = buildView(
			readWith({
				companies: [unrelated],
				held: [heldOf({ key: 'bse:532999', documentIds: ['d1'] })]
			}),
			ctx
		);
		expect(pickFiling(held, opened)).toBeNull();
		expect(pin(held, opened)).toEqual(opened);
		expect(waitingAbove(held, opened)).toEqual({
			kind: 'held',
			key: 'bse:532999',
			name: 'coast-q2.xml'
		});
		const unnamed = buildView(
			readWith({
				companies: [unrelated],
				unsorted: [
					fileOf({
						documentId: 'd1',
						intakeState: 'needs_company',
						pipeline: { identified: 'needs_you' }
					})
				]
			}),
			ctx
		);
		expect(pin(unnamed, opened)).toEqual(opened);
		expect(waitingAbove(unnamed, opened)).toEqual({
			kind: 'unnamed',
			documentId: 'd1',
			name: 'coast-q2.xml'
		});
		expect(waitingAbove(unnamed, null)).toBeNull();
		expect(waitingAbove(unnamed, { key: 'x', documentId: 'z1', name: 'z1.pdf' })).toBeNull();
	});

	it('a duplicate of a file that waits unnamed keeps the open filing on it, never an unrelated one', () => {
		const unrelated = {
			company: companyOf({ id: 'co-2' }),
			filings: [
				filingOf({
					key: 'co-2:annual_report:2026-03-31',
					settled: false,
					files: [fileOf({ documentId: 'z1' })]
				})
			]
		};
		const view = buildView(
			readWith({
				companies: [unrelated],
				unsorted: [
					fileOf({
						documentId: 'orig',
						intakeState: 'needs_company',
						pipeline: { identified: 'needs_you' },
						duplicates: ['d1']
					})
				]
			}),
			ctx
		);
		const opened = { key: 'file:d1', documentId: 'd1', name: 'ar.pdf' };
		expect(pickFiling(view, opened)).toBeNull();
		expect(pin(view, opened)).toBe(opened);
		expect(waitingAbove(view, opened)).toEqual({
			kind: 'unnamed',
			documentId: 'orig',
			name: 'ar.pdf'
		});
	});

	it('follow names a duplicate by its own name, never its first copy’s', () => {
		const view = buildView(
			readWith({
				companies: [
					{
						company: co,
						filings: [
							filingOf({
								key: 'K',
								files: [fileOf({ documentId: 'orig', originalName: 'ar.pdf', duplicates: ['d1'] })]
							})
						]
					}
				]
			}),
			ctx
		);
		expect(follow(view, 'd1', 'ar (1).pdf')).toEqual({
			key: 'K',
			documentId: 'd1',
			name: 'ar (1).pdf'
		});
		expect(follow(view, 'orig', 'ar.pdf')).toEqual({
			key: 'K',
			documentId: 'orig',
			name: 'ar.pdf'
		});
	});

	it('one file of a filing moves: the filing stays open; after the investor’s own Change it follows', () => {
		const view = buildView(
			readWith({
				companies: [
					{
						company: co,
						filings: [
							filingOf({
								key: 'K',
								settled: false,
								files: [fileOf({ documentId: 'd1' }), fileOf({ documentId: 'd3' })]
							}),
							filingOf({ key: 'K2', settled: false, files: [fileOf({ documentId: 'd2' })] })
						]
					}
				]
			}),
			ctx
		);
		expect(pin(view, { key: 'K', documentId: 'd2', name: 'd2.pdf' })).toEqual({
			key: 'K',
			documentId: 'd1',
			name: 'd1.pdf'
		});
		expect(follow(view, 'd2', 'd2.pdf')).toEqual({ key: 'K2', documentId: 'd2', name: 'd2.pdf' });
		expect(follow(view, 'nowhere', 'x.pdf')).toBeNull();
	});

	it('with nothing opened, the newest unsettled filing opens', () => {
		const read = readWith({
			companies: [
				{
					company: co,
					filings: [
						filingOf({
							key: 'old',
							settled: false,
							addedAt: '2026-10-18T08:00:00Z',
							files: [fileOf({ documentId: 'o1' })]
						}),
						filingOf({
							key: 'new',
							settled: false,
							addedAt: '2026-10-19T08:00:00Z',
							files: [fileOf({ documentId: 'n1' })]
						}),
						filingOf({
							key: 'done',
							settled: true,
							addedAt: '2026-10-20T08:00:00Z',
							files: [fileOf({ documentId: 'x1' })]
						})
					]
				}
			]
		});
		expect(pin(buildView(read, ctx), null)).toEqual({
			key: 'new',
			documentId: 'n1',
			name: 'n1.pdf'
		});
	});

	it('with nothing working, the newest Done filing opens; with nothing at all, none', () => {
		const read = readWith({
			companies: [
				{
					company: co,
					filings: [
						filingOf({ key: 'a', addedAt: '2026-10-18T08:00:00Z', files: [fileOf()] }),
						filingOf({ key: 'b', addedAt: '2026-10-19T08:00:00Z', files: [fileOf()] })
					]
				}
			]
		});
		expect(pickFiling(buildView(read, ctx), null)?.key).toBe('b');
		expect(pickFiling(buildView(readWith(), ctx), null)).toBeNull();
		expect(pin(buildView(readWith(), ctx), null)).toBeNull();
	});

	it('once pinned, a newer unsettled filing does not take over, nor does its own work finishing', () => {
		const older = filingOf({
			key: 'older',
			settled: false,
			addedAt: '2026-10-18T08:00:00Z',
			files: [fileOf({ documentId: 'o1' })]
		});
		const newer = filingOf({
			key: 'newer',
			settled: false,
			addedAt: '2026-10-19T08:00:00Z',
			files: [fileOf({ documentId: 'n1' })]
		});
		const opened = pin(
			buildView(readWith({ companies: [{ company: co, filings: [older] }] }), ctx),
			null
		);
		expect(
			pin(
				buildView(readWith({ companies: [{ company: co, filings: [older, newer] }] }), ctx),
				opened
			)?.key
		).toBe('older');
		expect(
			pin(
				buildView(
					readWith({ companies: [{ company: co, filings: [{ ...older, settled: true }, newer] }] }),
					ctx
				),
				opened
			)?.key
		).toBe('older');
	});

	it('a polled document that changes filing asks for the filings again', () => {
		const before = fileOf({
			documentId: 'd1',
			intakeState: 'identifying',
			pipeline: { identified: 'now' }
		});
		expect(
			shapeChanged(
				before,
				docOf({
					id: 'd1',
					intakeState: 'needs_company',
					pipeline: pipe({ identified: 'needs_you' })
				})
			)
		).toBe(true);
		expect(
			shapeChanged(
				before,
				docOf({ id: 'd1', intakeState: 'duplicate', pipeline: pipe({ identified: 'now' }) })
			)
		).toBe(true);
		expect(
			shapeChanged(
				before,
				docOf({
					id: 'd1',
					intakeState: 'identifying',
					pipeline: pipe({ identified: 'now', text: { state: 'now', pagesRead: 12 } })
				})
			)
		).toBe(false);
		expect(
			shapeChanged(
				before,
				docOf({
					id: 'd1',
					state: 'rejected',
					intakeState: 'identifying',
					pipeline: pipe({ identified: 'now' })
				})
			)
		).toBe(true);
	});

	it('answers load for the opened filing’s stored files that have none, and again for a file that moved', () => {
		const view = fv({
			files: [fileOf({ documentId: 'a' }), fileOf({ documentId: 'b' }), abandoned('c')]
		});
		expect(answersWanted(view, { a: null }, new Set())).toEqual(['b']);
		expect(answersWanted(view, { a: null, b: null }, new Set(['a']))).toEqual(['a']);
		expect(answersWanted(null, {}, new Set())).toEqual([]);
	});
});

describe('polling', () => {
	it('identifying is true while any file is checked or identified, never for an abandoned upload', () => {
		expect(
			identifying(readWith({ unsorted: [fileOf({ pipeline: { identified: 'now' } })] }), ctx)
		).toBe(true);
		expect(identifying(readWith({ unsorted: [abandoned('up-1')] }), ctx)).toBe(true); // this page is sending it
		expect(identifying(readWith({ unsorted: [abandoned('u1')] }), ctx)).toBe(false);
		expect(identifying(readWith({ unsorted: [] }), ctx)).toBe(false);
		const inFiling = readWith({
			companies: [
				{
					company: co,
					filings: [filingOf({ files: [fileOf({ pipeline: { identified: 'now' } })] })]
				}
			]
		});
		expect(identifying(inFiling, ctx)).toBe(true);
	});

	it('an abandoned upload never holds back a new question', () => {
		const read = readWith({
			unsorted: [abandoned('u1')],
			held: [heldOf({ key: 'bse:532999', nameAsPrinted: 'Coastline Bank Limited' })]
		});
		expect(identifying(read, ctx)).toBe(false);
		expect(newQuestions(new Set(), read).aloud).toBe(
			'Coastline Bank needs you: confirm the company.'
		);
	});

	it('a fallback track is not live; In line is', () => {
		expect(filingLive(fv({ numbers: words('next', '—'), text: words('next', '—') }), ctx)).toBe(
			false
		);
		expect(filingLive(fv({ text: words('next', 'In line') }), ctx)).toBe(true);
		expect(filingLive(fv({ numbers: words('now') }), ctx)).toBe(true);
		expect(filingLive(fv({ files: [abandoned('up-1')] }), ctx)).toBe(true);
	});

	it('the list is watched while a Working on filing other than the opened one is live', () => {
		const view = buildView(
			readWith({
				companies: [
					{
						company: co,
						filings: [
							filingOf({
								key: 'live',
								settled: false,
								files: [fileOf({ pipeline: { identified: 'now' } })]
							}),
							filingOf({ key: 'quiet', settled: false, files: [fileOf()] })
						]
					}
				]
			}),
			ctx
		);
		expect(listWatched(view, null, ctx)).toBe(true);
		expect(listWatched(view, 'live', ctx)).toBe(false);
	});
});

describe('merging reads', () => {
	it('a filings read never rolls back a file its own poll wrote', () => {
		const polled = readWith({
			unsorted: [
				fileOf({ documentId: 'd1', pipeline: { numbers: { source: 'pdf', state: 'now' } } })
			]
		});
		const stale = readWith({
			unsorted: [
				fileOf({
					documentId: 'd1',
					pipeline: { numbers: { source: null, state: 'waiting', reason: 'not_identified' } }
				})
			]
		});
		expect(keepFresher(polled, stale, ['d1']).unsorted[0].pipeline.numbers.state).toBe('now');
		expect(keepFresher(polled, stale, []).unsorted[0].pipeline.numbers.state).toBe('waiting');
	});

	it('keepFresher keeps the polled copy inside a company filing too', () => {
		const polledFile = fileOf({ documentId: 'd1', pipeline: { text: { state: 'now' } } });
		const staleFile = fileOf({ documentId: 'd1', pipeline: { text: { state: 'waiting' } } });
		const current = readWith({
			companies: [{ company: co, filings: [filingOf({ files: [polledFile] })] }]
		});
		const next = readWith({
			companies: [{ company: co, filings: [filingOf({ files: [staleFile] })] }]
		});
		const kept = keepFresher(current, next, ['d1']).companies[0].filings[0].files[0];
		expect(kept.pipeline).toEqual(polledFile.pipeline);
	});

	it('keepFresher keeps the poll’s fields only: a duplicate or basis the read adds stays', () => {
		const polledFile = fileOf({
			documentId: 'd1',
			basis: null,
			intakeState: 'reading',
			pipeline: { numbers: { source: 'pdf', state: 'now' } }
		});
		const readFile = fileOf({
			documentId: 'd1',
			basis: 'standalone',
			intakeState: 'identifying',
			duplicates: ['d9'],
			pipeline: { numbers: { source: null, state: 'waiting', reason: 'not_identified' } }
		});
		const merged = keepFresher(
			readWith({ unsorted: [polledFile] }),
			readWith({ unsorted: [readFile] }),
			['d1']
		).unsorted[0];
		expect(merged.duplicates).toEqual(['d9']);
		expect(merged.basis).toBe('standalone');
		expect(merged.pipeline).toEqual(polledFile.pipeline);
		expect(merged.intakeState).toBe('reading');
	});

	it('a read that began before an upload keeps the upload, in unsorted', () => {
		const upload = fileOf({ documentId: 'u9', pipeline: { stored: 'now' } });
		const current = readWith({ unsorted: [upload, fileOf({ documentId: 'd1' })] });
		const stale = readWith({ unsorted: [fileOf({ documentId: 'd1' })] });
		const merged = keepFresher(current, stale, ['u9']);
		expect(merged.unsorted.map((f) => f.documentId)).toEqual(['u9', 'd1']);
		expect(merged.unsorted[0]).toBe(upload);
		const view = buildView(merged, ctx);
		expect(pin(view, { key: 'file:u9', documentId: 'u9', name: 'u9.pdf' })).toEqual({
			key: 'file:u9',
			documentId: 'u9',
			name: 'u9.pdf'
		});
	});

	it('a file the read now holds, or lists as a duplicate, is not carried back into unsorted', () => {
		const polled = fileOf({ documentId: 'd1', pipeline: { identified: 'now' } });
		const current = readWith({ unsorted: [polled] });
		const held = readWith({ held: [heldOf({ key: 'bse:532999', documentIds: ['d1'] })] });
		expect(keepFresher(current, held, ['d1']).unsorted).toEqual([]);
		const duplicate = readWith({ unsorted: [fileOf({ documentId: 'orig', duplicates: ['d1'] })] });
		expect(keepFresher(current, duplicate, ['d1']).unsorted.map((f) => f.documentId)).toEqual([
			'orig'
		]);
	});

	it('applyDocument returns the same read when no file matches', () => {
		const read = readWith({ unsorted: [fileOf({ documentId: 'd1' })] });
		expect(applyDocument(read, docOf({ id: 'nope' }))).toBe(read);
	});

	it('applyDocument patches the file where it sits, and never moves it', () => {
		const read = readWith({
			companies: [
				{
					company: co,
					filings: [
						filingOf({ key: 'K', files: [fileOf({ documentId: 'd1', originalName: 'q2.pdf' })] })
					]
				}
			]
		});
		const doc = docOf({
			id: 'd1',
			intakeState: 'duplicate',
			classification: {
				id: 'c1',
				kind: 'annual_report',
				otherType: null,
				resultsSpan: null,
				periodLabel: null,
				companyId: 'co-1',
				companyNameAsPrinted: 'Synthetic Cements Limited',
				setBy: 'maester'
			},
			pipeline: pipe({ text: { state: 'not_needed' } })
		});
		const next = applyDocument(read, doc);
		const file = next.companies[0].filings[0].files[0];
		expect(file).toMatchObject({
			documentId: 'd1',
			originalName: 'q2.pdf',
			intakeState: 'duplicate',
			companyNameAsPrinted: 'Synthetic Cements Limited'
		});
		expect(file.pipeline.text.state).toBe('not_needed');
		expect(next.companies[0].filings[0].key).toBe('K');
		expect(read.companies[0].filings[0].files[0].intakeState).toBe('read');
	});

	it('withUpload adds the document to unsorted, and replaces it there', () => {
		const sending = docOf({
			id: 'up-1',
			originalName: 'q2.xml',
			format: 'xbrl',
			state: 'pending_upload',
			intakeState: null
		});
		const added = withUpload(readWith(), sending);
		expect(added.unsorted).toHaveLength(1);
		expect(added.unsorted[0]).toMatchObject({
			documentId: 'up-1',
			originalName: 'q2.xml',
			format: 'xbrl',
			basis: null,
			state: 'pending_upload',
			duplicates: []
		});
		const replaced = withUpload(added, { ...sending, state: 'uploaded' });
		expect(replaced.unsorted.map((f) => [f.documentId, f.state])).toEqual([['up-1', 'uploaded']]);
	});
});

describe('questions', () => {
	it('one new question is said by name', () => {
		expect(
			newQuestions(
				new Set(),
				readWith({ held: [heldOf({ key: 'bse:532999', nameAsPrinted: 'Coastline Bank Limited' })] })
			).aloud
		).toBe('Coastline Bank needs you: confirm the company.');
		const printed = fileOf({
			documentId: 'm1',
			originalName: 'meridian-q2.pdf',
			companyNameAsPrinted: 'Meridian Foods Limited',
			intakeState: 'needs_company',
			pipeline: { identified: 'needs_you' }
		});
		expect(newQuestions(new Set(), readWith({ unsorted: [printed] })).aloud).toBe(
			'meridian-q2.pdf needs you: is this Meridian Foods Limited?'
		);
	});

	it('a held identity with no printed name is said by its codes; unnamed and what-is-it files by name', () => {
		const keys = questionKeys(
			readWith({
				held: [
					heldOf({ key: 'bse:532999', nameAsPrinted: null, bseCode: '532999', nseSymbol: 'CSTL' })
				],
				unsorted: [
					fileOf({
						documentId: 'm1',
						originalName: 'nameless.pdf',
						intakeState: 'needs_company',
						pipeline: { identified: 'needs_you' }
					}),
					fileOf({
						documentId: 'm2',
						originalName: 'scan.pdf',
						intakeState: 'needs_kind',
						pipeline: { identified: 'needs_you' }
					})
				]
			})
		);
		expect([...keys]).toEqual([
			[
				'held:bse:532999',
				{ kind: 'company', aloud: 'BSE 532999 · NSE CSTL needs you: confirm the company.' }
			],
			['doc:m1:company', { kind: 'file', aloud: 'nameless.pdf needs you: which company is this?' }],
			['doc:m2:kind', { kind: 'file', aloud: 'scan.pdf needs you: what is it?' }]
		]);
	});

	it('many new questions are said as one count', () => {
		const read = readWith({
			held: Array.from({ length: 31 }, (_, i) =>
				heldOf({ key: `bse:5${String(i).padStart(5, '0')}` })
			),
			unsorted: [
				fileOf({
					documentId: 'm1',
					intakeState: 'needs_company',
					pipeline: { identified: 'needs_you' }
				}),
				fileOf({
					documentId: 'm2',
					intakeState: 'needs_kind',
					pipeline: { identified: 'needs_you' }
				})
			]
		});
		expect(newQuestions(new Set(), read).aloud).toBe('31 companies and 2 files need you.');
		expect(newQuestions(newQuestions(new Set(), read).seen, read).aloud).toBeNull();
	});

	it('a file asked what it is, then which company, has the second question said too', () => {
		const asKind = readWith({
			unsorted: [
				fileOf({
					documentId: 'm1',
					originalName: 'scan.pdf',
					intakeState: 'needs_kind',
					pipeline: { identified: 'needs_you' }
				})
			]
		});
		const asCompany = readWith({
			unsorted: [
				fileOf({
					documentId: 'm1',
					originalName: 'scan.pdf',
					intakeState: 'needs_company',
					pipeline: { identified: 'needs_you' }
				})
			]
		});
		const first = newQuestions(new Set(), asKind);
		expect(first.aloud).toBe('scan.pdf needs you: what is it?');
		expect(newQuestions(first.seen, asCompany).aloud).toBe(
			'scan.pdf needs you: which company is this?'
		);
	});

	it('a count leaves out a part at 0 and is singular at 1', () => {
		const twoCompanies = readWith({ held: [heldOf({ key: 'a' }), heldOf({ key: 'b' })] });
		expect(newQuestions(new Set(), twoCompanies).aloud).toBe('2 companies need you.');
		const oneEach = readWith({
			held: [heldOf({ key: 'a' })],
			unsorted: [
				fileOf({
					documentId: 'm2',
					intakeState: 'needs_kind',
					pipeline: { identified: 'needs_you' }
				})
			]
		});
		expect(newQuestions(new Set(), oneEach).aloud).toBe('1 company and 1 file need you.');
		expect(newQuestions(new Set(['held:a']), oneEach).aloud).toBe('m2.pdf needs you: what is it?');
	});
});
