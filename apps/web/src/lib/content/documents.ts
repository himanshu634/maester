/**
 * Copy for the Documents page (/terminal/documents). Plain words from the investor's side
 * (docs/DESIGN.md section 7): what Maester did with a file and what is left to do. Every
 * answer Maester gives shows the page and words it came from; never a confidence.
 */
import type { OtherType, ResultsSpan } from '$lib/documents/types';

export const documentsContent = {
	heading: 'Documents',
	lede: 'Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again.',
	drop: {
		title: 'Drop PDFs here',
		or: 'or',
		chooseFiles: 'Choose files',
		chooseFolder: 'Choose a folder',
		/** The limit, said before anything is chosen. PDF only until Maester reads XBRL. */
		note: 'Annual reports, quarterly results or any other company document. PDF only for now, up to 50 MB a file. A whole folder works too.',
		/** Before sending: each file's type and size, and its first bytes. */
		checking: (count: number) => (count === 1 ? 'Checking the file…' : `Checking ${count} files…`),
		sendingOne: (name: string) => `Sending ${name}…`,
		sending: (at: number, total: number, folder: string | null) =>
			`Sending ${at} of ${total} files${folder ? ` from ${folder}` : ''}…`,
		sendingOneAloud: (name: string) => `Sending ${name}.`,
		sendingAloud: (total: number) => `Sending ${total} files.`,
		sent: (count: number, folder: string | null) =>
			`${count === 1 ? '1 file' : `${count} files`} sent${folder ? ` from ${folder}` : ''}.`,
		notAddedAloud: (count: number) => (count === 1 ? '1 wasn’t added.' : `${count} weren’t added.`),
		/** One Notice per batch, never one per file. */
		refusedTitle: (count: number, total: number) =>
			total === 1
				? 'The file wasn’t added.'
				: count === total
					? `None of the ${total} files were added.`
					: `${count} of the ${total} files ${count === 1 ? 'wasn’t' : 'weren’t'} added.`,
		refusedListLabel: 'Files not added, and why',
		stopped: {
			'signed-out': (count: number) =>
				`You’re signed out, so the other ${count === 1 ? 'file wasn’t' : `${count} files weren’t`} sent. Sign in and add ${count === 1 ? 'it' : 'them'} again.`,
			offline: (count: number) =>
				`The connection dropped, so the other ${count === 1 ? 'file wasn’t' : `${count} files weren’t`} sent. Check your connection and add ${count === 1 ? 'it' : 'them'} again.`
		},
		chooseAgain: 'Choose files to add',
		signIn: 'Sign in'
	},
	/** Why a file wasn't added: after its name in the batch Notice, browser and API alike. */
	refusals: {
		xbrl: 'An XBRL file. Maester takes PDFs only for now.',
		notPdf: 'Not a PDF.',
		notPdfKnown: (what: string) => `${what}, not a PDF.`,
		notPdfInside: 'Named .pdf, but not a PDF inside.',
		empty: 'The file is empty.',
		tooLarge: (size: string) => `${size}, over the 50 MB limit.`,
		unreadable: 'Your device wouldn’t let Maester read it.',
		signedOut: 'Not sent: you’re signed out.',
		offline: 'Not sent: the connection dropped.',
		unfinished: 'The upload didn’t finish. Add it again.',
		kinds: {
			word: 'A Word document',
			spreadsheet: 'A spreadsheet',
			presentation: 'A presentation',
			picture: 'A picture'
		}
	},
	loading: 'Loading your documents.',
	loadFailed: {
		title: 'Your documents didn’t load.',
		detail: 'Nothing you added is lost. Check your connection and try again.',
		retry: 'Try again'
	},
	noWorkspace: {
		title: 'There is no workspace to add documents to.',
		detail: 'Sign out and in again. If it stays like this, tell us.'
	},
	leaving: 'Leaving this page doesn’t stop anything. The slip is here when you come back.',
	leavingWhileSending:
		'Files are still being sent. Moving to another page doesn’t stop them, but closing or reloading this tab does.',

	slip: {
		/** "Uploaded" step and the rest, in order. */
		steps: ['Uploaded', 'Worked out what it is', 'Reading the statements', 'Ready'],
		stepsLabel: 'Where this file stands',
		step: {
			done: 'Done',
			now: 'Now',
			next: 'Next',
			'needs-you': 'Needs you',
			stopped: 'Stopped',
			'not-read': 'Not read'
		},
		added: (when: string) => `added ${when}`,
		readAs: 'Read as',
		terms: {
			kind: 'What it is',
			company: 'Company',
			period: 'Period',
			statements: 'Statements'
		},
		youSaidSo: 'You said so',
		scannedPage: (page: number) => `Page ${page} (scanned)`,
		notConfirmed: 'Not confirmed yet',
		noSource: 'No page given',
		change: 'Change',
		changeLabel: (term: string) => `Change ${term.toLowerCase()}`,
		cancel: 'Cancel',
		notYet: 'Maester hasn’t worked this out yet.',
		/** Once a document is read and its company confirmed: a link to the company's figures. */
		seeFigures: 'See the figures',
		/** Beside it, once a document is read: read the filing again (say, one read before earnings per share were asked for). */
		readAgain: 'Read it again'
	},

	kind: {
		legend: 'What is it?',
		missing: 'Choose what it is.',
		choices: {
			annual_report: { label: 'Annual report', hint: 'A full year’s statements' },
			financial_results: {
				label: 'Financial results',
				hint: 'A quarter’s, half year’s or year’s statements'
			},
			other: {
				label: 'Other company document',
				hint: 'Kept with the company. Figures aren’t read from it yet.'
			}
		},
		typeLabel: 'Which kind of document?',
		spanLabel: 'Which period do the results cover?',
		spanUnknown: 'Not sure',
		save: 'Save and read it',
		saveKept: 'Save',
		saveChange: 'Save'
	},

	company: {
		question: (name: string) => `Is this ${name}?`,
		questionUnnamed: 'Which company is this?',
		questionCandidates: 'Which of your companies is this?',
		candidates: (count: number) =>
			count === 1
				? 'A company you’ve added matches what is printed. Check it is the same one.'
				: `${count} companies you’ve added match what is printed. Say which one it is.`,
		candidateLabel: 'Your companies that match',
		newCompany:
			'Maester hasn’t seen this company in your workspace. Add it and Maester reads the filing.',
		noName: 'Maester couldn’t find the company’s name on the first pages.',
		printed: (label: string, value: string) => `${label} ${value}`,
		onPage: (page: number) => `page ${page}`,
		add: (name: string) => `Add ${name} as a company`,
		nameLabel: 'Company name',
		nameHint: 'As it appears on the filing.',
		nameMissing: 'Enter the company’s name.',
		addNamed: 'Add this company',
		pickLabel: 'Or pick one you’ve added',
		pickPlaceholder: 'Choose a company',
		pickMissing: 'Choose a company first.',
		use: 'Use this company',
		newOption: 'A new company…',
		changeLabel: 'Company'
	},

	needsKind: {
		title: 'Maester couldn’t tell what this is.',
		detail: 'The first pages have no title it could read. Say what it is and it carries on.'
	},
	/**
	 * Names the company only once it is confirmed and read; a printed name alone is not enough,
	 * and a confirmed company whose name has not loaded yet is not called unconfirmed.
	 */
	kept: (company: string | null, confirmed: boolean) =>
		company
			? `Kept with ${company}. Maester reads annual reports and financial results for now.`
			: confirmed
				? 'Kept, not read. Maester reads annual reports and financial results for now.'
				: 'Kept. Company not confirmed yet.',
	duplicate: {
		title: 'Not worked out: you added this file before.',
		open: 'Open the first copy',
		again: 'Read it again'
	},
	answersFailed: {
		title: 'What Maester worked out didn’t load.',
		detail: 'The file and the answers are safe. Try loading them again.',
		retry: 'Try again',
		again: 'Still didn’t load. Try again in a moment.'
	},
	retrying: 'Asking Maester to try again…',
	identifyFailed: {
		title: 'Maester couldn’t work out what this is.',
		detail: 'The file is safe. Try again, and if it stops again, tell us which file it was.',
		retry: 'Try again'
	},
	readFailed: {
		title: 'Maester couldn’t read the statements.',
		detail: 'The file and what Maester worked out about it are safe. Try reading it again.',
		retry: 'Try again'
	},
	uploadUnfinished: {
		title: 'The upload didn’t finish.',
		detail: 'Maester never received the whole file. Add it again.'
	},
	checkFailed: {
		title: 'Maester couldn’t check this file.',
		detail: 'The file is kept as it arrived. Add it again, and if it stops again, tell us.'
	},
	rejected: {
		UNSUPPORTED_TYPE: {
			title: 'This file isn’t a PDF.',
			detail: 'Save it as a PDF and add it again.'
		},
		TOO_LARGE: {
			title: 'This file is larger than 50 MB.',
			detail: 'Maester takes PDFs up to 50 MB. Add a smaller copy.'
		},
		OBJECT_MISSING: {
			title: 'The upload didn’t arrive.',
			detail: 'Maester never received the file. Add it again.'
		}
	},

	earlier: {
		heading: 'Earlier',
		empty: 'Nothing added yet.',
		more: (count: number) => `Showing the ${count} most recent.`
	},

	/** What it is, in plain words. */
	kinds: {
		annual_report: 'Annual report',
		financial_results: 'Financial results',
		other: 'Other company document',
		not_sure: 'Not sure'
	},
	otherTypes: {
		shareholding_pattern: 'Shareholding pattern',
		shareholder_notice: 'Notice to shareholders',
		board_meeting: 'Board meeting',
		investor_presentation: 'Investor presentation',
		earnings_call: 'Earnings call',
		governance_filing: 'Governance filing',
		announcement: 'Announcement',
		offer_document: 'Offer document',
		unlisted_type: 'Other company document'
	} satisfies Record<OtherType, string>,
	spans: {
		quarter: 'quarter',
		half_year: 'half year',
		nine_months: 'nine months',
		full_year: 'full year'
	} satisfies Record<ResultsSpan, string>,
	statements: {
		balance_sheet: 'Balance sheet',
		income_statement: 'Profit and loss',
		cash_flow: 'Cash flow'
	},
	bases: {
		consolidated: 'consolidated',
		standalone: 'standalone',
		unknown: 'basis not stated'
	},

	/** Where a document stands, in plain words. */
	states: {
		uploading: 'Uploading',
		uploadUnfinished: 'Upload didn’t finish',
		checking: 'Checking the file',
		checkFailed: 'Couldn’t check the file',
		rejected: {
			UNSUPPORTED_TYPE: 'Not a PDF',
			TOO_LARGE: 'Too large',
			OBJECT_MISSING: 'Upload didn’t arrive'
		},
		identifying: 'Working out what it is',
		reading: 'Reading the statements',
		read: 'Ready',
		kept: 'Kept, not read',
		needs_company: 'Needs you: confirm the company',
		needs_kind: 'Needs you: what is it?',
		duplicate: 'Added before',
		identify_failed: 'Couldn’t work out what it is',
		read_failed: 'Couldn’t read the statements'
	},

	changeFailed: {
		changed: 'These answers changed since you opened them. Here is the latest.',
		moved: 'This document has moved on since you opened it. Here is the latest.',
		companyClash:
			'You already have a company with this name or number. Pick it from your companies instead.',
		nothing: 'That is already the answer. Nothing was changed.',
		invalid: 'Maester couldn’t save that answer. Check it and try again.',
		signedOut: 'You’re signed out. Sign in and try again.',
		offline: 'That didn’t reach Maester. Check your connection and try again.',
		other: 'That didn’t save. Try again.'
	},
	/** Announced once, politely, when the open slip's document moves on. */
	announce: (name: string, state: string) => `${name}: ${state}${/[.?!]$/.test(state) ? '' : '.'}`
} as const;
