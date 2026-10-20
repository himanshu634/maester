# Ingestion phase 4: XBRL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An XBRL instance the investor uploads (one file, a dropped folder or a folder imported from the command line) becomes facts with their source, element, span, basis, unit and precision; a results PDF whose statements XBRL already covers is not read by Gemini; the reads, the Research stitch and a new per-document `pipeline` object and `GET …/filings` route say which source every statement's numbers come from.

**Architecture:** The extractor gains `/v1/xbrl` (modes `classify`, `read`, `text`) and `/v1/xbrl/pdf-check`, over our own `lxml` parser in `packages/financial-engine/src/pdf_financial_qa/xbrl/` with one reviewed element map per mapped format. The worker sniffs XML in `document.verify`, classifies an XBRL instance with no model in `document.classify`, reads it in a new `document.xbrl` job (limit 2) into an `extraction_revision` with `source = 'xbrl'`, and runs the `xbrl_in_pdf` check in a new `document.xbrl_check` job. `decideIntake` applies the source rule, a named, versioned function in `@maester/financial-engine` with a Python twin in `apps/eval`, both tested against one fixture: XBRL wins a slot, a PDF whose bases XBRL covers skips Gemini, and a PDF waits (`waiting_for_xbrl`) for XBRL dropped with it. XBRL text blocks go into the phase 2 index through the extractor's `text` mode and a new indexer route that chunks given text.

**Tech Stack:** Python 3.12, lxml (pinned), FastAPI, python-multipart, Pydantic, unittest; TypeScript, Hono, Zod, Drizzle and drizzle-kit, saxes (pinned), Vitest; Postgres 16 with pgvector.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §6, §7, §8.1 (XBRL text blocks), §11, §13, §14, §15, §16 phase 4, §17 and §19. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §4. Screen contract: [`docs/superpowers/specs/2026-10-19-documents-filings-design.md`](../specs/2026-10-19-documents-filings-design.md) §3, §8 and §9 (the six asks and the filings route). Rules: [financial data layer](../specs/2026-10-15-financial-data-layer-design.md) §4 (span names), [ADR 0006](../../decisions/0006-concepts-calculations-agent-access.md), [ADR 0007](../../decisions/0007-ingestion-pipeline.md), `CLAUDE.md` "Financial figures". Builds on the [phase 2 plan](2026-10-20-ingestion-phase-2-index.md).

## Survey of the instances on hand

Read-only, 20 October 2026, over the 807 files in `~/Personal/maester-filings/xbrl/`. Only element names, context ids, enumerated values and counts were taken, never a figure. Task 4 repeats it with a committed command.

- **Namespaces.** Facts are in exactly one namespace per file: `http://www.sebi.gov.in/xbrl/2025-01-31/in-capmkt` (412 files) and `…/2026-01-31/in-capmkt` (201), `http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin` (178) and `…/2019-09-30/in-bse-fin` (16, banking). The root is `{http://www.xbrl.org/2003/instance}xbrl`. A comment comes before the root (`<!--IFIndAs V1.0 (07-10-2025)-->`). No DOCTYPE in any file.
- **Formats** by file-name token: `Integrated_Finance_Ind_As` 550, `Main_Ind_As` 174, `IFBanking` 49, `Banking` 16, `Integrated_Finance_NBFC` 12, `NBFC` 4, `IFOtherthan` 2. **The mapped Ind AS formats are 724 files, not the 550 the spec says** (550 is the in-capmkt Ind AS count alone).
- **Telling formats apart by elements** (numeric facts), checked on every file: banking always has `CET1Ratio` and `AdditionalTier1Ratio`, which no Ind AS file has. NBFC always has `InterestEarned`, `FeesAndCommissionIncome` and `ImpairmentOnFinancialInstruments`, and no Ind AS file has these. "Other than Ind AS" has `CashFlowsFromUsedInOperatingActivitiesBeforeExtraordinaryItems` and `AdjustmentsForWorkingCapital`, and has no `ComprehensiveIncomeForThePeriod`. Ind AS always has `ComprehensiveIncomeForThePeriod` and `BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations`. Element names are the same in in-capmkt Ind AS and in-bse-fin Ind AS.
- **Identity and metadata** (non-numeric facts in context `OneD`): `NameOfTheCompany`, `ScripCode`, `Symbol`, `ISIN`, `NatureOfReportStandaloneConsolidated` (`Consolidated` 715, `Standalone` 705, never both in one file), `WhetherResultsAreAuditedOrUnaudited`, `DateOfStartOfReportingPeriod`, `DateOfEndOfReportingPeriod`, `ReportingQuarter` (`First quarter`, `Second quarter`, `Third quarter`, `Fourth quarter`, `Half yearly`, `Yearly`), `TypeOfReportingPeriod` (in-capmkt only: `Quarterly`, `Half Yearly`), `DescriptionOfPresentationCurrency` (`INR` in all 807). The entity identifier scheme is `http://www.sebi.gov.in/in-capmkt/ScripCode` or `http://www.bseindia.com/bse-fin/ScripCode`; it is not used.
- **Rounding.** `LevelOfRounding` (in-capmkt): `Crores` 339, `Millions` 157, `Lakhs` 117. `LevelOfRoundingUsedInFinancialStatements` (in-bse-fin): `Crores` 102, `Millions` 48, `Lakhs` 44. A Lakhs file holds facts with `decimals` −3, −4 and −5. Earnings per share has `decimals="INF"`. No monetary fact has `decimals="0"`. Over the 724 Ind AS files, the finest integer `decimals` minus the declared rounding's exponent is 0 in 212 files, 1 in 26, 2 in 461 and 3 in 25 (all monetary facts; non-dimensional facts alone give 220, 27, 453 and 24), so padding never goes past 3 places.
- **Units.** `INR` (`iso4217:INR`) and `INRPerShare` (`iso4217:INR` over `xbrli:shares`).
- **Contexts** without dimensions, by the file name's period token (files: `MC` 187, `JQ` 193, `SQ` 105, `SH` 92, `DQ` 99, `DN` 103, `MQ` 18, `MH` 10): `MC` (March, cumulative) `FourD, OneD, OneI, PY_I`; `MQ` (March quarter, the Q4 results case) `FourD, OneD, OneI, PY_I` with `OneD` 3 months and `FourD` 12; `MH` (half-yearly filers' second half) `FourD, OneD, OneI, PY_I` with `OneD` 6 months and `FourD` 12; `JQ` `OneD` or `OneD, OneI`; `SQ` and `SH` `FourD, OneD, OneI, PY_I`; `DQ` and `DN` `FourD, OneD` or `FourD, OneD, OneI`. Dimensional contexts carry their members in `scenario` (`OneExpenses1D`, `D_ItemsThatWillNotBeReclassifiedToProfitAndLoss11`), never in `segment`. `CashAndCashEquivalentsCashFlowStatement` comes in `PY_I` (opening) and `OneI` (closing).
- **Tokens by format.** `Integrated_Finance_Ind_As` (in-capmkt) has every token: `MC` 164, `JQ` 173, `DN` 93, `SH` 82, `MQ` 18, `SQ` 10, `MH` 10. `Main_Ind_As` (in-bse-fin) has only `SQ` 85 and `DQ` 89, so its instances hold no full year, and only its `SQ` files hold a balance sheet and a cash flow.
- **`ReportingQuarter` against the dates.** The span of `DateOfStartOfReportingPeriod` to `DateOfEndOfReportingPeriod` is 3 months in 796 files and 6 months in 11 (`MH` 10, `MC` 1). The word disagrees with the dates in 106 files: the 11 six-month files say `Yearly`, and 95 `SQ` files (85 Ind AS, 10 other) say `Half yearly` over three-month dates. `MC` and `MQ` files say `Fourth quarter` over three-month dates.
- **Text blocks.** Three elements end in `TextBlock`: `DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock` (403 files), `DisclosureOfNotesOnSegmentsExplanatoryTextBlock` (162) and `DisclosureOfNotesOnAssetsAndLiabilitiesExplanatoryTextBlock` (84). Long text also sits in elements ending in `Explanatory`, such as `RelatedPartyTransactionExplanatory` (904 facts). Their text is escaped HTML.
- **Sizes.** Median 53,615 bytes; the largest is 7,915,421 bytes. No `xsi:nil` occurs.

## Where this plan departs from the spec, and why

1. **Span names are the data layer's.** §7.2 lists `full_year` but says the columns come "with its names". The data layer (§4) names the span `quarter`, `half_year`, `nine_months`, `year` and `other`, so the `fact_span` enum uses those names. The classification's `results_span` keeps `full_year`. `toResultsSpan(span)` in `@maester/contracts` maps `year` to `full_year`.
2. **A filing is keyed without the span.** The screen spec keys a filing by `(company_id, kind, period_end, span)`. The PDF classifier's span is the first span phrase on the title pages ("quarter and half year ended" is one filing). The XBRL span comes from the reporting period's dates. The two disagree on the same filing. This plan keys by `(company_id, kind, period_end)` and lists the spans, and the skip rule matches XBRL to a PDF by company, `financial_results` and period end.
3. **ISIN and basis need columns.** Identity uses `ISIN` (§6.2), but `company` and `document_classification` have no ISIN. Migration 0008 adds `company.isin` (unique per workspace when set) and `document_classification.isin`. `matchCompanies` matches by CIN, then by any of the BSE code, NSE symbol and ISIN, then by name. An instance's basis (`NatureOfReportStandaloneConsolidated`) has nowhere to live either: an unmapped instance (banking, NBFC) has `statementsFound` `[]` and a revision with no facts. So 0008 also adds `document_classification.basis reporting_basis null`, written for XBRL classifications only (null for a PDF, whose bases are in `statementsFound`).
4. **`xbrl_in_pdf` rows.** The check is per fact, it runs again when a PDF arrives after the XBRL, and the screen needs its page and reason (ask 6). So the rows are `extraction_check` rows (`check_type = 'xbrl_in_pdf'`, §13) with six new nullable columns: `fact_id`, `pdf_document_id`, `pdf_classification_id`, `page_index`, `reason` and `check_version`. A row's `revision_id` is the XBRL fact's revision. The new job `document.xbrl_check` writes them, once per (XBRL fact, PDF classification, `XBRL_PDF_CHECK_VERSION`). They are never updated: the facts and the revision's own checks stay as they are. A later PDF classification, a new XBRL revision (new fact ids) or a new check version adds a new set. Only `listXbrlPdfChecks` reads them: `listChecks` and `listChecksForRevisions` leave them out, so `GET …/extraction` and stitch see the revision's own checks only. "The units the PDF prints" is taken to be the unit the XBRL declares (`LevelOfRounding`), because when Gemini is skipped nothing has read the PDF's unit. Task 20's paired-PDF run measures how often that holds. `XBRL_PDF_CHECK=false` does not stop the jobs: `enqueueXbrlPdfChecks` always enqueues (`packages/jobs` reads no settings), the worker's check job answers `disabled` and writes no row, and the API gives the reason `disabled`.
5. **`XBRL_MIXED_BASIS` is held as "what is it?".** The intake states have no basis question. An instance that states both bases, or neither, is classified `not_sure` with the warning, so `decideIntake` holds it as `needs_kind`. If the investor then says "financial results", its facts are read with basis `unknown`, and a fact of unknown basis covers no slot.
6. **The Q4 question is left out, with no setting.** One function answers it: `annualSlotOf` in `@maester/financial-engine` (Task 9) gives no annual slot to any fact of a `financial_results` filing, so a results instance's full-year facts never fill an annual column, and stitch admits facts to the annual table only through it (Task 14). Today the `/financials` route also sends annual reports only (`counts()` in `apps/api/src/routes/research.ts`); that filter stays, but it is no longer the only guard. A "yes" from the investor changes four places, listed under "Open questions for the investor".
7. **The `pipeline` shape grows to carry the asks.** The changes are these:
   - `coveredByXbrl` is an array, because consolidated and standalone are two instances.
   - `identified` gains `waiting` (not stored yet).
   - `numbers.state` gains `not_read`, with a `reason` and a `format` (ask 3).
   - `waiting` carries `waitingOn` (ask 2).
   - `text` gains `xbrlBlocks` and `ahead` (ask 4).
   - Keys are camelCase on the wire, like every other contract.
8. **A PDF that skips Gemini goes to `read`** with no revision. The slip's "Ready" and the screen's "From XBRL" both read it that way. Only `financial_results` can skip, so Research's `counts()` (annual reports only) is unaffected. Today's slip offers "Read it again" on every `read` document, and that posts `/extract`, a Gemini Pro read. So `/extract` on a `pdf` `financial_results` document runs the source rule first and refuses a covered PDF (Task 12), and the slip hides the button for a PDF whose numbers come from XBRL (Task 19).
9. **New codes.** `XBRL_ROUNDING_MISSING` (no declared rounding: the unit is unknown and the revision is `partial`). `XBRL_UNIT_UNSUPPORTED` (a mapped element whose unit is neither money nor money per share: no fact is written for it). `XBRL_NOT_INSTANCE` is not added: verify answers `UNSUPPORTED_TYPE`.
10. **Who releases a waiting PDF.** A PDF waits on XBRL documents whose company is not known yet: during a folder import, that is every one of them. So each time an XBRL document settles, every waiting PDF of the workspace is decided again, not only those of that company. Each new decision is cheap and idempotent. An upload still at `pending_upload` holds no PDF, so an abandoned upload never holds one forever. XBRL that arrives later still takes its slots (§6.3.4).
11. **The map's sums.** A sum whose lines are all absent from the instance is `not_checked`. When some lines are absent, the check runs over the lines present, and its `detail` names the absent elements. A nil line makes the sum `not_checked`. The spec says the finest `decimals` is the sums' tolerance. A single 10^(−finest) is tighter than rounding allows: seven expense lines and their total, each rounded to the thousand, can be off by 4,000 rupees with nothing wrong. So the tolerance is n × ½ × 10^(−finest), where n counts the total and the parts present, and finest is the instance's `finest_decimals` (the largest integer `decimals` among the monetary facts the read writes). Eight lines at −3 give 4,000 rupees. A fact's own `decimals` is not used: in the filings on hand it mostly follows the value's trailing zeros, not how the value was rounded (research §4), so a crore total that happens to end in seven zeros would add 5,000,000 rupees of slack. Task 20's report shows how many sums pass under it.
12. **Precision is padded, never rounded, to the instance's finest.** `reported_value` is the value divided by the declared scale. It is written with at least max(0, finest_decimals − rounding exponent) places, padded with zeros, and never rounded. The rounding exponent is negative: −5 for lakh, so a lakh file whose finest is −3 writes 2 places, and −7 for crore, so a crore file whose finest is −5 writes 2 places for every value, a −7 total included ("1234567.00"). For the same trailing-zeros reason as Departure 11, per-fact padding would give one column several precisions. A per-share fact keeps its own places. **Restatement departs from §7.2**, which compares "at the declared rounding": stitch keeps its rule, the coarser of the two printed precisions, with an XBRL fact's printed precision being these padded places. Comparing in whole crores would hide a restatement smaller than a crore that both the PDF and the instance print.
13. **Cash balances in the cash flow.** `CashAndCashEquivalentsCashFlowStatement` is an instant. A map entry with a `cash_balance` block writes it once into each cash-flow duration column it opens (its instant is the day before the duration starts: the opening label and order) or closes (its instant is the duration's end: the closing label and order). The fact is written as the PDF reader writes a cash-flow line: the duration's `period_end`, `period_start`, `span` and period label, with `as_of_date` null. The instant's context stays in `xbrl_source.context_id`.
14. **Text blocks.** These are non-numeric facts whose element ends in `TextBlock` or `Explanatory` (the survey), with or without dimensions. The extractor's `text` mode turns their HTML into plain text. A new indexer route, `/v1/chunk-text`, splits it with the embedding model's tokenizer, because that tokenizer lives in the indexer. There is one hardened XML parser, not two.
15. **The import command** is a new pnpm package, `@maester/import` (`apps/import`). There is no `@maester/cli`: `apps/cli` is the Python app, and it has no API client. The command signs nothing: it reads the investor's session cookie from `MAESTER_SESSION_COOKIE`.
16. **Audit status** is read in classify mode and returned on the wire, but not stored. The data layer's phase 4 adds `audit_status`.
17. **The results span comes from the dates alone.** §6.2 takes the period from the reporting period's end and `ReportingQuarter` (and `TypeOfReportingPeriod`). This plan takes `resultsSpan` from `DateOfStartOfReportingPeriod` and `DateOfEndOfReportingPeriod` and does not read `ReportingQuarter`: the survey finds the word disagreeing with the dates in 106 of 807 files (Survey), while the dates agree with `OneD`'s own span in every file. Departure 2 keeps the span out of the filing key, so a disagreement could not split a filing anyway. No warning is raised, because one would fire on 106 files with nothing wrong in their dates.
18. **The concept is stored with the fact.** Each fact's map concept is written to `xbrl_source.concept` when the fact is written, so phase 5 reads the concept the revision was read under, not whatever the current map says.
19. **The check has a version.** `XBRL_PDF_CHECK_VERSION = 1` (Python `xbrl/__init__.py`, TypeScript `@maester/contracts`). It is in the check job's key, on each row (`check_version`) and in the rows' unique index, so a corrected check writes a new set beside the old one, and readers take the current version only.

## Not in this phase

- The Documents screen (`FilingList`, `Filing`, `Track`, `ConfirmCompanies`) and the figure panel's XBRL words: phase 6. Here, `apps/web` changes only its accept list, its browser check, the upload's MIME type, three copy strings, and the cases today's slip would otherwise get wrong: `waiting_for_xbrl`, evidence with no page, an XBRL re-read, and "Read it again" on a PDF whose numbers come from XBRL (Task 19).
- The source and format strata, `compare --xbrl`, and scoring the map against gold: phase 5. The map's evaluation here is the offline run of Task 20.
- Concept mappings written from the map (`concept_mapping` with source `xbrl_rule`): the data layer's phase 1. The map carries the concept, and the evaluation uses it.
- Dimensional facts (segments, related parties) as figures: the data layer's phase 5.
- Maps for banking, NBFC and "other than Ind AS": these formats are read, write no facts and carry `XBRL_FORMAT_UNMAPPED`.

## Global Constraints

- **Branching.** Branch from `staging` once PR #13 (phase 2) is merged, or from `feat/ingestion-index`. The migration is `0008_xbrl` (`pnpm --filter @maester/db generate --name xbrl`).
- **Financial figures** (`CLAUDE.md`, the `financial-figures` skill): decimal strings on the wire, `numeric` in Postgres, Python `Decimal` in the parser. The checks are these:
  - Never a float. `Number()` on a figure is a defect.
  - Unknown stays unknown: nil is `value_status = 'unparsed'` with `xbrl_source.nil = true` and the warning `XBRL_NIL`. A missing line is absent, never zero.
  - Basis, currency, unit, span and period are on every fact.
  - The element map is a mapping rule. A change to it, or to the parser or the sums, bumps `XBRL_MAP_VERSION` or `XBRL_PARSER_VERSION`; a change to `xbrl_in_pdf` bumps `XBRL_PDF_CHECK_VERSION`. Each ships with a `maester-eval xbrl-map` report under `docs/eval/`, and a check change with its `--pdfs` run (Task 20).
  - The source rule is `sourceRule` in `@maester/financial-engine` (`SOURCE_RULE_VERSION = 1`), with its fixture.
  - `apps/web` computes nothing.
- **The values.** These are fixed:
  - `XBRL_PARSER_VERSION = "1"`, `XBRL_MAP_VERSION = "1"`, `XBRL_TEXT_VERSION = "1"`, `XBRL_PDF_CHECK_VERSION = 1`.
  - Revision fields: `model` `"xbrl-parser-1"`, `pipeline_version` `"xbrl-1"`, `prompt_version` `"<format id>@<XBRL_MAP_VERSION>"` (for example `"in-capmkt/ind_as@1"`, or `"in-capmkt/banking@-"` unmapped).
  - Format ids are `<family>/<kind>`. Families: `in-capmkt`, `in-bse-fin`. Kinds: `ind_as`, `banking`, `nbfc`, `other_than_ind_as`, `unknown`. The mapped ids are `in-capmkt/ind_as` and `in-bse-fin/ind_as`.
- **Limits.** `XBRL_MAX_BYTES` 20971520, `XBRL_MAX_FACTS` 100000, `XBRL_DEADLINE_SECONDS` 30. Each is an extractor setting. Over any of them the answer is `XBRL_UNREADABLE`, not retried. `XBRL_SNIFF_BYTES` 65536 (worker).
- **Rounding words.** The value is matched case-insensitively and gives `unit_label`, `scale_factor` and the expected coarsest `decimals`:
  - `Crores`: `₹ crore`, 10000000, −7.
  - `Lakhs`: `₹ lakh`, 100000, −5.
  - `Millions`: `₹ million`, 1000000, −6.
  - `Thousands`: `₹ thousand`, 1000, −3.
  - `Billions`: `₹ billion`, 1000000000, −9.
  - `Actual`: `₹`, 1, 0.

  The symbol is `₹` for `iso4217:INR`; for any other currency the unit label starts with the ISO code. A **monetary** unit has one `iso4217:*` numerator and no denominator. A **per-share** unit has one `iso4217:*` numerator over `xbrli:shares`; its fact has `unit_label` `₹ a share` and `scale_factor` 1. Any other unit (`pure`, `xbrli:shares` alone) is neither, and the read writes no fact for it.
- **Spans from dates.** A duration whose start is the first of a month and whose end is the last day of a month spans n = 12·(end year − start year) + end month − start month + 1 months. n = 3 is `quarter`, 6 is `half_year`, 9 is `nine_months` and 12 is `year`. Any other duration is `other`. An instant has span null.
- **Period labels** come from the span and the dates, for example `Quarter ended 30 Sep 2025`, `Half year ended 30 Sep 2025`, `Nine months ended 31 Dec 2025`, `Year ended 31 Mar 2026`, `Period ended 30 Sep 2025` (`other`) and `As at 30 Sep 2025` (instant). The day has no leading zero and the month is a three-letter English abbreviation.
- **Jobs.** These are the new jobs:
  - `document.xbrl`: subject type `document`, pipeline version `readVersion(classificationId)`, limit 2, attempts 5.
  - `document.xbrl_check`: subject type `xbrl_pdf_check`, subject id the XBRL document, pipeline version `v<XBRL_PDF_CHECK_VERSION>:pdf-<pdf classification id>:xbrl-<xbrl revision id>` (both sides, so a new XBRL revision or PDF classification gets its own job), limit 2, attempts 5. `xbrlCheckKeyOf(idempotencyKey): { version: number; pdfClassificationId: string; xbrlRevisionId: string } | null` in `@maester/jobs` parses it back (`/:v(\d+):pdf-([0-9a-f-]{36}):xbrl-([0-9a-f-]{36})$/`), as `classificationIdOfReadJob` does.

  No paid call is made, so the default attempts apply.
- **No paid API calls** in tests or default paths. Tests use synthetic instances, a fake extractor client and the whitespace tokenizer. The live check (Task 21) uploads PDFs, which Gemini Flash classifies, and confirming a held company can send held PDFs to Gemini Pro: ask the investor before each.
- **No `docker compose up` in a worktree.** Database tests use the investor's Postgres on `localhost:5433` (the pgvector image). Tests on the real instances are gated on `MAESTER_XBRL_DIR` (for example `~/Personal/maester-filings/xbrl`) and skip without it. They read the files and write nothing.
- **No document text in logs**, errors or traces. This covers element values, text-block text, company names and file contents. Log ids, element names, counts, codes, versions and seconds.
- **Workspace isolation.** Every new table carries `workspace_id`, and every new query and route filters on it.
- `docs/systems/*.md` are ASD-STE100 Simplified Technical English (the `writing-ste` skill).
- **Root Python tests.** `tests/` has no `__init__.py` and its modules import siblings bare (`from pdf_fixtures import make_pdf`), so a single file runs as `uv run --locked python -m unittest discover -s tests -p '<file>.py' -v`, never as `tests.<module>`. `apps/indexer/tests` has an `__init__.py`, so `cd apps/indexer && uv run python -m unittest tests.<module> -v` is right there.
- **TypeScript checks.** `pnpm test` at the root runs every workspace package's `test` script through turbo. `apps/web` is not a workspace member: `cd apps/web && pnpm verify`.

## Review Focus

1. **A results PDF and its instances dropped together, finishing in any order.** The PDF never stays `waiting_for_xbrl` after the last XBRL document of its company and period has settled, and never goes to Gemini while one is still unsettled. That includes an XBRL that failed (at verify, classify or read, through a final-failure hook or the sweeper), was kept, or was confirmed for another company; an XBRL between verify's `stored` write and its `identifying` write; and a release that races the PDF's own decision. Tasks 10 and 12.
2. **A crore-declared instance that mixes `decimals` −5, −6 and −7** (the Mahindra case). The table keeps `₹ crore`, every value is padded to the instance's finest `decimals` and never rounded, each sum's tolerance is n × ½ × 10^(−finest), so a −7 total that is ₹20 lakh off its −5 parts fails, and the rounding cross-check passes. Task 5.
3. **A Q4 results instance next to the annual report of the same year.** It never fills an annual column (the open question's default), a half-year instance's 30 Sep balance sheet adds no annual column, and in any table a quarter fact and a year-to-date fact that end on the same day never share a column. Tasks 9 and 14.
4. **The folder imported twice.** The second run makes duplicates. A duplicate gets no `document.xbrl`, no `document.index` and no facts, and coverage and the filings route count the original once. Tasks 10, 12 and 17.
5. **A hostile or broken file:** a DOCTYPE with entities, a billion-laughs body, 25 MB, 150,000 facts, a parse that runs past 30 seconds, or a `.xml` that is a PDF. Each is refused at verify (`UNSUPPORTED_TYPE`) or fails `XBRL_UNREADABLE` without a retry. No worker hangs, and no text reaches a log. Tasks 2, 7, 10 and 11.

---

### Task 1: Migration 0008, the schema and the contract enums

**Files:**
- Modify: `packages/db/src/schema/{platform.ts,classification.ts,extraction.ts}`; Create: `packages/db/src/schema/xbrl.ts`; Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0008_xbrl.sql` (generated, then edited), `packages/db/drizzle/meta/0008_snapshot.json`
- Modify: `packages/contracts/src/{document.ts,classification.ts,extraction.ts,job.ts}`, `packages/contracts/README.md`; Create: `packages/contracts/src/xbrl.ts`; Modify: `packages/contracts/src/index.ts`
- Modify (the `NOT_A_PDF` rename, plain substitutions): `apps/worker/src/jobs/document-verify.ts` (line 109, `reject("NOT_A_PDF")`), `apps/web/src/lib/content/documents.ts`, `apps/web/src/lib/documents/types.ts`; `apps/api/src/serialize.ts` (`toDocument`)
- Test: `packages/db/test/migrate.test.ts`, `packages/db/test/migrate-0008.test.ts`, `packages/contracts/test/schemas.test.ts`, `apps/worker/test/document-verify.test.ts`, `apps/web/src/lib/documents/intake.test.ts`

**Interfaces:**
- Produces (Postgres):
  - `document_format` enum (`pdf`, `xbrl`); `document.format document_format not null default 'pdf'`; index `document_workspace_intake` on `(workspace_id, intake_state)`.
  - `intake_state` gains `waiting_for_xbrl`. `check_type` gains `xbrl_in_pdf`. Both use `ALTER TYPE … ADD VALUE`, and nothing in 0008 uses either new value: Postgres refuses a new enum value in the transaction that added it.
  - `fact_span` enum (`quarter`, `half_year`, `nine_months`, `year`, `other`); `financial_fact.span fact_span null`, `financial_fact.period_start date null`.
  - `extraction_source` enum (`pdf`, `xbrl`); `extraction_revision.source extraction_source not null default 'pdf'`.
  - `xbrl_source`: `id uuid pk`, `workspace_id` → workspace, `fact_id` → financial_fact unique, `document_id` → document, `element text not null`, `context_id text not null`, `decimals text null` (`"INF"` or an integer as text), `nil boolean not null default false`, `concept text null` (the map's concept when the fact was written, Departure 18), `footnote_ids text[] not null default '{}'`, `created_at`.
  - `extraction_check` gains `fact_id uuid null` → financial_fact, `pdf_document_id uuid null` → document, `pdf_classification_id uuid null` → document_classification, `page_index integer null`, `reason text null`, `check_version integer null`. Two indexes: unique `extraction_check_xbrl_pdf` on `(fact_id, pdf_classification_id, check_version) where pdf_classification_id is not null`, and `extraction_check_pdf_document` on `(workspace_id, pdf_document_id)`.
  - `classification_evidence.element text null`, `classification_evidence.context text null`.
  - `document_classification.isin text null`, `document_classification.xbrl_format text null` (a format id), `document_classification.basis reporting_basis null` (an XBRL instance's basis; null for a PDF).
  - `company.isin text null`, unique `company_workspace_isin` on `(workspace_id, isin) where isin is not null`.
  - Data: `update document set rejection_code = 'UNSUPPORTED_TYPE' where rejection_code = 'NOT_A_PDF'`.
- Produces (Drizzle, `@maester/db`): `documentFormat`, `factSpan`, `extractionSource`, `xbrlSource`, `XbrlSourceRow`, and the new columns as `format`, `span`, `periodStart`, `source`, `isin`, `xbrlFormat`, `basis`, `element`, `context`, `concept`, `factId`, `pdfDocumentId`, `pdfClassificationId`, `pageIndex`, `reason`, `checkVersion`.
- Produces (`@maester/contracts`):
  - `DocumentFormat = z.enum(["pdf", "xbrl"])`; `Document` gains `format: DocumentFormat`.
  - `RejectionCode = z.enum(["UNSUPPORTED_TYPE", "TOO_LARGE", "OBJECT_MISSING"])`; `IntakeState` gains `"waiting_for_xbrl"`.
  - Check types split in two, because `CheckType` is shared by the API shapes and the extractor-to-worker wire. `ExtractedCheckType = z.enum(["subtotal", "balance_identity"])` is the wire's: `ExtractedCheck` (and Task 6's `XbrlReadResult.checks`) use it, so the Pydantic twin keeps its two values. `CheckType` gains `"xbrl_in_pdf"` and stays the API's: `ExtractionCheck` and `CellCheck` use it, so a Drizzle row maps without a cast. No route sends an `xbrl_in_pdf` row in either shape in this phase (Departure 4).
  - `FactSpan = z.enum(["quarter", "half_year", "nine_months", "year", "other"])`; `toResultsSpan(span: FactSpan): ResultsSpan | null` (`year` → `full_year`, `other` → null).
  - `Isin = z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/, "a 12-character ISIN")`.
  - `JobTypes.DOCUMENT_XBRL = "document.xbrl"`, `JobTypes.DOCUMENT_XBRL_CHECK = "document.xbrl_check"`, `XBRL_CHECK_SUBJECT = "xbrl_pdf_check"`.
  - `xbrl.ts`: `XbrlFormatFamily = z.enum(["in-capmkt", "in-bse-fin"])`, `XbrlFormatKind = z.enum(["ind_as", "banking", "nbfc", "other_than_ind_as", "unknown"])`, `XbrlFormat = { family: XbrlFormatFamily.nullable(), kind: XbrlFormatKind, id: z.string().nullable(), mapped: z.boolean() }`, `XbrlPdfNotChecked = z.enum(["no_pdf", "scanned", "no_statement_pages", "disabled", "no_value", "no_unit", "not_yet"])` (`no_unit`: the instance declares no rounding, so a monetary value has no scale to look for); `XBRL_PDF_CHECK_VERSION = 1`. Task 6 adds the wire shapes to this file.

- [ ] **Step 1: Write the failing tests.** `migrate.test.ts`:
  - `document.format` defaults to `'pdf'` for an inserted row.
  - A revision inserted without `source` reads `'pdf'`.
  - `xbrl_source.fact_id` is unique.
  - `extraction_check_xbrl_pdf` refuses a second row for the same fact, PDF classification and check version, allows the same pair with another `check_version`, and allows two rows whose `pdf_classification_id` is null.
  - `company_workspace_isin` refuses a second company with the same ISIN in one workspace and allows it in another.
  - `select unnest(enum_range(null::intake_state))` includes `waiting_for_xbrl`.

  `migrate-0008.test.ts`, the one test of the data update. `runMigrations(db, folder)` applies every migration in the folder it is given, and every migration names the `public` schema, so a scratch schema isolates nothing. So the test:
  1. connects to the test server's `postgres` database and runs `create database maester_mig_<8 random hex>`;
  2. copies `packages/db/drizzle/` to a temporary folder and cuts its `meta/_journal.json` `entries` after the `0007_document_index` entry;
  3. calls `runMigrations(db, tmp)` on the scratch database, then inserts a workspace and a `rejected` document with `rejection_code = 'NOT_A_PDF'`;
  4. calls `runMigrations(db)` on the real folder, and asserts the document reads `'UNSUPPORTED_TYPE'`;
  5. closes the connection and drops the database in `afterAll`, also when an assertion failed.

  `schemas.test.ts`: `RejectionCode.parse("NOT_A_PDF")` throws (the existing case that parses `NOT_A_PDF` as valid now parses `UNSUPPORTED_TYPE`); `toResultsSpan("year")` is `"full_year"`; `Isin.parse("INE246F01010")` passes; `Isin.parse("INE246F0101")` throws; `ExtractedCheck` refuses `checkType: "xbrl_in_pdf"` and `ExtractionCheck` accepts it.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/db exec vitest run test/migrate.test.ts test/migrate-0008.test.ts && pnpm --filter @maester/contracts exec vitest run test/schemas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the schema and generate.** Edit the schema files. Run `pnpm --filter @maester/db generate --name xbrl`, then edit the SQL:
  - Put the two `ALTER TYPE … ADD VALUE` statements first.
  - Add the `update` last.
  - Write the partial unique index's predicate on `pdf_classification_id is not null`, not on the check type.

  Run `generate` again: no diff.
- [ ] **Step 4: Update the contracts** and every file that names `NOT_A_PDF`, as plain substitutions only. Vitest does not type-check, so the list is given here rather than found through compile errors. `grep -rn NOT_A_PDF packages apps/worker apps/api apps/web/src` must then find only the migration's data update and the two tests that seed or refuse the old code (`migrate-0008.test.ts`, `schemas.test.ts`):
  - `apps/worker/src/jobs/document-verify.ts` rejects with `UNSUPPORTED_TYPE` where it rejected with `NOT_A_PDF`, and `apps/worker/test/document-verify.test.ts` expects it;
  - `packages/contracts/test/schemas.test.ts` and `packages/contracts/README.md` name `UNSUPPORTED_TYPE`;
  - `apps/web/src/lib/content/documents.ts`, `apps/web/src/lib/documents/types.ts` and `apps/web/src/lib/documents/intake.test.ts` rename the key `NOT_A_PDF` to `UNSUPPORTED_TYPE` and keep its copy, which Task 19 rewords.

  `toDocument` in `apps/api/src/serialize.ts` sets `format`.
- [ ] **Step 5: Run to see them pass**, then `pnpm test` and `cd apps/web && pnpm vitest run src/lib/documents`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add packages/db packages/contracts apps/api/src/serialize.ts apps/worker apps/web/src/lib/content/documents.ts apps/web/src/lib/documents/types.ts apps/web/src/lib/documents/intake.test.ts
git commit -m "feat(db): migration 0008 for XBRL: document format, spans, revision source, xbrl_source, xbrl_in_pdf columns, ISIN, basis, waiting_for_xbrl"
```

---

### Task 2: The instance parser, with its limits

**Files:**
- Modify: `packages/financial-engine/pyproject.toml` (`lxml==<pin>`), `uv.lock`
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/{__init__.py,parser.py}`
- Create: `tests/xbrl_fixtures.py`
- Test: `tests/test_xbrl_parser.py`

**Interfaces:**
- Produces:
  - `xbrl/__init__.py`: `XBRL_PARSER_VERSION = "1"`, `XBRL_MAP_VERSION = "1"`, `XBRL_TEXT_VERSION = "1"`, `XBRL_PDF_CHECK_VERSION = 1`, `INSTANCE_NS = "http://www.xbrl.org/2003/instance"`.
  - `parser.py`, the records:
    - `Context(id, start: date | None, end: date | None, instant: date | None, dimensional: bool)`. `dimensional` is true when the context has a `scenario` or a `segment`.
    - `Unit(id, numerator: tuple[str, ...], denominator: tuple[str, ...])`. Measures are written `prefix:local` as resolved: `iso4217:INR`, `xbrli:shares`.
    - `RawFact(element: str, namespace: str, context_id: str, unit_id: str | None, decimals: str | None, text: str, nil: bool, order: int)`.
    - `Instance(root_namespaces: dict[str, str], schema_refs: list[str], contexts: dict[str, Context], units: dict[str, Unit], facts: list[RawFact])`.
  - `parse_instance(data: bytes, *, max_bytes: int, max_facts: int, deadline_seconds: float, clock: Callable[[], float] = time.monotonic) -> Instance`. It raises `ExtractionError("XBRL_UNREADABLE", <reason code only>, retryable=False)` (from `pdf_financial_qa.workflow.errors`). The reason is one of `TOO_LARGE`, `DOCTYPE`, `MALFORMED`, `NOT_AN_INSTANCE`, `TOO_MANY_FACTS`, `TIMED_OUT`. It reads with `lxml.etree.iterparse` over a `BytesIO` with `resolve_entities=False`, `no_network=True`, `load_dtd=False` and `huge_tree=False`. It refuses a DOCTYPE before parsing, by scanning the prolog up to the root's start tag, and again from the tree's `docinfo.doctype`. It checks the clock every 1000 elements and frees each finished top-level element (`elem.clear()`).
  - `tests/xbrl_fixtures.py` (imported bare, `from xbrl_fixtures import …`, as the other tests import `pdf_fixtures`). `FactTuple = tuple[str, str, str | None, str | None, str | None]` is `(element, context, unit, decimals, text)`, and a `text` of `None` writes `xsi:nil="true"`. Task 2 defines:
    - `instance(*, namespace=CAPMKT_2025, schema_ref="in-capmkt-ent-2025-01-31.xsd", contexts=Q2_CONTEXTS, units=STANDARD_UNITS, rounding: str | None = "Lakhs", facts: Sequence[FactTuple] = (), doctype: str | None = None, comment="<!--IFIndAs V1.0 (07-10-2025)-->") -> bytes`. The instance knows its family, so it writes the one rounding fact: in context `OneD`, before the given facts, as `LevelOfRoundingUsedInFinancialStatements` when `namespace` is `BSE_FIN` and `LevelOfRounding` for any other namespace. `rounding=None` writes none.
    - `CAPMKT_2025 = "http://www.sebi.gov.in/xbrl/2025-01-31/in-capmkt"`, `CAPMKT_2026` (the 2026-01-31 one), `BSE_FIN = "http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin"`.
    - `Q2_CONTEXTS`: `OneD` 2025-07-01..2025-09-30, `FourD` 2025-04-01..2025-09-30, `OneI` 2025-09-30, `PY_I` 2025-03-31, and `OneExpenses1D` (OneD's dates with a `scenario`).
    - `STANDARD_UNITS`: `INR` (`iso4217:INR`), `INRPerShare` (`iso4217:INR` over `xbrli:shares`) and `pure` (`xbrli:pure`).
    - `identity_facts(*, symbol="SYNCEM", basis="Consolidated") -> list[FactTuple]`: the metadata facts of the survey with fictional values (`NameOfTheCompany` "SYNTHETIC CEMENTS LIMITED", `ScripCode` "500999", `Symbol`, `ISIN` "INE999Z01011", `NatureOfReportStandaloneConsolidated`, `DateOfStartOfReportingPeriod` "2025-07-01", `DateOfEndOfReportingPeriod` "2025-09-30", `ReportingQuarter` "Second quarter"), all in `OneD`. It writes no rounding fact: `instance()` does. `basis=None` leaves the basis fact out.
    - `f(element, context="OneD", unit="INR", decimals="-5", text="100000") -> FactTuple`.
    - `IND_AS_MARKERS: list[FactTuple]` = `[("ComprehensiveIncomeForThePeriod", "OneD", "INR", "-5", "300000000"), ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INRPerShare", "INF", "12.34")]`.
    - `parse(data, **limits) -> Instance`, `real_instances() -> Iterator[Path]` and `real_instances_with_token() -> Iterator[tuple[Path, str]]` (the format token of the file name: `Integrated_Finance_Ind_As`, `Main_Ind_As`, `IFBanking`, `Banking`, `Integrated_Finance_NBFC`, `NBFC`, `IFOtherthan`), both empty unless `MAESTER_XBRL_DIR` is set.

    Task 3 adds `real_instances_with_period_token()`; Task 4 adds `named_real_instances()`; Task 5 adds `ind_as`, `read`, `fact`, `check`, `codes`, `warning`, `cash_balances`, `sum_outcomes` and `known_filer_inconsistencies`.

- [ ] **Step 1: Pin lxml.** Take the newest lxml release that is at least two weeks old and has wheels for macOS arm64, Linux aarch64 and x86_64 on Python 3.11–3.14 (`uv lock`). Do not write it from memory.
- [ ] **Step 2: Write the failing tests** in `tests/test_xbrl_parser.py`:

```python
def test_contexts_units_and_facts(self):
    inst = parse(instance(facts=[("RevenueFromOperations", "OneD", "INR", "-5", "1234500000"),
                                 ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INRPerShare", "INF", "12.34")]))
    self.assertEqual(inst.contexts["OneD"].start, date(2025, 7, 1))
    self.assertEqual(inst.contexts["OneI"].instant, date(2025, 9, 30))
    self.assertTrue(inst.contexts["OneExpenses1D"].dimensional)
    self.assertEqual(inst.units["INRPerShare"].denominator, ("xbrli:shares",))
    self.assertEqual([(f.element, f.decimals, f.text) for f in inst.facts if f.unit_id],
                     [("RevenueFromOperations", "-5", "1234500000"),
                      ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "INF", "12.34")])

def test_nil_is_kept_as_nil(self):
    fact = parse(instance(facts=[("OtherIncome", "OneD", "INR", "-5", None)])).facts[-1]   # the rounding fact comes first
    self.assertEqual((fact.nil, fact.text), (True, ""))

def test_a_doctype_is_refused_before_any_entity_is_read(self):
    bomb = '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
    self.assertUnreadable(instance(doctype=bomb), "DOCTYPE")

def test_limits(self):
    self.assertUnreadable(instance(), "TOO_LARGE", max_bytes=100)
    self.assertUnreadable(instance(facts=[("OtherIncome", "OneD", "INR", "-5", "1")] * 11), "TOO_MANY_FACTS", max_facts=10)
    ticks = iter(range(0, 10_000, 31))
    self.assertUnreadable(instance(facts=[("OtherIncome", "OneD", "INR", "-5", "1")] * 3000), "TIMED_OUT", clock=lambda: next(ticks))

def test_not_an_instance_and_malformed(self):
    self.assertUnreadable(b"<?xml version='1.0'?><html/>", "NOT_AN_INSTANCE")
    self.assertUnreadable(instance()[:-40], "MALFORMED")

def test_the_error_carries_no_document_text(self):
    with self.assertRaises(ExtractionError) as e: parse(b"<x>SYNTHETIC CEMENTS</y>")
    self.assertNotIn("SYNTHETIC", str(e.exception))

def test_real_instances_parse(self):  # skipped unless MAESTER_XBRL_DIR is set
    for path in real_instances(): parse(path.read_bytes())   # all 807, within the default limits
```

  `parse(data, **kw)` calls `parse_instance` with the default limits (20971520, 100000, 30.0) unless given. `assertUnreadable` checks the code and that the message is the reason code exactly. `real_instances()` yields every `.xml` under `MAESTER_XBRL_DIR`.
- [ ] **Step 3: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_parser.py' -v`. Expected: FAIL (no module).
- [ ] **Step 4: Implement** `xbrl/__init__.py`, `parser.py` and `tests/xbrl_fixtures.py`.
- [ ] **Step 5: Run to see them pass.** Run the same command, then `MAESTER_XBRL_DIR=~/Personal/maester-filings/xbrl uv run --locked python -m unittest discover -s tests -p 'test_xbrl_parser.py' -v`. Expected: PASS, the gated test reading all 807 files.
- [ ] **Step 6: Commit**

```bash
git add packages/financial-engine uv.lock tests/xbrl_fixtures.py tests/test_xbrl_parser.py
git commit -m "feat(xbrl): own instance parser over lxml: no DTD, no network, byte, fact and time limits"
```

---

### Task 3: Format, identity, periods and units: the classify answers

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/{formats.json,formats.py,periods.py,units.py,identity.py,classify.py}`
- Modify: `tests/xbrl_fixtures.py` (`real_instances_with_period_token`)
- Test: `tests/test_xbrl_classify.py`

**Interfaces:**
- Consumes: `Instance` (Task 2).
- Produces:
  - `formats.json`, as data:
    - `families`: `{ "in-capmkt": { "namespace": "^http://www\\.sebi\\.gov\\.in/xbrl/\\d{4}-\\d{2}-\\d{2}/in-capmkt$", "rounding_element": "LevelOfRounding" }, "in-bse-fin": { "namespace": "^http://www\\.bseindia\\.com/xbrl/fin/\\d{4}-\\d{2}-\\d{2}/in-bse-fin$", "rounding_element": "LevelOfRoundingUsedInFinancialStatements" } }`.
    - `rules`, ordered, the first match wins, applied to the set of numeric fact elements:
      - `banking`: `any_of` `["CET1Ratio", "AdditionalTier1Ratio", "CapitalAndLiabilities"]`.
      - `nbfc`: `all_of` `["InterestEarned", "FeesAndCommissionIncome"]`.
      - `other_than_ind_as`: `any_of` `["CashFlowsFromUsedInOperatingActivitiesBeforeExtraordinaryItems", "AdjustmentsForWorkingCapital"]`.
      - `ind_as`: `all_of` `["ComprehensiveIncomeForThePeriod", "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"]`.
    - `identity`: `{ "name": "NameOfTheCompany", "scrip_code": "ScripCode", "symbol": "Symbol", "isin": "ISIN", "basis": "NatureOfReportStandaloneConsolidated", "audited": "WhetherResultsAreAuditedOrUnaudited", "period_start": "DateOfStartOfReportingPeriod", "period_end": "DateOfEndOfReportingPeriod" }`.
    - `text_suffixes`: `["TextBlock", "Explanatory"]`.
  - `formats.py`: `family_of(instance) -> str | None` (from the namespace of the facts; several namespaces or none matching gives `None`); `detect_format(instance) -> XbrlFormat(family, kind, id, mapped)`. `id` is `f"{family}/{kind}"` or `None` without a family, and `mapped` is true for `in-capmkt/ind_as` and `in-bse-fin/ind_as` only.
  - `periods.py`: `span_of(start: date, end: date) -> Span` (Global Constraints); `period_label(span: Span | None, end: date) -> str` (Global Constraints' labels; `None` is the instant form).
  - `units.py`: `Rounding(word, unit_label, scale: Decimal, exponent: int)`; `rounding_of(word: str | None) -> Rounding | None` (Global Constraints' table, case-insensitive, `None` for anything else); `UnitInfo(kind: Literal["monetary", "per_share", "other"], unit_label: str | None, scale: Decimal | None, currency: str | None)`; `unit_of(unit: Unit, rounding: Rounding | None) -> UnitInfo`. The kinds are Global Constraints' monetary and per-share units. A monetary unit with no rounding gives `UnitInfo("monetary", None, None, currency)`, and any other unit gives `UnitInfo("other", None, None, None)`.
  - `identity.py`: `Identity(name, scrip_code, symbol, isin, basis: ReportingBasis, mixed_basis: bool, audited: bool | None, period_start, period_end, rounding_word)`; `read_identity(instance, family) -> Identity`. Values come from the non-dimensional facts of the identity elements, and the first one in document order is taken.
    - The basis is `consolidated` when there is at least one basis fact and every basis fact's text contains "consolidated" (case-insensitive), and `standalone` likewise. No basis fact, or facts that disagree, give `unknown` with `mixed_basis` true (Departure 5: "both bases, or neither"). The check is never a bare `all(...)`, which is true over no facts.
    - `period_end` falls back to the latest end or instant among the non-dimensional contexts of numeric facts.
  - `classify.py`: `classify_instance(instance) -> XbrlClassificationData` with the answers:
    - `kind` is `financial_results` when the family is known and the basis is not mixed, else `not_sure`.
    - `resultsSpan` is `to_results_span(span_of(period_start, period_end))`, where `to_results_span` in `periods.py` mirrors the TypeScript `toResultsSpan`: `year` gives `full_year` and `other` gives `None`. `ReportingQuarter` and `TypeOfReportingPeriod` are not read (Departure 17).
    - `periodEnd`, and `periodLabel` from `period_label(span, end)`.
    - `companyNameAsPrinted`, `cin` (always `None` in the formats on hand), `bseCode` (from `ScripCode` when it is six digits), `nseSymbol` (from `Symbol` when it matches `^[A-Z][A-Z0-9&-]{0,19}$` and is not `NOTLISTED`), `isin`.
    - `basis`, `audited`, `format`.
    - `statementsFound` is one `{statement, basis, pages: []}` per statement that has a mapped element among the non-dimensional numeric facts. Task 4 fills it from the maps; until then it is `[]`.
    - `evidence`: one `XbrlEvidenceData(field, rule_id, element, context, quote)` per answer, with `quote` the fact's text cut to 300 characters. The kind's evidence is `rule_id` `"xbrl.family"`, `element` `None`, `quote` the family name. The rule ids are `xbrl.identity.<key>`.
    - `warnings`: `XBRL_MIXED_BASIS` when mixed; `XBRL_FORMAT_UNMAPPED` (message: the format id, or `unknown`) when not mapped.

- [ ] **Step 1: Write the failing tests:**

```python
def test_span_of(self):
    self.assertEqual([span_of(date(2025, 7, 1), date(2025, 9, 30)), span_of(date(2025, 4, 1), date(2025, 9, 30)),
                      span_of(date(2025, 4, 1), date(2025, 12, 31)), span_of(date(2025, 4, 1), date(2026, 3, 31)),
                      span_of(date(2025, 1, 1), date(2025, 12, 31)), span_of(date(2025, 4, 1), date(2025, 7, 31)),
                      span_of(date(2025, 4, 2), date(2025, 6, 30))],
                     ["quarter", "half_year", "nine_months", "year", "year", "other", "other"])

def test_period_label(self):
    self.assertEqual(period_label("quarter", date(2025, 9, 30)), "Quarter ended 30 Sep 2025")
    self.assertEqual(period_label("year", date(2026, 3, 31)), "Year ended 31 Mar 2026")
    self.assertEqual(period_label(None, date(2025, 3, 1)), "As at 1 Mar 2025")

def test_rounding_words(self):
    self.assertEqual(rounding_of("Crores"), Rounding("Crores", "₹ crore", Decimal("10000000"), -7))
    self.assertEqual(rounding_of("lakhs").exponent, -5)
    self.assertIsNone(rounding_of("Hundreds"))

def test_formats_from_elements(self):
    self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS))).id, "in-capmkt/ind_as")
    self.assertEqual(detect_format(parse(instance(namespace=BSE_FIN, facts=IND_AS_MARKERS))).id, "in-bse-fin/ind_as")
    self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS + [("CET1Ratio", "OneI", "pure", "INF", "0.15")]))).kind, "banking")
    self.assertEqual(detect_format(parse(instance(facts=[f("InterestEarned"), f("FeesAndCommissionIncome")]))).kind, "nbfc")
    self.assertEqual(detect_format(parse(instance(namespace="http://example.com/x", facts=IND_AS_MARKERS))), XbrlFormat(None, "unknown", None, False))

def test_identity_and_answers(self):
    c = classify_instance(parse(instance(facts=identity_facts() + IND_AS_MARKERS)))
    self.assertEqual((c.kind, c.results_span, c.period_end, c.period_label), ("financial_results", "quarter", date(2025, 9, 30), "Quarter ended 30 Sep 2025"))
    self.assertEqual((c.bse_code, c.nse_symbol, c.isin, c.basis), ("500999", "SYNCEM", "INE999Z01011", "consolidated"))
    self.assertIn(XbrlEvidenceData("identifier", "xbrl.identity.scrip_code", "ScripCode", "OneD", "500999"), c.evidence)

def test_notlisted_symbol_is_no_symbol(self):
    self.assertIsNone(classify_instance(parse(instance(facts=identity_facts(symbol="NOTLISTED") + IND_AS_MARKERS))).nse_symbol)

def test_mixed_basis_is_not_sure(self):
    c = classify_instance(parse(instance(facts=identity_facts() + [("NatureOfReportStandaloneConsolidated", "OneD", None, None, "Standalone")] + IND_AS_MARKERS)))
    self.assertEqual((c.kind, c.basis, [w.code for w in c.warnings]), ("not_sure", "unknown", ["XBRL_MIXED_BASIS"]))

def test_no_basis_is_not_sure(self):
    c = classify_instance(parse(instance(facts=identity_facts(basis=None) + IND_AS_MARKERS)))
    self.assertEqual((c.kind, c.basis, [w.code for w in c.warnings]), ("not_sure", "unknown", ["XBRL_MIXED_BASIS"]))

def test_units(self):
    lakh = rounding_of("Lakhs")
    self.assertEqual(unit_of(Unit("INR", ("iso4217:INR",), ()), lakh), UnitInfo("monetary", "₹ lakh", Decimal("100000"), "INR"))
    self.assertEqual(unit_of(Unit("INRPerShare", ("iso4217:INR",), ("xbrli:shares",)), lakh), UnitInfo("per_share", "₹ a share", Decimal("1"), "INR"))
    self.assertEqual(unit_of(Unit("INR", ("iso4217:INR",), ()), None), UnitInfo("monetary", None, None, "INR"))
    self.assertEqual(unit_of(Unit("pure", ("xbrli:pure",), ()), lakh), UnitInfo("other", None, None, None))

def test_real_instances_detect_the_token_format(self):  # gated on MAESTER_XBRL_DIR
    # The file-name token decides the expectation: Integrated_Finance_Ind_As → in-capmkt/ind_as,
    # Main_Ind_As → in-bse-fin/ind_as, *Banking → banking, *NBFC → nbfc, IFOtherthan → other_than_ind_as.
    for path, token in real_instances_with_token(): self.assertEqual(detect_format(parse(path.read_bytes())).id, EXPECTED[token], path.name)

def test_real_instances_results_span_follows_the_dates(self):  # gated: 807 of 807 (Departure 17)
    # resultsSpan is OneD's own span in every file, whatever ReportingQuarter says (SQ's "Half yearly" included).
    for path, period_token in real_instances_with_period_token():
        inst = parse(path.read_bytes()); one = inst.contexts["OneD"]
        c = classify_instance(inst)
        self.assertEqual(c.results_span, to_results_span(span_of(one.start, one.end)), path.name)
        if period_token == "MQ": self.assertEqual(c.results_span, "quarter", path.name)      # 18 files: Q4 results
        if period_token == "MH": self.assertEqual(c.results_span, "half_year", path.name)    # 10 files
```

  `real_instances_with_period_token()` (in `tests/xbrl_fixtures.py`) yields each real instance with its period token (`MC`, `MQ`, `MH`, `JQ`, `SQ`, `SH`, `DQ`, `DN`), read from the file name by `_(MC|MQ|MH|JQ|SQ|SH|DQ|DN)\d{4}`.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_classify.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the five modules and `formats.json`.
- [ ] **Step 4: Run to see them pass**, without and with `MAESTER_XBRL_DIR`. Expected: PASS, with 807 of 807 detected as their token says. A file that disagrees stops the task: report it and do not loosen the rule list.
- [ ] **Step 5: Commit**

```bash
git add packages/financial-engine/src/pdf_financial_qa/xbrl tests/xbrl_fixtures.py tests/test_xbrl_classify.py
git commit -m "feat(xbrl): format from elements, identity, spans and labels from dates, rounding words: the classify answers"
```

---

### Task 4: The element maps and the survey command

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/maps.py`, `packages/financial-engine/src/pdf_financial_qa/xbrl/maps/in-capmkt.ind_as.json`, `packages/financial-engine/src/pdf_financial_qa/xbrl/maps/in-bse-fin.ind_as.json`, `packages/financial-engine/src/pdf_financial_qa/xbrl/maps/README.md`
- Modify: `packages/financial-engine/src/pdf_financial_qa/xbrl/classify.py` (`statementsFound` from the maps), `tests/xbrl_fixtures.py` (`named_real_instances`), `.gitignore` (`data/eval/xbrl/`)
- Create: `apps/eval/src/maester_eval/xbrl_survey.py`; Modify: `apps/eval/src/maester_eval/cli.py` (command `xbrl-elements`)
- Test: `tests/test_xbrl_maps.py`, `tests/test_eval_xbrl_survey.py`

**Interfaces:**
- Produces:
  - The map file schema, one per mapped format. Its top level holds `"format"` (`"in-capmkt/ind_as"`), `"map_version"` (`"1"`), `"entry_points"` (the `schemaRef` names it was checked on), `"entry_point_differences"` (`[{ "element", "only_in", "note" }]`, the 2025 and 2026 differences found by the survey), and these lists:
    - `"elements"`: `[{ "element", "statement": "income_statement"|"balance_sheet"|"cash_flow", "section", "order": int, "label", "concept": "<concepts.json id>"|null, "cash_balance"?: { "opening_label", "closing_label", "opening_concept", "closing_concept", "opening_order": int, "closing_order": int } }]`. A `cash_balance` entry's own `order` is unused; its two orders place the opening line before the cash-flow lines and the closing line after them.
    - `"sums"`: `[{ "id", "total": "<element>", "parts": [{ "element", "sign": 1|-1 }] }]`. A sum `id` is snake_case: `income`, `expenses`, `profit_before_exceptional_items_and_tax`, `assets`, `equity_and_liabilities`, `net_change_in_cash`, and so on.
    - `"identities"`: `[{ "id": "balance", "left": "Assets", "right": "EquityAndLiabilities" }]`.
    - `"ignored"`: `[element]`: numeric elements that are printed in the results but are not statement lines, such as `FaceValueOfEquityShareCapital` and the ratios. They raise no `XBRL_ELEMENT_UNMAPPED`.
  - `classify_instance` (Task 3) fills `statementsFound` from `load_map(format.id)`, and an unmapped format gives `[]`.
  - `maps.py`: `ElementMap` (the parsed file, frozen, with `entry(element) -> MapEntry | None`, `sums_with_total(element)`, `parts_of(element) -> list[str]`, `labels_of_parts(element) -> list[str]`); `load_map(format_id: str) -> ElementMap | None` (cached; `None` for an unmapped format); `MAPPED_FORMATS = ("in-capmkt/ind_as", "in-bse-fin/ind_as")`.
  - `maester-eval xbrl-elements --instances <dir> --out data/eval/xbrl/` writes `elements-<format id with / as ->.csv` for each detected format. The columns are `element, files, contexts, statement_guess`: element names and counts only, never a value. `statement_guess` is `balance_sheet` when the element's facts are instants and `duration` otherwise. It prints the format counts. `data/eval/xbrl/` is git-ignored.
- **What the maps must hold.** Draft them from the survey's CSVs and the SEBI results format the PDFs print. Labels are in sentence case, as the PDFs print them. These conditions apply:
  - Every element listed in "Survey of the instances on hand" that is a statement line is in both maps.
  - `classify_instance` of a synthetic Ind AS instance with P&L and balance-sheet lines but no cash-flow line gives `statementsFound` `[{income_statement, consolidated, []}, {balance_sheet, consolidated, []}]` (a test in `tests/test_xbrl_maps.py`).
  - At least these sums are in both maps:
    - `Income` = `RevenueFromOperations` + `OtherIncome`.
    - `Expenses` = its seven expense lines: `CostOfMaterialsConsumed`, `PurchasesOfStockInTrade`, `ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade`, `EmployeeBenefitExpense`, `FinanceCosts`, `DepreciationDepletionAndAmortisationExpense`, `OtherExpenses`.
    - `ProfitBeforeExceptionalItemsAndTax` = `Income` − `Expenses`.
    - `Assets` = `NoncurrentAssets` + `CurrentAssets` (plus held-for-sale, if the survey shows it outside both).
    - `EquityAndLiabilities` = `Equity` + `Liabilities`.
    - `IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges` = operating + investing + financing.
  - The balance identity.
  - `CashAndCashEquivalentsCashFlowStatement` is marked `cash_balance`, with the concepts `cash_at_beginning_of_period` and `cash_at_end_of_period`.
  - The earnings-per-share labels contain "earnings per share", so stitch's per-share rule finds them, for example "Basic earnings per share".
  - Each concept exists in `packages/contracts/concepts.json`. An "Others" or next-best-fit element has `concept: null`.

- [ ] **Step 1: Write the survey command and its test.** `test_eval_xbrl_survey.py` runs `xbrl-elements` over a temporary folder of three synthetic instances and checks:
  - the CSV rows and counts;
  - that no fact value appears in any output file;
  - that a DOCTYPE file is counted as unreadable and does not stop the run.

  Run `uv run --locked python -m unittest discover -s tests -p 'test_eval_xbrl_survey.py' -v`. Expected: FAIL, then implement, then PASS.
- [ ] **Step 2: Run the survey** on the investor's files (local, read-only): `uv run --locked maester-eval xbrl-elements --instances ~/Personal/maester-filings/xbrl --out data/eval/xbrl/`. Expected: 724 Ind AS files across the two mapped formats.
- [ ] **Step 3: Write the failing map tests** in `tests/test_xbrl_maps.py`:
  - Both maps load.
  - Their `map_version` equals `XBRL_MAP_VERSION`.
  - Every concept is in `concepts.json`, read through `maester_eval.concepts.load_taxonomy` as `tests/test_concepts_json.py` does. There is no Python copy of the taxonomy in `pdf_financial_qa` yet.
  - Every sum's elements are in `elements`.
  - No element is both in `elements` and `ignored`.
  - `(statement, order)` pairs are unique, counting each `cash_balance` entry's `opening_order` and `closing_order` in place of its `order`.
  - Every per-share label matches stitch's `PER_SHARE` pattern (`earnings? per (equity )?share|\beps\b`). The pattern stays the rule for PDF facts; stitch tells an XBRL per-share fact by its unit (Task 14).

  Two tests are gated on `MAESTER_XBRL_DIR`:
  - every element in a map occurs in at least one real instance of its format;
  - every non-dimensional fact of a mapped element in the real instances has a monetary or per-share unit (`unit_of(...).kind != "other"`), so `XBRL_UNIT_UNSUPPORTED` never fires on the files on hand.

  Name real instances per format in `tests/xbrl_fixtures.py` (`named_real_instances() -> dict[str, list[Path]]`, keyed by format id), chosen from the Survey's tokens:
  - `in-capmkt/ind_as` (`Integrated_Finance_Ind_As`): an `MC`, an `SH`, a `JQ` and an `MQ` file (the Q4 results case);
  - `in-bse-fin/ind_as` (`Main_Ind_As`, which has only `SQ` and `DQ`): two `SQ` files, which hold the balance sheet and cash flow, and a `DQ` file.

  Task 5 checks the sums on them.
- [ ] **Step 4: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_maps.py' -v`. Expected: FAIL (no maps).
- [ ] **Step 5: Write `maps.py` and the two maps;** record in `maps/README.md` how each was drafted and checked (survey date, files used, the sums' sources), and keep in it the table of known filer inconsistencies that Task 5 fills (file name, sum id, period).
- [ ] **Step 6: Run to see them pass**, with and without `MAESTER_XBRL_DIR`. Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add packages/financial-engine/src/pdf_financial_qa/xbrl apps/eval tests/xbrl_fixtures.py tests/test_xbrl_maps.py tests/test_eval_xbrl_survey.py .gitignore
git commit -m "feat(xbrl): Ind AS element maps for in-capmkt and in-bse-fin, version 1, and the xbrl-elements survey command"
```

---

### Task 5: Facts, sums and warnings: the read

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/{read.py,checks.py}`
- Test: `tests/test_xbrl_read.py`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `XbrlFactData`: the fields of `ExtractedFact` except `page_index` and `text_layer_match` (`statement, basis, section, line_order, reported_label, is_subtotal, component_labels, period_label, period_end, as_of_date, reported_text, reported_value, value_status, unit_label, scale_factor, currency, normalized_value`), plus `span, period_start, element, context_id, decimals, nil, concept`.
  - `read_instance(instance) -> XbrlReadData` with `format, mapped, basis, rounding: Rounding | None, coarsest_decimals: int | None, finest_decimals: int | None, state, warnings, facts, checks` (checks are `ExtractedCheck` from `workflow.contracts`). The rules:
    - **Which facts.** Numeric facts (with a `unit_id`) whose context is not dimensional, whose element is in the map, and whose unit is monetary or per share (Global Constraints). A mapped element whose unit is neither writes no fact and warns `XBRL_UNIT_UNSUPPORTED` (message: the sorted element names, joined by `", "`). An unmapped format writes no facts and warns `XBRL_FORMAT_UNMAPPED`.
    - **The fact's fields.** `section`, `line_order`, `reported_label` and `concept` come from the map. `is_subtotal` is true when the element is the total of a sum. `component_labels` are the labels of that sum's parts. `basis` is the instance's.
    - **Period.** A duration has `period_end` = end, `period_start` = start, `span` = `span_of` and `as_of_date` null. An instant has `as_of_date` = instant and `period_end`, `period_start` and `span` null. `period_label` comes from `period_label`.
    - **Cash balance elements** (Departure 13). For each non-dimensional duration context used by a cash-flow fact: an instant equal to the duration's start minus one day gives a fact with the opening label, concept and `opening_order`. An instant equal to the duration's end gives one with the closing label, concept and `closing_order`. These facts take the duration's `period_end`, `period_start`, `span` and label, with `as_of_date` null, as a PDF cash-flow line is written, and keep the instant's own `context_id`.
    - **Value.** `reported_text` is the instant's text, stripped. `normalized_value` is `Decimal(text)` in full rupees, or a share's rupees. `reported_value` is `normalized_value / scale` and keeps at least max(0, `finest_decimals` − `rounding.exponent`) places (the instance's finest, Departure 12; the exponent is negative), padded, never rounded. A per-share fact keeps its own places. `unit_label`, `scale_factor` and `currency` come from `unit_of`. Values go through `format_decimal`.
    - **Nil** gives `value_status` `unparsed`, `reported_value` and `normalized_value` null, `nil` true, and the revision warning `XBRL_NIL` (message: the elements, sorted, joined by `", "`). A text that is not a decimal gives `unparsed` with `nil` false.
    - **No declared rounding** gives `unit_label`, `scale_factor` and `reported_value` null (`normalized_value` stays) and the warning `XBRL_ROUNDING_MISSING`; the state is `partial`. The rounding word is read from the family's element (`formats.json`'s `rounding_element`).
    - **The rounding cross-check.** `coarsest_decimals` is the minimum integer `decimals` over every monetary fact in the instance, dimensional or not, as research §4 counted, and `finest_decimals` the maximum over the monetary facts the read writes (non-dimensional and mapped: the statement lines the sums and the padding are about). With a declared rounding, when `coarsest_decimals != rounding.exponent`, the state is `partial` with `XBRL_ROUNDING_MISMATCH` (message `"declared <word>, coarsest decimals <n>"`).
    - **Unmapped elements.** Numeric non-dimensional elements of a mapped format that are neither in the map nor `ignored` give `XBRL_ELEMENT_UNMAPPED` (message: the sorted names, joined by `", "`).
    - **The state** is `complete` otherwise.
  - `checks.py`: `sum_checks(facts: list[XbrlFactData], element_map: ElementMap, finest_decimals: int | None) -> list[ExtractedCheck]`. For each sum and each period of its total, the check is a `subtotal` with `statement`, `basis` and `section` of the total, and `period_label` and `subject_label` of the total fact exactly. `expected` is the total's `reported_value`, and `actual` is Σ sign × the parts' `reported_value` present in that period. `status`:
    - `passed` when |Σ sign × normalised parts − normalised total| ≤ n × ½ × 10^(−`finest_decimals`), where n counts the total and the parts present (Departure 11);
    - `failed` when the difference is larger;
    - `not_checked` when every part is absent, the total or a part is nil, or `finest_decimals` is `None`.

    `detail` names the absent parts' elements. The balance identity is a `balance_identity` check, `section` null, `subject_label` the `Assets` label, `expected` the `Assets` value and `actual` the `EquityAndLiabilities` value, compared the same way with n = 2.

Task 5 adds these helpers to `tests/xbrl_fixtures.py`:
- `ind_as(*, default_decimals: str = "-5", **lines: tuple[str | None, str]) -> list[FactTuple]` writes `IND_AS_MARKERS`, `identity_facts()`, and Revenue, Other income, Income, the seven expense lines, Expenses and `ProfitBeforeExceptionalItemsAndTax` in `OneD` and `FourD`. It writes no cash-flow line and no rounding fact (`instance()` writes that). A line is given by its snake_case key (`revenue`, `other_income`, `income`, `eps`, …) as `(text, decimals)`, and a given line replaces the `OneD` fact only (`FourD` keeps its default). `IND_AS_MARKERS`' two facts are the lines `comprehensive_income` and `eps`, so giving either replaces the marker rather than adding a second fact. A line not given is written at `default_decimals`, −5 whatever the declared rounding, with these `OneD` values in rupees, doubled in `FourD`, which add up:
  - `RevenueFromOperations` 1234500000, `OtherIncome` 5500000, `Income` 1240000000;
  - `CostOfMaterialsConsumed` 400000000, `PurchasesOfStockInTrade` 100000000, `ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade` 10000000, `EmployeeBenefitExpense` 150000000, `FinanceCosts` 20000000, `DepreciationDepletionAndAmortisationExpense` 60000000, `OtherExpenses` 200000000, `Expenses` 940000000;
  - `ProfitBeforeExceptionalItemsAndTax` 300000000.

  So `instance(facts=ind_as())` reads `complete` (Lakhs declared, coarsest −5), with every sum present `passed`. A test that declares Crores gives at least one line at −7.
- `read(data: bytes) -> XbrlReadData` (parse with the default limits, then `read_instance`).
- `fact(r, element, context_id) -> XbrlFactData`: the one fact with that element and `context_id`; fails the test when there is not exactly one.
- `check(r, total_element, period_label) -> ExtractedCheck`: the check whose `subject_label` is the map label of `total_element` (`load_map(r.format.id).entry(total_element).label`) and whose `period_label` matches. `check(r, "Income", …)` is the check of sum id `income`.
- `codes(r) -> list[str]`: the warning codes, sorted. `warning(r, code) -> ExtractionWarning`.
- `cash_balances(r) -> list[XbrlFactData]`: the facts of `CashAndCashEquivalentsCashFlowStatement`, sorted by `line_order`.
- `sum_outcomes(reads: Iterable[tuple[Path, XbrlReadData]]) -> dict[str, dict[str, list[str]]]`: for each sum id (and `balance`), the file names under `passed`, `failed` and `not_checked`.

- [ ] **Step 1: Write the failing tests** (synthetic instances; the hand-worked values are in the comments):

```python
def test_lakh_values_keep_the_lakh_unit_and_are_padded_never_rounded(self):
    r = read(instance(rounding="Lakhs", facts=ind_as(revenue=("1234500000", "-3"))))   # 1,234,500,000 / 100,000 = 12345; max(0, −3 − (−5)) = 2 places
    f = fact(r, "RevenueFromOperations", "OneD")
    self.assertEqual((f.reported_value, f.normalized_value, f.unit_label, f.scale_factor, f.currency),
                     ("12345.00", "1234500000", "₹ lakh", "100000", "INR"))
    self.assertEqual((f.span, f.period_start, f.period_end, f.period_label), ("quarter", date(2025, 7, 1), date(2025, 9, 30), "Quarter ended 30 Sep 2025"))

def test_a_crore_file_with_mixed_decimals(self):
    r = read(instance(rounding="Crores", facts=ind_as(revenue=("12345670000000", "-7"), other_income=("123400000", "-5"), income=("12345793400000", "-5"))))
    revenue = fact(r, "RevenueFromOperations", "OneD")
    self.assertEqual((revenue.reported_value, revenue.unit_label, revenue.scale_factor), ("1234567.00", "₹ crore", "10000000"))   # finest −5: max(0, −5 − (−7)) = 2 places, padded
    self.assertEqual(fact(r, "OtherIncome", "OneD").reported_value, "12.34")
    self.assertEqual((r.coarsest_decimals, r.finest_decimals, r.state), (-7, -5, "complete"))
    self.assertEqual(check(r, "Income", "Quarter ended 30 Sep 2025").status, "passed")      # 12345670000000 + 123400000 = 12345793400000

def test_a_crore_total_twenty_lakh_off_its_lakh_parts_fails(self):
    # Per-fact tolerance would be ½×10^7 + 2 × ½×10^5 = 5,100,000 and pass it; the instance's finest (−5) gives 3 × ½ × 10^5 = 150,000.
    r = read(instance(rounding="Crores", facts=ind_as(revenue=("12344600000", "-5"), other_income=("123400000", "-5"), income=("12470000000", "-7"))))
    c = check(r, "Income", "Quarter ended 30 Sep 2025")
    self.assertEqual((c.status, c.expected, c.actual), ("failed", "1247.00", "1246.80"))   # 12,470,000,000 − 12,468,000,000 = 2,000,000 > 150,000

def test_rounding_mismatch(self):
    r = read(instance(rounding="Crores", facts=ind_as(revenue=("1234500000", "-5"))))       # every line at −5: coarsest −5, declared −7
    self.assertEqual((r.state, codes(r)), ("partial", ["XBRL_ROUNDING_MISMATCH"]))

def test_bse_fin_reads_its_own_rounding_element(self):
    r = read(instance(namespace=BSE_FIN, rounding="Lakhs", facts=ind_as()))   # writes LevelOfRoundingUsedInFinancialStatements
    self.assertEqual((r.format.id, r.rounding.word, r.state, codes(r)), ("in-bse-fin/ind_as", "Lakhs", "complete", []))
    self.assertEqual(fact(r, "RevenueFromOperations", "OneD").unit_label, "₹ lakh")

def test_a_mapped_element_in_another_unit_writes_no_fact(self):
    r = read(instance(facts=ind_as() + [("OtherIncome", "OneI", "pure", "INF", "0.15")]))
    self.assertFalse(any(f.context_id == "OneI" and f.element == "OtherIncome" for f in r.facts))
    self.assertEqual(warning(r, "XBRL_UNIT_UNSUPPORTED").message, "OtherIncome")

def test_eps_keeps_rupees_a_share(self):
    f = fact(read(instance(facts=ind_as(eps=("12.34", "INF")))), "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD")
    self.assertEqual((f.reported_value, f.unit_label, f.scale_factor), ("12.34", "₹ a share", "1"))

def test_nil_is_unknown_never_zero(self):
    r = read(instance(facts=ind_as(other_income=(None, "-5"))))
    f = fact(r, "OtherIncome", "OneD")
    self.assertEqual((f.value_status, f.reported_value, f.normalized_value, f.nil), ("unparsed", None, None, True))
    self.assertIn("XBRL_NIL", codes(r)); self.assertEqual(check(r, "Income", "Quarter ended 30 Sep 2025").status, "not_checked")

def test_a_failed_sum_names_its_numbers(self):
    c = check(read(instance(facts=ind_as(revenue=("1000000", "-3"), other_income=("2000", "-3"), income=("1004000", "-3")))), "Income", "Quarter ended 30 Sep 2025")
    self.assertEqual((c.status, c.expected, c.actual), ("failed", "10.04", "10.02"))   # lakh: 1004000/1e5, (1000000+2000)/1e5; off by 2000 > 3 × ½ × 10^3 = 1500

def test_rounding_alone_does_not_fail_a_sum(self):
    c = check(read(instance(facts=ind_as(revenue=("1000000", "-3"), other_income=("2000", "-3"), income=("1003000", "-3")))), "Income", "Quarter ended 30 Sep 2025")
    self.assertEqual(c.status, "passed")   # off by 1000 ≤ 1500

def test_dimensional_and_unmapped(self):
    r = read(instance(facts=ind_as() + [("OtherExpenses", "OneExpenses1D", "INR", "-3", "5000"), ("SomethingNew", "OneD", "INR", "-3", "1")]))
    self.assertFalse(any(f.context_id == "OneExpenses1D" for f in r.facts))
    self.assertEqual(warning(r, "XBRL_ELEMENT_UNMAPPED").message, "SomethingNew")

def test_cash_balance_opens_and_closes_the_half_year(self):
    # One cash-flow line in FourD only, so the half year is the one cash-flow duration: PY_I (31 Mar) opens it, OneI (30 Sep) closes it.
    r = read(instance(facts=ind_as() + [("CashFlowsFromUsedInOperatingActivities", "FourD", "INR", "-5", "200000000"),
                                        ("CashAndCashEquivalentsCashFlowStatement", "PY_I", "INR", "-5", "500000000"),
                                        ("CashAndCashEquivalentsCashFlowStatement", "OneI", "INR", "-5", "700000000")]))
    opening, closing = cash_balances(r)          # sorted by line_order: opening_order before closing_order
    self.assertEqual((opening.context_id, opening.period_start, opening.period_end, opening.span, opening.as_of_date, opening.period_label),
                     ("PY_I", date(2025, 4, 1), date(2025, 9, 30), "half_year", None, "Half year ended 30 Sep 2025"))
    self.assertEqual((closing.context_id, closing.period_end, closing.span, closing.as_of_date), ("OneI", date(2025, 9, 30), "half_year", None))
    self.assertLess(opening.line_order, closing.line_order)

def test_no_rounding_declared(self):
    r = read(instance(facts=ind_as(), rounding=None))
    self.assertEqual((r.state, fact(r, "RevenueFromOperations", "OneD").reported_value, fact(r, "RevenueFromOperations", "OneD").normalized_value), ("partial", None, "1234500000"))
    self.assertIn("XBRL_ROUNDING_MISSING", codes(r))

def test_unmapped_format_writes_nothing(self):
    r = read(instance(facts=ind_as() + [("CET1Ratio", "OneI", "pure", "INF", "0.15")]))
    self.assertEqual((r.facts, r.checks, codes(r)), ([], [], ["XBRL_FORMAT_UNMAPPED"]))

def test_real_instances_rounding_cross_check(self):  # gated: 807 of 807 declare a rounding the reader finds, and it agrees (research §4)
    for path in real_instances():
        r = read(path.read_bytes())
        found = codes(r)
        self.assertNotIn("XBRL_ROUNDING_MISMATCH", found, path.name)
        self.assertNotIn("XBRL_ROUNDING_MISSING", found, path.name)   # in-bse-fin's LevelOfRoundingUsedInFinancialStatements is read
        if r.mapped:   # padding and tolerance rest on finest_decimals; the Survey measured 0 to 3 places past the declared unit
            self.assertIn(r.finest_decimals - r.rounding.exponent, {0, 1, 2, 3}, path.name)

def test_real_instances_sums_add_up(self):  # gated (spec §17: every sum adds up on the named real instances)
    outcomes = sum_outcomes((p, read(p.read_bytes())) for files in named_real_instances().values() for p in files)
    known = known_filer_inconsistencies()        # parsed from maps/README.md's table: {(file name, sum id, period label)}
    for sum_id, by_status in outcomes.items():
        for name in by_status["failed"]:
            self.assertIn((name, sum_id), {(n, s) for n, s, _ in known}, f"{sum_id} fails on {name}")
    self.assertGreater(len(outcomes["income"]["passed"]), 0)
```

  `known_filer_inconsistencies()` (in `tests/xbrl_fixtures.py`) reads the table in `maps/README.md`; it starts empty. A row is added only for a sum the PDF shows the filer got wrong, never for a map error (Step 4).
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_read.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `read.py` and `checks.py`. Every value is a `Decimal`; there is no float anywhere.
- [ ] **Step 4: Run to see them pass**, with and without `MAESTER_XBRL_DIR`. Expected: PASS. A sum that fails on a named real instance is changed in the map only when the PDF shows the map was wrong (a missing line, a wrong sign). A filer's own inconsistency gets a row in `maps/README.md` (file name, sum id, period) with the PDF page that shows it, and Task 20's report counts it.
- [ ] **Step 5: Commit**

```bash
git add packages/financial-engine/src/pdf_financial_qa/xbrl tests/xbrl_fixtures.py tests/test_xbrl_read.py
git commit -m "feat(xbrl): facts with span, period start, declared unit and padded precision; the map's sums and the balance identity as checks"
```

---

### Task 6: The wire contracts and text blocks, in both runtimes

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/{contracts.py,text.py}`
- Modify: `packages/contracts/src/xbrl.ts`
- Create: `packages/contracts/fixtures/xbrl/{stream-classify.ndjson,stream-read.ndjson,stream-text.ndjson,stream-error.ndjson,pdf-check-request.json,pdf-check-result.json}`
- Test: `packages/contracts/test/xbrl-fixtures.test.ts`, `tests/test_xbrl_contracts.py`, `tests/test_xbrl_text.py`

**Interfaces:**
- Produces (camelCase on the wire). The Pydantic twins subclass `workflow.contracts.WireModel`, which gives `to_wire()` only. They are read as the existing modules read theirs, through `TypeAdapter`s defined in `xbrl/contracts.py`: `XBRL_EVENT = TypeAdapter(XbrlEvent)` (as `EXTRACTOR_EVENT` is), `XBRL_PDF_CHECK_REQUEST = TypeAdapter(XbrlPdfCheckRequest)` and `XBRL_PDF_CHECK_RESULT = TypeAdapter(XbrlPdfCheckResult)`. No `from_wire` is added.
  - `XbrlEvidence = { field: EvidenceField, ruleId: string, element: string | null, context: string | null, quote: string (1–300) }`.
  - `XbrlClassification = { parserVersion, mapVersion, format: XbrlFormat, kind: "financial_results" | "not_sure", resultsSpan: ResultsSpan | null, periodEnd: IsoDate | null, periodLabel: string | null, companyNameAsPrinted, cin, bseCode, nseSymbol, isin: string | null, basis: ReportingBasis, audited: boolean | null, statementsFound: StatementFound[], evidence: XbrlEvidence[], warnings: ExtractionWarning[] }`.
  - `XbrlFact`: `ExtractedFact`'s fields without `pageIndex` and `textLayerMatch`, plus `span: FactSpan | null, periodStart: IsoDate | null, element: string, contextId: string, decimals: string | null, nil: boolean, concept: string | null`.
  - `XbrlReadResult = { pipelineVersion: "xbrl-1", model: "xbrl-parser-1", promptVersion: string, format: XbrlFormat, basis: ReportingBasis, state: ExtractionState, rounding: { word, unitLabel, scale: DecimalString, exponent: int } | null, coarsestDecimals: int | null, finestDecimals: int | null, warnings, facts: XbrlFact[], checks: ExtractedCheck[] }`. Its `checks` are `ExtractedCheck`, whose `checkType` is `ExtractedCheckType` (Task 1), so they refuse `checkType: "xbrl_in_pdf"`; the Pydantic `ExtractedCheck` keeps its two-value `Literal`.
  - `XbrlTextBlock = { element: string, contextId: string, heading: string, text: string }`; `XbrlTextResult = { textVersion: "1", basis: ReportingBasis, blocks: XbrlTextBlock[] }`.
  - `XbrlEvent` is a discriminated union on `type`:
    - `started { parserVersion, mapVersion, mode: "classify" | "read" | "text" }`
    - `heartbeat {}`
    - `classification { result: XbrlClassification }`
    - `read { result: XbrlReadResult }`
    - `text { result: XbrlTextResult }`
    - `error { code, retryable, message }`
  - `XbrlPdfCheckRequest = { scale: DecimalString | null, places: int ≥ 0 | null, statementPages: StatementFound[], facts: { factId: Uuid, value: DecimalString | null /* normalized */, perShare: boolean, statement: StatementKind, basis: ReportingBasis }[] }`. `scale` is the `scaleFactor` shared by the revision's monetary facts, null when the instance declares no rounding. `places` is the places the statement is printed to, max(0, finest decimals − rounding exponent) (Task 13), null with `scale`.
  - `XbrlPdfCheckResult = { checkVersion: 1, results: { factId: Uuid, status: CheckStatus, pageIndex: int ≥ 0 | null, reason: XbrlPdfNotChecked | null }[] }`. `checkVersion` is `z.literal(XBRL_PDF_CHECK_VERSION)` in Zod and the Python `XBRL_PDF_CHECK_VERSION`, so an extractor and a worker that disagree on the check's version fail the parse instead of writing rows under the wrong version.
  - `text.py`:
    - `html_to_text(html: str) -> str` (stdlib `html.parser`). `p`, `div`, `br`, `li`, `tr`, `h1`–`h6` and `table` end a line; `td` and `th` are joined by `" | "`; `script` and `style` are dropped; entities are unescaped; spaces collapse within a line; blank lines collapse to one; the result is stripped.
    - `element_heading(element: str) -> str`: drops the suffixes `ExplanatoryTextBlock`, `TextBlock` and `Explanatory`, splits CamelCase into words, keeps the first word's capital and lowers the rest: `DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock` gives `Disclosure of notes on financial results`.
    - `text_blocks(instance) -> list[XbrlTextBlock]`: non-numeric facts whose element ends in a `text_suffixes` entry, dimensional or not, in document order, with empty texts dropped and duplicates of `(element, text)` dropped.

- [ ] **Step 1: Write the fixtures and failing tests.** The fixtures are hand-written from Task 5's synthetic cases:
  - The read stream holds one per-share fact, one nil fact and one cash-balance fact.
  - The classify stream has an `XBRL_FORMAT_UNMAPPED` warning.
  - The text stream holds two blocks.
  - The check request has four facts, one of them per share and one with a null value; the result holds one `passed` with a page, one `failed`, one `not_checked` `scanned` and one `not_checked` `no_value`.

  The Zod test parses every line as `XbrlEvent` and the JSON files. It also checks three refusals: a `read` whose check has `checkType: "xbrl_in_pdf"`, a fact with `span: "full_year"`, and a result with `checkVersion: 2`. The Python test reads the same files through `XBRL_EVENT.validate_python`, `XBRL_PDF_CHECK_REQUEST` and `XBRL_PDF_CHECK_RESULT`, checks that `to_wire()` equals each input, and refuses the same three. `test_xbrl_text.py` checks four things:
  - `html_to_text("<p>Notes&nbsp;to <b>results</b></p><table><tr><td>Segment</td><td>Cement</td></tr></table>")` is `"Notes to results\nSegment | Cement"`.
  - `element_heading` gives the example above.
  - `text_blocks` keeps a dimensional `RelatedPartyTransactionExplanatory` fact.
  - `text_blocks` drops an empty block and a duplicate.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/contracts exec vitest run test/xbrl-fixtures.test.ts`, `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_contracts.py' -v` and `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_text.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** both contract files and `text.py`; `read.py` and `classify.py` return these wire models through `to_xbrl_classification(...)` and `to_xbrl_read_result(...)`.
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/financial-engine/src/pdf_financial_qa/xbrl tests/test_xbrl_contracts.py tests/test_xbrl_text.py
git commit -m "feat(contracts): /v1/xbrl events, the read and classify results, text blocks and the PDF check, in Zod and Pydantic"
```

---

### Task 7: The extractor's `/v1/xbrl`

**Files:**
- Modify: `apps/extractor/src/maester_extractor/{app.py,settings.py}`, `apps/extractor/pyproject.toml` (`python-multipart==<pin>`, for Task 8), `uv.lock`
- Test: `tests/test_extractor_xbrl.py`

**Interfaces:**
- Consumes: `parse_instance`, `classify_instance`, `read_instance`, `text_blocks` and the contracts (Tasks 2–6).
- Produces:
  - `Settings` gains `xbrl_max_bytes` (`XBRL_MAX_BYTES`, 20971520), `xbrl_max_facts` (`XBRL_MAX_FACTS`, 100000) and `xbrl_deadline_seconds` (`XBRL_DEADLINE_SECONDS`, 30).
  - `POST /v1/xbrl`, behind `x-extractor-secret` like `/v1/extract`. The body is the instance, the header `x-xbrl-mode` is `classify | read | text`, and `x-document-id` is optional. The answer is 200 at once with NDJSON: `started`, `heartbeat` lines every `heartbeat_seconds` while the parse runs in a thread, then exactly one `classification`, `read`, `text` or `error` line.
    - An unknown mode or an empty body is a 400 (`BAD_REQUEST`, `EMPTY_BODY`).
    - A body over `xbrl_max_bytes` is a 200 with `error XBRL_UNREADABLE` (`retryable: false`, message `TOO_LARGE`), read no further. It is never a 413, because the worker treats this as a document fault, not a transport fault.
    - A parser `ExtractionError` becomes its `error` line. Any other exception becomes `error XBRL_FAILED`, `retryable: true`, with the exception type only.
  - Logs carry the document id, the mode, the format id, fact and warning counts, the seconds and error codes, never a value or a name.

- [ ] **Step 1: Write the failing tests** with `fastapi.testclient.TestClient`. A synthetic Ind AS instance in each mode streams `started` then the right result, and each line parses with `XBRL_EVENT`. Then:
  - a wrong secret gives 401 `EXTRACTOR_UNAUTHORIZED`;
  - a DOCTYPE gives one `error` line `XBRL_UNREADABLE` with `retryable` false;
  - 21 MB of padding inside a comment gives `XBRL_UNREADABLE` `TOO_LARGE`;
  - a patched parser raising `RuntimeError("SYNTHETIC CEMENTS 1234")` gives `XBRL_FAILED`, and neither the line nor any captured log record (`assertLogs`) contains `SYNTHETIC`;
  - a parser that sleeps past `heartbeat_seconds` (set to 0.05) yields `heartbeat` lines;
  - `x-xbrl-mode: nope` gives 400.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_extractor_xbrl.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and the settings. Pin `python-multipart` as Task 2 pinned lxml.
- [ ] **Step 4: Run** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/extractor uv.lock tests/test_extractor_xbrl.py
git commit -m "feat(extractor): /v1/xbrl in classify, read and text modes over NDJSON, with limits and XBRL_UNREADABLE"
```

---

### Task 8: `xbrl_in_pdf`: the check and its route

**Files:**
- Create: `packages/financial-engine/src/pdf_financial_qa/xbrl/pdf_check.py`
- Modify: `apps/extractor/src/maester_extractor/app.py`
- Test: `tests/test_xbrl_pdf_check.py` (uses `tests/pdf_fixtures.py` for text-layer and scanned PDFs)

**Interfaces:**
- Consumes: `PdfDocument.load` and `text_layer_match` (`workflow/pdf.py`, `workflow/values.py`), unchanged; `XbrlPdfCheckRequest` and `XbrlPdfCheckResult` (Task 6).
- Produces:
  - `check_xbrl_in_pdf(pdf: bytes, request: XbrlPdfCheckRequest) -> XbrlPdfCheckResult`, with `checkVersion` `XBRL_PDF_CHECK_VERSION`. For each fact, the result is decided in this order:
    1. The fact's value is null: `not_checked` `no_value`.
    2. A monetary fact (not `perShare`) and `scale` null: `not_checked` `no_unit`.
    3. The `statementPages` entry for the fact's statement and basis is missing or empty: `not_checked` `no_statement_pages`.
    4. Otherwise the candidates are tried in this order on each page in turn, and the first page where `text_layer_match(page_text, candidate)` is `True` for one of them gives `passed` with that `pageIndex`:
       - the value itself for a per-share fact, or the exact `value / scale` (a `Decimal`);
       - for a monetary fact with `places` not null, `value / scale` rounded half up to `places` places. The PDF prints the statement to `places` places, and in the filings on hand a fact's `value` can carry digits finer than that (its `decimals` mostly follows trailing zeros, research §4), so the exact candidate alone would fail a correctly printed figure. Task 20's paired-PDF run counts how many passes need the rounded candidate.
    5. No page matches and every page's text is empty: `not_checked` `scanned`.
    6. No page matches and some pages have no text: `not_checked` `scanned`, because a miss next to a scan is not proof.
    7. Otherwise: `failed`, `pageIndex` null.

    An unreadable PDF: the `ExtractionError("UNREADABLE_PDF", …, retryable=False)` that `PdfDocument.load` already raises passes through unchanged.
  - `check_candidates(value: Decimal, per_share: bool, scale: Decimal | None, places: int | None) -> list[Decimal]` is the candidate list of rule 4, exported so Task 20's run counts exact and rounded passes apart.
  - `POST /v1/xbrl/pdf-check`, behind the secret: `multipart/form-data` with a `pdf` file part and a `request` part (JSON `XbrlPdfCheckRequest`). It answers one JSON `XbrlPdfCheckResult`, or `{"type":"error",…}` like `/v1/classify`. The body limit is `max_bytes`.

- [ ] **Step 1: Write the failing tests.** The fixture PDF prints a lakh statement. Page indexes are 0-based, as `StatementFound.pages` are: index 0 is a cover; index 1 is a table with `12,345.00`, `(234.50)` and an earnings-per-share line `12.34`; index 2 is a scan of the same table.

```python
def test_found_on_the_second_statement_page(self):
    r = run(pages=[0, 1], facts=[fact("1234500000"), fact("-23450000")], scale="100000", places=2)
    self.assertEqual([(x.status, x.page_index) for x in r.results], [("passed", 1), ("passed", 1)])   # 1234500000/1e5 = 12345.00; |−23450000/1e5| = 234.50
    self.assertEqual(r.check_version, 1)

def test_a_value_with_finer_digits_matches_its_printed_rounding(self):
    # 1234500400/1e5 = 12345.004 is not printed; rounded half up to 2 places it is 12345.00, which index 1 prints.
    self.assertEqual(one(run(pages=[1], facts=[fact("1234500400")], scale="100000", places=2)), ("passed", 1, None))
    self.assertEqual(one(run(pages=[1], facts=[fact("1234500400")], scale="100000", places=None)), ("failed", None, None))
    self.assertEqual(check_candidates(Decimal("1234500400"), False, Decimal("100000"), 2), [Decimal("12345.004"), Decimal("12345.00")])

def test_no_declared_unit_is_not_checked(self):
    self.assertEqual(one(run(pages=[1], facts=[fact("1234500000")], scale=None, places=None)), ("not_checked", None, "no_unit"))
    self.assertEqual(one(run(pages=[1], facts=[fact("12.34", per_share=True)], scale=None, places=None))[0], "passed")

def test_a_value_not_printed_fails_without_a_page(self):
    self.assertEqual(one(run(pages=[0, 1], facts=[fact("999900000")])), ("failed", None, None))

def test_scanned_and_missing_pages_are_not_checked_with_their_reason(self):
    self.assertEqual(one(run(pages=[2], facts=[fact("1234500000")])), ("not_checked", None, "scanned"))
    self.assertEqual(one(run(pages=[], facts=[fact("1234500000")])), ("not_checked", None, "no_statement_pages"))
    self.assertEqual(one(run(pages=[1], facts=[fact(None)])), ("not_checked", None, "no_value"))

def test_per_share_is_not_scaled(self):
    self.assertEqual(one(run(pages=[1], facts=[fact("12.34", per_share=True)]))[0], "passed")   # index 1 prints 12.34 as EPS
```

  `run(pages, facts, scale="100000", places=2)` builds the request with `statementPages` `[{income_statement, consolidated, pages}]`; `fact(value, per_share=False)` is an income-statement consolidated fact; `one(r)` is the first result as `(status, page_index, reason)`. Route tests: a multipart request answers the result, a request with no `pdf` part gives 400, and a wrong secret gives 401.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest discover -s tests -p 'test_xbrl_pdf_check.py' -v`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/financial-engine/src/pdf_financial_qa/xbrl/pdf_check.py apps/extractor tests/test_xbrl_pdf_check.py
git commit -m "feat(xbrl): xbrl_in_pdf looks for each XBRL value on the PDF's statement pages with text_layer_match"
```

---

### Task 9: The source rule, in `@maester/financial-engine` and its Python twin

**Files:**
- Create: `packages/financial-engine-ts/src/sources.ts`, `packages/financial-engine-ts/fixtures/source-rule.json`, `packages/financial-engine-ts/test/sources.test.ts`, `packages/financial-engine-ts/vitest.config.ts`
- Modify: `packages/financial-engine-ts/{src/index.ts,package.json,README.md}`
- Create: `apps/eval/src/maester_eval/source_rule.py`; Test: `tests/test_eval_source_rule.py`

**Interfaces:**
- Produces (`@maester/financial-engine`, no I/O, no dates beyond ISO strings, no numbers):
  - `SOURCE_RULE_VERSION = 1`.
  - `type FilingKind = "annual_report" | "financial_results"`; `type Basis = "consolidated" | "standalone" | "unknown"`; `type Statement = "income_statement" | "balance_sheet" | "cash_flow"`; `type Span = "quarter" | "half_year" | "nine_months" | "year" | "other"`.
  - `interface Slot { companyId: string; filingKind: FilingKind; statement: Statement; basis: Basis; periodEnd: string; span: Span | null }`; `slotKey(s: Slot): string` (`companyId|filingKind|statement|basis|periodEnd|span-or-instant`).
  - `interface SlotCandidate { revisionId: string; documentId: string; source: "xbrl" | "pdf"; filingPeriodEnd: string | null; revisionCreatedAt: string }`.
  - `rankSlotCandidates(cs: SlotCandidate[]): SlotCandidate[]`: owner first. `xbrl` comes before `pdf`, then the newer `filingPeriodEnd` (null last), then the newer `revisionCreatedAt`, then the larger `revisionId`. `slotOwner(cs) => rankSlotCandidates(cs)[0] ?? null`.
  - `annualSlotOf(filing: { companyId: string; kind: FilingKind; source: "xbrl" | "pdf"; periodEnd: string | null }, fact: { statement: Statement; basis: Basis; span: Span | null; periodEnd: string | null; asOfDate: string | null }): Slot | null`. This is the one place the investor's open Q4 question is answered (Departure 6), and stitch admits a fact to an annual table only when it gives a slot. The rules apply in order:
    1. A `financial_results` filing gives `null`: a results instance's full-year facts do not fill an annual column (the default, "not filled").
    2. A `pdf` fact gives its slot: `{ companyId, filingKind: "annual_report", statement, basis, periodEnd: fact.periodEnd ?? fact.asOfDate, span: fact.span }`. PDF facts are admitted as today, comparative years included.
    3. An `xbrl` fact gives its slot when its `span` is `year`, or when it is an instant (`span` null) whose `asOfDate` is the filing's own `periodEnd`. Anything else gives `null`: an instance holds no comparatives, and a quarter or a year to date that ends on the same day as a year never shares its column.
  - `interface XbrlDocInput { documentId: string; state: "unsettled" | "held" | "settled"; companyId: string | null; identity: { cin: string | null; bseCode: string | null; nseSymbol: string | null; isin: string | null }; periodEnd: string | null; coverage: { statement: Statement; basis: Basis }[] }`. `coverage` lists the statements and bases with facts in its current mapped revision; it is empty when unmapped, failed or not read.
  - `interface PdfNumbersInput { companyId: string; companyIdentity: XbrlDocInput["identity"]; kind: FilingKind; periodEnd: string | null; statementsFound: { statement: Statement; basis: Basis }[] }`.
  - `type PdfNumbersPlan = { action: "wait"; waitingOn: string[] } | { action: "skip"; coveredBy: string[] } | { action: "read"; coveredBy: string[]; uncovered: { statement: Statement; basis: Basis }[] }`.
  - `planPdfNumbers(pdf: PdfNumbersInput, xbrl: XbrlDocInput[]): PdfNumbersPlan`. The rules apply in order:
    1. An `annual_report`, or a PDF with a null `periodEnd`, is `read` with nothing covered (Departure 6).
    2. An XBRL document **could match** when both hold:
       - its `companyId` is the PDF's, or it is null and its identity is all null or shares a non-null code with the PDF company's identity;
       - its `periodEnd` is the PDF's, or it is null.
    3. If any `unsettled` or `held` XBRL document could match, the plan is `wait`, with those documents oldest first by input order.
    4. The settled XBRL documents of the same company and period cover their `coverage` pairs (`coveringXbrl`). The PDF's `statementsFound` pairs with basis `unknown` are never covered.
    5. If `statementsFound` is non-empty and every pair is covered, the plan is `skip`.
    6. Otherwise the plan is `read`, with the covering documents and the uncovered pairs.
  - `coveringXbrl(pdf: PdfNumbersInput, xbrl: XbrlDocInput[]): string[]`: rule 4 alone. These are the ids, in input order, of the `settled` XBRL documents whose `companyId` is the PDF's, whose `periodEnd` is the PDF's, and whose `coverage` holds at least one of the PDF's `statementsFound` pairs (basis `unknown` never matches). It ignores rule 3, so the pipeline can name what covers a PDF that was already skipped while new, unidentified XBRL arrives (Task 16).
  - `export { … } from "./sources.js"` in `index.ts`; `package.json` gains `"test": "vitest run"` and vitest as a dev dependency; the README drops "no plan to port" and lists the source rule.
  - `apps/eval/src/maester_eval/source_rule.py`: `SOURCE_RULE_VERSION = 1`, `slot_key`, `rank_slot_candidates`, `slot_owner`, `annual_slot_of`, `plan_pdf_numbers`, `covering_xbrl`, with the same fields in snake_case.
  - `fixtures/source-rule.json`: `{ "version": 1, "rank": [{ "name", "candidates", "expected": [revisionId…] }], "annual": [{ "name", "filing", "fact", "expected": Slot | null }], "plan": [{ "name", "pdf", "xbrl", "expected" }], "covering": [{ "name", "pdf", "xbrl", "expected": [documentId…] }] }`. Each case's expectation is worked out by hand from the rule above, not by running the function.

- [ ] **Step 1: Set up the package.** Add `"test": "vitest run"` and vitest (the version `packages/jobs` uses) to `packages/financial-engine-ts/package.json`, write `vitest.config.ts` as `packages/jobs` has it, and run `pnpm install`. Expected: `pnpm --filter @maester/financial-engine exec vitest run` runs and reports no test files.
- [ ] **Step 2: Write the fixture** with at least these cases:
  - `rank`:
    - `xbrl-wins-over-a-newer-pdf`;
    - `newest-xbrl-of-two`;
    - `pdf-by-filing-period-then-revision` (stitch's rule unchanged);
    - `null-filing-period-last`;
    - `later-xbrl-takes-over` (a PDF revision created before the XBRL one still loses);
    - `no-candidates` (`[]`).
  - `annual`:
    - `q4-results-xbrl-does-not-fill-annual`: a `financial_results` XBRL filing ending 31 Mar 2026, a `year` income-statement fact: `null`;
    - `half-year-results-balance-sheet-adds-no-column`: a `financial_results` XBRL filing ending 30 Sep 2025, an instant balance-sheet fact on 30 Sep 2025: `null`;
    - `annual-xbrl-year-fills`: an `annual_report` XBRL filing, a `year` fact: its slot, with `filingKind` `annual_report` and `span` `year`;
    - `annual-xbrl-quarter-does-not-fill`: an `annual_report` XBRL filing, a `quarter` fact ending on its period end: `null`;
    - `annual-xbrl-instant-on-its-own-period-end-fills` and `annual-xbrl-instant-on-another-day-does-not-fill`;
    - `annual-pdf-comparative-fills`: an `annual_report` PDF filing ending 31 Mar 2026, a fact for the year to 31 Mar 2025 with `span` null: its slot for 2025-03-31.
  - `plan`:
    - `both-bases-covered-skips`;
    - `consolidated-only-reads-for-standalone` (`read`, uncovered `[income_statement/standalone, …]`);
    - `q1-without-cash-flow-reads-cash-flow`;
    - `unsettled-unknown-company-waits`;
    - `held-with-matching-bse-code-waits`;
    - `held-with-other-codes-does-not-wait`;
    - `failed-xbrl-does-not-wait` (settled, empty coverage, `read`);
    - `unmapped-format-covers-nothing`;
    - `annual-report-never-waits-or-skips`;
    - `empty-statements-found-reads`;
    - `unknown-basis-never-covered`.
  - `covering`:
    - `covering-ignores-unsettled`: one settled XBRL covering the PDF's consolidated pairs and one unsettled XBRL of unknown company: the settled id only;
    - `covering-needs-a-shared-pair`: a settled XBRL of the same company and period whose coverage shares no pair with `statementsFound`: `[]`.
- [ ] **Step 3: Write the failing tests.** `sources.test.ts` and `test_eval_source_rule.py` both load the fixture by path (`packages/financial-engine-ts/fixtures/source-rule.json`) and assert every case's `expected`. A test in each also asserts `SOURCE_RULE_VERSION === fixture.version`.
- [ ] **Step 4: Run to see them fail.** `pnpm --filter @maester/financial-engine exec vitest run` and `uv run --locked python -m unittest discover -s tests -p 'test_eval_source_rule.py' -v`. Expected: FAIL, on the missing exports, not on the runner.
- [ ] **Step 5: Implement both.**
- [ ] **Step 6: Run to see them pass.** Expected: PASS.
- [ ] **Step 7: Commit**

```bash
git add packages/financial-engine-ts apps/eval tests/test_eval_source_rule.py pnpm-lock.yaml
git commit -m "feat(financial-engine): the source rule, version 1: XBRL wins a slot, skip, wait or read; Python twin in apps/eval on one fixture"
```

---

### Task 10: Accepting XML: the upload route and verify's sniff

**Files:**
- Create: `apps/worker/src/sniff.ts`; Modify: `apps/worker/src/jobs/document-verify.ts`, `apps/worker/package.json` (`saxes==<pin>`), `apps/worker/src/env.ts` (`XBRL_SNIFF_BYTES`)
- Modify (the final-failure hook gets a dispatcher): `apps/worker/src/jobs/types.ts:29`, `apps/worker/src/run.ts:99`, `apps/worker/src/queue.ts:137`, `apps/worker/src/jobs/document-classify.ts:137`, `apps/worker/src/jobs/document-extract.ts:190`
- Modify: `packages/jobs/src/intake.ts`, `packages/jobs/src/index.ts` (the `redecidePdfsAfterXbrl` stub)
- Modify: `packages/contracts/src/document.ts` (`CreateUploadRequest.mimeType`), `apps/api/src/routes/documents.ts`
- Test: `apps/worker/test/sniff.test.ts`, `apps/worker/test/document-verify.test.ts`, `apps/worker/test/run.test.ts`, `apps/worker/test/queue.test.ts`, `apps/api/test/documents.test.ts`

**Interfaces:**
- Produces:
  - `CreateUploadRequest.mimeType: z.enum(["application/pdf", "application/xml", "text/xml"])`; `formatForMime(mime): DocumentFormat` in `@maester/contracts`.
  - `storageKeyFor(workspaceId, documentId, format: DocumentFormat)`: `…/original.pdf` or `…/original.xml`. The upload route writes `document.format` from the declared type.
  - `sniff.ts`: `sniffXbrl(head: Uint8Array): "xbrl" | "doctype" | "not_xbrl"`. It skips a UTF-8 byte-order mark and whitespace, then feeds the bytes to `saxes` (`xmlns: true`, no DTD handling; its `doctype` event answers `doctype`). The first `opentag` must have local name `xbrl` and URI `http://www.xbrl.org/2003/instance`. A parse error, or no root within the bytes given, answers `not_xbrl`.
  - Verify keeps the hash and the size check over the whole stream and keeps the first `XBRL_SNIFF_BYTES` (65536). A `pdf` document must start with `%PDF-`, as today. An `xbrl` document must sniff `xbrl`. Anything else is rejected with `UNSUPPORTED_TYPE`, a DOCTYPE included. A document whose format is `xbrl` that settles at verify (rejected, or marked a duplicate) calls `redecidePdfsAfterXbrl`.
  - `JobHandler.onFinalFailure` becomes `(job: JobRow, deps: { db: Db; dispatcher: Dispatcher }) => Promise<void>`. Today it gets only `db` (`types.ts:29`), and a released PDF's `document.extract` job would be inserted but never dispatched, so in `cloud-tasks` mode it would never run. `run.ts:99` and `queue.ts:137` pass `{ db: deps.db, dispatcher: deps.dispatcher }` (`WorkerDeps` already holds the dispatcher). The two existing hooks (`document-classify.ts:137`, `document-extract.ts:190`) take `{ db }` from it and are otherwise unchanged.
  - `documentVerify.onFinalFailure` (new): for a document whose format is `xbrl`, it calls `redecidePdfsAfterXbrl(db, dispatcher, job.workspaceId)`. A verify that failed for good leaves the document `uploaded` or `verifying`, and Task 12 counts such a document as settled.
  - The stub `redecidePdfsAfterXbrl(db: Db, dispatcher: Dispatcher, workspaceId: string): Promise<number>` in `packages/jobs/src/intake.ts`, exported from `index.ts`, returns 0 until Task 12 writes its body.
  - `POST /:id/extract` on an `xbrl` document creates a `document.xbrl` job (`manual-<uuid>`, as today's manual runs). The guard for a covered `pdf` document needs the source rule's loader, so it lands in Task 12.

- [ ] **Step 1: Write the failing tests.** `sniff.test.ts`:
  - a Task 2-style instance, with its `<?xml …?>` declaration and comment before the root, sniffs `xbrl`;
  - the same with a BOM sniffs `xbrl`;
  - a DOCTYPE sniffs `doctype`;
  - `<html/>` and `<xbrl xmlns="urn:other"/>` sniff `not_xbrl`;
  - 65,536 bytes of comment with no root sniff `not_xbrl`.

  `document-verify.test.ts`:
  - an `xbrl` document with an instance is stored, and its classify and index jobs are created;
  - a `.xml` document that holds a PDF is rejected `UNSUPPORTED_TYPE`;
  - a PDF document holding XML is rejected `UNSUPPORTED_TYPE`;
  - an instance with a DOCTYPE is rejected `UNSUPPORTED_TYPE`;
  - a second copy of an instance is a duplicate and gets no classify job and no `document.index` job (Review Focus 4);
  - `documentVerify.onFinalFailure` on an `xbrl` document calls `redecidePdfsAfterXbrl` with the worker's dispatcher (a spy on the stub).

  `run.test.ts` and `queue.test.ts`: a final failure, from `executeJob` and from the sweeper, calls the hook with `{ db, dispatcher }`, the dispatcher being the one in `WorkerDeps`.

  `documents.test.ts`:
  - an upload with `text/xml` creates `format: "xbrl"` and a key ending `original.xml`;
  - `application/zip` gives 400 `VALIDATION_FAILED`;
  - `POST /:id/extract` on an `xbrl` document creates a `document.xbrl` job, not `document.extract`.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/worker exec vitest run test/sniff.test.ts test/document-verify.test.ts test/run.test.ts test/queue.test.ts && pnpm --filter @maester/api exec vitest run test/documents.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pin `saxes` to its newest release at least two weeks old.
- [ ] **Step 4: Run the worker, jobs and API suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/worker apps/api packages/contracts packages/jobs pnpm-lock.yaml
git commit -m "feat(intake): accept XBRL instances: XML uploads, original.xml, a streaming sniff that refuses DTDs, UNSUPPORTED_TYPE"
```

---

### Task 11: Classifying an XBRL document, and the worker's XBRL client

**Files:**
- Modify: `apps/worker/src/extractor.ts`, `apps/worker/src/jobs/document-classify.ts`
- Create: `apps/worker/src/jobs/classification-answers.ts`
- Modify: `packages/db/src/queries/classification.ts` (`matchCompanies`), `packages/contracts/src/classification.ts` (`Evidence`, `Classification`), `apps/api/src/serialize.ts` (`toEvidence`, `toClassification`), `apps/api/src/routes/classification.ts` (carry `isin`, `xbrlFormat`)
- Test: `apps/worker/test/extractor-xbrl.test.ts`, `apps/worker/test/document-classify.test.ts`, `packages/db/test/classification.test.ts`, `apps/api/test/classification.test.ts`

**Interfaces:**
- Consumes: `XbrlEvent`, `XbrlClassification`, `XbrlReadResult`, `XbrlTextResult`, `XbrlPdfCheckRequest`, `XbrlPdfCheckResult` (Task 6).
- Produces:
  - `ExtractorClient` gains:
    - `xbrl(input: { instance: Uint8Array; documentId: string; mode: "classify" }, onEvent): Promise<XbrlClassification>`, with overloads for `"read"` → `XbrlReadResult` and `"text"` → `XbrlTextResult`;
    - `xbrlPdfCheck(input: { pdf: Uint8Array; documentId: string; request: XbrlPdfCheckRequest }): Promise<XbrlPdfCheckResult>`, a `FormData` POST.

    The NDJSON is read as `extract` reads it, with the same failure mapping. An `error` event becomes its own `JobFailure`.
  - `ClassificationAnswers`: `ClassificationResult`'s fields without `pageCount` and `evidence`, plus `isin: string | null`, `xbrlFormat: string | null`, `basis: ReportingBasis | null` (an XBRL instance's basis; null for a PDF) and `evidence: StoredEvidence[]`. Here `StoredEvidence = { field, source: "rule" | "model", ruleId, pageIndex: number | null, quote: string | null, textLayerMatch: boolean | null, element: string | null, context: string | null }`.
  - `answersFromPdf(r: ClassificationResult): ClassificationAnswers` (`basis` null) and `answersFromXbrl(r: XbrlClassification): ClassificationAnswers` (`basis` from `r.basis`, `unknown` included). The XBRL version sets `rulesVersion` `xbrl-<parserVersion>`, `model` null and `promptVersion` `<format id>@<mapVersion>` or null, and its evidence is `source: "rule"` with `pageIndex` null.
  - `writeClassification(db, job, doc, answers: ClassificationAnswers, companyId)`: the signature changes from `ClassificationResult`, and it also writes `isin`, `xbrlFormat`, `basis`, `element` and `context`.
  - `document.classify` branches on `doc.format`. For `xbrl` it calls `ctx.extractor.xbrl({ mode: "classify" })` (no size check against `EXTRACT_MAX_BYTES`; the extractor's limit applies), matches the company with `isin`, writes and decides, and then calls `redecidePdfsAfterXbrl`. Its `onFinalFailure(job, { db, dispatcher })` (Task 10's signature) also calls `redecidePdfsAfterXbrl(db, dispatcher, job.workspaceId)` for an `xbrl` document.
  - `matchCompanies(db, ws, { cin?, bseCode?, nseSymbol?, isin?, name? })`: CIN first, then any of the three codes, then the name.
  - `Evidence` (API) gains `element: z.string().nullable()` and `context: z.string().nullable()`; `Classification` gains `isin`, `xbrlFormat` and `basis: ReportingBasis.nullable()`. The investor's classification POST carries `isin`, `xbrlFormat` and `basis` over from the previous answers, as it carries the identifiers.

- [ ] **Step 1: Write the failing tests.** `extractor-xbrl.test.ts` runs over a local `node:http` server replaying the Task 6 fixtures:
  - each mode resolves its result;
  - `stream-error.ndjson` rejects with `XBRL_UNREADABLE`, not retryable;
  - a cut stream rejects `EXTRACTOR_STREAM_INTERRUPTED`, retryable;
  - `xbrlPdfCheck` sends a multipart body with parts `pdf` and `request`.

  `document-classify.test.ts` uses a fake extractor:
  - an XBRL document of a workspace company with `bse_code` `500999` is classified `financial_results`, its company is matched, and `decideIntake` is called with that classification. Task 12 tests which job it creates;
  - with no company it is `needs_company`, and its evidence rows have `element` `ScripCode` and `context` `OneD`;
  - its classification row has `isin`, `xbrl_format` `in-capmkt/ind_as`, `basis` `consolidated`, `rules_version` `xbrl-1` and `model` null;
  - an unmapped standalone banking instance's row has `xbrl_format` `in-capmkt/banking` and `basis` `standalone`, although its `statements_found` is `[]`;
  - a PDF's classification row has `basis` null;
  - a mixed-basis answer is `needs_kind` with the warning;
  - `XBRL_UNREADABLE` fails the job without a retry and leaves `identify_failed`.

  `classification.test.ts` (db): `matchCompanies` finds a company by ISIN alone. `apps/api/test/classification.test.ts`: the investor's change to an XBRL document's company keeps `isin`, `xbrlFormat` and `basis` on the new row.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/worker exec vitest run test/extractor-xbrl.test.ts test/document-classify.test.ts && pnpm --filter @maester/db exec vitest run test/classification.test.ts && pnpm --filter @maester/api exec vitest run test/classification.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the worker, db, api and contracts suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/worker apps/api packages/db packages/contracts
git commit -m "feat(worker): classify an XBRL instance with no model: format, identity by ScripCode, Symbol and ISIN, evidence by element"
```

---

### Task 12: `decideIntake`: read XBRL, skip Gemini, wait, and release

**Files:**
- Modify: `packages/jobs/src/intake.ts` (the body of Task 10's `redecidePdfsAfterXbrl` stub, and the `enqueueXbrlPdfChecks` stub that Task 13 fills), `packages/jobs/src/index.ts`
- Create: `packages/db/src/queries/xbrl.ts`; Modify: `packages/db/src/index.ts`
- Modify: `packages/jobs/package.json`, `packages/db/package.json` and `apps/api/package.json` (each gains `"@maester/financial-engine": "workspace:*"`; `@maester/db` imports `XbrlDocInput`, the API imports `planPdfNumbers` here and in Tasks 14 and 16), `pnpm-lock.yaml`
- Modify: `apps/api/src/routes/documents.ts` (`POST /:id/extract` on a covered PDF)
- Test: `apps/worker/test/intake-xbrl.test.ts` (beside `intake.test.ts`, with the worker's `createWorkerContext` and `seedWorkspace` helpers and its `fileParallelism: false`; `packages/jobs` has no database harness), `apps/api/test/documents.test.ts`

**Interfaces:**
- Consumes: `planPdfNumbers`, `PdfNumbersInput` and `XbrlDocInput` (Task 9).
- Produces:
  - `loadWorkspaceXbrlDocs(db, ws): Promise<XbrlDocInput[]>` in `@maester/db`: one fixed set of queries for the whole workspace, so a caller with many PDFs loads it once and plans each PDF in memory. The XBRL documents of the workspace with `format = 'xbrl'` that are not duplicates, with their current classification and the state of their latest `document.verify` job, ordered by `created_at`. Their state is mapped by the first rule that matches:
    1. the latest `document.verify` job is `failed` (a verify that failed for good leaves the document `uploaded` or `verifying` with no hook to move it): `settled`;
    2. document state `uploaded` or `verifying`: `unsettled`;
    3. document state `stored` with intake state null: `unsettled`. Verify writes `state = 'stored'`, then `chainIntake` writes `intake_state = 'identifying'` in a second update, and a verify that crashed between them waits for its retry in this state;
    4. intake `identifying` or `reading`: `unsettled`;
    5. intake `needs_company` or `needs_kind`: `held`;
    6. everything else (`read`, `read_failed`, `identify_failed`, `kept`, rejected): `settled`.

    `coverage` holds the distinct `(statement, basis)` of the facts of the current revision when its `source` is `xbrl`. `pending_upload` documents are left out.
  - `companyIdentity(db, ws, companyId)` gives `{ cin, bseCode, nseSymbol, isin }`.
  - `decideIntake` (same signature) with a read kind and a company:
    - An `xbrl` document gets `reading` and a `document.xbrl` job (`readVersion(c.id)`).
    - A `pdf` document runs `planPdfNumbers` inside its transaction, under `pg_advisory_xact_lock(hashtext('xbrl-wait:' || workspace_id))`:
      - `wait` gives `waiting_for_xbrl` and no job;
      - `skip` gives `read` and no job;
      - `read` gives `reading` and a `document.extract` job, as today.
    - After commit, for a `pdf` `financial_results` document, it calls `enqueueXbrlPdfChecks(db, dispatcher, ws, { pdfDocumentId })`. This task adds it to `packages/jobs/src/intake.ts` as a stub returning 0, and Task 13 writes its body.
  - `POST /:id/extract` on a `pdf` document whose current classification is `financial_results` loads `loadWorkspaceXbrlDocs` and runs `planPdfNumbers` first. Only a `read` plan creates the `document.extract` job, as today. A `skip` plan answers 409 `INVALID_STATE` ("numbers come from XBRL") and a `wait` plan 409 `INVALID_STATE` ("waiting for its XBRL file"), with no job either way: without this, "Read it again" on a covered PDF would buy a Gemini Pro read of numbers that must come only from XBRL. Every other document is unchanged.
  - `DecideOptions.onlyFrom` accepts `waiting_for_xbrl` and `read`. `DecideOptions.allowWait?: boolean` (default true): with false, a `wait` plan changes nothing.
  - `redecidePdfsAfterXbrl(db, dispatcher, workspaceId): Promise<number>`. It nests no transaction:
    1. A short transaction takes the advisory lock, lists the ids of the workspace's `pdf` documents that are `waiting_for_xbrl`, and of those that are `read` with a non-null `readsUnderId` and no revision under it (skipped, so an XBRL confirmed for another company can send them back to Gemini), and commits.
    2. Then each id gets its own `decideIntake` with its current classification, and that transaction takes the lock itself. A waiting PDF gets `{ read: true, onlyFrom: ["waiting_for_xbrl"] }`. A skipped PDF gets `{ read: true, onlyFrom: ["read"], allowWait: false }`, so it acts only on a `read` plan: a finished PDF never goes back to waiting while a folder imports.

    It returns how many changed state.

    Callers: `document.xbrl` (success, a retry that finds the revision, and final failure); `document.classify` on an `xbrl` document (after `decideIntake`, and in `onFinalFailure`); `document.verify` when an `xbrl` document is rejected or is a duplicate, and in its `onFinalFailure` (Task 10); the API's classification POST and the confirm route (Task 17) for an `xbrl` document. Each final-failure hook passes the dispatcher it is given (Task 10), and the API passes its own.

- [ ] **Step 1: Write the failing tests** (database; `RecordingDispatcher`):

```ts
it("a results PDF whose XBRL is still being identified waits, and goes to Gemini once that XBRL fails", async () => {});
it("a results PDF whose consolidated and standalone XBRL are read is not read by Gemini: read, no document.extract job", async () => {});
it("a results PDF with only consolidated XBRL is read by Gemini", async () => {});
it("an annual report never waits for results XBRL and is read as today", async () => {});
it("the last XBRL settling releases the PDF, whatever order the PDF and the XBRL finish in", async () => {
  // interleave: PDF decides while XBRL is identifying; XBRL then settles in each way (read, read_failed, identify_failed, kept,
  // confirmed for another company); after redecidePdfsAfterXbrl no document is waiting_for_xbrl
});
it("an XBRL stored with a null intake state holds the PDF; it is unsettled, not settled with empty coverage", async () => {
  // XBRL row: state 'stored', intake_state null (between verify's two updates). decideIntake(pdf) → waiting_for_xbrl, no document.extract job
});
it("an XBRL whose verify failed for good settles: the PDF is released, and the sweeper's final failure releases it too", async () => {
  // XBRL row 'verifying' with its document.verify job 'failed' → loadWorkspaceXbrlDocs maps it 'settled'.
  // Then a PDF waiting on an XBRL whose verify job is running on its last attempt with an expired lease:
  // startQueueRunner(c, { concurrency: {}, pollMs: 20, sweepMs: 30, listen: noListen }), as queue.test.ts does, sweeps
  // and fails the job; documentVerify.onFinalFailure runs with the RecordingDispatcher, and the PDF's
  // document.extract job is created and recorded as dispatched.
});
it("a release that runs while the PDF is deciding does not leave it waiting", async () => {
  // Force the interleaving with the lock both sides take:
  // 1. a second connection opens a transaction and takes pg_advisory_xact_lock(hashtext('xbrl-wait:' || ws));
  // 2. start decideIntake(pdf) (it blocks on the lock); mark the XBRL row settled; start redecidePdfsAfterXbrl (it blocks too);
  // 3. commit the second connection's transaction to release the lock; await both promises;
  // 4. assert the PDF's intake_state <> 'waiting_for_xbrl'.
});
it("a skipped PDF goes back to Gemini when its XBRL is confirmed for another company", async () => {});
it("a skipped PDF stays read while new, unidentified XBRL documents of the workspace arrive", async () => {});
it("a held XBRL whose ScripCode is the PDF company's BSE code holds the PDF; one with other codes does not", async () => {});
it("a duplicate XBRL holds nothing and covers nothing", async () => {});
it("another workspace's XBRL never holds or covers a PDF", async () => {});
```

  `documents.test.ts` (API): `POST /:id/extract` on a skipped results PDF answers 409 `INVALID_STATE` and creates no `document.extract` job; on a results PDF the XBRL covers only in part, it creates one, as today.
- [ ] **Step 2: Run to see them fail.** `pnpm install`, then `pnpm --filter @maester/worker exec vitest run test/intake-xbrl.test.ts && pnpm --filter @maester/api exec vitest run test/documents.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire the callers listed above.
- [ ] **Step 4: Run the jobs, db, worker and API suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/jobs packages/db apps/worker apps/api pnpm-lock.yaml
git commit -m "feat(intake): XBRL documents read by document.xbrl; a PDF covered by XBRL skips Gemini; waiting_for_xbrl and its release"
```

---

### Task 13: `document.xbrl` and `document.xbrl_check`

**Files:**
- Create: `apps/worker/src/jobs/document-xbrl.ts`, `apps/worker/src/jobs/document-xbrl-check.ts`
- Modify: `apps/worker/src/jobs/{index.ts,document-extract.ts}` (export `setIntakeIfCurrent`), `apps/worker/src/queue.ts` (`DEFAULT_CONCURRENCY`), `apps/worker/src/env.ts` (`XBRL_PDF_CHECK`), `packages/jobs/src/{intake.ts,index.ts}` (`enqueueXbrlPdfChecks`, `xbrlCheckKeyOf`), `packages/contracts/src/payloads.ts`
- Test: `apps/worker/test/document-xbrl.test.ts`, `apps/worker/test/document-xbrl-check.test.ts`, `apps/worker/test/queue.test.ts`

**Interfaces:**
- Consumes: the extractor client (Task 11), `redecidePdfsAfterXbrl` (Task 12), the schema (Task 1).
- Produces:
  - `DEFAULT_CONCURRENCY["document.xbrl"] = 2`, `["document.xbrl_check"] = 2`.
  - `DocumentXbrlResult = { outcome: "read", revisionId: Uuid, state: ExtractionState, factCount: int, failedChecks: int, format: string | null, mapped: boolean }` and `DocumentXbrlCheckResult = { outcome: "checked" | "stale" | "disabled" | "not_mapped", rows: int }` in `payloads.ts`.
  - `writeXbrlRevision(db, job, doc, result: XbrlReadResult, classificationId): Promise<DocumentXbrlResult>`: one transaction, unique by job.
    - The revision: `source 'xbrl'`, `pageCount 0`, the result's versions, `coverage.statements` (one entry per statement and basis with facts: `pages: []`, `status: "extracted"`) and the warnings.
    - Each fact is written with `span` and `periodStart` plus one `xbrl_source` row (`element`, `context_id`, `decimals`, `nil`, `concept` from the fact, Departure 18), and **no** `source_reference`.
    - The checks, in batches of 500.
    - `failedChecks`, here and when a retry finds the revision, counts the revision's failed `subtotal` and `balance_identity` checks only, never `xbrl_in_pdf` rows that arrived later.
  - `documentXbrl` handler:
    - Errors: `EXTRACTOR_NOT_CONFIGURED` (not retried); `INVALID_STATE` for a document that is missing, not stored, a duplicate, or `format` not `xbrl`; `OBJECT_MISSING`.
    - A revision already written for the job sets the intake state again, enqueues the checks and releases.
    - Otherwise: the read, the write, `setIntakeIfCurrent(…, "read")`, `enqueueXbrlPdfChecks(db, dispatcher, ws, { xbrlDocumentId })`, then `redecidePdfsAfterXbrl`.
    - Progress stages `reading` and `stored`.
    - `onFinalFailure(job, { db, dispatcher })` sets `read_failed` when the job is current, then calls `redecidePdfsAfterXbrl(db, dispatcher, job.workspaceId)`.
  - `enqueueXbrlPdfChecks(db, dispatcher, ws, by: { xbrlDocumentId: string } | { pdfDocumentId: string }): Promise<number>`. It pairs XBRL documents (current revision `source = 'xbrl'` with at least one fact) with stored, non-duplicate `pdf` documents whose current classification is `financial_results` with the XBRL classification's company and period end. One `document.xbrl_check` job is created per pair, with pipeline version `v<XBRL_PDF_CHECK_VERSION>:pdf-<pdf classification id>:xbrl-<xbrl revision id>` (Global Constraints), so a second read of the same XBRL document (an investor change makes a new classification and so a new revision with new fact ids) gets a new job, and a retry of the same pair gets the old one. It always enqueues: `packages/jobs` reads no settings, so the job itself answers `disabled` when the worker's `XBRL_PDF_CHECK` is false (Departure 4).
  - `documentXbrlCheck` handler:
    1. It parses the job key with `xbrlCheckKeyOf`. `stale` when the XBRL revision in the key is no longer the XBRL document's current revision, or the PDF classification in the key is no longer the PDF's current one. `not_mapped` when the revision has no facts.
    2. `disabled` when `XBRL_PDF_CHECK` is false.
    3. It works out the request from the revision's facts. `scale` is the `scaleFactor` the monetary facts share, null when the revision carries `XBRL_ROUNDING_MISSING`. `places` is the fewest decimal places among the monetary facts' non-null `reportedValue`s, which is exactly the padding the read applied, max(0, finest decimals − rounding exponent) (Departure 12), so no new column is needed; null with `scale`. A crore file whose finest is −5 gives 2. `statementPages` is the PDF classification's `statementsFound`. Each fact goes as `value` = `normalizedValue` (null for a nil fact), `perShare` when `unitLabel` is `₹ a share`.
    4. When `scale` is null, the monetary facts are answered here, `not_checked` `no_unit`, without the extractor, and only the per-share facts are sent. With nothing left to send, no call is made.
    5. It writes one `extraction_check` row per answer: `workspace_id`; `revision_id` = the XBRL revision in the key; `check_type 'xbrl_in_pdf'`; `status` = the answer's status; `statement`, `basis`, `section`, `period_label` and `subject_label` from the fact; `expected` = the fact's `reported_value`; `actual` null; `detail` `""`; `fact_id`; `pdf_document_id`; `pdf_classification_id`; `page_index`; `reason`; `check_version` = the result's `checkVersion` (`XBRL_PDF_CHECK_VERSION` for rows answered here). `on conflict do nothing`.
    6. Logs carry counts by status only.

- [ ] **Step 1: Write the failing tests** with a fake extractor answering Task 6's fixtures:
  - an XBRL document is read into one revision with `source` `xbrl` and `page_count` 0; every fact has one `xbrl_source` row and no `source_reference`; the checks are stored; the document is `read`;
  - a retry after a crash following the commit writes nothing new;
  - an unmapped read writes a revision with no facts and the warning, the document is `read`, and the result says `mapped: false`;
  - `XBRL_UNREADABLE` gives `read_failed` without a retry, and a waiting PDF is released;
  - a stored results PDF of the same company and period gets one `document.xbrl_check` job, and a retry of the same `document.xbrl` job enqueues no second job for the same pair;
  - a second read of the same XBRL document under a new classification (a new revision, new fact ids) enqueues a new check job, and the new revision's facts get their own rows; the old rows stay;
  - the check writes one row per fact with its page, reason, `revision_id` (the XBRL revision) and `check_version` 1; running it twice writes each row once;
  - a PDF re-classified meanwhile, or an XBRL read again meanwhile, is `stale` and writes nothing;
  - a revision with `XBRL_ROUNDING_MISSING` writes `not_checked` `no_unit` for its monetary facts without calling the extractor, and sends its per-share facts;
  - with `XBRL_PDF_CHECK=false` the check job answers `disabled` and writes no row;
  - `xbrlCheckKeyOf("document.xbrl_check:<doc>:v1:pdf-<uuid a>:xbrl-<uuid b>")` gives `{ version: 1, pdfClassificationId: a, xbrlRevisionId: b }`, and a key without the suffix gives null;
  - `parseConcurrency(undefined, ["document.xbrl", "document.xbrl_check"])` gives 2 and 2;
  - no instance value reaches the logs.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/worker exec vitest run test/document-xbrl.test.ts test/document-xbrl-check.test.ts test/queue.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and register** both handlers.
- [ ] **Step 4: Run the worker and jobs suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/worker packages/jobs packages/contracts
git commit -m "feat(worker): document.xbrl writes an XBRL revision with xbrl_source; document.xbrl_check stores xbrl_in_pdf per fact"
```

---

### Task 14: The reads that join sources, and stitch with source precedence

**Files:**
- Modify: `packages/db/src/queries/{extraction.ts,research.ts}`, `packages/contracts/src/{extraction.ts,research.ts}`, `apps/api/src/{serialize.ts,financials/stitch.ts,routes/research.ts,routes/documents.ts,routes/dev.ts,env.ts}`
- Create: `apps/api/src/financials/in-pdf.ts`
- Modify: `apps/web/src/lib/research/types.ts` (types only: the page variant gains `kind?: "page"`)
- Test: `packages/db/test/research.test.ts`, `apps/api/test/stitch.test.ts`, `apps/api/test/in-pdf.test.ts`, `apps/api/test/research.test.ts`, `apps/api/test/extraction.test.ts`, `packages/contracts/test/research.test.ts`, `packages/contracts/test/readme-examples.test.ts`

**Interfaces:**
- Produces:
  - `FactWithSource = { fact: FinancialFactRow; source: SourceReferenceRow | null; xbrl: XbrlSourceRow | null }`. `listFactsWithSources` and `listFactsWithSourcesForRevisions` **left join** `source_reference` and `xbrl_source`. A fact with neither is returned with both null, and stitch shows it with source null.
  - `listXbrlPdfChecks(db, ws, factIds: string[]): Promise<ExtractionCheckRow[]>`: rows with `check_type = 'xbrl_in_pdf'` and `check_version = XBRL_PDF_CHECK_VERSION` only. It is the one reader of those rows (Departure 4).
  - `listChecks` (`GET /documents/:id/extraction`) and `listChecksForRevisions` (stitch's `Filing.checks`) gain `check_type <> 'xbrl_in_pdf'`. Without it, an XBRL document's extraction would list rows that arrived later with a PDF; stitch already matches checks by type (`subtotal`, `balance_identity`), so for stitch the filter only keeps rows it ignores out of memory. `existingSummary` in `document-extract.ts` reads PDF revisions only, which never hold these rows, and is unchanged.
  - Contracts:
    - `FinancialFact.source` becomes `FactSource`, a discriminated union on `kind`: `{ kind: "page", documentId, pageIndex, textLayerMatch }` and `{ kind: "xbrl", documentId, element, contextId, decimals: string | null, nil: boolean }`. It is nullable.
    - `FinancialFact` gains `span: FactSpan.nullable()` and `periodStart: IsoDate.nullable()`.
    - `ExtractionRevision` gains `source: z.enum(["pdf", "xbrl"])`.
  - `CellSource` becomes a discriminated union on `kind`:
    - `{ kind: "page", documentId, pageIndex, pageCount, textLayerMatch }`;
    - `{ kind: "xbrl", documentId, originalName, element, contextId, decimals: string | null, nil: boolean, periodStart: IsoDate | null, span: FactSpan | null, inPdf: XbrlInPdf }`, where `XbrlInPdf = { status: CheckStatus, pdfDocumentId: Uuid | null, pageIndex: int ≥ 0 | null, statementPages: int[], reason: XbrlPdfNotChecked | null }`.

    `Restated` becomes `{ kind: "page", documentId, filingPeriodEnd, pageIndex, value, printed }` or `{ kind: "xbrl", documentId, filingPeriodEnd, element, value, printed }`.
  - `inPdfFor(fact, checks, pdf: { documentId, classificationId, statementPages } | null, enabled: boolean): XbrlInPdf` in `apps/api/src/financials/in-pdf.ts`. Its answers:
    - no PDF of the filing gives `not_checked` `no_pdf`;
    - `enabled` false gives `not_checked` `disabled`;
    - no row for that PDF's current classification gives `not_checked` `not_yet`;
    - otherwise the row's status, page and reason.

    `statementPages` are the PDF classification's pages for the fact's statement and basis, so the screen can open "where the statement pages start". The API env gains `XBRL_PDF_CHECK` (default true).
  - `stitch(filings)`: `Filing` gains `revisionId: string`, `companyId: string`, `source: "pdf" | "xbrl"` and `filingKind: FilingKind` (the fields `annualSlotOf` and `SlotCandidate` need). Within a period the placed filings are ordered by `rankSlotCandidates` (Task 9) instead of `newestFirst`; each `Filing` maps to a `SlotCandidate` as `{ revisionId, documentId, source, filingPeriodEnd: periodEnd, revisionCreatedAt: revisionCreatedAt.toISOString() }`. A fact is admitted to the annual table only when `annualSlotOf(filing, fact)` (Task 9) gives a slot, so the source rule is the one guard: a `financial_results` filing adds nothing (the open Q4 question's default), and an XBRL quarter, year to date or off-date instant never shares a year's column. A fact is per share when it is an XBRL fact whose `unitLabel` is `₹ a share` (the unit says so exactly), or a PDF fact that matches `PER_SHARE` as today. `cellOf` builds the right `CellSource` variant, and the restated variant is chosen by the other filing's source. `precisionOf` is unchanged (Departure 12).
  - `/companies/:id/financials` passes `revisionId` (it already builds it), `companyId`, `source`, `filingKind` and the XBRL facts' `inPdf`. The filings it stitches stay annual reports only (`counts()`); with `annualSlotOf` that filter is no longer the only guard (Departure 6). The `/documents/:id/facts` and `dev.ts` routes use the new shapes.

- [ ] **Step 1: Write the failing tests.** `research.test.ts` (db):
  - XBRL facts come back from both queries with their `xbrl` row and `source` null;
  - a PDF fact comes back with `source` and `xbrl` null.

  `stitch.test.ts`:

```ts
// The XBRL filings below are filingKind "annual_report" (an MCA-style annual instance), so no test answers the open Q4 question.
it("an annual-report XBRL filing owns a year a newer annual-report PDF also prints, and the column never mixes them", () => {});
it("a line only the PDF prints stays out of the XBRL-owned column", () => { /* missing, never filled */ });
it("a year XBRL does not print comes from the PDF", () => {});
it("an XBRL quarter and its half year ending on 30 Sep never sit in an annual table", () => {});
it("a Q4 results XBRL (filingKind financial_results) with year facts adds no column and owns no year", () => {
  // the open question's default: the annual report's PDF still owns 2025-26
});
it("a half-year results XBRL with a 30 Sep OneI balance sheet adds no column", () => {});
it("an XBRL per-share fact is per share by its unit, whatever its label says", () => { /* unitLabel "₹ a share", label "Basic" */ });
it("an XBRL cell carries its element, context, decimals and the in-PDF outcome; a page cell carries kind 'page'", () => {});
it("XBRL restated against a PDF: the restated variant is the PDF's, at the coarser precision", () => {
  // XBRL 12345.00 lakh against PDF 12,345 lakh → not restated; against 12,346 → restated with kind "page"
});
it("an XBRL fact whose value is nil is '—' with status unparsed and nil true", () => {});
```

  `in-pdf.test.ts`: one case per `inPdfFor` answer above, and a row of an older `check_version` is not read (`not_yet`). `research.test.ts` (API): a company with a read results XBRL and a read annual report shows only the annual report's columns. `extraction.test.ts`:
  - `/documents/:id/facts` of an XBRL document returns `source.kind` `xbrl`;
  - `GET /documents/:id/extraction` of an XBRL document answers the same body before and after a `document.xbrl_check` job writes its `xbrl_in_pdf` rows.

  Contracts: `CellSource` refuses a page variant without `pageIndex` and an XBRL variant with one. Update the README examples.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/db exec vitest run test/research.test.ts && pnpm --filter @maester/api exec vitest run test/stitch.test.ts test/in-pdf.test.ts test/research.test.ts test/extraction.test.ts && pnpm --filter @maester/contracts exec vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the web's mirror types (types only; no component changes) and `cd apps/web && pnpm check`.
- [ ] **Step 4: Run the db, contracts and API suites and `apps/web`'s `pnpm verify`.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/db packages/contracts apps/api apps/web/src/lib/research/types.ts
git commit -m "feat(research): reads left-join page and XBRL sources; CellSource and Restated xbrl variants; stitch puts XBRL first"
```

---

### Task 15: XBRL text blocks into the index

**Files:**
- Create: `apps/indexer/src/maester_indexer/text_chunker.py`; Modify: `apps/indexer/src/maester_indexer/{app.py,contracts.py}`
- Modify: `packages/contracts/src/document-index.ts`, `apps/worker/src/indexer.ts`, `apps/worker/src/jobs/document-index.ts`
- Create: `packages/contracts/fixtures/index/{chunk-text-request.json,chunk-text-response.json}`
- Test: `apps/indexer/tests/test_text_chunker.py`, `apps/indexer/tests/test_service.py`, `packages/contracts/test/index-fixtures.test.ts`, `apps/worker/test/indexer-client.test.ts`, `apps/worker/test/document-index-xbrl.test.ts`

**Interfaces:**
- Produces:
  - Contracts: `ChunkTextRequest = { blocks: { element: string; heading: string; text: string }[]; basis: "consolidated" | "standalone" | null; embeddingModel: string }`, `TextChunk = { element, seq: int ≥ 0, kind: ChunkKind, sectionPath: string[], basis, text, tokenCount }` and `ChunkTextResponse = { versions: IndexerVersions; chunks: TextChunk[] }`, with Pydantic twins.
  - `chunk_text_blocks(blocks, basis, tokenizer) -> list[TextChunk]`:
    - Each block is split on blank lines into paragraphs, and a paragraph whose every line holds `" | "` is a table paragraph.
    - Paragraphs are packed in order while `contextualize([heading], text)` fits the budget Task 4 of phase 2 uses (`CHUNK_TOKENS`, at most `MAX_EMBED_TOKENS` in all). A paragraph over it is split by lines, then by words.
    - `seq` counts from 0 across all blocks.
    - `kind` is `table` when every paragraph of the chunk is a table paragraph.
    - `sectionPath` is `[heading]` and `basis` is the request's.
  - `POST /v1/chunk-text` (secret, `INDEX_MAX_BYTES`): it answers JSON `ChunkTextResponse`. A model that is not the loaded tokenizer's gives 409 with the body `{ "code": "INDEXER_MODEL_MISMATCH", "message": … }`.
  - `IndexerClient.chunkText(request, signal): Promise<ChunkTextResponse>`. Today the client turns every non-OK status into `INDEXER_HTTP_<status>` (`apps/worker/src/indexer.ts:64`), so `chunkText` reads a 409 body first: `code` `INDEXER_MODEL_MISMATCH` becomes `JobFailure("INDEXER_MODEL_MISMATCH", …, false)`, the code `document-index.ts` already uses. Any other status keeps today's mapping.
  - `document.index` on a `format = 'xbrl'` document runs `indexXbrl`:
    - No extractor gives `EXTRACTOR_NOT_CONFIGURED`; no indexer or embedder gives `INDEXER_NOT_CONFIGURED`.
    - It calls `extractor.xbrl({ mode: "text" })`, then `indexer.chunkText`.
    - It starts or resumes the revision with versions `doclingVersion: "none"`, `ocrEngine: "none"`, `readerOptions: "xbrl-text=<textVersion>"`, the indexer's `chunkerVersion` and `tokenizer`.
    - It runs `writeRange(…, pages: [], chunks with pageNumber null, element, textSource "xbrl", { pageCount: 0, pagesRead: 0, pagesOcr: 0, warnings: [] })`, then `embedPending` and `completeRevision`.
    - No block completes the revision with no chunks.

- [ ] **Step 1: Write the failing tests.** `test_text_chunker.py` (whitespace tokenizer):
  - two short blocks give two chunks with `seq` 0 and 1 and their headings;
  - a block of 2,000 words splits into chunks within the budget;
  - a table block is `kind` `table`;
  - consolidated basis carries through.

  `test_service.py`: `/v1/chunk-text` answers the fixture; a model mismatch gives 409 with code `INDEXER_MODEL_MISMATCH`. `indexer-client.test.ts`: `chunkText` against a 409 `{ code: "INDEXER_MODEL_MISMATCH" }` rejects with that code, not retryable; a 503 still rejects `INDEXER_HTTP_503`, retryable. `document-index-xbrl.test.ts`, with a fake extractor and indexer and `FakeEmbedder`:
  - an XBRL document is indexed into a complete revision whose chunks have `page_number` null, an `element` and `text_source` `xbrl`, every chunk embedded;
  - a search for a word in the block finds it with `pageNumber` null and the element;
  - an embedder failure and retry write no chunk twice.
- [ ] **Step 2: Run to see them fail.** `cd apps/indexer && uv run python -m unittest tests.test_text_chunker tests.test_service -v` and `pnpm --filter @maester/worker exec vitest run test/indexer-client.test.ts test/document-index-xbrl.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the indexer, contracts and worker suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/indexer apps/worker packages/contracts
git commit -m "feat(index): XBRL text blocks as chunks with text_source xbrl and their element, chunked by the indexer's tokenizer"
```

---

### Task 16: The `pipeline` object

**Files:**
- Create: `packages/contracts/src/pipeline.ts`; Modify: `packages/contracts/src/{document.ts,index.ts}`
- Create: `packages/db/src/queries/pipeline.ts`; Create: `apps/api/src/documents/pipeline.ts`
- Modify: `apps/api/src/{serialize.ts,routes/documents.ts,routes/classification.ts}`
- Test: `apps/api/test/pipeline.test.ts` (pure), `packages/db/test/pipeline.test.ts`, `apps/api/test/documents.test.ts`

**Interfaces:**
- Produces:
  - `DocumentPipeline` (`pipeline.ts`):

```ts
DocumentPipeline = z.strictObject({
  stored: z.enum(["done", "now", "failed"]),
  identified: z.enum(["done", "now", "needs_you", "failed", "waiting"]),
  numbers: z.strictObject({
    source: z.enum(["xbrl", "pdf"]).nullable(),
    state: z.enum(["done", "now", "not_needed", "failed", "waiting", "not_read"]),
    coveredByXbrl: z.array(Uuid),           // not_needed, and pdf partial coverage
    waitingOn: z.array(Uuid),               // waiting on XBRL (ask 2)
    reason: z.enum(["format_unmapped", "not_a_read_kind", "duplicate", "waiting_for_xbrl", "not_identified", "needs_you"]).nullable(),
    format: XbrlFormatKind.nullable(),      // with format_unmapped (ask 3)
  }),
  text: z.strictObject({
    state: z.enum(["done", "now", "partial", "failed", "waiting"]),
    pages: z.number().int().min(0), pagesRead: z.number().int().min(0), pagesOcr: z.number().int().min(0),
    chunks: z.number().int().min(0), xbrlBlocks: z.number().int().min(0),
    ahead: z.number().int().min(0).nullable(),   // queued document.index jobs before this one (ask 4)
  }),
})
```

  - `Document` gains `pipeline: DocumentPipeline`.
  - `loadPipelineInputs(db, ws, documentIds: string[]): Promise<Map<string, PipelineInput>>`. Batched: one query each for the documents, current classifications, current extraction revisions (with `source` and `warnings`), the latest `document`, `document.xbrl` and `document_index` jobs, the current index revisions with chunk and block counts (`count(distinct element) filter (where text_source = 'xbrl')`), and queue positions. The queue position is the count of `document.index` jobs in state `queued` with `(run_after, created_at)` below this job's, as the runner claims.
  - `computePipeline(input: PipelineInput, plan: PdfNumbersPlan | null, covering: string[]): DocumentPipeline` (pure). `covering` is `coveringXbrl` over the same inputs as the plan, `[]` for an XBRL document:
    - `stored`: document `stored` is `done`; `rejected` is `failed`; else `now`.
    - `identified`: not stored is `waiting`; `identifying` is `now`; `needs_company` or `needs_kind` is `needs_you`; `identify_failed` is `failed`; else `done`.
    - `numbers` for an XBRL document: `source "xbrl"`.
      - Intake `reading`, or a running or queued `document.xbrl` job, is `now`.
      - `read_failed` is `failed`.
      - `read` with the warning `XBRL_FORMAT_UNMAPPED` is `not_read` `format_unmapped`, `format` the classification's kind.
      - `read` otherwise is `done`.
      - Not identified yet is `waiting` `not_identified`.
      - `kept` is `not_read` `not_a_read_kind`.
      - A duplicate is `not_read` `duplicate`.
    - `numbers` for a PDF:
      - `waiting_for_xbrl` is `waiting` with `waitingOn` from the plan.
      - `read` with no revision is `not_needed`, `source "xbrl"`, `coveredByXbrl` from `coveringXbrl` (Task 9), not from the plan. While any unidentified XBRL document is in the workspace (any folder import) the plan is `wait`, which names no cover, and a finished PDF must keep its "From XBRL" link.
      - `reading` is `now`, `source "pdf"`.
      - `read` is `done`, `source "pdf"`, with `coveredByXbrl` for a partly covered PDF.
      - `read_failed` is `failed`.
      - `kept` is `not_read` `not_a_read_kind`.
      - `needs_*` is `waiting` `needs_you`; earlier states are `waiting` `not_identified`.
      - A duplicate is `not_read` `duplicate`.
    - `text`:
      - A complete revision is `done`; a partial one is `partial`.
      - The `document.index` job `running` is `now`; `queued` is `waiting` with `ahead`; `failed` with no revision is `failed`.
      - No job is `waiting` with `ahead` null.
      - The counts come from the newest revision for `EMBEDDING_MODEL` (0 without one).
  - The plan and the cover for a PDF are `planPdfNumbers` and `coveringXbrl` over `loadWorkspaceXbrlDocs`, loaded once per request and applied to each PDF in memory. Every `toDocument` call site passes the pipeline: the upload, finalize, list, get and classification POST.

- [ ] **Step 1: Write the failing tests.** `pipeline.test.ts` gives one case per branch above with hand-built inputs, among them:
  - a PDF waiting on two XBRL ids;
  - a PDF `not_needed` covered by two;
  - a skipped PDF keeps its `coveredByXbrl` while an import runs: plan `wait` on a new unidentified XBRL, `covering` the two settled ids, giving `not_needed` with both ids;
  - an unmapped banking instance giving `not_read`, `format_unmapped`, `banking`;
  - a text job third in the queue giving `ahead: 2`.

  `packages/db/test/pipeline.test.ts`:
  - the batched loader returns the right counts for an XBRL revision with 12 blocks in 30 chunks;
  - it runs a fixed number of queries for 50 documents. The test counts them by wrapping the pool's `query` (`db.$client.query`, a `pg.Pool`) in a counter before the call, so `createDb` needs no logger;
  - it never reads another workspace's jobs.

  `documents.test.ts`: `GET /documents` items carry a `pipeline` that parses as `DocumentPipeline`.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/api exec vitest run test/pipeline.test.ts test/documents.test.ts && pnpm --filter @maester/db exec vitest run test/pipeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the API, db and contracts suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/db apps/api
git commit -m "feat(api): the per-document pipeline object, computed on read: tracks, waiting on, covered by XBRL, unmapped format, queue position"
```

---

### Task 17: `GET …/filings` and confirming a company once

**Files:**
- Create: `packages/contracts/src/filings.ts`; Modify: `packages/contracts/src/{company.ts,index.ts}`
- Create: `apps/api/src/documents/{filings.ts,held.ts,reclassify.ts}`, `apps/api/src/routes/filings.ts`; Modify: `apps/api/src/{app.ts,serialize.ts,routes/companies.ts,routes/classification.ts}` (`toCompany` sets `isin`)
- Create: `packages/db/src/queries/filings.ts`
- Test: `apps/api/test/filings-build.test.ts` (pure), `apps/api/test/held.test.ts` (pure), `apps/api/test/filings.test.ts`, `apps/api/test/confirm.test.ts`

**Interfaces:**
- Produces:
  - Contracts (`filings.ts`):

```ts
StatementSourceReason = z.enum(["xbrl_lacks_statement", "xbrl_format_unmapped", "no_xbrl", "not_in_filing", "not_read_yet", "read_failed"])
InPdfCount = z.strictObject({ found: int, checked: int, notFound: z.array(Uuid) /* fact ids */, notChecked: XbrlPdfNotChecked.nullable() })
StatementSource = z.strictObject({
  statement: StatementKind, source: z.enum(["xbrl", "pdf"]).nullable(),
  xbrlDocumentId: Uuid.nullable(), xbrlSpans: z.array(FactSpan),
  pdfDocumentId: Uuid.nullable(), pdfPages: z.array(int ≥ 0),
  reason: StatementSourceReason.nullable(), inPdf: InPdfCount.nullable(),
})
BasisSources = z.strictObject({ basis: ReportingBasis, statements: z.array(StatementSource) })      // ask 1
FilingFile = z.strictObject({ documentId: Uuid, originalName: z.string(), format: DocumentFormat, basis: ReportingBasis.nullable(),
  createdAt: IsoTimestamp, intakeState: IntakeState.nullable(), duplicates: z.array(Uuid), pipeline: DocumentPipeline })
WorkspaceFiling = z.strictObject({ key: z.string(), kind: ClassificationKind, otherType: OtherType.nullable(), periodEnd: IsoDate.nullable(),
  spans: z.array(ResultsSpan), files: z.array(FilingFile), sources: z.array(BasisSources), settled: z.boolean(), addedAt: IsoTimestamp })
HeldIdentity = z.strictObject({ key: z.string(), nameAsPrinted: z.string().nullable(), cin, bseCode, isin, nseSymbol: z.string().nullable(),
  files: int, filings: int, documentIds: z.array(Uuid), matches: z.array(Uuid) })                   // ask 5's grouping
WorkspaceFilings = z.strictObject({ companies: z.array(z.strictObject({ company: Company, filings: z.array(WorkspaceFiling) })),
  held: z.array(HeldIdentity), unsorted: z.array(FilingFile) })
ConfirmCompanyRequest = z.strictObject({
  identity: z.strictObject({ cin: Cin.optional(), bseCode: BseCode.optional(), isin: Isin.optional(), nseSymbol: NseSymbol.optional() })
    .refine((i) => Object.values(i).some(Boolean), "at least one identifier"),
  company: z.union([z.strictObject({ id: Uuid }), z.strictObject({ new: CreateCompanyRequest.extend({ cin: Cin.optional(), bseCode: BseCode.optional(), isin: Isin.optional(), nseSymbol: NseSymbol.optional() }) })]),
})
ConfirmCompanyResponse = z.strictObject({ companyId: Uuid, confirmed: int })
```

  - `Company` gains `isin: z.string().nullable()`. The contract names are `WorkspaceFiling` and `WorkspaceFilings`, not `Filing`, because `apps/api/src/financials/stitch.ts` already exports a `Filing` type.
  - `buildFilings(input: FilingsInput): WorkspaceFilings` (pure, in `documents/filings.ts`):
    - **Grouping.** Files with a company are grouped by `(companyId, kind, periodEnd)` (Departure 2), and a kept `other` document also by its `otherType`, so a board-meeting outcome and an investor presentation of one day are two filings. The key is `${companyId}:${kind}:${periodEnd}`, or `${companyId}:other:${otherType}:${periodEnd}` for `kind` `other`; a null period puts `${documentId}` in the period's place.
    - **Ordering.** Filings are newest `periodEnd` first, and companies by display name. `spans` (a filing's `ResultsSpan`s) and `xbrlSpans` (`FactSpan`s) are listed distinct, in the order `quarter`, `half_year`, `nine_months`, then `full_year` or `year`.
    - **Duplicates** are not files: their ids sit under the original's `duplicates`.
    - **Unsorted.** Files with no company that are not held, and files whose current classification prints no identity at all, go to `unsorted`.
    - **`FilingFile.basis`** is an XBRL file's `document_classification.basis` (Task 11), and null for a PDF.
    - **Sources**, for each basis among the filing's XBRL instances' own `basis` (mapped or not) and its PDF's `statementsFound`, and each statement:
      - an XBRL instance of that basis whose current revision has facts of that statement gives `source "xbrl"`, with `xbrlSpans` the distinct spans of that statement's facts and `inPdf` counted from that statement's `xbrl_in_pdf` rows for the PDF's current classification. An instant-only statement (the balance sheet) has `xbrlSpans` `[]`: the route gives no span for it, and phase 6 words it from the filing's `periodEnd` (the screen spec has no string for it yet; "XBRL · as at 30 Sep 2025" is the proposal);
      - else the PDF has the pair in `statementsFound`: `source "pdf"`, with `pdfPages`, and `reason` set to `xbrl_lacks_statement` (an XBRL of that basis exists and has facts), `xbrl_format_unmapped` (an XBRL of that basis exists and its revision is unmapped) or `no_xbrl` (no XBRL of that basis). An unmapped instance gives `xbrl_format_unmapped` under its own basis only. When the PDF is not read yet the reason is `not_read_yet`, and when its read failed the reason is `read_failed`;
      - else `source` null and `not_in_filing`.

      The ranking between sources is `slotOwner` (Task 9).
    - **`settled`** is true when every file's `identified` is `done`, `numbers.state` is one of `done`, `not_needed`, `not_read` or `failed`, and `text.state` is one of `done`, `partial` or `failed`.
  - `groupHeld(rows: { documentId, kind, periodEnd, nameAsPrinted, cin, bseCode, isin, nseSymbol }[], companies: CompanyRow[]): HeldIdentity[]` (pure, `documents/held.ts`):
    - Documents that share any non-null identifier value are one group (union-find over `cin`, `bse`, `isin` and `nse` values). Documents with no identifier are left out; they are `unsorted`.
    - `key` is the group's identifiers sorted and joined, for example `bse:500999|isin:INE999Z01011`.
    - `nameAsPrinted` is the most common name.
    - `filings` counts the distinct `(kind, periodEnd)`.
    - `matches` are the `matchCompanies` results for the group's identifiers.
    - Groups are ordered by file count, largest first, then by key.
  - `GET /v1/workspaces/:ws/filings` (session and membership through `requireWorkspace`): `WorkspaceFilings`, read with batched queries (`listFilingRows`, `loadPipelineInputs`, the checks by fact id), never one query per file.
  - `writeInvestorClassification(tx, ws, userId, documentId, input: ChangeClassificationRequest): Promise<{ row: ClassificationRow; read: boolean }>`. This is the body of today's classification POST, moved and reused. That route calls it unchanged in behaviour.
  - `POST /v1/workspaces/:ws/companies/confirm`: `ConfirmCompanyRequest` → `ConfirmCompanyResponse`. It runs in one transaction:
    1. Create the company when the request says `new`, with the given identity's codes.
    2. Lock and list the workspace's `needs_company` documents whose current classification shares any given identifier.
    3. Write an investor classification for each: `basedOn` its current one, company `{ id }`.

    After commit it calls `decideIntake` for each, then `redecidePdfsAfterXbrl`. It answers the count. With no held document it answers `confirmed: 0`, still 200. A company name or code already used gives 409 `CONFLICT`.

- [ ] **Step 1: Write the failing tests.** `held.test.ts`:
  - two `financial_results` instances ending 30 Sep 2025 (consolidated and standalone) with `bse:500999`, and a `financial_results` PDF ending 30 Jun 2025 with `bse:500999` and a CIN, form one group of 3 files and 2 filings;
  - an instance with only `isin` and one with the same ISIN and a BSE code, both `financial_results` ending 30 Sep 2025, form one group of 2 files and 1 filing;
  - a file with no codes is not grouped.

  `filings-build.test.ts`:
  - **A Q2 filing** (period end 30 Sep 2025) with a PDF (both bases found) and consolidated and standalone instances gives one filing with three files. Under both bases the P&L is `source "xbrl"` with `xbrlSpans` `["quarter", "half_year"]` (`OneD` and `FourD`), the balance sheet `source "xbrl"` with `xbrlSpans` `[]` (`OneI` is an instant) and the cash flow `source "xbrl"` with `xbrlSpans` `["half_year"]`. The consolidated P&L's `inPdf` is `{ found: 38, checked: 38, notFound: [], notChecked: null }`, from 38 passed rows.
  - **A Q1 filing**, whose instances have no cash flow, gives cash flow `source "pdf"` with `xbrl_lacks_statement` and its pages.
  - **A standalone banking instance with a two-basis PDF** gives, under standalone, every statement the PDF found `source "pdf"` with `xbrl_format_unmapped`, and under consolidated `source "pdf"` with `no_xbrl`; the instance's file has `basis` `standalone`.
  - **A duplicate** sits under its original.
  - **A filing with a waiting PDF** is not settled.
  - **A PDF classified half year and its instance classified quarter** for the same period end are one filing with `spans` `["quarter", "half_year"]`.
  - **Two kept `other` documents** of one company and one period end, a `board_meeting` and an `investor_presentation`, are two filings, with keys `<company>:other:board_meeting:2025-09-30` and `<company>:other:investor_presentation:2025-09-30`.

  `filings.test.ts` (route):
  - signed out gives 401; another workspace gives 404;
  - a seeded workspace answers a body that parses as `WorkspaceFilings`;
  - 100 documents are answered within a fixed query count (counted by wrapping `db.$client.query`, as in Task 16).

  `confirm.test.ts`:
  - confirming `{ bseCode: "500999" }` as a new company releases every held document printing it, answers `confirmed: 3`, and creates their `document.xbrl` and `document.extract` jobs (or `waiting_for_xbrl`, as `decideIntake` decides);
  - a second confirm answers `confirmed: 0`;
  - a document of another workspace printing the same code is untouched;
  - an empty identity gives 400.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/api exec vitest run test/held.test.ts test/filings-build.test.ts test/filings.test.ts test/confirm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and move the classification POST's body into `writeInvestorClassification`. The existing `classification.test.ts` must pass unchanged.
- [ ] **Step 4: Run the API and contracts suites.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/db apps/api
git commit -m "feat(api): GET /filings by company and filing with per-basis statement sources; confirm a printed identity once for all its files"
```

---

### Task 18: `@maester/import`: a folder through the API

**Files:**
- Create: `apps/import/{package.json,tsconfig.json,eslint.config.js,README.md,vitest.config.ts}`, `apps/import/src/{cli.ts,import.ts,walk.ts}`
- Modify: `pnpm-workspace.yaml` (`apps/import`)
- Test: `apps/import/test/import.test.ts`

**Interfaces:**
- Produces:
  - `walk(folder: string): AsyncIterable<{ path: string; name: string; size: number }>`. It goes depth first and in sorted order. It takes `.pdf` and `.xml` (case-insensitive). It skips names starting with `.`, plus `Thumbs.db` and `desktop.ini`. It follows no symbolic link.
  - `importFolder(opts: { apiUrl: string; workspaceId: string; cookie: string; folder: string; concurrency?: number /* 4 */; fetch?: typeof fetch; onSettled?: (n: number, total: number) => void }): Promise<ImportResult>`, where `ImportResult = { sent: number; refused: { name: string; code: string }[]; failed: { name: string; code: string }[]; stopped: "signed_out" | null }`. Each file goes through three requests: `POST /v1/workspaces/:ws/documents/uploads` (`mimeType` `application/pdf` or `application/xml` by extension), `PUT` to the signed URL with its headers, then `POST …/:id/finalize`.
    - A 400 or 413 is `refused` with the error code.
    - A 401 stops the run: files already started finish, nothing new starts, and the result's `stopped` is `"signed_out"`.
    - `exitCodeOf(r: ImportResult): 0 | 1 | 2` in `cli.ts`: 2 when `stopped` is set, else 1 when anything failed, else 0. Refused files alone exit 0.
    - A network error, or a 5xx after two retries with waits of 1 s and 2 s, is `failed`.
    - A file over 52428800 bytes is refused locally (`UPLOAD_TOO_LARGE`) without a request.
    - The PUT goes to the signed `url` as given. The disk store signs an absolute URL on its own base URL; a relative one is resolved against `MAESTER_API_URL`. It sends the signed headers except `Content-Length`, which `fetch` sets from the body.
  - `pnpm --filter @maester/import run import <folder> [--workspace <id>] [--api <url>]`. The `run` is needed: `import` is a pnpm built-in (`pnpm import` builds a lockfile from another package manager's), so `pnpm --filter @maester/import import` would never reach the script. The command reads `MAESTER_SESSION_COOKIE`, plus `MAESTER_WORKSPACE` and `MAESTER_API_URL` (default `http://localhost:8787`). The cookie is the API's session cookie as `name=value`: the API sets `cookiePrefix: "maester"` (`apps/api/src/auth.ts:110`), so it is `maester.session_token` in development and `__Secure-maester.session_token` in production.
    - It prints a progress line every 25 files, then `Sent N. Refused M. Failed K.` and each refused or failed file by name with its code.
    - It exits with `exitCodeOf(result)`. A file's contents are never printed.
    - The README says how to copy the cookie, by those two names. It also says that a second run of the same folder creates duplicates, which are not read again.

- [ ] **Step 1: Set up the package.** Write `apps/import/package.json` (`"name": "@maester/import"`, scripts `"import": "tsx src/cli.ts"` and `"test": "vitest run"`, vitest as `packages/jobs` has it), `tsconfig.json`, `eslint.config.js` and `vitest.config.ts`; add `apps/import` to `pnpm-workspace.yaml`; run `pnpm install`. Expected: `pnpm --filter @maester/import exec vitest run` runs and reports no test files.
- [ ] **Step 2: Write the failing tests**, over a local `node:http` server that answers the three endpoints:
  - a folder of 3 PDFs, 2 XML files, a `.DS_Store` and a `notes.txt` makes 5 uploads with the right MIME types and 5 finalizes;
  - at most 4 requests are in flight at once (counted in the server);
  - a 413 on one file lists it as refused and goes on;
  - a 401 on the third upload stops new uploads, and the result's `stopped` is `"signed_out"`;
  - `exitCodeOf` gives 2 for a stopped run, 1 for a run with a failure, and 0 for a run with only refusals;
  - a 503 then a 200 succeeds after one retry;
  - a 60 MB sparse file is refused locally;
  - a relative signed URL (`/dev/blobs/…`) is resolved against the API URL.
- [ ] **Step 3: Run to see them fail.** `pnpm --filter @maester/import exec vitest run`. Expected: FAIL, on the missing modules.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run to see them pass.** Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add apps/import pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(import): pnpm --filter @maester/import run import <folder> uploads PDFs and XBRL instances through the API, four at a time"
```

---

### Task 19: The drop strip takes XBRL

**Files:**
- Modify: `apps/web/src/lib/documents/{batch.ts,client.ts,types.ts,intake.ts}`, `apps/web/src/lib/content/documents.ts`, `apps/web/src/lib/components/documents/DropStrip.svelte` (the `accept` attribute only), `apps/web/src/lib/components/documents/Slip.svelte` (the "Read it again" condition only, line 336's `{:else if doc.intakeState === 'read' && !jobRunning}` block), `docs/DESIGN.md` (§5 Drop strip, Stage ladder and Slip)
- Test: `apps/web/src/lib/documents/batch.test.ts`, `apps/web/src/lib/documents/client.test.ts`, `apps/web/src/lib/documents/intake.test.ts`

**Interfaces:**
- Produces:
  - `checkFile`: a `.xml` with type `application/xml`, `text/xml` or empty is accepted on name and type. The `xbrl` refusal is removed.
  - `looksLikeXml(head)`: true when the first bytes, after an optional BOM and whitespace, start with `<`.
  - `screen` checks `.pdf` files with `looksLikePdf` and `.xml` files with `looksLikeXml`; `notPdfInside` gains a twin `notXmlInside`: "Named .xml, but not XML inside."
  - `client.ts` sends `mimeType` `application/xml` for `.xml`.
  - The copy, from the screen spec §6, is these three strings:
    - `title` "Drop PDFs or XBRL files here";
    - `note` "PDF or XBRL (.xml), up to 50 MB a file. A whole folder works too.";
    - `notPdf` "Not a PDF or an XBRL file.", also used for the API's `UNSUPPORTED_MEDIA_TYPE` and the verify rejection `UNSUPPORTED_TYPE`.
  - `accept="application/pdf,.pdf,.xml,application/xml,text/xml"`.
  - `DESIGN.md` §5's Drop strip entry changes in four places:
    - `accept` gets the list above;
    - the title and the limit get the new strings;
    - the sentence "An XBRL .xml is refused with … until XBRL is read." is replaced by "An XBRL `.xml` is checked by its first bytes as XML; the server checks it is an XBRL instance.";
    - the type check reads "(by name and by its first bytes)".

    Nothing else in the drop strip changes.
  - **Today's slip meets four new inputs** before phase 6 replaces it, and must not get them wrong:
    - **The intake state `waiting_for_xbrl`.** Without a case, `statuses()` in `intake.ts` returns `undefined` and the ladder fails to render. It becomes `['done', 'done', 'next', 'next']`. `stateLabel()` looks the state up by its own name (`states[doc.intakeState]`), so the copy key is `waiting_for_xbrl: 'Waiting for its XBRL file.'` in `copy.states`, and `stateLabel` needs no new case. `isLive()` is true for `waiting_for_xbrl`, so the slip and the Earlier list keep polling a waiting PDF and see its release without a reload. The web's `IntakeState` mirror gains the value.
    - **A re-read of an XBRL document** runs `document.xbrl`, not `document.extract`. `readingAgain` accepts either job type, so the slip shows Now on Reading the statements while it runs.
    - **XBRL evidence**, with `pageIndex` null and an `element`. `sourceOf` answers `"<element> <quote>"`, for example "ScripCode 500999" (screen spec §5), when the evidence has an element. The web's `Evidence` mirror gains `element` and `context`.
    - **A PDF whose numbers come from XBRL** is `read` with no revision, and "Read it again" would post `/extract`, which Task 12 now refuses. `canReadAgain(doc: DocumentRecord): boolean` in `intake.ts` is false when `doc.pipeline?.numbers.state === 'not_needed'`, and `Slip.svelte` shows the button only when it is true; "See the figures" is unchanged. The web's `DocumentRecord` mirror gains `format: 'pdf' | 'xbrl'` and `pipeline?: { numbers: { state: string; coveredByXbrl: string[] } }`, the part of Task 16's `DocumentPipeline` it reads.
    - `DESIGN.md` §5 gains one sentence under **Stage ladder**: "A PDF waiting for its XBRL shows Next on Reading the statements." It gains two under **Slip**: "An answer read from an XBRL file shows the element and its value (\"ScripCode 500999\") in place of a page." and "A results PDF whose numbers come from its XBRL files has no \"Read it again\"."

- [ ] **Step 1: Write the failing tests:**
  - `checkFile({ name: "q2.xml", size: 10, type: "text/xml" })` is null;
  - `screen` refuses a `.xml` whose head is `%PDF-1.7` with "Named .xml, but not XML inside.";
  - `looksLikeXml` is true for `"﻿\n<?xml"` and false for `"%PDF"`;
  - the client's upload request for `a.xml` has `mimeType` `application/xml`;
  - `ladder` of a document in `waiting_for_xbrl` is Done, Done, Next, Next, `stateLabel` is "Waiting for its XBRL file.", and `isLive` is true;
  - a `read` XBRL document whose latest job is a running `document.xbrl` has `ladder` Done, Done, Now, Next and `isLive` true;
  - `sourceOf([{ field: 'identifier', source: 'rule', pageIndex: null, quote: '500999', textLayerMatch: null, element: 'ScripCode', context: 'OneD' }], 'identifier')` is "ScripCode 500999";
  - `canReadAgain` is false for a `read` PDF whose `pipeline.numbers.state` is `not_needed`, and true for a `read` PDF whose state is `done` and for a document with no `pipeline`.
- [ ] **Step 2: Run to see them fail.** `cd apps/web && pnpm vitest run src/lib/documents`. Expected: FAIL.
- [ ] **Step 3: Implement**, and edit `DESIGN.md`.
- [ ] **Step 4: Run** `cd apps/web && pnpm verify`. Expected: PASS (guard, types, lint, tests).
- [ ] **Step 5: Commit**

```bash
git add apps/web docs/DESIGN.md
git commit -m "feat(web): the drop strip takes XBRL instances; the slip names waiting_for_xbrl, shows XBRL evidence by element, and offers no re-read of a PDF XBRL covers"
```

---

### Task 20: The map's evaluation run, and the documentation

**Files:**
- Create: `apps/eval/src/maester_eval/xbrl_map.py`; Modify: `apps/eval/src/maester_eval/cli.py`, `apps/eval/README.md`
- Create: `docs/eval/2026-10-<day>-xbrl-map-v1.md` (the report, written by the command, with its `--pdfs` section)
- Modify: `docs/systems/{extractor.md,worker.md,api.md,eval.md,packages.md,indexer.md,maester.md}`, `docs/DATA_MODEL.md`, `docs/EXTRACTION.md`, `packages/financial-engine/README.md`, `.env.example`, `docker-compose.yml` (worker and API `XBRL_PDF_CHECK`; extractor `XBRL_*` limits)
- Modify (spec §14 says its changes are "to be written into the document named"): `docs/superpowers/specs/2026-10-15-financial-data-layer-design.md` (§14), `docs/decisions/0006-concepts-calculations-agent-access.md` (status line)
- Test: `tests/test_eval_xbrl_map.py`

**Interfaces:**
- Produces: `maester-eval xbrl-map --instances <dir> [--manifest <xbrl-manifest.csv>] [--pdfs <folder the manifests' paths start from> --pdf-manifest <manifest.csv>] [--to docs/eval/<file>.md] [--against <report.json>]`. It runs offline and makes no model call. For every `.xml` it runs `parse_instance`, `classify_instance` and `read_instance` and writes `report.json` and `report.md` into `data/eval/runs/<timestamp>-xbrl-map/`. Element names, ids and counts only, never a value or a company name. The report shows:
  - the files read and unreadable, by reason;
  - the detected format against the file-name token: a matrix and the disagreeing files by name;
  - per mapped format: files, facts written, the share of numeric non-dimensional facts mapped, and the top 30 unmapped elements with file counts;
  - per sum id: passed, failed and not checked;
  - the balance identity likewise;
  - the rounding cross-check: files that pass, and files with `XBRL_ROUNDING_MISSING`;
  - nil facts, and facts left out for `XBRL_UNIT_UNSUPPORTED`;
  - the share of facts with a concept;
  - the 2025 and 2026 entry-point differences seen;
  - with `--against`, the change in each count.
- **The `xbrl_in_pdf` run** (`--pdfs`), so the check ships with its evaluation (Global Constraints), free and offline:
  - **Pairing.** Instances come from `--manifest` (`bse_code`, `basis`, `filed`, `file`). PDFs come from `--pdf-manifest` rows with `category` `Result`, `subcategory` `Financial Results` and `status` `ok` (`bse_code`, `date`, `file`). An instance is paired with the results PDF of the same `bse_code` announced the same day (`filed` = `date`); on 20 October 2026 that pairs 537 of the 807 instances. Each paired PDF is read with `PdfDocument.load` and classified by the rules alone, `classify_text(pdf.page_texts)` in `pdf_financial_qa.classify.rules`, no model, and its rule-read `period_end` confirms the pair. A pair whose PDF's period disagrees with the instance's is counted and left out (`period_disagrees`), and one whose PDF period the rules cannot read is kept and counted (`period_unread`). An instance with no PDF that day is `unpaired` `no_pdf`.
  - **Statement pages** are `RuleAnswers.statements[(statement, basis)]`, the rules' own pages. A pair the rules found no page for is `not_checked` `no_statement_pages`, as the live check would answer when the classification found none.
  - **The check** is `check_xbrl_in_pdf` with the request Task 13 builds: `scale` from the declared rounding, `places` from the instance's finest decimals.
  - **What it reports:** passed, failed and not checked (by reason) per statement, per basis and per unit (`₹ crore`, `₹ lakh`, `₹ million`, `₹ a share`); passes on the exact candidate and passes that needed the rounded one, counted apart with `check_candidates`; and the top 20 failing elements with file counts. This is the measure behind the open question on the PDF's printed unit: a failure share far above the rest in one unit is how a PDF printing another unit than the instance declares shows up.
- [ ] **Step 1: Write the failing test.** The command over a temporary folder of four synthetic instances (Ind AS in both families, a banking one and an unreadable one) writes a report with:
  - the expected counts: 3 read, 1 unreadable `DOCTYPE`, 2 mapped, 1 unmapped;
  - no value from any instance in either file;
  - with `--against` an earlier report, the deltas.

  A second case adds `--pdfs` over three synthetic results PDFs built with `tests/pdf_fixtures.py` and their manifest rows, each announced the same day as an instance of its BSE code:
  - one prints the in-capmkt instance's revenue in lakh with 2 places and its period, so the pair is made and the revenue is counted `passed` under `₹ lakh`;
  - one prints another period, so its pair is counted `period_disagrees` and left out;
  - one prints no period, so its pair is kept and counted `period_unread`.

  An instance whose code has no PDF that day is `unpaired` `no_pdf`. Neither file of the report contains a value.
- [ ] **Step 2: Run to see it fail, implement, run to see it pass.** `uv run --locked python -m unittest discover -s tests -p 'test_eval_xbrl_map.py' -v`.
- [ ] **Step 3: Run the evaluation** on the investor's files (local, free, read-only, no model): `uv run --locked maester-eval xbrl-map --instances ~/Personal/maester-filings/xbrl --manifest ~/Personal/maester-filings/xbrl-manifest.csv --pdfs ~/Personal/maester-filings --pdf-manifest ~/Personal/maester-filings/manifest.csv --to docs/eval/2026-10-<day>-xbrl-map-v1.md`. The manifests' `file` paths are relative to `~/Personal/maester-filings`. Expected:
  - 807 read and 0 unreadable;
  - 807 of 807 formats as their tokens say;
  - 807 of 807 rounding cross-checks pass, and 0 files with `XBRL_ROUNDING_MISSING` (research §4);
  - the `--pdfs` section's counts, whatever they are: they are the check's first measure.

  Write a short "What this run says" section at the top of the report: the sums that fail most, and whether each failure is the map's or the filer's, checked against the PDF for two of them; and for `xbrl_in_pdf`, the units and elements that fail most, and whether the rounded candidate earns its place. This is the baseline. Nothing is held out and nothing earlier exists to regress against; phase 5 scores the map against gold.
- [ ] **Step 4: Write the documentation** in STE:
  - `extractor.md`: `/v1/xbrl` and its modes, `/v1/xbrl/pdf-check`, the limits, the maps and how a map change is evaluated.
  - `worker.md`: `document.xbrl`, `document.xbrl_check`, the classify branch, `waiting_for_xbrl` and its release, the skip rule, the XBRL index branch, the codes of §15.
  - `api.md`: `pipeline`, `/filings`, `/companies/confirm`, the `CellSource` variants.
  - `eval.md`: `xbrl-elements`, `xbrl-map` and its `--pdfs` run.
  - `packages.md`: the source rule in `@maester/financial-engine`, with its §7.2-style row, and `@maester/import`.
  - `indexer.md`: `/v1/chunk-text`.
  - `maester.md`: upload XML and the import command, `pnpm --filter @maester/import run import <folder>`, with the cookie names `maester.session_token` (development) and `__Secure-maester.session_token` (production).

  Also update `DATA_MODEL.md` (migration 0008) and `EXTRACTION.md` (two readers: PDF and XBRL). And write the two amendments ingestion spec §14 names:
  - the data-layer spec's §14 drops "XBRL ingestion" from its out-of-scope list and adds one sentence: "XBRL ingestion, and OCR for search only, are in scope since 20 October 2026: see the [ingestion pipeline](2026-10-19-ingestion-pipeline-design.md) and [ADR 0007](../../decisions/0007-ingestion-pipeline.md).";
  - ADR 0006's status line gains "Amended by [ADR 0007](0007-ingestion-pipeline.md): for a filing with XBRL, the reader is XBRL alone."
- [ ] **Step 5: Check** with `uv run --locked python scripts/check_workspace.py` (expected: `Workspace OK`), `uv run --locked python -m unittest discover -s tests -v` (expected: PASS), `docker compose config --quiet` (expected: exit 0), `pnpm test` (turbo runs each workspace package's `test` script; expected: PASS) and `cd apps/web && pnpm verify` (`apps/web` is not a workspace member; expected: PASS).
- [ ] **Step 6: Commit**

```bash
git add apps/eval tests/test_eval_xbrl_map.py docs .env.example docker-compose.yml packages/financial-engine/README.md
git commit -m "feat(eval): maester-eval xbrl-map with the paired-PDF xbrl_in_pdf run, the first report over the 807 instances; docs and spec amendments for XBRL ingestion"
```

---

### Task 21: Live check, from the main checkout, with the investor

This task runs on the investor's machine from the main checkout after the branch is merged, never from a worktree, and only once the investor says go. Importing XBRL makes no paid call. **Three steps can make paid calls, and each is asked about first, with its count:**
- Step 2's confirm, when an identity also holds a PDF: confirming releases every `needs_company` document that prints it, PDFs included, and a released results or annual PDF the XBRL does not cover gets `document.extract`, a Gemini Pro read.
- Step 3's PDF, classified by Gemini Flash (one small call).
- Step 4's PDF, classified by Gemini Flash (one small call).

- [ ] **Step 1: Migrate and start** — `docker compose build api worker extractor indexer && docker compose up -d`. Expected: `migrate` applied `0008_xbrl`.
- [ ] **Step 2: Import the folder** — `MAESTER_SESSION_COOKIE=maester.session_token=… MAESTER_WORKSPACE=… pnpm --filter @maester/import run import ~/Personal/maester-filings/xbrl`. Expected: `Sent 807. Refused 0. Failed 0.` Then, in Postgres:
  - `select intake_state, count(*) from document where format = 'xbrl' group by 1` shows every instance settled (`read`, `needs_company` or `kept`) within minutes;
  - `select count(*) from extraction_revision where source = 'xbrl'` is the number of read instances;
  - the unmapped ones carry `XBRL_FORMAT_UNMAPPED`.

  Before confirming any held company, read `GET …/filings` and list each `held` identity with its files by `format` (`FilingFile.format`). Confirm through `POST …/companies/confirm`, without asking, only the identities whose held files are all XBRL. For an identity that also holds a PDF, tell the investor how many PDFs it would release and that each one the XBRL does not cover is a Gemini Pro read, and confirm it only on their yes. Then check that the confirmed instances read.
- [ ] **Step 3: The done-when test** (one Gemini Flash classification: ask first). Pick a corpus company whose Q2 results PDF is in `maester-filings/filings` and whose consolidated and standalone instances are imported. Upload the PDF. Expected:
  - its `pipeline.numbers` is `not_needed` with both XBRL ids in `coveredByXbrl`;
  - no `document.extract` job exists for it;
  - the `document.xbrl_check` jobs ran, and `GET …/filings` shows the filing with both bases' statements from XBRL and the `inPdf` counts.

  Record the counts in the PR.
- [ ] **Step 4: Dropped together** (one Gemini Flash classification: ask first). Upload a second company's results PDF and its instances in one drop. Expected: the PDF shows `waiting` with `waitingOn` while the instances read, then `not_needed`, and no `document.extract` job exists for it.
- [ ] **Step 5: Commit** nothing unless a limit or a setting changed; record the run in the PR description.

---

## Task order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21.

The dependencies are these:
- Task 1 (schema and enums) comes before every TypeScript task.
- Tasks 2 to 8 are the Python reader, in order, and need nothing from TypeScript but Task 6's Zod half.
- Task 9 needs nothing else and may run beside Tasks 2 to 8.
- Task 10 needs Task 1. It widens the final-failure hook and adds the `redecidePdfsAfterXbrl` stub that Tasks 11 and 12 build on.
- Task 11 needs Tasks 6, 7 and 10.
- Task 12 needs Tasks 9, 10 and 11.
- Task 13 needs Tasks 8 and 12.
- Task 14 needs Tasks 9 and 13.
- Task 15 needs Tasks 7 and 11.
- Task 16 needs Tasks 12 and 15.
- Task 17 needs Tasks 14 and 16.
- Task 18 needs Task 10.
- Task 19 needs Tasks 10, 12 (the new intake state and the `/extract` guard) and 16 (`pipeline`, for "Read it again").
- Task 20 needs Tasks 5 and 8, and documents everything.
- Task 21 comes last.

## Open questions for the investor

- **Q4 results XBRL for annual years** (spec §6.3, screen spec §11). This plan leaves it out, with no setting: a results instance's full-year facts never fill an annual column, and an annual report is never skipped or held for one. A "yes" changes all of these, and nothing else decides it:
  - `annualSlotOf` rule 1 in `@maester/financial-engine` (Task 9), which gives a `financial_results` filing no annual slot, its Python twin, and the fixture cases `q4-results-xbrl-does-not-fill-annual` and `half-year-results-balance-sheet-adds-no-column` (the second stays `null`: only a year's facts would qualify);
  - `counts()` in `apps/api/src/routes/research.ts`, which sends only annual reports to the `/financials` stitch, to admit `financial_results` XBRL revisions;
  - `planPdfNumbers` rule 1 and its fixture case `annual-report-never-waits-or-skips`, if the annual report's PDF may then wait for, or skip Gemini because of, a Q4 instance;
  - `slotKey`'s `filingKind`, if a Q4 instance's year facts are to compete in the annual slot rather than sit beside it.
- **The unit the PDF prints, for `xbrl_in_pdf`.** The check assumes the PDF prints in the unit the XBRL declares. Task 20's `--pdfs` run measures it on the corpus: it counts failures by unit, and a unit whose failure share stands far above the rest is the sign of PDFs printing another unit. If it shows that, the next step is to read the PDF's unit note with the existing `scale_for`. That is a reader change with its own evaluation run.

## After this plan

- **Phase 5 (measure the numbers)** needs, from this plan:
  - `extraction_revision.source` and the XBRL revisions;
  - `xbrl_source`, with each fact's `concept` as written under the map the revision was read with (Departure 18), not looked up from the current map;
  - `XbrlFact.concept` on the read result;
  - the source rule's Python twin `maester_eval.source_rule`;
  - the `xbrl-map` report as the map's baseline, and its `--pdfs` section as the check's;
  - the `xbrl_in_pdf` rows, read through `listXbrlPdfChecks` at the current `XBRL_PDF_CHECK_VERSION`.

  Phase 5 adds the source and format strata, `compare --xbrl` with the manifest's XBRL pairing, and scores the map against gold.
- **Phase 6 (the screen)** needs, from this plan:
  - `GET /v1/workspaces/:ws/filings`;
  - `DocumentPipeline` on every document;
  - `POST /v1/workspaces/:ws/companies/confirm`;
  - `CellSource`'s `xbrl` variant with `inPdf` and its reason codes;
  - the drop strip's XBRL acceptance.

  It builds `FilingList`, `Filing`, `Track`, `ConfirmCompanies` and the figure panel's XBRL words, and amends `DESIGN.md` §5 and §10. It also words "Numbers from" for an instant-only statement (`xbrlSpans` `[]`), which the screen spec leaves open. The interface sheet `.superpowers/plans-1-6/phase-4-interfaces.md` lists every name and shape both phases consume.
- **Every later migration (0009 and up, phases 5 and 6)** must not use `intake_state`'s `waiting_for_xbrl` or `check_type`'s `xbrl_in_pdf`. Drizzle's migrator runs every pending migration in one transaction, so on a fresh database 0008 and a later migration share it, and Postgres refuses a value in the transaction that added it: such a migration would pass on an upgraded database and fail on a fresh one.
