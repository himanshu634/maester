"""Chunking a cached range read: per page, by element, with the section path carried along.

No models: the saved reads in tests/fixtures and a whitespace tokenizer built in code.
"""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from docling_core.types.doc import DocItemLabel, DoclingDocument

from maester_indexer.chunker import (
    MAX_EMBED_TOKENS,
    PATH_TOKENS,
    basis_of,
    chunk_range,
    embed_budget,
    filter_document,
    load_tokenizer,
)
from maester_indexer.contracts import ChunkEvent, PageEvent, RangeRead, contextualize
from maester_indexer.errors import IndexingError
from tests.helpers import fixture_read as read
from tests.helpers import restrict_read
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


class NewlineCountingTokenizer(HuggingFaceTokenizer):
    """The whitespace tokenizer, with each newline counted as a token too."""

    def count_tokens(self, text: str) -> int:
        return super().count_tokens(text) + text.count("\n")


def newline_tok(max_tokens: int, special_tokens: bool = False) -> NewlineCountingTokenizer:
    model = whitespace_tokenizer(max_tokens, special_tokens).get_tokenizer()
    return NewlineCountingTokenizer(tokenizer=model, max_tokens=max_tokens)


def with_heading(read: RangeRead, index: int, text: str) -> RangeRead:
    """The read with text item `index` turned into a section header saying `text`."""
    document = copy.deepcopy(read.document)
    item = document["texts"][index]
    item.update(label="section_header", level=1, text=text, orig=text)
    item["prov"][0]["charspan"] = [0, len(text)]
    return read.model_copy(update={"document": document})


def with_paragraph(read: RangeRead, words: int) -> RangeRead:
    """text-layer with its paragraph (under "Statement of profit and loss") `words` words long."""

    def lengthen(document: DoclingDocument) -> None:
        paragraph = document.texts[1]
        paragraph.text = paragraph.orig = " ".join(["word"] * words)
        paragraph.prov[0].charspan = (0, len(paragraph.text))

    return edited(read, lengthen)


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

    def test_a_table_on_two_pages_stays_on_its_first_however_the_range_is_cut(self):
        def onto_page_2(document: DoclingDocument) -> None:
            table = document.tables[0]
            table.prov.append(table.prov[0].model_copy(update={"page_no": 2}))

        whole = edited(read("two-sections"), onto_page_2)
        _, all_pages = chunk_range(whole, [], tok())
        pages, _ = chunk_range(restrict_read(whole, (1, 1)), [], tok())
        _, from_2 = chunk_range(restrict_read(whole, (2, 3)), path_after(pages, 1), tok())
        self.assertEqual([c.kind for c in all_pages if c.page_number == 2], ["prose"])
        self.assertEqual(
            [(c.page_number, c.seq, c.text) for c in all_pages if c.page_number >= 2],
            [(c.page_number, c.seq, c.text) for c in from_2],
        )

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

    def test_a_heading_with_no_basis_nests_under_the_root(self):
        # "Note 2. Inventories …" on page 1 becomes a heading; the paragraph after it runs onto page 2.
        source = with_heading(read("two-sections"), 3, "25 Borrowings")
        pages, chunks = chunk_range(source, [], tok())
        nested = ["Standalone balance sheet", "25 Borrowings"]
        under = [c for c in chunks if FIRST_HALF in c.text or SECOND_HALF in c.text]
        self.assertEqual([(c.page_number, c.section_path, c.basis) for c in under], [(1, nested, "standalone"), (2, nested, "standalone")])
        self.assertEqual(path_after(pages, 1), nested)
        self.assertEqual({(tuple(c.section_path), c.basis) for c in chunks if c.page_number == 3}, {(("Consolidated balance sheet",), "consolidated")})
        self.assertEqual(path_after(pages, 3), ["Consolidated balance sheet"])

    def test_the_root_carries_across_a_range_boundary(self):
        pages, _ = chunk_range(with_heading(read("two-sections"), 3, "25 Borrowings"), [], tok())
        _, chunks = chunk_range(read("two-sections", pages=(2, 3)), path_after(pages, 1), tok())
        self.assertEqual(
            [(c.page_number, c.section_path, c.basis) for c in chunks],
            [(2, ["Standalone balance sheet", "25 Borrowings"], "standalone"), (3, ["Consolidated balance sheet"], "consolidated")],
        )

    def test_a_carried_heading_nests_under_the_carried_root(self):
        pages, chunks = chunk_range(read("text-layer"), ["Notes to the standalone financial statements", "24 Equity"], tok())
        root_and_heading = ["Notes to the standalone financial statements", "Statement of profit and loss"]
        self.assertEqual({(tuple(c.section_path), c.basis) for c in chunks}, {(tuple(root_and_heading), "standalone")})
        self.assertEqual(pages[0].section_path_after, root_and_heading)

    def test_the_basis_stays_when_the_root_is_cut_from_the_shown_path(self):
        carried = ["Standalone notes " + "x " * 80, "Notes"]
        pages, chunks = chunk_range(read("two-sections", pages=(2, 2)), carried, tok())
        self.assertEqual([(c.section_path, c.basis) for c in chunks], [(["Notes"], "standalone")])
        self.assertEqual(pages[0].section_path_after, carried)  # whole, so the root carries on

    def test_a_root_heading_dropped_by_the_chunker_still_roots_the_path(self):
        # A heading longer than the budget: HybridChunker leaves it out of the chunk's headings.
        heading = "Standalone " + " ".join(["x"] * 30)
        _, chunks = chunk_range(with_heading(read("text-layer"), 0, heading), [], tok(24))
        prose = [c for c in chunks if c.kind == "prose"]
        self.assertTrue(prose)
        self.assertEqual({(tuple(c.section_path), c.basis) for c in prose}, {((heading,), "standalone")})

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

    def test_a_row_too_wide_for_its_header_is_cut_under_it(self):
        source = read("text-layer")
        header, *body = table_rows(source)
        _, chunks = chunk_range(source, [], tok(10))
        tables = [c for c in chunks if c.kind == "table"]
        self.assertTrue(all(c.token_count <= 10 for c in chunks))
        self.assertTrue(all(c.text.split("\n")[0] == header for c in tables))
        pieces = [line for c in tables for line in c.text.split("\n")[1:]]
        self.assertEqual(" ".join(pieces).split(), " ".join(body).split())

    def test_header_rows_too_large_to_repeat_are_read_as_rows(self):
        def all_header(document: DoclingDocument) -> None:
            for cell in document.tables[0].data.table_cells:
                cell.column_header = True

        source = edited(read("text-layer"), all_header)
        _, chunks = chunk_range(source, [], tok(24))
        tables = [c for c in chunks if c.kind == "table"]
        self.assertGreater(len(tables), 1)
        self.assertTrue(all(c.token_count <= 24 for c in chunks))
        self.assertEqual([line for c in tables for line in c.text.split("\n")], table_rows(read("text-layer")))

    def test_a_caption_too_long_for_the_budget_is_cut_ahead_of_the_table(self):
        caption = " ".join(f"c{n}" for n in range(40))

        def add_caption(document: DoclingDocument) -> None:
            table = document.tables[0]
            prov = table.prov[0].model_copy(update={"charspan": (0, len(caption))})
            item = document.add_text(label=DocItemLabel.CAPTION, text=caption, prov=prov, parent=table)
            table.captions.append(item.get_ref())

        source = edited(read("text-layer"), add_caption)
        _, chunks = chunk_range(source, [], tok(24))
        tables = [c for c in chunks if c.kind == "table"]
        self.assertTrue(all(c.token_count <= 24 for c in chunks))
        words = " ".join(c.text for c in tables).split()
        self.assertEqual(words[:40], caption.split())
        self.assertEqual(words.count("c0"), 1)
        self.assertEqual([c for c in chunks if c.kind == "prose" and "c0" in c.text], [])

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

    def test_items_with_no_recorded_source_are_left_out(self):
        source = read("mixed")
        source = source.model_copy(update={"item_sources": {"#/texts/2": source.item_sources["#/texts/2"]}})
        _, chunks = chunk_range(source, [], tok())
        self.assertEqual([c.text_source for c in chunks], ["ocr"])

    def test_an_unrecorded_item_under_ocr_makes_the_chunk_mixed(self):
        mixed = read("mixed")
        text_layer_only = {"#/texts/1": mixed.item_sources["#/texts/1"]}  # the OCR item #/texts/2 dropped
        for ocr_on, expected in ((True, "mixed"), (False, "text_layer")):
            source = mixed.model_copy(update={"item_sources": text_layer_only, "ocr_on": ocr_on})
            _, chunks = chunk_range(source, [], tok())
            self.assertEqual([c.text_source for c in chunks], [expected])

    def test_a_chunk_with_no_recorded_source_takes_the_reads_ocr_setting(self):
        for ocr_on, expected in ((False, "text_layer"), (True, "mixed")):
            source = read("mixed").model_copy(update={"item_sources": {}, "ocr_on": ocr_on})
            _, chunks = chunk_range(source, [], tok())
            self.assertEqual([c.text_source for c in chunks], [expected])

    def test_the_path_fits_the_embedding_limit_with_its_newline(self):
        heading = ["Statement of profit and loss"]  # 5 tokens, then 1 for the newline
        _, at_edge = chunk_range(with_paragraph(read("text-layer"), 506), [], newline_tok(1000))
        self.assertEqual((at_edge[0].section_path, at_edge[0].token_count), (heading, MAX_EMBED_TOKENS))
        _, over = chunk_range(with_paragraph(read("text-layer"), 507), [], newline_tok(1000))
        self.assertEqual((over[0].section_path, over[0].token_count), ([], 507))
        self.assertEqual(over[0].basis, None)

    def test_the_models_special_tokens_are_kept_out_of_the_budget(self):
        tokenizer = newline_tok(1000, special_tokens=True)  # start and end tokens: 510 left
        self.assertEqual(embed_budget(tokenizer), MAX_EMBED_TOKENS - 2)
        _, at_edge = chunk_range(with_paragraph(read("text-layer"), 504), [], tokenizer)
        self.assertEqual((len(at_edge[0].section_path), at_edge[0].token_count), (1, 510))
        _, over = chunk_range(with_paragraph(read("text-layer"), 505), [], tokenizer)
        self.assertEqual((over[0].section_path, over[0].token_count), ([], 505))
        with self.assertRaises(IndexingError):
            chunk_range(with_paragraph(read("text-layer"), 511), [], tokenizer)

    def test_a_text_over_the_embedding_limit_alone_is_a_bug(self):
        source = with_paragraph(read("text-layer"), MAX_EMBED_TOKENS + 1)
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

    def test_an_item_lost_by_filtering_is_an_indexing_error(self):
        document = DoclingDocument.model_validate(read("two-sections").document)
        with mock.patch.object(DoclingDocument, "filter", return_value=DoclingDocument(name="empty")):
            with self.assertRaises(IndexingError) as raised:
                filter_document(document, {3})
        self.assertEqual(raised.exception.code, "INDEX_FAILED")


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

    def test_refuses_a_malformed_lock(self):
        for content in ("{not json", '{"embedding": "Example/whitespace-model"}'):
            with tempfile.TemporaryDirectory() as root:
                folder = self._models(Path(root), None)
                (Path(root) / "models.lock.json").write_text(content, encoding="utf-8")
                with self.assertRaises(IndexingError) as raised:
                    load_tokenizer(str(folder), self.MODEL)
                self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_NOT_CONFIGURED", False))

    def test_a_folder_with_no_lock_is_not_configured(self):
        # The fetch writes the lock last, so no lock means the models were not (all) fetched.
        with tempfile.TemporaryDirectory() as root:
            folder = self._models(Path(root), None)
            with self.assertRaises(IndexingError) as raised:
                load_tokenizer(str(folder), self.MODEL)
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_NOT_CONFIGURED", False))

    def test_a_lock_for_a_folder_of_another_name_is_a_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            folder = self._models(Path(root), "Example/other-model")
            with self.assertRaises(IndexingError) as raised:
                load_tokenizer(str(folder), self.MODEL)
            self.assertEqual((raised.exception.code, raised.exception.retryable), ("INDEXER_MODEL_MISMATCH", False))


if __name__ == "__main__":
    unittest.main()
