import { describe, expect, it } from 'vitest';
import { groupIndian, percentText, rupees, shares } from './format';
import type { BrokerAccount, BrokerSummary, HoldingsSnapshot } from './types';
import {
	accountAction,
	addable,
	dayWords,
	heldAtWords,
	readWords,
	returnMessage,
	staleNote,
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
	returnUrl: ''
} satisfies BrokerSummary;

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
		expect(accountAction(account({ state: 'failing', errorCode: 'BROKER_UNAVAILABLE' }))).toBe(
			'read'
		);
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
					unknown: [],
					parts: [
						{
							broker: 'kite',
							accountId: 'AB1234',
							quantity: '120',
							averagePrice: '1512.4',
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
				gainCovers: 0
			},
			closeDay: null,
			calculations: []
		} satisfies HoldingsSnapshot;
		expect(heldAtWords(snap.rows[0]!, { kite: 'Zerodha' })).toBe('Zerodha 120*');
		expect(staleNote(snap, NOW)).toBe(
			'* Read Sun 18 Oct, 15:42, before Zerodha signed Maester out. Quantities change only when you trade; sign in to check.'
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

	it('offers only enabled brokers not yet connected', () => {
		expect(addable([kite, { ...kite, id: 'off', enabled: false }], [])).toEqual([kite]);
		expect(addable([kite], [account()])).toEqual([]);
	});
});
