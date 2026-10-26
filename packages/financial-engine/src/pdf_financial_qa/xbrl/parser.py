"""Our own reader for XBRL 2.1 instance documents, over lxml, with hard limits.

An instance is untrusted input: the investor drops it in, and a hostile or broken file must not hang
a worker, exhaust memory or reach the network. So the reader

* refuses a DOCTYPE outright, before the parser starts (a scan of the prolog) and again from the
  parsed tree, which catches the encodings the scan cannot read (UTF-16);
* never resolves entities, loads a DTD or opens the network, so a DOCTYPE that got past both checks
  would still read nothing, and does not lift libxml2's size and depth limits (``huge_tree=False``);
* refuses a file over a byte limit or a fact limit, and stops when a deadline passes (the clock is
  read every 1000 elements);
* frees each finished top-level element, so memory follows one element and not the document.

It reads structure only. A fact's text stays the text it was written with: a number is never turned
into a float here, and the read that follows turns it into a ``Decimal``. A refusal raises
``ExtractionError("XBRL_UNREADABLE", <reason code>, retryable=False)``. The message is the reason code
and nothing else, so no document text reaches a log, and the error carries no chained exception for the
same reason.
"""

import codecs
import io
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

from lxml import etree

from pdf_financial_qa.workflow.errors import ExtractionError

from . import INSTANCE_NS

XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
LINK_NS = "http://www.xbrl.org/2003/linkbase"
XLINK_NS = "http://www.w3.org/1999/xlink"
ISO4217_NS = "http://www.xbrl.org/2003/iso4217"

REASONS = ("TOO_LARGE", "DOCTYPE", "MALFORMED", "NOT_AN_INSTANCE", "TOO_MANY_FACTS", "TIMED_OUT")

_CLOCK_EVERY = 1000  # elements between two reads of the clock

_ROOT = f"{{{INSTANCE_NS}}}xbrl"
_CONTEXT = f"{{{INSTANCE_NS}}}context"
_ENTITY = f"{{{INSTANCE_NS}}}entity"
_SEGMENT = f"{{{INSTANCE_NS}}}segment"
_SCENARIO = f"{{{INSTANCE_NS}}}scenario"
_PERIOD = f"{{{INSTANCE_NS}}}period"
_START_DATE = f"{{{INSTANCE_NS}}}startDate"
_END_DATE = f"{{{INSTANCE_NS}}}endDate"
_INSTANT = f"{{{INSTANCE_NS}}}instant"
_UNIT = f"{{{INSTANCE_NS}}}unit"
_DIVIDE = f"{{{INSTANCE_NS}}}divide"
_NUMERATOR = f"{{{INSTANCE_NS}}}unitNumerator"
_DENOMINATOR = f"{{{INSTANCE_NS}}}unitDenominator"
_MEASURE = f"{{{INSTANCE_NS}}}measure"
_SCHEMA_REF = f"{{{LINK_NS}}}schemaRef"
_XLINK_HREF = f"{{{XLINK_NS}}}href"
_XSI_NIL = f"{{{XSI_NS}}}nil"

# A unit measure is written as the prefix its namespace conventionally has, whatever prefix the file
# chose, so "iso4217:INR" means the same in every file. A measure in any other namespace keeps the
# prefix it was written with.
_MEASURE_PREFIXES = {ISO4217_NS: "iso4217", INSTANCE_NS: "xbrli"}

_DATE = re.compile(r"(\d{4}-\d{2}-\d{2})(?:T[\d:.]+)?(?:Z|[+-]\d{2}:\d{2})?")


@dataclass(frozen=True, slots=True)
class Context:
    """A context's period. ``dimensional`` is true when it has a scenario or a segment."""

    id: str
    start: date | None
    end: date | None
    instant: date | None
    dimensional: bool


@dataclass(frozen=True, slots=True)
class Unit:
    """A unit's measures, written ``prefix:local``: ``iso4217:INR`` over ``xbrli:shares``."""

    id: str
    numerator: tuple[str, ...]
    denominator: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RawFact:
    """One fact as written: ``decimals`` and ``text`` are the file's own strings, ``order`` is the
    fact's place among the facts, from 0. A nil fact has ``nil`` true and empty ``text``."""

    element: str
    namespace: str
    context_id: str
    unit_id: str | None
    decimals: str | None
    text: str
    nil: bool
    order: int


@dataclass(frozen=True, slots=True)
class Instance:
    """``root_namespaces`` maps the root's prefixes to their namespaces (the default one under "")."""

    root_namespaces: dict[str, str]
    schema_refs: list[str]
    contexts: dict[str, Context]
    units: dict[str, Unit]
    facts: list[RawFact]


class _Refused(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def parse_instance(
    data: bytes,
    *,
    max_bytes: int,
    max_facts: int,
    deadline_seconds: float,
    clock: Callable[[], float] = time.monotonic,
) -> Instance:
    """Read an instance, or raise ``ExtractionError("XBRL_UNREADABLE", <reason>, retryable=False)``."""
    try:
        return _parse(data, max_bytes, max_facts, deadline_seconds, clock)
    except _Refused as refused:
        reason = refused.reason
    except (etree.LxmlError, UnicodeError):
        reason = "MALFORMED"
    # Raised outside the handlers, so the error has no cause or context that holds document text.
    raise ExtractionError("XBRL_UNREADABLE", reason, retryable=False)


def _parse(
    data: bytes, max_bytes: int, max_facts: int, deadline_seconds: float, clock: Callable[[], float]
) -> Instance:
    if len(data) > max_bytes:
        raise _Refused("TOO_LARGE")
    _refuse_doctype_in_prolog(data)

    started = clock()
    root_namespaces: dict[str, str] = {}
    schema_refs: list[str] = []
    contexts: dict[str, Context] = {}
    units: dict[str, Unit] = {}
    facts: list[RawFact] = []
    depth = 0
    finished = 0
    seen_root = False

    events = etree.iterparse(
        io.BytesIO(data),
        events=("start", "end"),
        resolve_entities=False,
        no_network=True,
        load_dtd=False,
        huge_tree=False,
        remove_comments=True,
        remove_pis=True,
    )
    for event, elem in events:
        if event == "start":
            depth += 1
            if depth == 1:
                _check_root(elem)
                root_namespaces = {prefix or "": uri for prefix, uri in elem.nsmap.items()}
                seen_root = True
            continue

        depth -= 1
        finished += 1
        if finished % _CLOCK_EVERY == 0 and clock() - started > deadline_seconds:
            raise _Refused("TIMED_OUT")
        if depth != 1:  # only a child of the root is read; its descendants are read through it
            continue

        tag = elem.tag
        if tag == _CONTEXT:
            context = _read_context(elem)
            if context.id in contexts:
                raise _Refused("MALFORMED")
            contexts[context.id] = context
        elif tag == _UNIT:
            unit = _read_unit(elem)
            if unit.id in units:
                raise _Refused("MALFORMED")
            units[unit.id] = unit
        elif tag == _SCHEMA_REF:
            href = elem.get(_XLINK_HREF)
            if href:
                schema_refs.append(href)
        elif elem.get("contextRef") is not None:
            if len(facts) >= max_facts:
                raise _Refused("TOO_MANY_FACTS")
            facts.append(_read_fact(elem, len(facts)))
        _free(elem)

    if not seen_root:
        raise _Refused("MALFORMED")
    return Instance(root_namespaces, schema_refs, contexts, units, facts)


def _refuse_doctype_in_prolog(data: bytes) -> None:
    """Walk the prolog (byte order mark, XML declaration, comments, processing instructions) up to the
    root's start tag, and refuse a DOCTYPE found there. Comments are skipped, so one that mentions a
    DOCTYPE is not a DOCTYPE. A wide encoding (UTF-16) hides ASCII markup from this scan; the tree check
    in ``_check_root`` catches those."""
    size = len(data)
    pos = len(codecs.BOM_UTF8) if data.startswith(codecs.BOM_UTF8) else 0
    while pos < size:
        while pos < size and data[pos] in b" \t\r\n":
            pos += 1
        if data.startswith(b"<?", pos):
            end, closer = data.find(b"?>", pos + 2), 2
        elif data.startswith(b"<!--", pos):
            end, closer = data.find(b"-->", pos + 4), 3
        elif data[pos : pos + 9].upper() == b"<!DOCTYPE":
            raise _Refused("DOCTYPE")
        else:
            return  # the root's start tag, or something the parser will call malformed
        if end < 0:
            return
        pos = end + closer


def _check_root(root) -> None:
    if root.getroottree().docinfo.doctype:
        raise _Refused("DOCTYPE")
    if root.tag != _ROOT:
        raise _Refused("NOT_AN_INSTANCE")


def _free(elem) -> None:
    """Drop a finished top-level element and the ones before it, so the tree stays small."""
    elem.clear()
    parent = elem.getparent()
    while elem.getprevious() is not None:
        del parent[0]


def _read_context(elem) -> Context:
    context_id = elem.get("id")
    if not context_id:
        raise _Refused("MALFORMED")
    start = end = instant = None
    period = elem.find(_PERIOD)
    if period is not None:
        start = _read_date(period.find(_START_DATE))
        end = _read_date(period.find(_END_DATE))
        instant = _read_date(period.find(_INSTANT))
    entity = elem.find(_ENTITY)
    dimensional = elem.find(_SCENARIO) is not None or (entity is not None and entity.find(_SEGMENT) is not None)
    return Context(context_id, start, end, instant, dimensional)


def _read_date(node) -> date | None:
    if node is None:
        return None
    match = _DATE.fullmatch((node.text or "").strip())
    if match is None:
        raise _Refused("MALFORMED")
    try:
        return date.fromisoformat(match.group(1))
    except ValueError:
        raise _Refused("MALFORMED") from None


def _read_unit(elem) -> Unit:
    unit_id = elem.get("id")
    if not unit_id:
        raise _Refused("MALFORMED")
    divide = elem.find(_DIVIDE)
    if divide is None:
        return Unit(unit_id, _measures(elem), ())
    return Unit(unit_id, _measures(divide.find(_NUMERATOR)), _measures(divide.find(_DENOMINATOR)))


def _measures(parent) -> tuple[str, ...]:
    if parent is None:
        return ()
    return tuple(_measure_name(measure) for measure in parent.findall(_MEASURE))


def _measure_name(measure) -> str:
    text = (measure.text or "").strip()
    prefix, colon, local = text.partition(":")
    if not colon:
        prefix, local = None, text  # an unprefixed name is in the default namespace
    conventional = _MEASURE_PREFIXES.get(measure.nsmap.get(prefix))
    return f"{conventional}:{local}" if conventional else text


def _read_fact(elem, order: int) -> RawFact:
    tag = elem.tag
    if tag.startswith("{"):
        namespace, _, element = tag[1:].partition("}")
    else:
        namespace, element = "", tag
    nil = (elem.get(_XSI_NIL) or "").strip() in ("true", "1")
    return RawFact(
        element=element,
        namespace=namespace,
        context_id=elem.get("contextRef"),
        unit_id=elem.get("unitRef"),
        decimals=elem.get("decimals"),
        text="" if nil else _text_of(elem),
        nil=nil,
        order=order,
    )


def _text_of(elem) -> str:
    if len(elem) == 0:
        return elem.text or ""
    return etree.tostring(elem, method="text", encoding="unicode", with_tail=False)
