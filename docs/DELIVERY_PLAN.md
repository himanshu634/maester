# Delivery plan

## 1. Delivery approach

Deliver a complete investor journey at each milestone. R0 organizes the working code; R1 creates useful research; R2 establishes accounting; R3 supports recurring review; R4 expands only where usage demonstrates value. A milestone is accepted by outcomes and tests, not by the number of screens built.

Dates and staffing have not been committed. For planning, assume two full-time product engineers with part-time design/product and financial-data review. The ranges below are rough planning estimates and include integration and QA, but not unpredictable procurement or new regulatory operating-model work. Re-estimate after the first vertical slice.

| Milestone | Scope | Indicative duration after prerequisites | Exit evidence |
| --- | --- | --- | --- |
| R0 foundation | F00, documents, package split and checks | Current change | Installed workspace, CLI compatibility, offline tests |
| Discovery/prototype | Confirm audience/market; core flows; provider/import samples | 1–2 weeks | Interview notes, five usability sessions, selected initial universe |
| R1 research | F01–F16 | 6–10 weeks | Source-backed review journey and snapshot UI pass gates |
| R2 accounting | F17–F24 | 6–10 weeks | Supported imports reconcile; ledger and return fixtures pass |
| R3 investor workflow | F25–F31 | 3–5 weeks | Changes/alerts/review loops used by pilot cohort |
| R4 expansion | Selected F32–F45 | Re-estimate per initiative | Validated demand and domain-specific acceptance |

Do not interpret these as a launch guarantee or stack them into a single fixed delivery date. Data quality, source coverage and feedback can change the ordering within a release.

## 2. First implementation backlog

### Slice A: A real source behind one financial cell

Implement sign-in and workspace ownership, company records, a private upload operation and a durable job. Preserve the original PDF and produce one normalized statement with real page references. Render the company financial table and open the exact source page from a cell. Include missing-value, partial-extraction and failed-job states. Related features: F01–F07.

Acceptance: an invited user can upload an authorized test filing, navigate away, return to the completed job and inspect a correct source location. Another workspace cannot discover or open that object. This slice should be demoable before building the full overview.

### Slice B: A saved research conclusion

Add the allowlisted calculation service, scoped Analyst and notes. Start with a few transparent operations: difference, positive-base percentage change, margin and supported balance/flow ratios. Render input facts and calculation references in answers. Save a note containing those references and show it as outdated after an input correction. Related features: F08–F10, F16.

Acceptance: a deterministic answer and table agree, source links work, and missing or incompatible periods produce a useful abstention. No model-generated arithmetic is silently promoted into a verified fact.

### Slice C: Current portfolio context

Add watchlists, portfolios/accounts, manual holdings and the generic snapshot CSV. Render the overview using dated/manual prices and explicit coverage. Link holdings to the company workspace. Add activity, export and data controls. Related features: F11–F15.

Acceptance: a reviewed snapshot matches displayed known values and has no invented historical performance. A user can complete research without importing a portfolio.

### Slice D: Account history that reconciles

Build the ledger, generic transaction import and one broker format selected from pilot samples. Add opening balances, dividend/basic-action handling, reconciliation and historical valuations. Then expose TWR/XIRR and benchmark views. Related features: F17–F24.

Acceptance: the accounting matrix passes and a pilot account reconciles to permissioned reference statements over the supported period. Unknown actions or missing cash history remain explicit blockers to complete performance.

## 3. Work-package handoff format

Each implementation issue should include the feature ID, investor outcome, supported inputs, UI states, data contract, acceptance examples, instrumentation and dependency links. Include a design reference where layout is material. Estimate engineering work after the relevant domain policy is selected.

Example: “F06: correct a financial scale” includes raw value/unit, normalized value, original source page, correction reason, revision conflict, dependent calculation invalidation and the success/failure UI. A ticket titled only “build PDF viewer” does not capture the investor outcome.

Product owns scope and release acceptance; Design owns task flows and interaction QA; Backend/Data own meaning, contracts and fixtures; Web owns accessible presentation; Platform owns identity/storage/jobs/deployment; QA coordinates independent expected results. Roles can be held by the same person but responsibilities stay explicit.

## 4. Dependencies and decisions

| Decision | Current planning default | Needed before | Owner |
| --- | --- | --- | --- |
| First audience | Self-directed long-term investors | Prototype acceptance | Product |
| Launch market | India first; global-capable IDs/currency model | Security directory and broker format selection | Product + Data |
| Initial assets | Listed cash equities and cash | Ledger design | Product + Data |
| Initial price mode | Manual dated prices for R1; authorized EOD for R2 | Performance release | Product + Data |
| Identity provider/hosting region | Not selected; GCP-compatible approach proposed | Hosted user data | Platform |
| Market-data provider and permitted uses | No selection or entitlement assumed | F20 and public quote display | Product + Data |
| Broker import format | Generic CSV plus one actual pilot format | F18 | Data |
| Accounting conventions | Proposed trade-date treatment, FIFO display, daily TWR, XIRR | F17–F23 fixtures | Backend + financial reviewer |
| Retention, backups and deletion | Product policy required; proposed recovery targets in PRD | Public beta | Platform + Product |
| Pricing | Unvalidated tier hypotheses | Paid launch | Product |
| Repository license and remote | Not selected/configured | External distribution/contribution | Project owner |

These are implementation/product decisions; the current documentation task does not require resolving them to create the monorepo. Do not silently assume that a competitor's data source or user subscription grants Maester integration rights.

## 5. Release checklists

### R1 readiness

- Research and holdings-snapshot paths each work from an empty workspace.
- Real source references, corrections and outdated-answer behavior pass evaluation.
- Usage/processing limits reflect actual supported files, not future targets.
- All private object and download paths enforce ownership.
- Essential screens pass keyboard, mobile and partial-data checks.
- Export, deletion, backup/restore and failed-job recovery are exercised.
- Product events and cost accounting have stable denominators and idempotency.
- Five moderated usability sessions and an initial invited cohort identify no unresolved critical comprehension issue.

### R2 readiness

- Supported historical imports replay without duplicates and reconcile positions/cash.
- Opening balances and snapshot conversion are tested.
- Dividends/actions and missing-data behavior pass independent fixtures.
- Return methods, annualization, benchmark basis and cutoff are visible and consistent.
- Data coverage, provider rights and correction policy are recorded.
- A backdated correction recomputes dependent views without mixing revisions.

### R3/R4 readiness

- A selected recurring job is observed in pilot behavior.
- Notifications are deduplicated and optional channels respect user preferences.
- Exports and saved reports retain methods, revisions and coverage.
- Each added market/asset/integration passes its own accounting and source tests.

## 6. Reprioritization and maintenance

Review the backlog after each milestone and after ten interviews, five prototype sessions and twenty activated users. Compare repeated investor problems, observed usage, support time, data availability and marginal service cost. A higher-priority request displaces another item rather than quietly expanding release scope.

Maintain a decision record for changes to financial semantics, data vendors, permissions or package boundaries. Update the "What exists today" section in [CONTRIBUTING.md](../CONTRIBUTING.md) when a feature becomes runnable. Keep planned features marked planned until their acceptance evidence exists.
