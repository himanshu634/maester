# Shared packages: system description

## Terms

| Term | Meaning |
| --- | --- |
| App | A directory under `apps/` that runs as a program: [`api`](api.md), [`worker`](worker.md), [`extractor`](extractor.md), [`web`](web.md) or [`cli`](cli.md). |
| Package | A directory under `packages/` with code for apps to import. It has a `package.json` (TypeScript) or a `pyproject.toml` (Python). |
| Validator | A Zod object that `@maester/contracts` exports. It parses JSON and refuses JSON with a wrong shape. |
| Database schema | The Drizzle table definitions in `packages/db/src/schema`. |
| Migration | One SQL file in `packages/db/drizzle`. It changes the database to the next version of the database schema. |
| Workspace | One row in the `workspace` table. Most tables have a `workspace_id` column that points to one workspace. |
| Job | One row in the `job` table. A job is one unit of background work on one subject, for example one document. |
| Task | The HTTP request that a dispatcher sends to the worker for one job. The body is `{ "jobId": "<id>" }`. |
| Dispatcher | An object with the method `enqueue(job)`. It sends a task for the job. |
| Idempotency key | The `idempotency_key` text of a job. The database keeps one job for each idempotency key. |
| Object store | An object that keeps file bytes under an object key. It implements the `ObjectStore` interface. |
| Object key | The path of one file in an object store. |
| Signed URL | A URL with an expiry time and a signature. A browser uses it to send or get one file without a session. |
| Classification | One row in `document_classification`. It is one set of answers about what a document is. |
| Extraction | One run of `run_extraction` over one PDF. It gives facts, checks and coverage. |
| Revision | One row in `extraction_revision`. It is the record of one extraction. |
| Fact | One row in `financial_fact`. It is one value from a financial statement, as printed and as a decimal. |
| Check | An arithmetic comparison of the values of one statement: a subtotal check or the balance sheet check. |
| Intake state | The value of `document.intake_state`. It shows the next step for a stored document. |
| Model | A Gemini language model on Vertex AI. The Python engine calls it through LangChain or `google-genai`. |
| Rule | A regular expression in `classify/rules.py` that finds an answer in the text of a page. |
| Fixture | A sample JSON or NDJSON file in `packages/contracts/fixtures`. The TypeScript tests and the Python tests read the same fixtures. |
| Wire format | The JSON that one process sends to a different process, for example from `extractor` to `worker`. |
| Transient error | An error after which the same call can succeed later, for example a timeout or HTTP status 429. |

## Function

The shared packages hold the code that more than one app uses. Five TypeScript packages give the API contracts, the database, job dispatch, file storage and the lint settings. One Python package, the financial engine, classifies PDF filings and extracts their financial statements. The `api` and `worker` apps use the TypeScript packages. The `extractor` and `cli` apps use the Python package.

A sixth TypeScript package, `packages/financial-engine-ts`, is empty. For the full system, see [Maester](maester.md).

## Parts

| Part | Location | Function |
| --- | --- | --- |
| `@maester/config` | `packages/config` | Gives the shared TypeScript compiler settings and the ESLint rules. |
| `@maester/contracts` | `packages/contracts` | Gives the validators for each JSON body that goes between the apps. |
| `@maester/db` | `packages/db` | Gives the database schema, the migrations, a PostgreSQL client and the query functions. |
| `@maester/jobs` | `packages/jobs` | Creates jobs, sends tasks and calculates the next intake state of a document. |
| `@maester/storage` | `packages/storage` | Gives the `ObjectStore` interface and three object stores. |
| `maester-financial-engine` | `packages/financial-engine` | A Python library with the import name `pdf_financial_qa`. It classifies PDF filings and extracts facts from them. |
| `@maester/financial-engine` | `packages/financial-engine-ts` | An empty TypeScript package. It exports only `ENGINE_VERSION`, with the value `"0.0.0"`. |

The name of the package in `packages/financial-engine-ts` is `@maester/financial-engine`, without `-ts`.

### Which apps use each package

| Package | Used by | File that shows it |
| --- | --- | --- |
| `@maester/config` | `apps/api`, `apps/worker`, each TypeScript package, `scripts/` | The `tsconfig.json` and `eslint.config.js` of each |
| `@maester/contracts` | `apps/api`, `apps/worker`, `@maester/jobs` | `apps/api/src/serialize.ts`, `apps/worker/src/extractor.ts`, `packages/jobs/src/intake.ts` |
| `@maester/db` | `apps/api`, `apps/worker`, `@maester/jobs` | `apps/api/src/app.ts`, `apps/worker/src/run.ts`, `packages/jobs/src/create.ts` |
| `@maester/jobs` | `apps/api`, `apps/worker` | `apps/api/src/dispatch/index.ts`, `apps/worker/src/dispatch.ts` |
| `@maester/storage` | `apps/api`, `apps/worker` | `apps/api/src/store.ts`, `apps/worker/src/store.ts` |
| `maester-financial-engine` | `apps/extractor`, `apps/cli` | `apps/extractor/src/maester_extractor/app.py`, `apps/cli/src/maester_cli/cli.py` |
| `@maester/financial-engine` | No app | Only its own `package.json` has this name |

The `web` app does not import `@maester/contracts`. The file `apps/web/src/lib/documents/types.ts` keeps a copy of a subset of the validators as TypeScript types.

### `@maester/config`

| File | Content |
| --- | --- |
| `tsconfig.base.json` | Target `ES2022`, module `ESNext`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `noEmit`. |
| `eslint.config.js` | The recommended JavaScript and `typescript-eslint` rules, plus `consistent-type-imports` and `no-unused-vars`. An argument with a name that starts with `_` is not an error. The rules ignore `dist/`, `node_modules/` and `drizzle/`. |

### `@maester/contracts`

| Module | Main exports |
| --- | --- |
| `common.ts` | `ErrorCode`, `ApiError`, `IsoTimestamp`, `DecimalString`, `Uuid`, `ListQuery`, `paginated()` |
| `workspace.ts` | `Workspace`, `Membership`, `Me` |
| `job.ts` | `JobTypes`, `JobState`, `JobProgress`, `Job` |
| `company.ts` | `CountryCode`, `Company`, `CreateCompanyRequest` |
| `document.ts` | `DocumentState`, `RejectionCode`, `Document`, `CreateUploadRequest`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`, `ClassificationChanged` |
| `extraction.ts` | `ExtractorEvent`, `ExtractionResult`, `ExtractedFact`, `ExtractionRevision`, `FinancialFact`, `DocumentExtraction`, `DocumentFacts`, `ExtractResponse` |
| `classification.ts` | `ClassifyResponse`, `ClassificationResult`, `Classification`, `Evidence`, `IntakeState`, `ChangeClassificationRequest`, `Cin`, `BseCode`, `NseSymbol` |
| `payloads.ts` | `DocumentVerifyResult`, `DocumentClassifyResult`, `DocumentExtractResult`. Each is the `result` of one job type. |

Each validator has a TypeScript type with the same name. `JobTypes` gives the three job types: `document.verify`, `document.classify` and `document.extract`. The package has no OpenAPI document and no generated client. Its `README.md` is the guide to the HTTP routes of the API.

### `@maester/db`

| Export | Function |
| --- | --- |
| `createDb(url)`, `closeDb(db)`, `Db` | Make a Drizzle client over a `pg` pool with a maximum of 10 connections. Close the pool. |
| `schema` | All the table and enum definitions. |
| `WorkspaceRow`, `MembershipRow`, `CompanyRow`, `DocumentRow`, `JobRow` | The row types of the platform tables. |
| `ExtractionRevisionRow`, `FinancialFactRow`, `SourceReferenceRow`, `ExtractionCheckRow` | The row types of the extraction tables. |
| `ClassificationRow`, `EvidenceRow`, `WaitlistEntryRow` | The row types of the classification and waitlist tables. |
| `runMigrations(db, folder)`, `DEFAULT_MIGRATIONS_FOLDER` | Apply the migrations. The default folder is `packages/db/drizzle`. |
| `encodeCursor`, `decodeCursor` | Make and parse the cursor of a list page. The cursor is base64url JSON with the `createdAt` and `id` of the last row. |
| `listWorkspacesForUser`, `getWorkspaceForUser`, `ensurePersonalWorkspace` | Workspace queries. `ensurePersonalWorkspace` creates one workspace and one `owner` membership for a user, if the user has none. |
| `getDocument`, `listDocuments`, `getJob`, `getLatestJobForSubject`, `getCompany`, `listCompanies` | Document, job and company queries. The lists give the newest row first. |
| `getLatestRevision`, `getRevision`, `listChecks`, `listFactsWithSources` | Extraction queries. |
| `getCurrentClassification`, `listEvidence`, `getCurrentRevision` | Classification queries. |
| `normalizeCompanyName`, `matchCompanies`, `findStoredDuplicate` | Company match and duplicate search for document intake. |
| `admitOrWaitlist`, `approveWaitlistEmail`, `normalizeEmail` | Waitlist queries for sign-up. |

Each query for a workspace record takes the workspace ID and gives only rows of that workspace. The package has three scripts: `generate`, `migrate` and `waitlist:approve`.

### `@maester/jobs`

| Export | Function |
| --- | --- |
| `createJob(db, dispatcher, input)` | Inserts a job and sends its task. If a job with the same idempotency key exists in the workspace, it gives that job and sends no task. |
| `DEFAULT_MAX_ATTEMPTS` | The value 5. |
| `JobScopeConflictError` | The idempotency key belongs to a job in a different workspace. |
| `Dispatcher` | The interface with the method `enqueue(job)`. |
| `LocalHttpDispatcher` | Sends the task to the worker over plain HTTP, with a shared secret. For local development. |
| `CloudTasksDispatcher` | Sends the task to the worker through Google Cloud Tasks, with an OIDC token. |
| `RecordingDispatcher` | Keeps each job it gets in an array and sends nothing. For tests. |
| `decideIntake(db, dispatcher, classification, opts)` | Writes the next intake state and company of a document from a classification. |
| `READ_KINDS` | The kinds that Maester extracts: `annual_report` and `financial_results`. |
| `readVersion(id)`, `classificationIdOfReadJob(key)` | Make the version text `classification-<id>` for an extraction job, and get the ID back from an idempotency key. |

The package does not run jobs. The `worker` app runs them. See [worker](worker.md).

### `@maester/storage`

| Export | Function |
| --- | --- |
| `ObjectStore` | The interface: `signUpload`, `signDownload`, `exists`, `readStream` and `put`. |
| `ObjectNotFoundError` | `readStream` throws it when no file has the object key. |
| `GcsObjectStore(bucket)` | Keeps files in a bucket of Google Cloud Storage. It makes V4 signed URLs. |
| `DiskObjectStore(root, signing)` | Keeps files on the local file system. It makes signed URLs to the blob routes of the API. |
| `verifyBlobSignature(...)` | Examines a signature from `DiskObjectStore`. It gives `false` for a bad signature or an expired URL. |
| `MemoryObjectStore` | Keeps files in memory. Only the tests of the apps use it. |

The `api` and `worker` apps make a `DiskObjectStore` or a `GcsObjectStore` from the environment variable `STORAGE_DRIVER`. The API dev routes use `verifyBlobSignature`.

### `maester-financial-engine`

| Module | Main exports | Used by |
| --- | --- | --- |
| `pdf_financial_qa.classify` | `run_classification`, `ClassifySettings`, `ClassificationModel`, `ClassificationResult`, `RULES_VERSION` | `apps/extractor` |
| `pdf_financial_qa.workflow` | `run_extraction`, `WorkflowSettings`, `ExtractionModel`, `ExtractionResult`, `ExtractionError`, `PIPELINE_VERSION` | `apps/extractor` |
| `classify.contracts`, `workflow.contracts` | `CLASSIFY_RESPONSE`, `EXTRACTOR_EVENT` and the Pydantic classes of the wire format | `apps/extractor` |
| `classify.model`, `workflow.model` | `GeminiClassificationModel`, `GeminiExtractionModel` | `apps/extractor` |
| `config`, `extraction`, `qa`, `storage` | `Settings`, `extract`, `ask`, `hash_pdf`, `load`, `save`, `list_cached` | `apps/cli` |

The Pydantic classes in `classify.contracts` and `workflow.contracts` are a copy of the TypeScript validators in `@maester/contracts`. The same fixtures test the two copies. The package needs Python 3.11 or later.

## Operation

### Job creation and dispatch

1. The caller gives `createJob` the workspace ID, the job type, the subject type, the subject ID and an optional version.
2. `createJob` makes the idempotency key `<type>:<subjectId>:<version>`. The default version is `1`.
3. `createJob` inserts a job with the state `queued` and `maxAttempts` 5. If a job with the same idempotency key exists, the insert adds no row.
4. If the insert adds a row, `createJob` gives the new job to the dispatcher and returns the job.
5. If the insert adds no row, `createJob` returns the job with that idempotency key in the same workspace. It sends no task.
6. `LocalHttpDispatcher` sends `POST <workerUrl>/tasks/<type>` with the header `x-dispatch-secret`. It does not wait for the response.
7. `CloudTasksDispatcher` gives the task to Google Cloud Tasks, with the name `<jobId>-<attempt>`. Cloud Tasks sends the same `POST` with an OIDC token for the invoker service account.

### Intake decision

`decideIntake` writes the next step for a document after a classification. It does these steps:

1. It calculates the next intake state from the classification:
   - The kind `not_sure` gives `needs_kind`.
   - The kind `other` gives `kept`.
   - A classification with no company gives `needs_company`.
   - Other classifications give `reading` if `opts.read` is true. Else the intake state stays the same.
2. It starts a transaction and locks the `document` row with `SELECT … FOR UPDATE`.
3. It stops with no change if the classification is not the current classification of the document.
4. It stops with no change if `opts.onlyFrom` does not contain the intake state of the document.
5. It writes the company ID and the new intake state to the `document` row.
6. For `reading`, it creates a `document.extract` job with the version `classification-<classificationId>`. It sends no task in the transaction.
7. After the transaction commits, it sends the task of the new job.

Because the version contains the classification ID, each classification gives a maximum of one extraction job.

### Migrations

1. A developer changes the database schema in `packages/db/src/schema`.
2. `drizzle-kit generate` writes a new SQL file and a snapshot to `packages/db/drizzle`. It also adds the file to `drizzle/meta/_journal.json`.
3. `runMigrations` gives the folder to the Drizzle migrator. The migrator applies, in journal order, each migration that the database does not have.
4. A second run of `runMigrations` on the same database changes nothing. The test `migrate.test.ts` examines this.

Four entry points call `runMigrations`:

- `pnpm --filter @maester/db migrate` runs `packages/db/src/migrate-cli.ts`.
- The API image runs `node dist/migrate.js`, from `apps/api/src/migrate.ts`. The image copies `packages/db/drizzle` to `/app/drizzle` and sets `MIGRATIONS_FOLDER` to that folder.
- The `migrate` service in `docker-compose.yml` runs the API image before the `api` and `worker` services start.
- `infra/deploy.sh` runs the same image as the Cloud Run job `maester-migrate`.

The migrations are:

| Migration | Change |
| --- | --- |
| `0000_abnormal_veda.sql` | Creates `user`, `session`, `account`, `verification`, `workspace`, `membership`, `document` and `job`. |
| `0001_company_and_extraction.sql` | Creates `company`, `extraction_revision`, `financial_fact`, `source_reference` and `extraction_check`. |
| `0002_sign_in.sql` | Creates `rate_limit` and `waitlist_entry`. |
| `0003_document_intake.sql` | Creates `document_classification` and `classification_evidence`. Adds the identifier columns to `company`, the intake columns to `document` and `classification_id` to `extraction_revision`. |

### Object storage

1. The API asks the object store for a signed URL with `signUpload`. The response contains the URL, the headers `Content-Type` and `Content-Length`, and the expiry time.
2. The browser sends the file to the signed URL.
3. The worker gets the file with `readStream`.
4. `GcsObjectStore` makes V4 signed URLs of Google Cloud Storage.
5. `DiskObjectStore` keeps the bytes in `<root>/objects/<key>` and the content type in `<root>/meta/<key>.json`.
6. `DiskObjectStore` makes the URL `<baseUrl>/dev/blobs/<key>?expires=<time>&signature=<signature>`. The signature is an HMAC-SHA256 of `<method>:<key>:<expires>` with the secret.
7. The API blob routes call `verifyBlobSignature` before they accept a request to a disk URL.

### Classification of a PDF

`run_classification` finds what a PDF is: its kind, company, identifiers, period and statements. It does these steps:

1. It loads the PDF with `pypdf` and gets the text of each page.
2. It applies the rules of `classify_text` to the page text. The rules version is `classify-rules-2`.
3. It makes a list of questions for each answer that the rules did not find.
4. If there are questions and no model, it adds the warning `MODEL_UNAVAILABLE` and leaves those answers empty.
5. If there are questions and a model, it sends the model the first 5 pages and the pages that the rules point to. The maximum is 10 pages.
6. After a transient error, it tries the model call one more time, 1 second later.
7. It keeps a model answer only if the quote is on the given page and the value is in the list of permitted values. A page with no text layer accepts the quote.
8. If it does not keep one or more model answers, it adds the warning `MODEL_ANSWER_DROPPED`.
9. It returns a `ClassificationResult`. If no rule or model answer gives a kind, the kind is `not_sure`.

A model failure never stops classification. The result has a warning instead.

### Extraction of a PDF

`run_extraction` is a LangGraph graph with the nodes `prepare`, `locate`, `statement` and `assemble`. It does these steps:

1. `prepare` loads the PDF. The progress is 5 percent.
2. `locate` asks the model which pages hold each statement. A PDF of more than 15 MB or more than 60 pages goes to the model in parts of 30 pages. The progress is 20 percent.
3. If the model finds no statement, the run stops with `NO_STATEMENTS_FOUND`.
4. A statement on more than 6 pages gets a `failed` coverage entry. The workflow does not extract it.
5. `statement` runs one branch for each other statement, in parallel. The progress goes from 20 to 90 percent.
6. Each branch extracts the statement from its pages and then runs the checks.
7. A check passes if the difference is not more than 1.0, or not more than 0.5 percent of the larger value.
8. If a check fails, the branch asks the model to correct the sections of that check. The maximum is 2 corrections.
9. The branch refuses a correction that adds a value that is not on its page. It adds the warning `CORRECTION_REJECTED`.
10. `assemble` makes the facts, the checks and the coverage. The state is `complete` if all statements give facts, else `partial`.

The run has a budget. It stops if it needs more than 40 model calls or more than 840 seconds. Each model call has a maximum of 3 attempts. The workflow tries a call again only after a transient error.

The progress callback gets the stage name and the percent. The `extractor` app sends these to the worker. See [extractor](extractor.md).

### First extraction path

The modules `config`, `extraction`, `qa`, `storage`, `schema` and `validation` are the first extraction path. `extract` sends one PDF of a maximum of 15 MB to the model in one call. `ask` answers one question about one extraction. `save` writes the result to `data/cache/<hash>.json`. Only the `cli` app uses this path. See [CLI](cli.md).

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| `JobScopeConflictError` | The idempotency key belongs to a job in a different workspace. | `createJob` throws the error. |
| The job exists | `createJob` gets an idempotency key that a job in the same workspace has. | `createJob` returns that job and sends no task. |
| `local dispatch failed` | The `POST` from `LocalHttpDispatcher` fails. | The dispatcher writes the error to the log. `enqueue` does not throw. |
| `task already exists` | Cloud Tasks gives gRPC code 6 for the task name `<jobId>-<attempt>`. | `CloudTasksDispatcher` writes a log line and returns. |
| Other Cloud Tasks error | `createTask` fails for a different cause. | `enqueue` throws the error. |
| `decideIntake` returns `null` | The document is not there, the classification is not current, or `onlyFrom` does not contain the intake state. | The document does not change. |
| `decideIntake` returns `null` after a write | The classification has a company and a kind that Maester extracts, but `opts.read` is false. | `decideIntake` writes only the company ID. The intake state stays the same. |
| `ObjectNotFoundError` | `readStream` gets an object key with no file. | The caller gets the error. |
| `invalid object key` | A `DiskObjectStore` key points outside the root folder. | The store throws an `Error`. |
| No `DiskSigningOptions` | `DiskObjectStore` gets a request for a signed URL, but it has no `DiskSigningOptions`. | The store throws an `Error`. |
| `decodeCursor` returns `null` | The cursor is not base64url JSON with a date and an ID. | The caller decides what to do. |
| Unique index error | A second company in one workspace has the same name, CIN, BSE code or NSE symbol. PostgreSQL compares the names without case. | PostgreSQL refuses the insert. |
| `DATABASE_URL is required` | `migrate-cli.ts` or `waitlist-cli.ts` starts with no `DATABASE_URL`. | The script stops. |
| `UNREADABLE_PDF` | The PDF has encryption, `pypdf` cannot parse it, or it has no pages. | `ExtractionError`, not retryable. |
| `NO_STATEMENTS_FOUND` | `locate` finds no statement. | `ExtractionError`, not retryable. |
| `NO_STATEMENTS_EXTRACTED` | No branch gives a statement, and no branch error is transient. | `ExtractionError`, not retryable. |
| `EXTRACTION_FAILED` | No branch gives a statement and a branch error is transient, or an unexpected error occurs. | `ExtractionError`, retryable. |
| `MODEL_UNAVAILABLE` | A model call fails with a transient error after its retries. | `ExtractionError`, retryable. In classification, a warning only. |
| `MODEL_REQUEST_REJECTED` | The model API refuses the request with a client error. | `ExtractionError`, not retryable. |
| `EXTRACTOR_NOT_CONFIGURED` | No Google Cloud credentials are available. | `ExtractionError`, not retryable. |
| `MODEL_CALL_BUDGET_EXCEEDED` | The run needs more than 40 model calls. | `ExtractionError`, not retryable. |
| `DEADLINE_EXCEEDED` | The run takes more than 840 seconds. | `ExtractionError`, not retryable. |
| `CANCELLED` | The caller sets the `cancel` event. | `ExtractionError`, retryable. |
| `LOCATE_PAGE_OUT_OF_RANGE` | The model gives a page number outside the PDF. | A warning. The workflow ignores that page. |
| `CORRECTION_FAILED` | A correction call fails. | A warning. The section keeps its values. |
| `CORRECTION_REJECTED` | A corrected value is not in the text layer of its page. | A warning. The section keeps its values. |
| `UNKNOWN_UNIT` | The unit text of a statement gives no scale. | A warning. The facts have no normalized value. |
| `COMPANY_NAME_MISMATCH` | The printed company name and the given company name are different. | A warning. |
| `MODEL_ANSWER_DROPPED` | A model answer has no quote on its page, or its value is not in the list of permitted values. | A warning. The answer stays empty. |

## Data

### Tables

| Table | Migration | Content |
| --- | --- | --- |
| `user` | 0000 | One person who can sign in: name, email, `email_verified` and image. Better Auth writes it. |
| `session` | 0000 | One sign-in session: token, expiry, IP address and user agent. The database deletes it when it deletes the user. |
| `account` | 0000 | One sign-in method of a user: provider, provider tokens and `password`. The database deletes it when it deletes the user. |
| `verification` | 0000 | One Better Auth value with an expiry: `identifier`, `value` and `expires_at`. |
| `workspace` | 0000 | One workspace: name, owner and locale. The default locale is `en-IN`. |
| `membership` | 0000 | One user in one workspace, with a role (`owner`) and a state (`active` or `revoked`). One row for each workspace and user. |
| `document` | 0000, 0003 | One file: original name, declared size and MIME type, object key, SHA-256, size, state, rejection code, intake state and `duplicate_of_document_id`. |
| `job` | 0000 | One job: type, subject, idempotency key, state, `attempt`, `max_attempts`, lease, progress, result and last error. |
| `company` | 0001, 0003 | One company of a workspace: `display_name`, country, CIN, BSE code and NSE symbol. |
| `extraction_revision` | 0001, 0003 | One extraction: document, job, classification, state, versions, page count, printed company name, coverage and warnings. |
| `financial_fact` | 0001 | One fact: statement, basis, section, line order, label, period, printed text, decimal, value status, unit, scale, currency and normalized value. |
| `source_reference` | 0001 | The page of one fact: document, page index from 0 and text layer match. One row for each fact. |
| `extraction_check` | 0001 | One check of a revision: type, statement, basis, subject, status, expected value and actual value. |
| `rate_limit` | 0002 | The Better Auth rate limiter: key, count and time of the last request. |
| `waitlist_entry` | 0002 | One email that asked for an account: status (`pending` or `approved`), source (`google`, `email` or `admin`), request time and approval time. |
| `document_classification` | 0003 | One classification: kind, other type, results span, period, company, printed identifiers, statements found, `set_by`, job, `reads_under_id`, versions and warnings. |
| `classification_evidence` | 0003 | The source of one answer: field, source (`rule`, `model` or `investor`), rule ID, page index, quote and text layer match. |

Rows in `document_classification`, `extraction_revision` and `financial_fact` do not change after the insert. A new answer or a new extraction adds new rows. The schema comments in `classification.ts` and `extraction.ts` say this.

The current classification of a document is its newest `document_classification` row. `getCurrentRevision` gives the newest revision with the `classification_id` of the `reads_under_id` of that classification. If the document has no classification, it gives the newest revision. If `reads_under_id` is empty, it gives `null`.

### Environment variables

| Variable | Read by | Function |
| --- | --- | --- |
| `DATABASE_URL` | `migrate-cli.ts`, `waitlist-cli.ts`, `drizzle.config.ts` | The address of the database. If it is empty, `drizzle.config.ts` uses `postgres://maester:maester@localhost:5433/maester`. |
| `MIGRATIONS_FOLDER` | `migrate-cli.ts`, `apps/api/src/migrate.ts` | The folder of the migrations. The API image gives it the value `/app/drizzle`. |
| `DATABASE_URL_TEST_DB` | `packages/db/test/helpers.ts` | The test database. The default is `postgres://maester:maester@localhost:5433/maester_test_db`. |
| `GOOGLE_CLOUD_PROJECT` | `pdf_financial_qa/config.py` | The Google Cloud project of the first extraction path. It is necessary. |
| `GOOGLE_CLOUD_LOCATION` | `pdf_financial_qa/config.py` | The Vertex AI location. The default is `us-central1`. |
| `GEMINI_MODEL` | `pdf_financial_qa/config.py` | The model name. The default is `gemini-2.5-pro`. |

### Files

- `DiskObjectStore` writes to `<root>/objects/` and `<root>/meta/`.
- The first extraction path writes to `data/cache/`, relative to the current directory. The file name is the first 16 hexadecimal characters of the SHA-256 of the PDF.

## Procedures

### To install the dependencies

1. Go to the root of the repository.
2. Install the TypeScript dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Install the Python dependencies:

   ```bash
   uv sync --locked
   ```

### To test `@maester/contracts`, `@maester/jobs` and `@maester/storage`

These tests need no database and no Google Cloud account.

1. Run the tests of `@maester/contracts`:

   ```bash
   pnpm --filter @maester/contracts test
   ```

2. Run the tests of `@maester/jobs`:

   ```bash
   pnpm --filter @maester/jobs test
   ```

3. Run the tests of `@maester/storage`:

   ```bash
   pnpm --filter @maester/storage test
   ```

The tests of `@maester/contracts` parse the fixtures and each JSON example in its `README.md`.

### To test `@maester/db`

The tests need PostgreSQL on port 5433 with the database `maester_test_db`. Step 2 can delete local data. Read the cautions before you start.

1. Start PostgreSQL in Docker:

   ```bash
   pnpm db:up
   ```

2. If the database `maester_test_db` is not there, delete the Docker volumes with `pnpm stack:reset`.
3. If you did step 2, start PostgreSQL again with `pnpm db:up`.
4. If your test database has a different address, set `DATABASE_URL_TEST_DB` to that address.
5. Run the tests:

   ```bash
   pnpm --filter @maester/db test
   ```

`scripts/db/init.sql` creates `maester_test_db` when Docker makes a new volume for PostgreSQL.

### To test the financial engine

The Python tests are in the root `tests/` folder, not in the package. They use a scripted substitute for the model and make no model calls.

1. Go to the root of the repository.
2. Run the Python tests:

   ```bash
   uv run --locked python -m unittest discover -s tests -v
   ```

This command also runs the tests of `apps/extractor` and `apps/cli`. The engine tests are `test_classification_*.py` and `test_extraction_*.py`.

### To lint and type-check `@maester/config` and `@maester/financial-engine`

These two packages have no tests.

1. Run the linter from the root:

   ```bash
   pnpm lint
   ```

2. Run the type checker from the root:

   ```bash
   pnpm typecheck
   ```

### To run all TypeScript tests

1. Start PostgreSQL with `pnpm db:up`.
2. Set the variables for the three test databases:

   ```bash
   export DATABASE_URL_TEST_DB=postgres://maester:maester@localhost:5433/maester_test_db
   export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:5433/maester_test_api
   export DATABASE_URL_TEST_WORKER=postgres://maester:maester@localhost:5433/maester_test_worker
   ```

3. Run the tests with Turborepo:

   ```bash
   pnpm test
   ```

### To make a migration

1. Change the table definitions in `packages/db/src/schema`.
2. Write the new migration:

   ```bash
   pnpm --filter @maester/db generate
   ```

3. Add the new SQL file, the new snapshot and `drizzle/meta/_journal.json` to your commit.

### To apply the migrations

1. Because the `migrate` script does not read `.env`, set `DATABASE_URL` in your shell.
2. Apply the migrations:

   ```bash
   pnpm --filter @maester/db migrate
   ```

3. Make sure that the script writes `migrations applied`.

### To approve an email for sign-up

1. Make sure that `.env` at the root or your shell gives `DATABASE_URL`.
2. Approve the email:

   ```bash
   pnpm --filter @maester/db waitlist:approve you@example.com
   ```

## Warnings and cautions

WARNING: Keep the rows of the `account` table private. The table holds provider tokens and the `password` column. If these values go outside the database, a person can sign in as an investor.

The form in which Better Auth keeps the password: Not known. The code in this repository does not show it.

CAUTION: Set `DATABASE_URL_TEST_DB` only to a test database. Each test file of `@maester/db` calls `testDb()`, which empties the tables with `TRUNCATE … CASCADE`.

CAUTION: Run `pnpm stack:reset` only if you can lose the local data. The command deletes the Docker volumes, with the local database and the local files.

CAUTION: Do not change a migration that a database already applied. Add a new migration. `docs/DEVELOPMENT.md` gives this rule.

## Limits

- `@maester/financial-engine` in `packages/financial-engine-ts` is empty. Its README says that extraction stays in Python.
- `@maester/jobs` creates jobs and sends tasks only. It does not run jobs, lease them or retry them.
- `DiskObjectStore` is for local development and tests. `apps/api/src/env.ts` refuses `STORAGE_DRIVER=disk` when `NODE_ENV` is `production`.
- `MembershipRole` has one value only: `owner`.
- The classification model gets a maximum of 10 pages.
- The extraction workflow does not extract a statement on more than 6 pages.
- The first extraction path refuses a PDF of more than 15 MB.
- No foreign key deletes rows in other tables, except the keys from `session` and `account` to `user`.
- The database has no tables for portfolios, holdings, transactions, prices or notes. `docs/DATA_MODEL.md` describes them as the target design.

## Sources

- [`packages/config/tsconfig.base.json`](../../packages/config/tsconfig.base.json)
- [`packages/config/eslint.config.js`](../../packages/config/eslint.config.js)
- [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts)
- [`packages/contracts/src/job.ts`](../../packages/contracts/src/job.ts)
- [`packages/contracts/src/payloads.ts`](../../packages/contracts/src/payloads.ts)
- [`packages/contracts/README.md`](../../packages/contracts/README.md)
- [`packages/db/package.json`](../../packages/db/package.json)
- [`packages/db/drizzle.config.ts`](../../packages/db/drizzle.config.ts)
- [`packages/db/src/index.ts`](../../packages/db/src/index.ts)
- [`packages/db/src/client.ts`](../../packages/db/src/client.ts)
- [`packages/db/src/migrate.ts`](../../packages/db/src/migrate.ts)
- [`packages/db/src/migrate-cli.ts`](../../packages/db/src/migrate-cli.ts)
- [`packages/db/src/waitlist-cli.ts`](../../packages/db/src/waitlist-cli.ts)
- [`packages/db/src/pagination.ts`](../../packages/db/src/pagination.ts)
- [`packages/db/src/schema/auth.ts`](../../packages/db/src/schema/auth.ts)
- [`packages/db/src/schema/platform.ts`](../../packages/db/src/schema/platform.ts)
- [`packages/db/src/schema/extraction.ts`](../../packages/db/src/schema/extraction.ts)
- [`packages/db/src/schema/classification.ts`](../../packages/db/src/schema/classification.ts)
- [`packages/db/src/schema/waitlist.ts`](../../packages/db/src/schema/waitlist.ts)
- [`packages/db/src/queries/classification.ts`](../../packages/db/src/queries/classification.ts)
- [`packages/db/src/queries/workspaces.ts`](../../packages/db/src/queries/workspaces.ts)
- [`packages/db/drizzle/meta/_journal.json`](../../packages/db/drizzle/meta/_journal.json)
- [`packages/db/test/helpers.ts`](../../packages/db/test/helpers.ts)
- [`packages/db/test/migrate.test.ts`](../../packages/db/test/migrate.test.ts)
- [`packages/jobs/src/create.ts`](../../packages/jobs/src/create.ts)
- [`packages/jobs/src/dispatch.ts`](../../packages/jobs/src/dispatch.ts)
- [`packages/jobs/src/intake.ts`](../../packages/jobs/src/intake.ts)
- [`packages/storage/src/index.ts`](../../packages/storage/src/index.ts)
- [`packages/storage/src/disk.ts`](../../packages/storage/src/disk.ts)
- [`packages/storage/src/gcs.ts`](../../packages/storage/src/gcs.ts)
- [`packages/storage/src/memory.ts`](../../packages/storage/src/memory.ts)
- [`packages/financial-engine/pyproject.toml`](../../packages/financial-engine/pyproject.toml)
- [`packages/financial-engine/src/pdf_financial_qa/classify/runner.py`](../../packages/financial-engine/src/pdf_financial_qa/classify/runner.py)
- [`packages/financial-engine/src/pdf_financial_qa/classify/rules.py`](../../packages/financial-engine/src/pdf_financial_qa/classify/rules.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/runner.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/runner.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/errors.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/errors.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/pdf.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/pdf.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/drafts.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/drafts.py)
- [`packages/financial-engine/src/pdf_financial_qa/config.py`](../../packages/financial-engine/src/pdf_financial_qa/config.py)
- [`packages/financial-engine/src/pdf_financial_qa/storage.py`](../../packages/financial-engine/src/pdf_financial_qa/storage.py)
- [`packages/financial-engine-ts/src/index.ts`](../../packages/financial-engine-ts/src/index.ts)
- [`packages/financial-engine-ts/README.md`](../../packages/financial-engine-ts/README.md)
- [`apps/api/src/store.ts`](../../apps/api/src/store.ts)
- [`apps/api/src/migrate.ts`](../../apps/api/src/migrate.ts)
- [`apps/api/Dockerfile`](../../apps/api/Dockerfile)
- [`apps/worker/src/store.ts`](../../apps/worker/src/store.ts)
- [`apps/worker/src/dispatch.ts`](../../apps/worker/src/dispatch.ts)
- [`apps/web/src/lib/documents/types.ts`](../../apps/web/src/lib/documents/types.ts)
- [`docker-compose.yml`](../../docker-compose.yml)
- [`infra/deploy.sh`](../../infra/deploy.sh)
- [`scripts/db/init.sql`](../../scripts/db/init.sql)
- [`package.json`](../../package.json)
- [`Makefile`](../../Makefile)
- [`turbo.json`](../../turbo.json)
- [`packages/contracts/src/common.ts`](../../packages/contracts/src/common.ts)
- [`packages/contracts/src/workspace.ts`](../../packages/contracts/src/workspace.ts)
- [`packages/contracts/src/company.ts`](../../packages/contracts/src/company.ts)
- [`packages/contracts/src/document.ts`](../../packages/contracts/src/document.ts)
- [`packages/contracts/src/extraction.ts`](../../packages/contracts/src/extraction.ts)
- [`packages/contracts/src/classification.ts`](../../packages/contracts/src/classification.ts)
- [`packages/contracts/test/readme-examples.test.ts`](../../packages/contracts/test/readme-examples.test.ts)
- [`packages/contracts/test/extraction-fixtures.test.ts`](../../packages/contracts/test/extraction-fixtures.test.ts)
- [`packages/contracts/test/classification-fixtures.test.ts`](../../packages/contracts/test/classification-fixtures.test.ts)
- [`packages/db/src/queries/documents.ts`](../../packages/db/src/queries/documents.ts)
- [`packages/db/src/queries/jobs.ts`](../../packages/db/src/queries/jobs.ts)
- [`packages/db/src/queries/companies.ts`](../../packages/db/src/queries/companies.ts)
- [`packages/db/src/queries/extraction.ts`](../../packages/db/src/queries/extraction.ts)
- [`packages/db/src/queries/waitlist.ts`](../../packages/db/src/queries/waitlist.ts)
- [`packages/db/drizzle/0000_abnormal_veda.sql`](../../packages/db/drizzle/0000_abnormal_veda.sql)
- [`packages/db/drizzle/0001_company_and_extraction.sql`](../../packages/db/drizzle/0001_company_and_extraction.sql)
- [`packages/db/drizzle/0002_sign_in.sql`](../../packages/db/drizzle/0002_sign_in.sql)
- [`packages/db/drizzle/0003_document_intake.sql`](../../packages/db/drizzle/0003_document_intake.sql)
- [`packages/jobs/src/index.ts`](../../packages/jobs/src/index.ts)
- [`packages/jobs/README.md`](../../packages/jobs/README.md)
- [`packages/jobs/test/dispatch.test.ts`](../../packages/jobs/test/dispatch.test.ts)
- [`packages/storage/test/disk.test.ts`](../../packages/storage/test/disk.test.ts)
- [`packages/financial-engine/README.md`](../../packages/financial-engine/README.md)
- [`packages/financial-engine/src/pdf_financial_qa/classify/__init__.py`](../../packages/financial-engine/src/pdf_financial_qa/classify/__init__.py)
- [`packages/financial-engine/src/pdf_financial_qa/classify/contracts.py`](../../packages/financial-engine/src/pdf_financial_qa/classify/contracts.py)
- [`packages/financial-engine/src/pdf_financial_qa/classify/model.py`](../../packages/financial-engine/src/pdf_financial_qa/classify/model.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/__init__.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/__init__.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/contracts.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/contracts.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/model.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/model.py)
- [`packages/financial-engine/src/pdf_financial_qa/workflow/values.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/values.py)
- [`packages/financial-engine/src/pdf_financial_qa/extraction.py`](../../packages/financial-engine/src/pdf_financial_qa/extraction.py)
- [`packages/financial-engine/src/pdf_financial_qa/qa.py`](../../packages/financial-engine/src/pdf_financial_qa/qa.py)
- [`apps/api/src/env.ts`](../../apps/api/src/env.ts)
- [`apps/api/src/app.ts`](../../apps/api/src/app.ts)
- [`apps/api/src/serialize.ts`](../../apps/api/src/serialize.ts)
- [`apps/api/src/dispatch/index.ts`](../../apps/api/src/dispatch/index.ts)
- [`apps/api/src/routes/dev.ts`](../../apps/api/src/routes/dev.ts)
- [`apps/api/src/routes/documents.ts`](../../apps/api/src/routes/documents.ts)
- [`apps/worker/src/run.ts`](../../apps/worker/src/run.ts)
- [`apps/worker/src/extractor.ts`](../../apps/worker/src/extractor.ts)
- [`apps/worker/src/jobs/document-verify.ts`](../../apps/worker/src/jobs/document-verify.ts)
- [`apps/extractor/src/maester_extractor/app.py`](../../apps/extractor/src/maester_extractor/app.py)
- [`apps/cli/src/maester_cli/cli.py`](../../apps/cli/src/maester_cli/cli.py)
- [`tests/test_classification_rules.py`](../../tests/test_classification_rules.py)
- [`tests/test_classification_runner.py`](../../tests/test_classification_runner.py)
- [`tests/test_classification_contracts.py`](../../tests/test_classification_contracts.py)
- [`tests/test_extraction_contracts.py`](../../tests/test_extraction_contracts.py)
- [`tests/test_extraction_values.py`](../../tests/test_extraction_values.py)
- [`tests/test_extraction_workflow.py`](../../tests/test_extraction_workflow.py)
- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md)
- [`docs/DATA_MODEL.md`](../DATA_MODEL.md)
