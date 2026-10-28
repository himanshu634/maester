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

/** The line under the state: what the broker said, or how long a sign-in lasts. */
export function stateDetail(a: BrokerAccount, broker: BrokerSummary | undefined): string {
	if (a.errorCode && copy.errors[a.errorCode]) return copy.errors[a.errorCode]!(a.name);
	if (a.state === 'signed_out') return broker?.copy.signedOutNote ?? '';
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
 * What the account's one action is: sign in on the broker's page when it has no good sign-in,
 * otherwise read again. A failing account that signed in and has not signed out still has its
 * sign-in, so it reads again.
 */
export function accountAction(a: BrokerAccount): 'sign_in' | 'read' {
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
 * The footnote for starred parts: the oldest such read, and whose. Null when none is starred.
 */
export function staleNote(s: HoldingsSnapshot, now: Date = new Date()): string | null {
	const stale = s.rows.flatMap((r) => r.parts.filter((p) => p.stale));
	if (!stale.length) return null;
	const oldest = stale.reduce((a, b) => (a.readAt <= b.readAt ? a : b));
	const when = whenWords(oldest.readAt, now);
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

const WEEKDAYS: Record<string, string> = {
	Mon: 'Monday',
	Tue: 'Tuesday',
	Wed: 'Wednesday',
	Thu: 'Thursday',
	Fri: 'Friday',
	Sat: 'Saturday',
	Sun: 'Sunday'
};

/** A read's day in words for the nudge: "today", "yesterday", "Friday" within the week, else "23 Oct". */
export function readDayWords(iso: string, now: Date = new Date()): string {
	const [y, m, d, wd] = istDay(iso);
	const [ny, nm, nd] = istDay(now);
	const days = Math.round((Date.UTC(ny, nm - 1, nd) - Date.UTC(y, m - 1, d)) / 86_400_000);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return WEEKDAYS[wd] ?? wd;
	return `${d} ${MONTHS[m - 1]}`;
}

/** "today 08:55" or "Fri 16:10": when one broker's part was read, short enough for a table line. */
export function readShort(iso: string, now: Date = new Date()): string {
	const [y, m, d, wd] = istDay(iso);
	const [ny, nm, nd] = istDay(now);
	return y === ny && m === nm && d === nd ? `today ${clock(iso)}` : `${wd} ${clock(iso)}`;
}

/**
 * The brokers the nudge names: signed out while holdings they read earlier are still on the page.
 * A broker with nothing read yet is not here (there is no data of it to call old), and neither is
 * one whose last read failed for another reason: "Your brokers" says what went wrong with it.
 */
export function needsSignIn(s: HoldingsSnapshot): BrokerAccount[] {
	return s.accounts.filter((a) => a.state === 'signed_out' && a.lastReadAt !== null);
}

/** The nudge's line, or null when every broker with holdings is signed in. */
export function nudgeLine(
	s: HoldingsSnapshot,
	now: Date = new Date()
): { lead: string; rest: string; button: string } | null {
	const out = needsSignIn(s);
	if (!out.length) return null;
	const oldest = out.reduce((a, b) => (a.lastReadAt! <= b.lastReadAt! ? a : b));
	const name = out[0]!.name;
	return {
		lead: copy.nudge.lead(readDayWords(oldest.lastReadAt!, now)),
		rest: copy.nudge.rest(out.length, s.accounts.length, name),
		button: copy.nudge.button(out.length, name)
	};
}

/** One broker's totals from the snapshot (holdings_by_account), or null when it holds nothing. */
export function totalsOf(s: HoldingsSnapshot, broker: string) {
	return s.accountTotals.find((t) => t.broker === broker) ?? null;
}

/** Brokers the investor can still add: enabled, not connected yet. */
export function addable(brokers: BrokerSummary[], accounts: BrokerAccount[]): BrokerSummary[] {
	return brokers.filter((b) => b.enabled && !accounts.some((a) => a.broker === b.id));
}
