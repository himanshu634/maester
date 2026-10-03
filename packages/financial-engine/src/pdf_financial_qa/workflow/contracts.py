"""Extractor wire format. Mirrors ``packages/contracts/src/extraction.ts``.

Both definitions validate the golden fixtures in
``packages/contracts/fixtures/extraction``, so they cannot drift apart.
"""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter
from pydantic.alias_generators import to_camel

StatementKind = Literal["balance_sheet", "income_statement", "cash_flow"]
ReportingBasis = Literal["consolidated", "standalone", "unknown"]
ValueStatus = Literal["value", "dash", "unparsed"]
DecimalStr = Annotated[str, StringConstraints(pattern=r"^-?\d+(\.\d+)?$")]


class WireModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def to_wire(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class ExtractionWarning(WireModel):
    code: str
    message: str


class CoverageEntry(WireModel):
    statement: StatementKind
    basis: ReportingBasis
    pages: list[Annotated[int, Field(ge=0)]]
    status: Literal["extracted", "failed"]
    message: str | None = None


class ExtractedFact(WireModel):
    statement: StatementKind
    basis: ReportingBasis
    section: str
    line_order: Annotated[int, Field(ge=0)]
    reported_label: str
    is_subtotal: bool
    component_labels: list[str]
    period_label: str
    period_end: date | None
    as_of_date: date | None
    reported_text: str
    reported_value: DecimalStr | None
    value_status: ValueStatus
    unit_label: str | None
    scale_factor: DecimalStr | None
    currency: str | None
    normalized_value: DecimalStr | None
    page_index: Annotated[int, Field(ge=0)]
    text_layer_match: bool | None


class ExtractedCheck(WireModel):
    check_type: Literal["subtotal", "balance_identity"]
    statement: StatementKind
    basis: ReportingBasis
    section: str | None
    period_label: str
    subject_label: str
    status: Literal["passed", "failed", "not_checked"]
    expected: DecimalStr | None
    actual: DecimalStr | None
    detail: str


class ExtractionResult(WireModel):
    pipeline_version: str
    model: str
    prompt_version: str
    page_count: Annotated[int, Field(ge=1)]
    company_name_as_printed: str | None
    state: Literal["complete", "partial"]
    coverage: list[CoverageEntry]
    warnings: list[ExtractionWarning]
    facts: list[ExtractedFact]
    checks: list[ExtractedCheck]


class StartedEvent(WireModel):
    type: Literal["started"] = "started"
    pipeline_version: str
    model: str
    prompt_version: str


class HeartbeatEvent(WireModel):
    type: Literal["heartbeat"] = "heartbeat"


class ProgressEvent(WireModel):
    type: Literal["progress"] = "progress"
    stage: str
    percent: Annotated[float, Field(ge=0, le=100)]


class ResultEvent(WireModel):
    type: Literal["result"] = "result"
    result: ExtractionResult


class ErrorEvent(WireModel):
    type: Literal["error"] = "error"
    code: str
    retryable: bool
    message: str


ExtractorEvent = Annotated[
    StartedEvent | HeartbeatEvent | ProgressEvent | ResultEvent | ErrorEvent,
    Field(discriminator="type"),
]
EXTRACTOR_EVENT = TypeAdapter(ExtractorEvent)
