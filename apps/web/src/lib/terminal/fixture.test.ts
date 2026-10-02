import { describe, expect, it } from 'vitest';
import { demo, dueDetail, quietChecks, quietDemo } from './fixture';
import { valuePortfolio } from './portfolio';

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
});
