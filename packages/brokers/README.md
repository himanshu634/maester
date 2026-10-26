# @maester/brokers

Brokers are data. Each broker is one JSON file that describes it: what the Holdings page says about it, what the investor types in, how they sign in, and the read-only calls Maester makes. To add a broker, add a file. The code here only interprets a fixed vocabulary and never runs anything from a definition.

- **Built-in definitions:** `definitions/*.json`, imported by `src/built-in.ts`, so a bundled API carries them. Zerodha (`kite.json`) signs in on its own page; Dhan (`dhan.json`) uses the Dhan connection saved in Settings.
- **Deployment definitions:** a folder named by `BROKER_DEFINITIONS_DIR`, loaded over the built-in ones. A file with a built-in id replaces it. Set `"enabled": false` with a `notOfferedReason` to list a broker as not offered.
- **Schema:** `BrokerDefinition` in `packages/contracts/src/brokers.ts`. `checkDefinition` adds the checks a schema cannot make, and a definition that fails them stops the API at start.
- **The web:** `/v1/brokers` serves each definition's name, copy and fields, never its calls. The page has no broker list of its own.

## The vocabulary

| Key | What it is |
| --- | --- |
| `id`, `name`, `enabled`, `notOfferedReason` | The broker, and whether it is offered |
| `hosts` | Every host a call may reach. A URL on any other host, or not https, is refused at load and again before it is sent |
| `copy` | What the page says: `pickerLine`, `lasts`, `cost`, `formLede`, numbered `steps`, `saveNote`, `signedOutNote` |
| `credentials` | The fields the investor types in (`key`, `label`, `hint`, `secret`, `minLength`, `maxLength`). They are kept together, encrypted. `credentialShown` names the one whose last 4 characters are shown. A `settings-connection` broker has none, and no `credentialShown` |
| `signIn.kind` | `redirect`: save a key, then sign in on the broker's page (the terms below). `settings-connection`: use the connection saved in Settings for `signIn.provider` (only `dhan` for now, a `market_connection` row), so there is nothing to save and no sign-in |
| `signIn.loginUrl` | The broker's login page. `{state}` is a single-use nonce; `{stateQuery}` is `state=<nonce>`, for brokers such as Zerodha that send back a `redirect_params` string; `{returnUrl}` is Maester's return address for the broker, for brokers such as Upstox that ask for it on the login page and again in the session call. Values in a URL are URL-encoded |
| `signIn.returnParams` | The query parameters the broker sends back: the code, the state, and optionally a status with its success value |
| `signIn.session` | The call that exchanges the code for a session: `method`, `url`, `headers`, `form`, `derive`, the JSON paths of `accessToken` and `accountId`, and the `expiry` (`daily` at a local time in a zone, or `hours`) |
| `reads.holdings` | The holdings call: `list` is the JSON path of the array, or absent when the answer is the array itself (Dhan); `fields` maps `isin`, `symbol`, `exchange`, `quantity`, `t1Quantity`, `averagePrice` and `lastPrice` to paths inside one item |
| `derive` | A value worked out before a call. Only `sha256hex`, over named values joined with nothing between them (Zerodha's checksum) |
| `signedOutStatuses` | Statuses that mean the broker signed Maester out |

A template may use only the values that exist where it is used: credentials everywhere, `{returnUrl}` on the login page and in the session call, `{code}` in the session call, and `{accessToken}` and `{accountId}` in reads.

## Signing in from Maester (`direct`, Groww)

`signIn.kind: "direct"` is for a broker whose session call Maester makes itself, with the saved key: no page to visit, no code coming back. Its `session` is a call like a redirect's, and may use the credentials and `{timestamp}` (epoch seconds, as a string). A call may send a JSON body (`json`, every value a string) in place of a form. `POST /v1/workspaces/:ws/brokers/:broker/session` signs in and reads at once; a session answer with no token is a refusal (`BROKER_REFUSED`), kept as the account's error.

`groww.json` follows Groww's own docs (24 Oct 2026): the token call in [curl](https://groww.in/trade-api/docs/curl) (`POST /v1/token/api/access`, `Authorization: Bearer <api key>`, `key_type: approval`, `checksum` = SHA-256 of the secret and the timestamp, both strings) and holdings in [portfolio](https://groww.in/trade-api/docs/curl/portfolio) (`GET /v1/holdings/user`, `X-API-VERSION: 1.0`, the list at `payload.holdings`). The investor approves the key on Groww Cloud each day before "Read Groww". Groww's holdings name no exchange, so `exchangeIs: "NSE"` says which; a share Groww holds that has no NSE listing will show no close. Not yet confirmed on a live run: whether `quantity` includes `t1_quantity` (it is not added on top, as for Dhan), and the token's real lifetime (the docs give 06:00 for one route only).

## Signed requests, GET bodies and joins (ICICI Direct)

- **Time and body:** every call may use `{timestamp}` (epoch seconds) and `{isoTimestamp}` (UTC, `2026-10-24T10:23:56.000Z`), taken once per call. `derive` and headers may also use `{body}`, the body exactly as sent, so a header can carry SHA-256 of the timestamp, the body and the secret. The body itself can never hold `{body}` or a value worked out from it; that is refused at load.
- **GET with a body:** a GET with a `json` body goes out through `node:https`, because `fetch` will not send one. The same host and https checks apply, and no redirect is followed.
- **`reads.holdings.join`:** a second call whose items add `averagePrice` and `lastPrice` to the first's, matched on `key` (in the first call's items) and `joinKey` (in the second's). A line with no match keeps an average price of `0`, which the engine reads as a cost it does not know.
- **`exchangeIs`:** NSE or BSE when the answer names no exchange but its symbols are that exchange's. Any other word, such as `ICICI`, means the symbols are the broker's own codes. Maester prices only NSE symbols, so such a share has a close only when another broker holds it too.

`icici.json` follows Breeze's docs ([api.icicidirect.com/breezeapi/documents](https://api.icicidirect.com/breezeapi/documents/index.html), 24 Oct 2026) and its official Python SDK:
- `customerdetails` is a GET with the session key and app key in a JSON body.
- Every other call carries the `X-Checksum: token <SHA-256(timestamp + body + secret)>`, `X-Timestamp`, `X-AppKey` and `X-SessionToken` headers.
- `dematholdings` (ISIN and quantity) is joined to `portfolioholdings` (average price, NSE, empty `stock_code` for all) on `stock_code`.

**It ships with `enabled: false`.** Breeze's login page takes no `state` and its docs say nothing comes back but the session key, so the return cannot be matched to the sign-in the investor started. The user chose (24 Oct 2026) to keep ICICI Direct off until a live test shows Breeze carries a state value, rather than accept the return on time alone.

To confirm before switching it on:
- the return parameter's name (`apisession` is a guess);
- whether `X-SessionToken` is `Success.session_token` as given (the SDK rebuilds it as base64 of the user ID and the session key);
- what happens to the static IP the app form asks for.

## Not offered yet

Angel One has no definition.

## Upstox

`upstox.json` follows Upstox's own docs (24 Oct 2026): the login dialog and token exchange in [authentication](https://upstox.com/developer/api-documentation/authentication/) and [get-token](https://upstox.com/developer/api-documentation/get-token/), and long-term holdings in [get-holdings](https://upstox.com/developer/api-documentation/get-holdings/). `state` comes back unchanged, so the nonce check holds. The token exchange takes the same `redirect_uri` as the login page and answers with `access_token` and `user_id` at the top level; the token lasts until 03:30 the next day. Upstox allows one app per person, so the investor's app replaces any other tool's. Not yet confirmed on a live run: whether `quantity` already includes `t1_quantity` (Maester adds them, as for Zerodha). A `settings-connection` read may use `{accessToken}` and `{clientId}`, the token and client ID Settings holds at the moment of the read.

## Signing in through Settings (Dhan)

Dhan tokens last 24 hours. The market worker (`apps/worker/src/market/refresh.ts`) renews the token saved in Settings on every pass when it has less than 6 hours left, and a renewal ends the old token. So a Dhan account keeps no token of its own: each read decrypts the one in `market_connection` (under the same `CONNECTIONS_KEY`) and sends it with the client ID. Adding Dhan on Holdings saves an empty credential set and reads at once; it is refused until Settings has a Dhan connection.

Settings connections are global to the install, but holdings are personal. So a Dhan account uses the Settings token only while that token was saved by the person who added the account (`market_connection.saved_by_user_id`, which a renewal keeps). Anyone else is refused when adding Dhan, and if another person's token replaces it in Settings, the account is signed out and reads nothing.

The account's state follows the connection: signed out when Settings has no Dhan token, the token has expired, the worker found it refused (`DHAN_TOKEN_EXPIRED`), or Dhan refused it on a holdings read since it was saved or renewed. A token saved or renewed after that refusal is a new one, so the account is signed in again with no step here. `DHAN_NO_DATA_PLAN` is about the paid Data API and does not affect holdings, which come from the free Trading API. A good read clears the account's last error, for every broker.

Two things in `dhan.json` rest on Dhan's documentation and want the first live run to confirm:

- **Quantity is `totalQty`**, with no `t1Quantity`. Dhan documents `totalQty` as the total and `t1Qty` as the part still settling, so `holding_quantity` (quantity plus T+1) would count T+1 shares twice if both were mapped.
- **Exchange is printed as `ALL`** for a demat holding. Maester values a holding only at an NSE close, so a share held only at Dhan is "—" until a broker that prints `NSE` holds it too (the row takes that broker's NSE symbol). Pricing Dhan's own rows would need a term mapping `ALL` to `NSE`, and that is safe only once the live run shows Dhan's `tradingSymbol` is the NSE symbol.

Dhan's docs do not say what an account with no holdings returns. If it is an error rather than `[]`, an empty Dhan account shows "Didn’t read" until it holds something; that would need a narrow term, with a test.

## Why so narrow

- **Only GET reads and one sign-in exchange.** There is no way to describe an order, so nothing can trade.
- **Figures stay decimal strings as printed.** A JSON number keeps the digits JSON printed. An exponent, or a value that is not a number, is refused.
- **A broker's error text is never logged or passed on.** It can echo a key. Errors carry a code only: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED` or `BROKER_ANSWER_UNREADABLE`.

**Treat the definitions folder as code.** A definition decides which host receives the decrypted credentials and token, so only the operator should be able to write to `BROKER_DEFINITIONS_DIR`.

A broker that needs something outside this vocabulary, such as a PIN and TOTP sign-in, a different checksum or a paged list, needs a new term here, with tests, before its file can be written.
