/** Number formats for the terminal. Indian digit grouping, rupees, a real minus sign. */

const MINUS = '−';

const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** Whole rupees: `₹27,03,690`. `sign` adds `+` to a positive amount; a negative always gets `−`. */
export function inr(n: number, opts: { sign?: boolean } = {}): string {
	const rounded = Math.round(n);
	const body = `₹${whole.format(Math.abs(rounded))}`;
	if (rounded < 0) return MINUS + body;
	return opts.sign && rounded > 0 ? `+${body}` : body;
}

/** A per-share price in rupees and paise: `₹1,612.40`. */
export function price(n: number): string {
	return `₹${twoDecimals.format(n)}`;
}

/** A share count: `1,500`. */
export function quantity(n: number): string {
	return whole.format(n);
}

/** A percentage: `23.9%`. */
export function percent(n: number, digits = 1): string {
	const body = `${Math.abs(n).toFixed(digits)}%`;
	return n < 0 && Number(body.slice(0, -1)) !== 0 ? MINUS + body : body;
}
