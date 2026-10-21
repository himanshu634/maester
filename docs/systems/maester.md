# Maester: system description

This document gives the system level of Maester. Each app and each shared package has its own document. The Parts table links to them.

## Terms

| Term | Meaning in this document |
| --- | --- |
| Maester | The system in this repository. It reads company filings for an investor. |
| investor | The person who uses the web client. |
| web origin | The address that the browser opens, for example `http://localhost:5173`. The browser sends all requests to this address. |
| session | A sign-in record of Better Auth in the `session` table. The browser keeps it in a cookie with the prefix `maester`. |
| waitlist | The `waitlist_entry` table. Only an email with an approved row can get an account. |
| workspace | A row in the `workspace` table. Companies, documents and jobs belong to one workspace. |
| document | A row in the `document` table. It records one file that the investor added: a PDF or an XBRL instance. |
| PDF | The bytes of a document that has the format `pdf`. The object store keeps them. |
| XBRL instance | An XML file in the XBRL format. It holds the numbers of one results filing for one basis. Maester reads it with no model. |
| format | The `format` column of a document: `pdf` or `xbrl`. |
| element map | A reviewed file that says which element of an XBRL format is which line of which statement. |
| source rule | The rule that says which source gives the numbers of a statement, and if a results PDF is read, skipped or held for XBRL. |
| pipeline | The `pipeline` object of a document. It shows where the document stands on its tracks. The API works it out on each read. |
| object store | The storage for PDFs, through the `ObjectStore` interface. The drivers are `gcs` (Cloud Storage), `disk` (a local folder) and memory (tests only). |
| job | A row in the `job` table. It is one unit of background work, with a type and a state. |
| dispatch | The HTTP request that tells the worker to run one job. The dispatcher is the code that sends it. |
| task | An HTTP request from Cloud Tasks. Maester uses tasks only in the `cloud-tasks` dispatch mode. |
| lease | A lock on a job row: a random token and an expiry time. Only the holder of the lease can write the progress or the result of the job. |
| classification | A row in the `document_classification` table. It holds one set of answers about a document: the kind, the company and the period. |
| evidence | A row in the `classification_evidence` table. It tells where one answer came from: a rule, the model or the investor. |
| intake state | The `intake_state` column of a document. It tells where a stored document stands. |
| extraction | The work that reads the financial statements of a PDF into facts. |
| revision | A row in the `extraction_revision` table. It holds the result of one extraction. |
| fact | A row in the `financial_fact` table. It holds one figure from a statement. |
| extraction check | A row in the `extraction_check` table. It holds the result of one arithmetic check of the facts. |
| opened filing | The panel on the Documents page that shows one filing: the files of one company, one kind and one period. |
| market point | A row in the `market_point` table. It holds the value of one daily market series on one day, with its source. |
| market refresh | One run of the market refresher in the worker. It gets new market points from Dhan and FRED. Each market refresh that starts writes one row in the `market_fetch` table. |
| market connection | A row in the `market_connection` table. It holds the encrypted secret for one market data source: Dhan or FRED. |
| access token | The secret that Dhan gives for a market connection. |
| API key | The secret that FRED gives for a market connection. |
| reading | One of the 10 daily market values that the Market mood page shows, for example India VIX. The API uses 7 of them to calculate the market mood. |
| market mood | A score from 0 to 100. The API calculates it from 7 of the readings when the web client asks for it. |

## Function

Maester reads financial filings for an investor. The investor signs in to the web client and adds a PDF or an XBRL instance. Maester finds what the file is and which company it is for. If the file is an annual report or financial results, Maester reads the statements into facts. Each fact from a PDF keeps the page that it came from. Each fact from an XBRL instance keeps its element and its context.

If an XBRL instance covers the statements of a results PDF, Maester does not read that PDF with a model. The numbers come from the instance.

Maester also shows a market mood. It calculates the market mood from daily market data that the investor's own Dhan and FRED accounts give. The repository holds eight apps, nine shared packages and the deployment scripts.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| [API](api.md) | `apps/api` | TypeScript HTTP service (Hono). It serves sign-in at `/api/auth/*` through Better Auth and the routes for workspaces, companies, documents and jobs at `/v1`. It writes documents and jobs and dispatches jobs. It also serves the market mood at `/v1/market-mood`, the market connections at `/v1/settings/connections` and the statements and prices of a company for Research. |
| [Worker](worker.md) | `apps/worker` | TypeScript HTTP service (Hono). In the `queue` mode, it claims each job from the database. In the `cloud-tasks` mode, it receives a dispatch at `POST /tasks/:type`. It takes a lease and runs `document.verify`, `document.classify`, `document.extract`, `document.index`, `document.xbrl` or `document.xbrl_check`. If `CONNECTIONS_KEY` has a value, it also runs the market refresh on a timer. |
| [Extractor](extractor.md) | `apps/extractor` | Python HTTP service (FastAPI). It answers `POST /v1/classify` and `POST /v1/extract` for the worker and calls Gemini on Vertex AI. It also answers `POST /v1/xbrl` and `POST /v1/xbrl/pdf-check`, which call no model. It does not write data. |
| [Indexer](indexer.md) | `apps/indexer` | Python HTTP service. It answers `POST /v1/index`, `POST /v1/chunk` and `POST /v1/chunk-text` for the worker. It reads the pages of a PDF with Docling and cuts them into chunks. It does not write data. |
| [Web client](web.md) | `apps/web` | Static SvelteKit site. In a container, nginx serves it and sends `/api/auth/`, `/v1/` and `/dev/` to the API. |
| [CLI](cli.md) | `apps/cli` | Python command `maester` with `ingest`, `ask` and `list-docs`. It keeps a JSON cache in `data/cache`. It does not use the API or the database. |
| [Evaluation harness](eval.md) | `apps/eval` | Python command `maester-eval` with `live`, `export`, `freeze`, `report`, `xbrl-elements` and `xbrl-map`. It runs the extraction workflow over the public filings in `data/eval/corpus` and scores a run against the gold files in `data/eval/gold`. It does not use the API or the database. |
| [Contracts](packages.md) | `packages/contracts` | Zod shapes for requests, responses and the wire format of the extractor. |
| [Database package](packages.md) | `packages/db` | Drizzle schema, queries and migrations for Postgres. |
| [Jobs package](packages.md) | `packages/jobs` | Job creation, the dispatchers and the intake decision. The API and the worker use it. |
| [Storage package](packages.md) | `packages/storage` | The `ObjectStore` interface and its drivers. |
| [Market package](packages.md) | `packages/market` | The clients for Dhan and FRED, and the encryption of the secrets of market connections. The API and the worker use it. |
| [Financial engine](packages.md) | `packages/financial-engine` | Python engine with the namespace `pdf_financial_qa`. The extractor, the CLI and the evaluation harness use it. |
| [TypeScript engine](packages.md) | `packages/financial-engine-ts` | The source rule. |
| [Import command](packages.md) | `apps/import` | The command `pnpm --filter @maester/import run import <folder>`. It sends the PDFs and XBRL instances of a folder through the API. |
| [Shared configuration](packages.md) | `packages/config` | The base TypeScript and ESLint configuration. |
| Infrastructure | `infra` | Bash scripts that prepare a Google Cloud project and deploy the API, the worker and the web client to Cloud Run. |

The repository has three package managers:

- The pnpm workspace at the root holds `apps/api`, `apps/worker`, `apps/import` and `packages/*`. Turborepo runs its scripts.
- `apps/web` is a separate pnpm project with its own lockfile. A root `pnpm install` does not install it.
- The uv workspace holds `apps/cli`, `apps/eval`, `apps/extractor` and `packages/financial-engine`.
- `apps/indexer` is a separate uv project with its own `uv.lock`, because Docling needs torch.

## Operation

### Sign-in

1. The browser opens the static pages at the web origin. nginx sends each request for `/api/auth/`, `/v1/` or `/dev/` to the API (`apps/web/nginx.conf.template:10-26`). In development, Vite does the same (`apps/web/vite.config.ts:7-10`). Thus the session cookie belongs to the web origin.
2. The login page calls Better Auth in the browser with `signIn.email` or with `signIn.social` for Google (`apps/web/src/routes/login/+page.svelte:54-58`, `:102-106`).
3. The API gives each `/api/auth/*` request to Better Auth (`apps/api/src/app.ts:64`). Better Auth keeps users, accounts, sessions and tokens in Postgres (`apps/api/src/auth.ts:24-33`).
4. Before Better Auth creates a user, the API calls `admitOrWaitlist` (`apps/api/src/auth.ts:123-133`). If the email has no approved row, Maester creates no user and records the email as `pending` (`apps/api/test/waitlist.test.ts:18-27`). An email sign-up then gets the same answer as a good one. A Google sign-in goes back to the login page with the error `WAITLISTED` (`apps/api/test/google.test.ts:21-27`).
5. After Better Auth creates a user, the API creates one personal workspace for that user (`apps/api/src/auth.ts:134-136`).
6. An email account must confirm its address before it can sign in. The API sends the mail through the `console` driver or the `resend` driver (`apps/api/src/auth.ts:34-54`, `apps/api/src/mail/index.ts:59`).
7. Each signed-in page asks Better Auth for the session (`apps/web/src/lib/session.ts:18-27`). If there is no session, the page goes to `/login?next=` with its own path (`apps/web/src/lib/components/terminal/SignedInPage.svelte:40`, `:51-57`).
8. Each `/v1` route needs a session (`apps/api/src/app.ts:67`). Each route under `/v1/workspaces/:ws` also needs a membership in that workspace (`apps/api/src/middleware/workspace.ts:7-17`).

### Document intake

1. The Documents page reads `GET /v1/me` and uses the first workspace in the answer (`apps/web/src/lib/components/documents/DocumentsPage.svelte:383-384`).
2. The web client sends `POST /v1/workspaces/:ws/documents/uploads` with the name, the size and the type of the file. The type is `application/xml` for an `.xml` file and `application/pdf` for all other files. The API also accepts `text/xml` (`apps/web/src/lib/documents/client.ts:185-189`).
3. The API writes a document with the state `pending_upload` and returns a signed upload URL (`apps/api/src/routes/documents.ts:47-82`).
4. The browser sends the PDF with `PUT` to the signed URL (`apps/web/src/lib/documents/client.ts:197-201`). With the `gcs` driver, the URL goes to Cloud Storage. With the `disk` driver, the URL goes to `/dev/blobs/*` on the API (`apps/api/src/routes/dev.ts:117-125`).
5. The web client sends `POST .../documents/:id/finalize` (`apps/web/src/lib/documents/client.ts:202`). The API makes sure that the PDF is in the object store. Then it sets the state to `uploaded` and creates a `document.verify` job (`apps/api/src/routes/documents.ts:84-111`).
6. `createJob` writes a job with the state `queued` and a unique key, then dispatches it (`packages/jobs/src/create.ts:28-56`). A second call with the same key returns the first job and does not dispatch again.
7. In the `queue` mode, the dispatcher runs `pg_notify('job_ready', <type>)` (`packages/jobs/src/dispatch.ts`). In the `cloud-tasks` mode, it creates a task with an OIDC token.
8. In the `queue` mode, a claim loop of the worker claims the job and takes the lease (`apps/worker/src/queue.ts`, `apps/worker/src/lease.ts`). In the `cloud-tasks` mode, the worker checks the token, and `runJob` takes the lease. Then `executeJob` calls the handler for the job type (`apps/worker/src/run.ts`).
9. `document.verify` reads the file from the object store. It calculates the SHA-256 hash and the size. For a PDF, it looks for the `%PDF-` header. For an XBRL instance, it reads the first `XBRL_SNIFF_BYTES` bytes and checks that the root is an XBRL instance with no DOCTYPE (`apps/worker/src/jobs/document-verify.ts`, `apps/worker/src/sniff.ts`). A good file gets the state `stored`. A bad file gets the state `rejected` with the code `UNSUPPORTED_TYPE`.
10. The worker compares the hash of a stored document with the other stored documents in the workspace. A copy gets the intake state `duplicate`. Any other document gets `identifying` and a `document.classify` job (`apps/worker/src/jobs/document-verify.ts:15-46`).
11. `document.classify` sends the PDF to `POST /v1/classify` on the extractor (`apps/worker/src/jobs/document-classify.ts:96-134`, `apps/worker/src/extractor.ts:71-81`). The extractor returns one JSON object with the kind, the company as printed, the period and the evidence (`apps/extractor/src/maester_extractor/app.py:188-205`).
12. If the investor gave no company, the worker looks for one company in the workspace that agrees with the printed identifiers or name (`apps/worker/src/jobs/document-classify.ts:78-81`). Then it writes the classification and its evidence in one transaction (`apps/worker/src/jobs/document-classify.ts:16-76`).
13. `decideIntake` sets the next intake state (`packages/jobs/src/intake.ts:36-71`):
    - The kind `not_sure` gives `needs_kind`.
    - The kind `other` gives `kept`.
    - An annual report or financial results without a company gives `needs_company`.
    - An annual report or financial results with a company gives `reading` and a new `document.extract` job.
14. `document.extract` sends the PDF to `POST /v1/extract` (`apps/worker/src/jobs/document-extract.ts:141-187`). The extractor answers with an NDJSON stream: `started`, then `progress` and `heartbeat` lines, then one `result` or one `error` (`apps/extractor/src/maester_extractor/app.py:123-186`). For each line, the worker extends its lease (`apps/worker/src/jobs/document-extract.ts:175-178`).
15. The worker writes the result in one transaction: one revision with its facts, its `source_reference` rows and its extraction checks (`apps/worker/src/jobs/document-extract.ts:36-128`). Then it sets the intake state to `read` (`apps/worker/src/jobs/document-extract.ts:131-139`).
16. While a track of the opened filing is live, the Documents page reads `GET .../documents/:id` for each file of the filing every 2 seconds (`apps/web/src/lib/documents/intake.ts:24`, `apps/web/src/lib/components/documents/DocumentsPage.svelte:354-378`). While another filing in the list "Working on" is live, the page reads `GET .../filings` every 5 seconds (`apps/web/src/lib/documents/intake.ts:27`, `apps/web/src/lib/components/documents/DocumentsPage.svelte:316`). The page also reads `GET .../filings` one time when a polled file changes its state, its intake state or its identification.
17. The page shows the two tracks of each filing, the source of each statement, the classification and its evidence. It does not show facts.
18. In parallel, `document.verify` creates a `document.index` job for each stored document that is not a duplicate. The job sends the PDF to the indexer one range at a time. It keeps the pages and the chunks. It sends the chunks to the embedder for their vectors. The API route `GET .../search` finds the chunks. Read the [worker description](worker.md) and the [indexer description](indexer.md).

### XBRL intake

An XBRL instance follows the steps of the document intake up to `document.verify`. The API sets the format `xbrl` from the declared type. The object key ends in `original.xml`. These steps differ:

1. `document.classify` sends the instance to `POST /v1/xbrl` with the mode `classify`. The extractor finds the format, the company identifiers, the basis, the period and the span from the elements of the instance. No model runs.
2. An instance with both bases or no basis gets the kind `not_sure` and the warning `XBRL_MIXED_BASIS`. It waits for the investor.
3. If the classification has a company, `decideIntake` sets `reading` and creates a `document.xbrl` job. If the company is not known, the investor confirms the printed identity once for all the files that print it, with `POST .../companies/confirm`.
4. `document.xbrl` sends the instance to `POST /v1/xbrl` with the mode `read`. The worker writes a revision with the source `xbrl`. Each fact has its span, its period, its unit and its element. The read also does the sum checks of the element map.
5. A format with no element map (banking, NBFC, other than Ind AS) writes no fact. The classification and the text are still stored. The warning is `XBRL_FORMAT_UNMAPPED`.
6. After the read, the worker pairs the instance with the results PDF of the same company and period end. A `document.xbrl_check` job looks for each XBRL value on the statement pages of the PDF.
7. The worker also decides again each results PDF that waited for XBRL. `document.index` cuts the text blocks of the instance into chunks with `text_source` `xbrl`.

A results PDF follows the source rule at the intake decision:

1. The PDF waits in the state `waiting_for_xbrl` if an XBRL document of its company and period can still settle.
2. If settled XBRL covers each statement and basis that the PDF prints, the worker does not read the PDF with the model. The PDF gets the state `read` with no revision.
3. Else the worker reads the PDF with `document.extract`.

A person can add a whole folder of PDFs and instances from the command line. See the procedure "To import a folder".

### Change by the investor

1. The investor can change the kind, the company or the period of a document in the opened filing. The web client sends `POST .../documents/:id/classification` (`apps/web/src/lib/documents/client.ts:135-140`). The body names the classification that the change starts from, in the field `basedOn`.
2. The API locks the document row and writes a new classification with `setBy` equal to `investor` (`apps/api/src/routes/classification.ts:35-65`). If `basedOn` is not the current classification, the API answers `CONFLICT`. If the new kind is `annual_report` and the document is an XBRL instance, the API answers `VALIDATION_FAILED`.
3. The API then calls `decideIntake`, which can start a new `document.extract` job, or a `document.xbrl` job for an XBRL instance (`apps/api/src/routes/classification.ts:51`).
4. The opened filing can also start the work again. The web client then sends `POST .../classify`, `POST .../extract` or `POST .../index` (`apps/web/src/lib/documents/client.ts:143-165`). Each call creates a new job (`apps/api/src/routes/classification.ts:67-85`, `apps/api/src/routes/documents.ts:185-201`, `apps/api/src/routes/documents.ts:205-222`).

### Market connections

1. The Settings page reads `GET /v1/settings/connections` (`apps/web/src/lib/settings/client.ts:27-29`). The routes for market connections need a session but no workspace (`apps/api/src/app.ts:77-80`).
2. Each of these routes needs `CONNECTIONS_KEY`. Without it, the API answers `INVALID_STATE` (`apps/api/src/routes/connections.ts:65-74`).
3. The investor saves a Dhan access token or a FRED API key with `PUT` (`apps/web/src/lib/settings/client.ts:30-35`). The secret goes only in the request body.
4. Before the API keeps a secret, it calls the source one time to check it (`apps/api/src/routes/connections.ts:86-117`). For Dhan, the client ID that Dhan returns must agree with the client ID in the request.
5. The API keeps the secret as AES-256-GCM ciphertext and keeps its last 4 characters (`apps/api/src/routes/connections.ts:97-101`, `packages/market/src/secrets.ts:11-18`). No answer contains the secret.
6. If the check fails, the API logs only the provider, the error code and the error name (`apps/api/src/routes/connections.ts:42-50`).
7. If Dhan accepts the access token but the Data API subscription is off, the API keeps the market connection with the notice `DATA_PLAN_INACTIVE` (`apps/api/src/routes/connections.ts:19-35`, `:100`).
8. `DELETE /v1/settings/connections/:provider` deletes the market connection (`apps/api/src/routes/connections.ts:119-124`). The market points stay.

### Market refresh

1. If `CONNECTIONS_KEY` has a value, the worker starts the market schedule (`apps/worker/src/server.ts:28-33`).
2. The first market refresh starts 10 seconds later. Then a market refresh starts every `MARKET_REFRESH_MINUTES`, with the default 30 (`apps/worker/src/market/schedule.ts:3-40`, `apps/worker/src/env.ts:37`).
3. A new market refresh does not start while the last one continues (`apps/worker/src/market/schedule.ts:25-38`). It also stops if a `market_fetch` row from the last hour has the state `running` (`packages/db/src/queries/market.ts:57-65`).
4. Each market refresh decrypts the saved market connections. Then it gets new market points from FRED and from Dhan (`apps/worker/src/market/refresh.ts:110-134`).
5. A series without stored points starts 4 years back (`apps/worker/src/market/refresh.ts:85`).
6. If a Dhan access token has less than 6 hours left, the worker gets a new access token from Dhan and keeps it (`apps/worker/src/market/refresh.ts:39`, `:187-215`).
7. If Dhan refuses the access token, or FRED refuses the API key, the worker writes the error code on the market connection (`apps/worker/src/market/refresh.ts:155-156`).
8. At the end, the worker writes `ok` or `failed` in the `market_fetch` row. A Dhan failure comes before a FRED failure (`apps/worker/src/market/refresh.ts:136-142`).

### Market mood

1. The Market mood page reads `GET /v1/market-mood` (`apps/web/src/lib/market-mood/client.ts:10-12`). This route needs a session but no workspace (`apps/api/src/app.ts:77-79`).
2. The API reads the market points of the last 4 years and the last `market_fetch` row (`apps/api/src/routes/market-mood.ts:9-24`).
3. `computeMood` ranks each reading against its own last 500 values. A reading with fewer than 250 values has no rank (`apps/api/src/market-mood/compute.ts:12-13`, `:103-104`).
4. The market mood is the rounded average of the scores of the 7 readings that the API uses. It needs a score for at least 5 of them (`apps/api/src/market-mood/compute.ts:14`, `:130-134`).
5. `GET /v1/market-mood/readings/:key` returns one reading and its last 500 values (`apps/api/src/routes/market-mood.ts:26-31`, `apps/api/src/market-mood/compute.ts:162`).
6. While the tab shows, the page reads the market mood again every 10 minutes (`apps/web/src/lib/components/market-mood/MarketMoodPage.svelte:30`, `:57-61`).
7. The page shows the state of the last market refresh in a notice. If the investor must act, the notice has a link to Settings (`apps/web/src/lib/market-mood/view.ts:202-240`).

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| Document `pending_upload` | The API created the upload. | The browser sends the PDF and then calls `finalize`. |
| Document `uploaded` | `finalize` found the PDF in the object store. | A `document.verify` job starts. |
| Document `verifying` | The verify job runs. | The worker reads the file. |
| Document `stored` | The file is a PDF with the `%PDF-` header, or an XBRL instance with no DOCTYPE. It is not larger than `MAX_UPLOAD_BYTES`. | Intake starts. |
| Document `rejected` with `UNSUPPORTED_TYPE`, `TOO_LARGE` or `OBJECT_MISSING` | The file is not a PDF or an XBRL instance, or it is too large, or the object store did not have it. | The document stops. The investor must add the file again. |
| Intake `duplicate` | A stored document in the workspace has the same SHA-256 hash. | Maester does not classify or read it. |
| Intake `identifying` | Verify stored the PDF. | `document.classify` runs. |
| Intake `needs_kind` | The extractor answered `not_sure`. | The investor selects the kind. |
| Intake `needs_company` | No company or more than one company agrees with the printed details. | The investor selects or adds the company. |
| Intake `kept` | The kind is `other`. | Maester keeps the document and does not read it. |
| Intake `reading` | The kind is a kind that Maester reads, and the document has a company. | `document.extract` runs for a PDF. `document.xbrl` runs for an XBRL instance. |
| Intake `waiting_for_xbrl` | A results PDF waits for an XBRL document of its company and period. | No job runs. The worker decides again when the XBRL document settles. |
| `XBRL_UNREADABLE` | The extractor refuses an instance: it is malformed, too large, has a DOCTYPE, has too many facts or takes too long. | The job fails without a second run. The intake state goes to `read_failed`. |
| Intake `read` | The revision is in the database, or XBRL covers the results PDF. | `GET .../extraction` and `GET .../facts` return the result. A skipped PDF has no revision. |
| Intake `identify_failed` | The last run of `document.classify` failed. | The investor can send `POST .../classify`. |
| Intake `read_failed` | The last run of `document.extract` failed. | The investor can send `POST .../extract`. |
| Job `queued`, `running`, `succeeded`, `failed` | The worker changes the state under its lease. | The API returns the latest job of a document as `latestJob`. |
| Job `cancelled` | Not known. No code in `apps` or `packages` sets this state. | Not known. |
| Error that the worker can try again | The handler failed, the error is not a permanent `JobFailure`, and the job has runs left. The default maximum is 5 runs. | The job goes back to `queued`. In the `queue` mode, the worker claims the job again after the backoff. In the `cloud-tasks` mode, the worker answers 500 and Cloud Tasks sends the task again. |
| Permanent error, or the last run | The handler failed with a permanent `JobFailure`, or the job has no runs left. | The job goes to `failed`. The handler can set `identify_failed` or `read_failed`. |
| `lease_held` (409 from the worker) | Another run holds a lease that did not expire. | The worker does not run the job. |
| `CLASSIFIER_NOT_CONFIGURED` | The worker has no `EXTRACTOR_URL`. | The classify job fails without a second run. The intake state goes to `identify_failed`. |
| `EXTRACTOR_NOT_CONFIGURED` | The extractor has no `GOOGLE_CLOUD_PROJECT` or no Google credentials. | The job fails without a second run. |
| `EXTRACTOR_UNAUTHORIZED` | The worker and the extractor have different values of `EXTRACTOR_SECRET`. | The job fails without a second run. |
| `UNAUTHENTICATED` (401) | A `/v1` request has no session. | The API returns the error. |
| `WAITLISTED` | A Google sign-in for an email without an approved row in `waitlist_entry`. | Maester creates no account. The browser goes to `/login` with this error. The email gets a `pending` row. |
| Email sign-up without approval | The email has no approved row in `waitlist_entry`. | Maester creates no account but gives the usual answer (200). The email gets a `pending` row. |
| `NOT_FOUND` (404) | The user has no membership in the workspace, or the record is not in it. | The API returns the error. |
| `UPLOAD_TOO_LARGE` (413) | The declared size is larger than `MAX_UPLOAD_BYTES` (50 MiB). | The API does not create the document. |
| `CONFLICT` (409) | `basedOn` is not current, or a company with the same name or identifier exists. | The API returns the error. |
| `INVALID_STATE` (409) | The action does not agree with the document state, for example `finalize` before the PDF arrived. | The API returns the error. |
| `INVALID_STATE` (409) without `CONNECTIONS_KEY` | The API has no `CONNECTIONS_KEY`. | Each route for market connections returns this error. The Settings page does not load. |
| No `CONNECTIONS_KEY` in the worker | The worker has no `CONNECTIONS_KEY`. | The worker does not start the market schedule. It writes this in its log. |
| Market refresh `running`, `ok`, `failed` | The worker writes the state of each market refresh in `market_fetch`. | The Market mood page shows a notice for a failed market refresh and for the first market refresh. |
| Market connection `not_connected`, `connected`, `expired`, `failing` | The API calculates the state from the row, the expiry time and `last_error_code`. | The Settings page shows the state in a word. |
| `VALIDATION_FAILED` (400) on a market connection | Dhan or FRED refused the secret, or the client ID does not agree. | The API keeps nothing. |
| `RATE_LIMITED` (429) on a market connection | Dhan asked for fewer requests in the check. | The API keeps nothing. |
| `INTERNAL` (503) with `SOURCE_UNAVAILABLE` | The source did not answer the check. | The API keeps nothing. |
| No market mood | Fewer than 5 of the 7 readings that the API uses have a score. | The API returns `score: null`. The page tells why. |

## Data

### Containers and connections

`docker-compose.yml` starts these containers:

| Container | Image source | Port on the host | Connects to |
| --- | --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | 5433 | None |
| `migrate` | `apps/api/Dockerfile` | None | `postgres`. It applies the migrations and stops. |
| `api` | `apps/api/Dockerfile` | 8787 | `postgres`, `embedder`, the `blobs` volume |
| `worker` | `apps/worker/Dockerfile` | 8788 | `postgres`, `extractor`, `indexer`, `embedder`, the `blobs` volume |
| `extractor` | `apps/extractor/Dockerfile` | 8790 | Vertex AI. It reads Google credentials from a folder that it mounts read-only. |
| `models` | `apps/indexer/Dockerfile` | None | The `models` volume. It runs one time, by hand, in the profile `setup`. It gets the weights and stops. |
| `indexer` | `apps/indexer/Dockerfile` | 8791 | The `models` volume, read-only |
| `embedder` | `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9` | 8792 (container port 80) | The `models` volume, read-only |
| `web` | `apps/web/Dockerfile` | 5173 (container port 8080) | `api` (nginx sends `/api/auth/`, `/v1/` and `/dev/` to it) |

The worker and the API do not wait for the indexer or the embedder. Until they answer, index jobs wait and retry, and the search route sends status 503. The volume `models` keeps the weights. The volume `pgdata` keeps the database. The volume `blobs` keeps the PDFs for the `disk` driver. The API and the worker share it.

### Database

Postgres 16 holds one database, `maester`. The schema is in `packages/db/src/schema`. The migrations are in `packages/db/drizzle`. Of the six apps, only the API and the worker connect to the database.

| Group | Tables |
| --- | --- |
| Sign-in | `user`, `session`, `account`, `verification`, `rate_limit`, `waitlist_entry` |
| Platform | `workspace`, `membership`, `company`, `document`, `job` |
| Classification | `document_classification`, `classification_evidence` |
| Extraction | `extraction_revision`, `financial_fact`, `source_reference`, `extraction_check`, `xbrl_source` |
| Market | `market_point`, `market_fetch`, `market_connection` |

The market tables have no workspace column. The market points and the market connections belong to the installation, not to a user or a workspace.

On a new `pgdata` volume, `scripts/db/init.sql` also creates the test databases `maester_test_db`, `maester_test_api` and `maester_test_worker`.

### Object storage

The API and the worker keep each file at the key `workspaces/{workspace}/documents/{document}/original.pdf`, or `original.xml` for an XBRL instance, (`apps/api/src/routes/documents.ts:35-37`). The `gcs` driver signs Cloud Storage URLs of version 4. The `disk` driver signs URLs to `/dev/blobs/*` with an HMAC-SHA256 signature and an expiry time. The API and the worker refuse the `disk` driver when `NODE_ENV` is `production`.

### Job dispatch

Maester has no separate queue in the local stack. The `job` table holds the state of each job. The `queue` mode notifies the worker through Postgres, and the worker claims each job from the `job` table. The `cloud-tasks` mode uses the Cloud Tasks queue `maester-jobs`. `infra/bootstrap.sh` sets that queue to unlimited tries for a maximum of 24 hours. Thus the `max_attempts` column of the job also limits the runs.

### External services

| Service | Used by | Purpose |
| --- | --- | --- |
| Google OAuth | API | Sign-in with Google. It is off when `GOOGLE_CLIENT_ID` has no value. |
| Resend | API | Confirmation and reset mail when `MAIL_DRIVER` is `resend`. |
| Hugging Face | `models` service | The weights, one time. Nothing is fetched at run time. |
| Gemini on Vertex AI | Extractor, CLI, evaluation harness | Classification, extraction and the answers of the CLI. The `live` command of the evaluation harness runs extraction. |
| Cloud Storage | API, worker | PDFs when `STORAGE_DRIVER` is `gcs`. |
| Cloud Tasks | API, worker | Dispatch when `DISPATCH_MODE` is `cloud-tasks`. In `queue` mode, Postgres does this work. |
| Cloud Run, Cloud SQL, Secret Manager, Artifact Registry | `infra` scripts | Deployment of the API, the worker and the web client. |
| Dhan Data API | API, worker | The check of a saved access token. The daily market data of India: Nifty 50, India VIX, MCX gold, the option chain and the Nifty 500 closes. |
| FRED | API, worker | The check of a saved API key. US VIX and the rupee per US dollar. |

## Procedures

### To start the whole stack in Docker

1. Install Docker with Compose version 2.
2. Go to the root of the repository.
3. Build the indexer image and get the weights. Do this one time. The [development guide](../DEVELOPMENT.md) gives the commands.
4. Start the stack:

   ```bash
   docker compose up --build
   ```

5. Open `http://localhost:5173` in a browser.
6. To stop the stack and keep the data, run this command:

   ```bash
   pnpm stack:down
   ```

### To sign in to the local stack

1. Copy the example environment file:

   ```bash
   cp -n .env.example .env
   ```

2. Install the root packages:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Approve your email on the waitlist:

   ```bash
   pnpm --filter @maester/db waitlist:approve you@example.com
   ```

4. Open `http://localhost:5173/signup` and create the account.
5. Find the confirmation link in the API log:

   ```bash
   docker compose logs api
   ```

6. Open the link in the same browser.
7. Sign in at `http://localhost:5173/login`.

### To import a folder of filings

You can send a folder of PDFs and XBRL instances through the API. The command reads the session cookie of the investor from the environment.

1. Sign in to Maester in the browser.
2. Copy the session cookie as `name=value`. The name is `maester.session_token` in development and `__Secure-maester.session_token` in production.
3. Set the cookie and the workspace ID:

   ```bash
   export MAESTER_SESSION_COOKIE='maester.session_token=<value>'
   export MAESTER_WORKSPACE=<workspace id>
   ```

4. Run the import. Use `run import`, because `pnpm import` is a built-in command of pnpm:

   ```bash
   pnpm --filter @maester/import run import <folder>
   ```

5. Read the last line. It shows the counts of sent, refused and failed files.

The command sends four files at a time. A second run of the same folder makes duplicates. Maester does not read a duplicate again.

### To let the extractor call Gemini

1. Get Application Default Credentials:

   ```bash
   gcloud auth application-default login
   ```

2. In `.env`, set `GOOGLE_CLOUD_PROJECT` to your Google Cloud project.
3. In `.env`, set `GCLOUD_CONFIG_DIR` to the absolute path of your gcloud configuration folder.
4. Start the extractor again:

   ```bash
   docker compose up -d extractor
   ```

### To run the services without Docker

1. If the Docker stack runs, stop it, because it uses the same ports 8787, 8788, 8790 and 5173.
2. Copy `.env.example` to `.env`, as in the procedure above.
3. Install the root packages and the Python packages:

   ```bash
   pnpm install --frozen-lockfile
   uv sync --locked
   ```

4. Start Postgres alone:

   ```bash
   pnpm db:up
   ```

5. Set `DATABASE_URL` in the shell, because the migration script does not read `.env`:

   ```bash
   export DATABASE_URL=postgres://maester:maester@localhost:5433/maester
   ```

6. Apply the migrations:

   ```bash
   pnpm --filter @maester/db migrate
   ```

7. In a new terminal, start the API:

   ```bash
   pnpm dev:api
   ```

8. In a new terminal, start the worker:

   ```bash
   pnpm dev:worker
   ```

9. In a new terminal, start the extractor:

   ```bash
   uv run --locked maester-extractor
   ```

10. Install the packages of the web client:

    ```bash
    pnpm --dir apps/web install --frozen-lockfile
    ```

11. Start the web client:

    ```bash
    pnpm --dir apps/web dev
    ```

12. Open `http://localhost:5173`, not the port of the API, because the session cookie belongs to the web origin.

### To run all checks

1. Install the root packages:

   ```bash
   pnpm install --frozen-lockfile
   ```

2. Install the packages of the web client:

   ```bash
   pnpm --dir apps/web install --frozen-lockfile
   ```

3. Install the Python packages:

   ```bash
   uv sync --locked
   ```

4. Start Postgres:

   ```bash
   pnpm db:up
   ```

5. Set the three test databases in the shell:

   ```bash
   export DATABASE_URL_TEST_DB=postgres://maester:maester@localhost:5433/maester_test_db
   export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:5433/maester_test_api
   export DATABASE_URL_TEST_WORKER=postgres://maester:maester@localhost:5433/maester_test_worker
   ```

6. Run the TypeScript checks from the root:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

7. Run the checks of the web client:

   ```bash
   pnpm --dir apps/web verify
   ```

8. Run the Python checks:

   ```bash
   make check
   ```

9. If `pnpm test` cannot connect to a test database, do the procedure "To delete the local data".

Note: `scripts/db/init.sql` creates the test databases only on a new `pgdata` volume.

### To delete the local data

CAUTION: This procedure deletes the database and all PDFs in the local stack. You cannot get them back.

1. Stop the stack and delete its volumes:

   ```bash
   pnpm stack:reset
   ```

2. Start the stack again:

   ```bash
   docker compose up --build
   ```

## Warnings and cautions

WARNING: Do not use the secrets from `docker-compose.yml` or `.env.example` on a shared host. All readers of this repository know them. `BETTER_AUTH_SECRET` protects the sessions and the local upload URLs.

WARNING: Control who can read the logs of the API and of nginx. Confirmation links and reset links are in the query strings of requests. A confirmation link that nobody used signs in the person who opens it.

WARNING: Keep `CONNECTIONS_KEY` private. A person with this key and a copy of the database can decrypt the Dhan access token and the FRED API key.

CAUTION: Do not change `CONNECTIONS_KEY` after you save a market connection. The worker cannot decrypt a secret that an old key encrypted. Then you must save each market connection again.

CAUTION: `pnpm stack:reset` deletes the `pgdata` and `blobs` volumes. Use `pnpm stack:down` to stop the stack and keep the data.

## Limits

- The web client does not show revisions. It shows facts and their checks only on the Research company page, from read annual reports. The API routes `GET .../extraction` and `GET .../facts` and the page `/dev/upload` return the revisions.
- `POST .../jobs/:id/retry` accepts a `queued` job only after 5 minutes.
- `infra/deploy.sh` does not deploy the extractor. The deployed worker has no `EXTRACTOR_URL`.
- The deployed worker also has no `GOOGLE_CLOUD_PROJECT` and no `WORKER_INVOKER_SA` (`infra/deploy.sh:60`). Thus its dispatcher cannot send a `document.classify` job (`apps/worker/src/dispatch.ts:8-13`).
- Each user has one personal workspace. The Documents page uses only the first workspace.
- Approval of an email is a script. There is no screen for it.
- Maester has no portfolio or holdings yet. In the terminal, Documents, Research, Market mood and Settings work. The other pages tell what they will do.
- Each signed-in user reads and changes the same two market connections. The market data has no owner.
- `infra/deploy.sh` does not set `CONNECTIONS_KEY`. Thus, the deployed API refuses the routes for market connections, and the deployed worker does not run the market refresh.
- The CLI does not share data with the API, the worker or the database.
- `packages/financial-engine-ts` holds only the source rule.
- Only two XBRL formats have an element map: Ind AS in the `in-capmkt` family and Ind AS in the `in-bse-fin` family. Other formats are read and write no fact.
- The `xbrl_in_pdf` check compares absolute values and counts a match anywhere on a statement page. The first evaluation report measures how often a number is found by chance.
- A text or chunker version change does not rebuild the index of an XBRL document through the backfill.

## Sources

- [`docker-compose.yml`](../../docker-compose.yml)
- [`package.json`](../../package.json), [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml), [`pyproject.toml`](../../pyproject.toml), [`turbo.json`](../../turbo.json), [`Makefile`](../../Makefile), [`.env.example`](../../.env.example)
- [`scripts/db/init.sql`](../../scripts/db/init.sql)
- [`apps/api/src/app.ts`](../../apps/api/src/app.ts), [`apps/api/src/auth.ts`](../../apps/api/src/auth.ts), [`apps/api/src/env.ts`](../../apps/api/src/env.ts), [`apps/api/src/errors.ts`](../../apps/api/src/errors.ts), [`apps/api/src/store.ts`](../../apps/api/src/store.ts), [`apps/api/src/mail/index.ts`](../../apps/api/src/mail/index.ts)
- [`apps/api/src/middleware/workspace.ts`](../../apps/api/src/middleware/workspace.ts), [`apps/api/src/routes/documents.ts`](../../apps/api/src/routes/documents.ts), [`apps/api/src/routes/classification.ts`](../../apps/api/src/routes/classification.ts), [`apps/api/src/routes/dev.ts`](../../apps/api/src/routes/dev.ts), [`apps/api/src/routes/jobs.ts`](../../apps/api/src/routes/jobs.ts), [`apps/api/src/jobs/create.ts`](../../apps/api/src/jobs/create.ts)
- [`apps/worker/src/app.ts`](../../apps/worker/src/app.ts), [`apps/worker/src/auth.ts`](../../apps/worker/src/auth.ts), [`apps/worker/src/env.ts`](../../apps/worker/src/env.ts), [`apps/worker/src/dispatch.ts`](../../apps/worker/src/dispatch.ts), [`apps/worker/src/run.ts`](../../apps/worker/src/run.ts), [`apps/worker/src/lease.ts`](../../apps/worker/src/lease.ts), [`apps/worker/src/extractor.ts`](../../apps/worker/src/extractor.ts)
- [`apps/worker/src/jobs/document-verify.ts`](../../apps/worker/src/jobs/document-verify.ts), [`apps/worker/src/jobs/document-classify.ts`](../../apps/worker/src/jobs/document-classify.ts), [`apps/worker/src/jobs/document-extract.ts`](../../apps/worker/src/jobs/document-extract.ts)
- [`apps/indexer/README.md`](../../apps/indexer/README.md), [`docker-compose.yml`](../../docker-compose.yml)
- [`apps/extractor/src/maester_extractor/app.py`](../../apps/extractor/src/maester_extractor/app.py), [`apps/extractor/src/maester_extractor/settings.py`](../../apps/extractor/src/maester_extractor/settings.py)
- [`apps/web/nginx.conf.template`](../../apps/web/nginx.conf.template), [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts), [`apps/web/package.json`](../../apps/web/package.json), [`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts), [`apps/web/src/routes/login/+page.svelte`](../../apps/web/src/routes/login/+page.svelte), [`apps/web/src/lib/components/terminal/SignedInPage.svelte`](../../apps/web/src/lib/components/terminal/SignedInPage.svelte)
- [`apps/api/src/routes/market-mood.ts`](../../apps/api/src/routes/market-mood.ts), [`apps/api/src/market-mood/compute.ts`](../../apps/api/src/market-mood/compute.ts), [`apps/api/src/routes/connections.ts`](../../apps/api/src/routes/connections.ts)
- [`apps/worker/src/server.ts`](../../apps/worker/src/server.ts), [`apps/worker/src/market/schedule.ts`](../../apps/worker/src/market/schedule.ts), [`apps/worker/src/market/refresh.ts`](../../apps/worker/src/market/refresh.ts)
- [`packages/market/src/secrets.ts`](../../packages/market/src/secrets.ts), [`packages/market/src/connections.ts`](../../packages/market/src/connections.ts), [`packages/db/src/schema/market.ts`](../../packages/db/src/schema/market.ts), [`packages/db/src/queries/market.ts`](../../packages/db/src/queries/market.ts)
- [`apps/web/src/lib/market-mood/client.ts`](../../apps/web/src/lib/market-mood/client.ts), [`apps/web/src/lib/market-mood/view.ts`](../../apps/web/src/lib/market-mood/view.ts), [`apps/web/src/lib/components/market-mood/MarketMoodPage.svelte`](../../apps/web/src/lib/components/market-mood/MarketMoodPage.svelte), [`apps/web/src/lib/settings/client.ts`](../../apps/web/src/lib/settings/client.ts), [`apps/web/src/lib/content/settings.ts`](../../apps/web/src/lib/content/settings.ts)
- [`apps/web/src/lib/documents/client.ts`](../../apps/web/src/lib/documents/client.ts), [`apps/web/src/lib/documents/intake.ts`](../../apps/web/src/lib/documents/intake.ts), [`apps/web/src/lib/components/documents/DocumentsPage.svelte`](../../apps/web/src/lib/components/documents/DocumentsPage.svelte), [`apps/web/src/lib/terminal/pages.ts`](../../apps/web/src/lib/terminal/pages.ts)
- [`apps/cli/src/maester_cli/cli.py`](../../apps/cli/src/maester_cli/cli.py), [`packages/financial-engine/src/pdf_financial_qa/config.py`](../../packages/financial-engine/src/pdf_financial_qa/config.py), [`apps/eval/src/maester_eval/cli.py`](../../apps/eval/src/maester_eval/cli.py)
- [`packages/jobs/src/create.ts`](../../packages/jobs/src/create.ts), [`packages/jobs/src/dispatch.ts`](../../packages/jobs/src/dispatch.ts), [`packages/jobs/src/intake.ts`](../../packages/jobs/src/intake.ts)
- [`packages/db/src/schema`](../../packages/db/src/schema), [`packages/db/src/queries/waitlist.ts`](../../packages/db/src/queries/waitlist.ts), [`packages/db/package.json`](../../packages/db/package.json), [`packages/db/src/migrate-cli.ts`](../../packages/db/src/migrate-cli.ts)
- [`packages/storage/src/index.ts`](../../packages/storage/src/index.ts), [`packages/storage/src/gcs.ts`](../../packages/storage/src/gcs.ts), [`packages/storage/src/disk.ts`](../../packages/storage/src/disk.ts), [`packages/financial-engine-ts/src/index.ts`](../../packages/financial-engine-ts/src/index.ts)
- [`apps/api/test/waitlist.test.ts`](../../apps/api/test/waitlist.test.ts), [`apps/api/test/google.test.ts`](../../apps/api/test/google.test.ts)
- [`infra/bootstrap.sh`](../../infra/bootstrap.sh), [`infra/deploy.sh`](../../infra/deploy.sh), [`infra/README.md`](../../infra/README.md)
- [`.github/workflows/ts.yml`](../../.github/workflows/ts.yml), [`.github/workflows/check.yml`](../../.github/workflows/check.yml)
- [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md), for the prerequisites and the local sign-in steps
