"""Local CLI cache; future hosted storage is specified in docs."""

import hashlib
from pathlib import Path

from pdf_financial_qa.config import CACHE_DIR
from pdf_financial_qa.schema import ExtractionResult


def hash_pdf(pdf_bytes: bytes) -> str:
    return hashlib.sha256(pdf_bytes).hexdigest()[:16]


def _cache_path(pdf_hash: str) -> Path:
    return Path(CACHE_DIR) / f"{pdf_hash}.json"


def load(pdf_hash: str) -> ExtractionResult | None:
    path = _cache_path(pdf_hash)
    if not path.exists():
        return None
    return ExtractionResult.model_validate_json(path.read_text())


def save(result: ExtractionResult) -> Path:
    path = _cache_path(result.source_pdf_hash)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(result.model_dump_json(indent=2))
    return path


def list_cached() -> list[ExtractionResult]:
    cache_dir = Path(CACHE_DIR)
    if not cache_dir.exists():
        return []
    results = []
    for path in sorted(cache_dir.glob("*.json")):
        results.append(ExtractionResult.model_validate_json(path.read_text()))
    return results
