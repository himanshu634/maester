/**
 * Copy for Settings (/terminal/settings): your account and the market data connections, from
 * canvas "Settings · G final" (K1–K3) and the spec's Settings states. A key is named only by its
 * last 4 characters; the key itself is never shown once saved.
 */
import type { ConnectionProvider } from '$lib/settings/types';

export const settingsContent = {
	heading: 'Settings',
	lede: 'Your account and the connections Maester reads the market through. More settings arrive here as the terminal grows.',
	loading: 'Loading your settings.',
	loadFailed: {
		title: 'Your settings didn’t load.',
		detail: 'Nothing saved is lost. Check your connection and try again.',
		retry: 'Try again',
		connections: 'Your connections didn’t load.',
		connectionsDetail: 'Nothing saved is lost. Check your connection and try again.',
		noServerKeyDetail: 'Set CONNECTIONS_KEY for the API and the worker, then reload this page.'
	},

	account: {
		heading: 'Account',
		title: 'Your account',
		state: 'Signed in',
		terms: { name: 'Name', email: 'Email', workspace: 'Workspace' },
		signOutNote: 'Sign out from the foot of the page list.'
	},

	connections: {
		heading: 'Connections',
		lede: 'Where Maester reads market data from. Each uses your own account; what it reads is for you only.',
		disconnectNote: 'Disconnecting deletes the key. Readings already read stay, with their dates.'
	},

	tag: {
		not_connected: 'Not connected',
		connected: 'Connected',
		expired: 'Expired',
		expiredOn: (day: string) => `Expired ${day}`,
		failing: 'Not answering'
	},

	providers: {
		dhan: {
			name: 'Dhan',
			reads: 'Nifty 50, India VIX, MCX gold, Nifty 500 closes, the option chain',
			intro:
				'Maester reads the market through your own Dhan Data API subscription. What it reads is for you only; nothing is shared.',
			summary: (last4: string, expires: string | null) =>
				expires ? `Token ending ${last4} · expires ${expires}` : `Token ending ${last4}`,
			secretLabel: 'Access token',
			showSecret: 'Show token',
			replace: 'Replace the token',
			saveNote: 'Maester asks Dhan who you are and when the token expires.',
			checking: 'Checking with Dhan…',
			connected: 'Dhan connected.',
			disconnected: 'Dhan disconnected.',
			steps: [
				'Sign in to Dhan on the web and open My profile.',
				'Open Access DhanHQ APIs. The Data API subscription must be active.',
				'Generate an access token. Copy it and your client ID.',
				'Paste both here and choose Save and check.'
			],
			site: { label: 'Open Dhan in a new tab', href: 'https://web.dhan.co/' }
		},
		fred: {
			name: 'FRED',
			reads: 'US VIX and the rupee per dollar',
			intro:
				'FRED is the Federal Reserve Bank of St. Louis’s free data service. Maester reads US VIX and the rupee per dollar with your own key.',
			summary: (last4: string) => `Key ending ${last4}`,
			secretLabel: 'API key',
			showSecret: 'Show key',
			replace: 'Replace the key',
			saveNote: 'Maester reads one US VIX close to check the key.',
			checking: 'Checking with FRED…',
			connected: 'FRED connected.',
			disconnected: 'FRED disconnected.',
			steps: [
				'Sign in to FRED, or create a free account.',
				'Open My account, then API keys.',
				'Request a key. Copy the 32 letters and digits.',
				'Paste it here and choose Save and check.'
			],
			site: {
				label: 'Open FRED in a new tab',
				href: 'https://fredaccount.stlouisfed.org/apikeys'
			}
		}
	} satisfies Record<ConnectionProvider, unknown>,

	form: {
		clientId: 'Client ID',
		secretHint: 'Kept encrypted. After you save it, Maester shows only its last 4 characters.',
		save: 'Save and check',
		cancel: 'Cancel',
		whereHeading: 'Where to find it'
	},

	connected: {
		clientId: 'Client ID',
		expires: 'Expires',
		lastRead: 'Last read',
		saved: (last4: string, day: string) => `Ending ${last4}. Saved ${day}.`,
		noExpiry: 'FRED keys don’t expire.',
		today: (time: string) => `Today ${time}`,
		earlier: (day: string, time: string) => `${day}, ${time}`,
		nothingRead: 'Nothing read yet',
		inDays: (n: number) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`),
		daysAgo: (n: number) => (n === 1 ? 'yesterday' : `${n} days ago`),
		disconnect: (name: string) => `Disconnect ${name}`
	},

	notices: {
		expired: {
			title: 'Dhan stopped answering. The token has expired.',
			stops: (day: string | null) =>
				day
					? `Market mood stops at ${day} until you save a new one.`
					: 'Market mood has no readings until you save a new one.'
		},
		failing: {
			fred: {
				title: 'FRED refused the key on the last read.',
				detail: 'Save a new key. US VIX and the rupee stop until you do.'
			},
			title: (name: string) => `${name} didn’t answer on the last read.`,
			detail: 'Maester tries again every 30 minutes. If it keeps failing, save the key again.'
		},
		dataPlan: {
			title: 'Dhan accepted the token, but the Data API subscription isn’t active.',
			detail: 'Turn it on in Dhan. Maester reads nothing until it is.'
		}
	},

	errors: {
		clientIdMissing: 'Enter your Dhan client ID.',
		tokenShort: 'Paste the whole token. It is longer than this.',
		fredKeyShape: 'A FRED API key is 32 lower-case letters and digits.',
		tokenRefused: 'Paste the whole token. Dhan said it isn’t valid.',
		keyRefused: 'Check the key. FRED said it isn’t valid.',
		noAnswer: (name: string) => `${name} didn’t answer. Try again in a minute.`,
		rateLimited: (name: string) => `${name} asked Maester to slow down. Try again in a minute.`,
		noServerKey: 'This server can’t keep keys yet: its encryption key isn’t set.',
		signedOut: 'Your session ended. Sign in again, then save.',
		disconnectFailed: (name: string) => `${name} wasn’t disconnected. Try again.`
	},

	dialog: {
		title: (name: string) => `Disconnect ${name}?`,
		detail: (secret: string) => `The ${secret} is deleted. Readings already read stay.`,
		confirm: 'Disconnect',
		keep: 'Keep it'
	}
};
