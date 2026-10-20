"""The versions an index revision and a cached page read are recorded under.

Read from the installed packages' metadata and the shipped models.lock.json, so they cannot
drift from uv.lock or from the lock.
"""

import hashlib
import json
from importlib.metadata import version
from pathlib import Path
from typing import Any, Protocol

from maester_indexer.lockfile import LOCK_FILE, shipped_lock

# The packages whose code turns a PDF into the read a page_read row caches.
READER_PACKAGES = ("docling", "docling-core", "docling-ibm-models", "docling-parse")


def models_hash(lock: dict[str, Any]) -> str:
    """A short hash of the lock's docling section (the layout, TableFormer and RapidOCR
    artifacts), the same for any key order or spacing. The embedding section is left out:
    it does not change a read."""
    docling = lock.get("docling")
    if not isinstance(docling, dict) or not docling:
        raise RuntimeError(f"{LOCK_FILE} has no docling section")
    canonical = json.dumps(docling, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


def reader_version(lock_path: Path | None) -> str:
    """Each reader package's installed version and the hash of the lock's docling section,
    so a change to any one of them alone keys new page reads."""
    if lock_path is None:
        raise RuntimeError(f"{LOCK_FILE} not found; set INDEXER_MODELS_LOCK")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    packages = ";".join(f"{name}={version(name)}" for name in READER_PACKAGES)
    return f"{packages};models={models_hash(lock)}"


DOCLING_VERSION: str = reader_version(shipped_lock())
OCR_ENGINE: str = f"rapidocr-onnxruntime {version('rapidocr')}"
CHUNKER_VERSION = "1"


class ReaderSettings(Protocol):
    table_cell_matching: bool
    ocr_engine: str


def reader_options(settings: ReaderSettings) -> str:
    """The reader options that change what a page read returns, in a fixed order."""
    cell_matching = "true" if settings.table_cell_matching else "false"
    return f"table=accurate;cell_matching={cell_matching};ocr={settings.ocr_engine}"
