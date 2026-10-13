/**
 * Copy for the Market mood page (/terminal/market-mood). Plain words from the investor's side
 * (docs/DESIGN.md section 7). The mood is context for keeping to your own allocation: it never
 * advises, so no word here tells anyone to act. Unknown is "—" with its reason, never zero.
 */
import type { MissingReason, MoodBand, ReadingFamily, ReadingKey } from '$lib/market-mood/types';

interface ReadingCopy {
	/** The reading's name on the page. */
	name: string;
	/** The name inside a sentence: "foreign flows have no source yet". */
	short: string;
	/** True when `short` takes a plural verb. */
	plural?: boolean;
	/** One line on what the reading measures, true whatever its value. */
	measures: string;
	/** Why an unscored reading is shown but left out of the mood. */
	unscored?: string;
	/** Words for a value above or below most of its 2 years, where "higher" would mislead. */
	rankWords?: { higher: string; lower: string };
}

export const marketMoodContent = {
	heading: 'Market mood',
	loading: 'Reading the market.',
	loadFailed: {
		title: 'Market mood didn’t load.',
		detail: 'The readings are still stored. Check your connection and try again.',
		retry: 'Try again'
	},
	noMood: 'Not enough readings to give a mood today.',
	ofHundred: (score: number) => `${score} of 100`,

	bands: {
		very_cautious: 'Very cautious',
		cautious: 'Cautious',
		middling: 'Middling',
		eager: 'Eager',
		very_eager: 'Very eager'
	} satisfies Record<MoodBand, string>,

	/** The first sentence under the band word. */
	bandSentence: {
		very_cautious: 'Investors are far more cautious than usual.',
		cautious: 'Investors are more cautious than usual.',
		middling: 'Investors are about as cautious as usual.',
		eager: 'Investors are more eager than usual.',
		very_eager: 'Investors are far more eager than usual.'
	} satisfies Record<MoodBand, string>,
	allReadings: 'Worked out from all 7 readings.',
	someReadings: (count: number, reasons: string) =>
		`Worked out from ${count} of 7 readings; ${reasons}.`,
	tooFewReadings: (count: number, reasons: string) =>
		`A mood needs 5 of the 7 readings and ${count === 0 ? 'none' : count} ${count === 1 ? 'has' : 'have'} one today; ${reasons}.`,
	noReadings: 'No readings yet. Maester fetches them after the market closes.',

	/** Why a reading is out, inside a sentence, as "<short> <reason>". */
	missingInSentence: {
		no_source: { one: 'has no source yet', many: 'have no source yet' },
		no_data: { one: 'has no data yet', many: 'have no data yet' },
		stale: { one: 'is late', many: 'are late' },
		not_enough_history: { one: 'has too little history', many: 'have too little history' }
	} satisfies Record<MissingReason, { one: string; many: string }>,

	readingsHeading: 'The readings',
	readingsLede:
		'10 readings in 4 families. 7 make up the mood; 3 are shown beside them and aren’t scored. Each is placed against its own last 2 years.',

	families: {
		fear: { title: 'Fear gauges', blurb: 'What investors pay to protect themselves.' },
		money: { title: 'Money', blurb: 'Which way money is moving in Indian shares.' },
		breadth: { title: 'Breadth and trend', blurb: 'How many shares are carrying the market.' },
		havens: { title: 'Currency and havens', blurb: 'Where money goes when it is nervous.' }
	} satisfies Record<ReadingFamily, { title: string; blurb: string }>,

	readings: {
		india_vix: {
			name: 'India VIX',
			short: 'India VIX',
			measures: 'How big a Nifty swing option traders expect over the next 30 days.'
		},
		us_vix: {
			name: 'US VIX',
			short: 'US VIX',
			measures: 'How big an S&P 500 swing US option traders expect over the next 30 days.'
		},
		nifty_pcr: {
			name: 'Nifty put–call ratio, open interest',
			short: 'the put–call ratio',
			measures: 'Open Nifty puts for each open call, at the nearest expiry.',
			unscored: 'people read a high ratio both ways'
		},
		fpi_flows: {
			name: 'Foreign investors, net, last 20 sessions',
			short: 'foreign flows',
			plural: true,
			measures: 'What foreign investors put into Indian shares, less what they took out.'
		},
		dii_flows: {
			name: 'Indian funds, net, last 20 sessions',
			short: 'Indian fund flows',
			plural: true,
			measures: 'What Indian mutual funds and insurers put into shares, less what they took out.',
			unscored: 'shown beside foreign flows'
		},
		nifty_trend: {
			name: 'Nifty 50 against its 125-day average',
			short: 'the Nifty trend',
			measures: 'How far the Nifty 50 is above or below its average of the last 125 sessions.'
		},
		n500_above_200d: {
			name: 'Nifty 500 shares above their 200-day average',
			short: 'shares above their 200-day average',
			plural: true,
			measures: 'The share of Nifty 500 companies above their own 200-day average.'
		},
		n500_net_highs: {
			name: 'Nifty 500 new 52-week highs less lows',
			short: 'new highs less lows',
			plural: true,
			measures: 'Shares at a year’s high less shares at a year’s low, as a share of the Nifty 500.'
		},
		usd_inr: {
			name: 'Rupee per US dollar',
			short: 'the rupee',
			measures: 'How many rupees one US dollar costs. Higher means a weaker rupee.',
			unscored: 'a driver, not a sign of mood',
			rankWords: { higher: 'Weaker than', lower: 'Stronger than' }
		},
		gold_vs_nifty: {
			name: 'Gold against the Nifty, 20 days',
			short: 'gold against the Nifty',
			measures: 'Gold’s change over the last 20 sessions, less the Nifty’s.'
		}
	} satisfies Record<ReadingKey, ReadingCopy> as Record<ReadingKey, ReadingCopy>,

	rank: {
		higher: 'Higher than',
		lower: 'Lower than',
		sentence: (words: string, share: number) => `${words} ${share}% of the last 2 years`,
		soFar: (days: number) => `Ranked against ${days} ${days === 1 ? 'day' : 'days'} so far`,
		nothingYet: 'Nothing to rank against yet',
		lowest: 'lowest',
		highest: 'highest'
	},
	previous: {
		change: (change: string, sessions: number) => `${change} in ${sessions} sessions`,
		was: (value: string, day: string) => `was ${value} on ${day}`
	},
	inMood: {
		score: (score: number, band: string) => `In the mood: ${score} · ${band}`,
		unscored: (why: string) => `Not in the mood: ${why}.`,
		no_source: 'Not in the mood: no source connected yet.',
		no_data: 'Not in the mood: nothing stored yet.',
		stale: (day: string) => `Not in the mood: its last reading, ${day}, is too old.`,
		not_enough_history: 'Not in the mood until it has 250 days to rank against.'
	},
	weekdayClose: (weekday: string) => `${weekday}’s close`,
	openReading: 'Open the reading',
	backToMood: 'Back to Market mood',
	showTable: 'Show as a table',
	hideTable: 'Hide the table',

	chart: {
		heading: 'The mood, last 12 months',
		today: (score: number) => `${score} today`,
		lowest: (score: number, day: string) => `${score} · lowest, ${day}`,
		atOrBelow: (share: number) =>
			`In the last 12 months the mood was this low or lower on ${share}% of trading days.`
	},

	method: {
		heading: 'How it is worked out',
		items: [
			{
				term: 'Each reading',
				detail:
					'Ranked against its own last 2 years of daily readings, then turned so 0 is its most fearful day and 100 its most eager.'
			},
			{
				term: 'The mood',
				detail:
					'The plain average of the scored readings present, at least 5 of the 7. No reading counts more than another.'
			},
			{
				term: 'Updated',
				detail:
					'Every 30 minutes, from what Dhan and FRED have published. It says “provisional” while an Indian reading is behind the latest session.'
			},
			{
				term: 'What it isn’t',
				detail:
					'A forecast or a signal to act. Moods like this have come before falls and before recoveries. Three readings are shown but not scored: the put–call ratio, which people read both ways, Indian fund flows and the rupee.'
			}
		],
		survivorship: 'Breadth uses today’s Nifty 500 members for all past days.'
	},

	notice: {
		settings: { label: 'Open Settings', href: '/terminal/settings' },
		never: {
			title: 'Maester hasn’t fetched any market data yet.',
			detail:
				'It starts once Dhan and FRED are connected in Settings, then fetches every 30 minutes.'
		},
		firstRun: {
			title: 'Maester is fetching the first readings now.',
			detail: 'The first fetch reads up to 4 years of history, so it can take a few minutes.'
		},
		tokenExpired: {
			title: (day: string) => `Dhan stopped answering on ${day}. The token has expired.`,
			detail: (stops: string | null) =>
				stops
					? `Market mood stops at ${stops} until you save a new one in Settings.`
					: 'Market mood has no readings until you save a new one in Settings.'
		},
		fredRefused: {
			title: (day: string) => `FRED refused the key on ${day}.`,
			detail: (stops: string | null) =>
				stops
					? `US VIX and the rupee stop at ${stops} until you save a new key in Settings.`
					: 'US VIX and the rupee have no readings until you save a new key in Settings.'
		},
		rateLimited: (day: string) => `Dhan asked Maester to slow down on ${day}.`,
		unavailable: (day: string) => `A market data source didn’t answer on ${day}.`,
		unknown: (day: string) => `The last market data fetch stopped on ${day}.`,
		retry: (stops: string | null) =>
			`Maester tries again within 30 minutes. ${stops ? `The readings stop at ${stops} until then.` : 'Nothing is stored yet.'}`
	}
};
