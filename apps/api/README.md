# API application boundary

Status: implemented (base). `apps/api` is a [Hono](https://hono.dev/) HTTP service on Node 22, deployed to Cloud Run (ADR [0003](../../docs/decisions/0003-typescript-backend.md)).

## What it owns

- [Better Auth](https://www.better-auth.com/) mounted at `/api/auth/*`: Google (redirect flow) and email/password with email confirmation, behind a waitlist gate. It issues the `maester.session_token` `HttpOnly` session cookie and creates a personal workspace for each new user. The gate (`admitOrWaitlist`, in `packages/db`) runs in `user.create.before`: an approved email gets an account, any other is recorded as pending and gets none. Email sign-up answers a waitlisted address with the same 200 as an approved one; only the Google callback redirects with `?error=WAITLISTED`. A Google account whose email Google has not verified is refused (`?error=GOOGLE_EMAIL_NOT_VERIFIED`), and a takeover guard (`account.create.before`) removes an unconfirmed password and its sessions when Google links to that account. Approve an email with `pnpm --filter @maester/db waitlist:approve <email>`. The design is in [SIGN_IN.md](../../docs/SIGN_IN.md) and [ADR 0005](../../docs/decisions/0005-sign-in-google-email-waitlist.md).
- `src/mail/`: the `Mailer` interface with a `console` driver (logs the message and its link; development and tests), a `resend` driver, and the confirm-email and reset-password templates.
- A database-backed rate limiter on the auth endpoints (the `rate_limit` table): five attempts a minute for sign-in and sign-up, three for reset and confirmation-email requests. It is on in production and off elsewhere unless `AUTH_RATE_LIMIT=on`.
- `GET /healthz` — liveness, no auth.
- `GET /v1/me` — current user and workspace memberships.
- `GET /v1/workspaces`, `GET /v1/workspaces/:ws` — workspace listing and detail.
- `POST /v1/workspaces/:ws/companies`, `GET /v1/workspaces/:ws/companies`, `GET /v1/workspaces/:ws/companies/:id` — workspace-owned company records; a duplicate name is `409`.
- `POST /v1/workspaces/:ws/documents/uploads` — create a pending document and a signed upload URL (`201`). `companyId` is optional: without one, classification works out the company.
- `POST /v1/workspaces/:ws/documents/:id/finalize` — confirm the upload and enqueue a `document.verify` job.
- `GET /v1/workspaces/:ws/documents`, `GET /v1/workspaces/:ws/documents/:id` — cursor-paginated list and detail (detail includes the latest job).
- `GET /v1/workspaces/:ws/documents/:id/download` — signed, time-limited read URL.
- `POST /v1/workspaces/:ws/documents/:id/extract` — enqueue a new `document.extract` job for a stored document (`202`); every call produces a new revision.
- `GET /v1/workspaces/:ws/documents/:id/classification`, `POST /v1/workspaces/:ws/documents/:id/classification` — the current answers about what the document is (kind, company, period, with the page each came from), and a change to them (`409` if the answers have moved on since they were loaded).
- `POST /v1/workspaces/:ws/documents/:id/classify` — enqueue a new `document.classify` job (`202`).
- `GET /v1/workspaces/:ws/documents/:id/extraction` — the latest extraction revision with its checks.
- `GET /v1/workspaces/:ws/documents/:id/facts?revisionId=` — a revision's facts with their page references (latest revision by default).
- `GET /v1/workspaces/:ws/jobs/:id`, `POST /v1/workspaces/:ws/jobs/:id/retry` — job state and manual retry.
- `GET /v1/workspaces/:ws/jobs/:id/events` — Server-Sent Events stream of job progress.
- `GET /dev/upload` — a small static page exercising the full upload → verify → SSE flow by hand; served only outside `NODE_ENV=production`. Browse it at the web origin (`http://localhost:5173/dev/upload`), which proxies `/dev`.
- `POST /dev/auth/admit` — development and test only: approves an email and confirms an existing account for it, so local sign-up and the smoke test need no inbox.
- `PUT|GET /dev/blobs/*` — signed local object storage standing in for Cloud Storage; mounted only when `STORAGE_DRIVER=disk`, which is refused in production.

Request/response shapes come from `@maester/contracts`; see [its README](../../packages/contracts/README.md) for the full frontend integration guide (error envelope, upload sequence, SSE format, pagination).

## Environment

Loaded from the root `.env` (see `.env.example`) via `loadEnv()` in `src/env.ts`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Drizzle) |
| `BETTER_AUTH_SECRET` | Better Auth session signing secret (min 32 chars) |
| `BETTER_AUTH_URL` | The web origin (`http://localhost:5173` locally), not this service's own: the browser reaches the API through the web origin's proxy, so the Google callback is `<web origin>/api/auth/callback/google` |
| `ALLOWED_ORIGINS` | Comma-separated CORS and trusted-origin allowlist: the web origin(s) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Both or neither; required in production |
| `MAIL_DRIVER` | `console` (default; logs each message and its link; refused in production) or `resend` |
| `RESEND_API_KEY`, `MAIL_FROM` | Required when `MAIL_DRIVER=resend` |
| `AUTH_RATE_LIMIT` | `on` or `off` (default `off`); turns the auth rate limiter on outside production, where it is always on |
| `TRUSTED_PROXIES` | Comma-separated proxy addresses or CIDR ranges skipped when the client address is read from `X-Forwarded-For`. Required in production: the API refuses to boot without it |
| `STORAGE_DRIVER` | `gcs` (default) or `disk`, the local development driver |
| `STORAGE_DIR` | Required when `STORAGE_DRIVER=disk`; directory holding uploaded objects |
| `GCS_BUCKET` | Required when `STORAGE_DRIVER=gcs`; private object storage bucket |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | GCP project and Cloud Tasks queue region; the project is required when `DISPATCH_MODE=cloud-tasks` |
| `DISPATCH_MODE` | `local` (in-process dispatcher) or `cloud-tasks` |
| `DISPATCH_SECRET` | Required when `DISPATCH_MODE=local`; shared secret the worker checks |
| `WORKER_URL` | Base URL of `apps/worker`, used to build Cloud Tasks targets |
| `WORKER_INVOKER_SA` | Required when `DISPATCH_MODE=cloud-tasks`; service account Cloud Tasks uses to call the worker |
| `MAX_UPLOAD_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS` | Upload/download limits (defaulted) |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | Server basics (defaulted) |

## Running it

```bash
docker compose up --build           # the whole stack, including this service
```

Or as a local process, which reloads on save:

```bash
pnpm install
pnpm db:up                          # Postgres via docker-compose
pnpm --filter @maester/db migrate
PORT=8787 pnpm dev:api              # http://localhost:8787, for direct health checks
```

Browsers reach the API through the web origin: run `pnpm --dir apps/web dev` and use `http://localhost:5173`, which proxies `/api/auth`, `/v1` and `/dev` here. Confirmation and reset links are in this service's log with the console mail driver.

`pnpm --filter @maester/api lint|typecheck|test` runs this package alone; `pnpm smoke path/to/file.pdf` drives the upload flow end to end from the repository root. See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the full TypeScript workflow.
