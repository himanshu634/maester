"""Who owns an XBRL slot, when two instances of one filing hold facts in it (rule `OWNER_RULE_VERSION`).

A refiling pairs one period token and basis twice, and a March filing can pair a quarter (MQ) and a half year (MH)
whose year facts meet in one slot. The candidates of a slot are ranked by the source rule's `rank_slot_candidates`,
with the pair's `filed` date as the revision's creation, so a later filing owns the slot.

On a tie on `filed`, the source rule's last key (the larger revision id) is never what decides: on BSE's names that is
the text order, not the time order. The stamp at the end of each name is read as a date and time in every way it can
be (`stamp_readings`), because BSE writes it sometimes zero-padded and sometimes not. A tied candidate owns the slot
only when its earliest reading is later than the latest reading of every other tied candidate. A candidate with no
reading orders nothing, so a tie that holds one is not ordered. A tie with no order is pooled: a cell every pooled
instance holds with the exact same figure is kept once; a cell they hold differently, or one of them lacks, is listed
in `differing_cells` and never picked.

File names, dates and figures compared for equality only: nothing is logged, and no figure is changed.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import PurePosixPath

from maester_eval.artefacts import Artefact
from maester_eval.cells import company_id, xbrl_slot
from maester_eval.source_rule import SlotCandidate, rank_slot_candidates

__all__ = [
    "OWNER_RULE_VERSION", "DifferingCell", "SlotOwner", "differing_cells", "fact_figure", "owned_facts", "pooled_instances",
    "slot_owners", "stamp_readings",
]

OWNER_RULE_VERSION = 1


@dataclass(frozen=True, slots=True)
class SlotOwner:
    """`instances`: the used instances that hold facts in the slot, in pair order. `owner`: the one that owns it, or
    None when the slot is pooled."""

    slot: str
    owner: str | None
    instances: list[str]


@dataclass(frozen=True, slots=True)
class DifferingCell:
    """An element of a slot that another instance holds with another figure. `owner` None: a pooled slot, and
    `others` is every pooled instance."""

    slot: str
    element: str
    concept: str | None
    owner: str | None
    others: list[str]


def _splits(digits: str, sizes: tuple[tuple[int, ...], ...]) -> Iterator[tuple[int, ...]]:
    """Every way `digits` cuts into consecutive parts, the n-th part one of `sizes[n]` digits long."""
    if not sizes:
        if not digits:
            yield ()
        return
    for size in sizes[0]:
        if size <= len(digits):
            for rest in _splits(digits[size:], sizes[1:]):
                yield (int(digits[:size]), *rest)


def stamp_readings(file_name: str) -> list[datetime]:
    """Every date and time the stamp of a name can be: the digits after the name's last `_` and before `.xml`, as
    day, month (1 or 2 digits each), year (4 digits, 2000 to 2099), hour, minute and second (1 or 2 digits each).
    Distinct and sorted; `[]` for a name with no `_`, a stamp that is not all digits, or one with no reading."""
    name = PurePosixPath(file_name).name
    if "_" not in name:
        return []  # a name with no `_` has no stamp: its digits, if any, are not a date
    stamp = name.rsplit("_", 1)[1]
    stamp = stamp[:-len(".xml")] if stamp.endswith(".xml") else stamp
    if not (stamp.isascii() and stamp.isdigit()):
        return []
    one_or_two, year = (1, 2), (4,)
    readings: set[datetime] = set()
    for day, month, y, hour, minute, second in _splits(stamp, (one_or_two, one_or_two, year, one_or_two, one_or_two, one_or_two)):
        if not 2000 <= y <= 2099:
            continue
        try:
            readings.add(datetime(y, month, day, hour, minute, second))
        except ValueError:  # no such date or time
            continue
    return sorted(readings)


def fact_figure(fact: dict) -> tuple[str, Decimal | None]:
    """What a fact holds, for exact equality: its status and its normalised value as a decimal (`2000` is `2000.0`)."""
    value = fact["normalizedValue"]
    return fact["valueStatus"], None if value is None else Decimal(value)


@dataclass(frozen=True, slots=True)
class _Slot:
    owner: SlotOwner
    # The instances the owner was chosen among: the owner alone, or every tied instance of a pooled slot.
    pooled: list[str]
    # Instance to its facts in the slot, in the artefact's order.
    facts: dict[str, list[dict]]


def _stamp_owner(tied: list[str]) -> str | None:
    readings = {file: stamp_readings(file) for file in tied}
    if any(not found for found in readings.values()):
        return None  # a candidate with no reading orders nothing
    for file in tied:
        if all(readings[file][0] > readings[other][-1] for other in tied if other != file):
            return file
    return None


def _slots(artefact: Artefact) -> dict[str, _Slot]:
    company = company_id(artefact.file)
    used = [i for i in artefact.instances if i.used]
    filed = {i.file: i.filed for i in used}
    held: dict[str, dict[str, list[dict]]] = {}
    for fact in (artefact.result or {}).get("facts", []):
        key = xbrl_slot(company, artefact.kind, fact)
        if key is None or fact["instance"] not in filed:
            continue
        held.setdefault(key, {}).setdefault(fact["instance"], []).append(fact)
    out: dict[str, _Slot] = {}
    for key, by_instance in held.items():
        instances = [i.file for i in used if i.file in by_instance]  # pair order
        candidates: list[SlotCandidate] = [
            {"revision_id": PurePosixPath(file).name, "document_id": file, "source": "xbrl",
             "filing_period_end": artefact.period_end, "revision_created_at": filed[file]} for file in instances]
        first = rank_slot_candidates(candidates)[0]
        tied = [file for file in instances if filed[file] == first["revision_created_at"]]
        owner = first["document_id"] if len(tied) == 1 else _stamp_owner(tied)
        out[key] = _Slot(SlotOwner(key, owner, instances), [owner] if owner else tied,
                         {file: by_instance[file] for file in instances})
    return out


def slot_owners(artefact: Artefact) -> dict[str, SlotOwner]:
    """Each slot the artefact's used instances hold facts in (`cells.xbrl_slot`), to the instance that owns it."""
    return {key: slot.owner for key, slot in _slots(artefact).items()}


def pooled_instances(artefact: Artefact) -> dict[str, list[str]]:
    """Each pooled slot (no owner) to the instances it was pooled from: the tied ones, in pair order."""
    return {key: slot.pooled for key, slot in _slots(artefact).items() if slot.owner.owner is None}


def _by_element(facts: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for fact in facts:
        out.setdefault(fact["element"], []).append(fact)
    return out


def _agreed(slot: _Slot) -> dict[str, list[dict]]:
    """The elements of a pooled slot that every pooled instance holds, all with one figure, to the first instance's facts."""
    held = [_by_element(slot.facts[file]) for file in slot.pooled]
    out: dict[str, list[dict]] = {}
    for element, facts in held[0].items():
        if all(element in other for other in held[1:]) and len({fact_figure(f) for h in held for f in h[element]}) == 1:
            out[element] = facts
    return out


def owned_facts(artefact: Artefact) -> list[dict]:
    """Each fact of an owned slot that its owner holds; for a pooled slot, each fact whose element every pooled
    instance holds with the exact same figure, once, from the first pooled instance in pair order."""
    out: list[dict] = []
    for slot in _slots(artefact).values():
        if slot.owner.owner is not None:
            out += slot.facts[slot.owner.owner]
        else:
            out += [fact for facts in _agreed(slot).values() for fact in facts]
    return out


def differing_cells(artefact: Artefact) -> list[DifferingCell]:
    """Sorted by slot, then element.

    In an owned slot, each element that a non-owner holds with another figure than the owner's (an owner that lacks
    the line holds no figure, so any is another); `others` are those instances. In a pooled slot, each element that
    the pooled instances do not all hold with one figure, one lacking it included; `others` is every pooled instance."""
    out: list[DifferingCell] = []
    for key, slot in sorted(_slots(artefact).items()):
        owner = slot.owner.owner
        if owner is not None:
            mine = _by_element(slot.facts[owner])
            elements: dict[str, list[str]] = {}
            concepts: dict[str, str | None] = {}
            for file in slot.owner.instances:
                if file == owner:
                    continue
                for element, facts in _by_element(slot.facts[file]).items():
                    if {fact_figure(f) for f in facts} != {fact_figure(f) for f in mine.get(element, [])}:
                        elements.setdefault(element, []).append(file)
                        concepts.setdefault(element, (mine.get(element) or facts)[0]["concept"])
            out += [DifferingCell(key, element, concepts[element], owner, files) for element, files in elements.items()]
        else:
            agreed = _agreed(slot)
            first: dict[str, dict] = {}
            for file in slot.pooled:
                for fact in slot.facts[file]:
                    first.setdefault(fact["element"], fact)
            out += [DifferingCell(key, element, fact["concept"], None, list(slot.pooled))
                    for element, fact in first.items() if element not in agreed]
    return sorted(out, key=lambda cell: (cell.slot, cell.element))
