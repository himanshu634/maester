/**
 * The API's broker and holdings shapes. apps/web is a standalone project and cannot import
 * @maester/contracts, so these mirror packages/contracts/src/brokers.ts (BrokerSummary,
 * BrokerAccount, HoldingsSnapshot). When the contract changes, change it here too. Every figure
 * is a decimal string worked out by the API's financial engine; the web only formats it.
 */

export interface BrokerCredentialField {
	key: string;
	label: string;
	hint?: string;
	secret: boolean;
	minLength: number;
	maxLength: number;
}

/** A broker as its JSON definition describes it to the page. */
export interface BrokerSummary {
	id: string;
	name: string;
	enabled: boolean;
	notOfferedReason: string | null;
	copy: {
		pickerLine: string;
		lasts: string;
		cost: string;
		formLede: string;
		steps: string[];
		saveNote?: string;
		signedOutNote: string;
	};
	credentials: BrokerCredentialField[];
	/**
	 * How the account signs in: on the broker's own page (`redirect`), or with the connection the
	 * investor saved in Settings (`settings-connection`), which asks for nothing here.
	 */
	signIn:
		| { kind: 'redirect' }
		| { kind: 'settings-connection'; provider: string }
		/** Maester signs in itself with the saved key, once the investor approved it on the broker's side (Groww). */
		| { kind: 'direct' };
	/** What to paste into the broker's app as its redirect URL. Null when there is no redirect. */
	returnUrl: string | null;
}

export type BrokerAccountState = 'saved' | 'signed_in' | 'signed_out' | 'failing';

export interface BrokerAccount {
	broker: string;
	name: string;
	state: BrokerAccountState;
	accountId: string | null;
	keyLast4: string | null;
	savedAt: string;
	signedInAt: string | null;
	signedOutAt: string | null;
	lastReadAt: string | null;
	lastReadCount: number | null;
	errorCode: string | null;
}

export type HoldingUnknown = 'NO_CLOSE' | 'NO_COST';

export interface HoldingPart {
	broker: string;
	accountId: string | null;
	quantity: string;
	averagePrice: string;
	cost: string | null;
	value: string | null;
	gain: string | null;
	gainPercent: string | null;
	readAt: string;
	/** Read before the broker signed Maester out. */
	stale: boolean;
}

export interface HoldingRow {
	isin: string;
	symbol: string;
	exchange: string;
	parts: HoldingPart[];
	quantity: string;
	cost: string | null;
	close: { value: string; day: string; source: string } | null;
	value: string | null;
	weight: string | null;
	gain: string | null;
	gainPercent: string | null;
	unknown: HoldingUnknown[];
}

/** One broker account's totals over its parts, with how many parts each figure covers. */
export interface HoldingAccountTotals {
	broker: string;
	knownValue: string | null;
	priced: number;
	count: number;
	cost: string | null;
	costed: number;
	gain: string | null;
	gainCovers: number;
	gainPercent: string | null;
}

export interface HoldingsSnapshot {
	accounts: BrokerAccount[];
	rows: HoldingRow[];
	totals: {
		knownValue: string | null;
		priced: number;
		count: number;
		cost: string | null;
		costed: number;
		unrealizedGain: string | null;
		gainCovers: number;
		gainPercent: string | null;
	};
	accountTotals: HoldingAccountTotals[];
	closeDay: string | null;
	calculations: { id: string; version: number }[];
}
