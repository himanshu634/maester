/**
 * Copy for the terminal overview that is not part of the synthetic portfolio itself
 * (that lives in lib/terminal/fixture.ts). Same rules as content/index.ts: every figure
 * shown beside this copy is synthetic and labelled so.
 */
export const terminalContent = {
	demoTag: 'Synthetic example',
	snapshotTag: 'Holdings snapshot',
	workspace: 'Long-term',
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
		/** "3 items. Decisions first, then data to fix." / "1 item." */
		subtitle: (count: number) =>
			count === 1 ? '1 item.' : `${count} items. Decisions first, then data to fix.`
	},
	figures: {
		knownValue: 'Known value',
		cash: 'Cash',
		cashNote: 'As you entered it on 30 Sep',
		gain: 'Unrealized gain',
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
