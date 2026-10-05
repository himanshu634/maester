/**
 * The signed-in terminal's pages, in rail order. Every page planned for the first release is
 * listed; one that does not work yet says "Soon" in the rail and opens a coming-soon page that
 * says what it will do (docs/DESIGN.md sections 7 and 10). The demo routes keep their own
 * one-item rail and are not listed here.
 */
export type TerminalPageKey =
	| 'overview'
	| 'holdings'
	| 'research'
	| 'watchlist'
	| 'documents'
	| 'analyst'
	| 'activity'
	| 'settings';

export type TerminalPath =
	| '/terminal'
	| '/terminal/holdings'
	| '/terminal/research'
	| '/terminal/watchlist'
	| '/terminal/documents'
	| '/terminal/analyst'
	| '/terminal/activity'
	| '/terminal/settings';

/** Portfolio pages, then research pages, then the pages kept at the foot of the rail. */
export type TerminalGroup = 'portfolio' | 'research' | 'foot';

export interface TerminalPage {
	key: TerminalPageKey;
	label: string;
	path: TerminalPath;
	group: TerminalGroup;
	/** True while the page is a coming-soon page: the rail adds "Soon" after its label. */
	soon: boolean;
}

export const terminalPages: readonly TerminalPage[] = [
	{ key: 'overview', label: 'Overview', path: '/terminal', group: 'portfolio', soon: true },
	{
		key: 'holdings',
		label: 'Holdings',
		path: '/terminal/holdings',
		group: 'portfolio',
		soon: true
	},
	{ key: 'research', label: 'Research', path: '/terminal/research', group: 'research', soon: true },
	{
		key: 'watchlist',
		label: 'Watchlist',
		path: '/terminal/watchlist',
		group: 'research',
		soon: true
	},
	{
		key: 'documents',
		label: 'Documents',
		path: '/terminal/documents',
		group: 'research',
		soon: true
	},
	{ key: 'analyst', label: 'Analyst', path: '/terminal/analyst', group: 'research', soon: true },
	{ key: 'activity', label: 'Activity', path: '/terminal/activity', group: 'foot', soon: true },
	{ key: 'settings', label: 'Settings', path: '/terminal/settings', group: 'foot', soon: true }
];

export function terminalPage(key: TerminalPageKey): TerminalPage {
	const found = terminalPages.find((page) => page.key === key);
	if (!found) throw new Error(`Unknown terminal page: ${key}`);
	return found;
}

/** The pages in one group, in rail order. */
export function pagesIn(group: TerminalGroup): TerminalPage[] {
	return terminalPages.filter((page) => page.group === group);
}

/** "Overview, Holdings, Research and Settings": the labels as one sentence-ready list. */
export function listLabels(pages: readonly TerminalPage[]): string {
	const labels = pages.map((page) => page.label);
	if (labels.length <= 1) return labels.join('');
	return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
