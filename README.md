# Maester

Maester is evolving into an investor platform for understanding portfolios, researching companies, and tracing financial conclusions back to evidence.

The repository is a Python monorepo with a working financial-document engine and CLI. The web application, hosted API, ingestion workers, and portfolio accounting are specified in the product documentation and are **not implemented yet**.

## Product direction

The proposed first audience is self-directed, long-term equity investors, with India-first imports and identifiers and foundations for other markets. This is a planning assumption pending investor interviews and market confirmation.

The product will connect four activities: track holdings and performance, investigate companies, verify financial facts, and record investment decisions. The first web release prioritizes a research workspace and a clearly labeled holdings snapshot; transaction-based performance follows after the accounting foundation is tested.

Read the [documentation index](docs/README.md), [product requirements](docs/PRD.md), [UI specification](docs/UI_SPECIFICATION.md), and [prioritized roadmap](docs/FEATURE_ROADMAP.md). The [research report](docs/RESEARCH.md) explains the evidence behind the choices.

## What works today

- Extract a financial-statement PDF with Gemini on Vertex AI.
- Store structured statement data and an LLM-produced text rendition in local JSON.
- Check some subtotals and the balance-sheet identity with heuristic arithmetic checks.
- Reuse cached extractions when asking questions about one document.
- Run the original `pdf-financial-qa` command or the new `maester` alias.

These checks do not establish complete extraction accuracy. The current schema does not store page/cell provenance; answers do not yet have verified source citations or a deterministic calculation engine. Missing subtotals can mean a check was skipped. See [known limitations](docs/DEVELOPMENT.md).

## Repository layout

```text
apps/
  cli/                      Working Typer application: maester and pdf-financial-qa
  web/                      Planned web application boundary; documentation only
  api/                      Planned HTTP API boundary; documentation only
  worker/                   Planned background worker boundary; documentation only
packages/
  financial-engine/         Working Python library; imports remain pdf_financial_qa
docs/                       PRD, UI, priorities, research, architecture, delivery
scripts/                    Workspace and local documentation checks
tests/                      Offline regression tests for the package migration
.github/workflows/          CI definition, ready for a GitHub repository
data/cache/                 Existing local extraction cache, ignored by version control
pyproject.toml              uv workspace and local package dependencies
uv.lock                     Shared Python dependency resolution
Makefile                    Root development commands
```

Only `apps/cli` and `packages/financial-engine` are active workspace members. Planned application directories have no runtime or installable package. The future TypeScript workspace is described in [architecture](docs/ARCHITECTURE.md); Node.js is not required today.

## Quick start

Use Python 3.11 or newer and [uv](https://docs.astral.sh/uv/getting-started/installation/). Run commands from the repository root:

```bash
uv sync --locked
uv run --locked maester --help
uv run --locked maester list-docs
```

Help, local cache listing, and offline tests do not require cloud credentials. Ingestion and Q&A require a GCP project with Vertex AI enabled, billing, and appropriate credentials.

If you do not already have `.env`, copy `.env.example` to `.env` and set `GOOGLE_CLOUD_PROJECT`. Keep an existing `.env` when upgrading. The example lists region and model overrides.

```bash
gcloud auth application-default login
uv run --locked maester ingest path/to/statement.pdf
uv run --locked maester list-docs
uv run --locked maester ask "How did operating cash flow change year over year?"
uv run --locked maester ask "What were total assets?" --doc DOCUMENT_HASH
```

`ingest --force` re-extracts a document and overwrites that document's cached JSON. Model calls use your configured cloud project and can incur charges. The inherited default model ID is `gemini-2.5-pro`; verify availability in your project and override `GEMINI_MODEL` as needed. This refactor does not select or validate a new cloud model.

For a pip-only installation:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ./packages/financial-engine -e ./apps/cli
maester --help
```

The pip path resolves package constraints independently; use uv for the shared locked environment. Root-level `pip install -e .` is replaced by installation of the two packages.

## Development

```bash
make sync
make check
make test
make cli
```

Equivalent checks without Make:

```bash
uv run --locked python scripts/check_workspace.py
uv run --locked python -m unittest discover -s tests -v
```

The checks validate package boundaries, local documentation links, imports, CLI behavior, cache compatibility, and arithmetic regression cases without sending financial data to a model. See [development and migration](docs/DEVELOPMENT.md).

## Delivery priorities

| Priority | Investor outcome | Planned scope |
| --- | --- | --- |
| P0 | Understand a company and inspect the evidence | Research workspace, upload/review, source-linked facts, grounded Q&A, notes/watchlist, holdings snapshot |
| P1 | Know what the portfolio actually earned | Transaction imports, reconciliation, cash/dividends/actions, return methods, comparison, monitoring |
| P2 | Evaluate alternatives and work with others | Valuation scenarios, screening, broader assets/currencies, broker connections, sharing and reports |
| P3 | Support specialist operating models | Adviser workflows, advanced attribution, tax modules, execution only as a separate initiative |

Priority is not a delivery promise. The [roadmap](docs/FEATURE_ROADMAP.md) contains feature IDs, dependencies, acceptance criteria, and release gates.

## Contributing and data handling

Keep domain logic in reusable packages and presentation/transport code in applications. Update the relevant PRD feature ID and tests when behavior changes. Keep private PDFs, caches, credentials, and account exports out of source control. Use synthetic data in tests and examples.

No license has been selected. Hosting, market-data contracts, and production integrations remain future work. This local project folder currently has no Git metadata or configured remote; the monorepo layout and CI files are ready for version control when it is configured.
