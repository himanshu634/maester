import type { DailyPoint } from "@maester/market";

/** Closes needed before a member counts towards the share above its 200-day average. */
const AVERAGE = 200;
/** Closes in a 52-week window: a member counts towards highs and lows only with this many. */
const YEAR = 252;

export type BreadthDay = { day: string; above200: number | null; netHighs: number | null };

/** Index of the point on `day`, or -1. `points` is sorted by day. */
function indexOn(points: DailyPoint[], day: string): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = points[mid]!.day;
    if (d === day) return mid;
    if (d < day) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Nifty 500 breadth on each of `days`, from each member's daily closes. A member counts on a day
 * only when it has a close on that day and enough closes up to it (200 for the average, 252 for
 * 52-week highs and lows), so a recent listing is left out rather than counted as below.
 * Each share is a percentage of the members counted, or null when none is.
 */
export function breadthOn(members: Map<string, DailyPoint[]>, days: string[]): BreadthDay[] {
  const prepared = [...members.values()].map((raw) => {
    const points = [...raw].sort((a, b) => a.day.localeCompare(b.day));
    const sums = new Float64Array(points.length + 1);
    for (let i = 0; i < points.length; i++) sums[i + 1] = sums[i]! + points[i]!.value;
    return { points, sums };
  });

  return days.map((day) => {
    let counted200 = 0;
    let above = 0;
    let counted252 = 0;
    let highs = 0;
    let lows = 0;
    for (const { points, sums } of prepared) {
      const i = indexOn(points, day);
      if (i < 0) continue;
      const close = points[i]!.value;
      const n = i + 1;
      if (n >= AVERAGE) {
        counted200++;
        if (close > (sums[n]! - sums[n - AVERAGE]!) / AVERAGE) above++;
      }
      if (n >= YEAR) {
        counted252++;
        let max = -Infinity;
        let min = Infinity;
        for (let j = n - YEAR; j < n; j++) {
          const v = points[j]!.value;
          if (v > max) max = v;
          if (v < min) min = v;
        }
        if (close >= max) highs++;
        if (close <= min) lows++;
      }
    }
    return {
      day,
      above200: counted200 ? (above / counted200) * 100 : null,
      netHighs: counted252 ? ((highs - lows) / counted252) * 100 : null,
    };
  });
}
