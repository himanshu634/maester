FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.17 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /repo
COPY pyproject.toml uv.lock ./
# Every workspace member's manifest is needed to resolve the lockfile; only the
# extractor and the engine are installed.
COPY apps/cli/pyproject.toml ./apps/cli/pyproject.toml
COPY apps/extractor ./apps/extractor
COPY packages/financial-engine ./packages/financial-engine
RUN uv sync --locked --no-dev --no-editable --package maester-extractor

FROM python:3.12-slim
RUN useradd -m app
# The virtualenv keeps the path it was built at so its scripts' shebangs resolve.
COPY --from=build /repo/.venv /repo/.venv
ENV PATH="/repo/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8790
CMD ["maester-extractor"]
