import { describe, expect, it } from 'vitest';
import { dueItems } from './due';
import { demo, quietDemo, WEEK } from './fixture';
import { valuePortfolio } from './portfolio';

describe('dueItems', () => {
	it('ranks decisions before data fixes on the demo portfolio', () => {
		const items = dueItems(valuePortfolio(demo.holdings), { ...WEEK, limit: demo.limit });
		expect(items).toEqual([
			{ kind: 'review', holding: 'Harbour Cements', weight: expect.any(Number) },
			{ kind: 'limit', holding: 'Meridian Bank', weight: expect.any(Number) },
			{ kind: 'missing-price', holding: 'Tamarind Textiles', weight: null }
		]);
	});

	it('is empty in the quiet week', () => {
		const items = dueItems(valuePortfolio(quietDemo.holdings), {
			...WEEK,
			limit: quietDemo.limit
		});
		expect(items).toEqual([]);
	});

	it('counts review dates on either edge of the week, and nothing outside it', () => {
		const v = valuePortfolio(demo.holdings);
		const at = (today: string, weekEnd: string) =>
			dueItems(v, { today, weekEnd, limit: 100 })
				.filter((i) => i.kind === 'review')
				.map((i) => i.holding);
		expect(at('2026-10-03', '2026-10-04')).toEqual(['Harbour Cements']);
		expect(at('2026-09-28', '2026-10-03')).toEqual(['Harbour Cements']);
		expect(at('2026-10-04', '2026-10-10')).toEqual([]);
		expect(at('2026-10-14', '2026-10-14')).toEqual(['Northgate Pharma']);
	});

	it('does not flag a holding sitting exactly on the limit', () => {
		const v = valuePortfolio(demo.holdings);
		const meridian = v.holdings.find((h) => h.name === 'Meridian Bank')?.weight ?? 0;
		const items = dueItems(v, { ...WEEK, limit: meridian });
		expect(items.some((i) => i.kind === 'limit')).toBe(false);
	});

	it('puts the larger weight first within a category', () => {
		const v = valuePortfolio(demo.holdings);
		const limits = dueItems(v, { ...WEEK, limit: 5 }).filter((i) => i.kind === 'limit');
		const weights = limits.map((i) => i.weight ?? 0);
		expect(limits.length).toBeGreaterThan(1);
		expect(weights).toEqual([...weights].sort((a, b) => b - a));
	});
});
