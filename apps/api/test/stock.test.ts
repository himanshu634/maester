import { describe, expect, it } from "vitest";
import { minusDays, stockFrom } from "../src/financials/stock.js";

const SRC = "Dhan · NSE close";
/** One close a day from `from` for `days` days, with the given values by index. */
function closes(from: string, days: number, value: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({ day: minusDays(from, -i), value: value(i), source: SRC }));
}
/** Every calendar day from `from` to `to`, both included, as ISO days. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = minusDays(d, -1)) out.push(d);
  return out;
}
/** One close on each listed day; `value` gets the day so a test can pick out one close. */
function on(days: string[], value: (day: string) => number = () => 500) {
  return days.map((day) => ({ day, value: value(day), source: SRC }));
}

describe("minusDays", () => {
  it("counts calendar days", () => {
    expect(minusDays("2026-10-10", 365)).toBe("2025-10-10");
    expect(minusDays("2026-03-01", 1)).toBe("2026-02-28");
  });
});

describe("stockFrom", () => {
  it("gives the last close, the one before, a year earlier, and the year's low and high", () => {
    const points = closes("2025-09-01", 405, (i) => 1000 + i);
    points[200]!.value = 900;
    const s = stockFrom("SYNCEM", points);
    const last = points.at(-1)!;
    expect(s.state).toBe("ok");
    expect(s.last).toEqual({ day: last.day, value: last.value });
    expect(s.previous).toEqual({ day: points.at(-2)!.day, value: points.at(-2)!.value });
    expect(s.yearAgo!.day).toBe(minusDays(last.day, 365));
    expect(s.low).toEqual({ day: points[200]!.day, value: 900 });
    expect(s.high).toEqual({ day: last.day, value: last.value });
    expect(s.series[0]!.day > minusDays(last.day, 365)).toBe(true);
    expect(s.series.at(-1)!.day).toBe(last.day);
    expect(s.source).toBe(SRC);
  });

  it("has no close a year earlier when the closes start later than that", () => {
    const s = stockFrom("NEWCO", closes("2026-06-01", 60, () => 500));
    expect(s.yearAgo).toBeNull();
    expect(s.series).toHaveLength(60);
  });

  it("has no close before a single day", () => {
    const s = stockFrom("ONE", closes("2026-10-10", 1, () => 500));
    expect(s.previous).toBeNull();
    expect(s.low).toEqual({ day: "2026-10-10", value: 500 });
  });

  it("takes the nearest earlier close when the year-before day has none", () => {
    const skip = new Set(["2025-10-08", "2025-10-09", "2025-10-10"]);
    const days = daysBetween("2025-09-01", "2026-10-10").filter((d) => !skip.has(d));
    const s = stockFrom("GAPCO", on(days, (d) => (d === "2025-10-07" ? 777 : 500)));
    expect(s.yearAgo).toEqual({ day: "2025-10-07", value: 777 });
  });

  it("has no close a year earlier when the only earlier close is 11 days before the year-before day", () => {
    const days = [...daysBetween("2025-09-01", "2025-09-29"), ...daysBetween("2025-10-11", "2026-10-10")];
    const s = stockFrom("SLACKCO", on(days));
    expect(s.yearAgo).toBeNull();
  });

  it("ignores closes on or before the window start when taking the year's low and high", () => {
    const s = stockFrom(
      "EDGECO",
      on(daysBetween("2025-09-01", "2026-10-10"), (d) => {
        if (d === "2025-10-10") return 1; // the window start: a lower close, excluded
        if (d === "2025-10-09") return 9999; // just before the window: a higher close, excluded
        if (d === "2026-01-05") return 400;
        if (d === "2026-02-05") return 600;
        return 500;
      }),
    );
    expect(s.low).toEqual({ day: "2026-01-05", value: 400 });
    expect(s.high).toEqual({ day: "2026-02-05", value: 600 });
    expect(s.series[0]!.day).toBe("2025-10-11");
  });

  it("has nothing at all when there are no closes", () => {
    expect(stockFrom("NONE", [])).toEqual({
      state: "not_tracked",
      symbol: "NONE",
      source: null,
      last: null,
      previous: null,
      yearAgo: null,
      low: null,
      high: null,
      series: [],
    });
  });
});
