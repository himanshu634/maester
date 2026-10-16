"""Export: an artefact becomes a CSV sheet a person corrects against the PDF.

The sheet carries what the pipeline read, one row per fact, with blank columns for the
person's concept, corrections and verdict. `material` is only a hint for where to start:
every kept row is checked by a person, and phase 1's mapping replaces the hint."""

import csv
import io
from pathlib import Path
import re

from maester_eval.artefacts import Artefact, read_artefacts
from maester_eval.files import write_text_atomically
from maester_eval.text import normalise

SHEET_COLUMNS = [
    "row", "statement", "basis", "section", "label", "period_label", "period_end",
    "printed", "value", "unit_label", "scale_factor", "normalized_value", "page", "printed_pages",
    "text_layer_match", "is_subtotal", "material",
    "concept", "gold_text", "gold_scale", "gold_page", "gold_period_end", "adds_up", "verified", "note",
]

# Labelling aid only: rows worth checking first. Not a mapping; see the module docstring.
MATERIAL_HINT = re.compile(
    r"\btotal\b|\brevenue\b|revenue from operations|\bprofit\b|\bloss\b|earnings? per"
    r"|\bcash\b|cash and cash equivalents|\bborrowings?\b|net cash|finance costs?|\bdividend"
)


def _yes(value: bool | None) -> str:
    return "" if value is None else ("yes" if value else "no")


def _printed_pages(page: int, printed_pages_per_page: int) -> str:
    """The printed page numbers to look for on PDF page `page`, counted from 1.

    When each PDF page is a spread of two printed pages, PDF page N holds printed pages 2N-1 and 2N.
    They are joined by an en dash, because a spreadsheet may read `3-4` with a hyphen as a date.
    Otherwise the printed page is the PDF page."""
    if printed_pages_per_page == 2:
        return f"{2 * page - 1}\u2013{2 * page}"
    return str(page)


def sheet_rows(artefact: Artefact) -> list[dict[str, str]]:
    blank = {column: "" for column in SHEET_COLUMNS}
    if artefact.result is None:
        code = artefact.error.code if artefact.error else "unknown"
        return [dict(blank, note=f"extraction failed: {code}")]
    rows = []
    for index, fact in enumerate(artefact.result["facts"], start=1):
        page = fact["pageIndex"] + 1
        rows.append(dict(
            blank,
            row=str(index), statement=fact["statement"], basis=fact["basis"], section=fact["section"],
            label=fact["reportedLabel"], period_label=fact["periodLabel"],
            # The fact's one date: a balance sheet fact is "as at" and keeps it in asOfDate, a period fact in periodEnd.
            period_end=fact["periodEnd"] or fact["asOfDate"] or "",
            printed=fact["reportedText"], value=fact["reportedValue"] or "", unit_label=fact["unitLabel"] or "",
            scale_factor=fact["scaleFactor"] or "", normalized_value=fact["normalizedValue"] or "",
            page=str(page), printed_pages=_printed_pages(page, artefact.printed_pages_per_page),
            text_layer_match=_yes(fact["textLayerMatch"]), is_subtotal=_yes(fact["isSubtotal"]),
            material="yes" if MATERIAL_HINT.search(normalise(fact["reportedLabel"])) else "",
        ))
    return rows


def sheet_path(sheets_dir: Path, filing_id: str) -> Path:
    return sheets_dir / f"{filing_id}.csv"


def write_sheet(path: Path, rows: list[dict[str, str]]) -> None:
    text = io.StringIO(newline="")
    writer = csv.DictWriter(text, fieldnames=SHEET_COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    # A BOM so spreadsheet applications read the UTF-8 (₹ in unit notes) correctly.
    write_text_atomically(path, text.getvalue(), encoding="utf-8-sig")


def export_run(run_dir: Path, sheets_dir: Path, only: list[str] | None = None, force: bool = False,
               *, artefacts: list[Artefact] | None = None) -> tuple[list[Path], list[Path]]:
    """Writes a sheet per artefact. A sheet that exists is a person's work: skipped unless `force`.

    The artefacts are read from `run_dir`, unless the caller has read them already and passes them as `artefacts`."""
    written: list[Path] = []
    skipped: list[Path] = []
    for artefact in read_artefacts(run_dir) if artefacts is None else artefacts:
        if only and artefact.filing_id not in only:
            continue
        path = sheet_path(sheets_dir, artefact.filing_id)
        if path.exists() and not force:
            skipped.append(path)
            continue
        write_sheet(path, sheet_rows(artefact))
        written.append(path)
    return written, skipped
