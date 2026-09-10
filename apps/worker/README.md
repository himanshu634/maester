# Worker application boundary

Status: implemented (base). `apps/worker` is a [Hono](https://hono.dev/) HTTP service on Node 22 that receives Cloud Tasks callbacks and runs job handlers, deployed to Cloud Run (ADR [0003](../../docs/decisions/0003-typescript-backend.md)).

## What it owns

- `GET /healthz` — liveness, no auth.
- `POST /tasks/:type` — the Cloud Tasks dispatch target. Verifies the request (OIDC token in `cloud-tasks` mode, a shared secret header in `local` mode), leases the job row in Postgres so a retried or duplicate task cannot run it twice, and runs the handler for `:type`.
- `document.verify` (`JobTypes.DOCUMENT_VERIFY` in `@maester/contracts`) — the only handler registered today. It downloads the uploaded object from `packages/storage`, checks it is a well-formed PDF within the configured size limit, records the checksum and size, and marks the document `stored` or `rejected` (with a `RejectionCode`). Progress is written to the job row as it runs, which the API streams out over SSE.

Job leasing lives in `src/lease.ts`; the handler registry is `src/jobs/index.ts`. In local development the API's `DISPATCH_MODE=local` dispatcher calls this service directly with a shared secret instead of going through real Cloud Tasks.

## Environment

Loaded from the root `.env` (see `.env.example`) via `loadWorkerEnv()` in `src/env.ts`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Drizzle) |
| `GCS_BUCKET` | Private object storage bucket |
| `DISPATCH_MODE` | `local` (shared-secret auth) or `cloud-tasks` (OIDC auth) |
| `DISPATCH_SECRET` | Required when `DISPATCH_MODE=local`; must match the API's value |
| `WORKER_URL` | This service's own base URL |
| `API_SERVICE_ACCOUNT_EMAIL` | Required when `DISPATCH_MODE=cloud-tasks`; expected OIDC token issuer/subject |
| `MAX_UPLOAD_BYTES` | Upload size limit enforced during verification (defaulted) |
| `LEASE_SECONDS` | How long a job stays leased before it is eligible for retry (defaulted) |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | Server basics (defaulted) |

## Running it

```bash
pnpm install
pnpm db:up                          # Postgres via docker-compose
pnpm --filter @maester/db migrate
PORT=8788 pnpm dev:worker           # http://localhost:8788
```

Run the API alongside it (`PORT=8787 pnpm dev:api`) to exercise a full upload → finalize → verify round trip via `/dev/upload` or `pnpm smoke path/to/file.pdf`. `pnpm --filter @maester/worker lint|typecheck|test` runs this package alone. See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the full TypeScript workflow.
