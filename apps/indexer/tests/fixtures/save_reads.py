"""Save the reader's output on each fixture PDF, for the tests that run with no models.

Run from apps/indexer:
`HF_HUB_OFFLINE=1 DOCLING_ARTIFACTS_PATH=$HOME/.cache/maester/docling uv run python tests/fixtures/save_reads.py`.
Each `<name>.read.json` is `RangeRead.to_wire()` for all of the PDF's pages, with OCR on.
The files are committed; regenerate them only when the Docling pin or the reader changes.

The layout model's boxes vary in about the fifth decimal place from run to run, so every
float is rounded to three places here; then a rerun writes the same bytes.
"""

import json
import os
import sys
from pathlib import Path
from threading import Event

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # apps/indexer, for `tests`

from maester_indexer.reader import Reader  # noqa: E402
from maester_indexer.settings import Settings  # noqa: E402
from tests.helpers import quiet_docling  # noqa: E402

HERE = Path(__file__).resolve().parent
NAMES = ("text-layer", "scanned", "mixed", "two-sections")
PLACES = 3


def rounded(value):
    if isinstance(value, float):
        return round(value, PLACES)
    if isinstance(value, dict):
        return {key: rounded(item) for key, item in value.items()}
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def main() -> None:
    quiet_docling()
    reader = Reader(Settings.from_env(os.environ))
    for name in NAMES:
        pdf = (HERE / f"{name}.pdf").read_bytes()
        read = reader.read_range(pdf, 1, reader.page_count(pdf), ocr_pages_left=400, cancel=Event())
        text = json.dumps(rounded(read.to_wire()), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        (HERE / f"{name}.read.json").write_text(text, encoding="utf-8")
        print(f"wrote {name}.read.json")


if __name__ == "__main__":
    main()
