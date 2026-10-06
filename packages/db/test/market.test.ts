import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "../src/client.js";
import { finishMarketFetch, latestMarketDay, latestMarketFetch, listMarketSeries, listMarketSeriesByPrefix, listMarketValuesByPrefix, startMarketFetch, upsertMarketPoints } from "../src/index.js";
import { testDb } from "./helpers.js";

let db: Db;
beforeEach(async () => { db = await testDb(); });
afterAll(() => closeDb(db));

describe("market points", () => {
  it("upserts by series and day, and lists oldest first", async () => {
    await upsertMarketPoints(db, [
      { series: "india_vix", day: "2026-10-05", value: 15.2, source: "Dhan · NSE close" },
      { series: "india_vix", day: "2026-10-06", value: 17.1, source: "Dhan · NSE close" },
    ]);
    await upsertMarketPoints(db, [{ series: "india_vix", day: "2026-10-06", value: 17.8, source: "Dhan · NSE close" }]);
    const got = await listMarketSeries(db, ["india_vix", "us_vix"], "2026-01-01");
    expect(got.india_vix!.map((p) => [p.day, p.value])).toEqual([["2026-10-05", 15.2], ["2026-10-06", 17.8]]);
    expect(got.us_vix).toEqual([]);
    expect(await latestMarketDay(db, "india_vix")).toBe("2026-10-06");
    expect(await latestMarketDay(db, "us_vix")).toBeNull();
  });
  it("lists member closes by prefix", async () => {
    await upsertMarketPoints(db, [
      { series: "eq:RELIANCE", day: "2026-10-06", value: 1400, source: "Dhan · NSE close" },
      { series: "nifty50", day: "2026-10-06", value: 24490, source: "Dhan · NSE close" },
    ]);
    expect(Object.keys(await listMarketSeriesByPrefix(db, "eq:", "2026-01-01"))).toEqual(["eq:RELIANCE"]);
  });
  it("lists only day and value by prefix, between two days inclusive", async () => {
    await upsertMarketPoints(db, [
      { series: "eq:TCS", day: "2026-10-01", value: 1, source: "Dhan · NSE close" },
      { series: "eq:TCS", day: "2026-10-05", value: 2, source: "Dhan · NSE close" },
      { series: "eq:TCS", day: "2026-10-06", value: 3, source: "Dhan · NSE close" },
      { series: "eq:INFY", day: "2026-10-05", value: 4, source: "Dhan · NSE close" },
      { series: "nifty50", day: "2026-10-05", value: 24490, source: "Dhan · NSE close" },
    ]);
    expect(await listMarketValuesByPrefix(db, "eq:", "2026-10-02", "2026-10-05")).toEqual({
      "eq:INFY": [{ day: "2026-10-05", value: 4 }],
      "eq:TCS": [{ day: "2026-10-05", value: 2 }],
    });
  });
  it("upserts an empty list without a query", async () => {
    expect(await upsertMarketPoints(db, [])).toBe(0);
  });
});

describe("market fetch runs", () => {
  it("refuses a second run while one is running, and records the outcome", async () => {
    const first = await startMarketFetch(db);
    expect(first).not.toBeNull();
    expect(await startMarketFetch(db)).toBeNull();
    await finishMarketFetch(db, first!, { state: "failed", pointsWritten: 3, errorCode: "DHAN_TOKEN_EXPIRED", errorMessage: "401" });
    const last = await latestMarketFetch(db);
    expect(last?.state).toBe("failed");
    expect(last?.errorCode).toBe("DHAN_TOKEN_EXPIRED");
    expect(await startMarketFetch(db)).not.toBeNull();
  });
});
