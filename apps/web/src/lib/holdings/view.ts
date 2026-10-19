/**
 * What Holdings says about accounts and rows: states in words, when things were read, where a
 * holding is held, and what the broker's return to Maester means. Pure, so it is tested without
 * Svelte. It counts and arranges; every figure it shows was worked out by the API.
 */
import { holdingsContent as copy } from '$lib/content/holdings';
import { shares } from './format';
import type { BrokerAccount, BrokerSummary, HoldingRow, HoldingsSnapshot } from './types';

const ZONE = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function istDay(iso: string | Date): [number, number, number, string] {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short'
	}).formatToParts(typeof iso === 'string' ? new Date(iso) : iso);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return [Number(get('year')), Number(get('month')), Number(get('day')), get('weekday')];
}

/** "09:14", in India. */
export function clock(iso: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: ZONE,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(new Date(iso));
}

/** "today, 09:14", or "Sun 18 Oct, 15:42". */
export function whenWords(iso: string, now: Date = new Date()): string {
	const [y, m, d, wd] = istDay(iso);
	const [ny, nm, nd] = istDay(now);
	if (y === ny && m === nm && d === nd) return `today, ${clock(iso)}`;
	return `${wd} ${d} ${MONTHS[m - 1]}, ${clock(iso)}`;
}

/** A close day ("2026-10-16") as "16 Oct". */
export function dayWords(day: string): string {
	const [, m, d] = day.split('-').map(Number);
	return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

export function stateWords(a: BrokerAccount): string {
	if (a.state === 'signed_out')
		return a.signedOutAt
			? copy.accounts.state.signedOutAt(clock(a.signedOutAt))
			: copy.accounts.state.signed_out;
	return copy.accounts.state[a.state];
}

/** The Settings connection's name ("Dhan") when the broker signs in through one, otherwise null. */
export function settingsProvider(broker: BrokerSummary | undefined): string | null {
	if (broker?.signIn.kind !== 'settings-connection') return null;
	return copy.settings.providers[broker.signIn.provider] ?? broker.name;
}

/** The line under the state: what the broker said, or how long a sign-in lasts. */
export function stateDetail(a: BrokerAccount, broker: BrokerSummary | undefined): string {
	const provider = settingsProvider(broker);
	if (a.errorCode && copy.errors[a.errorCode]) return copy.errors[a.errorCode]!(a.name);
	if (a.state === 'signed_out') return broker?.copy.signedOutNote ?? '';
	if (provider) return `${copy.settings.uses(provider)}.`;
	if (a.state === 'signed_in')
		return broker ? `${copy.add.lasts}: ${broker.copy.lasts.toLowerCase()}.` : '';
	return a.keyLast4 ? copy.accounts.key(a.keyLast4) : '';
}

export function readWords(a: BrokerAccount, now: Date = new Date()): string {
	if (!a.lastReadAt) return copy.accounts.notRead;
	const when = whenWords(a.lastReadAt, now);
	return copy.accounts.read(when.charAt(0).toUpperCase() + when.slice(1), a.lastReadCount ?? 0);
}

/**
 * What the account's one action is: sign in when it has no good sign-in, otherwise read again.
 * An account on a Settings connection has no sign-in here: signed out, it points to Settings.
 */
export function accountAction(
	a: BrokerAccount,
	broker?: BrokerSummary
): 'sign_in' | 'read' | 'settings' {
	if (settingsProvider(broker)) return a.state === 'signed_out' ? 'settings' : 'read';
	return a.state === 'signed_in' ||
		(a.state === 'failing' && a.signedInAt !== null && a.signedOutAt === null)
		? 'read'
		: 'sign_in';
}

/** "Zerodha 120*": each account's part, starred when it was read before a sign-out. */
export function heldAtWords(row: HoldingRow, names: Record<string, string>): string {
	return row.parts
		.map((p) => `${names[p.broker] ?? p.broker} ${shares(p.quantity)}${p.stale ? '*' : ''}`)
		.join(' · ');
}

/**
 * The footnote for starred parts: the oldest such read, and whose. Null when none is starred. A
 * broker on a Settings connection has no sign-in, so its note points to Settings.
 */
export function staleNote(
	s: HoldingsSnapshot,
	now: Date = new Date(),
	brokers: BrokerSummary[] = []
): string | null {
	const stale = s.rows.flatMap((r) => r.parts.filter((p) => p.stale));
	if (!stale.length) return null;
	const oldest = stale.reduce((a, b) => (a.readAt <= b.readAt ? a : b));
	const when = whenWords(oldest.readAt, now);
	const provider = settingsProvider(brokers.find((b) => b.id === oldest.broker));
	if (provider) return copy.table.staleSettings(when, provider);
	const name = s.accounts.find((a) => a.broker === oldest.broker)?.name ?? oldest.broker;
	return copy.table.stale(when, name);
}

export type ReturnMessage = { kind: 'status' | 'alert'; text: string; broker: string };

/** What the broker's trip back to Maester left in the address: ?broker=kite&signedIn=1 or &error=CODE. */
export function returnMessage(
	query: URLSearchParams,
	brokers: BrokerSummary[],
	accounts: BrokerAccount[]
): ReturnMessage | null {
	const id = query.get('broker');
	if (!id) return null;
	const name = brokers.find((b) => b.id === id)?.name ?? id;
	if (query.get('signedIn') === '1') {
		const count = accounts.find((a) => a.broker === id)?.lastReadCount ?? null;
		return { kind: 'status', text: copy.signedIn(name, count), broker: id };
	}
	const code = query.get('error');
	if (!code) return null;
	const say = copy.returned[code] ?? copy.returned.BROKER_UNAVAILABLE!;
	return { kind: 'alert', text: say(name), broker: id };
}

/**
 * The close's own day when it is older than the day the page names, so a share whose last
 * stored close is from months ago never reads as valued at this week's close. Null otherwise.
 */
export function olderCloseDay(row: HoldingRow, closeDay: string | null): string | null {
	return row.close && closeDay && row.close.day !== closeDay ? dayWords(row.close.day) : null;
}

/** Brokers the investor can still add: enabled, not connected yet. */
export function addable(brokers: BrokerSummary[], accounts: BrokerAccount[]): BrokerSummary[] {
	return brokers.filter((b) => b.enabled && !accounts.some((a) => a.broker === b.id));
}
