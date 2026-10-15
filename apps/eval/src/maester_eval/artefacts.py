"""One filing's extraction as the harness keeps it: the extractor's wire result or its
error, with timings and model call counts. Phase 1's replay mode reads these, so the
result is `ExtractionResult.to_wire()` unchanged (camelCase field names)."""

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from maester_eval.manifest import EvalSet, FilingKind


class ModelCalls(BaseModel):
    locate: int = 0
    extract: int = 0
    correct: int = 0

    @property
    def total(self) -> int:
        return self.locate + self.extract + self.correct


class ArtefactError(BaseModel):
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


def artefact_path(run_dir: Path, filing_id: str) -> Path:
    return run_dir / "artefacts" / f"{filing_id}.json"


def write_artefact(run_dir: Path, artefact: Artefact) -> Path:
    path = artefact_path(run_dir, artefact.filing_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artefact.model_dump(mode="json"), ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def read_artefacts(run_dir: Path) -> list[Artefact]:
    folder = run_dir / "artefacts"
    if not folder.is_dir():
        return []
    found = [Artefact.model_validate(json.loads(p.read_text(encoding="utf-8"))) for p in folder.rglob("*.json")]
    # By id, not by path: as text `tata-steel/…` sorts before `tata/…` ("-" is below "/"); as path parts it sorts after.
    return sorted(found, key=lambda artefact: artefact.filing_id)


def write_run(run_dir: Path, record: dict) -> None:
    (run_dir / "run.json").write_text(json.dumps(record, indent=1), encoding="utf-8")


def read_run(run_dir: Path) -> dict:
    return json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
