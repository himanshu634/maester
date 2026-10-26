"""Who and what period an instance is for, read from its metadata facts.

The identity elements are listed in ``formats.json``. Only a non-dimensional fact counts, in a context the
file declares, with a value: a nil fact or one that is empty after trimming is not taken. A key may have more
than one element (the name is ``NameOfBank`` in banking results); of the facts of a key's elements, the first
in document order gives the value. The basis is the exception: it is read from every
basis fact, because 613 of the 807 instances on hand state it twice (in ``OneD`` and in ``FourD``) and a
file that states two bases must not read as one.

A text is trimmed before it is used. The reading stops at what the file says: a code's shape and a symbol's
shape are checked by the caller, which owns the answer.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pdf_financial_qa.workflow.contracts import ReportingBasis

from .formats import IDENTITY_ELEMENTS, ROUNDING_ELEMENTS
from .parser import Instance, RawFact

_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# "Non-consolidated" and "unconsolidated" contain "consolidated" and are not it.
_NEGATED_CONSOLIDATED = re.compile(r"\b(?:non|un)[\s-]?consolidated")
_AUDITED = {"audited": True, "unaudited": False}


@dataclass(frozen=True, slots=True)
class Identity:
    """``basis`` is ``unknown`` with ``mixed_basis`` true when the instance states both bases, or neither.
    ``rounding_word`` is the declared rounding as written (trimmed), such as ``Crores``."""

    name: str | None
    scrip_code: str | None
    symbol: str | None
    isin: str | None
    basis: ReportingBasis
    mixed_basis: bool
    audited: bool | None
    period_start: date | None
    period_end: date | None
    rounding_word: str | None


def identity_facts(instance: Instance, family: str | None) -> dict[str, tuple[RawFact, ...]]:
    """The facts that can give each identity value, in document order, by identity key (``name``,
    ``scrip_code``, ``symbol``, ``isin``, ``basis``, ``audited``, ``period_start``, ``period_end``) and
    ``rounding``, which is the family's rounding element (none without a family)."""
    elements = dict(IDENTITY_ELEMENTS)
    rounding = ROUNDING_ELEMENTS.get(family or "")
    elements["rounding"] = (rounding,) if rounding else ()
    key_of = {element: key for key, names in elements.items() for element in names}
    found: dict[str, list[RawFact]] = {key: [] for key in elements}
    for fact in instance.facts:
        key = key_of.get(fact.element)
        if key is None or fact.nil or not fact.text.strip():
            continue
        context = instance.contexts.get(fact.context_id)
        if context is None or context.dimensional:
            continue
        found[key].append(fact)
    return {key: tuple(facts) for key, facts in found.items()}


def parse_iso_date(text: str) -> date | None:
    """A ``YYYY-MM-DD`` date, or None for anything else (another layout, or a day that does not exist)."""
    text = text.strip()
    if not _DATE.fullmatch(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def latest_period_end(instance: Instance) -> tuple[date, str] | None:
    """The latest end or instant among the non-dimensional contexts of numeric facts, with that context's
    id; the first one in document order when two end on the same day. None when there is none."""
    best: tuple[date, str] | None = None
    for fact in instance.facts:
        if fact.unit_id is None:
            continue
        context = instance.contexts.get(fact.context_id)
        if context is None or context.dimensional:
            continue
        day = context.end if context.end is not None else context.instant
        if day is not None and (best is None or day > best[0]):
            best = (day, context.id)
    return best


def read_identity(instance: Instance, family: str | None) -> Identity:
    facts = identity_facts(instance, family)

    def first(key: str) -> str | None:
        return facts[key][0].text.strip() if facts[key] else None

    basis, mixed_basis = _basis_of_facts(facts["basis"])
    audited_text = first("audited")
    period_end_text = first("period_end")
    period_end = parse_iso_date(period_end_text) if period_end_text is not None else None
    if period_end is None:
        latest = latest_period_end(instance)
        period_end = latest[0] if latest is not None else None
    period_start_text = first("period_start")
    return Identity(
        name=first("name"),
        scrip_code=first("scrip_code"),
        symbol=first("symbol"),
        isin=first("isin"),
        basis=basis,
        mixed_basis=mixed_basis,
        audited=_AUDITED.get(audited_text.casefold()) if audited_text is not None else None,
        period_start=parse_iso_date(period_start_text) if period_start_text is not None else None,
        period_end=period_end,
        rounding_word=first("rounding"),
    )


def _basis_of_text(text: str) -> Literal["consolidated", "standalone"] | None:
    lowered = text.casefold()
    consolidated = "consolidated" in lowered
    standalone = "standalone" in lowered
    if consolidated == standalone:  # both words, or neither
        return None
    if standalone:
        return "standalone"
    return None if _NEGATED_CONSOLIDATED.search(lowered) else "consolidated"


def _basis_of_facts(facts: tuple[RawFact, ...]) -> tuple[ReportingBasis, bool]:
    """Every basis fact must say the same one basis. No basis fact, or facts that disagree (or one that says
    both or neither), is ``unknown`` with ``mixed_basis`` true: both bases, or neither. Never a bare
    ``all(...)``, which is true over no facts."""
    bases = {_basis_of_text(fact.text) for fact in facts}
    if len(bases) == 1 and None not in bases:
        (basis,) = bases
        return basis, False
    return "unknown", True
