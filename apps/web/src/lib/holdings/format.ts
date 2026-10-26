/**
 * Formats the API's decimal strings for Holdings without turning them into numbers: Indian
 * digit grouping, rupees, a real minus sign. Nothing here rounds or computes; a figure arrives
 * already worked out, and only its digits are arranged.
 */

const MINUS = '−';
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** `2261390` → `22,61,390`: the last three digits, then pairs. */
export function groupIndian(digits: string): string {
	const trimmed = digits.replace(/^0+(?=\d)/, '');
	if (trimmed.length <= 3) return trimmed;
	const head = trimmed.slice(0, -3);
	const tail = trimmed.slice(-3);
	return `${head.replace(/\B(?=(\d{2})+$)/g, ',')},${tail}`;
}

function parts(value: string): { negative: boolean; whole: string; fraction: string } {
	const m = DECIMAL.exec(value.trim());
	if (!m) throw new Error(`not a decimal string: ${value}`);
	return { negative: m[1] === '-' && /[1-9]/.test(value), whole: m[2]!, fraction: m[3] ?? '' };
}

/**
 * Rupees with paise: `₹2,61,390.00`. A price stored with fewer places is shown with two
 * (`1742.6` → `₹1,742.60`); one with more keeps them all, since cutting digits would round.
 */
export function rupees(value: string, opts: { sign?: boolean } = {}): string {
	const { negative, whole, fraction } = parts(value);
	const body = `₹${groupIndian(whole)}.${fraction.padEnd(2, '0')}`;
	if (negative) return MINUS + body;
	return opts.sign && /[1-9]/.test(value) ? `+${body}` : body;
}

/** A share count: `1,500`, or `12.5` for a fractional one. */
export function shares(value: string): string {
	const { negative, whole, fraction } = parts(value);
	return `${negative ? MINUS : ''}${groupIndian(whole)}${fraction && /[1-9]/.test(fraction) ? `.${fraction.replace(/0+$/, '')}` : ''}`;
}

/** A weight the API worked out to one place: `61.8%`. */
export function percentText(value: string): string {
	return `${value}%`;
}

/** A signed per cent the API worked out to one place: `+15.2%`, `−7.8%`, `0.0%`. */
export function signedPercent(value: string): string {
	const { negative, whole, fraction } = parts(value);
	const body = `${whole}${fraction ? `.${fraction}` : ''}%`;
	if (negative) return MINUS + body;
	return /[1-9]/.test(value) ? `+${body}` : body;
}

/** Which way a signed figure points, read from its sign (nothing is compared): for its colour, after the sign. */
export function direction(value: string): 'gain' | 'loss' | 'flat' {
	const { negative } = parts(value);
	if (negative) return 'loss';
	return /[1-9]/.test(value) ? 'gain' : 'flat';
}
