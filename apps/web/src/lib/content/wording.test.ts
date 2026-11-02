import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { content } from './index';
import { authContent } from './auth';
import { terminalContent } from './terminal';
import * as fixture from '$lib/terminal/fixture';

// ADR 0010: Maester prompts a review; it never advises a trade.
const ADVICE =
	/\b(trim|trims|sell|sells|buy|buys|reduces?|exits?|accumulate|add to)\b|\bhold(,| or )|\bor hold\b|stay put|no move needed/i;

describe('ADR 0010 wording', () => {
	it('the pattern catches the advice verbs and spares ordinary words', () => {
		for (const bad of [
			'Hold, trim or revise',
			'Buy more',
			'sell it',
			'trim or hold',
			'Add to it',
			'Stay put'
		])
			expect(bad).toMatch(ADVICE);
		for (const ok of ['still holds', 'actually holds', 'what you hold there', 'You held it'])
			expect(ok).not.toMatch(ADVICE);
	});
	it('public index copy advises no trade', () => {
		expect(JSON.stringify(content)).not.toMatch(ADVICE);
	});
	it('index meta description advises no trade', () => {
		expect(
			readFileSync(join(import.meta.dirname, '../../routes/+page.svelte'), 'utf8')
		).not.toMatch(ADVICE);
	});
	it('auth copy advises no trade', () => {
		expect(JSON.stringify(authContent)).not.toMatch(ADVICE);
	});
	it('terminal copy advises no trade', () => {
		expect(JSON.stringify(terminalContent)).not.toMatch(ADVICE);
	});
	it('every fixture export advises no trade', () => {
		expect(JSON.stringify({ ...fixture })).not.toMatch(ADVICE);
	});
	it('demo due item advises no trade', () => {
		expect(JSON.stringify(fixture.dueDetail)).not.toMatch(ADVICE);
	});
	it('suggestion example keeps its synthetic tag', () => {
		expect(content.suggestion.tag).toMatch(/Synthetic example/);
	});
});
