# @maester/brokers

Brokers are plugins. Each one is a folder of TypeScript in `src/plugins/`, compiled into the API: a manifest (what the Holdings page says and asks for) and the code that signs in and reads holdings. A plugin can sign in and read, and nothing else. There is no way to place an order or move money.

Design: [broker plugins](../../docs/superpowers/specs/2026-10-27-broker-plugins-design.md) and [ADR 0009](../../docs/decisions/0009-broker-plugins.md). Zerodha (Kite Connect) is the one plugin for now.

## Layout

```
src/
  index.ts          the package's exports
  plugin.ts         the BrokerPlugin contract
  registry.ts       builds the registry from plugins/index.ts and checks it
  host.ts           what the API calls: loginUrlFor, completeSignIn, readHoldings, toBrokerError
  errors.ts         BrokerError and its four codes
  kit/              the only thing a plugin may import: http.ts, values.ts, expiry.ts
  plugins/
    index.ts        the list of plugins, and defaultRegistry()
    kite/           manifest.ts and plugin.ts
test/
  conformance.ts    runConformance(plugin, fixtures), the suite every plugin runs
  fake-plugin.ts    a test-only broker on broker.test, exported as @maester/brokers/testing
  kit/              tests of the kit
  plugins/kite/     kite.test.ts and fixtures/, the recorded answers
```

Tests and fixtures sit under `test/`, so they stay out of the build and outside the lint rule that applies to `src/plugins/`.

## The plugin contract

A `BrokerPlugin` (`src/plugin.ts`) has three parts:

- **`manifest`:** a `BrokerManifest` (`packages/contracts/src/brokers.ts`). It holds `id`, `name`, `enabled` and `notOfferedReason`; `hosts`, every host the login page and any call may reach; `copy`, what the page says; `credentials`, the fields the investor types in, with `credentialShown` naming the one whose last 4 characters are shown; `signIn`; and `signedOutStatuses`, the statuses that mean the broker signed Maester out. The API serves it, as a `BrokerSummary`, at `/v1/brokers`, so the web has no broker list of its own and never imports this package. It holds no call.
- **`signIn`:** one strategy today, `redirect`: the investor saves a key, signs in on the broker's own page, and comes back with a code or a token. A plugin gives `loginUrl({ creds, state, returnUrl })`, `readReturn(query)`, which says what the broker sent back and whether the investor turned it down, and `complete({ creds, payload, returnUrl, http, now })`, which turns the return into a `BrokerSession` (the token, the account it belongs to, when it was made and when it stops working). `signIn.kind` must equal `manifest.signIn.kind`.
- **`reads.holdings(ctx)`:** the holdings, as `BrokerHoldingLine`s. `ctx` holds the saved fields, the session the host decrypted, an `http` locked to the broker, and `now`. Later reads (funds, positions, SIPs) would be optional members here, each with its own output schema, and a change in the host and the web as well.

The registry (`createRegistry`, `defaultRegistry`) is built when the API starts. It parses every manifest, and refuses a repeated id, a `credentialShown` that is not a credential, two credentials with one key, and a `signIn.kind` that differs between manifest and plugin. A bad plugin stops the API with its id and the reason (`RegistryError`). A plugin with `enabled: false` is listed as not offered, and nothing can be saved or signed in for it.

## The kit

A plugin imports only from `src/kit/`, from `@maester/contracts` (types) and from its own folder. ESLint enforces it on `src/plugins/**`: no `fetch`, `XMLHttpRequest`, `WebSocket` or `process`, and no `node:http`, `node:https`, `node:net`, `node:tls`, `node:fs`, `node:child_process`, `undici` or their short names. A test lints a fixture that must fail, so the rule cannot be dropped quietly.

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

- A plugin reaches only its own hosts, over https. `ctx.http` is its only way out, and the host checks the address `loginUrl()` returns before it goes to the browser.
- Credentials and tokens stay with the host. It decrypts them and passes them in `ctx`, and it encrypts and keeps the session a plugin returns. A plugin stores nothing.
- A broker's own error text is never logged or passed on. Anything a plugin throws that is not a `BrokerError` becomes `BROKER_UNAVAILABLE` with a fixed message, and only the code is logged.
- Figures stay decimal strings, exactly as printed. The host parses every line with `BrokerHoldingLine`, so a figure that is not a decimal string makes the read `BROKER_ANSWER_UNREADABLE`, and so does the same (ISIN, exchange) twice.
- A plugin computes no figure. Quantity plus T+1, cost, value and gain stay in `@maester/financial-engine`. This one is a review rule: a plugin returns what the broker printed.
- Every sign-in return matches a sign-in the same person started. The host makes the single-use `state` (10 minutes) and takes it on return, so a return with no state, an unknown one or another person's is refused.
- A token in a return address is not logged. The return route logs only the broker id and an error code.

## Adding a broker

1. Read the broker's own docs and record what they say, with [off], [staff], [3p] and [?] marks, in `docs/research/`.
2. Copy `src/plugins/kite/` to `src/plugins/<id>/`. Write `manifest.ts`: hosts, saved fields, copy (DESIGN.md §7) and `signedOutStatuses`.
3. Write `plugin.ts`: `loginUrl`, `readReturn`, `complete` and `reads.holdings`. Use only the kit. Return figures with `decimal()`. Compute nothing.
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
- **Absent figures:** an absent `t1_quantity` is `"0"` (none pending). An absent `average_price` is `"0"`, which the engine reads as an unknown cost (`NO_COST`), so it shows as unknown, not zero, and one such line does not fail the whole read. A present figure that is not a decimal still fails it. An absent `last_price` is null.
- **Not yet confirmed on a live run:** no live run has happened. The first one should compare quantity, T+1 and average price on the Holdings page with Zerodha's own app, and confirm that a good return arrives with the shape the fixtures record.
