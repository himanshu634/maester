/**
 * Copy for Holdings (/terminal/holdings), from canvas "Maester Broker Accounts", D · final, one
 * person: the holdings first, signed-out brokers as one nudge, each share broken down by broker
 * with its P&L, the brokers at the foot. What a broker asks for, its steps and how long a sign-in
 * lasts come from the broker's manifest, a compiled-in plugin served at /v1/brokers
 * (BrokerSummary.copy), not from here.
 */

export const holdingsContent = {
	heading: 'Holdings',
	tag: 'Holdings snapshot',
	lede: 'Connect your broker and Maester reads what you hold there. It only reads: it can’t place an order or move money.',
	asOf: (day: string) => `Quantities from your brokers, valued at the NSE close of ${day}.`,
	asOfNone: 'Quantities from your brokers. No holding has an NSE close in Maester yet.',
	loading: 'Loading your holdings.',
	loadFailed: {
		title: 'Your holdings didn’t load.',
		detail: 'Nothing saved is lost. Check your connection and try again.',
		retry: 'Try again'
	},
	noKey: {
		title: 'Maester can’t keep broker keys yet.',
		detail: 'Set CONNECTIONS_KEY for the API, then reload this page.'
	},

	accounts: {
		heading: 'Your brokers',
		add: 'Add a broker',
		columns: { account: 'Broker', state: 'Where it stands', read: 'Holdings read', value: 'Value' },
		state: {
			saved: 'Not signed in yet',
			signed_in: 'Signed in',
			signed_out: 'Signed out',
			signedOutAt: (time: string) => `Signed out at ${time}`,
			failing: 'Didn’t read'
		},
		key: (last4: string) => `Key ending ${last4}`,
		signIn: (name: string) => `Sign in to ${name}`,
		readAgain: 'Read again',
		reading: (name: string) => `Reading your ${name} holdings…`,
		disconnect: 'Disconnect',
		notRead: 'Not read yet',
		read: (when: string, count: number) =>
			`${when} · ${count === 1 ? '1 holding' : `${count} holdings`}`,
		tooSoon: 'It read a moment ago. Try again in a few seconds.',
		readFailed: (name: string) => `${name} didn’t answer. Nothing read was lost.`
	},

	errors: {
		BROKER_UNAVAILABLE: (name: string) => `${name} didn’t answer. Try again in a minute.`,
		BROKER_ANSWER_UNREADABLE: (name: string) =>
			`${name}’s answer wasn’t one Maester could read. Nothing read before was lost.`,
		BROKER_SIGNED_OUT: (name: string) =>
			`${name} signed Maester out. Sign in again to read today’s holdings.`,
		BROKER_REFUSED: (name: string) =>
			`${name} didn’t accept the key. Approve it on ${name} today, then read again.`
	} as Record<string, (name: string) => string>,

	signedIn: (name: string, count: number | null) =>
		count === null
			? `${name} connected.`
			: `${name} connected. ${count === 1 ? '1 holding' : `${count} holdings`} read.`,

	returned: {
		SIGN_IN_EXPIRED: (name: string) => `That sign-in had expired. Sign in to ${name} again.`,
		SIGN_IN_CANCELLED: (name: string) =>
			`The sign-in on ${name}’s page was cancelled. Nothing changed.`,
		BROKER_REFUSED: (name: string) =>
			`${name} didn’t accept the key and secret. Check that both are from the same app, and that its redirect URL is the one Maester gave you.`,
		BROKER_UNAVAILABLE: (name: string) =>
			`${name} didn’t answer. Try signing in again in a minute.`,
		BROKER_ANSWER_UNREADABLE: (name: string) => `${name}’s answer wasn’t one Maester could read.`
	} as Record<string, ((name: string) => string) | undefined>,

	add: {
		heading: 'Add a broker',
		which: 'Which broker?',
		notOffered: 'Not offered',
		connect: (name: string) => `Connect ${name}`,
		returnUrl: 'Redirect URL',
		returnUrlHint: 'Paste this into your app’s redirect URL.',
		copy: 'Copy',
		copied: 'Copied.',
		save: (name: string) => `Save and sign in with ${name}`,
		saving: 'Saving the key…',
		cancel: 'Cancel',
		lasts: 'A sign-in lasts',
		cost: 'What it costs',
		enter: (label: string) => `Enter the ${label}.`
	},

	strip: {
		label: 'Holdings figures',
		knownValue: 'Known value',
		knownValueNote: (priced: number, count: number) =>
			`${priced} of ${count} holdings priced, at Maester’s NSE close.`,
		cost: 'Invested',
		costNote: (costed: number, count: number) =>
			`Quantity × each broker’s average cost, for ${costed} of ${count} holdings.`,
		gain: 'Unrealized P&L',
		gainNote: (percent: string | null, n: number) =>
			`${percent ? `${percent} on what was invested, ` : ''}for the ${n === 1 ? 'holding' : `${n} holdings`} with a value and a cost.`,
		accounts: 'Brokers signed in',
		accountsNote: (signedIn: number, count: number) =>
			signedIn === count
				? 'Every broker signed in.'
				: `${count - signedIn} of ${count} show what was read last, starred.`,
		unknown: 'Unknown until a holding has an NSE close in Maester'
	},

	/** The one line at the top while a broker is signed out but its holdings are on the page. */
	nudge: {
		lead: (day: string) => `Some holdings are from ${day}.`,
		rest: (out: number, count: number, name: string) =>
			out === 1
				? `${name} signed Maester out; sign in to see today’s.`
				: `${out} of ${count} brokers signed Maester out; sign in to see today’s.`,
		button: (out: number, name: string) => (out === 1 ? `Update ${name}` : `Update ${out} brokers`),
		listLabel: 'Brokers to sign in to',
		why: (state: string, what: string) => `${state} · ${what}`,
		whatRedirect: (name: string) => `Sign in on ${name}’s page`,
		whatRead: 'Read again',
		back: 'Each broker sends you back here. What was read last stays on the page until then.'
	},

	showBy: { label: 'Show by', company: 'Company', broker: 'Broker' },

	table: {
		heading: 'Holdings',
		label: 'Holdings across your brokers, by company and broker',
		byBrokerLabel: (name: string) => `${name} holdings`,
		byBrokerNote:
			'Each broker’s holdings, with its average cost and the P&L at Maester’s NSE close.',
		byBrokerStale: (when: string, name: string) =>
			`Quantities read ${when}, before ${name} signed Maester out. They change only when you trade; sign in to check.`,
		columns: {
			company: 'Company, then each broker holding it',
			companyShort: 'Company',
			heldAt: 'Held at',
			quantity: 'Quantity',
			averagePrice: 'Avg cost',
			cost: 'Invested',
			close: 'Close',
			value: 'Value',
			gain: 'P&L',
			gainPercent: 'P&L %',
			weight: 'Weight'
		},
		brokerLine: (id: string | null, when: string) => (id ? `${id} · read ${when}` : `read ${when}`),
		brokerTotal: 'Broker total',
		total: 'Total',
		closeOn: (day: string) => `close of ${day}`,
		noCloseNote:
			'— means Maester has no NSE close for the share. It keeps closes for Nifty 500 shares, from your Dhan data.',
		noClose:
			'No NSE close in Maester for this share. Maester keeps closes for Nifty 500 shares, from your Dhan data.',
		noCost: 'The broker doesn’t report what was paid for this share.',
		noGain: 'Unknown without both an NSE close and what was paid.',
		stale: (when: string, name: string) =>
			`* Read ${when}, before ${name} signed Maester out. Quantities change only when you trade; sign in to check.`,
		empty: 'Nothing held in the connected accounts.'
	},

	dialog: {
		title: (name: string) => `Disconnect ${name}?`,
		detail: 'Maester forgets the key and the secret, and these holdings leave this page.',
		confirm: 'Disconnect',
		keep: 'Keep it'
	},

	statuses: {
		disconnected: (name: string) => `${name} disconnected.`,
		read: (name: string, count: number | null) =>
			count === null
				? `${name} read.`
				: `${name} read: ${count === 1 ? '1 holding' : `${count} holdings`}.`
	}
};
