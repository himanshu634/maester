"""The element maps: which element of an XBRL format is which line of which statement.

One reviewed map per mapped format (``maps/<family>.<kind>.json``; the README beside them says how each was
drafted and checked). A map is a mapping rule, so a change to one bumps ``XBRL_MAP_VERSION``. It holds

* ``elements``: the statement lines. Each has its statement, its section, its place (``order``, from 10 up and
  unique in its statement), the label the PDF prints, and the taxonomy concept it is (None for an "Others" or
  next-best-fit line). ``CashAndCashEquivalentsCashFlowStatement`` is an instant that the cash flow prints twice,
  so its entry has a ``cash_balance`` block with the two labels, concepts and places;
* ``sums``: a total and the lines that add up to it, each with the sign it adds with. A total has one sum;
* ``identities``: two totals that must be equal (the balance sheet balances);
* ``ignored``: numeric elements that are in the results but are no statement line (ratios, face value, segment
  and debt disclosures). They raise no ``XBRL_ELEMENT_UNMAPPED``.

A format with no map (banking, NBFC, "other than Ind AS", an unknown family) has ``load_map(...) is None``.
"""

import json
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.resources import files
from typing import Literal

MAPPED_FORMATS = ("in-capmkt/ind_as", "in-bse-fin/ind_as")

Statement = Literal["income_statement", "balance_sheet", "cash_flow"]
STATEMENTS: tuple[Statement, ...] = ("income_statement", "balance_sheet", "cash_flow")


@dataclass(frozen=True, slots=True)
class CashBalance:
    """The two places an instant cash balance is printed: the opening line before the cash-flow lines and the
    closing line after them."""

    opening_label: str
    closing_label: str
    opening_concept: str
    closing_concept: str
    opening_order: int
    closing_order: int


@dataclass(frozen=True, slots=True)
class MapEntry:
    """A statement line. A ``cash_balance`` entry's own ``order`` is unused (0); its two places are in the block."""

    element: str
    statement: Statement
    section: str
    order: int
    label: str
    concept: str | None
    cash_balance: CashBalance | None


@dataclass(frozen=True, slots=True)
class SumPart:
    element: str
    sign: Literal[1, -1]


@dataclass(frozen=True, slots=True)
class MapSum:
    id: str
    total: str
    parts: tuple[SumPart, ...]


@dataclass(frozen=True, slots=True)
class MapIdentity:
    id: str
    left: str
    right: str


@dataclass(frozen=True, slots=True)
class EntryPointDifference:
    element: str
    only_in: str
    note: str


@dataclass(frozen=True)
class ElementMap:
    format: str
    map_version: str
    entry_points: tuple[str, ...]
    entry_point_differences: tuple[EntryPointDifference, ...]
    elements: tuple[MapEntry, ...]
    sums: tuple[MapSum, ...]
    identities: tuple[MapIdentity, ...]
    ignored: frozenset[str]
    _entries: dict[str, MapEntry] = field(init=False, repr=False, compare=False)
    _sums_by_total: dict[str, tuple[MapSum, ...]] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        entries = {entry.element: entry for entry in self.elements}
        if len(entries) != len(self.elements):
            raise ValueError(f"{self.format}: an element is listed twice")
        by_total: dict[str, list[MapSum]] = {}
        for total in self.sums:
            by_total.setdefault(total.total, []).append(total)
        object.__setattr__(self, "_entries", entries)
        object.__setattr__(self, "_sums_by_total", {total: tuple(sums) for total, sums in by_total.items()})

    def entry(self, element: str) -> MapEntry | None:
        """The statement line ``element`` is, or None (an ignored element and an unknown one alike)."""
        return self._entries.get(element)

    def sums_with_total(self, element: str) -> list[MapSum]:
        return list(self._sums_by_total.get(element, ()))

    def parts_of(self, element: str) -> list[str]:
        """The elements that add up to ``element``, in the map's order; empty when it is no total."""
        parts: list[str] = []
        for total in self._sums_by_total.get(element, ()):
            parts.extend(part.element for part in total.parts if part.element not in parts)
        return parts

    def labels_of_parts(self, element: str) -> list[str]:
        """The labels of ``parts_of(element)``, for a sentence that names the lines of a total."""
        return [entry.label for part in self.parts_of(element) if (entry := self._entries.get(part)) is not None]


def map_file_name(format_id: str) -> str:
    """``in-capmkt/ind_as`` is read from ``in-capmkt.ind_as.json``."""
    return f"{format_id.replace('/', '.')}.json"


@lru_cache(maxsize=None)
def load_map(format_id: str) -> ElementMap | None:
    """The map of a format, read once; None for a format that has none."""
    if format_id not in MAPPED_FORMATS:
        return None
    text = files(__package__).joinpath("maps", map_file_name(format_id)).read_text(encoding="utf-8")
    return _parse(format_id, json.loads(text))


def _parse(format_id: str, raw: dict) -> ElementMap:
    if raw["format"] != format_id:
        raise ValueError(f"{format_id}: the map file is for another format")
    return ElementMap(
        format=raw["format"],
        map_version=raw["map_version"],
        entry_points=tuple(raw["entry_points"]),
        entry_point_differences=tuple(EntryPointDifference(**item) for item in raw["entry_point_differences"]),
        elements=tuple(_entry(item) for item in raw["elements"]),
        sums=tuple(_sum(item) for item in raw["sums"]),
        identities=tuple(MapIdentity(**item) for item in raw["identities"]),
        ignored=frozenset(raw["ignored"]),
    )


def _entry(raw: dict) -> MapEntry:
    if raw["statement"] not in STATEMENTS:
        raise ValueError(f"{raw['element']}: {raw['statement']} is no statement")
    balance = raw.get("cash_balance")
    return MapEntry(
        element=raw["element"],
        statement=raw["statement"],
        section=raw["section"],
        order=raw["order"],
        label=raw["label"],
        concept=raw["concept"],
        cash_balance=CashBalance(**balance) if balance is not None else None,
    )


def _sum(raw: dict) -> MapSum:
    parts = tuple(SumPart(part["element"], part["sign"]) for part in raw["parts"])
    for part in parts:
        if part.sign not in (1, -1):
            raise ValueError(f"{raw['id']}: the sign of {part.element} is not 1 or -1")
    return MapSum(raw["id"], raw["total"], parts)
