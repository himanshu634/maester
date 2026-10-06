# Market data vendors for Market mood

This note was researched on 6 October 2026 for the Market mood page; see [How market mood is measured](2026-10-06-market-mood.md). Maester shows readings to signed-in users, so it needs display rights, not only personal use. End-of-day data is enough, with 2–3 years of daily history for backfill. Claims marked **[UNVERIFIED]** could not be confirmed.

## The short answer

No vendor removes the need for an NSE licence for NSE-derived series: India VIX, Nifty 50, Nifty 500 breadth, FII/DII flows and the put–call ratio.

- NSE's EOD tariff says a vendor that passes EOD data to its clients "for any type of usage" needs "written consent from NSE Data & Analytics Ltd" ([NSE EOD tariff, Apr 2026](https://nsearchives.nseindia.com//web/mediaattachment/2026-04/Download_End_of_the_Day_Data_Tariff_20260424120810.pdf)).
- TrueData ([source](https://truedata.in/market-data-apis)) and Twelve Data ([source](https://twelvedata.com/pricing-business)) say the same about display.

The cheapest clean core is a direct licence from NSE Data & Analytics and NSE Indices. Small separate sources then cover gold, USD/INR and US VIX.

Scraping is not an option. nseindia.com forbids automated collection ([terms](https://www.nseindia.com/static/nse-terms-of-use)), and niftyindices.com is personal, non-commercial use only ([terms](https://niftyindices.com/terms-of-use)).

## NSE fees (domestic price list, effective 1 April 2026)

Source: [NSE pricing for domestic clients](https://nsearchives.nseindia.com//web/mediaattachment/2026-03/NSE_Pricing_file_-_Domestic_clients_20260309171343.pdf).

| Licence | Fee | Notes |
| --- | --- | --- |
| EOD data, Capital Market | ₹1,00,000 a year | Per site and per medium; a website and a mobile app are separate mediums |
| EOD data, F&O | ₹1,00,000 a year | Same terms |
| Historical Trade Data, Capital Market | ₹1,10,000 a year | Same terms |
| Historical Trade Data, F&O | ₹1,10,000 a year | Same terms |
| 15-minute delayed, internal display | ₹1,40,000 a year | For comparison |
| Realtime snapshot on an open website | ₹29,20,000 a year | For comparison |

Taxes are extra, and each extra delivery channel adds 50%.

**Derived data.** NSE's non-display policy says redistributing derived data externally needs a separate agreement and fees (§3.5, [policy](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/Non_Display_Policy.pdf)). Breadth % and the put–call ratio are derived data, and it is **[UNVERIFIED]** whether the EOD display licence covers them.

**Index data.** Nifty 50, Nifty 500 and India VIX belong to NSE Indices Ltd, which licenses index data separately. Contact indices@nseids.co.in; see [data subscription](https://niftyindices.com/data-subscription). No fee is published, so the price is **[UNVERIFIED]**.

**Authorised NSE vendors** ([list](https://nsearchives.nseindia.com/web/sites/default/files/inline-files/Authorized_Realtime_Data_Vendors.pdf)):

- On the list: Bloomberg, Refinitiv, ICE, FactSet, Morningstar, TradingView, Global Financial Datafeeds and TrueData.
- Not on the list: EODHD, Twelve Data, FMP, Alpha Vantage, Massive and every broker.

## Vendors

| Vendor | What it covers | Display terms | Verdict |
| --- | --- | --- | --- |
| NSE Data & Analytics (direct) | Constituent EOD prices; F&O open interest, for the put–call ratio. Index closes and FII/DII **[UNVERIFIED]**. Files. | Display licence by design. | Core. About ₹2,36,000 a year with 18% GST (assumed): about ₹19,700 a month. |
| NSE Indices | Nifty 50, India VIX, Nifty 500 constituent lists | By quote **[UNVERIFIED]** | Core |
| TrueData | VIX, Nifty, constituents and option chain; authorised vendor | Internal use only; display needs written approval from the exchanges and TrueData ([source](https://truedata.in/market-data-apis)) | You pay TrueData plus NSE |
| Global Datafeeds | Authorised vendor | API display terms **[UNVERIFIED]** | Same as TrueData |
| Twelve Data Venture, $149–499 a month | NSEI, INDIAVIX, CRSLDX, N225, HSI ([indices](https://api.twelvedata.com/indices?country=India)); no Cboe VIX and no open interest | External display "subject to exchange licensing terms" | Not an NSE vendor |
| EODHD | Personal plans forbid display; commercial plans by quote ([terms](https://eodhd.com/financial-apis/terms-conditions), [pricing](https://eodhd.com/commercial-pricing)) | Not from exchange feeds | Not clean for NSE data |
| Alpha Vantage | BSE equities only ([docs](https://www.alphavantage.co/documentation/)) | Non-commercial | Not suitable |
| FMP | India coverage **[UNVERIFIED]** | Needs a display agreement ([source](https://site.financialmodelingprep.com/pricing-plans)) | Not an NSE vendor |
| Polygon / Massive | US only | Individual plans; business plans from $2,499 a month | Not suitable |
| Brokers: Kite, Upstox, Dhan, Angel, Breeze | Varied | Kite forbids distribution ([source](https://kite.trade/forum/discussion/comment/42658)); the others are unclear | Not clean |
| Cboe, for US VIX | VIX | Fee per user, about $25 a month per user through one vendor ([Optuma](https://www.optuma.com/kb/data/end-of-day-data-options/cboe-indices-data)). FRED VIXCLS needs permission for commercial use ([FRED legal](https://fred.stlouisfed.org/legal/)). | Quote needed, or drop it |
| FRED DEXINUS, for USD/INR | New York noon rate, a day behind | Public domain ([source](https://fred.stlouisfed.org/series/DEXINUS)) | Free; label it as the Federal Reserve rate, not FBIL |
| FBIL, for USD/INR | Reference rate | Terms not found **[UNVERIFIED]** | Ask FBIL |
| IBJA API, for gold in INR | IBJA rates | Official API meant for display ([source](https://ibjarates.com/)) | Quote needed |
| NSDL, for FPI flows | Confirmed daily FPI flows; no DII | © NSDL; no reuse licence found **[UNVERIFIED]** ([source](https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx)) | Fallback only with permission |
| FRED DGS10, for the US 10-year yield | Yield | Public domain ([source](https://fred.stlouisfed.org/series/DGS10)) | Free extra |

## Recommended combination

1. **NSE Data & Analytics** (marketdata@nse.co.in). Buy EOD Capital Market plus F&O for the website: ₹2,00,000 a year plus GST. Ask NSE to confirm four things in writing:
   1. whether displaying breadth % and the put–call ratio is allowed under §3.5;
   2. whether backfill history is included, or needs Historical Trade Data (₹1,10,000 in year one);
   3. whether FII/DII provisional figures can be licensed;
   4. whether index closes come in the Capital Market EOD file.
2. **NSE Indices** (indices@nseids.co.in). License EOD Nifty 50 and India VIX, and the Nifty 500 constituent lists with their history.
3. **IBJA API**, for gold in INR.
4. **FRED DEXINUS**, for USD/INR.
5. **Cboe**, for US VIX. Otherwise leave US VIX out of the first release.

The known floor is about ₹19,700 a month. With backfill and the quotes still to come, a realistic total is ₹25,000–40,000 a month **[UNVERIFIED]**.

Still uncovered or unconfirmed:

- FII/DII flows, the likeliest gap;
- the FBIL-exact USD/INR rate;
- US VIX, until Cboe quotes;
- MCX gold;
- GIFT Nifty.
