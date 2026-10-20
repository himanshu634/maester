"""Cutting one cached range read into page events and chunk events (spec section 8.3).

Each page is chunked on its own, so a chunk never crosses a page and a page chunked again
alone gets the same chunks. Within a page, Docling's HybridChunker cuts by element and
merges small peers under one heading; a table is always its own chunk and, when it is too
large, splits by rows with its header repeated. Furniture (running headers and footers)
never enters a chunk. The section path runs from page to page: a chunk's path is the
headings above it on its page, or else the path carried from the pages before.
"""

import json
import re
import warnings
from collections.abc import Callable
from pathlib import Path

import semchunk
from docling_core.transforms.chunker import DocChunk
from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer
from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from docling_core.types.doc import (
    ContentLayer,
    DoclingDocument,
    RefItem,
    SectionHeaderItem,
    TableItem,
    TextItem,
    TitleItem,
)
from transformers import AutoTokenizer

from maester_indexer.contracts import ChunkEvent, PageEvent, RangeRead, TextSource, contextualize
from maester_indexer.errors import IndexingError

MAX_EMBED_TOKENS = 512  # the most the embedding model is given: the path and the text
PATH_TOKENS = 64  # the most a carried section path may take
CHUNK_TOKENS = 448  # the chunker's budget, so a carried path still fits under MAX_EMBED_TOKENS

LOCK_FILE = "models.lock.json"
_ALL_LAYERS = set(ContentLayer)
_BASIS = re.compile(r"\b(consolidated|standalone)\b", re.IGNORECASE)


def chunk_range(
    read: RangeRead, section_path_before: list[str], tokenizer: BaseTokenizer
) -> tuple[list[PageEvent], list[ChunkEvent]]:
    """The range's page events and chunk events, page by page in order.

    `section_path_before` is the path in effect at the end of the page before the range
    (the previous range's last `sectionPathAfter`). `tokenizer` carries the chunker's
    budget (`get_max_tokens()`, CHUNK_TOKENS in production)."""
    document = DoclingDocument.model_validate(read.document)
    range_pages = {page.page_number for page in read.pages}
    chunker = HybridChunker(tokenizer=tokenizer, merge_peers=True, repeat_table_header=True)
    carried = cut_path(section_path_before, tokenizer)
    page_events: list[PageEvent] = []
    chunk_events: list[ChunkEvent] = []
    for page in read.pages:
        page_chunks, path_after = _chunk_page(read, document, page.page_number, range_pages, chunker, carried)
        chunk_events.extend(page_chunks)
        page_events.append(
            PageEvent(
                page_number=page.page_number,
                text=page.text,
                items_text_layer=page.items_text_layer,
                items_ocr=page.items_ocr,
                none_reason=page.none_reason,
                section_path_after=path_after,
            )
        )
        carried = cut_path(path_after, tokenizer)
    return page_events, chunk_events


def basis_of(section_path: list[str]) -> str | None:
    """From the innermost heading out, the first that names a basis decides."""
    for heading in reversed(section_path):
        if match := _BASIS.search(heading):
            return match.group(1).lower()
    return None


def cut_path(section_path: list[str], tokenizer: BaseTokenizer) -> list[str]:
    """The path with its outermost headings dropped until it fits PATH_TOKENS."""
    path = list(section_path)
    while path and tokenizer.count_tokens("\n".join(path)) > PATH_TOKENS:
        path = path[1:]
    return path


def filter_document(document: DoclingDocument, page_nrs: set[int]) -> tuple[DoclingDocument, dict[str, str]]:
    """`document.filter(page_nrs=…)`, and for each item ref of the result the ref the item
    has in `document`: filtering renumbers the refs (#/texts/4 becomes #/texts/0).

    The map walks the items in the order `filter()` does and numbers them as it does; each
    pair is checked to be the same item, so a change in Docling fails loudly here."""
    with warnings.catch_warnings():
        # filter() warns when an item's parent is left out and it hangs the item on an ancestor.
        warnings.filterwarnings("ignore", message=r"(Parent .* not found|No ancestor found)", category=UserWarning)
        filtered = document.filter(page_nrs=page_nrs)
    counts: dict[str, int] = {}
    originals: dict[str, str] = {}
    for item, _ in document._iterate_items_with_stack(
        with_groups=True, traverse_pictures=True, included_content_layers=_ALL_LAYERS, page_nrs=page_nrs
    ):
        key = item.self_ref.split("/")[1]
        if key == "body":
            continue
        new_ref = f"#/{key}/{counts.get(key, 0)}"
        counts[key] = counts.get(key, 0) + 1
        new_item = RefItem(cref=new_ref).resolve(filtered)
        if new_item.label != item.label or _boxes(new_item) != _boxes(item):
            raise IndexingError("INDEX_FAILED", "Filtering the document by page changed its items.", False)
        originals[new_ref] = item.self_ref
    if sum(len(getattr(filtered, key)) for key in counts) != len(originals):
        raise IndexingError("INDEX_FAILED", "Filtering the document by page changed its items.", False)
    return filtered, originals


def load_tokenizer(path: str, expected_model: str) -> HuggingFaceTokenizer:
    """The embedding model's tokenizer from INDEX_TOKENIZER_PATH, with CHUNK_TOKENS as its budget.

    The folder's model is the `embedding.id` of the nearest models.lock.json in the folder
    or above it (the fetch command puts it at the top of the models volume), and the folder
    must be named after it (`…/embed/<model id>`). Anything else is refused."""
    folder = Path(path)
    model_id = _locked_model(folder)
    if model_id != expected_model:
        found = model_id or "an unknown model"
        raise IndexingError(
            "INDEXER_MODEL_MISMATCH", f"The indexer's tokenizer is for {found}, not {expected_model}.", False
        )
    try:
        tokenizer = AutoTokenizer.from_pretrained(str(folder), local_files_only=True)
    except (OSError, ValueError):
        raise IndexingError("INDEXER_NOT_CONFIGURED", "No tokenizer could be loaded from INDEX_TOKENIZER_PATH.", False) from None
    return HuggingFaceTokenizer(tokenizer=tokenizer, max_tokens=CHUNK_TOKENS)


def _locked_model(folder: Path) -> str | None:
    for directory in (folder, *folder.parents):
        lock = directory / LOCK_FILE
        if lock.is_file():
            model_id = json.loads(lock.read_text(encoding="utf-8")).get("embedding", {}).get("id")
            if isinstance(model_id, str) and folder.parts[-len(model_id.split("/")) :] == tuple(model_id.split("/")):
                return model_id
            return None
    return None


def _chunk_page(
    read: RangeRead,
    document: DoclingDocument,
    page_no: int,
    range_pages: set[int],
    chunker: HybridChunker,
    carried: list[str],
) -> tuple[list[ChunkEvent], list[str]]:
    """One page's chunk events and the section path in effect at its end."""
    if page_no not in document.pages:  # Docling kept nothing of the page
        return [], carried
    page_doc, originals = filter_document(_cut_to_page(document, page_no, range_pages), {page_no})
    tokenizer = chunker.tokenizer
    events: list[ChunkEvent] = []
    for doc_chunk, kind in _doc_chunks(chunker, page_doc):
        path = list(doc_chunk.meta.headings or carried)
        source = _text_source(read, originals, doc_chunk, page_no)
        texts = [doc_chunk.text] if kind == "prose" else _table_texts(page_doc, doc_chunk, path, tokenizer)
        for text in texts:
            text = text.strip()
            if not text:
                continue
            token_count = tokenizer.count_tokens(contextualize(path, text))
            if token_count > MAX_EMBED_TOKENS:
                raise IndexingError(
                    "INDEX_FAILED",
                    f"A chunk on page {page_no} came to {token_count} tokens, over the {MAX_EMBED_TOKENS} the model takes.",
                    False,
                )
            events.append(
                ChunkEvent(
                    page_number=page_no,
                    seq=len(events),
                    kind=kind,
                    text_source=source,
                    section_path=path,
                    basis=basis_of(path),
                    text=text,
                    token_count=token_count,
                )
            )
    return events, _headings_at_end(page_doc) or carried


def _cut_to_page(document: DoclingDocument, page_no: int, range_pages: set[int]) -> DoclingDocument:
    """A copy of the document in which every item on the page holds only that page's part.

    `filter()` keeps an item with a prov on the page whole, with its provs on other pages.
    A text item that runs over a page break keeps this page's `prov.charspan` slices, as
    the page text does; any other item (a table) stays on its first page in the range only."""
    copy = document.model_copy(deep=True)
    items = [
        item
        for item, _ in copy.iterate_items(traverse_pictures=True, page_no=page_no, included_content_layers=_ALL_LAYERS)
        if any(prov.page_no != page_no for prov in getattr(item, "prov", []))
    ]
    for item in items:
        on_page = [prov for prov in item.prov if prov.page_no == page_no]
        if isinstance(item, TextItem):
            text = " ".join(
                part for prov in on_page if (part := item.text[prov.charspan[0] : prov.charspan[1]].strip())
            )
            item.text = item.orig = text
            item.prov = [prov.model_copy(update={"charspan": (0, len(text))}) for prov in on_page]
        else:
            first_page = min((prov.page_no for prov in item.prov if prov.page_no in range_pages), default=page_no)
            item.prov = on_page if first_page == page_no else []
    return copy


def _doc_chunks(chunker: HybridChunker, page_doc: DoclingDocument) -> list[tuple[DocChunk, str]]:
    """HybridChunker's steps on one page, with every table kept out of the merging.

    The hierarchical pass gives one chunk per element with its headings. Prose between two
    tables is split to the budget and merged with its peers as HybridChunker does; a table
    chunk is passed on whole, to be split by rows (`_table_texts`)."""
    serializer = chunker.serializer_provider.get_serializer(doc=page_doc)
    out: list[tuple[DocChunk, str]] = []
    run: list[DocChunk] = []

    def flush() -> None:
        split = [part for c in run for part in chunker._split_by_doc_items(c, doc_serializer=serializer)]
        split = [part for c in split for part in chunker._split_using_plain_text(c, doc_serializer=serializer)]
        out.extend((c, "prose") for c in chunker._merge_chunks_with_matching_metadata(split))
        run.clear()

    with warnings.catch_warnings():
        # HybridChunker warns, with the chunk's text, when headings alone overflow the budget.
        warnings.filterwarnings("ignore", message="Headers and captions for this chunk", category=UserWarning)
        for doc_chunk in chunker._inner_chunker.chunk(dl_doc=page_doc):
            if any(isinstance(item, TableItem) for item in doc_chunk.meta.doc_items):
                flush()
                out.append((doc_chunk, "table"))
            else:
                run.append(doc_chunk)
        flush()
    return out


def _table_texts(page_doc: DoclingDocument, doc_chunk: DocChunk, path: list[str], tokenizer: BaseTokenizer) -> list[str]:
    """A table chunk's texts: one row a line, cells separated by a space as the page text
    prints them, the caption first. When the whole does not fit the budget (with its path),
    it splits by rows, each part starting with the header rows."""
    budget = tokenizer.get_max_tokens()

    def fits(lines: list[str]) -> bool:
        return tokenizer.count_tokens(contextualize(path, "\n".join(lines))) <= budget

    texts: list[str] = []
    for table in (item for item in doc_chunk.meta.doc_items if isinstance(item, TableItem)):
        caption = table.caption_text(page_doc).strip()
        lead = [caption] if caption else []
        header, body = _table_rows(table)
        lines, rows_in, with_lead = [*lead, *header], 0, bool(lead)
        for row in body:
            if not fits([*lines, row]):
                if rows_in:
                    texts.append("\n".join(lines))
                elif with_lead:
                    texts.append("\n".join(lead))  # the caption, when no row fits under it
                lines, rows_in, with_lead = list(header), 0, False
                if not fits([*lines, row]):  # too wide to sit under its header: cut on its own
                    texts.extend(_cut_text(row, path, tokenizer))
                    continue
            lines.append(row)
            rows_in += 1
        if rows_in or not body:
            texts.append("\n".join(lines))
    return texts


def _table_rows(table: TableItem) -> tuple[list[str], list[str]]:
    """The header rows (the leading rows with a column header cell) and the body rows."""
    rows: dict[int, list[str]] = {}
    header_rows: set[int] = set()
    for cell in sorted(table.data.table_cells, key=lambda c: (c.start_row_offset_idx, c.start_col_offset_idx)):
        if cell.column_header:
            header_rows.add(cell.start_row_offset_idx)
        if cell.text.strip():
            rows.setdefault(cell.start_row_offset_idx, []).append(cell.text.strip())
    ordered = sorted(rows.items())
    leading = 0
    while leading < len(ordered) and ordered[leading][0] in header_rows:
        leading += 1
    lines = [" ".join(cells) for _, cells in ordered]
    return lines[:leading], lines[leading:]


def _cut_text(text: str, path: list[str], tokenizer: BaseTokenizer) -> list[str]:
    """A text too long for one chunk, cut at natural boundaries to fit with its path."""
    available = tokenizer.get_max_tokens() - tokenizer.count_tokens(contextualize(path, ""))
    split: Callable[[str], list[str]] = semchunk.chunkerify(tokenizer.get_tokenizer(), chunk_size=max(available, 1))
    return split(text)


def _text_source(read: RangeRead, originals: dict[str, str], doc_chunk: DocChunk, page_no: int) -> TextSource:
    """The union of the chunk's items' sources, looked up by the items' refs in the read."""
    sources = {
        read.item_sources[original]
        for item in doc_chunk.meta.doc_items
        if (original := originals.get(item.self_ref)) in read.item_sources
    }
    if not sources:
        raise IndexingError("INDEX_FAILED", f"A chunk on page {page_no} has no recorded text source.", False)
    return sources.pop() if len(sources) == 1 else "mixed"


def _headings_at_end(page_doc: DoclingDocument) -> list[str]:
    """The headings in effect after the page's last item, as HybridChunker tracks them, so
    a heading with nothing under it on its page still carries to the next."""
    by_level: dict[int, str] = {}
    for item, _ in page_doc.iterate_items():
        if isinstance(item, TitleItem | SectionHeaderItem):
            level = item.level if isinstance(item, SectionHeaderItem) else 0
            for shadowed in [k for k in by_level if k >= level]:
                del by_level[shadowed]
            by_level[level] = item.text
    return [by_level[level] for level in sorted(by_level)]


def _boxes(item) -> list:
    return [(prov.bbox, prov.charspan) for prov in getattr(item, "prov", [])]
