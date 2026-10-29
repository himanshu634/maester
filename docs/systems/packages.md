# Shared packages: system description

## Terms

| Term | Meaning |
| --- | --- |
| App | A directory under `apps/` that runs as a program: [`api`](api.md), [`worker`](worker.md), [`extractor`](extractor.md), [`web`](web.md), [`cli`](cli.md), [`mcp`](mcp.md) or [`eval`](eval.md). |
| Package | A directory under `packages/` with code for apps to import. It has a `package.json` (TypeScript) or a `pyproject.toml` (Python). |
| Validator | A Zod object that `@maester/contracts` exports. It parses JSON and refuses JSON with a wrong shape. |
| Database schema | The Drizzle table definitions in `packages/db/src/schema`. |
| Migration | One SQL file in `packages/db/drizzle`. It changes the database to the next version of the database schema. |
| Workspace | One row in the `workspace` table. Most tables have a `workspace_id` column that points to one workspace. |
| Job | One row in the `job` table. A job is one unit of background work on one subject, for example one document. |
| Task | A Cloud Tasks HTTP request to the worker for one job. The body is `{ "jobId": "<id>" }`. |
| Dispatcher | An object with the method `enqueue(job)`. It tells the worker about the job. |
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
| Model | A Claude language model from Anthropic. The Python engine calls it through the Anthropic Python SDK (`anthropic`). |
| Rule | A regular expression in `classify/rules.py` that finds an answer in the text of a page. |
| XBRL instance | An XML file in the XBRL 2.1 format with the facts of a results filing. |
| Source rule | The function `planPdfNumbers` and its companions in `@maester/financial-engine`. It says which source gives the numbers of a statement, and if a results PDF is read, skipped or held. |
| Fixture | A sample JSON or NDJSON file in `packages/contracts/fixtures`. The TypeScript tests and the Python tests read the same fixtures. |
| Wire format | The JSON that one process sends to a different process, for example from `extractor` to `worker`. |
| Transient error | An error after which the same call can succeed later, for example a timeout or HTTP status 429. |
| Market source | A service that gives market data: Dhan or FRED. The Dhan API is at `https://api.dhan.co/v2`. The FRED API is at `https://api.stlouisfed.org/fred`. |
| Market series | One daily series of market values with a text key, for example `india_vix` or `eq:RELIANCE`. |
| Market point | One row in `market_point`. It is the value of one market series on one day. |
| Market connection | One row in `market_connection`. It keeps the encrypted secret of the investor for one market source. |
| Secret | The Dhan access token or the FRED API key that the investor saves in Settings. |
| Connections key | The 32-byte AES key that encrypts the secret in each market connection. The apps get it from the environment variable `CONNECTIONS_KEY`. |
| Refresh run | One row in `market_fetch`. It is one pass of the market refresher in the `worker` app. |
| Reading | One of the 10 values on the Market mood page, for example `india_vix`. The `Reading` validator gives its shape. |
| Scrip master | The CSV file of Dhan instruments at `SCRIP_MASTER_URL`. |
| IST | India Standard Time, UTC plus 5 hours and 30 minutes. |

## Function

The shared packages hold the code that more than one app uses. Six TypeScript packages give the API contracts, the database, job dispatch, file storage, market data and the lint settings. One Python package, the financial engine, classifies PDF filings and extracts their financial statements. The `api` and `worker` apps use the TypeScript packages. The `extractor`, `cli` and `eval` apps use the Python package.

A seventh TypeScript package, `packages/financial-engine-ts`, holds the source rule. The command package `apps/import` sends a folder of files through the API. For the full system, see [Maester](maester.md).

## Parts

| Part | Location | Function |
| --- | --- | --- |
| `@maester/config` | `packages/config` | Gives the shared TypeScript compiler settings and the ESLint rules. |
| `@maester/contracts` | `packages/contracts` | Gives the validators for each JSON body that goes between the apps. |
| `@maester/db` | `packages/db` | Gives the database schema, the migrations, a PostgreSQL client and the query functions. |
| `@maester/jobs` | `packages/jobs` | Creates jobs, sends tasks and calculates the next intake state of a document. |
| `@maester/storage` | `packages/storage` | Gives the `ObjectStore` interface and three object stores. |
| `@maester/brokers` | `packages/brokers` | Broker plugins (Kite) behind a host-locked kit and a registry; read-only. |
| `@maester/market` | `packages/market` | Gets daily market data from Dhan and FRED. Encrypts and decrypts the secrets of market connections. |
| `@maester/document-index` | `packages/document-index` | Names the embedding models, calls the embedder and searches the chunks. |
| `maester-financial-engine` | `packages/financial-engine` | A Python library with the import name `pdf_financial_qa`. It classifies PDF filings and extracts facts from them. It also reads XBRL instances, with element maps. |
| `@maester/financial-engine` | `packages/financial-engine-ts` | The source rule. It exports `ENGINE_VERSION`, with the value `"0.0.0"`, and the functions of the source rule. |
| `@maester/import` | `apps/import` | A command that sends the PDFs and the XBRL instances of a folder through the API. |

The name of the package in `packages/financial-engine-ts` is `@maester/financial-engine`, without `-ts`.

### Which apps use each package

| Package | Used by | File that shows it |
| --- | --- | --- |
| `@maester/config` | `apps/api`, `apps/worker`, each TypeScript package, `scripts/` | The `tsconfig.json` and `eslint.config.js` of each |
| `@maester/contracts` | `apps/api`, `apps/worker`, `apps/mcp`, `@maester/jobs` | `apps/api/src/serialize.ts`, `apps/worker/src/extractor.ts`, `apps/mcp/src/present/`, `packages/jobs/src/intake.ts` |
| `@maester/db` | `apps/api`, `apps/worker`, `apps/mcp`, `@maester/jobs` | `apps/api/src/app.ts`, `apps/worker/src/run.ts`, `apps/mcp/src/main.ts`, `packages/jobs/src/create.ts` |
| `@maester/jobs` | `apps/api`, `apps/worker` | `apps/api/src/dispatch/index.ts`, `apps/worker/src/dispatch.ts` |
| `@maester/storage` | `apps/api`, `apps/worker` | `apps/api/src/store.ts`, `apps/worker/src/store.ts` |
| `@maester/market` | `apps/api`, `apps/worker` | `apps/api/src/routes/connections.ts`, `apps/worker/src/market/build.ts` |
| `@maester/document-index` | `apps/api`, `apps/worker`, `apps/mcp` | `apps/api/src/routes/search.ts`, `apps/worker/src/jobs/document-index.ts`, `apps/mcp/src/tools/` |
| `maester-financial-engine` | `apps/extractor`, `apps/cli`, `apps/eval` | `apps/extractor/src/maester_extractor/app.py`, `apps/cli/src/maester_cli/cli.py`, `apps/eval/src/maester_eval/runner.py` |
| `@maester/financial-engine` | `apps/api`, `apps/worker`, `@maester/jobs` | `apps/api/src/documents/pipeline.ts`, `apps/worker/src/jobs/document-classify.ts`, `packages/jobs/src/intake.ts` |
| `@maester/import` | No app. A person runs it. | `apps/import/src/cli.ts` |

The `web` app does not import `@maester/contracts`. Four files keep a copy of a subset of the validators as TypeScript types:

- `apps/web/src/lib/documents/types.ts`
- `apps/web/src/lib/market-mood/types.ts`, a copy of `market-mood.ts`
- `apps/web/src/lib/settings/types.ts`, a copy of `connection.ts`
- `apps/web/src/lib/research/types.ts`, a copy of `research.ts`, and of `Company` from `company.ts`

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
| `document.ts` | `DocumentState`, `DocumentFormat`, `UploadMimeType`, `RejectionCode`, `Document`, `CreateUploadRequest`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`, `ClassificationChanged` |
| `extraction.ts` | `ExtractorEvent`, `ExtractionResult`, `ExtractedFact`, `ExtractionRevision`, `FinancialFact`, `DocumentExtraction`, `DocumentFacts`, `ExtractResponse` |
| `classification.ts` | `ClassifyResponse`, `ClassificationResult`, `Classification`, `Evidence`, `IntakeState`, `ChangeClassificationRequest`, `Cin`, `BseCode`, `NseSymbol`, `toResultsSpan` |
| `payloads.ts` | `DocumentVerifyResult`, `DocumentClassifyResult`, `DocumentExtractResult`. Each is the `result` of one job type. |
| `market-mood.ts` | `ReadingKey`, `ReadingFamily`, `MoodBand`, `MissingReason`, `Reading`, `FetchStatus`, `MarketMood`, `ReadingDetail` |
| `connection.ts` | `ConnectionProvider`, `Connection`, `ConnectionList`, `SaveDhanConnectionRequest`, `SaveFredConnectionRequest` |
| `xbrl.ts` | The wire format of `/v1/xbrl` and `/v1/xbrl/pdf-check`: `XbrlClassification`, `XbrlReadResult`, `XbrlTextResult`, `XbrlPdfCheckRequest`, `XbrlPdfCheckResult`, `XbrlPdfNotChecked`, `XBRL_PDF_CHECK_VERSION` |
| `pipeline.ts` | `DocumentPipeline`. The `pipeline` object of a document. |
| `filings.ts` | `WorkspaceFilings`, `WorkspaceFiling`, `FilingFile`, `StatementSource`, `HeldIdentity`, `ConfirmCompanyRequest`, `ConfirmCompanyResponse` |
| `research.ts` | `CellStatus`, `CellCheck`, `CellSource`, `Restated`, `FinancialCell`, `FinancialRow`, `FinancialColumn`, `TableUnit`, `StatementTable`, `CompanyFiling`, `CompanyFinancials`, `StockPoint`, `CompanyStock`, `ResearchCompany`, `ResearchCompanies` |

Each validator has a TypeScript type with the same name. `JobTypes` gives the job types: `document.verify`, `document.classify`, `document.extract`, `document.index`, `document.xbrl` and `document.xbrl_check`. The package has no OpenAPI document and no generated client. Its `README.md` is the guide to the HTTP routes of the API. The README does not describe the routes for market mood, for market connections or for Research.

The market mood validators give the shape of the Market mood page:

- `ReadingKey` gives the 10 readings in page order. `ReadingFamily` gives four families: `fear`, `money`, `breadth` and `havens`.
- `MoodBand` gives five bands, from `very_cautious` to `very_eager`.
- `MissingReason` gives the cause when a reading has no value or no rank: `no_source`, `no_data`, `stale` or `not_enough_history`.
- A `MarketMood` has exactly 10 readings. Its `scoredCount` is a maximum of 7. Each `rank` and `score` is an integer from 0 to 100, or `null`.
- `FetchStatus.errorCode` has the five codes of `MarketSourceError`, the two codes `DHAN_NOT_CONNECTED` and `FRED_NOT_CONNECTED` that the refresher records, and `UNKNOWN`.
- A `ReadingDetail` has one reading and its values for the last 2 years, oldest first.

The Research validators give the shape of the Research pages:

- A `StatementTable` has one statement on one basis, a `unit`, `columns` (oldest first), `rows`, the count `unplaced` and the list `leftOut`.
- A `FinancialColumn` has the period of the year and the filing that the whole column comes from.
- A `FinancialRow` has `perShare`. On a per-share row, the values are rupees a share, as printed.
- A `FinancialCell` has a `status`: `value`, `dash`, `unparsed` or `missing`. It has `value` only when the status is `value`.
- A `CellSource` has the kind `page` or the kind `xbrl`. The kind `page` has the 0-based `pageIndex`, the `pageCount` and `textLayerMatch`, which is `null` for a page with no text layer. The kind `xbrl` has the element, the context, the `decimals`, the nil flag, the span and `inPdf`. It has no page.
- A `CellCheck` has the role `subject`, `component` or `none`. Its `expected` is the subtotal as the page prints it. Its `actual` is the sum of the lines.
- A `CompanyStock` has the state `ok`, `no_symbol`, `not_connected` or `not_tracked`.
- A `ResearchCompany` has a company and the counts `annualReportsRead`, `reading` and `failed`.

The connection validators give the shape of a market connection on the Settings page:

- A `Connection` never contains the secret. It contains only `last4`, the last 4 characters of the secret.
- The state of a `Connection` is `not_connected`, `connected`, `expired` or `failing`. The `notice` is `DATA_PLAN_INACTIVE` or `null`.
- The comment on `ConnectionList` says that it always has two items, Dhan first.
- `SaveDhanConnectionRequest` accepts a client ID of 1 to 32 characters and an access token of 20 to 4096 characters.
- `SaveFredConnectionRequest` accepts only an API key of 32 lower-case letters and digits. Its error message does not contain the refused value.

### `@maester/db`

| Export | Function |
| --- | --- |
| `createDb(url, options)`, `closeDb(db)`, `Db` | Make a Drizzle client over a `pg` pool. The option `max` sets the maximum number of connections (default 10). With the option `readOnly`, each session sets `default_transaction_read_only=on`, and Postgres refuses a write with code 25006. The MCP server uses this option. Close the pool. |
| `schema` | All the table and enum definitions. |
| `WorkspaceRow`, `MembershipRow`, `CompanyRow`, `DocumentRow`, `JobRow` | The row types of the platform tables. |
| `ExtractionRevisionRow`, `FinancialFactRow`, `SourceReferenceRow`, `ExtractionCheckRow`, `XbrlSourceRow` | The row types of the extraction tables. |
| `ClassificationRow`, `EvidenceRow`, `WaitlistEntryRow` | The row types of the classification and waitlist tables. |
| `runMigrations(db, folder)`, `DEFAULT_MIGRATIONS_FOLDER` | Apply the migrations. The default folder is `packages/db/drizzle`. |
| `encodeCursor`, `decodeCursor` | Make and parse the cursor of a list page. The cursor is base64url JSON with the `createdAt` and `id` of the last row. |
| `listWorkspacesForUser`, `getWorkspaceForUser`, `ensurePersonalWorkspace` | Workspace queries. `ensurePersonalWorkspace` creates one workspace and one `owner` membership for a user, if the user has none. |
| `getDocument`, `listDocuments`, `getJob`, `getLatestJobForSubject`, `getCompany`, `listCompanies` | Document, job and company queries. The lists give the newest row first. |
| `getLatestRevision`, `getRevision`, `listChecks`, `listFactsWithSources` | Extraction queries. |
| `getFactWithSource(db, workspaceId, factId)` | Gives one fact with its source, the document, the revision and the company IDs. It gives `null` if the fact is not in the workspace. |
| `listCompanyFilings`, `listFactsWithSourcesForRevisions`, `listChecksForRevisions`, `CompanyFilingRow` | Research queries. `listCompanyFilings` gives the documents that have a company, newest first, with the kind and the period end of the current classification. The other two queries give the facts with their pages, and the checks, of a list of revisions. |
| `getCurrentClassification`, `listEvidence`, `getCurrentRevision` | Classification queries. |
| `loadWorkspaceXbrlDocs`, `companyIdentity`, `companyIdentities`, `listXbrlPdfChecks` | XBRL queries. `loadWorkspaceXbrlDocs` gives the XBRL documents of a workspace as the source rule needs them: state, company, period and coverage. `listXbrlPdfChecks` gives the `xbrl_in_pdf` rows of the current check version. |
| `loadPipelineInputs` | Gives the rows from which the API works out the `pipeline` of documents. |
| `listFilingRows`, `loadXbrlFilingData`, `lockHeldDocuments` | Filing queries. `lockHeldDocuments` locks the held documents that print an identity, oldest first. |
| `normalizeCompanyName`, `matchCompanies`, `findStoredDuplicate` | Company match and duplicate search for document intake. |
| `admitOrWaitlist`, `approveWaitlistEmail`, `normalizeEmail` | Waitlist queries for sign-up. |
| `MarketPointRow`, `NewMarketPoint`, `MarketFetchRow`, `MarketConnectionRow`, `MarketConnectionProvider` | The row types of the market tables. |
| `upsertMarketPoints`, `listMarketSeries`, `listMarketSeriesByPrefix`, `listMarketValuesByPrefix`, `latestMarketDay` | Market point queries. `upsertMarketPoints` writes a maximum of 1000 rows in each insert. It replaces the value of a series and day that the table has. The lists give the oldest day first. |
| `startMarketFetch`, `finishMarketFetch`, `latestMarketFetch` | Refresh run queries. |
| `getConnection`, `listConnections`, `saveConnection`, `deleteConnection`, `markConnectionError`, `lastMarketReads`, `SaveConnection` | Market connection queries. `listConnections` gives Dhan first. `lastMarketReads` gives the last time that the database stored a market point from each market source. |

Each query for a workspace record takes the workspace ID and gives only rows of that workspace. The three market tables have no `workspace_id` column, and the market queries take no workspace ID. The package has three scripts: `generate`, `migrate` and `waitlist:approve`.

### `@maester/jobs`

| Export | Function |
| --- | --- |
| `createJob(db, dispatcher, input)` | Inserts a job and dispatches it. If a job with the same idempotency key exists in the workspace, it gives that job and does not dispatch it. |
| `DEFAULT_MAX_ATTEMPTS` | The value 5. |
| `MAX_ATTEMPTS_BY_TYPE` | The `maxAttempts` of the job types that call a paid model: `document.classify` 2 and `document.extract` 2. |
| `maxAttemptsFor(type)` | Gives the `maxAttempts` of a job type: the value in `MAX_ATTEMPTS_BY_TYPE`, or `DEFAULT_MAX_ATTEMPTS` for all other types. |
| `JobScopeConflictError` | The idempotency key belongs to a job in a different workspace. |
| `Dispatcher` | The interface with the method `enqueue(job)`. |
| `QueueNotifier` | Sends the Postgres notification `job_ready` with the job type. The queue runner of the worker wakes and claims the job. |
| `CloudTasksDispatcher` | Sends the task to the worker through Google Cloud Tasks, with an OIDC token. |
| `RecordingDispatcher` | Keeps each job it gets in an array and sends nothing. For tests. |
| `decideIntake(db, dispatcher, classification, opts)` | Writes the next intake state and company of a document from a classification. |
| `READ_KINDS` | The kinds that Maester extracts: `annual_report` and `financial_results`. |
| `readVersion(id)`, `classificationIdOfReadJob(key)` | Make the version text `classification-<id>` for an extraction job, and get the ID back from an idempotency key. |
| `pdfNumbersInput(classification, identity)` | Makes the input of the source rule from the classification of a results PDF. It gives `null` for a document that is not a results PDF or has no company. |
| `enqueueXbrlPdfChecks(db, dispatcher, ws, by)` | Creates a `document.xbrl_check` job for each pair of an XBRL document and a results PDF of the same company and period end. `by` names the XBRL side or the PDF side. |
| `redecidePdfsAfterXbrl(db, dispatcher, ws)` | Decides again each PDF of the workspace that waits for XBRL, and each results PDF that XBRL covers. It runs after an XBRL document settles, and after a change to the answers of a results PDF. |
| `recheckPdfRead(db, ws, documentId, classificationId)` | Applies the source rule again before `document.extract` reads a results PDF. It writes `read` for `skip` and `waiting_for_xbrl` for `wait`, and returns the plan. It returns null for a read. |
| `xbrlCheckVersion(pdfClassificationId, xbrlRevisionId)`, `xbrlCheckKeyOf(key)` | Make the version text `v<check version>:pdf-<id>:xbrl-<id>` of a check job, and read the three values back from an idempotency key. |

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

### `@maester/market`

| Export | Function |
| --- | --- |
| `DhanSource`, `FredSource` | The interfaces of the two market sources. |
| `HttpDhanSource(opts)` | Calls the Dhan API. It gives daily closes, the Nifty put-call ratio, the NSE equity IDs, the MCX gold contracts and the profile. It also renews the access token. |
| `HttpFredSource(opts)` | Calls the FRED API. It gives the observations of one series from a start day. `check()` reads one `VIXCLS` observation to examine the API key. |
| `MarketSourceError` | The error of a market source. Its `code` is `DHAN_TOKEN_EXPIRED`, `DHAN_RATE_LIMITED`, `FRED_KEY_REFUSED` or `SOURCE_UNAVAILABLE`. |
| `encryptSecret(plain, key)`, `decryptSecret(blob, key)` | Encrypt and decrypt one secret with AES-256-GCM. The connections key must have 32 bytes. |
| `loadConnections(rows, key)` | Decrypts the `market_connection` rows. It gives a Dhan client ID and access token, and a FRED API key, or `null` for each. |
| `ist(epochSeconds)` | Gives the IST calendar day of a time, as `YYYY-MM-DD`. |
| `NIFTY_50`, `INDIA_VIX`, `MCX_GOLD_NAME`, `NIFTY_OPTION_UNDERLYING`, `SCRIP_MASTER_URL` | The fixed Dhan instruments and the address of the scrip master. |
| `parseScripMaster`, `keepScripRow`, `nearMonthGold` | Parse the scrip master, keep only the NSE equity rows and the rows of MCX gold futures, and find the gold contract with the nearest expiry. |
| `DailyPoint`, `Instrument`, `GoldContract`, `ScripRow`, `DhanOptions`, `FredOptions`, `SavedConnection`, `LoadedConnections` | The types of the package. |

The package has no runtime dependencies. It uses `fetch` and `node:crypto` from Node.js. `loadConnections` takes rows, not a database client, so that `@maester/market` does not import `@maester/db`. The caller gives it the result of `listConnections`. The package does not read environment variables. The apps give it the connections key and the Dhan request rate.

### `@maester/document-index`

| Export | Function |
| --- | --- |
| `EMBEDDING_MODELS`, `embeddingModel` | The registry of embedding models. Each entry has the dimensions (1024), the query prefix and the document prefix. The model `Snowflake/snowflake-arctic-embed-l-v2.0` has the query prefix `query: ` and no document prefix. An unknown model gives an error. |
| `embeddingInput` | Adds the prefix to a text. The worker and the API both use it, so the prefix is in one place only. |
| `INDEX_PIPELINE_VERSION`, `indexPipelineVersion` | The version of the index pipeline, with the model name. |
| `Embedder`, `TeiEmbedder`, `EmbedderError` | The embedder interface and its client for text-embeddings-inference. The client posts to `/embed` with `normalize` true and `truncate` false. It tries again 3 times for status 429, status 500 or more, or no answer. The wait starts at 1 second and doubles. With `retryOnTimeout` false, it does not try again after a request runs past `timeoutMs` (the default is 60 seconds), because the embedder continues to work on that request. |
| `FakeEmbedder` | An embedder for tests. It gives the same unit vector for the same text. `fail` makes the next calls fail. |
| `ServedModelGate` | Asks the embedder which model it serves, before the caller embeds a query. It gives `{ ok: true }`, or a code that tells why the embedder cannot serve the query. The API search route and the MCP server both use it. |
| `searchChunks`, `fuse` | The hybrid search. It joins a vector branch and a keyword branch by reciprocal rank with k = 60. |
| `contextualize` | The text that the embedder gets: the section path and the text of the chunk. |

The package reads no environment variable. The apps give it the URL and the model.

### `maester-financial-engine`

| Module | Main exports | Used by |
| --- | --- | --- |
| `pdf_financial_qa.classify` | `run_classification`, `ClassifySettings`, `ClassificationModel`, `ClassificationResult`, `RULES_VERSION` | `apps/extractor` |
| `pdf_financial_qa.workflow` | `run_extraction`, `WorkflowSettings`, `ExtractionModel`, `ExtractionResult`, `ExtractionError`, `PIPELINE_VERSION` | `apps/extractor`, `apps/eval` |
| `classify.contracts`, `workflow.contracts` | `CLASSIFY_RESPONSE`, `EXTRACTOR_EVENT` and the Pydantic classes of the wire format | `apps/extractor` |
| `classify.model`, `workflow.model` | `ClaudeClassificationModel`, `ClaudeExtractionModel` | `apps/extractor`, `apps/eval` (`ClaudeExtractionModel` only) |
| `workflow.pdf`, `workflow.values` | `PdfDocument`, `parse_reported`, `parse_label_date`, `format_decimal` | `apps/eval` |
| `config`, `extraction`, `qa`, `storage` | `Settings`, `extract`, `ask`, `hash_pdf`, `load`, `save`, `list_cached` | `apps/cli` |

The Pydantic classes in `classify.contracts` and `workflow.contracts` are a copy of the TypeScript validators in `@maester/contracts`. The same fixtures test the two copies. The package needs Python 3.11 or later.

## Operation

### Job creation and dispatch

1. The caller gives `createJob` the workspace ID, the job type, the subject type, the subject ID and an optional version.
2. `createJob` makes the idempotency key `<type>:<subjectId>:<version>`. The default version is `1`.
3. `createJob` inserts a job with the state `queued` and the `maxAttempts` from `maxAttemptsFor`. If a job with the same idempotency key exists, the insert adds no row.
4. If the insert adds a row, `createJob` gives the new job to the dispatcher and returns the job.
5. If the insert adds no row, `createJob` returns the job with that idempotency key in the same workspace. It does not dispatch the job.
6. `QueueNotifier` runs `select pg_notify('job_ready', <type>)`. The job row is already `queued`. If the notification is lost, the poll of the worker finds the job.
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
6. For `reading`, it creates the read job with the version `classification-<classificationId>`. The job is `document.extract` for a PDF and `document.xbrl` for an XBRL instance. It sends no task in the transaction.
7. For a results PDF with a company, it first locks the XBRL wait of the workspace and applies the source rule. The state can be `waiting_for_xbrl` with no job, or `read` with no job when XBRL covers each statement of the PDF.
8. After the transaction commits, it sends the task of the new job.
9. For a PDF that is a results PDF, it then calls `enqueueXbrlPdfChecks`.

Because the version contains the classification ID, each classification gives a maximum of one extraction job.

### The source rule

`@maester/financial-engine` in `packages/financial-engine-ts` holds the source rule, `SOURCE_RULE_VERSION = 1`. Its functions are pure. They read no database and no clock. The Python twin is `apps/eval/src/maester_eval/source_rule.py`. Both pass the fixture `packages/financial-engine-ts/fixtures/source-rule.json`.

| Function | Rule |
| --- | --- |
| `rankSlotCandidates`, `slotOwner` | The revision that owns a slot. XBRL comes before PDF. Then the newer filing period, with no period last. Then the newer revision. Then the larger revision ID. |
| `annualSlotOf` | The slot in an annual table that a fact fills, or none. A fact of a results filing fills no annual column. An XBRL fact fills its year, or its own period-end instant. A PDF fact fills its slot as read. |
| `planPdfNumbers` | `read`, `skip` or `wait` for a results PDF. It waits if an XBRL document that is not settled can match its company and period. It skips if settled XBRL covers each statement and basis that the PDF prints. Else it reads. |
| `coveringXbrl` | The settled XBRL documents that cover at least one statement of the PDF. |
| `slotKey` | The text key of a slot. |

A basis `unknown` never covers a statement. An annual report is never skipped or held.

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
| `0004_market.sql` | Creates `market_point` and `market_fetch`. |
| `0005_market_connection.sql` | Creates `market_connection`. Its foreign key to `user` sets `saved_by_user_id` to `null` when the database deletes the user. |

### Object storage

1. The API asks the object store for a signed URL with `signUpload`. The response contains the URL, the headers `Content-Type` and `Content-Length`, and the expiry time.
2. The browser sends the file to the signed URL.
3. The worker gets the file with `readStream`.
4. `GcsObjectStore` makes V4 signed URLs of Google Cloud Storage.
5. `DiskObjectStore` keeps the bytes in `<root>/objects/<key>` and the content type in `<root>/meta/<key>.json`.
6. `DiskObjectStore` makes the URL `<baseUrl>/dev/blobs/<key>?expires=<time>&signature=<signature>`. The signature is an HMAC-SHA256 of `<method>:<key>:<expires>` with the `secret` of `DiskSigningOptions`.
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

The prompt for a statement asks for the earnings per share lines, basic and diluted, when the statement prints them. A line is a per-share line when its section or its label matches `earnings per share`, `earnings per equity share` or `eps`, with the case ignored. `is_per_share` finds it. The fact of a per-share line has the scale 1, whatever the unit of the statement. Thus its `normalizedValue` is rupees a share. The other facts of a statement have the scale of the unit of the statement.

The run has a budget. It stops if it needs more than 40 model calls or more than 840 seconds. Each model call has a maximum of 3 attempts. The workflow tries a call again only after a transient error.

The progress callback gets the stage name and the percent. The `extractor` app sends these to the worker. See [extractor](extractor.md).

### First extraction path

The modules `config`, `extraction`, `qa`, `storage`, `schema` and `validation` are the first extraction path. `extract` sends one PDF of a maximum of 15 MB to the model in one call. `ask` answers one question about one extraction. `save` writes the result to `data/cache/<hash>.json`. Only the `cli` app uses this path. See [CLI](cli.md).

### Dhan calls

`HttpDhanSource` sends each API request with the headers `access-token` and `client-id`. A request to `/RenewToken` sends `access-token` and `dhanClientId`. It does these steps for each API request:

1. It keeps a minimum of 1000 / `requestsPerSecond` milliseconds between two requests.
2. It sends the request with a timeout of 30 seconds.
3. If the response has status 401, or the error code `DH-901` or `807`, it throws `DHAN_TOKEN_EXPIRED`.
4. If the response has status 429, or the error code `DH-904` or `805`, it waits and sends the request again. The waits are 1, 2 and 4 seconds.
5. If the fourth request also gets a rate limit, it throws `DHAN_RATE_LIMITED`.
6. For `renewToken` only, a different 4xx status gives `DHAN_TOKEN_EXPIRED`.
7. A network failure, a different error status, a different error code, or a 2xx body that it cannot parse gives `SOURCE_UNAVAILABLE`.
8. The error message contains only the status and a short error code. It never contains text from the server, the token or the client ID.

The error codes `DH-902` and `806` tell that the Dhan data plan is not active. They give `DHAN_NO_DATA_PLAN`, not `DHAN_TOKEN_EXPIRED`.

`daily` asks `/charts/historical` for the closes from `from` to `to`. Dhan does not include the `toDate`, so the request sends the day after `to`. `ist` changes each timestamp to an IST day.

`putCallRatio` uses the first Nifty expiry on or after the current IST day. If there is no such expiry, it uses the earliest expiry in the list. It divides the sum of the put open interest by the sum of the call open interest. If the call open interest is 0, it throws `SOURCE_UNAVAILABLE`.

`equityIds` and `goldContracts` read the scrip master one time for each `HttpDhanSource`. The download has a timeout of 120 seconds. `HttpDhanSource` keeps only the NSE equity rows and the rows of MCX `GOLD` futures. If the download fails, `HttpDhanSource` does not keep the failure, and the next call tries again. `goldContracts` gives only contracts with an expiry on or after the current IST day, earliest first.

`profile` reads `/profile` and gives the client ID, the token expiry and `dataPlanActive`. Dhan gives the token expiry as `DD/MM/YYYY HH:MM` with no time zone, and `HttpDhanSource` reads it as IST. `dataPlanActive` is false if the data plan is not `Active` or if its end time is before now. It is `null` if Dhan gives no data plan. `renewToken` calls `/RenewToken`. Dhan then expires the old token and gives a new token.

### FRED calls

1. `HttpFredSource` sends `GET /series/observations` with `series_id`, `api_key` and `file_type=json`. The timeout is 30 seconds.
2. If the status is 400, 401 or 403, it throws `FRED_KEY_REFUSED`. FRED gives status 400 for a wrong API key.
3. If the status is a different value and not 200, it throws `SOURCE_UNAVAILABLE`.
4. A network failure or a body that is not JSON also gives `SOURCE_UNAVAILABLE`. The message does not contain the URL, because the URL contains the API key.
5. It ignores an observation with the value `"."`. A day with no value is never 0.
6. It returns the other observations as days and values.

`check()` asks for the newest `VIXCLS` observation only. The two sources keep the secrets in private class fields. `JSON.stringify` and log lines do not show them.

### Market connections and refresh runs

1. The `api` app encrypts the secret of the investor with `encryptSecret` and the connections key.
2. `encryptSecret` makes a new random 12-byte IV for each call. It returns base64 of the IV, the 16-byte authentication tag and the ciphertext, in this order.
3. `saveConnection` inserts or replaces the row of the market source. It sets `saved_at` to now and `last_error_code` to the given code or `null`.
4. The `worker` app reads the rows with `listConnections` and gives them to `loadConnections`.
5. `loadConnections` decrypts each row with `decryptSecret`. It ignores a Dhan row with no client ID.
6. The market refresher calls `startMarketFetch`. This inserts a refresh run with the state `running`.
7. If a different refresh run has the state `running` and started less than 1 hour ago, `startMarketFetch` inserts no row and returns `null`.
8. The refresher writes the market points with `upsertMarketPoints`.
9. `markConnectionError` writes the last error code of a market source, or `null` after a good call.
10. `finishMarketFetch` writes the state `ok` or `failed`, the end time, the number of market points and the error.

`startMarketFetch` looks only at the last hour. Thus a refresh run that stops with the state `running` blocks new runs for a maximum of 1 hour. When the refresher renews a Dhan token, it encrypts the new token and calls `saveConnection` again. See [worker](worker.md).

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| `JobScopeConflictError` | The idempotency key belongs to a job in a different workspace. | `createJob` throws the error. |
| The job exists | `createJob` gets an idempotency key that a job in the same workspace has. | `createJob` returns that job and does not dispatch it. |
| `pg_notify` fails | The database refuses the notification. | `enqueue` throws the error. |
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
| `DHAN_TOKEN_EXPIRED` | Dhan gives status 401, or the error code `DH-901` or `807`. Or `renewToken` gets a different 4xx status. | `MarketSourceError`. |
| `DHAN_RATE_LIMITED` | Dhan gives status 429, or the error code `DH-904` or `805`, to four requests in sequence. | `MarketSourceError`, after waits of 1, 2 and 4 seconds. |
| `FRED_KEY_REFUSED` | FRED gives status 400, 401 or 403. | `MarketSourceError`. |
| `SOURCE_UNAVAILABLE` | The request to a market source fails, the market source gives a different error, or the body has no usable data. | `MarketSourceError`. |
| `the connections key must be 32 bytes` | `encryptSecret` or `decryptSecret` gets a key that does not have 32 bytes. | The function throws an `Error`. |
| `the saved secret is malformed` | The encrypted value has fewer than 28 bytes. | `decryptSecret` throws an `Error`. |
| `the saved secret could not be decrypted` | The encrypted value changed, or a different key encrypted it. | `decryptSecret` throws an `Error`. |
| `the saved <provider> connection could not be decrypted; save it again in Settings` | `decryptSecret` fails for one row. | `loadConnections` throws an `Error` that gives only the provider name. |
| `requestsPerSecond must be greater than 0` | `HttpDhanSource` gets a rate of 0 or less, or a rate that is not finite. | The constructor throws an `Error`. |
| `startMarketFetch` returns `null` | A refresh run with the state `running` started less than 1 hour ago. | No new refresh run starts. |
| `deleteConnection` returns `false` | The table has no row for the market source. | Nothing changes. |
| `market_connection_provider` or `market_fetch_state` constraint error | A provider is not `dhan` or `fred`, or a state is not `running`, `ok` or `failed`. | PostgreSQL refuses the insert. |

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
| `document` | 0000, 0003, 0008 | One file: original name, declared size and MIME type, object key, SHA-256, size, state, rejection code, intake state, `duplicate_of_document_id` and `format` (`pdf` or `xbrl`). |
| `job` | 0000 | One job: type, subject, idempotency key, state, `attempt`, `max_attempts`, lease, progress, result and last error. |
| `company` | 0001, 0003, 0008 | One company of a workspace: `display_name`, country, CIN, BSE code, NSE symbol and ISIN. The ISIN is unique in a workspace when it has a value. |
| `extraction_revision` | 0001, 0003, 0008 | One extraction: document, job, classification, state, versions, page count, printed company name, coverage, warnings and `source` (`pdf` or `xbrl`). |
| `financial_fact` | 0001, 0008 | One fact: statement, basis, section, line order, label, period, printed text, decimal, value status, unit, scale, currency and normalized value. Also `period_start` and `span` (`quarter`, `half_year`, `nine_months`, `year` or `other`). |
| `source_reference` | 0001 | The page of one fact: document, page index from 0 and text layer match. One row for each fact. |
| `extraction_check` | 0001, 0008 | One check of a revision: type, statement, basis, subject, status, expected value and actual value. A row of the type `xbrl_in_pdf` also has `fact_id`, `pdf_document_id`, `pdf_classification_id`, `page_index`, `reason` and `check_version`. |
| `xbrl_source` | 0008 | The source of one XBRL fact: document, element, context ID, `decimals`, nil flag, concept and footnote IDs. One row for each fact. |
| `rate_limit` | 0002 | The Better Auth rate limiter: key, count and time of the last request. |
| `waitlist_entry` | 0002 | One email that asked for an account: status (`pending` or `approved`), source (`google`, `email` or `admin`), request time and approval time. |
| `document_classification` | 0003, 0008 | One classification: kind, other type, results span, period, company, printed identifiers, statements found, `set_by`, job, `reads_under_id`, versions and warnings. Also `isin`, `xbrl_format` and `basis` (for an XBRL instance only). |
| `classification_evidence` | 0003, 0008 | The source of one answer: field, source (`rule`, `model` or `investor`), rule ID, page index, quote and text layer match. Also `element` and `context` for an answer that an XBRL fact gave. |
| `market_point` | 0004 | One market point: series, day, value, source text and `fetched_at`. One row for each series and day. |
| `market_fetch` | 0004 | One refresh run: state (`running`, `ok` or `failed`), start time, end time, `points_written`, error code and error message. |
| `market_connection` | 0005 | One market connection: provider (`dhan` or `fred`), client ID, `secret_ciphertext`, `secret_last4`, expiry, `checked_at`, `last_error_code`, `saved_at` and `saved_by_user_id`. One row for each provider. |

Rows in `document_classification`, `extraction_revision` and `financial_fact` do not change after the insert. A new answer or a new extraction adds new rows. The schema comments in `classification.ts` and `extraction.ts` say this.

The current classification of a document is its newest `document_classification` row. `getCurrentRevision` gives the newest revision with the `classification_id` of the `reads_under_id` of that classification. If the document has no classification, it gives the newest revision. If `reads_under_id` is empty, it gives `null`.

The three market tables have no `workspace_id` column. The schema comment says that they keep the Dhan and FRED data of the user, and that the apps show it only in a session. The keys of the market series are:

- `nifty50`, `india_vix`, `us_vix`, `usd_inr` and `gold_mcx`
- `nifty_pcr_oi`, `n500_above_200d_pct` and `n500_net_highs_pct`
- `eq:<SYMBOL>` for the close of each Nifty 500 member

The source text of a market point starts with `Dhan ·` or `FRED ·`. `lastMarketReads` uses this text to find the market source. In `market_connection`, `secret_ciphertext` holds the output of `encryptSecret`, and `secret_last4` holds the last 4 characters of the secret. After a save, `last_error_code` holds `DHAN_NO_DATA_PLAN` or `null`. If the refresher gets `DHAN_TOKEN_EXPIRED` or `FRED_KEY_REFUSED`, it writes that code. After a good call, it writes `null`.

### Environment variables

| Variable | Read by | Function |
| --- | --- | --- |
| `DATABASE_URL` | `migrate-cli.ts`, `waitlist-cli.ts`, `drizzle.config.ts` | The address of the database. If it is empty, `drizzle.config.ts` uses `postgres://maester:maester@localhost:5433/maester`. |
| `MIGRATIONS_FOLDER` | `migrate-cli.ts`, `apps/api/src/migrate.ts` | The folder of the migrations. The API image gives it the value `/app/drizzle`. |
| `DATABASE_URL_TEST_DB` | `packages/db/test/helpers.ts` | The test database. The default is `postgres://maester:maester@localhost:5433/maester_test_db`. |
| `ANTHROPIC_API_KEY` | `pdf_financial_qa/config.py` | The Anthropic API key of the first extraction path. It is necessary. The SDK reads it. |
| `EXTRACTOR_MODEL` | `pdf_financial_qa/config.py` | The model name. The default is `claude-opus-5-5`. |
| `EXTRACTOR_EFFORT` | `pdf_financial_qa/config.py` | The effort of the model: `low`, `medium`, `high`, `xhigh` or `max`. The default is `high`. |
| `CONNECTIONS_KEY` | `apps/api/src/env.ts`, `apps/worker/src/env.ts` | The connections key, as 32 bytes in base64. The apps refuse a value of a different length. The packages do not read it. The apps decode it and give the bytes to `@maester/market`. |

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

### To test `@maester/contracts`, `@maester/jobs`, `@maester/storage` and `@maester/market`

These tests need no database and no Google Cloud account. The tests of `@maester/market` give the market sources a substitute `fetch`. They need no Dhan or FRED key.

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

4. Run the tests of `@maester/market`:

   ```bash
   pnpm --filter @maester/market test
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

This command also runs the tests of `apps/extractor`, `apps/cli` and `apps/eval`. The engine tests are `test_classification_*.py` and `test_extraction_*.py`.

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

WARNING: Keep the connections key and the rows of `market_connection` private. With these two, a person can decrypt the Dhan access token and the FRED API key of the investor.

CAUTION: Do not change the connections key while the database holds market connections. If the key changes, `loadConnections` cannot decrypt the rows. The investor must then save each market connection again in Settings.

CAUTION: Store the new token from `renewToken` immediately. Dhan expires the old token when it gives the new token. If the caller loses the new token, the saved Dhan token does not work.

CAUTION: Set `DATABASE_URL_TEST_DB` only to a test database. Each test file of `@maester/db` calls `testDb()`, which empties the tables with `TRUNCATE … CASCADE`.

CAUTION: Run `pnpm stack:reset` only if you can lose the local data. The command deletes the Docker volumes, with the local database and the local files.

CAUTION: Do not change a migration that a database already applied. Add a new migration. `docs/DEVELOPMENT.md` gives this rule.

## Limits

- `@maester/financial-engine` in `packages/financial-engine-ts` holds the source rule only. Its README says that extraction stays in Python.
- `@maester/import` does not retry a network error. It retries a `5xx` answer two times. A second run of the same folder makes duplicates.
- The source rule matches XBRL to a PDF by company and period end. It does not use the span.
- `@maester/jobs` creates jobs and sends tasks only. It does not run jobs, lease them or retry them.
- `DiskObjectStore` is for local development and tests. `apps/api/src/env.ts` refuses `STORAGE_DRIVER=disk` when `NODE_ENV` is `production`.
- `MembershipRole` has one value only: `owner`.
- The classification model gets a maximum of 10 pages.
- The extraction workflow does not extract a statement on more than 6 pages.
- The first extraction path refuses a PDF of more than 15 MB.
- No foreign key deletes rows in other tables, except the keys from `session` and `account` to `user`. The key from `market_connection` to `user` sets `saved_by_user_id` to `null`.
- The database has no tables for portfolios, holdings, transactions, prices of holdings or notes. `docs/DATA_MODEL.md` describes them as the target design. The `market_point` table keeps only the market series for the Market mood page.
- The comments in `dhan.ts` and `instruments.ts` say that the Dhan endpoints, headers, IDs and error codes come from the Dhan documentation, not from live calls.
- The Dhan documentation does not give the response of `/RenewToken`. `renewToken` reads an expiry only if the response has one that it can parse.
- `renewToken` operates only for a token from the Dhan website.
- `HttpDhanSource` reads the token expiry and the end of the data plan as IST, because Dhan gives no time zone.

## Sources

- [`packages/config/tsconfig.base.json`](../../packages/config/tsconfig.base.json)
- [`packages/config/eslint.config.js`](../../packages/config/eslint.config.js)
- [`packages/document-index/src/index.ts`](../../packages/document-index/src/index.ts)
- [`packages/document-index/src/models.ts`](../../packages/document-index/src/models.ts)
- [`packages/document-index/src/embedder.ts`](../../packages/document-index/src/embedder.ts)
- [`packages/document-index/src/search.ts`](../../packages/document-index/src/search.ts)
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
- [`packages/financial-engine-ts/src/sources.ts`](../../packages/financial-engine-ts/src/sources.ts)
- [`apps/import/README.md`](../../apps/import/README.md)
- [`packages/db/drizzle/0008_xbrl.sql`](../../packages/db/drizzle/0008_xbrl.sql)
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
- [`packages/financial-engine/src/pdf_financial_qa/workflow/prompts.py`](../../packages/financial-engine/src/pdf_financial_qa/workflow/prompts.py)
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
- [`apps/eval/src/maester_eval/runner.py`](../../apps/eval/src/maester_eval/runner.py)
- [`tests/test_classification_rules.py`](../../tests/test_classification_rules.py)
- [`tests/test_classification_runner.py`](../../tests/test_classification_runner.py)
- [`tests/test_classification_contracts.py`](../../tests/test_classification_contracts.py)
- [`tests/test_extraction_contracts.py`](../../tests/test_extraction_contracts.py)
- [`tests/test_extraction_values.py`](../../tests/test_extraction_values.py)
- [`tests/test_extraction_workflow.py`](../../tests/test_extraction_workflow.py)
- [`packages/contracts/src/market-mood.ts`](../../packages/contracts/src/market-mood.ts)
- [`packages/contracts/src/connection.ts`](../../packages/contracts/src/connection.ts)
- [`packages/contracts/src/research.ts`](../../packages/contracts/src/research.ts)
- [`packages/contracts/test/market-mood.test.ts`](../../packages/contracts/test/market-mood.test.ts)
- [`packages/contracts/test/connection.test.ts`](../../packages/contracts/test/connection.test.ts)
- [`packages/db/src/schema/market.ts`](../../packages/db/src/schema/market.ts)
- [`packages/db/src/queries/market.ts`](../../packages/db/src/queries/market.ts)
- [`packages/db/src/queries/research.ts`](../../packages/db/src/queries/research.ts)
- [`packages/db/drizzle/0004_market.sql`](../../packages/db/drizzle/0004_market.sql)
- [`packages/db/drizzle/0005_market_connection.sql`](../../packages/db/drizzle/0005_market_connection.sql)
- [`packages/db/test/market.test.ts`](../../packages/db/test/market.test.ts)
- [`packages/db/test/market-connection.test.ts`](../../packages/db/test/market-connection.test.ts)
- [`packages/market/package.json`](../../packages/market/package.json)
- [`packages/market/src/index.ts`](../../packages/market/src/index.ts)
- [`packages/market/src/sources.ts`](../../packages/market/src/sources.ts)
- [`packages/market/src/dhan.ts`](../../packages/market/src/dhan.ts)
- [`packages/market/src/fred.ts`](../../packages/market/src/fred.ts)
- [`packages/market/src/instruments.ts`](../../packages/market/src/instruments.ts)
- [`packages/market/src/scrip.ts`](../../packages/market/src/scrip.ts)
- [`packages/market/src/secrets.ts`](../../packages/market/src/secrets.ts)
- [`packages/market/src/connections.ts`](../../packages/market/src/connections.ts)
- [`packages/market/test/secrets.test.ts`](../../packages/market/test/secrets.test.ts)
- [`packages/market/test/sources.test.ts`](../../packages/market/test/sources.test.ts)
- [`apps/api/src/routes/connections.ts`](../../apps/api/src/routes/connections.ts)
- [`apps/worker/src/env.ts`](../../apps/worker/src/env.ts)
- [`apps/worker/src/market/build.ts`](../../apps/worker/src/market/build.ts)
- [`apps/worker/src/market/refresh.ts`](../../apps/worker/src/market/refresh.ts)
- [`apps/web/src/lib/market-mood/types.ts`](../../apps/web/src/lib/market-mood/types.ts)
- [`apps/web/src/lib/settings/types.ts`](../../apps/web/src/lib/settings/types.ts)
- [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md)
- [`docs/DATA_MODEL.md`](../DATA_MODEL.md)
