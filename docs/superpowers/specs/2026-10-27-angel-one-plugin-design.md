# Angel One broker plugin: design addendum

Status: built 29 October 2026, switched off until a live run. This is an addendum to the [broker plugins design](2026-10-27-broker-plugins-design.md) (§12.2 and §15) and [ADR 0009](../../decisions/0009-broker-plugins.md). The facts it builds on are in [`docs/research/2026-10-27-angel-one-publisher-login.md`](../../research/2026-10-27-angel-one-publisher-login.md). §2 below corrects some of them against Angel One's own SDKs.

**Depends on:**

- [PR #32](https://github.com/himanshu634/maester/pull/32) (the plugins spec, ADR 0009 and the research note), which is not merged yet;
- the Kite plugin build on `staging`: `packages/brokers/src/plugins/`, `registry.ts`, the kit and `test/conformance.ts`. On 27 October 2026 none of these are on `staging`, so the build waits.

## 1. Goal

Angel One (SmartAPI) is the second Holdings broker. It is one folder, `packages/brokers/src/plugins/angel/`, one line in `plugins/index.ts`, and its tests in `test/plugins/angel/`. There are no edits to `apps/api`, `apps/web`, `packages/contracts` or `packages/db` (§6).

It ships with `enabled: false` until a live run confirms what the host needs (§5).

**Decided by the user (27 October 2026):** keep Angel One; sign in through the publisher-login redirect, so the investor types no MPIN or TOTP and Maester keeps no TOTP seed; a return without `state` is refused, as it was for ICICI Direct.

**Decided here:** everything below.

## 2. Facts checked against Angel One's sources

Read on 27 October 2026:

- the Python SDK [`smartapi-python`](https://github.com/angel-one/smartapi-python) `SmartApi/smartConnect.py` (last commit 27 May 2025);
- the JS SDK [`smartapi-javascript`](https://github.com/angel-one/smartapi-javascript) `config/api.js` and `lib/smartapi-connect.js` (27 Sep 2024);
- the Go SDK [`smartapigo`](https://github.com/angel-one/smartapigo) `portfolio.go`, `user.go`, `http.go`, `connect.go` and `mock_responses/` (26 May 2025; its base URL is still `apiconnect.angelbroking.com`, so it is older in places);
- the staff post [14240](https://smartapi.angelone.in/smartapi/forum/post/14240), "New fields added to getHolding".

Marks are those of the research note: [off] Angel One's code or docs, [staff], [3p], [?].

| Fact | Note said | Evidence | Now |
| --- | --- | --- | --- |
| Hosts `smartapi.angelone.in`, `apiconnect.angelone.in` | [off] | Python `_login_url`, `_rootUrl`; JS `API.login`, `API.root` | [off] |
| Login `…/publisher-login?api_key=…` | [off] | Python `login_url()`, JS `getLoginURL()`. Neither adds `state`; the docs call it optional | [off]; `state` still [?] |
| Headers `Authorization: Bearer`, `X-PrivateKey` (the API key), `X-UserType: USER`, `X-SourceID: WEB`, `Accept` and `Content-Type: application/json` | [off] | All three SDKs | [off] |
| `X-ClientLocalIP`, `X-ClientPublicIP`, `X-MACAddress` | [?] | **Correction.** The Python SDK's `finally` block always overwrites the looked-up addresses with `127.0.0.1` and `106.193.147.98`, so every Python user sends the same two values. The JS SDK builds its default headers before its async address lookups finish. Only Go sends the machine's own values | Angel One does not check them against the caller [off, inferred]. Still left out (§3.5) |
| `getProfile` route, account at `data.clientcode` | route [off], field [?] | Go `UserProfile.ClientCode` tagged `clientcode`; Python `user['data']['clientcode']`. JS and Go send no parameters; Python adds `refreshToken`, which the others show is not needed | [off] |
| `getHolding` route, list at `data` | route [off], list [?] | Go decodes `data` into `[]Holding`; staff post 14240 | [off] |
| Holding key `tradingsymbol` | [staff] | **Correction.** The Go struct tag and post 14240 say `tradingsymbol`; the Go mock says `tradingSymbol` (Go's decoder ignores case, so the mock never failed) | Read `tradingsymbol`, else `tradingSymbol` |
| Figures are numbers | implied | **Correction.** Strings in the Go struct and mock (`"quantity": "0"`); JSON numbers in post 14240 (`"averageprice": 111.87`) | Accept both; `decimal()` already does |
| `averageprice`, `ltp` | [staff] | Post 14240 [staff]. Absent from the older Go SDK. A forum thread shows `averageprice: 0.0` with a non-zero `ltp` [3p] | A missing or zero price is `"0"`, which `holding_cost` v1 reads as an unknown cost |
| A holding's `tradingsymbol` can be `null` | — | Forum topic 4789 and post 11519 [3p] | One such line makes the read unreadable (§3.4) |
| Error inside HTTP 200 as `status: false`, `errorcode` | [?] | **Correction.** Two envelopes. A good answer is `{status, message, errorcode, data}` (Go `envelope` tags) [off]. The token error is `{"success": false, "message": "Invalid Token", "errorCode": "AG8001", "data": ""}` [3p, forum]. The JS SDK reads `success \|\| status` and `errorCode`, and calls its session-expiry hook on `AG8001` inside an HTTP 200 [off] | Check both flags and both casings (§3.3) |
| `AG8001` is an invalid or expired token | [?] | Staff replies on the forum; the JS SDK's expiry hook [off] | [off]. `AG8002`, `AG8003` stay [?] |
| `-EQ` on NSE symbols | [?] | Post 14240: `TATASTEEL-EQ`, `PARAGMILK-EQ`, `SBIN-EQ` on `NSE` [staff]. Maester's closes are looked up by NSE symbol (`apps/api/src/routes/brokers.ts`, `latestCloses`), so the strip is needed | [staff] |
| Logged out daily at midnight | [staff] | Unchanged | [staff] |

`getAllHolding` adds `data.totalholding` (value, invested, P&L). Maester does not call it: the engine works out every total.

## 3. The plugin

### 3.1 Manifest (`manifest.ts`)

| Key | Value |
| --- | --- |
| `id`, `name` | `angel`, `Angel One` |
| `enabled` | `false`, with `notOfferedReason`: "Not offered until Maester has tried a live Angel One sign-in." (§5) |
| `hosts` | `smartapi.angelone.in`, `apiconnect.angelone.in` |
| `credentials` | one: `apiKey`, label "API key", hint "From your app’s page on SmartAPI.", not secret, 6–64 characters. The publisher flow needs no secret key |
| `credentialShown` | `apiKey` |
| `signIn` | `{ kind: "redirect" }` |
| `signedOutStatuses` | `[401, 403]` (the default) |
| `copy` | the research note's draft (§1 there), unchanged. `lasts` is "Until midnight"; `signedOutNote` is "Angel One signs Maester out every night at midnight." |

### 3.2 Sign-in (`plugin.ts`, `signIn`)

- **`loginUrl({ creds, state })`:** `https://smartapi.angelone.in/publisher-login?api_key=<apiKey>&state=<state>`, each value URL-encoded. `returnUrl` is not sent: the investor pastes it into the SmartAPI app's redirect URL, as with Kite.
- **`readReturn(query)`:** `state` is `query.state`, or `null` when absent or empty. A non-empty `auth_token` gives `{ state, payload: { authToken } }`; anything else is `{ state, refused: true }`. `feed_token` and any `refresh_token` are not read: Maester streams nothing and does not renew a session. The host then refuses a missing or wrong `state` with `SIGN_IN_EXPIRED` before `complete` runs.
- **`complete({ creds, payload, http, now })`:** one `GET https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile` with the headers in §3.5. The answer is checked (§3.3), then `text(data.clientcode)` is the account. The session is `{ accessToken: authToken, accountId: clientcode, signedInAt: now, expiresAt: sessionExpiry({ kind: "daily", at: "00:00", timeZone: "Asia/Kolkata" }, now) }`. `sessionExpiry` already rolls a midnight that has passed to the next one.

### 3.3 Reading an answer

One function, `answer(body, phase)`, reads every SmartAPI answer that came back with HTTP 200:

1. Not an object: `BROKER_ANSWER_UNREADABLE`.
2. `status === false` or `success === false`: the code is `errorcode ?? errorCode`.
   - `AG8001`, `AG8002` or `AG8003`: `BROKER_SIGNED_OUT` while reading, `BROKER_REFUSED` while signing in.
   - Any other code, or none: `BROKER_UNAVAILABLE`.
3. Neither `status === true` nor `success === true`: `BROKER_ANSWER_UNREADABLE`.
4. Otherwise it returns `data`.

Angel One's `message` is never put in an error. The kit already turns HTTP 401 and 403 into `BROKER_SIGNED_OUT` (reading) or `BROKER_REFUSED` (signing in).

### 3.4 Holdings (`reads.holdings`)

`GET https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding`, headers as in §3.5, checked by `answer(body, "read")`.

- `data` is an array: one line per item. `[]` is an account with no holdings.
- Anything else, `null` included, is `BROKER_ANSWER_UNREADABLE`. "No holdings" is a figure, so it is said only for the shape we know means it. The live run (§5, item 5) decides whether `null` joins `[]`.

Each line, using only the kit:

| Line field | From | Rule |
| --- | --- | --- |
| `isin` | `isin` | `text()` |
| `exchange` | `exchange` | `text()` |
| `symbol` | `tradingsymbol`, else `tradingSymbol` | `text()`. On `NSE`, a trailing `-EQ` is removed. Any other suffix (`-BE`, `-SM`, `-GB`…) stays, so that share finds no NSE close and shows "—", never another share's close. On `BSE` nothing changes. A `null` symbol fails the whole read (`text()`), as the contract asks; it is never dropped silently |
| `quantity` | `quantity` | `decimal()` |
| `t1Quantity` | `t1quantity`, `0` when absent | `decimal()`. Kept apart; the engine adds it (live-run item 6) |
| `averagePrice` | `averageprice`, `0` when absent | `decimal()`. `"0"` is a cost the engine does not know (`holding_cost` v1) |
| `lastPrice` | `ltp`, `null` when absent | `decimal()`. Kept as the contract asks; Maester never values a holding at it |

`close`, `profitandloss`, `pnlpercentage`, `product`, `realisedquantity`, `authorisedquantity`, `collateral*`, `haircut` and `symboltoken` are not read. The plugin computes nothing.

### 3.5 Headers

Every call sends:

```
Authorization: Bearer <accessToken>
X-PrivateKey:  <apiKey>
X-UserType:    USER
X-SourceID:    WEB
Accept:        application/json
Content-Type:  application/json
```

`X-ClientLocalIP`, `X-ClientPublicIP` and `X-MACAddress` are left out. Maester cannot know the server's addresses through the kit and does not make them up. §2 shows that Angel One's own Python SDK sends the same two fixed addresses for every user, so if a live run is refused without them, the fallback is to send those fixed values (and a fixed MAC) as named constants, with this reason beside them.

## 4. Tests (`test/plugins/angel/`)

Fixtures, with every key, token, account ID and name replaced:

- `profile.json`: the Go mock's shape, `data.clientcode` = `"A1234567"`.
- `holdings.json`: post 14240's shape, figures as JSON numbers, NSE `-EQ` lines, one BSE line.
- `holdings-strings.json`: the Go mock's shape, figures as strings, key `tradingSymbol`.
- `holdings-empty.json`: `status: true`, `data: []`.
- `error-token.json`: `{ "success": false, "message": "Invalid Token", "errorCode": "AG8001", "data": "" }`.
- `error-other.json`: `{ "status": false, "message": "…", "errorcode": "AB1004", "data": null }`.

`angel.test.ts` runs `runConformance(plugin, fixtures)`, then:

1. **Return with `state`:** the state and `authToken` come back; `feed_token` is not in the payload.
2. **Return without `state`:** `state` is `null`; an empty `state` is `null` too.
3. **Return without `auth_token`:** refused.
4. **`loginUrl`:** the API key and the state are URL-encoded; the host is `smartapi.angelone.in`.
5. **`getProfile` check:** `complete` makes exactly one call, to `getProfile`, with the §3.5 headers and none of the `X-Client*` headers. The session carries the token, `A1234567` and the next midnight in Asia/Kolkata, both for a sign-in at 23:50 and at 00:10.
6. **`status: false` while signing in:** `AG8001` in either envelope is `BROKER_REFUSED`; `AB1004` is `BROKER_UNAVAILABLE`; a `data` without `clientcode` is unreadable.
7. **`status: false` while reading:** `AG8001`, `AG8002`, `AG8003` in either envelope are `BROKER_SIGNED_OUT`; `AB1004` is `BROKER_UNAVAILABLE`. No error message carries Angel One's text.
8. **Figures:** the number and the string fixtures give the same decimal strings as printed; a missing `averageprice` is `"0"`; a missing `ltp` is `null`.
9. **Empty account:** `data: []` is no lines; `data: null` and `data: {}` are unreadable.
10. **Symbols:** NSE `SBIN-EQ` is `SBIN`; NSE `ABC-BE` is unchanged; BSE `SBIN` is unchanged; `tradingSymbol` is read when `tradingsymbol` is absent; a `null` symbol fails the read.

## 5. Switched off until the live run

The spec's recipe (§15, step 7) keeps a plugin off while something the host needs is unknown. Two such things are unknown here:

- whether `state` comes back, which is the safety check;
- whether `quantity` already includes `t1quantity`. If it does, adding them double-counts a holding just after a purchase.

So Angel One ships with `enabled: false`. `enabled: false` also blocks saving a key, so the live run starts by switching it on in a local build. Its outcome is one of:

- **Everything holds:** `enabled: true`, `notOfferedReason` removed, and the research note's [?] marks updated.
- **`state` does not come back:** `enabled` stays `false` with the reason "Angel One’s sign-in page doesn’t send back the check Maester needs" (research note §2). A typed MPIN and TOTP sign-in would be a new strategy with its own design.
- **Anything else differs:** fix the plugin and its fixtures, then decide.

The live run needs Maester's return address on a public https host, because SmartAPI refuses a localhost redirect URL [staff].

Checklist, to be copied into `packages/brokers/README.md` as owed:

0. Switch `enabled` to `true` in a local build only.
1. `state` comes back unchanged.
2. A SmartAPI app made under the current "New Login" can use the publisher login [3p says it cannot]. If not, record which app type works.
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

## 6. Host changes: none

Each need was checked against the host as the spec describes it:

| Need | Already met by |
| --- | --- |
| Refuse a return without `state` | The host's nonce check (spec §6, §7) |
| Keep the token in the return URL out of logs | nginx's `/v1/` access log is off; the return route logs only the broker and a code (spec §6) |
| Expiry at midnight | `sessionExpiry` with `at: "00:00"` (`src/expiry.ts`, unchanged in the kit) |
| Figures as JSON numbers or strings | The kit's `decimal()` |
| An average price of zero | `holding_cost` v1 in `@maester/financial-engine` treats it as an unknown cost |
| GET with headers on two hosts | `BrokerHttp.get` |
| Errors inside HTTP 200 | The plugin's `answer()` (§3.3) |

## 7. Risks

| Risk | Answer |
| --- | --- |
| `state` never comes back | The host refuses the return; Angel One stays off with a reason (§5) |
| The return carries a token that can trade until midnight. Kite's return carries only a code that needs the secret | It never reaches Maester's logs (§6). It stays in the investor's own browser history until midnight, which a personal install accepts. A tunnel's log is the one place it leaks; the checklist's item 12 deals with it |
| One bad line (a `null` symbol) hides every Angel One holding | Safer than a silently missing holding. Item 11 shows whether it still happens |
| `quantity` includes `t1quantity` | Off until item 6 is answered |
| The JWT expires before midnight | A read then fails with `AG8001` and the account shows as signed out, which is true. Item 10 makes the expiry exact |

## Sources

- [smartapi-python](https://github.com/angel-one/smartapi-python), [smartapi-javascript](https://github.com/angel-one/smartapi-javascript), [smartapigo](https://github.com/angel-one/smartapigo)
- [Forum post 14240: new fields in getHolding](https://smartapi.angelone.in/smartapi/forum/post/14240) [staff]
- [Forum topic 4789: holding() output](https://smartapi.angelone.in/topic/4789/improper-output-of-smartapi-holding-function), [post 11519](https://smartapi.angelone.in/smartapi/forum/post/11519) [3p]
- [Forum topic 589: AG8001](https://smartapi.angelone.in/topic/589/error-ag8001) and [post 15929](https://smartapi.angelone.in/smartapi/forum/post/15929) [staff and 3p]
- The research note's own sources
