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
			watchlist: {
				what: 'Companies you’re watching but don’t own yet, each with the date you meant to look again and what has changed since.',
				needs: 'It starts once you can follow a company from Research.',
				sketch: {
					label:
						'A sketch of a pair of binoculars over a quiet horizon. Dragging sweeps their view along the horizon, and there is nothing in it yet.',
					idle: 'sweep the horizon',
					empty: 'nothing in view yet'
				}
			},
			analyst: {
				what: 'Each week, and whenever a filing is read, a small desk will review each company you own. Five of them write, your own limits check what they say, and you make the call.',
				needs:
					'The first of them starts once Maester can calculate from your filings, such as growth and margins.',
				/**
				 * How a review will run, until the first step works (plan:
				 * docs/superpowers/specs/2026-10-15-agents-design.md). Say what runs today before
				 * what is planned; no step promises advice, an order or a certainty.
				 */
				desk: {
					today: {
						title: 'What runs today',
						body: 'Your filings are read and every sum is checked. Each figure Maester shows comes from the page or from a named calculation, never from a guess. The desk will read only those figures.'
					},
					stepsHeading: 'How a review will run',
					labels: { reads: 'Reads', writes: 'Writes', never: 'Never' },
					steps: [
						{
							name: 'Read the filings',
							who: 'Filings analyst · writes',
							reads: 'Your filings’ figures and Maester’s calculations',
							writes: 'What changed in the business, and what looks wrong',
							never: 'Works out a figure itself or estimates a fair value',
							status: 'Not built yet',
							yours: false
						},
						{
							name: 'Read the price',
							who: 'Price analyst · writes',
							reads: 'Your Dhan closes',
							writes: 'Where the share stands against its own last two years',
							never: 'Predicts a price',
							status: 'Not built yet',
							yours: false
						},
						{
							name: 'Argue both sides',
							who: 'Bull and bear · write',
							reads: 'Only what steps 1 and 2 cited',
							writes: 'The strongest case for, and the strongest case against',
							never: 'Brings in a figure nobody cited',
							status: 'Not built yet',
							yours: false
						},
						{
							name: 'Weigh them',
							who: 'Reviewer · writes',
							reads: 'Both cases, your thesis and the market mood',
							writes: 'Which case is stronger, and what would change that',
							never: 'Tells you to buy or sell',
							status: 'Not built yet',
							yours: false
						},
						{
							name: 'Check your limits',
							who: 'Limits · rules you set',
							reads: 'Your holdings and your limits',
							writes: 'Within or over, for each limit',
							never: 'Adds risk. It can only make a review stricter.',
							status: 'Needs Holdings',
							yours: false
						},
						{
							name: 'Your call',
							who: 'You',
							reads: 'All of the above',
							writes: 'What you decided, and why',
							never: 'Maester never places an order',
							status: 'Today: you',
							yours: true
						}
					],
					sourceHeading: 'Every number has a source',
					sourceBody:
						'A writer may only repeat a figure Maester read or calculated, with its page. A sentence with any other number is refused before you see it.'
				},
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
			}
		}
	}
} as const;
