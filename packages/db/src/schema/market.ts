import { sql } from "drizzle-orm";
import { check, date, doublePrecision, index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { ts } from "./platform.js";

/**
 * One value of one daily market series. Global (no workspace): the user's own Dhan and FRED
 * data, shown only behind a session. Series keys: "nifty50", "india_vix", "us_vix", "usd_inr",
 * "gold_mcx", "nifty_pcr_oi", "n500_above_200d_pct", "n500_net_highs_pct", and "eq:<SYMBOL>"
 * for each Nifty 500 member's close.
 */
export const marketPoint = pgTable("market_point", {
  series: text("series").notNull(),
  day: date("day", { mode: "string" }).notNull(),
  value: doublePrecision("value").notNull(),
  source: text("source").notNull(),
  fetchedAt: ts("fetched_at").notNull().defaultNow(),
}, (t) => [primaryKey({ name: "market_point_pk", columns: [t.series, t.day] }), index("market_point_day").on(t.day)]);
export type MarketPointRow = typeof marketPoint.$inferSelect;
export type NewMarketPoint = typeof marketPoint.$inferInsert;

/** One refresh run of the worker's market refresher. */
export const marketFetch = pgTable("market_fetch", {
  id: uuid("id").primaryKey(),
  state: text("state", { enum: ["running", "ok", "failed"] }).notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  pointsWritten: integer("points_written").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
}, (t) => [
  check("market_fetch_state", sql`${t.state} in ('running', 'ok', 'failed')`),
  index("market_fetch_started_at").on(t.startedAt),
]);
export type MarketFetchRow = typeof marketFetch.$inferSelect;
