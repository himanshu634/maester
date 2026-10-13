/**
 * Geometry for the market mood line charts (the 12-month mood and each reading's 2 years). Pure,
 * so it is tested without Svelte. Drawn in real pixels from the container's width, so the 14px
 * labels never shrink on a phone. Sessions are spaced evenly: a holiday leaves no gap.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const CHART_HEIGHT = 220;
/** Band names fit at the right only when the drawing is at least this wide. */
const BAND_NAMES_FROM = 560;

export interface Frame {
	width: number;
	height: number;
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface Scales {
	count: number;
	frame: Frame;
	x: (index: number) => number;
	y: (value: number) => number;
}

export function frameFor(width: number, opts: { bandNames: boolean; left?: number }): Frame {
	const bandNames = opts.bandNames && width >= BAND_NAMES_FROM;
	return {
		width,
		height: CHART_HEIGHT,
		top: 12,
		right: bandNames ? 112 : 12,
		bottom: 28,
		left: opts.left ?? 48
	};
}

export function scales(count: number, frame: Frame, [lo, hi]: [number, number]): Scales {
	const inner = frame.width - frame.left - frame.right;
	const tall = frame.height - frame.top - frame.bottom;
	return {
		count,
		frame,
		x: (i) => (count <= 1 ? frame.width - frame.right : frame.left + (i * inner) / (count - 1)),
		y: (v) => frame.top + (1 - (v - lo) / (hi - lo)) * tall
	};
}

export function linePath(values: number[], s: Scales): string {
	return values
		.map((v, i) => `${i === 0 ? 'M' : 'L'}${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)}`)
		.join(' ');
}

/**
 * The first session of each month, as "Nov" or "Nov 2025", leaving out labels that would touch.
 * A label with its year is about 60px wide at 14px, so those keep 80px apart.
 */
export function monthTicks(
	days: string[],
	s: Scales,
	withYear = false,
	minGap = withYear ? 80 : 56
): { x: number; label: string }[] {
	const ticks: { x: number; label: string }[] = [];
	let last = -Infinity;
	for (let i = 1; i < days.length; i++) {
		if (days[i]!.slice(0, 7) === days[i - 1]!.slice(0, 7)) continue;
		const x = s.x(i);
		if (x - last < minGap || x > s.frame.width - s.frame.right - 16) continue;
		const month = MONTHS[Number(days[i]!.slice(5, 7)) - 1]!;
		ticks.push({ x, label: withYear ? `${month} ${days[i]!.slice(0, 4)}` : month });
		last = x;
	}
	return ticks;
}

/** Index of the first lowest value, or null with none. */
export function lowest(values: number[]): number | null {
	if (values.length === 0) return null;
	let at = 0;
	for (let i = 1; i < values.length; i++) if (values[i]! < values[at]!) at = i;
	return at;
}

/** Index of the first highest value, or null for no values. */
export function highest(values: number[]): number | null {
	if (values.length === 0) return null;
	let at = 0;
	values.forEach((v, i) => {
		if (v > values[at]!) at = i;
	});
	return at;
}

function niceStep(raw: number): number {
	const pow = 10 ** Math.floor(Math.log10(raw));
	for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
	return 10 * pow;
}

/** A domain that holds every value, rounded out to whole steps of 1, 2 or 5. */
export function niceDomain(values: number[]): [number, number] {
	let lo = Math.min(...values);
	let hi = Math.max(...values);
	if (!Number.isFinite(lo)) return [0, 1];
	if (hi === lo) {
		const pad = Math.abs(lo) * 0.1 || 1;
		lo -= pad;
		hi += pad;
	}
	const step = niceStep((hi - lo) / 3);
	return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** The values to label on the axis: the domain's ends and its middle. */
export function axisValues([lo, hi]: [number, number]): number[] {
	return [lo, (lo + hi) / 2, hi];
}
