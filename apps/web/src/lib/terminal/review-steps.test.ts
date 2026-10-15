import { describe, expect, it } from 'vitest';
import { terminalContent } from '$lib/content/terminal';

const analyst = terminalContent.comingSoon.pages.analyst;
const desk = analyst.desk;
const allCopy = [
	analyst.what,
	analyst.needs,
	desk.today.title,
	desk.today.body,
	desk.stepsHeading,
	desk.sourceHeading,
	desk.sourceBody,
	...desk.steps.flatMap((step) => [
		step.name,
		step.who,
		step.reads,
		step.writes,
		step.never,
		step.status
	])
].join('\n');

describe('the Analyst page’s review steps', () => {
	it('runs six steps in order and ends with your call, the one step that is yours', () => {
		expect(desk.steps.map((step) => step.name)).toEqual([
			'Read the filings',
			'Read the price',
			'Argue both sides',
			'Weigh them',
			'Check your limits',
			'Your call'
		]);
		expect(desk.steps.filter((step) => step.yours).map((step) => step.name)).toEqual(['Your call']);
	});

	it('says that no step is built yet, and only the limits wait for Holdings', () => {
		expect(desk.steps.map((step) => step.status)).toEqual([
			'Not built yet',
			'Not built yet',
			'Not built yet',
			'Not built yet',
			'Needs Holdings',
			'Today: you'
		]);
	});

	it('gives every step what it reads, what it writes and what it never does', () => {
		for (const step of desk.steps) {
			expect(step.reads).not.toBe('');
			expect(step.writes).not.toBe('');
			expect(step.never).not.toBe('');
		}
		expect(desk.steps.at(-1)?.never).toMatch(/never places an order/);
	});

	it('speaks of buying and selling only to rule them out', () => {
		const advice = desk.steps.filter((step) =>
			/\b(buy|sell)\b/i.test(`${step.reads} ${step.writes}`)
		);
		expect(advice).toEqual([]);
		expect(desk.steps.find((step) => /\bbuy or sell\b/.test(step.never))?.name).toBe('Weigh them');
	});

	it('markets the desk, not the technology, and claims no certainty', () => {
		expect(allCopy).not.toMatch(/\b(AI|agents?|models?|LLM|prompts?)\b/i);
		expect(allCopy).not.toMatch(/\b(confidence|confident|certain|accuracy|accurate)\b/i);
		expect(allCopy).not.toMatch(/\d+(\.\d+)?%/);
	});
});
