# Indexer: system description

This document describes `apps/indexer`, the Python service that reads the pages of a PDF and cuts them into chunks for search. It is for a developer who is new to this repository. For the full system, read the [Maester overview](maester.md). For the service that calls the indexer, read the [worker description](worker.md).

## Terms

| Term | Meaning |
| --- | --- |
| indexer | The Python HTTP service in `apps/indexer`. |
| worker | The TypeScript service in `apps/worker`. It sends requests to the indexer. |
| embedder | The service that turns text into vectors. It runs text-embeddings-inference in the `embedder` container. The indexer does not call it. |
| Docling | The library that reads the layout, the reading order, the headings and the tables of a PDF. |
| RapidOCR | The OCR engine that Docling uses on onnxruntime. OCR means optical character recognition. |
| range | A group of pages of one PDF, for example pages 21 to 40. One request reads one range. |
| read | The output of Docling for one range. It holds the document structure, the text of each page and the source of each item. |
| chunk | One piece of text for search. A chunk is on one page only. |
| text source | The origin of the text of a chunk: `text_layer`, `ocr` or `mixed`. |
| section path | The list of headings above a chunk. |
| event | One line of the NDJSON stream that the indexer returns. |
| secret | The value of `INDEXER_SECRET`. The worker sends it in the `x-indexer-secret` header. |
| model folder | The folder `/models` in the `models` volume. It holds the weights. |
| lock file | `apps/indexer/models.lock.json`. It records the commit of each model. |

## Function

The indexer reads financial documents in PDF format for the worker. It does two tasks:

- It reads a range of pages with Docling and RapidOCR, and cuts the pages into chunks.
- It cuts a read that the worker kept before into chunks again, and reads no page.

The indexer stores nothing. It has no access to the database or to object storage. The worker sends the PDF in the request body, writes the pages and the chunks to the database, and sends the chunks to the embedder. The indexer fetches no model while it runs.

## Parts

| Part | Location | Function |
| --- | --- | --- |
| HTTP app | `apps/indexer/src/maester_indexer/app.py` | Defines the routes, the secret comparison, the body limit and the event stream. |
| Settings | `apps/indexer/src/maester_indexer/settings.py` | Reads the configuration from environment variables. |
| Contracts | `apps/indexer/src/maester_indexer/contracts.py` | Defines the events, the read and the chunk request. |
| Reader | `apps/indexer/src/maester_indexer/reader.py` | Runs Docling on one range. |
| Sources | `apps/indexer/src/maester_indexer/sources.py` | Finds the text source of each item. |
| Chunker | `apps/indexer/src/maester_indexer/chunker.py` | Cuts the pages of a read into chunks. |
| Errors | `apps/indexer/src/maester_indexer/errors.py` | Defines `IndexingError`, which has a code, a message and a `retryable` value. |
| Entry point | `apps/indexer/src/maester_indexer/__main__.py` | Starts `uvicorn` on `PORT`. The command `maester-indexer` runs it. |
| Model fetch | `apps/indexer/src/maester_indexer/fetch_models.py` | The command `maester-indexer-fetch-models`. It gets the weights. |
| Versions | `apps/indexer/src/maester_indexer/versions.py` | Reads the versions of the Docling packages, the Docling artifacts in `models.lock.json`, the OCR engine and the chunker. |
| Lock file | `apps/indexer/models.lock.json` | Records the commit of each model. |
| Container | `apps/indexer/Dockerfile` | Builds the image `maester/indexer:local`. |

## Operation

### Routes

| Route | Function |
| --- | --- |
| `GET /healthz` | Returns status 200 when the indexer is ready. It needs no secret. |
| `GET /v1/versions` | Returns the versions of the indexer. |
| `POST /v1/index` | Reads one range of the PDF in the body and returns an event stream. |
| `POST /v1/chunk` | Cuts a read from the request body into chunks and returns an event stream. |

Each `/v1` route needs the header `x-indexer-secret`. If `INDEXER_SECRET` has no value, the indexer does not check the header.

### Request to `/v1/index`

1. The worker sends the PDF as the body, with the content type `application/pdf`.
2. The header `x-document-id` names the document.
3. The header `x-page-range` has the form `first-last`.
4. The header `x-section-path` holds the section path before the range, as JSON in base64url.
5. The header `x-ocr-pages-left` holds the number of pages that OCR can still read.
6. The header `x-embedding-model` names the model whose tokenizer counts the tokens.
7. The indexer reads the range in batches of `INDEX_PAGE_BATCH` pages.
8. The indexer sends the events while it reads.

### Events

| Event | Meaning |
| --- | --- |
| `started` | The versions, the page count of the PDF and the range. It is the first event. |
| `page` | The text of one page, its counts of items and its section path after the page. |
| `chunk` | One chunk, with its page, its position, its section path, its kind, its text source and its token count. |
| `progress` | A stage name and a percent. |
| `heartbeat` | No data. It keeps the connection open. |
| `result` | The read and the number of pages that OCR read. The read is empty for `/v1/chunk`. |
| `error` | A code, a `retryable` value and a message. The stream ends. |

### Chunks

1. The chunker cuts each page on its own, so a chunk never crosses a page.
2. A heading starts a chunk, and small parts under one heading join.
3. A table is always its own chunk. A table that is too large splits by rows, and each part starts with the header rows.
4. A chunk has at most `CHUNK_TOKENS` tokens (448) of the tokenizer of the embedding model.
5. The text that the embedder gets is the section path, one heading to a line, then the text of the chunk.

## States and errors

The indexer loads the tokenizer when the first request needs it, not at start. `GET /healthz` therefore sends status 200 also when the tokenizer is wrong or missing. A request then gets a `started` event and after it an `error` event.

### HTTP errors

These errors come before the stream. The body is `{ "detail": { "code": ... } }`.

| Status and code | Cause | Result |
| --- | --- | --- |
| 400 `BAD_REQUEST` | A header has no value or a wrong value, or the body of `/v1/chunk` does not agree with the schema. | The route does not run. |
| 400 `EMPTY_BODY` | The body has no bytes. | The route does not run. |
| 401 `INDEXER_UNAUTHORIZED` | The secret is not correct. | The route does not run. |
| 413 `TOO_LARGE_FOR_INDEX` | The body is larger than `INDEX_MAX_BYTES`. | The route does not run. |

### Error events

| Code | Retryable | Cause |
| --- | --- | --- |
| `INDEXER_MODEL_MISMATCH` | No | The header `x-embedding-model` is not `EMBEDDING_MODEL` (this is the first event). Or the tokenizer folder is not the model in `models.lock.json`. |
| `INDEXER_NOT_CONFIGURED` | No | `INDEX_TOKENIZER_PATH` has no value, or no tokenizer can be loaded from it. Or there is no `models.lock.json` in the tokenizer folder or above it: the models were not fetched, because the fetch command writes the lock last. Or the lock cannot be read. |
| `UNREADABLE_PDF` | No | Docling cannot open the PDF: it is encrypted, damaged or empty. |
| `INDEX_FAILED` | Yes | An unexpected error, or Docling ends the read with a bad status. The message has the type of the error only. |
| `INDEX_FAILED` | No | The first page of the range is after the last page of the file, or a check of the chunker finds that the items or the token counts are not correct. |

### Page reasons

A `page` event has `none_reason`. These values do not stop the stream.

| Value | Cause | Result |
| --- | --- | --- |
| `NO_TEXT` | The page is blank. | The page has no text. A revision with only this reason is still `complete`. |
| `OCR_FAILED` | OCR fails on a scanned page. | The page has no text. |
| `OCR_BUDGET` | `x-ocr-pages-left` is 0 for a scanned page. | The page has no text. |
| `PAGE_UNREADABLE` | Docling cannot read the page. | The page has no text. |

## Data

### Settings

The indexer reads these environment variables.

| Variable | Default | Function |
| --- | --- | --- |
| `PORT` | `8791` | The HTTP port. |
| `INDEXER_SECRET` | No default | The secret. |
| `INDEX_MAX_BYTES` | `52428800` (50 MiB) | The largest PDF that the indexer accepts. |
| `INDEX_THREADS` | `6` | The number of threads for Docling. |
| `INDEX_PAGE_BATCH` | `4` | The number of pages that Docling reads in one batch. A smaller value uses less memory. |
| `INDEX_TABLE_CELL_MATCHING` | `true` | `true` or `false`. It sets the cell matching of TableFormer. |
| `INDEX_TOKENIZER_PATH` | No default | The folder of the tokenizer of the embedding model. |
| `DOCLING_ARTIFACTS_PATH` | No default | The folder of the Docling and RapidOCR weights. |
| `OCR_ENGINE` | `rapidocr` | The only value is `rapidocr`. |
| `EMBEDDING_MODEL` | `Snowflake/snowflake-arctic-embed-l-v2.0` | The model whose tokenizer counts the tokens. |
| `HF_HUB_OFFLINE` | `1` in the image | If it is `1`, the libraries fetch no file from the network. |

### Pinned versions

`apps/indexer/pyproject.toml` pins Docling, docling-core, RapidOCR and onnxruntime to exact versions. `apps/indexer/uv.lock` pins all other packages. `versions.py` reads the versions from the installed packages, so the recorded versions agree with the lock. The Docling version (`doclingVersion`) has the versions of docling, docling-core, docling-ibm-models and docling-parse, and a hash of the `docling` section of `models.lock.json`, for example `docling=2.134.0;docling-core=2.103.0;docling-ibm-models=4.0.3;docling-parse=7.22.3;models=6a701a655efc`. The worker uses this value in the key of a cached page read. Thus, when one of these packages or one Docling artifact changes, the worker reads the pages again. The table of versions and the reason for each version are in the [README of the indexer](../../apps/indexer/README.md).

`models.lock.json` records the embedding model with a commit and the commit of each Docling artifact. RapidOCR gets its models at the tag that has the version of the `rapidocr` package.

### Weights

The service `models` fetches the weights once, into the volume `models`. The command is `maester-indexer-fetch-models --out /models`. It writes these folders:

- `/models/docling` holds the layout, TableFormer and RapidOCR weights.
- `/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0` holds the embedding model. Both the indexer and the embedder read it.
- `/models/models.lock.json` holds the lock file.

The option `--docling-only` fetches only the Docling weights. The CI workflow uses it. The services `indexer` and `embedder` mount the volume as read-only and set `HF_HUB_OFFLINE` to `1`.

### Log

The indexer writes log lines to standard error. A log line has no text from a document. It has no page text, no chunk text, no heading and no query. An error message has no such text.

## Procedures

### To fetch the weights

1. Build the image.

   ```bash
   docker compose build indexer
   ```

2. Run the `models` service one time.

   ```bash
   docker compose --profile setup run --rm models
   ```

### To run the tests without models

1. Go to the folder of the indexer.
2. Run the tests. The tests that need models do not run.

   ```bash
   cd apps/indexer
   uv run python -m unittest discover -s tests -v
   ```

### To run the tests with models

1. Fetch the Docling weights.

   ```bash
   cd apps/indexer
   uv run maester-indexer-fetch-models --out "$HOME/.cache/maester" --docling-only
   ```

2. Run the tests with the folder of the weights.

   ```bash
   MAESTER_DOCLING_MODELS="$HOME/.cache/maester/docling" uv run python -m unittest discover -s tests -v
   ```

### To run the indexer as a local process

1. Set the secret and the folders of the weights.
2. Start the indexer.

   ```bash
   cd apps/indexer
   INDEXER_SECRET=local-indexer-secret DOCLING_ARTIFACTS_PATH=/models/docling INDEX_TOKENIZER_PATH=/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0 uv run maester-indexer
   ```

## Warnings and cautions

CAUTION: Docling needs much memory. The container limit is 2304 MiB. If the container uses more, Docker stops it. Make `INDEX_PAGE_BATCH` smaller, or make the range smaller with `INDEX_PAGE_RANGE` in the worker.

## Limits

- The indexer reads one range for each request. It reads no whole PDF in one request.
- The indexer reads PDF files only. It does not read XBRL.
- RapidOCR is the only OCR engine.
- The indexer runs on the CPU only.

## Sources

- [apps/indexer/README.md](../../apps/indexer/README.md)
- [apps/indexer/models.lock.json](../../apps/indexer/models.lock.json)
- [apps/indexer/src/maester_indexer/settings.py](../../apps/indexer/src/maester_indexer/settings.py)
- [apps/indexer/src/maester_indexer/contracts.py](../../apps/indexer/src/maester_indexer/contracts.py)
- [apps/indexer/src/maester_indexer/app.py](../../apps/indexer/src/maester_indexer/app.py)
- [apps/indexer/src/maester_indexer/reader.py](../../apps/indexer/src/maester_indexer/reader.py)
- [apps/indexer/src/maester_indexer/fetch_models.py](../../apps/indexer/src/maester_indexer/fetch_models.py)
- [apps/indexer/Dockerfile](../../apps/indexer/Dockerfile)
- [apps/indexer/src/maester_indexer/chunker.py](../../apps/indexer/src/maester_indexer/chunker.py)
- [apps/worker/src/indexer.ts](../../apps/worker/src/indexer.ts)
- [docker-compose.yml](../../docker-compose.yml)
- [.github/workflows/indexer.yml](../../.github/workflows/indexer.yml)
