# Maester indexer

Status: in progress (ingestion phase 2). A Python service that reads a filing's pages with [Docling](https://github.com/docling-project/docling) and RapidOCR, and cuts them into chunks for search. Design: [ingestion pipeline spec](../../docs/superpowers/specs/2026-10-19-ingestion-pipeline-design.md) §8.

The indexer is its own uv project, not a member of the root workspace: Docling needs torch, which would slow every other Python job. It has its own `pyproject.toml` and `uv.lock`, runs on Python 3.12, and takes torch from the PyTorch CPU index on Linux.

## Pinned versions

Docling, docling-core, RapidOCR and onnxruntime are pinned to exact versions in `pyproject.toml`; `uv.lock` pins the rest. The lock covers macOS arm64 and Linux aarch64 and x86_64. `src/maester_indexer/versions.py` reads the recorded versions from the installed packages, so they cannot drift from the lock.

| Package | Version | Why this one |
| --- | --- | --- |
| `docling` | 2.134.0 | The newest 2.x release at least two weeks before 20 Oct 2026 (released 6 Oct 2026) |
| `docling-core` | 2.103.0 | What `uv lock` resolves for Docling 2.134.0 |
| `rapidocr` | 3.9.2 | The newest release before Docling 2.134.0. 3.10.0 (8 Oct 2026) no longer exposes `PP_OCRV6_LANGS`, which Docling 2.134.0 imports, so OCR fails to start with it |
| `onnxruntime` | 1.31.0 | What `uv lock` resolves |
| `torch`, `torchvision` | 2.14.1, 0.29.1 (`+cpu` on Linux) | What `uv lock` resolves; CPU builds on Linux |

The models are recorded in `models.lock.json`: the embedding model at a commit, and the commit of each Docling artifact (Docling itself asks for the layout models at `main` and the TableFormer models at the `v2.3.0` tag). RapidOCR's models come from ModelScope at the `v3.9.2` tag, which follows the `rapidocr` version.

## Running

```bash
cd apps/indexer
INDEXER_SECRET=local-indexer-secret \
DOCLING_ARTIFACTS_PATH=$HOME/.cache/maester/docling \
INDEX_TOKENIZER_PATH=$HOME/.cache/maester/embed/Snowflake/snowflake-arctic-embed-l-v2.0 \
HF_HUB_OFFLINE=1 uv run maester-indexer          # PORT defaults to 8791
```

`uv run maester-indexer-fetch-models --out <dir> [--docling-only]` fetches the weights offline use needs: Docling's under `<dir>/docling`, the embedding model under `<dir>/embed/<model id>`, and a copy of `models.lock.json`. Settings (`INDEX_THREADS`, `INDEX_PAGE_BATCH`, `INDEX_MAX_BYTES` and the rest) are in `src/maester_indexer/settings.py` and the [system description](../../docs/systems/indexer.md).

In Docker Compose the stack builds `maester/indexer:local` from `Dockerfile`, with the repository root as the build context. The same image runs two services: `models` (profile `setup`, `maester-indexer-fetch-models --out /models`, `HF_HUB_OFFLINE=0`, the only one that downloads) and `indexer` (read-only `/models`, `HF_HUB_OFFLINE=1`, limit 2304 MiB, 8 CPUs). Run `docker compose --profile setup run --rm models` once before the first `up`. The embedder (text-embeddings-inference) reads the same volume. See [DEVELOPMENT.md](../../docs/DEVELOPMENT.md) for the memory budget.

CI: `.github/workflows/indexer.yml` runs the suite with Docling's models on changes under `apps/indexer` and `packages/contracts/fixtures/index`; it needs no secret.

## Tests

```bash
cd apps/indexer
uv run python -m unittest discover -s tests -t .                       # the probe is skipped
uv run docling-tools models download layout tableformer rapidocr -o "$HOME/.cache/maester/docling"
HF_HUB_OFFLINE=1 MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest discover -s tests -t .
```

The fixture PDFs in `tests/fixtures` are synthetic, made by `tests/fixtures/make_fixtures.py` (`uv run python tests/fixtures/make_fixtures.py`), and the same bytes come out each run.

The chunker's tests run with no models on `tests/fixtures/<name>.read.json`, the reader's output on each fixture PDF (all pages, OCR on), written by `tests/fixtures/save_reads.py` (`HF_HUB_OFFLINE=1 DOCLING_ARTIFACTS_PATH=$HOME/.cache/maester/docling uv run python tests/fixtures/save_reads.py`). Regenerate them only when the Docling pin or the reader changes. Floats are rounded to three places there, because the layout model's boxes vary in about the fifth decimal place between runs.

## Docling interfaces this service relies on

`tests/test_probe.py` checks each of these against the pinned version. When the pin changes, run it first.

- `PdfPipelineOptions(do_ocr, ocr_options=RapidOcrOptions(backend="onnxruntime"), do_table_structure, table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE), artifacts_path, document_timeout=None, accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU), generate_parsed_pages=True)`. Without `generate_parsed_pages=True` the pages' text cells are dropped after assembly.
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

- Each page is chunked on its own, after a paragraph that runs over a page break is cut to the page's `charspan` slices, so a chunk never crosses a page and a page chunked again alone gets the same chunks and `seq` numbers. A table on two pages stays on its first, as in the page text.
- Prose is cut by element and small peers under one heading merge, within the tokenizer's budget (`CHUNK_TOKENS`, 448). A table is always its own chunk: one row a line, cells separated by a space as the page text prints them. A table too large for the budget, with its path, splits by rows, each part starting with the header rows; a row too wide to sit under the header is cut on its own.
- **Section path and basis.** A heading that names a basis ("consolidated" or "standalone", whole word, any case) becomes the root of the section path and stays the root; later headings that name none nest under it (`[root, latest heading]`) until another heading names a basis and replaces it. A chunk's basis comes from that root. A chunk with no heading above it on its page takes the path carried from the page before, and `sectionPathAfter` (the whole path at the end of the page, so a heading with nothing under it on its page still carries) carries the root across pages and ranges. Docling's PDF pipeline gives every section header level 1 (all of the fixtures' do), which is why the root is kept by what a heading says rather than by its level. The known cost: text after the last statements, such as a notice of the annual general meeting, keeps the last basis named.
- **Size.** The path a chunk is embedded with is cut from the left to `PATH_TOKENS` (64), and further, down to no path, until `contextualize(path, text)` with its newline fits `MAX_EMBED_TOKENS` (512), so the embedded text never goes over by construction. The basis still comes from the whole path. Only a text over 512 on its own raises `INDEX_FAILED` (a bug in the budget, not a fault in the document).
- **Text source.** A chunk's `textSource` is the union of its items' sources; an item with no recorded source is left out. When none of a chunk's items has one, it is `text_layer` if the range was read with OCR off and `mixed` (possibly OCR) if OCR was on.
- `load_tokenizer(path, expected_model)` loads `INDEX_TOKENIZER_PATH` with `local_files_only`. The folder's model is the `embedding.id` of the nearest `models.lock.json` in the folder or above it, and the folder must end with that id. The fetch command (Task 5) must therefore put the model in `/models/embed/<model id>` and the lock at `/models/models.lock.json`. A missing lock or another model is `INDEXER_MODEL_MISMATCH`; a folder with no tokenizer is `INDEXER_NOT_CONFIGURED`.
