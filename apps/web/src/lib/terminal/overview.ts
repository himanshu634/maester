/**
 * Sentences the overview composes from a valuation: the collapsed due rows and the notes
 * under the figures and the sector bars. Kept out of the components so the copy is tested.
 */
import { terminalContent } from '$lib/content/terminal';
import type { DueItem } from './due';
import { inr, percent, quantity } from './format';
import type { Valuation, Valued } from './portfolio';

/** The review that `dueDetail` in fixture.ts describes. */
const DETAILED_REVIEW = 'Harbour Cements';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const dayMonth = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	timeZone: 'UTC'
});

/** `2026-10-14` as `14 Oct`. */
export function shortDate(iso: string): string {
	return dayMonth.format(new Date(`${iso}T00:00:00Z`));
}

/** True when the item is the review that has expanded copy in the fixture. */
export function hasDetail(item: DueItem): boolean {
	return item.kind === 'review' && item.holding === DETAILED_REVIEW;
}

/** A collapsed row in the due panel: a bold title and a muted detail. */
export function dueRow(
	item: DueItem,
	v: Valuation,
	limit: number
): { title: string; detail: string } {
	const h = v.holdings.find((x) => x.name === item.holding);
	switch (item.kind) {
		case 'limit':
			return {
				title: `${item.holding} is over your ${limit}% limit`,
				detail: `${percent(item.weight ?? 0)} of priced value · ${inr(h?.value ?? 0)}`
			};
		case 'missing-price':
			return {
				title: `${item.holding} has no price`,
				detail: `${quantity(h?.quantity ?? 0)} shares left out of value`
			};
		case 'review':
			return {
				title: `${item.holding} review is due`,
				detail: h?.reviewDate ? `Due ${shortDate(h.reviewDate)}` : ''
			};
	}
}

const unpriced = (v: Valuation): Valued[] => v.holdings.filter((h) => h.value === null);

/** `+16.9% on the 7 holdings with a known cost. 2 left out.` */
export function gainNote(v: Valuation): string {
	const shown = percent(v.gainPercent);
	const sign = Number(v.gainPercent.toFixed(1)) > 0 ? '+' : '';
	const base = `${sign}${shown} on the ${v.withCost} ${plural(v.withCost, 'holding', 'holdings')} with a known cost.`;
	const left = v.count - v.withCost;
	return left > 0 ? `${base} ${left} left out.` : base;
}

/** Names the unpriced holding, or says every holding has a price. */
export function coverageNote(v: Valuation): string {
	const missing = unpriced(v);
	if (missing.length === 0) return terminalContent.figures.coverageComplete;
	if (missing.length === 1) return `${missing[0].name} has no price`;
	return `${missing.length} holdings have no price`;
}

/** What the sector bars measure, what the dashed bar is, and what is left out. */
export function allocationNote(v: Valuation): string {
	const noSector = v.holdings.filter((h) => h.value !== null && h.sector === null);
	const missing = unpriced(v);
	const parts: string[] = [terminalContent.allocation.note];
	if (noSector.length === 1)
		parts.push(`The dashed bar is ${noSector[0].name}, which has no sector yet.`);
	else if (noSector.length > 1)
		parts.push(`The dashed bar is ${noSector.length} holdings that have no sector yet.`);
	if (missing.length === 1) parts.push(`${missing[0].name} stays out until it has a price.`);
	else if (missing.length > 1)
		parts.push(`${missing.length} holdings stay out until they have a price.`);
	return parts.join(' ');
}
