# @maester/brokers

Brokers are plugins. Each one is a folder of TypeScript in `src/plugins/`, compiled into the API: a manifest (what the Holdings page says and asks for) and the code that signs in and reads holdings. The contract gives a plugin a sign-in and a read, and the API has no route that writes to a broker. A plugin makes no call that writes: nothing in it places an order or moves money.

Design: [broker plugins](../../docs/superpowers/specs/2026-10-27-broker-plugins-design.md) and [ADR 0009](../../docs/decisions/0009-broker-plugins.md). Zerodha (Kite Connect) is the one broker offered. Angel One (SmartAPI) is a plugin too, but it is switched off until a live run (see below).

## Layout

```
src/
  index.ts          the package's exports
  plugin.ts         the BrokerPlugin contract
  registry.ts       builds the registry from plugins/index.ts and checks it
  host.ts           what the API calls: loginUrlFor, completeSignIn, readHoldings, toBrokerError
  errors.ts         BrokerError and its four codes
  kit/              what a plugin imports, through kit/index.ts: BrokerError, the BrokerHttp type, values.ts, expiry.ts
    http.ts         the host-locked client; the host makes one, and a plugin gets it only as ctx.http
  plugins/
    index.ts        the list of plugins, and defaultRegistry()
    kite/           manifest.ts and plugin.ts
    angel/          manifest.ts, answer.ts and plugin.ts
test/
  conformance.ts    runConformance(plugin, fixtures), the suite every plugin runs
  fake-plugin.ts    a test-only broker on broker.test, exported as @maester/brokers/testing
  kit/              tests of the kit
  plugins/kite/     kite.test.ts and fixtures/, the recorded answers
  plugins/angel/    angel.test.ts, answer.test.ts, sign-in.test.ts and fixtures/, the recorded answers
```

Tests and fixtures sit under `test/`, so they stay out of the build and outside the lint rule that applies to `src/plugins/`.

## The plugin contract

A `BrokerPlugin` (`src/plugin.ts`) has three parts:

- **`manifest`:** a `BrokerManifest` (`packages/contracts/src/brokers.ts`). It holds `id`, `name`, `enabled` and `notOfferedReason`; `hosts`, every host the login page and any call may reach; `copy`, what the page says; `credentials`, the fields the investor types in, with `credentialShown` naming the one whose last 4 characters are shown; `signIn`; and `signedOutStatuses`, the statuses that mean the broker signed Maester out. The API serves it, as a `BrokerSummary`, at `/v1/brokers`, so the web has no broker list of its own and never imports this package. It holds no call.
- **`signIn`:** one strategy today, `redirect`: the investor saves a key, signs in on the broker's own page, and comes back with a code or a token. A plugin gives `loginUrl({ creds, state, returnUrl })`, `readReturn(query)`, which says what the broker sent back and whether the investor turned it down, and `complete({ creds, payload, returnUrl, http, now })`, which turns the return into a `BrokerSession` (the token, the account it belongs to, when it was made and when it stops working). `signIn.kind` must equal `manifest.signIn.kind`.
- **`reads.holdings(ctx)`:** the holdings, as `BrokerHoldingLine`s. `ctx` holds the saved fields, the session the host decrypted, an `http` locked to the broker, and `now`. Later reads (funds, positions, SIPs) would be optional members here, each with its own output schema, and a change in the host and the web as well.

The registry (`createRegistry`, `defaultRegistry`) is built when the API starts. It parses every manifest, and refuses a repeated id, a `credentialShown` that is not a credential, two credentials with one key, and a `signIn.kind` that differs between manifest and plugin. A bad plugin stops the API with its id and the reason (`RegistryError`). A plugin with `enabled: false` is listed as not offered, and nothing can be saved or signed in for it.

## The kit

A plugin is handed `ctx.http`, a client the host makes for each sign-in or read, locked to the plugin's manifest. `kit/index.ts` exports the `BrokerHttp` type and never `createBrokerHttp`, the factory that makes a client for whatever hosts it is given, and neither does the package (`test/exports.test.ts`).

Inside `src/plugins/**`, ESLint refuses the following, each with the message that a plugin reaches the network only through `ctx.http`. It matches an import path as written and does not resolve it, so a path written to get round a rule is for review to catch.

- **Imports are an allow-list.** A plugin imports relative modules and `@maester/contracts`, and nothing else: every other package and every Node module is refused, with or without the `node:` prefix, whether or not it is named (`node:http2`, `dns` and `worker_threads` as much as `node:https`). `http`, `https`, `net`, `tls`, `fs`, `fs/promises`, `child_process` (each with and without `node:`) and `undici` are also named, for a clearer message.
- **Three relative imports are refused.** `kit/http`, where the factory lives; `host`; and an `index` reached by `..` (the package's own, or the plugin list). The host's functions make a client from whatever manifest they are handed, and the package's index exports them.
- **The factory by name.** Importing `createBrokerHttp` is refused from any module.
- **Globals.** `fetch`, `XMLHttpRequest`, `WebSocket`, `process`, `globalThis` and `global`.
- **Syntax.** A dynamic `import()`, a call to `require`, and any member of `globalThis` (`globalThis.fetch`, `globalThis["process"]`).

`test/lint.test.ts` lints inline code, not a fixture file, and fails if any of these stops being refused inside a plugin. It also lints the real plugins and expects nothing, and checks that the same code is left alone outside `src/plugins/`.

The rest is convention, held by the shape of the contract, the conformance suite and review, not by lint: among relative imports, a plugin imports only from `src/kit/index.ts`, from `src/plugin.ts` (the contract's types) and from its own folder; and a plugin makes no call that writes.

- **`http`:** `BrokerHttp` has `get(url, { headers })` and `post(url, { headers, form | json })`, and answers with the parsed JSON of a 200. The host makes one for each sign-in or read, bound to the manifest.
  - A URL must be https on one of `manifest.hosts`, or the call throws `BROKER_UNAVAILABLE` before anything is sent.
  - One request per call. A redirect is an error (`redirect: "error"`), and a call times out after 20 seconds.
  - A failure says nothing of the request: the message never carries the URL, a key or what the broker said.
  - A status in `signedOutStatuses`, or a 400, is `BROKER_REFUSED` while signing in; a status in `signedOutStatuses` is `BROKER_SIGNED_OUT` while reading. Any other status but 200 is `BROKER_UNAVAILABLE`, and a body that is not JSON is `BROKER_ANSWER_UNREADABLE`.
- **`values`:** `at(value, "data.user_id")` reads a dotted path. `text(value, field)` gives a non-empty trimmed string. `decimal(value, field)` gives a decimal string and keeps the digits JSON printed, so an exponent or anything that is not a number is refused. `sha256hex(...parts)` hashes its parts joined with nothing between them.
- **`expiry`:** `sessionExpiry({ kind: "daily", at, timeZone } | { kind: "hours", hours }, signedInAt)` says when a sign-in stops working.
- **Errors:** `BrokerError(code, message)` has exactly four codes: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED` and `BROKER_ANSWER_UNREADABLE`. A plugin throws one when an answer has the wrong shape.

A GET with a body is not in the kit. A broker that needs one adds it, with its own test.

## What the host enforces

The host holds these rules, not the plugin, and a test checks each one.

- A plugin reaches only its own hosts, over https, on the default port, with no user name or password in the address. `ctx.http` checks every address it is given (`isBrokerAddress`), a plugin is never given the factory that makes a client, ESLint holds the imports, globals and syntax listed under The kit, and the host checks the address `loginUrl()` returns the same way before it goes to the browser.
- Credentials and tokens stay with the host. It decrypts them and passes them in `ctx`, and it encrypts and keeps the session a plugin returns, once it has checked it: a non-empty token, an account that is text or null, a sign-in time and an expiry that are real times, and an expiry after the sign-in. Anything else is `BROKER_ANSWER_UNREADABLE`, and the host keeps those four fields and nothing else. A plugin stores nothing.
- A broker's own error text is never logged or passed on. Anything a plugin throws that is not a `BrokerError` becomes `BROKER_UNAVAILABLE` with a fixed message, and the API logs the broker id and the error code only.
- Figures stay decimal strings, exactly as printed. The host parses every line with `BrokerHoldingLine`, so a figure that is not a decimal string makes the read `BROKER_ANSWER_UNREADABLE`, and so does the same (ISIN, exchange) twice.
- A plugin computes no figure. Quantity plus T+1, cost, value and gain stay in `@maester/financial-engine`. This one is a review rule: a plugin returns what the broker printed.
- Every sign-in return matches a sign-in the same person started. The host makes the single-use `state` (10 minutes) and takes it on return, so a return with no state, an unknown one or another person's is refused.
- A token in a return address is not logged. The return route logs only the broker id and an error code.

## Adding a broker

1. Read the broker's own docs and record what they say, with [off], [staff], [3p] and [?] marks, in `docs/research/`.
2. Copy `src/plugins/kite/` to `src/plugins/<id>/`. Write `manifest.ts`: hosts, saved fields, copy (DESIGN.md §7) and `signedOutStatuses`.
3. Write `plugin.ts`: `loginUrl`, `readReturn`, `complete` and `reads.holdings`. Use only the kit. Return figures with `decimal()`. Compute nothing, and make no call that writes.
4. Record the answers in `test/plugins/<id>/fixtures/`, with every key, token and account ID replaced.
5. Write `test/plugins/<id>/<id>.test.ts`: `runConformance(plugin, fixtures)` plus the broker's own cases.
6. Add the plugin to `src/plugins/index.ts`.
7. List below what a live run must confirm, and keep `enabled: false` if something the host needs, such as `state`, is unknown.

It needs no change in `apps/api`, `apps/web`, `packages/contracts` or `packages/db`. A pull request that adds a broker and touches them is either adding a sign-in strategy or a read capability, and says so.

## Kite (Zerodha)

Hosts: `kite.zerodha.com` and `api.kite.trade`. The investor saves the Kite Connect app's `apiKey` (shown by its last 4 characters) and `apiSecret`.

- **Login:** `https://kite.zerodha.com/connect/login?v=3&api_key=<apiKey>&redirect_params=<"state=" + nonce, URL-encoded>`. Zerodha sends the investor back with `request_token`, `state` and `status=success`.
- **Return:** a return with no `status` is a good one, because Zerodha adds it only to say how a sign-in ended. Any other status, or no `request_token`, is a refusal.
- **Session:** `POST https://api.kite.trade/session/token`, header `X-Kite-Version: 3`, form `api_key`, `request_token` and `checksum`, which is `sha256hex(apiKey, request_token, apiSecret)`. The secret is hashed and never sent. The token is `data.access_token` and the account is `data.user_id`.
- **Holdings:** `GET https://api.kite.trade/portfolio/holdings`, headers `X-Kite-Version: 3` and `Authorization: token <apiKey>:<accessToken>`. The list is `data`; each item gives `isin`, `tradingsymbol`, `exchange`, `quantity`, `t1_quantity`, `average_price` and `last_price`.
- **Expiry:** a session stops at 06:00 Asia/Kolkata each day, so "signed out" is an ordinary state. A 403 means Zerodha signed Maester out (`signedOutStatuses` is `[403]`).
- **Absent figures:** an absent or null `t1_quantity` is `"0"` (none pending). An absent or null `average_price` is `"0"`, so one such line does not fail the whole read. The engine reads an average of `"0"` as an unknown cost (`NO_COST`): the holding's invested, P&L and P&L % show "—", while its value (quantity × the close) still shows. The broker line's average-cost column still shows "₹0.00" today, a known follow-up. A present figure that is not a decimal still fails it. An absent or null `last_price` is null.
- **Not yet confirmed on a live run:** no live run has happened. The first one should compare quantity, T+1 and average price on the Holdings page with Zerodha's own app, and confirm that a good return arrives with the shape the fixtures record.

## Angel One (SmartAPI)

Hosts: `smartapi.angelone.in` and `apiconnect.angelone.in`. The investor saves the SmartAPI app's `apiKey` (shown by its last 4 characters). There is no secret key: the publisher login needs only the key. Design: [Angel One plugin design](../../docs/superpowers/specs/2026-10-27-angel-one-plugin-design.md).

- **Login:** `https://smartapi.angelone.in/publisher-login?api_key=<apiKey>&state=<nonce>`, each value URL-encoded. The return address is not sent. The investor pastes it into the SmartAPI app's redirect URL, as with Kite. The investor types no MPIN or TOTP, and Maester keeps no TOTP seed.
- **Return:** `state` is the query's `state`, or `null` when it is missing or empty, and the host refuses a return with no `state`. A non-empty `auth_token` is a good return. Anything else is a refusal. `feed_token` and `refresh_token` are not read: Maester streams nothing and does not renew a session.
- **Session:** one `GET https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile` checks the token. The account is `data.clientcode`. The token is the `auth_token` as it came back. No exchange step is made.
- **Holdings:** `GET https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding`. The list is `data`; each item gives `isin`, `exchange`, `tradingsymbol` (else `tradingSymbol`), `quantity`, `t1quantity`, `averageprice` and `ltp`. Nothing else is read, and nothing is worked out. `getAllHolding` is not called.
- **Answers:** SmartAPI can answer HTTP 200 with a failure inside, in one of two envelopes. A good answer is `{ status, message, errorcode, data }`. The token error is `{ success: false, message, errorCode, data }`. `answer()` (`answer.ts`) checks both flags and both spellings of the code, for every call.
  - `status` or `success` is `false` with `AG8001`, `AG8002` or `AG8003`: `BROKER_SIGNED_OUT` while reading, `BROKER_REFUSED` while signing in.
  - Any other code, or none: `BROKER_UNAVAILABLE`.
  - Neither flag is `true`, or the answer is not an object: `BROKER_ANSWER_UNREADABLE`.
  - Angel One's own `message` is never put in an error, and a code is repeated only if it looks like one (two capitals and four digits).
  - HTTP 401 and 403 are `signedOutStatuses` (`[401, 403]`), so the kit turns them into the same two errors.
- **Expiry:** Angel One signs Maester out every night at midnight. A session stops at 00:00 Asia/Kolkata, and a sign-in just after midnight lasts until the next one.
- **Symbols:** Angel One prints an NSE share as `SBIN-EQ`. Maester looks closes up by NSE symbol, so on `NSE` a trailing `-EQ` is removed. Any other suffix (`-BE`, `-SM`) stays, so that share finds no NSE close and shows "—", never another share's close. On `BSE` nothing changes.
- **Headers:** every call sends `Authorization: Bearer <accessToken>`, `X-PrivateKey` (the API key), `X-UserType: USER`, `X-SourceID: WEB`, `Accept` and `Content-Type: application/json`. `X-ClientLocalIP`, `X-ClientPublicIP` and `X-MACAddress` are left out: Maester cannot know the server's addresses through the kit and does not make them up. Angel One's own Python SDK sends the same two fixed addresses for every user, so if a live run is refused without the headers, the fallback is to send those fixed values (and a fixed MAC) as named constants, with this reason beside them.
- **Absent figures:** an absent or null `t1quantity` is `"0"`. An absent or null `averageprice` is `"0"`, which the engine reads as an unknown cost (`NO_COST`), as for Kite. An absent or null `ltp` is null. Figures can arrive as JSON numbers or as strings, and both are read. A `null` symbol, or a `quantity` or other figure that is present but not a decimal, fails the whole read.
- **No holdings:** `data: []` is an account with no holdings. Any other shape, `null` included, is `BROKER_ANSWER_UNREADABLE`, because "no holdings" is a figure and is said only for the shape known to mean it.
- **Switched off:** `enabled` is `false`, with the reason "Not offered until Maester has tried a live Angel One sign-in." The Holdings page lists Angel One as not offered, and nothing can be saved or signed in for it. Two things the host needs are unknown: whether `state` comes back, which is the safety check, and whether `quantity` already includes `t1quantity`, because if it does, adding them counts a holding twice just after a purchase.

### Live run owed

No live run has happened. It needs Maester's return address on a public https host, because SmartAPI refuses a localhost redirect URL. `enabled: false` also blocks saving a key, so the run starts by switching it on in a local build.

0. Switch `enabled` to `true` in a local build only.
1. `state` comes back unchanged.
2. A SmartAPI app made under the current "New Login" can use the publisher login (a third-party post says it cannot). If not, record which app type works.
3. `auth_token` works as the bearer token on `getProfile` and `getHolding` with no exchange, and has no `Bearer ` prefix of its own.
4. `getProfile` gives the client code at `data.clientcode`.
5. What `getHolding` returns for an account with no holdings (`[]`, `null`, or an error).
6. Whether `quantity` already includes `t1quantity`. If it does, `t1Quantity` becomes `"0"`.
7. The `-EQ` suffix, and which other series suffixes appear on NSE.
8. An expired token: its HTTP status, its envelope (`status` or `success`) and its code.
9. `getProfile` and `getHolding` work without the three `X-Client*` headers.
10. The `exp` inside the `auth_token` JWT: if it is earlier than midnight, the session ends at the earlier of the two.
11. Whether any holding still comes back with a `null` `tradingsymbol`.
12. After the run: the tunnel's request log holds the return URL, and with it a token that can trade until midnight. Clear the log, or sign out of SmartAPI.

The outcome is one of three:

- **Everything holds:** `enabled: true`, `notOfferedReason` removed, and the research note's [?] marks updated.
- **`state` does not come back:** `enabled` stays `false` with the reason "Angel One’s sign-in page doesn’t send back the check Maester needs" (research note §2). A typed MPIN and TOTP sign-in would be a new strategy with its own design.
- **Anything else differs:** fix the plugin and its fixtures, then decide.
