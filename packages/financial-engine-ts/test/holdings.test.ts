import { describe, expect, it } from "vitest";
import { holdingsSnapshot } from "../src/index.js";

// Expected values worked by hand (19 and 24 Oct 2026), not by the functions under test:
//   HDFC Bank, close 1742.60:
//     kite 120 @ 1512.40: cost 181,488.00, value 209,112.00, gain 27,624.00, 27,624 / 181,488 = 0.152208 → 15.2
//     dhan  30 @ 1688.00: cost  50,640.00, value  52,278.00, gain  1,638.00,  1,638 /  50,640 = 0.032346 →  3.2
//     row: quantity 150, cost 232,128.00, value 261,390.00, gain 29,262.00, 29,262 / 232,128 = 0.126060 → 12.6
//   Infosys, close 1618.25:
//     kite 80 @ 1402.15: cost 112,172.00, value 129,460.00, gain 17,288.00, 17,288 / 112,172 = 0.154120 → 15.4
//     dhan 20 @ 1755.00: cost  35,100.00, value  32,365.00, gain −2,735.00, −2,735 / 35,100 = −0.077920 → −7.8
//     row: quantity 100, cost 147,272.00, value 161,825.00, gain 14,553.00, 14,553 / 147,272 = 0.098817 → 9.9
//   Titan, no close: dhan 15 @ 3350.00, cost 50,250.00; value, gain and per cent unknown.
//   Totals: known value 423,215.00 (2 of 3 priced); cost 429,650.00 (3 costed);
//     unrealized gain over the 2 with both 29,262 + 14,553 = 43,815.00;
//     its per cent over the cost of those 2 only: 43,815 / (232,128 + 147,272 = 379,400) = 0.115485 → 11.5
//     (over all cost it would be 43,815 / 429,650 = 10.2, which counts Titan's cost but not its value).
//   Weights: 261,390 / 423,215 = 0.61763 → 61.8; 161,825 / 423,215 = 0.38237 → 38.2.
//   By account:
//     kite: value 209,112 + 129,460 = 338,572.00; cost 181,488 + 112,172 = 293,660.00; gain 44,912.00;
//           44,912 / 293,660 = 0.152939 → 15.3; 2 parts, 2 priced, 2 costed, 2 with both.
//     dhan: value 52,278 + 32,365 = 84,643.00 (2 of 3 priced); cost 50,640 + 35,100 + 50,250 = 135,990.00;
//           gain 1,638 − 2,735 = −1,097.00 over 2; −1,097 / (50,640 + 35,100 = 85,740) = −0.012794 → −1.3.
const inputs = [
  { isin: "INE040A01034", close: "1742.60", parts: [{ account: "kite", quantity: "120", t1Quantity: "0", averagePrice: "1512.40" }, { account: "dhan", quantity: "30", t1Quantity: "0", averagePrice: "1688.00" }] },
  { isin: "INE009A01021", close: "1618.25", parts: [{ account: "kite", quantity: "80", t1Quantity: "0", averagePrice: "1402.15" }, { account: "dhan", quantity: "20", t1Quantity: "0", averagePrice: "1755.00" }] },
  { isin: "INE280A01028", close: null, parts: [{ account: "dhan", quantity: "15", t1Quantity: "0", averagePrice: "3350.00" }] },
];

describe("holdingsSnapshot", () => {
  const { rows, totals, accounts } = holdingsSnapshot(inputs);

  it("works out each row", () => {
    expect(rows[0]).toMatchObject({ isin: "INE040A01034", quantity: "150", cost: "232128.00", value: "261390.00", weight: "61.8", gain: "29262.00", gainPercent: "12.6", unknown: [] });
    expect(rows[1]).toMatchObject({ isin: "INE009A01021", quantity: "100", cost: "147272.00", value: "161825.00", weight: "38.2", gain: "14553.00", gainPercent: "9.9", unknown: [] });
  });

  it("works out each account's part of a row", () => {
    expect(rows[0]!.parts).toEqual([
      { account: "kite", quantity: "120", averagePrice: "1512.40", cost: "181488.00", value: "209112.00", gain: "27624.00", gainPercent: "15.2" },
      { account: "dhan", quantity: "30", averagePrice: "1688.00", cost: "50640.00", value: "52278.00", gain: "1638.00", gainPercent: "3.2" },
    ]);
    expect(rows[1]!.parts[1]).toEqual({ account: "dhan", quantity: "20", averagePrice: "1755.00", cost: "35100.00", value: "32365.00", gain: "-2735.00", gainPercent: "-7.8" });
  });

  it("leaves a row with no close without a value, a gain or a weight, never zero", () => {
    expect(rows[2]).toEqual({
      isin: "INE280A01028", quantity: "15", cost: "50250.00", value: null, weight: null, gain: null, gainPercent: null, unknown: ["NO_CLOSE"],
      parts: [{ account: "dhan", quantity: "15", averagePrice: "3350.00", cost: "50250.00", value: null, gain: null, gainPercent: null }],
    });
  });

  it("totals only what is known, and works the per cent over the cost of rows with both", () => {
    expect(totals).toEqual({ knownValue: "423215.00", priced: 2, count: 3, cost: "429650.00", costed: 3, unrealizedGain: "43815.00", gainCovers: 2, gainPercent: "11.5" });
  });

  it("totals each account over its own parts", () => {
    expect(accounts).toEqual([
      { account: "kite", knownValue: "338572.00", priced: 2, count: 2, cost: "293660.00", costed: 2, gain: "44912.00", gainCovers: 2, gainPercent: "15.3" },
      { account: "dhan", knownValue: "84643.00", priced: 2, count: 3, cost: "135990.00", costed: 3, gain: "-1097.00", gainCovers: 2, gainPercent: "-1.3" },
    ]);
  });

  it("merges one account's lines for the same ISIN", () => {
    // kite holds X on NSE (10 @ 100) and BSE (5 @ 130): quantity 15, cost 1,000 + 650 = 1,650.00,
    // average 1,650 / 15 = 110.00; close 120: value 1,800.00, gain 150.00, 150 / 1,650 = 0.090909 → 9.1.
    const r = holdingsSnapshot([{ isin: "X", close: "120", parts: [{ account: "kite", quantity: "10", t1Quantity: "0", averagePrice: "100" }, { account: "kite", quantity: "5", t1Quantity: "0", averagePrice: "130" }] }]);
    expect(r.rows[0]!.parts).toEqual([{ account: "kite", quantity: "15", averagePrice: "110.00", cost: "1650.00", value: "1800.00", gain: "150.00", gainPercent: "9.1" }]);
    expect(r.accounts).toEqual([{ account: "kite", knownValue: "1800.00", priced: 1, count: 1, cost: "1650.00", costed: 1, gain: "150.00", gainCovers: 1, gainPercent: "9.1" }]);
  });

  it("counts the T+1 quantity", () => {
    // 10 settled + 5 on T+1 = 15; cost 15 × 100 = 1,500.00; value 15 × 110 = 1,650.00; gain 150.00, 150 / 1,500 = 10.0.
    const r = holdingsSnapshot([{ isin: "X", close: "110", parts: [{ quantity: "10", t1Quantity: "5", averagePrice: "100" }] }]);
    expect(r.rows[0]).toMatchObject({ quantity: "15", cost: "1500.00", value: "1650.00", weight: "100.0", gain: "150.00", gainPercent: "10.0" });
  });

  it("has no known value, gain or per cent when nothing is priced or costed", () => {
    const r = holdingsSnapshot([{ isin: "X", close: null, parts: [{ quantity: "1", t1Quantity: "0", averagePrice: "0" }] }]);
    expect(r.rows[0]?.unknown).toEqual(["NO_CLOSE", "NO_COST"]);
    expect(r.totals).toMatchObject({ knownValue: null, cost: null, unrealizedGain: null, gainPercent: null, priced: 0, costed: 0 });
    expect(r.accounts).toEqual([]);
  });
});
