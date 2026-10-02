import { describe, expect, it } from 'vitest';
import { dueItems } from './due';
import { demo, quietDemo, WEEK } from './fixture';
import { allocationNote, coverageNote, dueRow, gainNote, hasDetail, shortDate } from './overview';
import { valuePortfolio } from './portfolio';

const busy = valuePortfolio(demo.holdings);
const quiet = valuePortfolio(quietDemo.holdings);

describe('overview copy', () => {
	it('writes the collapsed due rows as frame C1 shows them', () => {
		const [review, ...rest] = dueItems(busy, { ...WEEK, limit: demo.limit });
		expect(hasDetail(review)).toBe(true);
		expect(rest.map((item) => dueRow(item, busy, demo.limit))).toEqual([
			{
				title: 'Meridian Bank is over your 20% limit',
				detail: '23.9% of priced value · ₹6,44,960'
			},
			{ title: 'Tamarind Textiles has no price', detail: '2,000 shares left out of value' }
		]);
	});

	it('gives a review without expanded copy a plain row', () => {
		const item = { kind: 'review', holding: 'Northgate Pharma', weight: 11.1 } as const;
		expect(hasDetail(item)).toBe(false);
		expect(dueRow(item, busy, demo.limit)).toEqual({
			title: 'Northgate Pharma review is due',
			detail: 'Due 14 Oct'
		});
		expect(shortDate('2026-10-03')).toBe('3 Oct');
	});

	it('notes the gain and coverage for both weeks', () => {
		expect(gainNote(busy)).toBe('+16.9% on the 7 holdings with a known cost. 2 left out.');
		expect(gainNote(quiet)).toBe('+16.0% on the 8 holdings with a known cost. 1 left out.');
		expect(coverageNote(busy)).toBe('Tamarind Textiles has no price');
		expect(coverageNote(quiet)).toBe('Every holding has a price');
	});

	it('explains the dashed bar, and the unpriced holding only when there is one', () => {
		expect(allocationNote(busy)).toBe(
			'Share of priced value. The dashed bar is Lantern Logistics, which has no sector yet. Tamarind Textiles stays out until it has a price.'
		);
		expect(allocationNote(quiet)).toBe(
			'Share of priced value. The dashed bar is Lantern Logistics, which has no sector yet.'
		);
	});
});
