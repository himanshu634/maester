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
