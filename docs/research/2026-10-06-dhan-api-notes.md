# Dhan and FRED API notes for market mood

Checked 6 October 2026. No credentials were used and no live API call was made.

Every fact has one of two sources:

- **CSV**: from the scrip master CSV (downloaded 6 Oct 2026 from `https://images.dhan.co/api-data/api-scrip-master.csv`, 25.6 MB, 203,296 rows, not committed).
- **Docs**: from docs, not yet called live. Sources: `https://dhanhq.co/docs/v2/` (historical-data, option-chain, annexure, authentication pages) and `https://fred.stlouisfed.org/docs/api/fred/series_observations.html`.

Live calls happen later (Task 7 Step 4, after Task 9b, with the user's own keys). Treat every "Docs" fact as a hypothesis until then.

## Breaks the spec

Nothing is proven to break the spec. Three docs facts are risks. Check them first when live calls start.

1. **Index daily history is not confirmed.** The historical-data page says daily data goes back "upto the date of its inception". It does not say that `IDX_I` / `INDEX` is supported. It shows only an `NSE_EQ` / `EQUITY` example. If `IDX_I` returns nothing or an error, NIFTY 50 and INDIA VIX history needs another source. (Docs)
2. **A token lasts 24 hours.** Renewal exists (`GET /v2/RenewToken`) but works only on an active token. "If you try to renew an expired token, it will return an error." A worker that misses one day needs a new token from the user. The planned `DHAN_TOKEN_EXPIRED` path and the renew message in Settings must be real. The worker should renew while the token is still active (for example once a day). (Docs)
3. **Daily end date is non-inclusive.** `toDate` is not included. To get today's candle, send tomorrow's date. (Docs)

## Instruments (CSV)

Columns of the CSV, in order: `SEM_EXM_EXCH_ID, SEM_SEGMENT, SEM_SMST_SECURITY_ID, SEM_INSTRUMENT_NAME, SEM_EXPIRY_CODE, SEM_TRADING_SYMBOL, SEM_LOT_UNITS, SEM_CUSTOM_SYMBOL, SEM_EXPIRY_DATE, SEM_STRIKE_PRICE, SEM_OPTION_TYPE, SEM_TICK_SIZE, SEM_EXPIRY_FLAG, SEM_EXCH_INSTRUMENT_TYPE, SEM_SERIES, SM_SYMBOL_NAME`.

The CSV uses one-letter segment codes. The API uses names. Map them:

| CSV exchange + segment | API `exchangeSegment` |
| --- | --- |
| NSE, I | `IDX_I` |
| NSE, E | `NSE_EQ` |
| MCX, M | `MCX_COMM` |

| Instrument | securityId | exchangeSegment | instrument | CSV row evidence |
| --- | --- | --- | --- | --- |
| NIFTY 50 | `13` | `IDX_I` | `INDEX` | `NSE,I,13,INDEX,0,NIFTY,...,Nifty 50` |
| INDIA VIX | `21` | `IDX_I` | `INDEX` | `NSE,I,21,INDEX,0,INDIA VIX,...,India VIX` |
| GOLD near month (on 6 Oct 2026) | `495213` (GOLD-04Dec2026-FUT) | `MCX_COMM` | `FUTCOM` | `MCX,M,495213,FUTCOM,0,GOLD-04Dec2026-FUT,...,2026-12-04 23:30:00` |

Notes:

- The NIFTY 50 trading symbol in the CSV is `NIFTY`, custom symbol `Nifty 50`. There is no row called "NIFTY 50" as a trading symbol. Match on `SEM_SMST_SECURITY_ID` `13`, not on a name.
- Other GOLD futures in the CSV (6 Oct 2026): 559933 (Feb 2027), 569424 (Apr 2027), 575691 (Jun 2027), 582365 (Aug 2027). The October 2026 contract has already expired and is not listed. Match `SM_SYMBOL_NAME` exactly `GOLD`. `GOLDM`, `GOLDGUINEA`, `GOLDPETAL` and `GOLDTEN` are different contracts.
- The GOLD security id changes at every expiry. A hard-coded id goes stale. For a continuous series, use `expiryCode` instead (next section).
- `SEM_EXPIRY_CODE` is `0` on every row of the CSV (203,296 rows). It is not usable to pick a month. `expiryCode` is a request field, not a CSV filter. (CSV)
- `expiryCode` values: `0` current or near expiry, `1` next expiry, `2` far expiry. So `expiryCode: 0` selects the near month for a continuous series. (Docs, annexure)
- A GOLD request needs one valid GOLD security id (any listed GOLD future) plus `expiryCode`. Which id the docs expect for a continuous series is not stated. Confirm live. (Docs, gap)

### Mapping an NSE trading symbol to a security id (CSV)

Filter rows with `SEM_EXM_EXCH_ID = NSE`, `SEM_SEGMENT = E`, `SEM_INSTRUMENT_NAME = EQUITY`, `SEM_SERIES = EQ`. Match the symbol on `SEM_TRADING_SYMBOL`. Take the id from `SEM_SMST_SECURITY_ID`. The company name is in `SM_SYMBOL_NAME` (upper case, abbreviated) and `SEM_CUSTOM_SYMBOL`.

The CSV has 2,707 NSE `EQ` rows. Sample rows:

| SEM_TRADING_SYMBOL | SEM_SMST_SECURITY_ID | SEM_SERIES | SM_SYMBOL_NAME |
| --- | --- | --- | --- |
| RELIANCE | `2885` | EQ | RELIANCE INDUSTRIES LTD |
| TCS | `11536` | EQ | TATA CONSULTANCY SERV LT |
| HDFCBANK | `1333` | EQ | HDFC BANK LTD |

Raw rows:

```
NSE,E,2885,EQUITY,0,RELIANCE,1.0,Reliance Industries,,,,10.0000,NA,ES,EQ,RELIANCE INDUSTRIES LTD
NSE,E,11536,EQUITY,0,TCS,1.0,Tata Consultancy Services,,,,10.0000,NA,ES,EQ,TATA CONSULTANCY SERV LT
NSE,E,1333,EQUITY,0,HDFCBANK,1.0,HDFC Bank,,,,5.0000,NA,ES,EQ,HDFC BANK LTD
```

## Daily history (Docs)

- `POST https://api.dhan.co/v2/charts/historical`. The docs list `/charts/historical` under the v2 base.
- Headers: `Content-Type: application/json`, `access-token: <JWT>`. The historical page lists only `access-token`. The option chain page also requires `client-id`. Send both on every call.
- Body: `securityId` (string), `exchangeSegment` (name), `instrument`, `expiryCode` (optional, derivatives), `oi` (optional boolean), `fromDate`, `toDate`.
- Date format: `YYYY-MM-DD`. `toDate` is non-inclusive.
- Range limit: daily has no stated limit ("back upto the date of its inception"). The 4-year-in-one-call question is not answered by the docs. Test live. The 90-day limit applies to intraday only.
- Response: arrays `open`, `high`, `low`, `close`, `volume`, `timestamp`, and `open_interest` when `oi` is true. One value per candle at the same array index.
- Timestamp: integer epoch seconds. The example value `1326220200` is 2012-01-10 18:30:00 UTC, which is 2012-01-11 00:00 IST. So a daily candle is stamped at IST midnight. Convert with the Asia/Kolkata zone, not UTC. The docs do not state the zone. This is an inference from the example. Confirm live.
- Holidays: the docs say nothing. Expect no candle for a non-trading day. Confirm live.

## Option chain (Docs)

Headers on both calls: `Content-Type: application/json`, `access-token`, `client-id` (both required).

1. `POST https://api.dhan.co/v2/optionchain/expirylist`, body `{ "UnderlyingScrip": 13, "UnderlyingSeg": "IDX_I" }`. Response: `{ "data": ["2024-10-17", "2024-10-24", ...], "status": "success" }`. `data` is an array of `YYYY-MM-DD` strings. The first one is assumed nearest. Confirm live.
2. `POST https://api.dhan.co/v2/optionchain`, body `{ "UnderlyingScrip": 13, "UnderlyingSeg": "IDX_I", "Expiry": "<date from step 1>" }`.

Note: `UnderlyingScrip` is a number here. `securityId` in the history call is a string.

Response paths per strike (the strike is the object key under `data.oc`):

| Value | Path |
| --- | --- |
| Call open interest | `data.oc.{strike}.ce.oi` |
| Put open interest | `data.oc.{strike}.pe.oi` |
| Call last price | `data.oc.{strike}.ce.last_price` |
| Put last price | `data.oc.{strike}.pe.last_price` |
| Greeks | `data.oc.{strike}.ce.greeks` and `.pe.greeks` (delta, theta, gamma, vega) |

Rate limit: one unique request every 3 seconds per underlying and expiry. Sum `oi` over all strikes for put-call ratio. Strike keys may be decimal strings such as `"25000.000000"`. Parse them as numbers. (Inference, confirm live.)

## Limits and errors (Docs)

| API group | Per second | Per minute | Per hour | Per day |
| --- | --- | --- | --- | --- |
| Data APIs (historical, option chain) | 5 | none stated | none stated | 100,000 |
| Quote APIs | 1 | unlimited | unlimited | unlimited |
| Non-trading APIs | 20 | unlimited | unlimited | unlimited |
| Order APIs | 10 | 250 | 1,000 | 7,000 |

The market mood needs far fewer calls than these limits. The option chain 3-second rule is the tight one.

Error body shape: `{ "errorType": "", "errorCode": "", "errorMessage": "" }`.

Codes that matter:

| Code | Meaning (docs wording) |
| --- | --- |
| `DH-901` | Client ID or user-generated access token is invalid or expired |
| `DH-902` | No Data API subscription, or no access to Trading APIs |
| `DH-904` | Too many requests, rate limit breached |
| `DH-905` | Missing required fields or bad values |
| `805` | Too many requests or connections. More may block the user |
| `806` | Data APIs not subscribed |
| `807` | Access token is expired |
| `810` | Client ID is invalid |
| `811` | Invalid expiry date |
| `812` | Invalid date format |
| `813` | Invalid securityId |
| `814` | Invalid request |

Gaps:

- The docs do not give the HTTP status for an invalid token. Expect 401, but the docs do not say so. Match on the error code (`DH-901`, `807`) as well as the status. The Task 5 test already plans for both.
- The wrong-token test was not run. Run it live with a deliberately wrong token.
- Treat `DH-902` and `806` as "Data API not subscribed", not as "token expired".

## Token and profile (Docs)

- Validity: 24 hours for a web-generated token (web.dhan.co), for a token from the API key and secret consent flow, and for a TOTP token.
- API key and secret last 12 months. Each access token from them still lasts 24 hours.
- Renew: `GET https://api.dhan.co/v2/RenewToken` with headers `access-token: <JWT>` and `dhanClientId: <client id>`. It gives another 24 hours. It works only on a token that is still active. An expired token returns an error (body not documented).

Profile endpoint, for the Settings feature:

| Item | Value |
| --- | --- |
| Method and path | `GET https://api.dhan.co/v2/profile` |
| Headers | `access-token: <JWT>` (the docs example shows only this one) |
| Body | none |

Response example (from the docs):

```json
{
  "dhanClientId": "1100003626",
  "tokenValidity": "30/03/2025 15:37",
  "activeSegment": "Equity, Derivative, Currency, Commodity",
  "ddpi": "Active",
  "mtf": "Active",
  "dataPlan": "Active",
  "dataValidity": "2024-12-05 09:37:52.0"
}
```

| Question | Field | Format |
| --- | --- | --- |
| When does the token expire? | `tokenValidity` | `DD/MM/YYYY HH:MM`. The zone is not stated, assume IST. |
| Is the Data API plan active? | `dataPlan` | `Active` or `Deactive` |
| When does the Data API plan end? | `dataValidity` | `YYYY-MM-DD HH:MM:SS.0` |

Settings should treat the token as valid only if the call succeeds and `tokenValidity` is in the future. It should treat the Data API plan as active only if `dataPlan` is `Active` and `dataValidity` is in the future. Whether `client-id` is needed on this call is not stated. Sending it is harmless.

## FRED (Docs)

- `GET https://api.stlouisfed.org/fred/series/observations?series_id=VIXCLS&api_key=<key>&file_type=json&observation_start=2026-09-01`. Same for `DEXINUS`.
- Key format: "32 character alpha-numeric lowercase string". So validate with `/^[a-z0-9]{32}$/`. The docs say alphanumeric, so do not narrow it to hex.
- `file_type` accepts `xml` (the default), `json`, `xlsx`, `csv`. Always send `file_type=json`.
- `observation_start` is `YYYY-MM-DD`.
- JSON response keys: `realtime_start`, `realtime_end`, `observation_start`, `observation_end`, `units`, `output_type`, `file_type`, `order_by`, `sort_order`, `count`, `offset`, `limit`, and `observations`. Each observation has `realtime_start`, `realtime_end`, `date`, `value`.
- `value` is a string. Missing days come back as the string `"."`. The observations page does not describe this. It is known FRED behaviour from other FRED documentation, not confirmed here. Confirm live. Parse `"."` as unknown, never as 0.
- Known behaviour to confirm live: FRED posts the US close the next morning. This is why the plan allows US VIX to trail the Indian session by up to 4 calendar days.

## Open questions for the live calls

1. Does `charts/historical` accept `IDX_I` / `INDEX` for ids 13 and 21? What do daily candles look like?
2. Does a 4-year range return in one call?
3. Is the daily timestamp IST midnight? How do holidays appear?
4. Which security id does a continuous GOLD series need with `expiryCode: 0`? Does the series join across expiries?
5. HTTP status and body for a wrong token.
6. Strike key format and whether `data.oc` is ordered. Does the expiry list start with the nearest date?
7. Does `/v2/profile` need `client-id`? What time zone is `tokenValidity` in?
8. Does FRED return `"."` for holidays on `VIXCLS` and `DEXINUS`?
