# Market mood: design

Status: approved for planning, 6 October 2026. Built on staging, 13 October 2026; the notes below are aligned with what was built.

Design canvas: "Maester Market Mood", https://claude.ai/artifact/Sa34MqzWhGqUZbPxTKNhZ5, page "A+B · final" (frames F1–F4).

Research:
- [How market mood is measured](../../research/2026-10-06-market-mood.md)
- [Market data vendors](../../research/2026-10-06-market-data-vendors.md)

## Goal

A signed-in terminal page, `/terminal/market-mood`, tells the investor how cautious or eager the market is. It shows:

- the mood, as a band word, a 0–100 score and a ruler;
- every reading behind the mood, grouped into 4 families, each with its source and time;
- the mood over the last 12 months, and how it is worked out.

It is context for keeping to the investor's own allocation. It never says buy or sell.

## Scope and data

Maester is a personal, non-commercial project for one user. Market data therefore comes from that user's own accounts under personal-use terms:

- **DhanHQ Data API**: the user's Dhan subscription, ₹499 a month.
- **FRED**: free API key; commercial-use limits don't apply.

The data is never shown on a public page. Scraping NSE's website stays out, because NSE's terms forbid automated collection whatever the use.

| Reading | Family | Scored | Source | Series stored |
| --- | --- | --- | --- | --- |
| India VIX | Fear gauges | yes, inverted | Dhan, `IDX_I` daily | `india_vix` |
| US VIX | Fear gauges | yes, inverted | FRED `VIXCLS` | `us_vix` |
| Nifty put–call ratio, open interest | Fear gauges | no | Dhan option chain, once a day after the close | `nifty_pcr_oi` |
| Foreign investors, net, 20 sessions | Money | yes | none yet | `fpi_net_cr` |
| Indian funds, net, 20 sessions | Money | no | none yet | `dii_net_cr` |
| Nifty 50 against its 125-day average | Breadth and trend | yes | Dhan, `IDX_I` daily | `nifty50` |
| Nifty 500 shares above their 200-day average | Breadth and trend | yes | worked out from Dhan daily closes of the Nifty 500 members | `n500_above_200d_pct` |
| Nifty 500 new 52-week highs less lows | Breadth and trend | yes | worked out from the same closes | `n500_net_highs_pct` |
| Rupee per US dollar | Currency and havens | no | FRED `DEXINUS` (Federal Reserve noon rate, New York) | `usd_inr` |
| Gold against the Nifty, 20 days | Currency and havens | yes, inverted | Dhan, MCX gold near-month future, daily | `gold_mcx` |

**Flows have no source.** Dhan and FRED don't publish FII/DII flows, and NSE can't be scraped. The two flow readings show "—" with "No source connected yet". The mood is worked out from the other 6 of 7 readings, and the page says so. Manual entry is a possible follow-up; it is not in this build.

**Nifty 500 members.** The member list is a CSV checked into the repo with its as-of date. It is downloaded by hand from niftyindices.com, whose terms allow personal use. Breadth uses today's members for all history, so it carries survivorship bias. The method says so.

**Put–call ratio history.** Dhan's option chain is live only, so the ratio's history starts on the first day the job runs. Until 2 years exist, its rank says "Ranked against N days so far".

## Method

These rules come from section 5 of the mood research.

- **Rank.** Each reading's value is ranked as a percentile of its own values on the trading days of the previous 2 years: up to 500 points, needing at least 250. With fewer than 250 points the reading still shows, but its rank is `null` and it is not scored.
- **Score.** For a scored reading, the score is the rank, or 100 minus the rank where a high value means caution (India VIX, US VIX, gold against Nifty).
- **Mood.** The mood is the plain mean of the scores present, rounded. If fewer than 5 of 7 are present, there is no mood.
- **Bands.** 0–19 Very cautious, 20–39 Cautious, 40–59 Middling, 60–79 Eager, 80–100 Very eager.
- **Derived readings:**
  - trend is `(close / mean(close over 125 sessions) − 1) × 100`;
  - gold against Nifty is the 20-session % change of gold less that of Nifty;
  - flows are a 20-session sum;
  - breadth is a share of the members with enough history (200 sessions for the average, 252 closes, one trading year, for 52-week highs and lows). The worker backfills 4 years, so derived readings have 500 ranked days.
- **Times.** Each reading carries its source label and the day its value is for. The mood's "as of" is its oldest scored reading's day. If any Indian scored reading is older than the latest Indian session, the head says "Provisional". US VIX, a day behind by nature, never makes the mood provisional; it drops out of the mood only when it is more than 4 calendar days old (stale).
- **History.** The 12-month line is the mood worked out for each Indian session in the last 12 months that had at least 5 scored readings, from the data as stored. It is drawn even on a day with no mood today.

## System

- **Storage.** `market_point` holds `(series, day) → value, source, fetched_at`. Per-member closes for breadth use the series `eq:<SYMBOL>`. `market_fetch` records each fetch run: source, status, error and row count.
- **Worker.** A `MarketRefresher` runs inside the worker process. Every 30 minutes it takes a Postgres advisory lock, then for each source fetches the days missing since the last stored point, upserts them, recomputes the two breadth series for the new days, and records the run. On the first run it backfills 3 years, which the 2-year ranks need, throttled to Dhan's rate limits. Each pass reads the saved connections from the database and skips any source that isn't connected. The refresher is off when `CONNECTIONS_KEY` is unset. A command, `pnpm --filter @maester/worker market:refresh`, runs one pass by hand.
- **API.**
  - `GET /v1/market-mood` returns the mood, the 10 readings and the 12-month history. It needs a session but no workspace.
  - `GET /v1/market-mood/readings/:key` returns one reading with its 2-year daily series, for the reading page.
  - The work is done in a pure module, `apps/api/src/market-mood/compute.ts`.
- **Web.**
  - The routes are `/terminal/market-mood` and `/terminal/market-mood/[key]`, prerendered for the 10 known keys.
  - Market mood goes in the rail's Portfolio group, after Holdings. It works, so it has no "Soon".
  - The page follows canvas F1–F4. Loading uses Hatch boxes and failure uses SectionIssue.

## Settings: connections

Canvas page "Settings · G final" (frames K1–K3). Picked 6 Oct 2026: G, with FRED in Settings too. Later the same day, every section became an accordion.

`/terminal/settings` stops being a coming-soon page. It is a list of accordion groups, so later settings can be added above or between them without a redesign:
- **Account:** one item, your account. It shows who is signed in, how and which workspace.
- **Connections:** Dhan, then FRED.

Each item is a real `<button aria-expanded>` header row inside an `h3`, with:
- a 2px rule above;
- the item's name, and a one-line summary under it;
- its state in words on the right, e.g. "Connected" or "Expired 2 Oct";
- + or − as decoration only; `aria-expanded` carries the state.

More than one item can be open at once, and there is no motion. An item that needs you (not connected, expired or failing) opens on load; the others start closed. On a phone the state replaces the summary line. Inside an open connection item: Each section has:
- a plain form: client ID and access token for Dhan, API key for FRED;
- a password field with "Show token" or "Show key";
- the button "Save and check";
- beside the form, 4 numbered steps for where to find the key.

Saving works like this:
- The API first checks the key with the source. For Dhan it reads the profile, which also gives the token's expiry. For FRED it reads one VIXCLS observation.
- It keeps the key only if the check passes.
- The key is stored encrypted (AES-256-GCM, with a server key `CONNECTIONS_KEY` from the environment). It is never sent back to the browser.

Once connected, each section shows the client ID, the key's last 4 characters, the expiry (Dhan only) and the last read. The section offers "Replace the token" or "Replace the key", and "Disconnect", which asks first.

Dhan is the page's primary action while it isn't connected. With no reminder in the rail, an expiry is said on Settings and in Market mood's notice.

Settings states:

| State | What the section says |
| --- | --- |
| Not connected | "Not connected", the empty form and the steps. Market mood says "Connect Dhan in Settings". |
| Checking | "Save and check" is disabled and points at "Checking with Dhan…" with the ruler. Nothing is kept yet. |
| Refused | Nothing is kept. The field gets a 3px border, with "Paste the whole token. Dhan said it isn’t valid." under it. |
| No answer | Nothing is kept. "Dhan didn’t answer. Try again in a minute." The token stays in the field. |
| Data API not active | The token is kept, with a Notice: "Dhan accepted the token, but the Data API subscription isn’t active. Turn it on in Dhan." |
| Expired | The tag says "Expired 2 Oct", with a note: "Market mood stops at 1 Oct until you save a new one." |

## States

| State | What the page says |
| --- | --- |
| No data yet | "No readings yet. Maester fetches them after the market closes." Each reading is missing as `no_data` (flows as `no_source`). The fetch status is shown: never run, running, or failed with its error. |
| Dhan token expired | "Dhan stopped answering. The token has expired." (undated: the worker records a failed run every 30 minutes, so the latest run's day is not when it stopped), "Market mood stops at 1 Oct until you save a new one in Settings." and a link to Settings. Readings show with their last stored day. |
| A reading missing or late | "—" with the reason. The head says "6 of 7 readings" and so on. |
| Fewer than 5 scored readings | "Not enough readings to give a mood today." The readings still show. |
| Holidays and weekends | Readings say the day they are for, in words ("Friday’s close"). |

## Out of scope

- FII/DII flows.
- C's morning sequence.
- D's portfolio panel, which waits for Holdings.
- Intraday updates.
- Any public or shared view.
