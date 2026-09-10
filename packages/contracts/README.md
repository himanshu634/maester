# @maester/contracts

`@maester/contracts` is the single source of truth for the shapes that cross the wire between the API (`apps/api`), the worker (`apps/worker`) and any frontend. It exports Zod schemas and their inferred TypeScript types; there is no OpenAPI document and no code generation step. This README is the integration guide the frontend (the SvelteKit app in `apps/web`) builds against.

```ts
import { Document, Job, ApiError } from "@maester/contracts";
```

## 1. Origins, cookies and CORS

The API is the origin of truth for the session cookie. Better Auth sets an `HttpOnly` cookie named `maester.session_token` (cookie prefix `maester`) scoped to the API's own origin — there is no cross-site cookie sharing.

Any browser client must:

- Send `credentials: "include"` on every `fetch` call to the API (including the `/api/auth/*` endpoints), so the cookie is attached and, on auth responses, stored.
- Be served from an origin listed in the API's `ALLOWED_ORIGINS` environment variable. The API only reflects `Access-Control-Allow-Origin` for origins in that list, and always sends `Access-Control-Allow-Credentials: true` for them.
- `http://localhost:5173` (the default Vite dev server origin) is included in `ALLOWED_ORIGINS` by default in `.env.example`, so a local SvelteKit dev server works against a local API with no extra configuration.

**Cookie scope in production.** The session cookie Better Auth sets is `SameSite=Lax`, so the browser only attaches it to requests that are same-site with the page that set it. In production this means the browser must reach the API on the same site as the frontend — there are two ways to arrange that:

1. **The SvelteKit server proxies `/api/auth/*` and `/v1/*` to the API (recommended).** The browser only ever talks to the frontend's own origin; the SvelteKit server forwards those paths to the API over a trusted, server-to-server connection. `credentials: "include"` is not needed for this path, since the request never leaves the app's origin from the browser's point of view.
2. **The frontend and the API share a custom domain** (e.g. `app.example.com` and `api.example.com`, both under `example.com` with matching `SameSite=Lax` eligibility), so the cookie set by the API is still sent on requests the browser makes to the frontend's origin family.

A cross-site call straight to the raw `*.run.app` Cloud Run URL (a different site from the frontend's origin) will not carry the cookie, regardless of `credentials: "include"` or CORS configuration — `SameSite=Lax` blocks it at the browser level before CORS is even evaluated.

Local development (`http://localhost:5173` calling `http://localhost:8787`) is same-site (same registrable domain, different port), so `credentials: "include"` works there with no proxy needed.

```http
GET /v1/me HTTP/1.1
Host: localhost:8787
Cookie: maester.session_token=<opaque-session-value>
```

## 2. Authentication endpoints

Authentication is [Better Auth](https://www.better-auth.com/) mounted at `/api/auth/*` with the email/password provider enabled. Use its Svelte client (`better-auth/svelte`) to call these rather than hand-rolling `fetch` calls — the client manages the cookie and exposes a reactive session store. The raw HTTP shapes are:

```http
POST /api/auth/sign-up/email
Content-Type: application/json

{ "name": "Dev User", "email": "dev@example.com", "password": "correct-horse-battery" }
```

```http
POST /api/auth/sign-in/email
Content-Type: application/json

{ "email": "dev@example.com", "password": "correct-horse-battery" }
```

```http
POST /api/auth/sign-out
```

```http
GET /api/auth/get-session
```

`sign-up` and `sign-in` set the `maester.session_token` cookie on a successful response; `sign-out` clears it. `get-session` returns the current session (or `null`) using whatever cookie is attached to the request. The API creates a personal workspace for the new user during sign-up itself — call `GET /v1/me` after the session is established to read it.

These four are the only endpoints the frontend calls directly on `/api/auth/*`; everything else in this guide is under `/v1`.

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
| POST | `/v1/workspaces/{ws}/documents/uploads` | Create a pending document and a signed upload URL |
| POST | `/v1/workspaces/{ws}/documents/{id}/finalize` | Mark a document uploaded and enqueue verification |
| GET | `/v1/workspaces/{ws}/documents` | List documents (cursor pagination) |
| GET | `/v1/workspaces/{ws}/documents/{id}` | Document detail, including its latest job |
| GET | `/v1/workspaces/{ws}/documents/{id}/download` | Signed, time-limited read URL |
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
    "originalName": "fy24-annual-report.pdf",
    "declaredSize": 245678,
    "declaredMime": "application/pdf",
    "state": "pending_upload",
    "contentSha256": null,
    "sizeBytes": null,
    "rejectionCode": null,
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
    "originalName": "fy24-annual-report.pdf",
    "declaredSize": 245678,
    "declaredMime": "application/pdf",
    "state": "uploaded",
    "contentSha256": null,
    "sizeBytes": null,
    "rejectionCode": null,
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
  "originalName": "fy24-annual-report.pdf",
  "declaredSize": 245678,
  "declaredMime": "application/pdf",
  "state": "stored",
  "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "sizeBytes": 245678,
  "rejectionCode": null,
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

`lastErrorCode` on a job is one of the worker's own error codes — `HANDLER_ERROR` (the handler threw) or `UNKNOWN_JOB_TYPE` (no handler registered for `job.type`) — not to be confused with a document's `rejectionCode` (`NOT_A_PDF`, `TOO_LARGE`, `OBJECT_MISSING`), which describes why a *document* was rejected, not why a job failed; a rejected document's verify job still `succeeds`, with `result.outcome === "rejected"`.

`retry` only succeeds when the job is `failed` or a `queued` job stuck without a dispatched task; any other state returns `409 INVALID_STATE`. On success it raises `maxAttempts` by 5 (relative to the job's current `attempt`) and resets `finishedAt` and `progress` back to their initial values (`null` and `{}`).

## 5. Upload sequence

Uploading and verifying a PDF is a five-step round trip:

1. **Create the upload.** `POST /v1/workspaces/{ws}/documents/uploads` with `CreateUploadRequest` (`originalName`, `size`, `mimeType: "application/pdf"`). The response's `document` is `pending_upload`; `upload` carries a signed `PUT` URL, the exact headers required, and an expiry.
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
      "originalName": "fy24-annual-report.pdf",
      "declaredSize": 245678,
      "declaredMime": "application/pdf",
      "state": "stored",
      "contentSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "sizeBytes": 245678,
      "rejectionCode": null,
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

Every exported schema (`Workspace`, `Membership`, `Me`, `Document`, `CreateUploadRequest`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`, `Job`, `JobProgress`, `ApiError`, `ErrorCode`, `DocumentVerifyResult`, …) is both a runtime validator and, via `z.infer<typeof X>`, the TypeScript type of the same name — there is no separate `.d.ts` to keep in sync.
