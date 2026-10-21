"""Build small synthetic XBRL instances shaped like the Indian filings, for offline tests.

Never use real filings in tests; these instances are generated here, with fictional values. The tests
that read the real files are gated on ``MAESTER_XBRL_DIR`` and write nothing.

A module that imports this one imports it bare (``from xbrl_fixtures import instance``), as the other
tests import ``pdf_fixtures``.
"""

import os
import re
import unittest
from collections.abc import Iterable, Iterator, Sequence
from decimal import Decimal
from pathlib import Path
from typing import NamedTuple
from xml.sax.saxutils import escape, quoteattr

from pdf_financial_qa.workflow.contracts import ExtractedCheck, ExtractionWarning
from pdf_financial_qa.xbrl.formats import detect_format
from pdf_financial_qa.xbrl.maps import load_map
from pdf_financial_qa.xbrl.parser import Instance, parse_instance
from pdf_financial_qa.xbrl.read import XbrlFactData, XbrlReadData, read_instance

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


# The period token of a real file's name, which follows the date: 2025-06-10_MC2024-2025_consolidated_...
_PERIOD_TOKEN = re.compile(r"_(MC|MQ|MH|JQ|SQ|SH|DQ|DN)\d{4}")


def real_instances_with_period_token() -> Iterator[tuple[Path, str]]:
    """Each real instance with the period token of its file name (``MC``, ``MQ``, ``MH``, ``JQ``, ``SQ``,
    ``SH``, ``DQ``, ``DN``). A name with no token is a defect in the collection and raises."""
    for path in real_instances():
        match = _PERIOD_TOKEN.search(path.name)
        if match is None:
            raise ValueError(f"no period token in the name of {path.name}")
        yield path, match.group(1)


# The real instances the tests name, per mapped format: the file-name tokens that pick them. In-capmkt has every
# period token, and MQ is the Q4 results case (a quarter's facts beside the year's). In-bse-fin has only SQ and
# DQ, and only its SQ files hold a balance sheet and a cash flow.
_NAMED = {
    "in-capmkt/ind_as": ("Integrated_Finance_Ind_As", ("MC", "SH", "JQ", "MQ")),
    "in-bse-fin/ind_as": ("Main_Ind_As", ("SQ", "SQ", "DQ")),
}


def named_real_instances() -> dict[str, list[Path]]:
    """Real instances by format id, the same files on every run: for each wanted period token, in the order
    above, the first file in path order that has the format's file-name token and the period token, is not taken
    yet and whose elements give the format. A format with no match, or no ``MAESTER_XBRL_DIR``, has fewer
    files, down to none."""
    paths = list(real_instances())
    named: dict[str, list[Path]] = {}
    for format_id, (format_token, period_tokens) in _NAMED.items():
        chosen: list[Path] = []
        for period_token in period_tokens:
            for path in paths:
                format_match, period_match = _FORMAT_TOKEN.search(path.name), _PERIOD_TOKEN.search(path.name)
                if (
                    path not in chosen
                    and format_match is not None
                    and period_match is not None
                    and format_match.group(1) == format_token
                    and period_match.group(1) == period_token
                    and detect_format(parse(path.read_bytes())).id == format_id
                ):
                    chosen.append(path)
                    break
        named[format_id] = chosen
    return named


# --- the read ------------------------------------------------------------------------------------

# The lines ``ind_as()`` writes, by key: the element and its value in rupees in ``OneD`` (``FourD`` holds twice
# it). The values add up: revenue + other income = income; the seven expense lines = expenses; income − expenses
# = profit before exceptional items and tax. The two marker lines (comprehensive income, earnings per share) are
# written in ``OneD`` only, as ``IND_AS_MARKERS`` writes them.
_IND_AS_LINES: dict[str, tuple[str, str]] = {
    "revenue": ("RevenueFromOperations", "1234500000"),
    "other_income": ("OtherIncome", "5500000"),
    "income": ("Income", "1240000000"),
    "cost_of_materials": ("CostOfMaterialsConsumed", "400000000"),
    "purchases": ("PurchasesOfStockInTrade", "100000000"),
    "changes_in_inventories": ("ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade", "10000000"),
    "employee_benefits": ("EmployeeBenefitExpense", "150000000"),
    "finance_costs": ("FinanceCosts", "20000000"),
    "depreciation": ("DepreciationDepletionAndAmortisationExpense", "60000000"),
    "other_expenses": ("OtherExpenses", "200000000"),
    "expenses": ("Expenses", "940000000"),
    "profit_before_exceptional_items_and_tax": ("ProfitBeforeExceptionalItemsAndTax", "300000000"),
}
_MARKER_KEYS = {
    "comprehensive_income": "ComprehensiveIncomeForThePeriod",
    "eps": "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
}


def ind_as(*, default_decimals: str = "-5", **lines: tuple[str | None, str]) -> list[FactTuple]:
    """An Ind AS results instance's facts: the markers, the identity facts and the profit and loss lines from
    revenue to profit before exceptional items and tax, in ``OneD`` and ``FourD``. A given line, as
    ``(text, decimals)`` (a text of None is nil), replaces its ``OneD`` fact only. A line not given is written at
    ``default_decimals``; earnings per share keeps ``INF``. No cash-flow line and no rounding fact."""
    unknown = set(lines) - set(_IND_AS_LINES) - set(_MARKER_KEYS)
    if unknown:
        raise ValueError(f"no such line: {sorted(unknown)}")
    facts: list[FactTuple] = []
    for element, context, unit, decimals, text in IND_AS_MARKERS:
        key = next(k for k, e in _MARKER_KEYS.items() if e == element)
        if decimals != "INF":
            decimals = default_decimals
        if key in lines:
            text, decimals = lines[key]
        facts.append((element, context, unit, decimals, text))
    facts += identity_facts()
    for key, (element, rupees) in _IND_AS_LINES.items():
        one_text, one_decimals = lines.get(key, (rupees, default_decimals))
        facts.append((element, "OneD", "INR", one_decimals, one_text))
        facts.append((element, "FourD", "INR", default_decimals, str(Decimal(rupees) * 2)))
    return facts


def read(data: bytes) -> XbrlReadData:
    """Parse with the default limits, then read."""
    return read_instance(parse(data))


def fact(r: XbrlReadData, element: str, context_id: str) -> XbrlFactData:
    """The one fact of ``element`` in ``context_id``; fails the test when there is not exactly one."""
    found = [x for x in r.facts if x.element == element and x.context_id == context_id]
    if len(found) != 1:
        raise unittest.TestCase.failureException(f"{len(found)} facts of {element} in {context_id}")
    return found[0]


def check(r: XbrlReadData, total_element: str, period_label: str, check_type: str = "subtotal") -> ExtractedCheck:
    """The check of the sum whose total is ``total_element`` (or, with ``check_type="balance_identity"``, the
    balance identity whose left side it is) in the period ``period_label``."""
    entry = load_map(r.format.id).entry(total_element)
    found = [
        c for c in r.checks
        if c.check_type == check_type and c.statement == entry.statement
        and c.subject_label == entry.label and c.period_label == period_label
    ]
    if len(found) != 1:
        raise unittest.TestCase.failureException(f"{len(found)} {check_type} checks of {total_element} in {period_label}")
    return found[0]


def codes(r: XbrlReadData) -> list[str]:
    return sorted(w.code for w in r.warnings)


def warning(r: XbrlReadData, code: str) -> ExtractionWarning:
    found = [w for w in r.warnings if w.code == code]
    if len(found) != 1:
        raise unittest.TestCase.failureException(f"{len(found)} warnings {code}")
    return found[0]


def cash_balances(r: XbrlReadData) -> list[XbrlFactData]:
    return sorted((x for x in r.facts if x.element == "CashAndCashEquivalentsCashFlowStatement"), key=lambda x: x.line_order)


def sum_outcomes(reads: Iterable[tuple[Path, XbrlReadData]]) -> dict[str, dict[str, list[str]]]:
    """For each sum id of the maps (and ``balance``, the balance identity): the names of the files with a check of
    that status, under ``passed``, ``failed`` and ``not_checked``. A file with several periods can be under more
    than one status. A check is traced to its sum by its statement and subject label: a label is unique in its
    statement."""
    outcomes: dict[str, dict[str, list[str]]] = {}
    for path, r in reads:
        element_map = load_map(r.format.id) if r.format.id is not None else None
        if element_map is None:
            continue
        sum_of = {}
        for total in element_map.sums:
            entry = element_map.entry(total.total)
            sum_of[(entry.statement, entry.label)] = total.id
        for c in r.checks:
            sum_id = "balance" if c.check_type == "balance_identity" else sum_of[(c.statement, c.subject_label)]
            names = outcomes.setdefault(sum_id, {"passed": [], "failed": [], "not_checked": []})[c.status]
            if path.name not in names:
                names.append(path.name)
    return outcomes


_MAPS_README = Path(__file__).resolve().parents[1] / "packages/financial-engine/src/pdf_financial_qa/xbrl/maps/README.md"


def known_filer_inconsistencies() -> set[tuple[str, str, str]]:
    """The rows of the "Known filer inconsistencies" table in the maps README (the section's first table), as
    (file name, sum id, period). The failures not yet confirmed against a PDF, in the table after it, are not."""
    rows: set[tuple[str, str, str]] = set()
    text = _MAPS_README.read_text(encoding="utf-8")
    lines = text.split("## Known filer inconsistencies", 1)[1].splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("|"))
    table = []
    for line in lines[start:]:
        if not line.startswith("|"):
            break
        table.append(line)
    for line in table[2:]:  # past the header and the separator
        cells = [cell.strip().strip("`") for cell in line.strip().strip("|").split("|")]
        rows.add((cells[0], cells[1], cells[2]))
    return rows
