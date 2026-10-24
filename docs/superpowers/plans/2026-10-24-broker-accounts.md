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

The calculations stay the ones built (`holding_quantity`, `holding_cost`, `holding_value`, `holdings_totals`, `holding_weight`, v1). A view of one holder is the same calculations over that holder's parts only, so a row held by two people splits by part before it is summed. Add a fixture for a two-holder household, worked by hand, with its working in a comment. No calculation moves into the API or the web.

### 6. Dhan for a second person (question 4)

Either a `redirect` definition on Dhan's API key and consent flow (a daily browser consent, 25 a day), or keep `settings-connection` and allow one Dhan account per install.

### 7. Web (waits for the pick)

- In every direction: "Whose account is it?" on add; the holder beside every part; several accounts per broker; one filled button per screen.
- D adds the "Whose holdings" toggle and per-holder grouping; E adds the morning-round panel and a round state carried across broker redirects; F adds the account-column table and the opened-account band.
- `docs/DESIGN.md` §5 and §10 rows for the new pieces.

### 8. Live runs owed

Each broker's first real run: the response shapes, the redirect back to Maester, Dhan's `totalQty`, Groww's TOTP route, ICICI Direct's static IP field and its join.

## Open questions

1. Angel One: in (MPIN and code typed daily, never kept) or out?
2. Holders: names the investor types, or Maester users who each sign in?
3. Groww at ₹499 (maybe ₹2,000) a month per account: offer it, or list it as not offered?
4. Dhan for a second person: Dhan's own sign-in, or one Dhan account per install?
