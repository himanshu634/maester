# Ingestion phase 2: the document index — Implementation Plan

Status: built (PR #13, branch `feat/ingestion-index`, commits `5e2fce8..aede6d2`). Tasks 1–12 are done and describe the code as built, except three open steps a review on 20 Oct 2026 found (Task 10 Step 6, Task 11 Step 6, Task 12 Step 6), which are not built. Task 13 (the live check and the backfill) is the investor's to run, from the main checkout after #13 merges; it does not wait for the open steps.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stored document gets a text index: its pages read by Docling (text layer and local OCR), split into passages that keep their page, embedded by a local model and stored in pgvector, so `searchChunks` and `GET /v1/workspaces/:ws/search` return the passages and pages that answer a question.

**Architecture:** Two new services. The **indexer** (Python, FastAPI, Docling pinned, RapidOCR on onnxruntime set explicitly) reads one page range per request and streams NDJSON pages and chunks; it also re-chunks a cached read. The **embedder** is text-embeddings-inference with no code of ours. The worker's `document.index` job (subject type `document_index`, limit 1) drives the ranges, writes pages and chunks per range and embeddings per batch, so a failure loses one range or one batch; Docling's reads are cached in `page_read`, so a retry or a rebuild never reads or OCRs a page twice. Search is hybrid: an HNSW cosine branch over `halfvec` and a `simple` full-text branch, fused by reciprocal rank.

**Tech Stack:** Python 3.12, FastAPI, Docling, docling-core's HybridChunker, RapidOCR on onnxruntime, uv; text-embeddings-inference `cpu-arm64-1.9` with `Snowflake/snowflake-arctic-embed-l-v2.0`; TypeScript, Drizzle and drizzle-kit, pgvector 0.8 on `pgvector/pgvector:pg16`, Hono, Zod, Vitest; Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §5, §8, §13, §15, §16 phase 2, §17 and §19. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §1 (pgvector, hybrid search), §2 (Docling, RapidOCR, chunking), §3 (the embedding model, TEI) and §6 (memory). Builds on the [phase 1 plan](2026-10-19-ingestion-phase-1-runner.md).

## As built

Where the build departed from this plan as first written. Each line gives the commit and why; the tasks below are corrected to match.

**Indexer (Python)**
1. **The root uv workspace excludes `apps/indexer`** (`[tool.uv.workspace] exclude = ["apps/indexer"]` in `pyproject.toml`), and `scripts/check_workspace.py` skips `.venv`. The exclusion keeps the nested project, Docling and torch out of the root workspace and lets `uv` run inside `apps/indexer` on its own lock. `c96f193`.
2. **Pins.** Docling 2.134.0, docling-core 2.103.0, rapidocr 3.9.2, onnxruntime 1.31.0; torch and torchvision come from the PyTorch CPU index on Linux. rapidocr 3.10.0 drops `PP_OCRV6_LANGS`, which Docling 2.134.0 imports. `models.lock.json` pins the embedding model at `ac6544c8…` and three Docling artefacts by revision (`docling-layout-heron`, `docling-layout-heron-onnx`, `docling-models`), which the fetch downloads at those revisions. Its fourth Docling entry, `RapidAI/RapidOCR` `v3.9.2`, is not a download pin: RapidOCR's weights follow the pinned `rapidocr` package, and the entry only records that version and feeds `models_hash`, so editing it changes the read-cache key, not what is fetched. `c96f193`, `51153e7`.
3. **The en dash is read as a hyphen.** docling-parse reads "2025–26" as "2025-26" at the character level. The probe records it (`test_the_text_layer_reader_writes_an_en_dash_as_a_hyphen`), and reader tests match the running header only up to the dash ("Annual report 2025"). `661801b`.
4. **Two small modules were added.** `errors.py` holds `IndexingError`. `lockfile.py` holds `shipped_lock()`, which looks in this order: `--lock`, `INDEXER_MODELS_LOCK`, `/app/models.lock.json`, then the lock beside `pyproject.toml`. The indexer also reads its own `EMBEDDING_MODEL` (`Settings.embedding_model`). That model is `versions.tokenizer`, and the model-mismatch check runs against it. Compose does not set it, so the default (the arctic model) applies. `fe64a2d`, `023856f`.
5. **One resident Docling pipeline.** `Reader` keeps one converter. A range that needs the other OCR setting drops the resident converter and its models before building the other. A read waits on the reader lock; if its client has gone by then, it is cancelled (`ReadCancelled`) without converting. Two pipelines did not fit the memory cap. `e28e1d6`, `7ee16f2`.
6. **`PAGE_UNREADABLE`** is a new page `noneReason`, in both runtimes and in `PageInput`. It covers a page Docling failed on or left out of a successful read. The read is kept, the revision is `partial`, and the read is not cached. A lost page must never read as a blank one. `e28e1d6`, `bc665e8`, `13d23e0`.
7. **What counts as a blank page.** `NO_TEXT` means Docling found no layout region and no image on the page. A picture-only page (a cover photo) reads `OCR_FAILED` with OCR on and `OCR_BUDGET` with OCR off, so many annual reports index as `partial`. Calling those pages `NO_TEXT` could hide a real OCR failure. `fe64a2d`, `eb4ce6a`.
8. **A paragraph over a page break** is one Docling item with a `prov` per page. It is cut by each `prov.charspan`, both in the page text and in the chunks, so no page repeats another's text. A table goes whole on its first page. `filter(page_nrs=…)` keeps every `prov` of an item it keeps. `fe64a2d`, `9206a4e`.
9. **The chunker runs HybridChunker's steps itself** (private: `_inner_chunker.chunk`, `_split_by_doc_items`, `_split_using_plain_text`, `_merge_chunks_with_matching_metadata`), so a table is never merged with its peers. Every table is its own chunk. An oversized table splits by rows, each part with the header repeated. Header rows over half the budget (`HEADER_SHARE = 2`) are read as body rows. An oversized caption goes out ahead of the table, cut to the budget. `merge_peers` and `repeat_table_header` therefore do nothing. `chunk_range` takes a docling-core `BaseTokenizer` that carries `max_tokens` (`CHUNK_TOKENS` 448 in production) instead of a raw tokenizer. `filter_document` maps the refs that `filter()` renumbers back to the read's own. `9206a4e`, `0d3de51`.
10. **A basis heading roots the section path.** Docling gives every PDF section header level 1, so a heading that names "consolidated" or "standalone" becomes the sticky root. Later headings nest under it as `[root, latest]` until another basis heading replaces it. Basis comes from that root. `f8a8805`.
11. **The embedded text fits 512 tokens by construction.** `fit_path` cuts the path to `PATH_TOKENS` and then further from the left, down to empty, until `contextualize(path, text)` plus the model's special tokens (`num_special_tokens_to_add`) fits. Only a text over the budget on its own raises `INDEX_FAILED`. `f8a8805`, `0d3de51`.
12. **Text source for an unrecorded item.** A chunk holding an item with text but no recorded source is `text_layer` with OCR off. With OCR on it is `mixed`, or `ocr` when every recorded source is OCR. `f8a8805`, `0d3de51`.
13. **Model fetch.** `fetch_models` uses Docling's `download_hf_model` at the lock's revisions for the three `DOCLING_REPOS`, plus `RapidOcrModel.download_models(backend="onnxruntime")` with no revision, not `docling-tools`. (Task 1's probe ran before this command existed, on `docling-tools`' download; the probe's docstring and the README's local test command still use it.) From the embedding repository it takes only `*.json`, `*.safetensors`, `sentencepiece.bpe.model`, `vocab.txt` and `merges.txt`, ignoring `onnx/*` and `openvino/*`: about 2.3 GB instead of 10.6 GB. It deletes the old lock first and writes the lock last. The Dockerfile installs `libgl1` and `libglib2.0-0` (OpenCV) and creates `/models` owned by `app`. `51153e7`, `7ee16f2`, `603a9c8`.
14. **`doclingVersion`**, which keys the page-read cache, is `docling=…;docling-core=…;docling-ibm-models=…;docling-parse=…;models=<12-hex hash of the lock's docling section>`. A change to any reader package or artefact reads the pages again. `023856f`.
15. **A missing `models.lock.json`** in or above `INDEX_TOKENIZER_PATH` is `INDEXER_NOT_CONFIGURED`, not a mismatch: the fetch writes the lock last, so a missing lock means the fetch did not finish. The tokenizer loads on the first request, and `/v1/index` loads it before reading, while sending heartbeats. `0c892e4`, `7ee16f2`.
16. **The service.** `create_app` takes `heartbeat_seconds` (default 15). A range starting past the last page is `INDEX_FAILED`, not retried. Unknown fields are refused on the wire in both runtimes. `51153e7`, `e6c0ec6`.

**Database, package, worker, API**
17. **Schema details.** The chunk key is `UNIQUE NULLS NOT DISTINCT (revision_id, page_number, seq)`, so a future XBRL chunk with no page is still unique. `writeRange` refuses a revision that is not `building` or belongs to another document. `insertEmbeddings` refuses a chunk outside the workspace. A revision is `partial` on `OCR_FAILED`, `OCR_BUDGET` or `PAGE_UNREADABLE`. `heading_text` is `sectionPath.join(" ")`, computed in `writeRange`. `documentsNeedingIndex` takes `documentIds?` for the backfill's `--document`. `dd33a69`, `bc665e8`.
18. **`IndexVersions` carries `tokenizer`, but no column stores it**, and `versionsMatch` in `startOrResumeRevision` does not compare it. The worker's `sameVersions` does compare it on every range (`INDEXER_VERSIONS_CHANGED`), and the job checks `versions.tokenizer === EMBEDDING_MODEL` before it starts. The same line also compares `embedder.model`, but that is the model string the worker gave its own `TeiEmbedder`, so that half can never fail: the worker never asks TEI which model it serves. A worker whose `EMBEDDING_MODEL` changes while TEI still serves the old `--model-id` would store the old model's vectors under the new label, stopped only by the 1024-dimension check on each answer. The fix is listed under "After this plan" for phase 3, which swaps models. `dd33a69`, `16880ac`.
19. **`TeiEmbedder` options:**
   - `timeoutMs` (default 60 000), `retries` (3), `backoffMs` (1000) and `retryOnTimeout` (true);
   - a timeout with `retryOnTimeout: false` throws `EMBEDDER_UNAVAILABLE`, retryable;
   - a 4xx other than 429 is `EMBEDDING_FAILED`, not retried;
   - a body cut off mid-read is retried;
   - the worker passes `EMBED_TIMEOUT_SECONDS × 1000` (default 300) with `retryOnTimeout: false`: TEI keeps working on a request the client gave up on, so a resend only queues behind it;
   - the API passes 30 s and 1 retry;
   - `EMBED_BATCH` is at most 32, the embedder's `--max-client-batch-size`.

   `a9bbfa1`, `8e3e8e5`, `3bfafc8`.
20. **Worker wiring** is in `server.ts` and `run.ts` (`WorkerDeps` gains `indexer` and `embedder`), not `start.ts`. `INDEXER_SECRET` is required whenever `INDEXER_URL` is set. The client adds `INDEXER_HTTP_<status>` (retried only for a 5xx). A stream cut mid-line is `INDEX_STREAM_INTERRUPTED`, and a versions body that is not JSON is `INDEXER_UNAVAILABLE`. `92568ad`, `be9344a`.
   The backfill CLI runs on the host (`tsx --env-file=../../.env`), not in the worker container: the image's bundle has only `server.ts`.
21. **`document.index` hardening:**
   - it strips U+0000 from page text, chunk text, paths and the cached read, because Postgres refuses it;
   - it does not cache a read made with OCR off or one holding a `PAGE_UNREADABLE` page;
   - cache keys use the fixed range bounds clamped to the page count;
   - an answer whose pages are not exactly the range asked for fails `INVALID_INDEXER_RESULT`, not retried;
   - the job deadline covers embedding, which runs after every range;
   - a database error keeps only its SQLSTATE or the query's own code, because drizzle's message lists the parameters;
   - a revision already complete for the job returns its summary without asking the indexer.

   `16880ac`, `adc51b8`.
22. **Checking the page count.** The worker assumes a page count from the revision or from the newest cached read of the file, then checks it against `started.pageCount` on every range. Before any page is stored, the indexer's count is trusted once, and a range cut short is read again. After a page is stored, a different count fails `INVALID_INDEXER_RESULT`. `51cffe9`.
23. **The search branches:**
   - **Unfiltered branch:** scans `chunk_embedding` alone, testing the revision in a correlated scalar subquery the planner cannot pull up, so the HNSW index serves the order. An answer shorter than 50 is redone with the exact scan.
   - **API logging:** a `DrizzleQueryError` is logged by name and SQLSTATE only, never by message.
   - **Contracts:** `SearchHit` and `SearchResults` live in `packages/contracts/src/search.ts`, and `SEARCH_UNAVAILABLE` is in the contracts' `ErrorCode`.
   - **Plan test:** prices out sorting, so a few dozen rows cannot make the planner prefer a sorted scan.

   `d67d27d`, `6753aa0`, `aede6d2`.
24. **No search query reaches a log line:** nginx's API proxy has `access_log off`. `33ba436`.
25. **The backfill requeues only a job that is still `failed` or `succeeded`**, so a job claimed since it was read keeps its lease. It counts a job as created only when it inserted it, and counts current documents by id. On a database failure it exits 1 with one line. `dbbb3a0`.

**Compose and CI**
26. **`restart: unless-stopped` on the indexer and the embedder.** The memory caps are not measured, and an OOM kill must not leave a service down while a backfill uses up every job's attempts. Both healthchecks have `start_period: 120s`. `df79e11`, `a51766c`.
27. **Four `mem_limit`s, not seven**: postgres 1g, embedder 2560m, indexer 2304m, web 96m. The worker, the extractor and the API stay uncapped until measured. Task 13 can cap the API from an index run; the worker and the extractor stay uncapped until one extraction is measured. `212360a`.
28. **CI.** The Docling model cache is keyed on `apps/indexer/uv.lock` and `apps/indexer/models.lock.json`. `indexer.yml` runs on a push to `main` and on a pull request into any branch (as `ts.yml` does), and pins two of its three actions by commit: `actions/cache` is pinned only by its `v4` tag (Task 12 Step 6). CI's Postgres has been `pgvector/pgvector:pg16` since phase 1 (`81c8c5e`). The investor's local `maester-postgres-1` is still `postgres:16` and must be recreated (Task 13, Step 2). On 20 Oct 2026 its image ships glibc 2.41 (Debian 13), while `pgvector/pgvector:pg16` ships glibc 2.36 (Debian 12), so Step 2 checks the C library and the collation versions before and after. `83a81e6`.
29. **Task 13 was not run in the build.** It needs the investor's machine, the pgvector Postgres and their go-ahead; it is rewritten below as their runbook.

## Where this plan departs from the spec, and why

1. **The query is embedded by the embedder, not the indexer.** §8.5 step 1 says "through the indexer"; §5 and §8.4 say the API posts one query to the embedder. The embedder is right: the indexer has no model loaded.
2. **The worker drives the page ranges.** §8.1 has the indexer read in ranges inside one request. Here the worker sends one `/v1/index` request per range (`INDEX_PAGE_RANGE`, default 20, is a worker setting). Resuming at the first missing range, checking the cache per range, the OCR budget and the per-range deadline all live in one place, and each range's pages and chunks land in one transaction. The cost is sending the PDF once per range over the compose network.
3. **A cache hit re-chunks through `/v1/chunk`.** The chunker needs Docling's document structure and the embedding model's tokenizer, both in Python. `page_read` stores Docling's document JSON per range; `/v1/chunk` takes it back and streams the same events as `/v1/index`, with no reading.
4. **The other revisions are deleted when one completes.** "A document's current index is its newest revision per embedding model" (§13). When a revision completes, the document's other revisions for the model (an older complete one, or another job's building one) are deleted in the same transaction, and a partial unique index allows one complete or partial revision per document and model. Older embeddings would otherwise stay in the HNSW graph and cost recall on every query. A job whose building revision was deleted this way fails where it stands, and every case is retried, so its next attempt starts a new revision:
   - in `writeRange`: `INDEX_REVISION_NOT_FOUND`;
   - in `insertEmbeddings`: `CHUNK_NOT_IN_WORKSPACE`, because the chunks went with the revision;
   - in its own `completeRevision`: a plain `Error`, stored as `HANDLER_ERROR` with the message `INDEX_REVISION_NOT_FOUND`.

   Index revisions carry no figure; nothing audits them.
5. **Boilerplate is what Docling labels furniture.** §8.3 says running headers and footers "repeated on most pages" are dropped from chunks. Docling's layout model labels them `page_header` and `page_footer` (the furniture layer), and HybridChunker leaves furniture out; no count across pages is added. The page text keeps them.

## Not in this phase

- **Claude OCR** (`OCR_ENGINE=claude`): paid, so not built. `OCR_ENGINE` accepts `rapidocr` only; phase 3 adds `tesseract` for the spot check.
- **XBRL text blocks** (§8.1): phase 4, when XML is accepted. The `text_source` value `xbrl` and the nullable `element` column land now so phase 4 adds no migration for them.
- **The `pipeline` object** (§11) and the screen: phases 4 and 6.
- **The other §13 rows** (`document.format`, `intake_state` `waiting_for_xbrl`, `span`, `period_start`, `extraction_revision.source`, `xbrl_source`, `check_type` `xbrl_in_pdf`, `classification_evidence` columns): phase 4. `job.run_after` is phase 1's.
- **The chunk's unit.** §13 lists "basis and unit where the section states them". Basis comes from the heading path (Task 4). A unit read from section text would be a reader of what a page means; no rule is written for it here, and the column is not added until one is.
- **Choosing the model and the OCR engine**: phase 3. Phase 2 runs the defaults.

## Global Constraints

- **Branching.** Built on `feat/ingestion-index` from `staging` after phase 1 merged (PR #12); PR #13 into `staging`. The migration is `packages/db/drizzle/0007_document_index.sql`; the next free number is 0008.
- **No paid API calls.** Tests use fakes (a fake indexer client, a fake `/embed` server, a whitespace tokenizer built in code) or the free local Docling and RapidOCR models. No test, live check or default path calls Gemini, Claude or any hosted embedding API.
- **No `docker compose up` in a worktree** (the compose project name is shared with the investor's running stack). Database tests use a Postgres on `localhost:5433` that must be a pgvector image (phase 1). CI's is `pgvector/pgvector:pg16`; the investor's `maester-postgres-1` was still `postgres:16` at the end of the build, and Task 13 Step 2 recreates it on a pgvector image with the same C library. In a worktree, compose files are checked with `docker compose config` only. The live check (Task 13) runs from the main checkout after merge, with the investor's go-ahead.
- **The indexer is its own uv project**, not a member of the root uv workspace: Docling needs torch, which would slow every Python CI run and may have no wheel for the 3.14 matrix entry. `apps/indexer` has its own `pyproject.toml` and `uv.lock`, `requires-python = ">=3.12,<3.13"`, torch from the PyTorch CPU index on Linux, and its own CI job. `scripts/check_workspace.py` still parses its `.py` files and Markdown links.
- **Pinned, never automatic.** Docling, docling-core, RapidOCR and onnxruntime are pinned to exact versions in `apps/indexer/pyproject.toml`; the OCR engine is `RapidOcrOptions` on onnxruntime, never Docling's automatic choice; the TEI image is `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`; the embedding model is pinned to a commit revision. Task 1 records the versions and the revision as resolved on 20 Oct 2026 (Docling 2.134.0, docling-core 2.103.0, rapidocr 3.9.2, onnxruntime 1.31.0, model revision `ac6544c8a46e00af67e330e85a9028c66b8cfd9a`); none is written from memory, and moving any of them is a change of its own that runs the probe again. They are recorded in `apps/indexer/README.md` and `apps/indexer/models.lock.json`.
- **Nothing is fetched at run time.** Weights (Docling's layout, TableFormer and RapidOCR models; the embedding model with its tokenizer) are fetched once into the `models` volume by `docker compose --profile setup run --rm models`; the indexer and the embedder run with `HF_HUB_OFFLINE=1`. The fetch takes the embedding model's safetensors, configuration and tokenizer files only (no `onnx/*`, no `openvino/*`).
- **The embedding model.** `EMBEDDING_MODEL` default `Snowflake/snowflake-arctic-embed-l-v2.0`, 1024 dimensions, `query: ` before a query and nothing before a document. The prefix is added by one TypeScript function used by the worker and the API (Task 7).
- **The text that is embedded** is `contextualize(sectionPath, text)`: the section path's entries joined by `"\n"`, then `"\n"`, then the chunk text; just the text when the path is empty. It is defined in both runtimes and both are tested against one fixture (`packages/contracts/fixtures/index/contextualize.json`). At most 512 tokens of the model's own tokenizer.
- **Settings and defaults.**
  - **Worker:**
    - `INDEXER_URL`, `INDEXER_SECRET` (required when `INDEXER_URL` is set), `EMBEDDER_URL`;
    - `EMBEDDING_MODEL` (must be a key of `EMBEDDING_MODELS`);
    - `INDEX_PAGE_RANGE` 20, `INDEX_TIMEOUT_SECONDS` 7200 (the whole job, embedding included);
    - `EMBED_BATCH` 16 (at most 32), `EMBED_TIMEOUT_SECONDS` 300 (one embed call; not resent within the attempt);
    - `OCR_PAGE_BUDGET` 400 (0 turns OCR off).
  - **API:** `EMBEDDER_URL`, `EMBEDDING_MODEL`; query embeds wait 30 s with 1 retry.
  - **Indexer:**
    - `INDEXER_SECRET`, `INDEX_MAX_BYTES` 52428800, `INDEX_THREADS` 6, `INDEX_PAGE_BATCH` 4, `INDEX_TABLE_CELL_MATCHING` true;
    - `INDEX_TOKENIZER_PATH`, `DOCLING_ARTIFACTS_PATH`, `OCR_ENGINE` `rapidocr`;
    - `EMBEDDING_MODEL` (default the arctic model; it is `versions.tokenizer` and what `x-embedding-model` must equal);
    - `INDEXER_MODELS_LOCK` (optional path to the shipped `models.lock.json`);
    - `PORT` 8791.
- **Job.** Type `document.index`, subject type `document_index`, subject id the document id, `pipelineVersion` `${INDEX_PIPELINE_VERSION}:${EMBEDDING_MODEL}` with `INDEX_PIPELINE_VERSION = "1"` in `@maester/document-index`. Limit 1 in `DEFAULT_CONCURRENCY`. Attempts: the default 5 (no paid call).
- **Workspace.** Every new table has `workspace_id`; every query filters on it. A duplicate document gets no index.
- **No document text in logs**, errors or traces: page and chunk text, headings and queries never appear in a log line or an error message (`CLAUDE.md`). Log ids, counts, codes, versions and seconds.
- **Readers stay as they are.** `PdfDocument`, Gemini extraction, the correction guard, the classifier's quote check, reader B and every check are untouched; OCR text feeds the index only (§8.2). That is why this phase changes no figure and ships no evaluation run; measuring the index is phase 3.
- **Errors.**
  - **From §15:**
    - `INDEXER_NOT_CONFIGURED`, not retried: no indexer or embedder URL, no tokenizer path, or no `models.lock.json` above it;
    - `UNREADABLE_PDF`, not retried;
    - `OCR_FAILED` and `OCR_BUDGET`: a page's `none_reason` and a revision warning, making the revision `partial`;
    - `EMBEDDING_FAILED`: retried, and the revision stays `building`;
    - `SEARCH_UNAVAILABLE`: 503.
  - **Added in this phase:**
    - `PAGE_UNREADABLE`: a page `none_reason` and a warning that makes the revision `partial`;
    - `INDEXER_UNAVAILABLE`, retried;
    - `INDEXER_UNAUTHORIZED`, not retried (the indexer's 401 or a 403);
    - `INDEXER_HTTP_<status>`, retried only for a 5xx. The indexer's own HTTP refusals, 400 `BAD_REQUEST`, 400 `EMPTY_BODY` and 413 `TOO_LARGE_FOR_INDEX`, reach the job under this name (`INDEXER_HTTP_400`, `INDEXER_HTTP_413`), not retried, because the client does not read the body;
    - `INDEXER_MODEL_MISMATCH`, not retried: the indexer's tokenizer is not `EMBEDDING_MODEL`'s, or the indexer was asked for another model. The embedder's model is not checked; only the dimensions of its vectors are (As built 18);
    - `INDEXER_VERSIONS_CHANGED`, retried; the next attempt replaces the revision;
    - `INVALID_INDEXER_RESULT`, not retried;
    - `INDEX_STREAM_INTERRUPTED`, retried;
    - `INDEX_TIMEOUT`, retried;
    - `INDEX_FAILED`: retried for an unexpected error and for a Docling status that is not success; not retried for a range past the end, a chunk over the budget, or an item lost or changed by filtering. The job row shows the code and the range only, so the two kinds look alike there;
    - the index queries' own codes `INDEX_REVISION_NOT_FOUND`, `REVISION_DOCUMENT_MISMATCH`, `REVISION_NOT_BUILDING` and `CHUNK_NOT_IN_WORKSPACE`, retried (Task 9);
    - `HANDLER_ERROR`, the runner's code for an error that is not a `JobFailure` (`apps/worker/src/run.ts`), retried: a database write that failed without a query code (message "… failed (SQLSTATE …)"), or a failure in an unwrapped query (Task 9);
    - the job's `INVALID_STATE` and `OBJECT_MISSING`, not retried;
    - `EMBEDDER_UNAVAILABLE`: an `EmbedderError` code, which reaches the job as `EMBEDDING_FAILED`.
- `docs/systems/*.md` are written in ASD-STE100 Simplified Technical English (the `writing-ste` skill).

## Review Focus

1. **A worker dies in the middle of a long index job.** The sweeper requeues it; the next attempt resumes the same `building` revision at the first range with no pages, writes no duplicate page, chunk or embedding, and embeds only the chunks that have none. Task 9.
2. **A rebuild is still building.** Search keeps returning the older complete revision until the new one completes; then the swap is one transaction, so the database never holds both or neither as current. Tasks 6 and 9. Search itself does not yet read one snapshot: `searchChunks` runs the vector branch, the keyword branch and the hit load as separate statements under read committed, so a swap committed between them can return one short or empty answer (R1's ids are found, then gone at the load). Task 10 Step 6 (open) makes it one snapshot and adds the interleaving test; until then this line claims the database-level swap only.
3. **The embedder is down.** During a job: `EMBEDDING_FAILED`, retried with backoff, the revision stays `building`, pages are not read again. During a search: 503 `SEARCH_UNAVAILABLE`, never a 500 and never keyword-only results presented as hybrid. Tasks 9 and 10.
4. **A heading on page 19 governs text on page 21**, across a range boundary and across a resume. The section path is carried from the last stored page; a consolidated section's text never shares a chunk or a path with the standalone one. Tasks 4 and 9.
5. **A long scanned filing** (more than `OCR_PAGE_BUDGET` pages needing OCR). Pages past the budget are stored with `none_reason = 'OCR_BUDGET'`, the revision is `partial` with the warning, and its text-layer pages are searchable. Tasks 3 and 9 pin the partial revision; the search half is correct in the code (`scope()` in `search.ts` takes `'partial'`) but no test searches a partial revision yet: Task 10 Step 6 (open) adds it, so Tasks 3, 9 and 10 own this line.

---

### Task 1: The indexer project, pinned, and a probe of Docling's interfaces

**Files:**
- Create: `apps/indexer/pyproject.toml`, `apps/indexer/uv.lock`, `apps/indexer/.python-version` (`3.12`), `apps/indexer/README.md`, `apps/indexer/LICENSE` (copy of `apps/extractor/LICENSE`), `apps/indexer/models.lock.json`
- Create: `apps/indexer/src/maester_indexer/__init__.py`, `apps/indexer/src/maester_indexer/versions.py`
- Create: `apps/indexer/tests/fixtures/make_fixtures.py`, `apps/indexer/tests/fixtures/{text-layer,scanned,mixed,two-sections}.pdf`
- Create: `apps/indexer/tests/test_probe.py`, `apps/indexer/tests/test_versions.py`, `apps/indexer/tests/helpers.py`
- Modify: `.gitignore` (`apps/indexer/.venv`), root `pyproject.toml` (`[tool.uv.workspace] exclude = ["apps/indexer"]`), `scripts/check_workspace.py` (`IGNORED_PARTS` gains `.venv`)
- Later (`023856f`): `apps/indexer/src/maester_indexer/lockfile.py`

**Interfaces:**
- Produces:
  - `versions.py`, read from installed package metadata (`importlib.metadata.version`) and the shipped lock, so they cannot drift:
    - `READER_PACKAGES = ("docling", "docling-core", "docling-ibm-models", "docling-parse")`;
    - `models_hash(lock) -> str`: the first 12 hex characters of the SHA-256 of the lock's `docling` section as canonical JSON. Key order and the `embedding` section do not change it; a lock with no `docling` section raises;
    - `reader_version(lock_path) -> str`: `"docling=2.134.0;docling-core=2.103.0;docling-ibm-models=<v>;docling-parse=<v>;models=<hash>"`; no lock raises;
    - `DOCLING_VERSION = reader_version(shipped_lock())`, `OCR_ENGINE = "rapidocr-onnxruntime 3.9.2"`, `CHUNKER_VERSION = "1"`;
    - `reader_options(settings) -> str`, giving `"table=accurate;cell_matching=true;ocr=rapidocr"`.
  - `lockfile.py`: `LOCK_FILE = "models.lock.json"`; `shipped_lock(explicit=None) -> Path | None`, which tries `explicit`, then `INDEXER_MODELS_LOCK`, then `/app/models.lock.json`, then the lock beside `pyproject.toml`.
  - Fixture PDFs, 1–3 pages each, made by `make_fixtures.py` (reportlab and Pillow, dev dependencies): `text-layer.pdf` (a heading, prose and a 4-column table of right-aligned Indian-format numbers); `scanned.pdf` (the same page rasterized at 200 dpi, no text layer); `mixed.pdf` (a text-layer heading, then under it a short text-layer paragraph and an image of a short printed paragraph, small enough for HybridChunker to merge into one chunk); `two-sections.pdf` (3 pages: "Standalone balance sheet" on page 1, its notes continuing onto page 2 with no new heading, "Consolidated balance sheet" on page 3, and a running header "Synthetic Cements Limited · Annual report 2025–26" on every page).
  - `models.lock.json` as built: `{ "embedding": { "id": "Snowflake/snowflake-arctic-embed-l-v2.0", "revision": "ac6544c8a46e00af67e330e85a9028c66b8cfd9a" }, "docling": { "docling-project/docling-layout-heron": "8f39ad3c…", "docling-project/docling-layout-heron-onnx": "40bde044…", "docling-project/docling-models": "fc0f2d45…", "RapidAI/RapidOCR": "v3.9.2" } }`. The three `docling-project` entries are download revisions (Task 5's fetch). `RapidAI/RapidOCR` only records the pinned `rapidocr` version and keys the read cache through `models_hash`; RapidOCR's weights are fetched with no revision and follow the package.
  - Pins as built: `docling==2.134.0`, `docling-core==2.103.0`, `rapidocr==3.9.2` (3.10.0 drops `PP_OCRV6_LANGS`, which Docling 2.134.0 imports), `onnxruntime==1.31.0`, plus `torch` and `torchvision` (CPU index on Linux).

- [x] **Step 1: Write the pins.** These were resolved on 20 Oct 2026 with `uv lock` on Python 3.12 (macOS arm64 and Linux aarch64 and x86_64); write them as they are, not a newer release: a newer Docling is a pin change of its own that runs this probe again. Dependencies: `docling==2.134.0`, `docling-core==2.103.0`, `rapidocr==3.9.2` (not 3.10.0, which drops `PP_OCRV6_LANGS`), `onnxruntime==1.31.0`, `fastapi>=0.120`, `uvicorn>=0.30`, `pydantic>=2.8`; dev group `httpx`, `reportlab`, `pillow`. Configure torch from `https://download.pytorch.org/whl/cpu` for Linux (`[[tool.uv.index]] name = "pytorch-cpu", explicit = true` and a `[tool.uv.sources] torch` entry with a `sys_platform == 'linux'` marker). The embedding model's revision is `ac6544c8a46e00af67e330e85a9028c66b8cfd9a` in `models.lock.json`.
- [x] **Step 2: Write the probe tests** in `tests/test_probe.py`, skipped unless `MAESTER_DOCLING_MODELS` names a folder with Docling's artifacts. Task 5's lock-pinned fetch command does not exist yet, so the probe's models come from Docling's own `docling-tools models download layout tableformer rapidocr -o "$MAESTER_DOCLING_MODELS"` (the probe's docstring and the README's local test command say the same). From Task 5 on, CI and the image fetch with `maester-indexer-fetch-models` at the lock's revisions, and CI runs this same probe against those models. Each test asserts a fact the later tasks depend on, against the pinned version:

```python
def test_page_range_reads_only_those_pages(self):
    doc = convert(FIXTURES / "two-sections.pdf", page_range=(2, 3)).document
    self.assertEqual({p.page_no for item, _ in doc.iterate_items() for p in item.prov}, {2, 3})

def test_ocr_cells_are_marked_and_land_on_the_scanned_page(self):
    res = convert(FIXTURES / "scanned.pdf")
    self.assertTrue(any(c.from_ocr for c in cells_of(res, page_no=1)))

def test_text_layer_cells_are_not_marked_ocr(self):
    res = convert(FIXTURES / "text-layer.pdf")
    self.assertFalse(any(c.from_ocr for c in cells_of(res, page_no=1)))

def test_mixed_page_has_both(self):
    flags = {c.from_ocr for c in cells_of(convert(FIXTURES / "mixed.pdf"), page_no=1)}
    self.assertEqual(flags, {True, False})

def test_running_header_is_furniture(self):
    doc = convert(FIXTURES / "two-sections.pdf").document
    self.assertIn("page_header", {i.label.value for i, _ in doc.iterate_items(included_content_layers={ContentLayer.FURNITURE})})

def test_the_text_layer_reader_writes_an_en_dash_as_a_hyphen(self):
    headers = {i.text for i, _ in convert(FIXTURES / "two-sections.pdf").document.iterate_items(included_content_layers={ContentLayer.FURNITURE})}
    self.assertEqual(headers, {"Synthetic Cements Limited · Annual report 2025-26"})

def test_hybrid_chunker_takes_the_options_we_use(self):
    chunker = HybridChunker(tokenizer=whitespace_tokenizer(448), merge_peers=True, repeat_table_header=True)
    self.assertEqual(chunker.tokenizer.get_max_tokens(), 448)

def test_a_page_can_be_filtered_out_of_a_document(self):
    # as built: filter keeps every item with a prov on the page, with all of its provs
    kept = list(convert(FIXTURES / "two-sections.pdf").document.filter(page_nrs={2}).iterate_items(included_content_layers=set(ContentLayer)))
    self.assertTrue(all(2 in {p.page_no for p in item.prov} for item, _ in kept))
    self.assertEqual({p.page_no for item, _ in kept for p in item.prov}, {1, 2})

def test_a_paragraph_continued_over_a_page_break_is_one_item_cut_by_charspan(self):
    # exactly one item spans pages 1 and 2; its two charspans cover item.text, page 1's part starts "Note 3.",
    # page 2's starts "which is worked out"
```

`convert` builds a `DocumentConverter` with `PdfPipelineOptions(do_ocr=True, ocr_options=RapidOcrOptions(backend="onnxruntime"), do_table_structure=True, table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE), artifacts_path=MAESTER_DOCLING_MODELS, document_timeout=None, accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU), generate_parsed_pages=True)`. `test_versions.py` (no models) checks `models_hash` (12 hex characters; changes with any artefact; ignores key order, spacing and the embedding section; refuses a lock with no `docling` section), `reader_version` (names each reader package; a changed lock alone changes it; no lock raises) and `reader_options`. `cells_of(res, page_no)` returns the text cells Docling kept for a page (`res.pages[i].cells`, kept only with `generate_parsed_pages=True`). `whitespace_tokenizer(max_tokens)` lives in `tests/helpers.py`: a `tokenizers` WordLevel model with a whitespace pre-tokenizer, wrapped in `PreTrainedTokenizerFast` and docling-core's `HuggingFaceTokenizer`.

- [x] **Step 3: Run the probe** — fetch the models first with `cd apps/indexer && uv run docling-tools models download layout tableformer rapidocr -o "$HOME/.cache/maester/docling"` (online, once), then `HF_HUB_OFFLINE=1 MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest tests.test_probe tests.test_versions -v`. Expected: PASS. Where a name differs in the pinned version (an option, `from_ocr`, `filter`, `repeat_table_header`), change the test to the pinned version's name and record it in the README's "Docling interfaces this service relies on" list. If OCR provenance per cell is not available at all, stop and report: Task 3's `text_source` needs another source and the spec's §8.2 rule 1 needs a decision.
- [x] **Step 4: Commit**

```bash
git add apps/indexer .gitignore pyproject.toml scripts/check_workspace.py
git commit -m "feat(indexer): pinned Docling and RapidOCR project, fixture PDFs, probe of the interfaces we rely on"
```

---

### Task 2: The wire contract, in both runtimes

**Files:**
- Create: `packages/contracts/src/document-index.ts`; Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/job.ts`. All objects are `z.strictObject` (unknown fields refused, as Pydantic's `extra="forbid"`; `e6c0ec6`).
- Create: `packages/contracts/fixtures/index/{stream-range.ndjson,stream-error.ndjson,chunk-request.json,contextualize.json}`
- Create: `apps/indexer/src/maester_indexer/contracts.py`
- Test: `packages/contracts/test/index-fixtures.test.ts`, `apps/indexer/tests/test_contracts.py`

**Interfaces:**
- Produces (camelCase on the wire, as the extractor's events):
  - `JobTypes.DOCUMENT_INDEX = "document.index"`; `DOCUMENT_INDEX_SUBJECT = "document_index"`.
  - `TextSource = "text_layer" | "ocr" | "mixed" | "xbrl"`; `ChunkKind = "prose" | "table"`; `PageNoneReason = "NO_TEXT" | "OCR_FAILED" | "OCR_BUDGET" | "PAGE_UNREADABLE"` (`PAGE_UNREADABLE` added in `e28e1d6`: Docling could not read the page).
  - `IndexerVersions { doclingVersion, ocrEngine, readerOptions, chunkerVersion, tokenizer }` (all strings; `tokenizer` is the model id whose tokenizer the indexer loaded).
  - `IndexerEvent`, a discriminated union on `type`:
    - `started { versions: IndexerVersions; pageCount: int; firstPage: int; lastPage: int }`
    - `page { pageNumber: int; text: string; itemsTextLayer: int; itemsOcr: int; noneReason: PageNoneReason | null; sectionPathAfter: string[] }`
    - `chunk { pageNumber: int; seq: int; kind: ChunkKind; textSource: TextSource; sectionPath: string[]; basis: "consolidated" | "standalone" | null; text: string; tokenCount: int }`
    - `progress { stage: string; percent: number }`, `heartbeat {}`
    - `result { read: RangeRead | null; ocrPages: int }` (`read` null from `/v1/chunk`)
    - `error { code: string; retryable: boolean; message: string }`
  - `RangePage` (the page fields without `type` and `sectionPathAfter`) and `RangeRead { firstPage: int; lastPage: int; pageCount: int /* the whole PDF's */; ocrOn: boolean; versions: IndexerVersions; document: Record<string, unknown> /* Docling's export_to_dict */; itemSources: Record<string, TextSource> /* by item self_ref */; pages: RangePage[] }`.
  - `ChunkRequest { read: RangeRead; sectionPathBefore: string[]; embeddingModel: string }`.
  - `contextualize(sectionPath: string[], text: string): string` exported from `@maester/contracts` (Global Constraints' rule).
  - Pydantic twins in `contracts.py` on a `WireModel` base (`alias_generator=to_camel`, `populate_by_name=True`, `extra="forbid"`) with `to_wire()` / `from_wire()`: `IndexerVersions`, `RangePage`, `RangeRead`, `ChunkRequest`, `StartedEvent`, `PageEvent`, `ChunkEvent`, `ProgressEvent`, `HeartbeatEvent`, `ResultEvent`, `ErrorEvent`, the `IndexerEvent` union and `INDEXER_EVENT = TypeAdapter(IndexerEvent)`; and `contextualize(section_path, text)`.

- [x] **Step 1: Write the fixtures and failing tests.** `stream-range.ndjson`: `started` (pages 1–3 of 3), three `page` lines (page 2 a scanned page with `itemsOcr > 0`), four `chunk` lines (one `table`, one `ocr`, one `mixed`, one carrying a path from page 1 on page 2), a `heartbeat`, a `progress`, and `result` with a small `read`. `contextualize.json`: `[{ sectionPath, text, expected }]` with an empty path, one entry and three entries, and a text holding `₹` and a newline. Zod test: every line of both streams parses as `IndexerEvent`; `chunk-request.json` parses as `ChunkRequest`; `contextualize` gives every `expected`; an `IndexerEvent` with `textSource: "scan"` and a `page` with `pageNumber: 0` are refused. Python test: the same files through `from_wire`, then `to_wire` equals the input line, and `contextualize` gives every `expected`.
- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/contracts exec vitest run test/index-fixtures.test.ts` and `cd apps/indexer && uv run python -m unittest tests.test_contracts -v` — FAIL (no module).
- [x] **Step 3: Implement** both schema files and both `contextualize` functions. Page numbers are 1-based, `int >= 1`; `seq` is `int >= 0`.
- [x] **Step 4: Run to see them pass** — same commands — PASS.
- [x] **Step 5: Commit**

```bash
git add packages/contracts apps/indexer/src/maester_indexer/contracts.py apps/indexer/tests/test_contracts.py
git commit -m "feat(contracts): the indexer's NDJSON events, the cached range read and contextualize, in Zod and Pydantic"
```

---

### Task 3: Reading a page range

**Files:**
- Create: `apps/indexer/src/maester_indexer/reader.py`, `apps/indexer/src/maester_indexer/settings.py`, `apps/indexer/src/maester_indexer/sources.py`, `apps/indexer/src/maester_indexer/errors.py`
- Test: `apps/indexer/tests/test_reader.py` (gated on `MAESTER_DOCLING_MODELS`, except the page count, unreadable, range, cancel, resident-pipeline, failed-page and no-text-in-errors tests, which use fakes), `apps/indexer/tests/test_sources.py`, `apps/indexer/tests/test_settings.py` (no models)

**Interfaces:**
- Consumes: `RangeRead`, `TextSource`, `PageNoneReason` (Task 2); `versions.py` (Task 1).
- Produces:
  - `@dataclass(frozen=True) Settings` with fields `secret`, `max_bytes`, `threads`, `page_batch`, `table_cell_matching`, `tokenizer_path`, `artifacts_path`, `ocr_engine`, `embedding_model`.
    - `Settings.from_env(env) -> Settings` reads the indexer settings of Global Constraints.
    - An empty value means unset.
    - A count below 1 raises `ValueError`.
    - A switch takes only `true` or `false`.
    - `OCR_ENGINE` must be in `OCR_ENGINES = ("rapidocr",)`.
  - `IndexingError(code, message, retryable)` in `errors.py`; its message never holds document text.
  - `class Reader`:
    - `__init__(settings)` sets `docling_settings.perf.page_batch_size = settings.page_batch` and exposes `reader.versions: IndexerVersions` (`tokenizer = settings.embedding_model`).
    - It keeps **one resident** `DocumentConverter`, as `(ocr_on, converter)`. When a range needs the other OCR setting, it clears the resident converter's `initialized_pipelines`, runs `gc.collect()`, then builds the other.
    - The options are the probe's, plus `do_cell_matching = settings.table_cell_matching`, `num_threads = settings.threads`, `generate_parsed_pages=True` and `ocr_batch_size`, `layout_batch_size` and `table_batch_size` all set to `settings.page_batch`.
    - One read runs at a time, under `Reader._lock`.
  - `Reader.page_count(pdf: bytes) -> int`, through pypdfium2 under Docling's `pypdfium2_lock`. An empty, encrypted or damaged file raises `UNREADABLE_PDF`.
  - `Reader.read_range(pdf: bytes, first: int, last: int, ocr_pages_left: int, cancel: threading.Event) -> RangeRead` converts pages `first..last`, clamped to the page count.
    - OCR is on for the whole range while `ocr_pages_left > 0` and off otherwise; `ocrOn` records which. The budget is checked per range, so a document can go up to `INDEX_PAGE_RANGE − 1` OCR pages over it.
    - `cancel` is checked before the conversion, again under the lock before Docling starts (a queued read whose client has gone never converts), and before returning. A cancelled read raises `ReadCancelled`.
    - It raises `IndexingError`:
      - `UNREADABLE_PDF`, not retryable;
      - `INDEX_FAILED`, not retryable, for a range that does not start on a page of the file;
      - `INDEX_FAILED`, retryable, for anything unexpected, with only the exception's type name, and raised outside the handler so it carries no cause.
  - In `sources.py`:
    - `Cell(box, from_ocr)`;
    - `cells_inside(cells, box) -> list[Cell]`: the cells whose centre lies inside the box, edges included. Both must have a top-left origin, or it raises `ValueError`;
    - `source_of(cells) -> TextSource | None`;
    - `item_source(cells, bbox | [bbox, …]) -> TextSource | None`: all OCR is `ocr`, none is `text_layer`, both is `mixed`, and no cell is `None` (the item has no text and is ignored). Several boxes take the union.
  - Pages:
    - `text` is every text and table item on the page in reading order, furniture included, joined by `"\n"`.
    - A table is one row a line, its cells separated by a space, and goes whole on its first page. A text item over a page break gives each page its `prov.charspan` part.
    - `itemsTextLayer` and `itemsOcr` count items by source (a mixed item counts in both), and only on pages where the item's part has text.
    - `noneReason` is one of:
      - `PAGE_UNREADABLE`: missing from `result.pages`, or named by one of `result.errors`; logged as page number and category only;
      - `null`: the page has text;
      - `NO_TEXT`: no layout cluster and no bitmap on the page;
      - `OCR_FAILED`: content but no text, with OCR on;
      - `OCR_BUDGET`: content but no text, with OCR off.

- [x] **Step 1: Write the failing model-free tests** in `test_sources.py` for `item_source`: all-OCR cells → `ocr`; none → `text_layer`; one of each → `mixed`; a cell whose centre is outside the box is ignored; no cells → `None`.
- [x] **Step 2: Write the failing gated tests** in `test_reader.py`:

```python
def test_text_layer_page(self):
    read = reader().read_range(pdf("text-layer.pdf"), 1, 20, ocr_pages_left=400, cancel=Event())
    self.assertEqual((read.first_page, read.last_page), (1, 1))
    self.assertEqual(set(read.item_sources.values()), {"text_layer"})
    self.assertIn("1,23,456.78", read.pages[0].text)   # exactly as printed

def test_scanned_page_is_ocr(self):
    read = reader().read_range(pdf("scanned.pdf"), 1, 1, 400, Event())
    self.assertEqual(set(read.item_sources.values()), {"ocr"})
    self.assertGreater(read.pages[0].items_ocr, 0)

def test_mixed_page_has_both_sources(self):
    self.assertEqual(set(reader().read_range(pdf("mixed.pdf"), 1, 1, 400, Event()).item_sources.values()), {"text_layer", "ocr"})

def test_no_ocr_budget_left_marks_the_scanned_page(self):
    page = reader().read_range(pdf("scanned.pdf"), 1, 1, 0, Event()).pages[0]
    self.assertEqual((page.text, page.none_reason), ("", "OCR_BUDGET"))

def test_a_range_reads_only_its_pages(self):
    read = reader().read_range(pdf("two-sections.pdf"), 2, 3, 400, Event())
    self.assertEqual([p.page_number for p in read.pages], [2, 3])

def test_running_header_stays_in_page_text(self):
    # docling-parse reads the en dash as "-" (as built), so match before it
    self.assertIn("Annual report 2025", reader().read_range(pdf("two-sections.pdf"), 1, 1, 400, Event()).pages[0].text)

def test_unreadable_pdf(self):
    with self.assertRaises(IndexingError) as e: reader().read_range(b"%PDF-1.7 not really", 1, 20, 400, Event())
    self.assertEqual((e.exception.code, e.exception.retryable), ("UNREADABLE_PDF", False))

def test_a_blank_page_has_no_text_with_or_without_ocr(self):
    for budget in (400, 0):  # a page with no layout region and no image
        self.assertEqual((page_of(made_pdf(), budget).text, page_of(made_pdf(), budget).none_reason), ("", "NO_TEXT"))
```

Also as built: `test_a_page_docling_could_not_read_is_kept_as_unreadable` and `test_a_page_missing_from_a_successful_read_is_unreadable_not_blank` (both `PAGE_UNREADABLE`), `test_only_one_pipeline_is_resident`, `test_a_cancelled_read_stops_before_docling`, `test_a_range_must_start_on_a_page_of_the_file`, `test_an_item_counts_only_on_pages_where_its_part_has_text`, `test_a_paragraph_over_a_page_break_gives_each_page_its_own_part`, and `test_an_error_names_no_document_text`.

- [x] **Step 3: Run to see them fail** — `cd apps/indexer && MAESTER_DOCLING_MODELS=… uv run python -m unittest tests.test_sources tests.test_reader -v` — FAIL (no module).
- [x] **Step 4: Implement** `settings.py`, `errors.py`, `sources.py` and `reader.py`. One converter is resident per process. Docling 2.134.0's threaded pipeline has no hook between page batches, so `read_range` checks `cancel` before the conversion, under the lock, and before returning.
- [x] **Step 5: Run to see them pass** — same command — PASS.
- [x] **Step 6: Save the reads as fixtures** for the model-free tests: `tests/fixtures/save_reads.py` runs `read_range` over each fixture PDF and writes `tests/fixtures/<name>.read.json` (`RangeRead.to_wire()`, all pages, OCR on, floats rounded to three places because the layout model's boxes vary in about the fifth). Commit them; regenerate only when the Docling pin or the reader changes.
- [x] **Step 7: Commit**

```bash
git add apps/indexer/src apps/indexer/tests
git commit -m "feat(indexer): read a page range with Docling and RapidOCR; text source per item from OCR provenance"
```

---

### Task 4: Chunking a range

**Files:**
- Create: `apps/indexer/src/maester_indexer/chunker.py`; Modify: `apps/indexer/tests/helpers.py`
- Test: `apps/indexer/tests/test_chunker.py` (no models: the `*.read.json` fixtures and the whitespace tokenizer)

**Interfaces:**
- Consumes: `RangeRead` (Task 2); the read fixtures `tests/fixtures/*.read.json` (Task 3 Step 6), made from Task 1's PDFs.
- Produces:
  - `MAX_EMBED_TOKENS = 512`, `PATH_TOKENS = 64`, `CHUNK_TOKENS = 448`, `HEADER_SHARE = 2`.
  - `chunk_range(read: RangeRead, section_path_before: list[str], tokenizer: BaseTokenizer) -> tuple[list[PageEvent], list[ChunkEvent]]`.
    - `tokenizer` is a docling-core `BaseTokenizer` that carries its budget (`get_max_tokens()`; `CHUNK_TOKENS` in production, from `load_tokenizer`).
    - Each page of the range is chunked alone, in order: `_cut_to_page(document, page)` cuts multi-page items to that page's `charspan` slices, then `filter_document(…, {page})`. A chunk never crosses a page, and furniture never enters one.
    - The chunker is `HybridChunker(tokenizer=tokenizer)`, whose private steps `_doc_chunks` runs itself (`_inner_chunker.chunk`, `_split_by_doc_items`, `_split_using_plain_text`, `_merge_chunks_with_matching_metadata`), so a table never merges with its peers.
  - `filter_document(document, page_nrs) -> (DoclingDocument, dict[new_ref, original_ref])`: `filter()` renumbers refs, so the map walks the items as `filter()` does (`_iterate_items_with_stack`, private). A lost or changed item raises `IndexingError("INDEX_FAILED", …, False)`.
  - **Section path.**
    - A heading naming a basis (`_BASIS = r"\b(consolidated|standalone)\b"`, any case) becomes the root and stays the root.
    - Later headings that name none nest under it as `[root, latest heading]`, until another basis heading replaces the root.
    - A chunk with no heading above it on its page takes the path carried in: `section_path_before` for the range's first page, then the path in force after the previous page.
    - `sectionPathAfter` is the whole path at the end of the page, so a heading with nothing under it on its page still carries.
  - `basis_of(path)`: from the innermost heading out, the first that names a basis decides; none gives `null`. In a built path that is the root, and the basis comes from the whole path even when the shown path is cut.
  - `cut_path(path, tokenizer)` drops outermost headings until the path fits `PATH_TOKENS`.
  - `embed_budget(tokenizer)` is `MAX_EMBED_TOKENS − num_special_tokens_to_add(pair=False)`.
  - `fit_path(path, text, tokenizer)` cuts further from the left, down to empty, until `count_tokens(contextualize(path, text)) <= embed_budget`. The embedded text fits by construction.
  - `seq` counts chunks within their page from 0, so a page chunked again alone gets the same numbers.
  - `kind`: a table is always its own chunk (`table`); everything else is `prose`.
    - A table that does not fit splits by rows, each part starting with the header rows.
    - Header rows taking more than `1/HEADER_SHARE` of the budget are not repeated but read as rows.
    - A caption that does not fit with the header goes out ahead of the table, cut to the budget.
    - A row too wide to sit under its header is cut into pieces, each under the header.
  - `textSource` is the union of the items' `itemSources` (one source, or `mixed`).
    - With OCR off, an item with no recorded source counts as `text_layer`.
    - With OCR on, a chunk holding an item with text and no recorded source is `mixed`, or `ocr` when every recorded source is OCR.
  - `tokenCount` is `count_tokens(contextualize(sectionPath, text))`, without special tokens. A text over `embed_budget` on its own raises `IndexingError("INDEX_FAILED", …, False)`: a bug, not a document fault.
  - `load_tokenizer(path: str, expected_model: str) -> HuggingFaceTokenizer` (with `max_tokens=CHUNK_TOKENS`).
    - The folder's model is the `embedding.id` of the nearest `models.lock.json` in the folder or above it, and the folder must end with that id.
    - Another model, or a folder of another name, is `INDEXER_MODEL_MISMATCH`.
    - No lock, a malformed lock, or no tokenizer in the folder (`AutoTokenizer.from_pretrained(…, local_files_only=True)` fails) is `INDEXER_NOT_CONFIGURED`.
    - Neither is retried.

- [x] **Step 1: Write the failing tests** in `test_chunker.py`:

```python
# docling-parse reads the header's en dash as a hyphen (As built 3), so match the part before it.
RUNNING_HEADER = "Annual report 2025"
# The two halves of the paragraph that runs from page 1 of two-sections onto page 2: one Docling
# item with a prov on each page (As built 8), so the test checks where each half lands.
FIRST_HALF = "shown net of the allowance for expected losses,"
SECOND_HALF = "Borrowings are carried at amortised cost"

def test_no_chunk_crosses_a_page(self):
    _, chunks = chunk_range(read("two-sections"), [], tok())
    self.assertEqual([c.page_number for c in chunks if FIRST_HALF in c.text], [1])
    self.assertEqual([c.page_number for c in chunks if SECOND_HALF in c.text], [2])

def test_a_heading_carries_onto_the_next_page(self):
    _, chunks = chunk_range(read("two-sections"), [], tok())
    first_on_2 = next(c for c in chunks if c.page_number == 2)
    self.assertEqual(first_on_2.section_path[-1], "Standalone balance sheet")
    self.assertEqual(first_on_2.basis, "standalone")

def test_a_heading_carries_across_a_range_boundary(self):
    pages, _ = chunk_range(read("two-sections", pages=(1, 1)), [], tok())
    _, chunks = chunk_range(read("two-sections", pages=(2, 3)), pages[-1].section_path_after, tok())
    self.assertEqual(chunks[0].section_path[-1], "Standalone balance sheet")

def test_consolidated_and_standalone_never_share_a_chunk(self):
    _, chunks = chunk_range(read("two-sections"), [], tok())
    self.assertEqual({c.basis for c in chunks if c.page_number == 3}, {"consolidated"})

def test_running_header_is_in_the_page_text_and_in_no_chunk(self):
    pages, chunks = chunk_range(read("two-sections"), [], tok())
    self.assertTrue(all(RUNNING_HEADER in p.text for p in pages))   # so the next line can fail
    self.assertFalse(any(RUNNING_HEADER in c.text for c in chunks))

def test_a_table_is_its_own_chunk_and_stays_whole_when_it_fits(self):
    _, chunks = chunk_range(read("text-layer"), [], tok(448))
    self.assertEqual([c.kind for c in chunks], ["prose", "table"])
    self.assertEqual(chunks[1].text, "\n".join(table_rows(read("text-layer"))))

def test_a_table_too_large_splits_by_rows_with_its_header(self):
    header, *body = table_rows(read("text-layer"))
    tables = [c for c in chunk_range(read("text-layer"), [], tok(24))[1] if c.kind == "table"]
    self.assertGreater(len(tables), 1)
    self.assertTrue(all(c.text.split("\n")[0] == header and c.token_count <= 24 for c in tables))
    self.assertEqual([line for c in tables for line in c.text.split("\n")[1:]], body)

def test_sources_and_budget(self):
    _, chunks = chunk_range(read("mixed"), [], tok())
    self.assertIn("mixed", {c.text_source for c in chunks})  # the merged paragraph chunk holds both
    self.assertTrue(all(c.token_count <= 512 for c in chunks))

def test_seq_is_stable_when_a_page_is_chunked_alone(self):
    _, all_pages = chunk_range(read("two-sections"), [], tok())
    _, page_2 = chunk_range(read("two-sections", pages=(2, 2)), path_after(all_pages, 1), tok())
    self.assertEqual([(c.page_number, c.seq, c.text) for c in all_pages if c.page_number == 2], [(c.page_number, c.seq, c.text) for c in page_2])

def test_a_long_carried_path_is_cut_from_the_left(self):
    _, chunks = chunk_range(read("two-sections", pages=(2, 2)), ["Part " + "x " * 80, "Notes", "25 Borrowings"], tok())
    self.assertEqual(chunks[0].section_path[-2:], ["Notes", "25 Borrowings"])
```

`read(name, pages=None)` loads `tests/fixtures/<name>.read.json`, restricted to `pages` (the fixture's document filtered to those pages); `tok(n=448)` is the whitespace tokenizer as a `BaseTokenizer` with `max_tokens=n`; `path_after(pages, n)` is page `n`'s `section_path_after`; `table_rows(read)` reads the table's rows back from the fixture, cells joined by a space.

As built, the suite also pins:
- **Roots** (`f8a8805`): `test_a_heading_with_no_basis_nests_under_the_root`, `test_the_root_carries_across_a_range_boundary`, `test_a_carried_heading_nests_under_the_carried_root`, `test_the_basis_stays_when_the_root_is_cut_from_the_shown_path`, `test_a_root_heading_dropped_by_the_chunker_still_roots_the_path`, `test_a_heading_with_nothing_under_it_on_its_page_still_carries`.
- **Tables** (`0d3de51`): `test_a_row_too_wide_for_its_header_is_cut_under_it`, `test_header_rows_too_large_to_repeat_are_read_as_rows`, `test_a_caption_too_long_for_the_budget_is_cut_ahead_of_the_table`, `test_a_table_on_two_pages_stays_on_its_first_however_the_range_is_cut`.
- **Sources** (`f8a8805`, `0d3de51`): `test_an_unrecorded_item_under_ocr_makes_the_chunk_mixed`, `test_a_chunk_with_no_recorded_source_takes_the_reads_ocr_setting`.
- **Budget** (`f8a8805`, `0d3de51`): `test_the_path_fits_the_embedding_limit_with_its_newline`, `test_the_models_special_tokens_are_kept_out_of_the_budget`, `test_a_text_over_the_embedding_limit_alone_is_a_bug`.
- **Filtering:** `test_filtered_refs_map_back_to_the_original_items`, `test_an_item_lost_by_filtering_is_an_indexing_error`.
- **`load_tokenizer`:** `test_loads_the_folder_named_in_the_lock`, `test_refuses_another_model`, `test_refuses_a_folder_with_no_tokenizer`, `test_refuses_a_malformed_lock`, `test_a_folder_with_no_lock_is_not_configured`, `test_a_lock_for_a_folder_of_another_name_is_a_mismatch`.

- [x] **Step 2: Run to see them fail** — `cd apps/indexer && uv run python -m unittest tests.test_chunker -v` — FAIL (no module).
- [x] **Step 3: Implement** `chunker.py`.
- [x] **Step 4: Run to see them pass** — same command — PASS.
- [x] **Step 5: Commit**

```bash
git add apps/indexer/src/maester_indexer/chunker.py apps/indexer/tests
git commit -m "feat(indexer): chunk a range by element within each page, carry the section path, basis from the headings"
```

---

### Task 5: The indexer service

**Files:**
- Create: `apps/indexer/src/maester_indexer/app.py`, `apps/indexer/src/maester_indexer/__main__.py`, `apps/indexer/src/maester_indexer/fetch_models.py`, `apps/indexer/Dockerfile`
- Test: `apps/indexer/tests/test_service.py` (no models: a fake `Reader` and the whitespace tokenizer), `apps/indexer/tests/test_fetch_models.py` (added in `603a9c8`)

**Interfaces:**
- Consumes: `Reader` (Task 3), `chunk_range`, `load_tokenizer` (Task 4), the contracts (Task 2).
- Produces:
  - `create_app(settings: Settings | None = None, reader: Reader | None = None, tokenizer: BaseTokenizer | None = None, heartbeat_seconds: float = HEARTBEAT_SECONDS) -> FastAPI` (`HEARTBEAT_SECONDS = 15.0`), the extractor's shape (`apps/extractor/src/maester_extractor/app.py`).
    - `x-indexer-secret` is compared with `hmac.compare_digest`; while `INDEXER_SECRET` is set, a missing or wrong one gives 401 `INDEXER_UNAUTHORIZED` on `/v1/versions`, `/v1/index` and `/v1/chunk`. A warning is logged at start when the secret is unset.
    - The body is read in a stream with `INDEX_MAX_BYTES` (413 `TOO_LARGE_FOR_INDEX`, also on `content-length`); an empty body is 400 `EMPTY_BODY`.
    - The tokenizer loads lazily, once, under a lock (`load_tokenizer(settings.tokenizer_path, settings.embedding_model)`). An unset path is `INDEXER_NOT_CONFIGURED`.
  - `GET /healthz` → `{"status":"ok"}`, with no secret; `GET /v1/versions` → `reader.versions`.
  - `POST /v1/index` takes the PDF as the body, with headers `x-document-id`, `x-page-range` (`^\d{1,9}-\d{1,9}$`, `first >= 1`, `last >= first`), `x-section-path` (base64url of a JSON array of strings), `x-ocr-pages-left` (int ≥ 0) and `x-embedding-model`.
    - `x-document-id`, `x-page-range` and `x-embedding-model` are required. `x-ocr-pages-left` and `x-section-path` are optional: a missing `x-ocr-pages-left` reads as 0, which turns OCR off for the range, and a missing `x-section-path` reads as `[]`. The worker always sends all five.
    - A missing required header, or any malformed value, is 400 `BAD_REQUEST`.
    - An `x-embedding-model` that is not `settings.embedding_model` gets one `error INDEXER_MODEL_MISMATCH` line (not retryable), and nothing is read.
    - Otherwise it counts the pages. A range starting past the end is `error INDEX_FAILED`, not retryable.
    - Then it sends `started` (with `lastPage` clamped), heartbeats while the tokenizer loads, then heartbeats every `heartbeat_seconds` while Docling reads in a thread, then while chunking.
    - Then each `page` line followed by its own `chunk` lines, `progress { stage: "chunking", percent: 100 }`, and `result { read, ocrPages }` (`ocrPages` counts pages with `itemsOcr > 0`) or one `error`.
    - A `ReadCancelled` ends the stream with no line. The `finally` block sets `cancel`, so a client that goes away stops the read.
  - `POST /v1/chunk` takes a `ChunkRequest` JSON body; one that does not validate is 400 `BAD_REQUEST`, with no detail. It returns the same stream with no reading and `result { read: null, ocrPages: 0 }`. A cached read is chunked by this service whatever its `chunkerVersion` (the cache keys on the reader versions only).
    - An `embeddingModel` that is not `settings.embedding_model` gets one `error INDEXER_MODEL_MISMATCH` line (not retryable), as on `/v1/index`.
    - `started` carries the service's own versions and the cached read's page bounds and page count. That is why a cached read under the current reader key always passes the worker's `sameVersions` check.
  - Errors: an `IndexingError` goes out as its own code. Anything else is `INDEX_FAILED`, retryable, with message `"unexpected <TypeName>"`, logged by type only.
  - `maester-indexer`: a console script running uvicorn on `PORT`, default 8791.
  - `maester-indexer-fetch-models --out <dir> [--lock <path>] [--docling-only]` is the only code that fetches. In order, it:
    1. deletes `<dir>/models.lock.json`;
    2. downloads each `DOCLING_REPOS` entry (`docling-project/docling-layout-heron`, `docling-layout-heron-onnx`, `docling-models`) with Docling's `download_hf_model(repo_id, revision=<lock>, local_dir=<dir>/docling/<repo with "/" as "--">)`, then `RapidOcrModel.download_models(backend="onnxruntime", local_dir=<dir>/docling/<RapidOcrModel._model_repo_folder>)` with no revision: RapidOCR's weights follow the pinned `rapidocr` package, and the lock's `RapidAI/RapidOCR` entry is not read here;
    3. unless `--docling-only` (used by CI), calls `snapshot_download(repo_id, revision=<lock>, local_dir=<dir>/embed/<id>, allow_patterns=EMBED_ALLOW_PATTERNS, ignore_patterns=EMBED_IGNORE_PATTERNS)`;
    4. copies the lock to `<dir>/models.lock.json`, last.

    `EMBED_ALLOW_PATTERNS = ("*.json", "*.safetensors", "sentencepiece.bpe.model", "vocab.txt", "merges.txt")` and `EMBED_IGNORE_PATTERNS = ("onnx/*", "openvino/*")` (`603a9c8`).
  - The Dockerfile has two stages on `python:3.12-slim`:
    - **Build stage:** uv 0.11.17, `uv sync --locked --no-dev --no-editable` in `/app`.
    - **Runtime stage:** `libgl1` and `libglib2.0-0` for OpenCV, `/models` created and owned by `app` (so a new named volume first mounted there is writable by the fetch), the virtualenv, `/app/models.lock.json`, `HF_HUB_OFFLINE=1`, user `app`, `EXPOSE 8791`.

- [x] **Step 1: Write the failing tests** in `test_service.py` with `fastapi.testclient.TestClient` and a fake reader that returns `tests/fixtures/two-sections.read.json` for any range: a full `/v1/index` stream parses line by line as `IndexerEvent`, starts with `started`, ends with `result`, and its chunks equal `chunk_range` on the same read; a wrong secret → 401 `INDEXER_UNAUTHORIZED`; a model mismatch → one `error` line `INDEXER_MODEL_MISMATCH` and the fake reader never called; a body over `INDEX_MAX_BYTES` → 413; a reader that sleeps longer than `heartbeat_seconds` (set to 0.05) yields `heartbeat` lines; a reader raising `IndexingError("UNREADABLE_PDF", …, False)` ends with that `error`; a reader raising `RuntimeError("Revenue 1,234")` ends with `error INDEX_FAILED`, retryable, and `"Revenue"` appears neither in the error line nor in any captured log record (`assertLogs`); `/v1/chunk` with `chunk-request.json` streams pages and chunks with `result.read` null; the client disconnecting sets the reader's `cancel`. As built, also: the range is clamped to the page count; a range past the end is an error; a missing tokenizer fails before the read; a waiting read that is cancelled never converts; overlapping reads never run Docling at once. `test_fetch_models.py`: the patterns take what TEI and the tokenizer load from the arctic repository's file list and nothing under `onnx/` (an `onnx/*.json` included), and `snapshot_download` is given them.
- [x] **Step 2: Run to see them fail** — `cd apps/indexer && uv run python -m unittest tests.test_service -v` — FAIL.
- [x] **Step 3: Implement** `app.py`, `__main__.py`, `fetch_models.py` and the Dockerfile. Logs: document id, range, page and chunk counts, OCR pages, seconds, error codes and exception types only.
- [x] **Step 4: Run the indexer suite** — `cd apps/indexer && uv run python -m unittest discover -s tests -v` — PASS (the gated tests skip without `MAESTER_DOCLING_MODELS`).
- [x] **Step 5: Build the image** — `docker build -f apps/indexer/Dockerfile -t maester/indexer:check .` (a build, not compose) — succeeds; note its size in the README (2.71 GB, 20 Oct 2026).
- [x] **Step 6: Commit**

```bash
git add apps/indexer
git commit -m "feat(indexer): /v1/index and /v1/chunk NDJSON service, versions, model fetch command, image"
```

---

### Task 6: The index tables and their queries

**Files:**
- Create: `packages/db/src/schema/document-index.ts`; Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/0007_document_index.sql` (generated, then edited), `packages/db/drizzle/meta/0007_snapshot.json`; Modify: `packages/db/drizzle/meta/_journal.json`
- Create: `packages/db/src/queries/document-index.ts`; Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/migrate.test.ts`, `packages/db/test/document-index.test.ts`

**Interfaces:**
- Produces, every table with `id uuid` primary key (except `chunk_embedding`), `workspace_id uuid not null` references `workspace`, `created_at`:
  - `document_index_revision`: `document_id` → `document`, `job_id` → `job` unique, `state` enum `index_revision_state` (`building`, `complete`, `partial`), `index_version`, `docling_version`, `ocr_engine`, `reader_options`, `chunker_version`, `embedding_model` (all text not null), `page_count int` (null until known), `pages_read int default 0`, `pages_ocr int default 0`, `warnings text[] default '{}'`, `completed_at`. Index `(workspace_id, document_id, embedding_model, created_at)`; partial unique index `document_index_current` on `(document_id, embedding_model) where state in ('complete','partial')`.
  - `document_page`: `revision_id` → revision on delete cascade, `page_number int not null`, `text text not null`, `items_text_layer int`, `items_ocr int`, `none_reason text`, `section_path_after text[] not null`. Unique `(revision_id, page_number)`.
  - `document_chunk`: `revision_id` → revision on delete cascade, `document_id`, `page_number int` (null only for a future XBRL chunk), `element text` (null for PDF chunks), `seq int not null`, `section_path text[] not null`, `kind` enum (`prose`, `table`), `text_source` enum (`text_layer`, `ocr`, `mixed`, `xbrl`), `basis text` (`consolidated`, `standalone` or null), `heading_text text not null` (the path joined by `" "`, written by the worker, because `array_to_string` is not immutable and a generated column needs an immutable expression), `text text not null`, `token_count int not null`, `tsv tsvector generated always as (to_tsvector('simple', heading_text || ' ' || text)) stored`. Constraint `document_chunk_revision_page_seq UNIQUE NULLS NOT DISTINCT (revision_id, page_number, seq)` (as built, `bc665e8`: a future XBRL chunk with a null page is still unique); GIN `document_chunk_tsv` on `tsv`; B-tree `document_chunk_workspace_document` on `(workspace_id, document_id)`. Enums `chunk_kind`, `chunk_text_source`, `index_revision_state`. Other indexes as built: `document_index_revision_document` on `(workspace_id, document_id, embedding_model, created_at)`, unique `document_page_revision_page`, unique `page_read_key`.
  - `chunk_embedding`: `chunk_id` → chunk on delete cascade, `model text`, `workspace_id`, `embedding vector(1024) not null`; primary key `(chunk_id, model)`; HNSW `chunk_embedding_hnsw` on `((embedding::halfvec(1024)) halfvec_cosine_ops)`.
  - `page_read`: `content_sha256`, `first_page`, `last_page`, `docling_version`, `ocr_engine`, `reader_options`, `read jsonb not null` (a `RangeRead`). Unique `(workspace_id, content_sha256, first_page, last_page, docling_version, ocr_engine, reader_options)`.
  - Exported from `@maester/db`: the type `IndexRevisionRow` (schema), the queries below, and the types `IndexVersions`, `PageInput`, `ChunkInput`, `RangeCounts`, `PageReadKey` and `RangeReadJson`.
    - `IndexVersions = { doclingVersion, ocrEngine, readerOptions, chunkerVersion, tokenizer, indexVersion, embeddingModel }`. `tokenizer` has no column and is not compared on resume.
    - `PageInput.noneReason` is `"NO_TEXT" | "OCR_FAILED" | "OCR_BUDGET" | "PAGE_UNREADABLE" | null`.
    - `ChunkInput` has `pageNumber: number | null`, `element?`, `seq`, `sectionPath`, `kind`, `textSource`, `basis?`, `text` and `tokenCount`.
    - `RangeCounts = { pageCount: number | null; pagesRead; pagesOcr; warnings: string[] }`.
    - `PageReadKey = { contentSha256, firstPage, lastPage, doclingVersion, ocrEngine, readerOptions }`.
    - `RangeReadJson = Record<string, unknown>`.
  - Queries (each takes `workspaceId` second, after `db`, except `documentsNeedingIndex`, which takes one options object with an optional `workspaceId`, because the backfill may run across workspaces). A guard throws a plain `Error` whose message is its code, with no text.
    - `startOrResumeRevision(db, ws, { documentId, jobId, versions: IndexVersions }) -> IndexRevisionRow` runs in one transaction.
      - It throws `DOCUMENT_NOT_FOUND`, or `JOB_NOT_FOR_DOCUMENT` when the job's `subject_id` is not the document.
      - It locks the job's revision `for update`. It resumes that revision when `indexVersion`, `doclingVersion`, `ocrEngine`, `readerOptions`, `chunkerVersion` and `embeddingModel` match; otherwise it deletes the revision (cascading) and inserts a new `building` one. With no revision, it inserts one.
    - `writeRange(db, ws, revisionId, documentId, pages: PageInput[], chunks: ChunkInput[], counts: RangeCounts) -> void` runs in one transaction.
      - It throws `INDEX_REVISION_NOT_FOUND`, `REVISION_DOCUMENT_MISMATCH` or `REVISION_NOT_BUILDING`.
      - Pages and chunks go in batches of 500 (`INSERT_BATCH`), `on conflict do nothing`, with `heading_text = sectionPath.join(" ")`.
      - It sets the counts and merges the warnings, sorted and unique.
    - `lastStoredPage(db, ws, revisionId) -> { pageNumber, sectionPathAfter } | null`.
    - `chunksWithoutEmbedding(db, ws, revisionId, model, limit) -> { id, sectionPath, text }[]`, ordered by page and seq.
    - `insertEmbeddings(db, ws, model, rows: { chunkId, embedding: number[] }[]) -> void` throws `CHUNK_NOT_IN_WORKSPACE` unless every chunk is in the workspace. It inserts in batches of 100, `on conflict do nothing`.
    - `completeRevision(db, ws, revisionId) -> IndexRevisionRow` runs in one transaction.
      - It deletes the document's other revisions for the same model.
      - It sets `state` to `partial` when `warnings` holds `OCR_FAILED`, `OCR_BUDGET` or `PAGE_UNREADABLE`, else `complete`, and sets `completed_at`.
    - `getPageRead(db, ws, key: PageReadKey) -> RangeReadJson | null` (the caller parses it with `RangeRead`) and `putPageRead(db, ws, key, read) -> void`, `on conflict do nothing`.
    - `documentsNeedingIndex(db, { workspaceId?, documentIds?, model, pipelineVersion }) -> { documentId, workspaceId, job: JobRow | null }[]`, ordered by `created_at`, then `id`. It returns:
      - documents with `state = 'stored'` and `intake_state is distinct from 'duplicate'`. A stored document from before intake has a null intake state and is included;
      - only those with no complete or partial revision for `model`;
      - each with its job, left-joined on `idempotency_key = 'document.index:' || id || ':' || pipelineVersion`;
      - nothing when `documentIds` is `[]`.

- [x] **Step 1: Write the failing tests.** `migrate.test.ts`: the `vector` extension is installed (`select extversion from pg_extension where extname = 'vector'`); the five tables exist; `chunk_embedding_hnsw`'s `indexdef` contains `halfvec_cosine_ops`; `document_chunk_tsv` is GIN; `document_index_current` is partial. `document-index.test.ts`, on seeded rows (a 1024-dimension vector helper `unit(i)` with a 1 at index `i`):

```ts
it("the bare nearest-neighbour query can use the HNSW index (Task 10 checks the real search query)", async () => {
  await seedIndexedChunks(db, ws, 30);
  const plan = await db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_seqscan = off`);
    return tx.execute(sql`explain select chunk_id from chunk_embedding order by embedding::halfvec(1024) <=> ${toVector(unit(1))}::halfvec(1024) limit 50`);
  });
  expect(JSON.stringify(plan.rows)).toContain("chunk_embedding_hnsw");
});
it("tsv uses the simple configuration, so a company name and a CIN are not stemmed", async () => { /* 'Synthetic Cements' and 'L26942GJ1981PLC004717' match exactly with websearch_to_tsquery('simple', …) */ });
it("writeRange twice writes each page and chunk once", async () => { /* same input twice → counts unchanged */ });
it("startOrResumeRevision resumes the job's revision and replaces it when the versions changed", async () => {});
it("completeRevision swaps in one transaction and leaves one current revision per document and model", async () => {
  /* an older complete revision R1 and a building R2 for the same document and model:
     before: current = R1; after completeRevision(R2): R1 is gone with its chunks and embeddings, R2 is complete */
});
it("completeRevision marks the revision partial when a page hit the OCR budget", async () => {});
it("a second complete revision for the same document and model is refused by document_index_current", async () => {});
it("documentsNeedingIndex skips duplicates, unstored documents and documents with a current revision, and reports the existing job", async () => {});
it("documentsNeedingIndex includes a stored document whose intake_state is null", async () => {});
it("no query returns another workspace's rows", async () => { /* seed two workspaces; every query above, called with ws A, returns nothing of B */ });
// as built, also:
it("writeRange stores the heading text as the section path joined by a space", async () => {});
it("writeRange merges warnings across ranges", async () => {});
it("lastStoredPage returns the highest page and its section path, or null", async () => {});
it("chunksWithoutEmbedding lists by page and seq, and not the embedded ones", async () => {});
it("page_read caches a range read once per key", async () => {});
it("writeRange refuses another document's id and a revision that is not building", async () => {});
it("startOrResumeRevision refuses a document outside the workspace and a job for another document", async () => {});
it("a chunk with no page number is unique per revision and seq", async () => {});
```

- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/db exec vitest run test/migrate.test.ts test/document-index.test.ts` — FAIL. First check the test database's image: `select 1 from pg_available_extensions where name = 'vector'` on `localhost:5433`; if it returns nothing, stop and ask the investor to recreate their Postgres container on the pgvector image (Task 13 Step 2 has the commands); do not run compose from the worktree. In the build this held: the suites ran against a pgvector database, and CI's service image is `pgvector/pgvector:pg16` (`.github/workflows/ts.yml`).
- [x] **Step 3: Write the schema and generate the migration.** Drizzle's `vector("embedding", { dimensions: 1024 })` for the column. Run `pnpm --filter @maester/db generate`, then edit the generated file: put `CREATE EXTENSION IF NOT EXISTS vector;` first; write the HNSW index as `CREATE INDEX "chunk_embedding_hnsw" ON "chunk_embedding" USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops);` and the `tsv` column as `GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, heading_text || ' ' || text)) STORED` if drizzle-kit wrote either differently. Mirror the generated column in the schema with a `customType` and `.generatedAlwaysAs(…)`, so the next `generate` shows no diff (run it again to check).
- [x] **Step 4: Implement the queries.**
- [x] **Step 5: Run to see them pass** — same command — PASS; then the whole `@maester/db` suite.
- [x] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): document index tables, HNSW on halfvec, simple full-text, the page read cache and their queries"
```

---

### Task 7: `@maester/document-index`: the model, the embedder client and the query prefix

**Files:**
- Create: `packages/document-index/{package.json,tsconfig.json,eslint.config.js,vitest.config.ts,README.md}`, `packages/document-index/src/{index.ts,models.ts,embedder.ts,fake.ts}`
- Test: `packages/document-index/test/embedder.test.ts`, `packages/document-index/test/models.test.ts`

**Interfaces:**
- Consumes: `contextualize` (Task 2).
- Produces:
  - `INDEX_PIPELINE_VERSION = "1"`; `indexPipelineVersion(model: string) => \`${INDEX_PIPELINE_VERSION}:${model}\``.
  - `EMBEDDING_MODELS: Record<string, { dimensions: 1024; queryPrefix: string; documentPrefix: string }>` with `"Snowflake/snowflake-arctic-embed-l-v2.0": { dimensions: 1024, queryPrefix: "query: ", documentPrefix: "" }`; `embeddingModel(id: string)` throws for an id not listed.
  - `embeddingInput(model: string, kind: "query" | "document", text: string): string` — the one place a prefix is added.
  - `interface Embedder { model: string; embed(texts: string[], kind: "query" | "document"): Promise<number[][]> }`.
  - `class EmbedderError extends Error { constructor(code: "EMBEDDING_FAILED" | "EMBEDDER_UNAVAILABLE", retryable: boolean, message: string) }`, with `code` and `retryable` as read-only fields and `name = "EmbedderError"`; for example `new EmbedderError("EMBEDDING_FAILED", false, "The embedder returned no vector.")`.
  - `interface TeiOptions { timeoutMs?: number /* 60_000 */; retries?: number /* 3, after the first attempt */; backoffMs?: number /* 1000, doubling */; retryOnTimeout?: boolean /* true */ }`.
  - `class TeiEmbedder implements Embedder { constructor(baseUrl: string, model: string, opts?: TeiOptions) }`. The constructor throws for an unknown model.
    - It sends `POST {baseUrl}/embed` with `{ inputs: texts.map(t => embeddingInput(model, kind, t)), normalize: true, truncate: false }`, and makes no call for `[]`.
    - **Retried up to `retries`, waiting 1 s, 2 s, 4 s:** a network error (`EMBEDDER_UNAVAILABLE`), a body cut off mid-read (`EMBEDDER_UNAVAILABLE`), and a 5xx or 429 (`EMBEDDING_FAILED`, retryable).
    - **Timeouts:** with `retryOnTimeout: false`, a request that runs past `timeoutMs`, including one whose body stops arriving, throws `EMBEDDER_UNAVAILABLE`, retryable, at once and is not sent again (`3bfafc8`).
    - **Not retried:** any other 4xx, a body that is not JSON, and an answer that is not `texts.length` vectors of the model's dimensions; each throws `EMBEDDING_FAILED`, not retryable.
  - `class FakeEmbedder implements Embedder { constructor(model = "Snowflake/snowflake-arctic-embed-l-v2.0"); fail(times: number, err?: EmbedderError): void }`. It gives deterministic 1024-dimension unit vectors from SHA-256 blocks of the raw text, so equal texts get equal vectors whatever the kind. The next `times` calls throw `err` (default: a retryable `EMBEDDING_FAILED`). The worker's and the API's tests use it.

- [x] **Step 1: Write the failing tests.** Against a local `node:http` server on a free port (a fake `/embed`): the request body carries `"query: what is the dividend"` for a query and the bare text for a document; two 503 answers then a 200 succeed after retries (with the waits shortened through an option); four 503 answers throw `EMBEDDING_FAILED` retryable; a refused connection throws `EMBEDDER_UNAVAILABLE`; a 768-dimension answer throws. As built, also: a 413 or 422 is not retried; a body cut off mid-read is retried; with `retryOnTimeout: false` a timed-out request (or a body that stops arriving past the timeout) is not sent again, while a 503 still is; by default a timed-out request is sent again `retries` times; `FakeEmbedder` gives a query and a document of equal text the same vector and fails with a custom error. `models.test.ts`: `embeddingModel("nope")` throws; `indexPipelineVersion` gives `"1:Snowflake/snowflake-arctic-embed-l-v2.0"`.
- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/document-index exec vitest run` — FAIL.
- [x] **Step 3: Implement**, and run `pnpm install` (`pnpm-workspace.yaml` takes `packages/*`, so it needs no change).
- [x] **Step 4: Run to see them pass** — same command — PASS.
- [x] **Step 5: Commit**

```bash
git add packages/document-index pnpm-lock.yaml
git commit -m "feat(document-index): the embedding model registry, the query prefix and the TEI client"
```

---

### Task 8: The worker's indexer client, settings and the job's place in the pipeline

**Files:**
- Create: `apps/worker/src/indexer.ts`
- Modify: `apps/worker/src/env.ts`, `apps/worker/src/jobs/types.ts`, `apps/worker/src/run.ts` (`WorkerDeps`, the job context), `apps/worker/src/server.ts` (builds the clients), `apps/worker/src/queue.ts` (`DEFAULT_CONCURRENCY`), `apps/worker/src/jobs/document-verify.ts` (`chainIntake`), `apps/worker/package.json` (`@maester/document-index`); `packages/contracts/src/job.ts` (`DOCUMENT_INDEX`, `DOCUMENT_INDEX_SUBJECT`)
- Test: `apps/worker/test/indexer-client.test.ts`, `apps/worker/test/document-verify.test.ts`, `apps/worker/test/env.test.ts`, `apps/worker/test/queue.test.ts`, `apps/worker/test/context.ts`

**Interfaces:**
- Consumes: `IndexerEvent`, `ChunkRequest`, `IndexerVersions` (Task 2); `Embedder`, `TeiEmbedder`, `FakeEmbedder`, `indexPipelineVersion`, `embeddingModel` (Task 7).
- Produces:
  - `interface IndexInput { pdf: Uint8Array; documentId: string; firstPage: number; lastPage: number; sectionPathBefore: string[]; ocrPagesLeft: number; signal: AbortSignal }`.
  - `interface IndexerClient { versions(): Promise<IndexerVersions>; index(input: IndexInput, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult>; chunk(request: ChunkRequest, signal: AbortSignal, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult> }`, where `IndexResult = { started: Started; pages: PageEvent[]; chunks: ChunkEvent[]; read: RangeRead | null; ocrPages: number }`. `Started`, `PageEvent` and `ChunkEvent` are local aliases in `indexer.ts`, not exports of `@maester/contracts` (Task 2 names its event types only on the Pydantic side): `type Started = Extract<IndexerEvent, { type: "started" }>`, and the same with `"page"` and `"chunk"`.
  - `HttpIndexerClient(baseUrl, secret, embeddingModel)` reads the NDJSON like `HttpExtractorClient.extract` (`apps/worker/src/extractor.ts`). It sends `x-indexer-secret` on every call, `x-embedding-model` from the constructor, and `x-section-path` as base64url JSON. `versions()` waits up to 30 s (`VERSIONS_TIMEOUT_MS`). Failures map to `JobFailure`s:

    | Failure | Code | Retried |
    | --- | --- | --- |
    | Network failure | `INDEXER_UNAVAILABLE` | yes |
    | 401 or 403 | `INDEXER_UNAUTHORIZED` | no |
    | Any other status that is not OK | `INDEXER_HTTP_<status>` | only a 5xx |
    | Versions body that is not JSON | `INDEXER_UNAVAILABLE` | yes |
    | Versions that do not parse, or an unparsable line | `INVALID_INDEXER_RESULT` | no |
    | Last line with no newline that is not JSON | `INDEX_STREAM_INTERRUPTED` | yes |
    | `result` before `started` | `INVALID_INDEXER_RESULT` | no |
    | Stream ends without `result` | `INDEX_STREAM_INTERRUPTED` | yes |
    | `error` event | its own code | its own flag |
    | Aborted signal | `INDEX_TIMEOUT` | yes |

    An `INVALID_INDEXER_RESULT` message names the failing field paths, never the line.
  - `JobContext` gains `indexer: IndexerClient | null` and `embedder: Embedder | null`; `WorkerDeps` (`run.ts`) gains the same two and passes them into the job context.
    - `server.ts` builds `new HttpIndexerClient(INDEXER_URL, INDEXER_SECRET, EMBEDDING_MODEL)` and `new TeiEmbedder(EMBEDDER_URL, EMBEDDING_MODEL, { timeoutMs: EMBED_TIMEOUT_SECONDS * 1000, retryOnTimeout: false })`, or null when the URL is unset.
    - When either is null it logs `documents are not indexed: the index settings are not all set` with the missing names.
    - `createWorkerContext` in tests defaults both to null.
  - `WorkerEnv` gains the worker settings of Global Constraints.
    - Start-up fails when `EMBEDDING_MODEL` is not a key of `EMBEDDING_MODELS`, when `EMBED_BATCH` is over 32, or when `INDEXER_URL` is set without `INDEXER_SECRET`.
  - `DEFAULT_CONCURRENCY["document.index"] = 1`.
  - `chainIntake` also creates the index job for a stored document that is not a duplicate, on the first verify and on a verify retry alike (the key makes it once):

    ```ts
    createJob(ctx.db, ctx.dispatcher, {
      workspaceId,
      type: JobTypes.DOCUMENT_INDEX,
      subjectType: DOCUMENT_INDEX_SUBJECT,
      subjectId: document id,
      pipelineVersion: indexPipelineVersion(ctx.env.EMBEDDING_MODEL),
    })
    ```

    It logs `indexing enqueued`, and runs whether or not the indexer is configured: the job then fails `INDEXER_NOT_CONFIGURED`, and the backfill recovers it.

- [x] **Step 1: Write the failing tests.** `indexer-client.test.ts` over a local `node:http` server replaying `packages/contracts/fixtures/index/stream-range.ndjson`: the result holds its 3 pages and 4 chunks and `onEvent` saw the heartbeat; the request carried `x-page-range: 1-20`, `x-ocr-pages-left`, `x-embedding-model` and `x-section-path` decoding to the array sent; the stream cut after the second chunk → `INDEX_STREAM_INTERRUPTED` retryable; `stream-error.ndjson` → its code; a 401 → `INDEXER_UNAUTHORIZED` not retryable; an aborted signal → `INDEX_TIMEOUT`. `document-verify.test.ts`: verifying a new PDF creates one `document.index` job with subject type `document_index` beside the classify job; a duplicate gets none; a verify retry creates no second one. `env.test.ts`: the defaults (`INDEX_PAGE_RANGE` 20, `INDEX_TIMEOUT_SECONDS` 7200, `EMBED_BATCH` 16, `EMBED_TIMEOUT_SECONDS` 300, `OCR_PAGE_BUDGET` 400, the default model); `EMBEDDING_MODEL=nope` fails; `EMBED_BATCH=33` fails; `INDEXER_URL` without `INDEXER_SECRET` fails. `indexer-client.test.ts` as built also covers a valid last line with no newline, a cut mid-line, a versions body that is not JSON, `INDEXER_HTTP_<status>` and nothing answering. `queue.test.ts`: `parseConcurrency(undefined, ["document.index"])` gives 1.
- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/indexer-client.test.ts test/document-verify.test.ts test/env.test.ts test/queue.test.ts` — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.
- [x] **Step 5: Commit**

```bash
git add apps/worker packages/contracts pnpm-lock.yaml
git commit -m "feat(worker): indexer client, index settings, document.index enqueued after verify with limit 1"
```

---

### Task 9: `document.index`, writing as it goes

**Files:**
- Create: `apps/worker/src/jobs/document-index.ts`; Modify: `apps/worker/src/jobs/index.ts`
- Test: `apps/worker/test/document-index.test.ts`

**Interfaces:**
- Consumes: the queries of Task 6, `IndexerClient` (Task 8), `Embedder` and `FakeEmbedder` (Task 7), `contextualize` (Task 2), `readAll` (`apps/worker/src/jobs/document-extract.ts`).
- Produces:
  - `documentIndex: JobHandler`, registered under `JobTypes.DOCUMENT_INDEX`. It returns `DocumentIndexResult = { outcome: "indexed"; revisionId; state: "complete" | "partial"; pages; chunks; ocrPages }`.
  - The new error codes `INDEXER_VERSIONS_CHANGED` and `INVALID_INDEXER_RESULT`.
  - `WARNING_CODES = {"OCR_FAILED", "OCR_BUDGET", "PAGE_UNREADABLE"}` (`NO_TEXT` is not one) and `EMBED_ROUND_BATCHES = 8`.

  The algorithm as built (`16880ac`, `adc51b8`, `51cffe9`):

```text
no indexer or embedder → JobFailure INDEXER_NOT_CONFIGURED (not retried)
document not found, not stored, or a duplicate → JobFailure INVALID_STATE (not retried)
deadline = start + INDEX_TIMEOUT_SECONDS; every indexer call gets AbortSignal.timeout(time left); past it → INDEX_TIMEOUT (retried)
a revision of this job that is no longer building → return its summary (no indexer call, no PDF read)
pdf = readAll(store, storageKey)            (OBJECT_MISSING if gone, not retried)
sha256 = document.content_sha256 ?? sha256(pdf)
versions = indexer.versions()               (failures kept to their code)
versions.tokenizer ≠ EMBEDDING_MODEL or embedder.model ≠ EMBEDDING_MODEL → INDEXER_MODEL_MISMATCH (not retried)
revision = startOrResumeRevision(job, { ...versions, indexVersion: INDEX_PIPELINE_VERSION, embeddingModel })
           (DOCUMENT_NOT_FOUND or JOB_NOT_FOR_DOCUMENT → INVALID_STATE); not building → return its summary
last = lastStoredPage(revision)             → next = last.pageNumber + 1, path = last.sectionPathAfter (or 1, [])
pageCount = revision.pageCount ?? the pageCount of the newest page_read of this sha256 in the workspace ?? null
for first = the range start holding `next`, stepping INDEX_PAGE_RANGE, while pageCount is null or first ≤ pageCount (and next ≤ pageCount):
    lastPage = pageCount null ? first + range − 1 : min(first + range − 1, pageCount)
    key = { sha256, first, lastPage, doclingVersion, ocrEngine, readerOptions }
    cached = pageCount null ? null : RangeRead.safeParse(getPageRead(key))   (an unparsable row is a miss)
    result = cached ? indexer.chunk({ read: cached, sectionPathBefore: path, embeddingModel })
                    : indexer.index({ pdf, first, lastPage, path, ocrPagesLeft: max(0, OCR_PAGE_BUDGET − pagesOcr) })
    result.started.versions ≠ versions (all five fields, tokenizer included) → INDEXER_VERSIONS_CHANGED (retried; the next attempt replaces the revision)
    result.started.pageCount ≠ assumed pageCount:
        a page already stored, or a second recount → INVALID_INDEXER_RESULT (not retried)
        else trust it once, store it with writeRange(…, [], [], counts); if the answer was cut short, read the range again
    pages not exactly first..min(lastPage, pageCount), or a chunk outside them → INVALID_INDEXER_RESULT (not retried)
    not cached and read.ocrOn and no PAGE_UNREADABLE page → putPageRead(key, read with U+0000 removed)
    writeRange(revision, pages ≥ next, their chunks (U+0000 removed from text and paths), counts, warnings ∩ WARNING_CODES)
        ocrPages = pages with itemsOcr > 0 or noneReason OCR_FAILED
    path = last page's sectionPathAfter; heartbeat; progress { stage: "reading", percent: ⌊pages done / pageCount × 90⌋ }
    embedPending(); log "index range stored" { firstPage, lastPage, cached, pages, chunks, ocrPages, embedded, seconds }
embedPending()                               (a retry after an embedder failure finds every page stored)
completeRevision(revision); progress { stage: "indexed", percent: 100 }; log "document indexed" { state, pages, chunks, ocrPages, warnings, seconds }
embedPending(): while chunksWithoutEmbedding(revision, model, EMBED_BATCH × 8) is not empty:
    longest contextualize(sectionPath, text) first, in batches of EMBED_BATCH; deadline checked before each batch
    embedder.embed(batch, "document")        (EmbedderError → EMBEDDING_FAILED, retryable; a count mismatch → EMBEDDING_FAILED)
    insertEmbeddings; heartbeat
```

A write that fails keeps the query's own code when it threw one (`INDEX_REVISION_NOT_FOUND`, `REVISION_DOCUMENT_MISMATCH`, `REVISION_NOT_BUILDING`, `CHUNK_NOT_IN_WORKSPACE`; retried). Any other write failure becomes an `Error` naming only the step and the SQLSTATE, because drizzle's message lists the parameters, page text and vectors included. An indexer failure is re-raised with its code and the range only, because an `error` event's message comes from the indexer.
Range bounds are fixed multiples of `INDEX_PAGE_RANGE` from page 1, so a resumed job asks for the same cache keys. When a page of a cached range is already stored (a crash between `writeRange` and the next range), `writeRange`'s `on conflict do nothing` keeps it once. Warnings are codes only (`OCR_FAILED`, `OCR_BUDGET`, `PAGE_UNREADABLE`). Logs: document id, revision id, range, counts, seconds; no worker log line gives the seconds of one embed call (Task 13 measures it directly).

- [x] **Step 1: Write the failing tests** with a fake `IndexerClient` (pages and chunks generated per range from a seeded "document" of N pages; it counts `index` and `chunk` calls and can be told to fail on a given range) and `FakeEmbedder`:

```ts
it("indexes a 45-page document in three ranges and completes the revision", async () => {
  // pages 1–20, 21–40, 41–45 requested in order; 45 document_page rows; every chunk has an embedding; revision complete; job succeeded
});
it("a failure in the third range keeps the first two and the next attempt starts at page 41", async () => {
  // fake fails range 41–45 once; after the retry: index() called for 41–45 only, no duplicate rows, same revision id
});
it("an embedder failure leaves the revision building, and the retry embeds only what is missing without reading again", async () => {
  // FakeEmbedder.fail(4); first attempt fails EMBEDDING_FAILED retryable; second attempt: no index() calls (pages stored), embed calls only for chunks without a vector
});
it("a rebuild reuses the page read cache: no page is read again", async () => {
  // index once; then a second job (new pipelineVersion) for the same document: zero index() calls, chunk() once per range
});
it("the section path carries across a range boundary and across a resume", async () => {
  // fake emits a heading on page 19 and none on 20–25; chunks on page 21 have it in sectionPath, also when the job resumed at 21
});
it("past OCR_PAGE_BUDGET the indexer is told no budget is left, and the revision is partial", async () => {
  // OCR_PAGE_BUDGET 30, every page scanned: ranges get ocrPagesLeft 30, 10, 0; pages past the budget carry OCR_BUDGET; revision partial with that warning
});
it("a range read with OCR off for the budget is not cached, so a rebuild reads it again with OCR", async () => {});
it("while a rebuild builds, the older complete revision is still the current one", async () => {
  // complete R1; start a second job that stops after one range; documentIndexCurrent → R1; finish it → R2 only
});
it("with no indexer configured the job fails INDEXER_NOT_CONFIGURED at once and is not retried", async () => {});
it("a duplicate document is refused", async () => {});
it("no page or chunk text reaches the logs", async () => { /* capture logger output; no fixture sentence in it */ });
```

As built the suite also has (`16880ac`, `6e7b0e1`, `adc51b8`, `51cffe9`):
- **Embedding:** "embeds the longest chunks of a batch first and embeds the section path with the text"; "the job's deadline covers embedding: past it, the next batch is not sent and the job fails INDEX_TIMEOUT".
- **Revisions and versions:** "a job whose revision is already complete returns its summary without calling the indexer"; "indexer versions that change mid-job fail INDEXER_VERSIONS_CHANGED, and the next attempt replaces the revision"; "an indexer whose tokenizer is not EMBEDDING_MODEL's fails INDEXER_MODEL_MISMATCH and is not retried".
- **Pages:** "a page Docling could not read makes the revision partial; a blank page does not"; "a stored PDF that is gone fails OBJECT_MISSING and is not retried".
- **Write failures:** three tests that a page, a cached read or vectors Postgres refuses fail with the SQLSTATE only, never the text or the vectors; "a query's own code is kept when a write is refused"; "U+0000 is taken out of page text, chunk text, section paths and the cached read".
- **Cache and page count:** "the first range of a short document is cached under its real bounds, found again by a resume and by a rebuild"; "an answer that is not exactly the pages asked for fails INVALID_INDEXER_RESULT and is not retried"; three page-count tests: too low corrected and read again, too high corrected without reading again, and a change after pages are stored fails `INVALID_INDEXER_RESULT`.

- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/document-index.test.ts` — FAIL.
- [x] **Step 3: Implement** `document-index.ts` and register it.
- [x] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.
- [x] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): document.index reads by page range, writes as it goes, caches reads, resumes, embeds in batches"
```

---

### Task 10: Search: `searchChunks` and the route

**Files:**
- Create: `packages/document-index/src/search.ts`; Modify: `packages/document-index/src/index.ts`, `packages/document-index/package.json` (`@maester/db`)
- Create: `apps/api/src/routes/search.ts`, `packages/contracts/src/search.ts` (`SearchHit`, `SearchResults`); Modify: `apps/api/src/app.ts` (the route, the embedder dep, `DrizzleQueryError` logging), `apps/api/src/env.ts`, `apps/api/src/server.ts` (the embedder), `apps/api/src/errors.ts` (`STATUS.SEARCH_UNAVAILABLE = 503`), `packages/contracts/src/common.ts` (`ErrorCode` gains `SEARCH_UNAVAILABLE`), `packages/contracts/src/index.ts`, `apps/api/package.json` (`@maester/document-index`), `apps/web/nginx.conf.template` (`access_log off` on the API proxy, `33ba436`)
- Test: `packages/document-index/test/search.test.ts`, `apps/api/test/search.test.ts`

**Interfaces:**
- Consumes: `Embedder` (Task 7), the tables (Task 6).
- Produces:
  - `AppDeps` gains `embedder: Embedder | null`. `server.ts` builds `new TeiEmbedder(EMBEDDER_URL, EMBEDDING_MODEL, { timeoutMs: 30_000, retries: 1 })` when `EMBEDDER_URL` is set (`3bfafc8`). `Env` (`apps/api/src/env.ts`) gains `EMBEDDER_URL` (optional URL) and `EMBEDDING_MODEL` (default the arctic model).
  - In `packages/contracts/src/search.ts`, as `z.strictObject`s:
    - `SearchHit { documentId: uuid; documentName; companyId: uuid | null; companyName: string | null; pageNumber: int ≥ 1 | null; element: string | null; sectionPath: string[]; textSource: TextSource; kind: ChunkKind; text: string; vectorRank: int ≥ 1 | null; keywordRank: int ≥ 1 | null }`;
    - `SearchResults { items: SearchHit[] }`.
  - Exported from `@maester/document-index`: `fuse`, `searchChunks`, `vectorBranchSql`, `keywordBranchSql` and the types `SearchInput`, `BranchInput` and `Fused`.
  - Constants: `BRANCH_LIMIT = 50`, `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50`, `RRF_K = 60`.
  - `fuse(vector: string[], keyword: string[], k = RRF_K): Fused[]`, where `Fused = { id; score; vectorRank: number | null; keywordRank: number | null }`. The first place of an id repeated in one ranking counts.: reciprocal rank fusion, score `Σ 1/(k + rank)` with ranks from 1, ties broken by the better vector rank, then the better keyword rank, then id.
  - `searchChunks(db: Db, embedder: Embedder, input: SearchInput): Promise<SearchHit[]>`, where `SearchInput = { workspaceId: string; query: string; limit?: number; companyId?: string; documentIds?: string[] }`:
    1. **Embed the query:** `embedder.embed([query], "query")`. No vector back is `EMBEDDING_FAILED`.
    2. **Vector branch, top 50.** The SQL comes from `vectorBranchSql(input: BranchInput, exact = false)`, with `BranchInput = { workspaceId; model; vector; companyId?; documentIds? }`, so the test can `explain` the same statement. It searches the workspace's chunks whose revision is complete or partial for `embedder.model` and whose embedding is for that model.
       - **Unfiltered**, in one transaction after `set local hnsw.ef_search = 100` and `set local hnsw.iterative_scan = relaxed_order`: a materialized CTE scans `chunk_embedding e` alone, `where e.model = $m and e.workspace_id = $ws`, and tests the revision in a correlated scalar subquery (`coalesce((select true from document_chunk c join document_index_revision r … where c.id = e.chunk_id and …), false)`), which the planner cannot pull up into a join. It orders by `e.embedding::halfvec(1024) <=> $q::halfvec(1024)`, with `limit 50`, and the outer query re-sorts by `distance, id`. An answer shorter than 50 (an iterative scan stops at `hnsw.max_scan_tuples`) is replaced by the exact statement (`6753aa0`).
       - **Filtered** by company or documents, and the exact statement: a join with `order by e.embedding <=> $q::vector, c.id`. The HNSW expression index does not serve it, so the filters apply first.
    3. **Keyword branch, top 50:** `keywordBranchSql(…)` computes `websearch_to_tsquery('simple', $query)` once in a cross join, keeps `c.tsv @@ q.tsq` with the same scope, and orders by `ts_rank(c.tsv, q.tsq) desc, c.id`. An empty tsquery gives no rows.
    4. **Hits:** `fuse`, then up to `limit` hits (`trunc`, clamped to 1–50; default 10), loaded with `document.original_name` and `company.display_name`, in fused order.
  - `GET /v1/workspaces/:ws/search?q=&limit=&company=` goes through the existing `requireWorkspace` for session and membership.
    - `q` must be 1–500 characters after trimming, `limit` 1–50 (default 10), and `company` a uuid; otherwise 400 `VALIDATION_FAILED`.     - No embedder, or an `EmbedderError`, is 503 `SEARCH_UNAVAILABLE` ("Search is not available right now."), logged with the trace id and the error code only.
    - A failed statement (`DrizzleQueryError`) is 500 `INTERNAL`, logged by name and SQLSTATE, never by its message, which holds the bound parameters.
    - The query is never logged.

- [x] **Step 1: Write the failing tests.** `search.test.ts` (database plus `FakeEmbedder`; chunk vectors seeded so the nearest neighbours are known): `fuse` on two hand-made rankings gives the hand-computed order and scores; a chunk found by both branches outranks one found by one; a chunk of a building revision, of another model or of another workspace is never returned; the exact SQL the unfiltered vector branch sends, run under `explain` with `set local enable_seqscan = off`, uses `chunk_embedding_hnsw`; a company filter returns only that company's chunks and runs without it (`explain` shows no `chunk_embedding_hnsw`); a CIN and a company name are found by the keyword branch exactly as printed; `limit` 60 is cut to 50. `apps/api/test/search.test.ts`: signed out → 401; a workspace the user is not a member of → 404 `NOT_FOUND` from `requireWorkspace`; `q` empty → 400; the embedder failing → 503 `SEARCH_UNAVAILABLE`; a seeded index returns hits with `pageNumber`, `sectionPath`, `textSource` and both ranks, and no hit carries a figure field. As built, also: a blank or over-500-character `q`, a bad `limit` and a bad `company` → 400; no embedder configured → 503; a failed statement → 500 `INTERNAL`, logging neither the query nor its parameters. `search.test.ts` also: "a short HNSW answer is completed by the exact scan" (a proxied transaction cuts the HNSW statement's answer to 3 rows; 50 hits come back); the plan tests run `explain` with `set local enable_seqscan = off` **and** `set local enable_sort = off`, so with a few dozen rows only an index that yields the order is left (`aede6d2`).
- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/document-index exec vitest run test/search.test.ts` and `pnpm --filter @maester/api exec vitest run test/search.test.ts` — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run both suites** — PASS.
- [x] **Step 5: Commit**

```bash
git add packages/document-index packages/contracts apps/api apps/web/nginx.conf.template
git commit -m "feat(search): hybrid searchChunks (HNSW halfvec and simple full-text, RRF k=60) and GET /v1/workspaces/:ws/search"
```

---

### Task 11: The backfill

**Files:**
- Create: `apps/worker/src/index-backfill.ts`, `apps/worker/src/index-backfill-cli.ts`; Modify: `apps/worker/package.json` (script `index:backfill`)
- Test: `apps/worker/test/index-backfill.test.ts`

**Interfaces:**
- Consumes: `documentsNeedingIndex` (Task 6), `createJob`, `maxAttemptsFor` (`@maester/jobs`), `indexPipelineVersion` (Task 7).
- Produces:
  - `interface BackfillOptions { workspaceId?: string; documentIds?: string[]; model: string; dryRun?: boolean }` and `interface BackfillCounts { created; requeued; waiting; current }`.
  - `requeue(db, dispatcher, job: JobRow) -> Promise<boolean>` queues a job again with a manual retry's terms (`apps/api/src/jobs/create.ts`). It sets `queued`, clears the lease, sets `max_attempts = attempt + maxAttemptsFor(type)`, clears `finished_at` and the progress, sets `run_after = now()`, then calls `dispatcher.enqueue`. Its `where` is `state in ('failed', 'succeeded')`, so a job claimed or retried since it was read keeps its lease, and `false` is returned (`dbbb3a0`).
  - `backfillIndex(db: Db, dispatcher: Dispatcher, opts: BackfillOptions) -> Promise<BackfillCounts>` takes each document from `documentsNeedingIndex`:
    - **No job:** `createJob`, as `chainIntake` does. It counts as created only if this call dispatched the job it inserted; otherwise as waiting.
    - **`queued` or `running`:** waiting.
    - **`failed` or `succeeded`** (a complete revision since removed): `requeue`, and requeued when it returns true, else waiting.
    - **Current:** the stored non-duplicate documents in scope that are not in the list, counted by id and not touched.
    - **`dryRun`:** counts without writing.
  - `runIndexBackfillOnce(argv, source = process.env, out = console, make = …) -> Promise<number>` is the CLI behind `pnpm --filter @maester/worker index:backfill [--workspace <id>] [--document <id>]… [--dry-run]`.
    - It runs on the host through `tsx --env-file=../../.env src/index-backfill-cli.ts`; the worker image bundles only `server.ts`.
    - It loads `WorkerEnv`, so the root `.env` needs `DATABASE_URL` (`localhost:5433`) and must not set `INDEXER_URL` without `INDEXER_SECRET`. It uses `EMBEDDING_MODEL` and dispatches with the worker's `createDispatcher`, which under `DISPATCH_MODE=queue` is a `QueueNotifier` (`NOTIFY job_ready`).
    - It prints one line, `[dry run: ]created N, requeued N, waiting N, current N`, and exits 0.
    - An unknown flag, a bad env, or a database failure exits 1 with one line. The database line is `index backfill failed: the database could not be read or written`, with no query text.
    - It enqueues and never runs the work itself; the worker's queue loop does, one job at a time.

- [x] **Step 1: Write the failing tests:** a stored document with no job gets one; one whose job failed `INDEXER_NOT_CONFIGURED` is queued again with `run_after <= now()` and the notifier called; a queued one is left alone; a duplicate, a rejected and an indexed document are skipped; `--workspace` and `--document` limit it; `dryRun` writes nothing; running it twice creates nothing the second time. As built, also: a succeeded job whose index is gone is queued again; a job claimed since it was read is not overwritten; a document indexed under another model is not counted as current; the current count is scoped by workspace and document; the CLI prints the four counts and exits 0, exits 1 with one line free of query text when the database fails, and exits 1 on an unknown flag.
- [x] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/index-backfill.test.ts` — FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run to see them pass** — PASS.
- [x] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): index backfill enqueues or requeues document.index for every stored document without a current index"
```

---

### Task 12: Compose, the memory budget, CI and documentation

**Files:**
- Modify: `docker-compose.yml`, `.env.example`
- Create: `.github/workflows/indexer.yml`
- Create: `docs/systems/indexer.md`; Modify: `docs/systems/worker.md`, `docs/systems/api.md`, `docs/systems/maester.md`, `docs/systems/packages.md` (the `document-index` package), `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `docs/README.md`, `apps/indexer/README.md`

**Interfaces:**
- Produces, in `docker-compose.yml`:
  - `models` (profile `setup`, image `maester/indexer:local`, `command: ["maester-indexer-fetch-models", "--out", "/models"]`, `HF_HUB_OFFLINE: "0"` (the image sets 1), volume `models:/models`): the one service that fetches, run once with `docker compose --profile setup run --rm models`.
  - `indexer`: build `apps/indexer/Dockerfile` (image `maester/indexer:local`), port `8791:8791`, `PORT: 8791`, `INDEXER_SECRET: local-indexer-secret`, `DOCLING_ARTIFACTS_PATH: /models/docling`, `INDEX_TOKENIZER_PATH: /models/embed/Snowflake/snowflake-arctic-embed-l-v2.0`, `INDEX_THREADS: 6`, `INDEX_PAGE_BATCH: 4`, `HF_HUB_OFFLINE: 1`, `models:/models:ro`, `mem_limit: 2304m`, `cpus: 8`, `restart: unless-stopped` (`df79e11`). The healthcheck runs a Python `urllib` call on `/healthz` every 10 s, timeout 5 s, 12 retries, `start_period: 120s`. `EMBEDDING_MODEL` is not set, so the indexer's default (the arctic model) applies.
  - `embedder`: image `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`, `command: ["--model-id", "/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0", "--max-client-batch-size", "32", "--port", "80"]`, `HF_HUB_OFFLINE: 1`, `models:/models:ro`, port `8792:80`, `mem_limit: 2560m`, `cpus: 8`, `restart: unless-stopped`. The healthcheck is `["CMD", "curl", "-fsS", "http://127.0.0.1:80/health"]` with the same timings; Task 13 checks that the image has `curl`.
  - `x-api-env` (shared by `migrate`, `api` and `worker`): `EMBEDDER_URL: http://embedder`, `EMBEDDING_MODEL: ${EMBEDDING_MODEL:-Snowflake/snowflake-arctic-embed-l-v2.0}`. The `worker` adds `INDEXER_URL: http://indexer:8791` and `INDEXER_SECRET: local-indexer-secret`. Neither the API nor the worker `depends_on` the indexer or the embedder: until they answer, index jobs back off and search answers 503.
  - Postgres `command: ["postgres", "-c", "shared_buffers=256MB", "-c", "maintenance_work_mem=512MB"]` (`shm_size` stays 1 GB, at least `maintenance_work_mem`).
  - Memory and CPU limits (`mem_limit`, `cpus`) within the 7.75 GiB VM. Four services are capped (postgres, embedder, indexer, web); the worker, the extractor and the API get `cpus: 2` and no `mem_limit` until Task 13 measures them:

| Service | `mem_limit` | `cpus` | Why |
| --- | --- | --- | --- |
| postgres | 1g | 2 | Records, queue, vectors; an HNSW build needs `maintenance_work_mem` (rebuilds want 1–2 GB: raise Docker's limit first) |
| embedder | 2560m | 8 | arctic in fp32 is about 2.3 GB |
| indexer | 2304m | 8 | Docling's peak is unpublished; one job at a time, 20-page ranges, page batch 4 |
| extractor | no limit until measured | 2 | Gemini calls; holds whole PDFs |
| api | no limit until measured | 2 | |
| worker | no limit until measured | 2 | Holds a whole PDF per running job: up to 2 extract, 2 classify and 1 index at 50 MB each, briefly doubled while the buffer is built |
| web | 96m | 1 | nginx |
| capped total | 5.9 GiB | | Leaves about 1.8 GiB for the three uncapped services and the VM; Docker Desktop's limit can be raised to 12 GB (§19) before a backfill |

  - `.github/workflows/indexer.yml`: on changes under `apps/indexer/**` or `packages/contracts/fixtures/index/**`; uv 0.11.17, Python 3.12, `uv sync --locked` in `apps/indexer`, `actions/cache` on `~/.cache/maester/docling` keyed by `hashFiles('apps/indexer/uv.lock', 'apps/indexer/models.lock.json')` (`83a81e6`), `uv run maester-indexer-fetch-models --out ~/.cache/maester --docling-only` when the cache missed, then `MAESTER_DOCLING_MODELS="$HOME/.cache/maester/docling" uv run python -m unittest discover -s tests -v`. It also runs on changes to `.github/workflows/indexer.yml`, with actions pinned by commit. Free downloads only; no secret is used.

- [x] **Step 1: Write the compose and CI changes.**
- [x] **Step 2: Check them without starting anything** — `docker compose config --quiet && docker compose --profile setup config --services | grep -x models` — exit 0; `docker compose config | grep -c mem_limit` gives 4.
- [x] **Step 3: Write the documentation** in STE: `docs/systems/indexer.md` (what the service does, its two routes and events, the settings table, the pinned versions and where they are recorded, how weights are fetched, what is logged); `worker.md` (`document.index`: ranges, the cache, resume, the OCR budget, the backfill command, the errors of §15 it raises); `api.md` (the search route, 503); `maester.md` and `ARCHITECTURE.md` (five services); `DEVELOPMENT.md` (first setup: `docker compose build indexer`, `docker compose --profile setup run --rm models`, then `up`; recreating Postgres on the pgvector image with `docker compose up -d --force-recreate postgres`; the memory table; raising Docker Desktop's limit to 12 GB; running the indexer's tests with and without models); `packages.md` (`@maester/document-index`); the indexer's error codes in `indexer.md`, including that picture-only pages read `OCR_FAILED` or `OCR_BUDGET` (`a51766c`, `eb4ce6a`).
- [x] **Step 4: Check links and the workspace** — `uv run --locked python scripts/check_workspace.py` — `Workspace OK`; and `pnpm -r --filter "./apps/*" --filter "./packages/*" exec vitest run` — PASS.
- [x] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example .github/workflows/indexer.yml docs apps/indexer/README.md
git commit -m "feat(compose): indexer, embedder and model setup services with a memory budget; indexer CI; docs"
```

---

### Task 13: The live check and the backfill, the investor's runbook

The investor runs this on their own machine, from the main checkout at `/Users/himanshu/Personal/maester-chatbot` after #13 merges into `staging`, never from a worktree, and only once they say go. Nothing in it calls a paid model.
- It uploads nothing, so no classification starts.
- The backfill only enqueues `document.index` for documents already stored.
- Indexing runs on the local indexer and embedder.

Step 3 stops if earlier paid jobs are still queued.

Three rules hold for the whole run:
- Never run `docker compose down -v`: it deletes the `pgdata` volume.
- Upload nothing while it runs.
- Keep notes and measurements in `~/maester-index-run`.

**Files** (changed only in Step 11, on a branch):
- Modify: `docker-compose.yml` (seven `mem_limit`s and the header comment), `docs/DEVELOPMENT.md` (the memory budget, measured), `apps/indexer/README.md` (the indexer's limit), `docs/systems/indexer.md` (the CAUTION line, in STE), `.env.example` (`INDEX_TIMEOUT_SECONDS` is the whole job, not one request).
- Only if Step 6's fallbacks apply: `apps/indexer/src/maester_indexer/fetch_models.py`, `apps/indexer/tests/test_fetch_models.py`, the embedder's healthcheck in `docker-compose.yml`.

**Interfaces:**
- Consumes everything Tasks 1–12 built:
  - the compose services `postgres`, `migrate`, `models` (profile `setup`), `indexer`, `embedder`, `worker`, `api`, `extractor` and `web`;
  - `pnpm --filter @maester/worker index:backfill [--workspace <id>] [--document <id>]… [--dry-run]`, which prints `[dry run: ]created N, requeued N, waiting N, current N`;
  - the worker's log lines `index range stored` and `document indexed`, which use pino's `message` key;
  - `GET /v1/workspaces/:ws/search`;
  - `EMBED_BATCH` 16 and `EMBED_TIMEOUT_SECONDS` 300.
- Produces:
  - measured `mem_limit`s for all seven services;
  - a measured memory table in `docs/DEVELOPMENT.md`;
  - an index for every stored, non-duplicate document in the investor's workspace.

Shell helpers, set in every terminal used below:

```bash
cd /Users/himanshu/Personal/maester-chatbot
pg() { docker compose exec -T postgres psql -U maester -d maester -v ON_ERROR_STOP=1 "$@"; }
WS=<the investor's workspace id>     # from Step 3
```

- [ ] **Step 1: Prepare the checkout and Docker.**

```bash
cd /Users/himanshu/Personal/maester-chatbot
git status --short                  # must be empty; commit or move work first
git switch staging && git pull --ff-only
git log --oneline -3                # the merge of PR #13 is there
pnpm install                        # the host-side backfill needs @maester/document-index
mkdir -p ~/maester-index-run
grep -E '^(DATABASE_URL|DISPATCH_MODE|INDEXER_URL|INDEXER_SECRET|EMBEDDING_MODEL|GOOGLE_CLOUD_PROJECT)=' .env
docker info --format '{{.MemTotal}}'
```

Expected:
- **`.env`:** `DATABASE_URL=postgres://maester:maester@localhost:5433/maester` and `DISPATCH_MODE=queue` (`local` reads as `queue`).
  - `EMBEDDING_MODEL` is unset or `Snowflake/snowflake-arctic-embed-l-v2.0`; any other value gives the backfill a different pipeline version from the worker.
  - `INDEXER_URL` is unset, or set together with `INDEXER_SECRET`; otherwise the backfill CLI refuses to start.
  - Note whether `GOOGLE_CLOUD_PROJECT` is set: it decides whether Step 3's guard matters.
- **Docker:** raise Docker Desktop's memory to 12 GB (Settings, Resources) and restart Docker before going on. `MemTotal` then reads about 12 GB (12884901888 bytes or a little less). Record it in `~/maester-index-run/notes.md`.

- [ ] **Step 2: Recreate `maester-postgres-1` on `pgvector/pgvector:pg16`, keeping its volume.** On 20 Oct 2026 the container was `postgres:16`, stopped, with the volume `maester_pgdata`, and there was no `maester_models` volume yet.

```bash
docker start maester-postgres-1     # it was stopped (exited) on 20 Oct 2026
until docker exec maester-postgres-1 pg_isready -U maester -q; do sleep 1; done
docker inspect maester-postgres-1 --format '{{.Config.Image}}'
docker inspect maester-postgres-1 --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}'
docker exec maester-postgres-1 pg_dump -U maester -d maester -Fc > ~/maester-index-run/before-pgvector.dump
ls -lh ~/maester-index-run/before-pgvector.dump
docker exec maester-postgres-1 psql -U maester -d maester -Atc "select count(*) from document" | tee ~/maester-index-run/documents-before.txt
```

Expected:
- **Image:** `postgres:16`. Stop if it is anything else (an `-alpine` tag, or another major version). A different C library or major version needs a dump and restore, not a recreate.
- **Mount:** `maester_pgdata -> /var/lib/postgresql/data` (beside the `init.sql` bind mount).
- **Dump:** not empty.

Then recreate the container only:

```bash
docker compose pull postgres
docker compose up -d --force-recreate --no-deps postgres
docker inspect maester-postgres-1 --format '{{.Config.Image}}'
docker compose logs --tail 20 postgres
pg -Atc "select default_version from pg_available_extensions where name = 'vector'"
pg -Atc "select count(*) from document"
pg -Atc "show shared_buffers" -c "show maintenance_work_mem"
```

Expected:
- **Image:** `pgvector/pgvector:pg16`.
- **Log:** ends with "database system is ready to accept connections".
- **Checks:** one `vector` version, 0.8 or later; the same document count as `documents-before.txt`; `256MB` and `512MB`.

If the log says the data files are incompatible, stop. Leave the volume alone, and restore `before-pgvector.dump` with `pg_restore` into a fresh database only after the investor decides.

- [ ] **Step 3: Guard against paid calls before the worker starts.** Starting the worker resumes every queued job, and the sweeper requeues any whose lease ran out.

```bash
pg -c "select type, state, count(*) from job where state in ('queued', 'running') group by 1, 2 order by 1, 2"
pg -c "select id, name from workspace"
```

Expected: no `document.verify`, `document.classify` or `document.extract` row, and no `document.index` row yet. A queued classify or extract job calls Gemini when `GOOGLE_CLOUD_PROJECT` is set, and a verify chains a classify. If any are listed, stop and ask the investor whether to let them run before going on. Set `WS` to the investor's workspace id from the second query.

- [ ] **Step 4: Build the images and fetch the models.**

```bash
docker compose build
docker compose pull embedder
docker volume ls --format '{{.Name}}' | grep -x maester_models || echo "no models volume yet"
docker compose --profile setup run --rm models
docker compose --profile setup run --rm models sh -c 'ls /models; ls /models/embed/Snowflake/snowflake-arctic-embed-l-v2.0; du -sh /models/docling /models/embed'
```

Expected:
- **Build:** `maester/indexer:local` among the images, about 2.7 GB. Before the fetch, "no models volume yet".
  - The volume must first be mounted by `models`, whose image owns `/models` as `app`. If the volume already exists and the fetch fails with a permission error, another container created it as root. Run `docker volume rm maester_models`, which holds only downloadable weights, and fetch again.
- **Fetch:** ends with `models are in /models`.
- **`/models`:** holds `docling`, `embed` and `models.lock.json`.
- **The arctic folder:** holds `config.json`, `config_sentence_transformers.json`, `modules.json`, `1_Pooling`, `model.safetensors`, `sentencepiece.bpe.model`, `special_tokens_map.json`, `tokenizer.json` and `tokenizer_config.json`, and no `onnx` folder.
- **Size:** `embed` is about 2.3 GB.

- [ ] **Step 5: Start the stack and check the migration.**

```bash
docker compose up -d
docker compose ps
docker compose logs migrate | tail -5
pg -Atc "select extversion from pg_extension where extname = 'vector'"
pg -Atc "select count(*) from pg_indexes where indexname in ('chunk_embedding_hnsw', 'document_chunk_tsv', 'document_index_current')"
curl -fsS http://localhost:8791/healthz
```

Expected:
- **Migration:** `migrate` exited 0, and its log shows no error. The checks print a `vector` version and `3`.
- **Health:** within about two minutes (`start_period: 120s`), `docker compose ps` shows `indexer` and `embedder` healthy, with `api`, `worker`, `extractor` and `web` up. The indexer answers `{"status":"ok"}`.

- [ ] **Step 6: Check that the embedder starts from safetensors and that its healthcheck tool exists.**

```bash
docker compose logs embedder 2>&1 | grep -inE 'safetensors|onnx|backend|ready|error' | head -20
docker compose exec embedder sh -c 'command -v curl || echo "no curl"'
curl -fsS http://localhost:8792/health && echo " health ok"
curl -s http://localhost:8792/info; echo
docker inspect maester-embedder-1 --format '{{.State.Health.Status}} restarts={{.RestartCount}}'
```

Expected:
- **Log:** TEI loads the model from `/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0`, says it is ready, and shows no error naming `model.onnx`.
- **`curl`:** `command -v curl` prints a path.
- **`/info`:** names the model folder, with `max_client_batch_size` 32 and `max_input_length` at least 512.
- **Health:** `healthy restarts=0`.

**Fallback A: TEI cannot start from safetensors.** The log names `onnx/model.onnx`, or the embedder keeps restarting. Fetch the fp32 ONNX files too, on the Step 11 branch (`git switch -c chore/index-memory-limits staging` now).
1. In `fetch_models.py`, set the two pattern lists:

   ```python
   EMBED_ALLOW_PATTERNS = ("*.json", "*.safetensors", "sentencepiece.bpe.model", "vocab.txt", "merges.txt", "onnx/model.onnx", "onnx/model.onnx_data")
   EMBED_IGNORE_PATTERNS = ("onnx/model_*", "onnx/*.json", "openvino/*")
   ```

   An ignore pattern beats an allow pattern in `snapshot_download`, so `onnx/*` must go; the remaining patterns still leave out `model_O4`, `model_bnb4`, `model_fp16`, `model_int8`, `model_q4`, `model_q4f16`, `model_quantized` and `model_uint8`.
2. In `test_fetch_models.py`, add `"onnx/model.onnx"` and `"onnx/model.onnx_data"` to the expected set, and rename the test `test_fetches_what_tei_and_the_tokenizer_load_and_only_the_fp32_onnx`.
3. Run `cd apps/indexer && uv run python -m unittest tests.test_fetch_models -v` and expect PASS. Then `docker compose build indexer && docker compose --profile setup run --rm models && docker compose up -d --force-recreate embedder`, and repeat this step's checks. The models volume grows by the size of the two ONNX files.
4. Commit: `fix(indexer): the fetch takes the embedding model's fp32 ONNX files, which TEI starts from`.

**Fallback B: no `curl` in the image** (the container reads `unhealthy` while `curl http://localhost:8792/health` from the host answers). Nothing `depends_on` the embedder's health, so this only changes what `docker compose ps` shows. On the Step 11 branch:
- If `docker compose exec embedder sh -c 'command -v bash head'` prints two paths, set the embedder's test to:

  ```yaml
  test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/80 && printf 'GET /health HTTP/1.0\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q ' 200 '"]
  ```

- Otherwise, set `healthcheck: { disable: true }`, with a comment that the worker and the API handle an absent embedder.

Then `docker compose up -d --force-recreate embedder`, and expect `healthy`, or no health status with `disable`. Commit: `fix(compose): the embedder's healthcheck uses a tool its image has`.

- [ ] **Step 7: Index a sample of three documents.** List the candidates:

```bash
pg -v ws="$WS" <<'SQL'
select d.id, d.original_name, round(d.size_bytes / 1048576.0, 1) as mb, c.kind, d.intake_state
from document d
left join lateral (select kind from document_classification dc where dc.document_id = d.id order by dc.created_at desc limit 1) c on true
where d.workspace_id = :'ws' and d.state = 'stored' and d.intake_state is distinct from 'duplicate'
order by d.size_bytes;
SQL
```

Pick three documents and record their ids in `notes.md`:
- a short results filing (`financial_results`, a few pages);
- a scanned filing (the investor knows one; a large file for its page count is a hint);
- an annual report of about 300 pages.

```bash
pnpm --filter @maester/worker index:backfill --workspace "$WS" --dry-run
```

Expected: `dry run: created N, requeued 0, waiting 0, current 0`, where N is the number of rows listed above.

In a second terminal, start sampling memory every 30 seconds, and leave it running until Step 12 ends:

```bash
while true; do docker stats --no-stream --format "$(date +%FT%T),{{.Name}},{{.MemUsage}},{{.CPUPerc}}" >> ~/maester-index-run/stats.csv; sleep 30; done
```

Enqueue the three documents one at a time, the annual report first. `claimNext` (`apps/worker/src/lease.ts`) takes the oldest ready job, by `run_after` and then `created_at`, so they run in this order. Step 8 needs the annual report's chunks before the scanned filing is read. Then follow the worker:

```bash
pnpm --filter @maester/worker index:backfill --workspace "$WS" --document <annual report>
pnpm --filter @maester/worker index:backfill --workspace "$WS" --document <scanned>
pnpm --filter @maester/worker index:backfill --workspace "$WS" --document <short>
docker compose logs -f --no-log-prefix worker | grep --line-buffered -E '"message":"(index range stored|document indexed)"' | tee -a ~/maester-index-run/worker-index.log
```

Expected:
- **Backfill:** each call prints `created 1, requeued 0, waiting 0, current 0`.
- **Worker log:** one `index range stored` line per 20-page range, with `firstPage`, `lastPage`, `cached`, `pages`, `chunks`, `ocrPages`, `embedded` and `seconds`, then one `document indexed` line per document, with `state`, `pages`, `chunks`, `ocrPages`, `warnings` and `seconds`. The worker runs one index job at a time.
- **`partial`:** an annual report ending `partial` with an `OCR_FAILED` warning is expected. A picture-only page (a cover photo, a chart) reads `OCR_FAILED`, and is not a fault.

Check the jobs:

```bash
pg -c "select subject_id, state, attempt, last_error_code, progress, finished_at - started_at as took from job where type = 'document.index' order by created_at"
```

Done when all three are `succeeded`. A `failed` job with `INDEXER_UNAVAILABLE`, `INDEX_STREAM_INTERRUPTED` or `EMBEDDING_FAILED` means a service went down: check Step 9's OOM line, then run the same `--document` command again, which requeues it.

- [ ] **Step 8: Measure embed seconds per batch against `EMBED_TIMEOUT_SECONDS` (300).** No log line gives one embed call's time (`index range stored` adds reading and embedding together), so time a worst-case batch directly. Once the annual report is indexed (its `document indexed` line is in `worker-index.log`) and while the scanned filing is being read (OCR is the heaviest CPU load), build a batch of `EMBED_BATCH` (16) of the longest stored chunks, embedded as the worker embeds them (`contextualize`: the path's entries, one per line, then the text). Check the batch is a real worst case before timing it:

```bash
pg -At -c "select json_build_object('inputs', json_agg(t), 'normalize', true, 'truncate', false) from (select case when cardinality(section_path) = 0 then text else array_to_string(section_path, E'\n') || E'\n' || text end as t from document_chunk order by token_count desc limit 16) s" > ~/maester-index-run/batch16.json
pg -Atc "select count(*), max(token_count), min(token_count) from (select token_count from document_chunk order by token_count desc limit 16) s"
python3 -c 'import json, os; print(len(json.load(open(os.path.expanduser("~/maester-index-run/batch16.json")))["inputs"]))'
time_batch() { for i in 1 2 3; do curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -H 'content-type: application/json' --data-binary @"$HOME/maester-index-run/batch16.json" http://localhost:8792/embed; done; }
time_batch | tee -a ~/maester-index-run/embed-times.txt     # while the scanned filing is being read (indexer CPU high in docker stats)
```

When the sample is done and nothing runs, run `time_batch | tee -a ~/maester-index-run/embed-times.txt` again, then `rm ~/maester-index-run/batch16.json`, which holds filing text.

Expected: `16` rows with a `max` near the chunk budget (about 448 to 510 tokens), and `16` inputs. If there are fewer, or the longest are short, wait for more of the corpus before timing. Then every line `200`. The slowest time is the figure to keep. It must stay under a third of `EMBED_TIMEOUT_SECONDS` (100 s), so a slower CPU moment does not time a batch out; a timed-out batch fails the job's attempt, because the worker does not resend it. If the slowest batch is over 100 s, add `EMBED_BATCH: 8` to the worker's `environment` in Step 11 and time a batch of 8 (`limit 8`). Raise `EMBED_TIMEOUT_SECONDS` only if a batch of 8 is still over.

- [ ] **Step 9: Record the sample and the memory peaks.**

```bash
pg <<'SQL'
select r.document_id, r.state, r.page_count, r.pages_read, r.pages_ocr, r.warnings,
       (select count(*) from document_chunk c where c.revision_id = r.id) as chunks,
       (select count(*) from chunk_embedding e join document_chunk c on c.id = e.chunk_id where c.revision_id = r.id) as embedded,
       extract(epoch from r.completed_at - r.created_at)::int as seconds
from document_index_revision r order by r.created_at;
SQL
awk -F, '{split($3, u, " / "); v = u[1]; n = v + 0; if (v ~ /GiB/) n *= 1024; else if (v ~ /KiB/) n /= 1024; else if (v !~ /MiB/) n /= 1048576; if (n > max[$2]) max[$2] = n} END {for (s in max) printf "%-24s %6.0f MiB\n", s, max[s]}' ~/maester-index-run/stats.csv | sort
for s in postgres embedder indexer worker extractor api; do v=$(docker compose exec -T "$s" cat /sys/fs/cgroup/memory.peak 2>/dev/null) && echo "$s $((v / 1048576)) MiB peak" || echo "$s no memory.peak"; done
for c in $(docker compose ps -q); do docker inspect "$c" --format '{{.Name}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}'; done
```

Expected:
- **Revisions:** three rows, `complete` or `partial`, with `chunks` equal to `embedded`.
- **Peaks:** one peak per container from `stats.csv`. Where cgroup v2 exposes it, also the kernel's peak since the container started (`memory.peak`), which catches a spike between two samples.
- **OOM:** `oom=false restarts=0` for every container.
- **Record:** write in `notes.md`, for each document, its pages, OCR pages, chunks, seconds, the per-range seconds from `worker-index.log` (reading and embedding that range together), and its state and warnings. Also write each service's peak, the larger of the two readings.
- **If the indexer was OOM-killed** (`oom=true` or `restarts` over 0):
  1. Set `INDEX_PAGE_BATCH: 2` in the indexer's environment.
  2. Run `docker compose up -d indexer`.
  3. Requeue that document with `--document`.
  4. Measure again.
  5. If it is still killed, also set `INDEX_PAGE_RANGE: 10` in the worker's environment.

- [ ] **Step 10: Search, and search without the embedder.** Sign in at `http://localhost:5173`, then open in the same browser `http://localhost:5173/v1/workspaces/<WS>/search?q=borrowings` (nginx proxies `/v1` to the API with the first-party session cookie). Then open the same address with `q` set to a CIN and to a company name from the sample. A curl alternative is `curl -s -b 'maester.session_token=<value from the browser>' "http://localhost:8787/v1/workspaces/$WS/search?q=borrowings" | python3 -m json.tool | head -40`.

Expected:
- **Hits:** `{"items":[…]}` with up to 10 hits. Each has `documentId`, `documentName`, `pageNumber`, `sectionPath`, `textSource`, `kind`, `text`, `vectorRank` and `keywordRank`, and none carries a figure field.
- **Keyword branch:** the CIN and the company name come back with a `keywordRank`.

Then, only when no index job is queued or running (`pg -Atc "select count(*) from job where type = 'document.index' and state in ('queued', 'running')"` prints `0`), because stopping the embedder under a running job uses up its attempts:

```bash
docker compose stop embedder
# reload the search address: 503 with {"error":{"code":"SEARCH_UNAVAILABLE","message":"Search is not available right now.",…}}
docker compose start embedder
docker compose logs api web | grep -c borrowings      # 0: no query reaches a log line
```

- [ ] **Step 11: Set the measured limits, on a branch.** Run `git switch -c chore/index-memory-limits staging`, or stay on it if Step 6 created it. In `docker-compose.yml`, set:
- **`postgres`, `embedder` and `indexer`:** `mem_limit` = the measured peak × 1.2, rounded up to a multiple of 64 MiB, written in `m`.
- **`worker`, `extractor` and `api`:** a new `mem_limit` = the measured peak × 1.2 + 400 MiB, rounded up the same way. This run started no extract or classify job and no upload, so their peaks are idle peaks (the API served only search). The 400 MiB covers what the code allows the worker and the extractor on top: up to 2 extract and 2 classify jobs, each holding a PDF of up to 50 MB (`EXTRACT_MAX_BYTES`), held twice while its buffer is built. The API gets the same headroom until an upload is measured.
- **`web`:** stays at `96m`.
- **The header comment:** update "the capped services … no cap until measured" to the seven measured limits.
- **The total:** the seven limits together must stay at least 0.8 GiB under `MemTotal` from Step 1. If they do not, lower `INDEX_PAGE_BATCH` first and measure the indexer again.

```bash
docker compose config --quiet && docker compose config | grep -c mem_limit
docker compose up -d
```

Expected: `7`, then the changed services recreated and healthy.

Write the measured table into `docs/DEVELOPMENT.md` under "Memory budget". For each service, give the measured peak, its `mem_limit`, `cpus` and how it was measured (sampled `docker stats` and `memory.peak`, the date, the three sample documents by kind, pages and OCR pages, and the slowest embed batch). Mark the worker, extractor and API rows "idle peak; not measured under extraction". Replace "These limits are a first budget; the measured run (Task 13 of the phase 2 plan) adjusts them." with a sentence giving the date of the measured run. Also:
- In `apps/indexer/README.md`, set "limit 2304 MiB" to the new limit.
- In `docs/systems/indexer.md`, set the CAUTION line "The container limit is 2304 MiB." to the new limit, in STE.
- In `.env.example`, change the `INDEX_TIMEOUT_SECONDS` comment from "seconds one request may take" to "seconds the whole index job may take".

```bash
uv run --locked python scripts/check_workspace.py        # Workspace OK
git add docker-compose.yml docs/DEVELOPMENT.md apps/indexer/README.md docs/systems/indexer.md .env.example
git commit -m "chore(compose): memory limits from the measured index run"
gh-help                                                    # then push the branch and open a PR into staging
```

- [ ] **Step 12: Backfill the rest, and know when it is done.**

```bash
pnpm --filter @maester/worker index:backfill --workspace "$WS" --dry-run
pnpm --filter @maester/worker index:backfill --workspace "$WS"
```

Expected: `created N−3, requeued 0, waiting 0, current 3`. The whole corpus takes days of CPU (§19); the worker runs one document at a time. Keep the `docker stats` loop running. Look once a day:

```bash
pg -v ws="$WS" <<'SQL'
select state, count(*) from job where type = 'document.index' and workspace_id = :'ws' group by 1 order by 1;
select last_error_code, count(*) from job where type = 'document.index' and workspace_id = :'ws' and state = 'failed' group by 1 order by 2 desc;
SQL
for c in $(docker compose ps -q); do docker inspect "$c" --format '{{.Name}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}'; done
```

How to read a `failed` job:
- **Retryable codes** (`INDEXER_UNAVAILABLE`, `INDEX_STREAM_INTERRUPTED`, `INDEX_TIMEOUT`, `EMBEDDING_FAILED`, `INDEXER_VERSIONS_CHANGED`) used up their attempts while a service was down. Run the backfill again; it requeues them.
- **Codes that are not retried** (`UNREADABLE_PDF`, `INVALID_INDEXER_RESULT`, `INDEXER_MODEL_MISMATCH`, `OBJECT_MISSING`, `INVALID_STATE`, and `INDEX_FAILED` on a range past the end or a chunk over the budget) are a fact about that file or a bug. List them for the investor, and do not requeue them in a loop.
- **A restart count** that grows on the indexer or the embedder means its limit is too low. Raise it on the branch, and go back to Step 9.

Done when this query returns 0 for the investor's workspace, or every document it still counts has a `failed` job with a code that is not retried and that the investor has looked at:

```bash
pg -v ws="$WS" <<'SQL'
select count(*) from document d
where d.workspace_id = :'ws' and d.state = 'stored' and d.intake_state is distinct from 'duplicate'
  and not exists (select 1 from document_index_revision r
                  where r.document_id = d.id and r.embedding_model = 'Snowflake/snowflake-arctic-embed-l-v2.0'
                    and r.state in ('complete', 'partial'));
select state, count(*) from document_index_revision where workspace_id = :'ws' group by 1;
select count(*) from document_chunk c join document_index_revision r on r.id = c.revision_id
where r.workspace_id = :'ws' and r.state in ('complete', 'partial')
  and not exists (select 1 from chunk_embedding e where e.chunk_id = c.id and e.model = r.embedding_model);
SQL
```

Expected:
1. `0`.
2. Only `complete` and `partial` rows; a `building` row exists only while a job runs.
3. `0`: no chunk of a current revision is without its vector.

Then stop the `docker stats` loop, and add the corpus totals (documents, pages, OCR pages, chunks, days) to the PR from Step 11.

---

## After this plan

Phase 3 measures the index from these tables: the OCR spot check (RapidOCR against Tesseract 5 on ten scanned pages) and the retrieval set (recall at 5 and 10 and MRR by text source, for vectors, keywords and hybrid, per candidate model). A model or OCR change is a new `EMBEDDING_MODEL` or reader version, which the cache and `indexPipelineVersion` already key on. Phase 4 adds XBRL text blocks as chunks with `text_source = 'xbrl'` and an `element`, and the `pipeline.text` object reads `document_index_revision`.
