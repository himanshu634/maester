"""Gemini against XBRL, cell by cell, on every results filing that has both (rule `COMPARE_RULE_VERSION`).

A cell is a source-rule slot of the filing's used XBRL instances (`owners.slot_owners`) plus a concept. XBRL facts
take their concept from the element map; Gemini facts take theirs from the company's labelling sheets
(`sheet_concepts`, carry rule `CONCEPT_CARRY_VERSION`). A Gemini fact is placed first, and only then is its concept
looked up, so a line with no concept never reads as a line Gemini missed:

- not placed (`no_period`, `no_span`): never compared, and never outside a slot;
- placed in a slot no used instance holds (a comparative column): `outside_instance`;
- placed in a slot of the instances: the slot is read. A fact with no concept counts in `no_concept`, and makes
  an XBRL line of that slot `unlabelled` rather than `xbrl_only`, because the unlabelled line may be it.

A slot no Gemini fact is placed in is `not_read`, or `span_unknown` when a Gemini fact with no span has the slot's
statement, basis and date. Two figures for one cell, on either side, are `ambiguous`, never a silent pick. A pooled
slot (refilings with no order) whose instances hold a cell differently is `instances_differ`.

Agreement is over the cells that both sides read with one figure each: `agree`, `agree_at_precision` and
`agree_dash_zero` over those and `disagree_value`, `disagree_scale`, `disagree_status` and `ambiguous`. A sign apart
(`disagree_sign`) and `instances_differ` are outside it: a sign convention and an XBRL refiling are not Gemini's
reading. Rates are whole tenths of a percent; every figure is a Decimal, compared, never changed.

Two `span="other"` XBRL durations of different lengths ending on one day share a slot under `slot_key`. The span rule
never gives `other`, so no Gemini fact is placed in such a slot and it cannot make a disagreement: its cells are
`not_read` (or `span_unknown`).

Figures go only into the report files and the settle sheets under `data/eval/`, never onto the console.
"""

from collections import Counter
from datetime import datetime
from decimal import Decimal
import json
from pathlib import Path
from typing import Literal, get_args

from pydantic import BaseModel

from maester_eval.artefacts import Artefact
from maester_eval.cells import (
    COMPARE_RULE_VERSION, company_id, gemini_slot, printed_exponent, read_figure, same_figure, xbrl_exponent, xbrl_slot,
)
from maester_eval.concepts import Taxonomy
from maester_eval.files import write_text_atomically
from maester_eval.manifest import Manifest, SetChoice, tag_values
from maester_eval.owners import OWNER_RULE_VERSION, DifferingCell, differing_cells, fact_figure, owned_facts, slot_owners
from maester_eval.paths import to_utc
from maester_eval.periods import SPAN_RULE_VERSION
from maester_eval.report import TAG_TITLES, count_change, pp_change
from maester_eval.scoring import UnusedInstance, rate_text, unused_instances, unusable_reason
from maester_eval.sheet_concepts import CONCEPT_CARRY_VERSION, CompanyConcepts, ConceptPick, load_company_concepts
from maester_eval.sheets import SHEET_COLUMNS, sheet_rows
from maester_eval.source_rule import SOURCE_RULE_VERSION
from maester_eval.tags import TAG_DIMENSIONS

__all__ = [
    "COMPARE_OUTCOMES", "CellCompare", "CompareOutcome", "CompareRun", "FilingCompare", "SETTLE_COLUMNS", "agreement_tenths",
    "compare_filing", "compare_runs", "exact_agreement_tenths", "render_compare_markdown", "settle_rows",
    "write_compare",
]

CompareOutcome = Literal["agree", "agree_at_precision", "agree_dash_zero", "disagree_value", "disagree_scale",
                         "disagree_status", "disagree_sign", "ambiguous", "instances_differ", "pdf_unknown", "xbrl_unknown",
                         "pdf_only", "xbrl_only", "unlabelled", "span_unknown", "not_read"]
COMPARE_OUTCOMES: tuple[str, ...] = get_args(CompareOutcome)
# What happened to each Gemini fact of a compared filing.
GEMINI_COUNTS = ("no_period", "no_span", "outside_instance", "no_concept", "concept_own", "concept_company")
NotCompared = Literal["no_pdf_artefact", "pdf_failed", "no_xbrl_artefact", "no_mapped_instance", "pair_mismatch", "no_concepts"]

_AGREE = ("agree", "agree_at_precision", "agree_dash_zero")
_DISAGREE = ("disagree_value", "disagree_scale", "disagree_status")
_SETTLED = frozenset(_DISAGREE)
# `scoring.RunScore.unusable`'s reasons, as compare names them: a file the reader could not read has no mapped instance.
_UNUSABLE = {"format_unmapped": "no_mapped_instance", "unreadable": "no_mapped_instance", "pair_mismatch": "pair_mismatch"}

# `xbrl_run` and `map_version` name the XBRL run and map the row was compared under; `settle` refuses a sheet whose rows
# name another than the PDF run's `compare-xbrl.json`.
SETTLE_COLUMNS = SHEET_COLUMNS + ["concept_from", "xbrl_element", "xbrl_value", "xbrl_unit", "xbrl_normalized", "outcome",
                                  "xbrl_run", "map_version"]


class CellCompare(BaseModel):
    slot: str
    statement: str
    basis: str
    span: str | None
    period_end: str
    # The XBRL fact's, else the Gemini fact's.
    period_label: str
    concept: str
    outcome: CompareOutcome
    concept_from: Literal["own", "company"] | None = None
    # The Gemini fact shown: its 1-based place in the artefact (the sheet's `row`), and its page from 1. None when
    # Gemini has no fact for the cell, or has two figures for it and none is picked.
    pdf_row: int | None = None
    pdf_printed: str | None = None
    pdf_page: int | None = None
    pdf_unit: str | None = None
    pdf_normalized: str | None = None
    # The XBRL fact shown. A pooled cell its instances hold differently names the element and no figure.
    xbrl_element: str | None = None
    xbrl_value: str | None = None
    xbrl_unit: str | None = None
    xbrl_normalized: str | None = None


class FilingCompare(BaseModel):
    filing_id: str
    company: str
    set: str
    tags: dict[str, str]
    compared: bool
    reason: NotCompared | None
    cells: list[CellCompare]
    counts: dict[str, int]
    instances_differ: list[DifferingCell]
    # A compared filing's instances that were not used: it was compared on its other instances.
    unused_instances: list[UnusedInstance] = []


class CompareRun(BaseModel):
    pdf_run: str
    xbrl_run: str
    eval_set: str
    generated_at: datetime
    versions: dict[str, int | str | None]
    filings: list[FilingCompare]

    def counts(self) -> dict[str, int]:
        """Every count summed over the compared filings."""
        total: Counter = Counter()
        for filing in self.filings:
            total.update(filing.counts)
        return {name: total.get(name, 0) for name in (*COMPARE_OUTCOMES, *GEMINI_COUNTS)}


def _zero_counts() -> dict[str, int]:
    return {name: 0 for name in (*COMPARE_OUTCOMES, *GEMINI_COUNTS)}


def _denominator(counts: dict[str, int]) -> int:
    return sum(counts.get(name, 0) for name in (*_AGREE, *_DISAGREE, "ambiguous"))


def agreement_tenths(counts: dict[str, int]) -> int | None:
    """`agree`, `agree_at_precision` and `agree_dash_zero` over those and the disagreements and `ambiguous`, in tenths of
    a percent rounded down; None with nothing to divide by. `disagree_sign` and `instances_differ` are outside."""
    denominator = _denominator(counts)
    return sum(counts.get(name, 0) for name in _AGREE) * 1000 // denominator if denominator else None


def exact_agreement_tenths(counts: dict[str, int]) -> int | None:
    """`agree` alone over `agreement_tenths`'s denominator."""
    denominator = _denominator(counts)
    return counts.get("agree", 0) * 1000 // denominator if denominator else None


# --- One filing ----------------------------------------------------------------------------------------------------


def _one(facts: list, figure) -> dict | None:
    """The first of `facts` when they all hold one figure; None when they hold two or more. A Gemini figure is
    `cells.read_figure`, an XBRL one `owners.fact_figure`, as the scorer tells them apart."""
    return facts[0] if len({figure(f) for f in facts}) == 1 else None


def _xbrl_number(fact: dict) -> Decimal | None:
    """An XBRL figure, or None for nil or a value that was not parsed."""
    if fact["valueStatus"] != "value" or fact["normalizedValue"] is None:
        return None
    return Decimal(fact["normalizedValue"])


def _both(gemini: dict, xbrl: dict) -> CompareOutcome:
    """One Gemini figure against one XBRL figure, by the rules in this order."""
    read = _xbrl_number(xbrl)
    if gemini["valueStatus"] == "dash":  # a printed dash is a reading, not an unknown
        if read is None:
            return "xbrl_unknown"
        return "agree_dash_zero" if read == 0 else "disagree_status"
    if read is None:
        return "xbrl_unknown"
    if gemini["valueStatus"] != "value" or gemini["normalizedValue"] is None:
        return "pdf_unknown"
    printed = Decimal(gemini["normalizedValue"])
    if printed != 0 and read == 0:
        return "disagree_status"  # the filer may have tagged a printed dash 0; compare cannot see the page
    printed_exp = printed_exponent(gemini["reportedValue"], gemini["scaleFactor"])
    read_exp = xbrl_exponent(xbrl["decimals"], xbrl["normalizedValue"])
    agreement = same_figure(printed, printed_exp, read, read_exp)
    if agreement == "exact":
        return "agree"
    if agreement == "at_precision":
        return "agree_at_precision"
    if (printed != 0 and read != 0 and (printed < 0) != (read < 0)
            and same_figure(-printed, printed_exp, read, read_exp) != "different"):
        return "disagree_sign"
    if (gemini["reportedValue"] is not None and xbrl["reportedValue"] is not None
            and Decimal(gemini["reportedValue"]) == Decimal(xbrl["reportedValue"])):
        return "disagree_scale"
    return "disagree_value"


def _slot_fields(slot: str) -> tuple[str, str, str, str | None]:
    """The statement, basis, date and span a slot key holds (`source_rule.slot_key`: `instant` is no span)."""
    *_, statement, basis, period_end, span = slot.split("|")
    return statement, basis, period_end, None if span == "instant" else span


def _not_compared(pdf: Artefact, xbrl: Artefact, concepts: CompanyConcepts) -> NotCompared | None:
    if pdf.result is None:
        return "pdf_failed"
    unusable = unusable_reason(xbrl)
    if unusable is not None:
        return _UNUSABLE[unusable]
    if not any(concepts.lookup(pdf.filing_id, f["statement"], f["section"], f["reportedLabel"]) for f in pdf.result["facts"]):
        return "no_concepts"
    return None


def _listed(filing_id: str, company: str, eval_set: str, tags: dict[str, str], reason: NotCompared) -> FilingCompare:
    """A filing listed, not compared: no cell, and every count zero."""
    return FilingCompare(filing_id=filing_id, company=company, set=eval_set, tags=tags, compared=False, reason=reason,
                         cells=[], counts=_zero_counts(), instances_differ=[])


def compare_filing(pdf: Artefact, xbrl: Artefact, concepts: CompanyConcepts, tags: dict[str, str]) -> FilingCompare:
    """Each cell of the instances' slots, Gemini against XBRL. Cells are sorted by slot, then concept."""
    reason = _not_compared(pdf, xbrl, concepts)
    if reason is not None:
        return _listed(pdf.filing_id, pdf.company, pdf.set, tags, reason)
    company = company_id(xbrl.file)
    owners = slot_owners(xbrl)
    differ = differing_cells(xbrl)
    pooled_differ = {(c.slot, c.concept): c for c in differ if c.owner is None and c.concept is not None}
    counts = _zero_counts()

    # XBRL cells: the owned facts with a concept, and in a pooled slot each cell its instances hold differently.
    xbrl_cells: dict[tuple[str, str], list[dict]] = {}
    for fact in owned_facts(xbrl):
        if fact["concept"] is not None:
            xbrl_cells.setdefault((xbrl_slot(company, xbrl.kind, fact), fact["concept"]), []).append(fact)
    for key in pooled_differ:
        xbrl_cells.setdefault(key, [])

    # Gemini facts, each with its 1-based place in the artefact, placed before their concept is looked up.
    gemini_cells: dict[tuple[str, str], list[tuple[int, dict, ConceptPick]]] = {}
    read: set[str] = set()
    unlabelled: set[str] = set()
    no_span: set[tuple[str, str, str]] = set()
    for number, fact in enumerate(pdf.result["facts"], start=1):
        placed = gemini_slot(company, pdf.kind, fact)
        if placed.key is None:
            counts[placed.reason] += 1
            if placed.reason == "no_span":
                no_span.add((fact["statement"], fact["basis"], fact["periodEnd"] or fact["asOfDate"]))
            continue
        if placed.key not in owners:
            counts["outside_instance"] += 1
            continue
        read.add(placed.key)
        pick = concepts.lookup(pdf.filing_id, fact["statement"], fact["section"], fact["reportedLabel"])
        if pick is None:
            counts["no_concept"] += 1
            unlabelled.add(placed.key)
            continue
        counts[f"concept_{pick.source}"] += 1
        gemini_cells.setdefault((placed.key, pick.concept), []).append((number, fact, pick))

    cells: list[CellCompare] = []
    for key in sorted(xbrl_cells.keys() | gemini_cells.keys()):
        slot, concept = key
        statement, basis, period_end, span = _slot_fields(slot)
        x_facts, g_facts = xbrl_cells.get(key, []), gemini_cells.get(key, [])
        x = _one(x_facts, fact_figure) if x_facts else None
        g = _one(g_facts, lambda item: read_figure(item[1])) if g_facts else None
        if slot not in read:
            outcome: CompareOutcome = "span_unknown" if (statement, basis, period_end) in no_span else "not_read"
        elif key in pooled_differ:
            outcome = "instances_differ" if g_facts else ("unlabelled" if slot in unlabelled else "xbrl_only")
        elif x_facts and g_facts:
            outcome = "ambiguous" if g is None or x is None else _both(g[1], x)
        elif x_facts:
            outcome = "unlabelled" if slot in unlabelled else "xbrl_only"
        else:
            outcome = "pdf_only"
        counts[outcome] += 1
        number, fact, pick = g if g is not None else (None, None, None)
        # The period label of the XBRL fact, else of the Gemini fact: the one shown, or the first of the cell.
        labelled_by = x_facts[0] if x_facts else (g_facts[0][1] if g_facts else None)
        label = labelled_by["periodLabel"] if labelled_by is not None else ""
        cells.append(CellCompare(
            slot=slot, statement=statement, basis=basis, span=span, period_end=period_end, period_label=label,
            concept=concept, outcome=outcome, concept_from=None if pick is None else pick.source,
            pdf_row=number, pdf_printed=None if fact is None else fact["reportedText"],
            pdf_page=None if fact is None else fact["pageIndex"] + 1, pdf_unit=None if fact is None else fact["unitLabel"],
            pdf_normalized=None if fact is None else fact["normalizedValue"],
            xbrl_element=pooled_differ[key].element if key in pooled_differ else (None if x is None else x["element"]),
            xbrl_value=None if x is None or key in pooled_differ else x["reportedValue"],
            xbrl_unit=None if x is None or key in pooled_differ else x.get("unitLabel"),
            xbrl_normalized=None if x is None or key in pooled_differ else x["normalizedValue"]))
    return FilingCompare(filing_id=pdf.filing_id, company=pdf.company, set=pdf.set, tags=tags, compared=True, reason=None,
                         cells=cells, counts=counts, instances_differ=differ, unused_instances=unused_instances(xbrl))


def settle_rows(fc: FilingCompare, pdf: Artefact, xbrl_run: str, map_version: str | None) -> list[dict[str, str]]:
    """For each `disagree_value`, `disagree_scale` or `disagree_status` cell, its Gemini fact's labelling sheet row with
    the concept filled, the XBRL side, and the XBRL run and map version it was compared under (no version is "").
    A sign apart or instances that differ never get a row."""
    rows = sheet_rows(pdf)
    out: list[dict[str, str]] = []
    for cell in fc.cells:
        if cell.outcome not in _SETTLED or cell.pdf_row is None:
            continue
        out.append(dict(rows[cell.pdf_row - 1], concept=cell.concept, concept_from=cell.concept_from or "",
                        xbrl_element=cell.xbrl_element or "", xbrl_value=cell.xbrl_value or "",
                        xbrl_unit=cell.xbrl_unit or "", xbrl_normalized=cell.xbrl_normalized or "", outcome=cell.outcome,
                        xbrl_run=xbrl_run, map_version=map_version or ""))
    return out


# --- A run ---------------------------------------------------------------------------------------------------------


def compare_runs(pdf_artefacts: list[Artefact], xbrl_artefacts: list[Artefact], manifest: Manifest, sheets_dir: Path,
                 taxonomy: Taxonomy, eval_set: SetChoice, pdf_run: str, xbrl_run: str, xbrl_record: dict,
                 generated_at: datetime) -> CompareRun:
    """Every selected filing of the set with XBRL pairs, compared or listed with why not. `xbrl_record` is the XBRL
    run's `run.json`, which names its parser and map versions."""
    pdf_by_id = {a.filing_id: a for a in pdf_artefacts}
    xbrl_by_id = {a.filing_id: a for a in xbrl_artefacts}
    concepts: dict[str, CompanyConcepts] = {}
    filings: list[FilingCompare] = []
    for filing in manifest.select(eval_set):
        if not filing.xbrl:
            continue
        tags = tag_values(filing)
        pdf, xbrl = pdf_by_id.get(filing.id), xbrl_by_id.get(filing.id)
        if pdf is None or xbrl is None:
            filings.append(_listed(filing.id, filing.company, filing.set, tags,
                                   "no_pdf_artefact" if pdf is None else "no_xbrl_artefact"))
            continue
        folder = filing.company_folder
        if folder not in concepts:
            concepts[folder] = load_company_concepts(sheets_dir, folder, taxonomy)
        filings.append(compare_filing(pdf, xbrl, concepts[folder], tags))
    versions = {"span_rule": SPAN_RULE_VERSION, "compare_rule": COMPARE_RULE_VERSION, "concept_carry": CONCEPT_CARRY_VERSION,
                "owner_rule": OWNER_RULE_VERSION, "source_rule": SOURCE_RULE_VERSION,
                "parser": xbrl_record.get("parser_version"), "map": xbrl_record.get("map_version")}
    return CompareRun(pdf_run=pdf_run, xbrl_run=xbrl_run, eval_set=eval_set, generated_at=generated_at, versions=versions,
                      filings=filings)


# --- The report ----------------------------------------------------------------------------------------------------

# Each outcome's column title in the breakdown tables.
_TITLES = {"agree": "Agree", "agree_at_precision": "At precision", "agree_dash_zero": "Dash as 0", "disagree_value": "Value",
           "disagree_scale": "Scale", "disagree_status": "Status", "disagree_sign": "Sign only", "ambiguous": "Ambiguous",
           "instances_differ": "Instances differ", "pdf_unknown": "PDF unknown", "xbrl_unknown": "XBRL unknown",
           "pdf_only": "PDF only", "xbrl_only": "XBRL only", "unlabelled": "Unlabelled", "span_unknown": "Span unknown",
           "not_read": "Not read"}


def _cell(value: object) -> str:
    """A table cell: one line, no bare pipe, a dash for nothing. A label read from a filing may hold either."""
    text = "" if value is None else " ".join(str(value).split())
    return text.replace("|", "\\|") or "—"


def _row(cells: list) -> str:
    return "| " + " | ".join(_cell(c) for c in cells) + " |"


def _counts_of(cells: list[CellCompare]) -> dict[str, int]:
    found = Counter(c.outcome for c in cells)
    return {name: found.get(name, 0) for name in COMPARE_OUTCOMES}


def _breakdown(title: str, groups: dict[str, tuple[int | None, dict[str, int]]]) -> list[str]:
    """A table of one row per group: its filings (or none), agreement, exact agreement and each outcome's cells."""
    lines = [_row([title, "Filings", "Agreement", "Exact", *(_TITLES[o] for o in COMPARE_OUTCOMES)]),
             _row(["---"] * (4 + len(COMPARE_OUTCOMES)))]
    for value, (filings, counts) in groups.items():
        lines.append(_row([value, filings, rate_text(agreement_tenths(counts)), rate_text(exact_agreement_tenths(counts)),
                           *(counts[o] for o in COMPARE_OUTCOMES)]))
    return lines


def _summary_lines(run: CompareRun) -> list[str]:
    compared = [f for f in run.filings if f.compared]
    listed = [f for f in run.filings if not f.compared]
    counts = run.counts()
    lines = ["## Summary", "", f"Compared: {len(compared)} filing(s). Not compared: {len(listed)}.", ""]
    if listed:
        lines += [f"- {f.filing_id}: {f.reason}" for f in listed] + [""]
    lines += ["| Measure | Value |", "| --- | --- |",
              _row(["Agreement", rate_text(agreement_tenths(counts))]),
              _row(["Exact agreement", rate_text(exact_agreement_tenths(counts))]),
              _row(["Of which at precision", counts["agree_at_precision"]]),
              _row(["Of which dash against 0", counts["agree_dash_zero"]]),
              _row(["Sign only (outside agreement)", counts["disagree_sign"]]),
              _row(["Instances that differ (outside agreement)", counts["instances_differ"]]), "",
              "Agreement is agree, at precision and dash against 0 over those, the disagreements of value, scale and "
              "status, and ambiguous cells. Exact agreement is agree alone over the same cells.", "",
              "### Cells by outcome", "", "| Outcome | Cells |", "| --- | --- |"]
    lines += [_row([name, counts[name]]) for name in COMPARE_OUTCOMES]
    lines += ["", "### Gemini facts", "",
              "Each Gemini fact is placed in a slot first, and only then is its concept looked up.", "",
              "| What happened | Facts |", "| --- | --- |"]
    lines += [_row([name, counts[name]]) for name in GEMINI_COUNTS]
    return lines + [""]


def _tag_lines(run: CompareRun) -> list[str]:
    compared = [f for f in run.filings if f.compared]
    lines = ["## By format tag", "",
             "A filing counts under every dimension: the tags are not a partition. A filing nobody tagged is not tagged.", ""]
    for dimension in TAG_DIMENSIONS:
        values = sorted({f.tags.get(dimension, "not tagged") for f in compared})
        groups = {}
        for value in values:
            chosen = [f for f in compared if f.tags.get(dimension, "not tagged") == value]
            groups[value] = (len(chosen), _counts_of([c for f in chosen for c in f.cells]))
        lines += [f"### {TAG_TITLES[dimension]}", ""] + (_breakdown("Value", groups) if groups else ["None."]) + [""]
    return lines


def _statement_lines(run: CompareRun) -> list[str]:
    cells = [c for f in run.filings for c in f.cells]
    groups = {s: (None, _counts_of([c for c in cells if c.statement == s])) for s in sorted({c.statement for c in cells})}
    return ["## By statement", ""] + (_breakdown("Statement", groups) if groups else ["None."]) + [""]


def _disagreement_lines(run: CompareRun) -> list[str]:
    lines = ["## Disagreements", ""]
    found = [(f.filing_id, c) for f in run.filings for c in f.cells if c.outcome in (*_DISAGREE, "ambiguous")]
    if not found:
        return lines + ["None.", ""]
    lines += ["| Filing | Statement | Basis | Period | Concept | PDF (page) | XBRL | Outcome |", _row(["---"] * 8)]
    for filing_id, c in found:
        pdf = None if c.pdf_printed is None else f"{c.pdf_printed} ({c.pdf_page})"
        xbrl = None if c.xbrl_value is None else " ".join(part for part in (c.xbrl_value, c.xbrl_unit) if part)
        lines.append(_row([filing_id, c.statement, c.basis, c.period_label, c.concept, pdf, xbrl, c.outcome]))
    return lines + [""]


def _sign_lines(run: CompareRun) -> list[str]:
    lines = ["## Sign only", "",
             "Gemini and XBRL hold the same figure with opposite signs. This is a convention of the element, not a misread, "
             "and it is outside agreement.", ""]
    found = Counter(c.xbrl_element or "—" for f in run.filings for c in f.cells if c.outcome == "disagree_sign")
    if not found:
        return lines + ["None.", ""]
    lines += ["| Element | Cells |", _row(["---"] * 2)]
    lines += [_row([element, n]) for element, n in sorted(found.items(), key=lambda item: (-item[1], item[0]))]
    return lines + [""]


def _differ_lines(run: CompareRun) -> list[str]:
    lines = ["## Instances that differ", "",
             "A cell another instance of the slot holds with another figure. With no owner the slot is pooled, and the "
             "cell is outside agreement.", ""]
    found = [(f.filing_id, d) for f in run.filings for d in f.instances_differ]
    if not found:
        return lines + ["None.", ""]
    lines += ["| Filing | Slot | Element | Owner | Others |", _row(["---"] * 5)]
    for filing_id, d in found:
        owner = "no order (pooled)" if d.owner is None else Path(d.owner).name
        lines.append(_row([filing_id, d.slot, d.element, owner, ", ".join(Path(o).name for o in d.others)]))
    return lines + [""]


def _unused_lines(run: CompareRun) -> list[str]:
    lines = ["## Instances not used", "",
             "A filing compared on its other instances. The instance named here was not read, so its slots are not "
             "compared.", ""]
    found = [u for f in run.filings for u in f.unused_instances]
    if not found:
        return lines + ["None.", ""]
    lines += ["| Filing | Instance not used | Reason |", _row(["---"] * 3)]
    return lines + [_row([u.filing_id, Path(u.file).name, u.reason]) for u in found] + [""]


def _filing_counts(run: CompareRun) -> list[tuple[str, int]]:
    """What decides the denominator, by filing: the filings compared and not, and the instances not used in those compared."""
    compared = [f for f in run.filings if f.compared]
    return [("Filings compared", len(compared)), ("Filings not compared", len(run.filings) - len(compared)),
            ("Instances not used", sum(len(f.unused_instances) for f in compared))]


def _against_lines(run: CompareRun, against: CompareRun) -> list[str]:
    now, before = run.counts(), against.counts()
    lines = [f"## Against {against.pdf_run} and {against.xbrl_run}", "",
             "Rates change in percentage points; counts change in filings, instances, cells or facts.", "",
             "| Measure | This run | Earlier | Change |", "| --- | --- | --- | --- |"]
    for label, rate in (("Agreement", agreement_tenths), ("Exact agreement", exact_agreement_tenths)):
        a, b = rate(now), rate(before)
        lines.append(_row([label, rate_text(a), rate_text(b), pp_change(a, b)]))
    for (label, a), (_, b) in zip(_filing_counts(run), _filing_counts(against)):
        lines.append(_row([label, a, b, count_change(a, b)]))
    for name in (*COMPARE_OUTCOMES, *GEMINI_COUNTS):
        lines.append(_row([name, now[name], before[name], count_change(now[name], before[name])]))
    return lines + [""]


def render_compare_markdown(run: CompareRun, against: CompareRun | None) -> str:
    v = run.versions
    lines = [f"# Gemini against XBRL: {run.pdf_run} and {run.xbrl_run}", "",
             f"Set `{run.eval_set}` · {to_utc(run.generated_at).strftime('%Y-%m-%d %H:%M UTC')} · PDF run `{run.pdf_run}` · "
             f"XBRL run `{run.xbrl_run}`.", "",
             f"Versions: span rule {v['span_rule']}, compare rule {v['compare_rule']}, concept carry rule {v['concept_carry']}, "
             f"owner rule {v['owner_rule']}, source rule {v['source_rule']}, XBRL parser {v['parser'] or 'unknown'}, "
             f"XBRL element map {v['map'] or 'unknown'}.", "",
             "A cell is a slot of the filing's own XBRL instances and a concept. Gemini's concepts come from the company's "
             "labelling sheets. A Gemini line in a comparative column is outside the instance, never a line XBRL lacks.", ""]
    lines += _summary_lines(run) + _tag_lines(run) + _statement_lines(run) + _disagreement_lines(run) + _sign_lines(run)
    lines += _differ_lines(run) + _unused_lines(run)
    if against is not None:
        lines += _against_lines(run, against)
    return "\n".join(lines).rstrip("\n") + "\n"


def write_compare(run_dir: Path, run: CompareRun, against: CompareRun | None) -> tuple[Path, Path]:
    """`compare-xbrl.md` and `compare-xbrl.json` in `run_dir`."""
    md, js = run_dir / "compare-xbrl.md", run_dir / "compare-xbrl.json"
    counts = run.counts()
    data = {**run.model_dump(mode="json"), "counts": counts, "agreement_tenths": agreement_tenths(counts),
            "exact_agreement_tenths": exact_agreement_tenths(counts),
            "against": None if against is None else {"pdf_run": against.pdf_run, "xbrl_run": against.xbrl_run}}
    if against is not None:
        before = against.counts()
        data["against_counts"] = before
        data["against_agreement_tenths"] = agreement_tenths(before)
        data["against_exact_agreement_tenths"] = exact_agreement_tenths(before)
    write_text_atomically(md, render_compare_markdown(run, against))
    write_text_atomically(js, json.dumps(data, ensure_ascii=False, indent=1))
    return md, js
