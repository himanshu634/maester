import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MarketMood, ReadingDetail } from "@maester/contracts";
import { finishMarketFetch, startMarketFetch, upsertMarketPoints } from "@maester/db";
import { createTestContext, type TestContext } from "./context.js";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(() => ctx.close());

describe("market mood routes", () => {
  it("needs a session", async () => {
    expect((await ctx.app.request("/v1/market-mood")).status).toBe(401);
  });

  it("answers an empty first run with no mood and the fetch state", async () => {
    const a = await ctx.signUp("mood1@example.com");
    const res = await ctx.app.request("/v1/market-mood", { headers: { cookie: a.cookie } });
    expect(res.status).toBe(200);
    const mood = MarketMood.parse(await res.json());
    expect(mood.score).toBeNull();
    expect(mood.fetch.state).toBe("never");
  });

  it("reports an expired Dhan token from the last run", async () => {
    const a = await ctx.signUp("mood2@example.com");
    const id = await startMarketFetch(ctx.db);
    await finishMarketFetch(ctx.db, id!, { state: "failed", pointsWritten: 0, errorCode: "DHAN_TOKEN_EXPIRED", errorMessage: "401" });
    const mood = MarketMood.parse(await (await ctx.app.request("/v1/market-mood", { headers: { cookie: a.cookie } })).json());
    expect(mood.fetch).toMatchObject({ state: "failed", errorCode: "DHAN_TOKEN_EXPIRED" });
  });

  it("names a refused FRED key from the last run", async () => {
    const a = await ctx.signUp("mood2b@example.com");
    const id = await startMarketFetch(ctx.db);
    await finishMarketFetch(ctx.db, id!, { state: "failed", pointsWritten: 0, errorCode: "FRED_KEY_REFUSED", errorMessage: "400" });
    const mood = MarketMood.parse(await (await ctx.app.request("/v1/market-mood", { headers: { cookie: a.cookie } })).json());
    expect(mood.fetch).toMatchObject({ state: "failed", errorCode: "FRED_KEY_REFUSED" });
  });

  it("returns one reading with its series, and 404 for an unknown key", async () => {
    const a = await ctx.signUp("mood3@example.com");
    await upsertMarketPoints(ctx.db, [{ series: "india_vix", day: "2026-10-06", value: 17.8, source: "Dhan · NSE close" }]);
    const res = await ctx.app.request("/v1/market-mood/readings/india_vix", { headers: { cookie: a.cookie } });
    const detail = ReadingDetail.parse(await res.json());
    expect(detail.series).toEqual([{ day: "2026-10-06", value: 17.8 }]);
    const bad = await ctx.app.request("/v1/market-mood/readings/nonsense", { headers: { cookie: a.cookie } });
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});
