/**
 * Who is signed in, for a static site. The API's session cookie is HttpOnly, so
 * script cannot read it: ask the API (GET /api/auth/get-session, same origin
 * through the proxy) instead. Keep this the single place that decides "signed in".
 */
export interface SessionUser {
	id: string;
	name: string;
	email: string;
}

export type SessionState = { status: 'signed-in'; user: SessionUser } | { status: 'signed-out' };

interface SessionSource {
	getSession(): Promise<{ data: { user: SessionUser } | null }>;
}

export async function readSession(source: SessionSource): Promise<SessionState> {
	try {
		const { data } = await source.getSession();
		if (!data?.user) return { status: 'signed-out' };
		const { id, name, email } = data.user;
		return { status: 'signed-in', user: { id, name, email } };
	} catch {
		return { status: 'signed-out' };
	}
}

/** Only allow same-site relative paths as a post-sign-in destination. */
export function safeNext(candidate: string | null, fallback = '/terminal'): string {
	if (!candidate) return fallback;
	let decoded: string;
	try {
		decoded = decodeURIComponent(candidate);
	} catch {
		return fallback;
	}
	for (const value of [candidate, decoded]) {
		if (!value.startsWith('/')) return fallback;
		if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
		// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
		if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
	}
	return candidate;
}

/** Where the emailed confirmation link lands, carrying the destination through. */
export function verifyCallback(next: string): string {
	return `/verify-email?next=${encodeURIComponent(next)}`;
}
