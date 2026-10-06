import { describe, expect, it } from "vitest";
import { MarketMood, ReadingKey } from "../src/index.js";

describe("market mood contract", () => {
  it("lists the 10 readings in page order", () => {
    expect(ReadingKey.options).toEqual([
      "india_vix", "us_vix", "nifty_pcr", "fpi_flows", "dii_flows",
      "nifty_trend", "n500_above_200d", "n500_net_highs", "usd_inr", "gold_vs_nifty",
    ]);
  });
  it("accepts an empty first run", () => {
    const readings = ReadingKey.options.map((key) => ({
      key, family: "fear", scored: false, value: null, day: null, previous: null,
      rank: null, rankDays: 0, score: null, source: "Dhan", missing: "no_data",
    }));
    const parsed = MarketMood.parse({
      score: null, band: null, scoredCount: 0, asOf: null, latestSession: null, provisional: false,
      readings, history: [], atOrBelowShare: null, fetch: { state: "never", at: null, errorCode: null },
    });
    expect(parsed.score).toBeNull();
  });
});
