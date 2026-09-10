# Investor platform research

## Executive assessment

The strongest initial direction for Maester is a research workspace with portfolio context, followed by transaction-based performance. Public product documentation shows that portfolio tools emphasize holdings, account context and return components, while research tools connect financial statements, filings, watchlists and valuation. The opportunity hypothesis is to make a user's investment reasoning traceable across those activities.

This does not establish an uncontested market gap. Several established products span research and portfolios, and feature pages do not reveal customer satisfaction, willingness to switch or the correctness of implementations. The proposed differentiation is a testable workflow: holding → company → financial fact → source → calculation → saved thesis → later review.

Evidence was reviewed on 9 September 2026. The report uses primary product/help documentation, official data-provider material and technical standards. Product pages without publication dates are treated as live descriptions accessed on that date. Prices, market size, user counts and investment-outperformance claims are not used to justify priorities. No paid-product hands-on assessment or customer interview was completed.

## 1. Comparable products and design implications

| Product | Observed capability in primary documentation | Implication for Maester | Evidence limit |
| --- | --- | --- | --- |
| Sharesight | Portfolio filters, cash-inclusive value, capital gain/income/currency components, manual/broker/spreadsheet entry and benchmark views | Put dates and scope near returns; support import and visible return decomposition | Documentation establishes capability, not accounting accuracy or exact regional coverage [^1] |
| Koyfin | Current holdings across accounts, lots, portfolio-currency P/L and exposure analysis | Keep account/security hierarchy and research-linked exposure views; do not equate a holdings tracker with a transaction ledger | Page describes My Portfolios specifically; do not generalize it to every Koyfin portfolio product [^2][^3] |
| Screener | Indian company financial histories, line-item detail, filing updates, watchlists, custom ratios and exports | Financial tables and filing-linked review are strong early workflows; exports matter to spreadsheet users | Published feature description, not verification of data completeness [^4] |
| TIKR | Financial analysis, valuation tools and watchlist feeds containing filings, transcripts and events | Connect a company's research surfaces and save review context; valuation follows reliable inputs | Marketing language does not validate forecast outcomes or portfolio-accounting depth [^5][^6] |
| Tijori | Company research, reports, tracking/watchlist/alert navigation and portfolio-related product areas | A recurring company-change workflow is relevant to an India-first audience | FAQ does not establish full feature availability by plan or usable external APIs [^7] |
| Portfolio Performance | Separately documented time-weighted and money-weighted performance methods | Give return methods distinct labels and test external-flow treatment | Its implementation convention is a useful reference, not a universal standard [^8][^9] |
| Zerodha Console | Downloadable tradebook and reports; trade journal tags and account analytics | A reviewed file import is a concrete integration starting point; preserve user rationale | Tradebook availability alone does not establish complete cash/fee/action history [^10][^11] |

### Interpretation

The shared pattern is structured working data, with conversational or qualitative analysis around it. Maester already has an extraction component that can support company research. It lacks the ledger, market history and evidence locations needed for a trustworthy portfolio product. Accordingly, use research to create initial value while implementing accounting as a deliberate second milestone.

A visually polished dashboard cannot solve mismatched units, missing dividends or an unknown opening balance. Those issues should appear as understandable UI states. Conversely, making investors resolve every document issue before reading any valid fact would create unnecessary friction. The recommended design exposes valid subsets with coverage and isolates disputed facts.

## 2. Investor jobs and feature choices

These are product judgments inferred from the observed workflows, not measured consumer preferences.

| Investor job | Proposed feature | Priority | Validation question |
| --- | --- | --- | --- |
| Read one company's results quickly | Source-linked financial tables and Analyst | P0 | Does this reduce the time to answer a source-checkable question? |
| Remember why a position was taken | Thesis/notes with evidence and review date | P0 | Does the investor revisit and update the note after new results? |
| See owned exposure | Snapshot holdings linked to research | P0 | Is partial price/cost coverage understood without assistance? |
| Know actual historical performance | Ledger, reconciliation, TWR/XIRR and benchmark | P1 | Can the user explain contributions vs investment return? |
| Notice a relevant change | Filing/fact changes and focused digests | P1 | Are events reviewed, or dismissed as noise? |
| Compare alternatives | Peers and saved valuation scenarios | P2 | Are users repeatedly recreating these analyses elsewhere? |
| Reduce repeated account entry | Read-only broker synchronization | P2 | Is import frequency high enough to justify integration cost? |
| Operate client accounts | Adviser workflows | P3 | Is there a separate validated buyer and operating model? |

This sequencing does not attempt feature parity with a mature financial terminal. Each milestone needs a coherent outcome with manageable coverage. The first supported universe can be small and declared; the UI should say what it covers rather than imply universal financial coverage.

## 3. Holdings versus performance

Portfolio Performance's documentation distinguishes return calculations that neutralize external flows from calculations sensitive to their amounts and timing. That distinction informs Maester's proposed TWR and XIRR labels.[^8][^9] The detailed conventions in the data-model document are Maester specifications to validate, not a claim of compliance with a performance-reporting standard.

A current snapshot can establish quantity and a dated valuation, and may establish cost if supplied. It cannot identify every historical deposit, withdrawal, sale, distribution or valuation. Therefore R1 must not show a fabricated all-time or year-to-date performance line. An upgrade to ledger mode needs opening positions, cash, activity and prices over a supported interval.

For the India-first path, Zerodha documents CSV/XLSX tradebook exports, a 365-day maximum per download, and separate external-trade records for certain corporate actions and transfers.[^10] These details make range stitching, deduplication and supplemental-history review material import requirements. A connector should be developed from permissioned sample files and tested formats, not from assumed headers.

## 4. Data sourcing and delivery constraints

### India market data

NSE's published policy covers use, display, distribution and redistribution of several forms of market data; permitted uses are governed by agreements. Its product documentation lists distinct real-time and delayed feeds.[^12][^13] Public visibility on a website is not evidence that Maester may redistribute the same data commercially.

Product implication: choose EOD requirements for the initial long-term-investor product, collect provider coverage and permitted-use terms, and show source/as-of metadata. A manually entered dated-price mode can support a private pilot. No vendor, contract, price or redistribution entitlement is assumed to exist today.

Before selecting a provider, record exchange/security coverage; delisted instruments; historical depth; adjusted/unadjusted price meaning; dividend and action coverage; benchmark return basis; time zone; correction policy; permitted app display/export/model usage; rate limits; downtime behavior; and total cost. This is procurement input tied to F20, not a provider recommendation.

### US filings

The SEC documents public submissions and extracted XBRL APIs, including Company Facts, with no API key required for those data APIs.[^14] This is a concrete later alternative to using model extraction for every US financial value. It is not a quote feed. Filings and facts still need taxonomy, unit, dimension, period and amendment selection.

Product implication: add a filing-provider adapter in F38 while retaining source provenance and revision history. Research remains useful for narrative notes and documents not covered by structured data. Follow the SEC's published access guidance and cache responsibly when this integration is built.

### Bring-your-own documents

The existing engine can extract a PDF and cache JSON. Repository inspection shows no per-page facts, schema-version field, durable jobs, organization ownership or correction history. The source rendition is requested from an LLM and has no measured completeness guarantee. These are direct code observations, not external market claims.

Product implication: F04–F06 are substantial work. Do not promise “verified citations” merely because the model sees the PDF. Retain source files with a document revision, capture actual locations, test citation resolution and represent partial extraction.

## 5. UI and implementation evidence

WCAG 2.2 provides an accessibility baseline for keyboard operation, focus, contrast and target sizes.[^15] The precise Maester geometry and palette are design proposals. Dense financial tables still need semantic structure, understandable mobile behavior and a non-color signal for gains, missing data and review status.

The existing Python implementation can be shared by new applications. uv documents workspaces with separate package metadata and a shared dependency lockfile.[^16] FastAPI's official documentation describes OpenAPI/JSON Schema support, which can support generated client contracts.[^17] SvelteKit provides an established application structure for the web client, including static prerendering.[^18] These capabilities inform a proposed stack; they do not establish that any web/API app is implemented here.

PostgreSQL distinguishes exact numeric types from inexact floating types, and documents row-security policies and their bypass conditions.[^19][^20] The recommended new monetary domain uses Decimal/numeric and explicit workspace authorization. OWASP describes indirect prompt injection through external content; model input separation alone is insufficient as an access boundary.[^21] Apply authorization before retrieval and expose only constrained calculations to the Analyst.

## 6. Competitive position to validate

Candidate promise: “Understand your portfolio and keep every financial conclusion connected to its evidence.” The product should demonstrate this with one complete journey before claiming breadth: upload a filing, inspect a value, calculate a change, save reasoning and find it from an owned holding.

The likely switching friction is existing spreadsheets, broker dashboards and research subscriptions. Exportability and import previews reduce that friction. Low-friction research onboarding may acquire users before they trust a new platform with transaction history. These are strategic hypotheses and require behavior-based validation.

Avoid using chatbot message count as the value proposition. A successful session may contain no chat: the investor can compare financial tables, inspect a source and update a thesis directly. Both structured UI and Analyst should operate on the same underlying facts and calculation contracts.

## 7. Evidence gaps and next research

Run ten interviews across self-directed investors who use spreadsheets, a research subscription, or more than one broker. Ask each to describe the last earnings review and the last unexplained portfolio difference. Request permissioned, redacted sample workflows and imports. Do not ask only whether the proposed feature sounds useful.

Test five participants on a prototype: identify the as-of date; find a cash-flow source; recognize missing-cost coverage; resolve a duplicate import; interpret TWR versus XIRR. Measure task completion, misunderstandings and support needed. Re-rank P1/P2 from repeated observed problems.

Unresolved questions include launch market, willingness to pay, provider economics, extraction coverage on actual filings, supported broker format stability, and the relative importance of portfolio tracking versus research. No primary source reviewed here resolves these questions. Do not convert competitor availability into a claim that Maester's customers demand the same feature.

## Sources

Dates below are publication/update dates only where visibly stated; otherwise the page is undated. All sources accessed 9 September 2026. Claims are paraphrased; documentation may change.

[^1]: Sharesight. [Portfolio Investments Page](https://help.sharesight.com/show_portfolio/). Undated help page. Used for portfolio layout, return components and import paths.
[^2]: Koyfin. [My Portfolios](https://www.koyfin.com/help/my-portfolios/). Undated help page. Used for accounts, lots, portfolio currency and current-holdings workflow.
[^3]: Koyfin. [Portfolio Exposures](https://www.koyfin.com/help/portfolio-exposures/). Undated help page. Used for exposure analysis and holding contributions.
[^4]: Screener. [Features](https://www.screener.in/features/). Undated product page. Used for Indian financial research, filing/watchlist and export workflows.
[^5]: TIKR. [Stock Market Research & Investor Analysis Tools](https://www.tikr.com/analyze-stocks). Undated product page. Used for financial, valuation and event-linked research.
[^6]: TIKR. [How to set up a watchlist on TIKR](https://support.tikr.com/hc/en-us/articles/5365387794203-How-to-set-up-a-watchlist-on-TIKR). Help page, publication date not independently established. Used for watchlist workflow.
[^7]: Tijori. [Frequently Asked Questions](https://www.tijorifinance.com/in/faq/). Undated help page. Used for company research, reports and product positioning.
[^8]: Portfolio Performance. [Time-Weighted Rate of Return](https://help.portfolio-performance.info/en/concepts/performance/time-weighted/). Living manual. Used for external-flow distinction and calculation-convention reference.
[^9]: Portfolio Performance. [Money weighted rate of return](https://help.portfolio-performance.info/en/concepts/performance/money-weighted/). Living manual. Used for cash-flow timing sensitivity and IRR reference.
[^10]: Zerodha. [Where can the trades that are taken for a particular period be seen?](https://support.zerodha.com/category/console/reports/other-queries/articles/where-can-i-see-all-the-trades-i-ve-taken-for-a-particular-period). Undated support page. Used for tradebook formats, date-range limit and external-trade caveats.
[^11]: Zerodha. [Console](https://zerodha.com/products/console/). Undated product page. Used for account analytics and trade-journal context.
[^12]: NSE. [NSE Data Sharing & Usage Policy](https://www.nseindia.com/static/market-data/nse-data-policy). Page shows updated 11 December 2025. Used for intended-use agreements and redistribution limits.
[^13]: NSE. [Paid Real Time Data](https://www.nseindia.com/static/market-data/real-time-data-subscription). Page shows updated 7 September 2026. Used for feed categories and delayed-data distinction.
[^14]: US SEC. [EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces). 6 June 2024. Used for submissions/XBRL APIs and authentication distinction.
[^15]: W3C. [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/). Current recommendation accessed on research date. Used as the UI accessibility reference.
[^16]: Astral. [Using workspaces](https://docs.astral.sh/uv/concepts/projects/workspaces/). Living documentation. Used for package/workspace/lockfile behavior.
[^17]: FastAPI. [Features](https://fastapi.tiangolo.com/features/). Living documentation. Used for OpenAPI and JSON Schema contracts.
[^18]: Svelte. [SvelteKit documentation](https://svelte.dev/docs/kit). Living documentation, accessed 10 September 2026. Used for the web application boundary.
[^19]: PostgreSQL Global Development Group. [Numeric Types, PostgreSQL 18](https://www.postgresql.org/docs/18/datatype-numeric.html). Versioned documentation. Used for exact numerical storage.
[^20]: PostgreSQL Global Development Group. [Row Security Policies, PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-rowsecurity.html). Versioned documentation. Used for row-policy capabilities and bypass caveats.
[^21]: OWASP. [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Living guidance. Used for untrusted source-content handling.

Numbered footnotes link claims to this source inventory. Product recommendations and priorities are analytical judgments, not endorsements by the cited organizations.
