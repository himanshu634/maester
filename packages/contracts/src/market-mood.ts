import { z } from "zod";
import { IsoTimestamp } from "./common.js";
import { IsoDate } from "./extraction.js";

/** The 10 readings on the Market mood page, in page order. */
export const ReadingKey = z.enum([
  "india_vix", "us_vix", "nifty_pcr",
  "fpi_flows", "dii_flows",
  "nifty_trend", "n500_above_200d", "n500_net_highs",
  "usd_inr", "gold_vs_nifty",
]);
export type ReadingKey = z.infer<typeof ReadingKey>;

export const ReadingFamily = z.enum(["fear", "money", "breadth", "havens"]);
export type ReadingFamily = z.infer<typeof ReadingFamily>;

export const MoodBand = z.enum(["very_cautious", "cautious", "middling", "eager", "very_eager"]);
export type MoodBand = z.infer<typeof MoodBand>;

/** Why a reading has no value or no rank. */
export const MissingReason = z.enum(["no_source", "no_data", "stale", "not_enough_history"]);
export type MissingReason = z.infer<typeof MissingReason>;

export const Reading = z.object({
  key: ReadingKey,
  family: ReadingFamily,
  /** True for the 7 readings that make up the mood. */
  scored: z.boolean(),
  value: z.number().nullable(),
  /** The day the value is for (IST trading day, or the US day for FRED series). */
  day: IsoDate.nullable(),
  /** The value a fixed number of sessions earlier, for "was … on …" and "+2.6 in 5 sessions". */
  previous: z.object({ value: z.number(), day: IsoDate, sessions: z.number().int() }).nullable(),
  /** Share of the ranked days with a lower value, 0–100. Null with fewer than 250 days. */
  rank: z.number().int().min(0).max(100).nullable(),
  /** How many days the rank was worked out against (at most 500). */
  rankDays: z.number().int().min(0),
  /** What it adds to the mood, 0–100 (the rank, turned round where high means caution). Null when unscored or unranked. */
  score: z.number().int().min(0).max(100).nullable(),
  /** "Dhan · NSE close", "FRED · Cboe VIX close" and so on. */
  source: z.string(),
  missing: MissingReason.nullable(),
});
export type Reading = z.infer<typeof Reading>;

export const FetchStatus = z.object({
  state: z.enum(["never", "running", "ok", "failed"]),
  at: IsoTimestamp.nullable(),
  errorCode: z.enum(["DHAN_TOKEN_EXPIRED", "DHAN_RATE_LIMITED", "FRED_KEY_REFUSED", "SOURCE_UNAVAILABLE", "UNKNOWN"]).nullable(),
});
export type FetchStatus = z.infer<typeof FetchStatus>;

export const MarketMood = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  band: MoodBand.nullable(),
  /** Scored readings present, out of 7. */
  scoredCount: z.number().int().min(0).max(7),
  /** The oldest day among the scored readings present. */
  asOf: IsoDate.nullable(),
  /** The latest Indian session in the data. */
  latestSession: IsoDate.nullable(),
  /** True when an Indian scored reading is older than the latest Indian session. */
  provisional: z.boolean(),
  readings: z.array(Reading).length(10),
  /** The mood for each Indian session in the last 12 months that had at least 5 scored readings. */
  history: z.array(z.object({ day: IsoDate, score: z.number().int().min(0).max(100) })),
  /** Share of history days with a mood at or below today's, 0–100. Null without a mood. */
  atOrBelowShare: z.number().int().min(0).max(100).nullable(),
  fetch: FetchStatus,
});
export type MarketMood = z.infer<typeof MarketMood>;

export const ReadingDetail = z.object({
  reading: Reading,
  /** The last 2 years of the reading's own values, oldest first. */
  series: z.array(z.object({ day: IsoDate, value: z.number() })),
});
export type ReadingDetail = z.infer<typeof ReadingDetail>;
