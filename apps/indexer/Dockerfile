FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.17 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
# The indexer is its own uv project (docling needs torch), not a workspace member.
COPY apps/indexer/pyproject.toml apps/indexer/uv.lock apps/indexer/LICENSE ./
COPY apps/indexer/src ./src
RUN uv sync --locked --no-dev --no-editable

FROM python:3.12-slim
# OpenCV (rapidocr) needs libGL and glib at import time. OCR_ENGINE=tesseract runs the
# tesseract command with English data; the package pulls in tesseract-ocr-osd, which Docling's
# orientation check reads.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m app \
    && mkdir /models && chown app:app /models
# The virtualenv keeps the path it was built at so its scripts' shebangs resolve.
COPY --from=build /app/.venv /app/.venv
COPY apps/indexer/models.lock.json /app/models.lock.json
# Nothing is fetched at run time; `maester-indexer-fetch-models` is the one command that does,
# and the models service turns this off for it.
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
USER app
EXPOSE 8791
CMD ["maester-indexer"]
