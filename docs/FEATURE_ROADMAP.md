# Prioritized feature roadmap

## Priority model

Rank features by investor value, frequency of use, dependency value, evidence strength and delivery cost. Correctness and access requirements are release prerequisites; a low estimated engagement score cannot remove them. No numerical RICE score is claimed because reach, conversion and effort have not been measured.

P0 delivers the first useful research product with portfolio context. P1 makes accounting dependable and turns research into a recurring workflow. P2 expands decision support, integrations and collaboration. P3 represents separately scoped specialist businesses. All items below are planned unless the status explicitly says existing or foundation implemented.

Sizes are relative implementation estimates: S = localized feature; M = multi-screen/domain feature; L = several dependent workflows; XL = separate subsystem. They are not calendar commitments. Owner labels identify responsibility, not assigned people: Product, Design, Web, Backend, Data, Platform, QA.

## R0 — engineering foundation

| ID | Status | Scope | Acceptance |
| --- | --- | --- | --- |
| F00 | Foundation implemented | CLI app and financial-engine library in one uv workspace; root commands and docs | Both console names work; offline regressions and workspace checks pass |
| LEG01 | Existing, limited | Inline PDF extraction and cached one-document Q&A | Preserve CLI behavior during migration; does not satisfy P0 citation, review or hosted access requirements |

## P0 — R1 research and portfolio context

Rows are ordered by suggested start sequence; dependencies determine when each can ship.

| ID | Feature / investor value | Minimum acceptance | Dependencies | Size / owner |
| --- | --- | --- | --- | --- |
| F01 | Workspace identity and privacy: retain personal research safely | Sign-in/out; ownership enforced for documents, facts, notes, jobs and downloads; cross-user access tests | F00 | M / Platform |
| F02 | Responsive app shell and context: understand where analysis applies | Accessible navigation, deep links, company/portfolio scope and locale; no dead future routes | F01 | M / Design + Web |
| F03 | Company/security directory: connect research and holdings correctly | Stable company ID; exchange-qualified security ID; ambiguous symbols require selection | F01 | M / Data |
| F04 | Private PDF upload and durable jobs: reuse a source without babysitting it | Limits/type checked; private storage; durable stages, retry and cancel; refresh resumes state | F01, F03 | L / Backend |
| F05 | Versioned fact extraction and provenance: inspect a financial value | Period, basis, units and raw text preserved; page location and document revision per exposed fact | F04 | L / Data |
| F06 | Source reader and issue review: resolve uncertainty | Open exact page; separate coverage/check/review status; correction reason and immutable revision | F05 | L / Web + Data |
| F07 | Financial tables: understand company history | Three statements; clear periods/units/basis; missing differs from zero; cell opens evidence | F05, F06 | M / Web |
| F08 | Deterministic calculation service: trust numerical answers | Versioned allowlisted arithmetic and ratios; decimal inputs; formula/lineage; undefined-case behavior | F05 | M / Backend |
| F09 | Evidence-backed Analyst: answer a concrete research question | Explicit scope; numeric claims tied to F08/facts; citations resolve; missing evidence produces partial/abstain state | F06, F08 | L / Backend + Web |
| F10 | Saved notes and thesis: preserve decision reasoning | User-editable thesis, risks, source links and next-review date; save failure visible; source revision retained | F03, F06 | M / Web |
| F11 | Watchlists: return to a focused set of companies | Create/add/remove; no ownership implied; latest available period and review date visible | F03, F10 | S / Web |
| F12 | Portfolio/account setup: establish meaningful scope | Name, base currency, market, account, snapshot date; balances partitioned by account | F01, F03 | M / Backend |
| F13 | Holdings snapshot: see current exposure quickly | Manual rows and defined snapshot CSV; price/cost may be unknown; dedupe preview; no invented return history | F12 | M / Backend + Web |
| F14 | Snapshot overview and research links: connect holdings to evidence | Known-value subtotal, cash and coverage; allocation uses stated denominator; holding links to company | F07, F13 | M / Web |
| F15 | Activity, usage and data controls: recover work and retain ownership | Upload/review events; usage limit feedback; user data export/deletion flow; raw content excluded from analytics | F01, F04, F10 | M / Platform |
| F16 | Evaluation and release instrumentation: detect broken evidence | Golden synthetic/public-source cases; source and arithmetic gates; activation events; no private document text in logs | F05–F15 | M / QA + Product |

R1 exit: all P0 outcomes pass the release checklist; five-person moderated workflow test is completed, and an initial invited cohort can use the product without manual database intervention. Existing CLI capabilities are reusable components, not completion credit for hosted requirements.

## P1 — R2 accounting, then R3 recurring investor value

| ID | Release / feature and value | Minimum acceptance | Dependencies | Size / owner |
| --- | --- | --- | --- | --- |
| F17 | R2 transaction ledger: know how holdings and cash arose | Decimal amounts/quantities; buys, sells, deposits, withdrawals, fees; immutable revisions and opening baseline | F12 | L / Backend |
| F18 | R2 tradebook import: reduce manual entry | Generic transaction CSV plus one verified broker format; mapping preview, identity resolution, batch receipt, idempotency | F03, F17 | L / Backend + Web |
| F19 | R2 reconciliation: identify missing or duplicate activity | Position/cash comparison to dated statement; blocked incomplete intervals; snapshot-to-ledger conversion without double count | F13, F18 | L / Backend + Data |
| F20 | R2 price and benchmark data: value the whole interval consistently | Authorized EOD coverage; observation time and provider; split conventions; missing/stale data surfaced | F03; provider decision | L / Data |
| F21 | R2 dividends and basic corporate actions: avoid false returns | Cash dividends, reinvestment as paired events, splits and bonus issues; unsupported events mark interval incomplete | F17, F20 | L / Data |
| F22 | R2 positions, cash and gain calculations: trust account balances | Replay ledger; supported lot basis; realized/unrealized gain and fees; deterministic reconciliation fixtures | F19–F21 | L / Backend |
| F23 | R2 TWR and XIRR: distinguish strategy performance from investor cash timing | Documented timing; complete interval; no-root/ambiguous XIRR state; method and annualization visible | F22 | L / Backend + QA |
| F24 | R2 benchmark comparison: contextualize performance | Same dates/currency/basis; indexed chart; explicit price-only vs total-return label; no unavailable comparison | F20, F23 | M / Web + Data |
| F25 | R3 financial-period comparison: find changes without re-reading tables | Two compatible periods; absolute/% deltas; negative/zero-base rules; source references | F07, F08 | M / Data + Web |
| F26 | R3 thesis review and filing changes: revisit decisions | New filing/correction linked to company and note; “outdated evidence” marker; acknowledge/review history | F05, F10, F11 | M / Backend + Web |
| F27 | R3 investor alerts and digest: focus attention | Filing/review reminders and configured numeric thresholds; deduped state transitions; opt-in channels and snooze | F15, F20, F26 | M / Backend |
| F28 | R3 portfolio-scoped Analyst: investigate owned exposures | Authorized holdings/facts at fixed cutoff; coverage list; no unsupported weighted financial aggregation | F09, F22 | M / Backend |
| F29 | R3 research and portfolio exports: continue work elsewhere | CSV/JSON with raw precision, periods, citations, method and as-of metadata; spreadsheet-safe text | F07, F10, F22 | M / Backend |
| F30 | R3 income calendar: plan around known distributions | Declared and received income distinct; dates/source; forecasts explicitly estimated | F21 | M / Data + Web |
| F31 | R3 concentration and drawdown: see major exposures and losses | Security/sector weight coverage, unknown bucket; drawdown on complete comparable series; method disclosed | F20, F23 | M / Backend + Web |

R2 exit is an accounting gate, not a marketing date: supported history reconciles and return fixtures pass. R3 exit requires investors to use at least one recurring workflow and alert evaluation to show useful, non-duplicative notifications. Evaluate F25/F26 earlier in a research-only pilot if they create more observed value than broker imports; do not bypass F17–F24 for performance claims.

## P2 — R4 expansion candidates

| ID | Feature / value | Minimum acceptance | Dependencies | Size / owner |
| --- | --- | --- | --- | --- |
| F32 | Saved peer comparisons | Compatible sectors, currencies, periods and accounting basis; missing coverage; user-selected peers | F25 | M / Data + Web |
| F33 | Valuation scenarios | User assumptions separated from facts; base/bull/bear inputs; sensitivity, formula and saved revisions | F08, F10, F32 | L / Backend + Web |
| F34 | Fundamental screener | Versioned filters; financial dates; reliable coverage universe; save to watchlist | F03, F07, F20 | L / Data |
| F35 | Read-only broker connections | Explicit authorization; sync status, disconnect, reconciliation and historical limitations | F18, F19; provider approval | XL / Integrations |
| F36 | Multi-currency portfolio accounting | Historical FX, explicit conversion direction/date, cash balances per currency and FX contribution | F22–F24 | L / Backend + Data |
| F37 | ETFs and mutual funds | Identifier/NAV conventions, fees, distributions; look-through only with licensed dated constituent data | F20–F24 | L / Data |
| F38 | US filing/XBRL expansion | Filing/concept/dimension mapping, revisions and source links; coverage evaluated on US cohort | F05, F20, F36 | L / Data |
| F39 | Advanced corporate actions | Mergers, demergers, rights, transfers with cost history and reconciliation fixtures | F21, F22 | XL / Data |
| F40 | Shared research and portfolios | Owner/editor/viewer scopes; invitation/revocation; audit; concurrent-edit handling | F01, F10, F22 | L / Platform |
| F41 | Rebalancing simulation | User target weights; proposed deltas/cash/fees; scenarios distinguished from actual ledger | F22, F31 | M / Backend + Web |
| F42 | Report builder | Versioned templates, methodology and coverage; reproducible PDF/export; access-controlled sharing | F29, F40 | L / Web + Backend |
| F43 | Earnings transcripts and qualitative change review | Licensed text; speaker/time/source references; versioned summaries and excerpts | F05, F09; source rights | L / Data |
| F44 | Mobile optimization/PWA | Fast review/alerts/notes; offline boundaries; no stale value represented as live | R1–R3 usage evidence | M / Web |
| F45 | Paid plans and entitlements | Visible usage, accurate metering, retries/refunds policy, billing cancellation and receipts | F15; retention/cost evidence | M / Platform |

Select no more than two large P2 initiatives at a time. Multi-currency support and a new asset class each create accounting work; they are not a display-format toggle. Broker connectivity cannot eliminate reconciliation or assume historical cash flows exist in an API.

## P3 — separate product initiatives

| ID | Candidate | Why deferred | Entry requirement |
| --- | --- | --- | --- |
| F46 | Adviser/client operating model | Different users, permissions, reporting and service obligations | Validated adviser cohort, operating model and client workflows |
| F47 | Jurisdiction-specific tax reporting | Lot rules, taxes, dates and filings vary; incorrect outputs have high consequence | Selected jurisdiction, reviewed calculation specification and extensive fixtures |
| F48 | Advanced factor/risk attribution | Requires complete adjusted history, validated models and clear interpretation | Reliable F23/F36 data and demonstrated demand |
| F49 | Bonds and private assets | Cash-flow schedules, valuation frequency and accounting differ | Asset-specific domain and data plan |
| F50 | Order execution | Adds brokerage connectivity, transaction authorization and operational responsibilities | Separate approved execution PRD and integration scope |
| F51 | Strategy backtesting | Survivorship, restatement and look-ahead controls require point-in-time data | Licensed point-in-time dataset and simulation methodology |
| F52 | Public marketplace/social strategies | Distribution incentives, moderation and privacy diverge from private research | Evidence of demand and separately approved sharing model |

## Recommended first implementation sequence

Complete F01–F07 as a vertical slice: a signed-in investor uploads a company filing, waits for a real job and inspects one extracted fact in its source. Add F08–F10 to turn this into a saved research conclusion. Add F11–F16 for repeat use, current-holdings context and release quality. Only then begin the accounting ledger and imports.

Priorities are based on the [research synthesis](RESEARCH.md), the current repository's strengths, and delivery dependencies. Revisit them after ten investor interviews, five moderated prototype sessions, the first twenty activated users and each release. Promote an item when it resolves an observed recurring job; record the displaced item and the new dependency impact.
