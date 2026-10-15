"""Score a run against the gold set.

A gold fact is found by statement, basis, normalised section, normalised label and
normalised period label (phase 1 adds matching by concept). Figures are compared as
exact decimals: a match means value, sign, scale, basis and period all agree. Lines
that fit with different figures are ambiguous, never a silent pick.
"""

from collections import Counter
from decimal import Decimal
import statistics
from typing import Literal

from pydantic import BaseModel, Field

from maester_eval.artefacts import Artefact
from maester_eval.gold import GoldFact, GoldFiling
from maester_eval.text import normalise

# match: value, sign and scale agree. wrong_value: the printed figure differs. wrong_scale: the printed figure is the
# gold one and the scale is not. wrong_status: a figure where a dash is printed, a dash where a figure is, or a cell
# that could not be read. ambiguous: lines fit with different figures. missing: no line fits.
Outcome = Literal["match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing"]
OUTCOMES: tuple[Outcome, ...] = ("match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing")


class FactScore(BaseModel):
    concept: str
    statement: str
    basis: str
    label: str
    period_label: str
    outcome: Outcome
    gold_printed: str
    read_printed: str | None
    gold_normalized: str | None
    read_normalized: str | None
    page_match: bool | None


class FilingScore(BaseModel):
    filing_id: str
    company: str
    kind: str
    set: str
    stratum: str | None
    scanned: bool
    extracted: bool
    error_code: str | None
    state: str | None
    facts: list[FactScore]
    fact_count: int
    checks: dict[str, int]
    warnings: int
    coverage: dict[str, int]
    seconds: float
    bytes: int
    model_calls: int


class Summary(BaseModel):
    filings: int = 0
    extracted: int = 0
    failed: int = 0
    gold_facts: int = 0
    match: int = 0
    wrong_value: int = 0
    wrong_scale: int = 0
    wrong_status: int = 0
    ambiguous: int = 0
    missing: int = 0
    page_checked: int = 0
    page_match: int = 0
    checks_passed: int = 0
    checks_failed: int = 0
    checks_not_checked: int = 0
    seconds_median: float | None = None
    seconds_max: float | None = None
    model_calls_median: float | None = None
    model_calls_max: int | None = None

    def rate(self, name: str) -> str:
        """`name` over its denominator as a percentage, rounded down to one decimal; "—" with nothing to divide by.

        Rounded down, so that 100.0% means every one did. Whole numbers only: no float is involved."""
        numerator = getattr(self, name)
        if name == "page_match":
            denominator = self.page_checked
        elif name in ("checks_passed", "checks_failed", "checks_not_checked"):
            denominator = self.checks_passed + self.checks_failed + self.checks_not_checked
        elif name in ("extracted", "failed"):
            denominator = self.filings
        else:
            denominator = self.gold_facts
        if not denominator:
            return "—"
        tenths = numerator * 1000 // denominator
        return f"{tenths // 10}.{tenths % 10}%"


def _key(statement: str, basis: str, section: str, label: str, period_label: str) -> tuple:
    return (statement, basis, normalise(section), normalise(label), normalise(period_label))


def _figure(fact: dict) -> tuple:
    """What a fact says, to tell two of them apart: its status and its printed and normalised values as decimals.

    The printed value is in it because a fact with no scale has no normalised value. As decimals, `2000` and
    `2000.0` are one figure, which a comparison of their text would call two."""
    reported, normalized = fact["reportedValue"], fact["normalizedValue"]
    return (fact["valueStatus"], None if reported is None else Decimal(reported),
            None if normalized is None else Decimal(normalized))


def _compare(gold: GoldFact, fact: dict) -> Outcome:
    if gold.value_status == "dash" or fact["valueStatus"] != "value":
        return "match" if gold.value_status == "dash" and fact["valueStatus"] == "dash" else "wrong_status"
    if fact["normalizedValue"] is not None and Decimal(fact["normalizedValue"]) == Decimal(gold.normalized_value):
        return "match"
    if fact["reportedValue"] is not None and Decimal(fact["reportedValue"]) == Decimal(gold.value):
        return "wrong_scale"
    return "wrong_value"


def _candidates(index: dict[tuple, list[dict]], sections: set[tuple], gold: GoldFact) -> list[dict]:
    """The facts a gold fact may be.

    When a fact of its statement and basis has its section, the line must be in that section: "Borrowings" is
    printed under both non-current and current liabilities, and the one that was not read is not made up by
    the other. When none has it, the section is dropped from the key, so that a section typed by hand, which
    the pipeline may have named otherwise, or none typed, does not lose the match."""
    key = _key(gold.statement, gold.basis, gold.section, gold.label, gold.period_label)
    if key[:3] in sections:
        return index.get(key, [])
    line = key[:2] + key[3:]
    return [f for other, facts in index.items() if other[:2] + other[3:] == line for f in facts]


def score_filing(artefact: Artefact, gold: GoldFiling) -> FilingScore:
    result = artefact.result
    if result is None:  # the filing could not be read, so every gold fact is missing
        result = {"facts": [], "checks": [], "warnings": [], "coverage": [], "state": None}
    index: dict[tuple, list[dict]] = {}
    for fact in result["facts"]:
        key = _key(fact["statement"], fact["basis"], fact["section"], fact["reportedLabel"], fact["periodLabel"])
        index.setdefault(key, []).append(fact)
    sections = {key[:3] for key in index}
    scores: list[FactScore] = []
    for g in gold.facts:
        found = _candidates(index, sections, g)
        base = dict(concept=g.concept, statement=g.statement, basis=g.basis, label=g.label, period_label=g.period_label,
                    gold_printed=g.printed, gold_normalized=g.normalized_value)
        if not found:
            scores.append(FactScore(**base, outcome="missing", read_printed=None, read_normalized=None, page_match=None))
            continue
        fact = min(found, key=lambda f: f["lineOrder"])
        outcome: Outcome = "ambiguous" if len({_figure(f) for f in found}) > 1 else _compare(g, fact)
        scores.append(FactScore(
            **base, outcome=outcome, read_printed=fact["reportedText"], read_normalized=fact["normalizedValue"],
            page_match=None if outcome == "ambiguous" else fact["pageIndex"] == g.page_index))
    # Scanned: a page the statements were found on has no text layer. With nothing found, any such page counts.
    located = {p for entry in result["coverage"] for p in entry["pages"]}
    no_text = set(artefact.pages_without_text)
    return FilingScore(
        filing_id=artefact.filing_id, company=artefact.company, kind=artefact.kind, set=artefact.set, stratum=artefact.stratum,
        scanned=bool(located & no_text) or (artefact.result is None and bool(no_text)),
        extracted=artefact.result is not None, error_code=artefact.error.code if artefact.error else None, state=result["state"],
        facts=scores, fact_count=len(result["facts"]),
        checks=dict(Counter(c["status"] for c in result["checks"])), warnings=len(result["warnings"]),
        coverage=dict(Counter(e["status"] for e in result["coverage"])), seconds=artefact.seconds, bytes=artefact.bytes,
        model_calls=artefact.model_calls.total,
    )


def _summarise(filings: list[FilingScore], facts: list[FactScore] | None = None) -> Summary:
    facts = [f for filing in filings for f in filing.facts] if facts is None else facts
    counts = Counter(f.outcome for f in facts)
    checks = Counter()
    for filing in filings:
        checks.update(filing.checks)
    seconds = [f.seconds for f in filings if f.extracted]
    calls = [f.model_calls for f in filings]
    found = [f for f in facts if f.page_match is not None]
    return Summary(
        filings=len(filings), extracted=sum(1 for f in filings if f.extracted), failed=sum(1 for f in filings if not f.extracted),
        gold_facts=len(facts), **{name: counts.get(name, 0) for name in OUTCOMES},
        page_checked=len(found), page_match=sum(1 for f in found if f.page_match),
        checks_passed=checks.get("passed", 0), checks_failed=checks.get("failed", 0), checks_not_checked=checks.get("not_checked", 0),
        seconds_median=statistics.median(seconds) if seconds else None, seconds_max=max(seconds) if seconds else None,
        model_calls_median=statistics.median(calls) if calls else None, model_calls_max=max(calls) if calls else None,
    )


class RunScore(BaseModel):
    run: str
    pipeline_version: str | None
    prompt_version: str | None
    model: str | None
    eval_set: str
    filings: list[FilingScore]
    not_run: list[str]
    gold_missing: list[str]
    # The manifest's filings a baseline leaves out. They are noted, not scored, and never listed in `not_run`.
    out_of_scope: list[str] = Field(default_factory=list)

    def summary(self) -> Summary:
        return _summarise(self.filings)

    def strata(self) -> dict[str, dict[str, Summary]]:
        out: dict[str, dict[str, Summary]] = {"kind": {}, "scanned": {}, "basis": {}, "statement": {}, "stratum": {}}
        for value in sorted({f.kind for f in self.filings}):
            out["kind"][value] = _summarise([f for f in self.filings if f.kind == value])
        for value in ("yes", "no"):
            chosen = [f for f in self.filings if f.scanned == (value == "yes")]
            if chosen:
                out["scanned"][value] = _summarise(chosen)
        facts = [f for filing in self.filings for f in filing.facts]
        for value in sorted({f.basis for f in facts}):
            out["basis"][value] = _summarise([], [f for f in facts if f.basis == value])
        for value in sorted({f.statement for f in facts}):
            out["statement"][value] = _summarise([], [f for f in facts if f.statement == value])
        for value in sorted({f.stratum or "none" for f in self.filings}):  # "none": the manifest gave the filing no stratum
            out["stratum"][value] = _summarise([f for f in self.filings if (f.stratum or "none") == value])
        return out


def score_run(run_name: str, artefacts: list[Artefact], gold: dict[str, GoldFiling], manifest_ids: list[str],
              eval_set: str, pipeline_version: str | None = None, prompt_version: str | None = None,
              model: str | None = None, out_of_scope_ids: list[str] | None = None) -> RunScore:
    by_id = {a.filing_id: a for a in artefacts if eval_set == "all" or a.set == eval_set}
    scored = [score_filing(by_id[i], gold[i]) for i in sorted(by_id) if i in gold]
    chosen_gold = {i for i, g in gold.items() if eval_set == "all" or g.set == eval_set}
    listed, skipped = set(manifest_ids), set(out_of_scope_ids or [])
    return RunScore(
        run=run_name, pipeline_version=pipeline_version, prompt_version=prompt_version, model=model, eval_set=eval_set,
        filings=scored,
        not_run=sorted(i for i in chosen_gold if i not in by_id and i in listed and i not in skipped),
        gold_missing=sorted(i for i in by_id if i not in gold),
        out_of_scope=sorted(skipped),
    )
