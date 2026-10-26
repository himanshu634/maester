"""The OCR spot check: read a fixed list of pages under four reader configurations.

`maester-indexer-ocr-sample --pages <file> --corpus <dir> --out <dir>` reads 10 scanned and 5
digital statement pages, each under the OCR engine (RapidOCR or Tesseract) and the table cell
matching setting a configuration names, and writes a folder a person scores by hand:
`scores.csv` (counts blank), a picture of each page, and the text each configuration read.
`maester-eval ocr report` scores the sheet (phase 3 of the ingestion plan).

It works config by config and holds one `Reader` at a time, so one converter's models are loaded
at once, inside the indexer's memory limit. The console shows the run folder's name and counts
only; the page text is in the run folder (under data/eval/, which git ignores).
"""

import argparse
import csv
import dataclasses
import difflib
import gc
import itertools
import json
import re
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from typing import Annotated, Literal

import pypdfium2
from docling_core.types.doc import DoclingDocument
from pydantic import BaseModel, ConfigDict, Field, RootModel, ValidationError

from maester_indexer.contracts import PageNumber, RangeRead
from maester_indexer.reader import Reader
from maester_indexer.settings import Settings

# name -> (OCR engine, table cell matching). The order is the order the configs are read in,
# and `a` comes before `b` in every pair of a Disagreement.
CONFIGS: dict[str, tuple[str, bool]] = {
    "rapidocr-cm": ("rapidocr", True),
    "rapidocr-nocm": ("rapidocr", False),
    "tesseract-cm": ("tesseract", True),
    "tesseract-nocm": ("tesseract", False),
}
# On a page with a text layer the engine reads nothing, so only cell matching varies.
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
PNG_DPI = 150
# A number as printed: the brackets and the sign stay, so (45) and 45 are different tokens.
_NUMBER = re.compile(r"\(?-?\d[\d,]*(?:\.\d+)?\)?")
_STAMP = "%Y%m%dT%H%M%SZ"  # as maester_eval.paths.EvalPaths.new_run writes it, so `--run latest` finds the folder

Kind = Literal["scanned", "digital"]
ReadPage = Callable[[bytes, int, str], RangeRead]  # (pdf, page, config name)


class PageRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing: str  # the PDF is <corpus>/<filing>.pdf
    page: PageNumber  # a PDF page, counted from 1


class PagesFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scanned: Annotated[list[PageRef], Field(min_length=10, max_length=10)]
    digital: Annotated[list[PageRef], Field(min_length=5, max_length=5)]


class Disagreement(BaseModel):
    """Where two configurations read different numbers on one page. Task 3's report lists them."""

    model_config = ConfigDict(extra="forbid")

    filing: str
    page: PageNumber
    a: str  # config names
    b: str
    pairs: list[tuple[str, str]]  # `disagreements` of the two configurations' number tokens


DisagreementFile = RootModel[list[Disagreement]]


def number_tokens(text: str) -> list[str]:
    return _NUMBER.findall(text)


def disagreements(a: list[str], b: list[str]) -> list[tuple[str, str]]:
    """The places two token lists differ, each side's tokens joined by a space ("" for no tokens)."""
    matcher = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return [(" ".join(a[i1:i2]), " ".join(b[j1:j2])) for tag, i1, i2, j1, j2 in matcher.get_opcodes() if tag != "equal"]


@dataclass(frozen=True)
class _PageRead:
    """What the sheet for the person needs from one read: the rest of the read is already in its file."""

    seconds: float
    engine: str  # the read's own engine string
    text: str
    none_reason: str | None
    tables: list[str]  # as markdown
    tokens: list[str]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _slug(filing: str) -> str:
    return filing.replace("/", "--")


def _configs_for(kind: Kind) -> list[str]:
    return list(DIGITAL_CONFIGS) if kind == "digital" else list(CONFIGS)


def _listed(pages: PagesFile) -> list[tuple[Kind, PageRef]]:
    return [("scanned", ref) for ref in pages.scanned] + [("digital", ref) for ref in pages.digital]


def page_reads(pages: PagesFile) -> int:
    """How many timed reads a run makes (the warm-ups are left out)."""
    return sum(len(_configs_for(kind)) for kind, _ in _listed(pages))


def run_sample(
    pages: PagesFile,
    corpus: Path,
    out: Path,
    read: ReadPage,
    clock: Callable[[], float] = time.monotonic,
    now: Callable[[], datetime] = _utc_now,
) -> Path:
    """Read every page under its configs, config by config, and write the run folder `out/<stamp>`."""
    listed = _listed(pages)

    def pdf_of(ref: PageRef) -> bytes:
        return (corpus / f"{ref.filing}.pdf").read_bytes()

    # Find a missing file before the first read: a run takes long.
    for _, ref in listed:
        if not (corpus / f"{ref.filing}.pdf").is_file():
            raise FileNotFoundError(f"The corpus has no PDF for {ref.filing}.")
    moment = now()
    stamp = (moment if moment.tzinfo is not None else moment.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).strftime(_STAMP)
    run = out / stamp
    try:
        run.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        raise FileExistsError(f"The run folder {stamp} exists already.") from None

    reads: dict[tuple[int, str], _PageRead] = {}  # by (index in `listed`, config)
    for config in CONFIGS:
        warm_up = pages.scanned[0]
        read(pdf_of(warm_up), warm_up.page, config)  # the first read loads the models; its time is not kept
        for index, (kind, ref) in enumerate(listed):
            if config not in _configs_for(kind):
                continue
            pdf = pdf_of(ref)
            started = clock()
            result = read(pdf, ref.page, config)
            seconds = clock() - started
            wire = {**result.to_wire(), "seconds": seconds, "ocrEngine": result.versions.ocr_engine}
            (run / f"{_slug(ref.filing)}_p{ref.page}_{config}.json").write_text(json.dumps(wire, ensure_ascii=False), encoding="utf-8")
            reads[(index, config)] = _page_read(result, ref.page, seconds)
            del pdf, result, wire

    entries: list[Disagreement] = []
    rows: list[dict[str, str]] = []
    for index, (kind, ref) in enumerate(listed):
        configs = _configs_for(kind)
        _render_png(pdf_of(ref), ref.page, run / f"{_slug(ref.filing)}_p{ref.page}.png")
        differences = {
            (a, b): disagreements(reads[(index, a)].tokens, reads[(index, b)].tokens) for a, b in itertools.combinations(configs, 2)
        }
        entries += [
            Disagreement(filing=ref.filing, page=ref.page, a=a, b=b, pairs=pairs) for (a, b), pairs in differences.items() if pairs
        ]
        (run / f"{_slug(ref.filing)}_p{ref.page}.md").write_text(
            _sheet(ref, kind, {config: reads[(index, config)] for config in configs}, differences), encoding="utf-8"
        )
        for config in configs:
            engine, cell_matching = CONFIGS[config]
            rows.append(
                {
                    **dict.fromkeys(SCORE_COLUMNS, ""),
                    "filing": ref.filing,
                    "page": str(ref.page),
                    "kind": kind,
                    "config": config,
                    "engine": engine,
                    "cell_matching": "true" if cell_matching else "false",
                    "seconds": f"{reads[(index, config)].seconds:.1f}",
                }
            )
    (run / "disagreements.json").write_text(DisagreementFile(entries).model_dump_json(indent=2) + "\n", encoding="utf-8")
    with (run / "scores.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SCORE_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return run


def _page_read(result: RangeRead, page: int, seconds: float) -> _PageRead:
    only = next(p for p in result.pages if p.page_number == page)
    # The document is validated once, not once per table: a table's markdown needs it to resolve its references.
    document = DoclingDocument.model_validate(result.document)
    return _PageRead(
        seconds=seconds,
        engine=result.versions.ocr_engine,
        text=only.text,
        none_reason=only.none_reason,
        tables=[table.export_to_markdown(doc=document) for table in document.tables],
        tokens=number_tokens(only.text),  # the page text holds the tables' rows too
    )


def _render_png(pdf: bytes, page: int, path: Path) -> None:
    document = pypdfium2.PdfDocument(pdf)
    try:
        pdf_page = document[page - 1]
        try:
            pdf_page.render(scale=PNG_DPI / 72).to_pil().save(path)
        finally:
            pdf_page.close()
    finally:
        document.close()


def _fenced(text: str) -> str:
    """The text in a code fence longer than any run of backticks inside it."""
    fence = "`" * max(3, max((len(run) for run in re.findall(r"`+", text)), default=0) + 1)
    return f"{fence}text\n{text}\n{fence}"


def _side(tokens: str) -> str:
    return tokens or "(none)"


def _sheet(ref: PageRef, kind: Kind, reads: dict[str, _PageRead], differences: dict[tuple[str, str], list[tuple[str, str]]]) -> str:
    """The page for the person scoring: each configuration's text and tables, then where the configurations differ."""
    lines = [f"# {ref.filing}, page {ref.page}", "", f"A {kind} page. The picture is `{_slug(ref.filing)}_p{ref.page}.png`.", ""]
    for config, page_read in reads.items():
        cell_matching = "on" if CONFIGS[config][1] else "off"
        lines += [f"## {config}", "", f"Engine `{page_read.engine}`, cell matching {cell_matching}, {page_read.seconds:.1f} s.", ""]
        if page_read.none_reason:
            lines += [f"No text was read: {page_read.none_reason}.", ""]
        lines += ["### Page text", "", _fenced(page_read.text), "", "### Tables", ""]
        if page_read.tables:
            for number, table in enumerate(page_read.tables, start=1):
                lines += [f"Table {number}", "", table, ""]
        else:
            lines += ["No tables.", ""]
    lines += ["## Where the configurations read different numbers", ""]
    for (a, b), pairs in differences.items():
        lines += [f"### {a} and {b}", ""]
        lines += [f"- {_side(x)} → {_side(y)}" for x, y in pairs] if pairs else ["The same numbers."]
        lines.append("")
    return "\n".join(lines)


class OneReaderAtATime:
    """The real `read`: holds at most one `Reader`, the one for the config being read.

    A config is a reader of its own (its engine and cell matching are settings of a Docling
    pipeline). When the config changes the old reader is dropped, with its converter and models, and
    collected before the next is built."""

    def __init__(
        self,
        make_reader: Callable[[Settings], Reader] = Reader,
        settings: Callable[[], Settings] = Settings.from_env,
    ) -> None:
        self._make_reader = make_reader
        self._settings = settings
        self._config: str | None = None
        self._reader: Reader | None = None

    def __call__(self, pdf: bytes, page: int, config: str) -> RangeRead:
        if config != self._config or self._reader is None:
            self._reader = None
            self._config = None
            gc.collect()
            engine, cell_matching = CONFIGS[config]
            self._reader = self._make_reader(dataclasses.replace(self._settings(), ocr_engine=engine, table_cell_matching=cell_matching))
            self._config = config
        return self._reader.read_range(pdf, page, page, ocr_pages_left=1, cancel=Event())


def main(argv: Sequence[str] | None = None, read: ReadPage | None = None, now: Callable[[], datetime] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="maester-indexer-ocr-sample",
        description="Read a fixed list of pages under four reader configurations and write a scoring sheet.",
    )
    parser.add_argument("--pages", required=True, type=Path, help="the page list: {scanned: [{filing, page}], digital: [...]}")
    parser.add_argument("--corpus", required=True, type=Path, help="the folder of filings: <corpus>/<filing>.pdf")
    parser.add_argument("--out", required=True, type=Path, help="the folder the run folder is made in")
    args = parser.parse_args(argv)
    try:
        pages = PagesFile.model_validate_json(args.pages.read_text(encoding="utf-8"))
    except OSError:
        print("The pages file could not be read.", file=sys.stderr)
        return 1
    except ValidationError as error:
        # The place and the kind of each problem only: the input is not echoed.
        problems = "; ".join(f"{'.'.join(str(part) for part in e['loc'])}: {e['type']}" for e in error.errors())
        print(f"The pages file is not valid: {problems}.", file=sys.stderr)
        return 1
    try:
        run = run_sample(pages, args.corpus, args.out, read or OneReaderAtATime(), now=now or _utc_now)
    except (FileExistsError, FileNotFoundError) as error:
        print(error, file=sys.stderr)
        return 1
    print(f"run {run.name}: {len(pages.scanned) + len(pages.digital)} pages, {page_reads(pages)} page reads")
    return 0


if __name__ == "__main__":
    sys.exit(main())
