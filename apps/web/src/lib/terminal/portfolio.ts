/** What a portfolio is worth, from the holdings you entered. Unknown stays null, never zero. */

export interface Holding {
	name: string;
	quantity: number;
	price: number | null;
	cost: number | null;
	sector: string | null;
	/** ISO date (YYYY-MM-DD) of the next thesis review, if one is set. */
	reviewDate: string | null;
}

export interface Valued extends Holding {
	value: number | null;
	/** Percent of the known value. */
	weight: number | null;
}

export interface SectorShare {
	label: string;
	/** Percent of the known value. */
	share: number;
	unknown: boolean;
}

export interface Valuation {
	/** Largest value first, unpriced last. */
	holdings: Valued[];
	knownValue: number;
	priced: number;
	count: number;
	/** Over holdings with both a price and a cost; 0 when there are none (see withCost). */
	gain: number;
	/** Percent of the cost of those holdings; null when that cost is zero or there are none. */
	gainPercent: number | null;
	withCost: number;
	/** Largest share first, the unknown bucket last. Empty when no value is known. */
	sectors: SectorShare[];
}

export const UNKNOWN_SECTOR = 'Sector not set';

export function valuePortfolio(holdings: readonly Holding[]): Valuation {
	const priced = holdings.flatMap((h) =>
		h.price === null ? [] : [{ holding: h, value: h.quantity * h.price }]
	);
	const knownValue = priced.reduce((sum, p) => sum + p.value, 0);
	// Weights and shares exist only against a known, positive value.
	const share = (value: number): number | null =>
		knownValue > 0 ? (value / knownValue) * 100 : null;

	const valued: Valued[] = holdings
		.map((h) => {
			const value = h.price === null ? null : h.quantity * h.price;
			return { ...h, value, weight: value === null ? null : share(value) };
		})
		.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

	// Gain only counts holdings that have both a price and a cost.
	const costed = priced.filter((p) => p.holding.cost !== null);
	const costBasis = costed.reduce((sum, p) => sum + p.holding.quantity * (p.holding.cost ?? 0), 0);
	const gain = costed.reduce(
		(sum, p) => sum + p.value - p.holding.quantity * (p.holding.cost ?? 0),
		0
	);

	const bySector = new Map<string, number>();
	for (const p of knownValue > 0 ? priced : []) {
		const label = p.holding.sector ?? UNKNOWN_SECTOR;
		bySector.set(label, (bySector.get(label) ?? 0) + p.value);
	}
	const sectors: SectorShare[] = [...bySector]
		.map(([label, value]) => ({
			label,
			share: (value / knownValue) * 100,
			unknown: label === UNKNOWN_SECTOR
		}))
		.sort((a, b) => Number(a.unknown) - Number(b.unknown) || b.share - a.share);

	return {
		holdings: valued,
		knownValue,
		priced: priced.length,
		count: holdings.length,
		gain,
		gainPercent: costBasis > 0 ? (gain / costBasis) * 100 : null,
		withCost: costed.length,
		sectors
	};
}
