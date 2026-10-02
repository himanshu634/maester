import { describe, expect, it } from 'vitest';
import { demo, dueDetail, quietChecks, quietDemo } from './fixture';
import { valuePortfolio, type Holding } from './portfolio';

describe('fixture', () => {
	it('differs between the two demos only where the quiet week needs it', () => {
		const changed = demo.holdings.filter(
			(h, i) => JSON.stringify(h) !== JSON.stringify(quietDemo.holdings[i])
		);
		expect(changed.map((h) => h.name)).toEqual(['Harbour Cements', 'Tamarind Textiles']);
		expect(valuePortfolio(quietDemo.holdings).priced).toBe(9);
	});

	it('computes the position-limit check from the valuation', () => {
		const checks = quietChecks(valuePortfolio(quietDemo.holdings), quietDemo.limit);
		expect(checks.map((c) => c.label)).toEqual([
			'New filings',
			'Review dates',
			'Position limit',
			'Prices'
		]);
		expect(checks[2].detail).toBe('Largest holding is Meridian Bank at 22.2% of your 25% limit.');
	});

	it('gives the review detail evidence with no link', () => {
		expect(dueDetail.evidence).toBe('Cash flow statement, page 96.');
	});

	it('names the holding the review detail describes', () => {
		expect(dueDetail.holding).toBe('Harbour Cements');
		expect(dueDetail.title).toContain(dueDetail.holding);
	});

	it('offers no research actions, since none has a destination yet', () => {
		for (const item of [...demo.research, ...quietDemo.research]) {
			expect(Object.keys(item).sort()).toEqual(['body', 'title', 'when']);
		}
	});

	it('shows the position limit as unknown, never zero, when nothing is priced', () => {
		const unpriced: Holding[] = demo.holdings.map((h) => ({ ...h, price: null }));
		const [, , limit] = quietChecks(valuePortfolio(unpriced), 25);
		expect(limit.detail).toBe(
			'No holding has a price, so the largest share is — of your 25% limit.'
		);
		expect(limit.detail).not.toMatch(/0\.0%/);
		const [, , empty] = quietChecks(valuePortfolio([]), 25);
		expect(empty.detail).toBe(limit.detail);
	});
});
