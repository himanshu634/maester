import { describe, expect, it } from 'vitest';
import { marketMoodContent } from '$lib/content/market-mood';
import type { MarketMood, Reading, ReadingKey } from './types';
import { READING_KEYS } from './types';
import {
	bandLabel,
	byFamily,
	dayWords,
	FAMILY_ORDER,
	fetchNotice,
	formatPrevious,
	formatValue,
	headLine,
	inMoodLine,
	rankSentence,
	sourceLine
} from './view';

const FAMILY: Record<ReadingKey, Reading['family']> = {
	india_vix: 'fear',
	us_vix: 'fear',
	nifty_pcr: 'fear',
	fpi_flows: 'money',
	dii_flows: 'money',
	nifty_trend: 'breadth',
	n500_above_200d: 'breadth',
	n500_net_highs: 'breadth',
	usd_inr: 'havens',
	gold_vs_nifty: 'havens'
};
const UNSCORED: ReadingKey[] = ['nifty_pcr', 'dii_flows', 'usd_inr'];

function reading(key: ReadingKey, over: Partial<Reading> = {}): Reading {
	return {
		key,
		family: FAMILY[key],
		scored: !UNSCORED.includes(key),
		value: 10,
		day: '2026-10-06',
		previous: null,
		rank: 50,
		rankDays: 500,
		score: UNSCORED.includes(key) ? null : 50,
		source: 'Dhan · NSE close',
		missing: null,
		...over
	};
}

/** The canvas's F1 figures, with flows unsourced as they are today. */
function canvasMood(over: Partial<MarketMood> = {}): MarketMood {
	return {
		score: 29,
		band: 'cautious',
		scoredCount: 6,
		asOf: '2026-10-06',
		latestSession: '2026-10-06',
		provisional: false,
		readings: [
			reading('india_vix', { value: 17.8, rank: 81, score: 19 }),
			reading('us_vix', { value: 22.6, rank: 70, score: 30, day: '2026-10-05' }),
			reading('nifty_pcr', { value: 1.21, rank: 62 }),
			reading('fpi_flows', noSource),
			reading('dii_flows', { ...noSource, scored: false }),
			reading('nifty_trend', { value: 1.4, rank: 46, score: 46 }),
			reading('n500_above_200d', { value: 38, rank: 34, score: 34 }),
			reading('n500_net_highs', { value: -4.2, rank: 31, score: 31 }),
			reading('usd_inr', { value: 88.74, rank: 85 }),
			reading('gold_vs_nifty', { value: 3.9, rank: 67, score: 33 })
		],
		history: [],
		atOrBelowShare: 19,
		fetch: { state: 'ok', at: '2026-10-06T10:30:00.000Z', errorCode: null },
		...over
	};
}

const noSource: Partial<Reading> = {
	value: null,
	day: null,
	rank: null,
	rankDays: 0,
	score: null,
	source: 'No source connected yet',
	missing: 'no_source'
};

describe('bandLabel', () => {
	it('names the five bands exactly', () => {
		expect(
			(['very_cautious', 'cautious', 'middling', 'eager', 'very_eager'] as const).map(bandLabel)
		).toEqual(['Very cautious', 'Cautious', 'Middling', 'Eager', 'Very eager']);
	});
});

describe('byFamily', () => {
	it('groups the readings into the four families in page order', () => {
		const groups = byFamily([...canvasMood().readings].reverse());
		expect(FAMILY_ORDER).toEqual(['fear', 'money', 'breadth', 'havens']);
		expect(groups.map((g) => g.family)).toEqual(FAMILY_ORDER);
		expect(groups.flatMap((g) => g.readings.map((r) => r.key))).toEqual([...READING_KEYS]);
	});
});

describe('formatValue', () => {
	it('writes each reading in its own unit, with a true minus sign', () => {
		expect(formatValue(reading('india_vix', { value: 17.8 }))).toBe('17.8');
		expect(formatValue(reading('nifty_trend', { value: 1.4 }))).toBe('+1.4%');
		expect(formatValue(reading('n500_above_200d', { value: 38.2 }))).toBe('38%');
		expect(formatValue(reading('n500_net_highs', { value: -4.2 }))).toBe('−4.2%');
		expect(formatValue(reading('nifty_pcr', { value: 1.2104 }))).toBe('1.21');
		expect(formatValue(reading('usd_inr', { value: 88.7412 }))).toBe('88.74');
		expect(formatValue(reading('gold_vs_nifty', { value: 3.94 }))).toBe('+3.9 pts');
		expect(formatValue(reading('fpi_flows', { value: -21450 }))).toBe('−₹21,450 cr');
	});

	it('gives no sign to a change that rounds to zero', () => {
		expect(formatValue(reading('nifty_trend', { value: -0.04 }))).toBe('0.0%');
	});

	it('shows a missing value as a dash, never zero', () => {
		expect(formatValue(reading('fpi_flows', noSource))).toBe('—');
	});
});

describe('formatPrevious', () => {
	it('gives the change over 5 sessions for the fear gauges', () => {
		const vix = reading('india_vix', {
			value: 17.8,
			previous: { value: 15.2, day: '2026-09-29', sessions: 5 }
		});
		expect(formatPrevious(vix)).toBe('+2.6 in 5 sessions');
	});

	it('gives the value 20 sessions back for the slower readings', () => {
		const trend = reading('nifty_trend', {
			value: 1.4,
			previous: { value: 6.8, day: '2026-09-08', sessions: 20 }
		});
		expect(formatPrevious(trend)).toBe('was +6.8% on 8 Sep');
	});

	it('says nothing without a previous value', () => {
		expect(formatPrevious(reading('india_vix'))).toBeNull();
		expect(formatPrevious(reading('fpi_flows', noSource))).toBeNull();
	});
});

describe('rankSentence', () => {
	it('places the value against its own last 2 years', () => {
		expect(rankSentence(reading('india_vix', { rank: 81 }))).toBe(
			'Higher than 81% of the last 2 years'
		);
		expect(rankSentence(reading('n500_net_highs', { rank: 31 }))).toBe(
			'Lower than 69% of the last 2 years'
		);
	});

	it('says how many days it has while history is short', () => {
		expect(
			rankSentence(
				reading('nifty_pcr', { rank: null, rankDays: 29, missing: 'not_enough_history' })
			)
		).toBe('Ranked against 29 days so far');
	});

	it('says nothing when there is no value', () => {
		expect(rankSentence(reading('fpi_flows', noSource))).toBeNull();
	});
});

describe('inMoodLine', () => {
	it('gives a scored reading its score and band', () => {
		expect(inMoodLine(reading('india_vix', { value: 17.8, rank: 81, score: 19 }))).toEqual({
			kind: 'score',
			score: 19,
			band: 'very cautious',
			text: 'In the mood: 19 · very cautious'
		});
	});

	it('says why a reading is left out', () => {
		expect(inMoodLine(reading('fpi_flows', noSource))).toEqual({
			kind: 'out',
			text: 'Not in the mood: no source connected yet.'
		});
		expect(inMoodLine(reading('nifty_pcr'))).toEqual({
			kind: 'out',
			text: 'Not in the mood: people read a high ratio both ways.'
		});
		expect(
			inMoodLine(
				reading('india_vix', {
					rank: null,
					rankDays: 29,
					score: null,
					missing: 'not_enough_history'
				})
			).text
		).toBe('Not in the mood until it has 250 days to rank against.');
		expect(
			inMoodLine(reading('n500_above_200d', { day: '2026-09-24', score: null, missing: 'stale' }))
				.text
		).toBe('Not in the mood: its last reading, 24 Sep, is too old.');
	});
});

describe('dayWords', () => {
	it('gives the latest session as a date', () => {
		expect(dayWords('2026-10-02', '2026-10-02')).toBe('2 Oct');
	});

	it('names the weekday for a reading a few days behind', () => {
		expect(dayWords('2026-10-02', '2026-10-05')).toBe('Friday’s close');
	});

	it('falls back to the date for anything older or with no session', () => {
		expect(dayWords('2026-09-24', '2026-10-05')).toBe('24 Sep');
		expect(dayWords('2026-09-08', null)).toBe('8 Sep');
	});
});

describe('sourceLine', () => {
	it('joins the source and the day', () => {
		expect(sourceLine(reading('india_vix'), '2026-10-06')).toBe('Dhan · NSE close · 6 Oct');
		expect(sourceLine(reading('fpi_flows', noSource), '2026-10-06')).toBe(
			'No source connected yet'
		);
	});
});

describe('headLine', () => {
	it('names the band, then how many readings it came from and why one is missing', () => {
		expect(headLine(canvasMood())).toBe(
			'Investors are more cautious than usual. Worked out from 6 of 7 readings; foreign flows have no source yet.'
		);
	});

	it('names every reason when several readings are out, in page order', () => {
		const m = canvasMood({ scoredCount: 5 });
		m.readings = m.readings.map((r) =>
			r.key === 'us_vix' ? { ...r, score: null, missing: 'stale' as const } : r
		);
		expect(headLine(m)).toBe(
			'Investors are more cautious than usual. Worked out from 5 of 7 readings; US VIX is late and foreign flows have no source yet.'
		);
	});

	it('explains a day with too few readings for a mood', () => {
		const m = canvasMood({ score: null, band: null, scoredCount: 4 });
		m.readings = m.readings.map((r) =>
			r.key === 'us_vix' || r.key === 'gold_vs_nifty'
				? { ...r, score: null, rank: null, missing: 'not_enough_history' as const }
				: r
		);
		expect(headLine(m)).toBe(
			'A mood needs 5 of the 7 readings and 4 have one today; US VIX has too little history, foreign flows have no source yet and gold against the Nifty has too little history.'
		);
	});

	it('says no readings yet before the first fetch', () => {
		expect(
			headLine(canvasMood({ score: null, band: null, scoredCount: 0, latestSession: null }))
		).toBe('No readings yet. Maester fetches them after the market closes.');
	});
});

describe('fetchNotice', () => {
	it('says the Dhan token expired, where the mood stops and where to renew it', () => {
		const m = canvasMood({
			latestSession: '2026-10-01',
			fetch: { state: 'failed', at: '2026-10-02T12:00:00.000Z', errorCode: 'DHAN_TOKEN_EXPIRED' }
		});
		expect(fetchNotice(m)).toEqual({
			title: 'Dhan stopped answering. The token has expired.',
			detail: 'Market mood stops at 1 Oct until you save a new one in Settings.',
			action: { label: 'Open Settings', href: '/terminal/settings' }
		});
	});

	it('never dates the expiry from the latest pass, which runs again every 30 minutes', () => {
		const m = canvasMood({
			latestSession: '2026-10-01',
			fetch: { state: 'failed', at: '2026-10-05T09:30:00.000Z', errorCode: 'DHAN_TOKEN_EXPIRED' }
		});
		expect(fetchNotice(m)?.title).not.toContain('5 Oct');
		expect(fetchNotice(m)?.detail).toContain('1 Oct');
	});

	it('dates a passing failure by the day in India, not in UTC', () => {
		const m = canvasMood({
			fetch: { state: 'failed', at: '2026-10-01T20:00:00.000Z', errorCode: 'SOURCE_UNAVAILABLE' }
		});
		expect(fetchNotice(m)?.title).toBe('A market data source didn’t answer on 2 Oct.');
	});

	it('sends a refused FRED key to Settings', () => {
		const m = canvasMood({
			fetch: { state: 'failed', at: '2026-10-06T10:00:00.000Z', errorCode: 'FRED_KEY_REFUSED' }
		});
		expect(fetchNotice(m)).toMatchObject({
			title: 'FRED refused the key.',
			detail: 'US VIX and the rupee stop at 5 Oct until you save a new key in Settings.',
			action: { href: '/terminal/settings' }
		});
	});

	it('says a passing failure will be tried again, with no action', () => {
		for (const errorCode of ['DHAN_RATE_LIMITED', 'SOURCE_UNAVAILABLE', 'UNKNOWN'] as const) {
			const notice = fetchNotice(
				canvasMood({ fetch: { state: 'failed', at: '2026-10-06T10:00:00.000Z', errorCode } })
			);
			expect(notice?.detail).toContain('tries again within 30 minutes');
			expect(notice?.action).toBeNull();
		}
	});

	it('points a never-run fetch at Settings', () => {
		const notice = fetchNotice(
			canvasMood({ latestSession: null, fetch: { state: 'never', at: null, errorCode: null } })
		);
		expect(notice?.title).toBe('Maester hasn’t fetched any market data yet.');
		expect(notice?.action?.href).toBe('/terminal/settings');
	});

	it('says the first fetch is running while nothing is stored', () => {
		const running = { state: 'running', at: '2026-10-06T10:00:00.000Z', errorCode: null } as const;
		expect(fetchNotice(canvasMood({ latestSession: null, fetch: running }))?.title).toBe(
			'Maester is fetching the first readings now.'
		);
		expect(fetchNotice(canvasMood({ fetch: running }))).toBeNull();
	});

	it('says nothing after a good fetch', () => {
		expect(fetchNotice(canvasMood())).toBeNull();
	});
});

describe('market mood copy', () => {
	it('never advises', () => {
		const words = JSON.stringify(marketMoodContent).toLowerCase();
		for (const banned of ['buy', 'sell', 'opportunity', 'overbought', 'high confidence']) {
			expect(words).not.toContain(banned);
		}
	});

	it('has a name and a line for every reading', () => {
		for (const key of READING_KEYS) {
			expect(marketMoodContent.readings[key].name).toBeTruthy();
			expect(marketMoodContent.readings[key].measures).toBeTruthy();
		}
	});
});
