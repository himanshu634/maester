import { describe, expect, it } from 'vitest';
import { frameFor, highest, linePath, lowest, monthTicks, niceDomain, scales } from './chart';

const days = (n: number, from = '2026-01-01') =>
	Array.from({ length: n }, (_, i) => {
		const d = new Date(`${from}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() + i);
		return d.toISOString().slice(0, 10);
	});

describe('frameFor', () => {
	it('keeps room on the right for band names only when the drawing is wide', () => {
		expect(frameFor(680, { bandNames: true }).right).toBeGreaterThan(80);
		expect(frameFor(340, { bandNames: true }).right).toBeLessThan(20);
		expect(frameFor(680, { bandNames: false }).right).toBeLessThan(20);
	});
});

describe('scales', () => {
	it('spreads sessions evenly and puts the domain floor on the axis', () => {
		const frame = frameFor(400, { bandNames: false });
		const s = scales(5, frame, [0, 100]);
		expect(s.x(0)).toBe(frame.left);
		expect(s.x(4)).toBe(frame.width - frame.right);
		expect(s.y(0)).toBe(frame.height - frame.bottom);
		expect(s.y(100)).toBe(frame.top);
	});

	it('puts a single point at the right edge', () => {
		const frame = frameFor(400, { bandNames: false });
		expect(scales(1, frame, [0, 100]).x(0)).toBe(frame.width - frame.right);
	});
});

describe('linePath', () => {
	it('draws one move then a line to each later point', () => {
		const frame = frameFor(400, { bandNames: false });
		const path = linePath([10, 20, 30], scales(3, frame, [0, 100]));
		expect(path.startsWith('M')).toBe(true);
		expect(path.match(/L/g)).toHaveLength(2);
	});

	it('draws nothing without points', () => {
		const frame = frameFor(400, { bandNames: false });
		expect(linePath([], scales(0, frame, [0, 100]))).toBe('');
	});
});

describe('monthTicks', () => {
	it('marks the first session of each month, dropping labels that would touch', () => {
		const ds = days(120, '2026-01-15');
		const frame = frameFor(600, { bandNames: false });
		const ticks = monthTicks(ds, scales(ds.length, frame, [0, 100]));
		expect(ticks.map((t) => t.label)).toEqual(['Feb', 'Mar', 'Apr', 'May']);
		const narrow = frameFor(160, { bandNames: false });
		const few = monthTicks(ds, scales(ds.length, narrow, [0, 100]));
		expect(few.length).toBeLessThan(4);
	});

	it('adds the year when asked', () => {
		const ds = days(60, '2025-12-20');
		const frame = frameFor(600, { bandNames: false });
		expect(monthTicks(ds, scales(ds.length, frame, [0, 100]), true)[0]?.label).toBe('Jan 2026');
	});
});

describe('lowest', () => {
	it('finds the first lowest point', () => {
		expect(lowest([5, 3, 9, 3])).toBe(1);
		expect(lowest([])).toBeNull();
	});
});

describe('niceDomain', () => {
	it('pads the values and rounds out to whole steps', () => {
		expect(niceDomain([11.2, 24.7])).toEqual([10, 25]);
		expect(niceDomain([-4.2, 3.1])).toEqual([-5, 5]);
	});

	it('gives a flat series some height', () => {
		const [lo, hi] = niceDomain([7, 7]);
		expect(lo).toBeLessThan(7);
		expect(hi).toBeGreaterThan(7);
	});
});

describe('frameFor left', () => {
	it('takes a wider left gutter for longer axis labels', () => {
		expect(frameFor(600, { bandNames: false }).left).toBe(48);
		expect(frameFor(600, { bandNames: false, left: 72 }).left).toBe(72);
	});
});

describe('highest', () => {
	it('finds the first highest point', () => {
		expect(highest([1, 5, 3, 5])).toBe(1);
		expect(highest([])).toBeNull();
	});
});
