import { authContent } from '$lib/content/auth';

export type AuthMessageKind =
	| 'waitlisted'
	| 'cancelled'
	| 'wrong-password'
	| 'not-verified'
	| 'rate-limited'
	| 'link-expired'
	| 'generic';

export interface AuthMessage {
	kind: AuthMessageKind;
	title: string;
	body: string;
}

const m = authContent.messages;

/**
 * Turn a Better Auth error code (from a response or an `?error=` query value) into
 * copy. Unknown codes get the generic message; a code is never shown to the person.
 */
export function messageFor(code: string | null | undefined, status?: number): AuthMessage | null {
	if (status === 429) return { kind: 'rate-limited', ...m.rateLimited };
	if (!code) return null;
	switch (code) {
		case 'WAITLISTED':
			return {
				kind: 'waitlisted',
				title: authContent.waitlisted.heading,
				body: authContent.waitlisted.bodyGoogle
			};
		case 'access_denied':
			return { kind: 'cancelled', ...m.cancelled };
		case 'INVALID_EMAIL_OR_PASSWORD':
			return { kind: 'wrong-password', ...m.wrongPassword };
		case 'EMAIL_NOT_VERIFIED':
			return { kind: 'not-verified', ...m.notVerified };
		case 'INVALID_TOKEN':
		case 'TOKEN_EXPIRED':
			return { kind: 'link-expired', ...m.linkExpired };
		default:
			return { kind: 'generic', ...m.generic };
	}
}
