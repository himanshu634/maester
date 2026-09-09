# Quality, evaluation and product measurement

## 1. Status

The repository currently includes offline regression checks for the package migration. The hosted-product tests and performance targets below are planned release requirements. Passing CLI tests does not establish extraction accuracy on real financial reports, citation quality or portfolio-accounting correctness.

## 2. Evidence test corpus

Build a permissioned corpus with digital and scanned reports, parenthesized negatives, multiple units, fiscal-year changes, consolidated/standalone variants, restatements, rotated pages, multi-page tables and note references. Include missing values and superficially plausible but incorrect arithmetic. Separate development examples from a held-out evaluation set.

Initial proposed size: 30 documents with at least 500 manually labeled material facts and 150 research questions. Stratify results by format, company type and reporting basis. Publish denominators, error definitions and confidence intervals where meaningful; do not report a single “AI accuracy” number.

Label concept, raw value, normalized value, sign, period, units, basis, dimensions and source page. Answer labels identify supported claims, required calculations and acceptable abstention. Have a second reviewer adjudicate disagreements for material values before adding them to the gold set. Training/prompt examples must not also count as held-out successes.

## 3. Release evaluation targets

All thresholds are proposed gates to calibrate after baseline measurement.

| Area | Gate | Measurement |
| --- | --- | --- |
| Fact correctness | ≥98% exact match on material supported facts; report coverage separately | Correct normalized value, sign, period, currency and basis as one compound success |
| Source references | 100% of exposed citations resolve to authorized stored revisions; ≥98% support the associated claim in held-out review | Resolution and semantic support measured separately |
| Numerical calculation | 100% of deterministic fixtures pass | Formula, unit handling, undefined cases and rounding |
| Abstention | ≥95% of intentionally unsupported questions avoid unsupported factual answers | Fixed missing/contradictory-evidence set, human review |
| Imports | Zero duplicate commits on replay/retry; every excluded row appears in receipt | Idempotency, legitimate repeated trades and row tracing |
| Accounting | 100% of supported ledger/return fixtures pass | Agreed expected cash, quantity, basis, values and rates |
| Authorization | All tenant-isolation and revoked-access tests pass | API, objects, jobs, search, exports, caches and source URLs |
| Usability | ≥80% core-task completion without moderator help | Five or more representative pilot participants |

Do not publish a verified badge based on meeting an aggregate model score. Status belongs to the specific fact, source and check. A small test corpus establishes only performance on that corpus.

## 4. Accounting acceptance matrix

| Case | Expected invariant |
| --- | --- |
| Deposit with no price movement | Portfolio value grows; investment return remains zero |
| Cash dividend retained | Value includes cash income once; no external deposit |
| Dividend reinvestment | Linked income/buy events; no double-counted return |
| Partial sale with fees | Remaining lot, cash and realized/unrealized gain reconcile |
| Split or bonus issue | Quantity/basis adjust; action alone creates no gain |
| Same-portfolio account transfer | Internal portfolio movement; account boundary handled separately |
| Snapshot-to-ledger conversion | One opening baseline; no duplicate historical holdings |
| Duplicate import/retried request | Same receipt and balances; no second commit |
| Missing opening cash/cost | Affected values explicitly unavailable or incomplete |
| Missing quote or action | Coverage disclosed; affected performance interval unavailable |
| Zero TWR denominator | Explain undefined period; do not divide by zero |
| XIRR without root/multiple plausible roots | Defined explanatory state; no arbitrary displayed return |
| Benchmark mismatch | Comparison withheld or explicitly labeled with the mismatch |
| Currency conversion | Historical dates and direction correct; added with F36 |
| Backdated correction | Recompute affected period; preserve earlier revision/history |

The synthetic example in [DATA_MODEL.md](DATA_MODEL.md) is the first shared fixture for holdings, API, export and Analyst surfaces. Add independent calculations or a second implementation as an oracle for return methods; do not generate expected outputs with the production function under test.

## 5. UI and integration testing

R1 browser journeys: sign in and recover session; research activation; upload/retry/cancel; open a source citation; correct a scale error; save a note; import a snapshot; export/delete owned data. R2 adds full transaction import and reconciliation. Test failures after a successful server commit, refresh during processing, expired source URL, stale revision and lost permissions.

Use synthetic or permissioned fixtures with known expected values. Test at 360, 768, 1280 and 1600 px, both themes, 200% zoom, keyboard-only input and reduced motion. Automated accessibility checks complement manual focus and screen-reader checks. Capture design states including missing data, unsupported basis and empty filtered results.

Provider contract tests use recorded sanitized payloads. Live smoke tests run separately with explicit environment/configuration and budget limits; the normal test suite must not require Vertex AI or a broker account. Never log raw account statements or model context into public CI output.

## 6. Performance and reliability envelope

Proposed pilot load: 100 active users, 100 holdings and 10,000 transactions per portfolio, 30 research documents per workspace, and 20 concurrent ingestion jobs. Test non-AI warm read p95 below 500 ms with 20 concurrent readers. Test the primary UI over a documented 10 Mbps/50 ms latency connection. These limits are sizing hypotheses, not promised service capacity.

Measure PDF latency by page count, scan quality and provider attempts. Start with a 20-page digital report baseline and report p50/p95 end-to-end and provider time separately. Support up to 25 MiB/200 pages only after the hosted pipeline passes those cases. A job exceeding the interactive wait window remains recoverable in Activity.

Test worker termination between extraction and commit, duplicate delivery, database timeout, exhausted provider quota and storage interruption. Verify outbox recovery, lease expiry, single active revision and bounded retry. A restore drill must recover metadata and its referenced objects within the PRD's proposed RPO/RTO.

## 7. Product events and metrics

| Event | Required properties | Purpose |
| --- | --- | --- |
| `onboarding_completed` | Cohort, selected path, market | Activation denominator and entry path |
| `document_ready` | Format/page bucket, elapsed time, coverage status | Pipeline outcome |
| `source_opened` | Fact/document IDs, origin screen | Evidence use; no source text |
| `answer_completed` | Scope type, supported/partial/abstained, latency, cost bucket | Research usefulness/quality |
| `note_saved` | Create/update, evidence-reference count | Meaningful research completion |
| `import_committed` | Mode, provider/format, counts, unresolved/excluded counts | Import friction and completeness |
| `portfolio_review_completed` | Interval, mode, coverage, related review action | Repeat portfolio value |
| `alert_reviewed` | Alert type, detected-to-review duration | Signal relevance |

Do not record raw prompts, note text, exact portfolio balances or filenames in default product analytics. Retain private operational records only under a defined policy. Deduplicate events by operation ID so retries do not inflate activation or billing.

Activation denominator is invited users who begin onboarding; numerator is users who inspect source evidence and save a linked note within seven days. Report invitation-to-start conversion separately. Week-four retention uses activated users with a substantive review in days 22–28, with cohort size shown. Establish a minimum cohort size before treating percentages as stable.

A weekly evidence-backed review combines a source inspection with a note update or review acknowledgement for the same company/evidence context. Portfolio reviews in R2 require a selected interval and a meaningful drill-down/review action. Track support burden and unit cost alongside usage so a popular but expensive failure pattern does not look successful.

## 8. Definition of done

A feature meets its roadmap acceptance criterion; implements all relevant availability/error/access states; has authoritative data semantics; passes appropriate automated and manual checks; emits minimal useful events; and updates the README/status documentation if its availability changes. Financial outputs and source references need held-out or independently specified expected results. Public-beta release requires a documented restore test and no unresolved critical accounting or data-access issue.
