"""The read: an instance's statement lines as facts, with the map's sums and the balance identity as checks.

A fact is written for each numeric fact whose context has no dimension, whose element is a line of the format's
map, and whose unit is money or money per share. It carries its span, period and the unit the instance declares
(``LevelOfRounding``), and its value twice: ``normalized_value`` in full rupees (or a share's rupees), exactly as
written, and ``reported_value`` in the declared unit, padded to the instance's finest ``decimals`` and never
rounded (Departure 12). Nil is unknown, never zero. Every value is a ``Decimal`` built from the file's own text;
nothing here is a float.

The warnings say what the read could not do: ``XBRL_FORMAT_UNMAPPED`` (no map: no facts), ``XBRL_ROUNDING_MISSING``
(no unit for a monetary value: the revision is partial), ``XBRL_ROUNDING_MISMATCH`` (the declared unit is not the
coarsest ``decimals``: partial), ``XBRL_UNIT_UNSUPPORTED``, ``XBRL_ELEMENT_UNMAPPED`` and ``XBRL_NIL``. A message
holds element names, a rounding word and a count, never a value.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from pdf_financial_qa.workflow.contracts import ExtractedCheck, ExtractionWarning, ReportingBasis, StatementKind
from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.workflow.values import format_decimal

from .checks import sum_checks
from .formats import XbrlFormat, detect_format
from .identity import read_identity
from .maps import ElementMap, MapEntry, load_map
from .parser import Context, Instance, RawFact
from .periods import Span, period_label, span_of
from .units import Rounding, UnitInfo, rounding_of, unit_of

# xs:decimal: a sign, digits and a point; no exponent, no NaN, no infinity.
_DECIMAL = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)")
# A ``decimals`` counted as an integer. A wider one (a hostile "999999999") would pad that many zeros.
_INTEGER_DECIMALS = re.compile(r"-?\d{1,3}")


@dataclass(frozen=True, slots=True)
class XbrlFactData:
    """An ``ExtractedFact`` without a page, with where in the instance it came from. ``concept`` is the map's
    concept when the fact was read, stored with the fact (Departure 18)."""

    statement: StatementKind
    basis: ReportingBasis
    section: str
    line_order: int
    reported_label: str
    is_subtotal: bool
    component_labels: list[str]
    period_label: str
    period_end: date | None
    as_of_date: date | None
    reported_text: str
    reported_value: str | None
    value_status: Literal["value", "unparsed"]
    unit_label: str | None
    scale_factor: str | None
    currency: str | None
    normalized_value: str | None
    span: Span | None
    period_start: date | None
    element: str
    context_id: str
    decimals: str | None
    nil: bool
    concept: str | None


@dataclass(frozen=True, slots=True)
class XbrlReadData:
    format: XbrlFormat
    mapped: bool
    basis: ReportingBasis
    rounding: Rounding | None
    coarsest_decimals: int | None
    finest_decimals: int | None
    state: Literal["complete", "partial"]
    warnings: list[ExtractionWarning]
    facts: list[XbrlFactData]
    checks: list[ExtractedCheck]


@dataclass(frozen=True, slots=True)
class _Period:
    """Where a fact sits in time: a duration (``span`` set) or an instant (``as_of_date`` set)."""

    label: str
    period_end: date | None
    period_start: date | None
    as_of_date: date | None
    span: Span | None


@dataclass(frozen=True, slots=True)
class _Line:
    """A fact the read writes, before its value is put in the declared unit."""

    raw: RawFact
    entry: MapEntry
    unit: UnitInfo
    period: _Period
    label: str
    order: int
    concept: str | None


def integer_decimals(decimals: str | None) -> int | None:
    """A fact's ``decimals`` as an integer, or None for ``INF``, none or anything wider than three digits."""
    if decimals is None:
        return None
    text = decimals.strip()
    return int(text) if _INTEGER_DECIMALS.fullmatch(text) else None


def read_instance(instance: Instance) -> XbrlReadData:
    _refuse_dangling_references(instance)
    fmt = detect_format(instance)
    identity = read_identity(instance, fmt.family)
    basis = identity.basis
    rounding = rounding_of(identity.rounding_word)
    coarsest = _coarsest_decimals(instance, rounding)

    warnings: list[ExtractionWarning] = []
    element_map = load_map(fmt.id) if fmt.id is not None else None
    facts: list[XbrlFactData] = []
    finest: int | None = None
    if element_map is None:
        warnings.append(ExtractionWarning(code="XBRL_FORMAT_UNMAPPED", message=fmt.id or "unknown"))
    else:
        lines, unsupported, unmapped = _lines(instance, element_map, rounding)
        monetary = [integer_decimals(line.raw.decimals) for line in lines if line.unit.kind == "monetary"]
        finest = max((d for d in monetary if d is not None), default=None)
        facts = [_fact(line, element_map, basis, rounding, finest) for line in lines]
        if unsupported:
            warnings.append(ExtractionWarning(code="XBRL_UNIT_UNSUPPORTED", message=", ".join(sorted(unsupported))))
        if unmapped:
            warnings.append(ExtractionWarning(code="XBRL_ELEMENT_UNMAPPED", message=", ".join(sorted(unmapped))))
        nil = {fact.element for fact in facts if fact.nil}
        if nil:
            warnings.append(ExtractionWarning(code="XBRL_NIL", message=", ".join(sorted(nil))))

    partial = False
    if rounding is None:
        partial = True
        message = "No level of rounding is declared." if identity.rounding_word is None else "The declared level of rounding is not one Maester can name."
        warnings.append(ExtractionWarning(code="XBRL_ROUNDING_MISSING", message=message))
    elif coarsest is not None and coarsest != rounding.exponent:
        partial = True
        warnings.append(ExtractionWarning(
            code="XBRL_ROUNDING_MISMATCH", message=f"declared {rounding.word}, coarsest decimals {coarsest}"
        ))

    checks = sum_checks(facts, element_map, finest) if element_map is not None else []
    return XbrlReadData(
        format=fmt,
        mapped=fmt.mapped,
        basis=basis,
        rounding=rounding,
        coarsest_decimals=coarsest,
        finest_decimals=finest,
        state="partial" if partial else "complete",
        warnings=warnings,
        facts=facts,
        checks=checks,
    )


def _refuse_dangling_references(instance: Instance) -> None:
    """A fact must name a context, and a unit if it has one, that the file declares (XBRL 2.1). The parser
    reads structure only, so the read checks it, and refuses the file as the parser refuses a broken one."""
    for fact in instance.facts:
        if fact.context_id not in instance.contexts or (fact.unit_id is not None and fact.unit_id not in instance.units):
            raise ExtractionError("XBRL_UNREADABLE", "MALFORMED", retryable=False)


def _coarsest_decimals(instance: Instance, rounding: Rounding | None) -> int | None:
    """The least integer ``decimals`` of every monetary fact, dimensional or not (research §4)."""
    found = [
        decimals
        for fact in instance.facts
        if fact.unit_id is not None
        and unit_of(instance.units[fact.unit_id], rounding).kind == "monetary"
        and (decimals := integer_decimals(fact.decimals)) is not None
    ]
    return min(found, default=None)


def _lines(
    instance: Instance, element_map: ElementMap, rounding: Rounding | None
) -> tuple[list[_Line], set[str], set[str]]:
    """The lines the read writes, in document order, and the elements of mapped lines in another unit and the
    numeric elements that are neither a line nor ignored. A cash balance is written into the cash-flow durations it
    opens or closes, in place of the instant it is (Departure 13)."""
    lines: list[_Line] = []
    balances: list[tuple[RawFact, MapEntry, UnitInfo, Context]] = []
    unsupported: set[str] = set()
    unmapped: set[str] = set()
    for raw in instance.facts:
        if raw.unit_id is None:
            continue
        context = instance.contexts[raw.context_id]
        if context.dimensional:
            continue
        entry = element_map.entry(raw.element)
        if entry is None:
            if raw.element not in element_map.ignored:
                unmapped.add(raw.element)
            continue
        unit = unit_of(instance.units[raw.unit_id], rounding)
        if unit.kind == "other":
            unsupported.add(raw.element)
            continue
        if entry.cash_balance is not None:
            if context.instant is not None:
                balances.append((raw, entry, unit, context))
            continue
        period = _period_of(context)
        if period is None:  # a forever context has no period to place a figure in
            continue
        lines.append(_Line(raw, entry, unit, period, entry.label, entry.order, entry.concept))

    durations: list[_Period] = []
    for line in lines:
        if line.entry.statement == "cash_flow" and line.period.span is not None and line.period not in durations:
            durations.append(line.period)
    for raw, entry, unit, context in balances:
        block = entry.cash_balance
        for duration in durations:
            if context.instant == duration.period_start - timedelta(days=1):
                lines.append(_Line(raw, entry, unit, duration, block.opening_label, block.opening_order, block.opening_concept))
            if context.instant == duration.period_end:
                lines.append(_Line(raw, entry, unit, duration, block.closing_label, block.closing_order, block.closing_concept))
    lines.sort(key=lambda line: line.raw.order)  # stable: a balance's opening and closing keep their order
    return lines, unsupported, unmapped


def _period_of(context: Context) -> _Period | None:
    if context.instant is not None:
        return _Period(period_label(None, context.instant), None, None, context.instant, None)
    if context.start is not None and context.end is not None:
        span = span_of(context.start, context.end)
        return _Period(period_label(span, context.end), context.end, context.start, None, span)
    return None


def _fact(line: _Line, element_map: ElementMap, basis: ReportingBasis, rounding: Rounding | None, finest: int | None) -> XbrlFactData:
    raw, unit = line.raw, line.unit
    text = raw.text.strip()
    value = Decimal(text) if not raw.nil and _DECIMAL.fullmatch(text) else None
    normalized = format_decimal(value) if value is not None else None
    reported: str | None = None
    if value is not None:
        if unit.kind == "per_share":
            reported = normalized
        elif rounding is not None:
            places = max(0, finest - rounding.exponent) if finest is not None else 0
            reported = format_decimal(_in_unit(value, rounding.exponent, places))
    return XbrlFactData(
        statement=line.entry.statement,
        basis=basis,
        section=line.entry.section,
        line_order=line.order,
        reported_label=line.label,
        is_subtotal=bool(element_map.sums_with_total(raw.element)),
        component_labels=element_map.labels_of_parts(raw.element),
        period_label=line.period.label,
        period_end=line.period.period_end,
        as_of_date=line.period.as_of_date,
        reported_text=text,
        reported_value=reported,
        value_status="value" if value is not None else "unparsed",
        unit_label=unit.unit_label,
        scale_factor=format_decimal(unit.scale) if unit.scale is not None else None,
        currency=unit.currency,
        normalized_value=normalized,
        span=line.period.span,
        period_start=line.period.period_start,
        element=raw.element,
        context_id=raw.context_id,
        decimals=raw.decimals.strip() if raw.decimals is not None else None,
        nil=raw.nil,
        concept=line.concept,
    )


def _in_unit(value: Decimal, exponent: int, places: int) -> Decimal:
    """``value`` divided by 10^(−exponent), with at least ``places`` places: the trailing zeros the division
    leaves are dropped and zeros are added up to ``places``. Built from the digits, so it is exact whatever the
    number of digits, and nothing is rounded."""
    sign, digits, power = value.as_tuple()
    digits, power = list(digits), power + exponent
    if not any(digits):  # zero, however it is written ("0.00", "-0"), is plain zero before it is padded
        sign, digits, power = 0, [0], 0
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        power += 1
    if power > -places:
        digits += [0] * (power + places)
        power = -places
    return Decimal((sign, tuple(digits), power))
