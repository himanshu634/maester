import { describe, expect, it } from 'vitest';
import { demo } from './fixture';
import { valuePortfolio, type Holding } from './portfolio';

const v = valuePortfolio(demo.holdings);
const holding = (name: string) => {
	const found = v.holdings.find((h) => h.name === name);
	if (!found) throw new Error(`fixture has no ${name}`);
	return found;
};

describe('valuePortfolio on the demo portfolio', () => {
	it('sums the value of priced holdings only', () => {
		expect(v.knownValue).toBe(2703690);
		expect(v.priced).toBe(8);
		expect(v.count).toBe(9);
	});

	it('computes unrealized gain over holdings with both price and cost', () => {
		expect(v.gain).toBe(366960);
		expect(v.gainPercent.toFixed(1)).toBe('16.9');
		expect(v.withCost).toBe(7);
	});

	it('weighs each holding against the known value', () => {
		expect(holding('Meridian Bank').weight?.toFixed(1)).toBe('23.9');
	});

	it('groups sectors by share, largest first, with the unknown bucket last', () => {
		const first = v.sectors[0];
		const last = v.sectors[v.sectors.length - 1];
		expect(first.label).toBe('Materials');
		expect(first.share.toFixed(1)).toBe('25.0');
		expect(first.unknown).toBe(false);
		expect(last.label).toBe('Sector not set');
		expect(last.share.toFixed(1)).toBe('7.1');
		expect(last.unknown).toBe(true);
		const shares = v.sectors.slice(0, -1).map((s) => s.share);
		expect(shares).toEqual([...shares].sort((a, b) => b - a));
	});

	it('leaves unpriced holdings out of the sectors', () => {
		expect(v.sectors.some((s) => s.label === 'Consumer discretionary')).toBe(false);
		expect(v.sectors.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(100, 6);
	});

	it('sorts holdings by value, largest first, unpriced last', () => {
		const last = v.holdings[v.holdings.length - 1];
		expect(last.name).toBe('Tamarind Textiles');
		expect(last.value).toBeNull();
		expect(last.weight).toBeNull();
		expect(v.holdings[0].name).toBe('Meridian Bank');
		const values = v.holdings.slice(0, -1).map((h) => h.value ?? 0);
		expect(values).toEqual([...values].sort((a, b) => b - a));
	});
});

describe('valuePortfolio edge cases', () => {
	const make = (over: Partial<Holding>): Holding => ({
		name: 'Test Co',
		quantity: 10,
		price: 100,
		cost: 80,
		sector: 'Utilities',
		reviewDate: null,
		...over
	});

	it('does not divide by zero when nothing is priced', () => {
		const empty = valuePortfolio([make({ price: null })]);
		expect(empty.knownValue).toBe(0);
		expect(empty.priced).toBe(0);
		expect(empty.gainPercent).toBe(0);
		expect(empty.holdings[0].weight).toBeNull();
		expect(empty.sectors).toEqual([]);
	});

	it('does not mutate its input', () => {
		const input = [make({ name: 'A', price: 1 }), make({ name: 'B', price: 2 })];
		valuePortfolio(input);
		expect(input.map((h) => h.name)).toEqual(['A', 'B']);
	});
});
