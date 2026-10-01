"""The LangGraph extraction workflow and its entry point, ``run_extraction``.

    prepare → locate → statement (one branch per located statement, in parallel) → assemble

Each statement branch is its own subgraph so its correction budget is its own:

    extract → check ─┬─► done
                     └─► correct → check   (failed check, attempts < max_corrections)
"""

import operator
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy, Send

from pdf_financial_qa.workflow.contracts import (
    CoverageEntry,
    ExtractedCheck,
    ExtractedFact,
    ExtractionResult,
    ExtractionWarning,
)
from pdf_financial_qa.workflow.drafts import (
    Check,
    DraftLine,
    DraftSection,
    DraftValue,
    StatementDraft,
    check_statement,
)
from pdf_financial_qa.workflow.errors import ExtractionError, ModelOutputError, is_transient
from pdf_financial_qa.workflow.model import (
    ExtractedLine,
    ExtractedSection,
    ExtractedValue,
    ExtractionModel,
    LocateOutput,
    StatementOutput,
)
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION
from pdf_financial_qa.workflow.values import format_decimal, parse_label_date, same_company, scale_for, text_layer_match

PIPELINE_VERSION = "extract-1"
STATEMENT_ORDER = {"balance_sheet": 0, "income_statement": 1, "cash_flow": 2}
BASIS_ORDER = {"consolidated": 0, "standalone": 1, "unknown": 2}

ProgressCallback = Callable[[str, float], None]


@dataclass(frozen=True)
class WorkflowSettings:
    max_corrections: int = 2
    max_pages_per_statement: int = 6
    chunk_pages: int = 30
    chunk_threshold_pages: int = 60
    inline_limit_bytes: int = 15 * 1024 * 1024
    max_model_calls: int = 40
    deadline_seconds: float = 840
    retry_attempts: int = 3
    retry_initial_interval: float = 1.0


# ---- Budget: call count, deadline and cancellation, shared by parallel branches ----


class _Budget:
    def __init__(self, settings: WorkflowSettings, cancel: threading.Event | None) -> None:
        self._settings = settings
        self._cancel = cancel
        self._deadline = time.monotonic() + settings.deadline_seconds
        self._calls = 0
        self._lock = threading.Lock()

    def spend(self) -> None:
        if self._cancel is not None and self._cancel.is_set():
            raise ExtractionError("CANCELLED", "the request was cancelled", retryable=True)
        if time.monotonic() > self._deadline:
            raise ExtractionError("DEADLINE_EXCEEDED", "extraction exceeded its time budget", retryable=False)
        with self._lock:
            self._calls += 1
            if self._calls > self._settings.max_model_calls:
                raise ExtractionError(
                    "MODEL_CALL_BUDGET_EXCEEDED",
                    f"extraction needed more than {self._settings.max_model_calls} model calls",
                    retryable=False,
                )


class _BudgetedModel:
    def __init__(self, model: ExtractionModel, budget: _Budget) -> None:
        self._model, self._budget, self.name = model, budget, model.name

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput:
        self._budget.spend()
        return self._model.locate(pdf, page_count)

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput:
        self._budget.spend()
        return self._model.extract(pdf, page_count, statement, basis)

    def correct(self, pdf, page_count, statement, basis, section, problems) -> ExtractedSection:
        self._budget.spend()
        return self._model.correct(pdf, page_count, statement, basis, section, problems)


# ---- Graph state ----


@dataclass(frozen=True)
class StatementTask:
    statement: str
    basis: str
    pages: tuple[int, ...]  # 0-based in the original PDF
    rejected: str | None = None


@dataclass(frozen=True)
class BranchResult:
    task: StatementTask
    draft: StatementDraft | None
    checks: tuple[Check, ...]
    warnings: tuple[ExtractionWarning, ...]
    error: str | None = None
    error_retryable: bool = False


class RunState(TypedDict, total=False):
    pdf: bytes
    company_name: str | None
    doc: PdfDocument
    company_name_as_printed: str | None
    tasks: list[StatementTask]
    warnings: Annotated[list[ExtractionWarning], operator.add]
    results: Annotated[list[BranchResult], operator.add]
    result: ExtractionResult


class BranchState(TypedDict, total=False):
    doc: PdfDocument
    task: StatementTask
    draft: StatementDraft
    checks: list[Check]
    attempts: int
    warnings: Annotated[list[ExtractionWarning], operator.add]


# ---- Helpers ----


def _map_page(page: int, pages: tuple[int, ...]) -> int:
    if len(pages) == 1:
        return pages[0]
    if 1 <= page <= len(pages):
        return pages[page - 1]
    raise ModelOutputError(f"line on page {page} of a {len(pages)}-page excerpt")


def _draft_section(section: ExtractedSection, pages: tuple[int, ...]) -> DraftSection:
    lines = []
    for line in section.lines:
        values = tuple(DraftValue.from_text(v.period.strip(), v.text) for v in line.values if v.text.strip())
        lines.append(DraftLine(
            label=line.label.strip(), page_index=_map_page(line.page, pages), is_subtotal=line.is_subtotal,
            component_labels=tuple(label.strip() for label in line.component_labels), values=values,
        ))
    return DraftSection(name=section.name.strip(), lines=tuple(lines))


def _as_extracted(section: DraftSection, pages: tuple[int, ...]) -> ExtractedSection:
    return ExtractedSection(name=section.name, lines=[
        ExtractedLine(label=line.label, page=pages.index(line.page_index) + 1, is_subtotal=line.is_subtotal,
                      component_labels=list(line.component_labels),
                      values=[ExtractedValue(period=v.period, text=v.text) for v in line.values])
        for line in section.lines
    ])


def _rejected_correction(doc: PdfDocument, before: DraftSection, after: DraftSection) -> str | None:
    """Why a corrected section must not replace the original, or None to accept it.

    A value the correction changed or added has to be printed on its page when
    the page has a text layer, so a re-read can fix a misreading but never
    invent a number that makes the totals agree.
    """
    if not after.lines:
        return "the correction returned no line items"
    original = {(line.label, v.period): v.text for line in before.lines for v in line.values}
    for line in after.lines:
        for value in line.values:
            if original.get((line.label, value.period)) == value.text or value.status != "value":
                continue
            if text_layer_match(doc.page_texts[line.page_index], value.value) is False:
                return f"corrected value {value.text!r} for {line.label!r} ({value.period}) is not on page {line.page_index + 1}"
    return None


def _call_with_retries(fn: Callable[[], Any], settings: WorkflowSettings) -> Any:
    delay = settings.retry_initial_interval
    for attempt in range(1, settings.retry_attempts + 1):
        try:
            return fn()
        except Exception as exc:
            if attempt == settings.retry_attempts or not is_transient(exc):
                raise
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")  # pragma: no cover


# ---- Graphs ----


def _branch_graph(model: _BudgetedModel, settings: WorkflowSettings, retry: RetryPolicy):
    def extract(state: BranchState) -> dict:
        doc, task = state["doc"], state["task"]
        out = model.extract(doc.subset(list(task.pages)), len(task.pages), task.statement, task.basis)
        if not out.sections:
            raise ModelOutputError("no sections were read")
        draft = StatementDraft(
            statement=task.statement, basis=task.basis, pages=task.pages,
            currency=(out.currency or "").strip() or None, unit_label=(out.unit_label or "").strip() or None,
            sections=tuple(_draft_section(s, task.pages) for s in out.sections),
        )
        return {"draft": draft, "attempts": 0}

    def check(state: BranchState) -> dict:
        return {"checks": check_statement(state["draft"])}

    def problems_by_section(state: BranchState) -> dict[str, list[str]]:
        names = {s.name for s in state["draft"].sections}
        out: dict[str, list[str]] = {}
        for c in state["checks"]:
            if c.status == "failed":
                for name in c.sections_involved:
                    if name in names:
                        out.setdefault(name, []).append(c.as_problem())
        return out

    def route(state: BranchState) -> str:
        if state["attempts"] >= settings.max_corrections or not problems_by_section(state):
            return END
        return "correct"

    def correct(state: BranchState) -> dict:
        doc, task, draft = state["doc"], state["task"], state["draft"]
        warnings: list[ExtractionWarning] = []
        pdf = doc.subset(list(task.pages))
        for name, problems in problems_by_section(state).items():
            index = next(i for i, s in enumerate(draft.sections) if s.name == name)
            before = draft.sections[index]
            try:
                fixed = _call_with_retries(lambda: model.correct(
                    pdf, len(task.pages), task.statement, task.basis, _as_extracted(before, task.pages), problems), settings)
                after = _draft_section(fixed, task.pages)
            except ExtractionError:
                raise
            except Exception as exc:
                warnings.append(ExtractionWarning(code="CORRECTION_FAILED",
                                                  message=f"{task.statement} ({task.basis}) {name}: {type(exc).__name__}"))
                continue
            reason = _rejected_correction(doc, before, after)
            if reason:
                warnings.append(ExtractionWarning(code="CORRECTION_REJECTED", message=f"{task.statement} ({task.basis}) {name}: {reason}"))
                continue
            draft = draft.with_section(index, replace(after, name=before.name))
        return {"draft": draft, "attempts": state["attempts"] + 1, "warnings": warnings}

    graph = StateGraph(BranchState)
    graph.add_node("extract", extract, retry_policy=retry)
    graph.add_node("check", check)
    graph.add_node("correct", correct)
    graph.add_edge(START, "extract")
    graph.add_edge("extract", "check")
    graph.add_conditional_edges("check", route, ["correct", END])
    graph.add_edge("correct", "check")
    return graph.compile()


def _build_graph(model: _BudgetedModel, settings: WorkflowSettings):
    retry = RetryPolicy(max_attempts=settings.retry_attempts, initial_interval=settings.retry_initial_interval,
                        retry_on=is_transient)
    branch = _branch_graph(model, settings, retry)

    def prepare(state: RunState) -> dict:
        return {"doc": PdfDocument.load(state["pdf"])}

    def locate(state: RunState) -> dict:
        doc = state["doc"]
        if len(doc.data) > settings.inline_limit_bytes or doc.page_count > settings.chunk_threshold_pages:
            chunks = doc.chunks(settings.chunk_pages)
        else:
            chunks = [(0, doc.page_count, doc.data)]
        found: dict[tuple[str, str], set[int]] = {}
        company: str | None = None
        warnings: list[ExtractionWarning] = []
        for start, count, pdf in chunks:
            out = model.locate(pdf, count)
            company = company or ((out.company_name or "").strip() or None)
            for located in out.statements:
                valid = [start + p - 1 for p in located.pages if 1 <= p <= count]
                if len(valid) != len(located.pages):
                    warnings.append(ExtractionWarning(
                        code="LOCATE_PAGE_OUT_OF_RANGE",
                        message=f"{located.statement} ({located.basis}): ignored pages outside the document {located.pages}"))
                if valid:
                    found.setdefault((located.statement, located.basis), set()).update(valid)
        if not found:
            raise ExtractionError("NO_STATEMENTS_FOUND", "no financial statements were found in the document", retryable=False)
        tasks = []
        for (statement, basis), pages in sorted(found.items(), key=lambda kv: (STATEMENT_ORDER[kv[0][0]], BASIS_ORDER[kv[0][1]])):
            ordered = tuple(sorted(pages))
            too_many = len(ordered) > settings.max_pages_per_statement
            tasks.append(StatementTask(statement, basis, ordered, rejected=(
                f"located on {len(ordered)} pages; at most {settings.max_pages_per_statement} are supported" if too_many else None)))
        return {"tasks": tasks, "company_name_as_printed": company, "warnings": warnings}

    def fan_out(state: RunState):
        sends = [Send("statement", {"doc": state["doc"], "task": t}) for t in state["tasks"] if not t.rejected]
        return sends or "assemble"

    def statement(payload: dict) -> dict:
        task: StatementTask = payload["task"]
        try:
            out = branch.invoke({"doc": payload["doc"], "task": task, "warnings": []})
        except ExtractionError:
            raise  # budget, deadline and cancellation stop the whole run
        except Exception as exc:
            return {"results": [BranchResult(task=task, draft=None, checks=(), warnings=(),
                                             error=f"{type(exc).__name__}: {str(exc)[:200]}", error_retryable=is_transient(exc))]}
        return {"results": [BranchResult(task=task, draft=out["draft"], checks=tuple(out["checks"]), warnings=tuple(out.get("warnings", [])))]}

    def assemble(state: RunState) -> dict:
        return {"result": _assemble(state, model.name)}

    graph = StateGraph(RunState)
    graph.add_node("prepare", prepare)
    graph.add_node("locate", locate, retry_policy=retry)
    graph.add_node("statement", statement)
    graph.add_node("assemble", assemble)
    graph.add_edge(START, "prepare")
    graph.add_edge("prepare", "locate")
    graph.add_conditional_edges("locate", fan_out, ["statement", "assemble"])
    graph.add_edge("statement", "assemble")
    graph.add_edge("assemble", END)
    return graph.compile()


def _assemble(state: RunState, model_name: str) -> ExtractionResult:
    doc = state["doc"]
    by_task = {r.task: r for r in state.get("results", [])}
    warnings = list(state.get("warnings", []))
    coverage: list[CoverageEntry] = []
    facts: list[ExtractedFact] = []
    checks: list[ExtractedCheck] = []

    for task in state["tasks"]:
        result = by_task.get(task)
        if task.rejected or result is None or result.draft is None:
            message = task.rejected or (result.error if result else "not extracted")
            coverage.append(CoverageEntry(statement=task.statement, basis=task.basis, pages=list(task.pages), status="failed", message=message))
            continue
        coverage.append(CoverageEntry(statement=task.statement, basis=task.basis, pages=list(task.pages), status="extracted"))
        warnings.extend(result.warnings)
        draft = result.draft
        scale = scale_for(draft.unit_label)
        if scale is None:
            warnings.append(ExtractionWarning(code="UNKNOWN_UNIT",
                                              message=f"{task.statement} ({task.basis}): unit {draft.unit_label!r} was not recognised"))
        order = 0
        for section in draft.sections:
            for line in section.lines:
                for value in line.values:
                    facts.append(_fact(doc, draft, section, line, value, order, scale))
                order += 1
        checks.extend(ExtractedCheck(statement=task.statement, basis=task.basis, **c.to_wire_fields()) for c in result.checks)

    if not any(entry.status == "extracted" for entry in coverage):
        retryable = any(r.error_retryable for r in state.get("results", []))
        reasons = "; ".join(f"{e.statement} ({e.basis}): {e.message}" for e in coverage)
        raise ExtractionError("EXTRACTION_FAILED" if retryable else "NO_STATEMENTS_EXTRACTED",
                              f"no statement could be extracted: {reasons}"[:1000], retryable=retryable)

    printed, chosen = state.get("company_name_as_printed"), state.get("company_name")
    if printed and chosen and not same_company(printed, chosen):
        warnings.append(ExtractionWarning(code="COMPANY_NAME_MISMATCH",
                                          message=f"the document names {printed!r}, but it was uploaded for {chosen!r}"))

    return ExtractionResult(
        pipeline_version=PIPELINE_VERSION, model=model_name, prompt_version=PROMPT_VERSION, page_count=doc.page_count,
        company_name_as_printed=printed, state="complete" if all(e.status == "extracted" for e in coverage) else "partial",
        coverage=coverage, warnings=warnings, facts=facts, checks=checks,
    )


def _fact(doc: PdfDocument, draft: StatementDraft, section: DraftSection, line: DraftLine, value: DraftValue,
          order: int, scale: Decimal | None) -> ExtractedFact:
    period_date = parse_label_date(value.period)
    is_balance = draft.statement == "balance_sheet"
    return ExtractedFact(
        statement=draft.statement, basis=draft.basis, section=section.name, line_order=order,
        reported_label=line.label, is_subtotal=line.is_subtotal, component_labels=list(line.component_labels),
        period_label=value.period, period_end=None if is_balance else period_date, as_of_date=period_date if is_balance else None,
        reported_text=value.text, reported_value=format_decimal(value.value) if value.value is not None else None,
        value_status=value.status, unit_label=draft.unit_label,
        scale_factor=format_decimal(scale) if scale is not None else None, currency=draft.currency,
        normalized_value=format_decimal(value.value * scale) if value.value is not None and scale is not None else None,
        page_index=line.page_index, text_layer_match=text_layer_match(doc.page_texts[line.page_index], value.value),
    )


def run_extraction(
    pdf: bytes,
    *,
    model: ExtractionModel,
    company_name: str | None = None,
    on_progress: ProgressCallback | None = None,
    settings: WorkflowSettings = WorkflowSettings(),
    cancel: threading.Event | None = None,
) -> ExtractionResult:
    """Run the workflow over one PDF. Raises ``ExtractionError`` with a stable code on failure."""
    progress = on_progress or (lambda stage, percent: None)
    graph = _build_graph(_BudgetedModel(model, _Budget(settings, cancel)), settings)
    result: ExtractionResult | None = None
    branches, finished = 0, 0
    try:
        for chunk in graph.stream({"pdf": pdf, "company_name": company_name, "warnings": [], "results": []},
                                  stream_mode="updates"):
            for node, update in chunk.items():
                if node == "prepare":
                    progress("prepare", 5)
                elif node == "locate":
                    branches = sum(1 for t in update["tasks"] if not t.rejected)
                    progress("locate", 20)
                elif node == "statement":
                    finished += 1
                    progress("statement", round(20 + 70 * finished / max(branches, 1), 1))
                elif node == "assemble":
                    result = update["result"]
    except ExtractionError:
        raise
    except Exception as exc:
        raise _classify(exc) from exc
    if result is None:  # pragma: no cover - assemble always runs or raises
        raise ExtractionError("EXTRACTION_FAILED", "the workflow ended without a result", retryable=True)
    progress("assemble", 100)
    return result


def _classify(exc: Exception) -> ExtractionError:
    try:
        from google.auth.exceptions import DefaultCredentialsError

        if isinstance(exc, DefaultCredentialsError):
            return ExtractionError("EXTRACTOR_NOT_CONFIGURED", "no Google Cloud credentials are available", retryable=False)
    except ImportError:  # pragma: no cover
        pass
    if is_transient(exc):
        return ExtractionError("MODEL_UNAVAILABLE", f"the model call failed: {type(exc).__name__}", retryable=True)
    return ExtractionError("EXTRACTION_FAILED", f"unexpected {type(exc).__name__}", retryable=True)
