# API application boundary

Status: implemented (base). `apps/api` is a [Hono](https://hono.dev/) HTTP service on Node 22, deployed to Cloud Run (ADR [0003](../../docs/decisions/0003-typescript-backend.md)).

## What it owns

- [Better Auth](https://www.better-auth.com/) mounted at `/api/auth/*` (email/password), issuing the `maester.session_token` `HttpOnly` session cookie and creating a personal workspace for each new user.
- `GET /healthz` — liveness, no auth.
- `GET /v1/me` — current user and workspace memberships.
- `GET /v1/workspaces`, `GET /v1/workspaces/:ws` — workspace listing and detail.
- `POST /v1/workspaces/:ws/documents/uploads` — create a pending document and a signed GCS upload URL (`201`).
- `POST /v1/workspaces/:ws/documents/:id/finalize` — confirm the upload and enqueue a `document.verify` job.
- `GET /v1/workspaces/:ws/documents`, `GET /v1/workspaces/:ws/documents/:id` — cursor-paginated list and detail (detail includes the latest job).
- `GET /v1/workspaces/:ws/documents/:id/download` — signed, time-limited read URL.
- `GET /v1/workspaces/:ws/jobs/:id`, `POST /v1/workspaces/:ws/jobs/:id/retry` — job state and manual retry.
- `GET /v1/workspaces/:ws/jobs/:id/events` — Server-Sent Events stream of job progress.
- `GET /dev/upload` — a small static page exercising the full upload → verify → SSE flow by hand; served only outside `NODE_ENV=production`.

Request/response shapes come from `@maester/contracts`; see [its README](../../packages/contracts/README.md) for the full frontend integration guide (error envelope, upload sequence, SSE format, pagination).

## Environment

Loaded from the root `.env` (see `.env.example`) via `loadEnv()` in `src/env.ts`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Drizzle) |
| `BETTER_AUTH_SECRET` | Better Auth session signing secret (min 32 chars) |
| `BETTER_AUTH_URL` | This service's own origin, used by Better Auth |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (include the Vite dev origin locally) |
| `GCS_BUCKET` | Private object storage bucket |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | GCP project and Cloud Tasks queue region |
| `DISPATCH_MODE` | `local` (in-process dispatcher) or `cloud-tasks` |
| `DISPATCH_SECRET` | Required when `DISPATCH_MODE=local`; shared secret the worker checks |
| `WORKER_URL` | Base URL of `apps/worker`, used to build Cloud Tasks targets |
| `WORKER_INVOKER_SA` | Required when `DISPATCH_MODE=cloud-tasks`; service account Cloud Tasks uses to call the worker |
| `MAX_UPLOAD_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS` | Upload/download limits (defaulted) |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | Server basics (defaulted) |

## Running it

```bash
pnpm install
pnpm db:up                          # Postgres via docker-compose
pnpm --filter @maester/db migrate
PORT=8787 pnpm dev:api              # http://localhost:8787
```

`pnpm --filter @maester/api lint|typecheck|test` runs this package alone; `pnpm smoke path/to/file.pdf` drives the upload flow end to end from the repository root. See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the full TypeScript workflow.
