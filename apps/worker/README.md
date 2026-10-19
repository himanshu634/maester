# Worker application boundary

Status: implemented (base). `apps/worker` is a [Hono](https://hono.dev/) HTTP service on Node 22 that receives Cloud Tasks callbacks and runs job handlers, and refreshes market data on a timer, deployed to Cloud Run (ADR [0003](../../docs/decisions/0003-typescript-backend.md)).

## What it owns

- `GET /healthz` — liveness, no auth.
- `POST /tasks/:type` — the Cloud Tasks dispatch target. Verifies the request (OIDC token in `cloud-tasks` mode, a shared secret header in `local` mode), leases the job row in Postgres so a retried or duplicate task cannot run it twice, and runs the handler for `:type`.
- `document.verify` (`JobTypes.DOCUMENT_VERIFY` in `@maester/contracts`) downloads the uploaded object from `packages/storage`, checks it is a well-formed PDF within the configured size limit, records the checksum and size, and marks the document `stored` or `rejected` (with a `RejectionCode`). A stored document then gets a `document.classify` job (idempotency key `document.classify:<id>:auto`); a second copy of a file already stored in the workspace is marked `duplicate` instead.
- `document.classify` (`JobTypes.DOCUMENT_CLASSIFY`) sends the PDF to the extractor's `/v1/classify`, stores the answer (kind, company, period, with the page each came from) as an immutable classification, and decides what happens next: read it, hold it for the investor or keep it. When it reads, it enqueues `document.extract` (idempotency key `document.extract:<id>:classification-<classificationId>`, so each set of answers is read once). It needs `EXTRACTOR_URL`; without it the job fails with `CLASSIFIER_NOT_CONFIGURED`.
- `document.extract` (`JobTypes.DOCUMENT_EXTRACT`) reads the PDF, streams it to `apps/extractor` (`src/extractor.ts`), relays its progress to the job row and renews the lease on every stream line, then writes the result as one `extraction_revision` with its facts, page references and checks in a single transaction. The revision is unique per job, so a retry never duplicates facts. See [document extraction](../../docs/EXTRACTION.md).

- **Market data refresher** (`src/market/`) — not a job and not a route: a timer inside the process that keeps market mood's daily series in `market_point` current. It runs only when `CONNECTIONS_KEY` is set (`src/server.ts`); the first pass starts 10 seconds after boot, and each next pass `MARKET_REFRESH_MINUTES` after the previous one ends (`src/market/schedule.ts`), so passes never overlap. Each pass (`src/market/refresh.ts`) records one `market_fetch` row and is skipped if another row has been `running` for less than an hour. It reads the Dhan and FRED keys the investor saved in Settings (`market_connection`, decrypted with `CONNECTIONS_KEY`) on every pass, then reads FRED (`us_vix`, `usd_inr`) and Dhan (`nifty50`, `india_vix`, the near-month MCX gold future `gold_mcx`, the Nifty put–call ratio `nifty_pcr_oi` after 15:45 IST, and each Nifty 500 member's close `eq:<SYMBOL>`), from the last stored day or a 4-year backfill. From the member closes it works out the two breadth series, `n500_above_200d_pct` and `n500_net_highs_pct` (`src/market/breadth.ts`); a member with too short a history is left out rather than counted as below, and a new day too few members have a close for yet is held back until a later pass. A Dhan token with under 6 hours left is renewed and saved encrypted. A FRED failure does not stop Dhan; when both fail, the run records the Dhan error. `DHAN_TOKEN_EXPIRED` and `FRED_KEY_REFUSED` also set `last_error_code` on the connection so Settings can say so.
- **Nifty 500 member list** — `data/nifty500.csv`, downloaded by hand from niftyindices.com (see [data/README.md](data/README.md)); never fetched from code, and nothing scrapes NSE. The path is found from the package root (`src/market/build.ts`), so it works from `src/`, `dist/` and the Docker image, which copies the `data` folder. It is read once at start, so restart the worker after replacing it. Missing, breadth is skipped and everything else still refreshes. Today's members are used for every past day, so breadth carries survivorship bias.

Progress is written to the job row as handlers run, and the API streams it out over SSE. A handler that throws a `JobFailure` records its code; a non-retryable one fails the job on the first attempt, anything else is retried up to `maxAttempts`.

Job leasing lives in `src/lease.ts`; the handler registry is `src/jobs/index.ts`; follow-up jobs are dispatched through `src/dispatch.ts` (`@maester/jobs`). In local development the API's `DISPATCH_MODE=local` dispatcher calls this service directly with a shared secret instead of going through real Cloud Tasks.

## Environment

Loaded from the root `.env` (see `.env.example`) via `loadWorkerEnv()` in `src/env.ts`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Drizzle) |
| `STORAGE_DRIVER` | `gcs` (default) or `disk`, the local development driver |
| `STORAGE_DIR` | Required when `STORAGE_DRIVER=disk`; directory the API writes uploads to |
| `GCS_BUCKET` | Required when `STORAGE_DRIVER=gcs`; private object storage bucket |
| `DISPATCH_MODE` | `local` (shared-secret auth) or `cloud-tasks` (OIDC auth) |
| `DISPATCH_SECRET` | Required when `DISPATCH_MODE=local`; must match the API's value |
| `WORKER_URL` | This service's own base URL |
| `API_SERVICE_ACCOUNT_EMAIL` | Required when `DISPATCH_MODE=cloud-tasks`; expected OIDC token issuer/subject |
| `MAX_UPLOAD_BYTES` | Upload size limit enforced during verification (defaulted) |
| `LEASE_SECONDS` | How long a job stays leased before it is eligible for retry (defaulted) |
| `EXTRACTOR_URL` | Base URL of `apps/extractor`. Unset: documents are verified, but classification fails with `CLASSIFIER_NOT_CONFIGURED` (the document is `identify_failed`), so nothing is read |
| `EXTRACTOR_AUTH` | `secret` (default, sends `x-extractor-secret`) or `oidc` (Cloud Run ID token for `EXTRACTOR_URL`) |
| `EXTRACTOR_SECRET` | Required with `EXTRACTOR_URL` and `EXTRACTOR_AUTH=secret`; must match the extractor's |
| `EXTRACT_TIMEOUT_SECONDS`, `EXTRACT_MAX_BYTES` | Whole-request timeout (1800 s) and largest PDF sent for extraction (50 MiB) |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `CLOUD_TASKS_QUEUE`, `WORKER_INVOKER_SA`, `TASK_DISPATCH_DEADLINE_SECONDS` | Required with `EXTRACTOR_URL` when `DISPATCH_MODE=cloud-tasks`, to enqueue `document.extract` |
| `CONNECTIONS_KEY` | 32 bytes, base64 (`openssl rand -base64 32`); must match the API's. Decrypts the saved Dhan and FRED keys and encrypts a renewed Dhan token. Unset: the market refresher does not run |
| `DHAN_REQUESTS_PER_SECOND` | Dhan Data API calls per second (default 4, at most 5) |
| `MARKET_REFRESH_MINUTES` | Minutes from the end of one market refresh pass to the start of the next (default 30) |
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
PORT=8788 pnpm dev:worker           # http://localhost:8788
```

Run the API alongside it (`PORT=8787 pnpm dev:api`) and the web dev server (`pnpm --dir apps/web dev`, which proxies the API) to exercise a full upload → finalize → verify round trip via <http://localhost:5173/dev/upload> or `pnpm smoke path/to/file.pdf` (which defaults to the web origin). `pnpm --filter @maester/worker lint|typecheck|test` runs this package alone.

To run one market refresh pass by hand (reads the root `.env`, needs `CONNECTIONS_KEY`):

```bash
pnpm --filter @maester/worker market:refresh   # prints e.g. "ok, 1234 points written"
```

It exits 0 for `ok` or `skipped` (another pass is running) and 1 for `failed` or a bad configuration, and prints no secret. It runs from source with `tsx` (`src/market-refresh-cli.ts`); the Docker image ships only `dist/server.js`, so the command is not in it. See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the full TypeScript workflow.
