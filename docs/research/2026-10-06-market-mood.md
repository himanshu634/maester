# How market mood is measured

Research for the Market mood terminal page, reviewed on 6 October 2026. The design canvas that uses it is "Maester Market Mood" (round 1, directions A–D). Items marked **[UNVERIFIED]** could not be confirmed. Items marked **[SECONDARY]** come from secondary sources only.

## 1. Existing composite indices

**CNN Fear & Greed (US).** It has seven equal-weight components:

1. Momentum: the S&P 500 against its 125-day average.
2. Strength: NYSE net new 52-week highs.
3. Breadth: the McClellan Volume Summation Index.
4. Options: the 5-day CBOE put/call ratio, inverted.
5. Junk bond demand: the high-yield spread over investment grade, inverted.
6. Volatility: VIX against its 50-day average, inverted.
7. Safe-haven demand: 20-day stock returns less Treasury returns.

Each component is scored by how far it sits from its average relative to how far it usually sits, and the result is scaled to 0–100. The bands are 0–24 Extreme Fear, 25–44 Fear, 45–55 Neutral, 56–75 Greed and 76–100 Extreme Greed. **[SECONDARY]** cnn.com returned HTTP 451, so these details come from secondary sources. The lookback is not published.

- https://edition.cnn.com/markets/fear-and-greed
- https://seekingalpha.com/article/4453044-fear-and-greed-index
- https://www.luxalgo.com/library/concept/fear-and-greed-index.md

**Tickertape Market Mood Index (India).** It has six equal-weight components:

1. FII net open interest in index futures. This is positioning, not cash flows.
2. India VIX and put/call skew.
3. Nifty 90-day EMA against its 30-day EMA.
4. A modified Arms breadth index.
5. Shares near their 52-week high less shares near their 52-week low.
6. Gold against Nifty over two weeks.

The zones are <30 Extreme Fear, 30–50 Fear, 50–70 Greed and >70 Extreme Greed. A help article described z-scores over a 45-day window, but it now returns 404 **[UNVERIFIED]**. Tickertape describes Extreme Fear as "a good time to open fresh positions". Maester must not use advice-like wording of that kind. https://www.tickertape.in/market-mood-index

**NSE.** NSE publishes no official composite. Indian sentiment indices in academic work are research constructs only (https://journals.smsvaranasi.com/index.php/purushartha/article/view/1360).

**AAII survey.** Members say whether they are bullish, neutral or bearish on the next 6 months, every week. Averages for 1987–2025: 37.5% bullish, 31.5% neutral, 31.0% bearish. https://www.aaii.com/sentimentsurvey

**BofA Bull & Bear.** A 0–10 scale; below 2 is read as "buy" and above 8 as "sell". Its normalisation is **[UNVERIFIED]**. https://optionstradingiq.com/bull-bear-indicator/

**BofA Global Fund Manager Survey cash rule.** Cash at 4% or less is a sell signal and 5% or more a buy signal. Since 2011, sell signals were followed by ACWI returns of −2.4% after 1 month and −0.7% after 3 months. https://investing.com/news/stock-market-news/bofa-says-stock-market-is-flashing-sell-signal-3776584

**Goldman Sachs Risk Appetite Indicator.** It is proprietary and expressed in standard deviations. https://investinglive.com/news/!/goldman-sachs-says-they-remain-broadly-pro-risk-but-vulnerability-to-shocks-20210329/ Public "proxies" of it are imitations, not Goldman's method.

**Citi Panic/Euphoria.** It combines short interest, margin debt, volumes, surveys, put/call ratios and fuel prices. Euphoria begins at about 0.41. The panic level and the weights are **[UNVERIFIED]**. https://www.advisorperspectives.com/articles/2011/08/02/does-citigroup-s-panic-euphoria-model-work

**State Street Investor Confidence Index.** It is built from institutional custody holdings, not a survey; 100 is neutral; it is published monthly. https://www.asianinvestor.net/article/state-street-investor-confidence-index-up/145842

These indices normalise their inputs in one of three ways: a rolling z-score, distance from a moving average scaled by its usual spread, or a percentile or fixed threshold. Weights are equal or nearly equal.

## 2. Indicators and usual readings

### Volatility

- **India VIX.** NSE computes it model-free, using CBOE's method, as the annualised 30-day expectation. https://nseindia.com/products/content/equities/indices/india_vix.htm
- **India VIX broker bands.** Below 12 is read as complacent, 12–20 normal, 20–30 elevated, 30–50 high and above 50 crisis. https://www.mnclgroup.com/what-is-india-vix
- **CBOE VIX/VIX3M.** Above 1 means acute stress; that happened on about 8% of days since 2010. https://www.thetrading.tools/vix-term-structure
- **MOVE.** About 85 is the long-run average; readings above about 126 have historically come with equity drawdowns. https://www.schwab.com/learn/story/whats-move-index-and-why-it-might-matter

### Trend and breadth

- **Trend.** There is no universal threshold, so express it as the % distance from a 125-day or 200-day average and score it against its own history.
- **% of Nifty 500 above the 200-day average.** Above 80% is read as stretched and below 20% as washed out. Readings can stay at an extreme for a long time. https://www.business-standard.com/amp/article/markets/five-market-breadth-indicators-that-every-cautious-investor-must-know-122061600126_1.html
- **Advance/decline and net 52-week highs less lows.** Both can be computed from the NSE bhavcopy.

### Options

- **Nifty PCR (open interest).** About 0.9–1.1 is the usual neutral range. Sources read high and low values in opposite directions (https://www.truedata.in/blog/what-is-the-put-call-ratio, https://www.5paisa.com/blog/how-pcr-ratio-affects-nifty-movement). Weekly put writing distorts it, and expiries moved to Tuesday from 1 Sep 2025. Show it unscored.

### Flows

- **FII/DII cash provisional (NSE).** Published in the evening, between about 18:00 and 20:30 IST; the exact time is **[UNVERIFIED]**. https://www.share.market/buzz/learn/how-to-track-fii-data-for-investing/
- **NSDL confirmed FPI.** Published at T+1. https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx Sector splits are fortnightly.
- **AMFI SIP flows.** Published monthly, around the 10th, at about ₹30,000–32,000 crore a month in 2026. Too slow for daily mood.

### Credit

- **US high-yield and investment-grade spreads (FRED, ICE).** FRED keeps only 3 years of ICE series. https://fred.stlouisfed.org/graph/?g=1XVfO

### Safe havens

- 20-day stocks against bonds, or gold against Nifty.

### Global drivers for India

| Driver | Source |
| --- | --- |
| US 10-year yield | FRED DGS10 |
| Broad dollar index | FRED DTWEXBGS. DXY is ICE-licensed. |
| USD/INR | FBIL reference rate, 13:00 IST since 6 Jan 2025 (https://www.hkex.com.hk/-/media/HKEX-Market/Services/Circulars-and-Notices/Participant-and-Members-Circulars/HKFE/2025/FIC_001_25_E.pdf) |
| Brent | FRED DCOILBRENTEU. The publication lag is **[UNVERIFIED]**. |
| GIFT Nifty | Trades 06:30–15:40 and 16:35–02:45 IST (https://www.mnclgroup.com/gift-nifty-trading-hours) |

Each driver can help or hurt Indian shares depending on the situation, so show it signed and unscored.

### Valuation

- **Nifty P/E.** NSE moved to consolidated EPS in April 2021, so P/E levels before and after that date are not comparable. https://www.capitalmind.in/nifty-pe-ratio/
- **G-sec yield less Nifty earnings yield.** Most Nifty tops came near a gap of 2 pp. https://businesstoday.in/markets/story/global-heavyweight-clsa-believes-nifty-could-slump-30-348517-2022-09-29

Valuation matters over 1–2 years, not days.

## 3. Evidence on usefulness

- **Baker–Wurgler (2006).** Sentiment predicts returns across stocks (small, volatile, unprofitable stocks) over months to years. It is not a timing switch. https://nber.org/papers/w10449
- **AAII.** The contrarian value is uneven. Extreme bullishness was followed by a higher S&P after 6 months only 48% of the time. Extreme bearishness was followed by average returns of +7%, +16% and +18% after 3, 6 and 12 months. https://www.aaii.com/journal/article3/is-the-aaii-sentiment-survey-a-contrarian-indicator
- **CNN F&G.** It predicted US returns in 2011–2020, and the link weakened in 2021–2024. https://research.ucc.ie/en/publications/the-cnn-fear-and-greed-index-as-a-predictor-of-us-equity-index-re/ "100% win rate" claims rest on about 12 observations and are overfitting.
- **India.** India VIX changes move strongly against same-day returns. https://inzeko.ktu.lt/index.php/EE/article/view/14966 No independent test of Tickertape MMI was found **[UNVERIFIED gap]**.
- **Pitfalls.** Inputs mostly come from price, so they lag. Thresholds are fitted in hindsight. Rule changes break series. Extremes can last.
- **Timing costs.** Investors earned 2.7, 2.5 and 5.8 pp a year less than their funds over 3, 5 and 10 years. https://cafemutual.com/news/press-news/27708-investors-earn-58-less-than-their-mutual-funds-in-10-year-period-report

**Conclusion for Maester.** Mood is context for keeping to your own allocation and rebalancing rules, and for spotting emotional decisions. It is never a buy or sell trigger.

## 4. Data and licensing for India

NSE's terms forbid automated collection from its website (https://www.nseindia.com/nse-terms-of-use). Redistributing NSE data needs an agreement with NSE (https://nsearchives.nseindia.com/web/sites/default/files/inline-files/NSE_Data_Sharing%26Usage_Policy.pdf).

| Input | Source | Timing (IST) | Licence |
| --- | --- | --- | --- |
| India VIX, Nifty, P/E | NSE | intraday; P/E at end of day | NSE licence or vendor |
| Breadth | NSE/BSE bhavcopy | after close | NSE licence; computed in-house |
| FII/DII provisional | NSE | evening, variable | NSE licence |
| FPI confirmed | NSDL | T+1 | check terms **[UNVERIFIED]** |
| SIP flows | AMFI | monthly | public |
| USD/INR | FBIL | 13:00 | check terms **[UNVERIFIED]** |
| US 10-year, dollar, Brent | FRED | US date | mostly public domain; ICE series restricted |
| VIX, MOVE, DXY | Cboe / ICE | — | vendor licence |

## 5. Recommended construction

**Scored readings.** Seven, all daily:

1. India VIX, inverted.
2. Nifty 50 % from its 125-day average.
3. % of Nifty 500 above their 200-day average.
4. Net 52-week highs less lows, as % of the Nifty 500.
5. Foreign cash flows over 20 sessions.
6. Gold against Nifty, inverted.
7. Global stress: US VIX or the US high-yield spread, inverted.

**Normalisation.** Each reading becomes its percentile rank in a trailing 2-year (about 500 trading days) window. The mood is the equal-weight mean of the readings that are present. Weights are never optimised.

**Missing readings.** Show "6 of 7 readings". Below 5 of 7, show no score. Never fill a gap with 0 or 50.

**Timing.** Each reading carries its own source and time. The mood is "provisional" until the evening flows arrive.

**Bands.** The bands describe the market, never an action. Avoid "buy zone", "opportunity" and "overbought".

| Score | Band |
| --- | --- |
| 0–20 | Very cautious |
| 20–40 | Cautious |
| 40–60 | Middling |
| 60–80 | Eager |
| 80–100 | Very eager |

**Shown but not scored.** Put/call ratio, rupee, US 10-year, broad dollar, Brent, GIFT Nifty, US and Asian closes, valuation, and SIP flows.

**Framing.** Pair the mood with the investor's drift from their own target allocation.
