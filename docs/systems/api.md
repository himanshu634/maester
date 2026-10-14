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
| provider | A market data source that the user connects in Settings: `dhan` (Dhan) or `fred` (FRED). |
| secret | The Dhan access token or the FRED API key that a user gives for a provider. |
| connection | The row in the `market_connection` table for one provider. It holds the encrypted secret. |
| connections key | The value of `CONNECTIONS_KEY`: 32 bytes in base64. The API uses it to encrypt each secret. |
| series | All rows in the `market_point` table with one `series` name, for example `nifty50`. One row is one value for one day. |
| refresh run | A row in the `market_fetch` table. The market refresher of the worker writes it. |
| trading day | One day in the `nifty50` series. The code calls the latest trading day `latestSession`. |
| reading | One of the 10 market values on the market mood page, with its day, rank and score. The contract is `Reading`. |
| scored reading | One of the 7 readings that make the mood. |
| rank | The percentage of earlier values of a reading that are lower than its current value. An equal value counts as one half. |
| score | The part that a scored reading gives to the mood, 0 to 100. |
| mood | The rounded average of the scores, 0 to 100. |
| band | The name of the range that the mood is in, for example `cautious`. |
| filing | A document that has a company. `listCompanyFilings` gives the filings of a workspace or of one company. |
| read annual report | A filing with the kind `annual_report` and the intake state `read`. Only these filings go into the statement tables. |
| statement table | One `StatementTable`: the statement lines of one statement on one basis, with one year column for each financial year. |
| statement line | One line of a statement table, with a section and a printed label. The contract calls it a row. |
| year column | One financial year of a statement table. Each year column comes from one filing. |
| cell | One figure of one statement line in one year column. It has a status, a source page and a check. |
| stock | The answer of `GET .../companies/:id/stock`: the NSE closing prices of the share of one company. |
| closing price | The value of one day in the series `eq:<SYMBOL>`. |

## Function

The API signs users in, keeps their sessions and admits only the emails that the waitlist approves. For a signed-in member of a workspace, it writes companies and documents, gives signed URLs for upload and download, and creates jobs. The worker does the slow work of each job. The API only writes the job row and tells the worker about it. The browser reads the result from the API later, or follows a job through a Server-Sent Events stream. The browser reaches the API through the proxy of the web origin.

The API also has two groups of routes that need a session but no workspace. The market mood routes calculate the mood from the series that the worker stores. The Settings routes check a secret with its provider, then keep it encrypted as a connection.

The Research routes need a workspace. They put the statements of a company together from its read annual reports. They also give the closing prices of its share from the series that the worker stores.

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
| Serialize | `apps/api/src/serialize.ts` | Changes database rows into the JSON shapes of `@maester/contracts`. `toFetchStatus` gives the status of the latest refresh run. |
| Market mood routes | `apps/api/src/routes/market-mood.ts` | Read the series and the latest refresh run, then send the mood or one reading. |
| Mood calculation | `apps/api/src/market-mood/compute.ts` | Calculates the readings, the ranks, the scores, the mood and the history. It uses no database and no clock. |
| Connections routes | `apps/api/src/routes/connections.ts` | List, check, keep and remove the connections. |
| Research routes | `apps/api/src/routes/research.ts` | Send the list of companies, the statement tables of one company and the stock of one company. |
| Stitch | `apps/api/src/financials/stitch.ts` | `stitch` puts the facts of the read annual reports of one company into statement tables. It uses no database and no clock. |
| Stock | `apps/api/src/financials/stock.ts` | `stockFrom` makes the stock from the points of one series. It uses no database. |
| Logger | `apps/api/src/logger.ts` | Writes JSON log records with pino. Removes the `cookie` and `authorization` request headers from the log. |
| Migrate | `apps/api/src/migrate.ts` | Applies the database migrations, then stops. |
| Tests | `apps/api/test/` | Vitest tests. They use a real Postgres database. |

The API uses five shared packages: `@maester/db`, `@maester/contracts`, `@maester/jobs`, `@maester/storage` and `@maester/market`. From `@maester/market`, it uses `encryptSecret`, `HttpDhanSource` and `HttpFredSource`. Read [shared packages](packages.md) for them.

## Operation

### Routes

All routes under `/v1` need a session. All routes under `/v1/workspaces/:ws/` also need the user to be a member of the workspace `:ws`.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/healthz` | `{ "status": "ok" }`. No session is necessary. |
| GET, POST | `/api/auth/*` | Better Auth sends the response. |
| GET | `/v1/me` | The user and the workspaces of the user. |
| GET | `/v1/market-mood` | The mood, the 10 readings, the history and the status of the latest refresh run. No workspace is necessary. |
| GET | `/v1/market-mood/readings/:key` | One reading and its last 500 values. No workspace is necessary. |
| GET | `/v1/settings/connections` | The two connections, `dhan` first. No workspace is necessary. |
| PUT | `/v1/settings/connections/dhan` | Checks a Dhan secret with Dhan, then keeps it. |
| PUT | `/v1/settings/connections/fred` | Checks a FRED secret with FRED, then keeps it. |
| DELETE | `/v1/settings/connections/:provider` | Removes a connection. Status 204. |
| GET | `/v1/workspaces` | The workspaces of the user. `nextCursor` is always `null`. |
| GET | `/v1/workspaces/:ws` | One workspace. |
| POST | `/v1/workspaces/:ws/companies` | Creates a company. Status 201. |
| GET | `/v1/workspaces/:ws/companies` | A page of companies. |
| GET | `/v1/workspaces/:ws/companies/:id` | One company. |
| GET | `/v1/workspaces/:ws/research/companies` | The companies for the Research list, with the annual reports that Maester read. |
| GET | `/v1/workspaces/:ws/companies/:id/financials` | The statement tables of one company, and its filings. |
| GET | `/v1/workspaces/:ws/companies/:id/stock` | The stock of one company. |
| POST | `/v1/workspaces/:ws/documents/uploads` | Creates a document and a signed upload URL. Status 201. |
| POST | `/v1/workspaces/:ws/documents/:id/finalize` | Checks the upload and creates a `document.verify` job. |
| GET | `/v1/workspaces/:ws/documents` | A page of documents. |
| GET | `/v1/workspaces/:ws/documents/:id` | One document, with its latest job and its current classification. |
| GET | `/v1/workspaces/:ws/documents/:id/download` | A signed download URL. |
| GET | `/v1/workspaces/:ws/documents/:id/file` | A redirect to a signed download URL of the PDF. Status 302. The API does not cache the response. |
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

### Market mood

1. The browser sends `GET /v1/market-mood`. The route needs a session. It does not need a workspace.
2. The API reads 8 series from the `market_point` table, from 1,464 days (4 × 366) before the current date. It also reads the latest refresh run.
3. `computeMood` makes the 10 readings from these series. The table after these steps shows each reading.
4. For each reading, the API uses the value on the latest trading day, or the last value before that day.
5. The API compares this value with up to 500 earlier values of the same reading, to get the rank. 500 values are about 2 years. With fewer than 250 earlier values, the reading has no rank.
6. If the value is more than 4 days older than the latest trading day, the reading is stale. A stale reading has no score.
7. The score of a scored reading is its rank. For `india_vix`, `us_vix` and `gold_vs_nifty`, the score is 100 minus the rank, because a high value shows caution.
8. The mood is the rounded average of the scores. If fewer than 5 of the 7 scored readings have a score, there is no mood.
9. The API calculates the mood again for each of the last 250 trading days. The history keeps each day with a mood.
10. `atOrBelowShare` is the percentage of the history days with a mood at or below the current mood.
11. The response also has the band, `scoredCount`, `asOf`, `latestSession`, `provisional` and `fetch`.

| Reading | Family | Scored | Score | Series |
| --- | --- | --- | --- | --- |
| `india_vix` | `fear` | Yes | 100 minus the rank | `india_vix` |
| `us_vix` | `fear` | Yes | 100 minus the rank | `us_vix` |
| `nifty_pcr` | `fear` | No | None | `nifty_pcr_oi` |
| `fpi_flows` | `money` | Yes | The rank | No series. The reading is always `no_source`. |
| `dii_flows` | `money` | No | None | No series. The reading is always `no_source`. |
| `nifty_trend` | `breadth` | Yes | The rank | Calculated from `nifty50`: the percentage above the average of the last 125 trading days. |
| `n500_above_200d` | `breadth` | Yes | The rank | `n500_above_200d_pct` |
| `n500_net_highs` | `breadth` | Yes | The rank | `n500_net_highs_pct` |
| `usd_inr` | `havens` | No | None | `usd_inr` |
| `gold_vs_nifty` | `havens` | Yes | 100 minus the rank | Calculated: the change of `gold_mcx` over 20 trading days, minus the change of `nifty50` over the same days. A day is left out if its gold close, or the gold close at its start, is more than 4 days older than the Nifty day. |

Other rules for the mood:

- The band is `very_cautious` below 20, `cautious` below 40, `middling` below 60, `eager` below 80, and `very_eager` from 80.
- `asOf` is the oldest day of the scored readings that have a score.
- `provisional` is true when a scored reading for India has a score and a day before the latest trading day. `us_vix` and `usd_inr` do not make the mood provisional.
- `previous` in a reading is the value 5 rows earlier for the `fear` readings, and 20 rows earlier for all other readings.
- The `source` of a reading is the `source` of its last row. If the reading has no rows, it is a fixed label, for example `FRED · Cboe VIX close`.
- If the `nifty50` series has no rows, no reading is stale, `provisional` is false and the history is empty.

`toFetchStatus` gives `fetch` from the latest refresh run:

- If there is no refresh run, `state` is `never`.
- If not, `state` is the state of the run. `at` is the time that the run finished, or the time that it started if it did not finish.
- `errorCode` has a value only for a `failed` run. A code that the contract does not know becomes `UNKNOWN`.

`GET /v1/market-mood/readings/:key` calculates the full mood, then sends one reading and the last 500 values of its series, oldest first. If `:key` is not one of the 10 readings, the result is `NOT_FOUND`.

### Research

1. `GET .../research/companies` reads up to 100 companies and the filings of all companies in the workspace.
2. For each company, the response gives `annualReportsRead`, the number of read annual reports, and `latestPeriodEnd`, the newest period end of these filings.
3. `reading` counts the filings of the company with the intake state `identifying` or `reading`. `failed` counts the filings with the state `identify_failed` or `read_failed`.
4. The list is in the order of `displayName`.
5. `GET .../companies/:id/financials` gets the company. If the company is not in the workspace, the result is `NOT_FOUND`.
6. `listCompanyFilings` gives the filings of the company. The route keeps the read annual reports and gets the current revision of each. If a filing has no revision, the route does not use it.
7. One query gets the facts of these revisions with their pages. One query gets their checks.
8. `stitch` makes the statement tables. The response has the company, all its filings and the statement tables. A filing has `counted` when its facts are in the statement tables.

The rule of `stitch` has three parts:

- `stitch` sorts the read annual reports by period end, newest first, then by the time of the revision.
- Each year column takes all its figures from the first filing in this order that prints its period. Thus a year column never mixes two filings.
- A statement line of one filing matches a statement line of another filing when the section and the printed label are equal after `normalise`. Thus a renamed statement line is two statement lines.

Other rules for the statement tables:

- `stitch` makes one statement table for each statement and basis that a read annual report has.
- The year columns are in the order of their period, oldest first. A fact with no period end and no as-of date goes in no year column. `unplaced` counts these facts.
- The statement lines follow the order of the newest year column. A statement line that only an older year column has goes in after the statement line before it.
- The unit of a statement table is the unit of the newest filing that has facts for the statement and the basis.
- If the scale of an older filing differs from the scale of the table, `stitch` moves the decimal point of its figures. If the currency is different, `leftOut` names the filing and `stitch` does not use it. `leftOut` also names it if one of the two scales has no value or is not a power of 10.
- A per-share line is a statement line with a section or label that matches `earnings per share`, `earnings per equity share` or `eps` after `normalise`. The API sends the printed value of a per-share line and never moves its decimal point.
- The `status` of a cell is `value`, `dash`, `unparsed` or `missing`. `missing` means that the filing of the year column does not print the statement line.
- If an older filing prints a different value or status for the same statement line and period, the cell has `restated`. It holds the page and the printed text of the older filing.
- A cell has the check of the subtotal that it is, or the check of the subtotal that has the statement line as a component. If more than one check applies, the worst status wins: `failed`, then `not_checked`, then `passed`.
- A filing with the kind `financial_results` is not in the statement tables.

`GET .../companies/:id/stock` has these steps:

1. The route gets the company. If the company is not in the workspace, the result is `NOT_FOUND`.
2. The series of the company is `eq:` and its `nseSymbol`. `latestMarketDay` gives the newest day of this series.
3. If the series has days, the route reads the closing prices of the last 380 days. Then `stockFrom` makes the stock.
4. `last` is the newest closing price. `previous` is the closing price before it.
5. `series` has the closing prices of the last 365 days, oldest first. `low` and `high` are the first lowest and the first highest value in `series`.
6. `yearAgo` is the newest closing price on or before the day 365 days before `last`. If this closing price is more than 10 days older than that day, `yearAgo` is `null`.
7. `source` is the `source` of the newest closing price.

| State | Cause | Result |
| --- | --- | --- |
| `ok` | The series has closing prices. | `last`, `low`, `high` and `series` have values. `previous` and `yearAgo` can be `null`. |
| `no_symbol` | The company has no `nseSymbol`. | All values are `null`, and `series` is empty. |
| `not_connected` | The series has no closing price, and the install has no Dhan connection. | `symbol` has the symbol. All other values are `null`, and `series` is empty. |
| `not_tracked` | The series has no closing price, and the install has a Dhan connection. The worker stores closing prices only for the Nifty 500 members. | `symbol` has the symbol. All other values are `null`, and `series` is empty. |

`GET .../documents/:id/file` gets the document. If the state is not `stored`, the result is `INVALID_STATE`. If not, the API signs a download URL for the time `DOWNLOAD_URL_TTL_SECONDS` and sends a redirect with status 302 and `Cache-Control: no-store`. A browser keeps the fragment of an address across the redirect. Thus `.../file#page=213` opens the PDF at page 213.

### Settings connections

1. The `requireSession` middleware checks the session.
2. The connections routes check the connections key. If `CONNECTIONS_KEY` has no value, each route gives `INVALID_STATE`, before the body check.
3. A `PUT` route checks the body with a Zod schema. The Dhan body has `clientId` (1 to 32 characters) and `accessToken` (20 to 4,096 characters). The FRED body has `apiKey`: 32 lower-case letters and digits.
4. The API calls the provider with the secret. For Dhan, it calls `GET https://api.dhan.co/v2/profile`. For FRED, it asks for the latest value of the `VIXCLS` series.
5. If the call fails, the API keeps nothing. The table after these steps shows the result.
6. For Dhan, if the client ID from Dhan is not the `clientId` of the request, the result is `VALIDATION_FAILED` on `clientId`.
7. `encryptSecret` encrypts the secret with AES-256-GCM and the connections key. It uses a new random 12-byte IV each time.
8. The API writes the connection: the encrypted secret, its last 4 characters, the expiry from Dhan, `checkedAt` and `savedByUserId`. A new save replaces the old connection.
9. The response is the same item that `GET /v1/settings/connections` gives for the provider.

| Code from the provider | Status | Result |
| --- | --- | --- |
| `DHAN_TOKEN_EXPIRED` | 400 | `VALIDATION_FAILED`, with one entry in `fields` for `accessToken`. |
| `FRED_KEY_REFUSED` | 400 | `VALIDATION_FAILED`, with one entry in `fields` for `apiKey`. |
| `DHAN_RATE_LIMITED` | 429 | `RATE_LIMITED`. |
| All other failures | 503 | `INTERNAL`, with the message `SOURCE_UNAVAILABLE`. |

Other rules for the connections:

- The API never sends a secret back. A connection shows only `last4`, the last 4 characters of the secret.
- When a check fails, the log gets only the provider, the code and the name of the error. The message of the error does not go into the response or the log.
- A save sets `lastErrorCode` to no value. But if Dhan accepts the token and the Data API plan is off, the save sets `DHAN_NO_DATA_PLAN`.
- If the expiry from Dhan does not parse, the connection has no expiry.
- `HttpDhanSource` sends 4 requests or fewer each second. Each call stops after 30 seconds. If Dhan sends a rate limit, `HttpDhanSource` tries again after 1, 2 and 4 seconds.
- `HttpFredSource` stops a call after 30 seconds. FRED status 400, 401 or 403 gives `FRED_KEY_REFUSED`. All other failures give `SOURCE_UNAVAILABLE`, also a FRED rate limit.
- `DELETE .../connections/:provider` sends status 204, also when the connection does not exist. A provider that is not `dhan` or `fred` gets `NOT_FOUND`.
- `lastRead` is the latest `fetched_at` of a row in `market_point` with a `source` that starts with `Dhan ·` or `FRED ·`.

## States and errors

### Error codes

The API sends each error in the error envelope. The trace ID is in the envelope and in the `x-request-id` header.

| Code | Status | Cause |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | A `/v1` route without a valid session. |
| `NOT_FOUND` | 404 | An unknown route, a path ID that is not a UUID, or a document, job or company that is not in the workspace of the user. Also an unknown reading and an unknown provider. |
| `VALIDATION_FAILED` | 400 | The body or the query does not agree with its schema. Also a company that is not in the workspace, and a classification change that changes nothing. Also a secret that the provider refuses, and a Dhan token for a different client ID. |
| `CONFLICT` | 409 | A company name or identifier that the workspace has. A stale `basedOn`. A job key that a different workspace has. |
| `UPLOAD_TOO_LARGE` | 413 | The declared `size` is more than `MAX_UPLOAD_BYTES`. |
| `INVALID_STATE` | 409 | The document or the job is not in the correct state for the action. Also a connections route when `CONNECTIONS_KEY` has no value. |
| `RATE_LIMITED` | 429 | Dhan sends a rate limit to the check of a Dhan secret, also after three more tries. |
| `INTERNAL` | 500 | An unexpected error. The message is `internal error`. The log has the stack. |
| `INTERNAL` | 503 | The check of a secret fails because the provider does not answer correctly. The message is `SOURCE_UNAVAILABLE`. |
| `FORBIDDEN` | 403 | Not used by an API route. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Not used by an API route. A type that is not PDF gets `VALIDATION_FAILED`. |

Better Auth makes its own responses for `/api/auth/*`. These responses do not use the error envelope. A request over the rate limit gets status 429 from Better Auth. The `/dev` routes also send a short `{ "error" }` body, not the error envelope.

### Document states and intake states

| State | Cause | Result |
| --- | --- | --- |
| `pending_upload` | `POST .../uploads` writes the document. | `finalize` checks that the object exists. |
| `uploaded` | `finalize` finds the object. | A `document.verify` job starts. |
| `stored` | The API does not write this state. | `download`, `file`, `extract` and `classify` work only in this state. |
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

### Reading states

A reading without a value or without a rank has a value in `missing`:

| State | Cause | Result |
| --- | --- | --- |
| `no_source` | The reading has no provider yet (`fpi_flows` and `dii_flows`). | No value, no rank and no score. |
| `no_data` | The series has no row on or before the latest trading day. | No value, no rank and no score. |
| `not_enough_history` | The reading has fewer than 250 earlier values. | A value, but no rank and no score. |
| `stale` | The value is more than 4 days older than the latest trading day. | A value and a rank, but no score. |
| No mood | Fewer than 5 scored readings have a score. | `score` and `band` are `null`. `scoredCount` shows how many have a score. |

### Connection states

| State | Cause | Result |
| --- | --- | --- |
| `not_connected` | The provider has no connection. | Only `lastRead` can have a value. |
| `connected` | The connection has no `lastErrorCode`, or has `DHAN_NO_DATA_PLAN`. | The last check or call with the secret did not fail. |
| `connected` with the notice `DATA_PLAN_INACTIVE` | `lastErrorCode` is `DHAN_NO_DATA_PLAN`. Dhan accepts the token, but the Data API plan is off. | The notice stays until a new save or a good call of the refresher. |
| `expired` | `lastErrorCode` is `DHAN_TOKEN_EXPIRED`, or `expiresAt` is now or earlier. | A save of a valid Dhan token clears this state. |
| `failing` | `lastErrorCode` has a different code. A FRED secret that FRED refuses is `failing`, because FRED secrets do not expire. | A save of a valid secret, or a good call of the refresher, clears this state. |

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
- `market_connection`, through `saveConnection` and `deleteConnection`. It has one row for each provider and no workspace column.

The API reads the `extraction_revision`, `extraction_check`, `financial_fact` and `source_reference` tables through `@maester/db`. It does not write them.

The Research routes read the `document` and `document_classification` tables with `listCompanyFilings`. They read the facts with their pages with `listFactsWithSourcesForRevisions`, and the checks with `listChecksForRevisions`. All three queries take the workspace ID.

The API reads the `market_point` and `market_fetch` tables through `listMarketSeries`, `latestMarketDay`, `latestMarketFetch` and `lastMarketReads`. It does not write them. The market refresher of the worker writes them. These tables have no workspace column.

### Object store

- `gcs`: a Cloud Storage bucket, `GCS_BUCKET`.
- `disk`: a local directory, `STORAGE_DIR`. The API signs URLs to its own `/dev/blobs/*` routes with `DISPATCH_SECRET`, or with `BETTER_AUTH_SECRET` if `DISPATCH_SECRET` has no value.

### External services

- Google, for sign-in.
- Resend (`https://api.resend.com/emails`), for mail when `MAIL_DRIVER=resend`. The API stops a call to Resend after 10 seconds.
- Cloud Tasks, when `DISPATCH_MODE=cloud-tasks`.
- The worker, at `WORKER_URL`.
- Dhan (`https://api.dhan.co/v2`), to check a Dhan secret. Only `PUT .../connections/dhan` calls it.
- FRED (`https://api.stlouisfed.org/fred`), to check a FRED secret. Only `PUT .../connections/fred` calls it.

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
| `CONNECTIONS_KEY` | None | 32 bytes in base64. It encrypts each secret. Without a value, the connections routes give `INVALID_STATE`. A value that is not 32 bytes in base64 stops the start. |
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

WARNING: Keep `DISPATCH_SECRET`, `BETTER_AUTH_SECRET` and `CONNECTIONS_KEY` private. A person with `CONNECTIONS_KEY` and the database can decrypt the Dhan and FRED secrets. The API sends `DISPATCH_SECRET` to the worker in each local dispatch. With the `disk` driver, a person with the secret can make a valid signed URL for any object.

CAUTION: Set `DATABASE_URL_TEST_API` only to a test database. The test setup empties the user, session, workspace, document, job and waitlist tables in that database.

## Limits

- No API route sends `FORBIDDEN` or `UNSUPPORTED_MEDIA_TYPE` in the error envelope.
- The API has no route to cancel a job, and no route to delete a document or a company.
- `GET /v1/workspaces` does not use pages. `nextCursor` is always `null`.
- The document list reads the latest job and the classification of each document with separate queries.
- In `local` mode, if the request to the worker fails, the API only writes a log record. The job stays `queued` until a retry.
- The Cloud Tasks dispatcher of the API sets no dispatch deadline. Cloud Tasks then uses its default.
- The events stream ignores `Last-Event-ID`. Each event has the full job.
- The connections are global to the install. Any approved user with a session can replace or delete the Dhan and FRED secrets.
- No rate limit applies to the `PUT` routes for the connections. Each call of these routes sends a request to Dhan or FRED.
- The API shows market data only to a user with a session. All users see the same market data, because it has no workspace.
- `fpi_flows` and `dii_flows` have no provider. Thus the mood uses 6 of the 7 scored readings at most.
- The API calculates the mood again for each request and keeps no cache. A request for one reading also calculates the full mood.
- The Research list shows 100 companies at most. It has no pages.
- The statement tables use only read annual reports. Results for a quarter or a half year are not in them.
- The financials route reads all facts of each read annual report for each request. It keeps no cache.
- The stock has the closing prices of the Nifty 500 members only. The worker stores no other closing price.
- The API does not decrypt a secret and does not write market data. The market refresher of the worker does this work.
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
- [apps/api/src/market-mood/compute.ts](../../apps/api/src/market-mood/compute.ts)
- [apps/api/src/financials/](../../apps/api/src/financials/)
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
- [packages/contracts/src/market-mood.ts](../../packages/contracts/src/market-mood.ts)
- [packages/contracts/src/connection.ts](../../packages/contracts/src/connection.ts)
- [packages/contracts/src/research.ts](../../packages/contracts/src/research.ts)
- [packages/db/src/queries/research.ts](../../packages/db/src/queries/research.ts)
- [packages/db/src/queries/market.ts](../../packages/db/src/queries/market.ts)
- [packages/market/src/secrets.ts](../../packages/market/src/secrets.ts)
- [packages/market/src/dhan.ts](../../packages/market/src/dhan.ts)
- [packages/market/src/fred.ts](../../packages/market/src/fred.ts)
- [packages/db/src/schema/](../../packages/db/src/schema/)
- [scripts/db/init.sql](../../scripts/db/init.sql)
- [.env.example](../../.env.example)
- [docker-compose.yml](../../docker-compose.yml)
- [docs/DEVELOPMENT.md](../DEVELOPMENT.md), section 8, for the test databases
