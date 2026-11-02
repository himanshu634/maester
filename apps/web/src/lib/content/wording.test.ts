import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './index';
import { dueDetail } from '$lib/terminal/fixture';

// ADR 0010: Maester prompts a review; it never advises a trade.
const ADVICE = /\b(trim|trims|sell|sells|buy|buys)\b|stay put|no move needed/i;

describe('ADR 0010 wording', () => {
	it('public index copy advises no trade', () => {
		expect(JSON.stringify(content)).not.toMatch(ADVICE);
	});
	it('index meta description advises no trade', () => {
		expect(readFileSync('src/routes/+page.svelte', 'utf8')).not.toMatch(ADVICE);
	});
	it('demo due item advises no trade', () => {
		expect(JSON.stringify(dueDetail)).not.toMatch(ADVICE);
	});
	it('suggestion example keeps its synthetic tag', () => {
		expect(content.suggestion.tag).toMatch(/Synthetic example/);
	});
});
