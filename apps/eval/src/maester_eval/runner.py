"""Live mode: run the extraction workflow over corpus filings and keep an artefact per filing.

The workflow runs in-process with the same model the extractor builds from the same
variables, so a run measures the configuration the product runs, and the harness can
count model calls, which the wire format does not carry.
"""

from collections.abc import Callable
from datetime import datetime, timezone
import os
from pathlib import Path
import threading
import time

from pdf_financial_qa.workflow import PIPELINE_VERSION, ExtractionError, ExtractionModel, WorkflowSettings, run_extraction
from pdf_financial_qa.workflow.model import ExtractedSection, LocateOutput, StatementOutput
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

from maester_eval.artefacts import Artefact, ArtefactError, ModelCalls, write_artefact, write_run
from maester_eval.manifest import Filing, SetChoice

ModelFactory = Callable[[], ExtractionModel]
Log = Callable[[str], None]


class EvalConfigError(RuntimeError):
    pass


class CountingModel:
    """Counts the workflow's calls on the real model. Thread-safe: statement branches run in parallel."""

    def __init__(self, inner: ExtractionModel) -> None:
        self._inner = inner
        self.name = inner.name
        self.calls = ModelCalls()
        self._lock = threading.Lock()

    def _count(self, kind: str) -> None:
        with self._lock:
            setattr(self.calls, kind, getattr(self.calls, kind) + 1)

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput:
        self._count("locate")
        return self._inner.locate(pdf, page_count)

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput:
        self._count("extract")
        return self._inner.extract(pdf, page_count, statement, basis)

    def correct(self, pdf: bytes, page_count: int, statement: str, basis: str,
                section: ExtractedSection, problems: list[str]) -> ExtractedSection:
        self._count("correct")
        return self._inner.correct(pdf, page_count, statement, basis, section, problems)


def pages_without_text(pdf: bytes) -> list[int]:
    """0-based pages with no text layer; empty when the file cannot be opened at all."""
    try:
        doc = PdfDocument.load(pdf)
    except ExtractionError:
        return []
    return [i for i, text in enumerate(doc.page_texts) if not text.strip()]


def run_filing(filing: Filing, pdf: bytes, model_factory: ModelFactory, settings: WorkflowSettings) -> Artefact:
    started = datetime.now(timezone.utc)
    clock = time.monotonic()
    model = CountingModel(model_factory())
    result = error = None
    try:
        result = run_extraction(pdf, model=model, company_name=filing.company, settings=settings).to_wire()
    except ExtractionError as exc:
        error = ArtefactError(code=exc.code, retryable=exc.retryable, message=exc.message)
    return Artefact(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
        period_end=filing.period_end, set=filing.set, stratum=filing.stratum,
        printed_pages_per_page=filing.printed_pages_per_page,
        pipeline_version=PIPELINE_VERSION, prompt_version=PROMPT_VERSION, model=model.name,
        started_at=started.isoformat(), seconds=round(time.monotonic() - clock, 1), bytes=len(pdf),
        model_calls=model.calls, pages_without_text=pages_without_text(pdf), result=result, error=error,
    )


def run_live(filings: list[Filing], corpus: Path, run_dir: Path, model_factory: ModelFactory,
             settings: WorkflowSettings, eval_set: SetChoice, log: Log = print) -> list[Artefact]:
    """Reads each filing in turn and writes its artefact as soon as it is done, so a run
    stopped half-way keeps what it read. The console gets ids, outcomes and counts only."""
    record = {
        "run": run_dir.name, "started_at": datetime.now(timezone.utc).isoformat(), "set": eval_set,
        "pipeline_version": PIPELINE_VERSION, "prompt_version": PROMPT_VERSION,
        "settings": {"deadline_seconds": settings.deadline_seconds, "max_model_calls": settings.max_model_calls},
        "filings": [f.id for f in filings],
    }
    write_run(run_dir, record)
    artefacts: list[Artefact] = []
    for filing in filings:
        log(f"{filing.id}: reading…")
        artefact = run_filing(filing, (corpus / filing.file).read_bytes(), model_factory, settings)
        write_artefact(run_dir, artefact)
        outcome = artefact.result["state"] if artefact.result else artefact.error.code
        log(f"{filing.id}: {outcome} in {artefact.seconds}s, {artefact.model_calls.total} model calls")
        artefacts.append(artefact)
    record["finished_at"] = datetime.now(timezone.utc).isoformat()
    record["model"] = artefacts[0].model if artefacts else None
    write_run(run_dir, record)
    return artefacts


def gemini_model_factory() -> ModelFactory:
    """The model the extractor runs, from the same variables (apps/extractor settings.py)."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise EvalConfigError("GOOGLE_CLOUD_PROJECT is not set; copy .env.example to .env and fill it in")
    location = os.environ.get("VERTEX_LOCATION") or "us-central1"
    model_name = os.environ.get("GEMINI_MODEL") or "gemini-2.5-pro"
    from pdf_financial_qa.workflow.model import GeminiExtractionModel

    instance = GeminiExtractionModel(project=project, location=location, model=model_name)
    return lambda: instance


def workflow_settings_from_env() -> WorkflowSettings:
    try:
        return WorkflowSettings(deadline_seconds=float(os.environ.get("EXTRACT_DEADLINE_SECONDS", "840")))
    except ValueError as exc:
        raise EvalConfigError(f"EXTRACT_DEADLINE_SECONDS: {exc}") from None
