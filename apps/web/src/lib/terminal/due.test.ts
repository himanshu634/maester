import { describe, expect, it } from 'vitest';
import { dueItems, mixesDecisionsAndData } from './due';
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

	it('counts review dates up to the end of the week, and nothing after it', () => {
		const v = valuePortfolio(demo.holdings);
		const at = (today: string, weekEnd: string) =>
			dueItems(v, { today, weekEnd, limit: 100 })
				.filter((i) => i.kind === 'review')
				.map((i) => i.holding);
		expect(at('2026-10-03', '2026-10-04')).toEqual(['Harbour Cements']);
		expect(at('2026-09-28', '2026-10-03')).toEqual(['Harbour Cements']);
		expect(at('2026-09-20', '2026-09-27')).toEqual([]);
		expect(at('2026-10-14', '2026-10-14')).toEqual(['Harbour Cements', 'Northgate Pharma']);
	});

	it('keeps an overdue review due until it is reviewed', () => {
		const v = valuePortfolio(demo.holdings);
		const items = dueItems(v, { today: '2026-10-05', weekEnd: '2026-10-11', limit: 100 });
		// Harbour Cements was due 3 Oct, before this week starts.
		expect(items.filter((i) => i.kind === 'review')).toEqual([
			{ kind: 'review', holding: 'Harbour Cements', weight: expect.any(Number) }
		]);
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

	it('says the items mix decisions and data fixes only when both are present', () => {
		const review = { kind: 'review', holding: 'A', weight: 10 } as const;
		const limit = { kind: 'limit', holding: 'B', weight: 30 } as const;
		const missing = { kind: 'missing-price', holding: 'C', weight: null } as const;
		expect(mixesDecisionsAndData([review, limit, missing])).toBe(true);
		expect(mixesDecisionsAndData([limit, missing])).toBe(true);
		expect(mixesDecisionsAndData([review, limit])).toBe(false);
		expect(mixesDecisionsAndData([missing, { ...missing, holding: 'D' }])).toBe(false);
		expect(mixesDecisionsAndData([])).toBe(false);
	});
});
