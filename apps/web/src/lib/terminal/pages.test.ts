import { describe, expect, it } from 'vitest';
import { signInAgainHref } from '$lib/errors/errors';
import { listLabels, pagesIn, terminalPage, terminalPages } from './pages';

describe('terminalPages', () => {
	it('lists the first release in rail order', () => {
		expect(terminalPages.map((page) => page.label)).toEqual([
			'Overview',
			'Holdings',
			'Research',
			'Watchlist',
			'Documents',
			'Analyst',
			'Activity',
			'Settings'
		]);
	});

	it('groups portfolio pages, research pages, and Activity and Settings at the foot', () => {
		expect(pagesIn('portfolio').map((page) => page.key)).toEqual(['overview', 'holdings']);
		expect(pagesIn('research').map((page) => page.key)).toEqual([
			'research',
			'watchlist',
			'documents',
			'analyst'
		]);
		expect(pagesIn('foot').map((page) => page.key)).toEqual(['activity', 'settings']);
	});

	it('keeps the overview at /terminal, where sign-in lands, and every page under it', () => {
		expect(terminalPage('overview').path).toBe('/terminal');
		for (const page of terminalPages) {
			expect(page.path === '/terminal' || page.path === `/terminal/${page.key}`).toBe(true);
		}
		expect(new Set(terminalPages.map((page) => page.path)).size).toBe(terminalPages.length);
	});

	it('never lists a demo route', () => {
		expect(terminalPages.some((page) => page.path.startsWith('/terminal/demo'))).toBe(false);
	});

	it('marks every page as coming soon until it works, Documents included', () => {
		expect(terminalPages.every((page) => page.soon)).toBe(true);
	});

	it('sends a signed-out visitor to sign-in and back to the page they asked for', () => {
		expect(signInAgainHref(terminalPage('holdings').path)).toBe(
			'/login?next=%2Fterminal%2Fholdings'
		);
		expect(signInAgainHref(terminalPage('overview').path)).toBe('/login?next=%2Fterminal');
	});
});

describe('listLabels', () => {
	it('joins labels into one sentence-ready list', () => {
		expect(listLabels(pagesIn('foot'))).toBe('Activity and Settings');
		expect(listLabels(pagesIn('portfolio').slice(0, 1))).toBe('Overview');
		expect(listLabels([])).toBe('');
		expect(listLabels(terminalPages)).toBe(
			'Overview, Holdings, Research, Watchlist, Documents, Analyst, Activity and Settings'
		);
	});
});
