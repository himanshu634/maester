import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	HATCH_STEPS,
	RULER_STEPS,
	SHOW_AFTER_MS,
	SLOW_AFTER_MS,
	STEP_MS,
	createClock,
	stepOf,
	watchPhase,
	type ClockEnv
} from './loading';

function testEnv(over: Partial<ClockEnv> = {}) {
	const intervals = vi.fn((fn: () => void, ms: number) => setInterval(fn, ms));
	const cleared = vi.fn((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
	const env: ClockEnv = {
		setInterval: intervals,
		clearInterval: cleared,
		reducedMotion: () => false,
		hidden: () => false,
		...over
	};
	return { env, intervals, cleared };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('stepOf', () => {
	it('wraps around the number of positions', () => {
		expect(stepOf(0, RULER_STEPS)).toBe(0);
		expect(stepOf(7, RULER_STEPS)).toBe(7);
		expect(stepOf(8, RULER_STEPS)).toBe(0);
		expect(stepOf(13, HATCH_STEPS)).toBe(1);
	});

	it('never goes negative', () => {
		expect(stepOf(-1, HATCH_STEPS)).toBe(5);
	});
});

describe('createClock', () => {
	it('steps every 120 ms and tells a new listener the current count at once', () => {
		const { env } = testEnv();
		const seen: number[] = [];
		createClock(env).subscribe((n) => seen.push(n));
		vi.advanceTimersByTime(STEP_MS * 3);
		expect(seen).toEqual([0, 1, 2, 3]);
	});

	it('runs one timer for every listener, so everything moves together', () => {
		const { env, intervals } = testEnv();
		const clock = createClock(env);
		const a: number[] = [];
		const b: number[] = [];
		clock.subscribe((n) => a.push(n));
		clock.subscribe((n) => b.push(n));
		vi.advanceTimersByTime(STEP_MS * 2);
		expect(intervals).toHaveBeenCalledTimes(1);
		expect(a.at(-1)).toBe(2);
		expect(b.at(-1)).toBe(2);
	});

	it('stops its timer when the last listener leaves, and starts again for the next', () => {
		const { env, intervals, cleared } = testEnv();
		const clock = createClock(env);
		const off1 = clock.subscribe(() => {});
		const off2 = clock.subscribe(() => {});
		off1();
		expect(cleared).not.toHaveBeenCalled();
		off2();
		expect(cleared).toHaveBeenCalledTimes(1);
		clock.subscribe(() => {});
		expect(intervals).toHaveBeenCalledTimes(2);
	});

	it('never starts under reduced motion and stays on step 0', () => {
		const { env, intervals } = testEnv({ reducedMotion: () => true });
		const seen: number[] = [];
		createClock(env).subscribe((n) => seen.push(n));
		vi.advanceTimersByTime(STEP_MS * 10);
		expect(intervals).not.toHaveBeenCalled();
		expect(seen).toEqual([0]);
	});

	it('does not advance while the tab is hidden', () => {
		let hidden = true;
		const { env } = testEnv({ hidden: () => hidden });
		const seen: number[] = [];
		createClock(env).subscribe((n) => seen.push(n));
		vi.advanceTimersByTime(STEP_MS * 3);
		expect(seen).toEqual([0]);
		hidden = false;
		vi.advanceTimersByTime(STEP_MS);
		expect(seen).toEqual([0, 1]);
	});

	it('stops calling a listener that has left', () => {
		const { env } = testEnv();
		const clock = createClock(env);
		const seen: number[] = [];
		const off = clock.subscribe((n) => seen.push(n));
		const keep = clock.subscribe(() => {});
		vi.advanceTimersByTime(STEP_MS);
		off();
		vi.advanceTimersByTime(STEP_MS * 2);
		expect(seen).toEqual([0, 1]);
		keep();
	});
});

describe('watchPhase', () => {
	const env = {
		setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
		clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)
	};

	it('shows nothing for a load that ends within 300 ms', () => {
		const seen: string[] = [];
		const cancel = watchPhase((p) => seen.push(p), env);
		vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
		cancel();
		vi.advanceTimersByTime(SLOW_AFTER_MS);
		expect(seen).toEqual([]);
	});

	it('reports loading after 300 ms and slow after 10 s', () => {
		const seen: string[] = [];
		watchPhase((p) => seen.push(p), env);
		vi.advanceTimersByTime(SHOW_AFTER_MS);
		expect(seen).toEqual(['loading']);
		vi.advanceTimersByTime(SLOW_AFTER_MS - SHOW_AFTER_MS);
		expect(seen).toEqual(['loading', 'slow']);
	});

	it('stops reporting once cancelled', () => {
		const seen: string[] = [];
		const cancel = watchPhase((p) => seen.push(p), env);
		vi.advanceTimersByTime(SHOW_AFTER_MS);
		cancel();
		vi.advanceTimersByTime(SLOW_AFTER_MS);
		expect(seen).toEqual(['loading']);
	});
});
