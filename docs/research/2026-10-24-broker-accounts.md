# Several broker accounts: the top five brokers, per account

Researched 24 Oct 2026, for a personal, read-only use: one household's holdings across several accounts, some at the same broker. This page fills the gaps in [`2026-10-19-broker-apis.md`](2026-10-19-broker-apis.md) and does not repeat it. Tags: [off] broker or regulator docs, [staff] broker employee on its forum, [3p] third party. [staff?] marks a poster who answers as the broker but shows no badge.

The round-2 directions on the "Maester Broker Accounts" canvas (<https://claude.ai/artifact/3kUub9WRnmnm2neMpGkmNy>) and the plan in [`docs/superpowers/plans/2026-10-24-broker-accounts.md`](../superpowers/plans/2026-10-24-broker-accounts.md) rest on this page. When a fact changes, change it here first, then `accounts-brokers.mjs` in the design kit.

## What the investor gives Maester, per account

| Broker | Once, per account | Each day | A sign-in lasts | Cost to read holdings | Several accounts |
| --- | --- | --- | --- | --- | --- |
| Groww | A Trade API subscription and an API key and secret (or a TOTP key), made in that person's Groww login | Approve the key on Groww Cloud | Until 6:00 the next morning | ₹499 a month + GST, an early-bird price against a listed ₹2,000 | Its own subscription and key (inferred) |
| Zerodha | A free Personal app with the client ID and Maester's redirect URL: API key and secret | Sign in on Zerodha's page (own login and code) | Until 6:00 the next morning | Free | One developer login can serve the family; one app per client ID is the safe reading |
| Angel One | A SmartAPI app (API key), the client code, the authenticator turned on | Type the MPIN and the 6-digit code | Until midnight | Free | Probably its own key |
| ICICI Direct | A new Breeze app (keys before 1 Oct 2025 were deleted): key, secret, redirect URL, a static IP on the form | Sign in on ICICI Direct's page | 24 hours, or midnight if sooner | Free | Assumed its own app |
| Upstox | An app with a redirect URI: key and secret; one app per person | Sign in on Upstox's page | Until 3:30 the next morning | Free | Its own app, which replaces any other tool's |

What this means for Maester:

1. **An account, not a broker, is the unit.** Every broker ties a key to one person's account, so Maester keeps one key and one day's token per account, and asks whose account it is.
2. **Every account signs out daily.** Six accounts can mean six sign-ins a morning. How the page carries that cost is the main design question.
3. **Angel One needs a new sign-in kind:** the MPIN and an authenticator code, typed each day and never kept. Keeping them would let Maester sign in alone; this page does not recommend it.
4. **ICICI Direct's app form asks for a static IP**, though the rule covers orders only. Hosting is undecided; the first live run will show whether the form accepts the API's address.
5. **ICICI Direct needs a join:** quantity and ISIN come from one call, average price from another keyed by ICICI's stock code.
6. **Groww's price may rise** from ₹499 to ₹2,000 a month per account.
7. **Mutual funds:** only Zerodha and Upstox give them by API. Groww, the largest mutual-fund platform, does not; the CAS stays the way to cover them.

## 1. Top five brokers by NSE active clients, September 2026

NSE's member-wise file was not opened directly; these are reports citing it, published 8 to 14 Oct 2026.

| # | Broker | Active clients, Sep 2026 | Change on Aug | NSE share |
| --- | --- | --- | --- | --- |
| 1 | Groww (Billionbrains / Nextbillion) | 1.345 crore (13.45 m) | +1,00,961 | 29.16% |
| 2 | Zerodha | 67.92 lakh | −5,313 | 14.73% |
| 3 | Angel One | 67.56 lakh | +36,956 | 14.65% |
| 4 | ICICI Securities (ICICI Direct) | 21.60–21.61 lakh | +4,410 | n/a |
| 5 | Upstox | 18.54 lakh | −10,343 | n/a |
| 6 | Kotak Securities | 13.92 lakh | ~flat | n/a |
| 7 | HDFC Securities | 13.54 lakh | +2,532 | n/a |
| 8 | Dhan | 11.21 lakh | +13,624 | n/a |
| – | SBI Securities | 10.21 lakh | −22,525 | n/a |

Industry: about 4.61 crore NSE active clients. "Active" means traded at least once in the trailing 12 months.

Sources [3p]: [Inc42, 14 Oct 2026](https://inc42.com/buzz/brokers-in-september-groww-strengthens-lead-angel-one-closes-in-on-zerodha/); [CNBC TV18 via TradingView, 8 Oct 2026](https://www.tradingview.com/news/cnbctv:5848d4f9b094b:0/); [CXO Digital Pulse](https://www.cxodigitalpulse.com/?p=63189) (Kotak 13.92 lakh). One outlet (Whalesbook) gives Angel One as 6.76 m; Inc42's 67.56 lakh is used.

So the five are Groww, Zerodha, Angel One, ICICI Securities and Upstox. Kotak is 6th and Dhan 8th.

## 2. What the investor must provide, per broker, to read holdings

### Zerodha (Kite Connect, Personal plan)

- **One-off:** sign up at developers.kite.trade; My Apps → Create New App → type Personal; fields "app name, Zerodha client ID, redirect URL, and optional postback URL" [off] ([FAQ](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/kite-connect-api-faqs)). Gives api_key + api_secret (secret stays on the server).
- **Every day:** the investor signs in on kite.zerodha.com (user ID, password, TOTP/app code) through the redirect; Maester exchanges the request_token. The access token "expires at 6 AM on the next day (regulatory requirement)"; a new session on the same key invalidates the old token [off] ([login](https://kite.trade/docs/connect/v3/user/), FAQ).
- **Cost:** Personal free (portfolio included, no market data); Connect ₹500 per app per month. New from Oct 2026: Connect users with ≥₹2,000 brokerage in a month get 500 Developer Credits toward the next renewal [off] ([charges](https://support.zerodha.com/category/trading-and-markets/kite-web-and-mobile/kite-api/articles/what-are-the-charges-for-kite-apis)).
- **Multi-account: one app = one client ID.**
  - Developer-console fine print, quoted by a user: "By default, the API is restricted to a single Zerodha user ID. If you want multi-user login support, please e-mail us." [off, via user quote] ([forum](https://kite.trade/forum/discussion/comment/52920/)). Logging another client ID into the app fails with "The user is not enabled for the app".
  - "You can log in only with the client ID associated with your Kite Connect app. For using multiple users you have to take multiple subscriptions." (Sree, Jun 2024) [staff?] ([forum](https://kite.trade/forum/discussion/14186/multi-account-login)).
  - "You can create multiple apps, each associated with a different Zerodha client id, however, you have to pay separately for each app" (salim_chisty, Nov 2025) [staff?] ([forum](https://kite.trade/forum/discussion/comment/51305/)). "Pay separately" is about Connect; a Personal app is free, so a family member's Personal app should cost nothing, but no first-party page says a Personal app can be created for a family member's client ID from your developer account. Not verified.
  - "Kite Connect is by default given only for single user… you will need to create multiple apps." (sujith, Mar 2023) [staff] ([forum](https://kite.trade/forum/discussion/12493/multiple-user)).
  - Zerodha's static-IP page (first-party, the newest text) describes a family set-up: "Use a single developer account for all family members", create separate apps, "Add all relevant client IDs (yours and your family members') to each app" (spouse, dependent children, dependent parents) [off] ([static IP](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip)). Read literally, one app can hold several family client IDs.
  - Staff on the NSE-circular thread support the other reading. Asked whether one developer account can hold "multiple apps… each one mapped to a different zerodha account", Matti answered "Yes." (Jul 2025) [staff] ([forum 15350](https://kite.trade/forum/discussion/15350/notes-on-the-nse-circular-prescribing-operating-procedures-for-api-usage)). Moderator Nivas: under one developer account you can create multiple apps, each mapped to a different client ID, e.g. one for you and one with your spouse's client ID [staff] ([forum 15873](https://kite.trade/forum/discussion/15873/regarding-market-protection-and-static-ip)). Users report "seven different apps on my profile, corresponding to seven different Zerodha accounts (just my family)" [3p].
  - Bottom line, two readings. (a) Zerodha's own wording: family client IDs may be added to one app. (b) Staff and practice: one app per family client ID, all under one developer account; Personal apps are free, so this costs nothing. Not settled; the developer console would show whether an app accepts a second client ID. What holds either way: one developer account can serve the family, and each family member must sign in on Kite with their own credentials and TOTP every day; Maester gets one access token per member.

### Groww (Trade API)

- **One-off:** an active Trading API subscription, bought from the Trading APIs page in the investor's own Groww profile; then Groww Cloud → API Keys → "Generate API key" (name it; copy key + secret), or "Generate TOTP token" (key + TOTP secret/QR) [off] ([Python SDK](https://groww.in/trade-api/docs/python-sdk), [curl](https://groww.in/trade-api/docs/curl)).
- **Three auth routes** [off] ([curl](https://groww.in/trade-api/docs/curl)):
  1. An access token generated on the web page ("Expires daily at 6:00 AM").
  2. Key + secret: POST `/v1/token/api/access` with `key_type: approval`, checksum SHA-256(secret + epoch). "Requires daily approval on Groww Cloud Api Keys Page."
  3. Key + TOTP: `key_type: totp`. The curl docs say this also needs daily approval; the Python SDK page labels the TOTP route "No Expiry". This conflicts. Most likely "No Expiry" means the TOTP key, not the access token. Not verified.
- 150 token generations per 24 h [off].
- **Cost/pricing change:** ₹499 + tax a month, now shown as an "EARLY BIRD OFFER" struck against ₹2,000. No end date is given, so the price may rise to ₹2,000 [off] ([trade-api](https://groww.in/trade-api)). No eligibility approval to subscribe: "Anyone with a Groww account!" [off]. The changelog has no 2026 entries (latest 2 Dec 2025) [off] ([changelog](https://groww.in/trade-api/docs/curl/changelog)).
- **Multi-account:** no first-party statement. The subscription and keys are created inside one Groww login's profile, so they act for that account. In practice each family account needs its own subscription (₹499 each) and key. Inference, not verified.

### Angel One (SmartAPI)

- **One-off:** sign up at smartapi.angelone.in (no client ID needed at signup) → Create an App (type, e.g. Trading APIs) → App name, Redirect URL, optional Postback URL, optional Angel client ID → API key + secret. Page updated 17 Jul 2026 [off] ([knowledge center](https://www.angelone.in/knowledge-center/smartapi/how-to-generate-smartapi-key-and-install-python-on-your-machine)). Enable TOTP for the account (QR from SmartAPI portal) [3p/earlier doc].
- **Every day:** `loginByPassword` with client code + 4-digit MPIN + current TOTP. Everyone is logged out at midnight: "All users will be logged out daily at 12 midnight for both old and new API keys." [staff, admin] ([forum 5352](https://smartapi.angelone.in/smartapi/forum/topic/5352/static-ip-based-api-keys-now-live-old-flow-still-supported-temporarily)). A redirect "publisher login" (`publisher-login?api_key=…&state=…`, returns auth_token and feed_token to the app's redirect URL) is in the docs [off, via search snippet of smartapi.angelbroking.com/docs]; one user reply says Publisher APIs are "no longer supported" in the "New Login" [3p, unverified].
- **Cost:** free ("quick, easy and FREE APIs" on smartapi.angelone.in) [off].
- **Multi-account:** unclear, leaning one key per client.
  - Client ID is optional on the app form, which historically let one key log in other client codes. A pre-2026 moderator said multiple accounts can log in from one machine (deleted topic) [staff] ([forum 4876](https://smartapi.angelone.in/smartapi/forum/topic/4876/multi-login)). That answer did not mention keys.
  - Since the SEBI rules: "only 1 API key can be used for non registered, client generated algos" [staff, admin] ([forum 5254](https://smartapi.angelone.in/smartapi/forum/topic/5254), now deleted). A user there describes the current rule as one SmartAPI profile = one trading account [3p].
  - Static IP: "can only be mapped to one client at a time"; family sharing needs "a formal written request and 2FA validation" [off] ([Angel, Apr 2026](https://www.angelone.in/news/market-updates/what-s-changing-in-angel-one-s-smartapi-access-from-april-1-2026)).
  - Not verified whether one key can still read another family member's holdings. Even if it can, Maester would need that member's MPIN and TOTP each day.

### ICICI Securities (ICICI Direct Breeze)

- **One-off:** log in to the Breeze API portal → "Register an App": App name, Redirect URL (docs suggest https://127.0.0.1), primary static IP (optional secondary) → AppKey + secret key. All keys made before 1 Oct 2025 were deleted; a new key is needed [off] ([Breeze docs](https://api.icicidirect.com/breezeapi/documents/index.html), [ICICI FAQ](https://www.icicidirect.com/faqs/fno/how-do-i-create-an-api-key-after-the-implementation-of-the-new-protocols-mentioned-in-the-circular)).
- **Every day:** open `api.icicidirect.com/apiuser/login?api_key=…`, the investor signs in on ICICI's page; the API_Session in the redirected address goes to `customerdetails` for a session_token. It "expires in 24 hours after generation or at midnight" [off]. Each request is signed with a checksum (timestamp within 60 s) [off].
- **Login change:** none found since the 19 Oct doc beyond the key reissue and static IP for orders. ICICI says the static-IP rule applies "only… while trading via Breeze API" [off]. No OAuth change found.
- **Cost:** free [off, earlier doc].
- **Multi-account:** "Each client can have multiple API keys as per the circular, however for unregistered algos (Breeze API) the client is restricted to route orders via single API key" [off, via search snippet of ICICI regulatory notes]. Nothing found on one key reading another client's account. Not verified; assume one key per client.

### Upstox

- **One-off:** Upstox Developer Apps → create app (API key = client_id, secret, Redirect URI exactly matching the login request, optional notifier URL) [off] ([auth](https://upstox.com/developer/api-documentation/authentication/)). Only one active API app per user since 1 Apr 2026; older ones deleted [off, Team Upstox] ([announcement](https://community.upstox.com/t/important-new-sebi-exchange-mandates-for-api-trading-effective-1st-april-2026/14822)).
- **Every day:** OAuth sign-in on upstox.com; token lasts to 3:30 next morning [off, earlier doc]. Alternative: Analytics Token, 1 year, GET only, "Only one Analytics Token is permitted per account at a time", but Portfolio and Mutual Fund calls with it need a whitelisted static IP [off] ([analytics token](https://upstox.com/developer/api-documentation/analytics-token/)).
- **Cost:** free [staff, earlier doc].
- **Multi-account: no.** "An Indie app, created from your Upstox profile, is intended for individual use, meaning it is linked to your user account and cannot be accessed by other users"; multi-client needs a Business API application (shanmu, Jul 2024) [staff?] ([forum](https://community.upstox.com/t/not-able-to-get-the-token-for-users-other-than-myself/6225)). Each family member creates their own app (and that becomes their one allowed app). Static IP can be shared among family members since 7 May 2026 (Pradeep_Jaiswar) [staff?], which also implies one app per member.

## 3. Changes since the 19 Oct doc

- **Angel One OAuth:** not shipped, as far as could be found. Admin said "OAuth will be live soon" in 2025 (topics 5254, 5352); no admin topic since mentions OAuth, the docs pages are JS-rendered and could not be read, and smartapi-python has no releases listed. Login is still client code + MPIN + TOTP.
- **ICICI Breeze:** no login change found; keys reissued for the static-IP regime (orders only).
- **Groww:** price shown as early-bird ₹499 against ₹2,000 (risk of increase); no approval gate; access token expires 6:00 AM daily; no changelog entry in 2026.
- **Zerodha:** Developer Credits for Connect from Oct 2026 (not relevant to Personal).
- **Upstox:** Mutual Fund API suite launched 27 Apr 2026 (see 5).

## 4. Holdings fields

| Field | Zerodha `/portfolio/holdings` | Groww `/v1/holdings/user` | Angel `getHolding` / `getAllHolding` | ICICI Breeze | Upstox `/v2/portfolio/long-term-holdings` |
| --- | --- | --- | --- | --- | --- |
| ISIN | `isin` | `isin` | `isin` | `stock_ISIN` in demat holdings only; portfolio holdings has `stock_code` | `isin` |
| Quantity | `quantity` (settled) | `quantity` | `quantity` | `quantity` (both endpoints) | `quantity` |
| T1 quantity | `t1_quantity` | `t1_quantity` | `t1quantity` | none named | `t1_quantity` |
| Pledged / collateral | `collateral_quantity`, `collateral_type`, `mtf{}` | `pledge_quantity`, `repledge_quantity`, demat/groww locked | `collateralquantity`, `collateraltype`, `haircut` | `blocked_quantity`, `demat_allocated_quantity` | `collateral_quantity`, `haircut` |
| Average price | `average_price` | `average_price` (₹) | `averageprice` | `average_price` in portfolio holdings only | `average_price` |
| Last price | `last_price`, `close_price` | **none** (use Live Data) | `ltp`, `close` | `current_market_price` (portfolio holdings) | `last_price`, `close_price` |

Sources [off]: [Kite portfolio](https://kite.trade/docs/connect/v3/portfolio/), [Groww portfolio](https://groww.in/trade-api/docs/curl/portfolio), [Angel forum 4006](https://smartapi.angelone.in/smartapi/forum/topic/4006) (admin release note, fields from the example response), [Breeze docs](https://api.icicidirect.com/breezeapi/documents/index.html), [Upstox holdings](https://upstox.com/developer/api-documentation/get-holdings/).

Quantity and average cost are available at all five. Caveats: Breeze splits them (ISIN + quantity in `dematholdings`; average price + market price keyed by `stock_code` in `portfolioholdings`, which needs `exchange_code`), so joining needs the stock-code→ISIN map. Groww has no last price on holdings. Groww's docs disagree on types (curl: quantity integer, average_price decimal; SDK page reversed). Types were not checked against live responses at any broker; parse every figure to a decimal from the raw response text. Zerodha's total held is `quantity + t1_quantity` (+ `mtf.quantity`) per forum discussion [3p].

## 5. Mutual fund holdings via API

- **Zerodha (Coin):** yes, `GET /mf/holdings`: folio, fund, tradingsymbol (= ISIN), quantity (units), average_price, last_price (NAV), last_price_date, pnl, pledged_quantity [off] ([MF docs](https://kite.trade/docs/connect/v3/mutual-funds/)). Whether a free Personal app may call it: not stated; not verified.
- **Upstox:** yes, since 27 Apr 2026: `GET /v2/mf/holdings`: instrument_key (ISIN), folio, fund, quantity, average_price, last_price (NAV), last_price_date, pnl, pledged_quantity [off] ([MF holdings](https://upstox.com/developer/api-documentation/get-mutual-fund-holdings/), [launch](https://community.upstox.com/t/mutual-fund-holding-support-with-api/14101)). Docs say "mutual fund routes must be enabled for your API subscription" [off]; with the Analytics Token it needs a static IP [off].
- **Groww:** no MF endpoint in the Trade API docs or changelog [off]. Groww is the biggest MF platform, so this is a real gap: use the CAS.
- **Angel One:** no; "we do not support mutual funds via smartAPIs" (admin, undated) [staff] ([forum](https://smartapi.angelone.in/smartapi/forum/post/18384)).
- **ICICI Breeze:** no MF endpoint in the docs (only an `mf_holding_mode_popup_flg` flag in customer details) [off].

## Could not verify

- NSE's own member-wise active-client file (only press reports).
- Zerodha: whether one app accepts several family client IDs (support page) or each needs its own app (staff); whether `/mf/holdings` works on Personal.
- Groww: any first-party statement on multiple accounts; whether the TOTP route avoids daily approval.
- Angel One: whether one API key can still log in several client codes after Apr 2026; whether the publisher (redirect) login still works; holdings docs (JS-rendered).
- ICICI Breeze: whether one key can read another client's account; the exact Breeze FAQ answers on multiple keys and family IP.
- Forum posters' staff status where no badge shows (Sree, salim_chisty, shanmu, Pradeep_Jaiswar).
