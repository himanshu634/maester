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
		overview: 'Overview',
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
	enterDemo: 'Explore the synthetic demo',
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
	}
} as const;
