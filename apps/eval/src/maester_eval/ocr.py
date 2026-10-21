"""The OCR spot check: score the sheet a person filled in, apply the rules fixed in advance, write the report.

`maester-indexer-ocr-sample` reads 10 scanned and 5 digital statement pages under four reader configurations and leaves
a run folder with `scores.csv`, a picture and the text of each page. A person fills in the counts (`read_scores`), and
`maester-eval ocr report` checks the sheet against the page list (`check_scores`), applies the rules (`choose_engine`,
`choose_cell_matching`) and writes the report (`render_ocr_report`).

apps/eval does not import apps/indexer, so the sheet's shape is copied here: `CONFIGS`, `DIGITAL_CONFIGS`,
`SCORE_COLUMNS`, the page list and `Disagreement`. A test holds the constants to the indexer's source, and the
disagreements fixture under packages/contracts/fixtures/eval is read by both sides.

Every figure here is a count of tokens a person marked, or a measured time. A rate is a ratio of whole numbers, printed
without a float, and a band is a `Fraction`. Nothing here reads a number of a filing as a number: the sheet holds
counts, and the report holds the tokens where two readers differ, as strings.
"""

from collections.abc import Sequence
import csv
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from fractions import Fraction
import json
from pathlib import Path
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel

from maester_eval.errors import EvalError
from maester_eval.files import read_model
from maester_eval.manifest import Manifest
from maester_eval.paths import to_utc

# name -> (OCR engine, table cell matching), in the order a run reads them; `a` comes before `b` in a Disagreement.
CONFIGS: dict[str, tuple[str, bool]] = {
    "rapidocr-cm": ("rapidocr", True),
    "rapidocr-nocm": ("rapidocr", False),
    "tesseract-cm": ("tesseract", True),
    "tesseract-nocm": ("tesseract", False),
}
# On a page with a text layer the engine reads nothing, so a digital page is read under these two only.
DIGITAL_CONFIGS = ("rapidocr-cm", "rapidocr-nocm")
SCORE_COLUMNS = [
    "filing",
    "page",
    "kind",
    "config",
    "engine",
    "cell_matching",
    "seconds",
    "numbers_printed",
    "numbers_wrong",
    "numbers_missing",
    "numbers_extra",
    "headings_printed",
    "headings_wrong",
    "headings_missing",
    "table_rows_printed",
    "table_rows_wrong",
    "checked",
]
_COUNT_COLUMNS = ["numbers_printed", "numbers_wrong", "numbers_missing", "numbers_extra", "headings_printed",
                  "headings_wrong", "headings_missing", "table_rows_printed", "table_rows_wrong"]
_CONFIG_OF = {setting: name for name, setting in CONFIGS.items()}
_ENGINES = {engine for engine, _ in CONFIGS.values()}
_WHOLE_NUMBER = re.compile(r"[0-9]+(?:\.0+)?")  # `7` or `7.0`, as a spreadsheet may write it
# `<filing-slug>_p<page>_<config>.json`, a page as the indexer's run folder holds it.
_PAGE_READ = re.compile(r"(?P<slug>.+)_p(?P<page>[0-9]+)_(?P<config>" + "|".join(re.escape(name) for name in CONFIGS) + r")\.json")

Kind = Literal["scanned", "digital"]
Engine = Literal["rapidocr", "tesseract"]
Measure = Literal["numbers", "headings", "table_rows"]
_KINDS: tuple[Kind, ...] = ("scanned", "digital")
_MEASURES: tuple[Measure, ...] = ("numbers", "headings", "table_rows")
PageNumber = Annotated[int, Field(ge=1)]  # a PDF page, counted from 1


class OcrScoreError(EvalError):
    """A sheet, a page list or a run folder the scoring cannot use. The text names a row, a page or a file, and never a page's words."""


class PageRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing: str  # the id of a filing of the manifest; the PDF is <corpus>/<filing>.pdf
    page: PageNumber


class OcrPages(BaseModel):
    """The page list the indexer's command reads (`data/eval/ocr/pages.json`). The indexer holds it to 10 scanned and 5
    digital pages; the shape is all that is copied."""

    model_config = ConfigDict(extra="forbid")

    scanned: list[PageRef]
    digital: list[PageRef]


class Disagreement(BaseModel):
    """Where two configurations read different numbers on one page."""

    model_config = ConfigDict(extra="forbid")

    filing: str
    page: PageNumber
    a: str  # config names
    b: str
    pairs: list[tuple[str, str]]  # the number tokens of `a` and of `b` at each place they differ, "" for none


DisagreementFile = RootModel[list[Disagreement]]


@dataclass(frozen=True)
class ScoreRow:
    """One line of the sheet: one page under one configuration, as a person counted it."""

    filing: str
    page: int
    kind: Kind
    config: str
    seconds: Decimal
    numbers_printed: int
    numbers_wrong: int
    numbers_missing: int
    numbers_extra: int
    headings_printed: int
    headings_wrong: int
    headings_missing: int
    table_rows_printed: int
    table_rows_wrong: int


@dataclass(frozen=True)
class Totals:
    errors: int
    printed: int
    seconds_mean: Decimal


@dataclass(frozen=True)
class EngineChoice:
    """`engine` is None when Tesseract wins by a band but is too slow: the investor decides."""

    engine: Engine | None
    reason: Literal["tie", "fewer_wrong_numbers", "fewer_wrong_headings", "slower_than_twice"]


@dataclass(frozen=True)
class CellMatchingChoice:
    cell_matching: bool
    reason: Literal["tie", "fewer_broken_rows"]


@dataclass(frozen=True)
class CellMatchingTotals:
    """The table rows broken with cell matching on and off, over the same rows. `band` is what off must win by."""

    on_wrong: int
    off_wrong: int
    printed: int
    band: Fraction


@dataclass(frozen=True)
class OcrRun:
    engines: dict[str, str]  # config -> the engine string its page reads name
    disagreements: list[Disagreement]


# ---- the sheet

def read_scores(path: Path) -> list[ScoreRow]:
    """The sheet's rows. It reads `utf-8-sig`, so a BOM a spreadsheet wrote is not part of the first column's name.

    A row is refused, by its row number in the sheet (the header is row 1), unless `checked` is `yes`, every count is a
    whole number (`7` or `7.0`) and `seconds` is a time. Wrong and missing cannot be more than printed. A row with
    nothing in it, such as the blank rows a spreadsheet leaves at the end, is left out."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            absent = [column for column in SCORE_COLUMNS if column not in (reader.fieldnames or ())]
            if absent:
                raise OcrScoreError(f"the sheet has no {', '.join(repr(column) for column in absent)} column; "
                                    "was it saved with a different delimiter?")
            rows = []
            for offset, record in enumerate(reader):
                cells = {key: (value or "").strip() for key, value in record.items() if key is not None}
                if any(cells.values()):
                    rows.append(_score_row(cells, offset + 2))
            return rows
    except UnicodeDecodeError:
        raise OcrScoreError(f"{path.name} is not UTF-8 text; save it as CSV UTF-8") from None


def _filled(cells: dict[str, str], column: str, line: int) -> str:
    text = cells[column]
    if not text:
        raise OcrScoreError(f"sheet row {line}: {column} is blank")
    return text


def _whole(cells: dict[str, str], column: str, line: int) -> int:
    text = _filled(cells, column, line)
    if not _WHOLE_NUMBER.fullmatch(text):
        raise OcrScoreError(f"sheet row {line}: {column} {text!r} is not a whole number")
    return int(text.partition(".")[0])


def _score_row(cells: dict[str, str], line: int) -> ScoreRow:
    # `checked` first: the sheet the indexer writes has every count blank, and "do this row" is the useful first message.
    if cells["checked"].lower() != "yes":
        raise OcrScoreError(f"sheet row {line}: checked must be yes")
    filing = _filled(cells, "filing", line)
    page = _whole(cells, "page", line)
    if page < 1:
        raise OcrScoreError(f"sheet row {line}: page must be 1 or more")
    kind = _filled(cells, "kind", line)
    if kind not in ("scanned", "digital"):
        raise OcrScoreError(f"sheet row {line}: kind {kind!r} is not scanned or digital")
    config = _filled(cells, "config", line)
    if config not in CONFIGS:  # the engine and cell matching are the config's; a spreadsheet may have retyped their cells
        raise OcrScoreError(f"sheet row {line}: config {config!r} is not one of {', '.join(CONFIGS)}")
    text = _filled(cells, "seconds", line)
    try:
        seconds = Decimal(text)
    except InvalidOperation:
        seconds = None
    if seconds is None or not seconds.is_finite() or seconds < 0:
        raise OcrScoreError(f"sheet row {line}: seconds {text!r} is not a number of seconds")
    counts = {column: _whole(cells, column, line) for column in _COUNT_COLUMNS}
    if counts["numbers_wrong"] + counts["numbers_missing"] > counts["numbers_printed"]:
        raise OcrScoreError(f"sheet row {line}: numbers_wrong + numbers_missing is more than numbers_printed")
    if counts["headings_wrong"] + counts["headings_missing"] > counts["headings_printed"]:
        raise OcrScoreError(f"sheet row {line}: headings_wrong + headings_missing is more than headings_printed")
    if counts["table_rows_wrong"] > counts["table_rows_printed"]:
        raise OcrScoreError(f"sheet row {line}: table_rows_wrong is more than table_rows_printed")
    return ScoreRow(filing=filing, page=page, kind=kind, config=config, seconds=seconds, **counts)  # type: ignore[arg-type]


def read_pages(path: Path) -> OcrPages:
    """The page list. A file that does not exist is a `FileNotFoundError`."""
    return read_model(path, OcrPages, OcrScoreError, "page list")


def _owed_configs(kind: Kind) -> tuple[str, ...]:
    return DIGITAL_CONFIGS if kind == "digital" else tuple(CONFIGS)


def check_scores(rows: Sequence[ScoreRow], pages: OcrPages, manifest: Manifest) -> None:
    """Stop unless the sheet is a whole, consistent score of the page list.

    A scanned page owes a row for each of the 4 configurations and a digital page one for each of the 2 in
    `DIGITAL_CONFIGS`. The printed counts of one page are the same for every config, because the page is the same. Every
    filing is a `dev` filing of the manifest. A row of no page of the list, a second row of one page and config, and a
    kind that the page list does not give are refused too, so no count enters a total it does not belong in."""
    dev = {filing.id for filing in manifest.filings if filing.set == "dev"}
    owed: dict[tuple[str, int], tuple[Kind, tuple[str, ...]]] = {}
    listed: list[tuple[Kind, list[PageRef]]] = [("scanned", pages.scanned), ("digital", pages.digital)]
    for kind, refs in listed:
        for ref in refs:
            if ref.filing not in dev:
                raise OcrScoreError(f"{ref.filing} is not in the dev set of the manifest")
            if (ref.filing, ref.page) in owed:
                raise OcrScoreError(f"page {ref.page} of {ref.filing} is in the page list twice")
            owed[(ref.filing, ref.page)] = (kind, _owed_configs(kind))
    seen: dict[tuple[str, int, str], ScoreRow] = {}
    for row in rows:
        where = f"page {row.page} of {row.filing}"
        if (row.filing, row.page) not in owed:
            raise OcrScoreError(f"{where} is not in the page list")
        kind, configs = owed[(row.filing, row.page)]
        if row.kind != kind:
            raise OcrScoreError(f"{where}: the sheet says {row.kind}, the page list says {kind}")
        if row.config not in configs:
            raise OcrScoreError(f"{where}: {row.config} is not a config of a {kind} page")
        if (row.filing, row.page, row.config) in seen:
            raise OcrScoreError(f"{where}: two rows for {row.config}")
        seen[(row.filing, row.page, row.config)] = row
    for (filing, page), (_, configs) in owed.items():
        where = f"page {page} of {filing}"
        for config in configs:
            if (filing, page, config) not in seen:
                raise OcrScoreError(f"{where}: no row for {config}")
        for column in ("numbers_printed", "headings_printed", "table_rows_printed"):
            if len({getattr(seen[(filing, page, config)], column) for config in configs}) > 1:
                raise OcrScoreError(f"{where}: {column} differs between configs")


# ---- the totals and the rules

def _select(rows: Sequence[ScoreRow], config: str, kind: Kind) -> list[ScoreRow]:
    chosen = [row for row in rows if row.config == config and row.kind == kind]
    if not chosen:
        raise OcrScoreError(f"no {kind} rows for {config}")
    return chosen


def _errors(row: ScoreRow, measure: Measure) -> int:
    if measure == "numbers":
        return row.numbers_wrong + row.numbers_missing
    if measure == "headings":
        return row.headings_wrong + row.headings_missing
    return row.table_rows_wrong


def _printed(row: ScoreRow, measure: Measure) -> int:
    return {"numbers": row.numbers_printed, "headings": row.headings_printed, "table_rows": row.table_rows_printed}[measure]


def _mean_seconds(chosen: Sequence[ScoreRow]) -> Fraction:
    """Exact, so that "more than twice" is not decided by the 28th digit of a mean such as 10/3."""
    return sum((Fraction(row.seconds) for row in chosen), Fraction(0)) / len(chosen)


def totals(rows: Sequence[ScoreRow], config: str, kind: Kind, measure: Measure) -> Totals:
    """The errors and the printed count of one measure over the pages of one kind read under `config`.

    Errors are wrong plus missing, and for table rows the wrong ones. A config with no rows of that kind is an error and
    never a zero."""
    chosen = _select(rows, config, kind)
    seconds = _mean_seconds(chosen)
    return Totals(
        errors=sum(_errors(row, measure) for row in chosen),
        printed=sum(_printed(row, measure) for row in chosen),
        seconds_mean=Decimal(seconds.numerator) / Decimal(seconds.denominator),
    )


def number_band(printed: int) -> Fraction:
    return max(Fraction(1), Fraction(printed, 100))


def heading_band(printed: int) -> Fraction:
    return max(Fraction(1), Fraction(printed * 5, 100))


def table_row_band(printed: int) -> Fraction:
    return max(Fraction(1), Fraction(printed * 2, 100))


def choose_engine(rows: Sequence[ScoreRow]) -> EngineChoice:
    """The OCR engine, judged on the scanned pages with cell matching on.

    A winner is the engine with fewer number errors by more than `number_band` of the numbers printed; or, when the
    number errors are within that band, the one with fewer heading errors by more than `heading_band`. RapidOCR is the
    current engine, so it wins ties. Tesseract that wins by a band but takes more than twice RapidOCR's mean seconds a
    page is not chosen (`slower_than_twice`): the investor decides. The slowness rule is for a switch only, so a
    RapidOCR win stands at any speed."""
    rapid_name, tess_name = _CONFIG_OF[("rapidocr", True)], _CONFIG_OF[("tesseract", True)]
    rapid_numbers, tess_numbers = (totals(rows, name, "scanned", "numbers") for name in (rapid_name, tess_name))
    rapid_headings, tess_headings = (totals(rows, name, "scanned", "headings") for name in (rapid_name, tess_name))
    winner: Engine
    reason: Literal["fewer_wrong_numbers", "fewer_wrong_headings"]
    fewer_for_tesseract = rapid_numbers.errors - tess_numbers.errors
    band = number_band(rapid_numbers.printed)
    if fewer_for_tesseract > band:
        winner, reason = "tesseract", "fewer_wrong_numbers"
    elif -fewer_for_tesseract > band:
        winner, reason = "rapidocr", "fewer_wrong_numbers"
    else:
        fewer_for_tesseract = rapid_headings.errors - tess_headings.errors
        band = heading_band(rapid_headings.printed)
        if fewer_for_tesseract > band:
            winner, reason = "tesseract", "fewer_wrong_headings"
        elif -fewer_for_tesseract > band:
            winner, reason = "rapidocr", "fewer_wrong_headings"
        else:
            return EngineChoice("rapidocr", "tie")
    if winner == "tesseract" and _mean_seconds(_select(rows, tess_name, "scanned")) > 2 * _mean_seconds(_select(rows, rapid_name, "scanned")):
        return EngineChoice(None, "slower_than_twice")
    return EngineChoice(winner, reason)


def cell_matching_totals(rows: Sequence[ScoreRow], engine: str | None) -> CellMatchingTotals:
    """The table rows broken with cell matching on and off, on the scanned pages read by `engine` and on the digital
    pages (read by RapidOCR whatever the engine). `engine=None`, the engine not chosen yet, reads as `rapidocr`."""
    engine = "rapidocr" if engine is None else engine
    if engine not in _ENGINES:
        raise ValueError(f"engine {engine!r} is not one of {', '.join(sorted(_ENGINES))}")
    on: list[ScoreRow] = []
    off: list[ScoreRow] = []
    for row in rows:
        row_engine, cell_matching = CONFIGS[row.config]
        if row.kind == "scanned" and row_engine != engine:
            continue
        (on if cell_matching else off).append(row)
    if not on or not off:
        raise OcrScoreError(f"no rows with cell matching {'on' if not on else 'off'} for {engine}")
    printed = sum(row.table_rows_printed for row in on)
    return CellMatchingTotals(sum(row.table_rows_wrong for row in on), sum(row.table_rows_wrong for row in off),
                              printed, table_row_band(printed))


def choose_cell_matching(rows: Sequence[ScoreRow], engine: str | None) -> CellMatchingChoice:
    """Cell matching stays on unless off breaks fewer table rows by more than `table_row_band`. A win for on is a tie:
    the current setting stays, and nothing is read again."""
    found = cell_matching_totals(rows, engine)
    if found.on_wrong - found.off_wrong > found.band:
        return CellMatchingChoice(False, "fewer_broken_rows")
    return CellMatchingChoice(True, "tie")


# ---- the run folder

def read_run(run: Path) -> OcrRun:
    """What the report needs from a run folder besides the sheet: the engine string each config's page reads name, and
    `disagreements.json`. It opens the `<slug>_p<page>_<config>.json` files for their `ocrEngine` and no `.md`."""
    engines: dict[str, str] = {}
    for path in sorted(run.iterdir()):
        found = _PAGE_READ.fullmatch(path.name)
        if found is None:
            continue
        config = found["config"]
        engine = _engine_of(path)
        if engines.setdefault(config, engine) != engine:
            raise OcrScoreError(f"{config}: the page reads name more than one engine")
    try:
        disagreements = read_model(run / "disagreements.json", DisagreementFile, OcrScoreError, "disagreements file").root
    except FileNotFoundError:
        raise OcrScoreError(f"{run.name} has no disagreements.json") from None
    return OcrRun({name: engines[name] for name in CONFIGS if name in engines}, disagreements)


def _engine_of(path: Path) -> str:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise OcrScoreError(f"{path.name} is not a readable page read") from None
    engine = data.get("ocrEngine") if isinstance(data, dict) else None
    if not isinstance(engine, str) or not engine:
        raise OcrScoreError(f"{path.name} has no ocrEngine")
    return engine


# ---- the report

def format_rate(errors: int, printed: int) -> str:
    """`errors / printed` with three decimals, rounded half to even, worked out on whole numbers. "—" when nothing was printed."""
    if printed == 0:
        return "—"
    thousandths, remainder = divmod(errors * 1000, printed)
    if remainder * 2 > printed or (remainder * 2 == printed and thousandths % 2 == 1):
        thousandths += 1
    return f"{thousandths // 1000}.{thousandths % 1000:03d}"


def _exact(value: Fraction) -> str:
    """A band as a decimal. Its denominator divides 100, so the decimal is exact."""
    if value.denominator == 1:
        return str(value.numerator)
    return format(Decimal(value.numerator) / Decimal(value.denominator), "f")


def _seconds_text(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN), "f")


def _one_line(text: object) -> str:
    return " ".join(str(text).split())


def _cell(text: object) -> str:
    """A table cell: one line, no bare pipe."""
    return _one_line(text).replace("|", "\\|")


def _row(cells: Sequence[object]) -> str:
    return "| " + " | ".join(_cell(cell) for cell in cells) + " |"


def _table(header: Sequence[str], body: Sequence[Sequence[object]]) -> list[str]:
    return [_row(header), _row(["---"] * len(header)), *(_row(cells) for cells in body)]


_REASON_WORDS = {"tie": "tie", "fewer_wrong_numbers": "fewer wrong numbers", "fewer_wrong_headings": "fewer wrong headings"}


def _engine_decision(choice: EngineChoice) -> str:
    if choice.engine is None:
        return ("No engine is named (slower than twice): Tesseract wins by a band, but its seconds per page are more "
                "than twice RapidOCR's. The investor decides.")
    words = _REASON_WORDS[choice.reason]
    if choice.engine == "rapidocr":
        return f"RapidOCR stays the engine ({words})."
    return f"Tesseract replaces RapidOCR: OCR_ENGINE becomes tesseract ({words})."


def _cell_matching_decision(choice: CellMatchingChoice) -> str:
    if choice.cell_matching:
        return "INDEX_TABLE_CELL_MATCHING stays true (tie)."
    return "INDEX_TABLE_CELL_MATCHING becomes false (fewer broken rows)."


def render_ocr_report(rows: Sequence[ScoreRow], pages: OcrPages, engines: dict[str, str],
                      disagreements: Sequence[Disagreement], engine_choice: EngineChoice,
                      cell_choice: CellMatchingChoice, run_name: str, generated_at: datetime) -> str:
    """The report as Markdown: the run and each config's engine string, the results by config and by page, the rule with
    its bands, the decision with the figures behind it, and the places where the configs read different numbers."""
    when = to_utc(generated_at).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# OCR spot check: {run_name}", "",
        f"{when} · {len(pages.scanned)} scanned and {len(pages.digital)} digital pages. Counts are the ones a person "
        "marked against the page pictures.", "",
        "## Readers", "",
    ]
    lines += [f"- `{name}`: `{engines[name]}`" if name in engines else f"- `{name}`: no page read in the run folder" for name in CONFIGS]
    lines += ["", "## Results by configuration", "",
              "Errors are wrong plus missing; for table rows they are the rows marked wrong. The rate is number errors over "
              "numbers printed. A configuration is listed for the kinds of page it was read on: a digital page has no "
              "Tesseract row.", ""]
    body = []
    for name in CONFIGS:
        for kind in _KINDS:
            if not any(row.config == name and row.kind == kind for row in rows):
                continue
            numbers, headings, table_rows = (totals(rows, name, kind, measure) for measure in _MEASURES)
            body.append([name, kind, numbers.errors, numbers.printed, format_rate(numbers.errors, numbers.printed),
                         headings.errors, headings.printed, table_rows.errors, table_rows.printed,
                         _seconds_text(numbers.seconds_mean)])
    lines += _table(["config", "kind", "number errors", "numbers printed", "rate", "heading errors", "headings printed",
                     "table rows wrong", "table rows printed", "seconds per page"], body)
    by_page = {(row.filing, row.page, row.config): row for row in rows}
    page_body = []
    listed: list[tuple[Kind, list[PageRef]]] = [("scanned", pages.scanned), ("digital", pages.digital)]
    for kind, refs in listed:
        for ref in refs:
            for name in CONFIGS:
                row = by_page.get((ref.filing, ref.page, name))
                if row is not None:
                    page_body.append([row.filing, row.page, kind, name, _errors(row, "numbers"), row.numbers_printed,
                                      row.numbers_extra, _errors(row, "headings"), row.headings_printed,
                                      row.table_rows_wrong, row.table_rows_printed, _seconds_text(row.seconds)])
    lines += ["", "## Results by page", ""]
    lines += _table(["filing", "page", "kind", "config", "number errors", "numbers printed", "numbers extra", "heading errors",
                     "headings printed", "table rows wrong", "table rows printed", "seconds"], page_body)

    rapid_cm, tess_cm = _CONFIG_OF[("rapidocr", True)], _CONFIG_OF[("tesseract", True)]
    rapid_numbers, tess_numbers = totals(rows, rapid_cm, "scanned", "numbers"), totals(rows, tess_cm, "scanned", "numbers")
    rapid_headings, tess_headings = totals(rows, rapid_cm, "scanned", "headings"), totals(rows, tess_cm, "scanned", "headings")
    judged_engine = engine_choice.engine or "rapidocr"
    cell = cell_matching_totals(rows, judged_engine)
    lines += [
        "", "## The rule", "",
        "The rule was fixed before the pages were read. A setting that is in use stays unless the other wins by a band, "
        "because any change makes the index read every document again.", "",
        "- **Engine**, judged on the scanned pages with cell matching on. Errors are wrong plus missing. Tesseract replaces "
        "RapidOCR only when its number errors are lower by more than the number band; or when the number errors are within "
        "that band and its heading errors are lower by more than the heading band. RapidOCR is kept by the same bands, "
        "with the same reasons; otherwise it is a tie and RapidOCR stays. When Tesseract wins by a band but its seconds per "
        "page are more than twice RapidOCR's, no engine is named and the investor decides. A RapidOCR win stands at any speed.",
        "- **Cell matching**, judged on the chosen engine's scanned pages and the digital pages. It becomes false only when "
        "the table rows wrong with it off are lower by more than the table row band. Otherwise it stays true.", "",
        "The bands, from what was printed on the pages judged:", "",
        f"- Number band, 1% of the numbers printed, at least 1: {_exact(number_band(rapid_numbers.printed))} "
        f"(of {rapid_numbers.printed} numbers).",
        f"- Heading band, 5% of the headings printed, at least 1: {_exact(heading_band(rapid_headings.printed))} "
        f"(of {rapid_headings.printed} headings).",
        f"- Table row band, 2% of the table rows printed, at least 1: {_exact(cell.band)} (of {cell.printed} table rows).",
        "", "## The decision", "",
        f"- Engine: {_engine_decision(engine_choice)}",
        f"  - Number errors: RapidOCR {rapid_numbers.errors}, Tesseract {tess_numbers.errors} "
        f"(band {_exact(number_band(rapid_numbers.printed))}).",
        f"  - Heading errors: RapidOCR {rapid_headings.errors}, Tesseract {tess_headings.errors} "
        f"(band {_exact(heading_band(rapid_headings.printed))}).",
        f"  - Seconds per page: RapidOCR {_seconds_text(rapid_numbers.seconds_mean)}, Tesseract {_seconds_text(tess_numbers.seconds_mean)}.",
        f"- Cell matching: {_cell_matching_decision(cell_choice)}",
        f"  - Table rows wrong: cell matching on {cell.on_wrong}, off {cell.off_wrong} (band {_exact(cell.band)}).",
        ("  - The engine is not chosen, so cell matching is judged on RapidOCR's scanned pages and the digital pages."
         if engine_choice.engine is None else
         f"  - Cell matching is judged on {'RapidOCR' if judged_engine == 'rapidocr' else 'Tesseract'}'s scanned pages "
         "and the digital pages."),
        "", "## Appendix: Disagreements", "",
        "Places where two configurations read different numbers from each other. They are not checked errors: both may be "
        "wrong, and the counts above are the measure.", "",
    ]
    if disagreements:
        def pair_text(pair: tuple[str, str]) -> str:
            first, second = (_one_line(side) or "(none)" for side in pair)
            return f"{first} → {second}"
        lines += _table(["filing", "page", "configs", "numbers (first → second)"],
                        [[d.filing, d.page, f"{d.a}, {d.b}", "; ".join(pair_text(pair) for pair in d.pairs)] for d in disagreements])
    else:
        lines.append("None.")
    return "\n".join(lines) + "\n"
