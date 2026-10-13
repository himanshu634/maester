// apps/api/test/market-mood-compute.test.ts
import { describe, expect, it } from "vitest";
import { MarketMood } from "@maester/contracts";
import { computeMood, percentileRank, readingSeries, type SeriesMap } from "../src/market-mood/compute.js";

const NEVER = { state: "never", at: null, errorCode: null } as const;

/** n weekday sessions ending on `last` (YYYY-MM-DD), oldest first. */
function sessions(n: number, last: string): string[] {
  const out: string[] = [];
  const d = new Date(last + "T00:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
const series = (days: string[], f: (i: number) => number, source = "Dhan · NSE close") =>
  days.map((day, i) => ({ day, value: f(i), source }));

/** 1,000 sessions of every Dhan/FRED series, gently trending, ending Tue 6 Oct 2026. */
function fullMarket(last = "2026-10-06"): SeriesMap {
  const days = sessions(1000, last);
  return {
    nifty50: series(days, (i) => 18000 + i * 6),
    india_vix: series(days, (i) => 12 + (i % 50) / 10),
    us_vix: series(days, (i) => 15 + (i % 40) / 10, "FRED · Cboe VIX close"),
    gold_mcx: series(days, (i) => 60000 + i * 40, "Dhan · MCX gold future"),
    usd_inr: series(days, (i) => 80 + i / 200, "FRED · Federal Reserve noon rate"),
    nifty_pcr_oi: series(days.slice(-30), (i) => 0.9 + i / 100, "Dhan · NSE option chain"),
    n500_above_200d_pct: series(days.slice(-700), (i) => 30 + (i % 60), "Worked out from Dhan closes"),
    n500_net_highs_pct: series(days.slice(-700), (i) => -10 + (i % 25), "Worked out from Dhan closes"),
  };
}

describe("percentileRank", () => {
  it("counts lower values and half of equal values", () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(63); // (2 + 0.5) / 4 = 62.5, rounded half up
    expect(percentileRank([5, 5, 5, 5], 5)).toBe(50);
    expect(percentileRank([1, 2, 3], 10)).toBe(100);
    // 43.5 / 300 = 14.5 exactly: must round half up to 15, not 14 through float error
    const w = [...Array(43).fill(0), ...Array(1).fill(1), ...Array(256).fill(2)];
    expect(w).toHaveLength(300);
    expect(percentileRank(w, 1)).toBe(15);
  });
});

describe("computeMood", () => {
  it("gives no mood on an empty first run", () => {
    const mood = MarketMood.parse(computeMood({}, NEVER));
    expect(mood.score).toBeNull();
    expect(mood.band).toBeNull();
    expect(mood.readings).toHaveLength(10);
    expect(mood.readings.every((r) => r.missing !== null)).toBe(true);
  });

  it("scores 6 of 7 when flows have no source, and says why", () => {
    const mood = MarketMood.parse(computeMood(fullMarket(), NEVER));
    expect(mood.scoredCount).toBe(6);
    expect(mood.score).not.toBeNull();
    expect(mood.readings.find((r) => r.key === "fpi_flows")?.missing).toBe("no_source");
    expect(mood.readings.find((r) => r.key === "dii_flows")?.scored).toBe(false);
  });

  it("turns round the readings where high means caution", () => {
    const mood = computeMood(fullMarket(), NEVER);
    const vix = mood.readings.find((r) => r.key === "india_vix")!;
    expect(vix.score).toBe(100 - vix.rank!);
    const trend = mood.readings.find((r) => r.key === "nifty_trend")!;
    expect(trend.score).toBe(trend.rank);
  });

  it("names the band from the score", () => {
    const mood = computeMood(fullMarket(), NEVER);
    const expected = mood.score! < 20 ? "very_cautious" : mood.score! < 40 ? "cautious" : mood.score! < 60 ? "middling" : mood.score! < 80 ? "eager" : "very_eager";
    expect(mood.band).toBe(expected);
  });

  it("gives no mood below 5 of 7 scored readings", () => {
    const m = fullMarket();
    delete m.india_vix; delete m.us_vix;
    const mood = computeMood(m, NEVER);
    expect(mood.scoredCount).toBe(4);
    expect(mood.score).toBeNull();
    expect(mood.band).toBeNull();
    expect(mood.atOrBelowShare).toBeNull();
  });

  it("still builds history when today has no mood", () => {
    const m = fullMarket();
    // two breadth series stop 10 sessions ago: stale today (4 scored), but present on earlier days
    m.n500_above_200d_pct = m.n500_above_200d_pct!.slice(0, -10);
    m.n500_net_highs_pct = m.n500_net_highs_pct!.slice(0, -10);
    const mood = computeMood(m, NEVER);
    expect(mood.score).toBeNull();
    expect(mood.history.length).toBeGreaterThan(0);
    expect(mood.atOrBelowShare).toBeNull();
  });

  it("does not rank a reading with fewer than 250 days", () => {
    const mood = computeMood(fullMarket(), NEVER);
    const pcr = mood.readings.find((r) => r.key === "nifty_pcr")!;
    expect(pcr.value).not.toBeNull();
    expect(pcr.rank).toBeNull();
    expect(pcr.missing).toBe("not_enough_history");
    expect(pcr.rankDays).toBe(29);
  });

  it("keeps US VIX a day behind as current, not provisional", () => {
    const m = fullMarket();
    m.us_vix = m.us_vix!.slice(0, -1); // FRED has Monday, India has Tuesday
    const mood = computeMood(m, NEVER);
    expect(mood.provisional).toBe(false);
    expect(mood.readings.find((r) => r.key === "us_vix")?.missing).toBeNull();
  });

  it("marks the mood provisional when an Indian reading is behind", () => {
    const m = fullMarket();
    m.n500_above_200d_pct = m.n500_above_200d_pct!.slice(0, -1);
    const mood = computeMood(m, NEVER);
    expect(mood.provisional).toBe(true);
    expect(mood.asOf).toBe(m.n500_above_200d_pct.at(-1)!.day);
  });

  it("asOf on a Monday before the close is Friday's session, not provisional", () => {
    const mood = computeMood(fullMarket("2026-10-02"), NEVER); // a Friday
    expect(mood.latestSession).toBe("2026-10-02");
    expect(mood.provisional).toBe(false);
    expect(mood.asOf).toBe("2026-10-02");
    expect(mood.readings.filter((r) => r.scored && r.score !== null).every((r) => r.missing === null)).toBe(true);
  });

  it("treats a reading more than 4 days older than the latest session as stale", () => {
    const m = fullMarket();
    m.us_vix = m.us_vix!.slice(0, -6);
    const r = computeMood(m, NEVER).readings.find((x) => x.key === "us_vix")!;
    expect(r.missing).toBe("stale");
    expect(r.score).toBeNull();
    expect(r.value).not.toBeNull(); // still shown, with its day
  });

  it("treats exactly 4 days behind as current and 5 as stale", () => {
    const m4 = fullMarket();
    m4.us_vix = m4.us_vix!.slice(0, -2); // Fri 2 Oct vs Tue 6 Oct: 4 days
    expect(computeMood(m4, NEVER).readings.find((x) => x.key === "us_vix")!.missing).toBeNull();
    const m5 = fullMarket();
    m5.us_vix = m5.us_vix!.slice(0, -3); // Thu 1 Oct: 5 days
    expect(computeMood(m5, NEVER).readings.find((x) => x.key === "us_vix")!.missing).toBe("stale");
  });

  it("labels an empty FRED reading with its own source", () => {
    const r = computeMood({}, NEVER).readings.find((x) => x.key === "us_vix")!;
    expect(r.source).toBe("FRED · Cboe VIX close");
  });

  it("builds 12 months of history and today's share", () => {
    const mood = computeMood(fullMarket(), NEVER);
    expect(mood.history.length).toBeGreaterThan(240);
    expect(mood.history.at(-1)?.day).toBe("2026-10-06");
    expect(mood.history.at(-1)?.score).toBe(mood.score);
    expect(mood.atOrBelowShare).not.toBeNull();
  });
});

describe("derived readings", () => {
  it("works out the trend against the 125-session average", () => {
    const days = sessions(130, "2026-10-06");
    const s = readingSeries("nifty_trend", { nifty50: series(days, () => 100) });
    expect(s).toHaveLength(6);
    expect(s.at(-1)!.value).toBe(0);
  });
  it("works out gold against the Nifty over 20 sessions", () => {
    const days = sessions(21, "2026-10-06");
    const s = readingSeries("gold_vs_nifty", {
      gold_mcx: series(days, (i) => (i === 20 ? 110 : 100)),
      nifty50: series(days, (i) => (i === 20 ? 101 : 100)),
    });
    expect(s.at(-1)!.value).toBeCloseTo(9, 6); // +10% less +1%
  });
  it("never pairs a Nifty day with a gold price more than 4 days old, so frozen gold goes stale", () => {
    const m = fullMarket();
    m.gold_mcx = m.gold_mcx!.slice(0, -10); // gold stopped two weeks before the latest session
    const s = readingSeries("gold_vs_nifty", m);
    expect(s.at(-1)!.day < "2026-09-28").toBe(true);
    const gold = computeMood(m, NEVER).readings.find((r) => r.key === "gold_vs_nifty")!;
    expect(gold.missing).toBe("stale");
    expect(gold.score).toBeNull();
  });
  it("takes gold's change over the same period as Nifty across MCX-only days", () => {
    const days = sessions(21, "2026-10-06");
    // day 1 of gold is distinct, so a base taken 20 gold points back (shifted by the extra point) gives a different answer
    const gold = series(days, (i) => (i === 20 ? 110 : i === 1 ? 80 : 100));
    gold.splice(4, 0, { day: "2026-09-12", value: 100, source: "x" }); // Saturday MCX session, Nifty shut
    const s = readingSeries("gold_vs_nifty", {
      gold_mcx: gold,
      nifty50: series(days, (i) => (i === 20 ? 101 : 100)),
    });
    expect(s.at(-1)!.value).toBeCloseTo(9, 6);
  });
});
