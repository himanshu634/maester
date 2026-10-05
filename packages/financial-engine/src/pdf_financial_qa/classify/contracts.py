"""Classifier wire format. Mirrors ``packages/contracts/src/classification.ts``.

Both definitions validate the golden fixtures in
``packages/contracts/fixtures/classification``, so they cannot drift apart.
"""

from datetime import date
from typing import Annotated, Literal, Union

from pydantic import Field, TypeAdapter

from pdf_financial_qa.workflow.contracts import ExtractionWarning, ReportingBasis, StatementKind, WireModel

Kind = Literal["annual_report", "financial_results", "other", "not_sure"]
OtherType = Literal[
    "shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
    "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type",
]
ResultsSpan = Literal["quarter", "half_year", "nine_months", "full_year"]
EvidenceField = Literal["kind", "other_type", "company", "identifier", "period", "results_span", "statements"]


class Evidence(WireModel):
    field: EvidenceField
    source: Literal["rule", "model"]
    rule_id: str | None
    page_index: Annotated[int, Field(ge=0)]
    quote: Annotated[str, Field(min_length=1, max_length=300)]
    text_layer_match: bool | None


class StatementFound(WireModel):
    statement: StatementKind
    basis: ReportingBasis
    pages: list[Annotated[int, Field(ge=0)]]


class ClassificationResult(WireModel):
    rules_version: str
    model: str | None
    prompt_version: str | None
    page_count: Annotated[int, Field(ge=1)]
    kind: Kind
    other_type: OtherType | None
    results_span: ResultsSpan | None
    period_end: date | None
    period_label: str | None
    company_name_as_printed: str | None
    cin: str | None
    bse_code: str | None
    nse_symbol: str | None
    statements_found: list[StatementFound]
    evidence: list[Evidence]
    warnings: list[ExtractionWarning]


class ClassifyResult(WireModel):
    type: Literal["result"] = "result"
    result: ClassificationResult


class ClassifyError(WireModel):
    type: Literal["error"] = "error"
    code: str
    retryable: bool
    message: str


CLASSIFY_RESPONSE = TypeAdapter(Annotated[Union[ClassifyResult, ClassifyError], Field(discriminator="type")])
