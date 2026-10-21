"""The unit of a fact: the instance's declared rounding word, and what a unit's measures say.

A rounding word (``Crores``, ``Lakhs``, ...) says what a monetary value is stated in. A monetary unit is one
``iso4217:*`` measure with no denominator; a per-share unit is one ``iso4217:*`` measure over
``xbrli:shares``; anything else (``xbrli:pure``, shares alone) is neither and a read writes no fact for it.
Scales are Decimals built from strings; nothing here is a float.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from .parser import Unit

_RUPEE = "₹"
_ISO4217 = "iso4217:"
_SHARES = "xbrli:shares"


@dataclass(frozen=True, slots=True)
class Rounding:
    """``scale`` is how many units of the currency one declared unit holds, and ``exponent`` is the
    ``decimals`` a value rounded to that unit has (-7 for a crore)."""

    word: str
    unit_label: str
    scale: Decimal
    exponent: int


_ROUNDINGS = {
    rounding.word.casefold(): rounding
    for rounding in (
        Rounding("Crores", f"{_RUPEE} crore", Decimal("10000000"), -7),
        Rounding("Lakhs", f"{_RUPEE} lakh", Decimal("100000"), -5),
        Rounding("Millions", f"{_RUPEE} million", Decimal("1000000"), -6),
        Rounding("Thousands", f"{_RUPEE} thousand", Decimal("1000"), -3),
        Rounding("Billions", f"{_RUPEE} billion", Decimal("1000000000"), -9),
        Rounding("Actual", _RUPEE, Decimal("1"), 0),
    )
}


def rounding_of(word: str | None) -> Rounding | None:
    """The rounding a declared word names, matched without regard to case or padding; None for anything
    else, an unknown word included."""
    if word is None:
        return None
    return _ROUNDINGS.get(word.strip().casefold())


@dataclass(frozen=True, slots=True)
class UnitInfo:
    """What a unit means for a fact. ``unit_label`` and ``scale`` are None while the scale is unknown (a
    monetary unit with no declared rounding) and for ``other``, which has no currency either."""

    kind: Literal["monetary", "per_share", "other"]
    unit_label: str | None
    scale: Decimal | None
    currency: str | None


_OTHER = UnitInfo("other", None, None, None)


def unit_of(unit: Unit, rounding: Rounding | None) -> UnitInfo:
    """The meaning of ``unit`` under the instance's declared ``rounding`` (None when it declares none)."""
    if len(unit.numerator) != 1 or not unit.numerator[0].startswith(_ISO4217):
        return _OTHER
    currency = unit.numerator[0][len(_ISO4217) :]
    if not currency:
        return _OTHER
    if not unit.denominator:
        if rounding is None:
            return UnitInfo("monetary", None, None, currency)
        return UnitInfo("monetary", _in_currency(rounding.unit_label, currency), rounding.scale, currency)
    if unit.denominator == (_SHARES,):
        return UnitInfo("per_share", _in_currency(f"{_RUPEE} a share", currency), Decimal("1"), currency)
    return _OTHER


def _in_currency(rupee_label: str, currency: str) -> str:
    """A label written for the rupee, with the currency's symbol: ``₹`` for INR, the ISO code for any other."""
    return rupee_label if currency == "INR" else rupee_label.replace(_RUPEE, currency, 1)
