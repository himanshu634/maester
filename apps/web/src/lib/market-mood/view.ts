/**
 * What the Market mood page says about the API's numbers: units, ranks, days in words and the
 * notices. Pure, so it is tested without Svelte. Every word comes from content/market-mood.ts.
 */
import { marketMoodContent as copy } from '$lib/content/market-mood';
import { inr } from '$lib/terminal/format';
import {
	READING_KEYS,
	type MarketMood,
	type MoodBand,
	type Reading,
	type ReadingFamily,
	type ReadingKey
} from './types';

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A reading at most this many days behind the latest session is named by its weekday. */
const WEEKDAY_SPAN = 6;

export const FAMILY_ORDER: ReadingFamily[] = ['fear', 'money', 'breadth', 'havens'];

export function bandLabel(band: MoodBand): string {
	return copy.bands[band];
}

/** Score to band, as the API bands it (0–19, 20–39, 40–59, 60–79, 80–100). */
export function bandOf(score: number): MoodBand {
	if (score < 20) return 'very_cautious';
	if (score < 40) return 'cautious';
	if (score < 60) return 'middling';
	if (score < 80) return 'eager';
	return 'very_eager';
}

/** The four families in page order, each with its readings in page order. */
export function byFamily(readings: Reading[]): { family: ReadingFamily; readings: Reading[] }[] {
	return FAMILY_ORDER.map((family) => ({
		family,
		readings: readings
			.filter((r) => r.family === family)
			.sort((a, b) => READING_KEYS.indexOf(a.key) - READING_KEYS.indexOf(b.key))
	}));
}

interface Unit {
	digits: number;
	/** Shows `+` on a positive value: the reading is a change, not a level. */
	signed: boolean;
	suffix: string;
}

const UNITS: Record<Exclude<ReadingKey, 'fpi_flows' | 'dii_flows'>, Unit> = {
	india_vix: { digits: 1, signed: false, suffix: '' },
	us_vix: { digits: 1, signed: false, suffix: '' },
	nifty_pcr: { digits: 2, signed: false, suffix: '' },
	nifty_trend: { digits: 1, signed: true, suffix: '%' },
	n500_above_200d: { digits: 0, signed: false, suffix: '%' },
	n500_net_highs: { digits: 1, signed: true, suffix: '%' },
	usd_inr: { digits: 2, signed: false, suffix: '' },
	gold_vs_nifty: { digits: 1, signed: true, suffix: ' pts' }
};

function number(n: number, unit: Unit): string {
	const digits = unit.digits;
	const fixed = new Intl.NumberFormat('en-IN', {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits
	});
	const rounded = Number(Math.abs(n).toFixed(digits));
	const sign = rounded === 0 ? '' : n < 0 ? MINUS : unit.signed ? '+' : '';
	return `${sign}${fixed.format(rounded)}${unit.suffix}`;
}

function valueOf(key: ReadingKey, n: number, signed?: boolean): string {
	if (key === 'fpi_flows' || key === 'dii_flows') return `${inr(n, { sign: true })} cr`;
	const unit = UNITS[key];
	return number(n, signed === undefined ? unit : { ...unit, signed });
}

/** "17.8", "+1.4%", "38%", "−₹21,450 cr", or "—" when there is no value. */
export function formatValue(r: Reading): string {
	return r.value === null ? '—' : valueOf(r.key, r.value);
}

/** "+2.6 in 5 sessions" for the fast readings, "was +6.8% on 8 Sep" for the slow ones. */
export function formatPrevious(r: Reading): string | null {
	if (r.value === null || r.previous === null) return null;
	const { value, day, sessions } = r.previous;
	if (sessions <= 5) return copy.previous.change(valueOf(r.key, r.value - value, true), sessions);
	return copy.previous.was(valueOf(r.key, value), dayMonth(day));
}

/** "Higher than 81% of the last 2 years", or how many days it has while history is short. */
export function rankSentence(r: Reading): string | null {
	if (r.value === null) return null;
	if (r.rank === null) return r.rankDays > 0 ? copy.rank.soFar(r.rankDays) : copy.rank.nothingYet;
	const words = copy.readings[r.key].rankWords ?? copy.rank;
	return r.rank >= 50
		? copy.rank.sentence(words.higher, r.rank)
		: copy.rank.sentence(words.lower, 100 - r.rank);
}

export type InMood =
	{ kind: 'score'; score: number; band: string; text: string } | { kind: 'out'; text: string };

/** What a reading adds to the mood, or why it adds nothing. */
export function inMoodLine(r: Reading): InMood {
	if (r.scored && r.score !== null) {
		const band = bandLabel(bandOf(r.score)).toLowerCase();
		return { kind: 'score', score: r.score, band, text: copy.inMood.score(r.score, band) };
	}
	const why = copy.readings[r.key].unscored;
	if (!r.scored && why) return { kind: 'out', text: copy.inMood.unscored(why) };
	switch (r.missing) {
		case 'stale':
			return { kind: 'out', text: copy.inMood.stale(r.day ? dayMonth(r.day) : '—') };
		case 'no_data':
		case 'not_enough_history':
		case 'no_source':
			return { kind: 'out', text: copy.inMood[r.missing] };
		default:
			return { kind: 'out', text: copy.inMood.no_data };
	}
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);

/** "8 Sep", from an ISO day. */
export function dayMonth(day: string): string {
	const d = utc(day);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2 Oct" for the latest session, "Friday’s close" for a reading a few days behind it. */
export function dayWords(day: string, latestSession: string | null): string {
	if (latestSession === null || day >= latestSession) return dayMonth(day);
	const behind = Math.round((utc(latestSession).getTime() - utc(day).getTime()) / 86_400_000);
	if (behind > WEEKDAY_SPAN) return dayMonth(day);
	return copy.weekdayClose(WEEKDAYS[utc(day).getUTCDay()]!);
}

/** "Dhan · NSE close · 6 Oct": where a reading came from and the day it is for. */
export function sourceLine(r: Reading, latestSession: string | null): string {
	return r.day ? `${r.source} · ${dayWords(r.day, latestSession)}` : r.source;
}

function joinAnd(parts: string[]): string {
	if (parts.length <= 1) return parts.join('');
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "foreign flows have no source yet and US VIX is late": the scored readings left out. */
function reasonsOut(m: MarketMood): string {
	return joinAnd(
		m.readings
			.filter((r) => r.scored && r.score === null && r.missing !== null)
			.map((r) => {
				const words = copy.readings[r.key];
				const reason = copy.missingInSentence[r.missing!];
				return `${words.short} ${words.plural ? reason.many : reason.one}`;
			})
	);
}

/** The sentence under the band word. */
export function headLine(m: MarketMood): string {
	if (m.latestSession === null) return copy.noReadings;
	if (m.score === null || m.band === null) return copy.tooFewReadings(m.scoredCount, reasonsOut(m));
	const count =
		m.scoredCount >= 7 ? copy.allReadings : copy.someReadings(m.scoredCount, reasonsOut(m));
	return `${copy.bandSentence[m.band]} ${count}`;
}

/** The day an instant falls on in India, as an ISO day. */
function istDay(iso: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Kolkata',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date(iso));
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

export interface FetchNotice {
	title: string;
	detail: string;
	action: { label: string; href: string } | null;
}

/** What to say about fetching: never run, the first run, or a failed run. Null when all is well. */
export function fetchNotice(m: MarketMood): FetchNotice | null {
	const { state, at, errorCode } = m.fetch;
	const stops = m.latestSession ? dayMonth(m.latestSession) : null;
	if (state === 'never') return { ...copy.notice.never, action: copy.notice.settings };
	if (state === 'running') {
		return m.latestSession === null ? { ...copy.notice.firstRun, action: null } : null;
	}
	if (state !== 'failed') return null;
	const day = at ? dayMonth(istDay(at)) : '—';
	switch (errorCode) {
		case 'DHAN_TOKEN_EXPIRED':
			return {
				title: copy.notice.tokenExpired.title,
				detail: copy.notice.tokenExpired.detail(stops),
				action: copy.notice.settings
			};
		case 'FRED_KEY_REFUSED': {
			const usDay = m.readings.find((r) => r.key === 'us_vix')?.day ?? null;
			return {
				title: copy.notice.fredRefused.title,
				detail: copy.notice.fredRefused.detail(usDay ? dayMonth(usDay) : null),
				action: copy.notice.settings
			};
		}
		case 'DHAN_RATE_LIMITED':
			return {
				title: copy.notice.rateLimited(day),
				detail: copy.notice.retry(stops),
				action: null
			};
		case 'SOURCE_UNAVAILABLE':
			return {
				title: copy.notice.unavailable(day),
				detail: copy.notice.retry(stops),
				action: null
			};
		default:
			return { title: copy.notice.unknown(day), detail: copy.notice.retry(stops), action: null };
	}
}
