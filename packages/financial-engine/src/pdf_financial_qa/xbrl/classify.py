"""What an XBRL instance is, answered from its own facts with no model.

``classify_instance`` gives the answers a PDF's classification gives, from the same elements every time:
the format (from the numeric elements), the company's identifiers, the basis, and the period and span from
the reporting period's dates. Each answer carries evidence: the element and context it was read from and the
text it said. The word the instance writes for its period (``ReportingQuarter``) is never read.

A rejected answer has no evidence: a symbol that is ``NOTLISTED`` or the wrong shape, a code that is not six
digits. The kind's evidence is the family; an instance in no known family has none, because there is no
name to quote. ``cin`` is always None: no format on hand carries one. ``statements_found`` is filled from
the format's element map: a statement is found when the instance has a figure for one of its lines, in a
context without a dimension, and it has the instance's basis and no pages (an instance has none). A format
with no map (banking, NBFC, an unknown family) finds none.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pdf_financial_qa.classify.contracts import EvidenceField, ResultsSpan, StatementFound
from pdf_financial_qa.workflow.contracts import ExtractionWarning, ReportingBasis

from .formats import XbrlFormat, detect_format
from .identity import Identity, identity_facts, latest_period_end, parse_iso_date, read_identity
from .maps import STATEMENTS, load_map
from .parser import Instance, RawFact
from .periods import period_label, span_of, to_results_span

_QUOTE_MAX = 300
_BSE_CODE = re.compile(r"[0-9]{6}")
_NSE_SYMBOL = re.compile(r"[A-Z][A-Z0-9&-]{0,19}")
_ISIN = re.compile(r"[A-Z]{2}[A-Z0-9]{9}[0-9]")
_NOT_LISTED = "NOTLISTED"

_MIXED_BASIS = "The instance states both bases, or neither."


@dataclass(frozen=True, slots=True)
class XbrlEvidenceData:
    """Where one answer came from. ``element`` and ``context`` are None when it came from no fact."""

    field: EvidenceField
    rule_id: str
    element: str | None
    context: str | None
    quote: str


@dataclass(frozen=True, slots=True)
class XbrlClassificationData:
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
    evidence: list[XbrlEvidenceData]
    warnings: list[ExtractionWarning]


def classify_instance(instance: Instance) -> XbrlClassificationData:
    fmt = detect_format(instance)
    identity = read_identity(instance, fmt.family)
    facts = identity_facts(instance, fmt.family)

    span = (
        span_of(identity.period_start, identity.period_end)
        if identity.period_start is not None and identity.period_end is not None
        else None
    )
    results_span = to_results_span(span)
    label = period_label(span, identity.period_end) if span is not None and identity.period_end is not None else None

    bse_code = _shaped(identity.scrip_code, _BSE_CODE)
    nse_symbol = _shaped(identity.symbol, _NSE_SYMBOL)
    if nse_symbol == _NOT_LISTED:
        nse_symbol = None
    isin = _shaped(identity.isin, _ISIN)

    def evidence(field: EvidenceField, key: str, answered: bool) -> list[XbrlEvidenceData]:
        if not answered:
            return []
        fact = facts[key][0]
        return [XbrlEvidenceData(field, f"xbrl.identity.{key}", fact.element, fact.context_id, _quote(fact.text))]

    proof: list[XbrlEvidenceData] = []
    if fmt.family is not None:
        proof.append(XbrlEvidenceData("kind", "xbrl.family", None, None, fmt.family))
    proof += evidence("company", "name", identity.name is not None)
    proof += evidence("identifier", "scrip_code", bse_code is not None)
    proof += evidence("identifier", "symbol", nse_symbol is not None)
    proof += evidence("identifier", "isin", isin is not None)
    proof += evidence("statements", "basis", identity.basis != "unknown")
    proof += _period_end_evidence(instance, identity, facts)
    proof += evidence("results_span", "period_start", results_span is not None)

    warnings: list[ExtractionWarning] = []
    if identity.mixed_basis:
        warnings.append(ExtractionWarning(code="XBRL_MIXED_BASIS", message=_MIXED_BASIS))
    if not fmt.mapped:
        warnings.append(ExtractionWarning(code="XBRL_FORMAT_UNMAPPED", message=fmt.id or "unknown"))

    return XbrlClassificationData(
        format=fmt,
        kind="financial_results" if fmt.family is not None and not identity.mixed_basis else "not_sure",
        results_span=results_span,
        period_end=identity.period_end,
        period_label=label,
        company_name_as_printed=identity.name,
        cin=None,
        bse_code=bse_code,
        nse_symbol=nse_symbol,
        isin=isin,
        basis=identity.basis,
        audited=identity.audited,
        statements_found=_statements_found(instance, fmt, identity.basis),
        evidence=proof,
        warnings=warnings,
    )


def _statements_found(instance: Instance, fmt: XbrlFormat, basis: ReportingBasis) -> list[StatementFound]:
    """The statements the map's lines show up in, in the order income statement, balance sheet, cash flow.
    A nil fact, an empty one, one with no unit (text) and one with a member are not a figure of a line."""
    element_map = load_map(fmt.id) if fmt.id is not None else None
    if element_map is None:
        return []
    found = set()
    for fact in instance.facts:
        if fact.nil or fact.unit_id is None or not fact.text.strip():
            continue
        entry = element_map.entry(fact.element)
        context = instance.contexts.get(fact.context_id)
        if entry is not None and context is not None and not context.dimensional:
            found.add(entry.statement)
    return [StatementFound(statement=statement, basis=basis, pages=[]) for statement in STATEMENTS if statement in found]


def _shaped(value: str | None, shape: re.Pattern[str]) -> str | None:
    return value if value is not None and shape.fullmatch(value) else None


def _quote(text: str) -> str:
    return text.strip()[:_QUOTE_MAX]


def _period_end_evidence(instance: Instance, identity: Identity, facts: dict[str, tuple[RawFact, ...]]) -> list[XbrlEvidenceData]:
    """The period end was read from its own fact, or else taken from the latest context of a numeric fact,
    and then the evidence names that context and the date."""
    if identity.period_end is None:
        return []
    end_facts = facts["period_end"]
    if end_facts and parse_iso_date(end_facts[0].text) is not None:
        fact = end_facts[0]
        return [XbrlEvidenceData("period", "xbrl.identity.period_end", fact.element, fact.context_id, _quote(fact.text))]
    latest = latest_period_end(instance)
    context = latest[1] if latest is not None else None
    return [XbrlEvidenceData("period", "xbrl.period_end.context", None, context, identity.period_end.isoformat())]
