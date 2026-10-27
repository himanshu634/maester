# Angel One SmartAPI: publisher login and holdings

Status: research note, 27 October 2026. This is input for the Angel One plugin, which gets its own design and build in a separate session. The [broker plugins design](../superpowers/specs/2026-10-27-broker-plugins-design.md) builds Kite only. Its plugin contract was checked against the facts below, so an Angel One plugin should need no change to the host (§3).

On 27 October 2026 the user chose the publisher-login redirect for Angel One. The alternatives were the investor typing the MPIN and authenticator code at each sign-in, or Maester keeping the TOTP seed. Earlier Angel One research is in [`2026-10-19-broker-apis.md`](2026-10-19-broker-apis.md) and [`2026-10-24-broker-accounts.md`](2026-10-24-broker-accounts.md).

Marks:

- **[off]** Angel One's own sources:
  - the SDK [`smartapi-python`](https://github.com/angel-one/smartapi-python), `SmartApi/smartConnect.py`, read 27 October 2026;
  - the [SmartAPI docs](https://smartapi.angelbroking.com/docs/User), which are rendered by script and were read only through search snippets.
- **[staff]** A post by Angel One staff on the SmartAPI forum.
- **[3p]** A post by a user on the forum.
- **[?]** Not yet confirmed.

## 1. What the plugin would do

| Part | Value |
| --- | --- |
| Hosts | `smartapi.angelone.in` (login), `apiconnect.angelone.in` (calls) [off] |
| Saved fields | `apiKey`, the SmartAPI app's API key (shown, not secret). The publisher flow needs no secret [off: the SDK's `login_url` uses `api_key` only] |
| Login | `https://smartapi.angelone.in/publisher-login?api_key=<apiKey>&state=<nonce>` [off: `_login_url`, and the docs' optional `state`] |
| Return | `auth_token` and `feed_token` in the query [off: docs]. `state` [?, §2]. No `auth_token` is a refusal. `feed_token` is not kept |
| Complete | `auth_token` is the session's bearer token [?]. The plugin confirms it with `GET https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile` [off: route]. A good answer gives the account, `data.clientcode` [?: field name] |
| Headers on every call | `Authorization: Bearer <token>`, `X-PrivateKey: <apiKey>`, `X-UserType: USER`, `X-SourceID: WEB`, `Accept` and `Content-Type: application/json` [off: the SDK's `requestHeaders`]. See the note below the table for the three `X-Client*` headers |
| App form | The SmartAPI app's redirect URL is Maester's return address, which must be public and https: the SmartAPI team says a localhost redirect or postback URL is refused with a 403 [staff]. Leave the postback URL blank, because Maester takes no order updates |
| Expiry | Daily at 00:00, Asia/Kolkata: "All users will be logged out daily at 12 midnight" [staff, forum 5352] |
| Holdings | `GET https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getHolding` [off: route]. List `data` [?]. Fields `isin`, `tradingsymbol`, `exchange`, `quantity`, `t1quantity`, `averageprice`, `ltp` [staff: forum 4006 example response] |
| Errors | HTTP 401 or 403 is signed out. An answer with `status: false` and `errorcode` `AG8001`, `AG8002` or `AG8003` (invalid, expired or missing token) is `BROKER_SIGNED_OUT` [?: codes]. Any other `status: false` is `BROKER_UNAVAILABLE` |
| Symbol | Angel One's NSE `tradingsymbol` carries the series (`SBIN-EQ`) [?]. On `NSE`, the plugin removes a trailing `-EQ` so the share matches Maester's NSE closes. Any other suffix is left alone, so that share shows "—" for its close, never another share's close |

**The three `X-Client*` headers.** The SDK also sends `X-ClientLocalIP`, `X-ClientPublicIP` and `X-MACAddress`, filled in from the machine it runs on. The plugin leaves them out, because it cannot read the server's network details through the kit and it should not invent them. Whether Angel One requires them on a read is [?] (§4). If it does, they become fixed constants in the plugin, written down with the reason.

Draft copy for the manifest. It follows DESIGN.md §7 and is checked with the build:

- **pickerLine:** "Sign in on Angel One’s page each day. SmartAPI is free."
- **lasts:** "Until midnight"
- **cost:** "Free (SmartAPI)"
- **formLede:** "Angel One lets an app read your holdings once you create a free SmartAPI app of your own and sign in to it each day."
- **steps:**
  1. "Sign in at smartapi.angelone.in and create an app."
  2. "Paste the redirect URL below into the app’s redirect URL."
  3. "Copy the app’s API key into the field below."
  4. "Save, then sign in on Angel One’s page. You come back here."
- **saveNote:** "Maester asks Angel One only for your holdings. It never places an order."
- **signedOutNote:** "Angel One signs Maester out every night at midnight."

## 2. If Angel One does not send `state` back

A forum report says the publisher login drops `state` and sends only `auth_token` [3p]. An Angel One admin replied that the issue "got resolved from our end" and was waiting to be deployed [staff]. Both posts are in [topic 5424](https://smartapi.angelone.in/smartapi/forum/topic/5424/issue-with-customer-state-in-redirect-uri), now deleted.

Without `state`, Maester cannot tie a return to the sign-in the investor started. Someone could then sign a person into another account's token. On 24 October 2026 the user kept ICICI Direct switched off for exactly this reason.

The plugins design already makes this fail safe: the host refuses any return without a matching `state` (`SIGN_IN_EXPIRED`). If the live run shows that `state` does not come back:

- set `enabled: false` with the reason "Angel One’s sign-in page doesn’t send back the check Maester needs";
- record the finding.

The fallback would be a typed MPIN and TOTP sign-in. That is a new sign-in strategy and needs a design of its own.

## 3. How it fits the plugin contract

These map onto the contract with no host change:

- **A token in the return.** `readReturn` puts `auth_token` in the payload.
- **Checking the token.** `complete` checks it with `getProfile` and returns the session.
- **An error inside an HTTP 200.** The plugin reads `status` and `errorcode` from the parsed answer and throws `BrokerError`.
- **The `-EQ` suffix.** The plugin strips it before returning the line.

The kit's HTTP client covers both calls: GET, with headers, on the manifest's hosts.

## 4. To confirm on the first live run

The live run needs Maester's return address on a public https host, because SmartAPI refuses a localhost redirect URL. Hosting is undecided, so the run needs either a deployment or a tunnel to a local API.

1. `state` comes back unchanged on the return.
2. The publisher login works for an app made under SmartAPI's current "New Login". One unverified reply says publisher APIs are not supported there [3p]. If it fails, record which app type works.
3. `auth_token` works as the bearer token on `getProfile` and `getHolding` without a further exchange. One user could not turn it into a JWT with `generateToken` [3p].
4. `getProfile` gives the client code at `data.clientcode`.
5. What `getHolding` returns for an empty account. The plugin would treat `status: true` with `data: null` or `[]` as no holdings, pinned by a fixture. Any other shape is `BROKER_ANSWER_UNREADABLE`.
6. Whether `quantity` already includes `t1quantity`. The plugin maps both, as Kite does, so the engine adds them. If `quantity` already includes T+1, map T+1 to `"0"`.
7. The `-EQ` suffix on NSE symbols, and which other series suffixes appear.
8. The error codes Angel One returns for an expired token.
9. Whether `getProfile` and `getHolding` succeed without `X-ClientLocalIP`, `X-ClientPublicIP` and `X-MACAddress`. If they are refused, add the three as fixed constants and record which values Angel One accepts.

## Sources

- [smartapi-python](https://github.com/angel-one/smartapi-python)
- [SmartAPI User docs](https://smartapi.angelbroking.com/docs/User)
- [Forum topic 5424: state not returned](https://smartapi.angelone.in/smartapi/forum/topic/5424/issue-with-customer-state-in-redirect-uri)
- [Forum post 18692](https://smartapi.angelone.in/smartapi/forum/post/18692)
- Forum 5352 (midnight logout) and 4006 (holdings fields), as cited in [`2026-10-24-broker-accounts.md`](2026-10-24-broker-accounts.md)
