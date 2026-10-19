# Indian broker APIs for reading holdings

Researched 19 Oct 2026 for a personal, read-only use. Maester reads one investor's own holdings, positions and trades, and never places an order. Each fact has a source tag:

- **[off]**: the broker's or regulator's own docs or support pages.
- **[staff]**: a broker employee on its forum.
- **[3p]**: a third party, such as OpenAlgo docs, review sites or vendor blogs.

The Holdings directions on the "Maester Broker Connections" canvas (<https://claude.ai/artifact/2YSB5bYQ5beYq5aanK7Sm6>) and the plan in [`docs/superpowers/plans/2026-10-19-broker-connections.md`](../superpowers/plans/2026-10-19-broker-connections.md) rest on this page. When a fact changes, change it here first, then `holdings-brokers.mjs` in the design kit.

## What this means for Maester

1. **Every broker signs an app out every day.** No retail broker gives a personal app a long-lived token for holdings. SEBI's retail-algo framework is the reason refresh tokens are going away. Fyers: "Continuous refresh-token sessions will not be supported". The one exception is Upstox's Analytics Token, and its Portfolio calls need a static IP. So the design has to treat "signed out since this morning" as the normal state, not an error. Holdings change only when the investor trades, so a quantity read yesterday is still useful if it carries its date.
2. **Reading holdings needs no static IP.** At every broker whose own docs could be checked, the static IP rule covers order endpoints only: Kite, Dhan, Upstox (standard OAuth token), Kotak Neo, Fyers, 5paisa, Angel One and Breeze. Hosting is still undecided, and this does not block it. A broker's redirect URL does need to reach Maester's API.
3. **Brokers fall into three groups by how they sign in:**
   - **Sign in on the broker's own page (OAuth-style redirect):** Zerodha, Upstox, Fyers, ICICI Direct (Breeze) and 5paisa. Maester never sees the password. Dhan offers this too (an API key and secret), but Maester already keeps a pasted Dhan token alive by renewing it (point 5).
   - **Approve the key in the broker's app each day:** Groww.
   - **PIN plus an authenticator code only:** Angel One, Kotak Neo, Shoonya and Motilal Oswal. A server can sign in unattended only by keeping the PIN and the TOTP seed. Maester should not keep them. Whether to let the investor type both each morning, used once and not kept, is an open question.
4. **Cost:** the cheapest useful setups are free for holdings:
   - Kite Personal is free and includes holdings and positions, but no data.
   - Dhan's Trading API is free. Its Data API, which Maester already uses for closes, is ₹499 a month.
   - Upstox, Fyers Standard, Breeze and Kotak Neo are free.
   - Groww charges ₹499 a month even to read holdings.
5. **Dhan tokens last 24 hours now, not 30 days.** Dhan's FAQ: "the validity of the API Access Token has now been updated to 24 hours" [off] ([FAQ](https://dhan.co/support/platforms/dhanhq-api/what-is-the-maximum-validity-of-an-api-access-token-in-dhan-apis/)). Maester already copes: the worker's market schedule (`apps/worker/src/market/schedule.ts`) runs every `MARKET_REFRESH_MINUTES` on every day, and each pass calls `/v2/RenewToken` when the token has less than 6 hours left (`refresh.ts`, `renewIfDue`). The chain breaks only if the worker is down for longer than the token's remaining life; then Settings asks for a new token. So Dhan is the one broker with no daily sign-in, and the same token reads Dhan holdings. `docs/DESIGN.md`'s ConnectionSection example ("5 Nov 2026, in 30 days") is out of date.
6. **One statement covers every broker.** The depository's Consolidated Account Statement (CAS) lists every NSDL and CDSL demat holding for a PAN, plus mutual fund folios. It covers holdings only, with no transactions and no cost. Account Aggregators can't be used: a data recipient must be regulated by RBI, SEBI, IRDAI or PFRDA.
7. **OpenAlgo is AGPL-3.0.** Do not link it into Maester or host it as part of Maester. The brokers' own SDKs (`kiteconnect` on npm, MIT) or plain HTTP adapters keep the licence clean.

## SEBI and exchange framework

- **The circular:** SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013, 4 Feb 2025, "Safer participation of retail investors in Algorithmic trading" [off] ([SEBI](https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html)). The start date moved from 1 Aug 2025 to 1 Oct 2025. Circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/132 (30 Sep 2025) then set a glide path, with full applicability for all brokers "W.e.f. April 01, 2026" [off] ([SEBI extension](https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html)). The exchange standard is NSE/INVG/67858 ([PDF](https://nsearchives.nseindia.com/content/circulars/INVG67858.pdf), not read: it timed out).
- **What it requires:**
  - No open APIs: access goes through an API key per client or vendor plus a static IP whitelisted with the broker.
  - OAuth and 2FA. This wording comes only from secondary sources [3p] ([summary](https://mondaq.com:443/india/commoditiesderivativesstock-exchanges/1581380/sebi-circular-safeguarding-retail-investors-in-algorithmic-trading)).
  - One primary and one secondary IP, which can be changed once a calendar week [staff] ([Kite forum](https://kite.trade/forum/discussion/15350/notes-on-the-nse-circular-prescribing-operating-procedures-for-api-usage)).
  - 10 orders a second per client. Above that, the strategy must be registered with the exchange [staff].
  - Market and IOC orders are barred for algos at several brokers ([Angel](https://www.angelone.in/news/market-updates/what-s-changing-in-angel-one-s-smartapi-access-from-april-1-2026), [5paisa](https://tradebetter.5paisa.com/t/important-update-sebi-algo-compliance-effective-1st-april/761)).
- **Read-only exemption:** the brokers apply this exemption, but it is not in the circular text that could be reached. Zerodha: "We'll only be placing the IP check on the order endpoints" [staff]. Zerodha's support page says the order book, positions and WebSocket "can continue to be accessed from any IP address" [off] ([Zerodha](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip)).

## Brokers

### Zerodha Kite Connect v3

- **Sign-in:** a redirect login at `kite.zerodha.com/connect/login?v=3&api_key=`. It returns a `request_token` that lives only a few minutes. Exchange it at `POST /session/token` with the checksum SHA-256(api_key + request_token + api_secret). The token expires "at 6 AM on the next day (regulatory requirement)". A `refresh_token` is given only "to certain approved platforms" [off] ([login](https://kite.trade/docs/connect/v3/user/)). You need an API key, a secret and a registered redirect URL. The secret stays on the server [off].
- **Cost:** Personal is free and includes portfolio (holdings and positions), but no historical or live data. Connect is ₹500 a month per app and adds WebSocket and historical candles [off] ([charges](https://support.zerodha.com/category/trading-and-markets/kite-web-and-mobile/kite-api/articles/what-are-the-charges-for-kite-apis)).
- **Reads:**
  - `/portfolio/holdings`: ISIN, quantity, T1 quantity, average price and P&L.
  - `/portfolio/positions`: net and day positions [off] ([portfolio](https://kite.trade/docs/connect/v3/portfolio/)).
  - Also orders, trades, margins and quotes.
- **Rate limits:** 10 requests a second for the portfolio endpoints, 1 a second for quotes and 3 a second for historical data [off] ([exceptions](https://kite.trade/docs/connect/v3/exceptions/)).
- **Static IP:** orders only, from 1 Apr 2026, at most 2 IPs [off].
- **SDKs:** `kiteconnect` on npm (official, TypeScript, MIT, Node 18+) and `pykiteconnect` (MIT) [off].

### Dhan (DhanHQ v2)

- **Sign-in:** four routes. Every token lasts 24 hours [off] ([auth](https://dhanhq.co/docs/v2/authentication/)).
  - A token generated on Dhan Web. `/v2/RenewToken` extends it while it is still active; once it has expired, renewing it fails.
  - `POST auth.dhan.co/app/generateAccessToken` with the client ID, PIN and TOTP. It runs unattended, but only if the server keeps the PIN and the TOTP seed.
  - An API key and secret, valid for 12 months, with a browser consent each time a token is made: consent, then login, then consume. 25 consents a day.
  - A partner flow.
- **Cost:** the Trading API (portfolio, positions and funds) is free. The Data API is ₹499 plus tax a month [off] ([FAQ](https://dhan.co/support/platforms/dhanhq-api/is-the-dhanhq-data-api-subscription-free-if-i-execute-a-minimum-number-of-trades-every-month/)).
- **Reads:** portfolio and positions, funds, statements, the order and trade books, and historical data from a scrip's inception for daily candles [off] ([historical](https://dhanhq.co/docs/v2/historical-data/)).
- **Rate limits:** 20 a second for non-trading calls, 5 a second for data and 1 a second for quotes [off] ([v2](https://dhanhq.co/docs/v2/)).
- **Static IP:** "only required while using Order Placement APIs" [off]. Adding an IP after a token was issued means making a new token (error DH-905).
- **SDKs:** `dhanhq` on PyPI (MIT, v2). The npm package is v1 and stale [3p].

### Upstox (v2 and v3)

- **Sign-in:** OAuth 2.0 authorisation code. The token lasts until 3:30 the next morning [off] ([get-token](http://upstox.com/developer/api-documentation/get-token/)). There is no refresh token [staff].
- **Analytics Token:** self-serve, valid one year, GET only. The Portfolio, User, Mutual Fund and P&L calls need a whitelisted static IP [off] ([analytics token](https://upstox.com/developer/api-documentation/analytics-token/)).
- **Cost:** REST and WebSocket appear to be free [staff].
- **Reads:** holdings, positions, funds, orders and trades. Daily candles go back to Jan 2000 [off].
- **Rate limits:** 50 a second, 500 a minute [off] ([limits](http://upstox.com/developer/api-documentation/rate-limiting/)).
- **Watch out:** from 1 Apr 2026 a user can have only one active API app, and older apps are deleted [off] ([announcement](https://community.upstox.com/t/important-new-sebi-exchange-mandates-for-api-trading-effective-1st-april-2026/14822)). If the investor uses another tool on Upstox, Maester would take its place.
- **SDKs:** `upstox-python-sdk` and `upstoxjsclient` on npm. Their licences were not checked.

### Groww Trade API

- **Sign-in:** either an API key and secret, which "Requires daily approval" on the Groww Cloud API Keys page, or an API key and TOTP. The access token lasts a day; its exact lifetime is not documented [off] ([SDK](https://groww.in/trade-api/docs/python-sdk)).
- **Cost:** ₹499 a month plus tax, required even to read holdings [off] ([trade-api](https://groww.in/trade-api)).
- **Reads:** holdings, positions, margin, the order and trade lists, quotes and candles [off].
- **Rate limits:** 20 a second and 500 a minute for non-trading calls; 150 token generations a day [off].
- **Static IP:** orders only [off] ([blog](https://groww.in/blog/static-ip-api-trading-setup)).
- **SDKs:** Python only (`growwapi`).

### Fyers API v3

- **Sign-in:** an app ID and secret, then a redirect that returns an auth code, which is exchanged for a token. Tokens expire at 6:30 every morning [off] ([token](https://fyers.in/api-docs/v3/api/authentication/third-party-app/generate-access-token/)). The 15-day refresh token is going away: users must "Complete 2FA once every trading day" [off] ([Fyers KB](https://support.fyers.in/portal/en/kb/articles/what-are-the-new-sebi-rules-for-retail-algo-trading-from-april-01-2026)).
- **Cost:** the Standard plan is free. Its limits are 10 a second and 200 a minute for user APIs. Going over the per-minute limit 3 times in a day blocks the app for the rest of the day [off] ([plans](https://fyers.in/api-docs/v3/getting-started/plans-and-limits/)).
- **Static IP:** orders only [off].
- **SDKs:** `fyers-apiv3` on PyPI (MIT).

### ICICI Direct Breeze

- **Sign-in:** an API key and secret, plus a session token from `api.icicidirect.com/apiuser/login?api_key=`. The token lasts 24 hours or until midnight, whichever comes first [off] ([iLearn](https://icicidirect.com/ilearn/stocks/articles/what-is-a-session-key-and-how-to-generate-it-for-using-breezeapi)).
- **Cost:** free, historical data included [off].
- **Reads:** holdings (filterable by date), positions, funds, orders and trades.
- **Rate limits:** 100 a minute, 5,000 a day [off].
- **Static IP:** orders only [off].
- **SDKs:** `breeze-connect` (MIT) and `breezeconnect` on npm.

### 5paisa Xstream

- **Sign-in:** OAuth, with a request token that lasts 60 minutes, or a TOTP and MPIN login for individuals. The access token is "valid throughout a day" [off] ([docs](https://xstream.5paisa.com/dev-docs/user-authentication-system/access-token)).
- **Static IP:** "applies only to Order Placement APIs" [off].
- **Not verified:** cost and read rate limits.

### Angel One SmartAPI

- **Sign-in:** `generateSession(clientcode, PIN, TOTP)`. The token expires at midnight [staff]. OAuth was announced as coming "soon" [staff] ([forum](https://smartapi.angelone.in/smartapi/forum/post/18268)).
- **Cost:** free, according to a scraped mirror only [3p].
- **Static IP:** orders only [off].

### Kotak Neo

- **Sign-in:** a consumer key, then `totp_login` (mobile number, UCC and TOTP), then `totp_validate` (MPIN). TOTP is the only way to sign in [off] ([migration guide](https://www.kotakneo.com/uploads/API_Migration_guide_03_12_2025_accfccef45.pdf)).
- **Cost:** "completely free" [off].
- **Static IP:** the portfolio and report APIs "will continue to work normally regardless of IP" [off] ([static IP](https://www.kotakneo.com/platform/kotak-neo-trade-api/static-ip-details/)).

### Thinner coverage

- **HDFC Sky:** a key, a secret, a redirect URL and a mandatory primary static IP on the app [3p] ([OpenAlgo](https://docs.openalgo.in/connect-brokers/brokers/hdfc-sky)).
- **Motilal Oswal:** a login with password, TOTP and date of birth [3p].
- **Paytm Money:** a key and secret, then a request token, then a read-only access token. Free; tokens expire at midnight [3p, dated].
- **Shoonya (Finvasia):** a login with the password hash and TOTP [3p].

## Holdings across all brokers: the CAS

- One depository Consolidated Account Statement per PAN covers NSDL and CDSL demat holdings and mutual fund folios. It arrives monthly when something moved, otherwise every half year [off] ([CDSL FAQ](https://www.cdslindia.com/CAS/FAQ.html), [NSDL FAQ](https://investor.nsdl.com/portal/en/kb/articles/faqs-on-cas-26-10-2023)).
- The PDF is locked with the PAN, in capitals.
- **casparser** (MIT, Python) reads CAMS, KFintech, NSDL and CDSL statements into typed JSON, with decimals as strings. A demat CAS gives holdings only, no transactions. Only the original PDF from the issuer is supported [off] ([GitHub](https://github.com/codereverser/casparser)).
- **Account Aggregators:** CDSL and NSDL provide equity data through Account Aggregators [off], but the recipient must be a regulated entity [off] ([Sahamati](https://sahamati.org.in/financial-information-user-fiu)). Not usable here.

## Comparison

| Broker | Sign-in | A sign-in lasts | Cost to read holdings | Static IP for reads |
| --- | --- | --- | --- | --- |
| Zerodha | Broker's page | Until 6:00 next day | Free (Personal) | No |
| Dhan | Pasted token, renewed by Maester (or the broker's page) | 24 hours, renewable | Free (Trading API) | No |
| Upstox | Broker's page | Until 3:30 next day | Free | No (yes for the Analytics Token) |
| Fyers | Broker's page | Until 6:30 next day | Free (Standard) | No |
| ICICI Direct | Broker's page | 24 h or midnight | Free | No |
| 5paisa | Broker's page | The day | Not verified | No |
| Groww | Approve daily in Groww Cloud | A day | ₹499 a month | No |
| Angel One | PIN + TOTP | Until midnight | Free [3p] | No |
| Kotak Neo | TOTP + MPIN | Not found | Free | No |

## Could not verify

- The text of the SEBI circular and of NSE/INVG/67858.
- Angel One: its pricing and current rate limits.
- Upstox: whether API orders carry a per-order fee, and its SDK licences.
- Groww: the exact access-token lifetime. Kotak: the session lifetime.
- 5paisa: cost and read rate limits.
- HDFC Sky, Motilal Oswal, Paytm Money and Shoonya, from first-party docs.
