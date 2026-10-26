"""The map's sums and the balance identity, checked on the facts of one read.

For each sum and each period its total has a fact in, the parts present in that period are added with their
signs and compared with the total, in full rupees. Rounding is not an error: each fact can be off by half a unit
of the instance's finest ``decimals``, so the tolerance is n × ½ × 10^(−finest), n counting the total and the
parts present (Departure 11). ``expected`` and ``actual`` are said in the declared unit, as the facts print them.

A check that cannot run says ``not_checked`` and why: every part absent, a total or part with no value (nil or
text that is not a number), or no finest ``decimals`` to set a tolerance by. A check never passes silently.
"""

from datetime import date
from decimal import Decimal, Inexact, localcontext
from typing import TYPE_CHECKING

from pdf_financial_qa.workflow.contracts import ExtractedCheck
from pdf_financial_qa.workflow.values import format_decimal

from .maps import ElementMap

if TYPE_CHECKING:
    from .read import XbrlFactData

# Exact addition: enough digits for any figure a filing prints. A sum that would need more is not checked.
_PRECISION = 200

_PeriodKey = tuple[date | None, date | None, date | None]


def sum_checks(facts: list["XbrlFactData"], element_map: ElementMap, finest_decimals: int | None) -> list[ExtractedCheck]:
    """The checks come in the map's order of sums, then the balance identity, each in the order its total's
    periods first appear. An element written twice in one period (a repeated fact) is checked by its first."""
    index: dict[tuple[str, _PeriodKey], XbrlFactData] = {}
    totals: dict[str, list[XbrlFactData]] = {}
    for fact in facts:
        if element_map.entry(fact.element).cash_balance is not None:
            continue  # a cash balance is two lines of one element in one period, and in no sum
        if (fact.element, _key(fact)) not in index:
            index[(fact.element, _key(fact))] = fact
            totals.setdefault(fact.element, []).append(fact)

    checks: list[ExtractedCheck] = []
    for total in element_map.sums:
        for fact in totals.get(total.total, []):
            parts = [(part.element, part.sign, index.get((part.element, _key(fact)))) for part in total.parts]
            checks.append(_check("subtotal", fact, fact.section, parts, finest_decimals))
    for identity in element_map.identities:
        for fact in totals.get(identity.left, []):
            right = index.get((identity.right, _key(fact)))
            checks.append(_check("balance_identity", fact, None, [(identity.right, 1, right)], finest_decimals))
    return checks


def _key(fact: "XbrlFactData") -> _PeriodKey:
    return (fact.period_start, fact.period_end, fact.as_of_date)


def _check(
    check_type: str,
    total: "XbrlFactData",
    section: str | None,
    parts: list[tuple[str, int, "XbrlFactData | None"]],
    finest: int | None,
) -> ExtractedCheck:
    present = [(element, sign, fact) for element, sign, fact in parts if fact is not None]
    absent = [element for element, _, fact in parts if fact is None]
    without_value = [fact.element for fact in [total] + [fact for _, _, fact in present] if fact.normalized_value is None]

    def result(status: str, detail: str, actual: str | None = None) -> ExtractedCheck:
        return ExtractedCheck(
            check_type=check_type,
            statement=total.statement,
            basis=total.basis,
            section=section,
            period_label=total.period_label,
            subject_label=total.reported_label,
            status=status,
            expected=total.reported_value,
            actual=actual,
            detail=detail,
        )

    absent_note = f"absent: {', '.join(absent)}" if absent else ""
    if not present:
        return result("not_checked", f"no part is in the instance: {', '.join(absent)}")
    if without_value:
        return result("not_checked", _join(f"no value: {', '.join(without_value)}", absent_note))
    if finest is None:
        return result("not_checked", _join("no decimals to set a tolerance by", absent_note))

    try:
        with localcontext() as context:
            context.prec = _PRECISION
            context.traps[Inexact] = True
            rupees = sum((sign * Decimal(fact.normalized_value) for _, sign, fact in present), Decimal(0))
            difference = abs(rupees - Decimal(total.normalized_value))
            tolerance = (len(present) + 1) * Decimal((0, (5,), -finest - 1))  # n × ½ × 10^(−finest)
            reported = [fact.reported_value for _, _, fact in present]
            actual = None
            if total.reported_value is not None and None not in reported:
                actual = format_decimal(sum((sign * Decimal(value) for (_, sign, _), value in zip(present, reported)), Decimal(0)))
    except Inexact:
        return result("not_checked", _join("too many digits to add exactly", absent_note))
    return result("passed" if difference <= tolerance else "failed", absent_note, actual)


def _join(*notes: str) -> str:
    return "; ".join(note for note in notes if note)
