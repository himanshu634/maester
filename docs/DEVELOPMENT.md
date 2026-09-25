# Development

Everything needed to run Maester locally, change it and check your work. New contributors should read the [contributing guide](../CONTRIBUTING.md) first for the engineering rules and the pull request checklist; this document is the operating manual.

The whole stack runs on your machine with no Google Cloud account:

```bash
docker compose up --build
```

## 1. What is in the repository

| Component | Path | Language | Status |
| --- | --- | --- | --- |
| HTTP API | `apps/api` | TypeScript, Hono | Running: identity, workspaces, document uploads, jobs, SSE ([README](../apps/api/README.md)) |
| Job worker | `apps/worker` | TypeScript, Hono | Running: leased job execution, `document.verify` ([README](../apps/worker/README.md)) |
| Web client | `apps/web` | SvelteKit, static | Running: public pages at `/`, `/login`, `/terminal`; investor journeys planned ([README](../apps/web/README.md)) |
| CLI | `apps/cli` | Python, Typer | Running: `maester ingest`, `list-docs`, `ask` |
| Document engine | `packages/financial-engine` | Python | Running: extraction, checks, cache, Q&A |
| API contracts | `packages/contracts` | TypeScript, Zod | Running: shared request and response shapes ([README](../packages/contracts/README.md)) |
| Database | `packages/db` | TypeScript, Drizzle | Running: schema, queries, migrations |
| Object storage | `packages/storage` | TypeScript | Running: Cloud Storage, local disk and in-memory drivers |
| Deployment | `infra` | Bash, gcloud | Running: Cloud Run bootstrap and deploy ([README](../infra/README.md)) |

Two independent language workspaces share the repository. The TypeScript side uses pnpm and `pnpm-lock.yaml`; the Python side uses uv and `uv.lock`. `apps/web` is a third, standalone pnpm project with its own lockfile — a root `pnpm install` does not install it. The boundaries and the reasoning behind them are in [architecture](ARCHITECTURE.md) and [ADR 0003](decisions/0003-typescript-backend.md).

## 2. Prerequisites

| You want to | You need |
| --- | --- |
| Run the stack | Docker with Compose v2 |
| Work on the API, worker or shared packages | Node 22 (`.nvmrc`), pnpm 11, Docker for Postgres |
| Work on the web client | Node 22, pnpm 11 |
| Work on the CLI or the document engine | Python 3.11+ and [uv](https://docs.astral.sh/uv/getting-started/installation/) |
| Extract a real PDF with the CLI | A Google Cloud project with Vertex AI enabled |

Nothing but Docker is required for the first section below.

## 3. Start the whole stack

```bash
docker compose up --build      # or: pnpm stack:up
```

That single command builds three images, starts Postgres, applies database migrations, then starts the API, the worker and the web client. The first build takes a few minutes; later starts take seconds. Everything runs with local development defaults — no cloud project, no credentials, no secrets to fill in.

| Service | Address | What it is |
| --- | --- | --- |
| Web | <http://localhost:5173> | The public pages, built statically and served by nginx |
| API | <http://localhost:8787> | Hono service, Better Auth, documents and jobs |
| Dev upload page | <http://localhost:8787/dev/upload> | The working upload flow, end to end in a browser |
| Worker | <http://localhost:8788> | Job execution; the API dispatches to it over HTTP |
| Postgres | `localhost:5433` | User `maester`, password `maester`, database `maester` |

Useful lifecycle commands:

```bash
pnpm stack:logs      # docker compose logs -f
pnpm stack:down      # stop everything, keep the database and uploads
pnpm stack:reset     # stop everything and delete the volumes
docker compose up --build api worker    # rebuild after changing service code
```

Containers do not hot-reload. After changing TypeScript under `apps/` or `packages/`, rebuild the affected service, or run the services as local processes instead (section 5).

### What the stack does not include

The Python CLI and document engine are not containerised; run them with uv (section 9). Gemini extraction, Cloud Tasks and Cloud Storage are not part of the local stack, and no service in it calls a paid API.

## 4. Try it

**In a browser.** Open <http://localhost:8787/dev/upload>, sign up with the pre-filled credentials, choose any PDF, and press *Upload and verify*. The page creates a document, uploads the bytes to a signed URL, finalises it, and then streams job progress over Server-Sent Events until the document reaches `stored`. That is the full R1 upload path: API, database, object storage, job dispatch, worker.

**From the terminal.** The same journey, scripted:

```bash
pnpm smoke path/to/file.pdf
```

It signs up a throwaway user, uploads, polls the job, and exits non-zero unless the document ends up `stored`.

**In the database.**

```bash
psql postgres://maester:maester@localhost:5433/maester -c 'table document'
```

**The web pages.** <http://localhost:5173> serves the index, `/login` and `/terminal`. They are static marketing and entry pages; they do not call the API yet. The visual contract they follow is [DESIGN.md](DESIGN.md).

## 5. Run the services without Docker

Faster for day-to-day API and worker work, because `tsx watch` reloads on save.

```bash
cp -n .env.example .env          # -n keeps an existing .env; the shipped defaults already work
pnpm install --frozen-lockfile
pnpm db:up                       # Postgres alone, in Docker
pnpm --filter @maester/db migrate
```

Then two terminals:

```bash
PORT=8787 pnpm dev:api
PORT=8788 pnpm dev:worker
```

Both read the root `.env`. With the shipped defaults they store uploads under `data/blobs`, dispatch jobs over plain HTTP and need no cloud credentials. The web client is separate and uses pnpm from its own directory:

```bash
pnpm --dir apps/web install --frozen-lockfile
pnpm --dir apps/web dev          # http://localhost:5173
```

Do not run both this and the full compose stack at once: they compete for ports 8787, 8788 and 5173.

## 6. Configuration

Copy [`.env.example`](../.env.example) to `.env`. Both services validate their environment at boot and refuse to start on anything invalid, so a typo is a clear error rather than a runtime surprise. The compose file sets its own values inline and ignores `.env`.

| Variable | Used by | Required | Local default |
| --- | --- | --- | --- |
| `DATABASE_URL` | api, worker | Always | `postgres://maester:maester@localhost:5433/maester` |
| `BETTER_AUTH_SECRET` | api | Always, at least 32 characters | A placeholder; replace it anywhere shared |
| `BETTER_AUTH_URL` | api | Always | `http://localhost:8787` |
| `ALLOWED_ORIGINS` | api | Always | The API and web origins, comma separated |
| `STORAGE_DRIVER` | api, worker | Defaults to `gcs` | `disk` |
| `STORAGE_DIR` | api, worker | When the driver is `disk` | `../../data/blobs` |
| `GCS_BUCKET` | api, worker | When the driver is `gcs` | Unset |
| `DISPATCH_MODE` | api, worker | Defaults to `local` | `local` |
| `DISPATCH_SECRET` | api, worker | When the mode is `local`; must match on both | `local-dispatch-secret` |
| `WORKER_URL` | api, worker | Always | `http://localhost:8788` |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `CLOUD_TASKS_QUEUE`, `WORKER_INVOKER_SA` | api | When the mode is `cloud-tasks` | Unset |
| `API_SERVICE_ACCOUNT_EMAIL` | worker | When the mode is `cloud-tasks` | Unset |
| `MAX_UPLOAD_BYTES`, `UPLOAD_URL_TTL_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS`, `LEASE_SECONDS` | api, worker | Defaulted | 50 MiB, 900 s, 300 s, 600 s |
| `PORT`, `LOG_LEVEL`, `NODE_ENV` | api, worker | Defaulted | `8787`/`8788`, `info`, `development` |
| `GOOGLE_CLOUD_PROJECT`, `GEMINI_MODEL`, `GOOGLE_APPLICATION_CREDENTIALS` | Python CLI | For `ingest` and `ask` | See section 9 |

Never commit credentials. `.env` and `data/` are ignored by version control; keep it that way.

## 7. How local storage and job dispatch stand in for the cloud

Two settings decide whether a service talks to Google Cloud or to something local. Both defaults in `.env.example` are the local ones, and the deployed configuration in [infra](../infra/README.md) sets the cloud ones.

**`STORAGE_DRIVER=disk`** keeps uploaded bytes on the filesystem under `STORAGE_DIR` instead of in a Cloud Storage bucket. The API signs upload and download URLs that point back at its own `/dev/blobs/…` routes, carrying an expiry and an HMAC signature; an unsigned, tampered or expired URL is refused. The worker reads the bytes straight off the same directory, which is why compose mounts one shared volume into both containers. Environment validation refuses this driver when `NODE_ENV=production`, and the blob routes exist only outside production. With `STORAGE_DRIVER=gcs` the same interface signs real Cloud Storage V4 URLs and the browser uploads directly to the bucket.

**`DISPATCH_MODE=local`** makes the API `POST` to the worker's `/tasks/:type` endpoint with a shared secret header, in place of enqueueing a Cloud Tasks task authenticated with an OIDC token. Retries are not automatic in this mode: a failed job stays failed until you call the retry endpoint. Everything else — leasing, progress, state transitions — behaves the same, because it lives in the database rather than in the queue.

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

The tests need Postgres and three separate databases, which `scripts/db/init.sql` creates the first time the Postgres volume is initialised. Point the suite at them:

```bash
export DATABASE_URL_TEST_DB=postgres://maester:maester@localhost:5433/maester_test_db
export DATABASE_URL_TEST_API=postgres://maester:maester@localhost:5433/maester_test_api
export DATABASE_URL_TEST_WORKER=postgres://maester:maester@localhost:5433/maester_test_worker
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

The CLI and the document engine are independent of the TypeScript services and share no database with them. They read and write a local JSON cache under `data/cache`, relative to the working directory, so run them from the repository root.

```bash
uv sync --locked
uv run --locked maester --help
uv run --locked maester list-docs
```

Extraction and Q&A call Gemini on Vertex AI and can incur charges:

```bash
gcloud auth application-default login
uv run --locked maester ingest path/to/statement.pdf
uv run --locked maester ask "What changed in operating cash flow?"
uv run --locked maester ask "What were total assets?" --doc DOCUMENT_HASH
```

`ask` requires `--doc` once more than one document is cached. `ingest` reuses a matching cached hash unless you pass `--force`, which overwrites the cached extraction. Set `GOOGLE_CLOUD_PROJECT` in `.env`, and override `GEMINI_MODEL` if the inherited default is unavailable in your project.

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
| A job stays `queued` | The worker is down, unreachable at `WORKER_URL`, or rejecting the dispatch because `DISPATCH_SECRET` differs between the two services. Local dispatch is fire-and-forget, so the failure only shows in the worker log: `docker compose logs worker`. |
| A document is rejected with `OBJECT_MISSING` | The API and the worker are pointed at different `STORAGE_DIR` paths, so the worker cannot find what the API wrote. Outside Docker the default resolves against each service's own directory; use `../../data/blobs` as `.env.example` does. |
| Code changes do nothing | Containers do not hot-reload. Rebuild the service, or run it as a local process. |
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

## 13. Known limitations

The document engine and CLI carry the prototype's limits, and the hosted services are an early base. Both are recorded here rather than implied by the code.

**Document engine and CLI**

- Only inline PDFs up to 15 MiB. No page batching.
- The model is asked for a complete text rendition; completeness is not measured and long documents may exceed output limits.
- The schema stores floats and a statement-wide scale factor, with no fact-level page locations, decimal contract, explicit period dates or revision metadata.
- Validation uses heuristic label matching and tolerances. Some checks are skipped when totals or periods are absent, and missing subtotal components can be treated as zero. A clean warning list is not a validation certificate.
- Q&A relies on prompt instructions and model arithmetic. There is no deterministic calculation service, citation verification or answer schema.
- The cache uses a 16-character hash prefix and non-versioned JSON, with no tenant boundary or concurrent-write control.

**API, worker and web**

- `document.verify` is the only job handler. It checks size and the PDF header and records a checksum; it does not extract anything. The engine is not wired into the worker yet.
- Identity is email and password only. Every user gets one personal workspace; there is no invitation or role management.
- The web client is a set of static pages. It does not call the API, and sign-in is not connected.
- Local dispatch does not retry a failed job automatically.
- There is no ledger, market data, portfolio accounting, evidence-backed Analyst or autonomous loop. Extraction accuracy is not measured.

Feature IDs F04–F09 address the evidence gaps and F17–F24 the accounting foundation; see the [feature roadmap](FEATURE_ROADMAP.md) and [delivery plan](DELIVERY_PLAN.md).
