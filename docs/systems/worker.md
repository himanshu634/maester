# Worker: system description

## Terms

| Term | Meaning in this document |
| --- | --- |
| Worker | The `apps/worker` service. It runs jobs. |
| API | The `apps/api` service. It creates the first job for each uploaded document. |
| Job | One row in the `job` table. A job tells the worker to do one task on one subject. |
| Job type | The `type` column of a job: `document.verify`, `document.classify` or `document.extract`. |
| Handler | The function that does the work for one job type. |
| `attempt` | The `attempt` column of a job. The worker adds 1 to it each time that it starts the job. |
| `maxAttempts` | The `max_attempts` column of a job. The default value is 5. |
| Lease | A time limit in which only one worker process can run a job. The `lease_token` and `lease_expires_at` columns hold the lease. |
| Lease token | A random UUID that `acquireLease` writes to `lease_token`. Only the process with this token can change the job. |
| Dispatch request | The HTTP request `POST /tasks/:type` with the JSON body `{ "jobId": "<uuid>" }`. It tells the worker to run a job. |
| Dispatch mode | The value of `DISPATCH_MODE`: `local` or `cloud-tasks`. |
| Dispatcher | The object that sends a dispatch request for a new job: `LocalHttpDispatcher` or `CloudTasksDispatcher`. |
| Idempotency key | The `idempotency_key` column of a job, in the form `<type>:<subjectId>:<pipelineVersion>`. Each key is unique. |
| Extractor | The `apps/extractor` service. It reads a PDF and sends back answers and facts. See [extractor](extractor.md). |
| Extractor client | `HttpExtractorClient`, the part of the worker that sends a PDF to the extractor. |
| Object store | The storage for uploaded files: a local directory (`disk`) or a Google Cloud Storage bucket (`gcs`). |
| Classification | One row in the `document_classification` table. It holds the answers about what a document is: kind, company and period. |
| Read kind | The classification kind `annual_report` or `financial_results`. The worker reads the statements only for these two kinds. |
| Evidence | The rows in the `classification_evidence` table. Each row tells where one answer came from: a rule, the model or the investor. |
| Read job | A `document.extract` job for one classification. A read job is current when `reads_under_id` of the current classification is the classification of the read job. |
| Revision | One row in the `extraction_revision` table, with its facts, source references and checks. |
| Document state | The `state` column of a `document` row: `pending_upload`, `uploaded`, `verifying`, `stored` or `rejected`. |
| Intake state | The `intake_state` column of a `document` row. It tells what the worker did with a `stored` document. It is empty before the document is `stored`. |
| `JobFailure` | An error with a stable code and a `retryable` flag. A handler throws it. |
| Final failure | The worker sets the job to `failed` and does not try the job again. |
| Retry | The worker sets the job to `queued` again after a failure that is not final. Then a new dispatch request can run the job. |

## Function

The worker runs the background jobs for document intake. It receives a dispatch request, takes the lease on the job and runs the handler for the job type. The three handlers verify an uploaded PDF, classify the PDF and read its financial statements. The worker writes all results to the Postgres database. The API creates the first job, and the worker creates the next jobs. For the full system, see the [Maester overview](maester.md).

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Server entry | `apps/worker/src/server.ts` | Reads the environment. Makes the database client, the object store, the dispatcher and the extractor client. Starts the HTTP server. |
| HTTP app | `apps/worker/src/app.ts` | Has the routes `GET /healthz` and `POST /tasks/:type`. Checks the request and the body, then calls `runJob`. |
| Request check | `apps/worker/src/auth.ts` | `verifyDispatchRequest` checks the shared secret or the OIDC token. |
| Job runner | `apps/worker/src/run.ts` | `runJob` takes the lease, runs the handler and records the result or the error. |
| Lease functions | `apps/worker/src/lease.ts` | `acquireLease`, `renewLease`, `writeProgress`, `completeJob` and `failAttempt`. |
| Handler registry | `apps/worker/src/jobs/index.ts` | Connects each job type to its handler. |
| Handler types | `apps/worker/src/jobs/types.ts` | `JobContext`, `JobHandler` and `JobFailure`. |
| Verify handler | `apps/worker/src/jobs/document-verify.ts` | `documentVerify`. |
| Classify handler | `apps/worker/src/jobs/document-classify.ts` | `documentClassify` and `writeClassification`. |
| Extract handler | `apps/worker/src/jobs/document-extract.ts` | `documentExtract`, `writeRevision` and `readAll`. |
| Extractor client | `apps/worker/src/extractor.ts` | `HttpExtractorClient` sends the PDF to the extractor and reads the answer. |
| Dispatcher factory | `apps/worker/src/dispatch.ts` | `createDispatcher` makes the dispatcher for the dispatch mode. |
| Store factory | `apps/worker/src/store.ts` | `createStore` makes a `DiskObjectStore` or a `GcsObjectStore`. |
| Configuration | `apps/worker/src/env.ts` | `loadWorkerEnv` reads and checks the environment variables. |
| Logger | `apps/worker/src/logger.ts` | `createLogger` makes a pino logger. It hides the `cookie` and `authorization` request headers in the log. |
| Tests | `apps/worker/test/` | Vitest tests. They use a real Postgres database. |
| Container image | `apps/worker/Dockerfile` | Builds the worker on Node 22. The image runs `node dist/server.js` as the user `app`. |

The worker uses four shared packages. For more information, see [shared packages](packages.md):

- `@maester/contracts`: the job type names, the result types and the extractor answer schemas.
- `@maester/db`: the database client, the table schema and the queries `matchCompanies`, `findStoredDuplicate` and `getCurrentClassification`.
- `@maester/jobs`: `createJob`, `decideIntake`, `classificationIdOfReadJob` and the two dispatchers.
- `@maester/storage`: the object store classes and `ObjectNotFoundError`.

## Operation

### Dispatch request and lease

1. A dispatcher in the API or in the worker sends a dispatch request to `POST /tasks/:type`.
2. `verifyDispatchRequest` checks the request. In `local` mode, the `x-dispatch-secret` header must be equal to `DISPATCH_SECRET`.
3. In `cloud-tasks` mode, the `authorization` header must hold a Google OIDC token. The token audience must be `WORKER_URL`, and the token `email` must be `API_SERVICE_ACCOUNT_EMAIL`.
4. If the check fails, the worker sends status 401. If the body has no valid UUID in `jobId`, the worker sends status 400.
5. `runJob` reads the job. If no job has this ID, the worker sends status 200 with the outcome `missing`.
6. If the job state is `succeeded`, `failed` or `cancelled`, the worker sends status 200 and does not run the job.
7. `acquireLease` sets the job to `running`, adds 1 to `attempt` and writes a new lease token. The lease ends after `LEASE_SECONDS`.
8. `acquireLease` changes only a `queued` job, or a `running` job with an expired lease. If another process holds the lease, the worker sends status 409 with the outcome `lease_held`.
9. `runJob` finds the handler from the `type` column of the job. The `:type` value in the path goes only into the log.
10. If the handler registry has no handler for the job type, the job gets a final failure with the code `UNKNOWN_JOB_TYPE`.
11. The handler runs. It can write progress to the `progress` column. It can renew the lease with `heartbeat`.
12. `heartbeat` renews the lease a maximum of one time in each 5 seconds (`HEARTBEAT_THROTTLE_MS`).
13. If the handler returns a value, `completeJob` sets the job to `succeeded` and writes the value to the `result` column. The worker sends status 200.
14. If a different process took the lease while the handler ran, `completeJob` changes nothing. The outcome is then `lease_lost`.
15. If the handler throws an error, the worker records the error. See [Retries](#retries).

### `document.verify`

1. The handler reads the `document` row for the job subject and the workspace. If the row does not exist, the handler throws a plain error.
2. If the document state is `stored`, the handler goes to step 8 and does not read the object store.
3. If the document state is `rejected`, the handler returns the old rejection code again.
4. The handler sets the document state to `verifying`.
5. The handler reads the object from the object store as a stream. If the object does not exist, the handler rejects the document with `OBJECT_MISSING`.
6. The handler calculates the SHA-256 hash and the size of the object. If the size becomes more than `MAX_UPLOAD_BYTES`, the handler rejects the document with `TOO_LARGE`.
7. If the first 5 bytes are not `%PDF-`, the handler rejects the document with `NOT_A_PDF`. If they are `%PDF-`, the handler sets the document state to `stored` and writes the hash and the size.
8. If the intake state is empty, the handler looks for an older `stored` document with the same hash in the same workspace.
9. If an older copy exists, the handler sets the intake state to `duplicate` and writes `duplicate_of_document_id`. The handler then stops.
10. If no older copy exists, the handler sets the intake state to `identifying`.
11. If the intake state is `identifying`, the handler creates a `document.classify` job. Its idempotency key is `document.classify:<documentId>:auto`.

A rejected document does not make the job fail. The job is `succeeded`, and its result has the outcome `rejected` and the rejection code. The handler creates the `document.classify` job also when the worker has no extractor client.

### `document.classify`

1. If the worker has no extractor client, the handler throws `CLASSIFIER_NOT_CONFIGURED`.
2. The handler reads the document. If the document does not exist, the handler throws `DOCUMENT_NOT_FOUND`.
3. If the document state is not `stored`, the handler throws `INVALID_STATE`.
4. If a classification for this job exists, the handler calls `decideIntake` again and returns. It does this only from the intake state `identifying`.
5. If `size_bytes` is more than `EXTRACT_MAX_BYTES`, the handler throws `TOO_LARGE_FOR_EXTRACTION`.
6. The handler reads the full PDF from the object store into memory. If the object does not exist, the handler throws `OBJECT_MISSING`.
7. The handler sends the PDF to `POST /v1/classify` on the extractor. The answer has the kind, the company name as printed, the company identifiers, the period and the evidence.
8. The handler finds the company. See [Company match](#company-match).
9. `writeClassification` writes one classification and its evidence in one transaction. It locks the `document` row first.
10. The classification gets `set_by` = `maester` and `created_at` = `clock_timestamp()`. Thus the classification that the database writes last is the current classification.
11. For a read kind with a company, `writeClassification` sets `reads_under_id` to the ID of the new classification.
12. `decideIntake` sets the company and the next intake state of the document. The table below shows the rules.

| Classification | New intake state | Next job |
| --- | --- | --- |
| Kind `not_sure` | `needs_kind` | No job. The investor must give the kind. |
| Kind `other` | `kept` | No job. The worker does not read the document. |
| Read kind, no company | `needs_company` | No job. The investor must give the company. |
| Read kind, with a company | `reading` | `document.extract`, with the key `document.extract:<documentId>:classification-<classificationId>` |

`decideIntake` changes the document only if this classification is the current classification. It writes the new state and the `document.extract` job in one transaction. The dispatcher sends the dispatch request for the new job after the commit.

### Company match

1. If the investor gave the company, the handler uses that company.
2. Before the first classification, the investor company is the `company_id` of the document. The investor gives it at upload.
3. After the first classification, the investor company is the company of the current classification. This is true only if its company evidence has the source `investor`.
4. If the investor gave no company, the handler calls `matchCompanies` for the workspace. This query compares the CIN, then the BSE code or the NSE symbol, then the normalized name.
5. The handler uses the result only if `matchCompanies` returns exactly one company. If it returns no company or more than one company, the company stays empty.
6. If the investor gave the company, `writeClassification` adds one evidence row with the field `company` and the source `investor`.

### `document.extract`

1. If the worker has no extractor client, the handler throws `EXTRACTOR_NOT_CONFIGURED`.
2. The handler reads the document. It throws `DOCUMENT_NOT_FOUND` or `INVALID_STATE` for the same causes as `document.classify`.
3. If a revision for this job exists, the handler does not call the extractor. It sets the intake state to `read` if this job is the current read job, and returns the summary of the revision.
4. If `size_bytes` is more than `EXTRACT_MAX_BYTES`, the handler throws `TOO_LARGE_FOR_EXTRACTION`.
5. If the document has a company, the handler reads the company name from the `company` table.
6. The handler reads the full PDF from the object store into memory. If the object does not exist, the handler throws `OBJECT_MISSING`.
7. The handler sends the PDF to `POST /v1/extract` on the extractor. The headers include `x-document-id` and, if the document has a company, `x-company-name`.
8. The extractor sends back an NDJSON stream. Each line is one JSON event.
9. For each event, the handler calls `heartbeat`. For a `progress` event, the handler writes the stage and the percent to the job.
10. An `error` event stops the job with a `JobFailure`. A `result` event gives the result of the extraction.
11. The handler finds the classification ID from the end of the idempotency key. If the key has no classification ID, the handler uses `reads_under_id` of the current classification.
12. `writeRevision` writes the revision and its rows in one transaction. It writes the rows in groups of 500.
13. `writeRevision` writes the facts to `financial_fact`, the page of each fact to `source_reference` and the checks to `extraction_check`.
14. If `reads_under_id` of the current classification is equal to the classification ID of this job, the handler sets the intake state to `read`.
15. If a newer classification replaced the classification of this job, the handler does not change the document.

### Retries

1. If a handler throws a `JobFailure`, the worker records its code. For a different error, the worker records the code `HANDLER_ERROR`.
2. The failure is final if the `JobFailure` has `retryable` = false. The failure is also final if `attempt` is equal to or more than `maxAttempts`.
3. For a final failure, `failAttempt` sets the job to `failed`. It writes `last_error_code`, `last_error_message` and `finished_at`. The message keeps the first 2000 characters.
4. After a final failure, the worker calls the `onFinalFailure` function of the handler, if the handler has one. The worker sends status 200 with the outcome `failed`.
5. For a failure that is not final, `failAttempt` sets the job to `queued` and removes the lease. The worker sends status 500 with the outcome `retry`.
6. In `cloud-tasks` mode, Cloud Tasks sends the dispatch request again after status 500. The script `infra/bootstrap.sh` sets the retry schedule of the queue.
7. In `local` mode, `LocalHttpDispatcher` sends the request one time. It writes the status to the log and does nothing more. No part of the worker sends the request again.

The `onFinalFailure` functions are:

- `document.classify`: sets the intake state to `identify_failed`, but only if the intake state is `identifying`.
- `document.extract`: sets the intake state to `read_failed`, but only if this job is the current read job.
- `document.verify` has no `onFinalFailure` function.

## States and errors

### Job states

| State or error | Cause | Result |
| --- | --- | --- |
| `queued` | `createJob` made the job, or a failure was not final. | The job waits for a dispatch request. |
| `running` | `acquireLease` took the lease. | The handler runs. If the lease expires, a new dispatch request can take the job again. |
| `succeeded` | The handler returned a value. | The worker does not run the job again. |
| `failed` | A final failure. | The worker does not run the job again. |
| `cancelled` | Not known. No code in `apps/worker` sets this state. | The worker sends status 200 and does not run the job. |

### HTTP responses

| State or error | Cause | Result |
| --- | --- | --- |
| Status 200 | The job is `succeeded`, `failed`, `cancelled` or not in the database. | The caller does not send the request again. |
| Status 400 | The body has no valid UUID in `jobId`. | The worker does not run the job. |
| Status 401 | The secret or the OIDC token is not correct. | The worker does not run the job. |
| Status 409 | A different process holds the lease. | The worker does not run the job. |
| Status 500, outcome `retry` | A failure that is not final. | The job is `queued` again. |
| Status 500, error `internal` | An error that `runJob` does not catch. Examples: a database error before the handler starts, or an error in `failAttempt`. | The worker writes the error to the log. |

### Error codes

| State or error | Cause | Result |
| --- | --- | --- |
| `UNKNOWN_JOB_TYPE` | No handler for the job type. | Final failure. |
| `HANDLER_ERROR` | An error that is not a `JobFailure`. Examples: a storage error, or no `document` row in `document.verify`. | Retry until `maxAttempts`. |
| `CLASSIFIER_NOT_CONFIGURED` | `EXTRACTOR_URL` has no value, and a `document.classify` job runs. | Final failure. The intake state becomes `identify_failed`. |
| `EXTRACTOR_NOT_CONFIGURED` | `EXTRACTOR_URL` has no value, and a `document.extract` job runs. The extractor can also send this code. | Final failure from the worker. For the extractor code, the `retryable` flag of the extractor applies. |
| `DOCUMENT_NOT_FOUND` | No `document` row for a classify or extract job. | Final failure. |
| `INVALID_STATE` | The document state is not `stored`. | Final failure. |
| `TOO_LARGE_FOR_EXTRACTION` | The document is larger than `EXTRACT_MAX_BYTES`, or the extractor sends status 413. | Final failure. |
| `OBJECT_MISSING` | The object store has no object for a classify or extract job. | Final failure. |
| `EXTRACTOR_UNAUTHORIZED` | The extractor sends status 401 or 403. | Final failure. |
| `EXTRACTOR_UNAUTHORIZED` | With `EXTRACTOR_AUTH` = `oidc`, the worker cannot get an ID token. | Retry. |
| `EXTRACTOR_UNAVAILABLE` | The request to the extractor fails before an answer, or the time limit ends first. | Retry. |
| `EXTRACTOR_HTTP_<status>` | The extractor sends a different error status. | Retry for status 500 or more. Final failure for other status codes. |
| `INVALID_CLASSIFIER_RESULT` | The classify answer is not valid for the `ClassifyResponse` schema. | Final failure. |
| `INVALID_EXTRACTOR_RESULT` | A stream line is not valid for the `ExtractorEvent` schema. | Final failure. |
| `EXTRACTOR_STREAM_INTERRUPTED` | The stream stops before a `result` event, or the stream breaks. | Retry. |
| A code from the extractor | The extractor sends an `error` answer or an `error` event. | The worker uses the code and the `retryable` flag of the extractor. |
| Classify job stays `queued` | `cloud-tasks` mode with no `GOOGLE_CLOUD_PROJECT` or no `WORKER_INVOKER_SA`, and no `EXTRACTOR_URL`. `loadWorkerEnv` accepts this configuration. | The dispatcher throws. On the retry, `createJob` finds the job and does not send it again. The document stays `identifying`. |
| Document stays `verifying` | A `document.verify` job gets a final failure after step 4. | `document.verify` has no `onFinalFailure`, so no code changes the document state. |

### Document rejection codes

These codes do not make the job fail. The document state becomes `rejected`, and the job is `succeeded`.

| State or error | Cause | Result |
| --- | --- | --- |
| `OBJECT_MISSING` | The object store has no object for the document. | The document is `rejected`. |
| `TOO_LARGE` | The object is larger than `MAX_UPLOAD_BYTES`. | The document is `rejected`. The worker stops the stream. |
| `NOT_A_PDF` | The first 5 bytes are not `%PDF-`. | The document is `rejected`. |

### Intake states

| State or error | Cause | Result |
| --- | --- | --- |
| Empty | The document is not `stored` yet. | No intake job. |
| `identifying` | `document.verify` stored the document, and it is not a copy. | A `document.classify` job starts. |
| `duplicate` | An older `stored` document in the workspace has the same hash. | No classify job. |
| `needs_kind` | The classification kind is `not_sure`. | The document waits for the investor. |
| `needs_company` | A read kind with no company. | The document waits for the investor. |
| `kept` | The classification kind is `other`. | The worker keeps the document and does not read it. |
| `reading` | A read kind with a company. | A `document.extract` job starts. |
| `read` | `document.extract` wrote the revision for the current classification. | The revision gives the current figures. |
| `identify_failed` | `document.classify` got a final failure. | No `document.extract` job. |
| `read_failed` | The current `document.extract` job got a final failure. | No new revision. |

## Data

### Database tables

| Table | The worker reads | The worker writes |
| --- | --- | --- |
| `job` | The job for each dispatch request. | State, `attempt`, lease, progress, result and errors. New rows for `document.classify` and `document.extract`. |
| `document` | The document for each job. | State, hash, size, `stored_at`, rejection code, intake state, `duplicate_of_document_id` and `company_id`. |
| `company` | The companies of the workspace, for the company match. The company name for the extract request. | Nothing. |
| `document_classification` | The current classification and the classification of a job. | One new row for each `document.classify` job. |
| `classification_evidence` | The evidence of the current classification. | The evidence rows of a new classification. |
| `extraction_revision` | The revision of a job. | One new row for each `document.extract` job. |
| `financial_fact` | The facts of a revision, for the summary. | The facts of a new revision. |
| `source_reference` | Nothing. | One row for each fact: the document and the page. |
| `extraction_check` | The failed checks of a revision, for the summary. | The checks of a new revision. |

The `jobId` column is unique in `document_classification` and in `extraction_revision`. Thus, when the same job runs again, the handler finds the old row and writes no new row.

### Other data

| Data | Direction | Details |
| --- | --- | --- |
| Object store | Read | The worker reads the object at `storage_key`. It never writes to the object store. |
| Extractor | Write and read | `POST /v1/classify` and `POST /v1/extract`, with the PDF as the body and `content-type: application/pdf`. |
| Cloud Tasks | Write | In `cloud-tasks` mode, the worker creates one task for each new job. The task name ends with `<jobId>-<attempt>`. |
| Worker | Write | In `local` mode, the worker sends the dispatch request for a new job to its own `WORKER_URL`. |
| Log | Write | JSON lines from pino, with a `severity` field. |

### Environment variables

`loadWorkerEnv` reads these variables. If a value is not correct, the worker stops at start with the message `invalid environment` or a message that names the variable. The `pnpm dev` script reads the root `.env` file.

| Variable | Default | Function |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. |
| `PORT` | `8788` | The HTTP port. |
| `LOG_LEVEL` | `info` | The pino log level. |
| `DATABASE_URL` | No default. Necessary. | The Postgres connection URL. |
| `STORAGE_DRIVER` | `gcs` | `gcs` or `disk`. The worker refuses `disk` when `NODE_ENV` is `production`. |
| `STORAGE_DIR` | `data/blobs` | The directory for the `disk` driver. |
| `GCS_BUCKET` | No default | The bucket. Necessary when `STORAGE_DRIVER` is `gcs`. |
| `DISPATCH_MODE` | `local` | `local` or `cloud-tasks`. |
| `DISPATCH_SECRET` | No default | The shared secret. Necessary in `local` mode. It must be the same in the API and in the worker. |
| `WORKER_URL` | No default. Necessary. | The URL of this worker. It is the OIDC audience and the target for new jobs. |
| `API_SERVICE_ACCOUNT_EMAIL` | No default | The `email` that the OIDC token must have. Necessary in `cloud-tasks` mode. |
| `MAX_UPLOAD_BYTES` | `52428800` (50 MiB) | The largest object that `document.verify` accepts. |
| `LEASE_SECONDS` | `600` | The length of a lease. |
| `EXTRACTOR_URL` | No default | The base URL of the extractor. If it has no value, the worker has no extractor client. |
| `EXTRACTOR_AUTH` | `secret` | `secret` sends the `x-extractor-secret` header. `oidc` sends a Google ID token with the extractor URL as audience. |
| `EXTRACTOR_SECRET` | No default | Necessary when `EXTRACTOR_URL` has a value and `EXTRACTOR_AUTH` is `secret`. |
| `EXTRACTOR_TIMEOUT_SECONDS` | `900` | The time limit for one request to the extractor, with the full stream. |
| `EXTRACT_MAX_BYTES` | `52428800` (50 MiB) | The largest document that the worker sends to the extractor. |
| `GOOGLE_CLOUD_PROJECT` | No default | The Cloud Tasks project. Necessary in `cloud-tasks` mode when `EXTRACTOR_URL` has a value. |
| `GOOGLE_CLOUD_LOCATION` | `asia-south1` | The Cloud Tasks location. |
| `CLOUD_TASKS_QUEUE` | `maester-jobs` | The Cloud Tasks queue. |
| `WORKER_INVOKER_SA` | No default | The service account for the OIDC token on each task. Necessary in `cloud-tasks` mode when `EXTRACTOR_URL` has a value. It must be the same account as `API_SERVICE_ACCOUNT_EMAIL`, because the worker accepts no other `email`. |
| `TASK_DISPATCH_DEADLINE_SECONDS` | `1800` | The dispatch deadline of each task that the worker creates. |

## Procedures

### To run the tests

1. Start the Postgres container from the repository root.

   ```bash
   pnpm db:up
   ```

2. If you use a different test database, set `DATABASE_URL_TEST_WORKER` to its URL.
3. Run the worker tests.

   ```bash
   pnpm --filter @maester/worker test
   ```

Note: The default test database is `maester_test_worker` on `localhost:5433`. The file `scripts/db/init.sql` creates it.

### To check the code

1. Run the linter.

   ```bash
   pnpm --filter @maester/worker lint
   ```

2. Run the type check.

   ```bash
   pnpm --filter @maester/worker typecheck
   ```

### To run the worker as a local process

1. Install the dependencies from the repository root.

   ```bash
   pnpm install
   ```

2. Start the Postgres container.

   ```bash
   pnpm db:up
   ```

3. Apply the database migrations.

   ```bash
   pnpm --filter @maester/db migrate
   ```

4. If the root `.env` file does not exist, copy `.env.example` to `.env`.
5. Make sure that the root `.env` file has the worker variables.
6. Start the worker.

   ```bash
   PORT=8788 pnpm dev:worker
   ```

7. Make sure that the worker answers with `{"status":"ok"}`.

   ```bash
   curl http://localhost:8788/healthz
   ```

### To build the container image

1. Build the image from the repository root.

   ```bash
   docker build -f apps/worker/Dockerfile -t maester/worker:local .
   ```

### To add a job type

1. Add the job type name to `JobTypes` in `packages/contracts/src/job.ts`.
2. Write the handler in `apps/worker/src/jobs/`.
3. If a retry cannot correct an error, throw a `JobFailure` with `retryable` = false.
4. If the subject must show a failure state, add an `onFinalFailure` function to the handler.
5. Add the handler to `handlers` in `apps/worker/src/jobs/index.ts`.
6. Add a test in `apps/worker/test/`.

## Warnings and cautions

WARNING: Keep `DISPATCH_SECRET` and `EXTRACTOR_SECRET` private. In `local` mode, a person with `DISPATCH_SECRET` can make the worker run any job. A person with `EXTRACTOR_SECRET` can send requests to the extractor.

CAUTION: Do not set `DATABASE_URL_TEST_WORKER` to a database with real data. The tests delete all rows in the `job`, `document`, `workspace`, `user` and related tables.

## Limits

- The worker has no retry schedule of its own. In `local` mode, no part of the system sends a failed dispatch request again. The API has a retry route for jobs.
- `document.verify` has no `onFinalFailure` function. After a final failure, the document can stay `verifying`.
- In `cloud-tasks` mode, `loadWorkerEnv` checks `GOOGLE_CLOUD_PROJECT` and `WORKER_INVOKER_SA` only when `EXTRACTOR_URL` has a value. Without them, the `document.classify` job stays `queued`.
- The worker command in `infra/deploy.sh` sets none of `EXTRACTOR_URL`, `GOOGLE_CLOUD_PROJECT` and `WORKER_INVOKER_SA`. With that configuration, the limit above applies.
- The classify and extract handlers read the full PDF into memory. `EXTRACT_MAX_BYTES` limits the size.
- The worker does not stop a handler when the lease ends. A second process can then start the same job.
- Not known: the port of a deployed worker. The Dockerfile has `EXPOSE 8080`, but the default `PORT` is `8788`.
- Not known: which part of the system sets a job to `cancelled`.

## Sources

- [apps/worker/src/server.ts](../../apps/worker/src/server.ts)
- [apps/worker/src/app.ts](../../apps/worker/src/app.ts)
- [apps/worker/src/auth.ts](../../apps/worker/src/auth.ts)
- [apps/worker/src/run.ts](../../apps/worker/src/run.ts)
- [apps/worker/src/lease.ts](../../apps/worker/src/lease.ts)
- [apps/worker/src/dispatch.ts](../../apps/worker/src/dispatch.ts)
- [apps/worker/src/store.ts](../../apps/worker/src/store.ts)
- [apps/worker/src/extractor.ts](../../apps/worker/src/extractor.ts)
- [apps/worker/src/env.ts](../../apps/worker/src/env.ts)
- [apps/worker/src/logger.ts](../../apps/worker/src/logger.ts)
- [apps/worker/src/jobs/index.ts](../../apps/worker/src/jobs/index.ts)
- [apps/worker/src/jobs/types.ts](../../apps/worker/src/jobs/types.ts)
- [apps/worker/src/jobs/document-verify.ts](../../apps/worker/src/jobs/document-verify.ts)
- [apps/worker/src/jobs/document-classify.ts](../../apps/worker/src/jobs/document-classify.ts)
- [apps/worker/src/jobs/document-extract.ts](../../apps/worker/src/jobs/document-extract.ts)
- [apps/worker/test/](../../apps/worker/test/)
- [apps/worker/package.json](../../apps/worker/package.json)
- [apps/worker/Dockerfile](../../apps/worker/Dockerfile)
- [packages/jobs/src/intake.ts](../../packages/jobs/src/intake.ts)
- [packages/jobs/src/create.ts](../../packages/jobs/src/create.ts)
- [packages/jobs/src/dispatch.ts](../../packages/jobs/src/dispatch.ts)
- [packages/db/src/queries/classification.ts](../../packages/db/src/queries/classification.ts)
- [packages/db/src/schema/platform.ts](../../packages/db/src/schema/platform.ts)
- [packages/db/src/schema/classification.ts](../../packages/db/src/schema/classification.ts)
- [packages/db/src/schema/extraction.ts](../../packages/db/src/schema/extraction.ts)
- [packages/contracts/src/job.ts](../../packages/contracts/src/job.ts)
- [packages/contracts/src/document.ts](../../packages/contracts/src/document.ts)
- [apps/extractor/src/maester_extractor/app.py](../../apps/extractor/src/maester_extractor/app.py)
- [package.json](../../package.json)
- [docker-compose.yml](../../docker-compose.yml)
- [.env.example](../../.env.example)
- [scripts/db/init.sql](../../scripts/db/init.sql)
- [infra/deploy.sh](../../infra/deploy.sh)
- [infra/bootstrap.sh](../../infra/bootstrap.sh)
- [apps/api/src/routes/jobs.ts](../../apps/api/src/routes/jobs.ts)
