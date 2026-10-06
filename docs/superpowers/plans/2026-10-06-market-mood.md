# Market mood implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** A working signed-in page, `/terminal/market-mood`. It shows:
- the market's mood, worked out from the investor's own Dhan and FRED data;
- every reading behind the mood, with its source and day;
- the mood's last 12 months.

**Architecture.**
- **Worker.** A refresher inside the worker process fetches daily series from the DhanHQ Data API and FRED into one Postgres table, `market_point`. It works out Nifty 500 breadth from the members' closes, and records each run in `market_fetch`.
- **API.** A pure module ranks each reading against its own 2 years and averages them into the mood. Two session-only routes serve it.
- **Web.** The SvelteKit page follows the "A+B · final" canvas.

**Tech stack.**
- TypeScript, Hono, drizzle-orm with Postgres 16, zod 4, vitest.
- SvelteKit 2 with Svelte 5, using adapter-static.
- The DhanHQ v2 REST API and the FRED REST API.

**Settings (picked 6 Oct 2026, canvas page "Settings · G final").** Dhan and FRED keys are entered in Settings, not `.env`. They are checked with the source, stored encrypted in `market_connection`, and read by the worker on each pass. This decision affects four tasks:
- Task 5 puts the source clients in a shared package, `packages/market`, used by both the API and the worker.
- Task 5b adds the table, the encryption and the Settings routes.
- Task 9b builds the Settings page.
- Task 1's spike still uses `.env` values, in the scratchpad only.

**Spec:** [docs/superpowers/specs/2026-10-06-market-mood-design.md](../specs/2026-10-06-market-mood-design.md). Read it first. The method, the reading table and the states are defined there.

## Global constraints

- **Personal use only.** Market data is shown only behind a signed-in session. Never add a public route. Never scrape nseindia.com or niftyindices.com programmatically.
- **Branch.** Work on `staging` in the main checkout. No feature branch, no worktree, no pull request. Commit when each task passes. Don't push unless the user asks.
- **Commits.** Conventional Commits with a scope and a lower-case imperative subject, for example `feat(db): market_point and market_fetch tables`. Sign off with `git commit -s`. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands.**
  - TypeScript packages use `pnpm --filter <pkg> test|typecheck|lint`.
  - The web app uses `pnpm --dir apps/web verify` (check, prettier, eslint, vitest with the design guard, then the static build).
  - The database comes from `pnpm db:up` (port 5433).
  - Never use Make for web work.
- **Workspace boundary.** `apps/web` is outside the pnpm workspace and cannot import `@maester/contracts`. Mirror the wire types in `apps/web/src/lib/market-mood/types.ts` by hand, with a header comment naming the contract file.
- **Design.** Follow `docs/DESIGN.md`:
  - colours from `var(--…)` only;
  - Archivo only;
  - no radius or shadow;
  - direction shown with a sign or a word, never colour;
  - nothing smaller than 14px;
  - sentence case;
  - unknown is "—" with its reason, never 0 or the middle of the ruler.
- **Copy.**
  - Never advise. Banned: "buy", "sell", "opportunity", "overbought", "buy zone", "high confidence".
  - The band names are exactly: Very cautious, Cautious, Middling, Eager, Very eager.
  - Market readings are shown with no "Synthetic example" tag, because they are real.
- **Svelte.** Before you touch any `.svelte` file, load the skills `svelte-code-writer` and `svelte-core-bestpractices`.
- **New tables.** Every new table must be added to the hard-coded `TRUNCATE` lists in:
  - `packages/db/test/helpers.ts`
  - `apps/api/test/context.ts`
  - `apps/worker/test/context.ts`
  It must also be added to the expected table list in `packages/db/test/migrate.test.ts`.

## Review focus

These are the inputs most likely to break the page for the one person using it. Each has a test in the task named.

1. **A weekend or holiday as "today".** Readings carry Friday's day. The page doesn't show them as missing and doesn't mark the mood provisional, because the latest Indian session is still Friday. Tested in Task 3, `asOf on a Monday before the close`.
2. **US VIX a day behind Indian data.** FRED posts the US close the next morning. US VIX is current when it is within 4 calendar days of the latest Indian session. It must not make every mood "Provisional". Tested in Task 3.
3. **An expired Dhan token.** Dhan answers 401 or the error code `DH-901`. The run records `DHAN_TOKEN_EXPIRED`. The page shows the renew message and still shows the stored readings. Tested in Tasks 5 and 6.
4. **The first run with an empty database.** Every reading reports `not_enough_history`, the mood is `null`, and the page shows "No readings yet" rather than crashing. Tested in Tasks 3 and 9.
6. **A secret leaking back.** No API response, log line or page state ever contains a saved token or key. Only its last 4 characters show. Tested in Task 5b.
5. **A member stock with a short history**, such as a recent listing. It is left out of breadth until it has 200 or 252 closes, so it never counts as below its average. Tested in Task 6.

---

### Task 1: Spike — confirm Dhan's identifiers and limits

There is no production code in this task. It writes down facts the later tasks depend on. **The user must put their own credentials in `.env`.** Never type or ask for a password or token yourself. Ask the user to add `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` and `FRED_API_KEY` to the repo-root `.env` (FRED keys are free at fred.stlouisfed.org).

**Files:**
- Create: `docs/research/2026-10-06-dhan-api-notes.md`
- Create, uncommitted, in the session scratchpad: `dhan-spike.mjs`

**Ruling, 6 Oct 2026:** there are no credentials in `.env`, and keys go in through Settings (Task 9b). So this task records only what the scrip master CSV and the public Dhan and FRED documentation say, and marks each fact "from docs, not yet called live". Steps 2–5 are done from the documentation only. The live calls happen in Task 7 Step 4, after Task 9b, with the user's own keys.

- [ ] **Step 1: Download the instrument list.** Fetch `https://images.dhan.co/api-data/api-scrip-master.csv`. If that URL has moved, find the current one in https://dhanhq.co/docs/v2/instruments/. Record the security ID, exchange segment and instrument for each of these:
  - NIFTY 50 (`IDX_I`, `INDEX`);
  - INDIA VIX (`IDX_I`, `INDEX`);
  - the MCX GOLD near-month future (`MCX_COMM`, `FUTCOM`), and how `expiryCode` 0 selects the near month for a continuous series;
  - the column names that map an NSE trading symbol (e.g. `RELIANCE`) to its `NSE_EQ` security ID.
- [ ] **Step 2: Call daily history for each instrument** with a 3-year range, using `POST https://api.dhan.co/v2/charts/historical` with headers `access-token` and `client-id`. Confirm and record:
  - indices return daily candles;
  - whether a 4-year range comes back in one call;
  - the timestamp form (epoch seconds, and which time zone a day maps to);
  - how holidays appear.
- [ ] **Step 3: Call the option chain.** Use `POST /v2/optionchain/expirylist` with `{UnderlyingScrip: <NIFTY id>, UnderlyingSeg: "IDX_I"}`, then `POST /v2/optionchain` for the nearest expiry. Record the response path to each strike's call and put `oi`.
- [ ] **Step 4: Record the limits and failures:**
  - the Data API rate limits from https://dhanhq.co/docs/v2/ (requests per second and per day);
  - the HTTP status and body for an invalid token, made by sending a deliberately wrong token;
  - the access token's validity period and how it is renewed (web token or API key consent flow).
- [ ] **Step 5: Call FRED.** `GET https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=$FRED_API_KEY&file_type=json&observation_start=2026-09-01`. Confirm missing days come back as `"."`. Do the same for `DEXINUS`.
- [ ] **Step 6: Write `docs/research/2026-10-06-dhan-api-notes.md`.** Include every identifier, field path, limit and error shape above, with the date checked. Task 5 copies the identifiers from this file into `apps/worker/src/market/instruments.ts`.
- [ ] **Step 7: Tell the user if a fact breaks the spec.** Examples: indices have no daily history, or the token lasts only 24 hours with no API renewal. Stop and wait for the user before Task 5.
- [ ] **Step 8: Commit.**
```bash
git add docs/research/2026-10-06-dhan-api-notes.md docs/research/2026-10-06-market-mood.md docs/research/2026-10-06-market-data-vendors.md docs/superpowers/specs/2026-10-06-market-mood-design.md docs/superpowers/plans/2026-10-06-market-mood.md
git commit -s -m "docs: market mood research, spec, plan and Dhan API notes"
```

### Task 2: Contracts, tables and queries

**Files:**
- Create: `packages/contracts/src/market-mood.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from "./market-mood.js";`)
- Test: `packages/contracts/test/market-mood.test.ts`
- Create: `packages/db/src/schema/market.ts`
- Modify: `packages/db/src/schema/index.ts` (add `export * from "./market.js";`)
- Create: `packages/db/src/queries/market.ts`
- Modify: `packages/db/src/index.ts` (export the row types and queries)
- Create: the generated migration `packages/db/drizzle/0004_market.sql`, plus its snapshot and journal entry
- Modify: the truncate lists named in the global constraints, and `packages/db/test/migrate.test.ts`
- Test: `packages/db/test/market.test.ts`

**Interfaces it produces:**
- The contract types `ReadingKey`, `ReadingFamily`, `MoodBand`, `MissingReason`, `Reading`, `MarketMood`, `ReadingDetail`, `FetchStatus`.
- The tables `schema.marketPoint` and `schema.marketFetch`.
- The queries:
  - `upsertMarketPoints(db, rows: NewMarketPoint[]): Promise<number>`
  - `listMarketSeries(db, series: string[], fromDay: string): Promise<Record<string, MarketPointRow[]>>`
  - `listMarketSeriesByPrefix(db, prefix: string, fromDay: string): Promise<Record<string, MarketPointRow[]>>`
  - `latestMarketDay(db, series: string): Promise<string | null>`
  - `startMarketFetch(db): Promise<string | null>`
  - `finishMarketFetch(db, id, outcome: { state: "ok" | "failed"; pointsWritten: number; errorCode?: string; errorMessage?: string }): Promise<void>`
  - `latestMarketFetch(db): Promise<MarketFetchRow | null>`

- [ ] **Step 1: Write the contract.**

```ts
// packages/contracts/src/market-mood.ts
import { z } from "zod";
import { IsoTimestamp } from "./common.js";

export const IsoDate = z.iso.date();

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
  errorCode: z.enum(["DHAN_TOKEN_EXPIRED", "DHAN_RATE_LIMITED", "SOURCE_UNAVAILABLE", "UNKNOWN"]).nullable(),
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
```

- [ ] **Step 2: Write the contract test.**

```ts
// packages/contracts/test/market-mood.test.ts
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
```

- [ ] **Step 3: Run it.** `pnpm --filter @maester/contracts test`. Expected: PASS once the index export is added. It fails before that.
- [ ] **Step 4: Write the tables.**

```ts
// packages/db/src/schema/market.ts
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
```

- [ ] **Step 5: Write the failing query tests.**

```ts
// packages/db/test/market.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "../src/client.js";
import { finishMarketFetch, latestMarketDay, latestMarketFetch, listMarketSeries, listMarketSeriesByPrefix, startMarketFetch, upsertMarketPoints } from "../src/index.js";
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
    expect(got.india_vix.map((p) => [p.day, p.value])).toEqual([["2026-10-05", 15.2], ["2026-10-06", 17.8]]);
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
```

- [ ] **Step 6: Implement the queries.**

```ts
// packages/db/src/queries/market.ts
import { and, asc, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { marketFetch, marketPoint, type MarketFetchRow, type MarketPointRow, type NewMarketPoint } from "../schema/market.js";

const CHUNK = 1000;

export async function upsertMarketPoints(db: Db, rows: NewMarketPoint[]): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(marketPoint).values(rows.slice(i, i + CHUNK)).onConflictDoUpdate({
      target: [marketPoint.series, marketPoint.day],
      set: { value: sql`excluded.value`, source: sql`excluded.source`, fetchedAt: sql`now()` },
    });
  }
  return rows.length;
}

function group(rows: MarketPointRow[], keys: string[] = []): Record<string, MarketPointRow[]> {
  const out: Record<string, MarketPointRow[]> = Object.fromEntries(keys.map((k) => [k, []]));
  for (const row of rows) (out[row.series] ??= []).push(row);
  return out;
}

export async function listMarketSeries(db: Db, series: string[], fromDay: string): Promise<Record<string, MarketPointRow[]>> {
  if (series.length === 0) return {};
  const rows = await db.select().from(marketPoint)
    .where(and(inArray(marketPoint.series, series), gte(marketPoint.day, fromDay)))
    .orderBy(asc(marketPoint.series), asc(marketPoint.day));
  return group(rows, series);
}

export async function listMarketSeriesByPrefix(db: Db, prefix: string, fromDay: string): Promise<Record<string, MarketPointRow[]>> {
  const rows = await db.select().from(marketPoint)
    .where(and(like(marketPoint.series, `${prefix}%`), gte(marketPoint.day, fromDay)))
    .orderBy(asc(marketPoint.series), asc(marketPoint.day));
  return group(rows);
}

export async function latestMarketDay(db: Db, series: string): Promise<string | null> {
  const [row] = await db.select({ day: sql<string | null>`max(${marketPoint.day})` }).from(marketPoint).where(eq(marketPoint.series, series));
  return row?.day ?? null;
}

/** Starts a run unless another started less than an hour ago is still running. Returns its id, or null. */
export async function startMarketFetch(db: Db): Promise<string | null> {
  const id = crypto.randomUUID();
  const rows = await db.execute(sql`
    insert into market_fetch (id, state)
    select ${id}, 'running'
    where not exists (select 1 from market_fetch where state = 'running' and started_at > now() - interval '1 hour')
    returning id`);
  return rows.length ? id : null;
}

export async function finishMarketFetch(db: Db, id: string, outcome: { state: "ok" | "failed"; pointsWritten: number; errorCode?: string; errorMessage?: string }): Promise<void> {
  await db.update(marketFetch).set({
    state: outcome.state, finishedAt: new Date(), pointsWritten: outcome.pointsWritten,
    errorCode: outcome.errorCode ?? null, errorMessage: outcome.errorMessage ?? null,
  }).where(eq(marketFetch.id, id));
}

export async function latestMarketFetch(db: Db): Promise<MarketFetchRow | null> {
  const [row] = await db.select().from(marketFetch).orderBy(desc(marketFetch.startedAt)).limit(1);
  return row ?? null;
}
```

If `db.execute` returns `{ rows }` rather than an array in this driver, follow what `queries/workspaces.ts` does with raw SQL.

- [ ] **Step 7: Export from `packages/db/src/index.ts`.**
```ts
export type { MarketPointRow, NewMarketPoint, MarketFetchRow } from "./schema/market.js";
export { upsertMarketPoints, listMarketSeries, listMarketSeriesByPrefix, latestMarketDay, startMarketFetch, finishMarketFetch, latestMarketFetch } from "./queries/market.js";
```
- [ ] **Step 8: Generate and name the migration.** Run `pnpm --filter @maester/db generate`. Rename the generated SQL file to `0004_market.sql`, and set the same tag in `drizzle/meta/_journal.json`.
- [ ] **Step 9: Update the truncate lists.** Add `"market_point", "market_fetch"` to the three `TRUNCATE` lists, and both table names to `packages/db/test/migrate.test.ts`.
- [ ] **Step 10: Run the tests.** `pnpm db:up && pnpm --filter @maester/db test && pnpm --filter @maester/contracts test && pnpm --filter @maester/db typecheck`. Expected: PASS.
- [ ] **Step 11: Commit.** Use `feat(db): market_point and market_fetch tables, queries and contracts`.

### Task 3: The mood computation (pure)

All the method in the spec lives in one pure module, with no database and no clock. The `today` value is passed in.

**Files:**
- Create: `apps/api/src/market-mood/compute.ts`
- Test: `apps/api/test/market-mood-compute.test.ts`

**Interfaces:**
- Consumes: the contract types from Task 2.
- Produces:
  - `type Point = { day: string; value: number; source: string }`
  - `type SeriesMap = Record<string, Point[]>`, holding raw stored series, oldest first.
  - `RAW_SERIES: string[]`, the series keys the API loads.
  - `percentileRank(window: number[], value: number): number`
  - `computeMood(series: SeriesMap, fetch: FetchStatus): MarketMood`
  - `readingSeries(key: ReadingKey, series: SeriesMap): Point[]`
  - `readingDetail(key: ReadingKey, series: SeriesMap, fetch: FetchStatus): ReadingDetail`

- [ ] **Step 1: Write the failing tests.** Build a helper that makes N weekday sessions ending on a given day. Then test each case below.

```ts
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
    expect(mood.history).toEqual([]);
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
  });

  it("treats a reading more than 4 days older than the latest session as stale", () => {
    const m = fullMarket();
    m.us_vix = m.us_vix!.slice(0, -6);
    const r = computeMood(m, NEVER).readings.find((x) => x.key === "us_vix")!;
    expect(r.missing).toBe("stale");
    expect(r.score).toBeNull();
    expect(r.value).not.toBeNull(); // still shown, with its day
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
});
```

- [ ] **Step 2: Run the tests.** `pnpm --filter @maester/api exec vitest run test/market-mood-compute.test.ts`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement it.**

```ts
// apps/api/src/market-mood/compute.ts
/**
 * Market mood, worked out from stored daily series (docs/superpowers/specs/2026-10-06-market-mood-design.md, "Method").
 * Pure: no database, no clock. Every reading is ranked against its own previous 2 years; the mood
 * is the plain mean of the scored readings present, and only with at least 5 of 7.
 */
import type { FetchStatus, MarketMood, MissingReason, MoodBand, Reading, ReadingDetail, ReadingFamily, ReadingKey } from "@maester/contracts";

export type Point = { day: string; value: number; source: string };
export type SeriesMap = Record<string, Point[]>;

const WINDOW = 500;
const MIN_RANK_DAYS = 250;
const MIN_SCORED = 5;
const STALE_DAYS = 4;
const HISTORY_SESSIONS = 250;

type Def = {
  key: ReadingKey;
  family: ReadingFamily;
  scored: boolean;
  /** High values mean caution: score = 100 − rank. */
  invert: boolean;
  /** Sessions back for `previous`. */
  previous: number;
  /** Indian readings make the mood provisional when behind; global ones do not. */
  indian: boolean;
  /** Null: no source connected yet. */
  build: ((s: SeriesMap) => Point[]) | null;
};

const raw = (name: string) => (s: SeriesMap) => s[name] ?? [];

export const RAW_SERIES = ["nifty50", "india_vix", "us_vix", "gold_mcx", "usd_inr", "nifty_pcr_oi", "n500_above_200d_pct", "n500_net_highs_pct"];

function trend(s: SeriesMap): Point[] {
  const n = s.nifty50 ?? [];
  const out: Point[] = [];
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    sum += n[i].value;
    if (i >= 125) sum -= n[i - 125].value;
    if (i >= 124) out.push({ day: n[i].day, value: (n[i].value / (sum / 125) - 1) * 100, source: n[i].source });
  }
  return out;
}

function change(p: Point[], i: number, n: number): number | null {
  return i >= n ? (p[i].value / p[i - n].value - 1) * 100 : null;
}

function goldVsNifty(s: SeriesMap): Point[] {
  const gold = new Map((s.gold_mcx ?? []).map((p, i, a) => [p.day, change(a, i, 20)]));
  const nifty = s.nifty50 ?? [];
  const out: Point[] = [];
  nifty.forEach((p, i) => {
    const g = gold.get(p.day);
    const n = change(nifty, i, 20);
    if (g != null && n != null) out.push({ day: p.day, value: g - n, source: "Worked out from Dhan · MCX gold and NSE close" });
  });
  return out;
}

export const READINGS: Def[] = [
  { key: "india_vix", family: "fear", scored: true, invert: true, previous: 5, indian: true, build: raw("india_vix") },
  { key: "us_vix", family: "fear", scored: true, invert: true, previous: 5, indian: false, build: raw("us_vix") },
  { key: "nifty_pcr", family: "fear", scored: false, invert: false, previous: 5, indian: true, build: raw("nifty_pcr_oi") },
  { key: "fpi_flows", family: "money", scored: true, invert: false, previous: 20, indian: true, build: null },
  { key: "dii_flows", family: "money", scored: false, invert: false, previous: 20, indian: true, build: null },
  { key: "nifty_trend", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: trend },
  { key: "n500_above_200d", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: raw("n500_above_200d_pct") },
  { key: "n500_net_highs", family: "breadth", scored: true, invert: false, previous: 20, indian: true, build: raw("n500_net_highs_pct") },
  { key: "usd_inr", family: "havens", scored: false, invert: false, previous: 20, indian: false, build: raw("usd_inr") },
  { key: "gold_vs_nifty", family: "havens", scored: true, invert: true, previous: 20, indian: true, build: goldVsNifty },
];

/** Share of `window` below `value`, counting equal values as half, as a whole percent (half up). */
export function percentileRank(window: number[], value: number): number {
  let below = 0, equal = 0;
  for (const v of window) { if (v < value) below++; else if (v === value) equal++; }
  return Math.floor(((below + equal / 2) / window.length) * 100 + 0.5);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Index of the last point on or before `day`, or −1. Points are oldest first. */
function atOrBefore(p: Point[], day: string): number {
  let lo = 0, hi = p.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid].day <= day) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function rankAt(p: Point[], i: number): { rank: number | null; days: number } {
  const window = p.slice(Math.max(0, i - WINDOW), i).map((x) => x.value);
  return { rank: window.length >= MIN_RANK_DAYS ? percentileRank(window, p[i].value) : null, days: window.length };
}

export function bandOf(score: number): MoodBand {
  return score < 20 ? "very_cautious" : score < 40 ? "cautious" : score < 60 ? "middling" : score < 80 ? "eager" : "very_eager";
}

export function readingSeries(key: ReadingKey, s: SeriesMap): Point[] {
  const def = READINGS.find((d) => d.key === key)!;
  return def.build ? def.build(s) : [];
}

function readingOn(def: Def, p: Point[], session: string | null): Reading {
  const base = { key: def.key, family: def.family, scored: def.scored, source: p.at(-1)?.source ?? (def.build ? "Dhan" : "No source connected yet") };
  const empty = (missing: MissingReason): Reading => ({ ...base, value: null, day: null, previous: null, rank: null, rankDays: 0, score: null, missing });
  if (!def.build) return empty("no_source");
  const i = session ? atOrBefore(p, session) : p.length - 1;
  if (i < 0) return empty("no_data");
  const { rank, days } = rankAt(p, i);
  const stale = session !== null && daysBetween(p[i].day, session) > STALE_DAYS;
  const score = def.scored && rank !== null && !stale ? (def.invert ? 100 - rank : rank) : null;
  const prev = i >= def.previous ? { value: p[i - def.previous].value, day: p[i - def.previous].day, sessions: def.previous } : null;
  const missing: MissingReason | null = stale ? "stale" : rank === null ? "not_enough_history" : null;
  return { ...base, value: p[i].value, day: p[i].day, previous: prev, rank, rankDays: days, score, missing };
}

function moodOf(readings: Reading[]): { score: number | null; count: number } {
  const scores = readings.filter((r) => r.scored && r.score !== null).map((r) => r.score!);
  if (scores.length < MIN_SCORED) return { score: null, count: scores.length };
  return { score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), count: scores.length };
}

export function computeMood(s: SeriesMap, fetch: FetchStatus): MarketMood {
  const built = READINGS.map((def) => ({ def, points: def.build ? def.build(s) : [] }));
  const sessionsList = (s.nifty50 ?? []).map((p) => p.day);
  const latestSession = sessionsList.at(-1) ?? null;
  const readings = built.map(({ def, points }) => readingOn(def, points, latestSession));
  const { score, count } = moodOf(readings);

  const scoredDays = readings.filter((r) => r.scored && r.score !== null && r.day).map((r) => r.day!);
  const asOf = scoredDays.length ? scoredDays.sort()[0] : null;
  const provisional = latestSession !== null && built.some(({ def }, k) => def.indian && def.scored && readings[k].score !== null && readings[k].day! < latestSession);

  const history: MarketMood["history"] = [];
  if (score !== null) {
    for (const day of sessionsList.slice(-HISTORY_SESSIONS)) {
      const m = moodOf(built.map(({ def, points }) => readingOn(def, points, day)));
      if (m.score !== null) history.push({ day, score: m.score });
    }
  }
  const atOrBelowShare = score !== null && history.length
    ? Math.round((history.filter((h) => h.score <= score).length / history.length) * 100)
    : null;

  return { score, band: score === null ? null : bandOf(score), scoredCount: count, asOf, latestSession, provisional, readings, history, atOrBelowShare, fetch };
}

export function readingDetail(key: ReadingKey, s: SeriesMap, fetch: FetchStatus): ReadingDetail {
  const mood = computeMood(s, fetch);
  const reading = mood.readings.find((r) => r.key === key)!;
  const series = readingSeries(key, s).slice(-WINDOW).map(({ day, value }) => ({ day, value }));
  return { reading, series };
}
```

- [ ] **Step 4: Run the tests.** Same command as Step 2. Expected: PASS.

If "asOf on a Monday…" fails because the fixture's Friday-ending sessions disagree, fix the fixture, not the rule. The rule is: the latest Indian session is the last `nifty50` day.

The history loop recomputes ranks each day, about 250 × 8 × 500 operations. If the test takes more than 2 seconds, precompute each reading's ranks once, as an array indexed like its points, and reuse them.

- [ ] **Step 5: Commit.** Use `feat(api): market mood computation`.

### Task 4: API routes

**Files:**
- Create: `apps/api/src/routes/market-mood.ts`
- Modify: `apps/api/src/app.ts` (add `v1.route("/market-mood", marketMoodRoutes(deps));` after `/me`)
- Modify: `apps/api/src/serialize.ts` (add `toFetchStatus`)
- Test: `apps/api/test/market-mood.test.ts`

**Interfaces:**
- Consumes: `computeMood`, `readingDetail`, `RAW_SERIES` from Task 3, and the queries from Task 2.
- Produces: `GET /v1/market-mood` → `MarketMood`, and `GET /v1/market-mood/readings/:key` → `ReadingDetail`. A key that doesn't exist returns 404 `NOT_FOUND`. Without a session it returns 401.

- [ ] **Step 1: Write the failing route tests.**

```ts
// apps/api/test/market-mood.test.ts
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

  it("returns one reading with its series, and 404 for an unknown key", async () => {
    const a = await ctx.signUp("mood3@example.com");
    await upsertMarketPoints(ctx.db, [{ series: "india_vix", day: "2026-10-06", value: 17.8, source: "Dhan · NSE close" }]);
    const res = await ctx.app.request("/v1/market-mood/readings/india_vix", { headers: { cookie: a.cookie } });
    const detail = ReadingDetail.parse(await res.json());
    expect(detail.series).toEqual([{ day: "2026-10-06", value: 17.8 }]);
    const bad = await ctx.app.request("/v1/market-mood/readings/nonsense", { headers: { cookie: a.cookie } });
    expect(bad.status).toBe(404);
    expect((await bad.json()).error.code).toBe("NOT_FOUND");
  });
});
```

If `TestContext` doesn't expose `db` yet, add it to the object `createTestContext` returns.

- [ ] **Step 2: Run the tests.** `pnpm --filter @maester/api exec vitest run test/market-mood.test.ts`. Expected: FAIL with 404s.
- [ ] **Step 3: Implement the routes.**

```ts
// apps/api/src/routes/market-mood.ts
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
```

```ts
// apps/api/src/serialize.ts (add)
import type { FetchStatus } from "@maester/contracts";
import type { MarketFetchRow } from "@maester/db";

const FETCH_CODES = new Set(["DHAN_TOKEN_EXPIRED", "DHAN_RATE_LIMITED", "SOURCE_UNAVAILABLE"]);
export function toFetchStatus(row: MarketFetchRow | null): FetchStatus {
  if (!row) return { state: "never", at: null, errorCode: null };
  return {
    state: row.state,
    at: (row.finishedAt ?? row.startedAt).toISOString(),
    errorCode: row.state === "failed" ? ((row.errorCode && FETCH_CODES.has(row.errorCode) ? row.errorCode : "UNKNOWN") as FetchStatus["errorCode"]) : null,
  };
}
```

- [ ] **Step 4: Run the checks.** `pnpm --filter @maester/api test && pnpm --filter @maester/api typecheck && pnpm --filter @maester/api lint`. Expected: PASS.
- [ ] **Step 5: Commit.** Use `feat(api): market mood routes`.

### Task 5: Shared package for the Dhan and FRED sources

The API needs these clients to check a key before saving it, and the worker needs them to fetch. So they live in a new workspace package, `packages/market` (`@maester/market`).

**Files:**
- Create: `packages/market/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts}`, copied from `packages/jobs`. The name is `@maester/market`, and the exports are `./src/index.ts`.
- Create: `packages/market/src/instruments.ts` (identifiers from Task 1's notes)
- Create: `packages/market/src/sources.ts` (the interfaces, `MarketSourceError` and `ist()`)
- Create: `packages/market/src/dhan.ts`, `packages/market/src/fred.ts`, `packages/market/src/index.ts`
- Modify: `apps/api/package.json` and `apps/worker/package.json` (add `"@maester/market": "workspace:*"`), then run `pnpm install`
- Modify: `apps/worker/src/env.ts` and `apps/api/src/env.ts`. Add `CONNECTIONS_KEY`, optional: 32 bytes, base64. Without it, the Settings routes answer `INVALID_STATE` and the refresher is off. Add `DHAN_REQUESTS_PER_SECOND` (default 4) and `MARKET_REFRESH_MINUTES` (default 30) to the worker.
- Test: `packages/market/test/sources.test.ts`

Everywhere below that says `apps/worker/src/market/{sources,dhan,fred,instruments}`, read `@maester/market`.

**Interfaces it produces:**

```ts
// sources.ts
export type DailyPoint = { day: string; value: number };
export type Instrument = { securityId: string; exchangeSegment: string; instrument: string; expiryCode?: number };
export interface DhanSource {
  daily(inst: Instrument, from: string, to: string): Promise<DailyPoint[]>; // closes, oldest first
  putCallRatio(): Promise<number>; // nearest Nifty expiry: Σ put OI ÷ Σ call OI
  equityIds(): Promise<Map<string, string>>; // NSE symbol → NSE_EQ security id
}
export interface FredSource { observations(seriesId: string, from: string): Promise<DailyPoint[]>; }
export class MarketSourceError extends Error {
  constructor(readonly code: "DHAN_TOKEN_EXPIRED" | "DHAN_RATE_LIMITED" | "SOURCE_UNAVAILABLE", message: string) { super(message); }
}
/** Epoch seconds → the IST calendar day, YYYY-MM-DD. */
export function ist(epochSeconds: number): string {
  return new Date((epochSeconds + 19_800) * 1000).toISOString().slice(0, 10);
}
```

- [ ] **Step 1: Write the failing tests.** Inject `fetch` through the constructor so tests answer for the network:
  - the Dhan daily response is parsed into `DailyPoint`s, with epoch → IST day;
  - a 401, or a body with `errorCode: "DH-901"`, becomes `MarketSourceError("DHAN_TOKEN_EXPIRED")`;
  - a 429 or `DH-904` is retried 3 times with backoff (inject a `sleep`), then raises `DHAN_RATE_LIMITED`;
  - requests are spaced to at most `requestsPerSecond` (assert on the injected `sleep` calls);
  - the option-chain response path recorded in Task 1 sums to the right ratio;
  - FRED skips `"."` values and parses the rest.

```ts
// apps/worker/test/market-sources.test.ts (core cases)
import { describe, expect, it } from "vitest";
import { HttpDhanSource } from "../src/market/dhan.js";
import { HttpFredSource } from "../src/market/fred.js";
import { ist, MarketSourceError } from "../src/market/sources.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("ist", () => {
  it("maps a 15:30 IST candle to its IST day", () => {
    expect(ist(Date.parse("2026-10-06T10:00:00Z") / 1000)).toBe("2026-10-06");
    expect(ist(Date.parse("2026-10-05T19:00:00Z") / 1000)).toBe("2026-10-06"); // 00:30 IST next day
  });
});

describe("HttpDhanSource", () => {
  const inst = { securityId: "21", exchangeSegment: "IDX_I", instrument: "INDEX" };
  it("parses daily closes", async () => {
    const t = Date.parse("2026-10-06T00:00:00+05:30") / 1000;
    const dhan = new HttpDhanSource({ clientId: "c", accessToken: "t", requestsPerSecond: 4, fetch: async () => json(200, { open: [1], high: [1], low: [1], close: [17.8], volume: [0], timestamp: [t] }), sleep: noSleep });
    expect(await dhan.daily(inst, "2026-10-01", "2026-10-07")).toEqual([{ day: "2026-10-06", value: 17.8 }]);
  });
  it("names an expired token", async () => {
    const dhan = new HttpDhanSource({ clientId: "c", accessToken: "t", requestsPerSecond: 4, fetch: async () => json(401, { errorCode: "DH-901", errorMessage: "Invalid token" }), sleep: noSleep });
    await expect(dhan.daily(inst, "2026-10-01", "2026-10-07")).rejects.toMatchObject({ code: "DHAN_TOKEN_EXPIRED" });
  });
  it("gives up on the rate limit after 3 retries", async () => {
    let calls = 0;
    const dhan = new HttpDhanSource({ clientId: "c", accessToken: "t", requestsPerSecond: 4, fetch: async () => { calls++; return json(429, { errorCode: "DH-904" }); }, sleep: noSleep });
    await expect(dhan.daily(inst, "2026-10-01", "2026-10-07")).rejects.toBeInstanceOf(MarketSourceError);
    expect(calls).toBe(4);
  });
});

describe("HttpFredSource", () => {
  it("skips missing observations", async () => {
    const fred = new HttpFredSource({ apiKey: "k", fetch: async () => json(200, { observations: [{ date: "2026-10-02", value: "." }, { date: "2026-10-05", value: "22.6" }] }) });
    expect(await fred.observations("VIXCLS", "2026-10-01")).toEqual([{ day: "2026-10-05", value: 22.6 }]);
  });
});
```

- [ ] **Step 2: Run the tests.** `pnpm --filter @maester/market test`. Expected: FAIL.

Add to the interfaces:
- `DhanSource.profile(): Promise<{ clientId: string; tokenExpiresAt: string | null; dataPlanActive: boolean | null }>`, using the profile endpoint recorded in Task 1.
- `FredSource.check(): Promise<void>`, which reads one `VIXCLS` observation.
- [ ] **Step 3: Implement `HttpDhanSource` and `HttpFredSource`.**

`HttpDhanSource`:
- **Construction:** `{ clientId, accessToken, requestsPerSecond, fetch = globalThis.fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), baseUrl = "https://api.dhan.co/v2" }`.
- **Request spacing:** one private `post(path, body)` keeps a `nextAt` timestamp so calls are at least `1000 / requestsPerSecond` ms apart.
- **Requests:** send `access-token`, `client-id` and `content-type: application/json`.
- **Errors:**
  - a 401, or a body with `DH-901`, throws `DHAN_TOKEN_EXPIRED`;
  - a 429, `DH-904` or `805` retries with 1, 2 and 4 seconds of `sleep`, then throws `DHAN_RATE_LIMITED`;
  - any other failure, or a network error, throws `SOURCE_UNAVAILABLE`.
- **`daily()`:** sends `{ securityId, exchangeSegment, instrument, expiryCode, oi: false, fromDate, toDate }` to `/charts/historical`. `toDate` is exclusive, so pass the day after `to`. It zips `close[]` with `timestamp[]` through `ist()`.
- **`equityIds()`:** downloads the scrip master CSV from the URL in `instruments.ts`, keeps the rows whose columns (named in Task 1's notes) say NSE equity, and maps symbol → id. It caches the result for the life of the object.

`HttpFredSource`:
- Sends `GET https://api.stlouisfed.org/fred/series/observations?series_id=…&api_key=…&file_type=json&observation_start=…`.
- A non-200 answer throws `SOURCE_UNAVAILABLE`.

`instruments.ts`:
- exports `NIFTY_50`, `INDIA_VIX` and `MCX_GOLD`, of type `Instrument`;
- exports `NIFTY_OPTION_UNDERLYING = { scrip: <id>, seg: "IDX_I" }`;
- exports `SCRIP_MASTER_URL`;
- copies each value from `docs/research/2026-10-06-dhan-api-notes.md`, with a comment giving the date it was checked.

- [ ] **Step 4: Test the environment check.** Add an `env.test.ts` case in both apps: a `CONNECTIONS_KEY` that doesn't decode to 32 bytes throws `CONNECTIONS_KEY must be 32 bytes, base64`. Run `pnpm --filter @maester/market test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** Use `feat(market): Dhan and FRED market data sources`.

### Task 5b: Connections — table, encryption and Settings routes

**Files:**
- Create: `packages/market/src/secrets.ts`
- Test: `packages/market/test/secrets.test.ts`
- Modify: `packages/db/src/schema/market.ts`. Add the `market_connection` table: `provider` text PK, checked to be in ('dhan', 'fred'); `client_id` text null; `secret_ciphertext` text not null; `secret_last4` text not null; `expires_at` ts null; `checked_at` ts not null; `last_error_code` text null; `saved_at` ts not null default now(); `saved_by_user_id` text, referencing `user.id`, on delete set null.
- Modify: the migration from Task 2. If Task 2 is already committed, generate `0005_market_connection.sql` instead.
- Modify: the truncate lists and `migrate.test.ts`.
- Modify: `packages/db/src/queries/market.ts`, adding `getConnection(db, provider)`, `listConnections(db)`, `saveConnection(db, row)` (an upsert) and `deleteConnection(db, provider)`.
- Create: `packages/contracts/src/connection.ts`:
  - `ConnectionProvider` is the enum `dhan` or `fred`.
  - `Connection` is `{ provider, state: "not_connected" | "connected" | "expired" | "failing", clientId: string | null, last4: string | null, expiresAt: IsoTimestamp | null, checkedAt: IsoTimestamp | null, lastRead: IsoTimestamp | null, notice: "DATA_PLAN_INACTIVE" | null }`.
  - `SaveDhanConnectionRequest` is `{ clientId: string (1–32), accessToken: string (20–4096) }`.
  - `SaveFredConnectionRequest` is `{ apiKey: string, 32 lower-case hex }`.
- Create: `apps/api/src/routes/connections.ts`, mounted with `v1.route("/settings/connections", connectionRoutes(deps))`.
- Test: `apps/api/test/connections.test.ts`

**Interfaces:**
- `encryptSecret(plain: string, key: Buffer): string`. The result is base64 of `iv(12) | tag(16) | ciphertext`.
- `decryptSecret(blob: string, key: Buffer): string`. It throws when the blob has been tampered with.
- `loadConnections(db, key): Promise<{ dhan: { clientId: string; accessToken: string } | null; fred: { apiKey: string } | null }>`, used by the worker in Task 6.
- Routes:
  - `GET /v1/settings/connections` returns `{ items: Connection[] }`, always 2 items, Dhan first.
  - `PUT /v1/settings/connections/dhan` and `PUT /v1/settings/connections/fred` return a `Connection`.
  - `DELETE /v1/settings/connections/:provider` returns 204.
  - These routes need a session but no workspace. Without `CONNECTIONS_KEY` they answer 409 `INVALID_STATE`, "CONNECTIONS_KEY is not set".

What a save returns:
- Dhan refuses the token: 400 `VALIDATION_FAILED`, `fields: [{ path: "accessToken", message: "Dhan said this token isn’t valid." }]`.
- Dhan doesn't answer: 503 `INTERNAL` with message `SOURCE_UNAVAILABLE`. Nothing is saved.
- Dhan accepts it, but the Data API subscription is off: saved, with `notice: "DATA_PLAN_INACTIVE"`.
- A save never echoes the secret. Test that the response body doesn't contain the token string.

- [ ] **Step 1: Write the failing `secrets.test.ts`.** Encrypting then decrypting gives back the same text. Two encryptions of the same text differ. A flipped byte throws. The wrong key throws.
- [ ] **Step 2: Implement `secrets.ts`** with `node:crypto` `createCipheriv("aes-256-gcm", key, iv)`. Run `pnpm --filter @maester/market test`. Expected: PASS.
- [ ] **Step 3: Write the failing route tests.** Inject fake sources through `AppDeps`: add `marketSources?: { dhan(creds): DhanSource; fred(key): FredSource }`, defaulting to the HTTP ones. Cover each case:
  - **Save and list:** saving Dhan with a fake that accepts lists `state: "connected"`, `last4` set and `expiresAt` from the profile, and never includes the token.
  - **Refused:** a fake that throws `DHAN_TOKEN_EXPIRED` gives 400 on `accessToken`, and nothing is stored.
  - **No answer:** `SOURCE_UNAVAILABLE` gives 503, and nothing is stored.
  - **FRED:** a key that isn't 32 hex characters gives 400 before any call.
  - **Delete:** deleting removes the row.
  - **Expired:** a row with `expires_at` in the past lists as `expired`. A row with `last_error_code = "DHAN_TOKEN_EXPIRED"` lists as `expired` too.
  - **No session:** 401.
- [ ] **Step 4: Implement the routes and queries.** Generate the migration. Run `pnpm --filter @maester/db test && pnpm --filter @maester/api test`. Expected: PASS.
- [ ] **Step 5: Commit.** Use `feat(api): Dhan and FRED connections, checked and kept encrypted`.

### Task 6: Breadth and the refresher

**Files:**
- Create: `apps/worker/data/nifty500.csv`, with its as-of date in `apps/worker/data/README.md`. Ask the user to download "Nifty 500 index constituents" from https://www.niftyindices.com/indices/equity/broad-based-indices/nifty--500 (personal use). Never fetch it programmatically.
- Create: `apps/worker/src/market/members.ts` (`readMembers(path): string[]`, reading the CSV's `Symbol` column)
- Create: `apps/worker/src/market/breadth.ts`
- Create: `apps/worker/src/market/refresh.ts`
- Test: `apps/worker/test/market-breadth.test.ts`, `apps/worker/test/market-refresh.test.ts`

**Interfaces:**
- Consumes: `DhanSource`, `FredSource`, `MarketSourceError` and the instruments from Task 5, and the queries from Task 2.
- Produces:
  - `breadthOn(members: Map<string, DailyPoint[]>, days: string[]): { day: string; above200: number | null; netHighs: number | null }[]`
  - `class MarketRefresher { constructor(deps: { db: Db; sources: () => Promise<{ dhan: DhanSource | null; fred: FredSource | null }>; members: string[]; logger: Logger; now?: () => Date; backfillYears?: number }); refresh(): Promise<"ran" | "skipped"> }`. In production `sources` calls `loadConnections(db, key)` from Task 5b and builds the HTTP clients, so a token saved in Settings is used on the next pass with no restart. When Dhan answers `DHAN_TOKEN_EXPIRED`, the refresher also sets `market_connection.last_error_code` for `dhan`. A successful Dhan call clears it.

- [ ] **Step 1: Write the failing breadth tests.**

```ts
// apps/worker/test/market-breadth.test.ts
import { describe, expect, it } from "vitest";
import { breadthOn } from "../src/market/breadth.js";

const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));

describe("breadthOn", () => {
  it("counts members above their 200-day average and net 52-week highs", () => {
    const d = days(260);
    const rising = d.map((day, i) => ({ day, value: 100 + i }));   // above average, at a high
    const falling = d.map((day, i) => ({ day, value: 400 - i }));  // below average, at a low
    const [last] = breadthOn(new Map([["UP", rising], ["DOWN", falling]]), [d.at(-1)!]);
    expect(last).toEqual({ day: d.at(-1), above200: 50, netHighs: 0 });
  });
  it("leaves out a member without enough history, never counting it as below", () => {
    const d = days(260);
    const rising = d.map((day, i) => ({ day, value: 100 + i }));
    const newListing = d.slice(-30).map((day, i) => ({ day, value: 50 + i }));
    const [last] = breadthOn(new Map([["UP", rising], ["NEW", newListing]]), [d.at(-1)!]);
    expect(last.above200).toBe(100);
  });
  it("gives null when no member has enough history", () => {
    const d = days(20);
    const [last] = breadthOn(new Map([["A", d.map((day) => ({ day, value: 1 }))]]), [d.at(-1)!]);
    expect(last).toEqual({ day: d.at(-1), above200: null, netHighs: null });
  });
});
```

- [ ] **Step 2: Implement `breadth.ts`.**

For each requested day and each member:
1. Take the member's closes up to and including that day. Use a binary search on day, as in `atOrBefore` in Task 3, and require that the member has a close *on* that day.
2. **Above the average:** with at least 200 closes, count the member, and count it as above when its close is greater than the mean of its last 200.
3. **52-week highs and lows:** with at least 252 closes, it's a high when the close is at least the max of the last 252, and a low when it's at most the min.

The results are `above200 = above / counted200 × 100` and `netHighs = (highs − lows) / counted252 × 100`. Either is null when its count is 0. Run `pnpm --filter @maester/worker exec vitest run test/market-breadth.test.ts`. Expected: PASS.

- [ ] **Step 3: Write the failing refresher tests.** Use `createWorkerContext()` and fake sources (plain objects that implement the interfaces and record calls):
  - **First run backfills.** With an empty database, `refresh()` asks Dhan for 4 years of `NIFTY_50`, `INDIA_VIX`, `MCX_GOLD` and each member. It stores `nifty50`, `india_vix`, `gold_mcx`, `eq:<SYMBOL>`, `n500_above_200d_pct` and `n500_net_highs_pct`. It asks FRED for `VIXCLS` and `DEXINUS`, stored as `us_vix` and `usd_inr`. It finishes the run `ok` with `pointsWritten > 0`.
  - **A second run fetches only from the last stored day.** Assert the `from` argument passed to the fake.
  - **Members are skipped when nothing is new.** When `nifty50` has no new day, members aren't fetched again.
  - **Put–call ratio after the close.** It is stored once per IST day, only when `now` is after 15:45 IST on a session day, as `nifty_pcr_oi` for that day.
  - **An expired token stops the run.** A `MarketSourceError("DHAN_TOKEN_EXPIRED")` from Dhan finishes the run `failed` with that code. FRED points written before the failure are kept.
  - **A run in progress blocks another.** While one run's row is `running`, a second `refresh()` returns `"skipped"` and makes no calls.
  - **Missing sources are skipped.** `dhan: null` skips the Dhan series, and `fred: null` skips FRED. Neither is an error.
- [ ] **Step 4: Implement `refresh.ts`.**

```ts
// apps/worker/src/market/refresh.ts (shape)
export class MarketRefresher {
  constructor(private readonly deps: { db: Db; dhan: DhanSource | null; fred: FredSource | null; members: string[]; logger: Logger; now?: () => Date; backfillYears?: number }) {}

  async refresh(): Promise<"ran" | "skipped"> {
    const runId = await startMarketFetch(this.deps.db);
    if (!runId) return "skipped";
    let written = 0;
    try {
      if (this.deps.fred) written += await this.fred();
      if (this.deps.dhan) {
        const newNifty = await this.dhanSeries();   // nifty50, india_vix, gold_mcx; returns the new nifty days
        written += newNifty.written;
        if (newNifty.days.length) written += await this.membersAndBreadth(newNifty.days);
        written += await this.putCallRatio();
      }
      await finishMarketFetch(this.deps.db, runId, { state: "ok", pointsWritten: written });
      return "ran";
    } catch (err) {
      const code = err instanceof MarketSourceError ? err.code : "UNKNOWN";
      this.deps.logger.warn({ code, message: (err as Error).message }, "market refresh failed");
      await finishMarketFetch(this.deps.db, runId, { state: "failed", pointsWritten: written, errorCode: code, errorMessage: (err as Error).message.slice(0, 500) });
      return "ran";
    }
  }
  // fromDay(series) = latestMarketDay ?? today − backfillYears (default 4).
  // Each series upserts with its source label:
  //   nifty50, india_vix: "Dhan · NSE close"; gold_mcx: "Dhan · MCX gold future"; eq:*: "Dhan · NSE close";
  //   us_vix: "FRED · Cboe VIX close"; usd_inr: "FRED · Federal Reserve noon rate, New York";
  //   nifty_pcr_oi: "Dhan · NSE option chain, nearest expiry"; breadth: "Worked out from Dhan · NSE closes".
  // membersAndBreadth: equityIds(); for each member symbol with an id, daily(from latest eq:<SYMBOL> day);
  //   a symbol without an id is logged once and skipped; then load all eq:* from (first new day − 400 days)
  //   and upsert breadthOn(...) for the new nifty days, dropping null values.
}
```

Run `pnpm --filter @maester/worker test`. Expected: PASS.

- [ ] **Step 5: Commit.** Use `feat(worker): market refresher with Nifty 500 breadth`.

### Task 7: Run it on a schedule, and by hand

**Files:**
- Create: `apps/worker/src/market/schedule.ts` (`startMarketSchedule(refresher, minutes, logger): () => void`, returning a stop function)
- Create: `apps/worker/src/market-refresh-cli.ts`
- Modify: `apps/worker/src/server.ts`, `apps/worker/package.json` (script `"market:refresh": "tsx --env-file=../../.env src/market-refresh-cli.ts"`), `docker-compose.yml` (the API and worker environment pass `CONNECTIONS_KEY`, `DHAN_REQUESTS_PER_SECOND` and `MARKET_REFRESH_MINUTES` through from `.env`), `.env.example`
- Test: `apps/worker/test/market-schedule.test.ts`

- [ ] **Step 1: Write the failing test.** With vitest fake timers, `startMarketSchedule`:
  - calls `refresh()` once after 10 seconds, then every `minutes`;
  - never runs two at once, so a slow refresh skips the next tick;
  - stops when the stop function is called;
  - logs and swallows a thrown error.
- [ ] **Step 2: Implement it** with `setTimeout` chaining (not `setInterval`) and an `inFlight` flag. Run the test. Expected: PASS.
- [ ] **Step 3: Wire it into `server.ts`.** When `env.CONNECTIONS_KEY` is set:
  - build the refresher, with `sources` reading `market_connection` on each pass;
  - build `readMembers(new URL("../data/nifty500.csv", import.meta.url))`;
  - start the schedule.

  Otherwise log `"CONNECTIONS_KEY is not set; market mood is not refreshed"`. A pass with no saved connections writes nothing and finishes `ok`. Call the stop function on `SIGTERM` before closing the server.

  The CLI builds the same objects, calls `refresh()` once, prints the run's state and code, and exits non-zero on `failed`.

  Make sure `tsup` copies, or the Dockerfile includes, `apps/worker/data/nifty500.csv`. Check `apps/worker/Dockerfile` and `tsup.config.ts`.
- [ ] **Step 4: Run it for real.** Generate a key with `openssl rand -base64 32` into `.env` as `CONNECTIONS_KEY`. The user saves their Dhan and FRED keys in Settings once Task 9b exists. **Ruling:** this live run happens after Task 9b, because the keys go in through Settings. Run Tasks 8, 9 and 9b first, then come back to this step. Then:
  1. `pnpm db:up && pnpm --filter @maester/db migrate`
  2. `pnpm --filter @maester/worker market:refresh`

  Expected: `ok`, and thousands of points written (about 500 members × 1,000 days on the first run, taking several minutes at 4 requests a second). Then:
  ```bash
  psql postgres://maester:maester@localhost:5433/maester -c "select series, count(*), max(day) from market_point where series not like 'eq:%' group by 1"
  ```
  Report the counts to the user.
- [ ] **Step 5: Run the checks.** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit.** Use `feat(worker): refresh market data every 30 minutes and on demand`.

### Task 8: Web data layer, rail entry and copy

Load `svelte-code-writer` and `svelte-core-bestpractices` first.

**Files:**
- Create: `apps/web/src/lib/market-mood/types.ts` (a hand mirror of `packages/contracts/src/market-mood.ts`, with a header naming it)
- Create: `apps/web/src/lib/market-mood/client.ts` (`marketMoodApi(fetcher)` with `mood()` and `reading(key)`, reusing `ApiError`, `Fetcher` and `getJson` from `$lib/documents/client`)
- Create: `apps/web/src/lib/market-mood/view.ts` (pure helpers)
- Test: `apps/web/src/lib/market-mood/view.test.ts` and `client.test.ts`
- Create: `apps/web/src/lib/content/market-mood.ts`
- Modify: `apps/web/src/lib/terminal/pages.ts` and its test

**Interfaces it produces (`view.ts`):**
- `bandLabel(band: MoodBand): string` gives "Very cautious" and so on.
- `FAMILY_ORDER: ReadingFamily[]`
- `byFamily(readings): { family, readings }[]`
- `formatValue(r: Reading): string` gives "17.8", "+1.4%", "38%", "−4.2%", "1.21", "88.74" or "—". It uses a true minus sign (U+2212) and a sign on percentages that change.
- `formatPrevious(r): string | null` gives "+2.6 in 5 sessions" for 5-session readings, and "was +6.8% on 8 Sep" for 20-session ones.
- `rankSentence(r): string | null` gives "Higher than 81% of the last 2 years", "Ranked against 29 days so far", or null when there is no value.
- `inMoodLine(r): { kind: "score"; score: number; band: string } | { kind: "out"; text: string }`
- `dayWords(day: string, latestSession: string | null): string` gives "6 Oct" or "Friday’s close".
- `headLine(m: MarketMood): string`, the sentence under the band.
- `fetchNotice(m): { title: string; detail: string } | null`, for the never-run, failed and token-expired states.

- [ ] **Step 1: Write the failing `view.test.ts`.** Cover each helper with the canvas's own figures:
  - India VIX 17.8 with a rank of 81 gives "Higher than 81% of the last 2 years" and "In the mood: 19 · very cautious";
  - a reading with `missing: "no_source"` gives "—" and "Not in the mood: no source connected yet";
  - `missing: "not_enough_history"` with `rankDays: 29` gives "Ranked against 29 days so far";
  - `fetch.errorCode: "DHAN_TOKEN_EXPIRED"` gives the title "Dhan stopped answering on 2 Oct. The token has expired." and the detail "Market mood stops at 1 Oct until you save a new one in Settings." It also gives a link to `/terminal/settings`;
  - `headLine` with 6 of 7 readings ends "Worked out from 6 of 7 readings; foreign flows have no source yet.";
  - `dayWords("2026-10-02", "2026-10-02")` gives "2 Oct", and a reading on the session before the latest gives the weekday name, as in "Friday’s close".
- [ ] **Step 2: Implement `view.ts`.** Keep all words in `content/market-mood.ts`, which follows the pattern of `content/documents.ts`. The reading names, "what it means" lines and family titles come from canvas F1. The method spec list text comes from F1 too, with "the plain average of the 6 or 7 readings present". Add the survivorship note: "Breadth uses today’s Nifty 500 members for all past days." Run `pnpm --dir apps/web test`. Expected: PASS.
- [ ] **Step 3: Add the rail entry.** In `pages.ts`:
  - add `'market-mood'` to `TerminalPageKey`;
  - add `'/terminal/market-mood'` to `TerminalPath`;
  - add `{ key: 'market-mood', label: 'Market mood', path: '/terminal/market-mood', group: 'portfolio', soon: false }` after Holdings;
  - change `ComingSoonKey` to `Exclude<TerminalPageKey, 'documents' | 'market-mood'>`. Settings stays a coming-soon page until Task 9b.

  Update `pages.test.ts` for the new labels and the new "soon" set.
- [ ] **Step 4: Run the checks.** `pnpm --dir apps/web check && pnpm --dir apps/web test`. Expected: PASS.
- [ ] **Step 5: Commit.** Use `feat(web): market mood data layer, copy and rail entry`.

### Task 9: Web page and components

Load the Svelte skills. Hold every frame against canvas page "A+B · final":
- F1, desktop;
- F2, phone;
- F3, a reading opened;
- F4, a late reading.

The kit that drew them is in this session's scratchpad. Task 10 commits it to `.claude/skills/design-directions/assets/kit/mood.mjs`.

**Files:**
- Create in `apps/web/src/lib/components/market-mood/`:
  - `MoodRuler.svelte`. Props `{ score: number | null; inverted?: boolean }`. A 2px rule with ticks at 0, 20, 40, 60, 80 and 100, the five band words under it (the current one bold, the rest `--ink-muted`), and an 8×26px ink block at the score. `role="img"` with `aria-label` "Mood 29 of 100: cautious", or "Mood unknown" with no block.
  - `RankRuler.svelte`. Props `{ rank: number }`. A 220px-wide 2px rule, "lowest" and "highest" labels, and a 6×18px block. `aria-label` from `rankSentence`.
  - `ScoreTick.svelte`. The 72px "In the mood" mini ruler.
  - `ReadingRow.svelte`. One reading in the F1 grid. On a phone it stacks as in F2. The name links to `/terminal/market-mood/<key>`, as an underlined link.
  - `MoodChart.svelte`. An inline SVG, ink only, one axis 0–100, band lines at 20, 40, 60 and 80, band names at the right from 1024px, the year's low marked, and the last point labelled "29 today". A "Show as a table" toggle shows a `<table>` of days and scores. It follows `dataviz`'s one-axis and table-view rules.
  - `MarketMoodPage.svelte`. Loads `mood()`, then shows, in order:
    1. the head (h1 "Market mood", a tag giving the day in words, the band word at display size, "29 of 100", and `headLine`);
    2. the ruler;
    3. "The readings" (h2) with the 4 families;
    4. the 12-month chart and "How it is worked out".

    While loading it shows Hatch boxes sized to the head, the ruler and 4 family blocks, with one status line, "Reading the market.". On failure it shows a SectionIssue with "Try again". A `fetchNotice` appears as a `Notice` (`role="note"`) above the readings. With no mood it shows "Not enough readings to give a mood today." in place of the band. If the tab stays open, it reloads the mood every 10 minutes, but not while hidden.
  - `ReadingPage.svelte`. Loads `reading(key)` and shows F3: "Back to Market mood", h1, the value at 72px, the rank sentence, the 2-year chart (the same `MoodChart` drawing code, generalised with a `domain` prop), "Show as a table", and the spec list (What it is, In the mood, Where from, What history says).
- Create: `apps/web/src/routes/terminal/market-mood/+page.svelte` with `<SignedInPage page="market-mood"><MarketMoodPage /></SignedInPage>`.
- Create: `apps/web/src/routes/terminal/market-mood/[key]/+page.svelte` and `+page.ts`. The `+page.ts` exports `prerender = true` and `entries = () => READING_KEYS.map((key) => ({ key }))`. The route's `load` returns `{ key }` and throws `error(404)` for an unknown key.
- Test: `apps/web/src/lib/components/market-mood/MoodRuler.svelte.test.ts`, only if the repo already has a browser test project. Otherwise `view.test.ts` covers the logic and the checks in Step 3 cover the rest.

- [ ] **Step 1: Build `MoodRuler`, `RankRuler`, `ScoreTick` and `ReadingRow`.** Use tokens only. Use a container query on the families section: four columns at 40rem or wider, stacked below that.
- [ ] **Step 2: Build `MarketMoodPage`, `MoodChart`, `ReadingPage` and the two routes.**
- [ ] **Step 3: Run `pnpm --dir apps/web verify`.** Expected: PASS. That covers the design guard, `svelte-check --fail-on-warnings`, the lint and the static build, which has to prerender the 10 reading pages.
- [ ] **Step 4: Check it in the browser.** Start `web-dev`, plus the API and worker (`pnpm dev:api`, `pnpm dev:worker`), using the data from Task 7. The user signs in in the Browser pane; never type their password. Compare `/terminal/market-mood` with F1 at 1440, with F2 at 390 and 360, and the reading page with F3. To see F4, temporarily delete today's `n500_above_200d_pct` row in the dev database, then re-run `market:refresh` to restore it. Screenshot each, and report any difference from the canvas plainly.
- [ ] **Step 5: Commit.** Use `feat(web): the working Market mood page`.

### Task 9b: Settings page — Dhan and FRED

Load the Svelte skills. Hold the page against canvas page "Settings · G final":
- K1, not connected;
- K2, both connected;
- K3, Dhan expired on a phone.

**Files:**
- Create: `apps/web/src/lib/settings/{types.ts,client.ts,view.ts,view.test.ts,client.test.ts}`.
  - `client.ts` exports `connectionsApi(fetcher)` with `list()`, `saveDhan(req)`, `saveFred(req)` and `remove(provider)`.
  - `view.ts` exports `tagWord(c)` ("Not connected", "Connected", "Expired 2 Oct", "Not answering"), `expiryWords(iso, now)` ("5 Nov 2026, in 30 days"), `saveFailure(err: ApiError)` (field message, form message or null) and `lastReadWords(c)`.
- Create: `apps/web/src/lib/content/settings.ts`. All copy comes from K1–K3 and the spec's Settings states.
- Create in `apps/web/src/lib/components/settings/`:
  - `SettingsGroup.svelte`: an `h2` and an optional lede, then its items, closed by a 2px rule.
  - `SettingsItem.svelte`: the accordion item. Props are `{ id, title, summary, state, stateStrong?: boolean, open?: boolean, children }`. The header is `<h3><button aria-expanded aria-controls>`, a 64px minimum height with a 2px rule above, and the panel `id` matches `aria-controls`. Several items can be open, and opening one has no effect on the others. There is no animation; it shows and hides at once. On a phone, `state` takes the summary's place. This is a new DESIGN.md §5 component, so add its row.
  - `SettingsPage.svelte`: the h1 and lede; then the group "Account" with one item, built from `readMe` and the session; then the group "Connections" with a `ConnectionSection` in an item for each provider. An item opens on load when its connection state is `not_connected`, `expired` or `failing`. Which items are open lives in component state only.
  - `ConnectionSection.svelte`: the item's body, either the not-connected form or the connected spec list, plus the "Where to find it" ordered list. From 1024px the steps are a 420px column beside the form; below that they sit under it.
  - `DisconnectDialog.svelte`: a native `<dialog>` with "Disconnect Dhan? The token is deleted. Readings already read stay." and the buttons "Disconnect" and "Keep it".
- Modify: `apps/web/src/routes/terminal/settings/+page.svelte` to render `<SignedInPage page="settings"><SettingsPage /></SignedInPage>` in place of the coming-soon page.
- Modify: `apps/web/src/lib/terminal/pages.ts` and its test.
  - Set Settings to `soon: false`.
  - Change `ComingSoonKey` to `Exclude<TerminalPageKey, 'documents' | 'market-mood' | 'settings'>`.
  - Remove the settings entry from `terminalContent.comingSoon.pages`.
- Delete: `apps/web/src/lib/components/terminal/sketches/SpannerSketch.svelte`, with every reference to it: its copy in `lib/content/terminal.ts`, any import, and its DESIGN.md §5 mention. The user decided this on 6 Oct 2026.

Rules:
- The accordion must work with Enter and Space on the header button. Focus never moves on open. After a save, focus goes to the item's header button.
- Use the existing `PasswordField` (its "Show" button), with the label "Show token" or "Show key".
- While a save is checking, "Save and check" is a disabled `<button>` pointing, through `aria-describedby`, at the visible line "Checking with Dhan…" with the `Ruler`.
- After a save, clear the secret field. Move focus to the item's header button, and announce "Dhan connected." through the page's polite status line.
- A refused save puts the error under the field (3px border, bold text) and moves focus back to the field.
- The secret never goes into the URL, `localStorage` or a log.
- The Dhan "Save and check" is the screen's one primary action only while Dhan isn't connected. FRED's is outline.

- [ ] **Step 1: Write the failing `view.test.ts`.** Cover each tag word, `expiryWords` across a month boundary, `saveFailure` for each API answer in Task 5b, and `opensOnLoad(c)`. `opensOnLoad` is true for `not_connected`, `expired` and `failing`, and false for `connected`.
- [ ] **Step 2: Implement the view, client and copy.** Run `pnpm --dir apps/web test`. Expected: PASS.
- [ ] **Step 3: Build the components and the route.** Run `pnpm --dir apps/web verify`. Expected: PASS.
- [ ] **Step 4: Check it in the browser.** With the API running and `CONNECTIONS_KEY` set:
  1. Ask the user to sign in, then paste their own Dhan token and FRED key into the page themselves. Never type them yourself.
  2. Confirm K2's connected state.
  3. Run `market:refresh`, and confirm Market mood fills in.
  4. Screenshot at 1440 and 390, and compare with K1–K3.
- [ ] **Step 5: Commit.** Use `feat(web): Settings with Dhan and FRED connections`.

### Task 10: Docs, kit and final checks

**Files:**
- Modify: `docs/DESIGN.md`. In §5 add Mood ruler, Rank ruler, Reading row and Mood chart entries, each as a behaviour paragraph like the existing ones. In §10, add Market mood to the working pages and the Portfolio rail group, and add a "**Market mood.**" paragraph describing the page order, the states, and "personal data, never on a public page".
- Modify: `docs/UI_SPECIFICATION.md` §2's navigation table. Add `docs/DESIGN.md` §10 lines saying that Settings works, with its sections, and §5 entries for Connection section.
- Modify: `docs/systems/api.md` (routes, the two new tables), `docs/systems/worker.md` (the refresher, schedule, CLI, env vars, error codes), `docs/systems/web.md` (the page's operation), `docs/systems/packages.md` (contracts, db tables, migration 0004), the `apps/api/README.md` and `apps/worker/README.md` route and env lists, and `.env.example`. Follow the `writing-ste` skill for `docs/systems/*`.
- Create: `.claude/skills/design-directions/assets/kit/mood.mjs`, `mood-notes.json` and `mood-heights.json`, copied from this session's scratchpad. Add a "Market mood round (2026-10-06)" section to the kit `README.md`.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run everything.** `pnpm lint && pnpm typecheck && pnpm test && pnpm --dir apps/web verify`. Expected: PASS.
- [ ] **Step 3: Commit.** Use `docs: market mood page, refresher and routes` and `chore(skills): market mood canvas kit`.
- [ ] **Step 4: Update memory.** `maester-market-mood-canvas.md` becomes "A+B BUILT on staging (commits …), not pushed".
- [ ] **Step 5: Ask for a review.** Run `superpowers:requesting-code-review` over the whole range of commits, then fix what it confirms.
