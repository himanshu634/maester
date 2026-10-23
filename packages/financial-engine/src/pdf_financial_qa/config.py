"""Configuration for the existing local document workflow."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

# The Messages API takes a request of up to 32 MB, and base64 makes a PDF a third
# larger. Keep a conservative local ceiling and fail loudly rather than silently
# truncating a document.
MAX_INLINE_PDF_BYTES = 15 * 1024 * 1024  # 15 MB

CACHE_DIR = "data/cache"


@dataclass(frozen=True)
class Settings:
    model: str
    effort: str

    @classmethod
    def load(cls) -> "Settings":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Copy .env.example to .env "
                "and fill in your Anthropic API key."
            )
        return cls(model=os.environ.get("EXTRACTOR_MODEL") or "claude-opus-5-5",
                   effort=os.environ.get("EXTRACTOR_EFFORT") or "high")
