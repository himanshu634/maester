"""The span of a column, read from the words of its header.

A quarter and its year to date end on one day (Q2 and the half year on 30 September), so a period end alone
does not say which one a column is. The header does, and this module reads it by one fixed rule, whose
version is recorded wherever a span it gave is used. A header that does not say gives null: a span that
cannot be read stays unknown, never a guess.

The names are phase 4's `fact_span` names (`year`, not `full_year`)."""

from datetime import date
import re

from maester_eval.manifest import is_iso_date
from maester_eval.source_rule import Span

__all__ = ["SPAN_RULE_VERSION", "Span", "span_of_label"]

SPAN_RULE_VERSION = 2

_SPACES = re.compile(r"\s+")
_AS_AT = re.compile(r"\bas (at|on)\b")
_YEAR_TO_DATE = re.compile(r"\byear to date\b|\bytd\b")
# Tried in this order, the first match wins: a column that says nine months is not a quarter because it also
# names the "three months" of its period, and "half year ended" is not a year. "FY" is not in this list: beside
# a span word (H1, H2, 1H, 2H, HY, 3M, 6M, 9M, 12M or Q3) it names the financial year the column falls in, not the
# column's length (version 2). It is tried last, and only when the head holds no short span token that this list
# does not recognise ("4M FY 2025-26" is unknown, not a year). A token run together with FY ("H1FY26") has no
# word boundary and matches nothing, so it stays unknown; "6M FY26" and "1H FY26" have a space and are read.
_WORDS: list[tuple[re.Pattern[str], Span]] = [
    (re.compile(r"\b(nine|9) months?\b|\b9\s?m\b"), "nine_months"),
    (re.compile(r"\b(six|6) months?\b|\bhalf[- ]?year(ly)?\b|\bh[12]\b|\b6\s?m\b|\b[12]\s?h\b|\bhy\b"), "half_year"),
    (re.compile(r"\b(three|3) months?\b|\bquarter(ly)?\b|\bq[1-4]\b|\b3\s?m\b"), "quarter"),
    (re.compile(r"\b(twelve|12) months?\b|\byear (ended|ending)\b|\b12\s?m\b"), "year"),
]
_FY = re.compile(r"\bfy\b")
# A short span token (4M, 10M, 3H) that the list above did not match: the span is unclear, so FY must not give "year".
_UNRECOGNISED_SPAN = re.compile(r"\b\d{1,2}\s?m\b|\b\d\s?h\b|\bhy\b")
# The month a year to date column ends in, under the 1 April financial year: June is the first quarter of it,
# September the half year, December nine months and March the year.
_YEAR_TO_DATE_BY_MONTH: dict[int, Span] = {6: "quarter", 9: "half_year", 12: "nine_months", 3: "year"}


def _month(period_end: date | str | None) -> int | None:
    if isinstance(period_end, date):
        return period_end.month
    if isinstance(period_end, str) and is_iso_date(period_end):
        return date.fromisoformat(period_end).month
    return None


def span_of_label(label: str, period_end: date | str | None = None) -> Span | None:
    """The span a column header names, or None. The rule never gives `other`; a person may.

    The label is lower-cased with its spaces collapsed, and the first rule that matches wins:
    "as at" or "as on" is a point in time (no span); "year to date" takes its span from the month of
    `period_end` (any other month, or no date, is no span); then nine months or 9M, six months, 6M, a half year, H1,
    H2, 1H, 2H or HY, three months, 3M or a quarter, and twelve months, 12M or a year ended; last, FY gives the
    year, unless the head holds another short span token (such as 4M) that the rule does not recognise."""
    text = _SPACES.sub(" ", label.lower()).strip()
    if _AS_AT.search(text):
        return None
    if _YEAR_TO_DATE.search(text):
        month = _month(period_end)
        return None if month is None else _YEAR_TO_DATE_BY_MONTH.get(month)
    for pattern, span in _WORDS:
        if pattern.search(text):
            return span
    if _FY.search(text) and not _UNRECOGNISED_SPAN.search(text):
        return "year"
    return None
