/**
 * Design-system guard. Fails the build when any stylesheet or component drifts
 * from docs/DESIGN.md: colours outside tokens.css, radius, shadows, foreign
 * fonts, slow or blanket transitions. An escape hatch exists for a reviewed
 * exception: put `/* design-guard: allow *\/` on the offending line.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..');
const TOKENS = join(SRC, 'lib', 'styles', 'tokens.css');
const APP_CSS = join(SRC, 'app.css');
const ALLOW = 'design-guard: allow';

const NAMED_COLORS = [
	'aliceblue',
	'antiquewhite',
	'aqua',
	'aquamarine',
	'azure',
	'beige',
	'bisque',
	'black',
	'blanchedalmond',
	'blue',
	'blueviolet',
	'brown',
	'burlywood',
	'cadetblue',
	'chartreuse',
	'chocolate',
	'coral',
	'cornflowerblue',
	'cornsilk',
	'crimson',
	'cyan',
	'darkblue',
	'darkcyan',
	'darkgoldenrod',
	'darkgray',
	'darkgreen',
	'darkgrey',
	'darkkhaki',
	'darkmagenta',
	'darkolivegreen',
	'darkorange',
	'darkorchid',
	'darkred',
	'darksalmon',
	'darkseagreen',
	'darkslateblue',
	'darkslategray',
	'darkslategrey',
	'darkturquoise',
	'darkviolet',
	'deeppink',
	'deepskyblue',
	'dimgray',
	'dimgrey',
	'dodgerblue',
	'firebrick',
	'floralwhite',
	'forestgreen',
	'fuchsia',
	'gainsboro',
	'ghostwhite',
	'gold',
	'goldenrod',
	'gray',
	'green',
	'greenyellow',
	'grey',
	'honeydew',
	'hotpink',
	'indianred',
	'indigo',
	'ivory',
	'khaki',
	'lavender',
	'lavenderblush',
	'lawngreen',
	'lemonchiffon',
	'lightblue',
	'lightcoral',
	'lightcyan',
	'lightgoldenrodyellow',
	'lightgray',
	'lightgreen',
	'lightgrey',
	'lightpink',
	'lightsalmon',
	'lightseagreen',
	'lightskyblue',
	'lightslategray',
	'lightslategrey',
	'lightsteelblue',
	'lightyellow',
	'lime',
	'limegreen',
	'linen',
	'magenta',
	'maroon',
	'mediumaquamarine',
	'mediumblue',
	'mediumorchid',
	'mediumpurple',
	'mediumseagreen',
	'mediumslateblue',
	'mediumspringgreen',
	'mediumturquoise',
	'mediumvioletred',
	'midnightblue',
	'mintcream',
	'mistyrose',
	'moccasin',
	'navajowhite',
	'navy',
	'oldlace',
	'olive',
	'olivedrab',
	'orange',
	'orangered',
	'orchid',
	'palegoldenrod',
	'palegreen',
	'paleturquoise',
	'palevioletred',
	'papayawhip',
	'peachpuff',
	'peru',
	'pink',
	'plum',
	'powderblue',
	'purple',
	'rebeccapurple',
	'red',
	'rosybrown',
	'royalblue',
	'saddlebrown',
	'salmon',
	'sandybrown',
	'seagreen',
	'seashell',
	'sienna',
	'silver',
	'skyblue',
	'slateblue',
	'slategray',
	'slategrey',
	'snow',
	'springgreen',
	'steelblue',
	'tan',
	'teal',
	'thistle',
	'tomato',
	'turquoise',
	'violet',
	'wheat',
	'white',
	'whitesmoke',
	'yellow',
	'yellowgreen'
];

const HEX = /(^|[\s(,])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(/i;
const NAMED = new RegExp(`(^|[\\s,(])(?:${NAMED_COLORS.join('|')})(?=$|[\\s,);])`, 'i');
const ALLOWED_WORDS =
	/^(?:currentcolor|transparent|inherit|initial|unset|revert|revert-layer|none)$/i;
const VAR_ONLY = /^\s*var\(--[\w-]+\)\s*$/;
const RADIUS_PROP = /^border(?:-(?:top|bottom)-(?:left|right))?-radius$/;
const ZERO = /^\s*(?:0(?:px|rem|em|%)?\s*){1,4}$|^\s*var\(--radius(?:-[\w-]+)?\)\s*$/;
const SHADOW_PROP = /^(?:box-shadow|text-shadow)$/;
const SHADOW_OK = /^\s*(?:none|var\(--shadow(?:-[\w-]+)?\))\s*$/;
const FILTER_PROP = /^(?:filter|backdrop-filter)$/;
const DROP_SHADOW = /\bdrop-shadow\(/i;
const FONT_PROP = /^(?:font|font-family)$/;
const FONT_OK = /^\s*(?:inherit|var\(--font-[\w-]+\))\s*$/;
const MOTION_PROP = /^(?:transition|transition-duration|animation|animation-duration)$/;
const DURATION = /(\d*\.?\d+)(ms|s)\b/g;
const TRANSITION_ALL = /(^|[\s,])all(\s|,|$)/;
const DECL = /(?<![\w-])([a-z-]+)\s*:\s*([^;{}]+)/gi;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(svelte|css)$/.test(name)) out.push(full);
	}
	return out;
}

function cssOf(file: string): string {
	const text = readFileSync(file, 'utf8');
	if (file.endsWith('.css')) return text;
	const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
	const attrs = [...text.matchAll(/\sstyle=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(
		(m) => `x{${m[1] ?? m[2]}}`
	);
	return [...blocks, ...attrs].join('\n');
}

function declarations(css: string): [string, string][] {
	const cleaned = css
		.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes(ALLOW) ? ALLOW : ''))
		.split('\n')
		.filter((line) => !line.includes(ALLOW))
		.join('\n');
	return [...cleaned.matchAll(DECL)].map((m) => [m[1].toLowerCase(), m[2].trim()]);
}

function isTokensFile(file: string): boolean {
	return file === TOKENS;
}

describe('design guard (docs/DESIGN.md)', () => {
	const files = walk(SRC);
	const violations: string[] = [];

	for (const file of files) {
		const rel = relative(SRC, file);
		for (const [prop, value] of declarations(cssOf(file))) {
			const flag = (rule: string) => violations.push(`${rel}: ${prop}: ${value}  [${rule}]`);
			const isVar = VAR_ONLY.test(value);
			if (!isTokensFile(file) && !isVar && !ALLOWED_WORDS.test(value)) {
				if (HEX.test(value) || COLOR_FN.test(value) || NAMED.test(value))
					flag('colour outside tokens');
			}
			if (RADIUS_PROP.test(prop) && !ZERO.test(value)) flag('radius must be 0');
			if (prop === '--radius' && !/^0(px)?$/.test(value)) flag('--radius must stay 0');
			if (SHADOW_PROP.test(prop) && !SHADOW_OK.test(value)) flag('no shadows');
			if (prop === '--shadow' && value !== 'none') flag('--shadow must stay none');
			if (FILTER_PROP.test(prop) && DROP_SHADOW.test(value)) flag('no drop-shadow');
			if (!isTokensFile(file) && FONT_PROP.test(prop) && !FONT_OK.test(value))
				flag('font outside tokens');
			if (MOTION_PROP.test(prop)) {
				if (TRANSITION_ALL.test(value)) flag('transition: all is forbidden');
				for (const m of value.matchAll(DURATION)) {
					const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
					if (ms > 300) flag('motion over 300ms');
				}
			}
		}
	}

	it('scans real files', () => {
		expect(files.some((f) => f.endsWith('.svelte'))).toBe(true);
		expect(files).toContain(TOKENS);
	});

	it('keeps colour literals inside tokens.css only', () => {
		expect(readFileSync(TOKENS, 'utf8')).toMatch(HEX);
		expect(readFileSync(TOKENS, 'utf8')).toMatch(/--font-sans:[^;]*Archivo/);
	});

	it('has the global reduced-motion kill switch', () => {
		const app = readFileSync(APP_CSS, 'utf8');
		const block = app.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\}\s*\}/);
		expect(block?.[0]).toMatch(/transition-duration/);
		expect(block?.[0]).toMatch(/animation-duration/);
	});

	it('has no violations', () => {
		expect(violations).toEqual([]);
	});
});
