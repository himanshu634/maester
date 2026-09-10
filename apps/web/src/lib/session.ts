/**
 * Session detection for the static site.
 *
 * The hosted API (feature F01, workspace identity) will set this cookie on
 * sign-in. Until it exists no session can be present, so `/terminal` always
 * hands off to `/login`. Keep this the single place that decides "signed in".
 */
export const SESSION_COOKIE = 'maester_session';

export function hasSession(): boolean {
	if (typeof document === 'undefined') return false;
	return document.cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

/** Only allow same-site relative paths as a post-login destination. */
export function safeNext(candidate: string | null, fallback = '/terminal'): string {
	if (!candidate) return fallback;
	if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
	return candidate;
}
