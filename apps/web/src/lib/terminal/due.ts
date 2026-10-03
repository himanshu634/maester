/** What is due this week. Decisions come before data fixes. */
import type { Valuation } from './portfolio';

export type DueKind = 'review' | 'limit' | 'missing-price';

export interface DueItem {
	kind: DueKind;
	holding: string;
	/** Percent of known value; null when the holding has no price. */
	weight: number | null;
}

/** One line of "what was checked" when nothing is due. */
export interface Check {
	label: string;
	detail: string;
}

/**
 * Category order is review, then limit, then missing price; within a category the larger
 * weight comes first. `today` and `weekEnd` are ISO dates. A review is due when its date
 * falls on or before `weekEnd`, so an overdue review stays due until it is reviewed.
 */
export function dueItems(
	v: Valuation,
	opts: { today: string; weekEnd: string; limit: number }
): DueItem[] {
	const byWeight = (a: DueItem, b: DueItem) => (b.weight ?? -1) - (a.weight ?? -1);
	const pick = (kind: DueKind, test: (h: Valuation['holdings'][number]) => boolean): DueItem[] =>
		v.holdings
			.filter(test)
			.map((h) => ({ kind, holding: h.name, weight: h.weight }))
			.sort(byWeight);

	return [
		...pick('review', (h) => h.reviewDate !== null && h.reviewDate <= opts.weekEnd),
		...pick('limit', (h) => h.weight !== null && h.weight > opts.limit),
		...pick('missing-price', (h) => h.price === null)
	];
}

/** True when the items hold both a decision (review or limit) and a data fix (missing price). */
export function mixesDecisionsAndData(items: readonly DueItem[]): boolean {
	return (
		items.some((i) => i.kind === 'missing-price') && items.some((i) => i.kind !== 'missing-price')
	);
}
