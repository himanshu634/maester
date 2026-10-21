"""The format tags: how a filing prints its figures, and which filings to label first.

A tag is the unit a filing prints in, whether negatives are in brackets and whether it restates columns. The unit is
proposed from the declared rounding of the filing's XBRL instances; the investor sets the rest (and may correct the
unit). A tag nobody set is "not tagged", never "no".

`pick_gold` chooses the first gold filings greedily so that every tag value in `REQUIREMENTS` has a filing. It reads
the manifest only, never a figure. `gold_coverage` and `unit_against_gold` then count what gold holds by tag, and
check the unit tag against the scales of the gold facts (a scale, never a figure).

Messages and console lines carry ids, tag words and counts only.
"""

from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Literal, get_args

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl.formats import MAPPED_FORMATS, detect_format
from pdf_financial_qa.xbrl.identity import read_identity
from pdf_financial_qa.xbrl.parser import parse_instance
from pdf_financial_qa.xbrl.units import rounding_of

from maester_eval.concepts import Taxonomy
from maester_eval.errors import EvalError
from maester_eval.gold import GoldFiling
from maester_eval.manifest import Filing, FormatTags, Manifest, SetChoice, Unit, tag_values
from maester_eval.xbrl_limits import XBRL_LIMITS

UNITS: tuple[str, ...] = get_args(Unit)
ProposeReason = Literal["xbrl", "instances_disagree", "no_rounding", "unreadable", "no_instance"]
GoldUnit = Literal["agrees", "disagrees", "mixed", "no_monetary_gold", "not_tagged"]

_UNIT_OF_EXPONENT: dict[int, Unit] = {-7: "crore", -5: "lakh", -6: "million", -3: "thousand", 0: "rupees"}
_UNIT_OF_SCALE: dict[Decimal, Unit] = {Decimal("10000000"): "crore", Decimal("100000"): "lakh",
                                       Decimal("1000000"): "million", Decimal("1000"): "thousand",
                                       Decimal("1"): "rupees"}

# (dimension, value, minimum): the tag values the first gold filings must cover. The dimensions are the ones
# `requirement_keys` builds.
REQUIREMENTS = (
    ("kind", "annual_report", 4), ("kind", "financial_results", 8), ("spread", "yes", 2),
    ("quarter", "Q1", 1), ("quarter", "Q2", 2), ("quarter", "Q3", 1), ("quarter", "Q4", 1),
    ("token", "SQ", 1), ("token", "SH", 1), ("family", "in-capmkt", 1), ("family", "in-bse-fin", 1),
    ("unit", "crore", 1), ("unit", "lakh", 1), ("unit", "million", 1),
    ("bases", "standalone_only", 1), ("instances", "refiled", 1),
    ("stratum", "large", 2), ("stratum", "mid", 2), ("stratum", "small", 2),
)

# The dimensions of `tag_values`, in the order a report lists them.
TAG_DIMENSIONS = ("unit", "brackets", "restated", "spreads", "financials")
_QUARTER_OF_TOKEN = {"JQ": "Q1", "SQ": "Q2", "SH": "Q2", "DQ": "Q3", "DN": "Q3", "MQ": "Q4", "MH": "Q4", "MC": "Q4"}


class TagsError(EvalError, ValueError):
    pass


def unit_of_exponent(exponent: int) -> Unit | None:
    """The unit a declared rounding's exponent names: crore -7, lakh -5, million -6, thousand -3, rupees 0. Anything
    else, Billions (-9) included, has no `Unit`."""
    return _UNIT_OF_EXPONENT.get(exponent)


def unit_of_scale(scale: str | None) -> Unit | None:
    """The unit a gold fact's scale names, or None for any other number or for no scale."""
    if not scale:
        return None
    try:
        return _UNIT_OF_SCALE.get(Decimal(scale))
    except InvalidOperation:
        return None


def propose_unit(filing: Filing, corpus: Path) -> tuple[Unit | None, ProposeReason]:
    """The unit the filing's instances declare, and why there is none when there is none.

    A unit is given only when every pair's declared rounding names one unit. The reasons are `no_instance` (no
    pair), `unreadable` (a pair that does not parse), `no_rounding` (a pair with no rounding word, a word that is not
    known, or a rounding with no `Unit`, Billions for one) and `instances_disagree`. A file the corpus does not hold
    is an `OSError` that names it."""
    if not filing.xbrl:
        return None, "no_instance"
    units: list[Unit | None] = []
    for pair in filing.xbrl:
        data = (corpus / pair.file).read_bytes()
        try:
            instance = parse_instance(data, **XBRL_LIMITS)
        except ExtractionError:
            return None, "unreadable"
        rounding = rounding_of(read_identity(instance, detect_format(instance).family).rounding_word)
        units.append(None if rounding is None else unit_of_exponent(rounding.exponent))
    if None in units:
        return None, "no_rounding"
    if len(set(units)) > 1:
        return None, "instances_disagree"
    return units[0], "xbrl"


@dataclass
class Proposal:
    """What `propose_units` found, as filing ids, in manifest order."""

    manifest: Manifest
    set: list[str] = field(default_factory=list)
    disagree: list[str] = field(default_factory=list)
    no_rounding: list[str] = field(default_factory=list)
    no_instance: list[str] = field(default_factory=list)
    unreadable: list[str] = field(default_factory=list)


def propose_units(manifest: Manifest, eval_set: SetChoice, corpus: Path) -> Proposal:
    """Set `unit` and `unit_from "xbrl"` on each in-scope results filing of the set that has a proposal.

    A filing whose unit the investor set is left as it is and not counted. A filing with no proposal keeps the unit
    it had. Annual reports have no instance and are not asked."""
    chosen = {f.id for f in manifest.select(eval_set) if f.kind == "financial_results"}
    proposal = Proposal(manifest)
    filings: list[Filing] = []
    for filing in manifest.filings:
        if filing.id not in chosen or (filing.tags is not None and filing.tags.unit_from == "investor"):
            filings.append(filing)
            continue
        unit, reason = propose_unit(filing, corpus)
        if unit is None:
            unproposed = {"instances_disagree": proposal.disagree, "no_rounding": proposal.no_rounding,
                          "unreadable": proposal.unreadable, "no_instance": proposal.no_instance}
            unproposed[reason].append(filing.id)
            filings.append(filing)
            continue
        proposal.set.append(filing.id)
        tags = (filing.tags or FormatTags()).model_copy(update={"unit": unit, "unit_from": "xbrl"})
        filings.append(filing.model_copy(update={"tags": tags}))
    proposal.manifest = Manifest(filings=filings)
    return proposal


def set_tags(manifest: Manifest, filing_id: str, unit: str | None, brackets: str | None,
             restated: str | None) -> Manifest:
    """The manifest with the investor's tags on one filing. A unit sets `unit_from "investor"`. Nothing to set is refused."""
    if unit is None and brackets is None and restated is None:
        raise TagsError("nothing to set: give --unit, --brackets or --restated")
    if unit is not None and unit not in UNITS:
        raise TagsError(f"--unit must be one of {', '.join(UNITS)}")
    flags: dict[str, bool] = {}
    for option, field_name, word in (("brackets", "negatives_in_brackets", brackets),
                                     ("restated", "restated_columns", restated)):
        if word is not None:
            if word not in ("yes", "no"):
                raise TagsError(f"--{option} must be yes or no")
            flags[field_name] = word == "yes"
    if filing_id not in manifest.by_id():
        raise TagsError(f"{filing_id} is not in the manifest")
    update: dict[str, object] = {**flags}
    if unit is not None:
        update.update(unit=unit, unit_from="investor")
    filings = [f.model_copy(update={"tags": (f.tags or FormatTags()).model_copy(update=update)})
               if f.id == filing_id else f for f in manifest.filings]
    return Manifest(filings=filings)


def requirement_keys(filing: Filing) -> set[tuple[str, str]]:
    """The `(dimension, value)` pairs a filing can advance."""
    keys: set[tuple[str, str]] = {("kind", filing.kind)}
    if filing.stratum is not None:
        keys.add(("stratum", filing.stratum))
    if filing.printed_pages_per_page == 2:
        keys.add(("spread", "yes"))
    for pair in filing.xbrl:
        token = pair.period[:2]
        keys.add(("quarter", _QUARTER_OF_TOKEN[token]))
        keys.add(("token", token))
        if pair.format is not None:
            keys.add(("family", pair.format.split("/")[0]))
    if filing.tags is not None and filing.tags.unit is not None:
        keys.add(("unit", filing.tags.unit))
    if filing.xbrl and all(p.basis == "standalone" for p in filing.xbrl):
        keys.add(("bases", "standalone_only"))
    if any(n > 1 for n in Counter((p.period, p.basis) for p in filing.xbrl).values()):
        keys.add(("instances", "refiled"))
    return keys


def eligible(filing: Filing) -> bool:
    """Whether a filing can be a gold filing: not out of scope and, for results, with an instance a map reads."""
    if filing.out_of_scope is not None:
        return False
    return filing.kind != "financial_results" or any(p.format in MAPPED_FORMATS for p in filing.xbrl)


@dataclass
class PickResult:
    picked: list[str]
    unmet: list[tuple[str, str, int]]
    # For each pick, the requirements it advanced, in the order of `requirements`.
    advanced: list[list[tuple[str, str]]] = field(default_factory=list)


def pick_gold(filings: list[Filing], count: int, requirements=REQUIREMENTS, include: list[str] = [],
              exclude: list[str] = []) -> PickResult:
    """The filings to label first: those in `include`, then the filing that advances most unmet requirements, until
    `count`. A tie goes to the company with fewer picks, then to the earlier filing of the manifest."""
    by_id = {f.id: f for f in filings}
    for filing_id in include:
        if filing_id not in by_id:
            raise TagsError(f"{filing_id} is not among the filings")
        if filing_id in exclude:
            raise TagsError(f"{filing_id} is both included and excluded")
        if not eligible(by_id[filing_id]):
            raise TagsError(f"{filing_id} is not eligible: out of scope, or no instance a map reads")
    if len(set(include)) > count:
        raise TagsError(f"{len(set(include))} included filings are more than the count {count}")
    need = {(d, v): n for d, v, n in requirements}
    rank = {(d, v): i for i, (d, v, _) in enumerate(requirements)}
    pool = [f for f in filings if eligible(f) and f.id not in exclude]  # manifest order
    order = {f.id: n for n, f in enumerate(pool)}
    picked: list[Filing] = []
    advanced: list[list[tuple[str, str]]] = []
    per_company: Counter[str] = Counter()

    def gain(f: Filing) -> int:
        return sum(1 for key in requirement_keys(f) if need.get(key, 0) > 0)

    def take(f: Filing) -> None:
        picked.append(f)
        per_company[f.company_folder] += 1
        met = sorted((key for key in requirement_keys(f) if need.get(key, 0) > 0), key=rank.__getitem__)
        advanced.append(met)
        for key in met:
            need[key] -= 1

    for filing_id in dict.fromkeys(include):
        take(by_id[filing_id])
    while len(picked) < count:
        taken = {f.id for f in picked}
        left = [f for f in pool if f.id not in taken]
        if not left:
            break
        take(max(left, key=lambda f: (gain(f), -per_company[f.company_folder], -order[f.id])))
    return PickResult([f.id for f in picked], [(d, v, n) for (d, v), n in need.items() if n > 0], advanced)


def gold_coverage(filings: list[Filing], gold: dict[str, GoldFiling]) -> dict[str, dict[str, tuple[int, int]]]:
    """For each tag dimension and each value some filing has, the gold filings and gold facts with that value.

    `filings` is every in-scope filing of the set and `gold` is the `sheet` view. A value no gold filing has is
    `(0, 0)`. `not tagged` is not a value and has no row."""
    by_id = {f.id: f for f in filings}
    values = {f.id: tag_values(f) for f in filings}
    table: dict[str, dict[str, tuple[int, int]]] = {}
    for dimension in TAG_DIMENSIONS:
        row: dict[str, tuple[int, int]] = {}
        for value in sorted({v[dimension] for v in values.values()} - {"not tagged"}):
            held = [g for filing_id, g in gold.items() if filing_id in by_id and values[filing_id][dimension] == value]
            row[value] = (len(held), sum(len(g.facts) for g in held))
        table[dimension] = row
    return table


def unit_against_gold(filing: Filing, gold: GoldFiling, taxonomy: Taxonomy) -> GoldUnit:
    """The unit tag against the scales of the gold's monetary facts. It reads scales, never a figure."""
    if filing.tags is None or filing.tags.unit is None:
        return "not_tagged"
    units = set()
    for fact in gold.facts:
        concept = taxonomy.get(fact.concept)
        if concept is not None and concept.kind == "monetary" and fact.value_status == "value":
            units.add(unit_of_scale(fact.scale))
    if not units:
        return "no_monetary_gold"
    if len(units) > 1:
        return "mixed"
    return "agrees" if units == {filing.tags.unit} else "disagrees"
