/**
 * All copy for the public pages lives here so it can be reviewed in one place.
 *
 * Rules (docs/DESIGN.md, section 7): market the product, not the technology.
 * No model names, frameworks, commands or file paths. Every company, figure or
 * event used as an example is synthetic and labelled as such. Never claim a
 * feature is live before its journey is implemented and tested.
 */
import type { Pathname } from '$app/types';

/** Internal destinations only: a known route, optionally with a search string or fragment. */
export type Href = Pathname | `${Pathname}?${string}` | `${Pathname}#${string}`;

export interface Link {
	label: string;
	href: Href;
}

export interface LedgerRow {
	title: string;
	first: string;
	second: string;
}

export interface Principle {
	term: string;
	body: string;
}

export interface ComparisonRow {
	before: string;
	after: string;
}

export interface SiteContent {
	masthead: { wordmark: string; nav: Link[]; terminal: Link };
	index: { title: string; links: Link[] };
	hero: { title: string; lede: string; primary: Link; secondary: Link };
	problem: { heading: string; noise: string[]; body: string };
	suggestion: {
		heading: string;
		tag: string;
		label: string;
		value: string;
		meta: string;
		rows: { term: string; detail: string }[];
	};
	features: {
		heading: string;
		intro: string;
		columns: [string, string, string];
		rows: LedgerRow[];
		note: string;
	};
	how: {
		heading: string;
		intro: string;
		columns: [string, string, string];
		rows: LedgerRow[];
		note: string;
	};
	week: { heading: string; intro: string; columns: [string, string]; rows: ComparisonRow[] };
	trust: { heading: string; intro: string; principles: Principle[]; measured: string };
	status: { heading: string; paragraphs: string[]; cta: Link };
	footer: { note: string };
	login: { heading: string; lede: string; notConnected: string };
	terminal: { heading: string; checking: string; noScript: string; placeholder: string };
}

export const content = {
	masthead: {
		wordmark: 'Maester',
		nav: [
			{ label: 'What it watches', href: '/#features' },
			{ label: 'How it works', href: '/#how' },
			{ label: 'Why trust it', href: '/#trust' },
			{ label: 'Where we are', href: '/#status' }
		],
		terminal: { label: 'Enter the terminal', href: '/terminal' }
	},
	index: {
		title: 'On this page',
		links: [
			{ label: 'The job nobody has time for', href: '/#problem' },
			{ label: 'What it watches', href: '/#features' },
			{ label: 'How it works', href: '/#how' },
			{ label: 'Your week, before and after', href: '/#week' },
			{ label: 'Why trust it', href: '/#trust' }
		]
	},
	hero: {
		title: 'Your portfolio, watched around the clock.',
		lede: 'Maester follows the filings, the prices, the dividends and the policy changes behind every company you own, and tells you when a decision is due. You stop scanning feeds. You decide.',
		primary: { label: 'Enter the terminal', href: '/terminal' },
		secondary: { label: 'See what it watches', href: '/#features' }
	},
	problem: {
		heading: 'The job nobody has time for',
		noise: [
			'A post claims a promoter is selling. Is it true, and does it matter to you?',
			'A budget line changes the tax treatment for one sector. Which of your holdings is in it?',
			'Quarterly results land at six in the evening with a forty-page presentation attached.',
			'A position has quietly grown from a tenth of your portfolio to a third.',
			'A dividend was declared three months ago. It never arrived, and nobody noticed.',
			'A rate decision moves the whole market. Your holdings may not care at all.'
		],
		body: 'Keeping up means reading everything, every day, or reading nothing and hoping. Most investors end up doing the monitoring late, by hand, or not at all. The reason you bought a stock lives in a forgotten spreadsheet, and nobody checks whether it still holds.'
	},
	suggestion: {
		heading: 'What a suggestion looks like',
		tag: 'Synthetic example. Not a real company.',
		label: 'Review your thesis on Harbour Cements',
		value: 'Due this week',
		meta: 'Triggered by the FY2025 annual report, published two days ago',
		rows: [
			{
				term: 'Trigger',
				detail:
					'Operating cash flow fell 18% year on year. Your saved thesis depended on cash generation.'
			},
			{
				term: 'Evidence',
				detail:
					'Cash flow statement, page 96. The number, the page it came from and the calculation are one click away.'
			},
			{
				term: 'Your call',
				detail:
					'Hold, trim or revise the thesis. Maester records what you decide and why. It never trades.'
			}
		]
	},
	features: {
		heading: 'What Maester watches so you do not have to',
		intro:
			'You set the scope once. Maester runs the loop every day: watch, spot a meaningful change, check it against the evidence, and hand you a suggestion with the reasons attached.',
		columns: ['Signal', 'What it watches', 'What you get'],
		rows: [
			{
				title: 'Filings and results',
				first:
					'Annual reports, quarterly results and restated numbers for every company you own, read the day they are published.',
				second:
					'The handful of numbers that moved against your thesis, with the page they came from. Not a summary, the page.'
			},
			{
				title: 'Prices and concentration',
				first:
					'Drawdowns, drift from the allocation you set, and positions that have grown larger than you meant them to be.',
				second:
					'A nudge before a position becomes a problem, with the limit you set and the number it crossed.'
			},
			{
				title: 'Dividends and income',
				first: 'Declared versus received distributions, upcoming payouts and reinvestment gaps.',
				second:
					'An income calendar, and a flag the week a payment that should have arrived did not.'
			},
			{
				title: 'Policy and the wider market',
				first:
					'Budgets, rate decisions, regulatory changes, currency and commodity moves, checked against what your portfolio actually holds.',
				second:
					'"No move needed" as often as "act", with the exposure that conclusion was based on. Silence you can trust.'
			},
			{
				title: 'Your ledger',
				first:
					'Imports, duplicate trades, unexplained cash differences and positions that no longer match a statement.',
				second:
					'Books that tie out without a weekend of spreadsheets, and a flag on the exact trade that does not.'
			},
			{
				title: 'Your own thesis',
				first: 'Why you bought each holding, the risk you accepted, and the review date you set.',
				second:
					'A reminder when a review is due, with the evidence for and against, so the decision is yours and informed.'
			}
		],
		note: 'Suggestions are ranked by what matters to your holdings and your thesis, never by how often they would make you trade.'
	},
	how: {
		heading: 'How it works for you',
		intro: 'Five steps. The first two are yours, once. The rest happen every day without you.',
		columns: ['Step', 'What happens', 'What you get'],
		rows: [
			{
				title: 'Bring in what you own',
				first:
					'Import your holdings once from a broker export or type them in. Maester keeps them reconciled from then on.',
				second: 'One place that knows your whole portfolio, across brokers.'
			},
			{
				title: 'Say why you own it',
				first:
					'Write the thesis behind each holding, the concentration you accept and when you want to revisit it.',
				second: 'Suggestions that are about your reasons, not a generic model portfolio.'
			},
			{
				title: 'Maester watches',
				first: 'Filings, prices, dividends, policy and your own deadlines, every day.',
				second: 'Your evenings back. Nothing to scan, nothing to miss.'
			},
			{
				title: 'You get a suggestion, with the evidence',
				first: 'Each one names the action, the trigger and the page it came from.',
				second: 'A decision you can check in a minute instead of a feed you read for an hour.'
			},
			{
				title: 'You decide, Maester remembers',
				first:
					'Review, hold, trim or ignore. Maester records the outcome and why. It never places an order.',
				second: 'A record of every decision, and sharper suggestions the longer you use it.'
			}
		],
		note: 'Nothing changes in your portfolio unless you change it. Execution stays with you and your broker.'
	},
	week: {
		heading: 'Your week, before and after',
		intro: 'The same portfolio, the same markets, a different amount of your time.',
		columns: ['Without Maester', 'With Maester'],
		rows: [
			{
				before:
					'Scroll feeds and news channels to find out whether anything happened to the companies you own.',
				after:
					'A short digest of what actually changed in your holdings, with the evidence behind each item.'
			},
			{
				before: 'Read a three-hundred-page annual report, or skip it and hope.',
				after: 'The numbers that moved against your thesis, and the page they came from.'
			},
			{
				before: 'Notice a position is a third of the portfolio when it is already a problem.',
				after: 'A nudge the week it drifts past the limit you set.'
			},
			{
				before: 'Discover at tax time that a dividend never arrived.',
				after: 'Declared versus received, flagged the week it goes missing.'
			},
			{
				before: 'Wonder whether the budget or the rate decision changes anything for you.',
				after: 'Checked against your actual holdings. "No move needed" when it does not.'
			},
			{
				before: 'Reconcile broker statements by hand, or not at all.',
				after: 'Books that tie out, and a flag on the one trade that does not.'
			}
		]
	},
	trust: {
		heading: 'Why you can act on it',
		intro:
			'A suggestion is only useful if you can check it in a minute. Every one is built to be checked.',
		principles: [
			{
				term: 'It shows its source.',
				body: 'Every number in a suggestion links to the page of the filing it came from, not to a summary of it.'
			},
			{
				term: 'It says when it does not know.',
				body: 'If the evidence is missing, the suggestion says so and asks for the input. A guess is never dressed up as a fact.'
			},
			{
				term: 'It tells you what was checked.',
				body: 'Whether a number was read from the filing, calculated, or reviewed by you is always shown separately. No single confidence score.'
			},
			{
				term: 'It never trades.',
				body: 'Maester suggests, explains and records. Placing an order stays with you and your broker.'
			},
			{
				term: 'It does not push you to act.',
				body: 'Suggestions are ranked by relevance to your thesis and your risk, not by activity. "Stay put" is a valid answer.'
			},
			{
				term: 'Your data stays yours.',
				body: 'Export everything at any time: holdings, extracted numbers, notes and every suggestion. Open source and self-hostable.'
			}
		],
		measured:
			'Before each release, suggestions and the numbers behind them are checked against a held-out set of real filings. We publish what was measured rather than a single accuracy figure.'
	},
	status: {
		heading: 'Where we are',
		paragraphs: [
			'Maester is early and built in the open. The part that reads annual reports and answers questions about them works today. The watching loop, the ledger and the terminal are being built next, starting with Indian markets and long-term equity investors.',
			'We would rather tell you what works than what we hope will. Nothing on this page is a promise of a date.'
		],
		cta: { label: 'Enter the terminal', href: '/terminal' }
	},
	footer: {
		note: 'Maester is a working name. Open source, built in public. Every company, figure and event on this page is synthetic. No license has been selected yet.'
	},
	login: {
		heading: 'Sign in to the terminal',
		lede: 'The terminal is where your holdings, your thesis and your suggestions live.',
		notConnected:
			'Sign-in is not open yet. Accounts arrive with the first release of the terminal. Nothing you typed was sent anywhere.'
	},
	terminal: {
		heading: 'The terminal',
		checking: 'Checking your session.',
		noScript: 'Sign in to enter the terminal.',
		placeholder:
			'You have a session, but the terminal has no screens yet. The first release adds your holdings and the filings behind them.'
	}
} as const satisfies SiteContent;
