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
| `signIn.loginUrl` | The broker's login page. `{state}` is a single-use nonce; `{stateQuery}` is `state=<nonce>`, for brokers such as Zerodha that send back a `redirect_params` string. Values in a URL are URL-encoded |
| `signIn.returnParams` | The query parameters the broker sends back: the code, the state, and optionally a status with its success value |
| `signIn.session` | The call that exchanges the code for a session: `method`, `url`, `headers`, `form`, `derive`, the JSON paths of `accessToken` and `accountId`, and the `expiry` (`daily` at a local time in a zone, or `hours`) |
| `reads.holdings` | The holdings call: `list` is the JSON path of the array, or absent when the answer is the array itself (Dhan); `fields` maps `isin`, `symbol`, `exchange`, `quantity`, `t1Quantity`, `averagePrice` and `lastPrice` to paths inside one item |
| `derive` | A value worked out before a call. Only `sha256hex`, over named values joined with nothing between them (Zerodha's checksum) |
| `signedOutStatuses` | Statuses that mean the broker signed Maester out |

A template may use only the values that exist where it is used: credentials everywhere, `{code}` in the session call, and `{accessToken}` and `{accountId}` in reads. A `settings-connection` read may use `{accessToken}` and `{clientId}`, the token and client ID Settings holds at the moment of the read.

## Signing in through Settings (Dhan)

Dhan tokens last 24 hours. The market worker (`apps/worker/src/market/refresh.ts`) renews the token saved in Settings on every pass when it has less than 6 hours left, and a renewal ends the old token. So a Dhan account keeps no token of its own: each read decrypts the one in `market_connection` (under the same `CONNECTIONS_KEY`) and sends it with the client ID. Adding Dhan on Holdings saves an empty credential set and reads at once; it is refused until Settings has a Dhan connection.

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
