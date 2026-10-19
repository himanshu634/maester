"""One filing's extraction as the harness keeps it: the extractor's wire result or its
error, with timings and model call counts. Phase 1's replay mode reads these, so the
result is `ExtractionResult.to_wire()` unchanged (camelCase field names).

A file the readers cannot read is an `ArtefactReadError` that names the file and nothing
in it: the text of a JSON or validation error repeats what the file holds, which can be a
label or a figure of the filing."""

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from maester_eval.files import write_text_atomically
from maester_eval.manifest import EvalSet, FilingKind, SetChoice


class ArtefactReadError(ValueError):
    """An artefact or a `run.json` that is not UTF-8, not JSON, or not of the form the harness writes."""


class ModelCalls(BaseModel):
    locate: int = 0
    extract: int = 0
    correct: int = 0

    @property
    def total(self) -> int:
        return self.locate + self.extract + self.correct


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


def artefact_path(run_dir: Path, filing_id: str) -> Path:
    return run_dir / "artefacts" / f"{filing_id}.json"


def write_artefact(run_dir: Path, artefact: Artefact) -> Path:
    path = artefact_path(run_dir, artefact.filing_id)
    write_text_atomically(path, json.dumps(artefact.model_dump(mode="json"), ensure_ascii=False, indent=1))
    return path


def read_artefact(path: Path) -> Artefact:
    """One artefact file. One that is not UTF-8, not JSON or not an artefact is an `ArtefactReadError` naming the path."""
    try:
        return Artefact.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
        raise ArtefactReadError(f"{path} is not a readable artefact") from None


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
    path = run_dir / "run.json"
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        RunRecord.model_validate(record)
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError):
        raise ArtefactReadError(f"{path} is not a readable run.json") from None
    return record
