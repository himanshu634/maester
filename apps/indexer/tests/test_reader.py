"""Reading a page range. The first class needs no models; the second is skipped unless
MAESTER_DOCLING_MODELS names a folder of Docling's artifacts (see test_probe)."""

import json
import os
import unittest
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from threading import Event
from types import SimpleNamespace

from docling.datamodel.base_models import ConversionStatus, DoclingComponentType, ErrorItem, FailureCategory
from docling_core.types.doc import DoclingDocument
from docling_core.types.doc.page import BoundingRectangle
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

from maester_indexer.contracts import RangePage, RangeRead
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



SECRET = "1,23,456.78"  # stands for document text that must never reach an error or a log


def saved_document() -> DoclingDocument:
    saved = json.loads((FIXTURES / "two-sections.read.json").read_text(encoding="utf-8"))
    return DoclingDocument.model_validate(saved["document"])


def stub_page(document: DoclingDocument, page_no: int) -> SimpleNamespace:
    """A read page whose text-layer cells sit exactly on the document's item boxes."""
    height = document.pages[page_no].size.height
    cells = [
        SimpleNamespace(rect=BoundingRectangle.from_bounding_box(prov.bbox.to_top_left_origin(height)), from_ocr=False)
        for item in [*document.texts, *document.tables]
        for prov in item.prov
        if prov.page_no == page_no
    ]
    return SimpleNamespace(page_no=page_no, cells=cells, predictions=SimpleNamespace(layout=None), parsed_page=None)


def stub_result(status=ConversionStatus.SUCCESS, read_pages=(1, 2, 3), errors=(), document=None) -> SimpleNamespace:
    document = document or saved_document()
    return SimpleNamespace(
        input=SimpleNamespace(valid=True),
        status=status,
        document=document,
        pages=[stub_page(document, n) for n in read_pages],
        errors=list(errors),
    )


class StubConverter:
    def __init__(self, outcome):
        self.outcome = outcome
        self.initialized_pipelines: dict = {}

    def convert(self, stream, raises_on_error, page_range):
        self.initialized_pipelines["pdf"] = object()  # what Docling's first convert loads
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class StubReader(Reader):
    """A reader whose converters are stubs, so no model is loaded."""

    def __init__(self, outcome=None):
        super().__init__(Settings.from_env({}))
        self.outcome = outcome if outcome is not None else stub_result()
        self.made: list[tuple[bool, StubConverter]] = []

    def _make_converter(self, ocr_on):
        converter = StubConverter(self.outcome)
        self.made.append((ocr_on, converter))
        return converter


class WithAStubConverter(unittest.TestCase):
    def test_only_one_pipeline_is_resident(self):
        stub = StubReader()
        stub.read_range(pdf("two-sections.pdf"), 1, 3, 400, Event())
        stub.read_range(pdf("two-sections.pdf"), 1, 3, 0, Event())
        stub.read_range(pdf("two-sections.pdf"), 1, 3, 0, Event())
        (ocr_on, dropped), (ocr_off, resident) = stub.made
        self.assertEqual((ocr_on, ocr_off), (True, False))
        self.assertEqual(dropped.initialized_pipelines, {})  # its models let go
        self.assertEqual(len(resident.initialized_pipelines), 1)
        self.assertIs(stub._resident[1], resident)

    def test_a_page_docling_could_not_read_is_kept_as_unreadable(self):
        error = ErrorItem(
            component_type=DoclingComponentType.PIPELINE,
            module_name="StandardPdfPipeline",
            error_message=f"Total {SECRET} broke the model",
            category=FailureCategory.INFERENCE_FAILURE,
            page_no=2,
        )
        stub = StubReader(stub_result(ConversionStatus.PARTIAL_SUCCESS, read_pages=(1, 3), errors=[error]))
        with self.assertLogs("maester_indexer.reader", level="WARNING") as logs:
            read = stub.read_range(pdf("two-sections.pdf"), 1, 3, 400, Event())
        page_1, page_2, page_3 = read.pages
        self.assertEqual(page_2, RangePage(page_number=2, text="", items_text_layer=0, items_ocr=0, none_reason="PAGE_UNREADABLE"))
        self.assertIn("Note 3. Trade receivables", page_1.text)
        self.assertIsNone(page_3.none_reason)
        self.assertEqual(logs.output, ["WARNING:maester_indexer.reader:page 2 could not be read (inference_failure)"])

    def test_a_page_missing_from_a_successful_read_is_unreadable_not_blank(self):
        stub = StubReader(stub_result(read_pages=(1, 2)))
        with self.assertLogs("maester_indexer.reader", level="WARNING") as logs:
            read = stub.read_range(pdf("two-sections.pdf"), 1, 3, 400, Event())
        self.assertEqual((read.pages[2].text, read.pages[2].none_reason), ("", "PAGE_UNREADABLE"))
        self.assertEqual(logs.output, ["WARNING:maester_indexer.reader:page 3 could not be read (missing)"])

    def test_an_item_counts_only_on_pages_where_its_part_has_text(self):
        document = saved_document()
        (continued,) = [t for t in document.texts if len(t.prov) > 1]
        continued.prov[1].charspan = (len(continued.text), len(continued.text))  # nothing on page 2
        page_2 = StubReader(stub_result(document=document)).read_range(pdf("two-sections.pdf"), 1, 3, 400, Event()).pages[1]
        self.assertEqual(page_2.items_text_layer, 1)  # the running header only
        self.assertNotIn("which is worked out", page_2.text)

    def test_an_error_names_no_document_text(self):
        stub = StubReader(RuntimeError(f"Total {SECRET}"))
        with self.assertRaises(IndexingError) as raised:
            stub.read_range(pdf("two-sections.pdf"), 1, 3, 400, Event())
        error = raised.exception
        self.assertEqual((error.code, error.retryable), ("INDEX_FAILED", True))
        self.assertEqual(str(error), "INDEX_FAILED: Reading the range failed: RuntimeError.")
        self.assertNotIn(SECRET, error.message)
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)


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
