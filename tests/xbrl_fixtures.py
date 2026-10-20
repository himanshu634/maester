"""Build small synthetic XBRL instances shaped like the Indian filings, for offline tests.

Never use real filings in tests; these instances are generated here, with fictional values. The tests
that read the real files are gated on ``MAESTER_XBRL_DIR`` and write nothing.

A module that imports this one imports it bare (``from xbrl_fixtures import instance``), as the other
tests import ``pdf_fixtures``.
"""

import os
import re
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import NamedTuple
from xml.sax.saxutils import escape, quoteattr

from pdf_financial_qa.xbrl.parser import Instance, parse_instance

# (element, context, unit, decimals, text). A text of None writes xsi:nil="true".
FactTuple = tuple[str, str, str | None, str | None, str | None]

CAPMKT_2025 = "http://www.sebi.gov.in/xbrl/2025-01-31/in-capmkt"
CAPMKT_2026 = "http://www.sebi.gov.in/xbrl/2026-01-31/in-capmkt"
BSE_FIN = "http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin"

_PREFIXES = {CAPMKT_2025: "in-capmkt", CAPMKT_2026: "in-capmkt", BSE_FIN: "in-bse-fin"}
_SCRIP_SCHEMES = {BSE_FIN: "http://www.bseindia.com/bse-fin/ScripCode"}
_CAPMKT_SCRIP_SCHEME = "http://www.sebi.gov.in/in-capmkt/ScripCode"


class ContextSpec(NamedTuple):
    """A context. ``dimension`` is where an explicit member sits, "scenario" or "segment", or None for
    none. With neither dates nor an instant the period is ``forever``."""

    id: str
    start: str | None = None
    end: str | None = None
    instant: str | None = None
    dimension: str | None = None


class UnitSpec(NamedTuple):
    """A unit. Measures are written ``prefix:local``. A denominator makes it a ``divide``."""

    id: str
    numerator: tuple[str, ...]
    denominator: tuple[str, ...] = ()


Q2_CONTEXTS: tuple[ContextSpec, ...] = (
    ContextSpec("OneD", "2025-07-01", "2025-09-30"),
    ContextSpec("FourD", "2025-04-01", "2025-09-30"),
    ContextSpec("OneI", instant="2025-09-30"),
    ContextSpec("PY_I", instant="2025-03-31"),
    ContextSpec("OneExpenses1D", "2025-07-01", "2025-09-30", dimension="scenario"),
)

STANDARD_UNITS: tuple[UnitSpec, ...] = (
    UnitSpec("INR", ("iso4217:INR",)),
    UnitSpec("INRPerShare", ("iso4217:INR",), ("xbrli:shares",)),
    UnitSpec("pure", ("xbrli:pure",)),
)

# The two facts only an Ind AS statement has (the survey): it tells Ind AS from the other formats.
IND_AS_MARKERS: list[FactTuple] = [
    ("ComprehensiveIncomeForThePeriod", "OneD", "INR", "-5", "300000000"),
    ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INRPerShare", "INF", "12.34"),
]

_ROOT_NAMESPACES = {
    "xbrli": "http://www.xbrl.org/2003/instance",
    "link": "http://www.xbrl.org/2003/linkbase",
    "xlink": "http://www.w3.org/1999/xlink",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
    "xbrldi": "http://xbrl.org/2006/xbrldi",
    "iso4217": "http://www.xbrl.org/2003/iso4217",
}


def f(
    element: str,
    context: str = "OneD",
    unit: str | None = "INR",
    decimals: str | None = "-5",
    text: str | None = "100000",
) -> FactTuple:
    """A fact tuple, by default a monetary one in the quarter, rounded to the lakh."""
    return (element, context, unit, decimals, text)


def identity_facts(*, symbol: str = "SYNCEM", basis: str | None = "Consolidated") -> list[FactTuple]:
    """The metadata facts of a results instance, with fictional values, all in ``OneD``. It writes no
    rounding fact: ``instance()`` does. ``basis=None`` leaves the basis fact out."""
    facts: list[FactTuple] = [
        ("NameOfTheCompany", "OneD", None, None, "SYNTHETIC CEMENTS LIMITED"),
        ("ScripCode", "OneD", None, None, "500999"),
        ("Symbol", "OneD", None, None, symbol),
        ("ISIN", "OneD", None, None, "INE999Z01011"),
        ("DateOfStartOfReportingPeriod", "OneD", None, None, "2025-07-01"),
        ("DateOfEndOfReportingPeriod", "OneD", None, None, "2025-09-30"),
        ("ReportingQuarter", "OneD", None, None, "Second quarter"),
    ]
    if basis is not None:
        facts.insert(4, ("NatureOfReportStandaloneConsolidated", "OneD", None, None, basis))
    return facts


def instance(
    *,
    namespace: str = CAPMKT_2025,
    schema_ref: str = "in-capmkt-ent-2025-01-31.xsd",
    contexts: Sequence[ContextSpec] = Q2_CONTEXTS,
    units: Sequence[UnitSpec] = STANDARD_UNITS,
    rounding: str | None = "Lakhs",
    facts: Sequence[FactTuple] = (),
    doctype: str | None = None,
    comment: str = "<!--IFIndAs V1.0 (07-10-2025)-->",
) -> bytes:
    """An instance document. It knows its family, so it writes the one rounding fact itself: in context
    ``OneD``, before the given facts, as ``LevelOfRoundingUsedInFinancialStatements`` for ``BSE_FIN`` and
    ``LevelOfRounding`` for any other namespace. ``rounding=None`` writes none. ``comment`` and
    ``doctype`` are written as given, after the XML declaration and before the root."""
    prefix = _PREFIXES.get(namespace, "x")
    member = (
        f'<xbrldi:explicitMember dimension="{prefix}:DetailsOfOtherExpensesAxis">'
        f"{prefix}:OtherExpenses1Member</xbrldi:explicitMember>"
    )
    scheme = _SCRIP_SCHEMES.get(namespace, _CAPMKT_SCRIP_SCHEME)

    declarations = " ".join(f'xmlns:{p}="{uri}"' for p, uri in {prefix: namespace, **_ROOT_NAMESPACES}.items())
    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    if comment:
        lines.append(comment)
    if doctype:
        lines.append(doctype)
    lines.append(f"<xbrli:xbrl {declarations}>")
    lines.append(f'<link:schemaRef xlink:type="simple" xlink:href={quoteattr(schema_ref)}/>')
    for spec in contexts:
        lines.append(_context(spec, scheme, member))
    for unit in units:
        lines.append(_unit(unit))
    all_facts = list(facts)
    if rounding is not None:
        name = "LevelOfRoundingUsedInFinancialStatements" if namespace == BSE_FIN else "LevelOfRounding"
        all_facts.insert(0, (name, "OneD", None, None, rounding))
    for fact in all_facts:
        lines.append(_fact(prefix, fact))
    lines.append("</xbrli:xbrl>")
    return "\n".join(lines).encode("utf-8")


def _context(spec: ContextSpec, scheme: str, member: str) -> str:
    if spec.instant:
        period = f"<xbrli:instant>{spec.instant}</xbrli:instant>"
    elif spec.start:
        period = f"<xbrli:startDate>{spec.start}</xbrli:startDate><xbrli:endDate>{spec.end}</xbrli:endDate>"
    else:
        period = "<xbrli:forever/>"
    segment = f"<xbrli:segment>{member}</xbrli:segment>" if spec.dimension == "segment" else ""
    scenario = f"<xbrli:scenario>{member}</xbrli:scenario>" if spec.dimension == "scenario" else ""
    return (
        f"<xbrli:context id={quoteattr(spec.id)}><xbrli:entity>"
        f'<xbrli:identifier scheme="{scheme}">500999</xbrli:identifier>{segment}</xbrli:entity>'
        f"<xbrli:period>{period}</xbrli:period>{scenario}</xbrli:context>"
    )


def _unit(unit: UnitSpec) -> str:
    def measures(names: Sequence[str]) -> str:
        return "".join(f"<xbrli:measure>{name}</xbrli:measure>" for name in names)

    if unit.denominator:
        body = (
            f"<xbrli:divide><xbrli:unitNumerator>{measures(unit.numerator)}</xbrli:unitNumerator>"
            f"<xbrli:unitDenominator>{measures(unit.denominator)}</xbrli:unitDenominator></xbrli:divide>"
        )
    else:
        body = measures(unit.numerator)
    return f"<xbrli:unit id={quoteattr(unit.id)}>{body}</xbrli:unit>"


def _fact(prefix: str, fact: FactTuple) -> str:
    element, context, unit, decimals, text = fact
    attributes = f" contextRef={quoteattr(context)}"
    if unit is not None:
        attributes += f" unitRef={quoteattr(unit)}"
    if decimals is not None:
        attributes += f" decimals={quoteattr(decimals)}"
    if text is None:
        return f'<{prefix}:{element}{attributes} xsi:nil="true"/>'
    return f"<{prefix}:{element}{attributes}>{escape(text)}</{prefix}:{element}>"


_DEFAULT_LIMITS = {"max_bytes": 20971520, "max_facts": 100000, "deadline_seconds": 30.0}


def parse(data: bytes, **limits) -> Instance:
    """``parse_instance`` with the default limits unless given."""
    return parse_instance(data, **{**_DEFAULT_LIMITS, **limits})


# The format token of a real file's name: <date>_<period>_<basis>_<token>_<scrip code>_<time>.xml, with a
# further _IFNBFC at the end of the twelve Integrated_Finance_NBFC files.
_FORMAT_TOKEN = re.compile(
    r"_(Integrated_Finance_Ind_As|Main_Ind_As|IFBanking|Banking|Integrated_Finance_NBFC|NBFC|IFOtherthan)"
    r"_\d+_\d+(?:_[A-Za-z]+)?\.xml$"
)


def real_instances() -> Iterator[Path]:
    """Every ``.xml`` under ``MAESTER_XBRL_DIR``, in a fixed order; none when it is not set."""
    directory = os.environ.get("MAESTER_XBRL_DIR")
    if directory:
        yield from sorted(Path(directory).expanduser().rglob("*.xml"))


def real_instances_with_token() -> Iterator[tuple[Path, str]]:
    """Each real instance with the format token of its file name (``Main_Ind_As``, ``IFBanking``, …).
    A name with no token is a defect in the collection and raises."""
    for path in real_instances():
        match = _FORMAT_TOKEN.search(path.name)
        if match is None:
            raise ValueError(f"no format token in the name of {path.name}")
        yield path, match.group(1)
