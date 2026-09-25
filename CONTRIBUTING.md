# Contributing to Maester

Thank you for helping build an open-source portfolio management platform that tracks portfolios autonomously and suggests evidence-backed actions. This guide covers everything technical: setup, running the CLI, repository layout, development commands, and the rules that keep the codebase trustworthy.

For the product vision, read the [README](README.md). For product and engineering specifications, start at the [documentation index](docs/README.md).

## Ways to contribute

- **Code** for the R1 vertical slice: versioned fact extraction with page locations, the source reader, the deterministic calculation service, and the web journeys on top of the existing API. TypeScript for the platform, Python for the document engine.
- **Investor interviews.** If you keep a spreadsheet, hold a research subscription, or use more than one broker, open an issue describing your last earnings review and your last unexplained portfolio difference.
- **Domain review** of accounting conventions: lot basis, external-flow treatment, corporate actions, TWR and XIRR edge cases. The [data model](docs/DATA_MODEL.md) is the document to challenge.
- **Sample data.** Permissioned, redacted filings and broker exports so connectors are built from real formats rather than assumed headers. Never commit private documents; open an issue to coordinate.
- **Documentation.** Corrections and clarifications to anything under `docs/`.

Before starting significant work, open an issue referencing the feature ID from the [feature roadmap](docs/FEATURE_ROADMAP.md) so the scope and acceptance criteria are agreed first.

## What exists today

Maester is a two-language monorepo: a Python document engine and CLI, and a TypeScript platform base of an HTTP API, a job worker and a static SvelteKit web client. The investor journeys, the ledger and portfolio accounting are specified in the docs and not implemented.

Working now:

- Extract a financial-statement PDF into structured statements with Gemini on Vertex AI, from the command line.
- Store structured data and a text rendition in a local JSON cache, run heuristic arithmetic checks on subtotals and the balance-sheet identity, and ask questions about a cached document.
- Sign up, get a personal workspace, upload a document to object storage, and watch a durable verification job run to completion over Server-Sent Events.
- Serve the static public pages, which carry the design system in [DESIGN.md](docs/DESIGN.md).

The whole hosted stack runs locally in Docker with no Google Cloud account; see [setup](#setup).

Not yet implemented: page-level provenance, verified citations, a deterministic calculation engine, a ledger, market data, or a web client connected to the API. Extraction accuracy is not measured. See [known limitations](docs/DEVELOPMENT.md).

## Prerequisites

- Docker with Compose v2, to run the API, worker, database and web client.
- Node 22 and pnpm 11, for the TypeScript services, shared packages and the web client.
- Python 3.11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/), for the CLI and the document engine.
- A Google Cloud project with Vertex AI enabled and billing, only for CLI ingestion and Q&A. Nothing else needs credentials.

Take only what your change touches. A Python-only contribution needs no Node; a web-only contribution needs no Python.

## Setup

Run all commands from the repository root.

The hosted stack — Postgres, the API, the worker and the web client — starts with one command and needs no cloud account:

```bash
docker compose up --build
```

Then open <http://localhost:8787/dev/upload> to run the upload and verification flow end to end, and <http://localhost:5173> for the public pages. [Development](docs/DEVELOPMENT.md) explains what is running, how to work on the services without Docker, and how to troubleshoot.

The Python CLI is independent of that stack:

```bash
uv sync --locked
uv run --locked maester --help
uv run --locked maester list-docs
```

For cloud features, copy `.env.example` to `.env` and set `GOOGLE_CLOUD_PROJECT`. Keep an existing `.env` when upgrading. The example file lists region and model overrides.

```bash
gcloud auth application-default login
uv run --locked maester ingest path/to/statement.pdf
uv run --locked maester list-docs
uv run --locked maester ask "How did operating cash flow change year over year?"
uv run --locked maester ask "What were total assets?" --doc DOCUMENT_HASH
```

`ingest --force` re-extracts a document and overwrites its cached JSON. Model calls run against your configured project and can incur charges. The inherited default model is `gemini-2.5-pro`; verify availability in your project and override `GEMINI_MODEL` as needed. The original `pdf-financial-qa` command remains available as an alias of `maester`.

### pip-only installation

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ./packages/financial-engine -e ./apps/cli
maester --help
```

The pip path resolves package constraints independently. Use uv for the shared locked environment. Root-level `pip install -e .` is not supported; install the two packages instead.

## Repository layout

```text
apps/
  cli/                      Working Typer application: maester and pdf-financial-qa
  api/                      Working Hono HTTP service: auth, workspaces, documents, jobs
  worker/                   Working Hono job runner: leasing and document.verify
  web/                      SvelteKit static pages; investor journeys planned
packages/
  financial-engine/         Working extraction, schema, checks, cache and Q&A
  contracts/                Shared Zod request and response schemas
  db/                       Drizzle schema, queries and migrations
  storage/                  Object storage drivers: Cloud Storage, local disk, memory
  config/                   Shared TypeScript and ESLint configuration
docs/                       PRD, UI spec, roadmap, research, architecture, data model
infra/                      Cloud Run bootstrap and deploy scripts
scripts/                    Workspace checks, database init, smoke test
tests/                      Offline Python regression tests
.github/workflows/          CI definitions
data/                       Local extraction cache and uploads, ignored by version control
docker-compose.yml          The local stack
pyproject.toml, uv.lock     uv workspace and Python dependency resolution
package.json, pnpm-*.yaml   pnpm workspace and TypeScript dependency resolution
Makefile                    Python development commands
```

Only `apps/cli` and `packages/financial-engine` are uv workspace members. `apps/api`, `apps/worker` and `packages/*` are the pnpm workspace. `apps/web` is a standalone pnpm project with its own lockfile, so a root `pnpm install` does not install it. The engine keeps the `pdf_financial_qa` import namespace for compatibility.

## Development commands

The local stack:

```bash
pnpm stack:up        # docker compose up --build
pnpm stack:logs
pnpm stack:down      # stop, keeping the database and uploads
pnpm stack:reset     # stop and delete the volumes
```

The TypeScript workspace:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test            # needs Postgres; see docs/DEVELOPMENT.md for the test database URLs
```

The Python workspace:

```bash
make sync
make check
make test
make cli
```

For the web client, use pnpm directly (from the repository root, or drop `--dir apps/web` inside that directory):

```bash
pnpm --dir apps/web install --frozen-lockfile
pnpm --dir apps/web verify
pnpm --dir apps/web dev
```

`verify` runs the type and accessibility check, prettier, eslint, the design guard and the static build. The individual scripts are listed in the [web README](apps/web/README.md).

Equivalent commands without Make:

```bash
uv run --locked python scripts/check_workspace.py
uv run --locked python -m unittest discover -s tests -v
```

The checks validate package boundaries, local documentation links, imports, CLI behavior, cache compatibility and arithmetic regression cases without sending any financial data to a model. Run both before opening a pull request. See [development and migration](docs/DEVELOPMENT.md) and the [quality plan](docs/QUALITY.md).

## Engineering rules

These rules come from the [product requirements](docs/PRD.md) and [architecture](docs/ARCHITECTURE.md). Pull requests that break them will be asked to change.

1. **Domain logic lives in packages; presentation and transport live in applications.** Applications import packages. Packages never import applications.
2. **Behavior changes update the relevant feature ID** in the [feature roadmap](docs/FEATURE_ROADMAP.md) and its tests.
3. **Money and quantities in new code use explicit decimal precision.** Round for display, never during intermediate calculation. Float-based legacy statement objects are a compatibility boundary, not a pattern to extend.
4. **Unknown is not zero.** Missing data reduces coverage; it never reduces a displayed amount or risk.
5. **Reported facts, calculations, AI interpretations and user assumptions are labelled distinctly.** Do not present arithmetic consistency as source verification.
6. **Model output is never an authorization boundary.** Resolve user scope and permissions before retrieval. Treat document content as untrusted input.
7. **Every derived value has a method and input lineage.** Every extracted fact has a source and revision.

## Data handling

- Never commit private PDFs, caches, credentials or account exports. `data/cache/` and `.env` are ignored by version control; keep it that way.
- Use synthetic data in tests and examples. Public filings are acceptable for golden test cases when their terms permit.
- Do not place private document text in logs or analytics.

## Pull request checklist

- [ ] An issue exists and references a feature ID, or the change is a small documentation or tooling fix.
- [ ] `make check` and `make test` pass locally for Python changes; `pnpm lint`, `pnpm typecheck` and `pnpm test` for TypeScript changes; `pnpm --dir apps/web verify` if `apps/web` changed.
- [ ] New behavior has offline tests that do not call a model.
- [ ] Documentation under `docs/` is updated where semantics changed.
- [ ] No private data, credentials or generated caches are included.
- [ ] Commits are signed off with `git commit -s`, and if this is your first pull request, you have added yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) and agreed to the [CLA](CLA.md) in the description.

## License

Maester is licensed under the [GNU Affero General Public License, version 3 or later](LICENSE). Anyone who runs a modified copy as a network service must make their source available to its users.

Contributions are accepted under the [Contributor Licence Agreement](CLA.md). You keep ownership of your work and grant the maintainer a licence broad enough to relicense the project, which is what makes a commercial licence possible for organisations that cannot use the Affero terms. Sign once by adding yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) in your first pull request and agreeing to the CLA in its description. Sign your commits off with `git commit -s`.
