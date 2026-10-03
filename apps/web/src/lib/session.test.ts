import { describe, expect, it } from 'vitest';
import { endSession, readSession, safeNext, verifyCallback } from './session';

describe('safeNext', () => {
	it('keeps a same-site path', () => {
		expect(safeNext('/terminal/demo')).toBe('/terminal/demo');
		expect(safeNext('/terminal?tab=holdings')).toBe('/terminal?tab=holdings');
	});

	it.each([
		null,
		'',
		'terminal',
		'//evil.com',
		'/\\evil.com',
		'https://evil.com',
		'/%2F%2Fevil.com',
		'/%5Cevil.com',
		'javascript:alert(1)',
		'/login\nSet-Cookie: x=1',
		'/%0d%0aX'
	])('falls back for %j', (candidate) => {
		expect(safeNext(candidate)).toBe('/terminal');
	});

	it('keeps a doubly encoded path on this site', () => {
		// Decoded once it is "/%2F%2Fevil.com", a path on this site; the browser never
		// decodes it twice.
		expect(safeNext('/%252F%252Fevil.com')).toBe('/%252F%252Fevil.com');
	});

	it('uses the given fallback', () => {
		expect(safeNext('//evil.com', '/')).toBe('/');
	});
});

describe('verifyCallback', () => {
	it('carries next through the confirmation link', () => {
		expect(verifyCallback('/terminal')).toBe('/verify-email?next=%2Fterminal');
	});
});

describe('readSession', () => {
	const user = { id: 'u1', name: 'Meera Iyer', email: 'meera.iyer@example.com', image: null };

	it('is signed in when the session has a user', async () => {
		const state = await readSession({ getSession: async () => ({ data: { user } }) });
		expect(state).toEqual({
			status: 'signed-in',
			user: { id: 'u1', name: 'Meera Iyer', email: 'meera.iyer@example.com' }
		});
	});

	it('is signed out when there is no session', async () => {
		expect(await readSession({ getSession: async () => ({ data: null }) })).toEqual({
			status: 'signed-out'
		});
	});

	it('is signed out when the request fails', async () => {
		const state = await readSession({
			getSession: async () => {
				throw new Error('network');
			}
		});
		expect(state).toEqual({ status: 'signed-out' });
	});
});

describe('endSession', () => {
	it('is true when sign-out succeeds', async () => {
		expect(await endSession({ signOut: async () => ({ data: { success: true } }) })).toBe(true);
	});

	it('is false when the API answers with an error', async () => {
		expect(
			await endSession({ signOut: async () => ({ data: null, error: { status: 500 } }) })
		).toBe(false);
	});

	it('is false when the request fails', async () => {
		expect(
			await endSession({
				signOut: async () => {
					throw new Error('network');
				}
			})
		).toBe(false);
	});
});
