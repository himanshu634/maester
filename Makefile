.PHONY: sync check test cli

export UV_CACHE_DIR ?= $(CURDIR)/.uv-cache

sync:
	uv sync --locked

check:
	uv run --locked python scripts/check_workspace.py
	uv run --locked python -m unittest discover -s tests -v

test:
	uv run --locked python -m unittest discover -s tests -v

cli:
	uv run --locked maester --help

.PHONY: ts-install ts-check ts-test ts-dev-api ts-dev-worker db-up db-down

ts-install:
	pnpm install --frozen-lockfile

ts-check:
	pnpm lint && pnpm typecheck

ts-test:
	pnpm test

ts-dev-api:
	pnpm dev:api

ts-dev-worker:
	pnpm dev:worker

db-up:
	docker compose up -d postgres

db-down:
	docker compose down
