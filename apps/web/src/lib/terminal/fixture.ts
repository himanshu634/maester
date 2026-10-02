/**
 * The synthetic demo portfolio behind /terminal/demo. Every company, holding, price and
 * figure here is made up. Nothing in this file describes a real security or a real person.
 */
import { percent } from './format';
import type { Check } from './due';
import type { Holding, Valuation } from './portfolio';

export interface ResearchItem {
	title: string;
	/** Short date, as shown. */
	when: string;
	body: string;
	action: string;
}

export interface Demo {
	holdings: readonly Holding[];
	/** Largest share of known value any one holding may take, in percent. */
	limit: number;
	cash: number;
	asOf: string;
	research: readonly ResearchItem[];
}

/** The demo week: Friday 3 Oct falls inside it, Tuesday 14 Oct does not. */
export const WEEK = { today: '2026-10-02', weekEnd: '2026-10-04' } as const;

const holdings: readonly Holding[] = [
	{
		name: 'Meridian Bank',
		quantity: 400,
		price: 1612.4,
		cost: 1385.0,
		sector: 'Financials',
		reviewDate: null
	},
	{
		name: 'Harbour Cements',
		quantity: 120,
		price: 4280.0,
		cost: 3610.0,
		sector: 'Materials',
		reviewDate: '2026-10-03'
	},
	{
		name: 'Quill Software',
		quantity: 300,
		price: 1455.25,
		cost: 1102.5,
		sector: 'Information technology',
		reviewDate: null
	},
	{
		name: 'Northgate Pharma',
		quantity: 250,
		price: 1198.6,
		cost: 1060.0,
		sector: 'Health care',
		reviewDate: '2026-10-14'
	},
	{
		name: 'Saffron Foods',
		quantity: 900,
		price: 268.35,
		cost: 241.2,
		sector: 'Consumer staples',
		reviewDate: null
	},
	{
		name: 'Kestrel Power',
		quantity: 1500,
		price: 142.1,
		cost: 128.4,
		sector: 'Utilities',
		reviewDate: null
	},
	{
		name: 'Lantern Logistics',
		quantity: 600,
		price: 318.9,
		cost: 302.0,
		sector: null,
		reviewDate: null
	},
	{
		name: 'Coral Chemicals',
		quantity: 180,
		price: 905.0,
		cost: null,
		sector: 'Materials',
		reviewDate: null
	},
	{
		name: 'Tamarind Textiles',
		quantity: 2000,
		price: null,
		cost: 96.5,
		sector: 'Consumer discretionary',
		reviewDate: null
	}
];

const asOf = 'Holdings as of 30 Sep 2026 · prices you entered on 1 Oct · Indian rupees';

const research: readonly ResearchItem[] = [
	{
		title: 'Harbour Cements · FY2025 annual report',
		when: '30 Sep',
		body: 'Operating cash flow fell 18% year on year, from ₹1,412 crore to ₹1,158 crore.',
		action: 'Open page 96'
	},
	{
		title: 'Quill Software · Q2 results',
		when: '29 Sep',
		body: 'Revenue up 11% year on year. Read and checked; nothing you follow moved.',
		action: 'Open the results'
	},
	{
		title: 'Kestrel Power · dividend declared',
		when: '26 Sep',
		body: '₹2.50 a share, record date 17 Oct. Expected ₹3,750 on your 1,500 shares.',
		action: 'See the announcement'
	}
];

/** The week with items due: Tamarind has no price, Meridian is over a 20% limit. */
export const demo: Demo = { holdings, limit: 20, cash: 112400, asOf, research };

/** The quiet week: Tamarind priced, Harbour already reviewed, limit raised to 25%. */
export const quietDemo: Demo = {
	holdings: holdings.map((h) => {
		if (h.name === 'Tamarind Textiles') return { ...h, price: 102.4 };
		if (h.name === 'Harbour Cements') return { ...h, reviewDate: '2027-01-14' };
		return h;
	}),
	limit: 25,
	cash: 112400,
	asOf,
	research: [
		{
			title: 'Harbour Cements · FY2025 annual report',
			when: '30 Sep',
			body: 'Reviewed by you on 1 Oct. You held and revised the thesis; next review 14 Jan.',
			action: 'See your decision'
		},
		research[1],
		research[2]
	]
};

/** The expanded review item in the "Due this week" panel. */
export const dueDetail = {
	title: 'Review your thesis on Harbour Cements',
	tag: 'Due Friday 3 Oct',
	meta: 'Triggered by the FY2025 annual report, published 30 Sep',
	trigger:
		'Operating cash flow fell 18% year on year. Your thesis note says the case rests on cash generation.',
	evidence: 'Cash flow statement, page 96.',
	call: 'Hold, trim or revise the thesis. Maester records what you decide and why. It never trades.'
} as const;

/** What was looked at, shown when nothing is due. Silence is a checked answer. */
export function quietChecks(v: Valuation, limit: number): Check[] {
	const [largest] = v.holdings;
	return [
		{
			label: 'New filings',
			detail:
				'Harbour Cements annual report, reviewed by you on 1 Oct. Quill Software Q2 results, 29 Sep: nothing crossed a line you set.'
		},
		{ label: 'Review dates', detail: 'Next one: Northgate Pharma, Tuesday 14 Oct.' },
		{
			label: 'Position limit',
			detail: `Largest holding is ${largest.name} at ${percent(largest.weight ?? 0)} of your ${limit}% limit.`
		},
		{ label: 'Prices', detail: 'All nine holdings priced on 1 Oct.' }
	];
}
