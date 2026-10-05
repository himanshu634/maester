import { createClock, browserEnv, stepOf, type Clock } from './loading';

let clock: Clock | undefined;

/**
 * The current position (0 to `steps - 1`) of the page's shared wait clock. Call it while a
 * component is being set up; it listens until the component goes away. On the server and
 * under reduced motion it stays at 0.
 */
export function useStep(steps: number) {
	let count = $state(0);

	$effect(() => {
		clock ??= createClock(browserEnv);
		return clock.subscribe((n) => {
			count = n;
		});
	});

	return {
		get current() {
			return stepOf(count, steps);
		}
	};
}
