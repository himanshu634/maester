import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { holdingsContent as copy } from '$lib/content/holdings';
import type { HoldingPart, HoldingsSnapshot } from '$lib/holdings/types';
import HoldingsByBroker from './HoldingsByBroker.svelte';
import HoldingsLedger from './HoldingsLedger.svelte';

// Both ledgers rendered on the server, to read the broker line's average-cost cell as the page
// prints it. The figures are the API's, already worked out: nothing here computes one.
const part = (over: Partial<HoldingPart> = {}): HoldingPart => ({
	broker: 'kite',
	accountId: 'ZK0001',
	quantity: '120',
	averagePrice: null,
	cost: null,
	value: '209112.00',
	gain: null,
	gainPercent: null,
	readAt: '2026-10-19T03:00:00Z',
	stale: false,
	...over
});

const snapshot = (p: HoldingPart): HoldingsSnapshot => ({
	accounts: [
		{
			broker: 'kite',
			name: 'Zerodha',
			state: 'signed_in',
			accountId: 'ZK0001',
			keyLast4: '1234',
			savedAt: '2026-10-18T03:00:00Z',
			signedInAt: '2026-10-19T03:00:00Z',
			signedOutAt: null,
			lastReadAt: '2026-10-19T03:00:00Z',
			lastReadCount: 1,
			errorCode: null
		}
	],
	rows: [
		{
			isin: 'INE040A01034',
			symbol: 'HDFCBANK',
			exchange: 'NSE',
			parts: [p],
			quantity: '120',
			cost: p.cost,
			close: { value: '1742.60', day: '2026-10-16', source: 'Dhan · NSE close' },
			value: '209112.00',
			weight: '100.0',
			gain: p.gain,
			gainPercent: p.gainPercent,
			unknown: p.cost === null ? ['NO_COST'] : []
		}
	],
	totals: {
		knownValue: '209112.00',
		priced: 1,
		count: 1,
		cost: p.cost,
		costed: p.cost === null ? 0 : 1,
		unrealizedGain: p.gain,
		gainCovers: p.gain === null ? 0 : 1,
		gainPercent: p.gainPercent
	},
	accountTotals: [
		{
			broker: 'kite',
			knownValue: '209112.00',
			priced: 1,
			count: 1,
			cost: p.cost,
			costed: p.cost === null ? 0 : 1,
			gain: p.gain,
			gainCovers: p.gain === null ? 0 : 1,
			gainPercent: p.gainPercent
		}
	],
	closeDay: '2026-10-16',
	calculations: [{ id: 'holding_average_price', version: 2 }]
});

/** The cells, after its row header, of the first table row whose header holds `header`. */
function cells(html: string, header: string): string[] {
	const tr = html
		.match(/<tr[\s\S]*?<\/tr>/g)
		?.find((r) => r.match(/<th[\s\S]*?<\/th>/)?.[0].includes(header));
	if (!tr) throw new Error(`no row headed ${header}`);
	return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
		m[1]!.replace(/<!--[\s\S]*?-->/g, '')
	);
}

const unknownCost = `<span aria-hidden="true">—</span><span class="visually-hidden">${copy.table.noCost}</span>`;

describe('the broker line’s average cost', () => {
	// The broker's line: under the company in the ledger, the share's own row by broker. Columns
	// after the row header: quantity, average cost, invested, …
	const ledgers = [
		['HoldingsLedger', HoldingsLedger, 'Zerodha'],
		['HoldingsByBroker', HoldingsByBroker, 'HDFCBANK']
	] as const;

	it.each(ledgers)(
		'%s shows an unknown average as "—" with the reason read out, never ₹0.00',
		(_, Ledger, row) => {
			const { body } = render(Ledger, { props: { snapshot: snapshot(part()) } });
			const [quantity, average, cost] = cells(body, row);
			expect(quantity).toBe('120');
			expect(average).toBe(unknownCost);
			expect(cost).toBe(unknownCost);
			expect(body).not.toContain('₹0.00');
		}
	);

	it.each(ledgers)('%s shows an average the broker gave in rupees', (_, Ledger, row) => {
		const known = part({
			averagePrice: '1512.4',
			cost: '181488.00',
			gain: '27624.00',
			gainPercent: '15.2'
		});
		const { body } = render(Ledger, { props: { snapshot: snapshot(known) } });
		const [, average, cost] = cells(body, row);
		expect(average).toBe('₹1,512.40');
		expect(cost).toBe('₹1,81,488.00');
	});
});
