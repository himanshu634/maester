# Ingestion phase 3: measure the index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two committed reports, `docs/eval/<date>-ocr-spot-check.md` and `docs/eval/<date>-retrieval.md`, that choose the OCR engine, the table cell-matching setting and `EMBEDDING_MODEL` by rules fixed before the runs. The plan also covers switching the live index to whatever the reports choose.

**Architecture:**
- **OCR.** Tesseract 5 is added to the indexer as a second engine behind `OCR_ENGINE`, with its own engine string. A new indexer command reads a fixed list of pages under four reader configurations, inside the indexer container. The page list is 10 scanned pages and 5 digital statement pages. A person scores the output by hand in a sheet, and `maester-eval ocr report` applies the decision rule.
- **Retrieval.** A set of 40 or more questions, each with the pages that answer it, lives under `data/eval/retrieval/` (git-ignored).
- **Candidates.** Each candidate embedding model is served by itself in an `eval` compose profile: its own TEI and an indexer holding its tokenizer. A one-shot worker command, `index:candidate`, builds that model's revisions for the retrieval corpus. It uses a job type the live worker has no handler for.
- **Rankings.** A worker command, `eval rank`, ranks pages with the product's own branch functions and writes rankings with no text. `maester-eval retrieval report` scores recall@5, recall@10 and MRR by text source, for vectors, keywords and hybrid, for each model, and applies the model rule.

**Tech Stack:**
- Python 3.12 in apps/indexer: Docling 2.134.0 with `TesseractCliOcrOptions`, and the Debian `tesseract-ocr` 5.x package in the image. The parity check uses `sentence-transformers` in a dev group.
- Python 3.11+ in apps/eval: Typer, Pydantic v2, `fractions.Fraction`, `csv`.
- TypeScript: `@maester/document-index`, worker CLIs, Zod, Vitest.
- text-embeddings-inference `cpu-arm64-1.9`; Docker Compose profiles.

**Spec:** [`docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md`](../specs/2026-10-19-ingestion-pipeline-design.md) §8.1–8.4, §10.3, §10.4, §16 phase 3, §17, §19. Research: [`docs/research/2026-10-19-ingestion-research.md`](../../research/2026-10-19-ingestion-research.md) §2 (Tesseract, `do_cell_matching`) and §3 (the candidate models, TEI, CPU estimates). Builds on [phase 2](2026-10-20-ingestion-phase-2-index.md) as built on `feat/ingestion-index`, and on [phase 0](2026-10-15-eval-baseline.md) (`maester-eval`, the manifest and its `dev` set).

## Where this plan departs from the spec, and why

1. **Ranking runs in TypeScript and scoring in `apps/eval`.**
   - Search is TypeScript (`vectorBranchSql`, `keywordBranchSql`, `fuse`), and copying it into Python would measure a copy of the product.
   - `searchChunks` is refactored to call one exported `rankChunks`, and the eval ranker calls the same function.
   - `apps/eval` owns the set, its schema and loader, the scoring, the decision rule and the report. The two runtimes meet in JSON files pinned by shared fixtures.
2. **Candidate revisions are built by a one-shot runner, not by the live worker.**
   - `claimNext` filters on job type only, and `document.index` indexes with `ctx.env.EMBEDDING_MODEL`. So two workers on two models would take each other's jobs.
   - Candidate jobs are therefore type `document.index.eval`. The live worker has no handler for that type, so it never claims them.
   - `index:candidate` creates these jobs and runs them in-process with the queue runner, with the candidate's indexer and embedder.
   - A guard is added to the shared handler: a job whose key names another model or index version fails `INDEX_MODEL_NOT_SERVED`. This also protects the switch, when jobs queued for the old model are still waiting.
3. **A 768-dimension model is zero-padded to the 1024 column, with no migration.** Padding adds nothing to a dot product and nothing to a norm, so cosine distance is unchanged, exactly. `vector(1024)`, `halfvec(1024)` and the HNSW index stay as built. The registry records the dimensions served and the dimensions kept, and one function (`toStored`) truncates, renormalises and pads.
4. **Granite is measured only when CPU time could decide.** The condition is fixed before the run: `granite-embedding-english-r2` is indexed and ranked only when the hybrid winner among the three 1024-dimension models takes more than 3,600 s to embed 1,500 chunks (a 300-page report) on the bench.
5. **Cell matching is judged on the 10 scanned pages plus 5 digital statement pages.** The setting applies to every page. The failure the research names, packed right-aligned numbers, is mostly a digital-table problem, so scanned pages alone would not show it. Open question 2 asks whether this suits the investor.
6. **Search is scoped per question, and the HNSW path is not measured.**
   - The retrieval corpus is every `dev` filing of three or four chosen companies, out-of-scope filings included (Task 8). Other years of the same company stand in as hard negatives, except where a question lists their pages as answers too.
   - Each question is searched within its company's filings in that corpus, as a `documentIds` filter. That filter runs the exact scan, so every model is compared on one path, and candidate vectors in the shared HNSW graph cannot bias the result.
   - Unscoped, workspace-wide search is not measured.
7. **The current settings win ties, and a switch must win by a band.** This departs from §10.3 ("The best hybrid recall at 10 becomes `EMBEDDING_MODEL`") and §10.4 ("The best engine becomes the default"), which name no band.
   - Any change of OCR engine or cell matching changes the `page_read` key, so every range of every document is read again: days of Docling time (§19).
   - Any change of model re-embeds the corpus: days of embedding time.
   - So a challenger replaces the current setting only when it wins by more than a band that is fixed in this plan (Tasks 3 and 9).
   - For the model, when the current model is inside the band of the best, it is kept, whatever its CPU time. CPU time chooses only among challengers, and only when the current model is outside the band.
8. **A version bump now rebuilds.** `documentsNeedingIndex` treats any complete or partial revision for the model as current and ignores `index_version`. It becomes "same model and same `index_version`", so bumping `INDEX_PIPELINE_VERSION` for a reader change makes the backfill rebuild.
9. **A better engine that is more than twice as slow goes to the investor.** §10.4 makes the best engine the default. When Tesseract wins by the band but its mean seconds per page is more than twice RapidOCR's, the report names no engine (`slower_than_twice`) and the investor decides, because a full re-read at that speed costs more than twice the Docling time of §19. This applies to a switch only: when RapidOCR wins, the current engine stays at any speed, and nothing is read again.

## Not in this phase

- Claude OCR (paid), a reranker (research §3: only if ranking, not recall, is the weakness), bge-m3, harrier-oss.
- XBRL text-block chunks (phase 4). The retrieval set has page answers only.
- A held-out retrieval set: §10.3 asks for development filings only (open question 3).
- A migration: none in this phase.

## Global Constraints

- **Branching.**
  - Implementation branches from `feat/ingestion-index` (PR #13), or from `staging` once PR #13 is merged.
  - The live tasks (11–14) also need two things on `staging`: the corpus manifest from `feat/eval-corpus` (491 filings, the `dev` set), and phase 2's live run (its Task 13: every stored document has a current index).
- **No paid calls.**
  - No test, command or default path calls Gemini, Claude or a hosted embedding API.
  - `index:candidate` builds its runner with `extractor: null` and a handler map of `{ "document.index.eval": documentIndex }` only.
  - Uploading a filing starts a Gemini classification, so a filing missing from the workspace is uploaded only with the investor's go-ahead.
- **No `docker compose up` in a worktree.** Compose files are checked with `docker compose config`. Every live step runs from the main checkout, `/Users/himanshu/Personal/maester-chatbot`, with the investor's go-ahead.
- **No document text in logs or on the console.** CLIs print filing ids, question ids, counts, codes and seconds.
  - Question text, page text and OCR text stay in git-ignored files: `data/eval/corpus/` and `data/eval/runs/` (ignored today), `data/eval/ocr/*` except `data/eval/ocr/pages.json` and `data/eval/ocr/.gitkeep` (Task 3), and `data/eval/retrieval/` (Task 8).
  - The committed retrieval report names questions by id only.
  - The committed OCR report lists the tokens where configurations disagree, with filing and page. These come from public filings, as phase 0's "Mismatches" appendix does.
- **Exact ratios.** Recall, MRR and the error rates are `fractions.Fraction`s of integers, printed with three decimals (`ROUND_HALF_EVEN`). Seconds are measurements, read as `Decimal(str(x))`. No figure of a filing is computed: OCR tokens are compared as strings and never parsed.
- **Pages are PDF pages, counted from 1**, as `document_page.page_number` counts them. They are not printed page numbers: many corpus filings have `printed_pages_per_page: 2`.
- **Models and pins.**
  - Every candidate is pinned to a Hugging Face commit in `apps/indexer/models.lock.json`, which gains a `candidates` list.
  - TEI stays `ghcr.io/huggingface/text-embeddings-inference:cpu-arm64-1.9`.
  - Tesseract comes from the Debian `tesseract-ocr` and `tesseract-ocr-eng` packages of the image's base. Its version and the sha256 of `eng.traineddata` go into the engine string.
  - No version, revision or prompt is written from memory: Tasks 1 and 4 resolve them.
- **Engine strings.**
  - RapidOCR's stays byte-identical, `rapidocr-onnxruntime <rapidocr version>`, so the live `page_read` cache stays valid.
  - Tesseract's is `tesseract-cli <version> eng:<first 12 hex of sha256(eng.traineddata)>`.
- **Settings added.**
  - Indexer: `OCR_ENGINE` accepts `rapidocr | tesseract` (default `rapidocr`).
  - Compose: `CANDIDATE_MODEL` (eval profile).
  - Worker CLIs: `--embedder-url` and `--indexer-url` flags, no new environment variables.
- **CLI paths.** `pnpm --filter @maester/worker <script>` runs in `apps/worker`. So the worker's eval and candidate CLIs resolve a relative `--request` or `--out` against `INIT_CWD` (the folder pnpm was started from), or against the current folder when `INIT_CWD` is unset (Task 6, `cliPath`). Every live command in Tasks 11–14 is run from the repository root, with paths relative to it.
- **Job type** `document.index.eval`, subject type `document_index`, `pipelineVersion` `indexPipelineVersion(model)`, attempts 5. It is never in `DEFAULT_CONCURRENCY` or `handlers`.
- **Errors added:** `INDEX_MODEL_NOT_SERVED` (worker, not retried).
- **Documentation.** `docs/systems/*.md` are ASD-STE100 Simplified Technical English (the `writing-ste` skill).

## Review Focus

1. **A candidate run touches neither the live index nor a paid model.**
   - While candidate revisions exist, live search on the live model returns none of their chunks, in either branch.
   - `index:candidate` refuses the live model.
   - The live worker's `handlers` has no `document.index.eval`.
   - Tests in Tasks 6 and 7.
2. **A scope filing with no current revision for a model** (not stored, failed, still building) makes the report refuse to score that model and name the filings. Such a filing is never counted as "not retrieved". Task 9.
3. **A questions sheet saved by a spreadsheet** reads correctly or is refused with its row number. The cases: a BOM, pages `12.0` or `12; 13`, a page `12-13` that a spreadsheet may read as a date, trailing blank rows. Task 8.
4. **A reader switch rebuilds, and nothing else does.**
   - The RapidOCR engine string is unchanged, so the cache stays valid.
   - Tesseract's differs, so it gets new keys.
   - After a bump, `documentsNeedingIndex` returns every document whose revision has the old `index_version`.
   - Tasks 1 and 6.
5. **Dimensions.**
   - voyage's 2048-value answer is cut to 1024 and renormalised; granite's 768 is padded.
   - Cosine between two stored vectors equals cosine between the originals.
   - A TEI answer of the wrong served length is refused, not truncated.
   - Task 4.

---

### Task 1: Tesseract as the second OCR engine

**Files:**
- Modify: `apps/indexer/src/maester_indexer/settings.py` (`OCR_ENGINES`), `versions.py` (replace the `OCR_ENGINE` constant), `reader.py` (`_make_converter`, `Reader.__init__`)
- Modify: `apps/indexer/Dockerfile` (runtime stage: `tesseract-ocr tesseract-ocr-eng`), `.github/workflows/indexer.yml` (`sudo apt-get install -y tesseract-ocr tesseract-ocr-eng` before Test), `apps/indexer/README.md`
- Test: `apps/indexer/tests/test_settings.py`, `test_versions.py`, `test_reader.py`, `test_probe.py`

**Interfaces:**
- Produces:
  - `OCR_ENGINES = ("rapidocr", "tesseract")`.
  - `versions.ocr_engine_version(engine: str, run: Callable[[list[str]], str] = _run) -> str`. For `"rapidocr"` it returns `f"rapidocr-onnxruntime {version('rapidocr')}"`. For `"tesseract"` it returns `f"tesseract-cli {v} eng:{sha12}"`:
    - `v` is the first `\d+\.\d+\.\d+` on the first line of `tesseract --version`;
    - `sha12` is from `eng.traineddata`, in the folder the header of `tesseract --list-langs` names (`List of available languages in "<dir>/"`).
    - It raises `RuntimeError("tesseract is not installed")` when the command is missing.
    - `_run(args: list[str]) -> str` runs the command and returns its stdout, or its stderr when stdout is empty. This is how the pinned Docling reads `--version` (`docling/models/stages/ocr/tesseract_ocr_cli_model.py`, `_get_name_and_version`, lines 178–197: Linux builds print the version to stderr). Docling reads `--list-langs` from stdout only (lines 307–312); the same fallback covers both.
  - `reader.ocr_options(settings) -> OcrOptions`: `RapidOcrOptions(backend="onnxruntime")`, or the pinned Docling's Tesseract CLI options with `lang=["eng"]` and `tesseract_cmd="tesseract"`.
  - `Reader.versions.ocr_engine = ocr_engine_version(settings.ocr_engine)`, computed once in `__init__`.

- [ ] **Step 1: Resolve the names.** Read the pinned Docling 2.134.0. Find the Tesseract CLI options class (expected `TesseractCliOcrOptions` in `docling.datamodel.pipeline_options`), its `lang` default, and whether its cells carry `from_ocr`. Find the Debian package version in `python:3.12-slim`: `docker run --rm python:3.12-slim sh -c 'apt-get update -qq && apt-cache policy tesseract-ocr'`. Find which stream the Debian build prints `--version` and `--list-langs` to: `docker run --rm python:3.12-slim sh -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends tesseract-ocr tesseract-ocr-eng >/dev/null && tesseract --version 2>/dev/null | head -1; echo ---; tesseract --list-langs 2>/dev/null | head -1'` (an empty part means stderr). Record all three in the README's "Docling interfaces this service relies on". Use the CLI class, not `tesserocr`: tesserocr is a compiled binding with no confirmed linux-aarch64 wheel.
- [ ] **Step 2: Write the failing tests.**

```python
# test_settings.py
def test_tesseract_is_an_ocr_engine(self):
    self.assertEqual(Settings.from_env({"OCR_ENGINE": "tesseract"}).ocr_engine, "tesseract")
def test_other_ocr_engines_are_refused(self):   # replaces test_only_rapidocr_is_an_ocr_engine
    for engine in ("claude", "easyocr"):        # Claude OCR (spec 8.1) is not built; naming it must not read with RapidOCR
        with self.subTest(engine=engine), self.assertRaisesRegex(ValueError, "OCR_ENGINE must be one of rapidocr, tesseract"):
            Settings.from_env({"OCR_ENGINE": engine})

# test_versions.py
def test_rapidocr_string_is_unchanged(self):   # the live page_read keys depend on it
    self.assertEqual(ocr_engine_version("rapidocr"), f"rapidocr-onnxruntime {version('rapidocr')}")
def test_tesseract_string_from_the_binary_and_its_language_data(self):
    with tempfile.TemporaryDirectory() as d:
        Path(d, "eng.traineddata").write_bytes(b"eng")
        out = {"--version": "tesseract 5.5.0\n leptonica-1.84.1\n",
               "--list-langs": f'List of available languages in "{d}/" (1):\neng\n'}
        self.assertEqual(ocr_engine_version("tesseract", run=lambda a: out[a[1]]), "tesseract-cli 5.5.0 eng:82fe032bd933")
def test_run_falls_back_to_stderr(self):     # a Linux tesseract prints --version to stderr
    with mock.patch("maester_indexer.versions.subprocess.run", return_value=CompletedProcess([], 0, stdout="", stderr="tesseract 5.3.0\n")):
        self.assertEqual(_run(["tesseract", "--version"]), "tesseract 5.3.0\n")
def test_reader_options_name_the_engine(self):
    self.assertEqual(reader_options(SimpleNamespace(table_cell_matching=True, ocr_engine="tesseract")),
                     "table=accurate;cell_matching=true;ocr=tesseract")
```

Add gated tests to `test_reader.py`, skipped unless `MAESTER_DOCLING_MODELS` is set and `shutil.which("tesseract")` finds the binary:
- `test_scanned_page_is_ocr_with_tesseract`: `item_sources` values are `{"ocr"}`;
- `test_mixed_page_has_both_sources_with_tesseract`: `{"text_layer", "ocr"}`;
- `test_tesseract_reader_records_its_engine`: `reader.versions.ocr_engine` starts with `"tesseract-cli "`.

Each builds `Reader(Settings(..., ocr_engine="tesseract"))`. In `test_probe.py`, `test_tesseract_cells_are_marked_ocr` asserts `from_ocr` on the cells of `scanned.pdf`. If it fails, stop and report: §8.2 rule 1 needs another source of `text_source`.
- [ ] **Step 3: Run to see them fail.** `cd apps/indexer && MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest tests.test_settings tests.test_versions tests.test_reader tests.test_probe -v`. Expected: FAIL (`ocr_engine_version` undefined; tesseract refused).
- [ ] **Step 4: Implement.** Remove the `OCR_ENGINE` constant and update its three importers: `reader.py`, `tests/test_versions.py` (its constant test becomes `test_rapidocr_string_is_unchanged`) and `tests/test_reader.py` (`test_the_read_carries_its_versions_and_document` compares `"ocr_engine"` with `ocr_engine_version("rapidocr")`). Delete `test_only_rapidocr_is_an_ocr_engine` from `test_settings.py`: `test_other_ocr_engines_are_refused` covers its case. Install `tesseract-ocr tesseract-ocr-eng` in the Dockerfile's runtime stage with `--no-install-recommends`.
- [ ] **Step 5: Run to see them pass.** Same command. Expected: PASS, with the Tesseract cases running locally (`brew install tesseract` on the Mac) and in CI.
- [ ] **Step 6: Commit.**

```bash
git add apps/indexer .github/workflows/indexer.yml
git commit -m "feat(indexer): Tesseract 5 as a second OCR engine behind OCR_ENGINE, with its own engine string; RapidOCR's string is unchanged"
```

---

### Task 2: The OCR spot-check command in the indexer

**Files:**
- Create: `apps/indexer/src/maester_indexer/ocr_sample.py`; Modify: `apps/indexer/pyproject.toml` (`[project.scripts] maester-indexer-ocr-sample = "maester_indexer.ocr_sample:main"`)
- Create: `packages/contracts/fixtures/eval/ocr-disagreements.json` (one page, two pairs of configs; read by Task 3's test too)
- Test: `apps/indexer/tests/test_ocr_sample.py` (no models: fake reader, fake clock)

**Interfaces:**
- Consumes: `Reader`, `Settings`, `RangeRead` (phase 2), `ocr_engine_version` (Task 1).
- Produces:
  - `CONFIGS: dict[str, tuple[str, bool]] = {"rapidocr-cm": ("rapidocr", True), "rapidocr-nocm": ("rapidocr", False), "tesseract-cm": ("tesseract", True), "tesseract-nocm": ("tesseract", False)}`.
  - `DIGITAL_CONFIGS = ("rapidocr-cm", "rapidocr-nocm")`: on a text-layer page the engine reads nothing, so only cell matching varies.
  - `PagesFile` (Pydantic): `scanned: list[PageRef]` (exactly 10) and `digital: list[PageRef]` (exactly 5). `PageRef(filing: str, page: int >= 1)`; the PDF is `<corpus>/<filing>.pdf`.
  - `number_tokens(text: str) -> list[str]`: the matches of `\(?-?\d[\d,]*(?:\.\d+)?\)?`, as strings.
  - `disagreements(a: list[str], b: list[str]) -> list[tuple[str, str]]`: `difflib.SequenceMatcher(None, a, b, autojunk=False)` opcodes other than `equal`, each side joined by a space, `""` for an empty side.
  - `SCORE_COLUMNS = ["filing", "page", "kind", "config", "engine", "cell_matching", "seconds", "numbers_printed", "numbers_wrong", "numbers_missing", "numbers_extra", "headings_printed", "headings_wrong", "headings_missing", "table_rows_printed", "table_rows_wrong", "checked"]`. `numbers_extra` counts numbers the configuration prints that are not on the page, so `numbers_wrong + numbers_missing` never exceeds `numbers_printed`.
  - `Disagreement` (Pydantic): `filing: str`, `page: int`, `a: str`, `b: str` (config names), `pairs: list[tuple[str, str]]` (the `disagreements` of their number tokens). `DisagreementFile = RootModel[list[Disagreement]]`.
  - `run_sample(pages: PagesFile, corpus: Path, out: Path, read: Callable[[bytes, int, str], RangeRead], clock: Callable[[], float] = time.monotonic, now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> Path`. It makes `out/<stamp>/`, where `<stamp>` is `now()` in UTC written `%Y%m%dT%H%M%SZ` (as `maester_eval.paths.EvalPaths.new_run` writes it; the indexer does not import maester_eval, so `--run latest` finds the folder only if the format matches). It refuses a folder that exists. It works **config by config**, so only one converter's models are loaded at a time, inside the indexer's 2304m:
    - it reads the first scanned page once, untimed, as a warm-up;
    - it reads every page of that config, timed;
    - the real `read` then drops that config's `Reader` and runs `gc.collect()` before the next config's is built.

    It writes:
    - `<filing-slug>_p<page>_<config>.json`: the `RangeRead` of that one page, plus `seconds` and `ocrEngine`;
    - `<filing-slug>_p<page>.png`: the page rendered at 150 dpi with pypdfium2;
    - `<filing-slug>_p<page>.md`: each config's page text and tables (`TableItem.export_to_markdown()`), then the `disagreements` of each pair of configs, for the person scoring;
    - `disagreements.json`: a `DisagreementFile`, one entry per page and pair of that page's configs (`a` before `b` in `CONFIGS` order), only pairs with at least one disagreement. Task 3's report reads this file, never the `.md`;
    - `scores.csv`: one row per page and config, `SCORE_COLUMNS`, with `seconds` (one decimal), `engine` and `cell_matching` filled and every count and `checked` blank.

    `<filing-slug>` is the filing id with `/` written `--`.
  - `main(argv: list[str] | None = None, read: Callable[[bytes, int, str], RangeRead] | None = None, now: Callable[[], datetime] | None = None) -> int`: `maester-indexer-ocr-sample --pages <file> --corpus <dir> --out <dir>`. `read` and `now` are test seams; unset, they are the real ones. The real `read` holds at most one `Reader`. It builds it from `Settings.from_env()` with the config's engine and cell matching when the config changes, and calls `read_range(pdf, page, page, ocr_pages_left=1, cancel=Event())`. It prints one line, `run <stamp>: <pages> pages, <reads> page reads`, where `<reads>` counts the timed reads (warm-ups left out).

- [ ] **Step 1: Write the failing tests.**

```python
def test_number_tokens_keep_the_printed_form(self):
    self.assertEqual(number_tokens("Revenue 1,23,456.78 and (4,567) less -12"), ["1,23,456.78", "(4,567)", "-12"])

def test_disagreements(self):
    self.assertEqual(disagreements(["1,200", "(45)", "300"], ["1,200", "45", "300", "7"]), [("(45)", "45"), ("", "7")])

def test_run_sample_reads_each_page_under_its_configs_and_times_without_the_warm_up(self):
    ticks = iter(range(0, 1000, 2))          # each read takes 2.0 s on the fake clock
    calls = []
    def read(pdf, page, config): calls.append((page, config)); return fake_read(page)
    run = run_sample(pages(scanned=10, digital=5), corpus, out, read, clock=lambda: float(next(ticks)))
    rows = list(csv.DictReader((run / "scores.csv").open(encoding="utf-8")))
    self.assertEqual(len(rows), 10 * 4 + 5 * 2)
    self.assertEqual(len(calls), 4 + 10 * 4 + 5 * 2)        # one warm-up per config, untimed
    configs_in_order = [c for _, c in calls]
    self.assertEqual(configs_in_order, sorted(configs_in_order, key=list(CONFIGS).index))  # config by config, never interleaved
    self.assertEqual({r["seconds"] for r in rows}, {"2.0"})
    self.assertEqual({r["config"] for r in rows if r["kind"] == "digital"}, {"rapidocr-cm", "rapidocr-nocm"})
    self.assertEqual({r["numbers_printed"] for r in rows} | {r["numbers_extra"] for r in rows} | {r["checked"] for r in rows}, {""})

def test_the_run_folder_is_named_by_utc_time(self):
    run = run_sample(pages(scanned=10, digital=5), corpus, out, read, now=lambda: datetime(2026, 10, 21, 9, 30, 5, tzinfo=timezone(timedelta(hours=5, minutes=30))))
    self.assertEqual(run.name, "20261021T040005Z")
    DisagreementFile.model_validate_json((run / "disagreements.json").read_text(encoding="utf-8"))

def test_main_prints_the_run_and_counts_only(self):
    with redirect_stdout(io.StringIO()) as buf:
        main(["--pages", str(pages_file(scanned=10, digital=5)), "--corpus", str(corpus), "--out", str(out)],
             read=lambda pdf, page, config: fake_read(page), now=lambda: datetime(2026, 10, 21, 4, 0, 5, tzinfo=timezone.utc))
    self.assertEqual(buf.getvalue().splitlines(), ["run 20261021T040005Z: 15 pages, 50 page reads"])

def test_the_shared_disagreements_fixture_round_trips(self):
    data = json.loads(CONTRACT_FIXTURES.joinpath("eval", "ocr-disagreements.json").read_text())
    self.assertEqual(DisagreementFile.model_validate(data).model_dump(mode="json"), data)

def test_pages_file_needs_ten_scanned_and_five_digital_pages(self):
    with self.assertRaises(ValidationError): PagesFile.model_validate({"scanned": [PAGE] * 9, "digital": [PAGE] * 5})
```

`fake_read(page)` returns the `RangeRead` of `tests/fixtures/scanned.read.json` with its page number set. `pages(...)` and `corpus` come from a temporary folder holding copies of `scanned.pdf`. `CONTRACT_FIXTURES` is `packages/contracts/fixtures`, as `test_contracts.py` finds it. The fixture is `[{"filing": "aether-industries/ar-2024-25", "page": 12, "a": "rapidocr-cm", "b": "tesseract-cm", "pairs": [["(45)", "45"], ["", "7"]]}, {"filing": "aether-industries/ar-2024-25", "page": 12, "a": "rapidocr-cm", "b": "rapidocr-nocm", "pairs": [["1,200 300", "1,200300"]]}]`: synthetic tokens only.
- [ ] **Step 2: Run to see them fail.** `cd apps/indexer && uv run python -m unittest tests.test_ocr_sample -v`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `ocr_sample.py` as specified. Nothing is printed but the folder name and counts.
- [ ] **Step 4: Run to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/indexer packages/contracts/fixtures/eval/ocr-disagreements.json
git commit -m "feat(indexer): maester-indexer-ocr-sample reads a fixed page list under four reader configurations and writes a scoring sheet"
```

---

### Task 3: OCR scoring and the report in `maester-eval`

**Files:**
- Create: `apps/eval/src/maester_eval/ocr.py`, `apps/eval/src/maester_eval/eval_wire.py`; Modify: `apps/eval/src/maester_eval/cli.py` (an `ocr` sub-app), `apps/eval/src/maester_eval/paths.py` (`EvalPaths.ocr` = `base / "ocr"`)
- Create: `packages/contracts/fixtures/eval/request.json` (two documents, one question; read by Task 6's Zod test too)
- Modify: `.gitignore` (`data/eval/ocr/runs/`); Create: `data/eval/ocr/.gitkeep`
- Test: `tests/test_eval_ocr.py`, `tests/test_eval_wire.py`

**Interfaces:**
- Consumes: `SCORE_COLUMNS` and the `pages.json` shape (Task 2), copied as Pydantic models here. apps/eval does not import apps/indexer.
- Produces:
  - `eval_wire.py`:
    - `EvalRequestModel(version: Literal[1], documents: list[DocumentRef], questions: list[RequestQuestion])`;
    - `DocumentRef(filing: str, sha256: str /^[0-9a-f]{64}$/)`;
    - `RequestQuestion(id: str /^q\d{3}$/, query: str (1–500 chars), scope: list[str] (≥ 1))`;
    - `document_refs(filings: list[Filing], corpus_dir: Path) -> list[DocumentRef]`, the sha256 of each PDF. A missing PDF is an `EvalError` that names it.

    This is the JSON the worker's eval commands read (Tasks 6 and 7); Task 8 adds the rankings and bench models.
  - `read_scores(path: Path) -> list[ScoreRow]`. It reads `utf-8-sig`. Counts are whole numbers (`7` or `7.0`). It refuses, with the row number, a row whose `checked` is not `yes`, a missing count, or `numbers_wrong + numbers_missing > numbers_printed`.
  - `check_scores(rows: list[ScoreRow], pages: OcrPages, manifest: Manifest) -> None` raises `OcrScoreError` when:
    - a page lacks one of its configs;
    - `numbers_printed`, `headings_printed` or `table_rows_printed` differs between the configs of one page;
    - a filing is not in the manifest's `dev` set.
  - `Totals(errors: int, printed: int, seconds_mean: Decimal)`; `totals(rows, config, kind, measure: Literal["numbers", "headings", "table_rows"]) -> Totals`. Errors are wrong plus missing; for table rows they are `table_rows_wrong`.
  - `choose_engine(rows) -> EngineChoice(engine: Literal["rapidocr", "tesseract"] | None, reason: Literal["tie", "fewer_wrong_numbers", "fewer_wrong_headings", "slower_than_twice"])`, on the scanned `-cm` rows. Tesseract replaces RapidOCR only:
    - when its number errors are lower by more than `max(1, Fraction(numbers_printed, 100))`; or
    - when the number errors are within that band and its heading errors are lower by more than `max(1, Fraction(headings_printed * 5, 100))`.

    The reverse holds for keeping RapidOCR. A winner whose `seconds_mean` is more than twice the other's gives `engine=None, reason="slower_than_twice"`, which the investor decides. Otherwise the result is `("rapidocr", "tie")`.
  - `choose_cell_matching(rows, engine: str) -> CellMatchingChoice(cell_matching: bool, reason: Literal["tie", "fewer_broken_rows"])`, on the chosen engine's scanned rows plus the digital rows (`engine=None` reads as `rapidocr`). `false` replaces `true` only when its `table_rows_wrong` is lower by more than `max(1, Fraction(table_rows_printed * 2, 100))`.
  - `render_ocr_report(rows, pages, engine_choice, cell_choice, run_name, generated_at) -> str`. It contains:
    - a header with the run, the date and each config's engine string, read from the run's JSON files;
    - a table by config: `| config | number errors | numbers printed | rate | heading errors | headings printed | table rows wrong | table rows printed | seconds per page |`;
    - a per-page table;
    - "The rule" and "The decision", with the band values;
    - an appendix "Disagreements" listing filing, page, the configs and their disagreeing tokens from the `.md` files. These are places where the configs differ from each other, not checked errors.
  - CLI: `maester-eval ocr request --out <file>` writes an `EvalRequestModel` holding every `dev` filing present in the corpus and no questions. `maester-eval ocr report --run <name|latest> [--to docs/eval/<date>-ocr-spot-check.md]` writes `report.md` into the run folder and copies it to `--to`.

- [ ] **Step 1: Write the failing tests.** The fixture has two scanned pages, A and B, each printing 300 numbers, 25 headings and 40 table rows, and one digital page, C (200, 5, 30).

| Config | Number errors (A + B) | Heading errors | Table rows wrong | Seconds per page |
| --- | --- | --- | --- | --- |
| rapidocr-cm | 7 + 7 = 14 | 2 | A 3, B 2; C 6 | 8.0 |
| tesseract-cm | 5 + 4 = 9 | 0 | A 2, B 2 | 12.0 |
| rapidocr-nocm | | | A 1, B 1; C 2 | |

```python
def test_engine_tie_keeps_rapidocr(self):
    # bands: numbers max(1, 600/100) = 6, diff 14 - 9 = 5; headings max(1, 50*5/100) = 5/2, diff 2
    self.assertEqual(choose_engine(ROWS), EngineChoice("rapidocr", "tie"))

def test_tesseract_wins_on_numbers_beyond_the_band(self):
    rows = with_number_errors(ROWS, "tesseract-cm", a=4, b=3)   # 7: diff 7 > 6
    self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_numbers"))

def test_a_winner_more_than_twice_as_slow_goes_to_the_investor(self):
    rows = with_seconds(with_number_errors(ROWS, "tesseract-cm", a=4, b=3), "tesseract-cm", "17.0")  # 17.0 > 2 * 8.0
    self.assertEqual(choose_engine(rows), EngineChoice(None, "slower_than_twice"))

def test_cell_matching_off_wins_beyond_the_band(self):
    # table rows printed 40 + 40 + 30 = 110; band max(1, 110*2/100) = 11/5; on wrong 11, off wrong 4
    self.assertEqual(choose_cell_matching(ROWS, "rapidocr"), CellMatchingChoice(False, "fewer_broken_rows"))

def test_cell_matching_tie_keeps_it_on(self):
    self.assertEqual(choose_cell_matching(with_table_rows_wrong(ROWS, "rapidocr-nocm", a=4, b=3, c=2), "rapidocr"),
                     CellMatchingChoice(True, "tie"))      # 9: diff 2 <= 11/5

def test_printed_counts_must_agree_between_configs(self):
    with self.assertRaisesRegex(OcrScoreError, "page 12 of .*: numbers_printed differs between configs"):
        check_scores(with_printed(ROWS, "tesseract-cm", numbers=301), PAGES, MANIFEST)

def test_unchecked_row_is_refused_with_its_line(self):
    with self.assertRaisesRegex(OcrScoreError, "sheet row 3: checked must be yes"): read_scores(sheet(unchecked_line=3))

def test_the_shared_request_fixture_round_trips(self):        # test_eval_wire.py
    data = json.loads(FIXTURES.joinpath("request.json").read_text())
    self.assertEqual(EvalRequestModel.model_validate(data).model_dump(mode="json"), data)

def test_report_states_the_rule_the_bands_and_the_decision(self):
    md = render_ocr_report(ROWS, PAGES, EngineChoice("rapidocr", "tie"), CellMatchingChoice(False, "fewer_broken_rows"), "r", NOW)
    self.assertIn("| rapidocr-cm | 14 | 600 | 0.023 |", md)   # 14/600 = 0.02333…
    self.assertIn("RapidOCR stays the engine (tie)", md)
    self.assertIn("INDEX_TABLE_CELL_MATCHING becomes false", md)
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest tests.test_eval_ocr tests.test_eval_wire -v`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `ocr.py` and the sub-app (`app.add_typer(ocr_app, name="ocr")`), with errors through `_reports_errors`.
- [ ] **Step 4: Run to see them pass.** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS, the existing eval tests included.
- [ ] **Step 5: Commit.**

```bash
git add apps/eval tests/test_eval_ocr.py tests/test_eval_wire.py packages/contracts/fixtures/eval .gitignore data/eval/ocr/.gitkeep
git commit -m "feat(eval): maester-eval ocr report scores the spot-check sheet and applies the engine and cell-matching rules"
```

---

### Task 4: Candidate models in the registry, with stored dimensions

**Files:**
- Modify: `packages/document-index/src/models.ts`, `embedder.ts` (`check` → `toStored`), `fake.ts`, `index.ts`
- Create: `packages/contracts/fixtures/index/embedding-models.json`, `packages/contracts/fixtures/index/embedding-parity.json`
- Test: `packages/document-index/test/models.test.ts`, `embedder.test.ts`

**Interfaces:**
- Produces:
  - `STORED_DIMENSIONS = 1024`.
  - `interface EmbeddingModel { servedDimensions: number; dimensions: number; queryPrefix: string; documentPrefix: string; promptsFrom: "card" | "ours" | "none" }`. `dimensions` is what Maester keeps: `dimensions <= servedDimensions` and `dimensions <= STORED_DIMENSIONS`.
  - `EMBEDDING_MODELS`:
    - `Snowflake/snowflake-arctic-embed-l-v2.0`: 1024 served and kept, `"query: "` and `""`, `"card"`.
    - `Qwen/Qwen3-Embedding-0.6B`: 1024 and 1024, `""` before a document, `"ours"`. Its query prefix is `"Instruct: Given an investor's question about an Indian listed company, retrieve the passages of its annual report or financial results that answer it\nQuery:"`. The format, `Instruct: {task}\nQuery:` with no space after the colon, is checked against the model card at the pinned revision in Step 1; the task sentence is ours.
    - `voyageai/voyage-4-nano`: 2048 served, 1024 kept, `"card"`. Its prefixes are copied verbatim in Step 1 from `prompts` in `config_sentence_transformers.json` at the pinned revision.
    - `ibm-granite/granite-embedding-english-r2`: 768 and 768, `""` and `""`, `"none"`.
  - `toStored(model: string, served: number[]): number[]`. It refuses a vector whose length is not `servedDimensions` (throws `EmbedderError("EMBEDDING_FAILED", false, …)`). It keeps the first `dimensions` values, renormalises them to unit length when it cut any, then pads with zeros to `STORED_DIMENSIONS`.
  - `TeiEmbedder.embed` returns `toStored` vectors, and the `check` message becomes `did not match ${count} vectors of ${servedDimensions} dimensions`. `FakeEmbedder` makes `dimensions` values and pads them.
  - Fixtures:
    - `embedding-models.json` holds `[{ id, servedDimensions, dimensions, queryPrefix, documentPrefix, promptsFrom }]` in registry order.
    - `embedding-parity.json` holds `{ "queries": [5 strings], "documents": [5 strings] }`: synthetic text in the style of the phase 2 fixtures ("Synthetic Cements Limited", "25 Borrowings", `1,23,456.78`, `₹`), with no real filing text.

- [ ] **Step 1: Resolve the pins.** For each candidate, take its current commit sha on Hugging Face and read `config_sentence_transformers.json`, `modules.json` and `1_Pooling/config.json` at that sha. Record the pooling and the prompts. For voyage-4-nano, also read every `*.py` in the repository at the sha before anything runs it, and note in `apps/indexer/README.md` what its custom head does. The revisions go to Task 5's lock. Write the fixture from these values.
- [ ] **Step 2: Write the failing tests.**

```ts
it("the registry is the shared fixture", () => {
  expect(Object.entries(EMBEDDING_MODELS).map(([id, m]) => ({ id, ...m }))).toEqual(fixture("embedding-models.json"));
});
it("every model keeps at most what it is served and what the column holds", () => {
  for (const m of Object.values(EMBEDDING_MODELS)) {
    expect(m.dimensions).toBeLessThanOrEqual(Math.min(m.servedDimensions, STORED_DIMENSIONS));
  }
});
it("puts Qwen's instruction before a query only", () => {
  expect(embeddingInput(QWEN, "query", "x")).toBe(EMBEDDING_MODELS[QWEN]!.queryPrefix + "x");
  expect(embeddingInput(QWEN, "document", "x")).toBe("x");
});
it("pads a 768-dimension vector with zeros, and cosine is unchanged", () => {
  const a = unit([1, 1, ...zeros(766)]), b = unit([0, 1, ...zeros(766)]);
  const [sa, sb] = [toStored(GRANITE, a), toStored(GRANITE, b)];
  expect(sa).toHaveLength(1024);
  expect(sa.slice(768).every((x) => x === 0)).toBe(true);
  expect(cosine(sa, sb)).toBeCloseTo(Math.SQRT1_2, 12);
});
it("cuts voyage's 2048 values to the first 1024 and renormalises", () => {
  const v = zeros(2048); v[0] = 0.6; v[1024] = 0.8;
  expect(toStored(VOYAGE, v)).toEqual([1, ...zeros(1023)]);
});
it("refuses an answer of the wrong served length", () => {
  expect(() => toStored(GRANITE, zeros(1024))).toThrow(/768/);
});
```

In `embedder.test.ts`, a TEI fake answering 768 values for granite returns 1024 values. One answering 1024 values for granite throws `EmbedderError` with `retryable: false`.
- [ ] **Step 3: Run to see them fail.** `pnpm --filter @maester/document-index exec vitest run test/models.test.ts test/embedder.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** `EmbeddingModel.dimensions` stops being the literal type `1024`. Nothing outside `models.ts` and `embedder.ts` pads or cuts.
- [ ] **Step 5: Run to see them pass.** `pnpm --filter @maester/document-index test && pnpm --filter @maester/worker test && pnpm --filter @maester/api test`. Expected: PASS. The worker's `EMBEDDING_MODEL` refinement now accepts the four ids.
- [ ] **Step 6: Commit.**

```bash
git add packages/document-index packages/contracts/fixtures/index
git commit -m "feat(document-index): candidate embedding models, with served and kept dimensions and one function that cuts, renormalises and pads"
```

---

### Task 5: Candidates in the indexer's lock, the fetch, and the parity check

**Files:**
- Modify: `apps/indexer/models.lock.json` (`candidates`), `apps/indexer/src/maester_indexer/chunker.py` (`_locked_model`), `fetch_models.py` (`--candidates`), `apps/indexer/pyproject.toml` (dependency group `parity = ["sentence-transformers==<pin>"]`)
- Create: `apps/indexer/src/maester_indexer/parity.py`, `apps/indexer/scripts/embedding_parity.py`
- Test: `apps/indexer/tests/test_versions.py`, `test_chunker.py`, `test_fetch_models.py`, `test_parity.py`

**Interfaces:**
- Consumes: the revisions resolved in Task 4 Step 1; `packages/contracts/fixtures/index/embedding-models.json` and `embedding-parity.json`.
- Produces:
  - Lock: `"candidates": [{ "id": "Qwen/Qwen3-Embedding-0.6B", "revision": "<sha>" }, { "id": "voyageai/voyage-4-nano", "revision": "<sha>" }, { "id": "ibm-granite/granite-embedding-english-r2", "revision": "<sha>" }]`. `models_hash` still hashes only `docling`.
  - `_locked_model(folder)`: the lock's `embedding.id`, or any `candidates[].id`, that the folder is named after; otherwise `None`. `load_tokenizer` keeps its signature.
  - `maester-indexer-fetch-models --out /models --candidates` also fetches each candidate at its revision into `<out>/embed/<id>`, with `EMBED_ALLOW_PATTERNS` and `EMBED_IGNORE_PATTERNS`. The lock is still copied last.
  - `parity.stored(vector: list[float], dimensions: int) -> list[float]`: the first `dimensions`, renormalised when cut. It mirrors `toStored`, without the padding.
  - `parity.compare(reference: list[list[float]], served: list[list[float]], threshold: float = 0.999) -> ParityResult(min_cosine: float, passed: bool, failures: list[int])`.
  - `scripts/embedding_parity.py --model <id> --tei <url> --out <file>`. It reads the registry entry from the fixture and the revision from the lock. It encodes the parity strings, with the registry's prefixes put before them, through:
    - `SentenceTransformer(id, revision=rev, trust_remote_code=(id == "voyageai/voyage-4-nano"))` with `normalize_embeddings=True`;
    - TEI's `/embed`, with `normalize: true` and `truncate: false`.

    It applies `stored` to both and writes `{ model, revision, minCosine, passed, promptsMatchCard }` to `--out`. `promptsMatchCard` is true when `promptsFrom` is not `"card"`, or when the model's `prompts` equal the registry's prefixes. It exits 1 unless `passed` and `promptsMatchCard`.

- [ ] **Step 1: Write the failing tests.**

```python
def test_candidates_do_not_change_the_reader_hash(self):          # live page_read keys stay valid
    self.assertEqual(models_hash({**LOCK, "candidates": [{"id": "Qwen/Qwen3-Embedding-0.6B", "revision": "b" * 40}]}), models_hash(LOCK))

def test_the_lock_names_every_registry_model(self):
    lock = json.loads(shipped_lock().read_text())
    ids = [lock["embedding"]["id"], *[c["id"] for c in lock["candidates"]]]
    self.assertEqual(sorted(ids), sorted(m["id"] for m in json.loads(FIXTURE.read_text())))

def test_a_candidate_folder_is_locked(self):      # test_chunker.py, with a lock in a temporary models folder
    self.assertEqual(_locked_model(models / "embed" / "Qwen" / "Qwen3-Embedding-0.6B"), "Qwen/Qwen3-Embedding-0.6B")
def test_a_folder_of_an_unlocked_model_is_not(self):
    self.assertIsNone(_locked_model(models / "embed" / "BAAI" / "bge-m3"))

def test_candidates_are_fetched_only_when_asked(self):   # test_fetch_models.py, snapshot_download patched
    main(["--out", out, "--candidates"]); self.assertEqual(fetched_ids(), [ARCTIC, QWEN, VOYAGE, GRANITE])
    main(["--out", out]);                self.assertEqual(fetched_ids(), [ARCTIC])

def test_stored_cuts_and_renormalises(self):              # test_parity.py
    self.assertEqual(stored([0.6, 0.0, 0.8], 2), [1.0, 0.0])
def test_compare_fails_below_the_threshold(self):
    r = compare([[1.0, 0.0], [1.0, 0.0]], [[1.0, 0.0], [0.6, 0.8]])
    self.assertEqual((r.passed, r.failures), (False, [1])); self.assertAlmostEqual(r.min_cosine, 0.6)
```

- [ ] **Step 2: Run to see them fail.** `cd apps/indexer && uv run python -m unittest tests.test_versions tests.test_chunker tests.test_fetch_models tests.test_parity -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pin `sentence-transformers` to the newest release at least two weeks old that `uv lock` resolves with the pinned torch. It stays out of the image: the group is dev-only.
- [ ] **Step 4: Run to see them pass.** Same command. Expected: PASS. Also `docker compose config -q` (no output).
- [ ] **Step 5: Commit.**

```bash
git add apps/indexer
git commit -m "feat(indexer): candidate embedding models in the lock and the fetch; the tokenizer loads any locked model; a TEI parity check"
```

---

### Task 6: Index jobs keyed by model, the candidate runner and the prune

**Files:**
- Modify: `packages/contracts/src/job.ts` (`JobTypes.DOCUMENT_INDEX_EVAL = "document.index.eval"`), `packages/db/src/queries/document-index.ts` (`documentsNeedingIndex`, new `deleteModelRevisions`), `apps/worker/src/jobs/document-index.ts` (the guard), `apps/worker/src/index-backfill.ts` (passes `indexVersion`)
- Create: `packages/contracts/src/retrieval-eval.ts` (exported from `packages/contracts/src/index.ts`), `apps/worker/src/index-candidate.ts`, `index-candidate-cli.ts`, `index-prune.ts`, `index-prune-cli.ts`, `apps/worker/src/eval/resolve.ts`
- Modify: `apps/worker/package.json` (`"index:prune": "tsx --env-file=../../.env src/index-prune-cli.ts"`), `apps/worker/tsup.config.ts` (`entry: { server: …, "index-candidate": "src/index-candidate-cli.ts" }`)
- Test: `packages/contracts/test/retrieval-eval.test.ts`, `packages/db/test/document-index.test.ts`, `apps/worker/test/document-index.test.ts`, `apps/worker/test/index-candidate.test.ts`, `apps/worker/test/index-prune.test.ts`, `apps/worker/test/eval.test.ts`

**Interfaces:**
- Consumes: `startQueueRunner`, `executeJob`, `WorkerDeps` (phase 1); `createJob`, `requeue` (from `index-backfill.ts`); `packages/contracts/fixtures/eval/request.json` (Task 3).
- Produces:
  - Zod in `retrieval-eval.ts`:
    - `EvalRequest = { version: 1; documents: { filing: string; sha256: /^[0-9a-f]{64}$/ }[]; questions: { id: /^q\d{3}$/; query: string (1–500 chars); scope: string[] (filing ids, ≥ 1) }[] }`, the twin of Task 3's `EvalRequestModel`;
    - `PageSource = "text_layer" | "ocr" | "mixed" | "none"`;
    - `EvalDocument = { filing; sha256; documentId: uuid | null; revisionId: uuid | null; state: "complete" | "partial" | null; versions: { indexVersion; doclingVersion; ocrEngine; readerOptions; chunkerVersion } | null; pages: { page: int ≥ 1; source: PageSource }[] }`.
  - In `document.index`, before the document is read: `if (!job.idempotencyKey.endsWith(`:${indexPipelineVersion(ctx.env.EMBEDDING_MODEL)}`)) throw new JobFailure("INDEX_MODEL_NOT_SERVED", "the job is for another embedding model or index version than this worker's", false)`.
  - `documentsNeedingIndex(db, { workspaceId?, documentIds?, model, pipelineVersion, indexVersion })`: a document is current only with a complete or partial revision of that model whose `index_version = indexVersion`.
  - `deleteModelRevisions(db, { model: string; workspaceId?: string; dryRun?: boolean }) -> Promise<{ revisions: number; chunks: number }>` deletes `document_index_revision` rows of the model. The cascade removes their pages, chunks and embeddings. `page_read` is kept.
  - `resolveEvalDocuments(db, workspaceId: string, model: string, refs: { filing: string; sha256: string }[]) -> Promise<EvalDocument[]>`. Each ref resolves to the workspace's stored document with that `content_sha256` that is not a duplicate. Then it finds that document's complete or partial revision for the model, with its versions and its pages' sources. A missing document or revision is `null`. `pageSource(itemsTextLayer, itemsOcr)` gives `text_layer` (`n, 0`), `ocr` (`0, n`), `mixed` (both `> 0`) or `none` (`0, 0`).
  - `runIndexCandidate(argv, source, out, make) -> Promise<number>`: `index:candidate --workspace <id> --model <id> --request <file> [--embedder-url <url>] [--indexer-url <url>]`. The defaults are `http://embedder-candidate` and `http://indexer-candidate:8791`. It:
    - refuses (exit 1) a `--model` that is not in the registry, or that equals `EMBEDDING_MODEL`;
    - resolves the request's documents and refuses any that is not stored;
    - creates one `document.index.eval` job per document with `pipelineVersion = indexPipelineVersion(model)`. Through `requeue`, it queues again a failed job, and a succeeded job whose document has no current revision for the model (one pruned since), so a later measurement can rebuild;
    - starts `startQueueRunner` with `handlers = { "document.index.eval": documentIndex }`, `env = { ...env, EMBEDDING_MODEL: model }`, `extractor: null`, and the candidate indexer and embedder;
    - polls its jobs every 5 s until all are terminal, stops the runner (grace 25 s), and prints `indexed <n>, failed <m> (<code>: <count>, …)`.

    It exits 0 only when every job succeeded.
  - `runIndexPrune(argv, source, out, make) -> Promise<number>`: `index:prune --model <id> [--workspace <id>] [--dry-run]`. It refuses `EMBEDDING_MODEL` and prints `revisions <n>, chunks <m>`.

- [ ] **Step 1: Write the failing tests.**
  - `retrieval-eval.test.ts`: `request.json` parses as `EvalRequest`. A question id `Q1` and a sha256 of 63 characters are refused.
  - `eval.test.ts`, `resolveEvalDocuments maps a duplicate to its original, a document of another workspace to nothing, and gives page sources`: page counts `3/0`, `0/3`, `2/1` and `0/0` give `text_layer`, `ocr`, `mixed` and `none`. A document with only a `building` revision for the model has `revisionId: null`.
  - `document-index.test.ts`, `a job for another model fails INDEX_MODEL_NOT_SERVED and is not retried`:
    - the key is `document.index:<doc>:1:Qwen/Qwen3-Embedding-0.6B` and the worker runs arctic;
    - the job is `failed` with code `INDEX_MODEL_NOT_SERVED`, `attempt` is 1, and no `document_index_revision` exists;
    - the fake indexer was never called.
  - `packages/db/test/document-index.test.ts`, `a revision of an older index version is not current`: with a complete revision whose `index_version = "1"`, `documentsNeedingIndex({ …, indexVersion: "2" })` returns the document and `{ …, indexVersion: "1" }` does not.
  - `index-candidate.test.ts`, using a `make` that injects the database, a fake indexer and a `FakeEmbedder(QWEN)`:
    - `refuses the live model`: exit 1, message `--model is the live EMBEDDING_MODEL; the worker indexes it`;
    - `builds the candidate's revisions and leaves the live ones`:
      - two seeded documents with arctic revisions get Qwen revisions, `complete`, with `embedding_model = QWEN`;
      - the arctic revisions' ids are unchanged;
      - job keys are `document.index.eval:<doc>:1:Qwen/Qwen3-Embedding-0.6B`;
      - the output is `indexed 2, failed 0`;
    - `after a prune, a rerun rebuilds`: run, `deleteModelRevisions({ model: QWEN })`, run again; both documents again have complete Qwen revisions, and the output is `indexed 2, failed 0`;
    - `builds no extractor and runs no other type`: the deps given to the runner have `extractor === null` and `Object.keys(handlers)` equals `["document.index.eval"]`;
    - `the live worker never claims an eval job`: `Object.keys(handlers)` of `apps/worker/src/jobs/index.ts` does not contain `"document.index.eval"`.
  - `index-prune.test.ts`:
    - `prunes one model and nothing else`: after a prune of Qwen, no Qwen revision, chunk or embedding is left, the arctic rows are as before, and `page_read` keeps its row count; the output is `revisions 2, chunks <seeded count>`;
    - `refuses the live model`;
    - `a dry run deletes nothing`.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/contracts exec vitest run test/retrieval-eval.test.ts && pnpm --filter @maester/db exec vitest run test/document-index.test.ts && pnpm --filter @maester/worker exec vitest run test/document-index.test.ts test/index-candidate.test.ts test/index-prune.test.ts test/eval.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `index-backfill.ts` passes `indexVersion: INDEX_PIPELINE_VERSION`. `INDEX_PIPELINE_VERSION` stays `"1"`; Task 11 bumps it only if a reader default changes.
- [ ] **Step 4: Run to see them pass.** `pnpm --filter @maester/db test && pnpm --filter @maester/worker test && pnpm --filter @maester/worker build`. Expected: PASS; `dist/index-candidate.js` exists.
- [ ] **Step 5: Commit.**

```bash
git add packages/contracts/src/job.ts packages/db apps/worker
git commit -m "feat(worker): index jobs keyed by model (INDEX_MODEL_NOT_SERVED), index:candidate through its own runner, index:prune; a version bump rebuilds"
```

---

### Task 7: The ranker, the sources and the bench (TypeScript)

**Files:**
- Modify: `packages/document-index/src/search.ts` (extract `rankChunks`), `index.ts`
- Create: `packages/document-index/src/evaluate.ts`, `packages/contracts/fixtures/eval/{rankings.json,bench.json}`; Modify: `packages/contracts/src/retrieval-eval.ts` (Task 6)
- Create: `apps/worker/src/eval/{sources.ts,rank.ts,bench.ts,cli.ts}`; Modify: `apps/worker/package.json` (`"eval": "tsx --env-file=../../.env src/eval/cli.ts"`)
- Test: `packages/document-index/test/search.test.ts`, `test/evaluate.test.ts`, `packages/contracts/test/retrieval-eval.test.ts`, `apps/worker/test/eval.test.ts`

**Interfaces:**
- Produces:
  - `rankChunks(db: Db, input: BranchInput & { query: string }): Promise<{ vector: string[]; keyword: string[] }>`. This is exactly today's two branch reads inside `searchChunks`: the `set local` transaction, the short-answer exact fallback, and the keyword branch. `searchChunks` becomes embed, then `rankChunks`, then `fuse`, then hydrate, with unchanged behaviour.
  - `rankPages(db, embedder: Embedder, input: { workspaceId: string; query: string; documentIds: string[] }): Promise<{ vector: ChunkPage[]; keyword: ChunkPage[]; hybrid: ChunkPage[] }>`. `ChunkPage = { documentId: string; pageNumber: number }`, one per chunk, in rank order. `hybrid` is `fuse(vector, keyword)` in full, so it has up to 100 entries.
  - Added to `retrieval-eval.ts` (beside Task 6's `EvalRequest`, `PageSource` and `EvalDocument`):
    - `EvalSources = { version: 1; model: string; documents: EvalDocument[] }`.
    - `PageRef = { filing: string; page: int ≥ 1 }`.
    - `EvalRankings = EvalSources & { rankings: { questionId: string; vector: PageRef[]; keyword: PageRef[]; hybrid: PageRef[] }[] }`.
    - `EvalBench = { version: 1; model: string; batch: int; chunks: int; warmupChunks: int; seconds: number; queries: int; queryMillisMedian: number }`.
  - `benchEmbedder(embedder: Embedder, texts: string[], batch: number, queries: string[], clock: () => number = performance.now): Promise<Omit<EvalBench, "version" | "model">>`. Texts are sorted longest first and sent `batch` at a time as `"document"`. The first batch is a warm-up and is not timed. Each query is sent alone as `"query"`, and `queryMillisMedian` is the median of those times.
  - `pnpm --filter @maester/worker eval <command>`, where every command takes `--workspace <id> --request <file> --out <file>`:
    - `sources [--model <id>]`: `EvalSources` for the request's documents. The default model is `EMBEDDING_MODEL`.
    - `rank --model <id> --embedder-url <url>`: `EvalRankings`. Each question is searched with `documentIds` set to its `scope`'s resolved documents. Chunks are mapped to `{ filing, page }` through the request's sha256s. When any scope document lacks a revision, the command still writes its sources, with `rankings: []`, and exits 2, printing the filings.
    - `bench --model <id> --embedder-url <url> [--chunks 480] [--text-model <id>]`: the texts are the first `--chunks` chunks, contextualized, of the `--text-model` revisions (default `EMBEDDING_MODEL`) of the request's documents. They are ordered by the request's document order, then page, then `seq`, so every model embeds the same texts. The queries are the request's questions.

    The CLI prints counts only. A question's text never reaches the console or `--out`, except in the request file itself.

- [ ] **Step 1: Write the failing tests.**
  - `search.test.ts`, `rankChunks gives each branch's own ranking`, on the existing seeds: `vector[0]` is the chunk whose embedded text equals the query, and `keyword` lists only chunks containing the query word.
  - All existing `searchChunks` tests stay unchanged and pass. Among them, `never returns a chunk of a building revision, of another model or of another workspace` is the pin for Review Focus 1: live search ignores candidate revisions.
  - `evaluate.test.ts`:
    - `ranks pages within the given documents only`: a chunk in a third document is never returned;
    - `hybrid is the whole fusion, chunk by chunk`: two chunks on one page appear twice, in fused order.
  - `retrieval-eval.test.ts`: `rankings.json` parses as `EvalRankings` and `bench.json` as `EvalBench`. A `PageRef` with `page: 0` is refused.
  - `eval.test.ts`:
    - `rank exits 2 and writes no rankings when a scope document has no revision for the model`;
    - `bench leaves the warm-up out`: 48 texts, batch 16, a clock that advances 1000 ms per embed call, and 3 queries give `{ batch: 16, chunks: 32, warmupChunks: 16, seconds: 2, queries: 3, queryMillisMedian: 1000 }`.
- [ ] **Step 2: Run to see them fail.** `pnpm --filter @maester/document-index exec vitest run && pnpm --filter @maester/contracts exec vitest run test/retrieval-eval.test.ts && pnpm --filter @maester/worker exec vitest run test/eval.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** This is a pure refactor of `searchChunks` (no SQL changes), plus the new files.
- [ ] **Step 4: Run to see them pass.** Same commands, and `pnpm --filter @maester/api test` (the search route). Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add packages/document-index packages/contracts apps/worker
git commit -m "feat(eval): rank pages with the product's own branches; sources, rank and bench commands with JSON contracts and no text"
```

---

### Task 8: The retrieval set: schema, loader and request

**Files:**
- Create: `apps/eval/src/maester_eval/retrieval.py`; Modify: `apps/eval/src/maester_eval/eval_wire.py`, `apps/eval/src/maester_eval/paths.py` (`EvalPaths.retrieval` = `base / "retrieval"`), `apps/eval/src/maester_eval/cli.py` (a `retrieval` sub-app)
- Modify: `.gitignore` (`data/eval/retrieval/`)
- Test: `tests/test_eval_retrieval.py`; shared fixtures from Task 7

**Interfaces:**
- Consumes: `load_manifest`, `Manifest`, `Filing` (phase 0); `EvalRequestModel` and `document_refs` (Task 3); the `rankings.json` and `bench.json` fixtures (Task 7).
- Produces:
  - In `eval_wire.py`: `EvalRankingsModel` and `EvalBenchModel`, the twins of Task 7's `EvalRankings` and `EvalBench`, with the same field names (camelCase aliases on the wire).
  - The files:
    - `data/eval/retrieval/corpus.json`: `{ "companies": [manifest company names] }`. Every `dev` filing of those companies is the retrieval corpus.
    - `data/eval/retrieval/questions.csv`: columns `id,filing,query,pages,status,notes`.
  - `RetrievalQuestion(id: str /^q\d{3}$/, filing: str, query: str, pages: tuple[int, ...], status: Literal["draft", "verified"])`. `notes` is never read beyond the sheet.
  - `read_questions(path) -> list[RetrievalQuestion]`. It reads `utf-8-sig` and skips rows whose every cell is empty. `pages` is whole numbers (`12` or `12.0`) separated by `;`, with optional spaces, and is sorted and de-duplicated. It refuses, with `sheet row <n>`, any of these: a page below 1, `12-13`, an empty query, a duplicate id, or an unknown status.
  - `read_corpus(path) -> RetrievalCorpus` and `corpus_filings(corpus, manifest) -> list[Filing]` (manifest order). A company that is not in the manifest, or that has no `dev` filing, is a `RetrievalSetError`.
  - `check_set(questions, corpus, manifest) -> None`. A question's filing must be in the corpus. `verified` questions must number at least 40, or it raises `RetrievalSetError("<n> verified questions; the set needs at least 40")`.
  - `build_request(questions, corpus, manifest, corpus_dir: Path) -> EvalRequestModel`:
    - `documents` is every corpus filing with the sha256 of `<corpus_dir>/<file>`;
    - `questions` is the verified ones only, each with `scope` = the corpus filings of its company.

    A missing PDF is a `RetrievalSetError` that names it.
  - CLI:
    - `maester-eval retrieval check` prints counts: questions, verified, by filing kind, the number of corpus filings.
    - `maester-eval retrieval request [--label <word>]` makes `data/eval/retrieval/runs/<stamp>[-label]/` with `request.json` and prints the folder.

- [ ] **Step 1: Write the failing tests.**

```python
def test_a_sheet_saved_by_a_spreadsheet(self):
    text = "﻿id,filing,query,pages,status,notes\nq001,aether-industries/ar-2024-25,Who audits the company?,12.0,verified,\n" \
           "q002,aether-industries/ar-2024-25,What are the borrowings?,40; 41,draft,\n,,,,,\n"
    qs = read_questions(write(text))
    self.assertEqual([(q.id, q.pages, q.status) for q in qs], [("q001", (12,), "verified"), ("q002", (40, 41), "draft")])

def test_a_page_range_a_spreadsheet_might_read_as_a_date_is_refused(self):
    with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages '12-13'"): read_questions(write(row(pages="12-13")))

def test_the_set_needs_forty_verified_questions(self):
    with self.assertRaisesRegex(RetrievalSetError, "39 verified questions; the set needs at least 40"):
        check_set(verified(39), CORPUS, MANIFEST)

def test_a_question_outside_the_corpus_is_refused(self):
    with self.assertRaisesRegex(RetrievalSetError, "q001: .* is not in the retrieval corpus"): check_set([q(filing="other/ar-2024-25")] + verified(40), CORPUS, MANIFEST)

def test_request_scopes_each_question_to_its_company(self):
    req = build_request(verified(40), CORPUS, MANIFEST, corpus_dir)
    self.assertEqual([d.filing for d in req.documents], ["aether-industries/ar-2024-25", "aether-industries/q1-2025-26", "bharat-paints/ar-2024-25"])
    self.assertEqual(req.questions[0].scope, ["aether-industries/ar-2024-25", "aether-industries/q1-2025-26"])
    self.assertEqual(req.documents[0].sha256, hashlib.sha256(b"%PDF-1.7 a").hexdigest())

def test_the_shared_rankings_and_bench_fixtures_round_trip(self):
    for name, model in (("rankings.json", EvalRankingsModel), ("bench.json", EvalBenchModel)):
        data = json.loads(FIXTURES.joinpath(name).read_text())
        self.assertEqual(model.model_validate(data).model_dump(mode="json", by_alias=True), data)
```

- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest tests.test_eval_retrieval -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** The console shows ids and counts only.
- [ ] **Step 4: Run to see them pass.** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/eval tests/test_eval_retrieval.py .gitignore
git commit -m "feat(eval): the retrieval set as a sheet, its corpus of dev companies, and the request the ranker reads"
```

---

### Task 9: Retrieval scoring, the model rule and the report

**Files:**
- Create: `apps/eval/src/maester_eval/retrieval_scoring.py`, `apps/eval/src/maester_eval/retrieval_report.py`; Modify: `cli.py` (`retrieval report`)
- Test: `tests/test_eval_retrieval_scoring.py`

**Interfaces:**
- Consumes: `RetrievalQuestion`, `EvalRankingsModel`, `EvalBenchModel` (Task 8).
- Produces:
  - `Metrics(n: int, recall_at_5: Fraction, recall_at_10: Fraction, mrr: Fraction)`.
    - Recall@k is the share of questions with at least one answering page, `(filing, page)`, among the pages of the top k chunks.
    - Reciprocal rank is `1/r` for the first chunk on an answering page, or 0 when there is none in the list.
    - k counts chunks, as the product's `limit` does.
  - `question_source(question, rankings) -> PageSource`: the answering pages' source when all agree, otherwise `mixed`. An answering page whose source is `none` or that is not in the document's pages raises `RetrievalScoreError("q001: page 12 of <filing> has no text")`.
  - `score_model(questions, rankings) -> ModelScore(model, by_method: dict[Literal["vector", "keyword", "hybrid"], dict[Literal["all", "text_layer", "ocr", "mixed"], Metrics]], first_ranks: dict[str, dict[str, int | None]])`. It raises `IncompleteIndexError("<model>: no current revision for <filing>, …")` when any document in a scope has `revisionId: null`, or when `rankings` is empty.
  - `check_same_reads(rankings_by_model: dict[str, EvalRankingsModel]) -> None` raises `RetrievalScoreError("<filing>: the models read it differently (<field>)")`. The fields are `versions` without the model, or `pages`. A re-read with a different OCR budget or reader default would otherwise compare models on different text.
  - `seconds_per_1000(bench) -> Decimal` = `Decimal(str(seconds)) * 1000 / chunks`.
  - `choose_model(scores: list[ModelScore], benches: dict[str, EvalBenchModel], current: str) -> ModelChoice(model: str, reason: Literal["best_recall", "tie_broken_by_cpu_time", "tie_kept_current"], band: Fraction)`.
    - `band = Fraction(1, n)`, where `n` is the number of verified questions.
    - The tied set is every model whose hybrid `recall_at_10` over `all` is within `band` of the best.
    - Within the tied set, the lowest `seconds_per_1000` wins. When it is equal, the current model is kept if tied, else the model listed first.
  - `needs_granite(choice, benches) -> bool`: `seconds_per_1000(winner) * Decimal("1.5") > 3600`.
  - The run folder, `data/eval/retrieval/runs/<run>/`, holds:
    - `request.json`;
    - `<slug>.rankings.json`, `<slug>.bench.json` and `<slug>.parity.json`, per model;
    - an optional hand-written `run.json`: `{ "current": "<live model id>", "excluded": { "<id>": "<reason>" }, "memoryMiB": { "<id>": <peak> } }`.
  - `render_retrieval_report(run, questions, scores, benches, parities, run_json, choice, granite_needed) -> str`. It contains:
    - a header: the run, the date, each model's revision (from the lock) and reader versions (from the rankings);
    - the set: n verified, and n by source and by filing kind;
    - one table per model: method by source, with n, recall@5, recall@10 and MRR;
    - a CPU table: seconds per 1,000 chunks, projected minutes for 1,500 chunks, the query median in ms, the peak memory in MiB, and parity (min cosine, prompts);
    - the excluded models with their reasons;
    - "The rule", stated before "The decision";
    - an appendix of the first answering rank per question id, model and method.

    It shows no question text.
  - CLI: `maester-eval retrieval report --run <name|latest> [--to docs/eval/<date>-retrieval.md]`.

- [ ] **Step 1: Write the failing tests.** The three questions in the fixture all have filing `F`:
  - q001 is answered by `{12}`. Its hybrid chunks are `(G,12), (F,12), (F,12), …`: page 12 of another filing does not count, so the first answering rank is 2.
  - q002 is answered by `{40, 41}`. Seven non-answering chunks come first, then `(F,41)` at rank 8.
  - q003 is answered by `{5}` and is never found.
  - The sources: page 12 is `text_layer`, page 40 is `ocr` and page 41 is `text_layer`, so q002 is `mixed`; page 5 is `ocr`.

```python
def test_hand_worked_metrics(self):
    m = score_model(QUESTIONS, RANKINGS).by_method["hybrid"]["all"]
    self.assertEqual((m.n, m.recall_at_5, m.recall_at_10, m.mrr), (3, Fraction(1, 3), Fraction(2, 3), Fraction(5, 24)))  # (1/2 + 1/8 + 0) / 3

def test_strata_by_answering_page_source(self):
    s = score_model(QUESTIONS, RANKINGS).by_method["hybrid"]
    self.assertEqual({k: v.n for k, v in s.items()}, {"all": 3, "text_layer": 1, "ocr": 1, "mixed": 1})

def test_a_scope_document_with_no_revision_refuses_the_model(self):
    with self.assertRaisesRegex(IncompleteIndexError, "no current revision for F"): score_model(QUESTIONS, without_revision(RANKINGS, "F"))

def test_models_that_read_a_document_differently_are_not_compared(self):
    qwen = with_page_source(RANKINGS, "F", page=40, source="none")       # OCR_BUDGET in Qwen's re-read
    with self.assertRaisesRegex(RetrievalScoreError, "F: the models read it differently \\(pages\\)"):
        check_same_reads({ARCTIC: RANKINGS, QWEN: qwen})

def test_cpu_time_breaks_a_tie_within_one_question(self):
    # 40 questions, band 1/40: qwen 31/40, arctic 30/40 (tied), voyage 29/40 (out)
    c = choose_model([s(ARCTIC, 30), s(QWEN, 31), s(VOYAGE, 29)], {ARCTIC: b(1200), QWEN: b(1800), VOYAGE: b(700)}, ARCTIC)
    self.assertEqual((c.model, c.reason, c.band), (ARCTIC, "tie_broken_by_cpu_time", Fraction(1, 40)))

def test_a_clear_winner(self):
    c = choose_model([s(ARCTIC, 30), s(QWEN, 33), s(VOYAGE, 29)], {ARCTIC: b(1200), QWEN: b(1800), VOYAGE: b(700)}, ARCTIC)
    self.assertEqual((c.model, c.reason), (QWEN, "best_recall"))

def test_an_exact_tie_keeps_the_current_model(self):
    c = choose_model([s(QWEN, 30), s(ARCTIC, 30)], {ARCTIC: b(1500), QWEN: b(1500)}, ARCTIC)
    self.assertEqual((c.model, c.reason), (ARCTIC, "tie_kept_current"))

def test_granite_is_needed_only_past_an_hour_for_1500_chunks(self):
    self.assertTrue(needs_granite(choice(QWEN), {QWEN: b(2600)}))    # 3900 s
    self.assertFalse(needs_granite(choice(QWEN), {QWEN: b(2400)}))   # 3600 s

def test_the_report_has_no_question_text(self):
    md = render_retrieval_report(...)
    for q in QUESTIONS: self.assertNotIn(q.query, md)
    self.assertIn("| hybrid | all | 3 | 0.333 | 0.667 | 0.208 |", md)
```

`s(model, hits)` is a `ModelScore` whose hybrid `all` recall@10 is `Fraction(hits, 40)`. `b(x)` is a bench of 1000 chunks taking `x` seconds.
- [ ] **Step 2: Run to see them fail.** `uv run --locked python -m unittest tests.test_eval_retrieval_scoring -v`. Expected: FAIL.
- [ ] **Step 3: Implement.** The report refuses to be written while any non-excluded model's rankings fail `score_model` or `check_same_reads`, and names the filings.
- [ ] **Step 4: Run to see them pass.** `uv run --locked python -m unittest discover -s tests -v`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add apps/eval tests/test_eval_retrieval_scoring.py
git commit -m "feat(eval): retrieval recall@5, recall@10 and MRR by text source and method, the model rule, and the report"
```

---

### Task 10: Compose for one model at a time, and the documentation

**Files:**
- Modify: `docker-compose.yml`, `docs/DEVELOPMENT.md`, `docs/systems/indexer.md`, `docs/systems/worker.md`, `docs/systems/eval.md`, `apps/eval/README.md`, `apps/indexer/README.md`

**Interfaces:**
- Produces:
  - The live model comes from one variable:
    - `indexer` gains `EMBEDDING_MODEL: ${EMBEDDING_MODEL:-Snowflake/snowflake-arctic-embed-l-v2.0}` and `INDEX_TOKENIZER_PATH: /models/embed/${EMBEDDING_MODEL:-Snowflake/snowflake-arctic-embed-l-v2.0}`;
    - the `embedder` command uses `--model-id /models/embed/${EMBEDDING_MODEL:-…}`;
    - `indexer` gains `OCR_ENGINE: ${OCR_ENGINE:-rapidocr}` and `INDEX_TABLE_CELL_MATCHING: ${INDEX_TABLE_CELL_MATCHING:-true}`.
  - The `eval` profile:
    - `embedder-candidate`: the same TEI image, `--model-id /models/embed/${CANDIDATE_MODEL:-none}`, port `8793:80`, `mem_limit: 3072m`, `cpus: 8`.
    - `indexer-candidate`: image `maester/indexer:local`, with the indexer's environment but `EMBEDDING_MODEL` and `INDEX_TOKENIZER_PATH` from `${CANDIDATE_MODEL:-none}`, port `8794:8791`, `mem_limit: 2304m`.

    Both are commented: "Unset CANDIDATE_MODEL leaves them unable to start; the live stack does not depend on them."

- [ ] **Step 1: Write the compose changes.**
- [ ] **Step 2: Check.**
  - `docker compose config -q` gives no output.
  - `docker compose --profile eval config | grep -c "embed/none"` gives `2`.
  - `EMBEDDING_MODEL=Qwen/Qwen3-Embedding-0.6B docker compose config | grep -c "embed/Qwen/Qwen3-Embedding-0.6B"` gives `2` (the embedder and the tokenizer path).
- [ ] **Step 3: Write the docs.**
  - `docs/systems/indexer.md`, `worker.md` and `eval.md` in STE (`writing-ste` skill). They cover:
    - the two OCR engines and `OCR_ENGINE`;
    - `maester-indexer-ocr-sample`;
    - `INDEX_MODEL_NOT_SERVED`;
    - `index:candidate`, `index:prune` and `eval sources|rank|bench`;
    - "Do not upload documents while a candidate run uses the stack."
  - `apps/eval/README.md`: the `ocr` and `retrieval` commands, and the `data/eval/ocr/` and `data/eval/retrieval/` layout.
  - `docs/DEVELOPMENT.md`: "Measure the index", which points at Tasks 11–14 of this plan.
- [ ] **Step 4: Check the links.** `uv run python scripts/check_workspace.py`. Expected: exit 0.
- [ ] **Step 5: Commit.**

```bash
git add docker-compose.yml docs apps/eval/README.md apps/indexer/README.md
git commit -m "chore(compose): the live model from one EMBEDDING_MODEL; an eval profile that serves one candidate at a time; docs"
```

---

### Task 11: Live, the OCR spot check, from the main checkout, with the investor

This task runs only after the branch is merged, and only once the investor says go. It calls no paid model.

- [ ] **Step 1: Set up.**
  - `docker compose build indexer worker`.
  - `docker compose --profile setup run --rm models maester-indexer-fetch-models --out /models --candidates`.
  - `docker compose up -d`.
- [ ] **Step 2: Pick the pages.**
  - `uv run maester-eval ocr request --out data/eval/ocr/request.json`.
  - `pnpm --filter @maester/worker eval sources --workspace <id> --request data/eval/ocr/request.json --out data/eval/ocr/sources.json`.
  - From `sources.json`, choose 10 pages whose source is `ocr` and 5 statement pages whose source is `text_layer`, all from `dev` filings.
    - Prefer pages that hold a statement table, over at least 4 filings.
    - Look at the page images in the PDFs first, not at any OCR output.
  - If fewer than 10 `ocr` pages exist in `dev`, stop. Following §10.4, the investor adds scanned filings to the corpus first.
  - Write `data/eval/ocr/pages.json` and commit it before anything is read.

```bash
git add data/eval/ocr/pages.json
git commit -m "chore(eval): the OCR spot check's 15 pages, fixed before any output is read"
```

- [ ] **Step 3: Read.** Stop the other heavy services so the timing is the indexer's alone: `docker compose stop worker embedder`. Then `docker compose run --rm --no-deps -v "$PWD/data/eval:/eval" indexer maester-indexer-ocr-sample --pages /eval/ocr/pages.json --corpus /eval/corpus --out /eval/ocr/runs`. Expected: `run <stamp>: 15 pages, 50 page reads`. Then `docker compose start worker embedder`.
- [ ] **Step 4: Score by hand.**
  - The builder fills `scores.csv` from each page's PNG and `.md`, using these definitions:
    - A number is wrong when the configuration's text has it with any difference in digits, grouping (`1,23,456`), decimal point, brackets or minus sign, or when it prints a number that is not on the page.
    - A number is missing when it is absent.
    - A heading is wrong when any letter or digit differs (case and spacing ignored), and missing when its words are absent.
    - A table row is wrong when any cell's text lands in another column or row, two cells merge, or one splits.
  - The investor checks every row where two configurations of one page differ by more than 2 errors, then sets `checked = yes` on every row.
- [ ] **Step 5: Report.** `uv run maester-eval ocr report --run latest --to docs/eval/$(date +%F)-ocr-spot-check.md`. Expected: the decision lines for the engine and for cell matching.
- [ ] **Step 6: Apply the decision.**
  - If both stay (`rapidocr`, `true`), nothing changes.
  - If either changes:
    - set the new default in `apps/indexer/src/maester_indexer/settings.py` and in `docker-compose.yml`;
    - bump `INDEX_PIPELINE_VERSION` to `"2"` in `packages/document-index/src/models.ts`, and update the tests that pin `1:`;
    - tell the investor that this re-reads every document, which is days of Docling time (§19);
    - with their go-ahead, merge it. Nothing is rebuilt in this task: Task 13 Step 2's backfill of the retrieval corpus (chosen in Task 12) rebuilds those documents first, and the full backfill can follow later.
  - On `slower_than_twice`, the investor chooses, and the choice goes into the report under "The decision".
- [ ] **Step 7: Commit.**

```bash
git add docs/eval apps/indexer packages/document-index docker-compose.yml
git commit -m "docs(eval): OCR spot check: RapidOCR against Tesseract 5 and cell matching on 15 pages; <decision>"
```

---

### Task 12: Live, the retrieval set, drafted by the builder and corrected by the investor

- [ ] **Step 1: Choose the corpus.**
  - Choose 3 or 4 `dev` companies: at least one bank or NBFC (`stratum: financials`), and at least one with scanned pages per `data/eval/ocr/sources.json`.
  - Every `dev` filing of these companies must be stored in the workspace and indexed by the live model: `eval sources` shows no `documentId: null`.
  - If one is missing, the investor decides whether to upload it. An upload starts a paid Gemini classification.
  - Write `data/eval/retrieval/corpus.json`.
- [ ] **Step 2: Draft 48 questions** in `data/eval/retrieval/questions.csv` (`status = draft`), from 10 to 15 filings of the corpus, read from `data/eval/corpus/` on the main checkout.
  - Phrase each question as an investor would, naming the company and the year where a person would.
  - At least a third use words that are not on the answering page.
  - None carries a figure of its answer.
  - Mix these kinds: statement lines and notes (borrowings, contingent liabilities), policies, the auditor's report, the directors' report, segment commentary, and identity (CIN, registered office).
  - At least 8 questions should be answered on `ocr` pages, where the corpus has them.
  - Pages are PDF pages.
- [ ] **Step 3: The investor corrects.** They change the questions, the pages and the status. Only `verified` rows count.
- [ ] **Step 4: Check.** `uv run maester-eval retrieval check`. Expected: `48 questions, ≥ 40 verified, <n> corpus filings`.
- [ ] Nothing is committed in this task: `data/eval/retrieval/` is git-ignored.

---

### Task 13: Live, candidates indexed, benched and ranked, one at a time

Each model's window, in this order: arctic (the live model), then Qwen3, then voyage-4-nano, then granite only if `needs_granite` (Task 9). During a window, uploads wait and search answers 503.

- [ ] **Step 1: Make the request.** `uv run maester-eval retrieval request --label models`. Expected: `data/eval/retrieval/runs/<run>/`, called `$RUN` below. Write `$RUN/run.json` with `"current": "Snowflake/snowflake-arctic-embed-l-v2.0"`.
- [ ] **Step 2: Arctic.**
  - Make sure the live index covers the corpus: `pnpm --filter @maester/worker index:backfill --workspace <id> --document <ids>` reports `current <n>`.
  - `docker compose stop worker indexer`. The live `embedder` stays up.
  - `pnpm --filter @maester/worker eval bench --workspace <id> --request $RUN/request.json --model Snowflake/snowflake-arctic-embed-l-v2.0 --embedder-url http://localhost:8792 --out $RUN/Snowflake--snowflake-arctic-embed-l-v2.0.bench.json`. While it runs, `docker stats --no-stream $(docker compose ps -q embedder)` every 10 s. The peak goes into `run.json` `memoryMiB`.
  - Then `eval rank … --out $RUN/<slug>.rankings.json`. Expected: `ranked 48 questions`.
  - Then `cd apps/indexer && uv run --group parity python scripts/embedding_parity.py --model Snowflake/snowflake-arctic-embed-l-v2.0 --tei http://localhost:8792 --out ../../$RUN/<slug>.parity.json`. Expected: `passed, min cosine ≥ 0.999`.
- [ ] **Step 3: Each candidate**, with `M` = its id and `S` = its slug:
  - `docker compose stop worker indexer embedder`.
  - `CANDIDATE_MODEL=$M docker compose --profile eval up -d embedder-candidate indexer-candidate`. If TEI refuses the model (its log says so), stop: write the reason into `run.json` `excluded` and go to the next model.
  - The parity check against `http://localhost:8793`. A failure means: exclude the model, with `minCosine` as the reason.
    - It downloads the pinned revision into the host's Hugging Face cache; that is the one download in this task.
    - For voyage-4-nano, it runs the repository code read in Task 4 Step 1, at the same sha.
  - The bench against `http://localhost:8793`, with `docker stats` on `$(docker compose --profile eval ps -q embedder-candidate)`.
  - Project the hours this model will take: `seconds_per_1000 ×` the corpus chunk count from `eval sources`. If that is over 24 hours, pause and ask the investor before indexing.
  - `docker compose --profile eval run --rm --no-deps -v "$PWD/data/eval:/eval:ro" worker node dist/index-candidate.js --workspace <id> --model $M --request /eval/retrieval/runs/<run>/request.json`. Expected: `indexed <n>, failed 0`. A failure prints its codes. Rerun the same command: it resumes.
  - `eval rank --model $M --embedder-url http://localhost:8793 --out $RUN/$S.rankings.json`.
  - `docker compose --profile eval stop embedder-candidate indexer-candidate`.
- [ ] **Step 4: Restore the live stack.** `docker compose up -d worker indexer embedder`. Live search answers again.
- [ ] **Step 5: Report.** `uv run maester-eval retrieval report --run <run> --to docs/eval/$(date +%F)-retrieval.md`.
  - Expected: the tables, and `EMBEDDING_MODEL: <model> (<reason>)`.
  - If the report says granite is needed, run Step 3 for granite and report again.
- [ ] **Step 6: Commit.**

```bash
git add docs/eval
git commit -m "docs(eval): retrieval over <n> questions: recall and MRR by source and method for <models>; EMBEDDING_MODEL <decision>"
```

---

### Task 14: The switch, and pruning the candidates

- [ ] **Step 1: If the model stays arctic**, skip to Step 4.
- [ ] **Step 2: Switch the code defaults**, in one commit, to the chosen id `M`:
  - `apps/indexer/models.lock.json`: the `embedding` entry becomes `M`, and arctic moves into `candidates`;
  - `apps/indexer/src/maester_indexer/settings.py` `DEFAULT_EMBEDDING_MODEL`;
  - `apps/worker/src/env.ts` and `apps/api/src/env.ts` `EMBEDDING_MODEL` defaults;
  - `docker-compose.yml`'s three `${EMBEDDING_MODEL:-…}` defaults;
  - `FakeEmbedder`'s default stays arctic (tests only).

  If `seconds_per_1000(M) * 1.5` is over `INDEX_TIMEOUT_SECONDS` less 1,800 s, raise `INDEX_TIMEOUT_SECONDS` to that projection plus 50%, rounded up to a whole hour. Run `pnpm -r test`, `cd apps/indexer && uv run python -m unittest discover -s tests` and `docker compose config -q`. Expected: PASS.

```bash
git add apps packages docker-compose.yml
git commit -m "feat(index): EMBEDDING_MODEL is <M>, chosen by docs/eval/<date>-retrieval.md"
```

- [ ] **Step 3: Rebuild, with the investor's go-ahead, after merge.**
  - `docker compose --profile setup run --rm models`, then `docker compose up -d --build`.
  - Then `pnpm --filter @maester/worker index:backfill --workspace <id>`. The corpus documents already hold `M`'s revisions from Task 13 and count as current. Every other document is chunked again from `page_read` and embedded: days of CPU (§19).
  - Search finds only the documents rebuilt so far until the backfill ends (no screen reads search yet).
  - Done when phase 2's Task 13 query (no stored document without a current revision) returns 0.
- [ ] **Step 4: Prune.**
  - For each measured model that is not `EMBEDDING_MODEL`, after a dry run: `pnpm --filter @maester/worker index:prune --model <id> --dry-run`, then `pnpm --filter @maester/worker index:prune --model <id>`.
  - Then `docker compose exec postgres psql -U maester -c 'VACUUM (ANALYZE) chunk_embedding'`.
  - Done when `select embedding_model, count(*) from document_index_revision group by 1` lists only `EMBEDDING_MODEL`.

---

## Open questions for the investor

1. **Search scope.** Measuring each question within its company's filings matches how an agent would search, and it keeps the comparison on the exact scan. Workspace-wide search over the HNSW graph is not measured. Is that the right question to answer?
2. **Cell matching on digital pages.** The brief says the cell-matching decision comes "from the same pages"; this plan adds 5 digital statement pages, because the failure the research names is a digital-table one. Keep them, or decide on the 10 scanned pages alone?
3. **Development only.** §10.3 measures on development filings, so there is no held-out retrieval check of the chosen model. Nothing is tuned on the set, so the risk is small; a held-out half could be added later.
4. **Several answering pages.** Recall@k counts a question as found when any one of its answering pages is in the top k. A question that needs two pages read together (a table continued on the next page) scores as found once one of them is. Is "any" the right reading?
5. **The bands.** One question (`1/n`) for models; 1% of numbers printed, then 5% of headings, for the engine; 2% of table rows for cell matching. The status quo wins inside them, because each switch costs days of CPU. Are these acceptable before the runs start?

## After this plan

- **Phase 4 (XBRL)** inherits:
  - the chosen `EMBEDDING_MODEL` and reader settings;
  - `INDEX_MODEL_NOT_SERVED`;
  - the rule that a bumped `INDEX_PIPELINE_VERSION` rebuilds;
  - `index:prune`.

  Its XBRL text-block chunks (`text_source = 'xbrl'`, an `element` instead of a page) are embedded by the chosen model.
- **Retrieval over XBRL chunks.** To measure it, `PageRef` gains an `element` alternative, and the retrieval set gains questions answered by an element. Both are additions to Tasks 7–9's contracts, not changes to them.
- **Phase 6 (the screen)** reads `document_index_revision.ocr_engine` to say which engine read a page.
- **The retrieval set and the bench stay in `data/eval/retrieval/`.** A later embedding or chunker change is measured with `maester-eval retrieval request`, `index:candidate`, `eval rank` and `retrieval report`, against the committed report as the baseline.
