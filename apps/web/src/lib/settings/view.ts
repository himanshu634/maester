/**
 * What Settings says about a connection: its state in a word, what is kept, when it expires and
 * when it last read, and what went wrong with a save. Pure, so it is tested without Svelte.
 */
import { settingsContent as copy } from '$lib/content/settings';
import type { ApiError } from '$lib/documents/client';
import type { Connection, ConnectionProvider } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ZONE = 'Asia/Kolkata';

/** The calendar day an instant falls on in India: [year, month 1–12, day]. */
function istParts(iso: string | Date): [number, number, number] {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
	const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return [n('year'), n('month'), n('day')];
}

const dayMonth = (iso: string) => {
	const [, m, d] = istParts(iso);
	return `${d} ${MONTHS[m - 1]}`;
};

const time = (iso: string) =>
	new Intl.DateTimeFormat('en-GB', {
		timeZone: ZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(iso));

/** Whole calendar days in India from `now` to `iso`; negative in the past. */
function daysFrom(iso: string, now: Date): number {
	const day = (p: [number, number, number]) => Date.UTC(p[0], p[1] - 1, p[2]);
	return Math.round((day(istParts(iso)) - day(istParts(now))) / 86_400_000);
}

export function tagWord(c: Connection, now: Date = new Date()): string {
	if (c.state === 'expired') {
		return c.expiresAt && Date.parse(c.expiresAt) <= now.getTime()
			? copy.tag.expiredOn(dayMonth(c.expiresAt))
			: copy.tag.expired;
	}
	return copy.tag[c.state];
}

/** The line under the item's name: what it reads before it is connected, then what is kept. */
export function summaryWords(c: Connection, now: Date = new Date()): string {
	if (c.state === 'not_connected' || !c.last4) return copy.providers[c.provider].reads;
	if (c.provider === 'fred') return copy.providers.fred.summary(c.last4);
	const expires =
		c.expiresAt && Date.parse(c.expiresAt) > now.getTime() ? dayMonth(c.expiresAt) : null;
	return copy.providers.dhan.summary(c.last4, expires);
}

/** "5 Nov 2026, in 30 days". */
export function expiryWords(iso: string, now: Date = new Date()): string {
	const [y] = istParts(iso);
	const n = daysFrom(iso, now);
	const when = n >= 0 ? copy.connected.inDays(n) : copy.connected.daysAgo(-n);
	return `${dayMonth(iso)} ${y}, ${when}`;
}

/** "Today 15:52", "2 Oct, 15:30", or "Nothing read yet". */
export function lastReadWords(c: Connection, now: Date = new Date()): string {
	if (!c.lastRead) return copy.connected.nothingRead;
	return daysFrom(c.lastRead, now) === 0
		? copy.connected.today(time(c.lastRead))
		: copy.connected.earlier(dayMonth(c.lastRead), time(c.lastRead));
}

/** "Ending 9f3c. Saved 6 Oct." and, for FRED, that its keys don't expire. */
export function savedWords(c: Connection): string {
	const saved = copy.connected.saved(c.last4 ?? '—', c.checkedAt ? dayMonth(c.checkedAt) : '—');
	return c.provider === 'fred' ? `${saved} ${copy.connected.noExpiry}` : saved;
}

/** Where Market mood stops while the Dhan token is expired: the day readings were last stored. */
export function expiredNote(c: Connection): string {
	return copy.notices.expired.stops(c.lastRead ? dayMonth(c.lastRead) : null);
}

/** An item that needs you opens on load: not connected, expired or failing. */
export function opensOnLoad(c: Connection): boolean {
	return c.state !== 'connected';
}

export interface Failure {
	/** The field the message goes under, or null for a message under the form. */
	field: 'clientId' | 'accessToken' | 'apiKey' | null;
	message: string;
}

/** Caught before asking Dhan: an empty client ID or a token too short to be one. */
export function checkDhan(clientId: string, accessToken: string): Failure | null {
	if (!clientId.trim()) return { field: 'clientId', message: copy.errors.clientIdMissing };
	if (accessToken.trim().length < 20) {
		return { field: 'accessToken', message: copy.errors.tokenShort };
	}
	return null;
}

/** Caught before asking FRED: a key that is not 32 lower-case letters and digits. */
export function checkFred(apiKey: string): Failure | null {
	return /^[a-z0-9]{32}$/.test(apiKey.trim())
		? null
		: { field: 'apiKey', message: copy.errors.fredKeyShape };
}

/** What a refused or failed save says, and where. Nothing was kept in any of these cases. */
export function saveFailure(err: ApiError, provider: ConnectionProvider): Failure {
	const name = copy.providers[provider].name;
	if (err.code === 'VALIDATION_FAILED') {
		if (err.names('accessToken'))
			return { field: 'accessToken', message: copy.errors.tokenRefused };
		if (err.names('apiKey')) return { field: 'apiKey', message: copy.errors.keyRefused };
		const clientId = err.fields.find((f) => f.path === 'clientId');
		if (clientId) return { field: 'clientId', message: clientId.message };
	}
	if (err.code === 'RATE_LIMITED') return { field: null, message: copy.errors.rateLimited(name) };
	if (err.code === 'INVALID_STATE') return { field: null, message: copy.errors.noServerKey };
	if (err.code === 'UNAUTHENTICATED') return { field: null, message: copy.errors.signedOut };
	return { field: null, message: copy.errors.noAnswer(name) };
}

/** The note on a connection whose last read failed. A FRED connection fails when FRED refuses its key. */
export function failingNotice(c: Connection): { title: string; detail: string } {
	return c.provider === 'fred'
		? copy.notices.failing.fred
		: {
				title: copy.notices.failing.title(copy.providers[c.provider].name),
				detail: copy.notices.failing.detail
			};
}

/** What the Connections group says when the list did not load, and whether trying again can help. */
export function listFailure(err: ApiError): { title: string; retry: boolean } {
	return err.code === 'INVALID_STATE'
		? { title: copy.errors.noServerKey, retry: false }
		: { title: copy.loadFailed.connections, retry: true };
}
