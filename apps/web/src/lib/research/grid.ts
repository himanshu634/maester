/** Arrow-key movement between the figures of a statement table: one tab stop, moved by keys. */
export type Pos = { r: number; c: number };

export function move(pos: Pos, key: string, rows: number, cols: number): Pos | null {
	const clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, n));
	switch (key) {
		case 'ArrowUp':
			return { r: clamp(pos.r - 1, rows), c: pos.c };
		case 'ArrowDown':
			return { r: clamp(pos.r + 1, rows), c: pos.c };
		case 'ArrowLeft':
			return { r: pos.r, c: clamp(pos.c - 1, cols) };
		case 'ArrowRight':
			return { r: pos.r, c: clamp(pos.c + 1, cols) };
		case 'Home':
			return { r: pos.r, c: 0 };
		case 'End':
			return { r: pos.r, c: cols - 1 };
		default:
			return null;
	}
}
