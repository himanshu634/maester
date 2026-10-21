"""Make the synthetic fixture PDFs the indexer's tests read.

Run from apps/indexer: `uv run python tests/fixtures/make_fixtures.py`. Every
figure and name here is made up; never put a real filing in the tests. The PDFs
are committed, and the output is byte-identical between runs, so regenerate
them only when this file changes.
"""

from io import BytesIO
from pathlib import Path

import pypdfium2
import reportlab
from PIL import Image
from reportlab import rl_config
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

rl_config.invariant = 1  # no creation date or random id, so a rerun gives the same bytes

# An embedded TrueType font with a ToUnicode map (Vera ships with reportlab), as a
# filing's fonts are, so the text layer reads the way a filing's does.
_FONTS = Path(reportlab.__file__).resolve().parent / "fonts"
pdfmetrics.registerFont(TTFont("Vera", str(_FONTS / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("VeraBd", str(_FONTS / "VeraBd.ttf")))
REGULAR, BOLD = "Vera", "VeraBd"

HERE = Path(__file__).resolve().parent
WIDTH, HEIGHT = A4
LEFT = 56
DPI = 200

RUNNING_HEADER = "Synthetic Cements Limited · Annual report 2025–26"

PROSE = [
    "Revenue from operations grew on higher cement volumes in the north and",
    "east, while fuel costs eased in the second half of the year. All figures",
    "below are in rupees lakh unless stated otherwise.",
]

TABLE = [
    ("Particulars", "Note", "2025–26", "2024–25"),
    ("Revenue from operations", "21", "1,23,456.78", "1,08,642.10"),
    ("Other income", "22", "2,345.60", "1,987.25"),
    ("Total income", "", "1,25,802.38", "1,10,629.35"),
    ("Cost of materials consumed", "23", "45,678.90", "41,234.56"),
    ("Profit for the year", "", "12,345.67", "10,987.65"),
]

MIXED_TEXT = [
    "The board met six times during the year. Each meeting had a quorum.",
]

MIXED_IMAGE_TEXT = [
    "The auditors were reappointed for a second term of five years",
    "at the last annual general meeting of the members.",
]

NOTES_PAGE_1 = [
    "Note 1. Property, plant and equipment are carried at cost less depreciation.",
    "Note 2. Inventories are valued at the lower of cost and net realisable value.",
    "Note 3. Trade receivables are shown net of the allowance for expected losses,",
]

NOTES_PAGE_2 = [
    "which is worked out from the ageing of the receivables at the year end.",
    "Note 4. Borrowings are carried at amortised cost using the effective rate.",
    "Note 5. Provisions are made when an outflow of resources is probable.",
]

BALANCE_SHEET = [
    ("Particulars", "Note", "31 March 2026", "31 March 2025"),
    ("Property, plant and equipment", "1", "56,789.01", "52,345.67"),
    ("Inventories", "2", "8,765.43", "7,654.32"),
    ("Trade receivables", "3", "6,543.21", "5,432.10"),
    ("Total assets", "", "72,097.65", "65,432.09"),
]


def _heading(canvas: Canvas, text: str, y: float) -> float:
    canvas.setFont(BOLD, 16)
    canvas.drawString(LEFT, y, text)
    return y - 28


def _lines(canvas: Canvas, lines: list[str], y: float, size: int = 11) -> float:
    canvas.setFont(REGULAR, size)
    for line in lines:
        assert canvas.stringWidth(line, REGULAR, size) < WIDTH - 2 * LEFT, "line runs off the page"
        canvas.drawString(LEFT, y, line)
        y -= size + 5
    return y - 10


def _table(canvas: Canvas, rows: list[tuple[str, str, str, str]], y: float) -> float:
    """A ruled four-column table, the figures right-aligned as a filing prints them."""
    columns = [LEFT, LEFT + 230, LEFT + 290, LEFT + 390, LEFT + 483]
    row_height = 20
    top = y + 14
    canvas.setLineWidth(0.6)
    for index, row in enumerate(rows):
        canvas.setFont(BOLD if index == 0 else REGULAR, 10)
        canvas.drawString(columns[0] + 4, y, row[0])
        canvas.drawRightString(columns[2] - 6, y, row[1])
        canvas.drawRightString(columns[3] - 6, y, row[2])
        canvas.drawRightString(columns[4] - 6, y, row[3])
        y -= row_height
    bottom = y + row_height - 6
    for line_y in [top] + [top - row_height * (i + 1) for i in range(len(rows))]:
        canvas.line(columns[0], line_y, columns[-1], line_y)
    for x in columns:
        canvas.line(x, top, x, bottom)
    return bottom - 24


def _pdf(draw_pages) -> bytes:
    out = BytesIO()
    canvas = Canvas(out, pagesize=A4, invariant=1)
    for draw in draw_pages:
        draw(canvas)
        canvas.showPage()
    canvas.save()
    return out.getvalue()


def _rasterize(pdf: bytes) -> list[Image.Image]:
    document = pypdfium2.PdfDocument(pdf)
    try:
        return [page.render(scale=DPI / 72).to_pil().convert("L") for page in document]
    finally:
        document.close()


def _image_reader(image: Image.Image) -> ImageReader:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return ImageReader(buffer)


def text_layer_page(canvas: Canvas) -> None:
    y = _heading(canvas, "Statement of profit and loss", HEIGHT - 72)
    y = _lines(canvas, PROSE, y)
    _table(canvas, TABLE, y)


def text_layer() -> bytes:
    return _pdf([text_layer_page])


def scanned() -> bytes:
    """The text-layer page rasterized at 200 dpi: an image and no text layer."""
    (image,) = _rasterize(text_layer())

    def page(canvas: Canvas) -> None:
        canvas.drawImage(_image_reader(image), 0, 0, WIDTH, HEIGHT)

    return _pdf([page])


def mixed() -> bytes:
    """A text-layer heading and paragraph, then an image of a printed paragraph."""
    box_width, box_height = 480, 90
    out = BytesIO()
    snippet = Canvas(out, pagesize=(box_width, box_height), invariant=1)
    snippet.setFont(REGULAR, 13)
    y = box_height - 30
    for line in MIXED_IMAGE_TEXT:
        snippet.drawString(8, y, line)
        y -= 22
    snippet.showPage()
    snippet.save()
    (image,) = _rasterize(out.getvalue())

    def page(canvas: Canvas) -> None:
        y = _heading(canvas, "Report of the board", HEIGHT - 72)
        y = _lines(canvas, MIXED_TEXT, y)
        canvas.drawImage(_image_reader(image), LEFT, y - box_height, box_width, box_height)

    return _pdf([page])


def two_sections() -> bytes:
    """Standalone on page 1, its notes running onto page 2, consolidated on page 3."""

    def header(canvas: Canvas) -> None:
        canvas.setFont(REGULAR, 9)
        canvas.drawString(LEFT, HEIGHT - 36, RUNNING_HEADER)

    def page_1(canvas: Canvas) -> None:
        header(canvas)
        y = _heading(canvas, "Standalone balance sheet", HEIGHT - 96)
        y = _table(canvas, BALANCE_SHEET, y)
        _lines(canvas, NOTES_PAGE_1, y)

    def page_2(canvas: Canvas) -> None:
        header(canvas)
        _lines(canvas, NOTES_PAGE_2, HEIGHT - 96)

    def page_3(canvas: Canvas) -> None:
        header(canvas)
        y = _heading(canvas, "Consolidated balance sheet", HEIGHT - 96)
        _table(canvas, BALANCE_SHEET, y)

    return _pdf([page_1, page_2, page_3])


FIXTURES = {
    "text-layer.pdf": text_layer,
    "scanned.pdf": scanned,
    "mixed.pdf": mixed,
    "two-sections.pdf": two_sections,
}


def main() -> None:
    for name, make in FIXTURES.items():
        (HERE / name).write_bytes(make())
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
