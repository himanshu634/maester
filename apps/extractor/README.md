# Maester extractor

Status: implemented. A stateless Python HTTP service ([FastAPI](https://fastapi.tiangolo.com/)) over the LangGraph extraction workflow in `packages/financial-engine` (`pdf_financial_qa.workflow`). The TypeScript worker (`apps/worker`) calls it for every `document.extract` job and writes the result to Postgres; this service never touches the database or object storage. Design: [document extraction spec](../../docs/EXTRACTION.md) and [ADR 0004](../../docs/decisions/0004-python-extraction-sidecar.md).

## Endpoints

- `GET /healthz` — liveness.
- `POST /v1/extract` — PDF as the `application/pdf` body; optional `x-document-id` (logged) and `x-company-name` (URI-encoded, compared with the printed name). Answers `200` with an `application/x-ndjson` stream: `started`, then `progress` and `heartbeat` lines, then exactly one `result` or `error`. `401` for a wrong secret, `413` over `EXTRACT_MAX_BYTES`. The line formats are the `ExtractorEvent` schemas in `@maester/contracts`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port, default `8790` |
| `EXTRACTOR_SECRET` | Shared secret expected in `x-extractor-secret`. Leave unset on Cloud Run, where IAM authenticates the worker |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI project. Without it, or without Application Default Credentials, every request ends with `EXTRACTOR_NOT_CONFIGURED` |
| `VERTEX_LOCATION` | Vertex AI region for Gemini, default `us-central1` |
| `GEMINI_MODEL` | Default `gemini-2.5-pro` |
| `EXTRACT_MAX_BYTES` | Largest accepted PDF, default 30 MiB |
| `EXTRACT_HEARTBEAT_SECONDS` | Heartbeat interval while a model call runs, default `15` |
| `EXTRACT_DEADLINE_SECONDS` | Time budget per request, default `840` |

LangSmith tracing is forced off. Logs carry document IDs, stages, codes and timings, never document text.

## Running it

```bash
docker compose up --build extractor        # as part of the local stack
uv run --locked maester-extractor          # or as a local process on :8790
```

Tests are offline and live in the repository's `tests/` folder (`test_extractor_service.py`, `test_extraction_*.py`); run them with `make test`.
