"""The gold set: facts a person checked against the PDF, keyed by concept.

Freeze reads a sheet (the columns `sheets.py` writes) and keeps the rows marked verified. Every figure
is text parsed by the engine's own `parse_reported`, never a number a spreadsheet made.

A spreadsheet may retype what the pipeline wrote: `2026-03-31` as `31/03/2026`, `10000000` as `1E+07`.
Given the artefact the sheet was exported from, freeze reads those columns from it again. A cell in them
that a person edited, and not only a spreadsheet retyped, must still agree with the artefact, or the row is
refused: the gold file never holds a value other than the one the person saw.

The messages of a `FreezeError` reach the console. They name a sheet row and a column. They may echo a
cell that is no text of the filing, such as a date, a scale, a span, a page, a row number or a concept id, and
never a figure, a label or a period label.

A gold file that cannot be read is a `GoldError`, whose message names the file and nothing in it: the text
of a JSON or validation error repeats what the file holds, which can be a label or a figure.
"""

import csv
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from maester_eval.artefacts import Artefact
from maester_eval.concepts import Concept, Taxonomy
from maester_eval.errors import EvalError
from maester_eval.files import read_model, write_text_atomically
from maester_eval.manifest import EvalSet, Filing, FilingKind, is_iso_date
from maester_eval.periods import Span
from maester_eval.sheets import sheet_rows
from maester_eval.text import normalise
from pdf_financial_qa.workflow.contracts import ReportingBasis, StatementKind
from pdf_financial_qa.workflow.values import format_decimal, parse_label_date, parse_reported

_DIGITS = re.compile(r"[0-9]+")
# A scale is a whole number from 1 without a leading zero: an unknown scale is never zero.
_SCALE = re.compile(r"[1-9][0-9]*")
# A whole number as written or with the ".0" a spreadsheet adds ("7", "7.0"); not "7.5", "1E+3" or "NaN".
_DIGITS_OR_FLOAT = re.compile(r"-?[0-9]+(?:\.0+)?")
_DAY_FIRST_DATE = re.compile(r"([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})")


class FreezeError(EvalError, ValueError):
    pass


class GoldError(EvalError, ValueError):
    """A gold file that is not UTF-8, not JSON or not of the form `freeze` writes."""


class GoldSealedError(EvalError):
    """A gold file exists, and `freeze` was not told to replace it."""


def _is_decimal(text: str) -> bool:
    try:
        return Decimal(text).is_finite()
    except InvalidOperation:
        return False


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
    # How long the period is: from the column header (`periods.span_of_label`), or a person's `gold_span`. Null is
    # unknown, never a guess, and a balance sheet line has none.
    span: Span | None = None
    printed: str
    value_status: Literal["value", "dash"]
    value: str | None
    scale: str | None
    normalized_value: str | None
    page_index: int
    dimensions: dict[str, str] = Field(default_factory=dict)
    # "sheet": a row a person labelled from a sheet of a run. "settled": a cell the investor settled where the model and
    # XBRL disagreed. Headline rates count the first only, because the second was labelled with the XBRL value in view.
    origin: Literal["sheet", "settled"] = "sheet"

    @model_validator(mode="after")
    def _figure_fits_its_status(self) -> "GoldFact":
        """A figure has a value and a normalised value and a dash has neither, as `freeze_sheet` writes them. Each
        figure is a decimal number, because the scorer compares them as `Decimal`. A hand-edited file that breaks
        this is refused when it is read, not met as a crash in the middle of a report."""
        figures = (self.value, self.normalized_value)
        if self.value_status == "value" and None in figures:
            raise ValueError("a figure needs value and normalized_value")
        if self.value_status == "dash" and figures != (None, None):
            raise ValueError("a dash has no value and no normalized_value")
        if not all(text is None or _is_decimal(text) for text in (self.value, self.scale, self.normalized_value)):
            raise ValueError("value, scale and normalized_value must be decimal numbers")
        return self


class ExpectedCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept: str
    basis: ReportingBasis
    period_label: str
    adds_up: bool


class SettledRecord(BaseModel):
    """One `settle` run: where its facts came from. Versions only, and the count of facts it added."""

    model_config = ConfigDict(extra="forbid")

    pdf_run: str
    xbrl_run: str
    map_version: str | None
    compare_rule: int
    settled_at: str
    facts: int


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
    # Each `settle` run that added facts of `origin "settled"` to this file, in order.
    settled: list[SettledRecord] = Field(default_factory=list)


def fact_keys(fact: GoldFact) -> tuple[tuple, ...]:
    """The keys by which a gold fact is the same cell as another: its concept and basis with the period label and
    dimensions, and with the span and period end. A fact with no period end has only the first."""
    keys: tuple[tuple, ...] = ((fact.concept, fact.basis, fact.period_label, tuple(sorted(fact.dimensions.items()))),)
    if fact.period_end is not None:
        keys += ((fact.concept, fact.basis, fact.span, fact.period_end),)
    return keys


def read_sheet(path: Path) -> list[dict[str, str]]:
    """The sheet's rows, each cell as stripped text.

    utf-8-sig: a BOM a spreadsheet application wrote is not part of the first column's name.
    A header with no `verified` column is a sheet saved with another delimiter, not a sheet with nothing verified."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if "verified" not in (reader.fieldnames or ()):
                raise FreezeError("the sheet has no 'verified' column; was it saved with a different delimiter?")
            return [{k: (v or "").strip() for k, v in r.items() if k is not None} for r in reader]
    except UnicodeDecodeError:
        raise FreezeError(f"{path.name} is not UTF-8 text; save it as CSV UTF-8") from None


def _whole(text: str, what: str, line: int) -> int:
    if not _DIGITS_OR_FLOAT.fullmatch(text):
        raise FreezeError(f"sheet row {line}: {what} {text!r} is not a whole number")
    return int(text.partition(".")[0])


def _unreadable(line: int, column: str, text: str, what: str, row: dict[str, str],
                artefact: Artefact | None) -> FreezeError:
    """The error for a cell that is not what it should be, most likely because a spreadsheet retyped it.

    `--run` can give back only a column the pipeline wrote, only when no artefact was passed, and only
    for a row that has a `row` number: a row added by hand has no fact behind it."""
    can_read_again = column in _MACHINE_COLUMNS and artefact is None and bool(row.get("row"))
    remedy = "pass --run to read it from the artefact" if can_read_again else "keep the column as text"
    return FreezeError(f"sheet row {line}: {column} {text!r} is not {what} (a spreadsheet may have retyped it; {remedy})")


def _same_words(sheet: str, original: str) -> bool:
    return normalise(sheet) == normalise(original)


def _same_period_label(sheet: str, original: str) -> bool:
    """The same words, or two ways of writing the same date, such as "As at 31 March 2026" and "31/03/2026"."""
    if _same_words(sheet, original):
        return True
    day = parse_label_date(sheet)
    return day is not None and day == parse_label_date(original)


def _read_date(text: str) -> date | None:
    """A date as the pipeline writes it (`2026-03-31`) or as a spreadsheet may (`31/03/2026`, day first); else None."""
    if is_iso_date(text):
        return date.fromisoformat(text)
    found = _DAY_FIRST_DATE.fullmatch(text)
    if found is None:
        return None
    day, month, year = (int(part) for part in found.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _same_date(sheet: str, original: str) -> bool:
    day = _read_date(sheet)
    return day is not None and day == _read_date(original)


def _same_figure(sheet: str, original: str) -> bool:
    """Equal as `parse_reported` reads them, so `2000` and `2,000.00` are `2,000`, and `-3000` is `(3,000)`."""
    return parse_reported(sheet) == parse_reported(original)


def _same_number(sheet: str, original: str) -> bool:
    """Equal as numbers, so `1E+07` is `10000000` and `2.0` is `2`. A cell that is no number agrees with nothing."""
    try:
        return Decimal(sheet) == Decimal(original)
    except InvalidOperation:
        return False


# How a cell of a column the pipeline wrote is compared with the artefact's, in the order they are checked. The
# label is not here: it is checked first, with a message of its own, because it says which fact the row is.
_AGREEMENTS = {
    "statement": _same_words, "basis": _same_words, "section": _same_words,
    "period_label": _same_period_label, "period_end": _same_date, "span": _same_words,
    "printed": _same_figure, "scale_factor": _same_number, "page": _same_number,
}
# The columns the pipeline wrote that freeze reads again from the artefact.
_MACHINE_COLUMNS = ("label", *_AGREEMENTS)


def _as_exported(row: dict[str, str], line: int, exported: dict[str, dict[str, str]] | None) -> dict[str, str]:
    """The row with the columns the pipeline wrote taken back from the artefact's fact, as the export wrote them.

    That needs the artefact and a `row` number. A row with no number was added by hand and stands as it is.

    A spreadsheet's retyping does not matter, but a cell the person edited must still agree with the artefact.
    Otherwise it would be dropped without a word, or, for a second run of the same filing, the second run's
    figures would be sealed in place of the ones the person checked. A cell left empty is not compared. A
    `printed` cell is not compared when the person gave `gold_text`, which is the figure then."""
    if exported is None or not row.get("row"):
        return row
    number = _whole(row["row"], "row", line)
    original = exported.get(str(number))
    if original is None or normalise(row.get("label", "")) != normalise(original["label"]):
        raise FreezeError(f"sheet row {line}: row {number} no longer matches the artefact; re-export or fix `row`")
    for column, agrees in _AGREEMENTS.items():
        if column == "printed" and row.get("gold_text"):
            continue
        cell = row.get(column, "")
        if cell and not agrees(cell, original[column]):
            raise FreezeError(f"sheet row {line}: {column} no longer matches the artefact")
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
        raise _unreadable(line, column, text, "a whole number", row, artefact)
    if not _SCALE.fullmatch(text):  # "0" is no scale, and "007" is not how a scale is written
        raise FreezeError(
            f"sheet row {line}: {column} {text!r} is not a scale: use a whole number from 1 without a leading zero")
    return text


def _period_end(row: dict[str, str], line: int, artefact: Artefact | None) -> str | None:
    column = "gold_period_end" if row.get("gold_period_end") else "period_end"
    text = row.get(column, "")
    if text and not is_iso_date(text):
        raise _unreadable(line, column, text, "a date written YYYY-MM-DD", row, artefact)
    return text or None


_SPANS: tuple[Span, ...] = get_args(Span)


def _span(row: dict[str, str], line: int, filing: Filing) -> Span | None:
    """The fact's span: `gold_span`, else the `span` the rule read. Another word is refused.

    A balance sheet line is a point in time and has none. A results filing's fact that is not on the balance
    sheet needs one, because a quarter and its year to date end on one day and cannot be told apart without it.
    An annual report's line may have none: annual reports are never paired, so nothing needs to place it."""
    column = "gold_span" if row.get("gold_span", "").strip() else "span"
    word = row.get(column, "").strip()
    span = next((known for known in _SPANS if known == word.lower()), None)
    if word and span is None:
        raise FreezeError(f"sheet row {line}: {column} {word} is not quarter, half_year, nine_months, year or other")
    if row.get("statement") == "balance_sheet":
        if span is not None:
            raise FreezeError(f"sheet row {line}: a balance sheet line has no span")
        return None
    if span is None and filing.kind == "financial_results":
        raise FreezeError(f"sheet row {line}: no span; fill gold_span")
    return span


def _verified(row: dict[str, str]) -> bool:
    return row.get("verified", "").lower() == "yes"


def count_unverified(rows: list[dict[str, str]]) -> int:
    """How many rows freeze leaves out: those with something in them that are not marked `verified=yes`.

    A row with every cell empty is a blank line a spreadsheet left behind, not a row."""
    return sum(1 for row in rows if any(row.values()) and not _verified(row))


def freeze_sheet(rows: list[dict[str, str]], filing: Filing, taxonomy: Taxonomy, frozen_at: datetime,
                 exported_from: dict | None = None, artefact: Artefact | None = None,
                 keep: GoldFiling | None = None) -> GoldFiling:
    """Keep the rows marked verified, each as a gold fact. A bad row is a `FreezeError` naming its sheet row.

    So is a sheet with no verified row: it would seal an empty gold file.

    With the `artefact` the sheet was exported from, a row that has a `row` number takes the columns the
    pipeline wrote from that artefact's fact, whatever a spreadsheet made of them; the sheet supplies the
    concept, the `gold_*` columns, `adds_up` and `verified`. Without it, and for a row added by hand,
    every column is the sheet's own.

    With `keep`, the gold file this one replaces: its facts of `origin "settled"` and its settled records stay, after
    the sheet's facts. A cell of the sheet that a settled fact holds already is a `FreezeError`, because a settled
    cell is the investor's call and a sheet is never allowed to overwrite it."""
    kept = [] if keep is None else [fact for fact in keep.facts if fact.origin == "settled"]
    settled_keys = {key for fact in kept for key in fact_keys(fact)}
    exported = None if artefact is None else {r["row"]: r for r in sheet_rows(artefact) if r["row"]}
    facts: list[GoldFact] = []
    checks: list[ExpectedCheck] = []
    seen: dict[tuple, int] = {}
    for offset, sheet_row in enumerate(rows):
        line = offset + 2  # the sheet's header is line 1
        if not _verified(sheet_row):
            continue
        row = _as_exported(sheet_row, line, exported)
        concept = taxonomy.get(row.get("concept", ""))
        if concept is None:
            raise FreezeError(f"sheet row {line}: unknown concept {row.get('concept', '')!r}")
        adds_up = row.get("adds_up", "").lower()
        if adds_up not in ("", "yes", "no"):
            raise FreezeError(f"sheet row {line}: adds_up must be yes, no or empty")
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
        span = _span(row, line, filing)
        try:
            fact = GoldFact(
                concept=concept.id, statement=row["statement"], basis=row["basis"], section=row.get("section", ""),
                label=row["label"], period_label=row["period_label"], period_end=period_end,
                span=span, printed=printed, value_status=status, value=value_text, scale=scale, normalized_value=normalized,
                page_index=page - 1,
            )
        except ValidationError as exc:  # a statement or basis outside the vocabulary
            problem = exc.errors()[0]
            column = ".".join(str(part) for part in problem["loc"])
            raise FreezeError(f"sheet row {line}: {column}: {problem['msg']}") from None
        if settled_keys.intersection(fact_keys(fact)):
            raise FreezeError(f"sheet row {line}: gold already has {fact.concept} for {fact.basis} "
                              f"{fact.period_end or 'no date'} from a settled disagreement")
        # One cell by any of its keys, as `settle` keys it: two header wordings of one slot are one cell.
        keys = fact_keys(fact)
        taken = next((seen[key] for key in keys if key in seen), None)
        if taken is not None:
            raise FreezeError(
                f"sheet row {line}: sheet row {taken} already has {fact.concept} for the same basis and period")
        seen.update(dict.fromkeys(keys, line))
        facts.append(fact)
        if adds_up:
            checks.append(ExpectedCheck(
                concept=fact.concept, basis=fact.basis, period_label=fact.period_label, adds_up=adds_up == "yes"))
    if not facts:
        raise FreezeError("no row is marked verified=yes; nothing to freeze")
    return GoldFiling(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind, period_end=filing.period_end,
        set=filing.set, stratum=filing.stratum, printed_pages_per_page=filing.printed_pages_per_page,
        taxonomy_version=taxonomy.taxonomy_version, frozen_at=frozen_at.isoformat(),
        exported_from=exported_from, facts=[*facts, *kept], expected_checks=checks,
        settled=[] if keep is None else list(keep.settled),
    )


def gold_path(gold_dir: Path, filing_id: str) -> Path:
    return gold_dir / f"{filing_id}.json"


def write_gold(gold_dir: Path, gold: GoldFiling, force: bool = False) -> Path:
    """Write `gold` to its file. One that exists is a `GoldSealedError` and stays as it was, unless `force`."""
    path = gold_path(gold_dir, gold.filing_id)
    if path.exists() and not force:
        raise GoldSealedError(f"{path} exists; gold is sealed, pass --force to replace it")
    write_text_atomically(path, json.dumps(gold.model_dump(mode="json"), ensure_ascii=False, indent=1) + "\n")
    return path


def read_gold_filing(gold_dir: Path, filing_id: str) -> GoldFiling | None:
    """The gold file of one filing, or None when there is none. One that cannot be read is a `GoldError`."""
    path = gold_path(gold_dir, filing_id)
    return read_model(path, GoldFiling, GoldError, "gold file") if path.is_file() else None


def read_gold(gold_dir: Path) -> dict[str, GoldFiling]:
    """Every gold file under `gold_dir`, by filing id. One that cannot be read is a `GoldError` naming the file."""
    if not gold_dir.is_dir():
        return {}
    loaded = [read_model(p, GoldFiling, GoldError, "gold file") for p in sorted(gold_dir.rglob("*.json"))]
    return {g.filing_id: g for g in loaded}


def gold_of_origin(gold: dict[str, GoldFiling], origin: Literal["sheet", "settled"]) -> dict[str, GoldFiling]:
    """Each filing with only the facts of `origin`, by filing id. A filing left with no fact is dropped.

    The `sheet` view keeps a filing's expected checks and the `settled` view has none: the checks were read from
    the sheet's rows. So a gold file made only of settled facts is not a gold filing of the `sheet` view."""
    view: dict[str, GoldFiling] = {}
    for filing_id, filing in gold.items():
        facts = [fact for fact in filing.facts if fact.origin == origin]
        if facts:
            view[filing_id] = filing.model_copy(
                update={"facts": facts, "expected_checks": filing.expected_checks if origin == "sheet" else []})
    return view
