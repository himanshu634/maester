# Maester indexer

Status: in progress (ingestion phase 2). A Python service that reads a filing's pages with [Docling](https://github.com/docling-project/docling) and RapidOCR (or Tesseract, by `OCR_ENGINE`), and cuts them into chunks for search. Design: [ingestion pipeline spec](../../docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md) §8.

The indexer is its own uv project, not a member of the root workspace: Docling needs torch, which would slow every other Python job. It has its own `pyproject.toml` and `uv.lock`, runs on Python 3.12, and takes torch from the PyTorch CPU index on Linux.

## Pinned versions

Docling, docling-core, RapidOCR and onnxruntime are pinned to exact versions in `pyproject.toml`; `uv.lock` pins the rest. The lock covers macOS arm64 and Linux aarch64 and x86_64. `src/maester_indexer/versions.py` reads the recorded versions from the installed packages, so they cannot drift from the lock. `doclingVersion`, which keys the worker's cached page reads, names docling, docling-core, docling-ibm-models and docling-parse and ends with a 12-character hash of the `docling` section of `models.lock.json`, so a change to any one of them reads the pages again.

| Package | Version | Why this one |
| --- | --- | --- |
| `docling` | 2.134.0 | The newest 2.x release at least two weeks before 20 Oct 2026 (released 6 Oct 2026) |
| `docling-core` | 2.103.0 | What `uv lock` resolves for Docling 2.134.0 |
| `rapidocr` | 3.9.2 | The newest release before Docling 2.134.0. 3.10.0 (8 Oct 2026) no longer exposes `PP_OCRV6_LANGS`, which Docling 2.134.0 imports, so OCR fails to start with it |
| `onnxruntime` | 1.31.0 | What `uv lock` resolves |
| `torch`, `torchvision` | 2.14.1, 0.29.1 (`+cpu` on Linux) | What `uv lock` resolves; CPU builds on Linux |

**OCR engines.** `OCR_ENGINE` is `rapidocr` (the default) or `tesseract`. Each has its own engine string in a page read's key (`versions.ocr_engine_version`), so switching engine reads every page again, and the stored reads of the other engine stay valid:

| Engine | Engine string | Comes from |
| --- | --- | --- |
| `rapidocr` | `rapidocr-onnxruntime 3.9.2` | The `rapidocr` package. The string is the same as before Tesseract was added, so the stored page reads still match |
| `tesseract` | `tesseract-cli 5.5.0 eng:7d4322bd2a77` (the image's) | The first `x.y.z` of `tesseract --version`, and the first 12 hex characters of the sha256 of `eng.traineddata`, in the folder the header of `tesseract --list-langs` names. A different binary or different language data gives a different string. The command is run once, when the reader is built, and a missing command stops the service with "tesseract is not installed" |

The image installs Tesseract from the Debian packages of its base, `python:3.12-slim` (versions below, under "Docling interfaces this service relies on"). A Mac needs `brew install tesseract`; a Linux CI runner needs `apt-get install tesseract-ocr tesseract-ocr-eng`. Without the binary the Tesseract tests are skipped.

The models are recorded in `models.lock.json`: the embedding model at a commit, and the commit of each Docling artifact (Docling itself asks for the layout models at `main` and the TableFormer models at the `v2.3.0` tag). RapidOCR's models come from ModelScope at the `v3.9.2` tag, which follows the `rapidocr` version.

## Running

```bash
cd apps/indexer
INDEXER_SECRET=local-indexer-secret \
DOCLING_ARTIFACTS_PATH=$HOME/.cache/maester/docling \
INDEX_TOKENIZER_PATH=$HOME/.cache/maester/embed/Snowflake/snowflake-arctic-embed-l-v2.0 \
HF_HUB_OFFLINE=1 uv run maester-indexer          # PORT defaults to 8791
```

`uv run maester-indexer-fetch-models --out <dir> [--docling-only]` fetches the weights offline use needs: Docling's under `<dir>/docling`, the embedding model under `<dir>/embed/<model id>`, and a copy of `models.lock.json`. From the embedding model's repository it takes only what text-embeddings-inference and the tokenizer load: `allow_patterns` `*.json` (config.json, the sentence-transformers files, the tokenizer's JSON files, and `1_Pooling/config.json`, since the match crosses `/`), `*.safetensors`, `sentencepiece.bpe.model`, `vocab.txt` and `merges.txt`, with `ignore_patterns` `onnx/*` and `openvino/*`. For the arctic model that is about 2.3 GB instead of about 10.6 GB with its ONNX variants (`tests/test_fetch_models.py` checks the set against the repository's file list). Settings (`INDEX_THREADS`, `INDEX_PAGE_BATCH`, `INDEX_MAX_BYTES` and the rest) are in `src/maester_indexer/settings.py` and the [system description](../../docs/systems/indexer.md).

In Docker Compose the stack builds `maester/indexer:local` from `Dockerfile`, with the repository root as the build context. The same image runs two services: `models` (profile `setup`, `maester-indexer-fetch-models --out /models`, `HF_HUB_OFFLINE=0`, the only one that downloads) and `indexer` (read-only `/models`, `HF_HUB_OFFLINE=1`, limit 2304 MiB, 8 CPUs). Run `docker compose --profile setup run --rm models` once before the first `up`. The embedder (text-embeddings-inference) reads the same volume. The image is 2.71 GB (built 20 Oct 2026). See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the memory budget.

CI: `.github/workflows/indexer.yml` runs the suite with Docling's models on changes under `apps/indexer` and `packages/contracts/fixtures/index`; it needs no secret.

## Tests

```bash
cd apps/indexer
uv run python -m unittest discover -s tests -t .                       # the probe is skipped
uv run docling-tools models download layout tableformer rapidocr -o "$HOME/.cache/maester/docling"
HF_HUB_OFFLINE=1 MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest discover -s tests -t .
```

The tests that read with Tesseract (`ReadRangeWithTesseract` in `test_reader.py` and `test_tesseract_cells_are_marked_ocr` in `test_probe.py`) also need the `tesseract` binary on `PATH`; they are skipped without it. CI installs it before the suite.

The fixture PDFs in `tests/fixtures` are synthetic, made by `tests/fixtures/make_fixtures.py` (`uv run python tests/fixtures/make_fixtures.py`), and the same bytes come out each run.

The chunker's tests run with no models on `tests/fixtures/<name>.read.json`, the reader's output on each fixture PDF (all pages, OCR on), written by `tests/fixtures/save_reads.py` (`HF_HUB_OFFLINE=1 DOCLING_ARTIFACTS_PATH=$HOME/.cache/maester/docling uv run python tests/fixtures/save_reads.py`). Regenerate them only when the Docling pin or the reader changes. Floats are rounded to three places there, because the layout model's boxes vary in about the fifth decimal place between runs.

## Docling interfaces this service relies on

`tests/test_probe.py` checks each of these against the pinned version. When the pin changes, run it first.

- `PdfPipelineOptions(do_ocr, ocr_options=RapidOcrOptions(backend="onnxruntime"), do_table_structure, table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE), artifacts_path, document_timeout=None, accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU), generate_parsed_pages=True)`. Without `generate_parsed_pages=True` the pages' text cells are dropped after assembly.
- For `OCR_ENGINE=tesseract`: `PdfPipelineOptions(ocr_options=TesseractCliOcrOptions(lang=["eng"], tesseract_cmd="tesseract"))`. This is the command-line class, not `TesseractOcrOptions` (`tesserocr`), which is a compiled binding with no confirmed linux-aarch64 wheel. Its `lang` default is `["eng", "spa", "fra", "deu"]`, and Docling raises when a language has no installed traineddata file, so `lang=["eng"]` is required in an image that holds only English. Its cells carry `from_ocr=True` (`tesseract_ocr_cli_model.py`), so a chunk's `text_source` is the same for both engines (`test_tesseract_cells_are_marked_ocr`).
- The Debian packages in `python:3.12-slim` (Debian 13, trixie; checked 21 Oct 2026): `tesseract-ocr` 5.5.0-1+b1 and `tesseract-ocr-eng` 1:4.1.0-2. `tesseract-ocr` depends on `tesseract-ocr-osd` (1:4.1.0-2), so it is installed with `--no-install-recommends`; Docling's orientation check reads it. The image's engine string is `tesseract-cli 5.5.0 eng:7d4322bd2a77`.
- Docling reads Tesseract's `--version` from stdout, or from stderr when stdout is empty (its comment says Linux builds print to stderr), and `--list-langs` from stdout only. The Debian 5.5.0 build in `python:3.12-slim` prints both to stdout and nothing to stderr; the Homebrew 5.5.3 build prints both to stdout. `versions._run` returns stdout, or stderr when stdout is empty, for both commands.
- `DocumentConverter.convert(path, page_range=(first, last))` reads only those pages; `prov.page_no` stays the page number in the whole file.
- `ConversionResult.pages[i].cells` (`parsed_page.textline_cells`) are `TextCell`s with `from_ocr`, true for a cell RapidOCR read. `Page.page_no` counts from 1, as `prov.page_no` does. A scanned page has OCR cells, a text-layer page none, and a page with a text-layer paragraph and an image of a paragraph has both.
- A running header is a `page_header` item in `ContentLayer.FURNITURE`, found with `iterate_items(included_content_layers={ContentLayer.FURNITURE})`.
- docling-parse, Docling's text-layer reader, reads an en dash as `-` already at the character level, with or without its `do_sanitization` switch (which Docling does not expose): "2025–26" as printed reads "2025-26". pypdfium2 reads the same file as printed. The middle dot is kept.
- A paragraph that runs over a page break is one item with one `prov` per page, and each `prov.charspan` is that page's part of `item.text`.
- `DoclingDocument.filter(page_nrs={n})` keeps every item with a `prov` on page `n`, with all of its `prov`s: such a paragraph comes with its part on the other page too. To keep a chunk within one page, cut a multi-page item by `charspan`.
- `HybridChunker(tokenizer=HuggingFaceTokenizer(tokenizer=…, max_tokens=…), merge_peers=True, repeat_table_header=True)` from `docling_core.transforms.chunker.hybrid_chunker`. In transformers 5, `PreTrainedTokenizerFast` is `TokenizersBackend`; it still wraps a `tokenizers.Tokenizer` through `tokenizer_object`.
- `DoclingDocument.filter()` numbers the kept items afresh (`#/texts/4` becomes `#/texts/0`), and shifts page numbers when the document's first page is not 1. `chunker.filter_document` walks the items as `filter()` does (`_iterate_items_with_stack(with_groups=True, traverse_pictures=True, included_content_layers=set(ContentLayer), page_nrs=…)`, private) to map each new ref back to the read's own, and checks each pair is the same item.
- The chunker runs HybridChunker's steps itself, so that a table is never merged with its peers: `_inner_chunker.chunk`, `_split_by_doc_items`, `_split_using_plain_text` and `_merge_chunks_with_matching_metadata` (private). `tests/test_chunker.py` fails if any of them changes behaviour.

## Chunks

`chunker.chunk_range(read, section_path_before, tokenizer)` turns one range read into its `page` and `chunk` events.

- Each page is chunked on its own, after a paragraph that runs over a page break is cut to the page's `charspan` slices, so a chunk never crosses a page and a page chunked again alone gets the same chunks and `seq` numbers. A table on two pages stays on its first, as in the page text, whichever range it is read in.
- Prose is cut by element and small peers under one heading merge, within the tokenizer's budget (`CHUNK_TOKENS`, 448). A table is always its own chunk: one row a line, cells separated by a space as the page text prints them. A table too large for the budget, with its path, splits by rows, each part starting with the header rows. Header rows that take more than half the budget are not repeated but read as rows; a caption that does not fit with the header goes out ahead of the table, cut to the budget; a row too wide to sit under the header is cut into pieces, each under the header.
- **Section path and basis.** A heading that names a basis ("consolidated" or "standalone", whole word, any case) becomes the root of the section path and stays the root; later headings that name none nest under it (`[root, latest heading]`) until another heading names a basis and replaces it. A chunk's basis comes from that root. A chunk with no heading above it on its page takes the path carried from the page before, and `sectionPathAfter` (the whole path at the end of the page, so a heading with nothing under it on its page still carries) carries the root across pages and ranges. Docling's PDF pipeline gives every section header level 1 (all of the fixtures' do), which is why the root is kept by what a heading says rather than by its level. The known cost: text after the last statements, such as a notice of the annual general meeting, keeps the last basis named.
- **Size.** The path a chunk is embedded with is cut from the left to `PATH_TOKENS` (64), and further, down to no path, until `contextualize(path, text)` with its newline, plus the start and end tokens the model adds (`num_special_tokens_to_add`, which `count_tokens` leaves out), fits `MAX_EMBED_TOKENS` (512), so the embedded text never goes over by construction. `tokenCount` is `count_tokens` of that text, without the special tokens. The basis still comes from the whole path. Only a text over the budget on its own raises `INDEX_FAILED` (a bug in the budget, not a fault in the document).
- **A page with only pictures.** A page reads `NO_TEXT` only when Docling found nothing on it: no layout region and no image. A page whose only content is a picture (a cover photo, a chart with no text in it) gives no text, so it reads `OCR_FAILED` with OCR on and `OCR_BUDGET` with OCR off, and the worker marks the revision partial. Many annual reports have such pages, so many index as partial. This is on purpose: a picture cluster cannot be told apart from a scanned page that OCR failed to read, so calling it `NO_TEXT` could hide a real OCR failure.
- **Text source.** A chunk's `textSource` is the union of its items' sources. With OCR off, an item with no recorded source can only be text layer. With OCR on, a chunk holding an item with text and no recorded source is `mixed` (possibly OCR), or `ocr` when every recorded source is OCR.
- `load_tokenizer(path, expected_model)` loads `INDEX_TOKENIZER_PATH` with `local_files_only`. The folder's model is the `embedding.id` of the nearest `models.lock.json` in the folder or above it, and the folder must end with that id. The fetch command (Task 5) must therefore put the model in `/models/embed/<model id>` and the lock at `/models/models.lock.json`. A lock for another model is `INDEXER_MODEL_MISMATCH`. A missing lock means the models were not fetched (the fetch writes the lock last), so it is `INDEXER_NOT_CONFIGURED`, as is a folder with no tokenizer.
