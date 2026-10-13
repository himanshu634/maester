import { describe, expect, it } from "vitest";
import { minusDays, stockFrom } from "../src/financials/stock.js";

const SRC = "Dhan · NSE close";
/** One close a day from `from` for `days` days, with the given values by index. */
function closes(from: string, days: number, value: (i: number) => number) {
  return Array.from({ length: days }, (_, i) => ({ day: minusDays(from, -i), value: value(i), source: SRC }));
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
});
