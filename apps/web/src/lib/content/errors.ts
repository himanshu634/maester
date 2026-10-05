/**
 * Copy for the error pages (src/routes/+error.svelte) and the offline banner. Same rules as
 * content/index.ts: the investor's words, sentence case, no server or code names. An error
 * says what happened and what to do next; it never apologises and never guesses.
 */
export const errorContent = {
	notFound: {
		title: 'Nothing at this address. Maester',
		label: 'Not found',
		code: 'Error 404',
		heading: 'Nothing at this address.',
		body: 'The link may be out of date, or the address may have a typo.',
		primary: 'Go to the index page',
		secondary: 'Enter the terminal',
		hint: 'Move the glass over the ledger.',
		found: 'Nothing filed here. Not even a footnote.',
		lens: ['nothing', 'filed here'],
		sketch:
			'A sketch of an open ledger with every line empty, and a magnifying glass that follows your pointer over it.'
	},
	terminalNotFound: {
		title: 'No page here. Maester',
		tag: 'Not found',
		heading: 'There’s no page here in the terminal.',
		body: 'The demo has one page, the overview. With an account, the terminal lists every page of the first release; most of them are coming soon.',
		asked: 'You asked for',
		demoPages: 'In the demo',
		demoPageList: 'Overview',
		accountPages: 'With an account',
		primary: 'Go to the overview'
	},
	failed: {
		title: 'This page didn’t load. Maester',
		label: 'Didn’t load',
		code: 'Error',
		heading: 'This page didn’t load.',
		body: 'Something went wrong on our side while loading it.',
		facts: {
			page: 'Page',
			when: 'When',
			todo: 'What to do',
			todoBody: 'Try again. If it keeps failing, wait a few minutes; it’s ours to fix.'
		},
		primary: 'Try again',
		secondary: 'Go to the index page',
		sketch: 'A small sketch of an old computer with a question mark on its screen.'
	},
	offline: {
		title: 'You’re offline. Maester',
		tag: 'Offline',
		heading: 'You’re offline.',
		body: 'Maester can’t reach the internet from this device. Nothing new can load until the connection is back.',
		primary: 'Check again',
		idle: 'Drag the plug into the socket, or press Check again.',
		checking: 'Checking the connection…',
		stillOffline: (time: string) =>
			`Checked at ${time}. This device is still offline. Check your Wi-Fi or mobile data.`,
		back: 'Back online. Reloading the page…',
		sketch:
			'A sketch of an unplugged cable and a wall socket. Dragging the plug into the socket checks the connection again.'
	},
	signedOut: {
		title: 'You’ve been signed out. Maester',
		label: 'Signed out',
		heading: 'You’ve been signed out.',
		body: 'Your session ended. Sign in again to go back to the page you were on.',
		primary: 'Sign in again',
		secondary: 'Go to the index page'
	},
	noAccess: {
		title: 'No access. Maester',
		label: 'No access',
		heading: 'You don’t have access to this.',
		body: 'It belongs to another workspace, or your access was removed, so its details aren’t shown.',
		primary: 'Go to the terminal'
	},
	banner: {
		lead: 'You’re offline.',
		body: (time: string) =>
			`Showing what loaded at ${time}. Nothing new can load until you’re back.`
	}
} as const;
