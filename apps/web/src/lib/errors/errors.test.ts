import { describe, expect, it, vi } from 'vitest';
import { checkConnection, clockTime, errorTime, errorView, signInAgainHref } from './errors';

describe('errorView', () => {
	it('treats a lost connection as offline, whatever the status', () => {
		expect(errorView({ status: 500, path: '/', online: false })).toEqual({
			kind: 'offline',
			shell: false
		});
		expect(errorView({ status: 404, path: '/terminal/demo', online: false })).toEqual({
			kind: 'offline',
			shell: true
		});
	});

	it('keeps a missing page inside the demo terminal in its shell', () => {
		expect(errorView({ status: 404, path: '/terminal/demo/holdings', online: true })).toEqual({
			kind: 'terminal-not-found',
			shell: true
		});
	});

	it('shows any other missing address as the public not-found page', () => {
		expect(errorView({ status: 404, path: '/termnal', online: true })).toEqual({
			kind: 'not-found',
			shell: false
		});
		// The signed-in terminal has no shell yet, so its missing pages stay public.
		expect(errorView({ status: 404, path: '/terminal/holdings', online: true }).shell).toBe(false);
		expect(errorView({ status: 404, path: '/terminal/demoish', online: true }).kind).toBe(
			'not-found'
		);
	});

	it('maps signed-out and no-access statuses to their own pages', () => {
		expect(errorView({ status: 401, path: '/terminal', online: true }).kind).toBe('signed-out');
		expect(errorView({ status: 403, path: '/terminal', online: true }).kind).toBe('no-access');
	});

	it('treats everything else as a page that failed to load', () => {
		expect(errorView({ status: 500, path: '/terminal/demo/quiet', online: true })).toEqual({
			kind: 'failed',
			shell: true
		});
		expect(errorView({ status: 418, path: '/', online: true })).toEqual({
			kind: 'failed',
			shell: false
		});
	});
});

describe('checkConnection', () => {
	it('is online when the site answers', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: true });
		expect(await checkConnection(fetcher, '/robots.txt')).toBe(true);
		expect(fetcher).toHaveBeenCalledWith('/robots.txt', { method: 'HEAD', cache: 'no-store' });
	});

	it('is offline when the request fails or the site answers with an error', async () => {
		expect(await checkConnection(vi.fn().mockRejectedValue(new TypeError('fail')), '/x')).toBe(
			false
		);
		expect(await checkConnection(vi.fn().mockResolvedValue({ ok: false }), '/x')).toBe(false);
	});
});

describe('errorTime', () => {
	it('reads as a day, a short month, a year and a 24-hour time', () => {
		expect(errorTime(new Date('2026-10-03T14:02:00Z'), 'UTC')).toBe('3 Oct 2026, 14:02');
	});
});

describe('clockTime', () => {
	it('is a 24-hour time', () => {
		expect(clockTime(new Date('2026-10-03T09:05:00Z'), 'UTC')).toBe('09:05');
	});
});

describe('signInAgainHref', () => {
	it('sends you back to the page you were on', () => {
		expect(signInAgainHref('/terminal/demo')).toBe('/login?next=%2Fterminal%2Fdemo');
	});

	it('never sends you off the site', () => {
		expect(signInAgainHref('//evil.example')).toBe('/login?next=%2Fterminal');
	});
});
