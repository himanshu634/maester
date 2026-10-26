"""Where an item's text came from: the PDF's text layer, OCR, or both.

Docling marks each text cell it read by OCR (`TextCell.from_ocr`). An item's source is
decided by the cells whose centre lies inside its provenance box.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from docling_core.types.doc import BoundingBox, CoordOrigin

from maester_indexer.contracts import TextSource


@dataclass(frozen=True)
class Cell:
    box: BoundingBox  # page coordinates, top-left origin
    from_ocr: bool


def cells_inside(cells: Iterable[Cell], box: BoundingBox) -> list[Cell]:
    """The cells whose centre lies inside the box (edges included). Both must have a top-left origin."""
    _require_top_left(box)
    inside = []
    for cell in cells:
        _require_top_left(cell.box)
        x = (cell.box.l + cell.box.r) / 2
        y = (cell.box.t + cell.box.b) / 2
        if box.l <= x <= box.r and box.t <= y <= box.b:
            inside.append(cell)
    return inside


def source_of(cells: Iterable[Cell]) -> TextSource | None:
    """All OCR is `ocr`, none is `text_layer`, both is `mixed`; no cell is None (no text)."""
    flags = {cell.from_ocr for cell in cells}
    if not flags:
        return None
    if flags == {True}:
        return "ocr"
    if flags == {False}:
        return "text_layer"
    return "mixed"


def item_source(cells: Sequence[Cell], bbox: BoundingBox | Sequence[BoundingBox]) -> TextSource | None:
    """The source of an item on one page from that page's cells. An item with several boxes
    takes the union of the cells inside each. Boxes and cells have a top-left origin."""
    boxes = [bbox] if isinstance(bbox, BoundingBox) else bbox
    return source_of(cell for box in boxes for cell in cells_inside(cells, box))


def _require_top_left(box: BoundingBox) -> None:
    if box.coord_origin != CoordOrigin.TOPLEFT:
        raise ValueError("boxes must have a top-left origin")
