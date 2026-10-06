# API (`apps/api`): system description

This document describes the HTTP service in `apps/api`. For the full system, read the [Maester overview](maester.md). For the shared packages, read [shared packages](packages.md).

## Terms

| Term | Meaning in this document |
| --- | --- |
| API | The HTTP service in `apps/api`. It uses the Hono framework on Node 22. |
| route | One HTTP method and one path that the API accepts, for example `GET /healthz`. |
| response | The HTTP status, headers and body that the API sends back for a request. |
| answer | One value in a classification, for example the kind or the company. |
| user | A person with an account in the `user` table. |
| session | A row in the `session` table for one sign-in. The browser holds it in a cookie. |
| Better Auth | The library that controls sign-up, sign-in, sessions and password reset. The API mounts it at `/api/auth/*`. |
| waitlist | The `waitlist_entry` table. Only an email with the status `approved` can get an account. |
| workspace | A group of documents, companies and jobs. Each user gets one personal workspace. |
| member | A user with a row in the `membership` table for a workspace. |
| company | A row in the `company` table. A workspace owns its companies. |
| document | One uploaded PDF file and its row in the `document` table. |
| object store | The storage for the bytes of a document. It is a Cloud Storage bucket (`gcs`) or a local directory (`disk`). |
| signed URL | A URL that is valid for a short time and lets the browser write or read one object in the object store. |
| classification | One set of answers about a document: its kind, company, period and results span. The newest row is the current classification. |
| evidence | The source of one answer in a classification: a page and a quote, a rule, or the user. |
| revision | One result of the extraction of financial statements from a document. |
| fact | One figure in a revision, with its page. |
| job | A row in the `job` table. The worker (`apps/worker`) does the work of a job. |
| dispatcher | The part that tells the worker to start a job. It sends an HTTP request or makes a Cloud Tasks task. |
| trace ID | The value of the `x-request-id` header. The API puts it in each error and in the log. |
| error envelope | The JSON body of an API error: `{ "error": { "code", "message", "fields", "traceId" } }`. |

## Function

The API signs users in, keeps their sessions and admits only the emails that the waitlist approves. For a signed-in member of a workspace, it writes companies and documents, gives signed URLs for upload and download, and creates jobs. The worker does the slow work of each job. The API only writes the job row and tells the worker about it. The browser reads the result from the API later, or follows a job through a Server-Sent Events stream. The browser reaches the API through the proxy of the web origin.

In this document, `...` in a path is `/v1/workspaces/:ws`.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| Server entry | `apps/api/src/server.ts` | Reads the environment and makes each part. Starts the HTTP server on `PORT`. Stops on `SIGTERM`. |
| App | `apps/api/src/app.ts` | Mounts the middleware and the routes. Turns each error into the error envelope. |
| Environment | `apps/api/src/env.ts` | Reads and checks the environment variables. Stops the start if a value is wrong. |
| Auth | `apps/api/src/auth.ts` | Configures Better Auth: email and password, Google, the waitlist gate, the takeover guard and the rate limiter. |
| Errors | `apps/api/src/errors.ts` | Gives `HttpError`, the HTTP status for each error code, and the error envelope. |
| Validation | `apps/api/src/validation.ts` | Checks a request body or query against a Zod schema from `@maester/contracts`. |
| Middleware | `apps/api/src/middleware/` | Sets the trace ID, checks the session, checks the workspace and checks the UUID in a path. |
| Routes | `apps/api/src/routes/` | One file for each group of routes. |
| Job creation | `apps/api/src/jobs/create.ts` | Creates a job and gives it to the dispatcher. Starts a job again on retry. |
| Dispatch | `apps/api/src/dispatch/index.ts` | Selects the dispatcher from `DISPATCH_MODE`. |
| Mail | `apps/api/src/mail/` | Sends the mail for email confirmation and password reset. |
| Store | `apps/api/src/store.ts` | Selects the object store from `STORAGE_DRIVER`. |
| Serialize | `apps/api/src/serialize.ts` | Changes database rows into the JSON shapes of `@maester/contracts`. |
| Logger | `apps/api/src/logger.ts` | Writes JSON log records with pino. Removes the `cookie` and `authorization` request headers from the log. |
| Migrate | `apps/api/src/migrate.ts` | Applies the database migrations, then stops. |
| Tests | `apps/api/test/` | Vitest tests. They use a real Postgres database. |

The API uses four shared packages: `@maester/db`, `@maester/contracts`, `@maester/jobs` and `@maester/storage`. Read [shared packages](packages.md) for them.

## Operation

### Routes

All routes under `/v1` need a session. All routes under `/v1/workspaces/:ws/` also need the user to be a member of the workspace `:ws`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/healthz` | `{ "status": "ok" }`. No session is necessary. |
| GET, POST | `/api/auth/*` | Better Auth sends the response. |
| GET | `/v1/me` | The user and the workspaces of the user. |
| GET | `/v1/workspaces` | The workspaces of the user. `nextCursor` is always `null`. |
| GET | `/v1/workspaces/:ws` | One workspace. |
| POST | `/v1/workspaces/:ws/companies` | Creates a company. Status 201. |
| GET | `/v1/workspaces/:ws/companies` | A page of companies. |
| GET | `/v1/workspaces/:ws/companies/:id` | One company. |
| POST | `/v1/workspaces/:ws/documents/uploads` | Creates a document and a signed upload URL. Status 201. |
| POST | `/v1/workspaces/:ws/documents/:id/finalize` | Checks the upload and creates a `document.verify` job. |
| GET | `/v1/workspaces/:ws/documents` | A page of documents. |
| GET | `/v1/workspaces/:ws/documents/:id` | One document, with its latest job and its current classification. |
| GET | `/v1/workspaces/:ws/documents/:id/download` | A signed download URL. |
| POST | `/v1/workspaces/:ws/documents/:id/extract` | Creates a new `document.extract` job. Status 202. |
| GET | `/v1/workspaces/:ws/documents/:id/extraction` | The current revision and its checks. |
| GET | `/v1/workspaces/:ws/documents/:id/facts` | The facts of a revision. The query `revisionId` is optional. |
| GET | `/v1/workspaces/:ws/documents/:id/classification` | The current classification and its evidence. |
| POST | `/v1/workspaces/:ws/documents/:id/classification` | Changes the answers. |
| POST | `/v1/workspaces/:ws/documents/:id/classify` | Creates a new `document.classify` job. Status 202. |
| GET | `/v1/workspaces/:ws/jobs/:id` | One job. |
| POST | `/v1/workspaces/:ws/jobs/:id/retry` | Starts a job again. |
| GET | `/v1/workspaces/:ws/jobs/:id/events` | A Server-Sent Events stream of the job. |
| GET | `/dev/upload` | A test page for the upload. Only in `development` and `test`. |
| POST | `/dev/auth/admit` | Approves an email and confirms its account. Only in `development` and `test`. |
| PUT, GET | `/dev/blobs/*` | Local object store for signed URLs. Only in `development` and `test`, and only with `STORAGE_DRIVER=disk`. |

A list route takes the query `cursor` and the query `limit`. The value of `limit` is 1 to 100. The default is 25. The response body is `{ "items", "nextCursor" }`.

### Request path

1. The `requestId` middleware reads the `x-request-id` header. If the header has 128 characters or fewer, the API uses it as the trace ID. If not, the API makes a new UUID.
2. The CORS middleware accepts only an origin in `ALLOWED_ORIGINS`. It permits cookies and the `Content-Type` and `x-request-id` headers.
3. For `/v1`, the `requireSession` middleware asks Better Auth for the session from the request headers. If there is no session, the result is `UNAUTHENTICATED`.
4. For `/v1/workspaces/:ws`, the `requireWorkspace` middleware gets the workspace and the membership of the user. If `:ws` is not a UUID, or the user is not a member, the result is `NOT_FOUND`.
5. The route checks the body or the query with a Zod schema. If the check fails, the result is `VALIDATION_FAILED`, with one entry in `fields` for each problem.
6. If a path parameter `:id` is not a UUID, the result is `NOT_FOUND`.
7. The API adds the `x-request-id` header to each response.

The API never tells a user that a document, a job or a company exists in a different workspace. A request for a document, a job or a company of a different workspace gets `NOT_FOUND`.

### Sign-up and the waitlist

1. A user signs up with an email and a password at `/api/auth/sign-up/email`, or signs in with Google.
2. Before Better Auth creates the user, the `user.create.before` hook calls `admitOrWaitlist` from `@maester/db`. The source is `email` for the email path and `google` for all other paths.
3. If the email is not `approved`, `admitOrWaitlist` writes a `pending` row in the waitlist. Then the hook stops the sign-up with the code `WAITLISTED`.
4. The email path then sends status 200, the same as for an approved email. Thus the response does not show if an email is on the waitlist.
5. The Google path sends the browser to the error URL with `?error=WAITLISTED`.
6. After Better Auth creates the user, the `user.create.after` hook calls `ensurePersonalWorkspace`. This makes one workspace with the user as `owner`.
7. Better Auth sends a confirmation mail on sign-up and on each sign-in before confirmation. The link is valid for one hour. A sign-in before confirmation gets status 403 with the code `EMAIL_NOT_VERIFIED`.
8. The confirmation link signs the user in.

Other rules for sign-in:

- A password must have 8 characters or more.
- A password reset link is valid for one hour. A reset removes all sessions of the user.
- A sign-up for an email that has an account gets the same response as a new sign-up. The owner of the email gets a mail that tells what occurred.
- The API refuses a Google profile if Google did not confirm the email. The browser goes to the error URL with `?error=GOOGLE_EMAIL_NOT_VERIFIED`.
- The API accepts Google only through the redirect flow. It refuses an ID token that the client sends.
- The Google sign-in exists only when `GOOGLE_CLIENT_ID` has a value.
- Better Auth refuses a callback URL or an error callback URL to a different site.

The takeover guard is the `account.create.before` hook. It runs when a Google account links to a user. If that user did not confirm the email, the hook removes the password and all sessions of the user. Then it marks the email as confirmed, because Google confirmed it.

The API sends each mail without a wait for the result. Thus the response time does not show if an account exists. If the mail fails, the API writes an error to the log.

The session cookie is `maester.session_token`. In production it is `__Secure-maester.session_token`, with `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`.

### Rate limiter

The rate limiter of Better Auth is on in production. In other environments it is on only when `AUTH_RATE_LIMIT=on`. It keeps its counts in the `rate_limit` table.

| Path under `/api/auth` | Limit in 60 seconds |
| --- | --- |
| `/sign-in/email` | 5 |
| `/sign-up/email` | 5 |
| `/request-password-reset` | 3 |
| `/send-verification-email` | 3 |
| All other paths | 100 |

The limiter gets the client address from the `x-forwarded-for` header. It reads the header from the right and skips the addresses in `TRUSTED_PROXIES`.

### Upload of a document

1. The browser sends `POST .../documents/uploads` with `originalName`, `size`, `mimeType` and an optional `companyId`.
2. The `mimeType` must be `application/pdf`. If `size` is more than `MAX_UPLOAD_BYTES`, the result is `UPLOAD_TOO_LARGE`.
3. If `companyId` is not a company of the workspace, the result is `VALIDATION_FAILED`.
4. The API changes each control character, `/` and `\` in the name to `_`. It keeps 255 characters or fewer.
5. The API writes a document with the state `pending_upload`. The object key is `workspaces/<ws>/documents/<id>/original.pdf`.
6. The API asks the object store for a signed upload URL. The URL is valid for `UPLOAD_URL_TTL_SECONDS` and agrees only with the declared type and size.
7. The response has the document and `upload`: the method `PUT`, the URL, the headers and `expiresAt`.
8. The browser sends the bytes to the signed URL.
9. The browser sends `POST .../documents/:id/finalize`.
10. If the state is `pending_upload` and the object is not in the object store, the result is `INVALID_STATE`. If the object is there, the API changes the state to `uploaded`.
11. The API creates a `document.verify` job. A second `finalize` call gets the same job.
12. The browser follows the job with `GET .../jobs/:id/events`.

### Change of a classification

1. The browser sends `POST .../documents/:id/classification`. The body has `basedOn`, the ID of the classification that the user saw, and one or more new answers.
2. The API starts a database transaction and locks the document row.
3. If the document has no classification, the result is `INVALID_STATE`. If `basedOn` is not the current classification, the result is `CONFLICT`.
4. If the body has `company.id`, the company must be in the workspace. If the body has `company.new`, the API creates the company.
5. The API compares the new answers with the current answers. If nothing changed, the result is `VALIDATION_FAILED`.
6. The API writes a new classification with `setBy` set to `investor`.
7. The API copies the evidence for each answer that did not change. For each changed answer with a value, it adds evidence with the source `investor`.
8. After the transaction, the API calls `decideIntake` from `@maester/jobs`. This sets the next intake state of the document. For a read, it also creates a `document.extract` job, and dispatches it after its own transaction.
9. The response has the document, the new classification and its evidence.

A read starts only when all these conditions are true:

- The kind is `annual_report` or `financial_results`.
- The classification has a company.
- The kind changed, the company changed, or the previous classification had no read.

### Job creation and dispatch

1. The API calls `createJob` from `@maester/jobs`. The idempotency key is `<type>:<subjectId>:<pipelineVersion>`. The default `pipelineVersion` is `1`.
2. If no job has the key, `createJob` writes a job with the state `queued` and `maxAttempts` 5. Then it gives the job to the dispatcher.
3. If a job of the same workspace has the key, `createJob` returns that job and does not dispatch it again.
4. If a job of a different workspace has the key, the result is `CONFLICT`.
5. The `extract` and `classify` routes set `pipelineVersion` to `manual-<UUID>`. Thus each call makes a new job.

The dispatcher has two modes:

- `local`: the API sends `POST <WORKER_URL>/tasks/<type>` with the body `{ "jobId" }` and the `x-dispatch-secret` header. The API does not wait for the response. It only writes the result to the log.
- `cloud-tasks`: the API makes a Cloud Tasks task with the name `<jobId>-<attempt>`. The task calls the same worker path with an OIDC token for `WORKER_INVOKER_SA`. If the task exists, the API ignores the error.

`POST .../jobs/:id/retry` starts a job again only in one of these states:

- `failed`.
- `queued`, with no change for more than 5 minutes.

For a retry, the API sets the state to `queued`, sets `maxAttempts` to `attempt` plus 5 and clears `finishedAt` and `progress`. Then it dispatches the job again. In all other states, the result is `INVALID_STATE`.

### Job events

1. `GET .../jobs/:id/events` sends a `job` event with the full job.
2. If the job is `succeeded`, `failed` or `cancelled`, the API sends a `done` event and closes the stream.
3. If not, the API reads the job again each 2 seconds.
4. When the state, `updatedAt` or `progress` changes, the API sends a new `job` event. After a final state, it sends `done`.
5. If nothing changes for 15 seconds, the API sends the comment line `: ping`.
6. The API closes the stream after 30 minutes.

## States and errors

### Error codes

The API sends each error in the error envelope. The trace ID is in the envelope and in the `x-request-id` header.

| Code | Status | Cause |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | A `/v1` route without a valid session. |
| `NOT_FOUND` | 404 | An unknown route, a path ID that is not a UUID, or a document, job or company that is not in the workspace of the user. |
| `VALIDATION_FAILED` | 400 | The body or the query does not agree with its schema. Also a company that is not in the workspace, and a classification change that changes nothing. |
| `CONFLICT` | 409 | A company name or identifier that the workspace has. A stale `basedOn`. A job key that a different workspace has. |
| `UPLOAD_TOO_LARGE` | 413 | The declared `size` is more than `MAX_UPLOAD_BYTES`. |
| `INVALID_STATE` | 409 | The document or the job is not in the correct state for the action. |
| `INTERNAL` | 500 | An unexpected error. The message is always `internal error`. The log has the stack. |
| `FORBIDDEN` | 403 | Not used by an API route. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Not used by an API route. A type that is not PDF gets `VALIDATION_FAILED`. |
| `RATE_LIMITED` | 429 | Not used by an API route. |

Better Auth makes its own responses for `/api/auth/*`. These responses do not use the error envelope. A request over the rate limit gets status 429 from Better Auth. The `/dev` routes also send a short `{ "error" }` body, not the error envelope.

### Document states and intake states

| State | Cause | Result |
| --- | --- | --- |
| `pending_upload` | `POST .../uploads` writes the document. | `finalize` checks that the object exists. |
| `uploaded` | `finalize` finds the object. | A `document.verify` job starts. |
| `stored` | The API does not write this state. | `download`, `extract` and `classify` work only in this state. |
| `rejected` | The API does not write this state. | `finalize` gives `INVALID_STATE`. Make a new upload. |
| `identifying` | `POST .../classify`. | A new `document.classify` job starts. |
| `needs_kind` | The kind is `not_sure`. | The user must give the kind. |
| `needs_company` | A read kind without a company. | The user must give the company. |
| `kept` | The kind is `other`. | No read starts. |
| `reading` | A read kind with a company. | A `document.extract` job starts. |

The API does not write the other intake states or the state `verifying`.

### Job states

| State | Cause | Result |
| --- | --- | --- |
| `queued` | `createJob` or a retry. | The dispatcher sends the job to the worker. |
| `running`, `succeeded`, `failed`, `cancelled` | The API does not write these states. | The events stream ends after `succeeded`, `failed` or `cancelled`. |

### Start errors

`loadEnv` stops the start with the message `invalid environment` in these conditions:

- A value does not agree with its schema.
- `STORAGE_DRIVER=gcs` and `GCS_BUCKET` has no value.
- `DISPATCH_MODE=local` and `DISPATCH_SECRET` has no value.
- `DISPATCH_MODE=cloud-tasks` and `WORKER_INVOKER_SA` or `GOOGLE_CLOUD_PROJECT` has no value.
- Only one of `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` has a value.
- `MAIL_DRIVER=resend` and `RESEND_API_KEY` or `MAIL_FROM` has no value.
- In production: `STORAGE_DRIVER=disk`, `MAIL_DRIVER=console`, no Google values, or no `TRUSTED_PROXIES`.

## Data

### Tables

The API writes these tables directly or through `@maester/db`:

- `user`, `session`, `account`, `verification` and `rate_limit`, through Better Auth.
- `waitlist_entry`, through `admitOrWaitlist` and `approveWaitlistEmail`.
- `workspace` and `membership`, through `ensurePersonalWorkspace`.
- `company`, `document`, `document_classification` and `classification_evidence`.
- `job`, through `createJob`, `retryJob` and `decideIntake`.

The API reads the `extraction_revision`, `extraction_check`, `financial_fact` and `source_reference` tables through `@maester/db`. It does not write them.

### Object store

- `gcs`: a Cloud Storage bucket, `GCS_BUCKET`.
- `disk`: a local directory, `STORAGE_DIR`. The API signs URLs to its own `/dev/blobs/*` routes with `DISPATCH_SECRET`, or with `BETTER_AUTH_SECRET` if `DISPATCH_SECRET` has no value.

### External services

- Google, for sign-in.
- Resend (`https://api.resend.com/emails`), for mail when `MAIL_DRIVER=resend`. The API stops a call to Resend after 10 seconds.
- Cloud Tasks, when `DISPATCH_MODE=cloud-tasks`.
- The worker, at `WORKER_URL`.

### Environment variables

The `dev` script reads the root `.env` file. A value that is an empty string counts as no value for the Google and Resend variables.

| Variable | Default | Rule |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. |
| `PORT` | `8787` | The HTTP port. |
| `LOG_LEVEL` | `info` | The pino log level. |
| `DATABASE_URL` | None | Always necessary. The Postgres connection string. |
| `BETTER_AUTH_SECRET` | None | Always necessary. 32 characters or more. |
| `BETTER_AUTH_URL` | None | Always necessary. The web origin. Links in mail start with it. |
| `ALLOWED_ORIGINS` | Empty | A comma-separated list for CORS and for Better Auth. |
| `STORAGE_DRIVER` | `gcs` | `gcs` or `disk`. Production refuses `disk`. |
| `STORAGE_DIR` | `data/blobs` | The directory for `disk`. |
| `GCS_BUCKET` | None | Necessary for `gcs`. |
| `GOOGLE_CLOUD_PROJECT` | None | Necessary for `cloud-tasks`. |
| `GOOGLE_CLOUD_LOCATION` | `asia-south1` | The location of the Cloud Tasks queue. |
| `DISPATCH_MODE` | `local` | `local` or `cloud-tasks`. |
| `WORKER_URL` | None | Always necessary. The base URL of the worker. |
| `DISPATCH_SECRET` | None | Necessary for `local`. |
| `CLOUD_TASKS_QUEUE` | `maester-jobs` | The name of the Cloud Tasks queue. |
| `WORKER_INVOKER_SA` | None | Necessary for `cloud-tasks`. The service account for the OIDC token. |
| `MAX_UPLOAD_BYTES` | `52428800` | The largest upload, 50 MiB. |
| `UPLOAD_URL_TTL_SECONDS` | `900` | The time limit of a signed upload URL. |
| `DOWNLOAD_URL_TTL_SECONDS` | `300` | The time limit of a signed download URL. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | None | Both or neither. Necessary in production. |
| `AUTH_RATE_LIMIT` | `off` | `on` or `off`. Production always uses the rate limiter. |
| `TRUSTED_PROXIES` | Empty | A comma-separated list of proxy addresses or CIDR ranges. Necessary in production. |
| `MAIL_DRIVER` | `console` | `console` or `resend`. The `console` driver writes the mail to the log. Production refuses it. |
| `RESEND_API_KEY`, `MAIL_FROM` | None | Necessary for `resend`. |
| `MIGRATIONS_FOLDER` | None | Only for `migrate.ts`. The Docker image sets `/app/drizzle`. |
| `DATABASE_URL_TEST_API` | `postgres://maester:maester@localhost:5433/maester_test_api` | Only for the tests. |

## Procedures

### To run the tests

1. Start Postgres with `pnpm db:up` from the root of the repository.
2. Make sure that the `maester_test_api` database exists.
3. If the test database has a different address, set `DATABASE_URL_TEST_API`:

   ```bash
   export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:5433/maester_test_api
   ```

4. Run the tests:

   ```bash
   pnpm --filter @maester/api test
   ```

Note: The script `scripts/db/init.sql` creates the test database on the first start of the Postgres volume.

### To start the API as a local process

1. Make sure that the root `.env` file has the variables in the Data section.
2. Start Postgres:

   ```bash
   pnpm db:up
   ```

3. Apply the migrations:

   ```bash
   pnpm --filter @maester/db migrate
   ```

4. Start the API:

   ```bash
   PORT=8787 pnpm dev:api
   ```

   Note: The API starts again when a source file changes.

5. Check that the API sends a response:

   ```bash
   curl http://localhost:8787/healthz
   ```

### To apply the migrations from the API image

1. Set `DATABASE_URL`.
2. Set `MIGRATIONS_FOLDER` to the folder with the migration files.
3. Run the migration program:

   ```bash
   node dist/migrate.js
   ```

### To approve an email on the waitlist

1. Set `DATABASE_URL`, or put it in the root `.env` file.
2. Run the approval script:

   ```bash
   pnpm --filter @maester/db waitlist:approve person@example.com
   ```

## Warnings and cautions

WARNING: Set `NODE_ENV=production` on a public server. If `NODE_ENV` has no value, the API uses `development`. In `development` and `test`, `POST /dev/auth/admit` approves and confirms any email without a check. The rate limiter is also off unless `AUTH_RATE_LIMIT=on`. The Docker image sets `production`, but other start methods do not.

WARNING: Keep `DISPATCH_SECRET` and `BETTER_AUTH_SECRET` private. The API sends `DISPATCH_SECRET` to the worker in each local dispatch. With the `disk` driver, a person with the secret can make a valid signed URL for any object.

CAUTION: Set `DATABASE_URL_TEST_API` only to a test database. The test setup empties the user, session, workspace, document, job and waitlist tables in that database.

## Limits

- No API route sends `FORBIDDEN`, `UNSUPPORTED_MEDIA_TYPE` or `RATE_LIMITED` in the error envelope.
- The API has no route to cancel a job, and no route to delete a document or a company.
- `GET /v1/workspaces` does not use pages. `nextCursor` is always `null`.
- The document list reads the latest job and the classification of each document with separate queries.
- In `local` mode, if the request to the worker fails, the API only writes a log record. The job stays `queued` until a retry.
- The Cloud Tasks dispatcher of the API sets no dispatch deadline. Cloud Tasks then uses its default.
- The events stream ignores `Last-Event-ID`. Each event has the full job.
- The deployment target of the API: Not known.
- The port of the API in production: Not known. The Dockerfile declares port 8080, but the image does not set `PORT`, and the default is 8787.

## Sources

- [apps/api/package.json](../../apps/api/package.json)
- [apps/api/Dockerfile](../../apps/api/Dockerfile)
- [apps/api/src/server.ts](../../apps/api/src/server.ts)
- [apps/api/src/app.ts](../../apps/api/src/app.ts)
- [apps/api/src/env.ts](../../apps/api/src/env.ts)
- [apps/api/src/auth.ts](../../apps/api/src/auth.ts)
- [apps/api/src/errors.ts](../../apps/api/src/errors.ts)
- [apps/api/src/validation.ts](../../apps/api/src/validation.ts)
- [apps/api/src/logger.ts](../../apps/api/src/logger.ts)
- [apps/api/src/migrate.ts](../../apps/api/src/migrate.ts)
- [apps/api/src/store.ts](../../apps/api/src/store.ts)
- [apps/api/src/serialize.ts](../../apps/api/src/serialize.ts)
- [apps/api/src/middleware/](../../apps/api/src/middleware/)
- [apps/api/src/routes/](../../apps/api/src/routes/)
- [apps/api/src/jobs/create.ts](../../apps/api/src/jobs/create.ts)
- [apps/api/src/dispatch/index.ts](../../apps/api/src/dispatch/index.ts)
- [apps/api/src/mail/](../../apps/api/src/mail/)
- [apps/api/test/](../../apps/api/test/)
- [packages/jobs/src/create.ts](../../packages/jobs/src/create.ts)
- [packages/jobs/src/intake.ts](../../packages/jobs/src/intake.ts)
- [packages/jobs/src/dispatch.ts](../../packages/jobs/src/dispatch.ts)
- [packages/db/src/queries/waitlist.ts](../../packages/db/src/queries/waitlist.ts)
- [packages/db/src/queries/workspaces.ts](../../packages/db/src/queries/workspaces.ts)
- [packages/db/package.json](../../packages/db/package.json)
- [packages/contracts/src/common.ts](../../packages/contracts/src/common.ts)
- [packages/contracts/src/document.ts](../../packages/contracts/src/document.ts)
- [packages/contracts/src/classification.ts](../../packages/contracts/src/classification.ts)
- [packages/contracts/src/job.ts](../../packages/contracts/src/job.ts)
- [packages/db/src/schema/](../../packages/db/src/schema/)
- [scripts/db/init.sql](../../scripts/db/init.sql)
- [docker-compose.yml](../../docker-compose.yml)
- [docs/DEVELOPMENT.md](../DEVELOPMENT.md), section 8, for the test databases
