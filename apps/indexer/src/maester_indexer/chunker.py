"""Cutting one cached range read into page events and chunk events (spec section 8.3).

Each page is chunked on its own, so a chunk never crosses a page and a page chunked again
alone gets the same chunks. Within a page, Docling's HybridChunker cuts by element and
merges small peers under one heading; a table is always its own chunk and, when it is too
large, splits by rows with its header repeated. Furniture (running headers and footers)
never enters a chunk.

The section path runs from page to page. A heading that names a basis ("consolidated" or
"standalone") becomes the root of the path, and later headings that name none nest under
it, until another heading names a basis and replaces it; the chunk's basis comes from that
root. A chunk with no heading above it on its page takes the path carried from before.
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
from maester_indexer.lockfile import LOCK_FILE

MAX_EMBED_TOKENS = 512  # the most the embedding model is given: the path, its newline, the text and its special tokens
PATH_TOKENS = 64  # the most a chunk's section path may take
CHUNK_TOKENS = 448  # the chunker's budget for the text, so a path of PATH_TOKENS still fits

HEADER_SHARE = 2  # a table's header rows are repeated only while they take at most 1/HEADER_SHARE of the budget
_ALL_LAYERS = set(ContentLayer)
_BASIS = re.compile(r"\b(consolidated|standalone)\b", re.IGNORECASE)


def chunk_range(
    read: RangeRead, section_path_before: list[str], tokenizer: BaseTokenizer
) -> tuple[list[PageEvent], list[ChunkEvent]]:
    """The range's page events and chunk events, page by page in order.

    `section_path_before` is the path in effect at the end of the page before the range
    (the previous range's last `sectionPathAfter`, whole: it carries the root). `tokenizer`
    carries the chunker's budget (`get_max_tokens()`, CHUNK_TOKENS in production)."""
    document = DoclingDocument.model_validate(read.document)
    # Only HybridChunker's steps are used (`_doc_chunks`), so its merge_peers and
    # repeat_table_header switches would do nothing here; the table rule is `_table_texts`.
    chunker = HybridChunker(tokenizer=tokenizer)
    carried = list(section_path_before)
    page_events: list[PageEvent] = []
    chunk_events: list[ChunkEvent] = []
    for page in read.pages:
        page_chunks, path_after = _chunk_page(read, document, page.page_number, chunker, carried)
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
        carried = path_after
    return page_events, chunk_events


def basis_of(section_path: list[str]) -> str | None:
    """From the innermost heading out, the first that names a basis decides. In a path the
    chunker builds, that is the root."""
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


def embed_budget(tokenizer: BaseTokenizer) -> int:
    """The most `contextualize(path, text)` may count: MAX_EMBED_TOKENS less the start and
    end tokens the model adds, which `count_tokens` leaves out."""
    model = tokenizer.get_tokenizer()
    special = model.num_special_tokens_to_add(pair=False) if hasattr(model, "num_special_tokens_to_add") else 0
    return MAX_EMBED_TOKENS - special


def fit_path(section_path: list[str], text: str, tokenizer: BaseTokenizer) -> list[str]:
    """The path a chunk is embedded with: cut to PATH_TOKENS, then further from the left
    (down to none) until `contextualize(path, text)`, newline included, fits `embed_budget`."""
    path = cut_path(section_path, tokenizer)
    budget = embed_budget(tokenizer)
    while path and tokenizer.count_tokens(contextualize(path, text)) > budget:
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
        try:
            new_item = RefItem(cref=new_ref).resolve(filtered)
        except (IndexError, KeyError, ValueError, AttributeError):
            raise IndexingError("INDEX_FAILED", "Filtering the document by page lost an item.", False) from None
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
    must be named after it (`…/embed/<model id>`). No lock means the models were not fetched
    (INDEXER_NOT_CONFIGURED); a lock for another model is INDEXER_MODEL_MISMATCH."""
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
    """The lock's model when the folder is named after it, else None. No lock at all is
    INDEXER_NOT_CONFIGURED: the fetch writes the lock last, so the models are not all there."""
    for directory in (folder, *folder.parents):
        lock = directory / LOCK_FILE
        if lock.is_file():
            try:
                model_id = json.loads(lock.read_text(encoding="utf-8")).get("embedding", {}).get("id")
            except (OSError, UnicodeDecodeError, ValueError, AttributeError):
                raise IndexingError(
                    "INDEXER_NOT_CONFIGURED", f"The {LOCK_FILE} above INDEX_TOKENIZER_PATH could not be read.", False
                ) from None
            if isinstance(model_id, str) and folder.parts[-len(model_id.split("/")) :] == tuple(model_id.split("/")):
                return model_id
            return None
    raise IndexingError(
        "INDEXER_NOT_CONFIGURED",
        f"No {LOCK_FILE} in or above INDEX_TOKENIZER_PATH: the models were not fetched.",
        False,
    )


def _chunk_page(
    read: RangeRead,
    document: DoclingDocument,
    page_no: int,
    chunker: HybridChunker,
    carried: list[str],
) -> tuple[list[ChunkEvent], list[str]]:
    """One page's chunk events and the section path in effect at its end."""
    if page_no not in document.pages:  # Docling kept nothing of the page
        return [], carried
    page_doc, originals = filter_document(_cut_to_page(document, page_no), {page_no})
    tokenizer = chunker.tokenizer
    budget = embed_budget(tokenizer)
    roots, end_root = _roots(page_doc, _root_of(carried))
    events: list[ChunkEvent] = []
    for doc_chunk, kind, root in _doc_chunks(chunker, page_doc, roots, _root_of(carried)):
        whole = _section_path(doc_chunk.meta.headings or [], root, carried)
        basis = basis_of(whole)
        shown = cut_path(whole, tokenizer)
        source = _text_source(read, page_doc, originals, doc_chunk)
        texts = [doc_chunk.text] if kind == "prose" else _table_texts(page_doc, doc_chunk, shown, tokenizer)
        for text in texts:
            text = text.strip()
            if not text:
                continue
            path = fit_path(shown, text, tokenizer)
            token_count = tokenizer.count_tokens(contextualize(path, text))
            if token_count > budget:  # the text alone: the chunker's budget failed
                raise IndexingError(
                    "INDEX_FAILED",
                    f"A chunk on page {page_no} came to {token_count} tokens, over the {budget} the model takes.",
                    False,
                )
            events.append(
                ChunkEvent(
                    page_number=page_no,
                    seq=len(events),
                    kind=kind,
                    text_source=source,
                    section_path=path,
                    basis=basis,
                    text=text,
                    token_count=token_count,
                )
            )
    return events, _section_path(_headings_at_end(page_doc), end_root, carried)


def _section_path(headings: list[str], root: str | None, carried: list[str]) -> list[str]:
    """A chunk's whole path from the headings above it on its page and the root in effect.

    The innermost heading that names a basis is the root, with the headings under it; with
    none among them, the headings nest under the root in effect. No heading above it on the
    page: the carried path, or the page's own root if one replaced the carried root (a
    heading HybridChunker dropped for overflowing its budget)."""
    if not headings:
        return list(carried) if root == _root_of(carried) else [root]
    named = [index for index, heading in enumerate(headings) if _BASIS.search(heading)]
    if named:
        return headings[named[-1] :]
    return [*([root] if root else []), *headings]


def _root_of(path: list[str]) -> str | None:
    """The heading in a path that names a basis (the innermost, if a caller sent several)."""
    return next((heading for heading in reversed(path) if _BASIS.search(heading)), None)


def _roots(page_doc: DoclingDocument, root: str | None) -> tuple[dict[str, str | None], str | None]:
    """For each item of the page, the root in effect at it, walking in reading order from
    the carried root; and the root at the end of the page. A heading that names a basis
    counts even with nothing under it before the next heading."""
    at: dict[str, str | None] = {}
    for item, _ in page_doc.iterate_items():
        if isinstance(item, TitleItem | SectionHeaderItem):
            if _BASIS.search(item.text):
                root = item.text
        else:
            at[item.self_ref] = root
    return at, root


def _cut_to_page(document: DoclingDocument, page_no: int) -> DoclingDocument:
    """A copy of the document in which every item on the page holds only that page's part.

    `filter()` keeps an item with a prov on the page whole, with its provs on other pages.
    A text item that runs over a page break keeps this page's `prov.charspan` slices, as
    the page text does; any other item (a table) stays on its first page only, so where it
    lands does not depend on how the document was split into ranges."""
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
            item.prov = on_page if min(prov.page_no for prov in item.prov) == page_no else []
    return copy


def _doc_chunks(
    chunker: HybridChunker, page_doc: DoclingDocument, roots: dict[str, str | None], carried_root: str | None
) -> list[tuple[DocChunk, str, str | None]]:
    """HybridChunker's steps on one page, with every table kept out of the merging.

    The hierarchical pass gives one chunk per element with its headings. Prose between two
    tables, under one root, is split to the budget and merged with its peers as
    HybridChunker does, so a change of root also ends a merge; a table chunk is passed on
    whole, to be split by rows (`_table_texts`). Each chunk comes with its root."""
    serializer = chunker.serializer_provider.get_serializer(doc=page_doc)
    out: list[tuple[DocChunk, str, str | None]] = []
    run: list[DocChunk] = []
    run_root: str | None = None

    def flush() -> None:
        split = [part for c in run for part in chunker._split_by_doc_items(c, doc_serializer=serializer)]
        split = [part for c in split for part in chunker._split_using_plain_text(c, doc_serializer=serializer)]
        out.extend((c, "prose", run_root) for c in chunker._merge_chunks_with_matching_metadata(split))
        run.clear()

    with warnings.catch_warnings():
        # HybridChunker warns, with the chunk's text, when headings alone overflow the budget.
        warnings.filterwarnings("ignore", message="Headers and captions for this chunk", category=UserWarning)
        for doc_chunk in chunker._inner_chunker.chunk(dl_doc=page_doc):
            items = doc_chunk.meta.doc_items
            root = roots.get(items[0].self_ref, carried_root) if items else carried_root
            if any(isinstance(item, TableItem) for item in items):
                flush()
                out.append((doc_chunk, "table", root))
                continue
            if run and root != run_root:
                flush()
            run.append(doc_chunk)
            run_root = root
        flush()
    return out


def _table_texts(page_doc: DoclingDocument, doc_chunk: DocChunk, path: list[str], tokenizer: BaseTokenizer) -> list[str]:
    """A table chunk's texts: one row a line, cells separated by a space as the page text
    prints them, the caption first. When the whole does not fit the budget (with its path),
    it splits by rows, each part starting with the header rows.

    Header rows taking more than 1/HEADER_SHARE of the budget are not repeated: they are
    read as body rows. A caption that does not fit with the header goes out ahead of the
    table, cut to the budget; a row too wide to sit under the header is cut into pieces,
    each under the header. So no part is over the budget."""
    budget = tokenizer.get_max_tokens()

    def fits(lines: list[str]) -> bool:
        return tokenizer.count_tokens(contextualize(path, "\n".join(lines))) <= budget

    texts: list[str] = []
    for table in (item for item in doc_chunk.meta.doc_items if isinstance(item, TableItem)):
        header, body = _table_rows(table)
        if header and tokenizer.count_tokens("\n".join(header)) * HEADER_SHARE > budget:
            header, body = [], [*header, *body]
        lead: list[str] = []
        if caption := table.caption_text(page_doc).strip():
            if fits([caption, *header]):
                lead = [caption]
            else:
                texts.extend(_cut_text(caption, path, tokenizer))
        lines, rows_in = [*lead, *header], 0
        for row in body:
            if not fits([*lines, row]):
                if rows_in:
                    texts.append("\n".join(lines))
                elif lead:
                    texts.append("\n".join(lead))  # the caption, when no row fits under it with the header
                lead, lines, rows_in = [], list(header), 0
                if not fits([*lines, row]):  # too wide to sit under its header: cut, each piece under it
                    texts.extend("\n".join([*header, piece]) for piece in _cut_text(row, path, tokenizer, header))
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


def _cut_text(text: str, path: list[str], tokenizer: BaseTokenizer, under: list[str] | None = None) -> list[str]:
    """A text too long for one chunk, cut at natural boundaries to fit with its path and
    the lines it goes under (a table's header rows)."""
    prefix = "\n".join([*(under or []), ""])
    available = tokenizer.get_max_tokens() - tokenizer.count_tokens(contextualize(path, prefix))
    split: Callable[[str], list[str]] = semchunk.chunkerify(tokenizer.get_tokenizer(), chunk_size=max(available, 1))
    return split(text)


def _text_source(read: RangeRead, page_doc: DoclingDocument, originals: dict[str, str], doc_chunk: DocChunk) -> TextSource:
    """The union of the chunk's items' sources, looked up by the items' refs in the read.

    With OCR off, every item is text layer, recorded or not. With OCR on, an item with text
    and no recorded source may have been read by OCR: the chunk is `mixed`, or `ocr` when
    every recorded source is OCR."""
    sources: set[str] = set()
    unrecorded = False
    for item in doc_chunk.meta.doc_items:
        original = originals.get(item.self_ref)
        if original in read.item_sources:
            sources.add(read.item_sources[original])
        elif _has_text(RefItem(cref=item.self_ref).resolve(page_doc)):  # a chunk's meta keeps only DocItem
            unrecorded = True
    if not read.ocr_on:
        return "text_layer" if not sources else (sources.pop() if len(sources) == 1 else "mixed")
    if unrecorded or not sources:
        return "ocr" if sources == {"ocr"} else "mixed"
    return sources.pop() if len(sources) == 1 else "mixed"


def _has_text(item) -> bool:
    if isinstance(item, TableItem):
        return any(cell.text.strip() for cell in item.data.table_cells)
    return isinstance(item, TextItem) and bool(item.text.strip())


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
