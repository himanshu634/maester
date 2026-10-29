# Angel One broker plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Angel One (SmartAPI) as the second Holdings broker plugin, registered but switched off (`enabled: false`) until a live run.

**Architecture:** One folder, `packages/brokers/src/plugins/angel/`: `manifest.ts` (data), `answer.ts` (reads SmartAPI's two answer envelopes) and `plugin.ts` (publisher-login sign-in and the holdings read). One line in `src/plugins/index.ts`. Tests and fixtures in `test/plugins/angel/`. Everything else comes from the Kite plugin build: the kit, the host functions, the registry and the conformance suite.

**Tech Stack:** TypeScript (ESM), zod 4, vitest 4, ESLint 10, pnpm.

**Spec:** [`docs/superpowers/specs/2026-10-27-angel-one-plugin-design.md`](../specs/2026-10-27-angel-one-plugin-design.md), an addendum to the [broker plugins design](../specs/2026-10-27-broker-plugins-design.md). It builds on the [Kite plugin plan](2026-10-27-broker-plugins.md), whose Interfaces blocks name every kit and host function used here.

## Global Constraints

**Before you start**
- The Kite plugin build must be on `origin/staging`. `git ls-tree -r --name-only origin/staging packages/brokers` must list `src/plugins/kite/plugin.ts`, `src/plugins/index.ts`, `src/registry.ts`, `src/host.ts`, `src/kit/http.ts` and `test/conformance.ts`. If any is missing, stop and tell the user.
- Where the code on `staging` names something differently from the Kite plan (`ConformanceFixtures` fields, `HttpPhase`, host function options), follow the code and note the difference in the PR.
- Branch `feat/angel-one-plugin` from `origin/staging`, and open the PR into `staging`. Run `gh-help` first. Push with `gh-git push`.

**Scope**
- No edits to `apps/api`, `apps/web`, `packages/contracts` or `packages/db`, except the one `apps/api` test line in "Adjustments" below. If any other test there fails because Angel One is now in the real registry, stop and tell the user; do not edit it.
- No change to the kit, the host functions, the registry or the conformance suite.
- Plugin code imports only from `../../kit` (or the kit's index), `@maester/contracts` types and its own folder. The lint rule for `src/plugins/**` must pass.

**Figures**
- Every figure goes through the kit's `decimal()`. Never `Number()`, `parseFloat` or arithmetic. `quantity` and `t1quantity` stay apart; the engine adds them.

**Errors**
- Only the four codes: `BROKER_UNAVAILABLE`, `BROKER_SIGNED_OUT`, `BROKER_REFUSED`, `BROKER_ANSWER_UNREADABLE`. Angel One's `message`, the token and the API key never go into an error message.

**Angel One values (spec §3)**
- Login: `https://smartapi.angelone.in/publisher-login?api_key=<encodeURIComponent(apiKey)>&state=<encodeURIComponent(state)>`.
- Profile: `GET https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile`.
- Holdings: `GET https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding`.
- Headers on both calls, exactly: `Authorization: Bearer <accessToken>`, `X-PrivateKey: <apiKey>`, `X-UserType: USER`, `X-SourceID: WEB`, `Accept: application/json`, `Content-Type: application/json`. Never `X-ClientLocalIP`, `X-ClientPublicIP` or `X-MACAddress`.
- Expiry: `sessionExpiry({ kind: "daily", at: "00:00", timeZone: "Asia/Kolkata" }, now)`.
- Token error codes: `AG8001`, `AG8002`, `AG8003`.

**Manifest copy, exactly** (interface text uses `’`):

| Key | Value |
| --- | --- |
| `id` / `name` | `angel` / `Angel One` |
| `enabled` | `false` |
| `notOfferedReason` | Not offered until Maester has tried a live Angel One sign-in. |
| `hosts` | `["smartapi.angelone.in", "apiconnect.angelone.in"]` |
| `credentials` | `[{ key: "apiKey", label: "API key", hint: "From your app’s page on SmartAPI.", secret: false, minLength: 6, maxLength: 64 }]` |
| `credentialShown` | `apiKey` |
| `signIn` | `{ kind: "redirect" }` |
| `signedOutStatuses` | `[401, 403]` |
| `copy.pickerLine` | Sign in on Angel One’s page each day. SmartAPI is free. |
| `copy.lasts` | Until midnight |
| `copy.cost` | Free (SmartAPI) |
| `copy.formLede` | Angel One lets an app read your holdings once you create a free SmartAPI app of your own and sign in to it each day. |
| `copy.steps` | 1. Sign in at smartapi.angelone.in and create an app. 2. Paste the redirect URL below into the app’s redirect URL. 3. Copy the app’s API key into the field below. 4. Save, then sign in on Angel One’s page. You come back here. |
| `copy.saveNote` | Maester asks Angel One only for your holdings. It never places an order. |
| `copy.signedOutNote` | Angel One signs Maester out every night at midnight. |

## Adjustments for the code on staging (29 October 2026)

The Kite build merged as `a8c6a15` (#32, #34, #35). Where it differs from the Kite plan, these lines win over the tasks below:

- **Branch.** `feat/angel-one-plugin` is cut from `docs/angel-one-plugin` (PR #33, which is `staging` plus this plan and the addendum), so Task 3 can edit them. Its PR goes into `staging`, stacked on #33.
- **Imports.** A plugin imports the kit as `../../kit/index.js`, as `src/plugins/kite/plugin.ts` does. The kit exports `BrokerError`, `at`, `text`, `decimal`, `sessionExpiry` and the types `BrokerHttp` and `HttpPhase`, but not `createBrokerHttp`. Lint allows only relative imports and `@maester/contracts`, and refuses `host`, `kit/http` and any `../index`. A plugin does not import another plugin.
- **Saved fields.** Read `apiKey` with a local `required(creds, "apiKey")`, a copy of Kite's helper: a missing value is `BROKER_UNAVAILABLE`, and the message names the key, never the value.
- **Session check.** `completeSignIn` refuses an empty token, an `accountId` that is neither text nor `null`, invalid dates, and an `expiresAt` that is not after `signedInAt`.
- **Tests.** They import `completeSignIn`, `loginUrlFor` and `readHoldings` from `../../../src/host.js`, `runConformance` from `../../conformance.js`, and their JSON fixtures directly, as `test/plugins/kite/kite.test.ts` does. The suite now also checks that a return carrying only `state` is refused, and that a refusal keeps its state.
- **Two tests that name the registry's brokers** change in Task 2. The user agreed to the `apps/api` one on 29 October 2026:
  - In `packages/brokers/test/plugins/kite/kite.test.ts`, "is the one plugin the default registry holds" becomes "is in the default registry". It checks `plugins` contains `kite` and `defaultRegistry().get("kite")` is Kite, with the manifest checks unchanged.
  - In `apps/api/test/brokers.test.ts`, "GET /v1/brokers lists the default registry's brokers" compares the ids with `[...defaultRegistry().keys()]`, imported from `@maester/brokers`, in place of `["kite"]`. That is the only edit allowed in `apps`.
- **API tests** need their own pgvector container: `docker run --rm -d --name maester-pg-angel -p 55434:5432 -e POSTGRES_USER=maester -e POSTGRES_PASSWORD=maester -e POSTGRES_DB=maester_test_api pgvector/pgvector:pg16`, then `DATABASE_URL_TEST_API=postgres://maester:maester@localhost:55434/maester_test_api`. Stop it with `docker stop maester-pg-angel`.

## Review Focus

1. **A holding bought today:** `quantity: 0`, `t1quantity: 5`. It is returned as a line with `quantity: "0"` and `t1Quantity: "5"`, never dropped. Test in Task 2.
2. **The same ISIN on the same exchange twice** (for example split by product). The host refuses the read as `BROKER_ANSWER_UNREADABLE`; the plugin never merges lines, because merging is arithmetic. Test in Task 2.
3. **A line with no `isin`.** The whole read is `BROKER_ANSWER_UNREADABLE`, as for a `null` symbol, never a dropped line. Test in Task 2.
4. **An empty `auth_token=` or a blank `state=`.** The first is refused; the second is `state: null`, so the host refuses it. Test in Task 1.
5. **An API key with reserved characters** (`ab+c&d`). It is encoded in the login URL and sent unencoded in `X-PrivateKey`. Test in Task 1 and Task 2.

---

### Task 1: The manifest, the answer reader and the sign-in

**Files:**
- Create: `packages/brokers/src/plugins/angel/manifest.ts`, `src/plugins/angel/answer.ts`, `src/plugins/angel/plugin.ts`.
- Create: `packages/brokers/test/plugins/angel/fixtures/profile.json`, `error-token.json`, `error-other.json`.
- Test: `packages/brokers/test/plugins/angel/answer.test.ts`, `test/plugins/angel/sign-in.test.ts`.

**Interfaces:**
- Consumes: `BrokerManifest` (contracts); `BrokerError`, `HttpPhase`, `at`, `text`, `sessionExpiry` (kit); `BrokerPlugin` (`src/plugin.ts`); `loginUrlFor`, `completeSignIn` (`src/host.ts`).
- Produces:
  - `manifest.ts`: `export const manifest: BrokerManifest`, the table in the Global Constraints.
  - `answer.ts`: `export const TOKEN_ERRORS: readonly string[] = ["AG8001", "AG8002", "AG8003"]` and `export function answer(body: unknown, phase: HttpPhase): unknown`. It follows spec §3.3 in order: not an object → `BROKER_ANSWER_UNREADABLE`; `status === false || success === false` → the code is `errorcode ?? errorCode`, a token code is `BROKER_SIGNED_OUT` on `"read"` and `BROKER_REFUSED` on `"sign-in"`, any other code or none is `BROKER_UNAVAILABLE`; neither `status === true` nor `success === true` → `BROKER_ANSWER_UNREADABLE`; otherwise it returns `data`. Messages name only the phase and the code, for example `"read: Angel One answered AG8001"`.
  - `plugin.ts`: `export const PROFILE_URL`, `HOLDINGS_URL` (the Global Constraints values), `export function angelHeaders(apiKey: string, accessToken: string): Record<string, string>`, and `export const angel: BrokerPlugin`, whose `signIn` this task writes. Its `reads.holdings` throws `BrokerError("BROKER_UNAVAILABLE", "read: not built yet")` until Task 2.

Fixtures (every value synthetic):
- `profile.json`: `{ "status": true, "message": "SUCCESS", "errorcode": "", "data": { "clientcode": "A1234567", "name": "TEST USER", "email": "", "mobileno": "", "exchanges": ["NSE", "BSE"], "products": ["DELIVERY"], "lastlogintime": "", "brokerid": "B2C" } }`
- `error-token.json`: `{ "success": false, "message": "Invalid Token", "errorCode": "AG8001", "data": "" }`
- `error-other.json`: `{ "status": false, "message": "Something Went Wrong, Please Try After Sometime", "errorcode": "AB1004", "data": null }`

- [ ] **Step 1: Write the failing tests.**

  `answer.test.ts`:
  - `returns data from a good answer`: `answer({ status: true, data: [1] }, "read")` equals `[1]`.
  - `reads the success/errorCode envelope`: `error-token.json` on `"read"` is `BROKER_SIGNED_OUT`, on `"sign-in"` is `BROKER_REFUSED`.
  - `reads the status/errorcode envelope`: `{ status: false, errorcode: "AG8002" }` and `{ status: false, errorcode: "AG8003" }` on `"read"` are `BROKER_SIGNED_OUT`.
  - `any other code is BROKER_UNAVAILABLE`: `error-other.json` on both phases; `{ status: false }` with no code too.
  - `a body with neither flag is unreadable`: `{}`, `null`, `"text"`, `{ status: "true" }` are `BROKER_ANSWER_UNREADABLE`.
  - `never passes Angel One's text on`: no message contains `Invalid Token` or `Something Went Wrong`.

  `sign-in.test.ts`, with `creds = { apiKey: "angelkey1" }` and a `vi.fn` fetch that answers by URL and records each request's URL and headers:
  - `builds the publisher-login URL`: `loginUrlFor(angel, { creds, state: "nonce-1", returnUrl: "https://m.test/r" })` equals `https://smartapi.angelone.in/publisher-login?api_key=angelkey1&state=nonce-1`.
  - `encodes the key and the state` (Review Focus 5): key `ab+c&d`, state `n/1=` gives `api_key=ab%2Bc%26d&state=n%2F1%3D`.
  - `reads a return with state`: `{ auth_token: "jwt-abc", feed_token: "feed-1", state: "nonce-1" }` gives `{ state: "nonce-1", payload: { authToken: "jwt-abc" } }`; the payload has no `feed_token`.
  - `reads a return without state as state null`: no `state`, and `state: ""` and `state: "  "` (Review Focus 4), each give `state: null` with the payload.
  - `refuses a return without auth_token`: `{ state: "nonce-1" }` and `{ auth_token: "", state: "nonce-1" }` give `{ state: "nonce-1", refused: true }`.
  - `checks the token with one getProfile call`: `completeSignIn(angel, { creds, payload: { authToken: "jwt-abc" }, returnUrl, now: new Date("2026-10-27T18:20:00Z"), fetch })` makes exactly one request, to `PROFILE_URL`, with headers equal to `angelHeaders("angelkey1", "jwt-abc")`, and none of the three `X-Client*` headers. It returns `{ accessToken: "jwt-abc", accountId: "A1234567", signedInAt, expiresAt: 2026-10-27T18:30:00.000Z }`.
  - `expires at the next midnight after a sign-in just past midnight`: `now = 2026-10-27T18:40:00Z` (00:10 IST) gives `expiresAt` `2026-10-28T18:30:00.000Z`.
  - `refuses a token Angel One refuses`: profile answered with `error-token.json` is `BROKER_REFUSED`; with `error-other.json` is `BROKER_UNAVAILABLE`; with `{ status: true, data: {} }` is `BROKER_ANSWER_UNREADABLE`.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- angel`. Expected: FAIL, because the modules do not exist.
- [ ] **Step 3:** Implement `manifest.ts`, `answer.ts` and `plugin.ts` (sign-in only). `readReturn` trims `state` and `auth_token` and treats an empty value as absent. `complete` calls `answer(await http.get(PROFILE_URL, { headers }), "sign-in")`, then `text(at(data, "clientcode"), "clientcode")`.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test -- angel && pnpm --filter @maester/brokers typecheck && pnpm --filter @maester/brokers lint`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(brokers): Angel One manifest, answer reader and publisher-login sign-in`.

### Task 2: The holdings read, conformance and the registry line

**Files:**
- Modify: `packages/brokers/src/plugins/angel/plugin.ts` (`reads.holdings`), `src/plugins/index.ts` (`[kite, angel]`).
- Create: `packages/brokers/test/plugins/angel/fixtures/holdings.json`, `holdings-strings.json`, `holdings-empty.json`.
- Test: `packages/brokers/test/plugins/angel/angel.test.ts`.

**Interfaces:**
- Consumes: Task 1's `angel`, `answer`, `angelHeaders`, `HOLDINGS_URL`, `PROFILE_URL`; `decimal`, `text`, `at` (kit); `readHoldings` (`src/host.ts`); `runConformance`, `ConformanceFixtures` (`test/conformance.ts`); `defaultRegistry` (`src/plugins/index.ts`).
- Produces: `angel.reads.holdings`, and `export function symbolOf(raw: string, exchange: string): string` in `plugin.ts`: on `NSE`, a trailing `-EQ` is removed; otherwise `raw` unchanged.

Line mapping (spec §3.4): `isin` = `text(isin)`; `exchange` = `text(exchange)`; `symbol` = `symbolOf(text(tradingsymbol ?? tradingSymbol), exchange)`; `quantity` = `decimal(quantity)`; `t1Quantity` = `decimal(t1quantity ?? 0)`; `averagePrice` = `decimal(averageprice ?? 0)`; `lastPrice` = `ltp == null ? null : decimal(ltp)`. `data` must be an array; anything else, `null` included, is `BROKER_ANSWER_UNREADABLE`.

Fixtures (synthetic figures, envelope `{ "status": true, "message": "SUCCESS", "errorcode": "", "data": [...] }`):
- `holdings.json`, figures as JSON numbers, post 14240's keys:
  - `SBIN-EQ`, `NSE`, `INE062A01020`, `quantity: 10`, `t1quantity: 0`, `averageprice: 512.35`, `ltp: 801.4`, plus `realisedquantity`, `product: "DELIVERY"`, `close`, `profitandloss`, `pnlpercentage`, `symboltoken`, `haircut`, `collateralquantity: null`;
  - `ABC-BE`, `NSE`, `INE000Z01011`, `quantity: 20`, `t1quantity: 5`, `averageprice: 0.0`, `ltp: 41.05`;
  - `SBIN`, `BSE`, `INE062A01020`, `quantity: 2`, `t1quantity: 0`, `averageprice: 600`, `ltp: 801.25`.
- `holdings-strings.json`, the Go mock's shape: `tradingSymbol: "RELIANCE-EQ"`, `NSE`, `INE002A01018`, `quantity: "4"`, `t1quantity: "0"`, `averageprice: "2450.10"`, `ltp: "2511.00"`, other figures as strings.
- `holdings-empty.json`: `data: []`.

- [ ] **Step 1: Write the failing tests** in `angel.test.ts`.

  `runConformance(angel, f)` with `creds { apiKey: "angelkey1" }`, `goodReturn { auth_token: "jwt-abc", feed_token: "feed-1", state: "nonce-1" }`, `refusedReturn { state: "nonce-1" }`, `answers` mapping `PROFILE_URL` to `profile.json` and `HOLDINGS_URL` to `holdings.json` (status 200), `expectedLines` as below, `signInAt 2026-10-27T18:20:00Z`, `expectedExpiry "2026-10-27T18:30:00.000Z"`.

  Then, through `readHoldings(angel, { creds, session: { accessToken: "jwt-abc", accountId: "A1234567" }, now, fetch })`:
  - `reads holdings as printed`: `holdings.json` gives exactly
    `{ isin: "INE062A01020", symbol: "SBIN", exchange: "NSE", quantity: "10", t1Quantity: "0", averagePrice: "512.35", lastPrice: "801.4" }`,
    `{ isin: "INE000Z01011", symbol: "ABC-BE", exchange: "NSE", quantity: "20", t1Quantity: "5", averagePrice: "0", lastPrice: "41.05" }`,
    `{ isin: "INE062A01020", symbol: "SBIN", exchange: "BSE", quantity: "2", t1Quantity: "0", averagePrice: "600", lastPrice: "801.25" }`.
  - `reads string figures and tradingSymbol`: `holdings-strings.json` gives `{ isin: "INE002A01018", symbol: "RELIANCE", exchange: "NSE", quantity: "4", t1Quantity: "0", averagePrice: "2450.10", lastPrice: "2511.00" }`.
  - `a missing averageprice is "0" and a missing ltp is null`.
  - `sends the same headers as the profile call`: the request to `HOLDINGS_URL` has headers equal to `angelHeaders("angelkey1", "jwt-abc")`; with key `ab+c&d`, `X-PrivateKey` is `ab+c&d` (Review Focus 5).
  - `keeps a holding bought today` (Review Focus 1): `quantity: 0, t1quantity: 5` gives `quantity: "0", t1Quantity: "5"`.
  - `an empty account is no lines`: `holdings-empty.json` gives `[]`.
  - `data null or an object is unreadable`: `data: null`, `data: {}` and `data: { holdings: [] }` are `BROKER_ANSWER_UNREADABLE`.
  - `a signed-out answer is BROKER_SIGNED_OUT`: `error-token.json`, and `{ status: false, errorcode: "AG8002" }`, `{ status: false, errorcode: "AG8003" }`; `error-other.json` is `BROKER_UNAVAILABLE`. No message contains `Invalid Token`, `jwt-abc` or `angelkey1`.
  - `symbols`: `symbolOf("SBIN-EQ", "NSE")` is `SBIN`; `symbolOf("ABC-BE", "NSE")`, `symbolOf("SBIN", "BSE")` and `symbolOf("SBIN-EQ", "BSE")` are unchanged.
  - `a null symbol fails the read`: `tradingsymbol: null` with no `tradingSymbol` is `BROKER_ANSWER_UNREADABLE`.
  - `a line with no isin fails the read` (Review Focus 3).
  - `the same isin and exchange twice fails the read` (Review Focus 2): two `SBIN-EQ`/`NSE` lines are `BROKER_ANSWER_UNREADABLE`.
  - `is registered, switched off`: `defaultRegistry().get("angel")` is `angel`, its `manifest.enabled` is `false` and its `notOfferedReason` is the Global Constraints value; `defaultRegistry().get("kite")` is still there.
- [ ] **Step 2:** Run `pnpm --filter @maester/brokers test -- angel`. Expected: FAIL (holdings not built, `angel` not registered).
- [ ] **Step 3:** Implement `reads.holdings` and `symbolOf` in `plugin.ts`, and add `angel` to `plugins` in `src/plugins/index.ts`.
- [ ] **Step 4:** Run `pnpm --filter @maester/brokers test && pnpm --filter @maester/brokers typecheck && pnpm --filter @maester/brokers lint`, then `pnpm --filter @maester/api test` (with the test database from the Kite plan's Global Constraints, on your own container and port). Expected: PASS everywhere. If an API test fails only because the real registry now lists Angel One, stop and tell the user (Global Constraints, Scope).
- [ ] **Step 5: Commit** with `feat(brokers): Angel One holdings read, registered and switched off`.

### Task 3: README, docs and the PR

**Files:**
- Modify: `packages/brokers/README.md`: an "Angel One" section with the plugin's notes (spec §3: the two envelopes, `-EQ`, the left-out `X-Client*` headers and their fallback) and "Live run owed", the checklist in spec §5 copied as items 0–12, and the three outcomes.
- Modify: `docs/superpowers/specs/2026-10-27-angel-one-plugin-design.md`: the status line becomes "built (#<PR>), 2026-10-xx; switched off, live run owed".
- Modify: `docs/README.md`: the Angel One row's "not built" becomes "built, switched off until a live run".

- [ ] **Step 1:** Write the three edits.
- [ ] **Step 2:** Run `uv run --locked python scripts/check_workspace.py` from the repo root, and `pnpm --filter @maester/brokers test`. Expected: `Workspace OK`, and PASS.
- [ ] **Step 3:** Run `git diff --stat origin/staging...HEAD -- apps packages/contracts packages/db`. Expected: only `apps/api/test/brokers.test.ts`, one line.
- [ ] **Step 4:** Commit with `docs(brokers): Angel One notes and the live run owed`, then `gh-git push -u origin feat/angel-one-plugin` and `gh pr create --base staging`. The PR body lists as owed: the live run (needs a public https return URL), and switching `enabled` on or recording why not.
