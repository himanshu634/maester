/**
 * Copy for the terminal overview that is not part of the synthetic portfolio itself
 * (that lives in lib/terminal/fixture.ts). Same rules as content/index.ts: every figure
 * shown beside this copy is synthetic and labelled so.
 */
export const terminalContent = {
	demoTag: 'Synthetic example',
	snapshotTag: 'Holdings snapshot',
	workspace: 'Long-term',
	pageTitle: 'Overview (synthetic demo). Maester',
	quietPageTitle: 'Overview, quiet week (synthetic demo). Maester',
	shell: {
		navLabel: 'Terminal',
		footNavLabel: 'Activity and settings',
		overview: 'Overview',
		soon: 'Soon',
		menu: 'Menu',
		workspaceLabel: 'Workspace',
		workspaceName: 'Personal',
		contextLabel: 'Portfolio',
		portfolio: (name: string) => `Portfolio: ${name}`,
		signedInAs: 'Signed in as',
		signOut: 'Sign out',
		signingOut: 'Signing out…',
		signOutFailed: 'Sign-out didn’t finish. Try again.'
	},
	readOnlyNote: 'Read-only demo. Decisions and updates arrive with your account.',
	leaveDemo: 'Leave the demo',
	actions: {
		updateHoldings: 'Update holdings',
		startReview: 'Start the review',
		moveToNextWeek: 'Move to next week'
	},
	due: {
		heading: 'Due this week',
		quietHeading: 'Nothing is due this week',
		quietLede: 'That is a checked answer, not a quiet feed. Here is what was looked at.',
		labels: { trigger: 'Trigger', evidence: 'Evidence', call: 'Your call' },
		/**
		 * "3 items. Decisions first, then data to fix." when decisions and data fixes are both
		 * due, otherwise just the count: "2 items." / "1 item."
		 */
		subtitle: (count: number, mixed: boolean) => {
			const counted = count === 1 ? '1 item.' : `${count} items.`;
			return mixed ? `${counted} Decisions first, then data to fix.` : counted;
		}
	},
	figures: {
		knownValue: 'Known value',
		cash: 'Cash',
		cashNote: 'As you entered it on 30 Sep',
		gain: 'Unrealized gain',
		gainNoneCosted: 'Counts holdings with a price and a known cost; none has both yet.',
		unknownValue: 'Unknown until a holding has a price',
		unknownGain: 'Unknown until a holding has both a price and a cost',
		coverage: 'Valuation coverage',
		coverageComplete: 'Every holding has a price',
		pricedOf: (priced: number, count: number) => `${priced} of ${count} holdings priced`
	},
	holdings: {
		heading: 'Holdings',
		columns: {
			company: 'Company',
			quantity: 'Quantity',
			price: 'Price',
			value: 'Value',
			weight: 'Weight'
		},
		noPrice: 'No price entered',
		pricedOf: (priced: number, count: number) => `${priced} of ${count} priced`
	},
	allocation: {
		heading: 'Allocation by sector',
		note: 'Share of priced value.'
	},
	research: {
		heading: 'Research updates',
		aside: 'Companies you own'
	},
	/**
	 * The signed-in pages that do not work yet (ComingSoon). Each says what the page will do
	 * for the investor, then what it needs first. The sketch lines are the hand lettering inside
	 * each page's drawing, which carries no information: `label` is its text alternative.
	 */
	comingSoon: {
		tag: 'Coming soon',
		pages: {
			overview: {
				what: 'Your portfolio on one page: what needs your decision this week, what each holding is worth and where the money sits.',
				needs: 'It opens once your holdings are in Maester.',
				sketch: {
					label:
						'A sketch of a paint roller on a half-painted wall. Dragging the roller paints the wall, but the paint runs out halfway across.',
					idle: 'roll it across the wall',
					rolling: 'nice and even…',
					dry: 'out of paint. needs another coat'
				}
			},
			holdings: {
				what: 'Every position you own, with its weight, cost and the date of its price. We’re still building it.',
				needs: 'It opens once you can add your holdings.',
				sketch: {
					label:
						'A sketch of a crane holding a block labelled Holdings over a half-built wall. Dragging the block down lowers it, but the wall is not finished.',
					idle: 'drag the load down',
					lower: 'a little lower…',
					landed: 'not yet! the walls are still going up'
				}
			},
			research: {
				what: 'Each company you own or follow, with the figures from its filings and the page each figure came from.',
				needs: 'It fills in as the filings for your companies are read.',
				sketch: {
					label:
						'A sketch of a filing cabinet. Dragging the top drawer open shows it holds a single note that says being sorted.',
					idle: 'pull the drawer open',
					open: 'just one note so far',
					note: ['being', 'sorted']
				}
			},
			watchlist: {
				what: 'Companies you’re watching but don’t own yet, each with the date you meant to look again and what has changed since.',
				needs: 'It opens with the research pages.',
				sketch: {
					label:
						'A sketch of a pair of binoculars over a quiet horizon. Dragging sweeps their view along the horizon, and there is nothing in it yet.',
					idle: 'sweep the horizon',
					empty: 'nothing in view yet'
				}
			},
			analyst: {
				what: 'Ask about a company you own and get an answer that shows its working and the page behind every figure.',
				needs: 'It answers from your filings, so it starts once they are read.',
				sketch: {
					label:
						'A sketch of a desk lamp beside an empty chair. Pulling the lamp’s cord switches the light on, and it shows the chair is still empty.',
					idle: 'pull the cord',
					on: 'the analyst starts soon',
					off: 'pull it again'
				}
			},
			activity: {
				what: 'A log of everything done for you: each filing read, each figure changed and who changed it.',
				needs: 'The first entries arrive with your first filing.',
				sketch: {
					label:
						'A sketch of an open logbook and a pencil. Dragging the pencil along the first line writes first entry soon.',
					idle: 'drag the pencil along the line',
					writing: 'keep going…',
					written: 'that’s the only line for now',
					entry: 'first entry soon'
				}
			},
			settings: {
				what: 'Your account, your preferences and what happens to your data, in one place.',
				needs: 'Until it opens, you can sign out below the page list.',
				sketch: {
					label:
						'A sketch of a spanner on a bolt in a half-assembled bracket. Dragging around the bolt turns the spanner; some parts are still missing.',
					idle: 'turn the spanner',
					turning: 'a little tighter…',
					done: 'still fitting the parts'
				}
			}
		}
	}
} as const;
