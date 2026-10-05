# @maester/contracts

`@maester/contracts` is the single source of truth for the shapes that cross the wire between the API (`apps/api`), the worker (`apps/worker`) and any frontend. It exports Zod schemas and their inferred TypeScript types; there is no OpenAPI document and no code generation step. This README is the integration guide the frontend (the SvelteKit app in `apps/web`) builds against.

```ts
import { Document, Job, ApiError } from "@maester/contracts";
```

## 1. Origins, cookies and CORS

The browser talks to one origin, the web origin. In development `vite dev` and `vite preview`, and in production the web container's nginx, proxy `/api/auth/*`, `/v1/*` and `/dev/*` to the API. Better Auth sets an `HttpOnly` cookie named `maester.session_token` (cookie prefix `maester`) on that origin; in production it is `__Secure-maester.session_token`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, because secure cookies add the `__Secure-` prefix. The cookie is first-party and the browser sends it on every call to the web origin. This is how Maester runs, locally (`http://localhost:5173`, proxying to the API on `:8787`) and deployed.

Any browser client must:

- Call the web origin with relative URLs (`fetch("/v1/me")`, `authClient` with `baseURL: window.location.origin`). Never call the API's own origin: the raw `*.run.app` URL is a different site from the frontend, and the `SameSite=Lax` session cookie is not sent to it. `credentials: "include"` is harmless but not needed for same-origin calls.
- Be served from an origin listed in the API's `ALLOWED_ORIGINS` environment variable, which holds the web origin only. Better Auth's `BETTER_AUTH_URL` is the same web origin, so the Google callback is `<web origin>/api/auth/callback/google`.
- Treat the session cookie as unreadable. Script cannot see an `HttpOnly` cookie: ask the API (`GET /api/auth/get-session`) who is signed in.

The proxy passes `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`, and streams Server-Sent Events and uploads without buffering. `/dev/*` is proxied too, for the development upload page and signed local blob URLs; the API does not mount it in production.

```http
GET /v1/me HTTP/1.1
Host: localhost:5173
Cookie: maester.session_token=<opaque-session-value>
```

## 2. Authentication endpoints

Authentication is [Better Auth](https://www.better-auth.com/) mounted at `/api/auth/*`, with Google and email/password with email confirmation enabled, behind a waitlist (see [sign-in](../../docs/SIGN_IN.md)). Use its Svelte client (`better-auth/svelte`) to call these rather than hand-rolling `fetch` calls — the client manages the cookie and exposes a reactive session store.

The endpoints the web uses, all under `/api/auth`:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/sign-in/social` | Start Google sign-in; returns the Google URL to go to |
| GET | `/callback/google` | Google returns here; Better Auth sets the session and redirects |
| POST | `/sign-in/email` | Email and password sign-in |
| POST | `/sign-up/email` | Create an account for an approved email |
| GET | `/verify-email` | The emailed confirmation link |
| POST | `/send-verification-email` | Send a fresh confirmation link |
| POST | `/request-password-reset` | Email a reset link |
| POST | `/reset-password` | Set a new password with the emailed token |
| GET | `/get-session` | The current session, or `null` |
| POST | `/sign-out` | End the session |

The raw HTTP shapes of the main calls:

```http
POST /api/auth/sign-in/social
Content-Type: application/json

{ "provider": "google", "callbackURL": "/terminal", "errorCallbackURL": "/login" }
```

```http
POST /api/auth/sign-up/email
Content-Type: application/json

{ "name": "Dev User", "email": "dev@example.com", "password": "correct-horse-battery", "callbackURL": "/verify-email" }
```

```http
POST /api/auth/sign-in/email
Content-Type: application/json

{ "email": "dev@example.com", "password": "correct-horse-battery", "callbackURL": "/verify-email" }
```

```http
POST /api/auth/sign-out
```

```http
GET /api/auth/get-session
```

A successful sign-in sets the `maester.session_token` cookie (`__Secure-maester.session_token` in production); `sign-out` clears it. `get-session` returns the current session (or `null`) using whatever cookie is attached to the request. The API creates a personal workspace for the new user during account creation itself — call `GET /v1/me` after the session is established to read it. Passwords are at least 8 characters, and confirmation and reset links last one hour; a reset link works once.

**Email sign-up never reveals the waitlist.** A sign-up for an email that is not approved answers the same `200` as one that is. It records a pending waitlist row and creates no user, so no error code distinguishes the two, and an approved address is the only one that is sent a confirmation link. Sign-in with an unconfirmed email answers `403 EMAIL_NOT_VERIFIED` and sends a fresh link. A sign-up for an address that already has an account answers the same `200` too, changes nothing, and emails the owner instead.

**Google-callback errors.** When Google sign-in cannot finish, Better Auth redirects to the `errorCallbackURL` with `?error=<code>`:

| Code | Meaning |
| --- | --- |
| `WAITLISTED` | The Google email is not approved. It is recorded as pending, and no account, session or workspace is created. A Google-callback code only: email sign-up never returns it |
| `GOOGLE_EMAIL_NOT_VERIFIED` | Google has not verified the email on the Google account; nothing is linked or created |
| `access_denied` | The person cancelled at Google |

Any other `?error=` value is a generic failure. Treat unknown codes as such and never show the raw string.

The JSON endpoints answer other Better Auth codes the web maps to copy: `INVALID_EMAIL_OR_PASSWORD` (401), `EMAIL_NOT_VERIFIED` (403), `INVALID_TOKEN` and `TOKEN_EXPIRED` (an expired confirmation link, or an expired or used reset link), and `429` when the auth rate limit is hit.

Everything else in this guide is under `/v1`.

## 3. Error envelope

Every non-2xx response from `/v1/*` uses the same envelope (contracts export `ApiError`):

<!-- schema: ApiError -->
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "size must be a positive integer",
    "fields": [{ "path": "size", "message": "Expected number, received string" }],
    "traceId": "3c1a9f7e2b4d4e6f"
  }
}
```

`fields` is present only for `VALIDATION_FAILED` responses with per-field detail; it is omitted otherwise. `traceId` echoes the `x-request-id` request header (or a generated id when the header is absent) and is also sent back as the `x-request-id` response header — include it when reporting a bug.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No valid session cookie |
| `FORBIDDEN` | 403 | Session valid, action not permitted |
| `NOT_FOUND` | 404 | Resource does not exist, or belongs to another workspace |
| `VALIDATION_FAILED` | 400 | Request body or query failed schema validation |
| `CONFLICT` | 409 | State conflict (e.g. duplicate) |
| `UPLOAD_TOO_LARGE` | 413 | Declared upload size exceeds the configured limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Declared or actual content type is not accepted |
| `INVALID_STATE` | 409 | Action is not valid for the resource's current state |
| `RATE_LIMITED` | 429 | Reserved; not yet enforced in the base |
| `INTERNAL` | 500 | Unhandled server error |

A cross-workspace request (a valid session requesting a `{ws}` the user is not a member of, or a document/job in a different workspace) returns `NOT_FOUND`, not `FORBIDDEN` — the API never confirms that a resource exists in a workspace the caller cannot see.

## 4. Routes

All routes below except `/healthz` and `/api/auth/*` are under `/v1` and require the session cookie. Workspace-scoped routes additionally require the caller to be a member of `{ws}` (a UUID).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | Liveness, no auth |
| \* | `/api/auth/*` | Better Auth (see §2) |
| GET | `/v1/me` | Current user and their workspace memberships |
| GET | `/v1/workspaces` | Workspaces the caller belongs to |
| GET | `/v1/workspaces/{ws}` | One workspace's detail |
| POST | `/v1/workspaces/{ws}/companies` | Create a company in the workspace |
| GET | `/v1/workspaces/{ws}/companies` | List companies (cursor pagination) |
| GET | `/v1/workspaces/{ws}/companies/{id}` | One company |
| POST | `/v1/workspaces/{ws}/documents/uploads` | Create a pending document (the company is optional; it is identified from the PDF) and a signed upload URL |
| POST | `/v1/workspaces/{ws}/documents/{id}/finalize` | Mark a document uploaded and enqueue verification |
| GET | `/v1/workspaces/{ws}/documents` | List documents (cursor pagination) |
| GET | `/v1/workspaces/{ws}/documents/{id}` | Document detail, including its latest job |
| GET | `/v1/workspaces/{ws}/documents/{id}/download` | Signed, time-limited read URL |
| POST | `/v1/workspaces/{ws}/documents/{id}/extract` | Enqueue a new extraction of a stored document |
| GET | `/v1/workspaces/{ws}/documents/{id}/extraction` | The current extraction revision (the one the current answers read under) and its checks |
| GET | `/v1/workspaces/{ws}/documents/{id}/facts` | A revision's facts with page references (the current revision by default) |
| GET | `/v1/workspaces/{ws}/documents/{id}/classification` | The current answers about what the document is (`DocumentClassification`: kind, company, period, with the evidence for each) |
| POST | `/v1/workspaces/{ws}/documents/{id}/classification` | Change those answers (`ChangeClassificationRequest`, `basedOn` is the classification id you loaded; `409` if it is no longer current); returns `ClassificationChanged` |
| POST | `/v1/workspaces/{ws}/documents/{id}/classify` | Identify the document again (`202`, `ClassifyJobResponse`) |
| GET | `/v1/workspaces/{ws}/jobs/{id}` | Job state |
| POST | `/v1/workspaces/{ws}/jobs/{id}/retry` | Re-enqueue a `failed` or stuck `queued` job |
| GET | `/v1/workspaces/{ws}/jobs/{id}/events` | Server-Sent Events stream of job progress (see §6) |

### `GET /v1/me`

<!-- schema: Me -->
```json
{
  "user": { "id": "usr_3f6a1c2b9d8e4f01", "name": "Dev User", "email": "dev@example.com" },
  "workspaces": [
    {
      "id": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
      "name": "Dev User's workspace",
      "ownerUserId": "usr_3f6a1c2b9d8e4f01",
      "locale": "en-IN",
      "createdAt": "2026-09-10T08:15:00Z"
    }
  ]
}
```

### `GET /v1/workspaces/{ws}`

<!-- schema: Workspace -->
```json
{
  "id": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
  "name": "Dev User's workspace",
  "ownerUserId": "usr_3f6a1c2b9d8e4f01",
  "locale": "en-IN",
  "createdAt": "2026-09-10T08:15:00Z"
}
```

### `POST /v1/workspaces/{ws}/companies`

A document is linked to a company once its company is identified from the PDF and confirmed (or when `companyId` is given at upload); until then its `companyId` is `null`. Names are unique per workspace, ignoring case (`409 CONFLICT` otherwise); `country` is an ISO 3166-1 alpha-2 code.

<!-- schema: CreateCompanyRequest -->
```json
{ "displayName": "Synthetic Industries Limited", "country": "IN" }
```

Response (`201 Created`), also the shape of `GET …/companies/{id}` and of each item of `GET …/companies`:

<!-- schema: Company -->
```json
{
  "id": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
  "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
  "displayName": "Synthetic Industries Limited",
  "country": "IN",
  "cin": null,
  "bseCode": null,
  "nseSymbol": null,
  "createdAt": "2026-09-10T08:14:00Z"
}
```

### `POST /v1/workspaces/{ws}/documents/uploads`

Request:

<!-- schema: CreateUploadRequest -->
```json
{
  "originalName": "fy24-annual-report.pdf",
  "size": 245678,
  "mimeType": "application/pdf"
}
```

Response (`201 Created`):

<!-- schema: CreateUploadResponse -->
```json
{
  "document": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
    "companyId": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
    "originalName": "fy24-annual-report.pdf",
    "declaredSize": 245678,
    "declaredMime": "application/pdf",
    "state": "pending_upload",
    "contentSha256": null,
    "sizeBytes": null,
    "rejectionCode": null,
    "intakeState": null,
    "duplicateOfDocumentId": null,
    "classification": null,
    "createdAt": "2026-09-10T08:15:30Z",
    "storedAt": null,
    "latestJob": null
  },
  "upload": {
    "method": "PUT",
    "url": "https://storage.googleapis.com/maester-private-dev/workspaces/3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f/documents/7c9e6679-7425-40de-944b-e07fc1f90ae7/original.pdf?X-Goog-Signature=abcd1234",
    "headers": { "Content-Type": "application/pdf", "Content-Length": "245678" },
    "expiresAt": "2026-09-10T08:30:30Z"
  }
}
```

### `POST /v1/workspaces/{ws}/documents/{id}/finalize`

No request body. Response:

<!-- schema: FinalizeResponse -->
```json
{
  "document": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
    "companyId": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
    "originalName": "fy24-annual-report.pdf",
    "declaredSize": 245678,
    "declaredMime": "application/pdf",
    "state": "uploaded",
    "contentSha256": null,
    "sizeBytes": null,
    "rejectionCode": null,
    "intakeState": null,
    "duplicateOfDocumentId": null,
    "classification": null,
    "createdAt": "2026-09-10T08:15:30Z",
    "storedAt": null,
    "latestJob": {
      "id": "9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b",
      "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
      "type": "document.verify",
      "subjectType": "document",
      "subjectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "state": "queued",
      "attempt": 0,
      "maxAttempts": 5,
      "progress": {},
      "result": null,
      "lastErrorCode": null,
      "lastErrorMessage": null,
      "createdAt": "2026-09-10T08:16:00Z",
      "startedAt": null,
      "finishedAt": null,
      "updatedAt": "2026-09-10T08:16:00Z"
    }
  },
  "job": {
    "id": "9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b",
    "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
    "type": "document.verify",
    "subjectType": "document",
    "subjectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "state": "queued",
    "attempt": 1,
    "maxAttempts": 5,
    "progress": {},
    "result": null,
    "lastErrorCode": null,
    "lastErrorMessage": null,
    "createdAt": "2026-09-10T08:16:00Z",
    "startedAt": null,
    "finishedAt": null,
    "updatedAt": "2026-09-10T08:16:00Z"
  }
}
```

### `GET /v1/workspaces/{ws}/documents/{id}`

A document once verification has finished, with its terminal job attached:

<!-- schema: Document -->
```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
  "companyId": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
  "originalName": "fy24-annual-report.pdf",
  "declaredSize": 245678,
  "declaredMime": "application/pdf",
  "state": "stored",
  "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 245678,
  "rejectionCode": null,
  "intakeState": null,
  "duplicateOfDocumentId": null,
  "classification": null,
  "createdAt": "2026-09-10T08:15:30Z",
  "storedAt": "2026-09-10T08:16:05Z",
  "latestJob": {
    "id": "9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b",
    "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
    "type": "document.verify",
    "subjectType": "document",
    "subjectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "state": "succeeded",
    "attempt": 0,
    "maxAttempts": 5,
    "progress": { "stage": "stored", "percent": 100 },
    "result": { "outcome": "stored", "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sizeBytes": 245678 },
    "lastErrorCode": null,
    "lastErrorMessage": null,
    "createdAt": "2026-09-10T08:16:00Z",
    "startedAt": "2026-09-10T08:16:01Z",
    "finishedAt": "2026-09-10T08:16:05Z",
    "updatedAt": "2026-09-10T08:16:05Z"
  }
}
```

A rejected document instead carries `"state": "rejected"`, a non-null `rejectionCode` (`NOT_A_PDF`, `TOO_LARGE` or `OBJECT_MISSING`), `contentSha256: null`, `sizeBytes: null` and `storedAt: null`.

### `GET /v1/workspaces/{ws}/documents/{id}/download`

Only valid once the document is `stored`; otherwise `409 INVALID_STATE`.

<!-- schema: DownloadResponse -->
```json
{
  "url": "https://storage.googleapis.com/maester-private-dev/workspaces/3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f/documents/7c9e6679-7425-40de-944b-e07fc1f90ae7/original.pdf?X-Goog-Signature=efgh5678",
  "expiresAt": "2026-09-10T08:21:00Z"
}
```

### Extraction: `POST …/documents/{id}/extract`, `GET …/extraction`, `GET …/facts`

When a document is verified and extraction is enabled, the worker runs a `document.extract` job automatically; `POST …/extract` runs another (`202`, body `ExtractResponse` with the new `job`, which can be followed over SSE like any job). Only `stored` documents can be extracted (`409 INVALID_STATE` otherwise). Every successful run creates a new, immutable revision. The current revision is the one the document's current answers read under; for a document with no answers yet it is the latest.

`GET …/extraction` returns the current revision and its arithmetic checks (`404` before the first extraction). `coverage` lists each statement found, its 0-based page indexes and whether it was extracted; `state` is `partial` when any statement failed.

<!-- schema: DocumentExtraction -->
```json
{
  "revision": {
    "id": "5d1f6a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
    "documentId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "jobId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "state": "complete",
    "pipelineVersion": "extract-1",
    "model": "gemini-2.5-pro",
    "promptVersion": "55d5e28e6e4b",
    "pageCount": 120,
    "companyNameAsPrinted": "SYNTHETIC INDUSTRIES LIMITED",
    "coverage": [{ "statement": "balance_sheet", "basis": "consolidated", "pages": [41, 42], "status": "extracted", "message": null }],
    "warnings": [],
    "createdAt": "2026-09-10T08:18:00Z"
  },
  "checks": [
    {
      "id": "8e9f0a1b-2c3d-4e5f-9a0b-1c2d3e4f5a6b",
      "checkType": "subtotal",
      "statement": "balance_sheet",
      "basis": "consolidated",
      "section": "Assets",
      "periodLabel": "As at 31 March 2026",
      "subjectLabel": "Total assets",
      "status": "passed",
      "expected": "120956.50",
      "actual": "120956.50",
      "detail": "components sum to the subtotal"
    }
  ]
}
```

`GET …/facts?revisionId=` returns one revision's facts (the current revision by default). Each fact keeps the value exactly as printed (`reportedText`), its parsed decimal (`reportedValue`, `null` for a dash or unparseable text, see `valueStatus`), the unit and scale, and `normalizedValue` in actual currency units when the unit is recognised. `periodEnd` (income and cash flow) or `asOfDate` (balance sheet) is set only when the period label names an unambiguous date. `source.pageIndex` is the 0-based page of the original PDF; `source.textLayerMatch` says whether the value was found in that page's text (`null` for a scanned page). All decimals are strings.

<!-- schema: DocumentFacts -->
```json
{
  "revision": {
    "id": "5d1f6a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
    "documentId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "jobId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "state": "complete",
    "pipelineVersion": "extract-1",
    "model": "gemini-2.5-pro",
    "promptVersion": "55d5e28e6e4b",
    "pageCount": 120,
    "companyNameAsPrinted": "SYNTHETIC INDUSTRIES LIMITED",
    "coverage": [{ "statement": "balance_sheet", "basis": "consolidated", "pages": [41, 42], "status": "extracted", "message": null }],
    "warnings": [],
    "createdAt": "2026-09-10T08:18:00Z"
  },
  "facts": [
    {
      "id": "0f1e2d3c-4b5a-4968-8776-655443322110",
      "revisionId": "5d1f6a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
      "companyId": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
      "statement": "balance_sheet",
      "basis": "consolidated",
      "section": "Assets",
      "lineOrder": 0,
      "reportedLabel": "Cash and cash equivalents",
      "isSubtotal": false,
      "componentLabels": [],
      "periodLabel": "As at 31 March 2026",
      "periodEnd": null,
      "asOfDate": "2026-03-31",
      "reportedText": "1,23,456.50",
      "reportedValue": "123456.50",
      "valueStatus": "value",
      "unitLabel": "₹ in crores",
      "scaleFactor": "10000000",
      "currency": "INR",
      "normalizedValue": "1234565000000.00",
      "source": { "documentId": "7c9e6679-7425-40de-944b-e07fc1f90ae7", "pageIndex": 41, "textLayerMatch": true }
    }
  ]
}
```

A failed extract job carries a code in `lastErrorCode`: `EXTRACTOR_NOT_CONFIGURED`, `UNREADABLE_PDF`, `NO_STATEMENTS_FOUND`, `NO_STATEMENTS_EXTRACTED`, `TOO_LARGE_FOR_EXTRACTION`, `MODEL_REQUEST_REJECTED` and `MODEL_CALL_BUDGET_EXCEEDED` fail at once; `MODEL_UNAVAILABLE`, `EXTRACTION_FAILED`, `EXTRACTOR_UNAVAILABLE` and `EXTRACTOR_STREAM_INTERRUPTED` are retried first.

### `GET /v1/workspaces/{ws}/jobs/{id}` and `POST /v1/workspaces/{ws}/jobs/{id}/retry`

Both return a `Job`:

<!-- schema: Job -->
```json
{
  "id": "9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b",
  "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
  "type": "document.verify",
  "subjectType": "document",
  "subjectId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "state": "failed",
  "attempt": 2,
  "maxAttempts": 5,
  "progress": { "stage": "hashing", "percent": 0 },
  "result": null,
  "lastErrorCode": "HANDLER_ERROR",
  "lastErrorMessage": "unexpected error while verifying the document",
  "createdAt": "2026-09-10T08:16:00Z",
  "startedAt": "2026-09-10T08:16:01Z",
  "finishedAt": "2026-09-10T08:16:03Z",
  "updatedAt": "2026-09-10T08:16:03Z"
}
```

`lastErrorCode` on a job is one of the worker's own error codes — `HANDLER_ERROR` (the handler threw), `UNKNOWN_JOB_TYPE` (no handler registered for `job.type`) or an extraction code listed above — not to be confused with a document's `rejectionCode` (`NOT_A_PDF`, `TOO_LARGE`, `OBJECT_MISSING`), which describes why a *document* was rejected, not why a job failed; a rejected document's verify job still `succeeds`, with `result.outcome === "rejected"`.

`retry` only succeeds when the job is `failed` or a `queued` job stuck without a dispatched task; any other state returns `409 INVALID_STATE`. On success it raises `maxAttempts` by 5 (relative to the job's current `attempt`) and resets `finishedAt` and `progress` back to their initial values (`null` and `{}`).

## 5. Upload sequence

Uploading and verifying a PDF is a five-step round trip:

1. **Create the upload.** `POST /v1/workspaces/{ws}/documents/uploads` with `CreateUploadRequest` (`originalName`, `size`, `mimeType: "application/pdf"`, and optionally `companyId`). An unknown `companyId` is `400 VALIDATION_FAILED` on that field. The response's `document` is `pending_upload`; `upload` carries a signed `PUT` URL, the exact headers required, and an expiry.
2. **PUT the bytes.** `fetch(upload.url, { method: "PUT", headers: upload.headers, body: file })` — send *exactly* the headers in `upload.headers` (`Content-Type` and `Content-Length`, in that exact casing — the API returns them as-is) and nothing else; a mismatched header invalidates the signature. Do not send the session cookie or `credentials: "include"` on this request — it goes straight to object storage, not the API.
3. **Finalize.** `POST /v1/workspaces/{ws}/documents/{id}/finalize` with no body. This confirms the object landed, flips the document to `uploaded`, and enqueues a `document.verify` job. The response is `FinalizeResponse` (`document`, `job`).
4. **Subscribe to progress.** Open `GET /v1/workspaces/{ws}/jobs/{job.id}/events` (see §6) to watch the job move through `queued` → `running` → `succeeded`/`failed`.
5. **Read the document.** Once the stream sends `event: done`, `GET /v1/workspaces/{ws}/documents/{id}` returns the final state: `stored` (with `contentSha256` and `sizeBytes` populated) or `rejected` (with `rejectionCode` set). `GET .../download` is only valid once `stored`.

## 6. Server-Sent Events

`GET /v1/workspaces/{ws}/jobs/{id}/events` responds `text/event-stream`. On connect it immediately sends the job's current full state, then an event on every change to `state`, `progress` or `updatedAt`, and finally a `done` event once the job reaches a terminal state (`succeeded`, `failed` or `cancelled`):

```text
event: job
id: 0
data: {"id":"9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b","workspaceId":"3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f","type":"document.verify","subjectType":"document","subjectId":"7c9e6679-7425-40de-944b-e07fc1f90ae7","state":"running","attempt":0,"maxAttempts":5,"progress":{"stage":"hashing","percent":0},"result":null,"lastErrorCode":null,"lastErrorMessage":null,"createdAt":"2026-09-10T08:16:00Z","startedAt":"2026-09-10T08:16:01Z","finishedAt":null,"updatedAt":"2026-09-10T08:16:01Z"}

: ping

event: job
id: 1
data: {"id":"9b2e2f0a-1d3c-4e5f-8a6b-7c8d9e0f1a2b","workspaceId":"3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f","type":"document.verify","subjectType":"document","subjectId":"7c9e6679-7425-40de-944b-e07fc1f90ae7","state":"succeeded","attempt":0,"maxAttempts":5,"progress":{"stage":"stored","percent":100},"result":{"outcome":"stored","sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","sizeBytes":245678},"lastErrorCode":null,"lastErrorMessage":null,"createdAt":"2026-09-10T08:16:00Z","startedAt":"2026-09-10T08:16:01Z","finishedAt":"2026-09-10T08:16:05Z","updatedAt":"2026-09-10T08:16:05Z"}

event: done
data:
```

Each `data:` payload on a `job` event parses with the `Job` schema shown in §4. `: ping` comment lines arrive roughly every 15 seconds when nothing has changed — ignore lines starting with `:`. The stream closes itself after 30 minutes even if the job has not reached a terminal state; `Last-Event-ID` is accepted but ignored, since every event carries the job's full current state rather than a diff. **Reconnect strategy:** on any close or error before receiving `done`, simply re-open a new `EventSource` against the same URL — the first event on the new connection resends the job's full state, so nothing needs to be replayed manually.

```ts
const es = new EventSource(`/v1/workspaces/${workspaceId}/jobs/${jobId}/events`, { withCredentials: true });
es.addEventListener("job", (e) => {
  const job: Job = JSON.parse(e.data);
  // update UI with job.state / job.progress
});
es.addEventListener("done", () => es.close());
```

## 7. Pagination

List routes accept `?cursor=&limit=` (`limit` is 1–100, default 25) and return `{ items, nextCursor }`; `nextCursor` is `null` on the last page. Pass the previous response's `nextCursor` back as `cursor` to fetch the next page:

```text
GET /v1/workspaces/3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f/documents?limit=25
```

```json
{
  "items": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "workspaceId": "3fa3c1de-8b8a-4a1a-9c8e-1a2b3c4d5e6f",
      "companyId": "c0a8012e-5b6f-4c3d-9e2a-1f0b2c3d4e5f",
      "originalName": "fy24-annual-report.pdf",
      "declaredSize": 245678,
      "declaredMime": "application/pdf",
      "state": "stored",
      "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "sizeBytes": 245678,
      "rejectionCode": null,
      "intakeState": null,
      "duplicateOfDocumentId": null,
      "classification": null,
      "createdAt": "2026-09-10T08:15:30Z",
      "storedAt": "2026-09-10T08:16:05Z",
      "latestJob": null
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA5LTEwVDA4OjE1OjMwWiIsImlkIjoiN2M5ZTY2NzktNzQyNS00MGRlLTk0NGItZTA3ZmMxZjkwYWU3In0"
}
```

Each item in `items` above independently parses as a `Document` (shown in full, including `latestJob`, in §4); there is no single exported schema for the page envelope itself since `paginated()` is a schema *factory*, not a schema — build it yourself with `paginated(Document)` or `paginated(Workspace)` if you need to validate a page.

## 8. Types

Import the Zod schemas to validate, or just the inferred TypeScript types:

```ts
import { Document, Job, ApiError } from "@maester/contracts";
import type { Document as DocumentType, Job as JobType, ApiError as ApiErrorType } from "@maester/contracts";

const doc = Document.parse(await res.json()); // throws on shape drift
```

Every exported schema (`Workspace`, `Membership`, `Me`, `Company`, `CreateCompanyRequest`, `Document`, `CreateUploadRequest`, `DocumentExtraction`, `DocumentFacts`, `FinancialFact`, `ExtractorEvent`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`, `Job`, `JobProgress`, `ApiError`, `ErrorCode`, `DocumentVerifyResult`, …) is both a runtime validator and, via `z.infer<typeof X>`, the TypeScript type of the same name — there is no separate `.d.ts` to keep in sync.
