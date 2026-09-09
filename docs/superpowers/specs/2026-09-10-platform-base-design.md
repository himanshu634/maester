# Platform base design

Date: 2026-09-10
Status: approved for implementation
Supersedes: the Python API/worker and Next.js proposals in `docs/ARCHITECTURE.md` (recorded in ADR 0002)

## 1. Purpose and scope

The platform base is the backend foundation that the PDF extraction pipeline, research features and portfolio accounting will be built on. It is judged by one test: when the extraction pipeline is built next, it slots in as a new job type and new tables without restructuring anything here.

**In scope**

- TypeScript monorepo (pnpm + Turborepo) alongside the frozen Python uv workspace.
- `apps/api`: Hono HTTP API with Better Auth, workspaces, documents, jobs, SSE.
- `apps/worker`: Hono service that executes durable jobs dispatched by Cloud Tasks.
- `packages/contracts`: Zod schemas for every request, response, error and job payload; the README is the frontend integration guide.
- `packages/db`: Drizzle schema, migrations and workspace-scoped client.
- `packages/config`: shared tsconfig, eslint config, env parsing.
- `packages/financial-engine-ts`: empty placeholder package with a README.
- Private upload path to GCS with a `document.verify` job as the proof-of-life job.
- Deployment to Cloud Run, Cloud SQL, GCS and Cloud Tasks via `infra/` scripts; GitHub Actions CI/CD.
- ADR 0002 and documentation updates.

**Out of scope**

- Any Gemini call, extraction, facts, Q&A, portfolios, market data.
- The web frontend. It is built separately in Svelte by the project owner and consumes `packages/contracts`.
- Row-level security policies (schema is shaped for them; policies come with the pipeline).
- Terraform. `infra/` uses gcloud scripts until resources stabilise.

## 2. Stack decisions

| Layer | Choice |
| --- | --- |
| Runtime | Node 22 LTS, TypeScript 5, ESM |
| Package manager / orchestration | pnpm 10 workspace, Turborepo |
| HTTP framework | Hono (`@hono/node-server`), `@hono/zod-validator` |
| Auth | Better Auth, Drizzle adapter, email + password |
| Database | PostgreSQL 16 on Cloud SQL; Drizzle ORM + drizzle-kit migrations; `pg` driver |
| Object storage | GCS via `@google-cloud/storage`, V4 signed URLs |
| Job dispatch | Cloud Tasks (`@google-cloud/tasks`) HTTP target → worker, OIDC-authenticated |
| Real-time | Server-Sent Events from the API (`hono/streaming`) |
| Logging | pino, JSON to stdout, Cloud Logging severity mapping |
| Validation / contracts | Zod 3 in `packages/contracts` |
| Tests | Vitest; integration tests against Postgres from Docker Compose |
| Hosting | Cloud Run services `maester-api`, `maester-worker` |
| CI/CD | GitHub Actions, Workload Identity Federation, no stored keys |

Decimal arithmetic (decimal.js) and pgvector are not needed in the base. The contracts package defines the decimal-string convention now so later packages inherit it.

## 3. Repository layout

```text
apps/
  api/                    Hono API service
  worker/                 Hono worker service (Cloud Tasks target)
  cli/                    Frozen Python CLI (uv member, unchanged)
  web/                    Owner's Svelte app; not part of this spec
packages/
  contracts/              Zod schemas, types, frontend integration README
  db/                     Drizzle schema, migrations, client, scoped helpers
  config/                 tsconfig base, eslint config, env helpers
  financial-engine-ts/    Placeholder for the extraction pipeline
  financial-engine/       Frozen Python engine (uv member, unchanged)
infra/                    gcloud bootstrap scripts, Cloud Run service YAML
docs/
  decisions/0002-typescript-backend.md
  superpowers/specs/      This document
.github/workflows/        check.yml (existing, Python) + ts.yml (new)
docker-compose.yml        Local Postgres
package.json, pnpm-workspace.yaml, turbo.json, .nvmrc, .npmrc
```

Root `package.json` is private and declares `engines` (node >=22, pnpm >=10). `pnpm-workspace.yaml` lists `apps/*` and `packages/*`; the Python directories contain no `package.json` so pnpm ignores them. `apps/web` becomes a workspace member automatically when the owner adds a `package.json` there.

Python remains installable via `uv sync --locked`; the Makefile gains `ts-install`, `ts-check`, `ts-test`, `ts-dev` targets.

## 4. Authentication and workspaces

Better Auth is mounted in the API at `/api/auth/*` with the Drizzle adapter. Email + password only in the base. Sessions are cookie-based: `SameSite=Lax`, `Secure` in production, `HttpOnly`.

- `trustedOrigins` and CORS `origin` come from `ALLOWED_ORIGINS` (comma-separated). CORS uses `credentials: true`.
- A `databaseHooks.user.create.after` hook creates a personal workspace (`name = "<user name>'s workspace"`, `owner_user_id`) and an owner membership in the same transaction.
- Middleware `requireSession` resolves the session on every `/v1/*` request and stores `{ user, session }` in Hono context. Unauthenticated → `401 UNAUTHENTICATED`.
- Middleware `requireWorkspace(param)` loads the workspace named by the route param, checks an active membership for the user, and stores `{ workspace, membership }` in context. No membership → `404 NOT_FOUND` (do not reveal existence).

Roles in the base: `owner` only. The `membership.role` column is an enum ready for `editor`/`viewer`.

## 5. Database

One Cloud SQL Postgres 16 database. All IDs are UUID v4 generated in the application (`crypto.randomUUID()`). All timestamps are `timestamptz` in UTC. Every private table carries `workspace_id` with a composite index `(workspace_id, created_at)`.

Tables owned by Better Auth (generated by its CLI into the Drizzle schema): `user`, `session`, `account`, `verification`.

Tables owned by the base:

**workspace**
- `id` uuid pk
- `name` text not null
- `owner_user_id` text fk → user.id
- `locale` text not null default `'en-IN'`
- `created_at`, `updated_at` timestamptz

**membership**
- `id` uuid pk
- `workspace_id` uuid fk → workspace.id
- `user_id` text fk → user.id
- `role` enum(`owner`) not null
- `state` enum(`active`, `revoked`) not null default `active`
- unique `(workspace_id, user_id)`

**document**
- `id` uuid pk
- `workspace_id` uuid fk
- `original_name` text not null (client-declared, sanitised, ≤ 255 chars)
- `declared_size` bigint not null
- `declared_mime` text not null
- `storage_key` text not null unique (`workspaces/{workspace_id}/documents/{id}/original.pdf`)
- `content_sha256` text null (set by verify job; full 64-hex)
- `size_bytes` bigint null (measured)
- `state` enum(`pending_upload`, `uploaded`, `verifying`, `stored`, `rejected`) not null
- `rejection_code` text null
- `created_by_user_id` text fk
- `created_at`, `updated_at`, `stored_at` timestamptz

**job**
- `id` uuid pk
- `workspace_id` uuid fk
- `type` text not null (e.g. `document.verify`)
- `subject_type` text not null, `subject_id` uuid not null
- `idempotency_key` text not null unique
- `state` enum(`queued`, `running`, `succeeded`, `failed`, `cancelled`) not null
- `attempt` integer not null default 0
- `max_attempts` integer not null default 5
- `lease_token` uuid null, `lease_expires_at` timestamptz null
- `progress` jsonb not null default `'{}'` (shape: `{ stage: string, percent?: number, message?: string }`)
- `result` jsonb null
- `last_error_code` text null, `last_error_message` text null
- `created_at`, `started_at`, `finished_at`, `updated_at` timestamptz
- index `(workspace_id, subject_type, subject_id)`, index `(state, lease_expires_at)`

Migrations live in `packages/db/drizzle/` and are generated by drizzle-kit and committed. `pnpm --filter @maester/db migrate` applies them; deployment runs it as a Cloud Run job before rolling out services.

`packages/db` exports:
- `createDb(connectionString)` → Drizzle instance.
- `schema` (all tables, enums, relations).
- Scoped helpers whose first argument is always `workspaceId`: `documents.getById(ws, id)`, `documents.list(ws, cursor)`, `jobs.getById(ws, id)`, etc. There is deliberately no unscoped read helper for private tables; the raw Drizzle client is used only by the auth hook and the worker's lease logic, which are covered by tests.

## 6. Job infrastructure

**Creation (API).** Inside one DB transaction: insert the job row with `state = queued` and an idempotency key `{type}:{subject_id}:{pipeline_version}`. If the key already exists, return the existing job (idempotent). After commit, enqueue a Cloud Tasks task whose `name` is `{queue}/tasks/{job.id}` so a duplicate enqueue returns `ALREADY_EXISTS` and is ignored. Task body: `{ jobId }`. Target: `POST {WORKER_URL}/tasks/{type}` with an OIDC token for the worker's service account audience.

If enqueue fails after commit, the job stays `queued`; a `POST /v1/jobs/{id}/retry` route re-enqueues. (A background sweeper is deferred until needed.)

**Execution (worker).**
1. Verify the OIDC token (`google-auth-library` `verifyIdToken` with audience = worker URL). Locally, verify a shared secret header instead (`DISPATCH_MODE=local`).
2. Load the job. If `state ∈ {succeeded, cancelled}` → `200` (ack, nothing to do). If `failed` → `200` (ack; retries are explicit).
3. Acquire lease: `UPDATE job SET state='running', lease_token=$t, lease_expires_at=now()+interval, attempt=attempt+1, started_at=coalesce(started_at, now()) WHERE id=$id AND (state='queued' OR (state='running' AND lease_expires_at < now())) RETURNING *`. Zero rows → another worker holds the lease → `409` (Cloud Tasks will retry later).
4. Run the handler for `type` with `(job, ctx)`, where `ctx.progress(stage, percent?, message?)` writes `progress` only if `lease_token` still matches.
5. Success: `UPDATE ... SET state='succeeded', result=$r, finished_at=now() WHERE id AND lease_token=$t` → `200`.
6. Handler error: if `attempt >= max_attempts` → set `failed` with error code/message → `200` (stop retrying). Else set `state='queued'`, record error, clear lease → `500` so Cloud Tasks retries with backoff.

Handler registry: `apps/worker/src/jobs/index.ts` maps `type → handler`. Unknown type → mark failed with `UNKNOWN_JOB_TYPE` → `200`.

**Local dispatch.** `apps/api/src/dispatch/` exposes `enqueue(job)`. With `DISPATCH_MODE=cloud-tasks` it calls Cloud Tasks; with `DISPATCH_MODE=local` it POSTs to `WORKER_URL` with `x-dispatch-secret` in the background (fire-and-forget with logging).

Cloud Tasks queue settings: `maxAttempts=5`, `minBackoff=10s`, `maxBackoff=300s`, `maxConcurrentDispatches=20` (the pilot envelope).

## 7. Private upload path and the verify job

Limits in the base: `MAX_UPLOAD_BYTES = 50 MiB`, allowed MIME `application/pdf` only.

Sequence:
1. `POST /v1/workspaces/{ws}/documents/uploads` body `{ originalName, size, mimeType }`. API validates limits, inserts `document` in `pending_upload`, returns `{ document, upload: { method: "PUT", url, headers: { "Content-Type", "Content-Length" }, expiresAt } }`. The V4 signed URL is bound to the exact content type and content length and expires in 15 minutes.
2. Client PUTs the bytes to GCS directly.
3. `POST /v1/workspaces/{ws}/documents/{id}/finalize`. API checks state `pending_upload`, does a GCS `exists()` on the object (cheap metadata call), sets `uploaded`, creates job `document.verify`, returns `{ document, job }`. Idempotent: if already `uploaded`/`verifying`/`stored`, returns current state and existing job.
4. Worker `document.verify`: sets document `verifying`; streams the object, computes SHA-256 and byte count; checks size ≤ limit and first bytes are `%PDF-`; on success sets `stored`, `content_sha256`, `size_bytes`, `stored_at`, and returns `{ sha256, sizeBytes }` as the job result. On a content check failure sets `rejected` with `rejection_code ∈ {NOT_A_PDF, TOO_LARGE, OBJECT_MISSING}` and succeeds the job (a rejection is a completed verification, not a job failure). Transient GCS errors throw → retry.
5. `GET /v1/workspaces/{ws}/documents/{id}/download` returns `{ url, expiresAt }` with a 5-minute signed read URL; only when state is `stored`.

The extraction pipeline attaches by enqueueing a second job type after `stored`.

## 8. API conventions

- Base path `/v1`. Health at `/healthz` (no auth). Auth at `/api/auth/*`.
- Every request body and query is validated with `@hono/zod-validator` using contracts schemas. Every response is built from a contracts schema type; in tests responses are parsed back through the schema.
- Error envelope (contracts `ApiError`):
  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "…", "fields": [{ "path": "size", "message": "…" }], "traceId": "…" } }
  ```
  Codes in the base: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `CONFLICT`, `UPLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INVALID_STATE`, `RATE_LIMITED` (reserved), `INTERNAL`.
- `traceId` = `x-request-id` header if present, else generated; echoed in the response header and every log line for the request.
- Cursor pagination: `?cursor=&limit=` (limit 1..100, default 25); response `{ items, nextCursor }`. Cursor encodes `(created_at, id)` base64url.
- Decimal strings: contracts exports `DecimalString` (regex-validated) for future use.
- Timestamps ISO 8601 UTC strings.

Routes in the base:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness |
| * | `/api/auth/*` | Better Auth |
| GET | `/v1/me` | current user + memberships |
| GET | `/v1/workspaces` | workspaces of the user |
| GET | `/v1/workspaces/{ws}` | workspace detail |
| POST | `/v1/workspaces/{ws}/documents/uploads` | create pending document + signed PUT |
| POST | `/v1/workspaces/{ws}/documents/{id}/finalize` | mark uploaded, enqueue verify |
| GET | `/v1/workspaces/{ws}/documents` | list (cursor) |
| GET | `/v1/workspaces/{ws}/documents/{id}` | detail incl. latest job summary |
| GET | `/v1/workspaces/{ws}/documents/{id}/download` | signed read URL |
| GET | `/v1/workspaces/{ws}/jobs/{id}` | job state |
| POST | `/v1/workspaces/{ws}/jobs/{id}/retry` | re-enqueue a `failed` or stuck `queued` job |
| GET | `/v1/workspaces/{ws}/jobs/{id}/events` | SSE |

**SSE.** `text/event-stream`. On connect: checks ownership, sends `event: job` with the full job JSON. Then polls the row every 2 s and sends `event: job` on any change to `state`, `progress`, or `updated_at`. On terminal state sends the final event then `event: done` and closes. Heartbeat comment `: ping` every 15 s. Max stream lifetime 30 minutes, after which the client reconnects. `Last-Event-ID` is accepted but ignored (state is always resent in full).

**Dev test page.** When `NODE_ENV !== "production"`, `GET /dev/upload` serves a single static HTML page (no framework) that signs in, creates an upload, PUTs a chosen file, finalizes, and renders SSE progress. It exists only to exercise the flow without the frontend.

## 9. Contracts package

`packages/contracts` (`@maester/contracts`) exports Zod schemas and inferred types:

- `auth`: `User`, `Session` (shape mirrors Better Auth output).
- `workspace`: `Workspace`, `Membership`, `Me`.
- `document`: `DocumentState`, `Document`, `CreateUploadRequest`, `CreateUploadResponse`, `FinalizeResponse`, `DownloadResponse`.
- `job`: `JobState`, `JobProgress`, `Job`, `JobEvent` (SSE payload).
- `common`: `ApiError`, `ErrorCode`, `Paginated(schema)`, `Cursor`, `DecimalString`, `IsoTimestamp`.
- `jobs/payloads`: `DocumentVerifyPayload`, `DocumentVerifyResult` (shared by API and worker).

The README documents: auth flow (sign-up, sign-in, sign-out, session check with cookies and CORS), every route with request/response examples, the error envelope, the upload sequence, the SSE format, and local dev origins. This README is the deliverable the frontend builds against.

## 10. Deployment and local development

**GCP resources** (one project, region `asia-south1` default, overridable):
- Cloud SQL Postgres 16 instance, database `maester`, IAM DB auth for services; local dev uses password auth through Docker.
- GCS bucket `maester-private-{project}`: uniform bucket-level access, no public access, versioning on, CORS configured for `ALLOWED_ORIGINS` on `PUT`.
- Cloud Tasks queue `maester-jobs`.
- Service accounts: `maester-api` (Cloud SQL client, `storage.objects.create/get` on the bucket, `roles/iam.serviceAccountTokenCreator` on itself so V4 URLs can be signed via IAM `signBlob`, `cloudtasks.enqueuer`, `iam.serviceAccountUser` on the worker SA so tasks carry an OIDC token), `maester-worker` (Cloud SQL client, `storage.objects.get`), `maester-migrate` (Cloud SQL client).
- Cloud Run services `maester-api` (public ingress, min 0), `maester-worker` (ingress internal + Cloud Tasks, no unauthenticated invoke; only `maester-api` SA may invoke via OIDC), Cloud Run job `maester-migrate`.
- Secret Manager: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `DISPATCH_SECRET` (local only, not in prod).

`infra/bootstrap.sh` creates these idempotently with gcloud; `infra/service-*.yaml` are the Cloud Run service specs used by CI (`gcloud run services replace`).

**Containers.** One multi-stage Dockerfile per app using `pnpm deploy --filter` to produce a pruned production `node_modules`, Node 22 slim base, non-root user, `PORT` honoured.

**CI (`.github/workflows/ts.yml`).** On push/PR: `pnpm install --frozen-lockfile`, `turbo lint typecheck test` with a Postgres service container. On push to `main`: build images with Cloud Build or `docker build` + push to Artifact Registry, run `maester-migrate` job, then `gcloud run services replace` for api and worker. Auth via Workload Identity Federation. The existing Python `check.yml` is unchanged.

**Local.** `docker-compose.yml` runs Postgres 16. `.env.example` (TypeScript section) lists `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT`, `DISPATCH_MODE=local`, `WORKER_URL=http://localhost:8788`, `DISPATCH_SECRET`, `API_PORT=8787`, `WORKER_PORT=8788`. Local runs use Application Default Credentials against a real dev bucket; no GCS emulator.

## 11. Observability

pino JSON logs with `severity` mapped for Cloud Logging, `traceId`, `workspaceId` (when resolved), `jobId` (worker). Never log request bodies, signed URLs, cookies or object contents. Each job handler logs start, progress transitions, and terminal state with duration. Cloud Run's built-in request metrics cover latency; a queue-age metric comes with the pipeline.

## 12. Testing

- `packages/contracts`: round-trip tests for each schema and the error envelope; example JSON in the README is asserted against the schemas.
- `packages/db`: migration applies cleanly on a fresh database; scoped helpers never return another workspace's rows (two-workspace fixture).
- `apps/api`: route tests via `app.request()` with a signed-in test session; auth hook creates workspace + membership; upload create validates limits; finalize is idempotent; cross-workspace access returns 404; SSE emits initial event, change event, and done.
- `apps/worker`: lease acquisition is exclusive under concurrent calls; retry/backoff state transitions; `document.verify` with a fixture PDF (stored), a text file (rejected `NOT_A_PDF`), and a missing object (rejected `OBJECT_MISSING`). GCS is behind a small `ObjectStore` interface with an in-memory implementation for tests and the real GCS implementation used in production.
- Integration tests run against Postgres from Docker Compose locally and a service container in CI. GCS is not exercised in CI; a manual smoke script `scripts/smoke-upload.ts` runs the full flow against a dev project.

## 13. Documentation changes

- `docs/decisions/0002-typescript-backend.md`: TypeScript on Cloud Run replaces the Python API/worker proposal; SvelteKit replaces Next.js; Better Auth; Cloud Tasks; SSE; contracts package replaces OpenAPI codegen as the type authority; Python engine frozen as reference behaviour.
- `docs/ARCHITECTURE.md`: sections 1–4 and 10 updated to the new stack; pipeline sections 5–9 unchanged in intent, language references corrected.
- `README.md`, `apps/api/README.md`, `apps/worker/README.md`, `apps/web/README.md`: status and commands.
- `docs/DEVELOPMENT.md`: TypeScript workflow.

## 14. Non-goals and deferred items

- Row-level security policies, rate limiting, email verification, password reset, OAuth providers.
- Job sweeper for jobs stuck in `queued` without a task (manual retry route covers the base).
- Terraform, custom domains, Cloud Armor, CDN.
- Any model call.
