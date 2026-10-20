# Ingestion phase 2: the document index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stored document gets a text index: its pages read by Docling (text layer and local OCR), split into passages that keep their page, embedded by a local model and stored in pgvector, so `searchChunks` and `GET /v1/workspaces/:ws/search` return the passages and pages that answer a question.

**Architecture:** Two new services. The **indexer** (Python, FastAPI, Docling pinned, RapidOCR on onnxruntime set explicitly) reads one page range per request and streams NDJSON pages and chunks; it also re-chunks a cached read. The **embedder** is text-embeddings-inference with no code of ours. The worker's `document.index` job (subject type `document_index`, limit 1) drives the ranges, writes pages and chunks per range and embeddings per batch, so a failure loses one range or one batch; Docling's reads are cached in `page_read`, so a retry or a rebuild never reads or OCRs a page twice. Search is hybrid: an HNSW cosine branch over `halfvec` and a `simple` full-text branch, fused by reciprocal rank.

**Tech Stack:** Python 3.12, FastAPI, Docling, docling-core's HybridChunker, RapidOCR on onnxruntime, uv; text-embeddings-inference `cpu-arm64-1.9` with `Snowflake/snowflake-arctic-embed-l-v2.0`; TypeScript, Drizzle and drizzle-kit, pgvector 0.8 on `pgvector/pgvector:pg16`, Hono, Zod, Vitest; Docker Compose.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §5, §8, §13, §15, §16 phase 2, §17 and §19. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §1 (pgvector, hybrid search), §2 (Docling, RapidOCR, chunking), §3 (the embedding model, TEI) and §6 (memory). Builds on the [phase 1 plan](2026-10-19-ingestion-phase-1-runner.md).

## Where this plan departs from the spec, and why

1. **The query is embedded by the embedder, not the indexer.** §8.5 step 1 says "through the indexer"; §5 and §8.4 say the API posts one query to the embedder. The embedder is right: the indexer has no model loaded.
2. **The worker drives the page ranges.** §8.1 has the indexer read in ranges inside one request. Here the worker sends one `/v1/index` request per range (`INDEX_PAGE_RANGE`, default 20, is a worker setting). Resuming at the first missing range, checking the cache per range, the OCR budget and the per-range deadline all live in one place, and each range's pages and chunks land in one transaction. The cost is sending the PDF once per range over the compose network.
3. **A cache hit re-chunks through `/v1/chunk`.** The chunker needs Docling's document structure and the embedding model's tokenizer, both in Python. `page_read` stores Docling's document JSON per range; `/v1/chunk` takes it back and streams the same events as `/v1/index`, with no reading.
4. **Older revisions are deleted when a newer one completes.** "A document's current index is its newest revision per embedding model" (§13). When a revision completes, older revisions of the same document and model are deleted in the same transaction, and a partial unique index allows one complete or partial revision per document and model. Older embeddings would otherwise stay in the HNSW graph and cost recall on every query. Index revisions carry no figure; nothing audits them.
5. **Boilerplate is what Docling labels furniture.** §8.3 says running headers and footers "repeated on most pages" are dropped from chunks. Docling's layout model labels them `page_header` and `page_footer` (the furniture layer), and HybridChunker leaves furniture out; no count across pages is added. The page text keeps them.

## Not in this phase

- **Claude OCR** (`OCR_ENGINE=claude`): paid, so not built. `OCR_ENGINE` accepts `rapidocr` only; phase 3 adds `tesseract` for the spot check.
- **XBRL text blocks** (§8.1): phase 4, when XML is accepted. The `text_source` value `xbrl` and the nullable `element` column land now so phase 4 adds no migration for them.
- **The `pipeline` object** (§11) and the screen: phases 4 and 6.
- **The other §13 rows** (`document.format`, `intake_state` `waiting_for_xbrl`, `span`, `period_start`, `extraction_revision.source`, `xbrl_source`, `check_type` `xbrl_in_pdf`, `classification_evidence` columns): phase 4. `job.run_after` is phase 1's.
- **The chunk's unit.** §13 lists "basis and unit where the section states them". Basis comes from the heading path (Task 4). A unit read from section text would be a reader of what a page means; no rule is written for it here, and the column is not added until one is.
- **Choosing the model and the OCR engine**: phase 3. Phase 2 runs the defaults.

## Global Constraints

- **Branching.** Implementation branches from `feat/ingestion-runner` (e713cc9), or from `staging` once phase 1 is merged. The migration takes the number `drizzle-kit generate` gives (0007 after phase 1's `0006_job_queue`; the data layer's phase 1 also plans 0006, whichever lands first takes it).
- **No paid API calls.** Tests use fakes (a fake indexer client, a fake `/embed` server, a whitespace tokenizer built in code) or the free local Docling and RapidOCR models. No test, live check or default path calls Gemini, Claude or any hosted embedding API.
- **No `docker compose up` in a worktree** (the compose project name is shared with the investor's running stack). Database tests use the investor's Postgres on `localhost:5433`, which must be the `pgvector/pgvector:pg16` image (phase 1). In a worktree, compose files are checked with `docker compose config` only. The live check (Task 13) runs from the main checkout after merge, with the investor's go-ahead.
- **The indexer is its own uv project**, not a member of the root uv workspace: Docling needs torch, which would slow every Python CI run and may have no wheel for the 3.14 matrix entry. `apps/indexer` has its own `pyproject.toml` and `uv.lock`, `requires-python = ">=3.12,<3.13"`, torch from the PyTorch CPU index on Linux, and its own CI job. `scripts/check_workspace.py` still parses its `.py` files and Markdown links.
- **Pinned, never automatic.** Docling, docling-core, RapidOCR and onnxruntime are pinned to exact versions in `apps/indexer/pyproject.toml`; the OCR engine is `RapidOcrOptions` on onnxruntime, never Docling's automatic choice; the TEI image is `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`; the embedding model is pinned to a commit revision. Task 1 resolves the versions and the revision; none is written from memory. They are recorded in `apps/indexer/README.md` and `apps/indexer/models.lock.json`.
- **Nothing is fetched at run time.** Weights (Docling's layout, TableFormer and RapidOCR models; the embedding model with its tokenizer) are fetched once into the `models` volume by `docker compose run --rm models`; the indexer and the embedder run with `HF_HUB_OFFLINE=1`.
- **The embedding model.** `EMBEDDING_MODEL` default `Snowflake/snowflake-arctic-embed-l-v2.0`, 1024 dimensions, `query: ` before a query and nothing before a document. The prefix is added by one TypeScript function used by the worker and the API (Task 7).
- **The text that is embedded** is `contextualize(sectionPath, text)`: the section path's entries joined by `"\n"`, then `"\n"`, then the chunk text; just the text when the path is empty. It is defined in both runtimes and both are tested against one fixture (`packages/contracts/fixtures/index/contextualize.json`). At most 512 tokens of the model's own tokenizer.
- **Settings and defaults.** Worker: `INDEXER_URL`, `INDEXER_SECRET`, `EMBEDDER_URL`, `EMBEDDING_MODEL`, `INDEX_PAGE_RANGE` 20, `INDEX_TIMEOUT_SECONDS` 7200 (the whole job), `EMBED_BATCH` 16, `OCR_PAGE_BUDGET` 400. API: `EMBEDDER_URL`, `EMBEDDING_MODEL`. Indexer: `INDEXER_SECRET`, `INDEX_MAX_BYTES` 52428800, `INDEX_THREADS` 6, `INDEX_PAGE_BATCH` 4, `INDEX_TABLE_CELL_MATCHING` true, `INDEX_TOKENIZER_PATH`, `DOCLING_ARTIFACTS_PATH`, `OCR_ENGINE` `rapidocr`.
- **Job.** Type `document.index`, subject type `document_index`, subject id the document id, `pipelineVersion` `${INDEX_PIPELINE_VERSION}:${EMBEDDING_MODEL}` with `INDEX_PIPELINE_VERSION = "1"` in `@maester/document-index`. Limit 1 in `DEFAULT_CONCURRENCY`. Attempts: the default 5 (no paid call).
- **Workspace.** Every new table has `workspace_id`; every query filters on it. A duplicate document gets no index.
- **No document text in logs**, errors or traces: page and chunk text, headings and queries never appear in a log line or an error message (`CLAUDE.md`). Log ids, counts, codes, versions and seconds.
- **Readers stay as they are.** `PdfDocument`, Gemini extraction, the correction guard, the classifier's quote check, reader B and every check are untouched; OCR text feeds the index only (§8.2). That is why this phase changes no figure and ships no evaluation run; measuring the index is phase 3.
- **Errors** (§15): `INDEXER_NOT_CONFIGURED` (not retried), `UNREADABLE_PDF` (not retried), `OCR_FAILED` and `OCR_BUDGET` (page `none_reason` and revision warnings; the revision is `partial`), `EMBEDDING_FAILED` (retried; the revision stays `building`), `SEARCH_UNAVAILABLE` (503). Added here: `INDEXER_UNAVAILABLE`, `INDEXER_UNAUTHORIZED`, `INDEXER_MODEL_MISMATCH` (the indexer's tokenizer is not `EMBEDDING_MODEL`'s; not retried), `INDEXER_VERSIONS_CHANGED` (retried), `INDEX_STREAM_INTERRUPTED`, `INDEX_TIMEOUT`, `INDEX_FAILED`.
- `docs/systems/*.md` are written in ASD-STE100 Simplified Technical English (the `writing-ste` skill).

## Review Focus

1. **A worker dies in the middle of a long index job.** The sweeper requeues it; the next attempt resumes the same `building` revision at the first range with no pages, writes no duplicate page, chunk or embedding, and embeds only the chunks that have none. Task 9.
2. **A rebuild is still building.** Search keeps returning the older complete revision until the new one completes; then the swap is one transaction and search never sees both or neither. Tasks 6 and 9.
3. **The embedder is down.** During a job: `EMBEDDING_FAILED`, retried with backoff, the revision stays `building`, pages are not read again. During a search: 503 `SEARCH_UNAVAILABLE`, never a 500 and never keyword-only results presented as hybrid. Tasks 9 and 10.
4. **A heading on page 19 governs text on page 21**, across a range boundary and across a resume. The section path is carried from the last stored page; a consolidated section's text never shares a chunk or a path with the standalone one. Tasks 4 and 9.
5. **A long scanned filing** (more than `OCR_PAGE_BUDGET` pages needing OCR). Pages past the budget are stored with `none_reason = 'OCR_BUDGET'`, the revision is `partial` with the warning, and its text-layer pages are searchable. Tasks 3 and 9.

---

### Task 1: The indexer project, pinned, and a probe of Docling's interfaces

**Files:**
- Create: `apps/indexer/pyproject.toml`, `apps/indexer/uv.lock`, `apps/indexer/.python-version` (`3.12`), `apps/indexer/README.md`, `apps/indexer/LICENSE` (copy of `apps/extractor/LICENSE`), `apps/indexer/models.lock.json`
- Create: `apps/indexer/src/maester_indexer/__init__.py`, `apps/indexer/src/maester_indexer/versions.py`
- Create: `apps/indexer/tests/fixtures/make_fixtures.py`, `apps/indexer/tests/fixtures/{text-layer,scanned,mixed,two-sections}.pdf`
- Create: `apps/indexer/tests/test_probe.py`, `apps/indexer/tests/helpers.py`
- Modify: `.gitignore` (`apps/indexer/.venv`)

**Interfaces:**
- Produces:
  - `versions.py`: `DOCLING_VERSION: str`, `OCR_ENGINE: str` (for example `"rapidocr-onnxruntime <rapidocr version>"`), `CHUNKER_VERSION = "1"`, all read from installed package metadata (`importlib.metadata.version`), so they cannot drift from the lock; `reader_options(settings) -> str` (`"table=accurate;cell_matching=true;ocr=rapidocr"`).
  - Fixture PDFs, 1–3 pages each, made by `make_fixtures.py` (reportlab and Pillow, dev dependencies): `text-layer.pdf` (a heading, prose and a 4-column table of right-aligned Indian-format numbers); `scanned.pdf` (the same page rasterized at 200 dpi, no text layer); `mixed.pdf` (a text-layer heading, then under it a short text-layer paragraph and an image of a short printed paragraph, small enough for HybridChunker to merge into one chunk); `two-sections.pdf` (3 pages: "Standalone balance sheet" on page 1, its notes continuing onto page 2 with no new heading, "Consolidated balance sheet" on page 3, and a running header "Synthetic Cements Limited · Annual report 2025–26" on every page).
  - `models.lock.json`: `{ "embedding": { "id": "Snowflake/snowflake-arctic-embed-l-v2.0", "revision": "<commit sha>" }, "docling": { "<artifact>": "<version or revision>" } }`.

- [ ] **Step 1: Resolve the pins.** Take the newest Docling 2.x release at least two weeks old and the docling-core, rapidocr and onnxruntime versions it resolves to with `uv lock` on Python 3.12 (macOS arm64 and Linux aarch64 and x86_64). Configure torch from `https://download.pytorch.org/whl/cpu` for Linux (`[[tool.uv.index]] name = "pytorch-cpu", explicit = true` and a `[tool.uv.sources] torch` entry with a `sys_platform == 'linux'` marker). Take the embedding model's current commit sha from its Hugging Face page. Dependencies: `docling==<pin>`, `docling-core==<pin>`, `rapidocr==<pin>`, `onnxruntime==<pin>`, `fastapi>=0.120`, `uvicorn>=0.30`, `pydantic>=2.8`; dev group `httpx`, `reportlab`, `pillow`.
- [ ] **Step 2: Write the probe tests** in `tests/test_probe.py`, skipped unless `MAESTER_DOCLING_MODELS` names a folder with Docling's artifacts (`docling-tools models download layout tableformer rapidocr -o "$MAESTER_DOCLING_MODELS"`). Each asserts a fact the later tasks depend on, against the pinned version:

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

def test_hybrid_chunker_takes_the_options_we_use(self):
    HybridChunker(tokenizer=whitespace_tokenizer(448), merge_peers=True, repeat_table_header=True)

def test_a_page_can_be_filtered_out_of_a_document(self):
    doc = convert(FIXTURES / "two-sections.pdf").document
    self.assertEqual({p.page_no for i, _ in doc.filter(page_nrs={2}).iterate_items() for p in i.prov}, {2})
```

`convert` builds a `DocumentConverter` with `PdfPipelineOptions(do_ocr=True, ocr_options=RapidOcrOptions(backend="onnxruntime"), do_table_structure=True, table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE), artifacts_path=MAESTER_DOCLING_MODELS, document_timeout=None)` and CPU `AcceleratorOptions`. `cells_of(res, page_no)` returns the text cells Docling kept for a page (`res.pages[...]`; keeping them may need a pipeline option such as `generate_parsed_pages`). `whitespace_tokenizer(max_tokens)` lives in `tests/helpers.py`: a `tokenizers` WordLevel model with a whitespace pre-tokenizer, wrapped in `PreTrainedTokenizerFast` and docling-core's `HuggingFaceTokenizer`.

- [ ] **Step 3: Run the probe** — `cd apps/indexer && MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest tests.test_probe -v`. Expected: PASS. Where a name differs in the pinned version (an option, `from_ocr`, `filter`, `repeat_table_header`), change the test to the pinned version's name and record it in the README's "Docling interfaces this service relies on" list. If OCR provenance per cell is not available at all, stop and report: Task 3's `text_source` needs another source and the spec's §8.2 rule 1 needs a decision.
- [ ] **Step 4: Commit**

```bash
git add apps/indexer .gitignore
git commit -m "feat(indexer): pinned Docling and RapidOCR project, fixture PDFs, probe of the interfaces we rely on"
```

---

### Task 2: The wire contract, in both runtimes

**Files:**
- Create: `packages/contracts/src/document-index.ts`; Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/job.ts`
- Create: `packages/contracts/fixtures/index/{stream-range.ndjson,stream-error.ndjson,chunk-request.json,contextualize.json}`
- Create: `apps/indexer/src/maester_indexer/contracts.py`
- Test: `packages/contracts/test/index-fixtures.test.ts`, `apps/indexer/tests/test_contracts.py`

**Interfaces:**
- Produces (camelCase on the wire, as the extractor's events):
  - `JobTypes.DOCUMENT_INDEX = "document.index"`; `DOCUMENT_INDEX_SUBJECT = "document_index"`.
  - `TextSource = "text_layer" | "ocr" | "mixed" | "xbrl"`; `ChunkKind = "prose" | "table"`; `PageNoneReason = "NO_TEXT" | "OCR_FAILED" | "OCR_BUDGET"`.
  - `IndexerVersions { doclingVersion, ocrEngine, readerOptions, chunkerVersion, tokenizer }` (all strings; `tokenizer` is the model id whose tokenizer the indexer loaded).
  - `IndexerEvent`, a discriminated union on `type`:
    - `started { versions: IndexerVersions; pageCount: int; firstPage: int; lastPage: int }`
    - `page { pageNumber: int; text: string; itemsTextLayer: int; itemsOcr: int; noneReason: PageNoneReason | null; sectionPathAfter: string[] }`
    - `chunk { pageNumber: int; seq: int; kind: ChunkKind; textSource: TextSource; sectionPath: string[]; basis: "consolidated" | "standalone" | null; text: string; tokenCount: int }`
    - `progress { stage: string; percent: number }`, `heartbeat {}`
    - `result { read: RangeRead | null; ocrPages: int }` (`read` null from `/v1/chunk`)
    - `error { code: string; retryable: boolean; message: string }`
  - `RangeRead { firstPage: int; lastPage: int; pageCount: int /* the whole PDF's */; ocrOn: boolean; versions: IndexerVersions; document: Record<string, unknown> /* Docling's export_to_dict */; itemSources: Record<string, TextSource> /* by item self_ref */; pages: Omit<page, "type" | "sectionPathAfter">[] }`.
  - `ChunkRequest { read: RangeRead; sectionPathBefore: string[]; embeddingModel: string }`.
  - `contextualize(sectionPath: string[], text: string): string` exported from `@maester/contracts` (Global Constraints' rule).
  - Pydantic twins in `contracts.py` with `to_wire()` / `from_wire()` like `pdf_financial_qa.workflow.contracts`, and `contextualize(section_path, text)`.

- [ ] **Step 1: Write the fixtures and failing tests.** `stream-range.ndjson`: `started` (pages 1–3 of 3), three `page` lines (page 2 a scanned page with `itemsOcr > 0`), four `chunk` lines (one `table`, one `ocr`, one `mixed`, one carrying a path from page 1 on page 2), a `heartbeat`, a `progress`, and `result` with a small `read`. `contextualize.json`: `[{ sectionPath, text, expected }]` with an empty path, one entry and three entries, and a text holding `₹` and a newline. Zod test: every line of both streams parses as `IndexerEvent`; `chunk-request.json` parses as `ChunkRequest`; `contextualize` gives every `expected`; an `IndexerEvent` with `textSource: "scan"` and a `page` with `pageNumber: 0` are refused. Python test: the same files through `from_wire`, then `to_wire` equals the input line, and `contextualize` gives every `expected`.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/contracts exec vitest run test/index-fixtures.test.ts` and `cd apps/indexer && uv run python -m unittest tests.test_contracts -v` — FAIL (no module).
- [ ] **Step 3: Implement** both schema files and both `contextualize` functions. Page numbers are 1-based, `int >= 1`; `seq` is `int >= 0`.
- [ ] **Step 4: Run to see them pass** — same commands — PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/indexer/src/maester_indexer/contracts.py apps/indexer/tests/test_contracts.py
git commit -m "feat(contracts): the indexer's NDJSON events, the cached range read and contextualize, in Zod and Pydantic"
```

---

### Task 3: Reading a page range

**Files:**
- Create: `apps/indexer/src/maester_indexer/reader.py`, `apps/indexer/src/maester_indexer/settings.py`
- Test: `apps/indexer/tests/test_reader.py` (gated on `MAESTER_DOCLING_MODELS`), `apps/indexer/tests/test_sources.py` (no models)

**Interfaces:**
- Consumes: `RangeRead`, `TextSource`, `PageNoneReason` (Task 2); `versions.py` (Task 1).
- Produces:
  - `Settings.from_env(env) -> Settings` with the indexer settings of Global Constraints.
  - `class Reader: __init__(settings)` builds one `DocumentConverter` with the probe's options plus `table_structure_options.do_cell_matching = settings.table_cell_matching`, `accelerator_options.num_threads = settings.threads`, `page_batch_size = settings.page_batch` (through Docling's settings object), and `do_ocr` per call.
  - `Reader.page_count(pdf: bytes) -> int`.
  - `Reader.read_range(pdf: bytes, first: int, last: int, ocr_pages_left: int, cancel: threading.Event) -> RangeRead`: converts pages `first..last` (clamped to the page count). OCR is on for the whole range while `ocr_pages_left > 0`, off otherwise (`ocrOn` records which); the budget is checked per range, so a document can go up to `INDEX_PAGE_RANGE − 1` OCR pages over it. Raises `IndexingError(code, message, retryable)` (`UNREADABLE_PDF` not retryable, for an encrypted, damaged or empty PDF; `INDEX_FAILED` retryable for anything unexpected, with the exception's type only).
  - `item_source(cells: list[Cell], bbox) -> TextSource | None` in `sources.py`: the cells whose centre lies inside the item's box decide: all OCR → `ocr`, none → `text_layer`, both → `mixed`, no cell → `None` (the item has no text; it is ignored). An item with several provenance boxes takes the union.
  - Pages: `text` is every text item on the page in reading order, furniture included, joined by `"\n"`; `itemsTextLayer` and `itemsOcr` count items by source (a mixed item counts in both); `noneReason` is `null` when the page has text, `NO_TEXT` when no OCR was needed and none was found, `OCR_FAILED` when OCR ran on the page and found nothing, `OCR_BUDGET` when the page has no text-layer text and OCR was off for the budget.

- [ ] **Step 1: Write the failing model-free tests** in `test_sources.py` for `item_source`: all-OCR cells → `ocr`; none → `text_layer`; one of each → `mixed`; a cell whose centre is outside the box is ignored; no cells → `None`.
- [ ] **Step 2: Write the failing gated tests** in `test_reader.py`:

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
    self.assertIn("Annual report 2025–26", reader().read_range(pdf("two-sections.pdf"), 1, 1, 400, Event()).pages[0].text)

def test_unreadable_pdf(self):
    with self.assertRaises(IndexingError) as e: reader().read_range(b"%PDF-1.7 not really", 1, 20, 400, Event())
    self.assertEqual((e.exception.code, e.exception.retryable), ("UNREADABLE_PDF", False))
```

- [ ] **Step 3: Run to see them fail** — `cd apps/indexer && MAESTER_DOCLING_MODELS=… uv run python -m unittest tests.test_sources tests.test_reader -v` — FAIL (no module).
- [ ] **Step 4: Implement** `settings.py`, `sources.py` and `reader.py`. The converter is built once per process; `read_range` checks `cancel` between Docling's page batches where the pinned version allows and before returning.
- [ ] **Step 5: Run to see them pass** — same command — PASS.
- [ ] **Step 6: Save the reads as fixtures** for the model-free tests: `tests/fixtures/save_reads.py` runs `read_range` over each fixture PDF and writes `tests/fixtures/<name>.read.json` (`RangeRead.to_wire()`). Commit them; regenerate only when the Docling pin changes.
- [ ] **Step 7: Commit**

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
- Consumes: `RangeRead` (Task 2), the JSON fixtures (Task 1).
- Produces:
  - `MAX_EMBED_TOKENS = 512`, `PATH_TOKENS = 64`, `CHUNK_TOKENS = 448`.
  - `chunk_range(read: RangeRead, section_path_before: list[str], tokenizer) -> tuple[list[PageEvent], list[ChunkEvent]]`. For each page of the range in order: `DoclingDocument.model_validate(read.document).filter(page_nrs={page})`, then `HybridChunker(tokenizer=HuggingFaceTokenizer(tokenizer, max_tokens=CHUNK_TOKENS), merge_peers=True, repeat_table_header=True).chunk(sub)`. So a chunk never crosses a page, and furniture never enters a chunk.
  - **Section path.** A chunk's path is its `meta.headings` when it has any, otherwise the path carried in: `section_path_before` for the range's first page, then the path in effect after the previous page. The path after a page is the last chunk's path on it (or the carried path if the page has no chunk) and is emitted as `sectionPathAfter`. A carried path is cut from the left (outermost headings dropped first) to fit `PATH_TOKENS`.
  - `seq` counts chunks within their page from 0, so a page re-chunked alone gets the same numbers.
  - `kind` is `table` when every doc item of the chunk is a table, else `prose`. `textSource` is the union of its items' `itemSources`: one source, or `mixed`.
  - `basis`: walking the path from the innermost heading out, the first that contains the word "consolidated" or "standalone" (case-insensitive, whole word) decides; none → `null`.
  - `tokenCount` is the tokenizer's count of `contextualize(sectionPath, text)`; a chunk over `MAX_EMBED_TOKENS` raises (a bug, not a document fault).
  - `load_tokenizer(path: str, expected_model: str)`: `AutoTokenizer.from_pretrained(path, local_files_only=True)`; refuses (raises `IndexingError("INDEXER_MODEL_MISMATCH", …, False)`) when the folder's model id (from `models.lock.json` beside it) is not `expected_model`.

- [ ] **Step 1: Write the failing tests** in `test_chunker.py`:

```python
def test_no_chunk_crosses_a_page(self):
    _, chunks = chunk_range(read("two-sections"), [], tok())
    for c in chunks: self.assertEqual(len({p.page_no for item in items_of(c) for p in item.prov}), 1)

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

def test_running_header_is_not_in_any_chunk(self):
    _, chunks = chunk_range(read("two-sections"), [], tok())
    self.assertFalse(any("Annual report 2025–26" in c.text for c in chunks))

def test_a_table_stays_whole_when_it_fits_and_splits_with_its_header(self):
    _, whole = chunk_range(read("text-layer"), [], tok(448))
    self.assertEqual(sum(c.kind == "table" for c in whole), 1)
    _, split = chunk_range(read("text-layer"), [], tok(24))
    tables = [c for c in split if c.kind == "table"]
    self.assertGreater(len(tables), 1)
    self.assertTrue(all(header_row(read("text-layer")) in c.text for c in tables))

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

`read(name, pages=None)` loads `tests/fixtures/<name>.read.json`, restricted to `pages` (the fixture's document filtered to those pages); `tok(n=448)` is the whitespace tokenizer; `path_after(pages, n)` is page `n`'s `section_path_after`; `items_of(chunk)` and `header_row(read)` read the chunk's doc items and the table's first row back from the fixture.

- [ ] **Step 2: Run to see them fail** — `cd apps/indexer && uv run python -m unittest tests.test_chunker -v` — FAIL (no module).
- [ ] **Step 3: Implement** `chunker.py`.
- [ ] **Step 4: Run to see them pass** — same command — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/indexer/src/maester_indexer/chunker.py apps/indexer/tests
git commit -m "feat(indexer): chunk a range by element within each page, carry the section path, basis from the headings"
```

---

### Task 5: The indexer service

**Files:**
- Create: `apps/indexer/src/maester_indexer/app.py`, `apps/indexer/src/maester_indexer/__main__.py`, `apps/indexer/src/maester_indexer/fetch_models.py`, `apps/indexer/Dockerfile`
- Test: `apps/indexer/tests/test_service.py` (no models: a fake `Reader` and the whitespace tokenizer)

**Interfaces:**
- Consumes: `Reader` (Task 3), `chunk_range`, `load_tokenizer` (Task 4), the contracts (Task 2).
- Produces:
  - `create_app(settings: Settings | None = None, reader: Reader | None = None, tokenizer=None) -> FastAPI`, the extractor's shape (`apps/extractor/src/maester_extractor/app.py`): `x-indexer-secret` compared with `hmac.compare_digest`, a warning at start when it is unset, the body read in a stream with `INDEX_MAX_BYTES` (413 `TOO_LARGE_FOR_INDEX`), `EMPTY_BODY` 400.
  - `GET /healthz` → `{"status":"ok"}`; `GET /v1/versions` → `IndexerVersions`.
  - `POST /v1/index`, body the PDF, headers `x-document-id`, `x-page-range` (`"21-40"`), `x-section-path` (base64url of a JSON array of strings), `x-ocr-pages-left` (int), `x-embedding-model`. Answers 200 at once with NDJSON: `started`, then `heartbeat` every `heartbeat_seconds` (15) while Docling reads in a thread, then the range's `page` lines, its `chunk` lines, `progress`, and `result { read, ocrPages }` or one `error`. A model id that is not the loaded tokenizer's → `error INDEXER_MODEL_MISMATCH` (not retryable) before any reading. A bad header → 400 `BAD_REQUEST`.
  - `POST /v1/chunk`, body `ChunkRequest` JSON: the same stream with no reading and `result.read = null`. A `read` whose `versions.chunkerVersion` or tokenizer is not this service's is still chunked by this service (the cache keys on the reader versions only).
  - `maester-indexer` console script (uvicorn on `PORT`, default 8791); `maester-indexer-fetch-models --out /models`: downloads Docling's `layout`, `tableformer` and `rapidocr` artifacts into `/models/docling` and the embedding model at the revision in `models.lock.json` into `/models/embed/<model id>` (`huggingface_hub.snapshot_download(revision=…)`), and copies `models.lock.json` beside them; `--docling-only` skips the embedding model (for CI). The only code that fetches.
  - Dockerfile on `python:3.12-slim`, uv 0.11.17, `uv sync --locked --no-dev --no-editable` inside `apps/indexer`, `HF_HUB_OFFLINE=1`, user `app`, `EXPOSE 8791`.

- [ ] **Step 1: Write the failing tests** in `test_service.py` with `fastapi.testclient.TestClient` and a fake reader that returns `tests/fixtures/two-sections.read.json` for any range: a full `/v1/index` stream parses line by line as `IndexerEvent`, starts with `started`, ends with `result`, and its chunks equal `chunk_range` on the same read; a wrong secret → 401 `INDEXER_UNAUTHORIZED`; a model mismatch → one `error` line `INDEXER_MODEL_MISMATCH` and the fake reader never called; a body over `INDEX_MAX_BYTES` → 413; a reader that sleeps longer than `heartbeat_seconds` (set to 0.05) yields `heartbeat` lines; a reader raising `IndexingError("UNREADABLE_PDF", …, False)` ends with that `error`; a reader raising `RuntimeError("Revenue 1,234")` ends with `error INDEX_FAILED`, retryable, and `"Revenue"` appears neither in the error line nor in any captured log record (`assertLogs`); `/v1/chunk` with `chunk-request.json` streams pages and chunks with `result.read` null; the client disconnecting sets the reader's `cancel`.
- [ ] **Step 2: Run to see them fail** — `cd apps/indexer && uv run python -m unittest tests.test_service -v` — FAIL.
- [ ] **Step 3: Implement** `app.py`, `__main__.py`, `fetch_models.py` and the Dockerfile. Logs: document id, range, page and chunk counts, OCR pages, seconds, error codes and exception types only.
- [ ] **Step 4: Run the indexer suite** — `cd apps/indexer && uv run python -m unittest discover -s tests -v` — PASS (the gated tests skip without `MAESTER_DOCLING_MODELS`).
- [ ] **Step 5: Build the image** — `docker build -f apps/indexer/Dockerfile -t maester/indexer:check .` (a build, not compose) — succeeds; note its size in the README.
- [ ] **Step 6: Commit**

```bash
git add apps/indexer
git commit -m "feat(indexer): /v1/index and /v1/chunk NDJSON service, versions, model fetch command, image"
```

---

### Task 6: The index tables and their queries

**Files:**
- Create: `packages/db/src/schema/document-index.ts`; Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/drizzle/<next>_document_index.sql` (generated, then edited)
- Create: `packages/db/src/queries/document-index.ts`; Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/migrate.test.ts`, `packages/db/test/document-index.test.ts`

**Interfaces:**
- Produces, every table with `id uuid` primary key (except `chunk_embedding`), `workspace_id uuid not null` references `workspace`, `created_at`:
  - `document_index_revision`: `document_id` → `document`, `job_id` → `job` unique, `state` enum `index_revision_state` (`building`, `complete`, `partial`), `index_version`, `docling_version`, `ocr_engine`, `reader_options`, `chunker_version`, `embedding_model` (all text not null), `page_count int` (null until known), `pages_read int default 0`, `pages_ocr int default 0`, `warnings text[] default '{}'`, `completed_at`. Index `(workspace_id, document_id, embedding_model, created_at)`; partial unique index `document_index_current` on `(document_id, embedding_model) where state in ('complete','partial')`.
  - `document_page`: `revision_id` → revision on delete cascade, `page_number int not null`, `text text not null`, `items_text_layer int`, `items_ocr int`, `none_reason text`, `section_path_after text[] not null`. Unique `(revision_id, page_number)`.
  - `document_chunk`: `revision_id` → revision on delete cascade, `document_id`, `page_number int` (null only for a future XBRL chunk), `element text` (null for PDF chunks), `seq int not null`, `section_path text[] not null`, `kind` enum (`prose`, `table`), `text_source` enum (`text_layer`, `ocr`, `mixed`, `xbrl`), `basis text` (`consolidated`, `standalone` or null), `heading_text text not null` (the path joined by `" "`, written by the worker, because `array_to_string` is not immutable and a generated column needs an immutable expression), `text text not null`, `token_count int not null`, `tsv tsvector generated always as (to_tsvector('simple', heading_text || ' ' || text)) stored`. Unique `(revision_id, page_number, seq)`; GIN `document_chunk_tsv` on `tsv`; B-tree `(workspace_id, document_id)`.
  - `chunk_embedding`: `chunk_id` → chunk on delete cascade, `model text`, `workspace_id`, `embedding vector(1024) not null`; primary key `(chunk_id, model)`; HNSW `chunk_embedding_hnsw` on `((embedding::halfvec(1024)) halfvec_cosine_ops)`.
  - `page_read`: `content_sha256`, `first_page`, `last_page`, `docling_version`, `ocr_engine`, `reader_options`, `read jsonb not null` (a `RangeRead`). Unique `(workspace_id, content_sha256, first_page, last_page, docling_version, ocr_engine, reader_options)`.
  - Queries (each takes `workspaceId` first after `db`):
    - `startOrResumeRevision(db, ws, { documentId, jobId, versions: IndexerVersions & { indexVersion: string; embeddingModel: string } }) -> IndexRevisionRow`: the job's revision when its versions match; when they differ, that revision is deleted and a new one inserted for the job; none → insert.
    - `writeRange(db, ws, revisionId, documentId, pages: PageInput[], chunks: ChunkInput[], counts: { pageCount, pagesRead, pagesOcr, warnings }) -> void`: one transaction; pages and chunks `on conflict do nothing`; the revision's counts set and warnings merged.
    - `lastStoredPage(db, ws, revisionId) -> { pageNumber, sectionPathAfter } | null`.
    - `chunksWithoutEmbedding(db, ws, revisionId, model, limit) -> { id, sectionPath, text }[]`, by page and seq.
    - `insertEmbeddings(db, ws, model, rows: { chunkId, embedding: number[] }[]) -> void`, `on conflict do nothing`.
    - `completeRevision(db, ws, revisionId) -> IndexRevisionRow`: one transaction: delete the document's other revisions for the same model, then set `state` to `partial` when `warnings` holds `OCR_FAILED` or `OCR_BUDGET`, else `complete`, and `completed_at`.
    - `getPageRead(db, ws, key) -> RangeRead | null`, `putPageRead(db, ws, key, read) -> void` (`on conflict do nothing`).
    - `documentsNeedingIndex(db, { workspaceId?, model, pipelineVersion }) -> { documentId, workspaceId, job: JobRow | null }[]`: documents `state = 'stored'`, `intake_state` not `duplicate`, with no complete or partial revision for `model`, with the `document.index` job of that pipeline version if one exists.

- [ ] **Step 1: Write the failing tests.** `migrate.test.ts`: the `vector` extension is installed (`select extversion from pg_extension where extname = 'vector'`); the five tables exist; `chunk_embedding_hnsw`'s `indexdef` contains `halfvec_cosine_ops`; `document_chunk_tsv` is GIN; `document_index_current` is partial. `document-index.test.ts`, on seeded rows (a 1024-dimension vector helper `unit(i)` with a 1 at index `i`):

```ts
it("the vector branch uses the HNSW index when the query casts to halfvec(1024)", async () => {
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
it("no query returns another workspace's rows", async () => { /* seed two workspaces; every query above, called with ws A, returns nothing of B */ });
```

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/db exec vitest run test/migrate.test.ts test/document-index.test.ts` — FAIL. First check the test database's image: `select 1 from pg_available_extensions where name = 'vector'` on `localhost:5433`; if it returns nothing, stop and ask the investor to recreate their Postgres container on the pgvector image (phase 1's Task 1); do not run compose from the worktree.
- [ ] **Step 3: Write the schema and generate the migration.** Drizzle's `vector("embedding", { dimensions: 1024 })` for the column. Run `pnpm --filter @maester/db generate`, then edit the generated file: put `CREATE EXTENSION IF NOT EXISTS vector;` first; write the HNSW index as `CREATE INDEX "chunk_embedding_hnsw" ON "chunk_embedding" USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops);` and the `tsv` column as `GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, heading_text || ' ' || text)) STORED` if drizzle-kit wrote either differently. Mirror the generated column in the schema with a `customType` and `.generatedAlwaysAs(…)`, so the next `generate` shows no diff (run it again to check).
- [ ] **Step 4: Implement the queries.**
- [ ] **Step 5: Run to see them pass** — same command — PASS; then the whole `@maester/db` suite.
- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): document index tables, HNSW on halfvec, simple full-text, the page read cache and their queries"
```

---

### Task 7: `@maester/document-index`: the model, the embedder client and the query prefix

**Files:**
- Create: `packages/document-index/{package.json,tsconfig.json,eslint.config.js,README.md}`, `packages/document-index/src/{index.ts,models.ts,embedder.ts,fake.ts}`
- Test: `packages/document-index/test/embedder.test.ts`, `packages/document-index/test/models.test.ts`

**Interfaces:**
- Consumes: `contextualize` (Task 2).
- Produces:
  - `INDEX_PIPELINE_VERSION = "1"`; `indexPipelineVersion(model: string) => \`${INDEX_PIPELINE_VERSION}:${model}\``.
  - `EMBEDDING_MODELS: Record<string, { dimensions: 1024; queryPrefix: string; documentPrefix: string }>` with `"Snowflake/snowflake-arctic-embed-l-v2.0": { dimensions: 1024, queryPrefix: "query: ", documentPrefix: "" }`; `embeddingModel(id: string)` throws for an id not listed.
  - `embeddingInput(model: string, kind: "query" | "document", text: string): string` — the one place a prefix is added.
  - `interface Embedder { model: string; embed(texts: string[], kind: "query" | "document"): Promise<number[][]> }`.
  - `class TeiEmbedder implements Embedder { constructor(baseUrl: string, model: string, opts?: { timeoutMs?: number; retries?: number }) }`: `POST {baseUrl}/embed` with `{ inputs: texts.map(t => embeddingInput(model, kind, t)), normalize: true, truncate: false }`; retries a network error or a 5xx or 429 up to `retries` (default 3) with 1 s, 2 s, 4 s waits; a 413 or 422 is not retried; then throws `EmbedderError(code: "EMBEDDING_FAILED" | "EMBEDDER_UNAVAILABLE", retryable: boolean)`. Checks every vector has the model's dimensions.
  - `class FakeEmbedder implements Embedder`: deterministic 1024-dimension unit vectors from a SHA-256 of the input text (so equal texts get equal vectors), and `fail(times: number)` to answer with errors; for tests in the worker and the API.

- [ ] **Step 1: Write the failing tests.** Against a local `node:http` server on a free port (a fake `/embed`): the request body carries `"query: what is the dividend"` for a query and the bare text for a document; two 503 answers then a 200 succeed after retries (with the waits shortened through an option); four 503 answers throw `EMBEDDING_FAILED` retryable; a refused connection throws `EMBEDDER_UNAVAILABLE`; a 768-dimension answer throws. `models.test.ts`: `embeddingModel("nope")` throws; `indexPipelineVersion` gives `"1:Snowflake/snowflake-arctic-embed-l-v2.0"`.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/document-index exec vitest run` — FAIL.
- [ ] **Step 3: Implement**; add the package to `pnpm-workspace.yaml` if it lists packages by name, and run `pnpm install`.
- [ ] **Step 4: Run to see them pass** — same command — PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/document-index pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(document-index): the embedding model registry, the query prefix and the TEI client"
```

---

### Task 8: The worker's indexer client, settings and the job's place in the pipeline

**Files:**
- Create: `apps/worker/src/indexer.ts`
- Modify: `apps/worker/src/env.ts`, `apps/worker/src/jobs/types.ts`, `apps/worker/src/start.ts` (the deps), `apps/worker/src/queue.ts` (`DEFAULT_CONCURRENCY`), `apps/worker/src/jobs/document-verify.ts` (`chainIntake`), `apps/worker/package.json` (`@maester/document-index`)
- Test: `apps/worker/test/indexer-client.test.ts`, `apps/worker/test/document-verify.test.ts`, `apps/worker/test/env.test.ts`, `apps/worker/test/context.ts`

**Interfaces:**
- Consumes: `IndexerEvent`, `ChunkRequest`, `IndexerVersions` (Task 2); `Embedder`, `TeiEmbedder`, `FakeEmbedder`, `indexPipelineVersion`, `embeddingModel` (Task 7).
- Produces:
  - `interface IndexerClient { versions(): Promise<IndexerVersions>; index(input: { pdf: Uint8Array; documentId: string; firstPage: number; lastPage: number; sectionPathBefore: string[]; ocrPagesLeft: number; signal: AbortSignal }, onEvent: (e: IndexerEvent) => Promise<void>): Promise<IndexResult>; chunk(request: ChunkRequest, signal: AbortSignal, onEvent: …): Promise<IndexResult> }` where `IndexResult = { started: StartedEvent; pages: PageEvent[]; chunks: ChunkEvent[]; read: RangeRead | null; ocrPages: number }`.
  - `HttpIndexerClient(baseUrl, secret, embeddingModel)`: reads the NDJSON like `HttpExtractorClient.extract` (`apps/worker/src/extractor.ts`); maps a network failure to `JobFailure("INDEXER_UNAVAILABLE", …, true)`, 401/403 to `INDEXER_UNAUTHORIZED` (not retried), an unparsable line to `INVALID_INDEXER_RESULT` (not retried), a stream that ends without `result` to `INDEX_STREAM_INTERRUPTED` (retried), an `error` event to its own code and retryable flag, an aborted signal to `INDEX_TIMEOUT` (retried).
  - `JobContext` gains `indexer: IndexerClient | null` and `embedder: Embedder | null` (null when `INDEXER_URL` or `EMBEDDER_URL` is unset); `createWorkerContext` in tests takes them as options.
  - `WorkerEnv` gains the worker settings of Global Constraints; `EMBEDDING_MODEL` must be in `EMBEDDING_MODELS` (start fails otherwise).
  - `DEFAULT_CONCURRENCY["document.index"] = 1`.
  - `chainIntake` also calls `createJob(db, dispatcher, { workspaceId, type: "document.index", subjectType: "document_index", subjectId: document id, pipelineVersion: indexPipelineVersion(env.EMBEDDING_MODEL) })` for a stored document that is not a duplicate, on the first verify and on a verify retry alike (the key makes it once). It does so whether or not the indexer is configured: the job then fails `INDEXER_NOT_CONFIGURED`, and the backfill recovers it.

- [ ] **Step 1: Write the failing tests.** `indexer-client.test.ts` over a local `node:http` server replaying `packages/contracts/fixtures/index/stream-range.ndjson`: the result holds its 3 pages and 4 chunks and `onEvent` saw the heartbeat; the request carried `x-page-range: 1-20`, `x-ocr-pages-left`, `x-embedding-model` and `x-section-path` decoding to the array sent; the stream cut after the second chunk → `INDEX_STREAM_INTERRUPTED` retryable; `stream-error.ndjson` → its code; a 401 → `INDEXER_UNAUTHORIZED` not retryable; an aborted signal → `INDEX_TIMEOUT`. `document-verify.test.ts`: verifying a new PDF creates one `document.index` job with subject type `document_index` beside the classify job; a duplicate gets none; a verify retry creates no second one. `env.test.ts`: the defaults (`INDEX_PAGE_RANGE` 20, `INDEX_TIMEOUT_SECONDS` 7200, `EMBED_BATCH` 16, `OCR_PAGE_BUDGET` 400, the default model); `EMBEDDING_MODEL=nope` fails. `queue.test.ts`: `parseConcurrency(undefined, ["document.index"])` gives 1.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/indexer-client.test.ts test/document-verify.test.ts test/env.test.ts test/queue.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.
- [ ] **Step 5: Commit**

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
- Produces: error code `INDEXER_VERSIONS_CHANGED`; `documentIndex: JobHandler` registered under `document.index`, returning `{ outcome: "indexed", revisionId, state, pages, chunks, ocrPages }`. The algorithm:

```text
no indexer or embedder → JobFailure INDEXER_NOT_CONFIGURED (not retried)
document not found, not stored, or a duplicate → JobFailure INVALID_STATE (not retried)
deadline = now + INDEX_TIMEOUT_SECONDS; every indexer call gets an AbortSignal for the time left
pdf = readAll(store, storageKey)            (OBJECT_MISSING if gone, not retried)
versions = indexer.versions()
revision = startOrResumeRevision(job, versions, model)   (a completed revision for this job → return its summary)
pageCount = revision.pageCount ?? the first range's read.pageCount (stored by writeRange)
last = lastStoredPage(revision)             → next = last.pageNumber + 1, path = last.sectionPathAfter (or 1, [])
for each range [first, min(first + INDEX_PAGE_RANGE − 1, pageCount)] from the range holding `next`:
    key = { sha256, first, last, docling, ocr, readerOptions }
    cached = getPageRead(key)
    result = cached ? indexer.chunk({ read: cached, sectionPathBefore: path, embeddingModel })
                    : indexer.index({ pdf, first, last, path, ocrPagesLeft: max(0, OCR_PAGE_BUDGET − revision.pagesOcr) })
    if result.started.versions ≠ revision's versions: JobFailure INDEXER_VERSIONS_CHANGED (retried; the next attempt replaces the revision)
    if !cached and result.read.ocrOn: putPageRead(key, result.read)   (a read made with OCR off for the budget is not cached)
    writeRange(revision, pages of the range ≥ next, their chunks, counts, warnings from none reasons)
    path = last page's sectionPathAfter; heartbeat; progress { stage: "reading", percent: pages done / pageCount × 90 }
    embedPending()
embedPending(): while chunksWithoutEmbedding(revision, model, EMBED_BATCH × 8) is not empty:
    in batches of EMBED_BATCH, longest first: embedder.embed(batch.map(c => contextualize(c.sectionPath, c.text)), "document")
    insertEmbeddings; heartbeat           (an EmbedderError → JobFailure EMBEDDING_FAILED, retryable)
completeRevision(revision); progress { stage: "indexed", percent: 100 }
```

Range bounds are fixed multiples of `INDEX_PAGE_RANGE` from page 1, so a resumed job asks for the same cache keys. When a page of a cached range is already stored (a crash between `writeRange` and the next range), `writeRange`'s `on conflict do nothing` keeps it once. Warnings are codes only (`OCR_FAILED`, `OCR_BUDGET`). Logs: document id, revision id, range, counts, seconds.

- [ ] **Step 1: Write the failing tests** with a fake `IndexerClient` (pages and chunks generated per range from a seeded "document" of N pages; it counts `index` and `chunk` calls and can be told to fail on a given range) and `FakeEmbedder`:

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

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/document-index.test.ts` — FAIL.
- [ ] **Step 3: Implement** `document-index.ts` and register it.
- [ ] **Step 4: Run the worker suite** — `pnpm --filter @maester/worker exec vitest run` — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): document.index reads by page range, writes as it goes, caches reads, resumes, embeds in batches"
```

---

### Task 10: Search: `searchChunks` and the route

**Files:**
- Create: `packages/document-index/src/search.ts`; Modify: `packages/document-index/src/index.ts`, `packages/document-index/package.json` (`@maester/db`)
- Create: `apps/api/src/routes/search.ts`; Modify: `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts` (the embedder dep), `apps/api/src/errors.ts` (`SEARCH_UNAVAILABLE` 503), `packages/contracts/src/document-index.ts` (`SearchHit`, `SearchResults`)
- Test: `packages/document-index/test/search.test.ts`, `apps/api/test/search.test.ts`

**Interfaces:**
- Consumes: `Embedder` (Task 7), the tables (Task 6).
- Produces:
  - `AppDeps` gains `embedder: Embedder | null` (a `TeiEmbedder` when `EMBEDDER_URL` is set), built in `server.ts`.
  - `SearchHit { documentId; documentName; companyId: string | null; companyName: string | null; pageNumber: number | null; element: string | null; sectionPath: string[]; textSource: TextSource; kind: ChunkKind; text: string; vectorRank: number | null; keywordRank: number | null }`; `SearchResults { items: SearchHit[] }`.
  - `fuse(vector: string[], keyword: string[], k = 60): { id; score; vectorRank; keywordRank }[]`: reciprocal rank fusion, score `Σ 1/(k + rank)` with ranks from 1, ties broken by the better vector rank, then the better keyword rank, then id.
  - `searchChunks(db: Db, embedder: Embedder, input: { workspaceId: string; query: string; limit?: number; companyId?: string; documentIds?: string[] }): Promise<SearchHit[]>`:
    1. `embedder.embed([query], "query")`.
    2. Vector branch, top 50, among chunks of the workspace whose revision is complete or partial for `embedder.model` and whose embedding is for that model. Unfiltered: in one transaction with `set local hnsw.ef_search = 100` and `set local hnsw.iterative_scan = relaxed_order`, `order by e.embedding::halfvec(1024) <=> $q::halfvec(1024)` in a materialized CTE, re-sorted by distance outside it (relaxed order can return rows slightly out of order). Filtered by company or documents: an exact scan, `order by e.embedding <=> $q::vector`, which the HNSW expression index does not serve, so the B-tree on `(workspace_id, document_id)` filters first.
    3. Keyword branch, top 50: `tsv @@ websearch_to_tsquery('simple', $query)`, `order by ts_rank(tsv, query) desc`, same filters; an empty tsquery (only stop characters) gives no rows.
    4. `fuse`, then load up to `limit` (default 10, at most 50) hits with their document name and company.
  - `GET /v1/workspaces/:ws/search?q=&limit=&company=`: session and membership through the existing `requireWorkspace`; `q` 1–500 characters after trimming; `limit` 1–50; `company` a uuid; otherwise 400 `VALIDATION`. No `EMBEDDER_URL` or an `EmbedderError` → 503 `SEARCH_UNAVAILABLE` ("Search is not available right now."). The query is not logged.

- [ ] **Step 1: Write the failing tests.** `search.test.ts` (database plus `FakeEmbedder`; chunk vectors seeded so the nearest neighbours are known): `fuse` on two hand-made rankings gives the hand-computed order and scores; a chunk found by both branches outranks one found by one; a chunk of a building revision, of another model or of another workspace is never returned; a company filter returns only that company's chunks and runs without the HNSW index (`explain` shows no `chunk_embedding_hnsw`); a CIN and a company name are found by the keyword branch exactly as printed; `limit` 60 is cut to 50. `apps/api/test/search.test.ts`: signed out → 401; a workspace the user is not a member of → 404 `NOT_FOUND` from `requireWorkspace`; `q` empty → 400; the embedder failing → 503 `SEARCH_UNAVAILABLE`; a seeded index returns hits with `pageNumber`, `sectionPath`, `textSource` and both ranks, and no hit carries a figure field.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/document-index exec vitest run test/search.test.ts` and `pnpm --filter @maester/api exec vitest run test/search.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both suites** — PASS.
- [ ] **Step 5: Commit**

```bash
git add packages/document-index packages/contracts apps/api
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
  - `backfillIndex(db: Db, dispatcher: Dispatcher, opts: { workspaceId?: string; documentIds?: string[]; model: string; dryRun?: boolean }) -> Promise<{ created: number; requeued: number; waiting: number; current: number }>`. Per document from `documentsNeedingIndex`: no job → `createJob` (as `chainIntake` does); job `failed` → requeued with `retryJob`'s semantics (`apps/api/src/jobs/create.ts`: `queued`, lease cleared, `max_attempts = attempt + maxAttemptsFor(type)`, `run_after = now()`, progress cleared, then `dispatcher.enqueue`); `queued` or `running` → counted as waiting; `succeeded` (a complete revision since removed) → requeued as for failed. Documents with a current revision count as current and are not touched. `dryRun` counts without writing.
  - `pnpm --filter @maester/worker index:backfill [--workspace <id>] [--document <id>]… [--dry-run]`: prints the four counts and exits 0; it enqueues and never runs the work itself (the worker's queue loop does, one at a time).

- [ ] **Step 1: Write the failing tests:** a stored document with no job gets one; one whose job failed `INDEXER_NOT_CONFIGURED` is queued again with `run_after <= now()` and the notifier called; a queued one is left alone; a duplicate, a rejected and an indexed document are skipped; `--workspace` and `--document` limit it; `dryRun` writes nothing; running it twice creates nothing the second time.
- [ ] **Step 2: Run to see them fail** — `pnpm --filter @maester/worker exec vitest run test/index-backfill.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see them pass** — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): index backfill enqueues or requeues document.index for every stored document without a current index"
```

---

### Task 12: Compose, the memory budget, CI and documentation

**Files:**
- Modify: `docker-compose.yml`, `.env.example`
- Create: `.github/workflows/indexer.yml`
- Create: `docs/systems/indexer.md`; Modify: `docs/systems/worker.md`, `docs/systems/api.md`, `docs/systems/maester.md`, `docs/DEVELOPMENT.md`, `docs/ARCHITECTURE.md`, `apps/indexer/README.md`

**Interfaces:**
- Produces, in `docker-compose.yml`:
  - `models` (profile `setup`, image `maester/indexer:local`, `command: ["maester-indexer-fetch-models", "--out", "/models"]`, `HF_HUB_OFFLINE` unset, volume `models:/models`): the one service that fetches, run once with `docker compose --profile setup run --rm models`.
  - `indexer` (build `apps/indexer/Dockerfile`, port 8791, `INDEXER_SECRET: local-indexer-secret`, `DOCLING_ARTIFACTS_PATH: /models/docling`, `INDEX_TOKENIZER_PATH: /models/embed/Snowflake/snowflake-arctic-embed-l-v2.0`, `INDEX_THREADS: 6`, `INDEX_PAGE_BATCH: 4`, `HF_HUB_OFFLINE: 1`, `models:/models:ro`, healthcheck on `/healthz`).
  - `embedder` (image `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`, `command: ["--model-id", "/models/embed/Snowflake/snowflake-arctic-embed-l-v2.0", "--max-client-batch-size", "32", "--port", "80"]`, `HF_HUB_OFFLINE: 1`, `models:/models:ro`, port `8792:80`, healthcheck on `/health`).
  - `worker` env: `INDEXER_URL: http://indexer:8791`, `INDEXER_SECRET`, `EMBEDDER_URL: http://embedder`, `EMBEDDING_MODEL`; `api` env (in `x-api-env`): `EMBEDDER_URL`, `EMBEDDING_MODEL`. Neither `depends_on` the indexer or the embedder: until they answer, index jobs back off and search answers 503.
  - Postgres `command: ["postgres", "-c", "shared_buffers=256MB", "-c", "maintenance_work_mem=512MB"]` (`shm_size` stays 1 GB, at least `maintenance_work_mem`).
  - Memory and CPU limits (`mem_limit`, `cpus`), within the 7.75 GiB VM with about 0.8 GiB to spare; Task 13 measures and adjusts them:

| Service | `mem_limit` | `cpus` | Why |
| --- | --- | --- | --- |
| postgres | 1g | 2 | Records, queue, vectors; an HNSW build needs `maintenance_work_mem` (rebuilds want 1–2 GB: raise Docker's limit first) |
| embedder | 2560m | 8 | arctic in fp32 is about 2.3 GB |
| indexer | 2304m | 8 | Docling's peak is unpublished; one job at a time, 20-page ranges, page batch 4 |
| extractor | 512m | 2 | Gemini calls; holds one PDF |
| api | 320m | 2 | |
| worker | 320m | 2 | Holds one PDF per index job |
| web | 96m | 1 | nginx |
| total | 7.0 GiB | | Docker Desktop's limit can be raised to 12 GB (§19) before a backfill |

  - `.github/workflows/indexer.yml`: on changes under `apps/indexer/**` or `packages/contracts/fixtures/index/**`; uv 0.11.17, Python 3.12, `uv sync --locked` in `apps/indexer`, `actions/cache` on `~/.cache/maester/docling` keyed by `apps/indexer/uv.lock`, `uv run maester-indexer-fetch-models --out ~/.cache/maester --docling-only` when the cache missed, then `MAESTER_DOCLING_MODELS=~/.cache/maester/docling uv run python -m unittest discover -s tests -v`. Free downloads only; no secret is used.

- [ ] **Step 1: Write the compose and CI changes.**
- [ ] **Step 2: Check them without starting anything** — `docker compose config --quiet && docker compose --profile setup config --services | grep -x models` — exit 0; `docker compose config | grep -c mem_limit` gives 7.
- [ ] **Step 3: Write the documentation** in STE: `docs/systems/indexer.md` (what the service does, its two routes and events, the settings table, the pinned versions and where they are recorded, how weights are fetched, what is logged); `worker.md` (`document.index`: ranges, the cache, resume, the OCR budget, the backfill command, the errors of §15 it raises); `api.md` (the search route, 503); `maester.md` and `ARCHITECTURE.md` (five services); `DEVELOPMENT.md` (first setup: build, `docker compose --profile setup run --rm models`, then `up`; the memory table; raising Docker Desktop's limit; running the indexer's tests with and without models).
- [ ] **Step 4: Check links and the workspace** — `uv run --locked python scripts/check_workspace.py` — `Workspace OK`; and `pnpm -r --filter "./apps/*" --filter "./packages/*" exec vitest run` — PASS.
- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example .github/workflows/indexer.yml docs apps/indexer/README.md
git commit -m "feat(compose): indexer, embedder and model setup services with a memory budget; indexer CI; docs"
```

---

### Task 13: Live check and the backfill, from the main checkout, with the investor

This task runs on the investor's machine from the main checkout after the branch is merged, never from a worktree, and only once the investor says go. Nothing in it calls a paid model: it indexes documents already stored, so no upload starts a classification.

- [ ] **Step 1: Set up** — `docker compose build indexer worker api && docker compose --profile setup run --rm models && docker compose up -d`. Expected: `indexer` and `embedder` healthy; `migrate` applied the index migration.
- [ ] **Step 2: Sample first.** Pick three stored documents: a short results filing, a scanned filing and a 300-page annual report. Run `pnpm --filter @maester/worker index:backfill --workspace <id> --dry-run`, then enqueue only those three with `--document <id> --document <id> --document <id>`. While they run, `docker stats --no-stream` every 30 s into a file. Record per document: pages, OCR pages, chunks, seconds to read, seconds to embed, and the peak memory of `indexer`, `embedder` and `postgres`.
- [ ] **Step 3: Adjust** `mem_limit` in `docker-compose.yml` to the measured peaks plus 20%, keep the total within the VM, and write the measured table into `docs/DEVELOPMENT.md`. If the indexer's peak does not fit, lower `INDEX_PAGE_BATCH` and `INDEX_PAGE_RANGE` first.
- [ ] **Step 4: Search** — `curl -s -b <session cookie> 'http://localhost:8787/v1/workspaces/<id>/search?q=borrowings'` returns hits with pages; stop the embedder and the same call answers 503 `SEARCH_UNAVAILABLE`.
- [ ] **Step 5: Backfill the rest** — `pnpm --filter @maester/worker index:backfill --workspace <id>`; let it run (days of CPU for the whole corpus, §19). Done when `select count(*) from document d where d.state = 'stored' and d.intake_state is distinct from 'duplicate' and not exists (select 1 from document_index_revision r where r.document_id = d.id and r.state in ('complete','partial'))` returns 0 for the investor's workspace.
- [ ] **Step 6: Commit** the measured limits and the table.

```bash
git add docker-compose.yml docs/DEVELOPMENT.md
git commit -m "chore(compose): memory limits from the measured index run"
```

---

## After this plan

Phase 3 measures the index from these tables: the OCR spot check (RapidOCR against Tesseract 5 on ten scanned pages) and the retrieval set (recall at 5 and 10 and MRR by text source, for vectors, keywords and hybrid, per candidate model). A model or OCR change is a new `EMBEDDING_MODEL` or reader version, which the cache and `indexPipelineVersion` already key on. Phase 4 adds XBRL text blocks as chunks with `text_source = 'xbrl'` and an `element`, and the `pipeline.text` object reads `document_index_revision`.
