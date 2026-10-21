"""Score a run against the gold set.

A gold fact is found by statement, basis, normalised section, normalised label and
normalised period label (phase 1 adds matching by concept). Figures are compared as
exact decimals: a match means value, sign, scale, basis and period all agree. Lines
that fit with different figures are ambiguous, never a silent pick.

An XBRL run is scored by concept within the instances' own slots (`score_xbrl_filing`): a gold fact is placed in
its source-rule slot (`cells.gold_slot`), and only the facts of the instance that owns the slot (`owners`) are its
candidates. A gold fact the eval cannot place, or one outside every slot the instances hold (a comparative), is
counted, never scored: the eval's own unknown is never blamed on XBRL. `match` stays exact equality for every
source; agreement only at the coarser precision, a dash against a tagged 0 and a sign apart are counted apart.

The `shown` mix (`score_shown`) scores the figure the product shows: XBRL where it owns a slot, and elsewhere the
PDF when the source rule reads it (`plan_pdf_numbers`), or nothing when it skips the PDF.
"""

from collections import Counter
from decimal import Decimal
import statistics
from typing import Literal, get_args

from pydantic import BaseModel, Field

from maester_eval.artefacts import Artefact
from maester_eval.cells import company_id, gold_slot, printed_exponent, read_figure, same_figure, xbrl_exponent, xbrl_slot
from maester_eval.gold import GoldFact, GoldFiling
from maester_eval.owners import SlotOwner, differing_cells, fact_figure, owned_facts, pooled_instances, slot_owners
from maester_eval.source_rule import CompanyIdentity, StatementBasis, XbrlDocInput, plan_pdf_numbers
from maester_eval.text import normalise

# match: value, sign and scale agree. wrong_value: the printed figure differs. wrong_scale: the printed figure is the
# gold one and the scale is not. wrong_status: a figure where a dash is printed, a dash where a figure is, or a cell
# that could not be read. ambiguous: lines fit with different figures. missing: no line fits.
# Only an XBRL figure gives the last three. match_at_precision: equal once both are rounded to the coarser of their two
# precisions. match_dash_zero: a printed dash against an XBRL 0. wrong_sign: equal in size, opposite in sign.
Outcome = Literal["match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing",
                  "match_at_precision", "match_dash_zero", "wrong_sign"]
OUTCOMES: tuple[Outcome, ...] = get_args(Outcome)


class FactScore(BaseModel):
    """One gold fact against a run. `read_printed`, `read_normalized` and `page_match` are None when no line fits
    (missing) and when lines with different figures fit (ambiguous): none was picked, so none is shown."""

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
    # Where the scored figure came from.
    source: Literal["pdf", "xbrl"] = "pdf"
    # The gold fact's place in `GoldFiling.facts`, from 0, set by the XBRL scorer. `score_filing` scores every gold
    # fact in order, so a PDF FactScore's place in `facts` is its index.
    gold_index: int | None = None
    # The matched XBRL fact's element, and the concept it was read with (under the run's map version).
    element: str | None = None
    xbrl_concept: str | None = None
    # The format id of the slot's owner, or of the pooled instances.
    format: str | None = None
    # For a map suspect: each element of the slot holding the gold figure under another concept, with that concept.
    suspects: list[tuple[str, str | None]] = Field(default_factory=list)
    # `map_suspect:<elements, sorted, joined by ",">`, `instances_differ` or `not_in_xbrl`.
    detail: str | None = None


NotPlacedReason = Literal["no_span", "no_period"]


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
    source: Literal["pdf", "xbrl", "shown"] = "pdf"
    # Gold facts not scored: placed outside every slot the source holds (a comparative), or not placed at all.
    outside_slots: int = 0
    not_placed: dict[NotPlacedReason, int] = Field(default_factory=dict)


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
    match_at_precision: int = 0
    match_dash_zero: int = 0
    wrong_sign: int = 0
    page_checked: int = 0
    page_match: int = 0
    checks_passed: int = 0
    checks_failed: int = 0
    checks_not_checked: int = 0
    seconds_median: float | None = None
    seconds_max: float | None = None
    model_calls_median: float | None = None
    model_calls_max: int | None = None

    def tenths(self, name: str) -> int | None:
        """`name` over its denominator in tenths of a percent, rounded down; None with nothing to divide by.

        Rounded down, so that 1000 means every one did. Whole numbers only: no float is involved."""
        numerator = getattr(self, name)
        if name == "page_match":
            denominator = self.page_checked
        elif name in ("checks_passed", "checks_failed", "checks_not_checked"):
            denominator = self.checks_passed + self.checks_failed + self.checks_not_checked
        elif name in ("extracted", "failed"):
            denominator = self.filings
        else:
            denominator = self.gold_facts
        return numerator * 1000 // denominator if denominator else None

    def rate(self, name: str) -> str:
        """`name` over its denominator as a percentage, rounded down to one decimal, such as `66.6%`; "—" with nothing to divide by."""
        return rate_text(self.tenths(name))


def rate_text(tenths: int | None) -> str:
    """A rate in tenths of a percent as a percentage to one decimal, such as `66.6%`; "—" for None."""
    return "—" if tenths is None else f"{tenths // 10}.{tenths % 10}%"


def _key(statement: str, basis: str, section: str, label: str, period_label: str) -> tuple:
    return (statement, basis, normalise(section), normalise(label), normalise(period_label))


def _compare(gold: GoldFact, fact: dict) -> Outcome:
    if gold.value_status == "dash" or fact["valueStatus"] != "value":
        return "match" if gold.value_status == "dash" and fact["valueStatus"] == "dash" else "wrong_status"
    if fact["normalizedValue"] is not None and Decimal(fact["normalizedValue"]) == Decimal(gold.normalized_value):
        return "match"
    if fact["reportedValue"] is not None and Decimal(fact["reportedValue"]) == Decimal(gold.value):
        return "wrong_scale"
    return "wrong_value"


def _candidates(index: dict[tuple, list[dict]], by_line: dict[tuple, list[dict]], sections: set[tuple],
                gold: GoldFact) -> list[dict]:
    """The facts a gold fact may be.

    When a fact of its statement and basis has its section, the line must be in that section: "Borrowings" is
    printed under both non-current and current liabilities, and the one that was not read is not made up by
    the other. When none has it, the section is dropped from the key, so that a section typed by hand, which
    the pipeline may have named otherwise, does not lose the match. No section typed means any section, even
    beside a section the pipeline left unnamed."""
    key = _key(gold.statement, gold.basis, gold.section, gold.label, gold.period_label)
    if key[2] and key[:3] in sections:
        return index.get(key, [])
    return by_line.get(key[:2] + key[3:], [])


def score_filing(artefact: Artefact, gold: GoldFiling) -> FilingScore:
    result = artefact.result
    if result is None:  # the filing could not be read, so every gold fact is missing
        result = {"facts": [], "checks": [], "warnings": [], "coverage": [], "state": None}
    index: dict[tuple, list[dict]] = {}
    by_line: dict[tuple, list[dict]] = {}  # the same, without the section
    for fact in result["facts"]:
        key = _key(fact["statement"], fact["basis"], fact["section"], fact["reportedLabel"], fact["periodLabel"])
        index.setdefault(key, []).append(fact)
        by_line.setdefault(key[:2] + key[3:], []).append(fact)
    sections = {key[:3] for key in index}
    scores: list[FactScore] = []
    for g in gold.facts:
        found = _candidates(index, by_line, sections, g)
        base = dict(concept=g.concept, statement=g.statement, basis=g.basis, label=g.label, period_label=g.period_label,
                    gold_printed=g.printed, gold_normalized=g.normalized_value)
        if not found:
            scores.append(FactScore(**base, outcome="missing", read_printed=None, read_normalized=None, page_match=None))
            continue
        if len({read_figure(f) for f in found}) > 1:
            scores.append(FactScore(**base, outcome="ambiguous", read_printed=None, read_normalized=None, page_match=None))
            continue
        fact = min(found, key=lambda f: f["lineOrder"])
        scores.append(FactScore(
            **base, outcome=_compare(g, fact), read_printed=fact["reportedText"], read_normalized=fact["normalizedValue"],
            page_match=fact["pageIndex"] == g.page_index))
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


Unusable = Literal["format_unmapped", "pair_mismatch", "unreadable"]


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
    source: Literal["pdf", "xbrl", "shown"] = "pdf"
    # An XBRL run's filings with no used instance, never scored: id to `format_unmapped`, `pair_mismatch` or `unreadable`.
    unusable: dict[str, Unusable] = Field(default_factory=dict)
    # An XBRL run's filings, gold or not, with slots whose instances have no order, to how many (none listed with 0).
    pooled: dict[str, int] = Field(default_factory=dict)
    # An XBRL run's reader and element map versions, as its `run.json` names them; None when it names none.
    parser_version: str | None = None
    map_version: str | None = None

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


def compare_xbrl(g: GoldFact, fact: dict) -> Outcome:
    """A gold fact against the one XBRL fact found for it. The rules apply in order:

    1. A gold dash against an XBRL 0 is `match_dash_zero` (XBRL cannot write a dash, so a filer tags it 0); against
       any other figure, or against nil, it is `wrong_status`, as phase 0 scores a figure where a dash is printed.
    2. XBRL nil against a gold figure is `wrong_status`.
    3. The same figure (`cells.same_figure`): exactly is `match`, at the coarser precision `match_at_precision`.
    4. Both non-zero, opposite in sign, and the negated gold figure not different: `wrong_sign`.
    5. The reported value equal to the gold value as printed: `wrong_scale`.
    6. Anything else: `wrong_value`."""
    figure = fact["valueStatus"] == "value" and fact["normalizedValue"] is not None
    if g.value_status == "dash":
        return "match_dash_zero" if figure and Decimal(fact["normalizedValue"]) == 0 else "wrong_status"
    if fact["valueStatus"] != "value":
        return "wrong_status"
    gold, gold_exp = Decimal(g.normalized_value), printed_exponent(g.value, g.scale)
    if figure:
        read, read_exp = Decimal(fact["normalizedValue"]), xbrl_exponent(fact["decimals"], fact["normalizedValue"])
        agreement = same_figure(gold, gold_exp, read, read_exp)
        if agreement == "exact":
            return "match"
        if agreement == "at_precision":
            return "match_at_precision"
        if gold != 0 and read != 0 and (gold < 0) != (read < 0) and same_figure(-gold, gold_exp, read, read_exp) != "different":
            return "wrong_sign"
    if fact["reportedValue"] is not None and Decimal(fact["reportedValue"]) == Decimal(g.value):
        return "wrong_scale"
    return "wrong_value"


def _holds_gold_figure(g: GoldFact, fact: dict) -> bool:
    """The XBRL fact holds the gold figure, exactly or at the coarser precision. A dash or nil holds no figure."""
    if g.value_status != "value" or fact["valueStatus"] != "value" or fact["normalizedValue"] is None:
        return False
    return same_figure(Decimal(g.normalized_value), printed_exponent(g.value, g.scale), Decimal(fact["normalizedValue"]),
                       xbrl_exponent(fact["decimals"], fact["normalizedValue"])) != "different"


def _read_printed(fact: dict) -> str | None:
    """The XBRL reported value with its unit label, such as `12345.00 ₹ lakh`; None for nil."""
    value, unit = fact["reportedValue"], fact.get("unitLabel")
    if value is None:
        return None
    return f"{value} {unit}" if unit else value


def _slot_format(artefact: Artefact, owner: SlotOwner, pooled: dict[str, list[str]]) -> str | None:
    """The format id of the slot's owner; for a pooled slot, those of the instances it was pooled from
    (`owners.pooled_instances`), joined by "+" when they differ."""
    read = {i.file: i for i in artefact.instances}
    chosen = [owner.owner] if owner.owner is not None else pooled[owner.slot]
    return "+".join(sorted({read[file].format for file in chosen if read[file].format is not None})) or None


def _filing_score(artefact: Artefact, facts: list[FactScore], source: Literal["pdf", "xbrl", "shown"], outside: int,
                  not_placed: Counter) -> FilingScore:
    """The filing-level counts of a run that read no PDF page: an XBRL run keeps no coverage and scans nothing."""
    result = artefact.result or {}
    return FilingScore(
        filing_id=artefact.filing_id, company=artefact.company, kind=artefact.kind, set=artefact.set, stratum=artefact.stratum,
        scanned=False, extracted=artefact.result is not None, error_code=artefact.error.code if artefact.error else None,
        state=result.get("state"), facts=facts, fact_count=len(result.get("facts", [])),
        checks=dict(Counter(c["status"] for c in result.get("checks", []))), warnings=len(result.get("warnings", [])),
        coverage=dict(Counter(e["status"] for e in result.get("coverage", []))), seconds=artefact.seconds,
        bytes=artefact.bytes, model_calls=artefact.model_calls.total, source=source, outside_slots=outside,
        not_placed=dict(not_placed))


def score_xbrl_filing(artefact: Artefact, gold: GoldFiling) -> FilingScore:
    """Each gold fact against the XBRL facts of its slot, by concept.

    A gold fact that is not placed (`no_span`, `no_period`) counts in `not_placed`; one placed in a slot no used
    instance holds counts in `outside_slots`. Neither is scored. In a slot, the candidates are the owner's facts of
    the gold concept, or for a pooled slot the facts every pooled instance holds alike; a concept the pooled
    instances hold differently is `ambiguous` (`instances_differ`). A `missing` or `wrong_value` fact names the
    slot's elements of another concept, or none, that hold the gold figure (`map_suspect:`)."""
    company = company_id(artefact.file)
    owners = slot_owners(artefact)
    pooled = pooled_instances(artefact)
    in_slot: dict[str, list[dict]] = {}
    for fact in owned_facts(artefact):
        in_slot.setdefault(xbrl_slot(company, artefact.kind, fact), []).append(fact)
    pooled_differ = {(c.slot, c.concept) for c in differing_cells(artefact) if c.owner is None}
    not_placed: Counter = Counter()
    outside = 0
    scores: list[FactScore] = []
    for index, g in enumerate(gold.facts):
        placed = gold_slot(company, artefact.kind, g)
        if placed.key is None:
            not_placed[placed.reason] += 1
            continue
        owner = owners.get(placed.key)
        if owner is None:
            outside += 1
            continue
        base = dict(concept=g.concept, statement=g.statement, basis=g.basis, label=g.label, period_label=g.period_label,
                    gold_printed=g.printed, gold_normalized=g.normalized_value, page_match=None, source="xbrl",
                    gold_index=index, format=_slot_format(artefact, owner, pooled))
        if (placed.key, g.concept) in pooled_differ:
            scores.append(FactScore(**base, outcome="ambiguous", read_printed=None, read_normalized=None,
                                    detail="instances_differ"))
            continue
        facts = in_slot.get(placed.key, [])
        found = [f for f in facts if f["concept"] == g.concept]
        fact: dict | None = None
        if not found:
            outcome: Outcome = "missing"
        elif len({fact_figure(f) for f in found}) > 1:
            outcome = "ambiguous"
        else:
            fact = found[0]
            outcome = compare_xbrl(g, fact)
        suspects: dict[str, str | None] = {}
        if outcome in ("missing", "wrong_value"):
            for other in facts:
                if other["concept"] != g.concept and _holds_gold_figure(g, other):
                    suspects.setdefault(other["element"], other["concept"])
        scores.append(FactScore(
            **base, outcome=outcome,
            read_printed=None if fact is None else _read_printed(fact),
            read_normalized=None if fact is None else fact["normalizedValue"],
            element=None if fact is None else fact["element"], xbrl_concept=None if fact is None else fact["concept"],
            suspects=sorted(suspects.items()),
            detail="map_suspect:" + ",".join(sorted(suspects)) if suspects else None))
    return _filing_score(artefact, scores, "xbrl", outside, not_placed)


def unusable_reason(artefact: Artefact) -> Unusable | None:
    """Why a filing has no used instance, from its first instance in pair order; None when one is used."""
    if any(i.used for i in artefact.instances):
        return None
    if not artefact.instances:
        raise ValueError(f"{artefact.filing_id}: an XBRL artefact with no instance")  # `xbrl-read` never writes one
    reason = artefact.instances[0].reason
    if reason == "XBRL_FORMAT_UNMAPPED":
        return "format_unmapped"
    if reason is not None and reason.startswith("XBRL_PAIR_"):
        return "pair_mismatch"
    if reason is not None and reason.startswith("XBRL_UNREADABLE:"):
        return "unreadable"
    raise ValueError(f"{artefact.filing_id}: an unused instance with an unknown reason")  # a reason is a code, never echoed


def score_xbrl_run(run_name: str, artefacts: list[Artefact], gold: dict[str, GoldFiling], manifest_ids: list[str],
                   eval_set: str, record: dict, out_of_scope_ids: list[str] | None = None) -> RunScore:
    """An XBRL run against the gold set. A filing with no used instance is listed in `unusable`, not scored; every
    filing of the set, with gold or not, with pooled slots is counted in `pooled`. `record` is the run's `run.json`."""
    by_id = {a.filing_id: a for a in artefacts if eval_set == "all" or a.set == eval_set}
    unusable = {i: reason for i in sorted(by_id) if (reason := unusable_reason(by_id[i])) is not None}
    pooled = {i: n for i in sorted(by_id) if (n := sum(1 for o in slot_owners(by_id[i]).values() if o.owner is None))}
    scored = [score_xbrl_filing(by_id[i], gold[i]) for i in sorted(by_id) if i in gold and i not in unusable]
    chosen_gold = {i for i, g in gold.items() if eval_set == "all" or g.set == eval_set}
    listed, skipped = set(manifest_ids), set(out_of_scope_ids or [])
    return RunScore(
        run=run_name, pipeline_version=record.get("pipeline_version"), prompt_version=record.get("prompt_version"),
        model=record.get("model"), eval_set=eval_set, filings=scored,
        not_run=sorted(i for i in chosen_gold if i not in by_id and i in listed and i not in skipped),
        gold_missing=sorted(i for i in by_id if i not in gold), out_of_scope=sorted(skipped),
        source="xbrl", unusable=unusable, pooled=pooled, parser_version=record.get("parser_version"),
        map_version=record.get("map_version"))


_NO_IDENTITY_CODES: CompanyIdentity = {"bse_code": None, "cin": None, "nse_symbol": None, "isin": None}


def _plan_reads_pdf(gold: GoldFiling, pdf_artefact: Artefact | None, xbrl_artefact: Artefact) -> bool:
    """Whether the source rule reads the PDF's numbers, given the filing's used instances, each a settled XBRL
    document of the filing's company and period covering the `(statement, basis)` pairs its facts hold.

    The identity carries no code: neither the gold file nor an artefact holds the BSE code, and with every XBRL
    document settled and of the PDF's company, the plan never reads the identity."""
    company = company_id(gold.file)
    coverage = (pdf_artefact.result or {}).get("coverage", []) if pdf_artefact is not None else []
    found: list[StatementBasis] = [{"statement": e["statement"], "basis": e["basis"]} for e in coverage]
    facts = (xbrl_artefact.result or {}).get("facts", [])
    docs: list[XbrlDocInput] = []
    for instance in xbrl_artefact.instances:
        if not instance.used:
            continue
        pairs = dict.fromkeys((f["statement"], f["basis"]) for f in facts if f["instance"] == instance.file)
        docs.append({"document_id": instance.file, "state": "settled", "company_id": company,
                     "identity": dict(_NO_IDENTITY_CODES), "period_end": gold.period_end,
                     "coverage": [{"statement": s, "basis": b} for s, b in pairs]})
    plan = plan_pdf_numbers({"company_id": company, "company_identity": dict(_NO_IDENTITY_CODES), "kind": gold.kind,
                             "period_end": gold.period_end, "statements_found": found}, docs)
    return plan["action"] == "read"


def _shown_filing(gold: GoldFiling, pdf: FilingScore, xbrl: FilingScore | None, xbrl_artefact: Artefact | None,
                  pdf_artefact: Artefact | None) -> FilingScore:
    usable = xbrl_artefact is not None and any(i.used for i in xbrl_artefact.instances)
    if usable:
        x = xbrl if xbrl is not None else score_xbrl_filing(xbrl_artefact, gold)
        by_index = {f.gold_index: f for f in x.facts}
        owners = slot_owners(xbrl_artefact)
        reads_pdf = _plan_reads_pdf(gold, pdf_artefact, xbrl_artefact)
    company = company_id(gold.file)
    not_placed: Counter = Counter()
    outside = 0
    facts: list[FactScore] = []
    for index, g in enumerate(gold.facts):
        if g.period_end is None:
            not_placed["no_period"] += 1
            continue
        if g.period_end != gold.period_end:  # a comparative: the product shows it from another filing
            outside += 1
            continue
        from_pdf = pdf.facts[index].model_copy(update={"source": "pdf", "gold_index": index})
        if not usable:  # no XBRL to show: the filing is read by Gemini
            facts.append(from_pdf)
            continue
        placed = gold_slot(company, gold.kind, g)
        if placed.key is None:
            not_placed[placed.reason] += 1
        elif placed.key in owners:  # XBRL owns the slot: every figure in it comes from XBRL, a line it lacks included
            facts.append(by_index[index])
        elif reads_pdf:  # a slot XBRL holds no facts for, in a PDF that is read
            facts.append(from_pdf)
        else:  # the PDF is skipped, so nothing is shown there
            facts.append(FactScore(
                concept=g.concept, statement=g.statement, basis=g.basis, label=g.label, period_label=g.period_label,
                outcome="missing", gold_printed=g.printed, read_printed=None, gold_normalized=g.normalized_value,
                read_normalized=None, page_match=None, source="xbrl", gold_index=index, detail="not_in_xbrl"))
    return pdf.model_copy(update={"facts": facts, "source": "shown", "outside_slots": outside,
                                  "not_placed": dict(not_placed)})


def score_shown(gold: dict[str, GoldFiling], pdf: RunScore, xbrl: RunScore | None, pdf_artefacts: list[Artefact],
                xbrl_artefacts: list[Artefact]) -> RunScore:
    """The figure the product shows, for every gold filing of the PDF run, own-period facts only.

    A filing with no XBRL artefact, or none with a used instance, is the PDF's throughout (an annual report is never
    paired). Otherwise a slot an instance owns is XBRL's FactScore; any other slot is the PDF's when the source rule
    (`plan_pdf_numbers`) reads the PDF, and `missing` (`not_in_xbrl`) when it skips it. With no XBRL run, every
    filing is the PDF's."""
    pdf_by_id = {a.filing_id: a for a in pdf_artefacts}
    xbrl_by_id = {a.filing_id: a for a in xbrl_artefacts} if xbrl is not None else {}
    xbrl_scores = {f.filing_id: f for f in xbrl.filings} if xbrl is not None else {}
    filings = [_shown_filing(gold[p.filing_id], p, xbrl_scores.get(p.filing_id), xbrl_by_id.get(p.filing_id),
                             pdf_by_id.get(p.filing_id)) for p in pdf.filings]
    return pdf.model_copy(update={
        "run": pdf.run if xbrl is None else f"{pdf.run}+{xbrl.run}", "filings": filings, "source": "shown",
        "pipeline_version": None, "prompt_version": None, "model": None})
