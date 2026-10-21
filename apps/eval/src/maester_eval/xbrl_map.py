"""The evaluation of the XBRL element maps, and of the `xbrl_in_pdf` check: counts and element names, never a value.

`maester-eval xbrl-map` reads every `.xml` under a folder with the engine's own parser, classifier and read, as the
extractor does, offline and with no model call. It counts what the read did: the files read and refused, the detected
format against the format token of the file name, the facts written and the share of numeric facts that a map covers,
the map's sums and the balance identity, the rounding cross-check, nil facts, the facts left out for their unit, the
share of facts with a concept, and the entry-point differences seen.

With `--pdfs` it also pairs each instance with the results PDF of the same BSE code announced the same day, reads
that PDF's text layer, classifies it by the rules alone (`classify_text`), and runs `check_xbrl_in_pdf` with the
request the worker builds. It counts the outcomes by statement, basis and unit, and measures two things the check
does not look at: the sign of a printed number, and how often a number that is one unit off still passes (a number
"anywhere on a statement page" counts).

The output holds element names, ids, file names of the instances and counts. Not a value, not a company name,
not the name of a PDF. An instance is named by its own file name (a date, a period token, a BSE code and a time),
never by the folder it sits in, which holds the company's name.
"""

import csv
import dataclasses
import re
import uuid
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation, localcontext
from pathlib import Path
from typing import Any

from pdf_financial_qa.classify.contracts import StatementFound
from pdf_financial_qa.classify.rules import RuleAnswers, classify_text
from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.values import format_decimal, page_numbers
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION, XBRL_PDF_CHECK_VERSION
from pdf_financial_qa.xbrl.checks import sum_checks
from pdf_financial_qa.xbrl.classify import classify_instance
from pdf_financial_qa.xbrl.contracts import XbrlPdfCheckFact, XbrlPdfCheckRequest
from pdf_financial_qa.xbrl.maps import ElementMap, load_map
from pdf_financial_qa.xbrl.parser import Instance, parse_instance
from pdf_financial_qa.xbrl.pdf_check import check_candidates, check_xbrl_in_pdf
from pdf_financial_qa.xbrl.read import XbrlFactData, XbrlReadData, read_instance

from maester_eval.errors import EvalError
from maester_eval.xbrl_survey import find_instances

REPORT_VERSION = 1
TOP_UNMAPPED = 30
TOP_FAILING = 20
MAX_NAMED = 25  # file names listed for one finding

# The extractor's limits (see xbrl_survey): a file it would refuse is counted unreadable here.
_MAX_BYTES = 20971520
_MAX_FACTS = 100000
_DEADLINE_SECONDS = 30.0

PER_SHARE = "₹ a share"
NO_FORMAT = "no format"

# The format a file-name token says the file is in (research §4). The token is the part of the name between the basis
# and the BSE code. A token of two names (`IFBanking`, `Banking`) is matched whole, never as a substring.
TOKEN_FORMATS = {
    "Integrated_Finance_Ind_As": "in-capmkt/ind_as",
    "Main_Ind_As": "in-bse-fin/ind_as",
    "IFBanking": "in-capmkt/banking",
    "Banking": "in-bse-fin/banking",
    "Integrated_Finance_NBFC": "in-capmkt/nbfc",
    "NBFC": "in-bse-fin/nbfc",
    "IFOtherthan": "in-capmkt/other_than_ind_as",
}
_TOKEN = re.compile(r"_(" + "|".join(TOKEN_FORMATS) + r")_\d+_\d+(?:_[A-Za-z]+)?\.xml$")
NO_TOKEN = "no token"


class XbrlMapError(EvalError):
    """A bad argument of `xbrl-map`: a manifest that cannot be read or lacks a column, or `--pdfs` with no manifest."""


def token_of(name: str) -> str:
    match = _TOKEN.search(name)
    return match.group(1) if match else NO_TOKEN


def share(part: int, whole: int) -> str:
    """`part` of `whole` as a percentage with one decimal, in integer arithmetic. "-" when there is no whole."""
    if whole <= 0:
        return "-"
    tenths = (part * 2000 + whole) // (2 * whole)  # round half up
    return f"{tenths // 10}.{tenths % 10}%"


# ---------------------------------------------------------------------------------------------------------------
# Manifests


def _rows(path: Path, columns: tuple[str, ...]) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            missing = [c for c in columns if c not in (reader.fieldnames or [])]
            if missing:
                raise XbrlMapError(f"{path} lacks the column(s) {', '.join(missing)}")
            return list(reader)
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise XbrlMapError(f"cannot read {path}: {type(exc).__name__}") from None


def read_instance_manifest(path: Path) -> dict[str, tuple[str, str]]:
    """`{instance file name: (bse_code, filed)}` from `bse_code, filed, file`. A name that two rows give is dropped:
    it cannot say which one an instance is."""
    found: dict[str, tuple[str, str]] = {}
    seen: set[str] = set()
    for row in _rows(path, ("bse_code", "filed", "file")):
        name = Path(row["file"]).name
        if name in seen:
            found.pop(name, None)
        else:
            found[name] = (row["bse_code"].strip(), row["filed"].strip())
            seen.add(name)
    return found


def read_pdf_manifest(path: Path) -> dict[tuple[str, str], list[str]]:
    """`{(bse_code, date): [file, ...]}` for the rows of category Result, subcategory Financial Results and status
    ok, files in sorted order."""
    found: dict[tuple[str, str], list[str]] = {}
    for row in _rows(path, ("bse_code", "date", "category", "subcategory", "status", "file")):
        if row["category"] == "Result" and row["subcategory"] == "Financial Results" and row["status"] == "ok":
            found.setdefault((row["bse_code"].strip(), row["date"].strip()), []).append(row["file"])
    return {key: sorted(files) for key, files in found.items()}


# ---------------------------------------------------------------------------------------------------------------
# The PDF side


@dataclass
class LoadedPdf:
    document: PdfDocument
    answers: RuleAnswers
    numbers: dict[int, set[Decimal]] = field(default_factory=dict)

    def numbers_of(self, index: int) -> set[Decimal]:
        if index not in self.numbers:
            self.numbers[index] = page_numbers(self.document.page_texts[index]) if index < self.document.page_count else set()
        return self.numbers[index]


class PdfCache:
    """Each PDF is read and classified once however many instances pair with it. The last few are kept."""

    def __init__(self, root: Path, keep: int = 6) -> None:
        self.root = root
        self.keep = keep
        self._loaded: OrderedDict[str, LoadedPdf | str] = OrderedDict()

    def get(self, relative: str) -> LoadedPdf | str:
        """The PDF, or the reason code it could not be read (`FILE_MISSING` or the reader's own code)."""
        if relative in self._loaded:
            self._loaded.move_to_end(relative)
            return self._loaded[relative]
        outcome: LoadedPdf | str
        try:
            document = PdfDocument.load((self.root / relative).read_bytes())
            outcome = LoadedPdf(document, classify_text(document.page_texts))
        except OSError:
            outcome = "FILE_MISSING"
        except ExtractionError as refused:
            outcome = refused.code
        self._loaded[relative] = outcome
        while len(self._loaded) > self.keep:
            self._loaded.popitem(last=False)
        return outcome


def _pages_of(answers: RuleAnswers) -> list[StatementFound]:
    return [StatementFound(statement=s, basis=b, pages=list(p)) for (s, b), p in sorted(answers.statements.items())]  # type: ignore[arg-type]


# The request the worker builds (`unitOf` in apps/worker/src/jobs/document-xbrl-check.ts).
def _places_of(value: str) -> int:
    point = value.find(".")
    return 0 if point < 0 else len(value) - point - 1


def unit_of(read: XbrlReadData) -> tuple[str | None, int | None]:
    """The scale the monetary facts share and the fewest places among their reported values; None, None when the read
    found no declared rounding or the facts disagree on the scale."""
    if any(w.code == "XBRL_ROUNDING_MISSING" for w in read.warnings):
        return None, None
    monetary = [f for f in read.facts if f.unit_label != PER_SHARE]
    scales = {f.scale_factor for f in monetary}
    if len(scales) != 1 or None in scales:
        return None, None
    places = [_places_of(f.reported_value) for f in monetary if f.reported_value is not None]
    return scales.pop(), (min(places) if places else None)


def _signed_forms(text: str, candidate: Decimal) -> set[str]:
    """How `candidate` is printed on a page: `signed` when a bracket or a minus stands right before it, `plain`
    otherwise. An approximation for a count: a table's own dashes can look like a minus."""
    text = re.sub(r"(?<=\d),\s+(?=\d)", ",", text)
    forms: set[str] = set()
    for match in re.finditer(r"\d[\d,]*(?:\.\d+)?", text):
        try:
            printed = Decimal(match.group().replace(",", ""))
        except InvalidOperation:
            continue
        if printed != abs(candidate):
            continue
        before = text[max(0, match.start() - 4): match.start()]
        signed = before[-1:] in ("-", "−") or before.rstrip().endswith("(")
        forms.add("signed" if signed else "plain")
    return forms


def _decoy(value: str, per_share: bool, scale: str | None, places: int | None) -> str | None:
    """The value moved by one unit of the last printed place. None for a value the request cannot move."""
    with localcontext() as context:
        context.prec = 60
        if per_share:
            return format_decimal(Decimal(value) + Decimal("0.01"))
        if scale is None or places is None:
            return None
        return format_decimal(Decimal(value) + Decimal(scale) * Decimal(1).scaleb(-places))


# ---------------------------------------------------------------------------------------------------------------
# The tally


def _group() -> Counter[str]:
    return Counter()


@dataclass
class Tally:
    """Everything the run counts. `to_report` turns it into the JSON-ready dict."""

    found: int = 0
    unreadable: Counter[str] = field(default_factory=Counter)
    read: int = 0
    matrix: dict[str, Counter[str]] = field(default_factory=dict)
    disagreeing: list[str] = field(default_factory=list)
    formats: dict[str, dict[str, Any]] = field(default_factory=dict)
    states: Counter[str] = field(default_factory=Counter)
    warning_files: Counter[str] = field(default_factory=Counter)
    sums: dict[str, Counter[str]] = field(default_factory=dict)
    sum_failures: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    balance: Counter[str] = field(default_factory=Counter)
    rounding: Counter[str] = field(default_factory=Counter)
    nil_facts: int = 0
    nil_files: int = 0
    unit_unsupported_files: int = 0
    unit_unsupported_elements: Counter[str] = field(default_factory=Counter)
    facts_written: int = 0
    facts_with_concept: int = 0
    entry_points: Counter[str] = field(default_factory=Counter)
    differences: dict[tuple[str, str, str], int] = field(default_factory=dict)
    # the paired-PDF run
    pdf: dict[str, Any] = field(default_factory=dict)
    pairing: Counter[str] = field(default_factory=Counter)
    by_dim: dict[str, dict[str, Counter[str]]] = field(
        default_factory=lambda: {"statement": {}, "basis": {}, "unit": {}, "pairing": {}})
    other_unit: dict[str, Counter[str]] = field(default_factory=dict)
    failing: Counter[str] = field(default_factory=Counter)
    decoy: dict[str, Counter[str]] = field(default_factory=dict)
    sign: dict[str, Counter[str]] = field(default_factory=dict)
    anywhere: Counter[str] = field(default_factory=Counter)


def _format_row(tally: Tally, format_id: str) -> dict[str, Any]:
    return tally.formats.setdefault(
        format_id,
        {"files": 0, "facts": 0, "numeric": 0, "mapped": 0, "ignored": 0, "unmapped": 0, "unmapped_elements": Counter()},
    )


def _count_format(tally: Tally, format_id: str, instance: Instance, read: XbrlReadData, element_map: ElementMap | None) -> None:
    row = _format_row(tally, format_id)
    row["files"] += 1
    row["facts"] += len(read.facts)
    if element_map is None:
        return
    unmapped_here: set[str] = set()
    for fact in instance.facts:
        if fact.unit_id is None:
            continue
        context = instance.contexts.get(fact.context_id)
        if context is None or context.dimensional:
            continue
        row["numeric"] += 1
        if element_map.entry(fact.element) is not None:
            row["mapped"] += 1
        elif fact.element in element_map.ignored:
            row["ignored"] += 1
        else:
            row["unmapped"] += 1
            unmapped_here.add(fact.element)
    row["unmapped_elements"].update(unmapped_here)


def _count_sums(tally: Tally, name: str, read: XbrlReadData, element_map: ElementMap) -> None:
    """Each sum, one by one, through the engine's own `sum_checks` on a map that holds that sum alone."""
    subtotal = 0
    for one in element_map.sums:
        alone = dataclasses.replace(element_map, sums=(one,), identities=())
        checks = sum_checks(read.facts, alone, read.finest_decimals)
        subtotal += len(checks)
        counts = tally.sums.setdefault(one.id, Counter())
        failed_periods: list[str] = []
        for check in checks:
            counts[check.status] += 1
            if check.status == "failed":
                failed_periods.append(check.period_label)
        if failed_periods:
            listed = tally.sum_failures.setdefault(one.id, [])
            if len(listed) < MAX_NAMED:
                listed.append({"file": name, "periods": sorted(set(failed_periods))})
    for check in read.checks:
        if check.check_type == "balance_identity":
            tally.balance[check.status] += 1
    if subtotal != sum(1 for c in read.checks if c.check_type == "subtotal"):
        raise EvalError(f"the per-sum count of {name} does not match the read's own checks")


def _entry_point(instance: Instance) -> str:
    if not instance.schema_refs:
        return "none"
    return Path(instance.schema_refs[0].split("?")[0].split("#")[0]).name or "none"


def _count_file(tally: Tally, path: Path, instance: Instance, read: XbrlReadData) -> None:
    classification = classify_instance(instance)
    detected = read.format.id or NO_FORMAT
    token = token_of(path.name)
    tally.matrix.setdefault(token, Counter())[detected] += 1
    if TOKEN_FORMATS.get(token) != detected:
        tally.disagreeing.append(path.name)
    element_map = load_map(read.format.id) if read.format.id else None
    _count_format(tally, detected, instance, read, element_map)
    tally.states[read.state] += 1
    for code in {w.code for w in read.warnings} | {w.code for w in classification.warnings}:
        tally.warning_files[code] += 1
    tally.facts_written += len(read.facts)
    tally.facts_with_concept += sum(1 for f in read.facts if f.concept is not None)
    nil = sum(1 for f in read.facts if f.nil)
    tally.nil_facts += nil
    tally.nil_files += 1 if nil else 0
    for warning in read.warnings:
        if warning.code == "XBRL_UNIT_UNSUPPORTED":
            tally.unit_unsupported_files += 1
            tally.unit_unsupported_elements.update(e.strip() for e in warning.message.split(","))
    rounding_warnings = {w.code for w in read.warnings}
    if "XBRL_ROUNDING_MISSING" in rounding_warnings:
        tally.rounding["missing"] += 1
    elif "XBRL_ROUNDING_MISMATCH" in rounding_warnings:
        tally.rounding["mismatch"] += 1
    else:
        tally.rounding["pass"] += 1
    point = _entry_point(instance)
    tally.entry_points[point] += 1
    if element_map is not None:
        _count_sums(tally, path.name, read, element_map)
        # The differences the map lists are facts with a member: count the files that hold the element with one.
        with_member = {fact.element for fact in instance.facts if instance.contexts[fact.context_id].dimensional}
        for difference in element_map.entry_point_differences:
            if difference.element in with_member:
                key = (difference.element, difference.only_in, point)
                tally.differences[key] = tally.differences.get(key, 0) + 1


# ---------------------------------------------------------------------------------------------------------------
# The paired-PDF run


def _pair(tally: Tally, period_end: Any, ids: tuple[str, str] | None,
          groups: dict[tuple[str, str], list[str]], cache: PdfCache) -> tuple[LoadedPdf, str] | None:
    """The PDF this instance is paired with, and how its period agrees (`period agrees` or `period unread`), or None
    with the reason counted."""
    if ids is None:
        tally.pairing["not_in_manifest"] += 1
        return None
    candidates = groups.get(ids, [])
    if not candidates:
        tally.pairing["unpaired_no_pdf"] += 1
        return None
    if len(candidates) > 1:
        tally.pairing["several_pdfs_that_day"] += 1
    readable: list[LoadedPdf] = []
    for relative in candidates:
        loaded = cache.get(relative)
        if isinstance(loaded, str):
            tally.pairing[f"pdf_unreadable_{loaded}"] += 1
        else:
            readable.append(loaded)
    if not readable:
        tally.pairing["unpaired_pdf_unreadable"] += 1
        return None
    agreeing = [p for p in readable if p.answers.period_end is not None and p.answers.period_end == period_end]
    unread = [p for p in readable if p.answers.period_end is None or period_end is None]
    if agreeing:
        tally.pairing["period_agrees"] += 1
        return agreeing[0], "period agrees"
    if unread:
        tally.pairing["period_unread"] += 1
        return unread[0], "period unread"
    tally.pairing["period_disagrees"] += 1
    return None


def _check_pair(tally: Tally, read: XbrlReadData, pdf: LoadedPdf, how: str, sign_of: dict[str, int]) -> None:
    tally.pairing["paired"] += 1
    if not read.facts:
        tally.pairing["paired_without_facts"] += 1
        return
    pages = _pages_of(pdf.answers)
    if not pdf.answers.statements:
        tally.pairing["paired_without_statement_pages"] += 1
    elif not any(basis == read.basis for (_, basis) in pdf.answers.statements):
        tally.pairing["paired_without_pages_for_the_basis"] += 1
    scale, places = unit_of(read)

    facts_by_id: dict[str, XbrlFactData] = {}
    sendable: list[XbrlPdfCheckFact] = []
    outcomes: list[tuple[XbrlFactData, str, int | None, str | None]] = []
    for fact in read.facts:
        per_share = fact.unit_label == PER_SHARE
        if scale is None and not per_share:  # answered by the worker without the extractor
            outcomes.append((fact, "not_checked", None, "no_unit"))
            continue
        fid = str(uuid.uuid4())
        facts_by_id[fid] = fact
        sendable.append(XbrlPdfCheckFact(fact_id=fid, value=fact.normalized_value, per_share=per_share,
                                         statement=fact.statement, basis=fact.basis))
    if sendable:
        request = XbrlPdfCheckRequest(scale=scale, places=places, statement_pages=pages, facts=sendable)
        result = check_xbrl_in_pdf(pdf.document.data, request)
        for item in result.results:
            outcomes.append((facts_by_id[item.fact_id], item.status, item.page_index, item.reason))
        _decoy_run(tally, pdf, scale, places, pages, sendable, facts_by_id)

    wanted = {(s, b): set(p) for (s, b), p in pdf.answers.statements.items()}
    failing_here: set[str] = set()
    for fact, status, page_index, reason in outcomes:
        label = reason if status == "not_checked" else None
        for dim, key in (("statement", fact.statement), ("basis", fact.basis), ("unit", fact.unit_label or "no unit"), ("pairing", how)):
            group = tally.by_dim[dim].setdefault(key, _group())
            group["not_checked:" + str(label) if status == "not_checked" else status] += 1
        if status == "failed":
            failing_here.add(fact.element)
            _count_other_unit(tally, fact, pdf, wanted.get((fact.statement, fact.basis), set()), scale)
        if status == "passed":
            _count_pass(tally, fact, pdf, wanted.get((fact.statement, fact.basis), set()), scale, places, sign_of, how)
    tally.failing.update(failing_here)


# The units a PDF can print in, as the scale that divides a value in rupees.
OTHER_UNITS = {"₹": Decimal(1), "₹ thousand": Decimal(1000), "₹ lakh": Decimal(100000), "₹ million": Decimal(1000000),
               "₹ crore": Decimal(10000000)}


def _count_other_unit(tally: Tally, fact: XbrlFactData, pdf: LoadedPdf, pages: set[int], scale: str | None) -> None:
    """A failed monetary fact: is its value on the statement's pages in a unit other than the declared one? An exact
    match only, and chance counts: the decoy share is the baseline to read it against."""
    if fact.unit_label == PER_SHARE or scale is None or fact.normalized_value is None:
        return
    value = abs(Decimal(fact.normalized_value))
    if value == 0 or not pages:
        return
    unit = fact.unit_label or "no unit"
    group = tally.other_unit.setdefault(unit, _group())
    group["failed_with_pages"] += 1
    found = []
    with localcontext() as context:
        context.prec = 60
        for label, divisor in OTHER_UNITS.items():
            if divisor == Decimal(scale):
                continue
            candidate = value / divisor
            if any(candidate in pdf.numbers_of(i) for i in pages):
                found.append(label)
    if found:
        group["found_in_another_unit"] += 1
        for label in found:
            group[f"as {label}"] += 1


def _count_pass(tally: Tally, fact: XbrlFactData, pdf: LoadedPdf, pages: set[int], scale: str | None,
                places: int | None, sign_of: dict[str, int], how: str) -> None:
    per_share = fact.unit_label == PER_SHARE
    candidates = check_candidates(Decimal(fact.normalized_value or "0"), per_share, Decimal(scale) if scale else None, places)
    # The check compares absolute values, and so does this: the page numbers are the absolute numbers on the page.
    candidates = [abs(c) for c in candidates]
    exact_anywhere = any(candidates[0] in pdf.numbers_of(i) for i in pages)
    kind = "passed_exact" if len(candidates) == 1 or exact_anywhere else "passed_rounded"
    for dim, key in (("statement", fact.statement), ("basis", fact.basis), ("unit", fact.unit_label or "no unit"), ("pairing", how)):
        tally.by_dim[dim].setdefault(key, _group())[kind] += 1

    value = Decimal(fact.normalized_value or "0")
    if value == 0:
        tally.anywhere["passed_zero"] += 1
    elif not per_share and abs(candidates[0]) < 100:
        tally.anywhere["passed_below_100"] += 1
    tally.anywhere["passed"] += 1

    # The sign: what the instance holds against what the page prints around the number that matched.
    klass = "negative" if value < 0 else ("part_taken_off" if sign_of.get(fact.element) == -1 else "other")
    counts = tally.sign.setdefault(klass, _group())
    counts["passed"] += 1
    forms: set[str] = set()
    for index in sorted(pages):
        if index >= pdf.document.page_count:
            continue
        for candidate in candidates:
            if candidate in pdf.numbers_of(index):
                forms |= _signed_forms(pdf.document.page_texts[index], candidate)
    counts["printed_signed_somewhere"] += 1 if "signed" in forms else 0
    counts["printed_plain_only"] += 1 if forms == {"plain"} else 0


def _decoy_run(tally: Tally, pdf: LoadedPdf, scale: str | None, places: int | None, pages: list[StatementFound],
               sendable: list[XbrlPdfCheckFact], facts_by_id: dict[str, XbrlFactData]) -> None:
    """The same check over each value moved by one unit of the last printed place. A decoy that passes is a number
    found by luck: the share of them is how much an "anywhere on a statement page" pass proves."""
    moved: list[XbrlPdfCheckFact] = []
    for item in sendable:
        if item.value is None:
            continue
        value = _decoy(item.value, item.per_share, scale, places)
        if value is not None:
            moved.append(item.model_copy(update={"value": value}))
    if not moved:
        return
    request = XbrlPdfCheckRequest(scale=scale, places=places, statement_pages=pages, facts=moved)
    for item in check_xbrl_in_pdf(pdf.document.data, request).results:
        if item.status == "not_checked":
            continue
        unit = facts_by_id[item.fact_id].unit_label or "no unit"
        group = tally.decoy.setdefault(unit, _group())
        group["checked"] += 1
        group["passed"] += 1 if item.status == "passed" else 0


# ---------------------------------------------------------------------------------------------------------------
# The run


def run_xbrl_map(instances: Path, manifest: Path | None = None, pdfs: Path | None = None,
                 pdf_manifest: Path | None = None) -> dict[str, Any]:
    """The report as a dict of counts and names. `pdfs` and `pdf_manifest` together switch the paired-PDF run on;
    it also needs `manifest` for each instance's BSE code and day."""
    with_pdfs = pdfs is not None or pdf_manifest is not None
    if with_pdfs and (pdfs is None or pdf_manifest is None or manifest is None):
        raise XbrlMapError("--pdfs needs --pdf-manifest and --manifest")
    ids_of = read_instance_manifest(manifest) if manifest is not None else {}
    groups = read_pdf_manifest(pdf_manifest) if pdf_manifest is not None else {}
    cache = PdfCache(pdfs) if pdfs is not None else None

    tally = Tally()
    paths = find_instances(instances)
    tally.found = len(paths)
    for path in paths:
        try:
            instance = parse_instance(path.read_bytes(), max_bytes=_MAX_BYTES, max_facts=_MAX_FACTS,
                                      deadline_seconds=_DEADLINE_SECONDS)
            read = read_instance(instance)
        except ExtractionError as refused:
            tally.unreadable[refused.message] += 1  # the reason code and nothing else
            continue
        tally.read += 1
        _count_file(tally, path, instance, read)
        if cache is not None:
            period_end = classify_instance(instance).period_end
            paired = _pair(tally, period_end, ids_of.get(path.name), groups, cache)
            if paired is not None:
                element_map = load_map(read.format.id) if read.format.id else None
                _check_pair(tally, read, paired[0], paired[1], _signs(element_map))
    return to_report(tally, with_pdfs)


def _signs(element_map: ElementMap | None) -> dict[str, int]:
    """The sign each element has as a part of a sum, -1 where any sum takes it off."""
    signs: dict[str, int] = {}
    if element_map is not None:
        for one in element_map.sums:
            for part in one.parts:
                signs[part.element] = min(signs.get(part.element, 1), part.sign)
    return signs


def _counts(counter: Counter[str]) -> dict[str, int]:
    return {key: counter[key] for key in sorted(counter)}


def _statuses(counter: Counter[str]) -> dict[str, Any]:
    """`passed`, `failed` and the not-checked count by reason out of a group's counter."""
    reasons = {key.split(":", 1)[1]: n for key, n in sorted(counter.items()) if key.startswith("not_checked:")}
    return {
        "passed": counter["passed"], "passed_exact": counter["passed_exact"], "passed_rounded": counter["passed_rounded"],
        "failed": counter["failed"], "not_checked": sum(reasons.values()), "not_checked_by_reason": reasons,
    }


def _top(counter: Counter[str], limit: int) -> list[dict[str, Any]]:
    return [{"element": element, "files": n} for element, n in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]]


def to_report(tally: Tally, with_pdfs: bool) -> dict[str, Any]:
    formats = {}
    for format_id in sorted(tally.formats):
        row = tally.formats[format_id]
        formats[format_id] = {
            "files": row["files"], "facts_written": row["facts"], "numeric_facts": row["numeric"],
            "mapped": row["mapped"], "ignored": row["ignored"], "unmapped": row["unmapped"],
            "top_unmapped": _top(row["unmapped_elements"], TOP_UNMAPPED),
        }
    report: dict[str, Any] = {
        "report_version": REPORT_VERSION,
        "versions": {"parser": XBRL_PARSER_VERSION, "map": XBRL_MAP_VERSION, "pdf_check": XBRL_PDF_CHECK_VERSION},
        "files": {"found": tally.found, "read": tally.read, "unreadable": _counts(tally.unreadable),
                  "unreadable_total": sum(tally.unreadable.values()), "state": _counts(tally.states)},
        "format_tokens": {
            "matrix": {token: _counts(tally.matrix[token]) for token in sorted(tally.matrix)},
            "as_the_token_says": tally.read - len(tally.disagreeing),
            "disagreeing": sorted(tally.disagreeing)[:MAX_NAMED],
            "disagreeing_total": len(tally.disagreeing),
        },
        "formats": formats,
        "warnings_files": _counts(tally.warning_files),
        "sums": {sum_id: {"passed": c["passed"], "failed": c["failed"], "not_checked": c["not_checked"]}
                 for sum_id, c in sorted(tally.sums.items())},
        "sum_failures": {sum_id: tally.sum_failures[sum_id] for sum_id in sorted(tally.sum_failures)},
        "balance_identity": {"passed": tally.balance["passed"], "failed": tally.balance["failed"],
                             "not_checked": tally.balance["not_checked"]},
        "rounding": {"files_pass": tally.rounding["pass"], "files_missing": tally.rounding["missing"],
                     "files_mismatch": tally.rounding["mismatch"]},
        "nil": {"facts": tally.nil_facts, "files": tally.nil_files},
        "unit_unsupported": {"files": tally.unit_unsupported_files,
                             "elements": _top(tally.unit_unsupported_elements, TOP_UNMAPPED)},
        "concepts": {"facts_written": tally.facts_written, "with_concept": tally.facts_with_concept},
        "entry_points": {"files": _counts(tally.entry_points),
                         "differences": [{"element": e, "only_in": o, "entry_point": p, "files": n}
                                         for (e, o, p), n in sorted(tally.differences.items())]},
    }
    if with_pdfs:
        report["pdf_check"] = _pdf_report(tally)
    return report


def _pdf_report(tally: Tally) -> dict[str, Any]:
    pairing = tally.pairing
    checked = {unit: c["checked"] for unit, c in tally.decoy.items()}
    return {
        "pairing": _counts(pairing),
        "by_statement": {k: _statuses(c) for k, c in sorted(tally.by_dim["statement"].items())},
        "by_basis": {k: _statuses(c) for k, c in sorted(tally.by_dim["basis"].items())},
        "by_unit": {k: _statuses(c) for k, c in sorted(tally.by_dim["unit"].items())},
        "by_pairing": {k: _statuses(c) for k, c in sorted(tally.by_dim["pairing"].items())},
        "failed_in_another_unit": {k: _counts(c) for k, c in sorted(tally.other_unit.items())},
        "top_failing_elements": _top(tally.failing, TOP_FAILING),
        "decoy": {unit: {"checked": checked[unit], "passed": tally.decoy[unit]["passed"]} for unit in sorted(tally.decoy)},
        "sign": {klass: _counts(c) for klass, c in sorted(tally.sign.items())},
        "anywhere": _counts(tally.anywhere),
    }


# ---------------------------------------------------------------------------------------------------------------
# --against


def flatten(node: Any, path: str = "") -> dict[str, int]:
    """Every count in a report as `{path: number}`. A list of `{element, files}` is keyed by its element names;
    a list of names, and a path listed under `sum_failures`, hold no counts and are left out."""
    found: dict[str, int] = {}
    if isinstance(node, bool):
        return found
    if isinstance(node, int):
        found[path] = node
    elif isinstance(node, dict):
        for key, value in node.items():
            if key == "sum_failures":
                continue
            found.update(flatten(value, f"{path}.{key}" if path else str(key)))
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, dict) and "element" in item:
                rest = {k: v for k, v in item.items() if k != "element"}
                tag = "/".join(str(item[k]) for k in ("element", "only_in", "entry_point") if k in item)
                found.update(flatten(rest, f"{path}[{tag}]"))
    return found


def deltas(now: dict[str, Any], before: dict[str, Any]) -> list[tuple[str, int, int]]:
    """`(path, before, now)` for every count that differs, a count missing on one side being 0."""
    a, b = flatten(before), flatten(now)
    return [(p, a.get(p, 0), b.get(p, 0)) for p in sorted(set(a) | set(b)) if a.get(p, 0) != b.get(p, 0)]


# ---------------------------------------------------------------------------------------------------------------
# Markdown


def _table(header: list[str], rows: list[list[Any]]) -> list[str]:
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return lines + [""]


def render_markdown(report: dict[str, Any], title: str, against: dict[str, Any] | None = None,
                    against_name: str | None = None) -> str:
    files, tokens = report["files"], report["format_tokens"]
    v = report["versions"]
    out = [f"# XBRL map evaluation: {title}", "",
           f"Parser {v['parser']}, map {v['map']}, `xbrl_in_pdf` check version {v['pdf_check']}. Offline, no model call. "
           "The report holds element names, ids, file names of instances and counts: no value, no company name.", ""]

    out += ["## Files", ""]
    out += _table(["", "Count"], [["Files found", files["found"]], ["Read", files["read"]],
                                   ["Unreadable", files["unreadable_total"]]]
                  + [[f"Unreadable, `{reason}`", n] for reason, n in files["unreadable"].items()]
                  + [[f"Read, state `{state}`", n] for state, n in files["state"].items()])

    out += ["## Format against the file-name token", "",
            f"{tokens['as_the_token_says']} of {files['read']} files are in the format their token says "
            f"({share(tokens['as_the_token_says'], files['read'])}). {tokens['disagreeing_total']} disagree.", ""]
    detected = sorted({fmt for row in tokens["matrix"].values() for fmt in row})
    out += _table(["Token"] + [f"`{d}`" for d in detected],
                  [[f"`{t}`"] + [row.get(d, 0) for d in detected] for t, row in tokens["matrix"].items()])
    if tokens["disagreeing"]:
        out += ["Disagreeing files" + (f" (first {len(tokens['disagreeing'])})" if tokens["disagreeing_total"] > len(tokens["disagreeing"]) else ""),
                ""] + [f"- `{name}`" for name in tokens["disagreeing"]] + [""]

    out += ["## Formats", ""]
    rows = []
    for fmt, row in report["formats"].items():
        covered = row["mapped"] + row["ignored"]
        rows.append([f"`{fmt}`", row["files"], row["facts_written"], row["numeric_facts"], row["mapped"],
                     share(row["mapped"], row["numeric_facts"]), row["ignored"], row["unmapped"]])
    out += _table(["Format", "Files", "Facts written", "Numeric facts, no member", "A line of the map", "Share",
                   "Ignored by the map", "In neither"], rows)
    out += ["A numeric fact is one with a unit in a context without a member. A format with no map writes no facts "
            "and has no line to map.", ""]
    for fmt, row in report["formats"].items():
        if row["top_unmapped"]:
            out += [f"Top unmapped elements of `{fmt}` (files holding each):", ""]
            out += [f"- `{item['element']}`: {item['files']}" for item in row["top_unmapped"]] + [""]

    out += ["## Sums", "", "Each sum is checked per period over the lines present, with a tolerance of n × ½ × 10^(−finest "
            "decimals). Counts are periods, over all mapped files.", ""]
    out += _table(["Sum id", "Passed", "Failed", "Not checked"],
                  [[f"`{k}`", c["passed"], c["failed"], c["not_checked"]] for k, c in report["sums"].items()]
                  + [["balance identity", *(report["balance_identity"][k] for k in ("passed", "failed", "not_checked"))]])
    if report["sum_failures"]:
        out += ["Failing sums, by file (first " + str(MAX_NAMED) + " files of each):", ""]
        for sum_id, listed in report["sum_failures"].items():
            out += [f"`{sum_id}`:", ""]
            out += [f"- `{item['file']}`: {', '.join(item['periods'])}" for item in listed] + [""]

    r = report["rounding"]
    out += ["## Rounding", "",
            f"The declared level of rounding against the coarsest `decimals` of the monetary facts: {r['files_pass']} of "
            f"{files['read']} files pass ({share(r['files_pass'], files['read'])}), {r['files_missing']} with "
            f"`XBRL_ROUNDING_MISSING`, {r['files_mismatch']} with `XBRL_ROUNDING_MISMATCH`.", ""]

    out += ["## Nil facts, units and concepts", ""]
    c = report["concepts"]
    out += _table(["", "Count"], [
        ["Nil facts written (unknown, never zero)", report["nil"]["facts"]],
        ["Files with a nil fact", report["nil"]["files"]],
        ["Files with a mapped element left out for `XBRL_UNIT_UNSUPPORTED`", report["unit_unsupported"]["files"]],
        ["Facts written", c["facts_written"]],
        ["Facts with a concept", c["with_concept"]],
        ["Share of facts with a concept", share(c["with_concept"], c["facts_written"])],
    ])
    if report["unit_unsupported"]["elements"]:
        out += ["Elements left out for their unit (files):", ""]
        out += [f"- `{i['element']}`: {i['files']}" for i in report["unit_unsupported"]["elements"]] + [""]
    out += ["Warnings by files holding each code:", ""]
    out += [f"- `{code}`: {n}" for code, n in report["warnings_files"].items()] + [""]

    out += ["## Entry points", ""]
    out += _table(["Entry point (first `schemaRef`)", "Files"], [[f"`{k}`", n] for k, n in report["entry_points"]["files"].items()])
    differences = report["entry_points"]["differences"]
    if differences:
        out += ["Elements the map lists as different between entry points, and the files that hold each with a member:", ""]
        out += _table(["Element", "Only in", "Entry point of the file", "Files with a member fact"],
                      [[f"`{d['element']}`", f"`{d['only_in']}`", f"`{d['entry_point']}`", d["files"]] for d in differences])

    if "pdf_check" in report:
        out += _render_pdf(report["pdf_check"])

    if against is not None:
        changes = deltas(report, against)
        out += [f"## Change against {against_name}", ""]
        if not changes:
            out += ["No count changed.", ""]
        else:
            out += _table(["Count", "Before", "Now", "Change"],
                          [[f"`{p}`", a, b, f"{b - a:+d}"] for p, a, b in changes])
    return "\n".join(out).rstrip() + "\n"


def _render_pdf(pdf: dict[str, Any]) -> list[str]:
    p = pdf["pairing"]
    out = ["## `xbrl_in_pdf`: the paired-PDF run", "",
           "Each instance is paired with the results PDF of the same BSE code announced the same day. The PDF is read "
           "from its text layer and classified by the rules alone, and its rule-read period confirms the pair. The check "
           "is `check_xbrl_in_pdf` with the request the worker builds.", "", "### Pairing", ""]
    out += _table(["", "Instances"], [[k.replace("_", " "), n] for k, n in p.items()])
    out += ["`paired` counts the pairs that were kept (`period agrees` and `period unread`). `period disagrees` and "
            "`unpaired no pdf` are left out.", ""]
    for heading, key in (("Statement", "by_statement"), ("Basis", "by_basis"), ("Unit", "by_unit"), ("Pairing", "by_pairing")):
        out += [f"### By {heading.lower()}", ""]
        rows = []
        for name, s in pdf[key].items():
            checked = s["passed"] + s["failed"]
            rows.append([f"`{name}`", s["passed"], s["passed_exact"], s["passed_rounded"], s["failed"],
                         share(s["failed"], checked), s["not_checked"],
                         ", ".join(f"{r} {n}" for r, n in s["not_checked_by_reason"].items()) or "-"])
        out += _table([heading, "Passed", "On the exact candidate", "Needed the rounded one", "Failed",
                       "Failed of checked", "Not checked", "Not checked, by reason"], rows)
    out += ["A pass is on the exact candidate when the exact number is on one of the statement's pages, and needed the "
            "rounded candidate otherwise. Counts are facts.", "", "### Top failing elements (files with a failure)", ""]
    out += [f"- `{i['element']}`: {i['files']}" for i in pdf["top_failing_elements"]] + [""]
    out += ["### Failed facts that sit on the page in another unit", "",
            "For each failed monetary fact, the exact value is looked for on the statement's pages as rupees, thousands, "
            "lakh, million and crore, leaving out the declared unit. Chance counts here too: read the share against the "
            "decoy share below.", ""]
    rows = []
    for unit, c in pdf["failed_in_another_unit"].items():
        others = ", ".join(f"{k[3:]} {n}" for k, n in c.items() if k.startswith("as "))
        rows.append([f"`{unit}`", c.get("failed_with_pages", 0), c.get("found_in_another_unit", 0),
                     share(c.get("found_in_another_unit", 0), c.get("failed_with_pages", 0)), others or "-"])
    out += _table(["Declared unit", "Failed, with pages", "Found in another unit", "Share", "In which unit"], rows)
    out += ["### Sign", "",
            "The check compares absolute values. For each pass, the number that matched is looked for with a bracket or a "
            "minus right before it. `negative`: the instance holds a negative value. `part taken off`: positive, and a sum "
            "takes the line off (a cash-flow outflow). `other`: everything else.", ""]
    out += _table(["Class", "Passed", "Printed signed somewhere", "Printed plain only"],
                  [[k.replace("_", " "), c.get("passed", 0), c.get("printed_signed_somewhere", 0),
                    c.get("printed_plain_only", 0)] for k, c in pdf["sign"].items()])
    out += ["### Anywhere on a statement page", "",
            "Each checked value is moved by one unit of the last printed place (0.01 for a share) and checked again. "
            "A decoy that passes was found by luck.", ""]
    out += _table(["Unit", "Decoys checked", "Decoys that pass", "Share"],
                  [[f"`{u}`", d["checked"], d["passed"], share(d["passed"], d["checked"])] for u, d in pdf["decoy"].items()])
    a = pdf["anywhere"]
    out += [f"Passes on a value of zero: {a.get('passed_zero', 0)} of {a.get('passed', 0)}. Passes on a monetary value "
            f"under 100 in the page's unit: {a.get('passed_below_100', 0)}.", ""]
    return out
