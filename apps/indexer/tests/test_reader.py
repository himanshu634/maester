"""Reading a page range. The first class needs no models; the second is skipped unless
MAESTER_DOCLING_MODELS names a folder of Docling's artifacts (see test_probe)."""

import json
import os
import unittest
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from threading import Event

from docling_core.types.doc import DoclingDocument
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

from maester_indexer.contracts import RangeRead
from maester_indexer.errors import IndexingError
from maester_indexer.reader import Reader, ReadCancelled
from maester_indexer.settings import Settings
from maester_indexer.versions import CHUNKER_VERSION, DOCLING_VERSION, OCR_ENGINE
from tests.helpers import quiet_docling

FIXTURES = Path(__file__).resolve().parent / "fixtures"
MODELS = os.environ.get("MAESTER_DOCLING_MODELS", "")


def pdf(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def made_pdf(pages: int = 1, encrypt: str | None = None) -> bytes:
    out = BytesIO()
    canvas = Canvas(out, pagesize=A4, invariant=1, encrypt=encrypt)
    for _ in range(pages):
        canvas.showPage()
    canvas.save()
    return out.getvalue()


@lru_cache(maxsize=1)
def reader() -> Reader:
    return Reader(Settings.from_env({"DOCLING_ARTIFACTS_PATH": MODELS}))


class BeforeReading(unittest.TestCase):
    """What the reader settles before Docling runs, so no models are needed."""

    def test_page_count(self):
        self.assertEqual(reader().page_count(pdf("two-sections.pdf")), 3)
        self.assertEqual(reader().page_count(pdf("text-layer.pdf")), 1)

    def test_unreadable_pdf(self):
        for data in (b"%PDF-1.7 not really", b"", made_pdf(encrypt="owner-only-knows")):
            with self.subTest(data=data[:12]):
                with self.assertRaises(IndexingError) as e:
                    reader().read_range(data, 1, 20, 400, Event())
                self.assertEqual((e.exception.code, e.exception.retryable), ("UNREADABLE_PDF", False))
                with self.assertRaises(IndexingError) as e:
                    reader().page_count(data)
                self.assertEqual(e.exception.code, "UNREADABLE_PDF")

    def test_a_range_must_start_on_a_page_of_the_file(self):
        for first, last in ((4, 6), (0, 2), (3, 2)):
            with self.subTest(first=first, last=last):
                with self.assertRaises(IndexingError) as e:
                    reader().read_range(pdf("two-sections.pdf"), first, last, 400, Event())
                self.assertEqual((e.exception.code, e.exception.retryable), ("INDEX_FAILED", False))

    def test_a_cancelled_read_stops_before_docling(self):
        cancel = Event()
        cancel.set()
        with self.assertRaises(ReadCancelled):
            reader().read_range(pdf("two-sections.pdf"), 1, 3, 400, cancel)

    def test_an_error_names_no_document_text(self):
        error = IndexingError("INDEX_FAILED", "Reading the range failed: RuntimeError.", True)
        self.assertEqual(str(error), "INDEX_FAILED: Reading the range failed: RuntimeError.")


class SavedReads(unittest.TestCase):
    """The reads tests/fixtures/save_reads.py wrote, which the chunker's tests run on."""

    def test_each_fixture_pdf_has_a_whole_read(self):
        for name in ("text-layer", "scanned", "mixed", "two-sections"):
            with self.subTest(name=name):
                read = RangeRead.from_wire(json.loads((FIXTURES / f"{name}.read.json").read_text(encoding="utf-8")))
                self.assertEqual((read.first_page, read.last_page), (1, reader().page_count(pdf(f"{name}.pdf"))))
                self.assertEqual([p.page_number for p in read.pages], list(range(1, read.last_page + 1)))
                self.assertTrue(read.ocr_on)
                document = DoclingDocument.model_validate(read.document)
                self.assertTrue(set(read.item_sources) <= {item.self_ref for item in [*document.texts, *document.tables]})


@unittest.skipUnless(MODELS and Path(MODELS).is_dir(), "MAESTER_DOCLING_MODELS does not name a folder of Docling artifacts")
class ReadRange(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        quiet_docling()

    def test_text_layer_page(self):
        read = reader().read_range(pdf("text-layer.pdf"), 1, 20, ocr_pages_left=400, cancel=Event())
        self.assertEqual((read.first_page, read.last_page, read.page_count), (1, 1, 1))
        self.assertEqual(set(read.item_sources.values()), {"text_layer"})
        self.assertIn("1,23,456.78", read.pages[0].text)  # exactly as printed
        self.assertEqual((read.pages[0].items_text_layer, read.pages[0].items_ocr), (3, 0))  # heading, text, table
        self.assertIsNone(read.pages[0].none_reason)

    def test_scanned_page_is_ocr(self):
        read = reader().read_range(pdf("scanned.pdf"), 1, 1, 400, Event())
        self.assertTrue(read.ocr_on)
        self.assertEqual(set(read.item_sources.values()), {"ocr"})
        self.assertGreater(read.pages[0].items_ocr, 0)
        self.assertEqual(read.pages[0].items_text_layer, 0)

    def test_mixed_page_has_both_sources(self):
        self.assertEqual(set(reader().read_range(pdf("mixed.pdf"), 1, 1, 400, Event()).item_sources.values()), {"text_layer", "ocr"})

    def test_no_ocr_budget_left_marks_the_scanned_page(self):
        read = reader().read_range(pdf("scanned.pdf"), 1, 1, 0, Event())
        self.assertFalse(read.ocr_on)
        page = read.pages[0]
        self.assertEqual((page.text, page.none_reason), ("", "OCR_BUDGET"))
        self.assertEqual((page.items_text_layer, page.items_ocr), (0, 0))

    def test_a_blank_page_has_no_text_with_or_without_ocr(self):
        for budget in (400, 0):
            with self.subTest(budget=budget):
                page = reader().read_range(made_pdf(), 1, 1, budget, Event()).pages[0]
                self.assertEqual((page.text, page.none_reason), ("", "NO_TEXT"))

    def test_a_range_reads_only_its_pages(self):
        read = reader().read_range(pdf("two-sections.pdf"), 2, 3, 400, Event())
        self.assertEqual([p.page_number for p in read.pages], [2, 3])
        self.assertEqual((read.first_page, read.last_page, read.page_count), (2, 3, 3))

    def test_running_header_stays_in_page_text(self):
        # Ruling G: docling-parse reads the en dash of "2025–26" as "-", so match before it.
        self.assertIn("Annual report 2025", reader().read_range(pdf("two-sections.pdf"), 1, 1, 400, Event()).pages[0].text)

    def test_a_paragraph_over_a_page_break_gives_each_page_its_own_part(self):
        # Ruling K: the item has a prov per page; each page's text takes only its charspan.
        page_1, page_2, _ = reader().read_range(pdf("two-sections.pdf"), 1, 3, 400, Event()).pages
        self.assertIn("Note 3. Trade receivables", page_1.text)
        self.assertNotIn("which is worked out", page_1.text)
        self.assertIn("which is worked out", page_2.text)
        self.assertNotIn("Note 3.", page_2.text)
        self.assertEqual(page_2.items_text_layer, 2)  # the continued paragraph and the running header

    def test_the_read_carries_its_versions_and_document(self):
        read = reader().read_range(pdf("two-sections.pdf"), 1, 3, 400, Event())
        self.assertEqual(
            read.versions.model_dump(),
            {
                "docling_version": DOCLING_VERSION,
                "ocr_engine": OCR_ENGINE,
                "reader_options": "table=accurate;cell_matching=true;ocr=rapidocr",
                "chunker_version": CHUNKER_VERSION,
                "tokenizer": "Snowflake/snowflake-arctic-embed-l-v2.0",
            },
        )
        # Every text and table item has a source, furniture included, keyed by its self_ref.
        document = DoclingDocument.model_validate(read.document)
        self.assertEqual(set(read.item_sources), {item.self_ref for item in [*document.texts, *document.tables]})
        self.assertIn("#/texts/0", read.item_sources)  # the running header on page 1


if __name__ == "__main__":
    unittest.main()
