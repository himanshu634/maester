/**
 * The API's market mood shapes. apps/web is a standalone project and cannot import
 * @maester/contracts, so these mirror its schemas in packages/contracts/src/market-mood.ts
 * (ReadingKey, ReadingFamily, MoodBand, MissingReason, Reading, FetchStatus, MarketMood and
 * ReadingDetail). When the contract changes, change it here too.
 */

/** The 10 readings on the Market mood page, in page order. */
export const READING_KEYS = [
	'india_vix',
	'us_vix',
	'nifty_pcr',
	'fpi_flows',
	'dii_flows',
	'nifty_trend',
	'n500_above_200d',
	'n500_net_highs',
	'usd_inr',
	'gold_vs_nifty'
] as const;
export type ReadingKey = (typeof READING_KEYS)[number];

export function isReadingKey(value: string): value is ReadingKey {
	return (READING_KEYS as readonly string[]).includes(value);
}

export type ReadingFamily = 'fear' | 'money' | 'breadth' | 'havens';

export type MoodBand = 'very_cautious' | 'cautious' | 'middling' | 'eager' | 'very_eager';

/** Why a reading has no value or no rank. */
export type MissingReason = 'no_source' | 'no_data' | 'stale' | 'not_enough_history';

export interface Reading {
	key: ReadingKey;
	family: ReadingFamily;
	/** True for the 7 readings that make up the mood. */
	scored: boolean;
	value: number | null;
	/** The day the value is for (IST trading day, or the US day for FRED series). */
	day: string | null;
	/** The value a fixed number of sessions earlier. */
	previous: { value: number; day: string; sessions: number } | null;
	/** Share of the ranked days with a lower value, 0–100. Null with fewer than 250 days. */
	rank: number | null;
	/** How many days the rank was worked out against (at most 500). */
	rankDays: number;
	/** What it adds to the mood, 0–100. Null when unscored or unranked. */
	score: number | null;
	/** "Dhan · NSE close", "FRED · Cboe VIX close" and so on. */
	source: string;
	missing: MissingReason | null;
}

export type FetchErrorCode =
	| 'DHAN_TOKEN_EXPIRED'
	| 'DHAN_RATE_LIMITED'
	| 'FRED_KEY_REFUSED'
	| 'SOURCE_UNAVAILABLE'
	| 'UNKNOWN';

export interface FetchStatus {
	state: 'never' | 'running' | 'ok' | 'failed';
	at: string | null;
	errorCode: FetchErrorCode | null;
}

export interface MarketMood {
	score: number | null;
	band: MoodBand | null;
	/** Scored readings present, out of 7. */
	scoredCount: number;
	/** The oldest day among the scored readings present. */
	asOf: string | null;
	/** The latest Indian session in the data. */
	latestSession: string | null;
	/** True when an Indian scored reading is older than the latest Indian session. */
	provisional: boolean;
	readings: Reading[];
	/** The mood for each Indian session in the last 12 months with at least 5 scored readings. */
	history: { day: string; score: number }[];
	/** Share of history days with a mood at or below today's, 0–100. Null without a mood. */
	atOrBelowShare: number | null;
	fetch: FetchStatus;
}

export interface ReadingDetail {
	reading: Reading;
	/** The last 2 years of the reading's own values, oldest first. */
	series: { day: string; value: number }[];
}
