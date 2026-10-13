import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/documents/client';
import type { Connection } from './types';
import {
	checkDhan,
	checkFred,
	expiredNote,
	expiryWords,
	failingNotice,
	lastReadWords,
	listFailure,
	opensOnLoad,
	saveFailure,
	savedWords,
	summaryWords,
	tagWord
} from './view';

const NOW = new Date('2026-10-06T09:00:00.000Z'); // 14:30 IST, 6 Oct

function conn(over: Partial<Connection> = {}): Connection {
	return {
		provider: 'dhan',
		state: 'connected',
		clientId: '1100284521',
		last4: '9f3c',
		expiresAt: '2026-11-05T09:00:00.000Z',
		checkedAt: '2026-10-06T04:00:00.000Z',
		lastRead: '2026-10-06T10:22:00.000Z',
		notice: null,
		...over
	};
}

const empty = (provider: Connection['provider']): Connection =>
	conn({
		provider,
		state: 'not_connected',
		clientId: null,
		last4: null,
		expiresAt: null,
		checkedAt: null,
		lastRead: null
	});

describe('tagWord', () => {
	it('says each state in a word', () => {
		expect(tagWord(empty('dhan'), NOW)).toBe('Not connected');
		expect(tagWord(conn(), NOW)).toBe('Connected');
		expect(tagWord(conn({ state: 'expired', expiresAt: '2026-10-02T09:00:00.000Z' }), NOW)).toBe(
			'Expired 2 Oct'
		);
		expect(tagWord(conn({ state: 'failing', provider: 'fred' }), NOW)).toBe('Not answering');
	});

	it('gives no date when Dhan refused a token that was not yet due to expire', () => {
		expect(tagWord(conn({ state: 'expired' }), NOW)).toBe('Expired');
	});
});

describe('summaryWords', () => {
	it('says what a connection reads before it is connected, then what is kept', () => {
		expect(summaryWords(empty('dhan'), NOW)).toBe(
			'Nifty 50, India VIX, MCX gold, Nifty 500 closes, the option chain'
		);
		expect(summaryWords(empty('fred'), NOW)).toBe('US VIX and the rupee per dollar');
		expect(summaryWords(conn(), NOW)).toBe('Token ending 9f3c · expires 5 Nov');
		expect(summaryWords(conn({ provider: 'fred', last4: '7a21', expiresAt: null }), NOW)).toBe(
			'Key ending 7a21'
		);
	});
});

describe('expiryWords', () => {
	it('gives the day and how far away it is, across a month boundary', () => {
		expect(expiryWords('2026-11-05T09:00:00.000Z', NOW)).toBe('5 Nov 2026, in 30 days');
		expect(expiryWords('2026-10-07T09:00:00.000Z', NOW)).toBe('7 Oct 2026, tomorrow');
		expect(expiryWords('2026-10-06T17:00:00.000Z', NOW)).toBe('6 Oct 2026, today');
		expect(expiryWords('2026-10-02T09:00:00.000Z', NOW)).toBe('2 Oct 2026, 4 days ago');
	});
});

describe('lastReadWords and savedWords', () => {
	it('says when readings were last stored, in India', () => {
		expect(lastReadWords(conn(), NOW)).toBe('Today 15:52');
		expect(lastReadWords(conn({ lastRead: '2026-10-02T10:00:00.000Z' }), NOW)).toBe('2 Oct, 15:30');
		expect(lastReadWords(empty('dhan'), NOW)).toBe('Nothing read yet');
	});

	it('names the key by its last 4 and the day it was saved', () => {
		expect(savedWords(conn())).toBe('Ending 9f3c. Saved 6 Oct.');
		expect(savedWords(conn({ provider: 'fred', last4: '7a21' }))).toBe(
			'Ending 7a21. Saved 6 Oct. FRED keys don’t expire.'
		);
	});
});

describe('expiredNote', () => {
	it('says where Market mood stops until a new token is saved', () => {
		expect(expiredNote(conn({ state: 'expired', lastRead: '2026-10-01T10:00:00.000Z' }))).toBe(
			'Market mood stops at 1 Oct until you save a new one.'
		);
		expect(expiredNote(conn({ state: 'expired', lastRead: null }))).toBe(
			'Market mood has no readings until you save a new one.'
		);
	});
});

describe('opensOnLoad', () => {
	it('opens an item that needs you', () => {
		expect(opensOnLoad(empty('dhan'))).toBe(true);
		expect(opensOnLoad(conn({ state: 'expired' }))).toBe(true);
		expect(opensOnLoad(conn({ state: 'failing' }))).toBe(true);
		expect(opensOnLoad(conn())).toBe(false);
	});
});

describe('checkDhan and checkFred', () => {
	it('catches an empty client ID or a short token before asking Dhan', () => {
		expect(checkDhan(' ', 'x'.repeat(30))).toEqual({
			field: 'clientId',
			message: 'Enter your Dhan client ID.'
		});
		expect(checkDhan('1100284521', 'abc')).toEqual({
			field: 'accessToken',
			message: 'Paste the whole token. It is longer than this.'
		});
		expect(checkDhan('1100284521', 'x'.repeat(30))).toBeNull();
	});

	it('catches a key that is not 32 lower-case letters and digits', () => {
		expect(checkFred('ABC')).toEqual({
			field: 'apiKey',
			message: 'A FRED API key is 32 lower-case letters and digits.'
		});
		expect(checkFred(' ' + 'a1'.repeat(16) + ' ')).toBeNull();
	});
});

describe('saveFailure', () => {
	const refused = (path: string, message: string) =>
		new ApiError(400, 'VALIDATION_FAILED', 'request validation failed', [{ path, message }]);

	it('puts a refused token or key under its field', () => {
		expect(
			saveFailure(refused('accessToken', 'Dhan said this token isn’t valid.'), 'dhan')
		).toEqual({
			field: 'accessToken',
			message: 'Paste the whole token. Dhan said it isn’t valid.'
		});
		expect(saveFailure(refused('apiKey', 'FRED said this key isn’t valid.'), 'fred')).toEqual({
			field: 'apiKey',
			message: 'Check the key. FRED said it isn’t valid.'
		});
		expect(
			saveFailure(refused('clientId', 'This token belongs to another Dhan client ID.'), 'dhan')
		).toEqual({ field: 'clientId', message: 'This token belongs to another Dhan client ID.' });
	});

	it('says the source didn’t answer, kept nothing, and to try again', () => {
		expect(saveFailure(new ApiError(503, 'INTERNAL', 'SOURCE_UNAVAILABLE'), 'dhan')).toEqual({
			field: null,
			message: 'Dhan didn’t answer. Try again in a minute.'
		});
		expect(saveFailure(new ApiError(0, 'NETWORK', 'offline'), 'fred')).toEqual({
			field: null,
			message: 'FRED didn’t answer. Try again in a minute.'
		});
		expect(saveFailure(new ApiError(429, 'RATE_LIMITED', 'DHAN_RATE_LIMITED'), 'dhan')).toEqual({
			field: null,
			message: 'Dhan asked Maester to slow down. Try again in a minute.'
		});
	});

	it('says when the server cannot keep keys, or the session ended', () => {
		expect(
			saveFailure(new ApiError(409, 'INVALID_STATE', 'CONNECTIONS_KEY is not set'), 'dhan').message
		).toBe('This server can’t keep keys yet: its encryption key isn’t set.');
		expect(saveFailure(new ApiError(401, 'UNAUTHENTICATED', 'no'), 'dhan').message).toBe(
			'Your session ended. Sign in again, then save.'
		);
	});
});

describe('failingNotice', () => {
	it('says FRED refused the key, since that is what makes FRED failing', () => {
		expect(failingNotice(conn({ provider: 'fred', state: 'failing' }))).toEqual({
			title: 'FRED refused the key on the last read.',
			detail: 'Save a new key. US VIX and the rupee stop until you do.'
		});
	});

	it('says Dhan did not answer, for a Dhan connection that is failing', () => {
		expect(failingNotice(conn({ state: 'failing' })).title).toBe(
			'Dhan didn’t answer on the last read.'
		);
	});
});

describe('listFailure', () => {
	it('says the server cannot keep keys when its encryption key is not set', () => {
		expect(listFailure(new ApiError(409, 'INVALID_STATE', 'CONNECTIONS_KEY is not set'))).toEqual({
			title: 'This server can’t keep keys yet: its encryption key isn’t set.',
			retry: false
		});
	});

	it('offers to try again for anything else', () => {
		expect(listFailure(new ApiError(0, 'NETWORK', 'offline'))).toEqual({
			title: 'Your connections didn’t load.',
			retry: true
		});
	});
});
