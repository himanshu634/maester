"""The versions an index revision and a cached page read are recorded under.

Read from the installed packages' metadata and the shipped models.lock.json, so they cannot
drift from uv.lock or from the lock.
"""

import hashlib
import json
import re
import subprocess
from collections.abc import Callable
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
CHUNKER_VERSION = "1"


def _run(args: list[str]) -> str:
    """The command's stdout, or its stderr when stdout is empty: Docling reads Tesseract's
    `--version` the same way, because a Linux build may print it to stderr."""
    done = subprocess.run(args, capture_output=True, text=True, stdin=subprocess.DEVNULL, check=False)
    return done.stdout or done.stderr


def ocr_engine_version(engine: str, run: Callable[[list[str]], str] = _run) -> str:
    """The OCR engine's name and version, which a page read is keyed by. RapidOCR's string must
    not change: the stored page reads are keyed by it. Tesseract's names the binary and the
    sha256 of its English language data, so a change to either keys new reads."""
    if engine == "rapidocr":
        return f"rapidocr-onnxruntime {version('rapidocr')}"
    if engine == "tesseract":
        return _tesseract_version(run)
    raise ValueError(f"No version is recorded for the OCR engine {engine!r}")


def _tesseract_version(run: Callable[[list[str]], str]) -> str:
    try:
        first_line = run(["tesseract", "--version"]).strip().split("\n", 1)[0]
        languages = run(["tesseract", "--list-langs"])
    except FileNotFoundError:
        raise RuntimeError("tesseract is not installed") from None
    release = re.search(r"\d+\.\d+\.\d+", first_line)
    if release is None:
        raise RuntimeError("tesseract did not report a version")
    # The header names the folder the language data is read from: List of available languages in "<dir>/" (n):
    folder = re.search(r'List of available languages in "([^"]+)"', languages)
    if folder is None:
        raise RuntimeError("tesseract did not name its language data folder")
    try:
        data = (Path(folder.group(1)) / "eng.traineddata").read_bytes()
    except OSError:
        raise RuntimeError("tesseract has no English language data (eng.traineddata)") from None
    return f"tesseract-cli {release.group()} eng:{hashlib.sha256(data).hexdigest()[:12]}"


class ReaderSettings(Protocol):
    table_cell_matching: bool
    ocr_engine: str


def reader_options(settings: ReaderSettings) -> str:
    """The reader options that change what a page read returns, in a fixed order."""
    cell_matching = "true" if settings.table_cell_matching else "false"
    return f"table=accurate;cell_matching={cell_matching};ocr={settings.ocr_engine}"
