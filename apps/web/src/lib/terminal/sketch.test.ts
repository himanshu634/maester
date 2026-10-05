import { describe, expect, it } from 'vitest';
import { angleAround, angleStep, clamp, toViewBox } from './sketch';

describe('clamp', () => {
	it('keeps a value inside its range', () => {
		expect(clamp(5, 0, 10)).toBe(5);
		expect(clamp(-3, 0, 10)).toBe(0);
		expect(clamp(42, 0, 10)).toBe(10);
	});
});

describe('toViewBox', () => {
	it('maps a pointer on a scaled drawing into the drawing’s own units', () => {
		const box = { left: 100, top: 50, width: 260, height: 240 };
		expect(toViewBox({ clientX: 100, clientY: 50 }, box, 520, 480)).toEqual({ x: 0, y: 0 });
		expect(toViewBox({ clientX: 230, clientY: 170 }, box, 520, 480)).toEqual({ x: 260, y: 240 });
		expect(toViewBox({ clientX: 360, clientY: 290 }, box, 520, 480)).toEqual({ x: 520, y: 480 });
	});
});

describe('angleStep', () => {
	it('takes the short way round across the ±π seam', () => {
		expect(angleStep(0.1, 0.3)).toBeCloseTo(0.2);
		expect(angleStep(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
		expect(angleStep(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
	});
});

describe('angleAround', () => {
	it('measures from the right, clockwise on screen', () => {
		const centre = { x: 10, y: 10 };
		expect(angleAround({ x: 20, y: 10 }, centre)).toBeCloseTo(0);
		expect(angleAround({ x: 10, y: 20 }, centre)).toBeCloseTo(Math.PI / 2);
		expect(angleAround({ x: 0, y: 10 }, centre)).toBeCloseTo(Math.PI);
	});
});
