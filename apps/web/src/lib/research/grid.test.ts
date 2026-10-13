import { describe, expect, it } from 'vitest';
import { move } from './grid';

describe('move', () => {
	it('moves one figure with the arrows and stops at the edges', () => {
		expect(move({ r: 1, c: 1 }, 'ArrowRight', 5, 4)).toEqual({ r: 1, c: 2 });
		expect(move({ r: 1, c: 3 }, 'ArrowRight', 5, 4)).toEqual({ r: 1, c: 3 });
		expect(move({ r: 0, c: 0 }, 'ArrowUp', 5, 4)).toEqual({ r: 0, c: 0 });
		expect(move({ r: 4, c: 0 }, 'ArrowDown', 5, 4)).toEqual({ r: 4, c: 0 });
	});
	it('jumps to the ends of a row with Home and End', () => {
		expect(move({ r: 2, c: 2 }, 'Home', 5, 4)).toEqual({ r: 2, c: 0 });
		expect(move({ r: 2, c: 0 }, 'End', 5, 4)).toEqual({ r: 2, c: 3 });
	});
	it('leaves other keys alone', () => {
		expect(move({ r: 0, c: 0 }, 'Tab', 5, 4)).toBeNull();
	});
});
