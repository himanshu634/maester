"""Cells: where a fact sits, and whether two figures are the same figure.

A cell is a source-rule slot (`source_rule.slot_key`) plus a concept. The slot carries the company, the filing kind,
the statement, the basis, the period end and the span, so consolidated and standalone never meet, and a quarter never
meets the half year that ends on the same day. A Gemini or gold fact takes its span from its column header
(`periods.span_of_label`); an XBRL fact carries its own. A fact with no date or, off the balance sheet, no span is not
placed (`no_period`, `no_span`): it is never keyed as an instant, and never counted outside a slot.

Two figures agree exactly, or at the coarser of their two precisions (rule `COMPARE_RULE_VERSION`), which is stitch's
`sameFigure`: both values are rounded half away from zero to the coarser power of ten and compared. Decimal only.
"""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Literal, cast

from maester_eval.gold import GoldFact
from maester_eval.periods import span_of_label
from maester_eval.source_rule import Slot, Span, slot_key

__all__ = [
    "COMPARE_RULE_VERSION", "Placed", "gemini_slot", "gold_slot", "printed_exponent", "same_figure", "xbrl_exponent",
    "xbrl_slot",
]

COMPARE_RULE_VERSION = 1

NotPlaced = Literal["no_period", "no_span"]
Agreement = Literal["exact", "at_precision", "different"]


@dataclass(frozen=True, slots=True)
class Placed:
    """A fact's slot key, or None with the reason it has none."""

    key: str | None
    reason: NotPlaced | None


def _key(company_id: str, filing_kind: str, statement: str, basis: str, period_end: str, span: Span | None) -> str:
    return slot_key(cast(Slot, {"company_id": company_id, "filing_kind": filing_kind, "statement": statement,
                                "basis": basis, "period_end": period_end, "span": span}))


def _placed(company_id: str, filing_kind: str, statement: str, basis: str, period_end: str | None,
            span_from_header: Callable[[str], Span | None]) -> Placed:
    """The date first, then the span: a balance sheet line is a point in time; any other line needs a span."""
    if not period_end:
        return Placed(None, "no_period")
    if statement == "balance_sheet":
        return Placed(_key(company_id, filing_kind, statement, basis, period_end, None), None)
    span = span_from_header(period_end)
    if span is None:
        return Placed(None, "no_span")
    return Placed(_key(company_id, filing_kind, statement, basis, period_end, span), None)


def gemini_slot(company_id: str, filing_kind: str, fact: dict) -> Placed:
    """A Gemini wire fact's slot: its period end, else its as-of date, and the span its column header names."""
    return _placed(company_id, filing_kind, fact["statement"], fact["basis"], fact["periodEnd"] or fact["asOfDate"],
                   lambda period_end: span_of_label(fact["periodLabel"], period_end))


def xbrl_slot(company_id: str, filing_kind: str, fact: dict) -> str | None:
    """An XBRL wire fact's slot key, or None when it has no date. The span is the fact's own, none on the balance sheet.
    The period end comes before the as-of date, so opening cash (an instant at the start of the period) keys on the
    column it is printed in."""
    period_end = fact["periodEnd"] or fact["asOfDate"]
    if not period_end:
        return None
    span = None if fact["statement"] == "balance_sheet" else fact["span"]
    return _key(company_id, filing_kind, fact["statement"], fact["basis"], period_end, span)


def gold_slot(company_id: str, filing_kind: str, g: GoldFact) -> Placed:
    """A gold fact's slot: its period end, and its span, or the span its header names when the gold file was frozen
    before gold facts carried one."""
    return _placed(company_id, filing_kind, g.statement, g.basis, g.period_end,
                   lambda period_end: g.span if g.span is not None else span_of_label(g.period_label, period_end))


def _power_of_ten(value: Decimal) -> int | None:
    """n when `value` is exactly 10^n, read from its digits as written; None for anything else."""
    if not value.is_finite():
        return None
    sign, digits, exponent = value.as_tuple()
    if sign or digits[0] != 1 or any(digits[1:]):
        return None
    return len(digits) - 1 + exponent


def _places_exponent(value: Decimal) -> int | None:
    """The exponent of the last digit as written: -2 for "12.34", 0 for "1200"."""
    return value.as_tuple().exponent if value.is_finite() else None


def printed_exponent(reported_value: str | None, scale_factor: str | None) -> int | None:
    """The power of ten a printed figure is known to, in rupees (or rupees a share): the scale's exponent less the
    places the figure is printed to. "12345.67" in crore is known to 10^(7-2). A null, or a scale that is not a power
    of ten, gives None."""
    if reported_value is None or scale_factor is None:
        return None
    scale = _power_of_ten(Decimal(scale_factor))
    places = _places_exponent(Decimal(reported_value))
    if scale is None or places is None:
        return None
    return scale + places


def xbrl_exponent(decimals: str | None, normalized_value: str) -> int | None:
    """The power of ten an XBRL value is known to: `decimals="-6"` is 10^6; "INF" is exact, so the places of the
    value as written; null, or anything else, gives None."""
    if decimals is None:
        return None
    if decimals == "INF":
        return _places_exponent(Decimal(normalized_value))
    try:
        return -int(decimals)
    except ValueError:
        return None


def same_figure(a: Decimal, a_exp: int | None, b: Decimal, b_exp: int | None) -> Agreement:
    """`exact` when the values are equal; `at_precision` when, with both precisions known, they are equal once both
    are rounded half away from zero to the coarser one; `different` otherwise."""
    if a == b:
        return "exact"
    if a_exp is None or b_exp is None:
        return "different"
    step = Decimal(f"1E{max(a_exp, b_exp)}")
    # Room for any figure a filing prints, so the rounding never runs out of digits.
    with localcontext() as context:
        context.prec = 100
        if a.quantize(step, rounding=ROUND_HALF_UP) == b.quantize(step, rounding=ROUND_HALF_UP):
            return "at_precision"
    return "different"
