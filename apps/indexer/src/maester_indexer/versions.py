"""The versions an index revision and a cached page read are recorded under.

Read from the installed packages' metadata, so they cannot drift from uv.lock.
"""

from importlib.metadata import version
from typing import Protocol

DOCLING_VERSION: str = version("docling")
OCR_ENGINE: str = f"rapidocr-onnxruntime {version('rapidocr')}"
CHUNKER_VERSION = "1"


class ReaderSettings(Protocol):
    table_cell_matching: bool
    ocr_engine: str


def reader_options(settings: ReaderSettings) -> str:
    """The reader options that change what a page read returns, in a fixed order."""
    cell_matching = "true" if settings.table_cell_matching else "false"
    return f"table=accurate;cell_matching={cell_matching};ocr={settings.ocr_engine}"
