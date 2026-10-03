/**
 * What the error page shows, decided from the status, the address and the connection.
 * The page itself (src/routes/+error.svelte) only renders the answer.
 */
import { safeNext } from '$lib/session';

export type ErrorKind =
	'not-found' | 'terminal-not-found' | 'failed' | 'offline' | 'signed-out' | 'no-access';

export interface ErrorView {
	kind: ErrorKind;
	/** Draw it inside the demo terminal's shell. The error page does not read the session, so it never draws the signed-in shell. */
	shell: boolean;
}

const DEMO = '/terminal/demo';

function inDemo(path: string): boolean {
	return path === DEMO || path.startsWith(`${DEMO}/`);
}

export function errorView({
	status,
	path,
	online
}: {
	status: number;
	path: string;
	online: boolean;
}): ErrorView {
	const shell = inDemo(path);
	if (!online) return { kind: 'offline', shell };
	if (status === 404)
		return shell ? { kind: 'terminal-not-found', shell } : { kind: 'not-found', shell };
	if (status === 401) return { kind: 'signed-out', shell: false };
	if (status === 403) return { kind: 'no-access', shell: false };
	return { kind: 'failed', shell };
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

/**
 * Ask the site for a tiny file, bypassing every cache. The browser's own online flag only
 * says a network exists, not that it reaches us.
 */
export async function checkConnection(fetcher: Fetcher, url: string): Promise<boolean> {
	try {
		const response = await fetcher(url, { method: 'HEAD', cache: 'no-store' });
		return response.ok;
	} catch {
		return false;
	}
}

/** "3 Oct 2026, 14:02": when the error happened, in the reader's time zone. */
export function errorTime(date: Date, timeZone?: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(date);
}

/** "14:02": a time on today's clock, for "showing what loaded at …". */
export function clockTime(date: Date, timeZone?: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(date);
}

/** Back to sign-in, then back to the page you were on (same-site paths only). */
export function signInAgainHref(path: string): `/login?next=${string}` {
	return `/login?next=${encodeURIComponent(safeNext(path))}`;
}
