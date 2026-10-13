import type { CompanyStock, StockPoint } from "@maester/contracts";

/** A share's NSE closes summarised for the Research summary. Pure: the route reads the points. */

const DAY = 86_400_000;
/** A close more than this many days before the year-ago day is too old to compare with. */
const YEAR_AGO_SLACK = 10;

export function minusDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
}

export function stockFrom(symbol: string, points: { day: string; value: number; source: string }[]): CompanyStock {
  const last = points.at(-1);
  if (!last) return { state: "not_tracked", symbol, source: null, last: null, previous: null, yearAgo: null, low: null, high: null, series: [] };
  const point = (p: { day: string; value: number }): StockPoint => ({ day: p.day, value: p.value });
  const yearBefore = minusDays(last.day, 365);
  const earlier = [...points].reverse().find((p) => p.day <= yearBefore);
  const yearAgo = earlier && earlier.day >= minusDays(yearBefore, YEAR_AGO_SLACK) ? point(earlier) : null;
  const series = points.filter((p) => p.day > yearBefore).map(point);
  let low = series[0]!;
  let high = series[0]!;
  for (const p of series) {
    if (p.value < low.value) low = p;
    if (p.value > high.value) high = p;
  }
  const previous = points.at(-2);
  return { state: "ok", symbol, source: last.source, last: point(last), previous: previous ? point(previous) : null, yearAgo, low, high, series };
}
