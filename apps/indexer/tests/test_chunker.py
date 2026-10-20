"""Chunking a cached range read: per page, by element, with the section path carried along.

No models: the saved reads in tests/fixtures and a whitespace tokenizer built in code.
"""

import json
import tempfile
import unittest
from pathlib import Path

from docling_core.types.doc import DoclingDocument

from maester_indexer.chunker import (
    MAX_EMBED_TOKENS,
    PATH_TOKENS,
    basis_of,
    chunk_range,
    filter_document,
    load_tokenizer,
)
from maester_indexer.contracts import ChunkEvent, PageEvent, RangeRead, contextualize
from maester_indexer.errors import IndexingError
from tests.helpers import fixture_read as read
from tests.helpers import whitespace_tokenizer

# The fixture's running header. docling-parse reads its en dash as a hyphen, so the test
# looks for the part before it.
RUNNING_HEADER = "Annual report 2025"
# The two halves of the paragraph that runs from page 1 of two-sections onto page 2.
FIRST_HALF = "shown net of the allowance for expected losses,"
SECOND_HALF = "Borrowings are carried at amortised cost"


def tok(max_tokens: int = 448):
    return whitespace_tokenizer(max_tokens)


def path_after(pages: list[PageEvent], page_number: int) -> list[str]:
    return next(p.section_path_after for p in pages if p.page_number == page_number)


def table_rows(read: RangeRead, index: int = 0) -> list[str]:
    """The fixture table's rows as the reader prints them: cells joined by a space."""
    rows: dict[int, list[str]] = {}
    cells = read.document["tables"][index]["data"]["table_cells"]
    for cell in sorted(cells, key=lambda c: (c["start_row_offset_idx"], c["start_col_offset_idx"])):
        if cell["text"].strip():
            rows.setdefault(cell["start_row_offset_idx"], []).append(cell["text"].strip())
    return [" ".join(row) for _, row in sorted(rows.items())]


def edited(read: RangeRead, edit) -> RangeRead:
    """The read with its document changed by `edit(DoclingDocument)`."""
    document = DoclingDocument.model_validate(read.document)
    edit(document)
    return read.model_copy(update={"document": document.export_to_dict()})


class WithinAPageTests(unittest.TestCase):
    def test_no_chunk_crosses_a_page(self):
        _, chunks = chunk_range(read("two-sections"), [], tok())
        first = [c.page_number for c in chunks if FIRST_HALF in c.text]
        second = [c.page_number for c in chunks if SECOND_HALF in c.text]
        self.assertEqual(first, [1])
        self.assertEqual(second, [2])

    def test_running_header_is_in_the_page_text_and_in_no_chunk(self):
        pages, chunks = chunk_range(read("two-sections"), [], tok())
        self.assertTrue(all(RUNNING_HEADER in p.text for p in pages))
        self.assertFalse(any(RUNNING_HEADER in c.text for c in chunks))

    def test_a_page_event_for_each_page_in_order(self):
        source = read("two-sections")
        pages, _ = chunk_range(source, [], tok())
        self.assertEqual([p.page_number for p in pages], [1, 2, 3])
        for event, page in zip(pages, source.pages, strict=True):
            self.assertEqual(
                (event.text, event.items_text_layer, event.items_ocr, event.none_reason),
                (page.text, page.items_text_layer, page.items_ocr, page.none_reason),
            )

    def test_seq_counts_within_the_page(self):
        _, chunks = chunk_range(read("text-layer"), [], tok(24))
        self.assertGreater(len(chunks), 2)
        self.assertEqual([c.seq for c in chunks], list(range(len(chunks))))

    def test_seq_is_stable_when_a_page_is_chunked_alone(self):
        _, all_pages = chunk_range(read("two-sections"), [], tok())
        pages, _ = chunk_range(read("two-sections", pages=(1, 1)), [], tok())
        _, page_2 = chunk_range(read("two-sections", pages=(2, 2)), path_after(pages, 1), tok())
        self.assertEqual(
            [(c.page_number, c.seq, c.text, c.section_path) for c in all_pages if c.page_number == 2],
            [(c.page_number, c.seq, c.text, c.section_path) for c in page_2],
        )


class SectionPathTests(unittest.TestCase):
    def test_a_heading_carries_onto_the_next_page(self):
        _, chunks = chunk_range(read("two-sections"), [], tok())
        first_on_2 = next(c for c in chunks if c.page_number == 2)
        self.assertEqual(first_on_2.section_path, ["Standalone balance sheet"])
        self.assertEqual(first_on_2.basis, "standalone")

    def test_a_heading_carries_across_a_range_boundary(self):
        pages, _ = chunk_range(read("two-sections", pages=(1, 1)), [], tok())
        self.assertEqual(pages[-1].section_path_after, ["Standalone balance sheet"])
        _, chunks = chunk_range(read("two-sections", pages=(2, 3)), pages[-1].section_path_after, tok())
        self.assertEqual(chunks[0].page_number, 2)
        self.assertEqual(chunks[0].section_path, ["Standalone balance sheet"])

    def test_the_path_before_the_range_is_used_until_a_heading(self):
        _, chunks = chunk_range(read("two-sections", pages=(2, 3)), ["Notes"], tok())
        self.assertEqual([c.section_path for c in chunks if c.page_number == 2], [["Notes"]])
        self.assertEqual({tuple(c.section_path) for c in chunks if c.page_number == 3}, {("Consolidated balance sheet",)})

    def test_consolidated_and_standalone_never_share_a_chunk(self):
        _, chunks = chunk_range(read("two-sections"), [], tok())
        self.assertEqual({c.basis for c in chunks if c.page_number in (1, 2)}, {"standalone"})
        self.assertEqual({c.basis for c in chunks if c.page_number == 3}, {"consolidated"})

    def test_a_heading_with_nothing_under_it_on_its_page_still_carries(self):
        # Page 3 without its table: the page ends on "Consolidated balance sheet".
        source = edited(read("two-sections"), lambda d: d.delete_items(node_items=[d.tables[1]]))
        pages, chunks = chunk_range(source, [], tok())
        self.assertEqual([c for c in chunks if c.page_number == 3], [])
        self.assertEqual(path_after(pages, 3), ["Consolidated balance sheet"])

    def test_a_long_carried_path_is_cut_from_the_left(self):
        carried = ["Part " + "x " * 80, "Notes", "25 Borrowings"]
        _, chunks = chunk_range(read("two-sections", pages=(2, 2)), carried, tok())
        self.assertEqual(chunks[0].section_path, ["Notes", "25 Borrowings"])
        self.assertLessEqual(tok().count_tokens("\n".join(chunks[0].section_path)), PATH_TOKENS)

    def test_the_path_after_a_page_with_no_heading_is_the_carried_path(self):
        pages, _ = chunk_range(read("two-sections", pages=(2, 2)), ["Notes"], tok())
        self.assertEqual(pages[0].section_path_after, ["Notes"])


class BasisTests(unittest.TestCase):
    def test_the_innermost_heading_that_names_a_basis_decides(self):
        self.assertEqual(basis_of(["Consolidated financial statements", "Standalone notes", "25 Borrowings"]), "standalone")
        self.assertEqual(basis_of(["Notes to the CONSOLIDATED financial statements", "25 Borrowings"]), "consolidated")

    def test_a_basis_is_a_whole_word(self):
        self.assertIsNone(basis_of(["Unconsolidated entities", "Standalones"]))
        self.assertIsNone(basis_of([]))


class TableTests(unittest.TestCase):
    def test_a_table_is_its_own_chunk_and_stays_whole_when_it_fits(self):
        source = read("text-layer")
        _, chunks = chunk_range(source, [], tok(448))
        self.assertEqual([c.kind for c in chunks], ["prose", "table"])
        prose, table = chunks
        self.assertEqual(table.text, "\n".join(table_rows(source)))
        self.assertIn("Revenue from operations grew", prose.text)
        self.assertNotIn("Revenue from operations grew", table.text)

    def test_a_table_too_large_splits_by_rows_with_its_header(self):
        source = read("text-layer")
        header, *body = table_rows(source)
        _, chunks = chunk_range(source, [], tok(24))
        tables = [c for c in chunks if c.kind == "table"]
        self.assertGreater(len(tables), 1)
        for chunk in tables:
            self.assertEqual(chunk.text.split("\n")[0], header)
            self.assertLessEqual(chunk.token_count, 24)
        self.assertEqual([line for c in tables for line in c.text.split("\n")[1:]], body)

    def test_a_row_too_wide_for_its_header_is_cut_on_its_own(self):
        source = read("text-layer")
        body = table_rows(source)[1:]
        _, chunks = chunk_range(source, [], tok(10))
        tables = [c for c in chunks if c.kind == "table"]
        self.assertTrue(all(c.token_count <= 10 for c in chunks))
        self.assertEqual(" ".join(c.text for c in tables).split(), " ".join(body).split())

    def test_a_table_takes_the_source_of_its_own_item(self):
        # Mark only page 3's table as OCR: filtering renumbers it #/tables/0 on its page.
        source = read("two-sections")
        source = source.model_copy(update={"item_sources": {**source.item_sources, "#/tables/1": "ocr"}})
        for whole in (source, read("two-sections")):
            self.assertEqual(whole.item_sources.get("#/tables/0"), "text_layer")
        _, chunks = chunk_range(source, [], tok())
        self.assertEqual({(c.page_number, c.text_source) for c in chunks if c.kind == "table"}, {(1, "text_layer"), (3, "ocr")})


class SourceAndBudgetTests(unittest.TestCase):
    def test_sources_and_budget(self):
        _, chunks = chunk_range(read("mixed"), [], tok())
        self.assertEqual([c.text_source for c in chunks], ["mixed"])  # the merged paragraph chunk holds both
        for chunk in [*chunks, *chunk_range(read("two-sections"), [], tok())[1]]:
            self.assertEqual(chunk.token_count, tok().count_tokens(contextualize(chunk.section_path, chunk.text)))
            self.assertLessEqual(chunk.token_count, MAX_EMBED_TOKENS)

    def test_ocr_items_make_an_ocr_chunk(self):
        _, chunks = chunk_range(read("scanned"), [], tok())
        self.assertEqual({c.text_source for c in chunks}, {"ocr"})

    def test_a_chunk_with_no_recorded_source_is_refused(self):
        source = read("mixed").model_copy(update={"item_sources": {}})
        with self.assertRaises(IndexingError) as raised:
            chunk_range(source, [], tok())
        self.assertEqual(raised.exception.code, "INDEX_FAILED")

    def test_a_chunk_over_the_embedding_limit_is_a_bug(self):
        def lengthen(document: DoclingDocument) -> None:
            paragraph = document.texts[1]
            paragraph.text = paragraph.orig = " ".join(["word"] * 600)
            paragraph.prov[0].charspan = (0, len(paragraph.text))

        source = edited(read("text-layer"), lengthen)
        with self.assertRaises(IndexingError) as raised:
            chunk_range(source, [], tok(1000))
        self.assertEqual(raised.exception.code, "INDEX_FAILED")
        self.assertFalse(raised.exception.retryable)
        self.assertNotIn("word", raised.exception.message)

    def test_events_are_wire_models(self):
        pages, chunks = chunk_range(read("two-sections"), [], tok())
        for event in [*pages, *chunks]:
            self.assertIsInstance(event, (PageEvent, ChunkEvent))
            type(event).from_wire(event.to_wire())


class FilterDocumentTests(unittest.TestCase):
    def test_filtered_refs_map_back_to_the_original_items(self):
        document = DoclingDocument.model_validate(read("two-sections").document)
        page_3, original = filter_document(document, {3})
        self.assertEqual(original["#/texts/1"], "#/texts/7")
        self.assertEqual(original["#/tables/0"], "#/tables/1")
        self.assertEqual(page_3.texts[1].text, "Consolidated balance sheet")


class LoadTokenizerTests(unittest.TestCase):
    MODEL = "Example/whitespace-model"

    def _models(self, root: Path, model_id: str | None) -> Path:
        folder = root / "embed" / self.MODEL
        whitespace_tokenizer(448).get_tokenizer().save_pretrained(str(folder))
        if model_id is not None:
            lock = {"embedding": {"id": model_id, "revision": "0" * 40}, "docling": {}}
            (root / "models.lock.json").write_text(json.dumps(lock), encoding="utf-8")
        return folder

    def test_loads_the_folder_named_in_the_lock(self):
        with tempfile.TemporaryDirectory() as root:
            tokenizer = load_tokenizer(str(self._models(Path(root), self.MODEL)), self.MODEL)
            self.assertEqual(tokenizer.get_max_tokens(), 448)
            self.assertEqual(tokenizer.count_tokens("three short words"), 3)

    def test_refuses_another_model(self):
        with tempfile.TemporaryDirectory() as root:
            folder = self._models(Path(root), self.MODEL)
            with self.assertRaises(IndexingError) as raised:
                load_tokenizer(str(folder), "Snowflake/snowflake-arctic-embed-l-v2.0")
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_MODEL_MISMATCH", False))

    def test_refuses_a_folder_with_no_tokenizer(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root) / "embed" / self.MODEL
            folder.mkdir(parents=True)
            lock = {"embedding": {"id": self.MODEL, "revision": "0" * 40}, "docling": {}}
            (Path(root) / "models.lock.json").write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaises(IndexingError) as raised:
                load_tokenizer(str(folder), self.MODEL)
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_NOT_CONFIGURED", False))

    def test_refuses_a_folder_with_no_lock(self):
        with tempfile.TemporaryDirectory() as root:
            folder = self._models(Path(root), None)
            with self.assertRaises(IndexingError) as raised:
                load_tokenizer(str(folder), self.MODEL)
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_MODEL_MISMATCH", False))


if __name__ == "__main__":
    unittest.main()
