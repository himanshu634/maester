# Maester UI specification

## 1. Design intent

The UI should feel like a calm investment workspace: readable financial tables, restrained charts, clear context and fast access to evidence. Design for a weekly portfolio review and a focused company-research session. Keep those activities connected through stable company and security records.

Use Maester as the working name. Do not copy a competitor's visual identity. The earlier mockup is inspiration only; implementation follows this specification. This document describes the target UI, not screens currently available in the repository.

## 2. Application shell and navigation

At 1280–1600 px desktop widths, use a 224 px left navigation rail, a 56 px context header and 24 px page gutters. Main content uses the remaining width with a practical maximum of 1440 px for reading-heavy pages. Tables and evidence review may use the full available width. A collapsed rail is 64 px with accessible labels and text tooltips.

The rail header contains Maester and the workspace picker. The context header contains the portfolio selector on portfolio pages, company identity on research pages, global company/document search, and activity/profile actions. Do not use an active portfolio selector to imply that a company belongs to only one portfolio.

| Navigation | Route proposal | Release | Scope |
| --- | --- | --- | --- |
| Overview | `/portfolios/:portfolioId` | R1 | One portfolio, snapshot initially |
| Holdings | `/portfolios/:portfolioId/holdings` | R1 | Owned positions |
| Transactions | `/portfolios/:portfolioId/transactions` | R2 | Accounts within portfolio |
| Performance | `/portfolios/:portfolioId/performance` | R2 | Supported complete interval |
| Research | `/research` and `/companies/:companyId` | R1 | Companies in the workspace |
| Watchlist | `/watchlists/:watchlistId` | R1 | Tracked companies, independent of ownership |
| Documents | `/documents` and `/documents/:documentId` | R1 | Authorized uploads and sources |
| Analyst | `/analyst/:conversationId` | R1 | Explicit question scope |
| Alerts | `/alerts` | R3 | Followed changes and conditions |
| Reports | `/reports` | R3 basic; R4 expanded | Export artifacts |
| Activity | `/activity` | R1 basic | Jobs, imports, edits |
| Settings | `/settings` | R1 | Preferences, data, account |

Group portfolio navigation together; group Research, Watchlist, Documents and Analyst together. Activity and Settings stay at the bottom. Do not expose future routes as empty menu items. R1 without any portfolio opens Research onboarding. Remember the last workspace, but validate access before restoring a deep link.

Global search returns companies, securities, documents and saved notes in named groups. Results show exchange, company name and source/period metadata. It must never silently choose the first result for an ambiguous ticker. Search text is not automatically submitted to an AI model.

## 3. Visual system

These are proposed implementation tokens and dimensions; validate them in a clickable prototype.

| Token | Light appearance | Dark appearance | Usage |
| --- | --- | --- | --- |
| Canvas | `#F6F7F9` | `#101418` | Page background |
| Surface | `#FFFFFF` | `#182027` | Tables, reader and panels |
| Text | `#17212B` | `#E8EDF2` | Primary reading |
| Secondary text | `#526171` | `#AAB6C2` | Metadata, never hidden meaning |
| Border | `#D6DEE6` | `#384652` | Quiet separation |
| Action | `#2455D6` | `#9BB6FF` | Links, selection, focus |
| Positive direction | `#147D57` | `#68DDB0` | Signed numeric changes |
| Negative direction | `#B42336` | `#FF9CA9` | Signed numeric changes/errors |
| Attention | `#8A5700` | `#F2CB79` | Missing/reviewable information |

Use a system sans-serif initially, with optional locally hosted Inter later. Page titles: 28/36 px; section headings: 18/26; body and default table: 14/22; secondary labels: 12/18. Use 16 px editable inputs on mobile. Numerical fields use tabular numerals and right alignment. Body text weight is 400; headings/selected values use 500–600. Avoid excessively wide letter spacing and all-capital financial labels.

Spacing uses a 4 px base: 4, 8, 12, 16, 24, 32. Surface corner radius is 8 px; dialogs 12 px. Borders provide structure; shadows are reserved for overlays. Buttons have one primary action per local workflow. Comfortable table rows are 44 px; an optional compact density uses 36 px on fine-pointer desktop devices. Mobile interactive rows remain at least 44 px high.

Define semantic tokens for income, costs, unavailable data and review states. Color is always paired with text, sign, symbol or line style. Green revenue growth is not an investment recommendation. Focus treatment must be distinguishable from selected-row highlighting. Audit actual token combinations in both themes before release.

## 4. Overview

### R1 snapshot view

Header: portfolio name, mode badge “Holdings snapshot,” snapshot date, base currency and “Update holdings” action. A freshness line identifies manual or imported prices. The first row contains known portfolio value, cash if known, and valuation coverage. Show unrealized gain only when the required cost and valuation coverage is complete; otherwise identify the covered subset explicitly.

The main workspace contains a holdings summary and allocation by security/sector. Unknown sector has its own bucket. The secondary area lists relevant research updates and outstanding data issues. Document-processing counts belong in Activity, not the main value metrics. Do not draw a historical performance chart in snapshot mode.

### R2 transaction view

Show portfolio value, selected-period gain amount, TWR and net external flows. The return-method control reveals XIRR as an alternate with its annualized label. Keep currency, date interval, valuation cutoff and completeness status beside the metrics. Net flows are deposits less withdrawals; dividends retained inside the portfolio are not external deposits.

```text
┌ Navigation ┬ Portfolio / accounts         As of / currency / date interval ┐
│ Overview   │ Value         Gain amount        TWR         Net flows      │
│ Holdings   ├─────────────────────────────────────────────────────────────┤
│ ...        │ Performance vs benchmark       │ Allocation                 │
│            │ Indexed growth; method visible │ Ranked bars + percentages  │
│            ├────────────────────────────────┴────────────────────────────┤
│            │ Holdings / contributors                                    │
│            ├─────────────────────────────────────────────────────────────┤
│            │ Relevant research changes       │ Data requiring attention  │
└────────────┴─────────────────────────────────┴───────────────────────────┘
```

Use a line chart for value or indexed cumulative return; use bars for period contributions. Switching chart measures updates title, axis units and tooltip. Benchmark overlays use the same interval/currency and compatible return basis. Never imply price-only index data includes dividends. No interpolation across missing valuation periods. Provide a data table alternative.

## 5. Holdings and position detail

The table is the primary working surface. Controls are account, asset type, search and grouping; density/column selection are secondary. Default columns: security/company, exchange, quantity, quote with timestamp, market value, portfolio weight, cost basis if known, unrealized gain if available, and data status. R2 adds realized gain and income as optional columns. The sticky identity column always retains a visible text link.

Sort and filters persist in the URL or saved view. Numeric sort uses raw values, not formatted currency strings. The total row states which rows are included and whether filtering affects totals. Unknown quantity/cost/price shows an em dash with a reason; zero renders as zero. CSV export preserves full precision and includes metadata rather than copying abbreviated display text.

Selecting a holding opens a detail page with account breakdown, quantity, lots where supported, price history, transactions, income, research and notes. “View company research” preserves portfolio context as a breadcrumb. A security and its issuer are distinct: multiple listings may connect to one company. A holding snapshot is edited through a review form; ledger-mode positions are derived from transactions and cannot be directly overwritten.

Empty state: “Add your first holding,” with manual and import choices and a read-only demo option clearly labeled synthetic. Partial state: known-value subtotal plus missing securities. Permission loss closes the record and clears cached private details.

## 6. Onboarding and import workbench

Offer “Research a company” and “Track a portfolio” as two short entry paths. Do not force financial account entry to ask about a statement. Create the personal workspace implicitly after sign-in; choose market, currency and number formatting explicitly when a portfolio is created.

An import is a dedicated page rather than a small modal. It contains steps: file and mode, mapping, review, confirmation. R1 supports snapshot rows. R2 supports defined transaction formats. Each step can be revisited without losing mappings.

Mapping pairs each required field with a source column and representative non-sensitive examples. Ask for date format, decimal separator, currency and exchange only where ambiguous. The review step shows accepted, duplicate, unresolved and excluded rows with counts; row-level reasons remain searchable. Explicit exclusions appear in the final receipt. The preview shows balance changes before commit.

Disable commit while blocking issues remain. On provider or server failure, retain the preview and operation ID. Reopening a completed import shows its receipt instead of inviting another commit. Undo creates a reviewed reversal or batch rollback according to dependent-transaction rules; never silently deletes committed accounting history. A snapshot-to-ledger conversion includes a dedicated baseline reconciliation step.

## 7. Company research workspace

Company header: legal/display name, exchange-qualified listings, reporting currency, last available period, selected consolidated/standalone basis, watchlist action, and “Ask about this company.” If owned, show a modest portfolio-context link with position size and valuation date.

Tabs: Overview, Financials, Documents, Notes. Add Peers and Valuation in later releases. The overview answers what the company does, the latest supported financial changes and available source coverage. Never fill missing business descriptions with unsourced AI copy.

Financials contains income statement, balance sheet and cash flow subviews. Period columns are consistently ordered with fiscal end dates available. A visible control switches annual/quarterly data only when available. Unit and basis controls apply to the entire table; a cell with different source units is normalized before display and preserves its original unit in the inspector. Mixed currencies cannot be summed by presentation code.

Clicking a cell opens the evidence inspector; opening a chart shows the same selected fact revisions. Values labeled Reported, Calculated, Estimated or User assumption use separate metadata. A revised filing shows a restated marker with access to earlier values. If source mapping is not available, label the limitation and withhold the source-verified state.

Notes contains dated thesis, supporting evidence, risks, disconfirming conditions and next review date. These are user-authored, with optional AI drafts clearly marked until saved. Autosave feedback reads “Saving,” “Saved,” or “Unable to save”; it must not imply success before acknowledgement. Versioned evidence links survive note edits.

## 8. Document library and processing

Library columns: document name, company, reporting period/basis, type, uploaded date, processing state, review issues and source coverage. Filters: company, period, document type, state. Upload supports drag/drop and a conventional file picker. State the supported limits before selection.

The current engine enforces 15 MiB inline. R1's proposed service target is up to 25 MiB and 200 pages only after object storage, extraction chunking and load tests exist. Until then the UI must show the backend's actual capability and must not advertise the larger limit.

Durable stages: Uploaded → Queued → Reading pages → Extracting facts → Checking consistency → Ready / Review required. Failed and Cancelled are explicit terminal states. “3 of 18 pages read” is allowed only when measured. Indeterminate progress uses stage text without a fake percentage. Leaving the screen does not cancel a job. Cancel requests show pending cancellation until acknowledged.

Duplicates link to an existing authorized document and offer a versioned reprocess action. Never reveal another workspace's matching filename/hash. A reprocessed result is a new extraction revision, not silent overwrite of reviewed facts. The legacy CLI's force behavior is different and remains documented separately.

## 9. Evidence review

At widths above 1200 px, use a 56/44 split: source reader left, facts and issues right. A draggable divider has keyboard resizing. At 768–1199 px, use “Source” and “Facts” tabs preserving selected cell/page. On mobile, use sequential views with a visible return-to-fact action.

```text
┌ Document / company / reporting period / revision ────────────────┐
│ Source reader                         │ Selected fact           │
│ Page 42 / 156  Zoom  Fit width         │ Operating cash flow     │
│                                       │ FY ended 31 Mar 2026    │
│ [PDF page with selected source cell]  │ INR · millions · group  │
│                                       │ Raw / normalized value  │
│                                       │ Source / checks / review│
│                                       │ Correct draft / reason  │
├───────────────────────────────────────┴─────────────────────────┤
│ Previous issue          Issue 2 of 5              Next issue     │
└─────────────────────────────────────────────────────────────────┘
```

Source metadata includes stored page index and printed page label where known, table/section, excerpt and bounding box when reliable. Page-level citation is the minimum; cell highlighting is shown only for a real location. Text-only fallback is available for inaccessible rendering, with its limitation stated.

Keep three independent status axes: extraction coverage (complete/partial/unknown); arithmetic checks (passed/warning/not run); human review (unreviewed/verified/corrected). A document can pass arithmetic and still be partially extracted. Do not collapse these into “High confidence” or “98% accurate.”

Editing opens a draft with value, sign, unit/scale, concept, period and basis. Show the original alongside the draft and the list of affected calculations. Require a reason before committing a correction. Concurrent edits produce a revision conflict with reload/compare; do not overwrite the latest revision. A “cannot resolve” action retains the issue for later.

## 10. Analyst

Use a conversation list on the left of the Analyst page only, main answer area in the center, and an on-demand evidence panel. Avoid an always-open chatbot overlay on every page. A contextual “Ask” action carries company/portfolio and selected facts into a draft with visible scope chips.

The composer shows permitted companies/documents, period/basis where selected, and an evidence cutoff. Broaden scope only through an explicit user action. New messages retain the last scope visibly. Ask for clarification if a company has incompatible reporting periods or bases; do not silently switch from consolidated to standalone.

Answer structure: direct result; relevant reported or calculated table; explanation; supporting references; limitations affecting the result. A calculation disclosure shows formula, exact input values, normalized units, rounding rule and method version. Each material numeric claim links to facts, and each fact links to its document revision. AI interpretation is labeled separately from the input evidence.

States: selecting evidence, calculating, composing, completed, insufficient data, interrupted, failed. Streaming prose cannot mark a calculation as verified before its result arrives. “Save as note” opens an editable draft; “Report an issue” attaches answer/fact IDs. Retry preserves context and does not silently multiply paid work.

## 11. Watchlists, alerts and reports

R1 watchlists are company lists with last reviewed date, latest available period, research note and user review date. Add/remove is reversible. A simple watchlist should not require price alerts or a broker connection.

R3 alerts are grouped by new filings, changed financial facts, portfolio conditions and user review reminders. Each event has occurred-at and detected-at times, affected scope, previous/current values when relevant, and the source. Provide “Reviewed,” “Snooze,” and notification preferences; repeated unchanged states produce no new alerts. Email/digests are opt-in and link back to the authenticated app.

Reports preview selected scope, dates, methodology, coverage, source attribution and included sections. R3 starts with CSV/JSON plus saved review summaries; polished PDF/client reports are later. Reports are immutable snapshots when exported, with a generated-at timestamp. Private report links expire or require access; public sharing is not an R1 default.

## 12. Shared component contracts

| Component | Required input | Required behavior |
| --- | --- | --- |
| MoneyValue | Decimal string, currency, scale, availability | Locale format; precise inspect/copy; no unknown-as-zero |
| ReturnValue | Decimal return, method, interval, annualized flag, coverage | Signed value and accessible method explanation |
| AsOfLabel | Observation time, provider, freshness policy | Distinguish delayed, stale, manual and unavailable |
| EvidenceReference | Fact/document revision, location, authorization | Open exact source; explain missing/revoked source |
| FinancialTable | Periods, basis, units, fact revisions | Sticky identities, keyboard navigation, source inspection |
| JobStatus | Durable stage, counts, error, retryability | Survive refresh; no simulated progress |
| DataIssue | Severity, affected objects, next action | Local actionable explanation, no unexplained red banner |
| ImportPreview | Rows, mappings, balances, exclusions, batch key | Preview then idempotent commit |
| MetricChart | Series, units, interval, gaps, metadata | Labeled axes, keyboard/touch details, table fallback |
| EmptyState | Current scope, cause, primary next action | Distinguish empty data, active filters and denied access |

## 13. Accessibility and responsive behavior

Target WCAG 2.2 AA. Provide keyboard navigation, visible unobscured focus, semantic headings/tables, associated field labels, text alternatives and status announcements. Normal text needs at least 4.5:1 contrast and relevant non-text controls 3:1. The WCAG minimum target-size rule is 24 CSS px with defined exceptions; choose 44 px touch targets as the product default.[^1]

Desktop ≥1200 px supports split review and full financial tables. Tablet 768–1199 px collapses the rail and secondary panels. Mobile <768 px uses a navigation drawer, stacked sections and a compact core column set; the full table remains available in a labeled horizontal scroll region. Do not force the entire page to scroll horizontally. Test at 360, 768, 1280 and 1600 px and at 200% zoom.

Charts do not depend on hover: keyboard and tap expose the same values. Return focus when drawers/dialogs close. Escape closes dismissible overlays but must not silently discard an unsaved correction. Honor reduced motion. Loading changes use status regions, not repeated screen-reader announcements of every streamed token.

## 14. Design deliverables and acceptance

Before frontend implementation, produce clickable flows for research activation, snapshot import, source correction and the R2 reconciliation journey. Each needs populated, empty, loading, partial, failure, permission-loss and saved/unsaved states. Use synthetic companies, filings and holdings with internally consistent numbers.

Prototype tasks: identify the portfolio's date/currency; distinguish a snapshot from historical performance; find a source page; correct a unit error; resolve an ambiguous listing; explain why a return is unavailable. A participant should complete at least four of five assigned core tasks without moderator help before the layout is accepted. Record confusion, time and accidental commits, not aesthetic preference alone.

## Sources

[^1]: W3C, [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/) and [Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), accessed 9 September 2026. The remaining dimensions, tokens and interaction choices are proposed Maester design decisions.
