"""A period's span and label, worked out from its dates alone.

A duration that starts on the first of a month and ends on the last day of a month spans n whole months:
3 is a quarter, 6 a half year, 9 nine months and 12 a year. Any other duration is ``other``. An instant has
no span. The word an instance writes for its period (``ReportingQuarter``) is never read: it disagrees with
the dates in 106 of the 807 instances on hand.
"""

import calendar
from datetime import date
from typing import Literal

from pdf_financial_qa.classify.contracts import ResultsSpan

# The data layer's span names. A classification's ``ResultsSpan`` says ``full_year`` for ``year``.
Span = Literal["quarter", "half_year", "nine_months", "year", "other"]

_SPAN_OF_MONTHS: dict[int, Span] = {3: "quarter", 6: "half_year", 9: "nine_months", 12: "year"}

_LABEL_PREFIX = {
    "quarter": "Quarter ended",
    "half_year": "Half year ended",
    "nine_months": "Nine months ended",
    "year": "Year ended",
    "other": "Period ended",
}

# English abbreviations, fixed here: ``strftime("%b")`` follows the machine's locale.
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def span_of(start: date, end: date) -> Span:
    """The span of the duration ``start`` to ``end``, both days included."""
    if start.day != 1 or end.day != calendar.monthrange(end.year, end.month)[1]:
        return "other"
    months = 12 * (end.year - start.year) + end.month - start.month + 1
    return _SPAN_OF_MONTHS.get(months, "other")


def to_results_span(span: Span | None) -> ResultsSpan | None:
    """A span as a classification's results span: ``year`` is ``full_year``, and ``other`` (or no span) has
    none. It mirrors ``toResultsSpan`` in ``@maester/contracts``."""
    if span is None or span == "other":
        return None
    return "full_year" if span == "year" else span


def period_label(span: Span | None, end: date) -> str:
    """``Quarter ended 30 Sep 2025``; for an instant (no span), ``As at 30 Sep 2025``."""
    day = f"{end.day} {_MONTHS[end.month - 1]} {end.year}"
    if span is None:
        return f"As at {day}"
    return f"{_LABEL_PREFIX[span]} {day}"
