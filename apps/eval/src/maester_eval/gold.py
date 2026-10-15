"""The gold set: facts a person checked against the PDF, keyed by concept.

Freeze reads a sheet (the columns `sheets.py` writes) and keeps the rows marked verified. Every figure
is text parsed by the engine's own `parse_reported`, never a number a spreadsheet made.

A spreadsheet may retype what the pipeline wrote: `2026-03-31` as `31/03/2026`, `10000000` as `1E+07`.
Given the artefact the sheet was exported from, freeze reads those columns from it again.

The messages of a `FreezeError` reach the console. They name a sheet row and a column and never the
text of the filing.
"""

import csv
from datetime import date, datetime
from decimal import Decimal
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from maester_eval.artefacts import Artefact
from maester_eval.concepts import Concept, Taxonomy
from maester_eval.manifest import EvalSet, Filing, FilingKind
from maester_eval.sheets import sheet_rows
from maester_eval.text import normalise
from pdf_financial_qa.workflow.values import format_decimal, parse_reported

StatementKind = Literal["balance_sheet", "income_statement", "cash_flow"]
ReportingBasis = Literal["consolidated", "standalone", "unknown"]

_DIGITS = re.compile(r"[0-9]+")
# A whole number as written or with the ".0" a spreadsheet adds ("7", "7.0"); not "7.5", "1E+3" or "NaN".
_DIGITS_OR_FLOAT = re.compile(r"-?[0-9]+(?:\.0+)?")
_ISO_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# The columns the pipeline wrote that freeze reads again from the artefact.
_MACHINE_COLUMNS = ("statement", "basis", "section", "label", "period_label", "period_end", "printed", "scale_factor", "page")


class FreezeError(ValueError):
    pass


class GoldFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept: str
    statement: StatementKind
    basis: ReportingBasis
    section: str
    label: str
    period_label: str
    # Where the fact sits in time: the period end of a duration line, the as-at date of a balance sheet line.
    period_end: str | None
    span: str | None = None
    printed: str
    value_status: Literal["value", "dash"]
    value: str | None
    scale: str | None
    normalized_value: str | None
    page_index: int
    dimensions: dict[str, str] = Field(default_factory=dict)


class ExpectedCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept: str
    basis: ReportingBasis
    period_label: str
    adds_up: bool


class GoldFiling(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing_id: str
    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet
    stratum: str | None
    printed_pages_per_page: int
    taxonomy_version: int
    frozen_at: str
    exported_from: dict | None
    facts: list[GoldFact]
    expected_checks: list[ExpectedCheck]


def read_sheet(path: Path) -> list[dict[str, str]]:
    """The sheet's rows, each cell as stripped text.

    utf-8-sig: a BOM a spreadsheet application wrote is not part of the first column's name."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            return [{k: (v or "").strip() for k, v in r.items() if k is not None} for r in csv.DictReader(handle)]
    except UnicodeDecodeError:
        raise FreezeError(f"{path.name} is not UTF-8 text; save it as CSV UTF-8") from None


def _whole(text: str, what: str, line: int) -> int:
    if not _DIGITS_OR_FLOAT.fullmatch(text):
        raise FreezeError(f"sheet row {line}: {what} {text!r} is not a whole number")
    return int(text.partition(".")[0])


def _is_iso_date(text: str) -> bool:
    if not _ISO_DATE.fullmatch(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _unreadable(line: int, column: str, text: str, what: str, artefact: Artefact | None) -> FreezeError:
    """The error for a cell that is not what it should be, most likely because a spreadsheet retyped it.

    `--run` can give back only a column the pipeline wrote, and only when no artefact was passed."""
    can_read_again = column in _MACHINE_COLUMNS and artefact is None
    remedy = "pass --run to read it from the artefact" if can_read_again else "keep the column as text"
    return FreezeError(f"sheet row {line}: {column} {text!r} is not {what} (a spreadsheet may have retyped it; {remedy})")


def _as_exported(row: dict[str, str], line: int, exported: dict[str, dict[str, str]] | None) -> dict[str, str]:
    """The row with the columns the pipeline wrote taken back from the artefact's fact, as the export wrote them.

    That needs the artefact and a `row` number. A row with no number was added by hand and stands as it is."""
    if exported is None or not row.get("row"):
        return row
    number = _whole(row["row"], "row", line)
    original = exported.get(str(number))
    if original is None or normalise(row.get("label", "")) != normalise(original["label"]):
        raise FreezeError(f"sheet row {line}: row {number} no longer matches the artefact; re-export or fix `row`")
    return {**row, **{column: original[column] for column in _MACHINE_COLUMNS}}


def _scale(row: dict[str, str], concept: Concept, line: int, artefact: Artefact | None) -> str:
    """The multiplier of a figure: `gold_scale`, else `scale_factor`. A per-share or count line is in units already."""
    if concept.kind in ("per_share", "count"):
        return "1"
    column = "gold_scale" if row.get("gold_scale") else "scale_factor"
    text = row.get(column, "")
    if not text:
        raise FreezeError(f"sheet row {line}: no scale (fill gold_scale: 10000000 for crore, 100000 for lakh, 1 for actuals)")
    if not _DIGITS.fullmatch(text):
        raise _unreadable(line, column, text, "a whole number", artefact)
    return text


def _period_end(row: dict[str, str], line: int, artefact: Artefact | None) -> str | None:
    column = "gold_period_end" if row.get("gold_period_end") else "period_end"
    text = row.get(column, "")
    if text and not _is_iso_date(text):
        raise _unreadable(line, column, text, "a date written YYYY-MM-DD", artefact)
    return text or None


def freeze_sheet(rows: list[dict[str, str]], filing: Filing, taxonomy: Taxonomy, frozen_at: datetime,
                 exported_from: dict | None = None, artefact: Artefact | None = None) -> GoldFiling:
    """Keep the rows marked verified, each as a gold fact. A bad row is a `FreezeError` naming its sheet row.

    With the `artefact` the sheet was exported from, a row that has a `row` number takes the columns the
    pipeline wrote from that artefact's fact, whatever a spreadsheet made of them; the sheet supplies the
    concept, the `gold_*` columns, `adds_up` and `verified`. Without it, and for a row added by hand,
    every column is the sheet's own."""
    exported = None if artefact is None else {r["row"]: r for r in sheet_rows(artefact) if r["row"]}
    facts: list[GoldFact] = []
    checks: list[ExpectedCheck] = []
    seen: dict[tuple, int] = {}
    for offset, sheet_row in enumerate(rows):
        line = offset + 2  # the sheet's header is line 1
        if sheet_row.get("verified", "").lower() != "yes":
            continue
        row = _as_exported(sheet_row, line, exported)
        concept = taxonomy.get(row.get("concept", ""))
        if concept is None:
            raise FreezeError(f"sheet row {line}: unknown concept {row.get('concept', '')!r}")
        for field in ("statement", "basis", "label", "period label"):
            if not row.get(field.replace(" ", "_"), ""):
                raise FreezeError(f"sheet row {line}: no {field}")
        figure_column = "gold_text" if row.get("gold_text") else "printed"
        printed = row.get(figure_column, "")
        if not printed:
            raise FreezeError(f"sheet row {line}: no figure (printed or gold_text)")
        status, value = parse_reported(printed)
        if status == "unparsed":
            raise FreezeError(f"sheet row {line}: cannot read {figure_column} as a figure")
        if value is None:  # a dash: kept as a dash, with nothing to scale
            scale = value_text = normalized = None
        else:
            scale = _scale(row, concept, line, artefact)
            value_text, normalized = format_decimal(value), format_decimal(value * Decimal(scale))
        page_text = row.get("gold_page") or row.get("page") or ""
        page = _whole(page_text, "page", line) if page_text else 0
        if page < 1:
            raise FreezeError(f"sheet row {line}: page {page_text!r} must be 1 or more (gold_page)")
        period_end = _period_end(row, line, artefact)
        try:
            fact = GoldFact(
                concept=concept.id, statement=row["statement"], basis=row["basis"], section=row.get("section", ""),
                label=row["label"], period_label=row["period_label"], period_end=period_end,
                printed=printed, value_status=status, value=value_text, scale=scale, normalized_value=normalized,
                page_index=page - 1,
            )
        except ValidationError as exc:  # a statement or basis outside the vocabulary
            problem = exc.errors()[0]
            column = ".".join(str(part) for part in problem["loc"])
            raise FreezeError(f"sheet row {line}: {column}: {problem['msg']}") from None
        key = (fact.concept, fact.basis, fact.period_label, tuple(sorted(fact.dimensions.items())))
        if key in seen:
            raise FreezeError(
                f"sheet row {line}: sheet row {seen[key]} already has {fact.concept} for the same basis and period")
        seen[key] = line
        facts.append(fact)
        adds_up = row.get("adds_up", "").lower()
        if adds_up in ("yes", "no"):
            checks.append(ExpectedCheck(
                concept=fact.concept, basis=fact.basis, period_label=fact.period_label, adds_up=adds_up == "yes"))
    return GoldFiling(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind, period_end=filing.period_end,
        set=filing.set, stratum=filing.stratum, printed_pages_per_page=filing.printed_pages_per_page,
        taxonomy_version=taxonomy.taxonomy_version, frozen_at=frozen_at.isoformat(),
        exported_from=exported_from, facts=facts, expected_checks=checks,
    )


def gold_path(gold_dir: Path, filing_id: str) -> Path:
    return gold_dir / f"{filing_id}.json"


def write_gold(gold_dir: Path, gold: GoldFiling, force: bool = False) -> Path:
    path = gold_path(gold_dir, gold.filing_id)
    if path.exists() and not force:
        raise FileExistsError(f"{path} exists; gold is sealed, pass --force to replace it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(gold.model_dump(mode="json"), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def read_gold(gold_dir: Path) -> dict[str, GoldFiling]:
    if not gold_dir.is_dir():
        return {}
    loaded = [GoldFiling.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in sorted(gold_dir.rglob("*.json"))]
    return {g.filing_id: g for g in loaded}
