"""Which format an instance is in, from the elements it holds and never from its file name.

The rules are data (``formats.json``): the families by the namespace of their facts, the ordered rules that
tell Ind AS from banking, NBFC and "other than Ind AS" results by the numeric elements an instance has, the
identity elements and the suffixes of text blocks. A change to a rule is a change to a mapping rule and
bumps ``XBRL_MAP_VERSION``.
"""

import json
import re
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal

from . import maps
from .parser import Instance

Family = Literal["in-capmkt", "in-bse-fin"]
FormatKind = Literal["ind_as", "banking", "nbfc", "other_than_ind_as", "unknown"]

_DATA = json.loads(files(__package__).joinpath("formats.json").read_text(encoding="utf-8"))

# family name -> the pattern its facts' namespace must match whole
FAMILY_NAMESPACES: dict[str, re.Pattern[str]] = {
    name: re.compile(family["namespace"]) for name, family in _DATA["families"].items()
}
# family name -> the element that holds the declared rounding, such as "Crores"
ROUNDING_ELEMENTS: dict[str, str] = {name: family["rounding_element"] for name, family in _DATA["families"].items()}
# identity key (name, scrip_code, symbol, isin, basis, audited, period_start, period_end) -> the elements that
# give it. A key may name several: banking results print the name as ``NameOfBank``, the rest as ``NameOfTheCompany``.
IDENTITY_ELEMENTS: dict[str, tuple[str, ...]] = {
    key: (value,) if isinstance(value, str) else tuple(value) for key, value in _DATA["identity"].items()
}
# a non-numeric fact whose element ends in one of these is a text block
TEXT_SUFFIXES: tuple[str, ...] = tuple(_DATA["text_suffixes"])


@dataclass(frozen=True, slots=True)
class _Rule:
    kind: str
    any_of: frozenset[str] | None
    all_of: frozenset[str] | None

    def matches(self, elements: set[str]) -> bool:
        if self.any_of is not None:
            return not self.any_of.isdisjoint(elements)
        return self.all_of is not None and self.all_of <= elements


def _load_rule(raw: dict) -> _Rule:
    if ("any_of" in raw) == ("all_of" in raw):
        raise ValueError("a format rule has either any_of or all_of")
    return _Rule(
        raw["kind"],
        frozenset(raw["any_of"]) if "any_of" in raw else None,
        frozenset(raw["all_of"]) if "all_of" in raw else None,
    )


_RULES: tuple[_Rule, ...] = tuple(_load_rule(raw) for raw in _DATA["rules"])

# The formats an element map reads (the list is ``maps.MAPPED_FORMATS``). The others are read, and write no facts.
MAPPED_FORMATS = frozenset(maps.MAPPED_FORMATS)


@dataclass(frozen=True, slots=True)
class XbrlFormat:
    """``id`` is ``<family>/<kind>``, or None without a family. ``mapped`` is true when a map reads it."""

    family: Family | None
    kind: FormatKind
    id: str | None
    mapped: bool


def family_of(instance: Instance) -> Family | None:
    """The family of the facts' namespace. Facts in several namespaces, in none, or in a namespace no
    family matches give None."""
    namespaces = {fact.namespace for fact in instance.facts}
    if len(namespaces) != 1:
        return None
    (namespace,) = namespaces
    matching = [name for name, pattern in FAMILY_NAMESPACES.items() if pattern.fullmatch(namespace)]
    return matching[0] if len(matching) == 1 else None


def detect_format(instance: Instance) -> XbrlFormat:
    """The format of an instance. Without a family no rule is tried: the kind is ``unknown``. With one, the
    first rule that matches the set of numeric elements gives the kind; none gives ``unknown``. A numeric
    fact is one with a unit, a nil one included: the form defined the element, whatever it holds."""
    family = family_of(instance)
    if family is None:
        return XbrlFormat(None, "unknown", None, False)
    numeric = {fact.element for fact in instance.facts if fact.unit_id is not None}
    kind = next((rule.kind for rule in _RULES if rule.matches(numeric)), "unknown")
    format_id = f"{family}/{kind}"
    return XbrlFormat(family, kind, format_id, format_id in MAPPED_FORMATS)
