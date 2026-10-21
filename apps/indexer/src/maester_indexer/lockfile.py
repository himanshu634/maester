"""Where the models.lock.json shipped with the indexer is."""

import os
from pathlib import Path

LOCK_FILE = "models.lock.json"


def shipped_lock(explicit: str | None = None) -> Path | None:
    """`explicit`, else INDEXER_MODELS_LOCK, else the lock in the image (/app), else the one
    beside pyproject.toml (a checkout); None when there is none.

    The image is asked first: there the package is installed in the virtualenv, and the
    folder two above this file is not apps/indexer."""
    candidates = [explicit, os.environ.get("INDEXER_MODELS_LOCK"), "/app/" + LOCK_FILE,
                  str(Path(__file__).resolve().parents[2] / LOCK_FILE)]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None
