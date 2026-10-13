/**
 * Copy for the Research pages (/terminal/research and the company page). Plain words from the
 * investor's side (docs/DESIGN.md section 7). It describes the company's own figures and the
 * share's closes; it never advises. Unknown is "—" with its reason, never zero.
 */
export const researchContent = {
	heading: 'Research',
	lede: 'Each company you’ve added, with the figures from its filings and the page each one came from.',
	loading: 'Loading your companies.',
	loadFailed: {
		title: 'Research didn’t load.',
		detail: 'Your filings are safe. Check your connection and try again.',
		retry: 'Try again'
	},
	noWorkspace: { title: 'There’s no workspace to show.', detail: 'Sign out and in again.' },
	empty: 'Nothing here yet. Add a filing in Documents and its company appears here once it’s read.',
	addFiling: 'Add a filing in Documents',
	missingCompany: 'Missing a company?',
	count: (n: number) =>
		`${n} ${n === 1 ? 'company' : 'companies'}. A company’s figures appear once one of its filings is read.`,
	columns: {
		company: 'Company',
		readFrom: 'Read from',
		latest: 'Latest year',
		standing: 'Where it stands'
	},
	reports: (n: number) =>
		n === 0 ? 'No annual report read yet' : `${n} annual ${n === 1 ? 'report' : 'reports'}`,
	standing: {
		failed: (n: number) => `${n} ${n === 1 ? 'filing' : 'filings'} didn’t read`,
		reading: (n: number) => `Reading ${n} ${n === 1 ? 'filing' : 'filings'}`,
		read: 'Read',
		nothing: 'Nothing read yet'
	},

	company: {
		back: 'Research',
		loading: (name: string | null) => (name ? `Loading ${name}.` : 'Loading the company.'),
		notFound: { title: 'This company isn’t in your workspace.', back: 'Back to Research' },
		financialsFailed: {
			title: 'The statements didn’t load.',
			detail: 'Your filings are safe. Try again.',
			retry: 'Try again'
		},
		stockFailed: {
			title: 'The prices didn’t load.',
			detail: 'The business figures below are still current.',
			retry: 'Try again'
		},
		readFrom: (n: number) => `Read from ${n} annual ${n === 1 ? 'report' : 'reports'}:`,
		nothingRead: (name: string) => `No annual report for ${name} has been read yet.`,
		addInDocuments: 'Add one in Documents',
		notInTable: (names: string) =>
			`Results for a quarter or half year aren’t in this table yet: ${names}.`
	},

	summary: {
		heading: 'The stock and the business',
		labels: {
			close: 'Last close',
			range: '52-week range',
			pe: 'Price to earnings',
			profit: (fy: string) => `Profit for ${fy}`,
			profitUnknown: 'Profit for the latest year'
		},
		closeNote: (day: string) => `NSE close, ${day}. From your Dhan data.`,
		dayChange: (change: string, pct: string) => `${change} (${pct}) on the day`,
		rangeNote: (low: string, high: string) =>
			`Low on ${low}, high on ${high}. The block is the last close.`,
		peNote: (close: string, eps: string, fy: string, page: number) =>
			`${close} ÷ ${eps}, the basic earnings per share for ${fy} (annual report, page ${page}).`,
		profitChange: (pct: string, fy: string) => `${pct} on ${fy}`,
		profitNote: (basis: string, revenue: string | null, change: string | null) =>
			[basis, revenue ? `Revenue ${revenue}${change ? `, ${change}` : ''}.` : null]
				.filter(Boolean)
				.join(' '),
		noPrice: {
			no_symbol: 'Maester has no NSE symbol for this company.',
			not_connected: 'Connect Dhan in Settings to see prices.',
			not_tracked: 'Maester keeps prices for Nifty 500 shares only, and this isn’t one.',
			failed: 'The prices didn’t load.'
		},
		needsCloses: 'Needs the year’s closes.',
		needsPrice: 'Needs a price.',
		noEps: 'The filing’s earnings per share wasn’t read.',
		loss: (fy: string) => `The company made a loss in ${fy}, so there’s no price to earnings.`,
		noFigures: 'No annual report read yet.',
		noProfit: 'Profit wasn’t found in the statement.',
		unknownUnit: 'The statement’s unit isn’t one Maester can name.',
		settings: 'Settings',
		chart: {
			heading: 'The last year’s closes',
			source: 'NSE, ₹ a share. From your Dhan data.',
			value: 'Close',
			label: (name: string, low: string, high: string, last: string) =>
				`${name}’s NSE closes for the last year: low ${low}, high ${high}, last ${last}.`,
			today: (close: string) => `${close} last`,
			low: (value: string, day: string) => `Low ${value}, ${day}`,
			high: (value: string, day: string) => `High ${value}, ${day}`
		}
	},

	statements: {
		heading: 'Statements',
		kinds: {
			income_statement: 'Profit and loss',
			balance_sheet: 'Balance sheet',
			cash_flow: 'Cash flow'
		},
		bases: { consolidated: 'Consolidated', standalone: 'Standalone', unknown: 'Basis not stated' },
		statementGroup: 'Statement',
		basisGroup: 'Basis',
		caption: (basis: string, kind: string) =>
			`${basis} ${kind.toLowerCase()}, years to their period end.`,
		line: 'Line, as printed',
		unit: (words: string) => `${words}.`,
		perShareUnit: '₹ a share',
		region: (kind: string) => `${kind} by year, scrolls sideways`,
		restated: (fy: string) => `${fy} restated`,
		newestWins:
			'Each year comes whole from the newest filing that prints it, so a column never mixes filings.',
		notRead: (basis: string, kind: string) =>
			`No ${basis.toLowerCase()} ${kind.toLowerCase()} has been read yet.`,
		unplaced: (n: number) =>
			`${n} ${n === 1 ? 'figure had' : 'figures had'} no date and ${n === 1 ? 'is' : 'are'} left out.`,
		leftOut: {
			other_currency: (filing: string) => `${filing} reports in another currency and is left out.`,
			other_unit: (filing: string) => `${filing} uses a unit Maester can’t convert and is left out.`
		}
	},

	panel: {
		eyebrow: 'Selected figure',
		none: 'Select a figure to see where it came from.',
		context: (kind: string, basis: string, period: string) =>
			`${kind} · ${basis.toLowerCase()} · ${period}`,
		terms: {
			from: 'From',
			restated: 'Restated',
			onPage: 'On the page',
			addsUp: 'Adds up',
			usedIn: 'Used in',
			reviewed: 'Reviewed'
		},
		from: (filing: string, page: string) => `${filing}, ${page}`,
		restated: (filing: string, printed: string, page: number) =>
			`${filing} printed ${printed} for this year, on page ${page}. The newer filing’s figure is shown.`,
		usedIn: 'Price to earnings, in the summary above',
		reviewed: 'Not yet',
		open: (page: number) => `Open the PDF at page ${page}`,
		openNote: (page: number) =>
			`Opens the filing in a new tab. If it opens at the start, go to page ${page}.`,
		back: 'Back to the table'
	},

	words: {
		page: (page: number, of: number) => `Page ${page} of ${of}`,
		found: 'Found in the page’s text',
		scanned: (page: number) => `Page ${page} is scanned: not checked against its text`,
		notFound: {
			strong: 'Not found.',
			text: (printed: string) => `The page’s text doesn’t contain ${printed}.`
		},
		noSum: 'No sum covers this line',
		adds: 'Adds up',
		partOf: (subject: string, ok: boolean) =>
			`Part of ${subject.toLowerCase()}, which ${ok ? 'adds up' : 'doesn’t add up'}`,
		notChecked: 'Not checked',
		failed: {
			strong: 'No.',
			/** `more`: the page prints more than the lines add up to. No difference when a number is unknown. */
			text: (lines: string, page: string, difference: string | null, more: boolean) =>
				`The lines add up to ${lines}; the page prints ${page}${difference ? `, ${difference} ${more ? 'more' : 'less'}` : ''}.`
		},
		missing: (filing: string) => `Not printed under this name in ${filing}.`,
		dash: (page: number) => `A dash printed on page ${page}. Maester doesn’t read it as zero.`,
		unparsed: (page: number) => `Maester couldn’t read what page ${page} prints here.`
	}
} as const;
