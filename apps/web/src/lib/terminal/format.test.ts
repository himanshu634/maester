import { describe, expect, it } from 'vitest';
import { inr, percent, price, quantity } from './format';

describe('inr', () => {
	it('groups digits the Indian way with a rupee prefix', () => {
		expect(inr(2703690)).toBe('₹27,03,690');
		expect(inr(112400)).toBe('₹1,12,400');
		expect(inr(950)).toBe('₹950');
	});

	it('rounds to whole rupees', () => {
		expect(inr(1234.56)).toBe('₹1,235');
	});

	it('marks positive amounts with + only when asked', () => {
		expect(inr(366960, { sign: true })).toBe('+₹3,66,960');
		expect(inr(366960)).toBe('₹3,66,960');
	});

	it('writes negative amounts with the minus sign, not a hyphen', () => {
		expect(inr(-5000)).toBe('−₹5,000');
		expect(inr(-5000, { sign: true })).toBe('−₹5,000');
	});

	it('never shows a signed zero', () => {
		expect(inr(-0.4)).toBe('₹0');
		expect(inr(0, { sign: true })).toBe('₹0');
	});
});

describe('price', () => {
	it('always shows two decimals', () => {
		expect(price(1612.4)).toBe('₹1,612.40');
		expect(price(268.35)).toBe('₹268.35');
	});
});

describe('quantity', () => {
	it('groups digits with no currency', () => {
		expect(quantity(1500)).toBe('1,500');
	});
});

describe('percent', () => {
	it('defaults to one decimal', () => {
		expect(percent(23.85)).toBe('23.9%');
		expect(percent(25.02)).toBe('25.0%');
	});

	it('takes the number of digits', () => {
		expect(percent(100, 0)).toBe('100%');
	});

	it('writes negatives with the minus sign', () => {
		expect(percent(-4.25)).toBe('−4.3%');
	});
});
