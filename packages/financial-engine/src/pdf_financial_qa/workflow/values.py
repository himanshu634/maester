"""Deterministic interpretation of printed values, units and period labels."""

import re
from datetime import date
from decimal import Decimal, InvalidOperation

DASHES = {"-", "–", "—", "‒", "−", "nil", "Nil", "NIL"}
_CURRENCY_PREFIX = re.compile(r"^(?:₹|\$|€|£|rs\.?|inr|usd)\s*", re.IGNORECASE)
_PLAIN_NUMBER = re.compile(r"^\d+(?:\.\d+)?$")


def parse_reported(text: str) -> tuple[str, Decimal | None]:
    """Interpret a cell exactly as printed.

    Returns ``(status, value)`` where status is ``value``, ``dash`` or
    ``unparsed``. Parentheses and a leading minus mean negative; any digit
    grouping (Indian ``1,23,456`` or Western ``123,456``) is accepted. A dash or
    "nil" is a ``dash``: its meaning depends on the source's convention, so it
    is never turned into zero here.
    """
    raw = text.strip()
    if raw in DASHES:
        return "dash", None
    negative = False
    if raw.startswith("(") and raw.endswith(")"):
        negative, raw = True, raw[1:-1].strip()
    raw = _CURRENCY_PREFIX.sub("", raw)
    if raw[:1] in {"-", "−", "–"}:
        negative, raw = True, raw[1:].strip()
    raw = raw.replace(",", "").replace(" ", "")
    if not _PLAIN_NUMBER.match(raw):
        return "unparsed", None
    try:
        value = Decimal(raw)
    except InvalidOperation:  # pragma: no cover - guarded by the regex
        return "unparsed", None
    return "value", -value if negative else value


def format_decimal(value: Decimal) -> str:
    """A plain decimal string, never exponent notation (``1E+5`` → ``100000``)."""
    text = format(value, "f")
    return "0" if text in {"-0", "-0.0"} or re.fullmatch(r"-0\.0+", text) else text


_SCALES: list[tuple[re.Pattern[str], Decimal]] = [
    (re.compile(r"\b(?:crores?|crs?)\b"), Decimal(10) ** 7),
    (re.compile(r"\b(?:lakhs?|lacs?|lakh)\b"), Decimal(10) ** 5),
    (re.compile(r"\b(?:millions?|mn|mio)\b"), Decimal(10) ** 6),
    (re.compile(r"\b(?:billions?|bn)\b"), Decimal(10) ** 9),
    (re.compile(r"\b(?:thousands?)\b|'000|\b000s\b"), Decimal(10) ** 3),
]
_ACTUAL = re.compile(r"\b(?:actuals?|absolute|units?|rupees|inr|usd|dollars?)\b")


def scale_for(unit_label: str | None) -> Decimal | None:
    """Multiplier from a unit note such as "₹ in crores"; None when unknown or ambiguous."""
    if not unit_label:
        return None
    label = unit_label.lower()
    found = {scale for pattern, scale in _SCALES if pattern.search(label)}
    if len(found) == 1:
        return found.pop()
    if not found and _ACTUAL.search(label):
        return Decimal(1)
    return None


_MONTHS = {
    name: index
    for index, names in enumerate(
        [
            ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
            ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
            ("september", "sept", "sep"), ("october", "oct"), ("november", "nov"), ("december", "dec"),
        ],
        start=1,
    )
    for name in names
}
_MONTH = "|".join(sorted(_MONTHS, key=len, reverse=True))
_DAY_FIRST = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?[\s-]+({_MONTH})\.?,?[\s-]+(\d{{4}})\b", re.IGNORECASE)
_MONTH_FIRST = re.compile(rf"\b({_MONTH})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.IGNORECASE)


def parse_label_date(label: str) -> date | None:
    """The single unambiguous day–month-name–year date in a period label, if any.

    "As at 31 March 2026" and "Year ended March 31, 2026" yield a date;
    "FY2026", numeric dates and labels naming two different dates yield None.
    """
    found: set[date] = set()
    for day, month, year in _DAY_FIRST.findall(label):
        found.add(_safe_date(int(year), _MONTHS[month.lower()], int(day)))
    for month, day, year in _MONTH_FIRST.findall(label):
        found.add(_safe_date(int(year), _MONTHS[month.lower()], int(day)))
    found.discard(None)  # type: ignore[arg-type]
    return found.pop() if len(found) == 1 else None


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


_SPLIT_GROUP = re.compile(r"(?<=\d),\s+(?=\d)")
_NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")


def page_numbers(page_text: str) -> set[Decimal]:
    """Absolute values of every number printed in a page's text layer."""
    text = _SPLIT_GROUP.sub(",", page_text)
    numbers: set[Decimal] = set()
    for token in _NUMBER_TOKEN.findall(text):
        try:
            numbers.add(Decimal(token.replace(",", "")))
        except InvalidOperation:  # pragma: no cover
            continue
    return numbers


def text_layer_match(page_text: str, value: Decimal | None) -> bool | None:
    """Whether a parsed value appears on its page. None when the page has no text layer
    (a scan) or there is no numeric value to look for."""
    if value is None or not page_text.strip():
        return None
    return abs(value) in page_numbers(page_text)


_SUFFIXES = re.compile(r"\b(?:limited|ltd|private|pvt|inc|incorporated|corporation|corp|plc|llp|llc|co|company|the)\b")


def same_company(a: str, b: str) -> bool:
    """Loose name comparison used only to raise a review warning, never to link records."""
    def norm(name: str) -> str:
        return " ".join(_SUFFIXES.sub(" ", re.sub(r"[^a-z0-9 ]", " ", name.lower())).split())

    left, right = norm(a), norm(b)
    return bool(left) and bool(right) and (left == right or left in right or right in left)
