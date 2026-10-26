"""One filing's extraction as the harness keeps it: the extractor's wire result or its
error, with timings and model call counts. Phase 1's replay mode reads these, so the
result is `ExtractionResult.to_wire()` unchanged (camelCase field names).

A file the readers cannot read is an `ArtefactReadError` that names the file and nothing
in it: the text of a JSON or validation error repeats what the file holds, which can be a
label or a figure of the filing."""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from maester_eval.errors import EvalError
from maester_eval.files import read_model, write_text_atomically
from maester_eval.manifest import EvalSet, FilingKind, SetChoice


class ArtefactReadError(EvalError, ValueError):
    """An artefact or a `run.json` that is not UTF-8, not JSON, or not of the form the harness writes."""


class ModelCalls(BaseModel):
    locate: int = 0
    extract: int = 0
    correct: int = 0

    @property
    def total(self) -> int:
        return self.locate + self.extract + self.correct


# What read a run: the extraction workflow's model on the PDF, or the XBRL parser on the paired instances.
RunSource = Literal["pdf", "xbrl"]


class InstanceRead(BaseModel):
    """What `xbrl-read` did with one XBRL instance paired with a results filing, and why it did not use it."""

    model_config = ConfigDict(extra="forbid")

    # `<company-folder>/xbrl/<name>.xml`, relative to the corpus; basis, period and filed come from the pair.
    file: str
    basis: str
    period: str
    filed: str
    sha256: str
    # The format id from `classify_instance`; null when the file could not be read.
    format: str | None
    mapped: bool
    used: bool
    # `XBRL_UNREADABLE:<reason code>`, `XBRL_PAIR_COMPANY`, `XBRL_PAIR_PERIOD`, `XBRL_PAIR_BASIS` or `XBRL_FORMAT_UNMAPPED`.
    reason: str | None
    # `complete` or `partial` for an instance that was read, null for one that was not used.
    state: str | None
    facts: int
    # Codes only: a message of the reader can name an element.
    warnings: list[str]


class ArtefactError(BaseModel):
    """The error of a filing the workflow could not read, as its artefact keeps it. Not an exception: see `ArtefactReadError`."""

    code: str
    retryable: bool
    message: str


class Artefact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing_id: str
    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet
    stratum: str | None
    printed_pages_per_page: int
    pipeline_version: str
    prompt_version: str
    model: str
    started_at: str
    seconds: float
    bytes: int
    model_calls: ModelCalls
    # 0-based pages of the PDF with no text layer (scans). Empty for an unreadable file.
    pages_without_text: list[int]
    result: dict | None
    error: ArtefactError | None
    # An XBRL artefact reads no PDF: its facts come from the paired instances, each one's use recorded here.
    source: RunSource = "pdf"
    instances: list[InstanceRead] = []


class RunRecord(BaseModel):
    """The keys of `run.json` the harness reads, to check their types. A run made by an earlier version of the
    harness may lack one, so each may be absent; a key the harness does not read is kept as it is."""

    model_config = ConfigDict(extra="allow")

    run: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    set: SetChoice | None = None
    pipeline_version: str | None = None
    prompt_version: str | None = None
    model: str | None = None
    filings: list[str] | None = None
    # An XBRL run says so, with the parser and map versions it read under. A run without `source` is a PDF run.
    source: RunSource | None = None
    parser_version: str | None = None
    map_version: str | None = None


def artefact_path(run_dir: Path, filing_id: str) -> Path:
    return run_dir / "artefacts" / f"{filing_id}.json"


def write_artefact(run_dir: Path, artefact: Artefact) -> Path:
    path = artefact_path(run_dir, artefact.filing_id)
    write_text_atomically(path, json.dumps(artefact.model_dump(mode="json"), ensure_ascii=False, indent=1))
    return path


def read_artefact(path: Path) -> Artefact:
    """One artefact file. One that is not UTF-8, not JSON or not an artefact is an `ArtefactReadError` naming the path."""
    return read_model(path, Artefact, ArtefactReadError, "artefact")


def read_artefacts(run_dir: Path) -> list[Artefact]:
    folder = run_dir / "artefacts"
    if not folder.is_dir():
        return []
    found = [read_artefact(p) for p in folder.rglob("*.json")]
    # By id, not by path: as text `tata-steel/…` sorts before `tata/…` ("-" is below "/"); as path parts it sorts after.
    return sorted(found, key=lambda artefact: artefact.filing_id)


def write_run(run_dir: Path, record: dict) -> None:
    write_text_atomically(run_dir / "run.json", json.dumps(record, indent=1))


def read_run(run_dir: Path) -> dict:
    """`run.json` as it was written. A folder without one is a `FileNotFoundError`. A `run.json` that is not UTF-8,
    not JSON, not an object or holds a key of the wrong type is an `ArtefactReadError` naming the path."""
    return read_model(run_dir / "run.json", RunRecord, ArtefactReadError, "run.json").model_dump(exclude_unset=True)
