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
	/** Read out after the "—" in the Latest year column. */
	noLatest: 'No annual report read yet',
	/** Read from and Latest year in one line, under the name, when the list is narrow. */
	folded: (reports: string, latest: string | null) =>
		latest ? `${reports}, latest ${latest}` : reports,
	listLabel: 'Your companies',
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
		/** The page's heading while the company's name is not known yet; read out, not shown. */
		heading: 'A company in Research',
		identity: { nse: 'NSE', bse: 'BSE', cin: 'CIN' },
		loading: (name: string | null) => (name ? `Loading ${name}.` : 'Loading the company.'),
		notFound: { title: 'This company isn’t in your workspace.', back: 'Back to Research' },
		financialsFailed: {
			title: 'The statements didn’t load.',
			detail: 'Your filings are safe. Try again.',
			/** Under Statements, when the prices above did load. */
			detailWithPrices: 'Your filings are safe. The prices above are still current.',
			retry: 'Try again',
			busy: 'Asking for the statements again…',
			again: 'Still didn’t load. Try again in a moment.'
		},
		stockFailed: {
			title: 'The prices didn’t load.',
			detail: 'The business figures below are still current.',
			retry: 'Try again',
			busy: 'Asking for the prices again…',
			again: 'Still didn’t load. Try again in a moment.'
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
		/** `basic`: the line is the basic earnings per share; otherwise it is named plainly. */
		peNote: (close: string, eps: string, fy: string, where: string, basic: boolean) =>
			`${close} ÷ ${eps}, the ${basic ? 'basic ' : ''}earnings per share for ${fy} (${where}).`,
		profitChange: (pct: string, fy: string) => `${pct} on ${fy}`,
		profitNote: (basis: string, revenue: string | null, change: string | null) =>
			[basis, revenue ? `Revenue ${revenue}${change ? `, ${change}` : ''}.` : null]
				.filter(Boolean)
				.join(' '),
		noPrice: {
			no_symbol: 'Maester has no NSE symbol for this company.',
			not_connected: 'Connect Dhan in Settings to see prices.',
			not_tracked:
				'Maester has no closes for this share yet. It keeps prices for Nifty 500 shares, from your Dhan data.',
			failed: 'The prices didn’t load.'
		},
		needsCloses: 'Needs the year’s closes.',
		needsPrice: 'Needs a price.',
		noEps: 'The filing’s earnings per share wasn’t read.',
		otherCurrency: 'The filing reports in another currency.',
		loss: (fy: string) => `The company made a loss in ${fy}, so there’s no price to earnings.`,
		noFigures: 'No annual report read yet.',
		/** An annual report was read, but none of its profit and loss figures has a date to place it by. */
		noPlacedFigures: 'The profit and loss has no figures Maester could place by year.',
		noStatements: 'The statements didn’t load.',
		noProfit: 'Profit wasn’t found in the statement.',
		unknownUnit: 'The statement’s unit isn’t one Maester can name.',
		settings: 'Settings',
		/** "Connect Dhan in Settings to see prices.", with Settings as a link. */
		connect: { before: 'Connect Dhan in', after: 'to see prices.' },
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
			'Each year comes whole from one filing: an XBRL filing first, otherwise the newest filing that prints it, so a column never mixes filings or sources.',
		/** The sub-label under a year whose column comes from an XBRL file. */
		xbrlColumn: 'Results, XBRL',
		/** Under the table: the years whose statements come from more than one source. */
		yearSources: {
			label: 'Where each year’s statements come from',
			xbrl: 'the XBRL',
			page: 'the annual report, read by Gemini',
			/** "Profit and loss and balance sheet from the XBRL" */
			from: (statements: string, source: string) => `${statements} from ${source}`
		},
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
			unit: 'Unit',
			inPdf: 'In the PDF',
			restated: 'Restated',
			onPage: 'On the page',
			addsUp: 'Adds up',
			usedIn: 'Used in',
			reviewed: 'Reviewed'
		},
		from: (filing: string, page: string) => `${filing}, ${page}`,
		/** A figure read from an XBRL file: its span and period, the file and the element, never the context. */
		xbrlFrom: {
			/** "Results for the year to 31 Mar 2026" */
			period: (span: string, day: string) => `Results for the ${span} to ${day}`,
			/** A balance sheet figure is at a day, not over a span. */
			instant: (day: string) => `Results at ${day}`,
			withPdf: (period: string) => `${period}: the XBRL filed with the PDF`,
			alone: (period: string) => `${period}: the XBRL file`,
			note: (file: string, element: string) => `${file} · tagged ${element}`,
			spans: {
				quarter: 'quarter',
				half_year: 'half year',
				nine_months: 'nine months',
				year: 'year'
			}
		},
		/** The unit of an XBRL figure and, where it agrees with the places shown, its rounding. */
		xbrlUnit: {
			perShare: (currency: string) => `${currency} a share`,
			declared: ', as the filing declares',
			converted: (from: string) => `, converted from ${from} as the filing declares`,
			rounded: (word: string) => `; rounded to the ${word}`,
			/** By the `decimals` the XBRL file gives. */
			roundedTo: {
				'-7': 'crore',
				'-5': 'lakh',
				'-4': 'ten thousand',
				'-3': 'thousand',
				'-1': 'ten',
				'2': 'paisa'
			} as Record<string, string>
		},
		/** The `xbrl_in_pdf` outcome, in words. */
		inPdf: {
			/** The check ran, but its result is not shown (`IN_PDF_RESULT_SHOWN`). */
			resultNotShown: 'Not checked',
			foundOnPage: (page: number) => `Found on page ${page} of the results PDF.`,
			foundOnStatements: (pages: string) =>
				`Found on the results PDF’s statement pages${pages ? ` (${pages})` : ''}.`,
			notFound: (pages: string) =>
				`Not found on the PDF’s statement pages${pages ? ` (${pages})` : ''}.`,
			notFoundDetail: ' The figure stays as filed in XBRL. Check the PDF yourself.'
		},
		/** The link to the results PDF, and what it opens. */
		xbrlOpen: {
			atPage: (page: number) => `Open the results PDF at page ${page}`,
			plain: 'Open the results PDF',
			foundNote: 'The page where the check found this figure. The XBRL file itself has no pages.',
			statementsNote: 'Where the statement pages start. The XBRL file has no pages.',
			plainNote: 'The XBRL file has no pages.'
		},
		/** What another filing printed or filed, and which figure the table shows. */
		restated: (filing: string, printed: string, page: number) =>
			`${filing} printed ${printed} for this year, on page ${page}.`,
		restatedXbrl: (filing: string, value: string, unit: string) =>
			`${filing} filed ${value} ${unit} for this year in its XBRL file.`,
		restatedShown: {
			/** The page filing's figure was replaced by ... */
			page: {
				page: ' The newer filing’s figure is shown.',
				xbrl: ' The XBRL filing’s figure is shown.'
			},
			xbrl: {
				xbrl: ' The newer XBRL filing’s figure is shown.',
				page: ' This filing’s figure is shown.'
			}
		},
		usedIn: 'Price to earnings, in the summary above',
		reviewed: 'Not yet',
		open: (page: number) => `Open the PDF at page ${page}`,
		openNote: (page: number) =>
			`Opens the filing in a new tab. If it opens at the start, go to page ${page}.`,
		back: 'Back to the table'
	},

	words: {
		page: (page: number, of: number) => `Page ${page} of ${of}`,
		/** Where a price-to-earnings figure's earnings per share came from. */
		wherePage: (page: number) => `annual report, page ${page}`,
		whereXbrl: (element: string) => `XBRL file, element ${element}`,
		whereUnknown: 'annual report',
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
		failedXbrl: {
			strong: 'No.',
			text: (lines: string, total: string, difference: string | null, more: boolean) =>
				`The lines add up to ${lines}; the XBRL file gives ${total}${difference ? `, ${difference} ${more ? 'more' : 'less'}` : ''}.`
		},
		identityFailedXbrl: {
			strong: 'No.',
			text: (
				subject: string,
				total: string,
				sides: string,
				difference: string | null,
				more: boolean
			) =>
				`${subject} doesn’t equal equity and liabilities: the XBRL file gives ${total}; equity and liabilities come to ${sides}${difference ? `, ${difference} ${more ? 'more' : 'less'}` : ''}.`
		},
		failed: {
			strong: 'No.',
			/** `more`: the page prints more than the lines add up to. No difference when a number is unknown. */
			text: (lines: string, page: string, difference: string | null, more: boolean) =>
				`The lines add up to ${lines}; the page prints ${page}${difference ? `, ${difference} ${more ? 'more' : 'less'}` : ''}.`
		},
		/** The balance identity: total assets against equity and liabilities, said on the total alone. */
		identityFailed: {
			strong: 'No.',
			/** `more`: the page prints more than equity and liabilities come to. */
			text: (
				subject: string,
				page: string,
				sides: string,
				difference: string | null,
				more: boolean
			) =>
				`${subject} doesn’t equal equity and liabilities: the page prints ${page}; equity and liabilities come to ${sides}${difference ? `, ${difference} ${more ? 'more' : 'less'}` : ''}.`
		},
		missing: (filing: string) => `Not printed under this name in ${filing}.`,
		dash: (page: number) => `A dash printed on page ${page}. Maester doesn’t read it as zero.`,
		unparsed: (page: number) => `Maester couldn’t read what page ${page} prints here.`,
		xbrlNil: 'The XBRL file gives no value for this line.',
		xbrlUnparsed: 'Maester couldn’t read the value the XBRL file gives for this line.',
		xbrlNoRounding: 'The XBRL file doesn’t declare its rounding, so the unit isn’t known.'
	}
} as const;
