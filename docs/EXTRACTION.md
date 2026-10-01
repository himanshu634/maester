# Document extraction (F03 minimal + F05)

Status: approved design, 1 October 2026. Implements the minimal company record (F03) and versioned fact extraction with page provenance (F05) from the [feature roadmap](FEATURE_ROADMAP.md), the next step of Slice A in the [delivery plan](DELIVERY_PLAN.md). Architecture decision: [ADR 0004](decisions/0004-python-extraction-sidecar.md).

## 1. Outcome

An investor uploads a financial-statement PDF for a company they chose. Without further action, Maester stores a new extraction revision: every reported value as printed, its parsed decimal, its unit and scale, its period and basis, and the page of the original PDF it was read from. Arithmetic checks record what passed, what failed and what could not be checked. Re-running extraction creates another revision and never overwrites an earlier one.

Out of scope here: the source reader and review/corrections (F06), the financial table UI (F07), calculations (F08), the Analyst (F09), shared reference companies, securities and tickers, dimensions and restatement links.

## 2. Architecture

```text
upload (companyId) → document.verify ──stored──► enqueue document.extract   (only when EXTRACTOR_URL is set)
                                                     │
apps/worker (TypeScript)                             ▼
  lease job → read PDF from object store → POST /v1/extract ──► apps/extractor (Python: FastAPI + LangGraph)
  ◄── NDJSON stream: started, heartbeat, progress …, then exactly one result | error
  validate result (Zod) → one transaction: extraction_revision, financial_fact, source_reference, extraction_check
  complete job
```

- `apps/extractor` is a FastAPI service over the LangGraph workflow in `packages/financial-engine` (`pdf_financial_qa.workflow`). It holds no database or storage credentials: the PDF arrives as the request body and the result leaves in the response stream.
- The worker owns job state, leasing, retries and all writes. Drizzle remains the only schema authority.
- `document.verify` enqueues `document.extract` with the idempotency key `document.extract:<documentId>:auto`, so a repeated verify never enqueues twice. `POST …/documents/:id/extract` enqueues a fresh job with a unique key and produces a new revision.
- Job creation and dispatch move from `apps/api` to a shared `@maester/jobs` package so the worker can enqueue the follow-up job. Behaviour is unchanged.
- Service authentication: `EXTRACTOR_AUTH=secret` sends `x-extractor-secret` (local and Compose); `EXTRACTOR_AUTH=oidc` sends a Google ID token for the extractor URL (Cloud Run IAM, worker service account as invoker).
- Lease renewal: every stream line received renews the job lease, so an extraction longer than `LEASE_SECONDS` is never re-leased mid-run.
- When `EXTRACTOR_URL` is unset the worker does not chain extraction. A deployed environment therefore keeps today's behaviour until the extractor is deployed.
- The CLI keeps its single-call path unchanged as reference behaviour.

## 3. Data model

New Drizzle tables (migration `0001`). Every table carries `workspace_id`; every query filters on it.

| Table | Columns | Notes |
| --- | --- | --- |
| `company` | `id`, `workspace_id`, `display_name`, `country` (ISO 3166-1 alpha-2), `created_by_user_id`, timestamps | Unique on `(workspace_id, lower(display_name))`. Workspace-owned only for now. |
| `document` | new `company_id` (nullable FK) | Nullable for existing rows; the upload contract requires it. |
| `extraction_revision` | `id`, `workspace_id`, `document_id`, `job_id` (unique), `state` (`complete`, `partial`), `pipeline_version`, `model`, `prompt_version`, `page_count`, `company_name_as_printed`, `coverage` (jsonb), `warnings` (jsonb), `created_at` | Immutable. The current revision is the newest by `created_at`; there is no pointer column. A failed extraction writes no revision; the failure lives on the job. |
| `financial_fact` | `id`, `workspace_id`, `revision_id`, `company_id`, `statement` (`balance_sheet`, `income_statement`, `cash_flow`), `basis` (`consolidated`, `standalone`, `unknown`), `section`, `line_order`, `reported_label`, `is_subtotal`, `component_labels` (text[]), `period_label`, `period_end`, `as_of_date`, `reported_text`, `reported_value` (numeric), `value_status` (`value`, `dash`, `unparsed`), `unit_label`, `scale_factor` (numeric), `currency`, `normalized_value` (numeric), `created_at` | Immutable. No floats. |
| `source_reference` | `id`, `workspace_id`, `fact_id`, `document_id`, `page_index` (0-based in the original PDF), `text_layer_match` (boolean, nullable) | Exactly one per fact in F05. |
| `extraction_check` | `id`, `workspace_id`, `revision_id`, `check_type` (`subtotal`, `balance_identity`), `statement`, `basis`, `section`, `period_label`, `subject_label`, `status` (`passed`, `failed`, `not_checked`), `expected`, `actual` (numeric), `detail` | A missing component yields `not_checked`, never a zero-filled sum. |

Value rules:

- A line not disclosed for a period has no fact row.
- `reported_text` is the cell exactly as printed. `(1,234.5)` parses to `-1234.5`; Indian grouping (`1,23,456`) and Western grouping both parse; a dash or "nil" is stored with `value_status = dash` and no value, because its meaning depends on the source convention.
- `scale_factor` is derived deterministically from the unit label (`actuals` 1, `thousands` 10³, `lakhs` 10⁵, `millions` 10⁶, `crores` 10⁷, `billions` 10⁹). An unknown label leaves `scale_factor` and `normalized_value` null and adds an `UNKNOWN_UNIT` warning.
- `period_end` (income statement, cash flow) or `as_of_date` (balance sheet) is set only when the label contains an unambiguous day–month-name–year date, such as "31 March 2024" or "March 31, 2024". "FY2024" and numeric dates stay null.
- `text_layer_match` records whether the printed value appears among the numbers of that page's text layer, after normalising commas, spaces and signs. It is null when the page has no text layer (scanned).

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

- Model: Gemini on Vertex AI through `langchain-google-genai` (`ChatGoogleGenerativeAI(vertexai=True)`) with `with_structured_output` and Pydantic schemas. Model calls sit behind an `ExtractionModel` interface so tests inject a scripted model.
- Transient model errors (429, 5xx, timeouts, unparseable output) retry up to 3 times with backoff through LangGraph's node retry policy. A statement branch that still fails is recorded in coverage as `failed` and the revision is `partial`. If no statement succeeds, the request fails with a retryable error.
- Budget: at most 40 model calls and 15 minutes per request.
- Versions: `pipeline_version` is a constant, `prompt_version` is a hash of the prompt texts, `model` is the configured Gemini model.
- LangSmith tracing stays disabled (it would send document content to a third party). No document text is logged.

## 5. Contracts and errors

The extractor wire format is defined twice, as Pydantic models (`pdf_financial_qa.workflow.contracts`) and as Zod schemas (`@maester/contracts`, `extraction.ts`), and kept in step by golden fixtures in `packages/contracts/fixtures/extraction/` that both a Vitest test and a Python unittest validate.

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
| `EXTRACTOR_NOT_CONFIGURED` (no Vertex project or credentials) | extractor error event | permanent failure |
| `UNREADABLE_PDF`, `NO_STATEMENTS_FOUND`, `NO_STATEMENTS_EXTRACTED`, `MODEL_REQUEST_REJECTED` (Vertex 4xx other than 429), `MODEL_CALL_BUDGET_EXCEEDED`, `DEADLINE_EXCEEDED` | extractor error event | permanent failure |
| `TOO_LARGE_FOR_EXTRACTION` (over `EXTRACT_MAX_BYTES`, default 30 MiB) | worker before calling, or extractor `413` | permanent failure |
| `EXTRACTOR_UNAUTHORIZED` (`401`/`403`) | worker | permanent failure |
| `EXTRACTION_FAILED`, `MODEL_UNAVAILABLE`, `EXTRACTOR_UNAVAILABLE`, `EXTRACTOR_HTTP_5xx`, `EXTRACTOR_STREAM_INTERRUPTED` (stream ended without a terminal event), timeout | worker or extractor | retry with the job's attempt budget |
| Result fails Zod validation | worker | permanent failure, `INVALID_EXTRACTOR_RESULT` |

Permanent failures are raised as a typed `JobFailure` (code, retryable) that the job runner honours: it records the code instead of `HANDLER_ERROR` and does not retry. The worker enqueues `document.extract` through `@maester/jobs`; in `cloud-tasks` mode it needs `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE` and `WORKER_INVOKER_SA`, and sets the task's dispatch deadline from `TASK_DISPATCH_DEADLINE_SECONDS` (default 1800).

API additions (all under `/v1/workspaces/:ws`):

- `POST /companies`, `GET /companies`, `GET /companies/:id`. A duplicate name returns `409 CONFLICT`.
- `POST /documents/uploads` now requires `companyId`; an unknown company is `400 VALIDATION_FAILED` on `companyId`. `Document` gains `companyId`.
- `POST /documents/:id/extract` → `202` with the new job. The document must be `stored`.
- `GET /documents/:id/extraction` → the latest revision with its checks, or `404`.
- `GET /documents/:id/facts?revisionId=` → a revision's facts with their source references (latest revision by default).

The write is idempotent per job: `extraction_revision.job_id` is unique, and a retry that finds its revision already committed returns it without writing again.

## 6. Testing

- Python (unittest, offline, no model calls): number parsing, unit scales, period dates, text-layer matching, Decimal checks, PDF page subsetting on a synthetic text-layer PDF built in the test, and the whole graph driven by a scripted `ExtractionModel` — including the self-correction loop, the rejected-correction guard, the attempt cap, partial results and permanent errors. The extractor's stream (heartbeat, terminal events, auth, size limit) is tested through FastAPI's test client.
- Contracts: golden fixtures validated by Zod and Pydantic.
- TypeScript: company routes and the upload contract; the extract handler against a fake extractor HTTP server (success, partial, permanent and retryable errors, interrupted stream, idempotent rewrite, lease renewal); chaining from verify; the facts and extraction read endpoints, including cross-workspace isolation.
- A live Vertex run is manual and never part of CI.

## 7. Local and deployed operation

- Docker Compose adds `extractor` (port 8790). Extraction needs `GOOGLE_CLOUD_PROJECT` and Application Default Credentials; without them extract jobs fail with `EXTRACTOR_NOT_CONFIGURED` and uploads still work.
- Deployment is a follow-up and is not part of this change. Before enabling extraction in Cloud Run: deploy `maester-extractor` with internal ingress and `--timeout` above 15 minutes; grant the worker service account `run.invoker` on it; grant the worker `cloudtasks.enqueuer` and `iam.serviceAccountUser` on the invoker service account so it can enqueue `document.extract`; give the extract task a `dispatchDeadline` above the extraction budget; set `EXTRACTOR_URL`, `EXTRACTOR_AUTH=oidc`, `GOOGLE_CLOUD_PROJECT`, `CLOUD_TASKS_QUEUE` and `WORKER_INVOKER_SA` on the worker. Cloud Run's 32 MiB HTTP/1 request limit is why `EXTRACT_MAX_BYTES` defaults to 30 MiB.
