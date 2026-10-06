import { Hono } from "hono";
import { ReadingKey } from "@maester/contracts";
import { latestMarketFetch, listMarketSeries } from "@maester/db";
import type { AppDeps, AppEnv } from "../app.js";
import { HttpError } from "../errors.js";
import { computeMood, RAW_SERIES, readingDetail, type SeriesMap } from "../market-mood/compute.js";
import { toFetchStatus } from "../serialize.js";

/** Four years: 500 ranked days of a derived reading need up to 250 more sessions behind them. */
const LOOKBACK_DAYS = 4 * 366;

export function marketMoodRoutes(deps: AppDeps) {
  const r = new Hono<AppEnv>();

  async function load(): Promise<SeriesMap> {
    const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = await listMarketSeries(deps.db, RAW_SERIES, from);
    return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.map((p) => ({ day: p.day, value: p.value, source: p.source }))]));
  }

  r.get("/", async (c) => {
    const [series, fetch] = await Promise.all([load(), latestMarketFetch(deps.db)]);
    return c.json(computeMood(series, toFetchStatus(fetch)));
  });

  r.get("/readings/:key", async (c) => {
    const key = ReadingKey.safeParse(c.req.param("key"));
    if (!key.success) throw new HttpError("NOT_FOUND", "reading not found");
    const [series, fetch] = await Promise.all([load(), latestMarketFetch(deps.db)]);
    return c.json(readingDetail(key.data, series, toFetchStatus(fetch)));
  });
  return r;
}
