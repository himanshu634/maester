# Broker plugins: design

Status: draft for review, 27 October 2026. The decision is [ADR 0009](../../decisions/0009-broker-plugins.md).

This design replaces how a broker is described. Until now that was "a broker is one JSON definition", from the [broker connections plan](../plans/2026-10-19-broker-connections.md) and the [broker accounts plan](../plans/2026-10-24-broker-accounts.md). The Holdings screen ("D · final, one person") does not change. The broker facts are in [`docs/research/2026-10-24-broker-accounts.md`](../../research/2026-10-24-broker-accounts.md). Angel One's are in [`docs/research/2026-10-27-angel-one-publisher-login.md`](../../research/2026-10-27-angel-one-publisher-login.md).

**Depends on** `origin/staging` getting the migration that creates the broker tables: `broker_connection`, `broker_login_state`, `holding_read` and `holding_line`.

- The broker code merged in #30, but staging's migrations stop at `0008_xbrl`.
- The migration exists only as an untracked `0009_broker_holdings.sql` in a local checkout. It has to land on staging before this build.
- If it lands as `0009`, this design's "no schema change" (§11) still holds.

## 1. Goal

Maester reads holdings from one broker, Zerodha (Kite Connect), through a plugin. A plugin is one folder of typed code that the API loads through one registry.

A new broker is one more folder and one more line in the registry; routes, contracts, the web and the database do not change for it. Angel One is the next plugin, designed and built in a session of its own. This design checks that its known needs fit the contract (§12.2).

## 2. What is decided, and by whom

The user decided these points on 27 October 2026:

- Keep Kite and Angel One, and remove Dhan, Upstox, Groww and ICICI Direct as Holdings brokers.
- For now, support Kite only. Angel One is worked on in another session.
- Brokers are plugins, and adding one must be as easy as possible. The design follows the open/closed principle.
- Angel One will sign in through its publisher-login redirect, the way Zerodha does (recorded for that session).
- The design in this document, which was presented in chat and approved.

These points are the designer's call:

- The package layout.
- The plugin contract.
- The host toolkit.
- The conformance suite.
- The fake plugin that proves the routes depend on no broker (§14.3).

## 3. Goals, non-goals, anti-goals

**Goals**

- A broker that uses an existing sign-in strategy is added with one folder, one registry line and recorded fixtures. It needs no change to `apps/api`, `apps/web`, `packages/contracts` or `packages/db`.
- Every safety rule that the JSON vocabulary used to make impossible is now enforced by the host and checked by a test (§6).
- Kite behaves exactly as it does today: same calls, same expiry, same errors.
- Angel One's known needs fit the contract without a host change (§12.2), so its session adds only a plugin.

**Non-goals**

- No Angel One plugin here.
- No new reads. Funds, positions, SIPs and mutual funds are not built. Read capabilities have a slot for them (§8.1).
- No new sign-in strategy. Kite uses `redirect`.
- No change to the Holdings screen, its copy rules or the holdings calculations in `@maester/financial-engine`.
- No migration. No row for a removed broker is rewritten (§11).

**Anti-goals**

- A plugin never gets a way to place an order, move money or call a host its manifest does not name.
- No plugin is loaded at runtime from a folder or a package the operator drops in. Plugins are compiled into the API.
- A plugin never computes a figure. It returns facts as the broker printed them, and the engine does the arithmetic.

## 4. Why the JSON vocabulary is replaced

`packages/brokers` today interprets one JSON file per broker with a fixed vocabulary. Every broker after Zerodha needed new words in that vocabulary:

| Broker | What it added to the shared interpreter |
| --- | --- |
| Dhan | `settings-connection` sign-in; a list at the root of the answer |
| Upstox | `{returnUrl}` in the login page and the session call |
| Groww | `direct` sign-in; JSON bodies; `{timestamp}`; `exchangeIs` |
| ICICI Direct | GET with a body over `node:https`; `{isoTimestamp}`; `{body}` signing; `join` |

So the interpreter was never closed to change. Each broker reopened it, and every change risked the brokers that already worked. Angel One, the next broker, would add two more words:

- **A return that carries the token.** The broker sends the access token back in the query, with no code to exchange.
- **A success status with an error inside.** Angel One answers HTTP 200 with `status: false` and an error code.

A plugin states this kind of difference in a few lines of code that only it runs. The safety the vocabulary gave ("a definition cannot describe an order") moves to the host. The host gives a plugin only a host-locked HTTP client and a contract that has no write operation.

## 5. Architecture

### 5.1 Layout

```
packages/brokers/
  src/
    index.ts          exports the registry, the contract types and BrokerError
    plugin.ts         the BrokerPlugin contract (§5.3)
    registry.ts       builds the registry from plugins/index.ts and checks it (§5.4)
    kit/              what a plugin may import (§5.5)
      http.ts         the host-locked HTTP client
      values.ts       at(), text(), decimal(), sha256hex()
      expiry.ts       sessionExpiry() (moved from src/expiry.ts, unchanged)
    plugins/
      index.ts        export const plugins = [kite] as const;
      kite/
        manifest.ts   data: name, copy, hosts, fields, sign-in kind
        plugin.ts     the sign-in and the holdings read
  test/
    conformance.ts    the suite every plugin runs (§14.1)
    registry.test.ts
    plugins/
      kite/
        fixtures/     recorded answers (holdings, session, errors)
        kite.test.ts
```

Tests and fixtures live under `test/`, where `vitest.config.ts` already looks (`test/**/*.test.ts`). This keeps the fixtures out of the build, and keeps the tests outside the lint rule for `src/plugins/**` (§5.5), because a test needs to stub `fetch` and read files.

The following are deleted:

- `definitions/*.json`, `src/built-in.ts`, `src/definitions.ts`, `src/template.ts` and `src/client.ts`;
- `loadDefinitions`, `parseDefinition` and `checkDefinition`;
- the `BROKER_DEFINITIONS_DIR` setting.

### 5.2 How the parts depend on each other

```
apps/api routes ──► registry ──► plugin.signIn / plugin.reads
       │                              │
       │ makes ctx.http per call      └──► kit (http, values, expiry)
       ▼
 encryption, broker_connection, holding_read, login state (host only)
```

`apps/web` sees only `BrokerSummary` from `GET /v1/brokers`, which is built from each manifest. It never imports `@maester/brokers`.

### 5.3 The plugin contract

```ts
/** What a plugin returns for one holding. Every figure is a decimal string exactly as the broker printed it. */
type BrokerHoldingLine = {
  isin: string; symbol: string; exchange: string;
  quantity: string; t1Quantity: string; averagePrice: string; lastPrice: string | null;
};

type Credentials = Record<string, string>;                        // the saved fields, by manifest key
type BrokerSession = { accessToken: string; accountId: string | null; signedInAt: Date; expiresAt: Date };

/** The one strategy today: save a key, sign in on the broker's page, come back with a code or a token. */
type RedirectSignIn = {
  kind: "redirect";
  /** The broker's login page. It must be https on one of the manifest's hosts; the host checks. */
  loginUrl(ctx: { creds: Credentials; state: string; returnUrl: string }): string;
  /** Reads the broker's return. `state` is null when the broker sent none; the host then refuses the return. */
  readReturn(query: Record<string, string | undefined>):
    | { state: string | null; payload: Record<string, string> }
    | { state: string | null; refused: true };
  /** Turns the return into a session, with whatever calls the broker needs. */
  complete(ctx: { creds: Credentials; payload: Record<string, string>; returnUrl: string; http: BrokerHttp; now: Date }): Promise<BrokerSession>;
};

type ReadCtx = { creds: Credentials; session: { accessToken: string; accountId: string | null }; http: BrokerHttp; now: Date };

type BrokerPlugin = {
  manifest: BrokerManifest;
  signIn: RedirectSignIn;                 // a union of strategies; one member today
  reads: {
    holdings(ctx: ReadCtx): Promise<BrokerHoldingLine[]>;
    // Later reads (funds, positions, SIPs) are optional members added here, each with its own output schema.
  };
};
```

`BrokerManifest` is a zod schema in `packages/contracts/src/brokers.ts`, which replaces `BrokerDefinition`:

```ts
BrokerManifest = z.object({
  id: BrokerId,
  name: z.string().min(1).max(40),
  enabled: z.boolean(),
  notOfferedReason: z.string().max(200).optional(),
  hosts: z.array(Host).min(1).max(8),            // every host the login page and any call may reach
  copy: BrokerCopy,                              // pickerLine, lasts, cost, formLede, steps, saveNote, signedOutNote (as today)
  credentials: z.array(BrokerCredentialField).min(1).max(4),
  credentialShown: z.string(),                   // must name a credential
  signIn: z.discriminatedUnion("kind", [z.object({ kind: z.literal("redirect") })]),
  signedOutStatuses: z.array(HttpStatus).default([401, 403]),
});
```

The manifest holds data the web and the host need without running the plugin. The plugin holds behaviour. `signIn.kind` appears in both places, and the registry checks that they agree.

### 5.4 The registry

`registry.ts` builds a `BrokerRegistry`, a map from id to plugin, from `plugins/index.ts`. When the API starts, the registry:

1. parses every manifest with `BrokerManifest`;
2. fails if two plugins share an id, if `credentialShown` is not a credential, if two credentials share a key, if `manifest.signIn.kind !== plugin.signIn.kind`, or if a host is not a bare lower-case host name;
3. freezes the result.

A failure stops the API with the plugin's id and the reason, as a bad definition does today. A plugin that should not be offered sets `enabled: false` and a `notOfferedReason`. It is then listed as not offered and nothing can be saved for it, as today.

`AppDeps.brokerDefinitions` becomes `AppDeps.brokerRegistry?: BrokerRegistry`. Tests inject a registry that holds a fake plugin (§14.3).

### 5.5 The kit

A plugin may import only from `./kit`, from `@maester/contracts` (types) and from its own folder. ESLint enforces this with `no-restricted-imports` and `no-restricted-globals` on `src/plugins/**`. It forbids:

- the global `fetch`, `XMLHttpRequest` and `WebSocket`;
- `node:http`, `node:https`, `node:net`, `node:tls`, `node:fs`, `node:child_process` and `undici`;
- `process.env`.

**`BrokerHttp`** (`kit/http.ts`). The host makes one for each sign-in or read, bound to the plugin's manifest:

```ts
type BrokerHttp = {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<unknown>;
  post(url: string, init: { headers?: Record<string, string>; form?: Record<string, string>; json?: unknown }): Promise<unknown>;
};
```

It keeps the behaviour of today's `BrokerClient.call`:

- **Allowed URLs.** A URL must be https on one of `manifest.hosts`. Any other URL throws `BROKER_UNAVAILABLE` before anything is sent.
- **One request per call.** Redirects are an error (`redirect: "error"`), and every request has a 20-second timeout.
- **Failures say nothing about the request.** A network failure is `BROKER_UNAVAILABLE`, and the message never carries the URL, because a URL can carry a key.
- **Statuses, while signing in.** A status in `signedOutStatuses`, or a 400, is `BROKER_REFUSED`.
- **Statuses, while reading.** A status in `signedOutStatuses` is `BROKER_SIGNED_OUT`.
- **Other answers.** Any status other than 200 is `BROKER_UNAVAILABLE`, and a body that is not JSON is `BROKER_ANSWER_UNREADABLE`.
- **The answer.** It returns the parsed JSON. A plugin checks the shape itself and throws `BrokerError` when the shape is wrong.

GET with a body (`httpsGetWithBody`) is not carried over, because only ICICI Direct used it. A future broker that needs it adds it to the kit with its own test.

**Values** (`kit/values.ts`):

- `at(value, "data.user_id")` reads a dotted path.
- `text(v, field)` returns a non-empty trimmed string, or throws `BROKER_ANSWER_UNREADABLE`.
- `decimal(v, field)` turns a JSON number or string into a decimal string. A number keeps the digits JSON printed, and an exponent or anything that is not a number is refused. This is today's `decimal`, unchanged.
- `sha256hex(...parts)` joins its parts with nothing between them and hashes them.

**Expiry** (`kit/expiry.ts`): `sessionExpiry({ kind: "daily", at, timeZone } | { kind: "hours", hours }, signedInAt)`, unchanged.

## 6. Invariants the host enforces

The JSON format used to make these rules impossible to break. The host now enforces each one, and a test checks it.

| Invariant | How it is enforced | Test |
| --- | --- | --- |
| A plugin cannot place an order or move money | The contract has only `signIn` and `reads`, and the API has no route that writes to a broker | Contract type and route list in `apps/api/test/brokers.test.ts` |
| A plugin reaches only its own hosts, over https | `ctx.http` is the only network access it gets. ESLint bans every other way out. `loginUrl()` output is checked by the host before it is returned | Conformance: a URL on another host or over http is refused before `fetch` is called. Lint rule |
| Credentials and tokens stay with the host | The host decrypts them and passes them in `ctx`. It encrypts and stores the session a plugin returns. A plugin never stores anything | Conformance: `fetch` sees the token only in the request the plugin builds |
| A broker's own error text is never logged or passed on | A plugin throws `BrokerError` with a code. The host turns anything else into `BROKER_UNAVAILABLE` and logs the code and the error's class name only | Conformance: a plugin that throws an `Error` carrying a secret logs no secret |
| Figures stay decimal strings, exactly as printed | The host parses every line a plugin returns with `BrokerHoldingLine` (zod, `DecimalString` for each figure). A line that fails makes the read `BROKER_ANSWER_UNREADABLE` | Conformance: a float with an exponent, or `NaN`, fails the read |
| A plugin computes no figure | Quantity plus T+1, cost, value and gain stay in `@maester/financial-engine`. Review rule, written in the README's "Adding a broker" | Fixture tests compare a plugin's lines with the broker's printed values |
| Every sign-in return matches a sign-in the same person started | The host makes the single-use `state` nonce (10 minutes), takes it on return and checks the user. A return with no state, or a state that does not match, is `SIGN_IN_EXPIRED` | Route test with a fake plugin whose return has no state |
| A token in a return URL is not logged | nginx already turns off the access log for `/v1/` (`apps/web/nginx.conf.template`), and the API logs no request lines. The return route logs only the broker id and an error code | Route test: the logger receives no query value |

## 7. Sign-in

The flow is today's redirect flow, with the broker's part in the plugin:

1. `POST /v1/workspaces/:ws/brokers/:broker/sign-in`. The host decrypts the saved credentials and makes a nonce, then calls `plugin.signIn.loginUrl({ creds, state, returnUrl })`. It checks that the URL is https on a manifest host and returns `{ url }`.
2. The investor signs in on the broker's page. The broker sends them to `GET /v1/brokers/:broker/return?…`.
3. The host calls `readReturn(query)`, then takes the nonce. It refuses the return when the state is missing, unknown, expired or another user's (`SIGN_IN_EXPIRED`). It refuses it when the plugin says the broker refused (`SIGN_IN_CANCELLED`).
4. The host calls `complete({ creds, payload, returnUrl, http, now })`. Kite exchanges `request_token` for a session. A broker whose return carries the token itself, such as Angel One, would check it with one call instead. The contract allows both.
5. The host encrypts and saves the session, reads the holdings once, and sends the browser to `/terminal/holdings?broker=…&signedIn=1`, or `&error=CODE` on failure.

A new strategy, such as a prompt for an MPIN and a TOTP, would be a new member of the `signIn` union. It would need host routes, `BrokerSummary.signIn` and the web together, and a design round for its screen. That is the one change here that is not "add a folder". A strategy is shared by many brokers, so this should be rare.

## 8. Reads

### 8.1 Capabilities

`reads.holdings` is required. Later reads are optional members of `reads`, each with its own output schema in `@maester/contracts`. The host calls one only when a plugin has it. Adding one is a host and web change, because the screen must show it. A broker that later supports an existing read adds only code to its own plugin. Nothing beyond holdings is built now.

### 8.2 Holdings

`POST /v1/workspaces/:ws/brokers/:broker/read` and the read after sign-in both call `plugin.reads.holdings(ctx)`. The host:

1. starts a `holding_read`;
2. validates the lines it gets back (§6);
3. keeps them, or keeps the error code;
4. clears or sets the account's error, as `readHoldings` does today.

The 10-second gap between reads stays.

### 8.3 Errors

The four codes are unchanged: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED` and `BROKER_ANSWER_UNREADABLE`. A plugin may throw any of them. The kit throws them for transport failures, and the host maps any other error to `BROKER_UNAVAILABLE`.

## 9. API

`apps/api/src/routes/brokers.ts` keeps its routes and loses everything that served the removed brokers:

| Route | Change |
| --- | --- |
| `GET /v1/brokers` | Built from the registry: `summary(manifest)` |
| `GET /v1/brokers/:broker/return` | Calls `readReturn` and `complete` (§7) |
| `PUT /v1/workspaces/:ws/brokers/:broker` | Validates fields from the manifest, as today. The `settings-connection` branch goes |
| `POST …/:broker/sign-in` | Calls `loginUrl` and checks its host |
| `POST …/:broker/session` | **Removed**: it served Groww's `direct` sign-in only |
| `POST …/:broker/read` | Calls `reads.holdings` |
| `DELETE …/:broker` | Unchanged |
| `GET /v1/workspaces/:ws/holdings` | Unchanged, apart from reading the registry |

These helpers are removed: `connectionOf`, `settingsConnections`, `settingsState`, the settings branch of `accountOf` and `readHoldings`, and `brokerDefinitions()`. `accountOf` keeps only the redirect states: `saved`, `signed_in`, `signed_out` and `failing`.

## 10. Contracts and web

**Contracts** (`packages/contracts/src/brokers.ts`):

- **Replaced:** `BrokerDefinition` becomes `BrokerManifest` (§5.3).
- **Removed:** `SettingsConnectionProvider`, the `direct` and `settings-connection` members of `BrokerSignIn`, `Call`, `BrokerDerivedValue`, `BrokerHoldingFields` and the `join` and `exchangeIs` terms.
- **`BrokerSummary.signIn`** becomes a union with one member, `{ kind: "redirect" }`. A later strategy then adds a member without changing the shape. `returnUrl` stays nullable for the same reason.
- **Unchanged:** `BrokerAccount`, `HoldingsSnapshot` and every holding type.
- **`BrokerHoldingLine`** moves here as a zod schema, so the host can validate plugin output.

**Web** (`apps/web/src/lib/holdings/`, `lib/content/holdings.ts`, `components/holdings/`). The web already renders what `BrokerSummary` says, so it only loses branches:

- **`view.ts`:** `settingsProvider` goes. `accountAction` returns `'sign_in' | 'read'`. The Settings branches of `stateDetail` and `staleNote` go.
- **`client.ts`:** `session()` goes.
- **`types.ts`:** the `direct` and `settings-connection` members go.
- **`content/holdings.ts`:** `settings.providers` and the Groww and Dhan sentences go. The Dhan sentences that describe *closes* stay ("from your Dhan data"), because Dhan is still the Settings market-data connection.
- **Components:** `AddBroker`, `AccountsLedger` and `HoldingsNudge` lose their Settings and direct branches.
- **`view.test.ts`:** the Dhan and Groww fixtures go.

There is no new visible state and no mockup round. The picker lists one broker, and `AddBroker` already opens with the first offered broker chosen, so Kite's form shows straight away.

## 11. Database

There is no schema change. `broker_connection.broker` is free text.

A row whose broker is no longer in the registry is already left out of every list, by the filter `defs.has(row.broker)`, which becomes `registry.has(row.broker)`. Its encrypted credentials stay where they are and are never decrypted.

No live broker run has happened, so no such rows are expected. Rows that do exist can be removed by hand.

## 12. The plugins

### 12.1 Kite (Zerodha)

This is a straight port of `kite.json`, with the same behaviour:

| Part | Value |
| --- | --- |
| Hosts | `kite.zerodha.com`, `api.kite.trade` |
| Saved fields | `apiKey` (shown, not secret), `apiSecret` (secret) |
| Login | `https://kite.zerodha.com/connect/login?v=3&api_key=<apiKey>&redirect_params=<"state=" + nonce, URL-encoded>` |
| Return | `request_token`, `state`, `status=success`; any other status is refused |
| Complete | `POST https://api.kite.trade/session/token`, form `api_key`, `request_token`, `checksum = sha256hex(apiKey, request_token, apiSecret)`, header `X-Kite-Version: 3`. Token `data.access_token`, account `data.user_id` |
| Expiry | Daily at 06:00, Asia/Kolkata |
| Holdings | `GET https://api.kite.trade/portfolio/holdings`, headers `X-Kite-Version: 3`, `Authorization: token <apiKey>:<accessToken>`. List `data`. Fields `isin`, `tradingsymbol`, `exchange`, `quantity`, `t1_quantity`, `average_price`, `last_price` |
| Signed out | 403 |

The fixtures are the answers already recorded in `packages/brokers/test/brokers.test.ts`. The port is done when every Kite case there passes against the plugin.

### 12.2 Angel One fits the contract

Angel One is not built here. Its facts, its live-run checklist and the rule for a missing `state` are in [`docs/research/2026-10-27-angel-one-publisher-login.md`](../../research/2026-10-27-angel-one-publisher-login.md). The contract was checked against those facts, and each need maps onto it with no host change:

| Angel One's need | Where it goes |
| --- | --- |
| The publisher login, `smartapi.angelone.in/publisher-login?api_key=…&state=…` | `loginUrl()` |
| `auth_token` comes back in the query, with no code to exchange | `readReturn()` puts it in the payload. `complete()` checks it with one `getProfile` call through `ctx.http` |
| HTTP 200 with `status: false` and an error code | The plugin reads the parsed answer and throws `BrokerError` |
| NSE symbols carry the series (`SBIN-EQ`) | The plugin strips `-EQ` before it returns the line |
| A session until midnight | `sessionExpiry({ kind: "daily", at: "00:00", timeZone: "Asia/Kolkata" })` |
| `state` may not come back | The host already refuses such a return (§6), so a missing state fails safe |

## 13. Removed

**From `packages/brokers`:**

- the definitions: `definitions/dhan.json`, `upstox.json`, `groww.json`, `icici.json` and `kite.json` (Kite moves to its plugin);
- the old interpreter: `src/client.ts`, `definitions.ts`, `template.ts` and `built-in.ts`;
- their tests.

**Elsewhere:**

- **Contracts:** the vocabulary types listed in §10.
- **Settings:** `BROKER_DEFINITIONS_DIR`, in `apps/api/src/env.ts`, `.env.example` and the API test context.
- **API:** the `/session` route and the Settings-connection helpers (§9).
- **Web:** the branches listed in §10.

**Kept:**

- Dhan as the Settings market-data connection: `packages/market`, the worker's token renewal, the Nifty 500 closes, Market mood, `market_connection` and Settings.
- Kite's behaviour and its tests.
- Every holdings table and calculation.

## 14. Testing

### 14.1 Conformance suite

`packages/brokers/test/conformance.ts` exports `runConformance(plugin, fixtures)`. Each plugin's test file calls it with its recorded answers. It checks:

- the manifest parses, and the registry accepts the plugin;
- `loginUrl()` is https on a manifest host and carries the nonce, whether URL-encoded or inside a parameter;
- `readReturn()` gives back the state it was given, and treats a return without the broker's code or token as a refusal;
- every network call made during `complete()` and `reads.holdings()` goes through `ctx.http`, to a manifest host. The fake `fetch` refuses anything else, and the test fails if the plugin reaches the network another way;
- a status in `signedOutStatuses` during a read is `BROKER_SIGNED_OUT`, and during sign-in is `BROKER_REFUSED`;
- an answer of the wrong shape is `BROKER_ANSWER_UNREADABLE`, never a crash and never an empty list;
- every holding line passes `BrokerHoldingLine`, and the figures equal the strings printed in the fixture;
- no error message contains a credential, the token or the fixture's error text;
- the expiry matches the manifest's rule for a fixed sign-in time.

### 14.2 Per-plugin tests

- **Kite:** every Kite case from today's `brokers.test.ts`.

### 14.3 API

`apps/api/test/brokers.test.ts` runs against a registry that holds a **fake plugin**, a test-only broker on `broker.test`. This shows that the routes depend on no real broker. It covers:

- the sign-in, the return (no state, a wrong user, a refusal, a good return), reads, the 10-second gap and disconnect;
- the holdings snapshot;
- that the logger never receives a query value from the return route.

One case checks that Kite loads in the real registry. With one real broker, the fake plugin is what shows that the routes are generic: it signs in with a token in its return, as Angel One will, so a broker of that shape is already exercised.

### 14.4 Lint

The `src/plugins/**` restrictions from §5.5 have a fixture file that should fail lint, so the rule cannot be dropped quietly.

## 15. Adding a broker

The recipe the brokers README will carry:

1. Read the broker's own docs and record what they say, with [off], [staff], [3p] and [?] marks, in `docs/research/`.
2. Copy `src/plugins/kite/` to `src/plugins/<id>/`. Write `manifest.ts`: hosts, saved fields, copy (DESIGN.md §7) and `signedOutStatuses`.
3. Write `plugin.ts`: `loginUrl`, `readReturn`, `complete` and `reads.holdings`. Use only the kit. Return figures with `decimal()`. Compute nothing.
4. Record the answers in `test/plugins/<id>/fixtures/` with every key, token and account ID replaced.
5. Write `test/plugins/<id>/<id>.test.ts`: `runConformance(plugin, fixtures)` plus the broker's own cases.
6. Add the plugin to `plugins/index.ts`.
7. List what a live run must confirm in the README, and keep `enabled: false` if something the host needs, such as `state`, is unknown.

It needs no change in `apps/api`, `apps/web`, `packages/contracts` or `packages/db`. A pull request that adds a broker and touches them is either adding a strategy or a read capability, and says so.

## 16. Documents to change with the build

- **`packages/brokers/README.md`:** rewritten. Plugins, the kit, the invariants, the recipe in §15 and the Kite notes.
- **`docs/DESIGN.md`:**
  - §5: Accounts ledger, Holdings nudge and Add a broker lose Dhan's Settings sentences.
  - §10 Holdings: "A broker is a JSON definition the API loads…" becomes "A broker is a plugin in `packages/brokers/src/plugins/`…". Zerodha is the one broker for now.
- **`docs/systems/packages.md`:** the `@maester/brokers` row.
- **`.env.example` and `docs/DEVELOPMENT.md`:** `BROKER_DEFINITIONS_DIR` goes.
- **`docs/README.md`:** this spec and ADR 0009 are indexed (done with this spec).

## 17. Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| One real plugin shapes the contract | The second broker needs a host change after all | The contract was checked against Angel One's known needs (§12.2), and the API tests' fake plugin signs in the way Angel One will (§14.3) |
| No public https address yet | Kite's redirect cannot be tried live end to end | A deployment or a tunnel. Angel One has the same need, so one answer covers both |
| A plugin sneaks around the kit | Credentials reach a host the manifest does not name | Lint ban, the conformance suite's fake `fetch`, and review. Plugins are compiled in, so a plugin is code review's job, as definitions were ("treat the definitions folder as code") |
| Code plugins make brokers harder to add than JSON | Fewer brokers | A plugin for a Kite-like broker is about 80 lines with the kit. The recipe and the conformance suite carry the rules a reviewer would otherwise hold in their head |
