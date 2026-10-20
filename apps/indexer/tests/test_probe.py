"""Facts about the pinned Docling that the indexer relies on.

Skipped unless MAESTER_DOCLING_MODELS names a folder holding Docling's
artifacts (`docling-tools models download layout tableformer rapidocr -o
"$MAESTER_DOCLING_MODELS"`). When the Docling pin changes, these tests say
which of our assumptions still hold.
"""

import os
import unittest
from functools import lru_cache
from pathlib import Path

from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.document import ConversionResult
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    RapidOcrOptions,
    TableFormerMode,
    TableStructureOptions,
)
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
from docling_core.types.doc import ContentLayer
from docling_core.types.doc.page import TextCell

from tests.helpers import quiet_docling, whitespace_tokenizer

FIXTURES = Path(__file__).resolve().parent / "fixtures"
MODELS = os.environ.get("MAESTER_DOCLING_MODELS", "")


@lru_cache(maxsize=1)
def _converter() -> DocumentConverter:
    options = PdfPipelineOptions(
        do_ocr=True,
        ocr_options=RapidOcrOptions(backend="onnxruntime"),
        do_table_structure=True,
        table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE),
        artifacts_path=MODELS,
        document_timeout=None,
        accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU),
        generate_parsed_pages=True,  # keeps each page's text cells on the result
    )
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})


@lru_cache(maxsize=None)
def convert(path: Path, page_range: tuple[int, int] | None = None) -> ConversionResult:
    if page_range is None:
        return _converter().convert(path)
    return _converter().convert(path, page_range=page_range)


def cells_of(res: ConversionResult, page_no: int) -> list[TextCell]:
    """The text cells Docling kept for a page; `Page.page_no` counts from 1, as `prov.page_no` does."""
    return [cell for page in res.pages if page.page_no == page_no for cell in page.cells]


@unittest.skipUnless(MODELS and Path(MODELS).is_dir(), "MAESTER_DOCLING_MODELS does not name a folder of Docling artifacts")
class DoclingProbe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        quiet_docling()

    def test_page_range_reads_only_those_pages(self):
        doc = convert(FIXTURES / "two-sections.pdf", page_range=(2, 3)).document
        self.assertEqual({p.page_no for item, _ in doc.iterate_items() for p in item.prov}, {2, 3})

    def test_ocr_cells_are_marked_and_land_on_the_scanned_page(self):
        res = convert(FIXTURES / "scanned.pdf")
        self.assertTrue(any(c.from_ocr for c in cells_of(res, page_no=1)))

    def test_text_layer_cells_are_not_marked_ocr(self):
        cells = cells_of(convert(FIXTURES / "text-layer.pdf"), page_no=1)
        self.assertTrue(cells, "no cells kept for the page, so the flag below proves nothing")
        self.assertFalse(any(c.from_ocr for c in cells))

    def test_mixed_page_has_both(self):
        flags = {c.from_ocr for c in cells_of(convert(FIXTURES / "mixed.pdf"), page_no=1)}
        self.assertEqual(flags, {True, False})

    def test_running_header_is_furniture(self):
        doc = convert(FIXTURES / "two-sections.pdf").document
        labels = {i.label.value for i, _ in doc.iterate_items(included_content_layers={ContentLayer.FURNITURE})}
        self.assertIn("page_header", labels)

    def test_the_text_layer_reader_writes_an_en_dash_as_a_hyphen(self):
        # docling-parse reads the en dash of "2025–26" as "-" at the character level, with or
        # without its do_sanitization switch; pypdfium2 reads it as printed. The middle dot is kept.
        doc = convert(FIXTURES / "two-sections.pdf").document
        headers = {i.text for i, _ in doc.iterate_items(included_content_layers={ContentLayer.FURNITURE})}
        self.assertEqual(headers, {"Synthetic Cements Limited · Annual report 2025-26"})

    def test_hybrid_chunker_takes_the_options_we_use(self):
        chunker = HybridChunker(tokenizer=whitespace_tokenizer(448), merge_peers=True, repeat_table_header=True)
        self.assertEqual((chunker.merge_peers, chunker.repeat_table_header), (True, True))
        self.assertEqual(chunker.tokenizer.get_max_tokens(), 448)

    def test_a_page_can_be_filtered_out_of_a_document(self):
        # filter keeps every item with a box on the page, and keeps all of that item's
        # boxes: a paragraph continued from page 1 comes with its page 1 box too.
        doc = convert(FIXTURES / "two-sections.pdf").document
        kept = list(doc.filter(page_nrs={2}).iterate_items(included_content_layers=set(ContentLayer)))
        self.assertTrue(kept)
        self.assertTrue(all(2 in {p.page_no for p in item.prov} for item, _ in kept))
        self.assertEqual({p.page_no for item, _ in kept for p in item.prov}, {1, 2})

    def test_a_paragraph_continued_over_a_page_break_is_one_item_cut_by_charspan(self):
        # The notes run from page 1 onto page 2 with no heading: Docling joins them into
        # one item with a box per page, and each box's charspan is that page's part.
        doc = convert(FIXTURES / "two-sections.pdf").document
        continued = [item for item, _ in doc.iterate_items() if len({p.page_no for p in item.prov}) > 1]
        self.assertEqual(len(continued), 1)
        (item,) = continued
        self.assertEqual([p.page_no for p in item.prov], [1, 2])
        (start_1, end_1), (start_2, end_2) = (p.charspan for p in item.prov)
        self.assertEqual((start_1, end_2), (0, len(item.text)))
        self.assertLess(end_1, start_2)
        self.assertTrue(item.text[start_1:end_1].startswith("Note 3."))
        self.assertTrue(item.text[start_2:end_2].startswith("which is worked out"))


if __name__ == "__main__":
    unittest.main()
