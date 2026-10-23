# Document extraction (F03 minimal + F05)

Status: implemented, 1 October 2026. Sections 2 to 4 (architecture, data model, workflow) were approved in conversation before implementation. Sections 5 to 7 and the changes under "Changes during implementation" were written while building. These parts still need review.

This document implements the minimal company record (F03) and versioned fact extraction with page provenance (F05) from the [feature roadmap](FEATURE_ROADMAP.md). It is the next step of Slice A in the [delivery plan](DELIVERY_PLAN.md). Architecture decision: [ADR 0004](decisions/0004-python-extraction-sidecar.md).

## 1. Outcome

An investor uploads a financial-statement PDF, optionally for a company they chose. Maester first works out what the document is. For an annual report or financial results with a known company, Maester then stores a new extraction revision with no further action. The revision holds each reported value as printed and its parsed decimal. It also holds the unit, the scale, the period, the basis, and the page of the original PDF that Maester read the value from. 

Arithmetic checks record what passed, what failed and what Maester could not check. A new extraction creates another revision and never overwrites an earlier one.

These items are out of scope here:

- The source reader and review and corrections (F06).
- The financial table UI (F07).
- Calculations (F08).
- The Analyst (F09).
- Shared reference companies, securities and tickers.
- Dimensions and restatement links.

## Changes during implementation

- The current revision is the newest by `created_at`. There is no `document.current_revision_id` pointer, because it makes a circular foreign key.
- A failed extraction writes no revision. Its code is on the job. Revision states are `complete` and `partial` only.
- `source_reference.printed_page_label` and `excerpt` were dropped until the source reader (F06) needs them.
- Added codes: `CORRECTION_FAILED` (warning), `MODEL_REQUEST_REJECTED`, `NO_STATEMENTS_EXTRACTED`, `DEADLINE_EXCEEDED`, `CANCELLED`.
- Job creation and dispatch moved to `@maester/jobs` so the worker can enqueue `document.extract`.
- Document intake (5 October 2026): verify now hands over to `document.classify`. It works out what the PDF is before the worker reads anything. See the [intake spec](superpowers/specs/2026-10-05-document-intake-classification-design.md). `EXTRACT_MAX_BYTES` defaults to 50 MiB.
- Second reader (20 October 2026): a results filing that comes with an XBRL instance is read from the instance, with no model. Section 8 describes this reader, and the [ingestion pipeline](superpowers/specs/2026-10-19-ingestion-pipeline-design.md) specifies it ([ADR 0007](decisions/0007-ingestion-pipeline.md)).
- Next (15 October 2026): the [financial data layer](superpowers/specs/2026-10-15-financial-data-layer-design.md) ([ADR 0006](decisions/0006-concepts-calculations-agent-access.md)) designs concepts, a second reader, more checks, a period model, calculations and agent access. It specifies everything after `extract-2`. This document describes the pipeline as it runs today.

## 2. Architecture

```text
upload (company optional) → document.verify ─stored─► document.classify ─decide─► document.extract
                                                     │
apps/worker (TypeScript)                             ▼
  lease job → read PDF from object store → POST /v1/extract ──► apps/extractor (Python: FastAPI + LangGraph)
  ◄── NDJSON stream: started, heartbeat, progress …, then exactly one result | error
  validate result (Zod) → one transaction: extraction_revision, financial_fact, source_reference, extraction_check
  complete job
```

- `apps/extractor` is a FastAPI service over the LangGraph workflow in `packages/financial-engine` (`pdf_financial_qa.workflow`). It holds no database or storage credentials: the PDF arrives as the request body and the result leaves in the response stream.
- The worker owns job state, leasing, retries and all writes. Drizzle remains the only schema authority.
- `document.verify` enqueues `document.classify` with the idempotency key `document.classify:<documentId>:auto`. Thus a repeated verify never enqueues twice. A copy of a file that the workspace stored before gets the state `duplicate` instead.
- The classification can say that the document is an annual report or financial results, and its company can be known. Then `document.classify` enqueues `document.extract` with the key `document.extract:<documentId>:classification-<classificationId>`. Thus Maester reads each set of answers once.
- `POST …/documents/:id/extract` enqueues a fresh job with a unique key and produces a new revision. `POST …/documents/:id/classify` runs identification again.
- Job creation and dispatch moved from `apps/api` to a shared `@maester/jobs` package. Thus the worker can enqueue the follow-up job. The behavior is the same.
- Service authentication: `EXTRACTOR_AUTH=secret` sends `x-extractor-secret` (local and Compose). `EXTRACTOR_AUTH=oidc` sends a Google ID token for the extractor URL (Cloud Run IAM, worker service account as invoker).
- Lease renewal: a timer (`JOB_HEARTBEAT_MS`) and every stream line that arrives renew the job lease. Thus an extraction longer than `LEASE_SECONDS` never gets a new lease in the middle of a run. The worker stops waiting for the extractor after `EXTRACT_TIMEOUT_SECONDS` (1800).
- Classification and extraction both need `EXTRACTOR_URL`. If it has no value, `document.classify` fails with `CLASSIFIER_NOT_CONFIGURED` and the document is `identify_failed`. Thus nothing is read until the extractor is deployed.
- The CLI keeps its single-call path as reference behavior.

## 3. Data model

New Drizzle tables (migration `0001`). Every table carries `workspace_id`. Every query filters on it.

| Table | Columns | Notes |
| --- | --- | --- |
| `company` | `id`, `workspace_id`, `display_name`, `country` (ISO 3166-1 alpha-2), `created_by_user_id`, timestamps | Unique on `(workspace_id, lower(display_name))`. Workspace-owned only for now. |
| `document` | new `company_id` (nullable FK) | Nullable for existing rows. The upload contract requires it. |
| `extraction_revision` | `id`, `workspace_id`, `document_id`, `job_id` (unique), `state` (`complete`, `partial`), `pipeline_version`, `model`, `prompt_version`, `page_count`, `company_name_as_printed`, `coverage` (jsonb), `warnings` (jsonb), `created_at` | Immutable. The current revision is the newest by `created_at`. There is no pointer column. A failed extraction writes no revision. The failure is on the job. |
| `financial_fact` | `id`, `workspace_id`, `revision_id`, `company_id`, `statement` (`balance_sheet`, `income_statement`, `cash_flow`), `basis` (`consolidated`, `standalone`, `unknown`), `section`, `line_order`, `reported_label`, `is_subtotal`, `component_labels` (text[]), `period_label`, `period_end`, `as_of_date`, `reported_text`, `reported_value` (numeric), `value_status` (`value`, `dash`, `unparsed`), `unit_label`, `scale_factor` (numeric), `currency`, `normalized_value` (numeric), `created_at` | Immutable. No floats. |
| `source_reference` | `id`, `workspace_id`, `fact_id`, `document_id`, `page_index` (0-based in the original PDF), `text_layer_match` (boolean, nullable) | Exactly one per fact in F05. |
| `extraction_check` | `id`, `workspace_id`, `revision_id`, `check_type` (`subtotal`, `balance_identity`), `statement`, `basis`, `section`, `period_label`, `subject_label`, `status` (`passed`, `failed`, `not_checked`), `expected`, `actual` (numeric), `detail` | A missing component gives `not_checked`, never a sum with a zero in its place. |

Value rules:

- A line that a period does not disclose has no fact row.
- `reported_text` is the cell exactly as printed. `(1,234.5)` parses to `-1234.5`. Indian grouping (`1,23,456`) and Western grouping both parse. A dash or "nil" is stored with `value_status = dash` and no value, because its meaning depends on the source convention.
- `scale_factor` comes from the unit label with fixed rules: `actuals` 1, `thousands` 10³, `lakhs` 10⁵, `millions` 10⁶, `crores` 10⁷ and `billions` 10⁹. An unknown label leaves `scale_factor` and `normalized_value` null and adds an `UNKNOWN_UNIT` warning.
- The extract prompt asks for earnings per share lines (basic and diluted) when a statement prints them. The extractor gives a whole statement one unit. A per-share line has a section or label that matches "earnings per share", "earnings per equity share" or "EPS", with the case ignored. Maester stores it at `scale_factor` 1, and its `normalized_value` is rupees a share. The API reads the `reported_value` of a per-share line, as printed, for the Research pages.
- `period_end` (income statement, cash flow) or `as_of_date` (balance sheet) has a value only when the label has one unambiguous date. The reader reads numbers day first, as Indian filings print them. These forms are read:
  - A month name: "31 March 2024", "31st Mar. 2024", "31-Mar-2024", "March 31, 2024".
  - A month name with a two-digit year, joined by hyphens: "31-Mar-24". The years 00 to 68 are 2000s, and 69 to 99 are 1900s.
  - All numbers, the same separator twice and a four-digit year: "31.03.2024", "31/03/2024", "31-03-2024".

  The date stays null in these cases:

  - "FY2024" or "2023-24".
  - An impossible date, such as "31.02.2024", or the month-first "03.31.2024".
  - Mixed separators, such as "31.03/2024".
  - A numeric date with a two-digit year, such as "31.03.24".
  - A year-first date, such as "2024-03-31".
  - A label that names two different dates, such as "01.04.2023 to 31.03.2024".

  The same date printed twice counts once. The reader reads numeric dates and "31-Mar-24" from `PIPELINE_VERSION` `extract-2`. Facts that Maester stored before keep their dates. A filing that Maester read before gets dates only when it is read again ("Read it again" on the Documents slip).
- `text_layer_match` records if the printed value is among the numbers of the text layer of that page, after the reader normalizes commas, spaces and signs. It is null when the page has no text layer (scanned).

## 4. Extraction workflow (LangGraph)

```text
prepare → locate → statement branch (one per located statement, in parallel) → assemble
statement branch:  extract → check ─┬─► done
                         ▲          │ failed check, attempts < 2
                         └ correct ◄┘
```

| Node | Kind | Behaviour |
| --- | --- | --- |
| prepare | deterministic | Open with pypdf, count pages, read each page's text layer. Encrypted or unreadable → `UNREADABLE_PDF` (permanent). |
| locate | model | Statements present (balance sheet, income statement, cash flow × consolidated/standalone), their pages, and the company name as printed. Pages are validated (in range, at most 6 per statement). PDFs over 15 MB or 60 pages are located in 30-page chunks. Nothing found → `NO_STATEMENTS_FOUND` (permanent). |
| extract | model | Sends a sub-PDF of only that statement's pages. Returns currency, unit label, periods and line items with values as printed text and the page of the sub-PDF each line was read from, mapped back to the original page index. |
| check | deterministic | Parse values to `Decimal`, then subtotal and balance-sheet identity checks (0.5% relative, 1.0 absolute in reported units). |
| correct | model | Re-extracts only a section with a failed check, given the expected and actual values. At most 2 attempts per statement. A corrected value that differs from the original must appear on its page's text layer (when the page has one), otherwise the correction is rejected, the original kept and a `CORRECTION_REJECTED` warning added. A correction call that still fails after retries keeps the original and adds `CORRECTION_FAILED`. |
| assemble | deterministic | State is `complete` when every located statement extracted, else `partial`. Warns `COMPANY_NAME_MISMATCH` when the printed name differs from the chosen company's. |

- Model: Claude through the Anthropic Python SDK (`ClaudeExtractionModel`). Each model call is one streamed request. The PDF goes first as a base64 `document` block, then the instruction. The answer is constrained to a JSON schema made from the Pydantic model, and Pydantic validates it. The model and its effort come from `EXTRACTOR_MODEL` and `EXTRACTOR_EFFORT`. The extract and correct calls mark the document for the prompt cache, so a correction on the same pages reads the cache. The SDK makes one attempt per call (`max_retries=0`); the workflow retries. Model calls sit behind an `ExtractionModel` interface so tests inject a scripted model.
- Transient model errors (429, 5xx including 529 overloaded, connection errors and timeouts, unparseable output) retry up to 3 times with backoff through LangGraph's node retry policy. A statement branch that still fails is recorded in coverage as `failed` and the revision is `partial`. If no statement succeeds, the request fails with a retryable error.
- Budget: at most 40 model calls and 15 minutes per request.
- Versions: `pipeline_version` is a constant, `prompt_version` is a hash of the prompt texts, `model` is the configured Claude model.
- LangSmith tracing stays disabled (it would send document content to a third party). No document text is logged.

## 5. Contracts and errors

The extractor wire format has two definitions. One is the Pydantic models in `pdf_financial_qa.workflow.contracts`. The other is the Zod schemas in `@maester/contracts` (`extraction.ts`). Golden fixtures in `packages/contracts/fixtures/extraction/` keep them the same. A Vitest test and a Python unittest validate these fixtures.

`POST /v1/extract` takes the PDF as an `application/pdf` body, with the document ID and the chosen company name (URI-encoded) in `x-document-id` and `x-company-name`. It answers `200` with `application/x-ndjson` immediately, then:

```text
{"type":"started","pipelineVersion":"…","model":"…","promptVersion":"…"}
{"type":"heartbeat"}                                 every 15 s while a model call runs
{"type":"progress","stage":"locate","percent":20}
{"type":"result","result":{…}}  or  {"type":"error","code":"NO_STATEMENTS_FOUND","retryable":false,"message":"…"}
```

Decimals travel as plain decimal strings (`DecimalString`, never exponent notation).

| Failure | Where | Job outcome |
| --- | --- | --- |
| `EXTRACTOR_NOT_CONFIGURED` (no `ANTHROPIC_API_KEY`, or Anthropic refused the key with 401 or 403) | extractor error event | permanent failure |
| `UNREADABLE_PDF`, `NO_STATEMENTS_FOUND`, `NO_STATEMENTS_EXTRACTED`, `MODEL_REQUEST_REJECTED` (Anthropic 4xx other than 401, 403 and 429), `MODEL_REFUSED` (the model declined the document), `MODEL_OUTPUT_TOO_LONG` (the answer did not fit its token limit), `MODEL_CALL_BUDGET_EXCEEDED`, `DEADLINE_EXCEEDED` | extractor error event | permanent failure |
| `TOO_LARGE_FOR_EXTRACTION` (over `EXTRACT_MAX_BYTES`, default 50 MiB) | worker before calling, or extractor `413` | permanent failure |
| `EXTRACTOR_UNAUTHORIZED` (`401`/`403`) | worker | permanent failure |
| `EXTRACTION_FAILED`, `MODEL_UNAVAILABLE`, `EXTRACTOR_UNAVAILABLE`, `EXTRACTOR_HTTP_5xx`, `EXTRACTOR_STREAM_INTERRUPTED` (stream ended without a terminal event), timeout | worker or extractor | retry with the job's attempt budget |
| Result fails Zod validation | worker | permanent failure, `INVALID_EXTRACTOR_RESULT` |

A permanent failure is a typed `JobFailure` (code, retryable). The job runner records its code instead of `HANDLER_ERROR` and does not retry. The worker enqueues `document.classify` and `document.extract` through `@maester/jobs`. In `cloud-tasks` mode it needs `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE` and `WORKER_INVOKER_SA`. It sets the dispatch deadline of the task from `TASK_DISPATCH_DEADLINE_SECONDS` (default 1800).

API additions (all under `/v1/workspaces/:ws`):

- `POST /companies`, `GET /companies` and `GET /companies/:id`. A duplicate name returns `409 CONFLICT`.
- `POST /documents/uploads` takes an optional `companyId`. An unknown company gives `400 VALIDATION_FAILED` on `companyId`. A company that the investor gives counts as the investor's company answer. `Document` gains `companyId` (nullable).
- `POST /documents/:id/extract` → `202` with the new job. The document must be `stored`.
- `GET /documents/:id/extraction` → the latest revision with its checks, or `404`.
- `GET /documents/:id/facts?revisionId=` → a revision's facts with their source references (latest revision by default).

The write is idempotent for each job. `extraction_revision.job_id` is unique. A retry that finds its revision returns it and writes nothing again.

## 6. Testing

- Python (unittest, offline, no model calls) tests these parts:
  - Number parsing, unit scales, period dates, text-layer matching and Decimal checks.
  - PDF page subsets, on a synthetic text-layer PDF that the test builds.
  - The whole graph, with a scripted `ExtractionModel`. This includes the self-correction loop, the rejected-correction guard, the attempt cap, partial results and permanent errors.
  - The stream of the extractor (heartbeat, terminal events, auth, size limit), through the test client of FastAPI.
- Contracts: golden fixtures validated by Zod and Pydantic.
- TypeScript tests these parts:
  - The company routes and the upload contract.
  - The extract handler, against a fake extractor HTTP server. The cases are success, partial results, permanent and retryable errors, an interrupted stream, an idempotent rewrite and lease renewal.
  - The chain from verify to classify and from classify to extract.
  - The routes that read facts and extractions, including isolation between workspaces.
- A live run against Claude is manual and never part of CI.

## 7. Local and deployed operation

- Docker Compose adds `extractor` (port 8790). Extraction needs `ANTHROPIC_API_KEY`. Without it, extract jobs fail with `EXTRACTOR_NOT_CONFIGURED` and uploads still work.
- Deployment is a follow-up and is not part of this change. Before you enable extraction in Cloud Run, do these steps:
  - Deploy `maester-extractor` with internal ingress and `--timeout` above 30 minutes.
  - Give the worker service account `run.invoker` on it.
  - Give the worker `cloudtasks.enqueuer` and `iam.serviceAccountUser` on the invoker service account. Then it can enqueue `document.extract`.
  - Give the extract task a `dispatchDeadline` above the extraction budget. The worker sets one from `TASK_DISPATCH_DEADLINE_SECONDS`. The dispatcher of the API sets none, so a manual `POST …/extract` task gets the default of Cloud Tasks.
  - Raise the `--timeout` of the worker in Cloud Run above `EXTRACT_TIMEOUT_SECONDS` (1800 seconds, 30 minutes). The `--timeout` of the extractor must be more than 30 minutes too.
  - Set `EXTRACTOR_URL`, `EXTRACTOR_AUTH=oidc`, `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE` and `WORKER_INVOKER_SA` on the worker.

  `EXTRACT_MAX_BYTES` defaults to 50 MiB, the same as `MAX_UPLOAD_BYTES`.

## 8. The XBRL reader

Maester has two readers of financial figures. The PDF reader is the workflow of section 4. The XBRL reader reads an XBRL instance (an XML file) and uses no model. For a filing that has XBRL, the XBRL reader is the only reader of its numbers. The PDF reader runs for a filing that has no XBRL.

```text
upload .xml → document.verify ─stored─► document.classify ─► document.xbrl ─► revision (source xbrl)
                                     │                                 │
              POST /v1/xbrl classify ┘             POST /v1/xbrl read ──┘
results PDF ─► source rule: wait for XBRL │ skip (XBRL covers it) │ read with document.extract
revision + results PDF ─► document.xbrl_check ─► POST /v1/xbrl/pdf-check ─► one xbrl_in_pdf row for each fact
```

- The extractor parses the instance with its own parser. The parser refuses a DOCTYPE and a file over `XBRL_MAX_BYTES` (20 MiB). It also refuses a file with more than `XBRL_MAX_FACTS` (100000) facts. It stops a parse that takes more than `XBRL_DEADLINE_SECONDS` (30).
- An element map is a reviewed file for each format. It says which element is which line of which statement. Two formats have a map: Ind AS in the `in-capmkt` family and Ind AS in the `in-bse-fin` family. Banking, NBFC and "other than Ind AS" are read and write no fact.
- A fact has its span (`quarter`, `half_year`, `nine_months`, `year` or `other`) from the dates of its context, its period start and its period end. The word that an instance writes for its period is never read.
- The unit comes from the rounding that the instance declares. The read writes the value in full rupees (`normalized_value`) and in the declared unit (`reported_value`). It pads the value to the finest `decimals` of the instance and never rounds it.
- A nil fact has the status `unparsed`. It is unknown, never zero.
- Each fact has one `xbrl_source` row: the element, the context, the `decimals`, the nil flag and the concept of the map. It has no `source_reference`, because an instance has no page.
- The read checks each sum of the map and the balance identity. The tolerance is n × ½ × 10^(−finest decimals), where n counts the total and the parts that are present.
- The check `xbrl_in_pdf` looks for each XBRL value on the statement pages of the results PDF of the same filing. It reads the text layer only and calls no model. The check compares absolute values.
- The source rule (`@maester/financial-engine`) decides each results PDF. It waits for an XBRL document that can still cover the PDF. It skips the PDF when settled XBRL covers each statement. In all other cases, it reads the PDF.
- Where two sources print the same slot, XBRL owns the slot. A results filing never fills an annual column.

A change to an element map, to the parser or to a sum changes `XBRL_MAP_VERSION` or `XBRL_PARSER_VERSION`. A change to the PDF check changes `XBRL_PDF_CHECK_VERSION`. Each change ships with a report of `maester-eval xbrl-map` in `docs/eval`.

Offline tests use synthetic instances and a fake extractor. The tests that read the real instances run only when `MAESTER_XBRL_DIR` is set. They read the files and write nothing.
