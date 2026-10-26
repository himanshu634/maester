# Development

Everything needed to run Maester locally, change it and check your work. New contributors should read the [contributing guide](../CONTRIBUTING.md) first for the engineering rules and the pull request checklist; this document is the operating manual.

The whole stack runs on your machine with no Google Cloud account; only fact extraction needs one (section 7):

```bash
docker compose up --build
```

## 1. What is in the repository

| Component | Path | Language | Status |
| --- | --- | --- | --- |
| HTTP API | `apps/api` | TypeScript, Hono | Running: identity, workspaces, document uploads, jobs, SSE ([README](../apps/api/README.md)) |
| Job worker | `apps/worker` | TypeScript, Hono | Running: leased job execution, `document.verify`, `document.classify`, `document.extract`, `document.index` ([README](../apps/worker/README.md)) |
| Extractor | `apps/extractor` | Python, FastAPI | Running: stateless extraction service the worker calls ([README](../apps/extractor/README.md)) |
| Indexer | `apps/indexer` | Python | Running: stateless page reader and chunker the worker calls ([README](../apps/indexer/README.md), [description](systems/indexer.md)) |
| Web client | `apps/web` | SvelteKit, static | Running: public pages at `/`, sign-in and recovery pages (`/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password`), `/terminal`; investor journeys planned ([README](../apps/web/README.md)) |
| CLI | `apps/cli` | Python, Typer | Running: `maester ingest`, `list-docs`, `ask` (deprecated, section 9) |
| MCP server | `apps/mcp` | TypeScript, MCP SDK | Running: a read-only stdio server that lets an agent read the filings (section 15, [description](systems/mcp.md)) |
| Evaluation harness | `apps/eval` | Python, Typer | Running: `maester-eval live`, `export`, `freeze`, `report`, `xbrl-elements`, `xbrl-map` ([README](../apps/eval/README.md)) |
| Document engine | `packages/financial-engine` | Python | Running: the LangGraph extraction workflow ([spec](EXTRACTION.md)), plus the CLI's extraction, checks, cache and Q&A |
| API contracts | `packages/contracts` | TypeScript, Zod | Running: shared request and response shapes ([README](../packages/contracts/README.md)) |
| Database | `packages/db` | TypeScript, Drizzle | Running: schema, queries, migrations |
| Jobs | `packages/jobs` | TypeScript | Running: job creation and dispatch shared by the API and the worker |
| Object storage | `packages/storage` | TypeScript | Running: Cloud Storage, local disk and in-memory drivers |
| Deployment | `infra` | Bash, gcloud | Running: Cloud Run bootstrap and deploy ([README](../infra/README.md)) |

Two independent language workspaces share the repository. The TypeScript side uses pnpm and `pnpm-lock.yaml`; the Python side uses uv and `uv.lock`. `apps/web` is a third, standalone pnpm project with its own lockfile — a root `pnpm install` does not install it. The boundaries and the reasoning behind them are in [architecture](ARCHITECTURE.md), [ADR 0003](decisions/0003-typescript-backend.md) and [ADR 0004](decisions/0004-python-extraction-sidecar.md): TypeScript owns the API, jobs and every database write, and the Python extractor is a stateless sidecar the worker calls over HTTP.

## 2. Prerequisites

| You want to | You need |
| --- | --- |
| Run the stack | Docker with Compose v2 |
| Work on the API, worker or shared packages | Node 22 (`.nvmrc`), pnpm 11, Docker for Postgres |
| Work on the web client | Node 22, pnpm 11 |
| Work on the CLI, the extractor or the document engine | Python 3.11+ and [uv](https://docs.astral.sh/uv/getting-started/installation/) |
| Extract facts from a real PDF, in the stack or with the CLI | An Anthropic API key (`ANTHROPIC_API_KEY`) |

Nothing but Docker is required for the first section below.

## 3. Start the whole stack

First setup has three steps. The weights for search are fetched once into the `models` volume:

```bash
docker compose build indexer                       # builds maester/indexer:local, which the models service reuses
docker compose --profile setup run --rm models     # fetches the embedding model and Docling's weights, then exits
docker compose up --build                          # or: pnpm stack:up
```

The `up` command builds five images, starts Postgres, applies database migrations, then starts the extractor, the indexer, the embedder, the API, the worker and the web client. The first build takes a few minutes; later starts take seconds. Everything runs with local development defaults — no cloud project, no credentials, no secrets to fill in.

| Service | Address | What it is |
| --- | --- | --- |
| Web | <http://localhost:5173> | The public pages and sign-in, built statically and served by nginx, which proxies `/api/auth`, `/v1` and `/dev` to the API |
| API | <http://localhost:8787> | Hono service, Better Auth, documents and jobs. Browsers reach it through the web origin; use this address for direct health checks (`/healthz`) |
| Dev upload page | <http://localhost:5173/dev/upload> | The working upload flow, end to end in a browser, through the web origin |
| Worker | <http://localhost:8788> | Job execution; it pulls jobs from Postgres |
| Extractor | <http://localhost:8790> | Python extraction service; the worker streams PDFs to it |
| Indexer | <http://localhost:8791> | Python service that reads a filing's pages with Docling and cuts them into chunks; the worker streams PDFs to it |
| Embedder | <http://localhost:8792> | text-embeddings-inference serving the embedding model; the worker embeds chunks with it and the API embeds search queries |
| Postgres | `localhost:5433` | User `maester`, password `maester`, database `maester`. The image is `pgvector/pgvector:pg16`, with `shm_size: 1gb` |

The Postgres image is `pgvector/pgvector:pg16`, started with `shared_buffers=256MB` and `maintenance_work_mem=512MB`. A stack that you started before the pgvector image keeps the old container, which is the stock `postgres:16` image and has no `vector` extension. Recreate the container once. The major version is the same, so the data volume stays valid:

```bash
docker compose up -d --force-recreate postgres
```

Run the `models` command before the indexer or the embedder starts for the first time. Otherwise Docker creates `/models` owned by root and the fetch cannot write to it. `EMBEDDING_MODEL` (default `Snowflake/snowflake-arctic-embed-l-v2.0`) is the one variable for the live model: Compose gives it to the worker, the API and the indexer, and builds the embedder's `--model-id` and the indexer's `INDEX_TOKENIZER_PATH` from it. To switch the live model, fetch its weights (`maester-indexer-fetch-models --candidates` fetches the candidates), set `EMBEDDING_MODEL` and start the stack again. Jobs queued for the old model fail with `INDEX_MODEL_NOT_SERVED`. The worker and the API ask the embedder (`GET /info`) which model it serves: a mismatch fails the job with `INDEXER_MODEL_MISMATCH`, and search answers `SEARCH_UNAVAILABLE`.

The worker and the API do not wait for the indexer or the embedder. Until they answer, index jobs back off and retry, and `GET /v1/workspaces/:ws/search` answers 503 `SEARCH_UNAVAILABLE`. Index every document that was stored before search existed with `pnpm --filter @maester/worker index:backfill [--workspace <id>] [--document <id>]… [--dry-run]`.

### Memory budget

Docker Desktop's VM has 7.75 GiB by default. The compose file caps four services and leaves the other three uncapped until they are measured:

| Service | `mem_limit` | `cpus` | Why |
| --- | --- | --- | --- |
| postgres | 1g | 2 | Records, queue and vectors. An HNSW build needs `maintenance_work_mem`; a rebuild wants 1 to 2 GB, so raise Docker's limit first |
| embedder | 2560m | 8 | The embedding model in fp32 is about 2.3 GB |
| indexer | 2304m | 8 | Docling's peak is unpublished; one job at a time, 20-page ranges, page batch 4 |
| extractor | no limit | 2 | Claude calls; holds whole PDFs |
| api | no limit | 2 | |
| worker | no limit | 2 | Holds a whole PDF per running job: up to 2 extract, 2 classify and 1 index at 50 MB each, briefly doubled while the buffer is built |
| web | 96m | 1 | nginx |
| capped total | 5.9 GiB | | Leaves about 1.8 GiB for the three uncapped services and the VM |

These limits are a first budget; the measured run (Task 13 of the phase 2 plan) adjusts them. Before a backfill or an HNSW rebuild, raise Docker Desktop's memory limit to 12 GB (Settings, Resources), then restart Docker. If the indexer is killed for memory, lower `INDEX_PAGE_BATCH` or the worker's `INDEX_PAGE_RANGE`. The indexer and the embedder have `restart: unless-stopped`, so a kill for memory does not leave them down while index jobs use up their attempts.

Useful lifecycle commands:

```bash
pnpm stack:logs      # docker compose logs -f
pnpm stack:down      # stop everything, keep the database and uploads
pnpm stack:reset     # stop everything and delete the volumes
docker compose up --build api worker extractor    # rebuild after changing service code
```

Containers do not hot-reload. After changing TypeScript under `apps/` or `packages/`, rebuild the affected service, or run the services as local processes instead (section 5).

### What the stack does not include

The Python CLI is not containerised; run it with uv (section 9). Cloud Tasks and Cloud Storage are not part of the local stack. The extractor is, but it only calls Claude (a paid API) once you give it an Anthropic API key (section 7); until then every extract job fails fast with `EXTRACTOR_NOT_CONFIGURED`.

## 4. Try it

**In a browser.** Open <http://localhost:5173/dev/upload> (the web origin, so the session cookie is first-party), sign up with the pre-filled credentials (the page approves the email and confirms the account for you), keep or change the company, choose a PDF, and press *Upload, verify and extract*. The page picks or creates the company, creates a document for it, uploads the bytes to a signed URL, finalises it, and streams job progress over Server-Sent Events until the document reaches `stored`. Verification then enqueues `document.classify`, which enqueues `document.extract` for an annual report or financial results with a known company; the page follows the extract job too and, when it succeeds, prints the revision, its coverage and checks, and the first facts with their page numbers. Without `ANTHROPIC_API_KEY` set the extract job fails with `EXTRACTOR_NOT_CONFIGURED`, which is expected.

**From the terminal.** The same journey, scripted:

```bash
pnpm smoke path/to/file.pdf
```

It approves and signs up a throwaway user through the web origin (`API_URL` defaults to <http://localhost:5173>), creates a company, uploads, polls the verify job, and exits non-zero unless the document ends up `stored`. It needs the stack or the API and `pnpm --dir apps/web dev` running, with `NODE_ENV=development`, because it uses the development-only `/dev/auth/admit` route.

**In the database.**

```bash
psql postgres://maester:maester@localhost:5433/maester -c 'table document'
psql postgres://maester:maester@localhost:5433/maester -c 'select type, state, last_error_code from job order by created_at desc limit 5'
```

**The web pages.** <http://localhost:5173> serves the index, `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` and `/terminal`. The pages are static, but sign-in and recovery call the API: they sign in through the web origin's proxy, so the session cookie is first-party and `/terminal` can read the session. See "Signing in locally" below. The visual contract they follow is [DESIGN.md](DESIGN.md).

### Signing in locally

Maester is invite-only, so an email must be approved before it can create an account. With the stack running (or the API and `pnpm --dir apps/web dev`):

1. Approve your email: `pnpm --filter @maester/db waitlist:approve you@example.com`. The script upserts an approved row in `waitlist_entry`; it reads `DATABASE_URL` from `.env`.
2. Open <http://localhost:5173/signup>, create the account, and read the confirmation link from the API log: `pnpm stack:logs` (or `docker compose logs api`) in the stack, or the terminal running `pnpm dev:api`. The console mail driver (`MAIL_DRIVER=console`) logs each message, link included, instead of sending it. Open the link in the same browser; it lasts one hour.
3. Sign in at <http://localhost:5173/login>. An email that is not approved gets no account: its sign-up looks the same as an approved one's, and the address is recorded as pending in `waitlist_entry`.

To use Google sign-in locally, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env` (both or neither). The three setup steps are the ones in [SIGN_IN.md](SIGN_IN.md) section 6:

1. In Google Cloud, set up the OAuth consent screen: External, scopes `openid email profile`, published to Production (in Testing only listed test users can sign in).
2. Create an OAuth client of type Web application with the origin `http://localhost:5173` and the redirect URI `http://localhost:5173/api/auth/callback/google` (add the deployed web URL and its callback for production).
3. For real email delivery, verify a sending domain in Resend (SPF and DKIM on a domain you own) and create an API key, then set `MAIL_DRIVER=resend`, `RESEND_API_KEY` and `MAIL_FROM`. Locally the console driver is enough.

Google only signs in an approved email too, and refuses an account whose email Google has not confirmed.

## 5. Run the services without Docker

Faster for day-to-day API and worker work, because `tsx watch` reloads on save.

```bash
cp -n .env.example .env          # -n keeps an existing .env; the shipped defaults already work
pnpm install --frozen-lockfile
pnpm db:up                       # Postgres alone, in Docker
pnpm --filter @maester/db migrate
```

Then three terminals:

```bash
PORT=8787 pnpm dev:api
PORT=8788 pnpm dev:worker
uv run --locked maester-extractor     # :8790; optional, only for extraction
```

All three read the root `.env`. With the shipped defaults the API and worker store uploads under `data/blobs` and need no cloud credentials, the worker pulls its jobs from Postgres (`DISPATCH_MODE=queue`) and sends classify and extract jobs to the extractor at `EXTRACTOR_URL`. Comment out `EXTRACTOR_URL` and uploads are verified but not identified: `document.classify` fails with `CLASSIFIER_NOT_CONFIGURED`. The web client is separate and uses pnpm from its own directory:

```bash
pnpm --dir apps/web install --frozen-lockfile
pnpm --dir apps/web dev          # http://localhost:5173
```

The dev server proxies `/api/auth`, `/v1` and `/dev` to `API_PROXY_TARGET` (default `http://localhost:8787`), so start the API first and always browse at <http://localhost:5173>, never at the API's own port: the session cookie and `BETTER_AUTH_URL` are the web origin's.

Do not run both this and the full compose stack at once: they compete for ports 8787, 8788, 8790, 8791, 8792 and 5173.

### The indexer's tests

The indexer is its own uv project in `apps/indexer`. Without models, the tests that need them are skipped:

```bash
cd apps/indexer
uv run --locked python -m unittest discover -s tests -v
```

With models, fetch Docling's weights once and point the tests at them:

```bash
uv run maester-indexer-fetch-models --out "$HOME/.cache/maester" --docling-only
MAESTER_DOCLING_MODELS="$HOME/.cache/maester/docling" uv run --locked python -m unittest discover -s tests -v
```

The workflow [`indexer.yml`](../.github/workflows/indexer.yml) runs the second form on changes under `apps/indexer`.

## 6. Configuration

Copy [`.env.example`](../.env.example) to `.env`. The TypeScript services validate their environment at boot and refuse to start on anything invalid, so a typo is a clear error rather than a runtime surprise. The compose file sets its own values inline; from `.env` it reads only `ANTHROPIC_API_KEY`, `EXTRACTOR_MODEL`, `EXTRACTOR_EFFORT`, `EXTRACTOR_CLASSIFY_MODEL` and `EXTRACTOR_CLASSIFY_EFFORT`, for the extractor, and `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, for Google sign-in, and `EMBEDDING_MODEL`.

**Upgrading an older `.env`.** `cp -n` keeps the `.env` you already have, so it may still set `DISPATCH_MODE=local` and `DISPATCH_SECRET`. The API and the worker read `local` as `queue` and log "DISPATCH_MODE=local is now queue; update .env" at start; change it to `queue` when convenient. `DISPATCH_SECRET` is ignored and can be deleted. Recreate the Postgres container once for the pgvector image (`docker compose up -d --force-recreate postgres`, see section 3).

| Variable | Used by | Required | Local default |
| --- | --- | --- | --- |
| `DATABASE_URL` | api, worker | Always | `postgres://maester:maester@localhost:5433/maester` |
| `BETTER_AUTH_SECRET` | api | Always, at least 32 characters | A placeholder; replace it anywhere shared |
| `BETTER_AUTH_URL` | api | Always | `http://localhost:5173`; the web origin, not the API's, because the browser reaches the API through the web origin's proxy |
| `ALLOWED_ORIGINS` | api | Always | The web origins (`http://localhost:5173,http://localhost:4173`), comma separated |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | Both or neither; required in production | Unset (Google sign-in is off) |
| `MAIL_DRIVER` | api | Defaults to `console`; `console` is refused in production | `console` (logs each message and its link) or `resend` |
| `RESEND_API_KEY`, `MAIL_FROM` | api | When `MAIL_DRIVER=resend` | Unset; `MAIL_FROM` looks like `Maester <hello@your-domain>` |
| `AUTH_RATE_LIMIT` | api | Defaults to `off`; `on` turns the auth rate limiter on outside production (it is always on in production) | `off` |
| `TRUSTED_PROXIES` | api | Required in production (the API refuses to boot without it); comma-separated addresses or CIDR ranges of proxies to skip when reading `X-Forwarded-For` | Unset |
| `API_PROXY_TARGET` | web (Vite dev and preview, the nginx image) | Defaults to `http://localhost:8787`; the compose stack sets `http://api:8787` | `http://localhost:8787` |
| `STORAGE_DRIVER` | api, worker | Defaults to `gcs` | `disk` |
| `STORAGE_DIR` | api, worker | When the driver is `disk` | `../../data/blobs` |
| `GCS_BUCKET` | api, worker | When the driver is `gcs` | Unset |
| `DISPATCH_MODE` | api, worker | Defaults to `queue`; `cloud-tasks` is the other value | `queue` |
| `JOB_CONCURRENCY` | worker | Optional; `type=n` pairs separated by commas, over the defaults `document.verify=4`, `document.classify=2`, `document.extract=2` and 1 for any other type | Unset |
| `JOB_POLL_MS`, `JOB_SWEEP_MS`, `JOB_HEARTBEAT_MS` | worker | Defaulted; the heartbeat must be at most half of `LEASE_SECONDS` | 1000 ms, 30000 ms, 15000 ms |
| `WORKER_URL` | api, worker | Always | `http://localhost:8788` |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `CLOUD_TASKS_QUEUE`, `WORKER_INVOKER_SA` | api | When the mode is `cloud-tasks` | Unset |
| `API_SERVICE_ACCOUNT_EMAIL` | worker | When the mode is `cloud-tasks` | Unset |
| `EXTRACTOR_URL` | worker | To classify and extract; unset: `document.classify` fails with `CLASSIFIER_NOT_CONFIGURED` | `http://localhost:8790` |
| `EXTRACTOR_AUTH`, `EXTRACTOR_SECRET` | worker | `secret` (default) needs the secret, which must match the extractor's; `oidc` uses Cloud Run IAM | `secret`, `local-extractor-secret` |
| `INDEXER_URL`, `INDEXER_SECRET` | worker | To index; the secret is required when the URL is set and must match the indexer's. Unset: `document.index` fails with `INDEXER_NOT_CONFIGURED` | `http://localhost:8791`, `local-indexer-secret` |
| `EMBEDDER_URL`, `EMBEDDING_MODEL` | worker, api | To embed chunks (worker) and search queries (api); unset in the API: search answers 503 | `http://localhost:8792`, `Snowflake/snowflake-arctic-embed-l-v2.0` |
| `INDEX_PAGE_RANGE`, `INDEX_TIMEOUT_SECONDS`, `EMBED_BATCH`, `EMBED_TIMEOUT_SECONDS`, `OCR_PAGE_BUDGET` | worker | Defaulted. `EMBED_BATCH` is at most 32, the embedder's `--max-client-batch-size`; an embed call that times out is not retried in the call, because the embedder keeps working on it, and the job retries later | 20 pages, 7200 s, 16, 300 s, 400 pages |
| `INDEXER_SECRET`, `INDEX_THREADS`, `INDEX_PAGE_BATCH`, `INDEX_MAX_BYTES`, `DOCLING_ARTIFACTS_PATH`, `INDEX_TOKENIZER_PATH`, `EMBEDDING_MODEL` | indexer | See the [indexer description](systems/indexer.md) | Compose sets them |
| `OCR_ENGINE`, `INDEX_TABLE_CELL_MATCHING` | indexer (Compose reads them from the root `.env`) | `rapidocr` (default) or `tesseract`; `true` (default) or `false`. A change gives new keys to the cached page reads | `rapidocr`, `true` |
| `CANDIDATE_MODEL` | Compose, `eval` profile | The embedding model that `embedder-candidate` and `indexer-candidate` serve. Unset, they cannot start | Unset |
| `EXTRACT_TIMEOUT_SECONDS`, `EXTRACT_MAX_BYTES` | worker | Defaulted | 1800 s, 50 MiB |
| `GOOGLE_CLOUD_PROJECT`, `WORKER_INVOKER_SA`, `CLOUD_TASKS_QUEUE`, `TASK_DISPATCH_DEADLINE_SECONDS` | worker | To enqueue extraction when the mode is `cloud-tasks` | Unset |
| `EXTRACTOR_SECRET`, `ANTHROPIC_API_KEY`, `EXTRACTOR_MODEL`, `EXTRACTOR_EFFORT`, `EXTRACTOR_CLASSIFY_MODEL`, `EXTRACTOR_CLASSIFY_EFFORT` | extractor | `ANTHROPIC_API_KEY`, for any extraction | See the [extractor README](../apps/extractor/README.md) |
| `MAX_UPLOAD_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS`, `LEASE_SECONDS` | api, worker | Defaulted | 50 MiB, 900 s, 300 s, 600 s |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | api, worker | Defaulted | `8787`/`8788`, `info`, `development` |
| `ANTHROPIC_API_KEY`, `EXTRACTOR_MODEL`, `EXTRACTOR_EFFORT` | Python CLI | For `ingest` and `ask` | See section 9 |
| `DATABASE_URL`, `MAESTER_WORKSPACE_ID` or `MAESTER_USER_EMAIL`, `EMBEDDER_URL`, `EMBEDDING_MODEL`, `XBRL_PDF_CHECK` | MCP server | `DATABASE_URL` and one of the two workspace settings. The agent host sets them, not `.env` | See section 15 |

Never commit credentials. `.env` and `data/` are ignored by version control; keep it that way.

## 7. How local storage and job dispatch stand in for the cloud

Two settings decide whether a service talks to Google Cloud or to something local. Both defaults in `.env.example` are the local ones, and the deployed configuration in [infra](../infra/README.md) sets the cloud ones.

**`STORAGE_DRIVER=disk`** keeps uploaded bytes on the filesystem under `STORAGE_DIR` instead of in a Cloud Storage bucket. The API signs upload and download URLs that point back at its own `/dev/blobs/…` routes, carrying an expiry and an HMAC signature; an unsigned, tampered or expired URL is refused. The worker reads the bytes straight off the same directory, which is why compose mounts one shared volume into both containers. Environment validation refuses this driver when `NODE_ENV=production`, and the blob routes exist only outside production. With `STORAGE_DRIVER=gcs` the same interface signs real Cloud Storage V4 URLs and the browser uploads directly to the bucket.

**`DISPATCH_MODE=queue`** (the default) makes the worker pull its jobs from Postgres, in place of Cloud Tasks pushing them to `/tasks/:type`; in this mode that route does not exist. The API and the worker send `pg_notify('job_ready', <type>)` after they commit a job. The worker runs one claim loop for each job type. It wakes on `LISTEN job_ready` and also polls every `JOB_POLL_MS`, so a lost notification costs at most one poll. A claim is one `FOR UPDATE SKIP LOCKED` statement, so two workers never take the same job. A worker runs at most 4 `document.verify`, 2 `document.classify`, 2 `document.extract` and 1 of any other type at once; `JOB_CONCURRENCY=document.extract=3,document.verify=8` changes that, and a value that is not `type=n`, a type with no handler or a limit below 1 stops the worker at start-up. A failed job waits before it runs again (`run_after`: 30 s, doubling to 900 s, plus up to 20% jitter) until `maxAttempts`: 2 for `document.classify` and `document.extract`, which call a paid model, and 5 for every other type. At start the worker logs how many jobs of each type are queued or running, because its first claims take all of them. A timer renews the lease of a running job every `JOB_HEARTBEAT_MS`. A sweep every `JOB_SWEEP_MS` gives back a job whose lease ended, with the code `LEASE_EXPIRED`, or fails it when its attempts are spent. On `SIGTERM` the worker stops claiming and waits up to 25 s for running jobs, then gives back any job still running (queued, ready now, its attempt restored), so a restart costs it no attempt; compose gives it 30 s. A document extraction can take up to `EXTRACT_TIMEOUT_SECONDS` (30 minutes). Everything else — leasing, progress, state transitions — behaves the same as with Cloud Tasks, because it lives in the database rather than in the queue.

**Extraction.** When `document.verify` stores a document it enqueues `document.classify`, which sends the PDF to the extractor to work out what it is (this needs the worker's `EXTRACTOR_URL`; without it the job fails with `CLASSIFIER_NOT_CONFIGURED` and the document is `identify_failed`). For an annual report or financial results with a known company it then enqueues `document.extract`. That job streams the PDF to the extractor, which answers with NDJSON progress, heartbeats and finally a result; the worker writes the result as a new `extraction_revision` with its facts, page references and checks, in one transaction. The extractor runs a LangGraph workflow: locate the statements, extract each from its own pages, check the arithmetic, and re-read only failing sections. The design is in [document extraction](EXTRACTION.md). To let the compose stack call Claude, create an API key in the Anthropic Console and set it in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# optional: EXTRACTOR_MODEL, EXTRACTOR_EFFORT (low|medium|high|xhigh|max),
# EXTRACTOR_CLASSIFY_MODEL, EXTRACTOR_CLASSIFY_EFFORT
```

and restart the extractor (`docker compose up -d extractor`). Re-run extraction for a stored document with `POST /v1/workspaces/{ws}/documents/{id}/extract`; read the result with `GET …/extraction` and `GET …/facts`.

## 8. Database, migrations and checks

The schema lives in `packages/db/src/schema` and the generated SQL in `packages/db/drizzle`.

```bash
pnpm --filter @maester/db generate   # after changing the schema: write a new migration
pnpm --filter @maester/db migrate    # apply migrations to DATABASE_URL
```

In compose this runs as a one-shot `migrate` service on the API image, which mirrors the Cloud Run migration job that [deploy.sh](../infra/deploy.sh) runs in production. Never edit a migration that has already been applied somewhere else; add a new one.

TypeScript checks, from the repository root:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

The tests need Postgres and four separate databases, which `scripts/db/init.sql` creates the first time the Postgres volume is initialised. A volume made before `maester_test_mcp` was added does not have it; create it once with `docker compose exec postgres createdb -U maester maester_test_mcp`. Point the suite at them:

```bash
export DATABASE_URL_TEST_DB=postgres://maester:maester@localhost:5433/maester_test_db
export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:5433/maester_test_api
export DATABASE_URL_TEST_WORKER=postgres://maester:maester@localhost:5433/maester_test_worker
export DATABASE_URL_TEST_MCP=postgres://maester:maester@localhost:5433/maester_test_mcp
pnpm test
```

Web client and Python checks:

```bash
pnpm --dir apps/web verify     # svelte-check, prettier, eslint, design guard, static build
make check                     # Python workspace checker and offline unittest suite
make test                      # the unittest suite alone
```

`make check` parses package metadata and Python syntax, catches library imports of application modules, and validates every local Markdown link. It does not check external URLs, anchors or prose. The full test matrix and release criteria are in [quality and measurement](QUALITY.md); `.github/workflows` runs the same commands on every pull request.

## 9. The Python CLI

The CLI is independent of the TypeScript services and shares no database with them. It keeps the original single-call extraction path as reference behaviour; the hosted extraction workflow lives in the same engine package under `pdf_financial_qa.workflow` and is reached through the extractor. They read and write a local JSON cache under `data/cache`, relative to the working directory, so run them from the repository root.

```bash
uv sync --locked
uv run --locked maester --help
uv run --locked maester list-docs
```

Extraction and Q&A call Claude through the Anthropic API and can incur charges:

```bash
uv run --locked maester ingest path/to/statement.pdf
uv run --locked maester ask "What changed in operating cash flow?"
uv run --locked maester ask "What were total assets?" --doc DOCUMENT_HASH
```

`ask` is deprecated: it prints a warning on stderr that points to section 15, and it is removed once the MCP server calculates. It requires `--doc` once more than one document is cached. `ingest` reuses a matching cached hash unless you pass `--force`, which overwrites the cached extraction. Set `ANTHROPIC_API_KEY` in `.env`, and override `EXTRACTOR_MODEL` or `EXTRACTOR_EFFORT` to change the model or its effort.

Without uv:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ./packages/financial-engine -e ./apps/cli
```

Uninstall any older `pdf-financial-qa` distribution first; it owned the same console script name. The pip path does not consume `uv.lock`. `make` writes to a repository-local `.uv-cache` and honours an existing `UV_CACHE_DIR`.

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Bind for 0.0.0.0:5433 failed: port is already allocated` | Another Postgres holds the port, often a container from an older checkout. `docker ps` to find it, then stop it. |
| `migrate` exits 1 with `ENOTFOUND postgres` | Leftover containers from an interrupted start. `docker compose down --volumes`, then start again. |
| API logs `EACCES … /var/lib/maester/blobs` | The blob volume predates the image that owns that directory. `pnpm stack:reset` and rebuild. |
| A signed upload or download returns 403 | The URL expired (15 minutes for uploads, 5 for downloads) or was altered. The API both signs and verifies these URLs, so the worker is not involved. Create a new upload. |
| `invalid environment: …` at boot | A required variable is missing for the driver or dispatch mode you selected. The message names the variable; section 6 says when each one is required. |
| A job stays `queued` | The worker is down, or it has no handler for the job type (it logs "queued jobs of a type this worker has no handler for" at start-up), or the limit for that type is reached, or `run_after` is still in the future after a failure. Check `docker compose logs worker`. |
| A document is rejected with `OBJECT_MISSING` | The API and the worker are pointed at different `STORAGE_DIR` paths, so the worker cannot find what the API wrote. Outside Docker the default resolves against each service's own directory; use `../../data/blobs` as `.env.example` does. |
| Code changes do nothing | Containers do not hot-reload. Rebuild the service, or run it as a local process. |
| Extract jobs fail with `EXTRACTOR_NOT_CONFIGURED` | The extractor has no `ANTHROPIC_API_KEY`, or Anthropic refused the key (authentication or permission error). See section 7; the job does not retry. |
| Extract jobs fail with `MODEL_REQUEST_REJECTED` | Anthropic refused the request (a 4xx other than 401, 403 and 429): for example an unknown `EXTRACTOR_MODEL`, or a PDF over the request limit. The job does not retry. Two other permanent codes come from the model itself: `MODEL_REFUSED` (the model declined to read the document) and `MODEL_OUTPUT_TOO_LONG` (the answer did not fit its token limit). They fail the job only when they stop the step that finds the statements; on one statement, only that statement fails. |
| After verify a `document.classify` job appears but no `document.extract` | Extract follows only when the document is an annual report or financial results with a known company. Without `EXTRACTOR_URL` on the worker, classify fails with `CLASSIFIER_NOT_CONFIGURED`. |
| Extract jobs fail with `EXTRACTOR_UNAUTHORIZED` | `EXTRACTOR_SECRET` differs between the worker and the extractor. |
| `pnpm test` fails to connect | The three test databases only exist on a freshly initialised Postgres volume. `pnpm stack:reset`, start again, and export the `DATABASE_URL_TEST_*` variables. |

## 11. Adding a workspace member

For a TypeScript package: create it under `packages/` with a `package.json` naming it `@maester/<name>`, add it to `pnpm-workspace.yaml` if it sits outside `packages/*`, extend `packages/config/tsconfig.base.json`, and give it `lint`, `typecheck` and `test` scripts so Turbo picks it up. Applications import packages; packages never import applications.

For a Python package: create it with its own `pyproject.toml` and source namespace, add its explicit path to the root workspace members, declare only the dependencies it uses, then run `uv lock`, `uv sync --locked` and `make check`.

For web work, follow [ADR 0002](decisions/0002-web-sveltekit-brutalist-design-system.md) and the design contract in [DESIGN.md](DESIGN.md). Define the shared contract in `packages/contracts` before duplicating a type by hand.

## 12. Legacy import paths

The prototype was a single package. The engine kept its `pdf_financial_qa` import namespace so old code and cached JSON continue to work.

| Before | After |
| --- | --- |
| `src/pdf_financial_qa/cli.py` | `apps/cli/src/maester_cli/cli.py` |
| `src/pdf_financial_qa/{schema,config,extraction,qa,storage,validation}.py` | `packages/financial-engine/src/pdf_financial_qa/` |
| Distribution `pdf-financial-qa` | `maester-cli` and `maester-financial-engine` |
| `python -m pdf_financial_qa.cli` | `python -m maester_cli` |

`data/cache/*.json` and `.env` keep their paths and contents; no data migration was performed.

## 13. The evaluation harness

`maester-eval` measures the extraction workflow on real filings; nothing about how figures are read changes without a run (`CLAUDE.md`, "Financial figures"). `live` calls Claude, so it needs `ANTHROPIC_API_KEY` in `.env`, as in section 9, and uses Anthropic credit. Public filings go under `data/eval/corpus/<company-folder>/<name>.pdf` (git-ignored) and are listed in `data/eval/manifest.json`:

```json
{
  "filings": [
    { "file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
      "kind": "annual_report", "period_end": "2026-03-31", "set": "dev" }
  ]
}
```

`kind` is `annual_report` or `financial_results`; `period_end` is written `YYYY-MM-DD`; `set` is `dev` or `heldout`, and a company (and its corpus folder) is in one set only. A filing may also carry `stratum` (`large`, `mid`, `small` or `financials`), `out_of_scope` (why a baseline leaves it out: `live` skips it unless named with `--only`, and `report` lists it under "Out of scope" instead of counting it as not run) and `printed_pages_per_page` (`2` when each PDF page is a spread of two printed pages). Then:

```bash
uv run --locked maester-eval live --set dev --label baseline   # costs model calls; --only <id> for one filing
uv run --locked maester-eval export --run latest               # sheets to data/eval/sheets/, never overwritten without --force
# correct the sheets against the PDFs: concept, gold_text, gold_scale, gold_page, verified=yes
uv run --locked maester-eval freeze synthetic-cements/ar-2025-26 --run latest
uv run --locked maester-eval report --run latest --set dev --to docs/eval/2026-10-16-baseline.md
```

Keep every sheet column as text and every date as `YYYY-MM-DD` in your spreadsheet application. `freeze --run` reads the machine columns (`statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `span`, `printed`, `scale_factor`, `page`) back from the run's artefact, so a cell you edit there must still agree with it; put a correction in the matching `gold_` column (`gold_text`, `gold_scale`, `gold_page`, `gold_period_end`, `gold_span`) instead. The model comes from the same variables as the extractor (`ANTHROPIC_API_KEY`, `EXTRACTOR_MODEL`, `EXTRACTOR_EFFORT`). The console shows ids, codes and counts; figures are only in the files. The full description is [System: evaluation harness](systems/eval.md).

### Measure the index

Ingestion phase 3 chooses the OCR engine, the table cell-matching setting and the embedding model by rules fixed before the runs. Two reports in `docs/eval/` hold the result: `<date>-ocr-spot-check.md` and `<date>-retrieval.md`. Rebuild `maester/worker:local` and `maester/indexer:local` before the first candidate window (`docker compose build worker indexer`): the candidate command and the Tesseract reader are in the new images only. The live steps are Tasks 11 to 14 of the phase 3 plan (measure the index). They run from the main checkout, never from a worktree, with the investor's go-ahead, and need a stack with a current index. Outline:

1. **OCR spot check.** `maester-eval ocr request --out data/eval/ocr/request.json`, then `maester-indexer-ocr-sample` in the indexer container (it reads 10 scanned and 5 digital pages under four configurations), score `scores.csv` by hand, then `maester-eval ocr report --to docs/eval/<date>-ocr-spot-check.md`. Reading with Tesseract needs the image to hold it; the image's engine string is in the [indexer README](../apps/indexer/README.md).
2. **The retrieval set.** Write `data/eval/retrieval/corpus.json` and `questions.csv` (40 or more verified questions; pages are PDF pages counted from 1, not printed page numbers), then `maester-eval retrieval check` and `maester-eval retrieval request`.
3. **One candidate at a time.** Fetch the candidates (`maester-indexer-fetch-models --out /models --candidates`), start `CANDIDATE_MODEL=<id> docker compose --profile eval up -d embedder-candidate indexer-candidate`, then run `docker compose --profile eval run --rm --no-deps -v "$PWD/data/eval:/eval:ro" worker node dist/index-candidate.js --workspace <id> --model <id> --request /eval/retrieval/runs/<run>/request.json` (the worker container reads the `blobs` volume and has `INDEXER_SECRET`; its defaults are `http://embedder-candidate` and `http://indexer-candidate:8791`; a command on the host cannot read the volume, so its jobs fail with `OBJECT_MISSING`), then `eval rank` and `eval bench` for the model, and stop the pair before the next model. The embedder and the indexer of a candidate are checked against `--model` first (`/info` and `/v1/versions`); a mismatch stops the command.
4. **Report.** Write `run.json` by hand, then `maester-eval retrieval report --to docs/eval/<date>-retrieval.md`.
5. **Switch.** Only if a report names a challenger: change `EMBEDDING_MODEL`, `OCR_ENGINE` or `INDEX_TABLE_CELL_MATCHING`, raise `INDEX_PIPELINE_VERSION` for a reader change, and run `index:backfill`. Each switch reads or embeds every document again. This is expected to take days; phase 3 has not measured it. `index:prune` deletes a candidate's revisions afterwards.

Run one `index:candidate` at a time: two runs fail each other's `document.index.eval` jobs. A runner sweeps only the job types it has a handler for, so an expired `document.index.eval` job is swept only by the next `index:candidate` run, not by the live worker. Do not upload documents while a candidate run uses the stack: an upload starts a Claude classification, which is a paid call.

The candidate pair adds 5.25 GiB (3072m + 2304m) to the live stack's capped total of 5.9 GiB, so raise Docker Desktop's memory limit before it starts (the memory budget above). The details are in the [worker](systems/worker.md), [indexer](systems/indexer.md) and [evaluation harness](systems/eval.md) descriptions.

## 14. Known limitations

The document engine and CLI carry the prototype's limits, and the hosted services are an early base. Both are recorded here rather than implied by the code.

**Document engine and CLI**

- Only inline PDFs up to 15 MiB. No page batching.
- The model is asked for a complete text rendition; completeness is not measured and long documents may exceed output limits.
- The schema stores floats and a statement-wide scale factor, with no fact-level page locations, decimal contract, explicit period dates or revision metadata.
- Validation uses heuristic label matching and tolerances. Some checks are skipped when totals or periods are absent, and missing subtotal components can be treated as zero. A clean warning list is not a validation certificate.
- Q&A relies on prompt instructions and model arithmetic. There is no deterministic calculation service, citation verification or answer schema.
- The cache uses a 16-character hash prefix and non-versioned JSON, with no tenant boundary or concurrent-write control.

**API, worker and web**

- Extraction accuracy is not measured. The workflow has offline tests with a scripted model only; a live run against Claude is manual.
- Each fact has one page reference and no bounding box. Statements spanning more than six pages are not extracted. Dimensions, restatement links and printed page labels are not modelled.
- The correction guard checks changed values against the page's text layer, so it cannot protect scanned pages, and it does not stop a correction from changing which components a subtotal lists.
- There is no review or correction flow for facts yet (F06). The web client shows facts, with their pages and checks, only on a company's Research page, from its read annual reports (F07).
- Extraction is not deployed: the Cloud Run steps are listed in [document extraction](EXTRACTION.md) section 7.
- Identity is Google or email and password, behind a waitlist: approval is a script, with no admin screen, and nothing is emailed on approval. Every user gets one personal workspace; there is no invitation or role management. [SIGN_IN.md](SIGN_IN.md) section 3.8 lists the known limits, including pre-registration through the email link.
- The web client is a set of static pages. Sign-in and recovery call the API through the web origin; under a real session `/terminal/documents` adds filings and shows what Maester read them as, `/terminal/research` shows a company's statements year by year, and `/terminal/market-mood` and `/terminal/settings` work, all through the API, while the terminal's other first-release pages (`/terminal` and four more: holdings, watchlist, analyst and activity) are coming-soon pages, and the overview is a synthetic demo that does not read the API.
- In `queue` mode, a failed job is retried with backoff until `maxAttempts` (2 for classify and extract, 5 for the rest). The retry endpoint resets the wait (`run_after`) and adds that many attempts again.
- There is no ledger, market data, portfolio accounting, evidence-backed Analyst or autonomous loop. Extraction accuracy is not measured.

Feature IDs F04–F09 address the evidence gaps and F17–F24 the accounting foundation; see the [feature roadmap](FEATURE_ROADMAP.md) and [delivery plan](DELIVERY_PLAN.md).

## 15. Connect an agent

`apps/mcp` is a read-only MCP server over stdio. An agent that you run, such as Claude Code or Claude Desktop, starts it and reads one workspace of your filings through seven tools. The tools are `list_companies`, `list_filings`, `get_statement`, `get_filing_facts`, `get_fact`, `search_filings` and `list_metrics`. Every figure comes back with its fact id and its source. Maester has no named calculation yet, so `list_metrics` is empty, and the agent must say so when you ask for a growth or a margin. The [system description](systems/mcp.md) has the detail, and the [design](superpowers/specs/2026-10-21-mcp-server-design.md) has the reasons.

**Which database.** The server reads the Postgres of the main checkout's stack, on `localhost:5433`, where your real filings are. Never point it at a worktree's database: that database is empty or holds test data. Start the stack from the main checkout (`docker compose up`, section 3) so that Postgres is up. For search, the embedder on `localhost:8792` must also be up. Without `EMBEDDER_URL`, only `search_filings` fails, with `SEARCH_UNAVAILABLE`.

**Build it.** The agent starts the built file, so build again after each change to the server:

```bash
pnpm install
pnpm --filter @maester/mcp build
```

This writes `apps/mcp/dist/main.js`. Use the absolute path of the main checkout below (`<repo>`).

**Claude Code:**

```bash
claude mcp add maester \
  --env DATABASE_URL=postgres://maester:maester@localhost:5433/maester \
  --env MAESTER_USER_EMAIL=you@example.com \
  --env EMBEDDER_URL=http://localhost:8792 \
  -- node <repo>/apps/mcp/dist/main.js
```

**Claude Desktop.** Add this to the `mcpServers` object in `claude_desktop_config.json`, then restart the app:

```json
{
  "mcpServers": {
    "maester": {
      "command": "node",
      "args": ["<repo>/apps/mcp/dist/main.js"],
      "env": {
        "DATABASE_URL": "postgres://maester:maester@localhost:5433/maester",
        "MAESTER_USER_EMAIL": "you@example.com",
        "EMBEDDER_URL": "http://localhost:8792"
      }
    }
  }
}
```

**Settings.** `DATABASE_URL` is required. One of `MAESTER_WORKSPACE_ID` (a workspace id, which wins when both are set) or `MAESTER_USER_EMAIL` (that user's first workspace) is required. `EMBEDDING_MODEL` defaults to `Snowflake/snowflake-arctic-embed-l-v2.0` and must be the model that the embedder serves. `XBRL_PDF_CHECK` is `true` unless you set it to `false`, and must match the API's value. A bad setting stops the server at start with one line on stderr that names the setting. The server also stops, naming `DATABASE_URL`, when Postgres says its session is not read-only: connect to Postgres directly, not through a pooler that drops startup options. A `?options=` in the URL is kept, but it cannot turn read-only off.

**Check it.** Ask the agent: "What was the consolidated revenue from operations of the company in FY2025?" It must give the figure with its fact id, filing, page, basis, unit and period. Then ask: "What was its revenue growth?" It must say that Maester has no named calculation for it yet, and give no figure. A company whose filings do not state a basis is read with `basis: "unknown"`; `get_statement` names it in `read_bases` when it is the basis there is. The server logs one line for each tool call on stderr, with no arguments and no results. Your agent host shows stderr in its MCP log.
