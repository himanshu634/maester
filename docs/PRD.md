# Maester product requirements

## 1. Product purpose

Maester helps investors connect what they own, what a company reports, and why they made an investment decision. An investor should move from a holding to financial history, inspect the underlying source, record a thesis, and return when new information challenges it.

The near-term advantage is a dependable evidence workflow: financial values with periods and units, reproducible calculations, a source reader, and saved analysis. Portfolio accounting gives that research personal context and a reason to return. Broad coverage and automation are later investments once these workflows earn repeat use.

The commercial hypothesis is that investors will pay for reduced manual reconciliation and repeated research effort. It is unvalidated. Product success is measured by useful research and portfolio-review behavior, not by investment returns or the volume of generated text. The [research report](RESEARCH.md) supports the opportunity and records its limitations.

## 2. Users and jobs

| Persona | Situation | Job to complete | Evidence of value |
| --- | --- | --- | --- |
| Primary: self-directed long-term investor | Maintains a watchlist and holdings across one or more accounts | Understand earnings, cash flow and exposures; keep a reasoned investment record | Completes a source-backed review and returns after new results |
| Secondary: research-intensive investor | Compares companies and maintains spreadsheets | Normalize comparable facts, inspect disagreements, export analysis | Reuses verified facts in a comparison or model |
| Later: adviser or small research team | Reviews several client accounts with colleagues | Reconcile, collaborate and deliver repeatable client reports | Review turnaround and report reliability improve |

Primary jobs are: “What do I own?”, “What changed?”, “What actually drove my return?”, “Where did this number come from?”, and “Does my original thesis still hold?” These are hypotheses to validate with interviews, not claimed survey results.

Assume an India-first personal product for initial research. Support exchange-qualified Indian equities and cash in the first portfolio milestone. Use INR defaults only after locale/market selection; never infer listing, fiscal period or currency from a ticker or user location. Mutual funds, ETF look-through, US expansion, fixed income and private assets have later scopes.

## 3. Outcomes and release boundaries

| Release | User promise | Must work | Later |
| --- | --- | --- | --- |
| Existing CLI | Ask about one extracted PDF | Ingest, cache, list, one-document Q&A, heuristic checks | Page citations, hosted users, accounting |
| R0: foundation | Developers can evolve independent apps and libraries | Working monorepo, commands, tests, documentation | Investor web runtime |
| R1: research and holdings snapshot | Research a company and connect it to current holdings | Identity, company library, documents, review, facts, cited answers, notes/watchlist, dated position snapshots | Historical performance claims |
| R2: portfolio accounting | Understand performance over supported complete history | Ledger, import review, reconciliation, cash, supported actions, valuations, return methods, benchmarks | Automated trading, tax filing |
| R3: investor workflow | Keep research and portfolio monitoring current | Changes, alerts, comparisons, income calendar, exports and history | Large adviser operations |
| R4: expansion | Evaluate scenarios and support broader use cases | Selected P2 features after usage validation | P3 until separately scoped |

R1 can launch without a market-data agreement by accepting user-entered dated prices and marking dependent valuations as manual. Research does not require owning a security. R2 performance is blocked until historical data, cash-flow reconstruction and corporate-action scope pass acceptance tests.

## 4. Product principles

1. Keep portfolio, account, security, period, reporting basis and currency visible where they affect meaning.
2. Every derived value has a method and input lineage. Every extracted fact has a source and revision.
3. Distinguish reported facts, calculations, AI interpretations and user assumptions with text labels.
4. Unknown differs from zero. Missing data reduces coverage, not the displayed risk or amount.
5. Support completion without AI: tables, imports, notes and source inspection remain usable.
6. Favor a few repeatable workflows over a dashboard crowded with unrelated widgets.
7. Keep a review history when a user corrects evidence or accounting records.

## 5. Core journeys

### J1. First useful research session

The user signs in, chooses “Research a company,” selects or creates a company record, uploads a statement and confirms reporting period and basis. The processing page reports actual stages and survives navigation away. On completion, the user sees financial tables with coverage and issues, asks a supported numerical question, opens the cited page and saves a note.

Success: one saved note contains a verified evidence reference. An upload alone is not activation. If processing fails, retain the upload and show a retry action with a useful reason. If a question lacks evidence, return an insufficient-data response identifying the missing period or document.

### J2. Add existing holdings

The user creates a portfolio and account, chooses snapshot mode, imports or enters security, quantity, optional cost, snapshot date and dated price. Ambiguous symbols require exchange/identifier selection. A preview shows valuation coverage and unavailable historical fields. Confirming creates a dated snapshot and a link from each position to the company workspace.

Success: holdings, cash and known-price subtotal match the reviewed input. Cost-based unrealized gain is available only for known cost; return history is unavailable. A watchlist does not count as an owned position.

### J3. Upgrade to complete transaction history

The user chooses transaction mode, imports a supported tradebook plus required opening positions/cash and supplemental activity, maps columns and resolves duplicates or identifiers. The system replays transactions in a preview and shows unexplained negative holdings, cash differences, unsupported actions and missing prices. Confirming commits one versioned import batch. Re-importing the same file does not duplicate transactions.

Success: the account reconciles to the chosen statement date. Conversion from snapshot mode requires matching/replacing the snapshot baseline; never count both baseline holdings and the historical buys that produced them.

### J4. Weekly portfolio review

The overview opens with a consistent as-of date and selected portfolio. The investor checks value, return method, allocation and relevant changes. Selecting a position opens quantity, transactions, supported return contribution and related research. An alert opens its event or source and can be marked reviewed with a note.

Success: the investor can explain one important change and record a follow-up. “Reviewed” means the investor examined the event; it is not endorsement of the investment.

### J5. Resolve a disputed financial fact

The user opens an issue beside a financial cell. A reader shows the original page and excerpt; an inspector shows raw text, normalized amount, scale, period, basis and validation result. The user edits a draft with a reason, sees dependent calculations, and confirms. A new fact revision replaces the active selection while preserving the old extraction. Affected answers/notes display an outdated-evidence marker.

Success: the corrected fact, review record and downstream values agree. Arithmetic consistency cannot be labeled “source verified” without a source-verification record.

## 6. Functional requirement families

Feature IDs, ordering and acceptance criteria are defined in [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md).

| Family | Required behavior | Boundary |
| --- | --- | --- |
| Identity and settings | Personal workspace, portfolio/account context, locale, sessions, export/deletion | Organization-aware ownership from first hosted release; collaboration later |
| Research | Company profile, financials, source library, saved notes, watchlist | Consolidated and standalone data remain distinct |
| Evidence | PDF upload, durable processing state, page references, issue review, revisions | Per-fact status and document coverage; no invented correctness probability |
| AI analyst | Explicit scope, structured results, calculation steps, citations, saved answer | Reads permitted evidence; cannot execute trades or silently edit facts |
| Portfolio | Snapshot then ledger mode, cash and positions, imports and reconciliation | No historical returns reconstructed from only today's holdings |
| Performance | TWR, XIRR, coverage, benchmark comparison and method disclosure | Compatible intervals, currencies and return bases |
| Monitoring | Filings, corrected evidence, threshold conditions and digests | Meaningful changes linked to their cause |
| Portability | Raw inputs, extracted values, notes and account exports | Preserve timestamps, units, methods and limitations |

## 7. Financial and evidence requirements

Money and quantity arithmetic must use explicit decimal precision in the new portfolio domain. Float-based legacy statement objects remain a compatibility boundary until schema versioning and migration exist. Round for display, not during intermediate ledger calculations. Keep reported unit text and normalized values.

A statement fact identity includes company, concept, period, consolidation basis, currency/unit, applicable dimensions and document revision. Restatements create new versions and a documented active-selection rule. Trailing-twelve-month values require compatible consecutive periods; never manufacture them from mixed annual and quarterly data.

Portfolio value includes supported positions plus cash at the valuation cutoff. If a holding lacks a quote, show a known-value subtotal and missing coverage; do not present it as the complete portfolio. Returns require an explicit external cash-flow boundary and observation interval. Transfers between accounts in the same portfolio are internal at portfolio level. Conventions and examples are in [DATA_MODEL.md](DATA_MODEL.md).

AI answers include scope, evidence cutoff, review flags and input references. Quantitative claims with unsupported facts are withheld or explicitly partial. A citation opens the exact stored document revision. A calculation result is produced by a constrained deterministic service; the model explains it.

## 8. UI scope and appearance

Use a desktop-first research workspace with a quiet neutral palette, clear typography, compact financial tables and a persistent context header. The hierarchy is context, decision-relevant values, primary workspace and source detail. Positive/negative colors describe numerical direction, not whether an investment is good or bad.

R1 navigation contains Overview, Holdings, Research, Watchlist, Documents and Analyst. Activity and Settings are secondary. Activate Performance and Transactions under the portfolio section in R2, then Alerts and Reports as their workflows exist. Omit unbuilt destinations from live navigation. The [UI specification](UI_SPECIFICATION.md) defines screen fields, dimensions, interactions, empty states and accessibility.

## 9. Nonfunctional requirements

These are proposed release targets, not current measurements. Measure under the envelope in [QUALITY.md](QUALITY.md).

| Area | R1/R2 acceptance target |
| --- | --- |
| Access | Every private read/write/download checks workspace ownership; automated cross-workspace tests |
| Usability | Core workflows keyboard accessible; WCAG 2.2 AA evaluation; meaningful content at 360 px width |
| Data clarity | Monetary series include currency, unit, period and as-of context |
| Responsiveness | Warm non-AI API read p95 under 500 ms; primary screen usable within 2.5 s on agreed connection |
| Processing | Accepted uploads receive durable job IDs; retry does not duplicate active facts |
| AI | Prompt status feedback; 60 s initial interactive timeout with recoverable outcome; no invented ETA |
| Reliability | Initial hosted availability target 99.5% monthly, measured end-to-end; revise after pilot baseline |
| Recovery | Proposed R1 metadata RPO 24 h and RTO 8 h, demonstrated by restore drill before public beta |
| Auditability | Imports, corrections and deletions identify actor, time and revision |
| Cost | Track model cost per accepted document and successful research session; configurable usage caps |

## 10. Product measurement

North-star candidate: weekly investors completing an evidence-backed review, defined as inspecting source evidence and saving/updating a note or marking a related event reviewed. Pair it with weekly portfolio reviews in R2. Page opens and generated answers alone do not count.

Pilot targets are hypotheses: 60% of users who start onboarding complete activation; 80% of moderated participants complete source inspection without help; median first useful review below 15 minutes excluding provider queue time; 40% of activated users return for a substantive review in week four. Report invitation-to-onboarding conversion separately, alongside cohort sizes and denominators. A small pilot cannot establish market demand or causal investment benefit.

Guardrails include incorrect citations, unresolved discrepancies, duplicate imports, missing-price coverage, support time, model spend and abandoned corrections. Metrics must not encourage accepting uncertain facts or overtrading.

## 11. Product packaging hypotheses

Pilot access is invite-only with visible document limits and export capability. A future individual plan can meter active portfolios, processing volume and monitoring depth. A research tier can add comparisons, saved models and more history; collaboration is a later tier. Determine prices through willingness-to-pay interviews and measured costs. Do not charge for correcting a processing error or hide billing status behind an expired job.

## 12. Dependencies and open decisions

Audience, launch geography and asset scope need product-owner confirmation. Historical data procurement, permitted display/export uses, statement samples, corporate-action coverage and return conventions precede R2. Identity provider, hosting region and retention policy precede the first hosted release. Adviser services, tax outputs and execution require separate requirements when selected; this PRD does not establish that operating model.

Each release closes the checklist in [DELIVERY_PLAN.md](DELIVERY_PLAN.md). A feature is complete when its UI, data semantics, failure states, instrumentation and tests satisfy its outcome.
