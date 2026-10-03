import { describe, expect, it } from 'vitest';
import { dueItems } from './due';
import { demo, dueDetail, quietDemo, WEEK } from './fixture';
import {
	allocationNote,
	coverageNote,
	dueRow,
	dueSubtitle,
	gainNote,
	hasDetail,
	shortDate
} from './overview';
import { valuePortfolio, type Holding } from './portfolio';

const busy = valuePortfolio(demo.holdings);
const quiet = valuePortfolio(quietDemo.holdings);

describe('overview copy', () => {
	it('writes the collapsed due rows as frame C1 shows them', () => {
		const [review, ...rest] = dueItems(busy, { ...WEEK, limit: demo.limit });
		expect(review.holding).toBe(dueDetail.holding);
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

	it('never prints an unknown as zero, and gives an undated review no detail', () => {
		const limit = { kind: 'limit', holding: 'Nobody', weight: null } as const;
		expect(dueRow(limit, busy, demo.limit).detail).toBe('— of priced value · —');
		const missing = { kind: 'missing-price', holding: 'Nobody', weight: null } as const;
		expect(dueRow(missing, busy, demo.limit).detail).toBe('Its shares are left out of value');
		const review = { kind: 'review', holding: 'Meridian Bank', weight: 23.9 } as const;
		expect(dueRow(review, busy, demo.limit).detail).toBeNull();
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

	it('states the order in the subtitle only when decisions and data fixes are both due', () => {
		const items = dueItems(busy, { ...WEEK, limit: demo.limit });
		expect(dueSubtitle(items)).toBe('3 items. Decisions first, then data to fix.');
		const decisions = items.filter((i) => i.kind !== 'missing-price');
		expect(dueSubtitle(decisions)).toBe('2 items.');
		const data = items.filter((i) => i.kind === 'missing-price');
		expect(dueSubtitle(data)).toBe('1 item.');
	});
});

describe('overview copy for a portfolio with unknowns', () => {
	const make = (over: Partial<Holding>): Holding => ({
		name: 'Test Co',
		quantity: 10,
		price: 100,
		cost: 80,
		sector: 'Utilities',
		reviewDate: null,
		...over
	});

	it('never writes a zero percent gain when nothing is priced', () => {
		const v = valuePortfolio([make({ price: null }), make({ name: 'B', price: null })]);
		const note = gainNote(v);
		expect(note).toBe('Counts holdings with a price and a known cost; none has both yet.');
		expect(note).not.toMatch(/0\.0%|\b0 holdings\b/);
		expect(coverageNote(v)).toBe('2 holdings have no price');
		expect(allocationNote(v)).toBe(
			'Share of priced value. 2 holdings stay out until they have a price.'
		);
	});

	it('never writes a zero percent gain when nothing priced has a cost', () => {
		const v = valuePortfolio([make({ cost: null })]);
		expect(gainNote(v)).toBe('Counts holdings with a price and a known cost; none has both yet.');
	});

	it('shows the gain percent as unknown when the known cost is zero', () => {
		const v = valuePortfolio([make({ cost: 0 }), make({ name: 'B', cost: null })]);
		expect(gainNote(v)).toBe('— on the 1 holding with a known cost. 1 left out.');
	});
});
