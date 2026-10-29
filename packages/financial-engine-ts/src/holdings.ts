import Decimal from "decimal.js";

/**
 * Holdings across broker accounts (Holdings page). Every input is a fact read from a broker (a
 * quantity, a T+1 quantity, an average price) or Maester's stored NSE close; every output is one
 * of the calculations below. Money is rounded to the paisa and a per cent to one decimal place,
 * half up. Unknown stays unknown: a row with no close has no value, no gain and no weight.
 */
export const HOLDINGS_CALCULATIONS = [
  { id: "holding_quantity", version: 1, description: "Settled quantity plus T+1 quantity, summed over the accounts holding the ISIN." },
  { id: "holding_cost", version: 1, description: "Each account's quantity × its average price, summed over the accounts. Unknown when any average price is unknown or zero." },
  { id: "holding_value", version: 1, description: "Quantity × the NSE close. Unknown without a close." },
  { id: "holdings_totals", version: 1, description: "Known value over priced rows, cost over costed rows, unrealized gain over rows with both." },
  { id: "holding_weight", version: 1, description: "A row's value ÷ the known value, as a per cent to one decimal place." },
  { id: "holding_gain", version: 1, description: "Value less cost, for a row or one account's part of it. Unknown without both." },
  { id: "holding_gain_percent", version: 1, description: "Gain ÷ the cost it was worked from, as a per cent to one decimal place. Unknown without a gain or with a cost of zero." },
  { id: "holding_average_price", version: 2, description: "An account's cost ÷ its quantity, to the paisa, when it holds one ISIN on more than one exchange; otherwise the broker's own average price. Unknown when the account's cost is unknown." },
  { id: "holdings_by_account", version: 1, description: "Each account's known value, cost and gain over its parts, with how many parts each covers." },
] as const;

/**
 * One account's line for an ISIN. `account` keys the part's result; parts with the same key are merged.
 * `averagePrice` is null when the broker gave none.
 */
export type HoldingPartInput = { account?: string; quantity: string; t1Quantity: string; averagePrice: string | null };
export type HoldingInput = { isin: string; parts: HoldingPartInput[]; close: string | null };
export type HoldingUnknown = "NO_CLOSE" | "NO_COST";
export type HoldingPartResult = {
  account: string | null;
  quantity: string;
  /** Null when the cost is unknown (NO_COST), never "0". */
  averagePrice: string | null;
  cost: string | null;
  value: string | null;
  gain: string | null;
  gainPercent: string | null;
};
export type HoldingResult = {
  isin: string;
  quantity: string;
  cost: string | null;
  value: string | null;
  weight: string | null;
  gain: string | null;
  gainPercent: string | null;
  unknown: HoldingUnknown[];
  parts: HoldingPartResult[];
};
export type HoldingsTotals = {
  knownValue: string | null;
  priced: number;
  count: number;
  cost: string | null;
  costed: number;
  unrealizedGain: string | null;
  gainCovers: number;
  /** holding_gain_percent over the rows with both a value and a cost (never over `cost`, which counts unpriced rows). */
  gainPercent: string | null;
};
export type AccountTotals = {
  account: string;
  knownValue: string | null;
  priced: number;
  count: number;
  cost: string | null;
  costed: number;
  gain: string | null;
  gainCovers: number;
  gainPercent: string | null;
};

const money = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const percent1 = (d: Decimal) => d.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);

/** holding_quantity v1. */
export function holdingQuantity(parts: HoldingPartInput[]): Decimal {
  return parts.reduce((s, p) => s.plus(p.quantity).plus(p.t1Quantity), new Decimal(0));
}

/**
 * holding_cost v1. An average price the broker did not give, or gave as zero, is a broker that does
 * not know the cost, so the cost is unknown.
 */
export function holdingCost(parts: HoldingPartInput[]): Decimal | null {
  let sum = new Decimal(0);
  for (const p of parts) {
    if (p.averagePrice === null) return null;
    const avg = new Decimal(p.averagePrice);
    if (avg.isZero()) return null;
    sum = sum.plus(new Decimal(p.quantity).plus(p.t1Quantity).times(avg));
  }
  return sum;
}

/** holding_gain v1. */
export function holdingGain(value: Decimal | null, cost: Decimal | null): Decimal | null {
  return value === null || cost === null ? null : value.minus(cost);
}

/** holding_gain_percent v1. */
export function holdingGainPercent(gain: Decimal | null, cost: Decimal | null): Decimal | null {
  return gain === null || cost === null || cost.isZero() ? null : gain.div(cost).times(100);
}

type Part = { account: string | null; lines: HoldingPartInput[]; quantity: Decimal; cost: Decimal | null; value: Decimal | null };

/** The parts of one ISIN, merged by account in the order each account first appears. */
function partsOf(h: HoldingInput): Part[] {
  const by = new Map<string, HoldingPartInput[]>();
  const order: string[] = [];
  h.parts.forEach((p, i) => {
    const key = p.account ?? `#${i}`;
    if (!by.has(key)) {
      by.set(key, []);
      order.push(key);
    }
    by.get(key)!.push(p);
  });
  return order.map((key) => {
    const lines = by.get(key)!;
    const quantity = holdingQuantity(lines);
    return { account: lines[0]!.account ?? null, lines, quantity, cost: holdingCost(lines), value: h.close === null ? null : quantity.times(h.close) };
  });
}

/**
 * holding_average_price v2: the broker's own figure for one line; for merged lines, cost ÷ quantity.
 * Unknown (null) whenever the part's cost is unknown, so an average the broker gave as zero or not
 * at all never reaches the page as ₹0.00. v1 returned "0" there.
 */
function averagePrice(p: Part): string | null {
  if (p.cost === null) return null;
  if (p.lines.length === 1) return p.lines[0]!.averagePrice;
  if (p.quantity.isZero()) return null;
  return money(p.cost.div(p.quantity));
}

/** All the calculations over the workspace's holdings: rows in the order given, accounts in the order they first appear. */
export function holdingsSnapshot(inputs: HoldingInput[]): { rows: HoldingResult[]; totals: HoldingsTotals; accounts: AccountTotals[] } {
  const base = inputs.map((h) => {
    const parts = partsOf(h);
    const quantity = holdingQuantity(h.parts);
    const cost = holdingCost(h.parts);
    const value = h.close === null ? null : quantity.times(h.close);
    return { isin: h.isin, quantity, cost, value, gain: holdingGain(value, cost), parts };
  });
  const priced = base.filter((r) => r.value !== null);
  const knownValue = priced.length ? priced.reduce((s, r) => s.plus(r.value!), new Decimal(0)) : null;
  const costed = base.filter((r) => r.cost !== null);
  const both = base.filter((r) => r.gain !== null);
  const bothCost = both.reduce((s, r) => s.plus(r.cost!), new Decimal(0));
  const unrealizedGain = both.length ? both.reduce((s, r) => s.plus(r.gain!), new Decimal(0)) : null;

  const rows = base.map((r): HoldingResult => {
    const unknown: HoldingUnknown[] = [];
    if (r.value === null) unknown.push("NO_CLOSE");
    if (r.cost === null) unknown.push("NO_COST");
    const weight = r.value !== null && knownValue && !knownValue.isZero() ? percent1(r.value.div(knownValue).times(100)) : null;
    const pct = holdingGainPercent(r.gain, r.cost);
    return {
      isin: r.isin,
      quantity: r.quantity.toString(),
      cost: r.cost ? money(r.cost) : null,
      value: r.value ? money(r.value) : null,
      weight,
      gain: r.gain ? money(r.gain) : null,
      gainPercent: pct ? percent1(pct) : null,
      unknown,
      parts: r.parts.map((p) => {
        const gain = holdingGain(p.value, p.cost);
        const gp = holdingGainPercent(gain, p.cost);
        return {
          account: p.account,
          quantity: p.quantity.toString(),
          averagePrice: averagePrice(p),
          cost: p.cost ? money(p.cost) : null,
          value: p.value ? money(p.value) : null,
          gain: gain ? money(gain) : null,
          gainPercent: gp ? percent1(gp) : null,
        };
      }),
    };
  });

  // holdings_by_account v1: the same sums as the totals, over one account's parts.
  const acc = new Map<string, { value: Decimal; priced: number; count: number; cost: Decimal; costed: number; gain: Decimal; gainCost: Decimal; gainCovers: number }>();
  for (const r of base) {
    for (const p of r.parts) {
      if (p.account === null) continue;
      const a = acc.get(p.account) ?? { value: new Decimal(0), priced: 0, count: 0, cost: new Decimal(0), costed: 0, gain: new Decimal(0), gainCost: new Decimal(0), gainCovers: 0 };
      a.count += 1;
      if (p.value !== null) {
        a.value = a.value.plus(p.value);
        a.priced += 1;
      }
      if (p.cost !== null) {
        a.cost = a.cost.plus(p.cost);
        a.costed += 1;
      }
      const gain = holdingGain(p.value, p.cost);
      if (gain !== null) {
        a.gain = a.gain.plus(gain);
        a.gainCost = a.gainCost.plus(p.cost!);
        a.gainCovers += 1;
      }
      acc.set(p.account, a);
    }
  }
  const accounts = [...acc.entries()].map(([account, a]): AccountTotals => {
    const gain = a.gainCovers ? a.gain : null;
    const pct = holdingGainPercent(gain, a.gainCovers ? a.gainCost : null);
    return {
      account,
      knownValue: a.priced ? money(a.value) : null,
      priced: a.priced,
      count: a.count,
      cost: a.costed ? money(a.cost) : null,
      costed: a.costed,
      gain: gain ? money(gain) : null,
      gainCovers: a.gainCovers,
      gainPercent: pct ? percent1(pct) : null,
    };
  });

  const totalPct = holdingGainPercent(unrealizedGain, both.length ? bothCost : null);
  return {
    rows,
    totals: {
      knownValue: knownValue ? money(knownValue) : null,
      priced: priced.length,
      count: base.length,
      cost: costed.length ? money(costed.reduce((s, r) => s.plus(r.cost!), new Decimal(0))) : null,
      costed: costed.length,
      unrealizedGain: unrealizedGain ? money(unrealizedGain) : null,
      gainCovers: both.length,
      gainPercent: totalPct ? percent1(totalPct) : null,
    },
    accounts,
  };
}
