import { describe, expect, it } from 'vitest';
import { messageFor } from './messages';

describe('messageFor', () => {
	it('has no message without a code or status', () => {
		expect(messageFor(null)).toBeNull();
		expect(messageFor(undefined)).toBeNull();
	});

	it.each([
		['WAITLISTED', 'waitlisted'],
		['access_denied', 'cancelled'],
		['INVALID_EMAIL_OR_PASSWORD', 'wrong-password'],
		['EMAIL_NOT_VERIFIED', 'not-verified'],
		['INVALID_TOKEN', 'link-expired'],
		['TOKEN_EXPIRED', 'link-expired']
	])('maps %s to %s', (code, kind) => {
		expect(messageFor(code)?.kind).toBe(kind);
	});

	it('treats 429 as too many attempts whatever the code', () => {
		expect(messageFor(undefined, 429)?.kind).toBe('rate-limited');
		expect(messageFor('SOMETHING', 429)?.kind).toBe('rate-limited');
	});

	it.each(['state_mismatch', '<script>alert(1)</script>', '', 'internal_server_error'])(
		'shows the generic message for %j and never echoes it',
		(code) => {
			const message = messageFor(code || 'x');
			expect(message?.kind).toBe('generic');
			expect(`${message?.title} ${message?.body}`).not.toContain(code || 'x');
		}
	);
});
