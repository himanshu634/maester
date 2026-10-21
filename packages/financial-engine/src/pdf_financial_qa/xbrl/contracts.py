"""The extractor's ``/v1/xbrl`` wire format. Mirrors ``packages/contracts/src/xbrl.ts``.

Both definitions validate the golden fixtures in ``packages/contracts/fixtures/xbrl``, so they cannot drift apart.
The models are read through the ``TypeAdapter`` below, as ``workflow.contracts.EXTRACTOR_EVENT`` is: ``XBRL_EVENT``
for a line of the response stream, ``XBRL_PDF_CHECK_REQUEST`` and ``XBRL_PDF_CHECK_RESULT`` for the PDF check.

``to_xbrl_classification`` and ``to_xbrl_read_result`` turn what ``classify_instance`` and ``read_instance`` answer
into these models; the route sends them. ``XbrlFormat`` here is the wire object: ``formats.XbrlFormat`` is the
dataclass the parser works with, and the two are converted by hand, never one imported as the other.
"""

from dataclasses import asdict
from datetime import date
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, TypeAdapter, field_validator

from pdf_financial_qa.classify.contracts import EvidenceField, ResultsSpan, StatementFound
from pdf_financial_qa.workflow.contracts import (
    DecimalStr,
    ExtractedCheck,
    ExtractionWarning,
    FactFields,
    ReportingBasis,
    StatementKind,
    WireModel,
)
from pdf_financial_qa.workflow.values import format_decimal

from . import XBRL_MAP_VERSION, XBRL_PARSER_VERSION, XBRL_PDF_CHECK_VERSION
from .classify import XbrlClassificationData
from .formats import Family, FormatKind
from .formats import XbrlFormat as FormatData
from .periods import Span
from .read import XbrlReadData

# The same 8-4-4-4-12 shape Zod's ``z.uuid()`` takes (RFC 9562 versions 1-8, and the nil and max UUIDs).
UuidStr = Annotated[
    str,
    StringConstraints(
        pattern=(
            r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
            r"|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        )
    ),
]

XbrlPdfNotChecked = Literal["no_pdf", "scanned", "no_statement_pages", "disabled", "no_value", "no_unit", "not_yet"]


class XbrlFormat(WireModel):
    family: Family | None
    kind: FormatKind
    id: str | None
    mapped: bool


class XbrlEvidence(WireModel):
    field: EvidenceField
    rule_id: str
    element: str | None
    context: str | None
    quote: Annotated[str, Field(min_length=1, max_length=300)]


class XbrlClassification(WireModel):
    parser_version: str
    map_version: str
    format: XbrlFormat
    kind: Literal["financial_results", "not_sure"]
    results_span: ResultsSpan | None
    period_end: date | None
    period_label: str | None
    company_name_as_printed: str | None
    cin: str | None
    bse_code: str | None
    nse_symbol: str | None
    isin: str | None
    basis: ReportingBasis
    audited: bool | None
    statements_found: list[StatementFound]
    evidence: list[XbrlEvidence]
    warnings: list[ExtractionWarning]


class XbrlFact(FactFields):
    span: Span | None
    period_start: date | None
    element: str
    context_id: str
    decimals: str | None
    nil: bool
    concept: str | None


class XbrlRounding(WireModel):
    word: str
    unit_label: str
    scale: DecimalStr
    exponent: int


class XbrlReadResult(WireModel):
    pipeline_version: Literal["xbrl-1"]
    model: Literal["xbrl-parser-1"]
    prompt_version: str
    format: XbrlFormat
    basis: ReportingBasis
    state: Literal["complete", "partial"]
    rounding: XbrlRounding | None
    coarsest_decimals: int | None
    finest_decimals: int | None
    warnings: list[ExtractionWarning]
    facts: list[XbrlFact]
    checks: list[ExtractedCheck]


class XbrlTextBlock(WireModel):
    element: str
    context_id: str
    heading: str
    text: str


class XbrlTextResult(WireModel):
    text_version: Literal["1"]
    basis: ReportingBasis
    blocks: list[XbrlTextBlock]


class XbrlStartedEvent(WireModel):
    type: Literal["started"] = "started"
    parser_version: str
    map_version: str
    mode: Literal["classify", "read", "text"]


class XbrlHeartbeatEvent(WireModel):
    type: Literal["heartbeat"] = "heartbeat"


class XbrlClassificationEvent(WireModel):
    type: Literal["classification"] = "classification"
    result: XbrlClassification


class XbrlReadEvent(WireModel):
    type: Literal["read"] = "read"
    result: XbrlReadResult


class XbrlTextEvent(WireModel):
    type: Literal["text"] = "text"
    result: XbrlTextResult


class XbrlErrorEvent(WireModel):
    type: Literal["error"] = "error"
    code: str
    retryable: bool
    message: str


XbrlEvent = Annotated[
    XbrlStartedEvent | XbrlHeartbeatEvent | XbrlClassificationEvent | XbrlReadEvent | XbrlTextEvent | XbrlErrorEvent,
    Field(discriminator="type"),
]
XBRL_EVENT = TypeAdapter(XbrlEvent)


class XbrlPdfCheckFact(WireModel):
    fact_id: UuidStr
    value: DecimalStr | None  # the normalized value, in full rupees
    per_share: bool
    statement: StatementKind
    basis: ReportingBasis


class XbrlPdfCheckRequest(WireModel):
    scale: DecimalStr | None
    places: Annotated[int, Field(ge=0)] | None
    statement_pages: list[StatementFound]
    facts: list[XbrlPdfCheckFact]


class XbrlPdfCheckOutcome(WireModel):
    fact_id: UuidStr
    status: Literal["passed", "failed", "not_checked"]
    page_index: Annotated[int, Field(ge=0)] | None
    reason: XbrlPdfNotChecked | None


class XbrlPdfCheckResult(WireModel):
    check_version: Annotated[int, Field(strict=True)]
    results: list[XbrlPdfCheckOutcome]

    @field_validator("check_version")
    @classmethod
    def _is_the_current_version(cls, value: int) -> int:
        """A check of another version is refused, as the Zod twin refuses it, so no row is written under the wrong one."""
        if value != XBRL_PDF_CHECK_VERSION:
            raise ValueError(f"the check version is {XBRL_PDF_CHECK_VERSION}")
        return value


XBRL_PDF_CHECK_REQUEST = TypeAdapter(XbrlPdfCheckRequest)
XBRL_PDF_CHECK_RESULT = TypeAdapter(XbrlPdfCheckResult)


def _format(data: FormatData) -> XbrlFormat:
    return XbrlFormat(family=data.family, kind=data.kind, id=data.id, mapped=data.mapped)


def to_xbrl_classification(data: XbrlClassificationData) -> XbrlClassification:
    """The classification as the wire carries it, stamped with the parser and map versions it was read under."""
    return XbrlClassification(
        parser_version=XBRL_PARSER_VERSION,
        map_version=XBRL_MAP_VERSION,
        format=_format(data.format),
        kind=data.kind,
        results_span=data.results_span,
        period_end=data.period_end,
        period_label=data.period_label,
        company_name_as_printed=data.company_name_as_printed,
        cin=data.cin,
        bse_code=data.bse_code,
        nse_symbol=data.nse_symbol,
        isin=data.isin,
        basis=data.basis,
        audited=data.audited,
        statements_found=data.statements_found,
        evidence=[XbrlEvidence(**asdict(item)) for item in data.evidence],
        warnings=data.warnings,
    )


def to_xbrl_read_result(data: XbrlReadData) -> XbrlReadResult:
    """The read as the wire carries it. Its prompt version is ``<format id>@<map version>``, ``@-`` for a format no
    map reads (and ``unknown`` for an instance in no family)."""
    rounding = data.rounding
    return XbrlReadResult(
        pipeline_version="xbrl-1",
        model="xbrl-parser-1",
        prompt_version=f"{data.format.id or 'unknown'}@{XBRL_MAP_VERSION if data.format.mapped else '-'}",
        format=_format(data.format),
        basis=data.basis,
        state=data.state,
        rounding=None
        if rounding is None
        else XbrlRounding(
            word=rounding.word, unit_label=rounding.unit_label, scale=format_decimal(rounding.scale), exponent=rounding.exponent
        ),
        coarsest_decimals=data.coarsest_decimals,
        finest_decimals=data.finest_decimals,
        warnings=data.warnings,
        facts=[XbrlFact(**asdict(fact)) for fact in data.facts],
        checks=data.checks,
    )
