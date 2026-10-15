# Financial data layer: design

Status: approved for planning, 15 October 2026, after a design conversation that went through sections 5–12 one at a time. The four decisions it rests on are recorded in [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md). The rules every model and every developer follow are in the project `CLAUDE.md` ("Financial figures") and the `financial-figures` skill.

## 1. Goal

Maester reads a company's filings into figures an investor, and an agent working for the investor, can use without second-guessing them. That needs four things the pipeline does not have today:

1. **Meaning.** A figure is keyed by what it is (`profit_after_tax`, consolidated, the year to 31 March 2026), not only by the words printed beside it.
2. **Two readings.** A figure is confirmed by two independent readers where the PDF allows it, and says when it is not.
3. **Arithmetic in functions.** Every derived number comes from a named, versioned, tested function. A model never adds, divides, compares or ranks figures.
4. **Measurement.** Every change to how figures are read is measured against real filings before it lands.

The scope agreed: the three primary statements of annual reports, quarterly and half-year results, and five note families (segments, borrowings, share capital, dividends, related parties). The first consumer is a typed tool layer exposed as an MCP server; the Analyst page in the terminal comes later on the same tools.

## 2. Today, and what is wrong

### 2.1 The pipeline as built

`document.extract` ([`apps/worker/src/jobs/document-extract.ts`](../../../apps/worker/src/jobs/document-extract.ts)) streams the PDF to the extractor, which runs the LangGraph workflow in [`packages/financial-engine/src/pdf_financial_qa/workflow/runner.py`](../../../packages/financial-engine/src/pdf_financial_qa/workflow/runner.py):

```text
prepare → locate → per statement: extract → check ─┬► done        → assemble
                                        ▲          └► correct ─┘
```

- `locate` (model): the three statements by basis, their pages, the printed company name.
- `extract` (model): one sub-PDF per statement; sections, lines, values as printed text per period column; the model also says which lines are subtotals and which labels add up to them.
- `check` (deterministic): subtotal sums from the model's own `component_labels`; a balance identity found by label heuristics.
- `correct` (model): re-reads a failing section; a changed value must appear in the page's text layer.
- `assemble`: scale from the unit label (`values.py`), one date from the period label, `text_layer_match`.

The worker writes `extraction_revision`, `financial_fact`, `source_reference` and `extraction_check` in one transaction. The API's [`stitch.ts`](../../../apps/api/src/financials/stitch.ts) puts years together across filings by normalised label; the web's [`summary.ts`](../../../apps/web/src/lib/research/summary.ts) finds revenue and profit by regex and divides the close by earnings per share in JavaScript floats.

### 2.2 Findings

| # | Finding | Where | Why it matters |
| --- | --- | --- | --- |
| 1 | **No concept layer.** A fact is keyed by `section` and `reported_label` only. | `financial_fact`; `summary.ts` `REVENUE`/`PROFIT` regexes; `drafts.py` `_check_balance_identity` label heuristics | Any consumer must guess which line is which. A renamed line is a different row; an agent asking for operating margin has nothing to ask for. |
| 2 | **No calculation service.** | `summary.ts` (`Number()`, `/`, `.toFixed`); `qa.py` (the model does the arithmetic over pasted JSON); `stitch.ts` (exact, but hand-rolled BigInt decimals) | Arithmetic lives in three places with three precisions; none is a named, versioned function with lineage. F08 in the roadmap is unbuilt. |
| 3 | **A period is one date.** `period_end` or `as_of_date`; no start, no span, no fiscal year. | `ExtractedFact`; `parse_label_date` | Quarters, half-years and years cannot be told apart, so results filings are classified but never shown, and TTM cannot be defined. |
| 4 | **Checks depend on the model's claims.** A subtotal is checked only when the model volunteered its components; no cross-statement checks. | `drafts.py` `_check_subtotals` | A passed check on self-declared components is weaker than one against an independent definition. Nothing compares the cash flow's opening profit with the P&L or closing cash with the balance sheet. |
| 5 | **One reader.** Gemini reads page images; `text_layer_match` only asks whether the number appears anywhere on the page. | `model.py`; `values.py` `text_layer_match` | A digit swap that happens to match another number on the page passes. There is no independent reading to disagree with. |
| 6 | **No evaluation set.** | `data/cache` empty; `QUALITY.md` §2 proposes 30 documents, none exist | Accuracy today is unmeasured. A prompt change cannot be shown to help or hurt. |
| 7 | **Only three statements.** Notes are not located. | `prompts.LOCATE` | Shares outstanding, segments, borrowings, dividends and related parties are not read, so market capitalisation, payout and segment analysis cannot be computed. |
| 8 | **One unit per statement.** A per-share line is the one exception, by regex. | `runner.py` `_fact`; `stitch.ts` `perShare` | Any other line in a different unit (a count of shares, a percentage) is silently scaled. |
| 9 | **Restatements and comparatives are read-time only.** | `stitch.ts` `restated` | An older filing's figure for the same period is noticed only when the table is drawn, never recorded or checked at extraction. |
| 10 | **The CLI's `ask` contradicts the product rule.** | `qa.py` `SYSTEM_INSTRUCTION` ("apply the scale factor") | It asks the model to compute. |

### 2.3 What is right and stays

As-printed text with a parsed decimal and a deterministic scale; immutable revisions, one per job, idempotent; a page per fact; `numeric` in Postgres and decimal strings on the wire; the correction guard against invented numbers; the call and time budget; no document text in logs or traces; the wire format pinned in both runtimes by golden fixtures; stitch's rule that a column comes whole from the newest filing that prints it.

## 3. Decisions

| Axis | Decision | Rejected |
| --- | --- | --- |
| How a line becomes a concept | A **mapping layer over as-printed facts**: `financial_fact` stays as printed; a `concept_mapping` per fact records the concept and where it came from (rule, model); a per-company `concept_override` records the investor's correction by label. | Storing the model's concept on the fact (meaning baked into an immutable row with no deterministic first pass); a concept-keyed warehouse table (loses printed structure, restatements and per-cell provenance). |
| How numbers are read | **Two independent readers, reconciled**: Gemini (reader A) and a deterministic text-layer table parser (reader B). Agreement is recorded per fact. Checks the model cannot influence are added. | Model-only with more self-correction (the same model is not independent of itself); parser-first (a long tail of layouts, and scans). |
| Where calculations live | **TypeScript**, in `packages/financial-engine-ts` (`@maester/financial-engine`), exact decimals, a metric registry with lineage. | Python over HTTP (a network hop per figure, domain semantics in two runtimes). |
| How an agent reads | **`apps/mcp`, a read-only stdio MCP server** over the same functions the API mounts. | MCP over HTTP with personal tokens (needed only when remote). |

## 4. Terms

| Term | Meaning |
| --- | --- |
| concept | An entry of the taxonomy: what a line means, independent of its printed words. |
| taxonomy | `packages/contracts/concepts.json`: the list of concepts, versioned. |
| mapping | The concept recorded for one fact by the extractor (rule or model). |
| override | The investor's concept for a line of a company, by label, applying to every filing of that company. |
| reader A, reader B | Gemini's reading of a target; the deterministic text-layer reading of the same target. |
| agreement | Whether A and B read the same figure: `confirmed`, `unverified` (B absent), `disputed`. |
| target | What `locate` finds: a statement by basis, a results statement, or a note. |
| span | The length of a duration period: `quarter`, `half_year`, `nine_months`, `year`, `other`. |
| series | The company's figures by concept, basis and period, resolved from its filings: what the calculator and the agent read. |
| metric | A named, versioned calculation in the registry. |
| calculation result | A metric's value or its reason for being unavailable, with every input's fact id. |

## 5. Data model

Additive. Migration `0006`. Every table carries `workspace_id`.

### 5.1 Taxonomy

`packages/contracts/concepts.json`, `TAXONOMY_VERSION` inside it. TypeScript imports it; Python loads a generated copy (`pdf_financial_qa/concepts/taxonomy.py`) and a test fails when the copy drifts from the JSON. Each concept:

| Field | Meaning |
| --- | --- |
| `id` | `snake_case`, stable forever; a renamed concept is a new id with the old one marked `superseded_by`. |
| `label` | Plain words for the UI and tool descriptions. |
| `family` | `income_statement`, `balance_sheet`, `cash_flow`, `segment_note`, `borrowings_note`, `share_capital_note`, `dividend_note`, `related_party_note`. |
| `kind` | `monetary`, `per_share`, `count`. Decides the canonical unit. |
| `period_type` | `duration` or `instant`. |
| `dimensions` | Keys the concept takes: `segment`, `party`, `relationship`, `nature`, `tenure`, `security`. Empty for the statements. |
| `sum_of` | Concept ids whose values add up to this one, for the concept checks. Optional. |
| `cross_check` | Another concept this one must equal, for the cross-statement checks (`cash_flow_opening_profit_before_tax` ↔ `profit_before_tax`; `cash_flow_opening_profit_after_tax` ↔ `profit_after_tax`; `cash_at_end_of_period` ↔ `cash_and_cash_equivalents`). Optional. |
| `notes` | Conventions: sign as printed, what is excluded. |

Version 1 covers the three statements, about 60 concepts, Ind AS Schedule III names:

- Income statement (duration): `revenue_from_operations`, `other_income`, `total_income` (= revenue + other income), `cost_of_materials_consumed`, `purchases_of_stock_in_trade`, `changes_in_inventories`, `employee_benefits_expense`, `finance_costs`, `depreciation_and_amortisation`, `other_expenses`, `total_expenses`, `profit_before_exceptional_items_and_tax`, `exceptional_items`, `profit_before_tax`, `current_tax`, `deferred_tax`, `total_tax_expense`, `profit_after_tax` (= PBT − total tax), `other_comprehensive_income`, `total_comprehensive_income`, `profit_attributable_to_owners`, `profit_attributable_to_non_controlling_interests`, `eps_basic`, `eps_diluted`.
- Balance sheet (instant): `property_plant_and_equipment`, `capital_work_in_progress`, `right_of_use_assets`, `goodwill`, `other_intangible_assets`, `non_current_investments`, `deferred_tax_assets`, `total_non_current_assets`, `inventories`, `current_investments`, `trade_receivables`, `cash_and_cash_equivalents`, `other_bank_balances`, `total_current_assets`, `total_assets` (= non-current + current), `equity_share_capital`, `other_equity`, `equity_attributable_to_owners`, `non_controlling_interests`, `total_equity`, `non_current_borrowings`, `non_current_lease_liabilities`, `deferred_tax_liabilities`, `total_non_current_liabilities`, `current_borrowings`, `current_lease_liabilities`, `trade_payables`, `total_current_liabilities`, `total_liabilities`, `total_equity_and_liabilities` (= equity + liabilities).
- Cash flow (duration): `cash_flow_opening_profit_before_tax` or `cash_flow_opening_profit_after_tax` (Indian cash flows open with one or the other; the mapping rule reads which from the label, and each cross-checks its own P&L line), `net_cash_from_operating_activities`, `net_cash_from_investing_activities`, `net_cash_from_financing_activities`, `effect_of_exchange_rate_changes_on_cash`, `net_change_in_cash` (= operating + investing + financing + exchange effect), `cash_at_beginning_of_period`, `cash_at_end_of_period` (= beginning + change), `income_taxes_paid`, `interest_paid`, `purchase_of_property_plant_and_equipment`, `dividends_paid`.

Phase 5 adds the note families: `segment_revenue`, `segment_result`, `segment_assets`, `segment_liabilities` (dimension `segment`); `borrowings_amount` (dimensions `tenure`, `security`); `number_of_equity_shares_outstanding` (instant, count), `weighted_average_shares_basic`, `weighted_average_shares_diluted` (duration, count), `face_value_per_share`; `dividend_per_share_declared`, `dividend_declared_total`; `related_party_transaction_amount` (dimensions `party`, `relationship`, `nature`), `related_party_balance` (instant). The exact list is settled in that phase's plan against the gold set.

A line no concept fits stays unmapped. There are no catch-all concepts: "other" lines are read and shown with their label, not forced into a bucket.

### 5.2 Columns added to `financial_fact`

| Column | Type | Set by | Meaning |
| --- | --- | --- | --- |
| `period_start` | `date`, nullable | rule | Durations only: the first day of the period, from `period_end` and `span`. |
| `span` | enum `quarter`, `half_year`, `nine_months`, `year`, `other`, nullable | rule | From the column header's words ("quarter ended", "three months", "six months", "half year", "nine months", "year ended"). Null when the header does not say. |
| `fiscal_year_end` | `date`, nullable | rule | The year end the period belongs to. For an annual report, the filing's own period end gives the month and day; a results filing's "year ended" column does; otherwise the company's year end known from any annual report of it; otherwise null. |
| `audit_status` | enum `audited`, `unaudited`, `reviewed`, nullable | rule | From "(Audited)", "(Unaudited)", "(Reviewed)" in the column header or the statement heading. |
| `dimensions` | `jsonb`, default `{}` | reader A | Note tables only: `{"segment": "Cement"}`, `{"party": "…", "relationship": "subsidiary", "nature": "sale of goods"}`. |
| `agreement` | enum `confirmed`, `unverified`, `disputed` | reconcile | Whether reader B read the same figure. Existing rows, and every fact written before reader B lands in phase 3: `unverified`. |
| `alternate_text` | `text`, nullable | reconcile | Reader B's text when it differs. |

`statement_kind` gains the note kinds: `segment_note`, `borrowings_note`, `share_capital_note`, `dividend_note`, `related_party_note`. Results filings need no new kind: their lines are `income_statement`, `balance_sheet` and `cash_flow` facts whose `span` is a quarter, half year or nine months.

A fact's identity, for everything that reads the series, is (company, concept, basis, `period_end`, `span`, `dimensions`).

### 5.3 New tables

**`concept_mapping`** — one per fact per mapping run, written by the worker with the revision and again by `document.map` (§6.10), immutable. The newest row per fact is current.

| Column | Meaning |
| --- | --- |
| `fact_id`, `revision_id` | The fact and its revision. |
| `job_id`, `created_at` | The job that wrote it (the extract job, or a later map job) and when. |
| `concept_id` | A taxonomy id, or null when nothing fits. |
| `source` | `rule` or `model`. |
| `rule_id` | The mapping rule that fired (`source = rule`). |
| `rules_version`, `taxonomy_version`, `prompt_version` | What produced it. |

**`concept_override`** — the investor's answer, per company, by label. Newest row per key is current; a row with `concept_id` null removes a mapping.

| Column | Meaning |
| --- | --- |
| `company_id` | The company. |
| `statement`, `basis`, `label_key` | The line: statement kind, basis, and the normalised section and label (`stitch.normalise`, the same key `stitch.ts` already builds, less the occurrence). |
| `concept_id` | The concept, or null. |
| `reason`, `set_by_user_id`, `created_at` | Why, who, when. |

Precedence on read: an override for the line's key, else the mapping. An override applies to every revision and filing of the company, past and future, so re-reading never loses a correction.

**`fact_review`** — the investor's verdict on one fact. Newest row per fact is current.

| Column | Meaning |
| --- | --- |
| `fact_id` | The fact. |
| `outcome` | `confirmed`; `use_alternate` (take reader B's figure); `corrected`. |
| `corrected_text` | For `corrected`: the figure as printed, typed by the investor; parsed by the same `parse_reported` rule. |
| `reason`, `reviewer_user_id`, `created_at` | Why, who, when. |

The fact row never changes. Readers prefer the reviewed figure and say so.

`extraction_check.check_type` gains `concept_sum`, `cross_statement`, `period_identity`, `eps_identity`. `extraction_revision` gains `artefact_key`: the object-store key of the extractor's full result (both readings, the mapping inputs), kept for replay and evaluation, never served to the browser.

### 5.4 The series

A query, not a table: `companySeries(workspace, company, {concepts, basis, spans, from, to, dimensions})`. The resolution logic is a pure function in `@maester/financial-engine` over rows that `@maester/db` fetches, with its own tests. For each (concept, basis, `period_end`, `span`, `dimensions`) it returns one entry:

| Field | Meaning |
| --- | --- |
| `value` | Exact decimal string in the canonical unit: rupees for `monetary` (the fact's `normalized_value`), rupees a share for `per_share` (`reported_value`), units for `count`. Null unless `status` is `value`. |
| `currency` | The fact's currency. Non-INR values are returned as they are; metrics refuse to mix currencies. |
| `status` | `value`, `dash`, `unparsed`, `missing`. |
| `fact_id`, `revision_id`, `document_id`, `page_index` | Provenance. |
| `printed` | The text as printed. |
| `mapping` | `{ source: rule \| model \| override, rule_id? }`. |
| `agreement` | From the fact. |
| `review` | The current review outcome, or null. When `use_alternate` or `corrected`, `value` is the reviewed figure and `original_value` holds the fact's. |
| `checks` | The worst status among the checks that cover the fact, with their types, as `stitch.checkFor` ranks them. |
| `restated_by` | An older filing's figure for the same key when it differs, as `stitch.ts` computes it today. |
| `filing` | The document, its classification `period_end` and `audit_status`. |

Which fact serves a key:

1. The newest filing that prints the period: latest classification `period_end`, then latest revision — stitch's rule, unchanged.
2. Within that revision, the first line by `line_order` whose resolved concept is the key's. A second line with the same concept in the same statement is an open issue (`DUPLICATE_CONCEPT`), not a silent choice.
3. A current `fact_review` with `use_alternate` or `corrected` replaces the value.

It is computed on read. At personal scale this is tens of filings; if it ever needs to be materialised, the shape stays.

## 6. Extraction pipeline

`PIPELINE_VERSION` becomes `extract-3`. The graph:

```text
prepare → locate ─► per target: read A ┐
                                read B ├► reconcile → map → check ─┬► done
                                       ┘       ▲                   └► correct ┘
                  → assemble
```

### 6.1 prepare

As today (pypdf: page count, text layer, subsets), plus, per page with a text layer, the positioned words from `pdfplumber` for reader B. A page with no words is a scan; reader B is absent there.

### 6.2 locate

Targets:

| Target | Found by |
| --- | --- |
| Balance sheet, income statement, cash flow, by basis | Heading rules (the classify `STATEMENT_RULES` moved into a shared module), then the model for anything the rules did not find, as today. |
| Results statement (a quarterly, half-year or annual results filing) | Heading rule ("Statement of … financial results for the quarter/half year/nine months/year ended …"), then the model. Its lines are income statement lines; a results filing with a statement of assets and liabilities or a cash flow (half-year and annual results) yields those targets too. |
| Segment note | "Segment information", "Segment reporting", "Operating segments", "Segment-wise revenue, results, assets and liabilities" (results filings carry this too). |
| Borrowings note | "Borrowings", "Non-current borrowings", "Current borrowings" as a note heading. |
| Share capital note | "Equity share capital", "Share capital", "Earnings per share" (for weighted average shares). |
| Dividend note | "Dividend", "Distributions made and proposed". |
| Related party note | "Related party transactions", "Related party disclosures". |

Each target is at most `max_pages_per_target` pages (6 for statements as today; notes may be set per kind in the plan). A target on more pages is recorded in coverage as failed with the reason, as today.

### 6.3 read A

Gemini, one call per target, with a prompt per target kind. Statement prompts are today's. Note prompts describe the note's own table: a segment note is blocks (revenue, result, assets, liabilities) of rows (segments) by period; a related-party note is rows of party, relationship, nature and amount by period; a borrowings note is rows by tenure and security. Every value is text as printed, with its page in the sub-PDF, as today. `dimensions` come from the row's own headers.

### 6.4 read B

Deterministic, no model call. Over the target's pages: words grouped into lines by their y position; numeric columns found by the x alignment of number tokens across lines; each row's label is the text left of the first numeric column, with continuation lines that carry no number joined to the label above; column headers are the lines above the first numeric row that carry period words or dates. Output: the same shape as reader A (rows with label, page, values by column header). When the parser finds no table on the pages (a scan, or a layout it cannot read), reader B is absent and a `READER_B_UNAVAILABLE` warning names the target.

Reader B's known limits, to be measured by the evaluation rather than designed around: merged header cells, labels wrapped across a page break, footnote markers glued to numbers, two tables side by side.

### 6.5 reconcile

Rows aligned by normalised label (`normalise`, as `stitch.ts`) and order; columns by normalised header. Per cell, after `parse_reported` on both:

| A and B | Agreement | Action |
| --- | --- | --- |
| Same decimal, or both a dash | `confirmed` | — |
| B absent, or B has no cell for this row and column | `unverified` | — |
| Different | `disputed` | `alternate_text` = B's text; the cell is a problem for **correct**: "the page's text prints {B} here". |
| B has a row A does not | — | Warning `LINE_MISSED` with the label and page; a problem for **correct**: "the page prints a line {label} you did not return". |

`text_layer_match` stays as a column for compatibility and is now implied by agreement; a `disputed` fact may still have `text_layer_match = true` (the number is somewhere on the page), which is exactly why reader B exists.

### 6.6 map

Mapping rules (`pdf_financial_qa/concepts/rules.py`, `MAPPING_RULES_VERSION`), deterministic, in order of specificity: a rule matches the normalised label, optionally constrained by the normalised section and the statement kind, and names a concept and a `rule_id`. A line under "Non-current liabilities" labelled "Borrowings" maps to `non_current_borrowings`; the same label under "Current liabilities" to `current_borrowings`. Rules never guess: a label two rules claim with different concepts is left for the model.

Lines no rule placed go in one call per target to the classify model (flash): the statement, the section, the neighbouring labels and the taxonomy's concepts for that family; the answer is a concept id or `none` per line, validated against the taxonomy. Recorded as `source = model` with the prompt version. A failed mapping call leaves the lines unmapped with a `MAPPING_MODEL_FAILED` warning; it never fails the extraction.

### 6.7 check

All deterministic, on `Decimal`s in the statement's own unit as today, with today's tolerance (0.5% relative, 1.0 absolute). Five kinds:

| `check_type` | What | Inputs |
| --- | --- | --- |
| `subtotal` | Today's: a printed subtotal against the model's own component list. | `component_labels` |
| `concept_sum` | A concept against its taxonomy `sum_of`, independent of anything the model claimed: `total_assets` = non-current + current; `total_income` = revenue + other income; `profit_after_tax` = `profit_before_tax` − `total_tax_expense`; `net_change_in_cash` = operating + investing + financing + exchange effect; `cash_at_end_of_period` = beginning + change. | mapped concepts |
| `balance_identity` | Today's, now on concepts: `total_assets` = `total_equity_and_liabilities`. The label heuristics stay only as a fallback when the concepts are unmapped. | mapped concepts |
| `cross_statement` | The cash flow's opening profit against its own P&L line (`cash_flow_opening_profit_before_tax` ↔ `profit_before_tax`, `cash_flow_opening_profit_after_tax` ↔ `profit_after_tax`) for the same period and basis; `cash_at_end_of_period` against `cash_and_cash_equivalents` at the period end. The cash check is `not_checked` with the reason "the cash flow's cash may net bank overdrafts" when the two differ by more than the tolerance and the balance sheet prints a current borrowing; never a silent pass, never a failure that masks a definition difference. | mapped concepts across targets |
| `period_identity` | In a results filing that prints both: the fourth quarter = year − nine months; the half year = Q1 + Q2; nine months = half year + Q3. | mapped concepts across columns |
| `eps_identity` | `eps_basic` against `profit_attributable_to_owners` (or `profit_after_tax`) ÷ `weighted_average_shares_basic`, when the share capital note gives the weighted average. Tolerance: 1% relative, because filings round differently. | phase 5 |

A failed check names its cells and routes to **correct** as today, with reader B's text as evidence where it has one. "Not checked" always carries its reason.

### 6.8 correct

As today: at most two attempts per target; a corrected figure must appear in the page's text layer; `CORRECTION_REJECTED` otherwise. The problems now include disputed cells and missed lines.

### 6.9 assemble

Facts as today plus the period fields and `audit_status` by rule:

- `span` from the header words. `period_start` from `period_end` and `span`: a year starts a year less a day before; a quarter on the first day of the month two months before the end month; a half year five months before; nine months eight months before. `other` and null spans leave `period_start` null.
- `fiscal_year_end` as §5.2.
- A fact whose mapped concept is `per_share` or `count` is stored at `scale_factor` 1, whatever the statement's unit note says, as per-share lines are today by regex; the regex stays as the fallback for an unmapped line.
- A header the rules cannot read leaves all three null. The fact keeps its label and is shown with it; the series leaves it out and counts it, as `stitch.ts` counts `unplaced` today.

The wire format (`contracts.py`, `extraction.ts`) gains the new fields, check types and warning codes; the golden fixtures in `packages/contracts/fixtures/extraction/` are extended, so both runtimes stay in step.

### 6.10 Re-mapping without re-reading

`POST /v1/map` on the extractor takes a revision's lines (statement, basis, section, label, neighbours) and returns their mappings, rules then model, exactly as §6.6. A `document.map` job in the worker calls it for a stored revision and writes a new set of `concept_mapping` rows (the newest set per revision is current). It runs after a taxonomy or rules change, from the eval harness and from a one-off command over every revision in a workspace, so mapping improves without another read of the PDF.

### 6.11 Budget and versions

`max_model_calls` becomes a setting with a default of 60: an annual report with both bases and five notes is about 11 reads, 11 mapping calls, locate chunks and corrections. The deadline stays 14 minutes. Versions on the revision: `pipeline_version`, `prompt_version`, `model`, and now `mapping_rules_version` and `taxonomy_version` on each mapping.

## 7. Calculations

### 7.1 The package

`packages/financial-engine-ts` (`@maester/financial-engine`), today a placeholder, becomes the home of every calculation. It depends on `@maester/contracts` and `decimal.js` and on nothing else; it has no database access. Modules:

- `decimal`: `decimal.js` configured for 40 significant digits, rounding only in display helpers; `moveDecimal` and `roundTo` move here from `stitch.ts` and are re-exported for it.
- `concepts`: the taxonomy loader and types.
- `series`: the pure resolution of §5.4 over rows.
- `periods`: span arithmetic, the year before, TTM windows.
- `metrics`: the registry and `compute`.

### 7.2 The registry

Each metric:

| Field | Meaning |
| --- | --- |
| `id`, `version` | `net_margin`, 1. A change in formula or convention bumps the version; results carry it. |
| `label`, `description` | Plain words, including the convention ("ROE uses the average of opening and closing equity"). |
| `inputs` | Each: a role, a concept, and a period rule: `same` (the metric's period), `prior_year` (the same span a year earlier), `instant_at_end`, `instant_at_start`, `average_of_ends`, `ttm`. Some inputs are alternatives in order (`profit_attributable_to_owners`, else `profit_after_tax`), and the result says which was used. |
| `spans` | Which spans the metric accepts (`year`; `year, quarter`; `ttm`). |
| `formula` | A pure function of named `Decimal`s to a `Decimal`. |
| `unit` | `ratio`, `percent`, `rupees`, `times`, `rupees_per_share`. |
| `unavailable_when` | The cases the function must refuse, each with a code (§7.4). |

First set, with conventions:

| Metric | Formula | Notes |
| --- | --- | --- |
| `difference`, `pct_change` | b − a; (b − a) ÷ |a| | Generic, over any one concept and two periods. `pct_change` unavailable on a zero base; on a negative base it is reported with the base's sign stated. |
| `revenue_growth`, `profit_growth`, `eps_growth` | `pct_change` of the concept against the year before | |
| `gross_margin` | (revenue − materials − purchases − changes in inventories) ÷ revenue | Unavailable when any cost line is missing; the result names the lines. |
| `operating_margin` | (PBT + finance costs − other income) ÷ revenue | Ind AS statements print no operating profit; this is a stated convention, in the description. |
| `net_margin` | `profit_after_tax` ÷ `revenue_from_operations` | |
| `roe` | PAT ÷ average of opening and closing `total_equity` | `equity_attributable_to_owners` first when printed. |
| `roce` | (PBT + finance costs) ÷ average of (total assets − current liabilities) | |
| `debt_to_equity` | (non-current + current borrowings) ÷ total equity | Lease liabilities excluded, said so. |
| `interest_coverage` | (PBT + finance costs) ÷ finance costs | Unavailable when finance costs are zero. |
| `cash_conversion` | CFO ÷ PAT | Unavailable when PAT ≤ 0. |
| `free_cash_flow` | CFO − purchase of PPE | Rupees. |
| `pe` | last close ÷ `eps_basic` of the newest year | Unavailable: no price, a loss, another currency, no EPS. Takes the price as a parameter from the API, which reads it from `market_point`. |
| `ttm_revenue`, `ttm_profit` | Four consecutive quarters; else year + year-to-date − prior year-to-date | The method used is in the result; a gap makes it unavailable. Phase 4. |
| `market_cap`, `dividend_payout`, `dividend_yield` | close × shares outstanding; dividends ÷ PAT; DPS ÷ close | Phase 5. |

### 7.3 The result

```json
{
  "metric": "net_margin", "version": 1,
  "company_id": "…", "basis": "consolidated",
  "period": { "end": "2026-03-31", "span": "year", "fiscal_year_end": "2026-03-31" },
  "value": "0.12063", "unit": "ratio",
  "unavailable": null,
  "formula": "profit_after_tax / revenue_from_operations",
  "inputs": [
    { "role": "numerator", "concept": "profit_after_tax", "period_end": "2026-03-31", "span": "year",
      "value": "14590000000", "currency": "INR", "fact_id": "…", "document_id": "…", "page_index": 212,
      "mapping": { "source": "rule", "rule_id": "is.profit_for_the_year" }, "agreement": "confirmed", "review": null }
  ],
  "caveats": [],
  "computed_at": "2026-10-15T09:30:00Z"
}
```

`caveats` are sentences a consumer must repeat: "profit_after_tax was mapped by the model and is not reviewed", "revenue_from_operations is disputed: the page's text prints 1,21,054", "the subtotal check on total expenses failed". An unavailable result has `value: null` and `unavailable: { code, detail }`.

### 7.4 Unavailable codes

`MISSING_INPUT`, `ZERO_BASE`, `LOSS` (a negative numerator where the metric is undefined for one), `MIXED_BASIS`, `MIXED_CURRENCY`, `SPAN_MISMATCH`, `PERIOD_GAP` (TTM), `NO_PRICE`, `METRIC_UNKNOWN`, `CONCEPT_UNKNOWN`, `AMBIGUOUS_INPUT` (two lines map to the input's concept). Each has a sentence for the UI in `lib/content/research.ts`.

### 7.5 Fixtures

Every metric has a fixture: input facts as decimal strings and the expected result, worked out by hand or in a spreadsheet and recorded with how, never produced by `compute`. Fixtures cover the unavailable cases too. `QUALITY.md` §3's "100% of deterministic fixtures pass" is the gate.

## 8. API, MCP and web

### 8.1 API

Under `/v1/workspaces/:ws`:

| Route | Returns |
| --- | --- |
| `GET /concepts`, `GET /metrics` | The taxonomy and the registry with descriptions, so a client or an agent can discover them. |
| `GET /companies/:id/series?concepts=&basis=&span=&from=&to=` | §5.4. |
| `POST /companies/:id/compute` `{ metric, period_end, span, basis, params }` | One calculation result. `GET /companies/:id/metrics?period_end=&span=&basis=` returns the whole first set for a period. |
| `GET /facts/:id` | The fact with its source, mapping, override, checks, reviews and `alternate_text`: everything a citation needs. |
| `POST /facts/:id/review` `{ outcome, corrected_text?, reason }` | A `fact_review` row. |
| `PUT /companies/:id/concept-overrides` `{ statement, basis, label_key, concept_id, reason }` | A `concept_override` row. |
| `POST /documents/:id/map` | A `document.map` job. |

`GET /companies/:id/financials` keeps its shape and adds `concept` (id, source) per row and `agreement` per cell. The stock summary's figures (`pe`, the changes) come from `compute`; the web no longer divides.

### 8.2 MCP server

`apps/mcp`: TypeScript, `@modelcontextprotocol/sdk`, stdio transport. Reads Postgres through `@maester/db` with `DATABASE_URL`; the workspace is `MAESTER_WORKSPACE_ID` (or the first workspace of `MAESTER_USER_EMAIL`). It imports the same functions the API routes call; it has no HTTP server and no auth of its own because it runs on the investor's own machine for their own workspace. **Read-only.** Tools:

| Tool | Returns |
| --- | --- |
| `list_companies()` | id, name, NSE and BSE codes, filings read by kind, latest period, open issue counts. |
| `list_concepts()`, `list_metrics()` | The taxonomy and registry. |
| `get_series(company_id, concepts[], basis?, span?, from?, to?, dimensions?)` | §5.4 entries. |
| `compute(company_id, metric, period_end, span?, basis?, params?)` | §7.3. |
| `get_fact(fact_id)` | Full provenance, the printed text, the alternate reading, checks and reviews, and the page number to open in the Research page. |
| `list_open_issues(company_id?)` | Disputed cells, failed checks, unmapped lines, model-mapped lines not yet reviewed, duplicate concepts. |

Every tool description carries the answer rules (§10). Reviews and overrides are not tools: the agent surfaces issues, the investor settles them in the terminal.

### 8.3 Web

- The statement table shows a row's concept (its label, muted, under the printed name when mapped) and marks a disputed cell in words.
- The figure panel's "On the page" row becomes the agreement sentence: "Read twice: both readings agree."; "Read once: page 213 has no text to check against."; "**Readings differ.** The model read 1,234; the page's text prints 1,243." Its "Reviewed" row gains three outline actions: "Confirm"; "Use the page's reading" (disputed cells only, both figures shown); "Correct", which opens a field for the printed figure and a reason. After a review the row says the outcome and who, and the figure shows the reviewed value with "reviewed" beside it.
- A new "Concept" row: the concept's label with its source in words ("by rule", "by the model, not reviewed", "set by you") and a "Change" that opens a list of the family's concepts and a reason field, writing an override.
- The summary's P/E and changes are formatted from calculation results; a caveat in the result appears as the figure's note.

These follow the figure panel's existing contract (spec list rows, outline buttons, a 3px border and bold text for an error) and are added to `DESIGN.md` §5 when built. If the panel needs more than that, the `design-directions` skill runs first.

## 9. Evaluation

`apps/eval`, a Python app in the uv workspace, command `maester-eval`.

- **Corpus.** `data/eval/corpus/<company>/<filing>.pdf`, git-ignored. The investor's own filings: annual reports and results of companies they hold, digital and scanned, both bases. Split by company into a development set and a held-out set; a company is in one set only.
- **Gold.** `data/eval/gold/<filing>.json`, committed (public figures, small). Per filing: the material facts (concept, basis, `period_end`, `span`, printed text, value, unit scale, page, dimensions) and the expected check outcomes. Labelling: `maester-eval export` writes a sheet per filing from the pipeline's reading; the figures are corrected against the PDF by hand; `maester-eval freeze` writes the gold file. Material facts (totals, PAT, revenue, cash, borrowings, EPS) are checked by a second pass before freezing, as `QUALITY.md` §2 asks.
- **Modes.** `live`: through the extractor over HTTP, real model calls, producing revisions in a local database and artefacts. `replay`: from the corpus PDFs and the stored artefacts (reader A's output), re-running reader B, reconcile, map and check with no model call, so a rule, taxonomy or parser change is measured in seconds. `calc`: the metric fixtures and the series resolution tests.
- **Report.** Per run, stratified by digital/scanned, annual/results and basis: fact exact match (value, sign, period, unit, basis as one success) against gold; mapping coverage by source (rule, model, none) and mapping accuracy against gold; agreement mix; check coverage and pass rate; model calls, time and bytes per filing; failures by code. Written to `data/eval/runs/<timestamp>/` and summarised in `docs/eval/<date>-<label>.md`, committed.
- **Baseline.** The first run is on today's pipeline (`extract-2`) over the development set, before anything changes. Every later report shows the delta against the previous one.
- **Gate.** A change to a prompt, mapping rule, the taxonomy, reader B or a metric lands with a report; no regression on the held-out set.

## 10. Rules

The answer rules, for any model that reads Maester's figures (tool descriptions, the future Analyst's prompt, this repository's agents):

1. A number in an answer is a fact (fact id, filing, page) or a calculation result (metric id and version, input fact ids). Nothing else.
2. The model never adds, divides, compares or ranks figures itself; it calls `compute`. When no metric exists it says so.
3. Unknown is unknown: null with its reason, never zero, never an estimate.
4. Basis, currency, unit, span and period accompany every figure; consolidated and standalone never mix.
5. A disputed, failed-check, model-mapped or unreviewed figure is said to be so.
6. No advice words; direction with a sign or a word.

The developer rules are in the project `CLAUDE.md` ("Financial figures") and the `financial-figures` skill, which holds the checklists for adding a concept, a mapping rule, a metric or a check, changing a prompt or reader B, and showing a figure.

## 11. Phases

Each phase is its own implementation plan from this document, lands on `staging`, ends with an evaluation run and updates `EXTRACTION.md`, `DATA_MODEL.md`, the `docs/systems/*` descriptions and, for web changes, `DESIGN.md` §5.

| Phase | Builds | Done when |
| --- | --- | --- |
| 0 · Baseline | `apps/eval` (`live`, `export`, `freeze`, the report); `data/eval/corpus/` git-ignored and loaded; gold v1 for the three statements of the development set; `docs/eval/` baseline on `extract-2`. | The baseline report is committed and the held-out set is sealed. Nothing else changes before this. |
| 1 · Concepts and calculations | Migration 0006; taxonomy v1 and its Python copy; mapping rules and the flash fallback; `/v1/map` and `document.map`; `concept_override`; the series; `@maester/financial-engine` with decimals, series resolution and the first metrics (growth, margins, ROE, ROCE, debt to equity, coverage, cash conversion, FCF, P/E); `/concepts`, `/metrics`, `/series`, `/compute`, `/facts/:id`; the summary and the table moved onto them; `stitch.ts` on the shared decimals; existing revisions re-mapped. | Mapping coverage and accuracy reported on the development set; every metric fixture passes; the web does no arithmetic; `replay` mode works. |
| 2 · MCP | `apps/mcp` with its tools (§8.2); `DEVELOPMENT.md` on connecting Claude Desktop and Claude Code to it; the CLI's `ask` marked deprecated. | An agent answers a margin or growth question with fact ids and pages, and refuses one it has no metric for. |
| 3 · Two readers | `pdfplumber` reader B; reconcile; concept, balance (on concepts) and cross-statement checks; `agreement` written; review actions and the concept row in the figure panel; `/facts/:id/review` and the overrides route. | Agreement mix and the check pass rate in the report; the delta on exact match against the baseline; a disputed cell can be settled in the terminal. |
| 4 · Results | The results statement target; `span`, `period_start`, `fiscal_year_end`, `audit_status`; period identities; TTM metrics; results in the series and the Research table's quarter view. | Gold v2 covers results filings; period identities report; TTM fixtures pass. |
| 5 · Notes | The five note targets and prompts; `dimensions`; the note concepts; the EPS identity; `market_cap`, `dividend_payout`, `dividend_yield`, segment shares. | Gold v3 covers the notes; the note metrics' fixtures pass. |

## 12. States and errors

| State or error | Where | Meaning |
| --- | --- | --- |
| Agreement `confirmed`, `unverified`, `disputed` | `financial_fact` | Both readers agree; reader B absent; readers differ, `alternate_text` holds B's. |
| Mapping source `rule`, `model`; `override` | `concept_mapping`, `concept_override` | How the line got its concept. The series says which applied. |
| Review `confirmed`, `use_alternate`, `corrected` | `fact_review` | The investor's verdict; the series prefers the reviewed figure. |
| Open issues `DISPUTED`, `CHECK_FAILED`, `UNMAPPED`, `MODEL_MAPPED_UNREVIEWED`, `DUPLICATE_CONCEPT` | `list_open_issues`, the figure panel | What needs a person. |
| Warnings `READER_B_UNAVAILABLE`, `LINE_MISSED`, `MAPPING_MODEL_FAILED`, `TARGET_PAGES_EXCEEDED` | revision `warnings` | Reader B could not read a target; B found a line A missed; the mapping call failed; a note was on too many pages. |
| Calculation unavailable (§7.4) | calculation result | Null with its code and sentence. |
| `MAP_FAILED` | `document.map` job | The extractor's `/v1/map` failed; the previous mapping stays current. |

## 13. Testing

- Python, offline: reader B on synthetic text-layer PDFs built in the test (`tests/pdf_fixtures.py` gains positioned words and multi-column tables); reconcile on scripted readings; the mapping rules on a labelled list of Schedule III lines; the new checks on drafted statements; period rules on header strings; the whole graph with a scripted model, as today.
- Contracts: golden fixtures extended for the new fields, check types and the `/v1/map` shape, validated by Zod and Pydantic.
- TypeScript: the taxonomy loader and the Python copy in step; series resolution over fixture rows (precedence, overrides, reviews, duplicates); every metric's fixture and unavailable cases; the worker's write of mappings and the artefact; `document.map`; the routes with cross-workspace isolation; the MCP tools against a seeded database.
- Web: the summary formats results and never computes; the figure panel's review and concept flows; the design guard unchanged.
- Evaluation: `replay` and `calc` run in CI on the committed gold and artefact fixtures; `live` is manual and never in CI.

## 14. Out of scope

OCR for scanned pages (reader B is absent and the fact says `unverified`); the Analyst page and any chat UI; MCP over HTTP or any remote access; automated acceptance of a model's mapping as reviewed; sector-specific taxonomies (banks and insurers print different statements and are unmapped beyond the common lines until a later taxonomy version); XBRL ingestion; a materialised series; editing a fact's value other than through a review; shared reference companies.

## 15. Consequences

- Existing revisions get mappings through `document.map` without a re-read; they stay `unverified` until read again ("Read it again" on the slip).
- `stitch.ts` keeps its job for the as-printed table and loses its private decimal helpers to the engine package.
- `summary.ts` shrinks to words and formatting.
- The CLI's `ask` is deprecated in phase 2 and removed once the MCP server answers the same questions with lineage; `ingest` and `list-docs` stay as reference behaviour per ADR 0004.
- `docs/systems/extractor.md`, `worker.md`, `api.md`, `packages.md` and `web.md` gain the new parts and procedures; `EXTRACTION.md` points here for everything after `extract-2`.
