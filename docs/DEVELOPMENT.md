# Development and monorepo migration

## 1. Working components

| Component | Location | Status |
| --- | --- | --- |
| CLI distribution `maester-cli` | `apps/cli` | Runnable; Typer commands |
| Library `maester-financial-engine` | `packages/financial-engine` | Runnable; `pdf_financial_qa` imports |
| Workspace `maester-platform` | Root `pyproject.toml` | Dependency coordinator, not an installable library |
| Web/API/worker | `apps/web`, `apps/api`, `apps/worker` | Boundary documentation only |
| Portfolio accounting / shared UI / contracts | Described in architecture | Planned; no package yet |

This is an actual multi-package Python workspace. Planned TypeScript applications will share the repository but use their own language workspace and lockfile. No Node.js, database or queue installation is needed to run the existing CLI.

## 2. Environment and installation

Use Python 3.11+ and uv. The migration was exercised with local Python 3.14 and uv 0.11.17. CI is configured for Python 3.11 and 3.14, but a remote CI run has not occurred because no Git repository/remote is configured in this folder.

Run from the repository root:

```bash
uv sync --locked
uv run --locked maester --help
uv run --locked pdf-financial-qa --help
uv run --locked python -m maester_cli --help
```

`uv sync` creates/updates `.venv` and installs local workspace packages editable. The new lockfile resolves versions satisfying the previous dependency constraints; it can update packages from an older manually installed environment. Commit `uv.lock` when version control is configured. Use `uv lock` for deliberate dependency changes and rerun checks afterward.

The root is not a pip-distributable package. For a pip-only environment:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ./packages/financial-engine -e ./apps/cli
```

If upgrading an old pip installation, uninstall the old `pdf-financial-qa` distribution before reinstalling the two members; it previously owned the same console script name. uv's managed sync performs environment reconciliation. The pip alternative does not consume `uv.lock`.

Make uses a repository-local `.uv-cache` by default and honors an existing `UV_CACHE_DIR`. If direct uv commands cannot write to the default cache in a restricted environment, pass `--cache-dir .uv-cache`. Dependency resolution/first installation requires network access; offline checks do not call model or data providers.

## 3. Configuration and runtime

Keep an existing `.env`. For a new environment, copy `.env.example` and fill in the GCP project. The environment template contains only placeholders; never commit credentials.

| Setting | Meaning | Current default |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | Project used by Vertex AI | Required for ingest/ask |
| `GOOGLE_CLOUD_LOCATION` | Provider region | `us-central1` |
| `GEMINI_MODEL` | Model identifier | Inherited `gemini-2.5-pro`; verify availability before use |
| `GOOGLE_APPLICATION_CREDENTIALS` | Optional credentials file | Otherwise application-default credentials |

The SDK client explicitly selects Vertex AI. `.env.example` also contains `GOOGLE_GENAI_USE_VERTEXAI=true`. Region/model availability and account permissions are external to this refactor. No live cloud request is part of the migration verification.

```bash
gcloud auth application-default login
uv run --locked maester ingest path/to/statement.pdf
uv run --locked maester list-docs
uv run --locked maester ask "What changed in operating cash flow?"
uv run --locked maester ask "What were total assets?" --doc DOCUMENT_HASH
```

With multiple cached documents, `ask` requires `--doc`. Ingestion reuses a matching cached hash unless `--force` is passed. Force overwrites that local cached extraction. The future hosted pipeline instead requires revisioned reprocessing; do not assume the CLI implements it.

Cache location remains `data/cache` relative to the process working directory. Run from the root to reuse the existing cache. Changing directories changes the cache location. Configuration discovery still uses python-dotenv. Workspace-aware storage/configuration is a future refactor, not silently changed behavior.

## 4. Validation commands

```bash
make check
make test
make cli
uv build --all-packages --cache-dir .uv-cache
```

`make check` runs the workspace checker and offline unittest suite. The checker parses package metadata/Python syntax, catches library imports of application modules and validates local Markdown link targets. It does not verify external URL uptime, Markdown anchor fragments, prose accuracy or arbitrary dynamic imports.

The regression suite tests both installed console commands, the module entry point, distribution dependency, legacy JSON/cache compatibility, local CLI behavior, balance/subtotal checks, PDF size enforcement and mocked SDK integration. It uses temporary synthetic data. It does not test real financial extraction quality or the planned portfolio functions.

`uv build --all-packages` creates wheel and source distributions under ignored `dist/`. These artifacts are local builds, not published packages. The checked-in GitHub Actions definition installs the locked workspace, runs checks and builds both packages on two Python versions when the project is placed in GitHub. Its action pins follow the [official uv integration examples](https://docs.astral.sh/uv/guides/integration/github/) reviewed on 9 September 2026.

## 5. Migration map

| Before | After | Compatibility |
| --- | --- | --- |
| `src/pdf_financial_qa/cli.py` | `apps/cli/src/maester_cli/cli.py` | CLI code moved; old module import path changes |
| `src/pdf_financial_qa/{schema,config,extraction,qa,storage,validation}.py` | `packages/financial-engine/src/pdf_financial_qa/` | Engine import namespace preserved |
| Root distribution `pdf-financial-qa` | `maester-cli` + `maester-financial-engine` | Original command name retained by new CLI distribution |
| `pip install -e .` | `uv sync --locked` | Pip users install both explicit member paths |
| `python -m pdf_financial_qa.cli` | `python -m maester_cli` | Update scripts using the old module path |
| `data/cache/*.json` and `.env` | Same paths and content | No schema or data migration performed |

Generated legacy `__pycache__` directories may remain locally under the old path; they are ignored and are not workspace packages. Runtime source files are owned by the new package paths. This change does not rename the folder, initialize Git, create a remote, publish packages or deploy services.

## 6. Known limitations inherited from the prototype

- Only inline PDFs up to 15 MiB are accepted. No GCS upload path, page batching or durable ingestion job exists.
- The model is asked for a complete text rendition; completeness is not measured and long documents may exceed output limits.
- The schema stores floats and a statement-wide scale factor. It has no fact-level page locations, precise decimal contract, explicit period dates or revision metadata.
- Validation uses heuristic label matching and tolerances. Some checks are skipped when totals/periods are absent; missing subtotal components can be treated as zero during summation. A clean warning list is not a complete validation certificate.
- The CLI's success text is inherited and can overstate which checks actually ran. The PRD requires explicit check coverage in the new product.
- Q&A relies on prompt instructions and model arithmetic. There is no deterministic calculation service, source-citation verification or output schema for answers.
- Local caching uses a 16-character hash prefix, working-directory-relative paths and non-versioned JSON. There is no tenant boundary, concurrent-write control or corrupted-cache recovery.
- Cloud errors, invalid/missing parsed model output and some invalid paths are not converted into polished recovery states.
- There is no portfolio ledger, historical pricing, authentication, web UI, hosted API, queue, market-data integration or broker connection.

These limitations are recorded rather than being mixed into the package migration. F04–F09 address the core evidence gaps; F17–F24 define the independent accounting foundation.

## 7. Adding a workspace member

Create a Python package under the correct app/library boundary with its own `pyproject.toml` and source namespace. Add its explicit path to root workspace members, declare only the dependencies it uses, and use a root workspace source mapping for internal dependencies. Keep app imports out of libraries. Run `uv lock`, `uv sync --locked`, `make check` and an appropriate package build.

For the future web client, follow the TypeScript workspace plan in [ARCHITECTURE.md](ARCHITECTURE.md). Define the API contract before manually duplicating types. Do not add a placeholder runtime or claim readiness in the root README until its primary journey is implemented and tested.
