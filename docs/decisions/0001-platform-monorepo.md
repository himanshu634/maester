# ADR 0001: Platform monorepo with application and library boundaries

## Status

Accepted for the repository structure on 9 September 2026. Future application choices in the architecture document remain proposals until implemented.

## Context

The original project was one Python distribution containing CLI presentation, model calls, data schema, validation and local persistence. The intended product now includes research, portfolio accounting, a web interface and durable ingestion. Keeping the CLI as the entire project identity would couple new entry points to local application concerns.

## Decision

Create a uv workspace with `apps/cli` and `packages/financial-engine` as explicit members. The root `maester-platform` project is non-packaged and depends on the CLI workspace member. The CLI depends on the engine using workspace source resolution. Both packages have independent build metadata and share `uv.lock`.

Preserve `pdf_financial_qa` as the engine import namespace. Move CLI presentation to `maester_cli`; publish both `maester` and `pdf-financial-qa` entry points from the CLI distribution. Preserve local cache format and root-relative runtime behavior. Add documentation-only boundaries for the web, API and worker.

Add the TypeScript workspace only when real web code is introduced. Domain calculations belong in reusable Python packages; browser code consumes authoritative calculation results. See [architecture](../ARCHITECTURE.md).

## Alternatives considered

Keeping a single package is simpler initially but does not create application/library boundaries. Separate repositories would add cross-repository release coordination before independent teams exist. Adding a full Node orchestrator now would introduce tooling without a runnable JavaScript application. Moving directly to microservices would add network and operational boundaries unrelated to present scale.

## Consequences

Root `pip install -e .` is replaced by `uv sync --locked` or explicit pip installation of both members. The legacy console command still works after installation; `python -m pdf_financial_qa.cli` becomes `python -m maester_cli`. Programmatic imports of the old CLI module need migration. Engine imports and cached extraction data remain compatible.

The lockfile resolves currently available dependencies satisfying the inherited constraints; it does not freeze the exact versions in the old untracked environment. Offline tests and package smoke tests cover the migration. A live model call remains an explicit cloud test.

The working folder had no `.git` metadata at inspection. This change establishes monorepo structure without creating a remote, committing files or renaming the on-disk project folder.
