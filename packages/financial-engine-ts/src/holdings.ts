import Decimal from "decimal.js";

/**
 * Holdings across broker accounts (Holdings page). Every input is a fact read from a broker (a
 * quantity, a T+1 quantity, an average price) or Maester's stored NSE close; every output is one
 * of the calculations below. Money is rounded to the paisa and a weight to one decimal place of a
 * per cent, half up. Unknown stays unknown: a row with no close has no value and no weight.
 */
export const HOLDINGS_CALCULATIONS = [
  { id: "holding_quantity", version: 1, description: "Settled quantity plus T+1 quantity, summed over the accounts holding the ISIN." },
  { id: "holding_cost", version: 1, description: "Each account's quantity × its average price, summed over the accounts." },
  { id: "holding_value", version: 1, description: "Quantity × the NSE close. Unknown without a close." },
  { id: "holdings_totals", version: 1, description: "Known value over priced rows, cost over costed rows, unrealized gain over rows with both." },
  { id: "holding_weight", version: 1, description: "A row's value ÷ the known value, as a per cent to one decimal place." },
] as const;

export type HoldingPartInput = { quantity: string; t1Quantity: string; averagePrice: string };
export type HoldingInput = { isin: string; parts: HoldingPartInput[]; close: string | null };
export type HoldingUnknown = "NO_CLOSE" | "NO_COST";
export type HoldingResult = { isin: string; quantity: string; cost: string | null; value: string | null; weight: string | null; unknown: HoldingUnknown[] };
export type HoldingsTotals = { knownValue: string | null; priced: number; count: number; cost: string | null; costed: number; unrealizedGain: string | null; gainCovers: number };

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/** holding_quantity v1. */
export function holdingQuantity(parts: HoldingPartInput[]): Decimal {
  return parts.reduce((s, p) => s.plus(p.quantity).plus(p.t1Quantity), new Decimal(0));
}

/** holding_cost v1. An average price of zero is a broker that does not know the cost, so the cost is unknown. */
export function holdingCost(parts: HoldingPartInput[]): Decimal | null {
  let sum = new Decimal(0);
  for (const p of parts) {
    const avg = new Decimal(p.averagePrice);
    if (avg.isZero()) return null;
    sum = sum.plus(new Decimal(p.quantity).plus(p.t1Quantity).times(avg));
  }
  return sum;
}

/** All five calculations over the workspace's holdings, rows in the order given. */
export function holdingsSnapshot(inputs: HoldingInput[]): { rows: HoldingResult[]; totals: HoldingsTotals } {
  const base = inputs.map((h) => {
    const quantity = holdingQuantity(h.parts);
    const cost = holdingCost(h.parts);
    const value = h.close === null ? null : quantity.times(h.close);
    return { isin: h.isin, quantity, cost, value };
  });
  const priced = base.filter((r) => r.value !== null);
  const knownValue = priced.length ? priced.reduce((s, r) => s.plus(r.value!), new Decimal(0)) : null;
  const costed = base.filter((r) => r.cost !== null);
  const both = base.filter((r) => r.value !== null && r.cost !== null);
  const rows = base.map((r): HoldingResult => {
    const unknown: HoldingUnknown[] = [];
    if (r.value === null) unknown.push("NO_CLOSE");
    if (r.cost === null) unknown.push("NO_COST");
    const weight = r.value !== null && knownValue && !knownValue.isZero()
      ? r.value.div(knownValue).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1)
      : null;
    return { isin: r.isin, quantity: r.quantity.toString(), cost: r.cost ? money(r.cost) : null, value: r.value ? money(r.value) : null, weight, unknown };
  });
  return {
    rows,
    totals: {
      knownValue: knownValue ? money(knownValue) : null,
      priced: priced.length,
      count: base.length,
      cost: costed.length ? money(costed.reduce((s, r) => s.plus(r.cost!), new Decimal(0))) : null,
      costed: costed.length,
      unrealizedGain: both.length ? money(both.reduce((s, r) => s.plus(r.value!).minus(r.cost!), new Decimal(0))) : null,
      gainCovers: both.length,
    },
  };
}
