"""Reading one page range of a PDF with Docling and RapidOCR.

The converters are built once per process. OCR is on or off for a whole range (the
worker's OCR budget), so there is one converter for each; each loads its own models
the first time it reads.
"""

import threading
from io import BytesIO

import pypdfium2
from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import ConversionStatus, DocumentStream, InputFormat
from docling.datamodel.document import ConversionResult
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    RapidOcrOptions,
    TableFormerMode,
    TableStructureOptions,
)
from docling.datamodel.settings import settings as docling_settings
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.utils.locks import pypdfium2_lock
from docling_core.types.doc import ContentLayer, TableItem, TextItem

from maester_indexer.contracts import IndexerVersions, PageNoneReason, RangePage, RangeRead, TextSource
from maester_indexer.errors import IndexingError
from maester_indexer.settings import Settings
from maester_indexer.sources import Cell, cells_inside, source_of
from maester_indexer.versions import CHUNKER_VERSION, DOCLING_VERSION, OCR_ENGINE, reader_options

# The layers whose items make a page's text: the body and the furniture (running headers
# and footers, which the chunker leaves out but the page text keeps).
PAGE_TEXT_LAYERS = {ContentLayer.BODY, ContentLayer.FURNITURE}
# Docling reads the bytes under this name, so the read does not depend on the upload's name.
STREAM_NAME = "document.pdf"


class ReadCancelled(Exception):
    """The caller set `cancel` (the worker went away); nothing was returned."""


def _unreadable() -> IndexingError:
    return IndexingError("UNREADABLE_PDF", "The PDF could not be opened: it is encrypted, damaged or empty.", False)


class Reader:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        # The legacy pipelines read the batch size from Docling's settings object; the
        # threaded StandardPdfPipeline that reads PDFs takes it per stage (_options).
        docling_settings.perf.page_batch_size = settings.page_batch
        self._converters = {ocr_on: self._converter(ocr_on) for ocr_on in (True, False)}
        self._lock = threading.Lock()  # one read at a time
        self.versions = IndexerVersions(
            docling_version=DOCLING_VERSION,
            ocr_engine=OCR_ENGINE,
            reader_options=reader_options(settings),
            chunker_version=CHUNKER_VERSION,
            tokenizer=settings.embedding_model,
        )

    def _converter(self, ocr_on: bool) -> DocumentConverter:
        settings = self._settings
        options = PdfPipelineOptions(
            do_ocr=ocr_on,
            ocr_options=RapidOcrOptions(backend="onnxruntime"),
            do_table_structure=True,
            table_structure_options=TableStructureOptions(
                mode=TableFormerMode.ACCURATE, do_cell_matching=settings.table_cell_matching
            ),
            artifacts_path=settings.artifacts_path,
            document_timeout=None,  # the worker sends one range at a time instead
            accelerator_options=AcceleratorOptions(device=AcceleratorDevice.CPU, num_threads=settings.threads),
            generate_parsed_pages=True,  # keeps each page's text cells, which carry from_ocr
            ocr_batch_size=settings.page_batch,
            layout_batch_size=settings.page_batch,
            table_batch_size=settings.page_batch,
        )
        return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})

    def page_count(self, pdf: bytes) -> int:
        if not pdf:
            raise _unreadable()
        try:
            with pypdfium2_lock:
                document = pypdfium2.PdfDocument(pdf)
                try:
                    count = len(document)
                finally:
                    document.close()
        except pypdfium2.PdfiumError:
            raise _unreadable() from None
        if count < 1:
            raise _unreadable()
        return count

    def read_range(self, pdf: bytes, first: int, last: int, ocr_pages_left: int, cancel: threading.Event) -> RangeRead:
        """Read pages first..last (clamped to the page count), with OCR while budget is left.

        Docling's threaded pipeline has no hook between page batches, so `cancel` is
        checked before the conversion starts and again before the read is returned."""
        page_count = self.page_count(pdf)
        if first < 1 or last < first or first > page_count:
            raise IndexingError("INDEX_FAILED", "The page range does not start on a page of the file.", False)
        last = min(last, page_count)
        ocr_on = ocr_pages_left > 0
        if cancel.is_set():
            raise ReadCancelled()
        result = self._convert(pdf, first, last, ocr_on)
        if cancel.is_set():
            raise ReadCancelled()
        try:
            return self._range_read(result, first, last, page_count, ocr_on)
        except Exception as error:
            raise IndexingError("INDEX_FAILED", f"Reading the range failed: {type(error).__name__}.", True) from None

    def _convert(self, pdf: bytes, first: int, last: int, ocr_on: bool) -> ConversionResult:
        stream = DocumentStream(name=STREAM_NAME, stream=BytesIO(pdf))
        try:
            with self._lock:
                result = self._converters[ocr_on].convert(stream, raises_on_error=False, page_range=(first, last))
        except StopIteration:  # Docling did not take the bytes for a PDF
            raise _unreadable() from None
        except Exception as error:
            raise IndexingError("INDEX_FAILED", f"Reading the range failed: {type(error).__name__}.", True) from None
        if not result.input.valid:
            raise _unreadable()
        if result.status != ConversionStatus.SUCCESS:
            # Includes PARTIAL_SUCCESS: a page Docling could not read is not a page with no text.
            raise IndexingError("INDEX_FAILED", f"Docling ended the read with status {result.status.value}.", True)
        return result

    def _range_read(self, result: ConversionResult, first: int, last: int, page_count: int, ocr_on: bool) -> RangeRead:
        document = result.document
        heights = {page_no: page.size.height for page_no, page in document.pages.items()}
        cells = {
            page.page_no: [
                Cell(box=cell.rect.to_bounding_box().to_top_left_origin(heights[page.page_no]), from_ocr=cell.from_ocr)
                for cell in page.cells
            ]
            for page in result.pages
        }
        # A page Docling found something on (a layout region or an image) needed reading,
        # by OCR if its text layer gave nothing; a page with neither is blank.
        has_content = {
            page.page_no: bool(page.predictions.layout and page.predictions.layout.clusters)
            or bool(page.parsed_page and page.parsed_page.bitmap_resources)
            for page in result.pages
        }

        item_sources: dict[str, TextSource] = {}
        texts: dict[int, list[str]] = {n: [] for n in range(first, last + 1)}
        counts: dict[int, dict[str, int]] = {n: {"text_layer": 0, "ocr": 0} for n in range(first, last + 1)}
        for item, _ in document.iterate_items(included_content_layers=PAGE_TEXT_LAYERS):
            if not isinstance(item, (TextItem, TableItem)) or not item.prov:
                continue
            source = source_of(
                cell
                for prov in item.prov
                for cell in cells_inside(cells.get(prov.page_no, []), prov.bbox.to_top_left_origin(heights[prov.page_no]))
            )
            if source is None:  # no cell under it: the item has no text
                continue
            item_sources[item.self_ref] = source
            page_nos = sorted({prov.page_no for prov in item.prov if prov.page_no in texts})
            for page_no in page_nos:
                if source in ("text_layer", "mixed"):
                    counts[page_no]["text_layer"] += 1
                if source in ("ocr", "mixed"):
                    counts[page_no]["ocr"] += 1
            for page_no, text in _page_parts(item, page_nos):
                if text:
                    texts[page_no].append(text)

        pages = []
        for page_no in range(first, last + 1):
            text = "\n".join(texts[page_no])
            pages.append(
                RangePage(
                    page_number=page_no,
                    text=text,
                    items_text_layer=counts[page_no]["text_layer"],
                    items_ocr=counts[page_no]["ocr"],
                    none_reason=_none_reason(text, has_content.get(page_no, False), ocr_on),
                )
            )
        return RangeRead(
            first_page=first,
            last_page=last,
            page_count=page_count,
            ocr_on=ocr_on,
            versions=self.versions,
            document=document.export_to_dict(),
            item_sources=item_sources,
            pages=pages,
        )


def _page_parts(item: TextItem | TableItem, page_nos: list[int]) -> list[tuple[int, str]]:
    """An item's text on each of its pages. A text item over a page break gives each page
    its own `prov.charspan` part, so no page repeats another's text; a table, which has no
    charspan, goes whole on its first page."""
    if not page_nos:
        return []
    if isinstance(item, TableItem):
        return [(page_nos[0], _table_text(item))]
    if len(page_nos) == 1:
        return [(page_nos[0], item.text.strip())]
    parts = []
    for page_no in page_nos:
        slices = [item.text[prov.charspan[0] : prov.charspan[1]].strip() for prov in item.prov if prov.page_no == page_no]
        parts.append((page_no, " ".join(slices)))
    return parts


def _table_text(table: TableItem) -> str:
    """A table as printed, one row a line, cells in column order separated by a space."""
    rows: dict[int, list[str]] = {}
    for cell in sorted(table.data.table_cells, key=lambda c: (c.start_row_offset_idx, c.start_col_offset_idx)):
        if cell.text.strip():
            rows.setdefault(cell.start_row_offset_idx, []).append(cell.text.strip())
    return "\n".join(" ".join(row) for _, row in sorted(rows.items()))


def _none_reason(text: str, has_content: bool, ocr_on: bool) -> PageNoneReason | None:
    if text:
        return None
    if not has_content:
        return "NO_TEXT"
    return "OCR_FAILED" if ocr_on else "OCR_BUDGET"
