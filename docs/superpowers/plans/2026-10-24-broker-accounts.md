# The top five brokers on Holdings: implementation plan

Status: built (#30), 25 Oct 2026; no live broker run yet. D is picked, redrawn as "D · final, one person" on the "Maester Broker Accounts" canvas (<https://claude.ai/artifact/3kUub9WRnmnm2neMpGkmNy>). The broker facts are in [`docs/research/2026-10-24-broker-accounts.md`](../../research/2026-10-24-broker-accounts.md); the colours are in [`docs/research/2026-10-24-pnl-and-highlight-colours.md`](../../research/2026-10-24-pnl-and-highlight-colours.md).

This plan builds on `feat/holdings-dhan` (A · Accounts, then one table, built for Zerodha and Dhan, not merged). It lands after that branch.

## Goal

One investor connects the brokers they hold accounts with. They have one account at each broker, at any of the top five by NSE active clients: Groww, Zerodha, Angel One, ICICI Direct and Upstox. Holdings shows every share in one view, broken down by the brokers that hold it, with P&L for each. Maester only reads; it never places an order.

The user corrected an earlier reading on 24 Oct 2026: "There won’t be multiple people, only one account, one person. But the broker may differ; multiple brokers can be available to one person." So there is no holder on an account, no "Whose holdings" toggle, and no second account at the same broker. The built rule of one account per broker per workspace (`broker_connection_workspace_broker`) stays as it is.

## What the built code lacks

- **Definitions:** there are only two, `kite.json` and `dhan.json`. Groww, Angel One, ICICI Direct and Upstox have none.
- **Sign-in kinds:** the vocabulary has `redirect` and `settings-connection`.
  - Angel One needs secrets typed each day.
  - Groww needs a key exchange after a daily approval.
  - ICICI Direct needs a checksum on every request and a join across two calls.
- **P&L per broker:** the snapshot has a row per share and its totals. It has no gain for each broker's part, and no gain per cent.
- **The page:** it leads with the accounts ledger, and every signed-out account is a filled "Sign in to …" button. The picked design leads with the holdings, and turns signed-out brokers into one nudge.

## Tasks

### 1. New definition terms (`packages/brokers`)

Each lands with tests in `packages/brokers/test/` and a row in the README's vocabulary.

- **`signIn.kind: "typed"` (Angel One):** fields marked `daily: true` are asked for at each sign-in. They are sent once in the session call and never written to the database or a log.
- **`signIn.kind: "approved-key"` (Groww):** the session call runs when the investor says they have approved the key. `derive` gains `sha256hex` over the secret and the epoch seconds.
- **`derive.checksum` per request (ICICI Direct Breeze):** a timestamp, and SHA-256 over the timestamp, the body and the secret, on every read.
- **`reads.holdings` as two calls joined on a key (ICICI Direct):** `dematholdings` gives the ISIN and `portfolioholdings` is keyed by stock code. The stock-code-to-ISIN map comes from the first call.

Settle question 1 (Angel One in or out) before writing `typed`.

### 2. Definitions

`groww.json`, `angel.json`, `icici.json` and `upstox.json`, each from the research page: fields, steps, copy, hosts, the session call and the holdings field map.

- Groww has no last price on holdings. Maester values at its own NSE close anyway.
- Every figure is read as a decimal string from the raw response.

### 3. Figures (`@maester/financial-engine`)

The built calculations stay as they are: `holding_quantity`, `holding_cost`, `holding_value`, `holdings_totals` and `holding_weight`, all v1. Holdings shows P&L for each broker's part of a share, which needs:

- **New calculations**, each with its own fixture worked out by hand, the working in a comment. Built 24 Oct 2026 on `feat/holdings-top-five`:
  - `holding_gain`: value less cost, for a row or one broker's part of it. It is unknown without both.
  - `holding_gain_percent`: gain ÷ the cost it was worked from, as a per cent to one place. It is unknown when the cost is zero or unknown. For the totals, the cost is that of the holdings with both a value and a cost.
  - `holding_average_price`: one broker's cost ÷ its quantity, when it holds one share on NSE and BSE, merged into one part.
  - `holdings_by_account`: each broker's value, invested and P&L, summed over its parts, with what they cover.
- **The snapshot shape:** each `HoldingRow.parts[]` carries the broker, its quantity, average price, cost, value, gain and gain per cent, all as decimal strings. `packages/contracts/src/brokers.ts` changes to match.

No calculation moves into the API or the web.

### 4. Dhan (question 4)

Keep `settings-connection`: one person, one Dhan account, read with the token saved in Settings. This needs no change unless the user wants Dhan's own sign-in.

### 5. Design system (on the go-ahead)

Gain `#006B55` and loss `#BA2C1A`, with `#3FC4A2` and `#FF7A4D` on ink, on a signed P&L figure only. The G · Highlighter `#F9DC5C` marks the nudge. These ship in the same change as the page, along with:

- an amendment to ADR 0002;
- DESIGN.md §2, §5, §6 and §10;
- `tokens.css`;
- `design-guard.test.ts`.

UI_SPECIFICATION §3 needs no change: it already allows colour paired with text, a sign or a symbol. Built 24 Oct 2026 as ADR 0008.

The research page lists each change.

### 6. Web: D · final, one person

In order, the page has:

1. **The heading:** the `h1`, the tags and the lede ("Your holdings at five brokers, valued at the NSE close of Friday 23 Oct."), with "Add a broker" beside the title.
2. **The nudge**, shown only while some broker is signed out and its holdings are still on the page.
   - It is one line between 2px rules: "Some holdings are from Friday." in the highlight, then "2 of 5 brokers signed Maester out; sign in to see today’s.", then an outline "Update 2 brokers" button with `aria-expanded`.
   - The button opens a 2px box listing each broker, why it is signed out, and its one action. The first action is filled.
   - Escape closes the box and focus returns to the button. On a phone the box opens in place.
   - On load, the highlight draws across its words once, over 240ms, with `transform: scaleX`. This is the page's one motion after load, and there is none under reduced motion.
3. **The strip:** known value, invested, unrealized P&L with its %, and brokers read today.
4. **Holdings:** company, then a line per broker that holds it. Each line has the client ID and when it was read, then quantity, average cost, invested, value, P&L and P&L % in gain or loss. A "Show by: Company | Broker" switch sits above; showing by broker gives each broker its own ledger and total.
5. **"Your brokers"** at the foot: the accounts ledger with outline buttons only.

When every broker was read today, there is no nudge and nothing is starred. With no broker yet, the page is the add form, as built, with what each of the five needs.

Sign-in prompts take 8% of the first desktop screen, down from 48%, and 16% of a phone's. `docs/DESIGN.md` §5 and §10 get rows for the nudge and the broken-down ledger.

### 7. Live runs owed

Each broker's first real run should confirm:

- the response shapes;
- the redirect back to Maester;
- Dhan's `totalQty`;
- Groww's TOTP route;
- ICICI Direct's static IP field and its join.

## Open questions

1. Angel One: in, with the MPIN and code typed daily and never kept, or out?
2. Groww costs ₹499 a month, and the price may rise to ₹2,000. Offer it, or list it as not offered?
3. Highlight G, and gain and loss on Holdings only? Both are assumed in the drawing.
