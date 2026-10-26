import { describe, expect, it } from 'vitest';
import { direction, groupIndian, percentText, rupees, shares, signedPercent } from './format';
import type { BrokerAccount, BrokerSummary, HoldingsSnapshot } from './types';
import {
	accountAction,
	addable,
	olderCloseDay,
	dayWords,
	heldAtWords,
	needsSignIn,
	nudgeLine,
	readDayWords,
	readShort,
	readWords,
	returnMessage,
	staleNote,
	stateDetail,
	stateWords,
	whenWords
} from './view';

const NOW = new Date('2026-10-19T03:45:00Z'); // Monday 19 Oct, 09:15 in India

const account = (over: Partial<BrokerAccount> = {}): BrokerAccount => ({
	broker: 'kite',
	name: 'Zerodha',
	state: 'signed_in',
	accountId: 'AB1234',
	keyLast4: 'x123',
	savedAt: '2026-10-18T09:00:00Z',
	signedInAt: '2026-10-19T03:44:00Z',
	signedOutAt: null,
	lastReadAt: '2026-10-19T03:44:00Z',
	lastReadCount: 4,
	errorCode: null,
	...over
});
const kite = {
	id: 'kite',
	name: 'Zerodha',
	enabled: true,
	notOfferedReason: null,
	copy: {
		pickerLine: '',
		lasts: 'Until 6:00 the next morning',
		cost: 'Free',
		formLede: '',
		steps: [],
		signedOutNote: 'Zerodha signs Maester out every morning at 6:00.'
	},
	credentials: [],
	signIn: { kind: 'redirect' },
	returnUrl: ''
} satisfies BrokerSummary;
const dhan = {
	...kite,
	id: 'dhan',
	name: 'Dhan',
	copy: {
		...kite.copy,
		lasts: 'As long as your Dhan connection in Settings',
		signedOutNote:
			'Dhan’s token in Settings has expired or was refused. Save a new one in Settings.'
	},
	signIn: { kind: 'settings-connection', provider: 'dhan' },
	returnUrl: null
} satisfies BrokerSummary;
const dhanAccount = (over: Partial<BrokerAccount> = {}) =>
	account({
		broker: 'dhan',
		name: 'Dhan',
		accountId: '1100012345',
		keyLast4: null,
		signedInAt: null,
		...over
	});

describe('format', () => {
	it('groups digits the Indian way', () => {
		expect(groupIndian('261390')).toBe('2,61,390');
		expect(groupIndian('22261390')).toBe('2,22,61,390');
		expect(groupIndian('999')).toBe('999');
	});
	it('shows rupees with paise, a real minus and a sign when asked, without rounding', () => {
		expect(rupees('261390.00')).toBe('₹2,61,390.00');
		expect(rupees('1742.6')).toBe('₹1,742.60');
		expect(rupees('-12.50')).toBe('−₹12.50');
		expect(rupees('43815.00', { sign: true })).toBe('+₹43,815.00');
		expect(rupees('0.00', { sign: true })).toBe('₹0.00');
		expect(rupees('1.005')).toBe('₹1.005');
	});
	it('shows shares and weights as given', () => {
		expect(shares('1500')).toBe('1,500');
		expect(shares('12.50')).toBe('12.5');
		expect(percentText('61.8')).toBe('61.8%');
	});
});

describe('view', () => {
	it('says when, in India', () => {
		expect(whenWords('2026-10-19T03:44:00Z', NOW)).toBe('today, 09:14');
		expect(whenWords('2026-10-18T10:12:00Z', NOW)).toBe('Sun 18 Oct, 15:42');
		expect(dayWords('2026-10-16')).toBe('16 Oct');
	});

	it('says a sign-out with its time', () => {
		expect(stateWords(account({ state: 'signed_out', signedOutAt: '2026-10-19T00:30:00Z' }))).toBe(
			'Signed out at 06:00'
		);
		expect(stateWords(account({ state: 'saved' }))).toBe('Not signed in yet');
	});

	it('picks the one action an account needs', () => {
		expect(accountAction(account())).toBe('read');
		expect(accountAction(account({ state: 'signed_out' }))).toBe('sign_in');
		expect(accountAction(account({ state: 'saved', signedInAt: null }))).toBe('sign_in');
		// Groww signs in from Maester: no page to go to, only "Read Groww" once its key is approved.
		const groww = { ...kite, id: 'groww', name: 'Groww', signIn: { kind: 'direct' as const } };
		expect(accountAction(account({ broker: 'groww', state: 'signed_out' }), groww)).toBe('direct');
		expect(accountAction(account({ broker: 'groww' }), groww)).toBe('read');
		expect(accountAction(account({ state: 'failing', errorCode: 'BROKER_UNAVAILABLE' }))).toBe(
			'read'
		);
	});

	it('never asks a Settings-connection account to sign in here', () => {
		expect(accountAction(dhanAccount(), dhan)).toBe('read');
		expect(
			accountAction(dhanAccount({ state: 'failing', errorCode: 'BROKER_UNAVAILABLE' }), dhan)
		).toBe('read');
		expect(accountAction(dhanAccount({ state: 'signed_out' }), dhan)).toBe('settings');
	});

	it('says a Settings-connection account uses Settings, and points there when signed out', () => {
		expect(stateDetail(dhanAccount(), dhan)).toBe('Uses your Dhan connection from Settings.');
		expect(stateDetail(dhanAccount({ state: 'signed_out' }), dhan)).toBe(
			'Dhan’s token in Settings has expired or was refused. Save a new one in Settings.'
		);
		expect(stateDetail(account(), kite)).toBe('A sign-in lasts: until 6:00 the next morning.');
	});

	it('says what was read and when', () => {
		expect(readWords(account(), NOW)).toBe('Today, 09:14 · 4 holdings');
		expect(readWords(account({ lastReadAt: null }), NOW)).toBe('Not read yet');
	});

	it('stars a part read before the sign-out and footnotes the oldest', () => {
		const snap = {
			accounts: [account({ state: 'signed_out' })],
			rows: [
				{
					isin: 'I',
					symbol: 'HDFCBANK',
					exchange: 'NSE',
					quantity: '120',
					cost: null,
					close: null,
					value: null,
					weight: null,
					gain: null,
					gainPercent: null,
					unknown: [],
					parts: [
						{
							broker: 'kite',
							accountId: 'AB1234',
							quantity: '120',
							averagePrice: '1512.4',
							cost: null,
							value: null,
							gain: null,
							gainPercent: null,
							readAt: '2026-10-18T10:12:00Z',
							stale: true
						}
					]
				}
			],
			totals: {
				knownValue: null,
				priced: 0,
				count: 1,
				cost: null,
				costed: 0,
				unrealizedGain: null,
				gainCovers: 0,
				gainPercent: null
			},
			closeDay: null,
			calculations: [],
			accountTotals: []
		} satisfies HoldingsSnapshot;
		expect(heldAtWords(snap.rows[0]!, { kite: 'Zerodha' })).toBe('Zerodha 120*');
		expect(staleNote(snap, NOW)).toBe(
			'* Read Sun 18 Oct, 15:42, before Zerodha signed Maester out. Quantities change only when you trade; sign in to check.'
		);
	});

	it('says where a holding is held, account by account', () => {
		const row = {
			isin: 'INE040A01034',
			symbol: 'HDFCBANK',
			exchange: 'NSE',
			quantity: '150',
			cost: '226435.50',
			close: null,
			value: null,
			weight: null,
			gain: null,
			gainPercent: null,
			unknown: [],
			parts: [
				{
					broker: 'kite',
					accountId: 'AB1234',
					quantity: '120',
					averagePrice: '1512.4',
					cost: null,
					value: null,
					gain: null,
					gainPercent: null,
					readAt: '2026-10-19T03:44:00Z',
					stale: false
				},
				{
					broker: 'dhan',
					accountId: '1100012345',
					quantity: '30',
					averagePrice: '1498.25',
					cost: null,
					value: null,
					gain: null,
					gainPercent: null,
					readAt: '2026-10-19T03:44:00Z',
					stale: false
				}
			]
		} satisfies HoldingsSnapshot['rows'][number];
		expect(heldAtWords(row, { kite: 'Zerodha', dhan: 'Dhan' })).toBe('Zerodha 120 · Dhan 30');
	});

	it('points a stale part on a Settings connection to Settings, not a sign-in', () => {
		const part = {
			broker: 'dhan',
			accountId: '1100012345',
			quantity: '30',
			averagePrice: '1498.25',
			cost: null,
			value: null,
			gain: null,
			gainPercent: null,
			readAt: '2026-10-18T10:12:00Z',
			stale: true
		};
		const snap = {
			accounts: [dhanAccount({ state: 'signed_out' })],
			rows: [
				{
					isin: 'I',
					symbol: 'HDFCBANK',
					exchange: 'NSE',
					quantity: '30',
					cost: null,
					close: null,
					value: null,
					weight: null,
					gain: null,
					gainPercent: null,
					unknown: [],
					parts: [part]
				}
			],
			totals: {
				knownValue: null,
				priced: 0,
				count: 1,
				cost: null,
				costed: 0,
				unrealizedGain: null,
				gainCovers: 0,
				gainPercent: null
			},
			closeDay: null,
			calculations: [],
			accountTotals: []
		} satisfies HoldingsSnapshot;
		expect(staleNote(snap, NOW, [kite, dhan])).toBe(
			'* Read Sun 18 Oct, 15:42, before the Dhan token in Settings stopped working. Quantities change only when you trade; save a new token in Settings to check.'
		);
	});

	it('reads the return from the broker', () => {
		expect(
			returnMessage(new URLSearchParams('broker=kite&signedIn=1'), [kite], [account()])
		).toEqual({ kind: 'status', text: 'Zerodha connected. 4 holdings read.', broker: 'kite' });
		expect(
			returnMessage(new URLSearchParams('broker=kite&error=SIGN_IN_CANCELLED'), [kite], [])?.text
		).toBe('The sign-in on Zerodha’s page was cancelled. Nothing changed.');
		expect(
			returnMessage(new URLSearchParams('broker=kite&error=SOMETHING_NEW'), [kite], [])?.kind
		).toBe('alert');
		expect(returnMessage(new URLSearchParams(''), [kite], [])).toBeNull();
	});

	it('names a close older than the page’s close day', () => {
		const row = {
			isin: 'I',
			symbol: 'X',
			exchange: 'NSE',
			parts: [],
			quantity: '1',
			cost: null,
			value: null,
			weight: null,
			gain: null,
			gainPercent: null,
			unknown: [],
			close: { value: '10', day: '2026-04-03', source: 'Dhan · NSE close' }
		};
		expect(olderCloseDay(row, '2026-10-16')).toBe('3 Apr');
		expect(
			olderCloseDay({ ...row, close: { ...row.close, day: '2026-10-16' } }, '2026-10-16')
		).toBeNull();
	});

	it('offers only enabled brokers not yet connected', () => {
		expect(addable([kite, { ...kite, id: 'off', enabled: false }], [])).toEqual([kite]);
		expect(addable([kite], [account()])).toEqual([]);
	});
});

describe('P&L figures', () => {
	it('signs a per cent the API worked out, with a real minus', () => {
		expect(signedPercent('15.2')).toBe('+15.2%');
		expect(signedPercent('-7.8')).toBe('−7.8%');
		expect(signedPercent('0.0')).toBe('0.0%');
	});

	it('reads a figure’s direction from its sign alone', () => {
		expect(direction('27624.00')).toBe('gain');
		expect(direction('-2735.00')).toBe('loss');
		expect(direction('0.00')).toBe('flat');
		expect(direction('-0.00')).toBe('flat');
	});

	it('signs rupees for a gain', () => {
		expect(rupees('27624.00', { sign: true })).toBe('+₹27,624.00');
		expect(rupees('-2735.00', { sign: true })).toBe('−₹2,735.00');
	});
});

describe('the nudge', () => {
	const snap = (accounts: BrokerAccount[]): HoldingsSnapshot => ({
		accounts,
		rows: [],
		totals: {
			knownValue: null,
			priced: 0,
			count: 0,
			cost: null,
			costed: 0,
			unrealizedGain: null,
			gainCovers: 0,
			gainPercent: null
		},
		accountTotals: [],
		closeDay: null,
		calculations: []
	});
	// NOW is Monday 19 Oct 09:15 in India; Friday 16 Oct 16:10 is three days before.
	const friday = '2026-10-16T10:40:00Z';
	const angel = account({
		broker: 'angel',
		name: 'Angel One',
		state: 'signed_out',
		lastReadAt: friday
	});
	const groww = account({
		broker: 'groww',
		name: 'Groww',
		state: 'signed_out',
		lastReadAt: '2026-10-17T10:00:00Z'
	});

	it('says the day of the oldest read in words', () => {
		expect(readDayWords('2026-10-19T02:00:00Z', NOW)).toBe('today');
		expect(readDayWords('2026-10-18T10:00:00Z', NOW)).toBe('yesterday');
		expect(readDayWords(friday, NOW)).toBe('Friday');
		expect(readDayWords('2026-10-01T10:00:00Z', NOW)).toBe('1 Oct');
	});

	it('names only brokers that are signed out and still have holdings on the page', () => {
		const never = account({ broker: 'upstox', name: 'Upstox', state: 'saved', lastReadAt: null });
		const failing = account({ broker: 'icici', name: 'ICICI Direct', state: 'failing' });
		expect(
			needsSignIn(snap([account(), angel, groww, never, failing])).map((a) => a.broker)
		).toEqual(['angel', 'groww']);
	});

	it('is one line, and nothing when every broker is signed in', () => {
		expect(nudgeLine(snap([account(), angel, groww]), NOW)).toEqual({
			lead: 'Some holdings are from Friday.',
			rest: '2 of 3 brokers signed Maester out; sign in to see today’s.',
			button: 'Update 2 brokers'
		});
		expect(nudgeLine(snap([account(), angel]), NOW)).toEqual({
			lead: 'Some holdings are from Friday.',
			rest: 'Angel One signed Maester out; sign in to see today’s.',
			button: 'Update Angel One'
		});
		expect(nudgeLine(snap([account()]), NOW)).toBeNull();
	});

	it('shows a part’s read time short enough for a table line', () => {
		expect(readShort('2026-10-19T03:25:00Z', NOW)).toBe('today 08:55');
		expect(readShort(friday, NOW)).toBe('Fri 16:10');
	});
});
