/**
 * Copy for the Documents page (/terminal/documents). Plain words from the investor's side
 * (docs/DESIGN.md section 7): what Maester did with a file and what is left to do. Every
 * answer Maester gives shows the page and words it came from; never a confidence.
 */
import type {
	OtherType,
	RejectionCode,
	ResultsSpan,
	XbrlFormatKind,
	XbrlPdfNotChecked,
	XbrlReadWarning
} from '$lib/documents/types';

/** Said by the Numbers track and by the statement sources alike: one string each. */
const noXbrlWords = 'No XBRL for this filing.';
const xbrlUnreadableWords = 'The XBRL file couldn’t be read.';

export const documentsContent = {
	heading: 'Documents',
	lede: 'Add a filing and Maester works out what it is, then reads it. Wrong guess? Change it and it’s read again.',
	drop: {
		title: 'Drop PDFs or XBRL files here',
		or: 'or',
		chooseFiles: 'Choose files',
		chooseFolder: 'Choose a folder',
		/** The limit, said before anything is chosen. */
		note: 'PDF or XBRL (.xml), up to 50 MB a file. A whole folder works too.',
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
		/** The Notice's first line when the connection dropped: how many went of how many chosen. */
		unfinishedTitle: (sent: number, total: number) =>
			total === 1
				? 'The upload didn’t finish. The file wasn’t sent.'
				: `The upload didn’t finish. ${sent} of ${total} files ${sent === 1 ? 'was' : 'were'} sent.`,
		/** Under "Send the rest": a file that had started may be left unfinished (Decision 11). */
		restNote:
			'A file that had started sending may also show under “Company not known yet” as unfinished. Documents can’t be removed yet.',
		sendRest: 'Send the rest',
		stopped: {
			'signed-out': (count: number) =>
				`You’re signed out, so the other ${count === 1 ? 'file wasn’t' : `${count} files weren’t`} sent. Sign in and add ${count === 1 ? 'it' : 'them'} again.`
		},
		chooseAgain: 'Choose files to add',
		signIn: 'Sign in'
	},
	/** Why a file wasn't added: after its name in the batch Notice, browser and API alike. */
	refusals: {
		notPdf: 'Not a PDF or an XBRL file.',
		notPdfKnown: (what: string) => `${what}, not a PDF.`,
		notPdfInside: 'Named .pdf, but not a PDF inside.',
		notXmlInside: 'Named .xml, but not XML inside.',
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
		/** An answer read from an XBRL file: the element and its value, in place of a page. */
		fromElement: (element: string, value: string | null) =>
			value ? `${element} ${value}` : element,
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

	/**
	 * The opened filing (spec 2026-10-19 section 5). The Read as words are the slip's, copied; the
	 * slip's group goes when its last reader does.
	 */
	filing: {
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
		seeFigures: 'See the figures',
		readAgain: 'Read it again',
		opensInNewTab: 'Files open in a new tab.',
		tryAgain: 'Try again',
		/** The entries' names: the two tracks and the files. */
		numbers: 'Numbers',
		text: 'Text',
		files: 'Files',
		/** The statement sources' column headers. */
		columns: { statement: 'Statement', from: 'Numbers from', inPdf: 'In the PDF' }
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
			title: 'Not a PDF or an XBRL file.',
			detail: 'Save it as a PDF, or add the XBRL instance (.xml), and add it again.'
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

	/**
	 * A filing's two tracks in words (spec 2026-10-19 sections 4 and 5, board S1). Only "Needs you" and
	 * "Stopped" are bold, which the component decides from the track's state (Decision 18).
	 */
	tracks: {
		/** The two tracks' labels, in a filing's row and in the opened filing. */
		numbersLabel: 'Numbers',
		textLabel: 'Text',
		/** A track with nothing to say yet. */
		none: '—',
		sending: 'Sending',
		stopped: 'Stopped',
		needsYou: 'Needs you',
		notRead: 'Not read',
		uploadUnfinished: 'The upload didn’t finish. Add it again.',
		rejected: {
			UNSUPPORTED_TYPE: 'Not a PDF or an XBRL file.',
			TOO_LARGE: 'Larger than 50 MB.',
			OBJECT_MISSING: 'The upload didn’t arrive.'
		} satisfies Record<RejectionCode, string>,
		checkFailed: 'Maester couldn’t check this file.',
		checking: 'Checking the file',
		duplicate: 'You added this file before.',
		identifyFailed: 'Maester couldn’t work out what this is.',
		identifying: 'Working out what it is',
		sayWhatItIs: 'Say what it is.',
		confirmCompany: 'Confirm the company.',
		numbersFailed: 'Maester couldn’t read the numbers.',
		fromXbrlNow: 'From XBRL · reading now',
		fromXbrlNext: 'From XBRL · next',
		fromXbrlDone: 'From XBRL · done',
		fromXbrlAndPdfDone: 'From XBRL and the PDF · done',
		pdfNow: 'Read from the PDF · now',
		pdfNext: 'Read from the PDF · next',
		pdfDone: 'Read from the PDF · done',
		waitingForXbrl: 'Waiting for XBRL',
		pdfWaitsForIt: 'The PDF waits for it, so Gemini reads only what XBRL doesn’t cover.',
		/** One XBRL file is read first; its name is "An XBRL file" when the page does not know it. */
		beingRead: (name: string | null) =>
			`${name ?? 'An XBRL file'} is being read. Gemini reads only what it doesn’t cover.`,
		manyBeingRead: (count: number) =>
			`${count} XBRL files are being read. Gemini reads only what they don’t cover.`,
		noXbrl: noXbrlWords,
		xbrlUnreadable: xbrlUnreadableWords,
		xbrlFailedOne: 'Maester couldn’t read the XBRL file.',
		xbrlFailedNamed: (name: string) => `${name} couldn’t be read.`,
		xbrlFailedMany: (count: number) => `${count} XBRL files couldn’t be read.`,
		geminiReadPdf: ' Gemini read the PDF.',
		notReadFromXbrl: 'Not read from XBRL',
		keptKind: 'Maester reads annual reports and financial results for now.',
		/** "The XBRL is in the banking format, not mapped yet." */
		unmapped: (format: string) => `The XBRL is in ${format}, not mapped yet.`,
		formats: {
			banking: 'the banking format',
			nbfc: 'the NBFC format',
			other_than_ind_as: 'the “other than Ind AS” format',
			ind_as: 'the Ind AS format',
			unknown: 'a format Maester doesn’t know yet'
		} satisfies Record<XbrlFormatKind, string>,
		/** Said after the check, so a partial read is never a clean "done" in words. */
		warnings: {
			XBRL_ROUNDING_MISSING: 'The XBRL file doesn’t declare its rounding, so its unit isn’t known.',
			XBRL_ROUNDING_MISMATCH: 'Its rounding doesn’t match the rounding it declares.',
			XBRL_ELEMENT_UNMAPPED: 'Some of its lines aren’t mapped yet, so they aren’t read.',
			XBRL_NIL: 'Some lines are filed with no value.'
		} satisfies Record<XbrlReadWarning, string>,
		partialRead: 'Part of the XBRL file wasn’t read.',
		/** The statements, in the order the split lists them, lower case. */
		statementNames: {
			income_statement: 'profit and loss',
			balance_sheet: 'balance sheet',
			cash_flow: 'cash flow'
		},
		split: {
			xbrl: (statements: string) => `XBRL: ${statements}.`,
			pdf: (statements: string) => `PDF: ${statements}.`,
			joined: (xbrl: string, pdf: string) => `${xbrl} ${pdf}`,
			oneSource: (basis: string, source: 'xbrl' | 'pdf') =>
				`${basis} from ${source === 'xbrl' ? 'XBRL' : 'the PDF'}`,
			mixed: (basis: string, xbrl: string, pdf: string) =>
				`${basis}: XBRL for ${xbrl}, the PDF for ${pdf}`
		},
		/** One XBRL basis: its check against the PDF, in a sentence. */
		check: {
			found: (found: number, checked: number) =>
				`${found} of ${checked} ${checked === 1 ? 'figure' : 'figures'} found in the PDF.`,
			missed: (count: number) =>
				`${count} ${count === 1 ? 'figure' : 'figures'} not found in the PDF.`,
			notChecked: {
				no_pdf: 'No PDF of these results in your documents.',
				scanned: 'The PDF’s statement pages are scanned, so the check didn’t run.',
				no_statement_pages: 'Maester didn’t find the statement pages in the PDF.',
				disabled: 'The check against the PDF is turned off.',
				not_yet: 'Checking against the PDF.',
				no_value: 'The XBRL file gives no value to look for in the PDF.',
				no_unit: 'With no unit known, its figures weren’t looked for in the PDF.'
			} satisfies Record<XbrlPdfNotChecked, string>,
			notCheckedUnknown: 'Not checked against the PDF.'
		},
		/** Two or more XBRL bases: each named, counted apart, never summed. */
		checkBases: {
			prefix: 'In the PDF: ',
			found: (basis: string, found: number, checked: number) =>
				`${basis} ${found} of ${checked} found`,
			notYet: (basis: string) => `${basis} not checked yet`,
			notChecked: (basis: string) => `${basis} not checked`,
			notCheckedWhy: (basis: string, why: string) => `${basis} not checked: ${why}`,
			why: {
				no_pdf: 'no PDF of these results',
				scanned: 'its statement pages are scanned',
				no_statement_pages: 'no statement pages found',
				disabled: 'the check is turned off',
				no_value: 'no value to look for',
				no_unit: 'its unit isn’t known'
			} satisfies Partial<Record<XbrlPdfNotChecked, string>>
		},
		text: {
			readingPages: 'Reading the pages',
			page: (read: number, of: number) => `Page ${read} of ${of}`,
			soFar: (ocr: number, chunks: number) =>
				`${ocr > 0 ? `${ocr} ${ocr === 1 ? 'page' : 'pages'} by OCR · ` : ''}${chunks} ${chunks === 1 ? 'passage' : 'passages'} so far`,
			readingXbrl: 'Reading the XBRL notes',
			inLine: 'In line',
			nextInLine: 'Next in line',
			inLineAhead: (ahead: number) => `In line, ${ahead} ahead`,
			waitingPdf: (pages: number) =>
				pages > 0 ? `PDF: ${pages} ${pages === 1 ? 'page' : 'pages'}` : 'PDF',
			waitingXbrl: 'XBRL: its notes',
			stopped: 'The text wasn’t indexed. Your numbers aren’t affected.',
			done: 'Done',
			donePartial: 'Done, some pages without text',
			/** The list's line: "22 pages, 4 by OCR · 61 passages · 12 XBRL notes". */
			listPages: (pages: number, ocr: number) =>
				`${pages} ${pages === 1 ? 'page' : 'pages'}${ocr > 0 ? `, ${ocr} by OCR` : ''}`,
			listPassages: (chunks: number) => `${chunks} ${chunks === 1 ? 'passage' : 'passages'}`,
			listNotes: (blocks: number) => `${blocks} XBRL ${blocks === 1 ? 'note' : 'notes'}`,
			/** The opened filing's line: "18 pages of the PDF, 2 by OCR, 52 passages; 12 notes from the XBRL". */
			openedPages: (pages: number) => `${pages} ${pages === 1 ? 'page' : 'pages'} of the PDF`,
			openedOcr: (ocr: number) => `${ocr} by OCR`,
			openedNotes: (blocks: number) => `${blocks} ${blocks === 1 ? 'note' : 'notes'} from the XBRL`
		}
	},

	/**
	 * The opened filing's statement sources, per basis (spec 2026-10-19 section 5, board C2): where
	 * each statement's numbers come from and whether its XBRL figures are on the PDF.
	 */
	sources: {
		basisTitle: {
			consolidated: 'Consolidated',
			standalone: 'Standalone',
			unknown: 'Basis not stated'
		},
		xbrl: 'XBRL',
		/** An XBRL statement with no span is an instant: "XBRL · at 30 Sep 2026". */
		xbrlAt: (day: string) => `XBRL · at ${day}`,
		xbrlSpans: (spans: string) => `XBRL · ${spans}`,
		/** The spans of an XBRL statement, in this order. */
		spans: {
			quarter: 'quarter',
			half_year: 'half year',
			nine_months: 'nine months',
			year: 'year',
			other: 'other periods'
		},
		pdf: 'PDF, read by Gemini',
		pdfPages: (pages: string) => `PDF, read by Gemini · ${pages}`,
		notInFiling: 'Not in this filing',
		notReadYet: 'Not read yet.',
		readStopped: 'The read stopped.',
		noXbrl: noXbrlWords,
		xbrlReadFailed: xbrlUnreadableWords,
		xbrlNotReadYet: 'The XBRL file isn’t read yet.',
		/** "The quarter’s XBRL has no cash flow"; without a span, "The XBRL has no cash flow". */
		lacks: (statement: string, span: string | null) =>
			`The ${span === null ? '' : `${span} `}XBRL has no ${statement}`,
		/** The shortest span of a filing, as a possessive. */
		possessive: {
			quarter: 'quarter’s',
			half_year: 'half year’s',
			nine_months: 'nine months’',
			full_year: 'year’s'
		},
		none: '—',
		found: (found: number, checked: number) => `Found: ${found} of ${checked}`,
		missed: (count: number) => `${count} not found.`,
		openPdf: (page: number) => `Open the results PDF at page ${page}`,
		notChecked: {
			no_pdf: 'Not checked: no PDF of these results is in your documents.',
			scanned:
				'Not checked: the PDF’s statement pages are scanned, so their text can’t be searched.',
			no_statement_pages: 'Not checked: Maester didn’t find the statement pages in the PDF.',
			disabled: 'Not checked: the check is turned off.',
			no_value: 'Not checked: the XBRL file gives no value to look for.',
			/** The XBRL file gives no unit Maester can name, so the check had no unit to look for. */
			no_unit: 'Not checked: its unit isn’t known.',
			not_yet: 'Not checked yet.'
		} satisfies Record<XbrlPdfNotChecked, string>,
		page: (page: number) => `page ${page}`,
		pagesRun: (first: number, last: number) => `pages ${first}–${last}`,
		pagesList: (list: string, last: number) => `pages ${list} and ${last}`
	},

	/** The page's sections (spec 2026-10-19 section 2). */
	sections: {
		working: 'Working on',
		done: 'Done',
		confirm: 'Not in your workspace yet',
		unknownCompany: 'Company not known yet'
	},

	/** A filing's title, heading, meta line and file lines, and the sections' counts. */
	titles: {
		/** "Results, quarter to 30 Sep 2026". */
		results: (span: string, day: string) => `Results, ${span} to ${day}`,
		resultsNoSpan: (day: string) => `Results to ${day}`,
		resultsNoPeriod: 'Results, period not stated',
		/** "Annual report 2025–26". */
		annualReport: (year: string) => `Annual report ${year}`,
		annualReportYearTo: (day: string) => `Annual report, year to ${day}`,
		annualReportNoPeriod: 'Annual report, period not stated',
		/** "Investor presentation, 14 Aug 2026". */
		other: (type: string, day: string) => `${type}, ${day}`,
		/** "Synthetic Cements · results, quarter to 30 Sep 2026". */
		heading: (company: string, title: string) => `${company} · ${title}`,
		files: (count: number) => (count === 1 ? '1 file' : `${count} files`),
		filings: (count: number) => (count === 1 ? '1 filing' : `${count} filings`),
		added: (when: string) => `added ${when}`,
		separator: ' · ',
		/** A file of a filing: "XBRL · 500999_Q2_FY27_Consolidated.xml". */
		format: { pdf: 'PDF', xbrl: 'XBRL' },
		/** A file added more than once: its copies count with it. */
		addedTimes: (times: number) => (times === 2 ? 'Added twice' : `Added ${times} times`),
		/** Done's button for a company with more than three filings. */
		showAll: (count: number, company: string) => `Show all ${count} filings of ${company}`,
		hiddenStopped: (count: number) => ` · ${count} stopped`,
		showNewest: (count: number) => `Show the newest ${count}`
	},

	/** "Not in your workspace yet": the printed companies to confirm, once each (spec section 7). */
	confirm: {
		/** "31 companies. Their 214 files wait until you confirm each company, once." */
		lede: (companies: number, files: number) =>
			companies === 1
				? `1 company. ${files === 1 ? 'Its file waits' : `Its ${files} files wait`} until you confirm it, once.`
				: `${companies} companies. Their ${files === 1 ? 'file waits' : `${files} files wait`} until you confirm each company, once.`,
		/** A row's "Add Coastline Bank"; "Add this company" when the filing prints no name. */
		add: (name: string) => `Add ${name}`,
		addUnnamed: 'Add this company',
		/** "27 more companies", then the button that lists them. */
		more: (count: number) => (count === 1 ? '1 more company' : `${count} more companies`),
		showAll: 'Show all',
		showFewer: 'Show fewer',
		/** Said once the investor's own confirm lands. */
		added: (name: string, files: number) =>
			files === 1
				? `${name} added. Its file carries on.`
				: `${name} added. Its ${files} files carry on.`,
		confirmed: (name: string, files: number) =>
			`${files === 1 ? '1 file' : `${files} files`} confirmed as ${name}.`,
		nothingWaiting: 'Nothing was waiting for this company any more.',
		/** A file that prints no code: its Notice, and the action on it. */
		/** The picker of the companies already added, and the way to it from an "Add" row. */
		pickerLabel: 'Your companies',
		oneOfMine: 'It’s one of mine',
		/** A row's action is running: its buttons are disabled and this line says why. */
		saving: 'Saving…',
		/** The companies read has not settled, so no row can say whether it matches one. */
		checkingCompanies: 'Checking which of your companies match…',
		/** An unnamed file's form could not open because its answers did not load. */
		answersFailed: 'What Maester read didn’t load. Try again.',
		loadingAnswers: 'Opening…',
		unnamedAction: 'Say which company',
		unnamedNoName: (file: string) => `${file}: which company is this?`,
		unnamedNoNameDetail:
			'Maester couldn’t find the company on the first pages. Say which it is and it carries on.',
		unnamedWithName: (file: string, name: string) => `${file}: is this ${name}?`,
		unnamedWithNameDetail:
			'No company code is printed beside the name, so Maester can’t match it. Add it, or say which of your companies it is.'
	},

	/** A question that arrives, said once (Decision 10). */
	questions: {
		confirmCompany: (who: string) => `${who} needs you: confirm the company.`,
		isThis: (file: string, company: string) => `${file} needs you: is this ${company}?`,
		whichCompany: (file: string) => `${file} needs you: which company is this?`,
		whatIsIt: (file: string) => `${file} needs you: what is it?`,
		/** A held company that prints neither a name nor a code; the API always gives one of them. */
		someCompany: 'A company',
		companies: (count: number) => (count === 1 ? '1 company' : `${count} companies`),
		/** "31 companies and 2 files need you"; the files are counted by `titles.files`. */
		many: (parts: string[]) => `${parts.join(' and ')} need you.`
	},

	/** The opened filing's file now waits under "Not in your workspace yet" (Decision 17). */
	waiting: {
		title: (name: string) => `${name} waits for you above.`,
		held: 'Confirm its company under “Not in your workspace yet”. It carries on from there.',
		unnamed: 'Say which company it is under “Not in your workspace yet”.',
		action: 'Go to it'
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
			UNSUPPORTED_TYPE: 'Not a PDF or an XBRL file',
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
		read_failed: 'Couldn’t read the statements',
		waiting_for_xbrl: 'Waiting for its XBRL file.'
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
