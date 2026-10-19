/**
 * Copy for Holdings (/terminal/holdings), from canvas "Maester Broker Connections", direction
 * A · Accounts, then one table. What a broker asks for, its steps and how long a sign-in lasts
 * come from the broker's JSON definition (BrokerSummary.copy), not from here.
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
		heading: 'Your accounts',
		add: 'Add a broker',
		columns: { account: 'Account', state: 'Where it stands', read: 'Holdings read' },
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
		openSettings: 'Open Settings',
		readFailed: (name: string) => `${name} didn’t answer. Nothing read was lost.`
	},

	errors: {
		BROKER_UNAVAILABLE: (name: string) => `${name} didn’t answer. Try again in a minute.`,
		BROKER_ANSWER_UNREADABLE: (name: string) =>
			`${name}’s answer wasn’t one Maester could read. Nothing read before was lost.`,
		BROKER_SIGNED_OUT: (name: string) =>
			`${name} signed Maester out. Sign in again to read today’s holdings.`
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

	/** A broker that signs in with a connection saved in Settings (Dhan): nothing to type or sign in to here. */
	settings: {
		providers: { dhan: 'Dhan' } as Record<string, string | undefined>,
		uses: (provider: string) => `Uses your ${provider} connection from Settings`,
		add: (name: string) => `Add ${name}`,
		adding: (name: string) => `Reading your ${name} holdings…`,
		notConnected: (provider: string) => `${provider} isn’t connected in Settings yet.`,
		notConnectedDetail: (provider: string) =>
			`Save your ${provider} client ID and access token in Settings, then come back and add it here.`,
		added: (name: string, count: number | null) =>
			count === null
				? `${name} added.`
				: `${name} added. ${count === 1 ? '1 holding' : `${count} holdings`} read.`
	},

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
		cost: 'Cost',
		costNote: (costed: number, count: number) =>
			`What your brokers report you paid, for ${costed} of ${count} holdings.`,
		gain: 'Unrealized gain',
		gainNote: (n: number) =>
			`Value less cost, for the ${n === 1 ? 'holding' : `${n} holdings`} with both.`,
		accounts: 'Accounts',
		accountsNote: (signedIn: number, count: number) => `${signedIn} of ${count} signed in now.`,
		unknown: 'Unknown until a holding has an NSE close in Maester'
	},

	table: {
		heading: 'Holdings',
		label: 'Holdings across your accounts',
		columns: {
			company: 'Company',
			heldAt: 'Held at',
			quantity: 'Quantity',
			close: 'Close',
			value: 'Value',
			weight: 'Weight'
		},
		total: 'Total',
		closeOn: (day: string) => `close of ${day}`,
		noCloseNote:
			'— means Maester has no NSE close for the share. It keeps closes for Nifty 500 shares, from your Dhan data.',
		noClose:
			'No NSE close in Maester for this share. Maester keeps closes for Nifty 500 shares, from your Dhan data.',
		stale: (when: string, name: string) =>
			`* Read ${when}, before ${name} signed Maester out. Quantities change only when you trade; sign in to check.`,
		staleSettings: (when: string, provider: string) =>
			`* Read ${when}, before the ${provider} token in Settings stopped working. Quantities change only when you trade; save a new token in Settings to check.`,
		empty: 'Nothing held in the connected accounts.'
	},

	dialog: {
		title: (name: string) => `Disconnect ${name}?`,
		detail: 'Maester forgets the key and the secret, and these holdings leave this page.',
		settingsDetail: (provider: string) =>
			`Maester stops reading these holdings, and they leave this page. ${provider} stays connected in Settings.`,
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
