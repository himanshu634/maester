"""The indexer's configuration, read from the environment."""

import os
from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_EMBEDDING_MODEL = "Snowflake/snowflake-arctic-embed-l-v2.0"
# Claude OCR (spec 8.1) is paid, so it is not built.
OCR_ENGINES = ("rapidocr", "tesseract")


@dataclass(frozen=True)
class Settings:
    # Shared secret the worker sends in x-indexer-secret.
    secret: str | None = None
    max_bytes: int = 52428800
    threads: int = 6
    # Pages Docling reads in one batch, for memory.
    page_batch: int = 4
    table_cell_matching: bool = True
    tokenizer_path: str | None = None
    # Docling's layout, TableFormer and RapidOCR weights; nothing is fetched at run time.
    artifacts_path: str | None = None
    ocr_engine: str = "rapidocr"
    # The model whose tokenizer the chunker counts with (versions.tokenizer).
    embedding_model: str = DEFAULT_EMBEDDING_MODEL

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings":
        ocr_engine = env.get("OCR_ENGINE") or "rapidocr"
        if ocr_engine not in OCR_ENGINES:
            raise ValueError(f"OCR_ENGINE must be one of {', '.join(OCR_ENGINES)}")
        return cls(
            secret=env.get("INDEXER_SECRET") or None,
            max_bytes=_positive(env, "INDEX_MAX_BYTES", 52428800),
            threads=_positive(env, "INDEX_THREADS", 6),
            page_batch=_positive(env, "INDEX_PAGE_BATCH", 4),
            table_cell_matching=_switch(env, "INDEX_TABLE_CELL_MATCHING", True),
            tokenizer_path=env.get("INDEX_TOKENIZER_PATH") or None,
            artifacts_path=env.get("DOCLING_ARTIFACTS_PATH") or None,
            ocr_engine=ocr_engine,
            embedding_model=env.get("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL,
        )


def _positive(env: Mapping[str, str], name: str, default: int) -> int:
    value = int(env.get(name) or default)
    if value < 1:
        raise ValueError(f"{name} must be at least 1")
    return value


def _switch(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = (env.get(name) or str(default)).strip().lower()
    if value not in ("true", "false"):
        raise ValueError(f"{name} must be true or false")
    return value == "true"
