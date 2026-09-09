# Contributing to Maester

Thank you for helping build an open-source portfolio management platform that tracks portfolios autonomously and suggests evidence-backed actions. This guide covers everything technical: setup, running the CLI, repository layout, development commands, and the rules that keep the codebase trustworthy.

For the product vision, read the [README](README.md). For product and engineering specifications, start at the [documentation index](docs/README.md).

## Ways to contribute

- **Code** for the R1 vertical slice: durable job pipeline, versioned fact extraction with page locations, the source reader, and the deterministic calculation service. Python today, TypeScript once the web client starts.
- **Investor interviews.** If you keep a spreadsheet, hold a research subscription, or use more than one broker, open an issue describing your last earnings review and your last unexplained portfolio difference.
- **Domain review** of accounting conventions: lot basis, external-flow treatment, corporate actions, TWR and XIRR edge cases. The [data model](docs/DATA_MODEL.md) is the document to challenge.
- **Sample data.** Permissioned, redacted filings and broker exports so connectors are built from real formats rather than assumed headers. Never commit private documents; open an issue to coordinate.
- **Documentation.** Corrections and clarifications to anything under `docs/`.

Before starting significant work, open an issue referencing the feature ID from the [feature roadmap](docs/FEATURE_ROADMAP.md) so the scope and acceptance criteria are agreed first.

## What exists today

Maester is a Python monorepo with a working financial-document engine and CLI, plus a static SvelteKit index page in `apps/web`. The web application's investor journeys, the HTTP API, ingestion workers and portfolio accounting are specified in the docs and not implemented.

Working now:

- Extract a financial-statement PDF into structured statements with Gemini on Vertex AI.
- Store structured data and a text rendition in a local JSON cache.
- Run heuristic arithmetic checks on subtotals and the balance-sheet identity.
- Ask questions about a single cached document from the terminal.
- Build and preview the static web index page (`pnpm --dir apps/web build`, `pnpm --dir apps/web preview`), which explains the workflow and carries the design system in [DESIGN.md](docs/DESIGN.md).

Not yet implemented: page-level provenance, verified citations, a deterministic calculation engine, a ledger, market data, or any hosted runtime. Extraction accuracy is not measured. See [known limitations](docs/DEVELOPMENT.md).

## Prerequisites

- Python 3.11 or newer.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for the shared locked environment.
- A Google Cloud project with Vertex AI enabled and billing, only for ingestion and Q&A. Help, cache listing and offline tests need no credentials.

Node 22 and pnpm 11 are required only for `apps/web`; see [architecture](docs/ARCHITECTURE.md) and the [web README](apps/web/README.md). Python-only contributions do not need them.

## Setup

Run all commands from the repository root.

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
  web/                      SvelteKit static index page; investor journeys planned
  api/                      Planned FastAPI service; documentation only
  worker/                   Planned durable-job workers; documentation only
packages/
  financial-engine/         Working extraction, schema, checks, cache and Q&A
docs/                       PRD, UI spec, roadmap, research, architecture, data model
scripts/                    Workspace and documentation checks
tests/                      Offline regression tests
.github/workflows/          CI definition
data/cache/                 Local extraction cache, ignored by version control
pyproject.toml              uv workspace and local package dependencies
uv.lock                     Shared Python dependency resolution
Makefile                    Root development commands
```

Only `apps/cli` and `packages/financial-engine` are active uv workspace members. `apps/web` is a standalone pnpm project with its own lockfile. `apps/api` and `apps/worker` hold boundary documentation and no runtime. The engine keeps the `pdf_financial_qa` import namespace for compatibility.

## Development commands

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
- [ ] `make check` and `make test` pass locally, and `pnpm --dir apps/web verify` if `apps/web` changed.
- [ ] New behavior has offline tests that do not call a model.
- [ ] Documentation under `docs/` is updated where semantics changed.
- [ ] No private data, credentials or generated caches are included.

## License

A license has not been selected yet. It will be an OSI-approved open-source license, chosen before the first hosted release. Contributions are accepted on the understanding that the project will be released under such a license.
