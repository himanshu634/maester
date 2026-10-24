# Several broker accounts on Holdings: implementation plan

Status: draft, 24 Oct 2026. The backend tasks are written now. The web tasks wait until a direction is picked on the "Maester Broker Accounts" canvas (<https://claude.ai/artifact/3kUub9WRnmnm2neMpGkmNy>): D · Household, by person; E · The morning round; F · Accounts as columns. The facts are in [`docs/research/2026-10-24-broker-accounts.md`](../../research/2026-10-24-broker-accounts.md).

This plan builds on `feat/holdings-dhan` (A · Accounts, then one table, built for Zerodha and Dhan, not merged). It lands after that branch.

## Goal

The investor adds every account their household holds, at the top five brokers by NSE active clients (Groww, Zerodha, Angel One, ICICI Direct, Upstox), more than one at the same broker, each named for whose it is. Holdings shows one view of all of them, with where each part is held, whose it is and when it was read. Maester only reads; it never places an order.

## What the built code cannot do today

- **One account per broker.** `broker_connection` has a unique index on `(workspace_id, broker)`, the routes are keyed by `:broker`, and `addable()` drops a broker once it is connected.
- **No owner.** Nothing says whose an account is, so two Zerodha accounts read alike in "Held at".
- **Two definitions.** Only `kite.json` and `dhan.json`. Groww, Angel One, ICICI Direct and Upstox have none.
- **Sign-in kinds.** The vocabulary has `redirect` and `settings-connection`. Angel One needs typed daily secrets; Groww needs a key exchange after a daily approval; ICICI Direct needs a checksum per request and a two-call join.
- **Dhan is one per install.** It reads only through the Settings token of the person who saved it.

## Tasks

### 1. Accounts, not brokers (database and contracts)

- Migration `0007_broker_accounts`:
  - Drop `broker_connection_workspace_broker`.
  - Add `holder text not null` (the name the investor types, "Asha"), backfilled from the saving user's name.
  - Unique `(workspace_id, broker, account_id)` where `account_id` is not null, so the same client ID is not added twice.
- `packages/contracts/src/brokers.ts`: `BrokerAccount` gains `id` (the connection id) and `holder`; `SaveBrokerRequest` gains `holder`. `HoldingPart` names the connection id, not the broker.
- Add the new table changes to the truncate lists in `packages/db/test/helpers.ts`, `apps/api/test/context.ts`, `apps/worker/test/context.ts` and `packages/db/test/migrate.test.ts`.

### 2. Routes keyed by account

- `/v1/workspaces/:ws/brokers` becomes `/v1/workspaces/:ws/accounts`: POST (broker, holder, credentials), and `/:account/sign-in`, `/:account/read`, DELETE `/:account`, PATCH `/:account` (rename the holder).
- `/v1/brokers/:broker/return` finds the account through `broker_login_state.connection_id`, which it already holds.
- `addable()` goes: every offered broker can always be added again.

### 3. New definition terms (`packages/brokers`)

Each lands with tests in `packages/brokers/test/` and a row in the README's vocabulary.

- `signIn.kind: "typed"` (Angel One): fields marked `daily: true` are asked for at each sign-in, sent once in the session call and never written to the database or a log.
- `signIn.kind: "approved-key"` (Groww): the session call runs when the investor says they approved the key; `derive` gains `sha256hex` over the secret and the epoch seconds.
- `derive.checksum` per request (ICICI Direct Breeze): a timestamp and SHA-256 over the timestamp, the body and the secret, on every read.
- `reads.holdings` as two calls joined on a key (ICICI Direct: `dematholdings` by ISIN and `portfolioholdings` by stock code), with the stock-code-to-ISIN map from the first.

Settle question 1 (Angel One in or out) before writing `typed`.

### 4. Definitions

`groww.json`, `angel.json`, `icici.json`, `upstox.json`, each from the research page: fields, steps, copy, hosts, the session call and the holdings field map. Groww has no last price on holdings; Maester values at its own NSE close anyway. Every figure is read as a decimal string from the raw response.

### 5. Figures (`@maester/financial-engine`)

The calculations built so far stay as they are: `holding_quantity`, `holding_cost`, `holding_value`, `holdings_totals` and `holding_weight`, all v1. A view of one holder runs the same calculations over that holder's parts only, so a row held by two people is split by part before it is summed. Add a fixture for a two-holder household, worked by hand, with the working in a comment. No calculation moves into the API or the web.

Round 3 of the canvas shows P&L per account and per holding: "I’m not getting clear information about which broker’s account holds which positions, and the columns lack profit-and-loss data." That needs:

- **Two new calculations**, each with its own fixture:
  - `holding_part_gain`: one account's quantity × the close, less its quantity × the broker's average price. It is unknown without a close.
  - `holding_gain_percent`: gain ÷ cost, as a per cent to one place. It is unknown when the cost is zero or unknown.
- **Per-account values** for the total of each account: value, invested and P&L, summed over that account's parts.
- **The snapshot shape:** each `HoldingRow.parts[]` carries its quantity, average price, cost, value, gain and gain per cent, all as decimal strings.

### 6. Dhan for a second person (question 4)

Either a `redirect` definition on Dhan's API key and consent flow (a daily browser consent, 25 a day), or keep `settings-connection` and allow one Dhan account per install.

### 7. Web: D · final (picked 24 Oct 2026; build waits for the go-ahead)

The user picked D, with this change: "If a user account is automatically locked out, we should display a brief nudge instead of taking up an entire section of the screen." and "if we already have the data, we should not ask the user to update it again." The page is drawn as "D · final" on the canvas. In order, it has:

1. The `h1`, the tags, the lede and the "Whose holdings" toggle.
2. **The nudge**, only while some account is signed out and still has holdings. It is one line between 2px rules: "Some holdings are from Friday." in the highlight, then "3 of 6 accounts signed Maester out; sign in to see today’s.", then an outline "Update 3 accounts" button with `aria-expanded`. The button opens a 2px box of the sign-ins, each account with why it is signed out and its one action, the first one filled. Escape closes it and focus returns to the button. On a phone the box opens in place. The highlight draws across its words once on load, over 240ms with `transform: scaleX`. That is the page's one motion after load, and there is none under reduced motion.
3. The strip: known value, invested, unrealized P&L with its %, and accounts read today.
4. Holdings, company then account, with "Show by: Company | Account".
5. Accounts at the foot, grouped by person, with outline buttons only.

With every account read today there is no nudge and nothing is starred. With no account yet, the page is the add form, as built. Measured: sign-in prompts take 8% of the first desktop screen, down from 48%, and 16% of a phone's.

The colours from round 4 are gain `#006B55` and loss `#BA2C1A` (`#3FC4A2` and `#FF7A4D` on ink), on the signed P&L figure only, and the G · Highlighter `#F9DC5C` for the nudge. They need the design-system changes listed in [`docs/research/2026-10-24-pnl-and-highlight-colours.md`](../../research/2026-10-24-pnl-and-highlight-colours.md), made in the same change.

The notes from before the pick:

- In every direction:
  - "Whose account is it?" when an account is added.
  - Several accounts per broker.
  - One filled button per screen.
  - From round 3, the holdings ledger becomes company, then account. Each company line is followed by one line per account that holds it, with "Zerodha · Asha", the client ID and when the account was read. Each line shows quantity, average cost, invested, value, P&L and P&L %.
  - From round 3, a "Show by: Company | Account" switch. By account, each account gets its own ledger and total.
  - From round 3, the strip shows Invested and Unrealized P&L with its per cent.
- D adds the "Whose holdings" toggle and per-holder grouping; E adds the morning-round panel and a round state carried across broker redirects; F adds the account-column table and the opened-account band.
- `docs/DESIGN.md` §5 and §10 rows for the new pieces.

### 8. Live runs owed

Each broker's first real run: the response shapes, the redirect back to Maester, Dhan's `totalQty`, Groww's TOTP route, ICICI Direct's static IP field and its join.

## Open questions

1. Angel One: in (MPIN and code typed daily, never kept) or out?
2. Holders: names the investor types, or Maester users who each sign in?
3. Groww at ₹499 (maybe ₹2,000) a month per account: offer it, or list it as not offered?
4. Dhan for a second person: Dhan's own sign-in, or one Dhan account per install?
