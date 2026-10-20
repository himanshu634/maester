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

## Tests

```bash
cd apps/indexer
uv run python -m unittest discover -s tests -t .                       # the probe is skipped
uv run docling-tools models download layout tableformer rapidocr -o "$HOME/.cache/maester/docling"
HF_HUB_OFFLINE=1 MAESTER_DOCLING_MODELS=$HOME/.cache/maester/docling uv run python -m unittest discover -s tests -t .
```

The fixture PDFs in `tests/fixtures` are synthetic, made by `tests/fixtures/make_fixtures.py` (`uv run python tests/fixtures/make_fixtures.py`), and the same bytes come out each run.

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
