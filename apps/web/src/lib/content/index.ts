/**
 * All copy for the public pages lives here so it can be reviewed in one place.
 *
 * Rules (docs/DESIGN.md, section 7): market the product, not the technology.
 * No model names, frameworks, commands or file paths. Every company, figure or
 * event used as an example is synthetic and labelled as such. Never claim a
 * feature is live before its journey is implemented and tested.
 */
import type { Pathname } from '$app/types';

/**
 * Internal destinations only: the index page and its sections, or the terminal. Kept to the few
 * routes the public copy links to, because resolve() cannot take a union of every route once
 * there are more than 25 (the compiler stops matching the argument against its overloads).
 */
export type Href = Extract<Pathname, '/' | '/terminal' | '/terminal/demo'> | `/#${string}`;

export interface Link {
	label: string;
	href: Href;
}

/** Off-site destinations: profiles and email. Never routed through the router. */
export interface ExternalLink {
	label: string;
	href: `https://${string}` | `mailto:${string}`;
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
	status: { heading: string; paragraphs: string[]; cta: Link; demo: Link };
	footer: { note: string; links: ExternalLink[] };
	login: { heading: string; lede: string };
	terminal: { checking: string; noScript: string };
}

export const content = {
	masthead: {
		wordmark: 'Maester',
		nav: [
			{ label: 'What it will watch', href: '/#features' },
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
			{ label: 'What it will watch', href: '/#features' },
			{ label: 'How it works', href: '/#how' },
			{ label: 'Your week, before and after', href: '/#week' },
			{ label: 'Why trust it', href: '/#trust' }
		]
	},
	hero: {
		title: 'Every figure, with the filing it came from.',
		lede: 'Maester reads the filings of the companies you own, shows the filing and the page or tag behind every number and keeps your holdings beside them. Later, it will watch them for you and tell you when your thesis needs a look. You decide.',
		primary: { label: 'Enter the terminal', href: '/terminal' },
		secondary: { label: 'See what it will watch', href: '/#features' }
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
		heading: 'What a review prompt will look like',
		tag: 'Planned. Synthetic example. Not a real company.',
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
					'Keep the thesis, revise it or look again later. Maester records what you decide and why. It never trades.'
			}
		]
	},
	features: {
		heading: 'What Maester will watch',
		intro:
			'This is planned. Today you add the filings yourself and Maester reads them. Next, you set the scope once and Maester runs the loop every day: watch, spot a meaningful change, check it against the evidence, and hand you a review prompt with the reasons attached.',
		columns: ['Signal', 'What it will watch', 'What you get'],
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
					'"Nothing to review" as often as "look at this", with the exposure that conclusion was based on. Silence you can trust.'
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
		note: 'Review prompts are ranked by what matters to your holdings and your thesis, never by how often they would make you trade.'
	},
	how: {
		heading: 'How it works for you',
		intro:
			'Five steps. Step one works today. Steps two to five are planned: you write your thesis once, then Maester will watch and prompt you every day without you.',
		columns: ['Step', 'What happens', 'What you get'],
		rows: [
			{
				title: 'Bring in what you own',
				first:
					'Connect Zerodha from Holdings and Maester reads what you hold there. It only reads: it cannot place an order or move money. More brokers are planned.',
				second: 'Your holdings in one place, valued at the NSE close, with the figures behind them.'
			},
			{
				title: 'Say why you own it (planned)',
				first:
					'You will write the thesis behind each holding, the concentration you accept and when you want to revisit it.',
				second: 'Review prompts that are about your reasons, not a generic model portfolio.'
			},
			{
				title: 'Maester will watch',
				first: 'Filings, prices, dividends, policy and your own deadlines, every day.',
				second: 'Your evenings back. Nothing to scan, nothing to miss.'
			},
			{
				title: 'You get a review prompt, with the evidence',
				first: 'Each one names the trigger, the figure and the page it came from.',
				second: 'A decision you can check in a minute instead of a feed you read for an hour.'
			},
			{
				title: 'You decide, Maester remembers',
				first:
					'Review it, revise your thesis or set it aside. Maester records the outcome and why. It never places an order.',
				second: 'A record of every decision and the reason you gave.'
			}
		],
		note: 'Nothing changes in your portfolio unless you change it. Execution stays with you and your broker.'
	},
	week: {
		heading: 'Your week, before and after',
		intro:
			'The same portfolio, the same markets, a different amount of your time. "With Maester" is the planned loop, not what runs today.',
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
				after: 'Checked against your actual holdings. "Nothing to review" when it does not.'
			},
			{
				before: 'Reconcile broker statements by hand, or not at all.',
				after: 'Books that tie out, and a flag on the one trade that does not.'
			}
		]
	},
	trust: {
		heading: 'Why you can check it',
		intro:
			'A figure or a review prompt is only useful if you can check it in a minute. Every one is built to be checked. Export, notes, recorded decisions and calculated figures are planned; what is described here as running today is the reading of filings and the source behind each number.',
		principles: [
			{
				term: 'It shows its source.',
				body: 'Every number points to the filing it came from, and to the page or the tag behind it, not to a summary of it.'
			},
			{
				term: 'It says when it does not know.',
				body: 'If the evidence is missing, Maester says so and asks for the input. A guess is never dressed up as a fact.'
			},
			{
				term: 'It tells you what was checked.',
				body: 'Whether a number was read from the filing’s own tags, read from the PDF by a model, or reviewed by you is always shown separately. No single confidence score.'
			},
			{
				term: 'It never trades.',
				body: 'Maester shows, explains and records. Placing an order stays with you and your broker.'
			},
			{
				term: 'It does not push you to act.',
				body: 'Review prompts are ranked by relevance to your thesis and your risk, not by activity. "Nothing to review" is a valid answer.'
			},
			{
				term: 'Your data stays yours.',
				body: 'Open source and self-hostable, so your holdings and the numbers read from your filings stay on your machine. Export, notes and a record of your decisions are planned.'
			}
		],
		measured:
			'Measuring the numbers behind each figure and review prompt against a held-out set of real filings is planned. We will publish what was measured under the evaluation reports, rather than a single accuracy figure.'
	},
	status: {
		heading: 'Where we are',
		paragraphs: [
			'Maester is early and built in the open. Today it reads filings and shows the page behind each figure, builds research tables, reads your Zerodha holdings and tracks market mood. It runs on your own machine. Figure review and calculations come next; the watching loop after them. It starts with Indian markets and long-term equity investors.',
			'We would rather tell you what works than what we hope will. Nothing on this page is a promise of a date.'
		],
		cta: { label: 'Enter the terminal', href: '/terminal' },
		demo: { label: 'Explore the synthetic demo', href: '/terminal/demo' }
	},
	footer: {
		note: 'Maester is a working name. Every company, figure and event on this page is synthetic. Maester is free and open source under the GNU Affero General Public License, version 3 or later. Built in public by Himanshu Mendapara.',
		links: [
			{ label: 'GitHub', href: 'https://github.com/himanshu634/maester' },
			{ label: 'X', href: 'https://x.com/himanshu_btw' },
			{ label: 'Email', href: 'mailto:himanshumendapra@gmail.com' }
		]
	},
	login: {
		heading: 'Sign in to the terminal',
		lede: 'The terminal is where your filings, your holdings and the evidence behind every figure live.'
	},
	terminal: {
		checking: 'Checking your session.',
		noScript: 'Sign in to enter the terminal.'
	}
} as const satisfies SiteContent;
