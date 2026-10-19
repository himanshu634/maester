# Broker connections on Holdings: implementation plan

Status: draft, 19 Oct 2026. The backend tasks are written now. The web tasks wait until a direction is picked on the "Maester Broker Connections" canvas (<https://claude.ai/artifact/2YSB5bYQ5beYq5aanK7Sm6>): A · Accounts, then one table; B · Each account, its own ledger; C · The statement first. The facts behind it are in [`docs/research/2026-10-19-broker-apis.md`](../../research/2026-10-19-broker-apis.md).

## Goal

The investor connects the brokers they hold accounts with on the Holdings page. Maester reads the holdings and positions there and never places an order. `/terminal/holdings` stops being a coming-soon page: it shows every holding with where it is held, when it was read, and what it is worth at Maester's own NSE close.

The user's constraint: "I think that will fall under the holding page." Broker connections live on Holdings, not in Settings. Settings keeps Account and the market-data connections (Dhan for closes, FRED).

## What changes in the product rules

- **Roadmap:** this pulls F35 (read-only broker connections, P2) ahead of F18 and F19, because Maester is for personal use (see `docs/FEATURE_ROADMAP.md`). The roadmap's own caveat still holds: connectivity does not remove reconciliation, and an API does not give historical cash flows. Holdings stays in snapshot mode (UI spec §5). There is no ledger, no returns and no history chart.
- **DESIGN.md §10 and UI spec §2:** Holdings moves from Soon to live. Section 5 gains the new components (per the pick). The Settings example "5 Nov 2026, in 30 days" becomes a 24-hour Dhan token.
- **Financial figures:** a quantity, an average cost and a broker's price are facts read from the broker, each with its account and read time. Value, combined quantity, total, weight and unrealized gain are named calculations in `packages/financial-engine-ts`, each with a hand-worked fixture. `apps/web` formats them; it never computes one. A broker that is signed out keeps its last read, dated. A broker that failed is "—" with its reason, never zero, and never silently left out of a total.

## Decisions to take with the pick

1. **Dhan.** Recommended: one credential. The Dhan account on Holdings reads holdings with the `market_connection` Dhan row that Settings already keeps (a client ID and a 24-hour token the worker renews on every market pass), and both places show the same state. Note that `market_connection` is global, keyed by provider, while `broker_connection` is per workspace; Dhan on Holdings is the one account that points at the global row. The alternative is a separate broker row with its own key and consent flow.
2. **PIN-and-code brokers (Angel One, Kotak Neo).** Recommended: not offered in this release. The alternative is to let the investor type the PIN and today's code each morning, used once and not kept.
3. **Price for value.** Recommended: Maester's stored NSE close, from the Dhan Data API. A share without a stored close is "—" with the reason. Using the broker's own last price is the alternative; it carries a different basis and time and must say so.
4. **First brokers.** Build the adapters for the brokers the investor actually holds accounts with first, then the rest of the "sign in on the broker's page" group.

## Architecture

```
web /terminal/holdings ──► API /v1/workspaces/:ws/brokers/*   (save key, start sign-in, read, disconnect)
                       └─► API /v1/workspaces/:ws/holdings      (combined snapshot, computed in the engine)
broker's login page ──redirect──► API /v1/brokers/:broker/return?state=…   (exchange, store token, queue read)
worker  holdings.read  ──► packages/brokers adapter ──► broker REST (GET holdings, positions)
                       └─► holding_read + holding_line rows (immutable, one read per run)
```

- **`packages/brokers`** (new, shaped like `packages/market`): a `BrokerAdapter` interface and one adapter per broker. Plain HTTP with `fetch`, so there is no AGPL code; the `kiteconnect` npm SDK (MIT) is allowed for Zerodha. Each adapter turns the broker's payload into a `BrokerHoldingLine`: ISIN, exchange symbol, quantity, T1 quantity, average price and the broker's last price, all decimal strings. It validates the payload with a schema and rejects any field it does not expect. The adapter tests use recorded, sanitised payloads (QUALITY.md); the normal suite never calls a broker.
- **Secrets:** reuse `packages/market/src/secrets.ts` (AES-256-GCM under `CONNECTIONS_KEY`). The API key, the secret and the day's access token are each stored encrypted, and only the last 4 of the key are ever shown. A token, a secret or a payload is never logged.
- **Sign-in round trip:** `GET …/brokers/:broker/login` writes a single-use `broker_login_state` (a random nonce, the workspace, the broker and a 10-minute expiry) and answers with the broker's login URL. The return route checks the nonce, exchanges the code for a token (Kite's checksum is computed on the server), stores the token with its expiry, queues `holdings.read` and redirects to `/terminal/holdings?connected=<broker>`. The redirect URL each broker app needs is the API's return route. Whether each broker accepts a localhost or http redirect URL for development is an open check per broker, done in task 10 before its adapter is relied on.
- **No static IP:** every call is a GET on holdings, positions or profile. An adapter has no order methods, so nothing can trade.

## Tasks

Each task is TDD: test first, then code, then `pnpm verify` in the package.

1. **Contracts** (`packages/contracts/src/brokers.ts`, mirrored by hand in `apps/web/src/lib/holdings/types.ts`):
   - `BrokerId`: kite, dhan, upstox, fyers, icici, fivepaisa, groww.
   - `BrokerAccount`: state `not_connected | signed_in | signed_out | failing`, account ID, key last 4, signed-in at, signed-out at, last read, error code.
   - `HoldingsSnapshot`: lines per account, combined rows, totals with coverage, and each figure's basis and "as of".
   - Fixtures in `packages/contracts/fixtures/brokers/`.
2. **Schema** (`packages/db/src/schema/brokers.ts` plus a migration):
   - `broker_connection`: workspace, broker, account ID, key and secret ciphertext, key last 4, token ciphertext, token expiry, state, last error, saved by.
   - `broker_login_state`.
   - `security`: ISIN primary key, NSE symbol, BSE code, name. It is separate from the workspace-scoped `company`, matched to it by NSE symbol (UI spec §5: a security and its issuer are distinct).
   - `holding_read`: connection, started, finished, ok or failed, error code.
   - `holding_line`: read, ISIN, symbol, `numeric` quantity, T1 quantity, average price and broker price.
   - Add every new table to the truncate lists in `packages/db/test/helpers.ts`, `apps/api/test/context.ts` and `apps/worker/test/context.ts`, and to `packages/db/test/migrate.test.ts`.
3. **Engine** (`packages/financial-engine-ts`), all `decimal.js`, each versioned with a fixture worked by hand:
   - `holding_value` (quantity × close).
   - `combined_quantity` (per ISIN across accounts).
   - `holdings_total` (known value plus coverage, "n of m priced").
   - `holding_weight`.
   - `unrealized_gain` (only where both cost and value are known).
   - Unavailable codes: `NO_CLOSE`, `NO_COST`, `ACCOUNT_FAILED`.
4. **`packages/brokers`:** the interface, a fake adapter for tests, then the adapters in the order of decision 4. Zerodha first if it is among them: login URL, `POST /session/token` with the checksum, `GET /portfolio/holdings`, `GET /portfolio/positions`, and the 6:00 expiry. Dhan reuses `HttpDhanSource`'s credential and calls `GET /v2/holdings` and `GET /v2/positions`.
5. **API** (`apps/api/src/routes/brokers.ts`, `holdings.ts`): list, save and check the key (checked with the broker's profile call before it is kept, like Settings' "Save and check"), start sign-in, return, read again, disconnect (keeps the reads, dated), and the holdings snapshot. Workspace-scoped like `documents`; the return route is on v1 without `requireWorkspace` and resolves the workspace from the state.
6. **Worker** (`apps/worker/src/jobs/holdings-read.ts`): reads one connection and writes one `holding_read`. A refused token marks the connection `signed_out`, not `failing`. It runs after each sign-in and on "Read again". There is no unattended schedule, because there is no token to use after the broker signs Maester out.
7. **Web: after the pick.** `lib/holdings/` (client, view logic, tested, free of Svelte), `lib/content/holdings.ts` (copy) and the components the picked direction names: for A, `AccountsLedger` and `BrokerPicker`, with `HoldingsTable` gaining Held at; for B, `AccountBlock` and `BrokerSheet`; for C, the statement sources list and the reconciliation table. Every direction needs `BrokerConnectForm` (numbered steps, the redirect URL to copy, the key fields, "Save and sign in with <broker>") and the states in the canvas's shared frame: reading, done, refused, disconnect asks first. Holdings becomes live in `lib/terminal/pages.ts`; its coming-soon page and `CraneSketch` are removed.
8. **C only:**
   - A CAS reader beside the extractor (casparser, MIT, Python).
   - A `cas` kind in classification.
   - A PAN prompt to open the locked PDF, used once and not kept.
   - Statement-versus-broker rules in the engine, stated per row in words.
9. **Docs:** DESIGN §5 and §10, UI spec §2 and §5, FEATURE_ROADMAP (F35 note), `docs/systems/packages.md` (`packages/brokers`), and the Settings copy for Dhan's 24-hour token.
10. **Live check:** with the investor's own keys, connect each broker on localhost, sign in, read, sign out the next morning, and read again. Record what each broker actually returned, with no figures in the log, in the research doc.

## Order and size

- Tasks 1 to 3 and 4 (the fake adapter plus one real adapter) can start before the pick. They are the same for A, B and C.
- Task 7 starts after the pick. Task 8 only if C is picked.
- Rough size: about 2 days for the backend with one adapter, half a day per further adapter, and 1.5 days for the web of A or B (2.5 for C, plus the CAS reader).

## Risks

- Brokers change their sign-in rules often; Fyers and Angel One are mid-change in 2026. Adapters stay small and are checked live each quarter.
- Upstox allows one API app per account. Connecting Maester would replace another tool's app.
- Groww's ₹499 a month is the investor's cost to bear. The page says so before they connect.
- The SEBI circular text was not read directly. The read-only exemption from the static IP rule rests on the brokers' own pages.
