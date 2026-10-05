/**
 * The timing of every wait in the terminal, kept free of Svelte so it can be tested.
 *
 * Waiting is shown in two ways, both driven by one clock: the ruler (an ink block that
 * steps along a rule) and the hatch (placeholder boxes whose lines drift). One step is
 * 120 ms, the same step the evidence trace uses. A page clock sets the step, rather than a
 * CSS animation, because the design guard caps animation at 300 ms and a pass is longer.
 */

export const STEP_MS = 120;
/** Positions of the ruler's block along its rule. A pass is 960 ms. */
export const RULER_STEPS = 8;
/** Pixels the hatch drifts before its pattern repeats. A pass is 720 ms. */
export const HATCH_STEPS = 6;
/** A load that finishes sooner than this shows nothing at all. */
export const SHOW_AFTER_MS = 300;
/** After this long the wait is said out loud and the person gets a way to try again. */
export const SLOW_AFTER_MS = 10_000;

/** Which of `steps` positions the shared count `n` falls on. */
export function stepOf(n: number, steps: number): number {
	return ((n % steps) + steps) % steps;
}

export interface ClockEnv {
	setInterval(fn: () => void, ms: number): unknown;
	clearInterval(id: unknown): void;
	/** Read when the clock starts: with reduced motion nothing ever moves. */
	reducedMotion(): boolean;
	/** A hidden tab does not advance. */
	hidden(): boolean;
}

export interface Clock {
	/** Calls `listener` now and on every step. Returns the function that stops listening. */
	subscribe(listener: (count: number) => void): () => void;
}

/**
 * One shared clock: every ruler and hatch on the page reads the same count, so they move
 * together and read as one motion. It ticks only while something listens.
 */
export function createClock(env: ClockEnv, stepMs: number = STEP_MS): Clock {
	const listeners = new Set<(count: number) => void>();
	let timer: unknown;
	let running = false;
	let count = 0;

	function start() {
		if (running || env.reducedMotion()) return;
		running = true;
		timer = env.setInterval(() => {
			if (env.hidden()) return;
			count += 1;
			for (const listener of listeners) listener(count);
		}, stepMs);
	}

	function stop() {
		if (!running) return;
		env.clearInterval(timer);
		running = false;
	}

	return {
		subscribe(listener) {
			listeners.add(listener);
			listener(env.reducedMotion() ? 0 : count);
			start();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) stop();
			};
		}
	};
}

export type WaitPhase = 'quiet' | 'loading' | 'slow';

export interface PhaseEnv {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(id: unknown): void;
}

/**
 * Reports `'loading'` once the wait passes SHOW_AFTER_MS and `'slow'` once it passes
 * SLOW_AFTER_MS. Before the first, the phase is `'quiet'` and nothing is drawn. Returns the
 * function that cancels both timers, to call when the wait ends.
 */
export function watchPhase(
	onPhase: (phase: WaitPhase) => void,
	env: PhaseEnv,
	after: { show: number; slow: number } = { show: SHOW_AFTER_MS, slow: SLOW_AFTER_MS }
): () => void {
	const show = env.setTimeout(() => onPhase('loading'), after.show);
	const slow = env.setTimeout(() => onPhase('slow'), after.slow);
	return () => {
		env.clearTimeout(show);
		env.clearTimeout(slow);
	};
}

/** The real browser, for the components. Not used on the server. */
export const browserEnv: ClockEnv & PhaseEnv = {
	setInterval: (fn, ms) => window.setInterval(fn, ms),
	clearInterval: (id) => window.clearInterval(id as number),
	setTimeout: (fn, ms) => window.setTimeout(fn, ms),
	clearTimeout: (id) => window.clearTimeout(id as number),
	reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	hidden: () => document.hidden
};
