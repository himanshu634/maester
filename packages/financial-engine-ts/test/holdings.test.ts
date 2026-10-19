import { describe, expect, it } from "vitest";
import { holdingsSnapshot } from "../src/index.js";

// Expected values worked by hand (19 Oct 2026), not by the functions under test:
//   HDFC Bank: 120 @ 1512.40 + 30 @ 1688.00. Quantity 150. Cost 181,488.00 + 50,640.00 = 232,128.00.
//              Value 150 × 1742.60 = 261,390.00.
//   Infosys:   80 @ 1402.15 + 20 @ 1755.00. Quantity 100. Cost 112,172.00 + 35,100.00 = 147,272.00.
//              Value 100 × 1618.25 = 161,825.00.
//   Titan:     15 @ 3350.00, no close. Cost 50,250.00. Value unknown.
//   Known value 261,390 + 161,825 = 423,215.00 (2 of 3 priced). Cost 429,650.00 (3 costed).
//   Unrealized gain over the 2 with both: 29,262 + 14,553 = 43,815.00.
//   Weights: 261,390 / 423,215 = 0.61763 → 61.8; 161,825 / 423,215 = 0.38237 → 38.2.
const inputs = [
  { isin: "INE040A01034", close: "1742.60", parts: [{ quantity: "120", t1Quantity: "0", averagePrice: "1512.40" }, { quantity: "30", t1Quantity: "0", averagePrice: "1688.00" }] },
  { isin: "INE009A01021", close: "1618.25", parts: [{ quantity: "80", t1Quantity: "0", averagePrice: "1402.15" }, { quantity: "20", t1Quantity: "0", averagePrice: "1755.00" }] },
  { isin: "INE280A01028", close: null, parts: [{ quantity: "15", t1Quantity: "0", averagePrice: "3350.00" }] },
];

describe("holdingsSnapshot", () => {
  const { rows, totals } = holdingsSnapshot(inputs);

  it("works out each row", () => {
    expect(rows[0]).toEqual({ isin: "INE040A01034", quantity: "150", cost: "232128.00", value: "261390.00", weight: "61.8", unknown: [] });
    expect(rows[1]).toEqual({ isin: "INE009A01021", quantity: "100", cost: "147272.00", value: "161825.00", weight: "38.2", unknown: [] });
  });

  it("leaves a row with no close without a value or a weight, never zero", () => {
    expect(rows[2]).toEqual({ isin: "INE280A01028", quantity: "15", cost: "50250.00", value: null, weight: null, unknown: ["NO_CLOSE"] });
  });

  it("totals only what is known, and says how much it covers", () => {
    expect(totals).toEqual({ knownValue: "423215.00", priced: 2, count: 3, cost: "429650.00", costed: 3, unrealizedGain: "43815.00", gainCovers: 2 });
  });

  it("counts the T+1 quantity", () => {
    // 10 settled + 5 on T+1 = 15; cost 15 × 100 = 1,500.00; value 15 × 110 = 1,650.00.
    const r = holdingsSnapshot([{ isin: "X", close: "110", parts: [{ quantity: "10", t1Quantity: "5", averagePrice: "100" }] }]);
    expect(r.rows[0]).toMatchObject({ quantity: "15", cost: "1500.00", value: "1650.00", weight: "100.0" });
  });

  it("has no known value when nothing is priced", () => {
    const r = holdingsSnapshot([{ isin: "X", close: null, parts: [{ quantity: "1", t1Quantity: "0", averagePrice: "0" }] }]);
    expect(r.rows[0]?.unknown).toEqual(["NO_CLOSE", "NO_COST"]);
    expect(r.totals).toMatchObject({ knownValue: null, cost: null, unrealizedGain: null, priced: 0, costed: 0 });
  });
});
