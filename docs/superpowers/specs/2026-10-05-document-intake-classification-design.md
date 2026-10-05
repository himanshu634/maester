# Document intake: working out what a PDF is

Status: approved 5 October 2026. While planning, `reads_under_id` and nullable investor quotes were added, and filling a matched company's missing identifiers was dropped. Backend for the Documents page picked as direction "B · The intake desk" on the [Maester Terminal Pages canvas](https://claude.ai/artifact/DZZwTXu6q7c68hfL8MSaJC). Builds on [document extraction](../../EXTRACTION.md) (F03 minimal, F05) and the private uploads and durable jobs of F04 in the [feature roadmap](../../FEATURE_ROADMAP.md). The Documents page itself is a separate plan that follows this one.

## 1. Outcome

An investor drops a PDF without choosing anything first. Maester works out what it is (an annual report, financial results, another company document, or "not sure"), which company published it and for what period, and records the page and the words each answer came from. When the answers allow it, Maester carries on and reads the statements without waiting. The investor can confirm or change any answer; a change that affects the figures reads the document again. Nothing is accepted on a confidence score: every answer carries a page and a quote, or it is "not sure" and waits for the investor.

### What the investor said

- Three kinds plus "not sure". Only annual reports and financial results are read for figures for now; everything else is kept with the company and its type named.
- Year-end audited results are "financial results, full year", not an annual report.
- Maester carries on reading without waiting for a yes (direction B), except when the company is new to the workspace or ambiguous: then it holds until the investor confirms the company.
- Classification runs as its own step before reading, with rules first and the model only for what the rules cannot settle.
- No demos: the Documents page is a working page on this backend.
- The services will not run on Cloud Run, so its request limits do not constrain this design.

### Document kinds (India first, SEBI LODR)

| Kind | `other_type` | What it is |
| --- | --- | --- |
| `annual_report` | — | Audited full-year standalone and consolidated statements with the board's, governance and BRSR reports (Reg 34). Read. |
| `financial_results` | — | Quarterly, half-year, nine-month or full-year results, including the integrated filing (financial) from the June 2025 quarter (Reg 33). Read. |
| `other` | `shareholding_pattern` | Reg 31, quarterly. Kept. |
| `other` | `shareholder_notice` | AGM, EGM or postal-ballot notice. Kept. |
| `other` | `board_meeting` | Intimation (Reg 29) or outcome (Reg 30) of a board meeting. Kept. |
| `other` | `investor_presentation` | Reg 30. Kept. |
| `other` | `earnings_call` | Earnings or conference call transcript. Kept. |
| `other` | `governance_filing` | Corporate governance report (Reg 27) or integrated filing (governance). Kept. |
| `other` | `announcement` | Press release or other Reg 30 announcement: record date, credit rating, acquisition. Kept. |
| `other` | `offer_document` | Prospectus, red herring prospectus, letter of offer. Kept. |
| `other` | `unlisted_type` | A company document that fits none of the above. Kept. |
| `not_sure` | — | Maester could not tell. Waits for the investor. |

Results usually carry a balance sheet and cash flow only half-yearly, so a quarter with only the income statement is a complete reading, not a partial one.

## 2. Architecture and flow

```text
upload (company optional) → document.verify ─stored─► duplicate? ─yes─► intake: duplicate
                                                          │ no
                                                          ▼
                                                 document.classify → decide
   annual_report / financial_results + company matched          → document.extract   (intake: reading)
   annual_report / financial_results + company new or ambiguous → hold                (intake: needs_company)
   other                                                        → done                (intake: kept)
   not_sure                                                     → hold                (intake: needs_kind)
investor confirms or changes answers → new classification (set_by investor) → decide again
```

- `packages/financial-engine` gains `pdf_financial_qa.classify`: `rules.py` (deterministic, versioned), `model.py` (a `ClassificationModel` protocol with a Gemini implementation and a scripted test double, the same pattern as `ExtractionModel`), `contracts.py` (Pydantic) and `runner.py` (rules, then the model for open answers, then checks).
- `apps/extractor` gains `POST /v1/classify`: same authentication as `/v1/extract`, the PDF as the `application/pdf` body, `x-document-id` for logs. It answers one JSON document (no stream; it takes seconds). `413` over `EXTRACT_MAX_BYTES`.
- `apps/worker` gains a `document.classify` handler and a `decide` function. `document.verify` now enqueues `document.classify` (idempotency key `document.classify:<documentId>:auto`) instead of `document.extract`; `decide` enqueues `document.extract` with the key `document.extract:<documentId>:<classificationId>`. The extract request sends the confirmed company's display name as `x-company-name`, as today.
- `apps/api`: `companyId` becomes optional on upload; new classification read, change and re-run endpoints (section 5); the document list and detail gain `intakeState` and a classification summary.
- Without `EXTRACTOR_URL` the worker cannot classify: the job fails with `CLASSIFIER_NOT_CONFIGURED` and the document is `identify_failed` until `POST …/classify` runs with the extractor configured. With the extractor but no model configured, classification runs on rules alone (section 4).
- `EXTRACT_MAX_BYTES` defaults to 50 MiB in the extractor and the worker, matching `MAX_UPLOAD_BYTES`, so every upload Maester accepts can be classified and read.

## 3. Data model

One migration. Every new table carries `workspace_id`, and every query filters on it.

`document_classification`: one immutable row per answer set; the newest by `created_at` is current.

| Column | Type / values |
| --- | --- |
| `id`, `workspace_id`, `document_id` | uuid |
| `kind` | `annual_report`, `financial_results`, `other`, `not_sure` |
| `other_type` | the `other_type` values above; set only when `kind = other` |
| `results_span` | `quarter`, `half_year`, `nine_months`, `full_year`; set only for `financial_results` |
| `period_end` | date; only from an unambiguous printed day–month-name–year date |
| `period_label` | text, as printed ("Quarter ended 30 June 2026") |
| `company_id` | uuid, nullable: the matched or confirmed company |
| `company_name_as_printed`, `cin`, `bse_code`, `nse_symbol` | text, nullable: what the document says |
| `statements_found` | jsonb: `[{ statement, basis, pages: number[] }]` |
| `set_by` | `maester`, `investor`; with `set_by_user_id` (investor) or `job_id` (Maester, unique) |
| `reads_under_id` | uuid, nullable, self-reference: the classification whose read gives this document its current figures. A classification that starts a read points at itself; one that changes only the period or results span copies its predecessor's; `other` and `not_sure` have none. |
| `rules_version`, `model`, `prompt_version` | text; `model` and `prompt_version` null when rules answered everything |
| `warnings` | jsonb `[{ code, message }]`, e.g. `MODEL_UNAVAILABLE` |
| `created_at` | timestamp |

`classification_evidence`: why each answer is what it is.

| Column | Type / values |
| --- | --- |
| `id`, `workspace_id`, `classification_id` | uuid |
| `field` | `kind`, `other_type`, `company`, `identifier`, `period`, `results_span`, `statements` |
| `source` | `rule`, `model`, `investor`; `rule_id` text for rules (e.g. `title.annual_report`) |
| `page_index` | integer, 0-based; null for investor answers |
| `quote` | text, at most 300 characters, as printed; null for investor answers |
| `text_layer_match` | boolean, nullable: does the quote appear in that page's text layer (null when the page has none) |

An investor change copies unchanged answers and their evidence rows into the new classification, so each classification is complete on its own.

`company` gains nullable `cin`, `bse_code`, `nse_symbol`, each unique within a workspace when not null. They are set when the investor creates a company from a document's answers.

`document` gains:

- `intake_state`: `identifying`, `duplicate`, `needs_company`, `needs_kind`, `kept`, `reading`, `read`, `identify_failed`, `read_failed`; null until `stored`. Written in the same transaction as the job transition or investor change it reflects.
- `duplicate_of_document_id`: uuid, nullable.
- `company_id` (exists) follows the current classification's `company_id`.

`extraction_revision` gains `classification_id` (set for new rows; existing rows stay null). A document's current figures are the newest revision whose `classification_id` is the current classification's `reads_under_id`. A document with no classification (uploaded before this change) keeps its newest revision as current.

## 4. Rules and model

Input: the text layer of every page, read once with the existing `PdfDocument`. A page with no text layer gives the rules nothing.

Rules (`rules_version`; every hit records `rule_id`, page and quote). Title rules look at the first five pages; identifier and statement rules at every page.

| Answer | Patterns |
| --- | --- |
| CIN | `[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}` |
| BSE code | "Scrip Code", "BSE" or "Security Code" followed by six digits |
| NSE symbol | "Symbol" or "NSE" followed by an upper-case symbol |
| Company name | a line ending in "Limited" or "Ltd" on the first page, or the name printed beside the CIN |
| `annual_report` | "Annual Report 20xx–yy", "Integrated Annual Report", "Annual Report and Accounts" |
| `financial_results` | "Statement of (audited\|unaudited) (standalone\|consolidated) financial results for the … ended", "Regulation 33", "Integrated Filing (Financial)" |
| `results_span` | "quarter ended", "half year ended", "nine months ended", "year ended"; "quarter and year ended 31 March" is `full_year` |
| `other_type` | "Shareholding Pattern" / "Regulation 31"; "Notice is hereby given" with general meeting or postal ballot; "Intimation of Board Meeting" / "Regulation 29"; "Outcome of Board Meeting"; "Investor Presentation"; "Transcript" with earnings or conference call; "Corporate Governance Report" / "Integrated Filing (Governance)" / "Regulation 27"; "Press Release"; "Prospectus", "Red Herring", "Letter of Offer" |
| Period | "(quarter\|half year\|nine months\|year) ended <date>", "as at <date>" |
| Statements | "Balance Sheet as at", "Statement of Profit and Loss", "Cash Flow Statement", each with "Standalone" or "Consolidated" |

Precedence:

1. A financial statement found in the document makes it `annual_report` or `financial_results` (a board-meeting outcome with results attached; an annual report with its AGM notice bound in).
2. Otherwise a title on the first pages beats a phrase deeper in.
3. Rules that point at different kinds are a conflict for the model, never a guess.

Model:

- Asked only for answers the rules left open or in conflict, with the allowed values for each.
- Given a sub-PDF of at most 10 pages: the first five plus the pages the rules pointed at.
- Returns, per answer: value, page (mapped back to the original index) and the quote it read.
- One call per document, retried once on a transient error, 60-second limit. Gemini on Vertex AI through the extractor's existing configuration.

Checks on model answers (in `runner.py`, deterministic):

- A value outside the allowed set is dropped.
- A page outside the document is dropped.
- A quote not found in that page's text layer (after normalising whitespace and case) is dropped; on a page without a text layer it is kept with `text_layer_match = null`.
- A company name the model gives must appear in a quote; the model cannot name a company the document does not print.
- A dropped answer becomes "not sure" for that field. `kind` left open is `not_sure`.

Company matching (worker, deterministic): CIN, then BSE code or NSE symbol, then the name with "Ltd"/"Limited", punctuation and case ignored. Exactly one match: matched. None, or more than one: `needs_company`.

## 5. API

All under `/v1/workspaces/:ws`.

- `POST /documents/uploads`: `companyId` optional. When given, it counts as the investor's company answer and skips matching.
- `GET /documents`, `GET /documents/:id`: add `intakeState`, `duplicateOfDocumentId` and a classification summary (kind, other type, results span, period label, company).
- `GET /documents/:id/classification`: the current classification with its evidence; `404` before one exists.
- `POST /documents/:id/classification`: body `{ basedOn, kind?, otherType?, resultsSpan?, periodEnd?, periodLabel?, company?: { id } | { new: { displayName, country, cin?, bseCode?, nseSymbol? } } }`. `basedOn` is the classification id the investor was looking at; if it is not current, `409 CONFLICT`. Stores a new classification (`set_by = investor`; changed answers get `source = investor` evidence; unchanged ones are copied) and runs `decide`:
  - kind becomes `annual_report` or `financial_results`, or the company is confirmed or changed, with a read kind: enqueue `document.extract` (new key per classification).
  - only `periodEnd`, `periodLabel` or `resultsSpan` changed: no read.
  - kind becomes `other`: `kept`; earlier figures are no longer current.
  - kind becomes `not_sure`: `400`; the investor cannot choose "not sure".
  - A new company is created in the same transaction; a name or identifier clash is `409 CONFLICT`.
- `POST /documents/:id/classify`: re-run classification (after `identify_failed`, to try again, or to classify a `duplicate` anyway, which is the page's "Read it again"); `202` with the job.
- A read already running when the investor changes an answer finishes, but its revision is under the old classification and is not current. There is no cancel.

## 6. Errors

| Case | Where | Outcome | `intake_state` |
| --- | --- | --- | --- |
| `UNREADABLE_PDF` | extractor | permanent | `identify_failed` |
| `CLASSIFIER_NOT_CONFIGURED` (no `EXTRACTOR_URL`) | worker | permanent until re-run | `identify_failed` |
| Extractor unavailable, `5xx`, timeout | worker | retry within the job's attempts, then permanent | `identify_failed` |
| `EXTRACTOR_UNAUTHORIZED` | worker | permanent | `identify_failed` |
| `TOO_LARGE_FOR_EXTRACTION` | worker or extractor `413` | permanent | `identify_failed` |
| `INVALID_CLASSIFIER_RESULT` (fails Zod) | worker | permanent | `identify_failed` |
| Model not configured, unavailable, rejected, timed out | extractor | not a failure; rules-only result with a `MODEL_UNAVAILABLE` warning | per `decide` |
| Scanned pages and no model | extractor | not a failure; `kind = not_sure` | `needs_kind` |
| Same `content_sha256` already stored in the workspace | worker, after verify | classification skipped | `duplicate` |
| Extraction fails | existing codes | as today | `read_failed` |

The classify wire format is defined twice, Pydantic and Zod (`@maester/contracts`, `classification.ts`), and kept in step by golden fixtures in `packages/contracts/fixtures/classification/` that both test suites validate. No document text is logged; quotes live only in the workspace's own rows.

## 7. Testing

- Python (unittest, offline): every rule on synthetic text layers, for each kind and other type, CIN, BSE and NSE extraction, period and span parsing, precedence and conflicts; the runner with a scripted `ClassificationModel`: only open answers asked, a mismatched quote dropped, a scanned page kept with `text_layer_match = null`, a model failure falling back to rules with a warning; `/v1/classify` authentication and size limit through FastAPI's test client.
- Contracts: golden fixtures validated by Zod and Pydantic.
- Worker (Vitest, against a fake extractor HTTP server): verify enqueues classify; classify outcomes (matched → extract enqueued with the classification id; new or ambiguous company → `needs_company`; other → `kept`; not sure → `needs_kind`); duplicates; retryable and permanent errors; idempotent re-delivery.
- API: upload without a company; classification read, change and re-run; `409` on a stale `basedOn`; the read-or-not rules; new-company creation and clashes; company matching with "Ltd"/"Limited" and ambiguity; cross-workspace isolation for every new endpoint.
- A live run on real public filings is manual and never part of CI. No real filing is committed to the repository.

## 8. Out of scope

The Documents page (its own plan, next); cancelling a running read; reading figures from `other` documents; a shared company or security directory; fetching filings from the exchanges; any change to the deploy target.
