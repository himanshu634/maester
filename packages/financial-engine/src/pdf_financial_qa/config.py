"""Configuration for the existing local document workflow."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

# Inline PDF bytes have a server-side size limit on Vertex AI (not published as
# a client-side constant by the SDK). Keep a conservative local ceiling and
# fail loudly rather than silently truncating a document.
MAX_INLINE_PDF_BYTES = 15 * 1024 * 1024  # 15 MB

CACHE_DIR = "data/cache"


@dataclass(frozen=True)
class Settings:
    project: str
    location: str
    model: str

    @classmethod
    def load(cls) -> "Settings":
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
        if not project:
            raise RuntimeError(
                "GOOGLE_CLOUD_PROJECT is not set. Copy .env.example to .env "
                "and fill in your GCP project ID."
            )
        return cls(project=project, location=location, model=model)
