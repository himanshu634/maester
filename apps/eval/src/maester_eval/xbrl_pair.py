"""Pairing results filings with the XBRL instances BSE filed for them.

The investor's `xbrl-manifest.csv` lists every instance by BSE code, period token, basis and filed date. A results
filing pairs with the rows of its company's code whose period token ends on the filing's period end, in CSV order:
a basis is not chosen here, and a refiling (one token and basis twice) is kept twice, for the owner rule of a later
task to settle. An annual report gets a code and no pairs.

`apply_pairs` copies each instance into the git-ignored corpus (`<company folder>/xbrl/<name>`) and writes the
format each one detects as. It reads an instance for its format only and never writes a figure. A corpus file is
never overwritten, and a missing source stops everything before the first copy.
"""

import csv
import hashlib
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

from pydantic import ValidationError

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl.formats import detect_format
from pdf_financial_qa.xbrl.parser import parse_instance

from maester_eval.errors import EvalError
from maester_eval.files import write_bytes_atomically
from maester_eval.manifest import Filing, Manifest, XbrlPair, is_iso_date, period_end_of_token
from maester_eval.text import normalise
from maester_eval.xbrl_limits import XBRL_LIMITS

COLUMNS = ("bse_code", "company", "period", "basis", "filed", "file", "status")
_BASES = ("consolidated", "standalone")


class XbrlPairError(EvalError):
    """The XBRL manifest or its files cannot be paired. The text names a column, a line, a company or a path, never a figure."""


@dataclass(frozen=True)
class XbrlRow:
    """One line of `xbrl-manifest.csv`. `file` is relative to the folder the instances were downloaded into."""

    bse_code: str
    company: str
    period: str
    basis: str
    filed: str
    file: str
    status: str


def read_xbrl_manifest(path: Path) -> list[XbrlRow]:
    """The rows of the CSV, in file order. UTF-8 with or without a BOM.

    A missing column is an `XbrlPairError` naming it. Every row marked `exists` must hold a six-digit code, a period
    token, a basis, a filed date and an `.xml` file name that stays inside the folder: a bad one is named by its line.
    """
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise XbrlPairError(f"{path} is not UTF-8 text") from None
    reader = csv.DictReader(text.splitlines())
    absent = [column for column in COLUMNS if column not in (reader.fieldnames or [])]
    if absent:
        raise XbrlPairError(f"{path} has no column {', '.join(absent)}")
    rows: list[XbrlRow] = []
    for number, record in enumerate(reader, start=2):
        row = XbrlRow(**{column: (record.get(column) or "").strip() for column in COLUMNS})
        if row.status == "exists":
            bad = _bad_column(row)
            if bad:
                raise XbrlPairError(f"{path} line {number}: {bad} is not valid")
        rows.append(row)
    return rows


def _bad_column(row: XbrlRow) -> str | None:
    """The first column of an `exists` row that cannot be used, or None."""
    if not (len(row.bse_code) == 6 and row.bse_code.isascii() and row.bse_code.isdigit()):
        return "bse_code"
    if not row.company:
        return "company"
    try:
        period_end_of_token(row.period)
    except ValueError:
        return "period"
    if row.basis not in _BASES:
        return "basis"
    if not is_iso_date(row.filed):
        return "filed"
    parts = PurePosixPath(row.file).parts
    if not row.file.endswith(".xml") or ".." in parts or row.file.startswith("/") or not row.file.split("/")[-1]:
        return "file"
    return None


@dataclass
class PairPlan:
    """What the CSV says about the manifest, before anything is copied."""

    # Company folder to BSE code.
    codes: dict[str, str] = field(default_factory=dict)
    # Results filing id to its rows, in CSV order. A filing with none is not here.
    pairs: dict[str, list[XbrlRow]] = field(default_factory=dict)
    # Filing ids (any kind) of a company the CSV does not hold.
    no_code: list[str] = field(default_factory=list)
    # Rows marked `exists` that no results filing of their period takes.
    no_filing: list[XbrlRow] = field(default_factory=list)
    # Results filing ids with no row.
    none: list[str] = field(default_factory=list)
    # Rows not marked `exists`, which are left out of everything.
    skipped: int = 0


def plan_pairs(manifest: Manifest, rows: list[XbrlRow]) -> PairPlan:
    """Which rows go with which results filing. Pure."""
    codes_by_name: dict[str, set[str]] = {}
    for row in rows:
        codes_by_name.setdefault(normalise(row.company), set()).add(row.bse_code)
    plan = PairPlan(skipped=sum(1 for r in rows if r.status != "exists"))
    for filing in manifest.filings:
        found = codes_by_name.get(normalise(filing.company), set())
        if len(found) > 1:
            raise XbrlPairError(f"{filing.company} has more than one BSE code in the XBRL manifest: {', '.join(sorted(found))}")
        if not found:
            plan.no_code.append(filing.id)
            continue
        (code,) = found
        if plan.codes.setdefault(filing.company_folder, code) != code:
            raise XbrlPairError(f"folder {filing.company_folder} has more than one BSE code: {plan.codes[filing.company_folder]}, {code}")
    live = [(index, row) for index, row in enumerate(rows) if row.status == "exists"]
    taken: set[int] = set()
    for filing in manifest.filings:
        if filing.kind != "financial_results":
            continue
        code = plan.codes.get(filing.company_folder)
        matched = [] if code is None else [
            (index, row) for index, row in live
            if row.bse_code == code and period_end_of_token(row.period).isoformat() == filing.period_end]
        if not matched:
            plan.none.append(filing.id)
            continue
        plan.pairs[filing.id] = [row for _, row in matched]
        taken.update(index for index, _ in matched)
    plan.no_filing = [row for index, row in live if index not in taken]
    return plan


@dataclass(frozen=True)
class CopyJob:
    """One instance bound for the corpus. `destination` is relative to the corpus; `needed` is False when the
    same bytes are already there."""

    source: Path
    destination: str
    needed: bool


def destination_of(filing: Filing, row: XbrlRow) -> str:
    return f"{filing.company_folder}/xbrl/{PurePosixPath(row.file).name}"


def check_copies(manifest: Manifest, plan: PairPlan, source_root: Path, corpus: Path) -> list[CopyJob]:
    """Every instance the plan pairs, checked and ready to copy; nothing is written.

    A source that is not a file stops here, naming the count and the first three. So does a destination that holds
    other bytes (or that two different sources want), because a corpus file is never overwritten.
    """
    wanted: list[tuple[Path, str, str]] = []  # source, destination, the file as the CSV writes it
    for filing in manifest.filings:
        for row in plan.pairs.get(filing.id, []):
            wanted.append((source_root / row.file, destination_of(filing, row), row.file))
    absent = list(dict.fromkeys(name for source, _, name in wanted if not source.is_file()))
    if absent:
        raise XbrlPairError(f"{len(absent)} XBRL source file(s) missing under {source_root}, the first {_first(absent)}")
    jobs: dict[str, CopyJob] = {}
    digests: dict[str, str] = {}
    conflicts: list[str] = []
    for source, destination, _ in wanted:
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if destination in jobs:
            if digests[destination] != digest:
                conflicts.append(destination)
            continue
        target = corpus / destination
        needed = True
        if target.exists():
            if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                conflicts.append(destination)
                continue
            needed = False
        jobs[destination] = CopyJob(source, destination, needed)
        digests[destination] = digest
    if conflicts:
        unique = list(dict.fromkeys(conflicts))
        raise XbrlPairError(f"{len(unique)} corpus file(s) already hold other bytes and are never overwritten, "
                            f"the first {_first(unique)}")
    return list(jobs.values())


def _first(names: list[str]) -> str:
    return f"{min(3, len(names))}: {', '.join(names[:3])}"


def _format_of(data: bytes) -> str | None:
    """The format id of an instance, or None when it cannot be read or is in no known format."""
    try:
        return detect_format(parse_instance(data, **XBRL_LIMITS)).id
    except ExtractionError:
        return None


def apply_pairs(manifest: Manifest, plan: PairPlan, source_root: Path, corpus: Path) -> tuple[Manifest, int]:
    """Copy the paired instances into the corpus and return the manifest that names them, and the number copied.

    Every company the CSV holds gives its filings the BSE code; a results filing's `xbrl` is what the plan pairs
    with it. The corpus is written only after every source and destination has been checked.
    """
    jobs = check_copies(manifest, plan, source_root, corpus)
    formats: dict[str, str | None] = {}
    copied = 0
    for job in jobs:
        data = job.source.read_bytes()
        formats[job.destination] = _format_of(data)
        if job.needed:
            write_bytes_atomically(corpus / job.destination, data)
            copied += 1
    filings: list[Filing] = []
    for filing in manifest.filings:
        update: dict[str, object] = {}
        code = plan.codes.get(filing.company_folder)
        if code is not None:
            update["bse_code"] = code
        if filing.kind == "financial_results":
            update["xbrl"] = [
                XbrlPair(file=destination_of(filing, row), basis=row.basis, period=row.period, filed=row.filed,  # type: ignore[arg-type]
                         format=formats[destination_of(filing, row)])
                for row in plan.pairs.get(filing.id, [])]
        try:
            filings.append(Filing.model_validate({**filing.model_dump(), **update}))
        except ValidationError:
            raise XbrlPairError(f"{filing.id}: its pairs are not valid") from None
    return Manifest(filings=filings), copied


def summary_lines(manifest: Manifest, plan: PairPlan) -> list[str]:
    """What the plan found, as the command prints it: counts and filing ids, no company name, no file name."""
    by_id = manifest.by_id()
    paired = list(plan.pairs)
    dev = sum(1 for i in paired if by_id[i].set == "dev")
    refiled = sum(1 for rows in plan.pairs.values()
                  if any(n > 1 for n in Counter((r.period, r.basis) for r in rows).values()))
    annual = sum(1 for f in manifest.filings if f.kind == "annual_report" and f.company_folder in plan.codes)
    lines = [
        f"paired {len(paired)} results filing(s) ({dev} dev, {len(paired) - dev} heldout) "
        f"with {sum(len(rows) for rows in plan.pairs.values())} instance(s)",
        f"{refiled} refiled: one period token and basis paired twice",
        f"{len(plan.none)} results filing(s) with none" + (f": {', '.join(plan.none)}" if plan.none else ""),
        f"{len(plan.no_filing)} instance(s) with no results filing of their period",
        f"{annual} annual report(s) given a BSE code, never paired",
        "no BSE code: " + (", ".join(plan.no_code) if plan.no_code else "none"),
    ]
    if plan.skipped:
        lines.append(f"{plan.skipped} row(s) not marked exists, left out")
    return lines
