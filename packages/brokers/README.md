# @maester/brokers

Brokers are data. Each broker is one JSON file that describes it: what the Holdings page says about it, what the investor types in, how they sign in, and the read-only calls Maester makes. To add a broker, add a file. The code here only interprets a fixed vocabulary and never runs anything from a definition.

- **Built-in definitions:** `definitions/*.json`, imported by `src/built-in.ts`, so a bundled API carries them. Zerodha (`kite.json`) is the first.
- **Deployment definitions:** a folder named by `BROKER_DEFINITIONS_DIR`, loaded over the built-in ones. A file with a built-in id replaces it. Set `"enabled": false` with a `notOfferedReason` to list a broker as not offered.
- **Schema:** `BrokerDefinition` in `packages/contracts/src/brokers.ts`. `checkDefinition` adds the checks a schema cannot make, and a definition that fails them stops the API at start.
- **The web:** `/v1/brokers` serves each definition's name, copy and fields, never its calls. The page has no broker list of its own.

## The vocabulary

| Key | What it is |
| --- | --- |
| `id`, `name`, `enabled`, `notOfferedReason` | The broker, and whether it is offered |
| `hosts` | Every host a call may reach. A URL on any other host, or not https, is refused at load and again before it is sent |
| `copy` | What the page says: `pickerLine`, `lasts`, `cost`, `formLede`, numbered `steps`, `saveNote`, `signedOutNote` |
| `credentials` | The fields the investor types in (`key`, `label`, `hint`, `secret`, `minLength`, `maxLength`). They are kept together, encrypted. `credentialShown` names the one whose last 4 characters are shown |
| `signIn.loginUrl` | The broker's login page. `{state}` is a single-use nonce; `{stateQuery}` is `state=<nonce>`, for brokers such as Zerodha that send back a `redirect_params` string. Values in a URL are URL-encoded |
| `signIn.returnParams` | The query parameters the broker sends back: the code, the state, and optionally a status with its success value |
| `signIn.session` | The call that exchanges the code for a session: `method`, `url`, `headers`, `form`, `derive`, the JSON paths of `accessToken` and `accountId`, and the `expiry` (`daily` at a local time in a zone, or `hours`) |
| `reads.holdings` | The holdings call: `list` is the JSON path of the array; `fields` maps `isin`, `symbol`, `exchange`, `quantity`, `t1Quantity`, `averagePrice` and `lastPrice` to paths inside one item |
| `derive` | A value worked out before a call. Only `sha256hex`, over named values joined with nothing between them (Zerodha's checksum) |
| `signedOutStatuses` | Statuses that mean the broker signed Maester out |

A template may use only the values that exist where it is used: credentials everywhere, `{code}` in the session call, and `{accessToken}` and `{accountId}` in reads.

## Why so narrow

- **Only GET reads and one sign-in exchange.** There is no way to describe an order, so nothing can trade.
- **Figures stay decimal strings as printed.** A JSON number keeps the digits JSON printed. An exponent, or a value that is not a number, is refused.
- **A broker's error text is never logged or passed on.** It can echo a key. Errors carry a code only: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED` or `BROKER_ANSWER_UNREADABLE`.

A broker that needs something outside this vocabulary, such as a PIN and TOTP sign-in, a different checksum or a paged list, needs a new term here, with tests, before its file can be written.
