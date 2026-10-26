"""The report: Markdown for people and JSON for the next comparison.

The Markdown holds labels and figures from public filings, which is why a report is a file and never console output.
A rate is a ratio of whole numbers (`Summary.rate`), and so is the change between two of them: it is worked out in
tenths of a percent, with no float.

With a run of another source (`xbrl`, and the `shown` mix of the two), the format tags or settled facts, the report
also gives the figures by source, by format tag, the element map against gold and the settled facts, which are scored
apart. A report of one PDF run is the phase 0 report, unchanged.
"""

from collections import Counter
from datetime import datetime
import functools
from importlib import resources
import json
from pathlib import Path, PurePosixPath

from maester_eval.artefacts import read_artefacts, read_run
from maester_eval.cells import COMPARE_RULE_VERSION
from maester_eval.errors import EvalError
from maester_eval.files import write_text_atomically
from maester_eval.gold import GoldFiling
from maester_eval.owners import OWNER_RULE_VERSION
from maester_eval.paths import to_utc
from maester_eval.periods import SPAN_RULE_VERSION
from maester_eval.scoring import FactScore, RunScore, Summary, score_run, score_xbrl_run
from maester_eval.sheet_concepts import CONCEPT_CARRY_VERSION
from maester_eval.source_rule import SOURCE_RULE_VERSION
from maester_eval.tags import TAG_DIMENSIONS, UNITS

LABELS = {"match": "Exact match", "wrong_value": "Wrong value", "wrong_scale": "Wrong scale",
          "wrong_status": "Wrong status", "ambiguous": "Ambiguous", "missing": "Missing"}
RATES = [*LABELS.items(), ("page_match", "Page match"), ("checks_passed", "Checks passed"), ("checks_failed", "Checks failed")]
# The outcomes of a gold fact that is right. The `## Mismatches` appendix lists every other.
MATCHES = frozenset({"match", "match_at_precision", "match_dash_zero"})
SOURCES = ("pdf", "xbrl", "shown")
TAG_TITLES = {"unit": "Unit", "brackets": "Negatives in brackets", "restated": "Restated columns",
              "spreads": "Two-page spreads", "financials": "Banks and NBFCs"}
NOT_TAGGED = "not tagged"


class MapFileError(EvalError):
    """A format id with no element map file."""


def score_run_dir(run_dir: Path, gold: dict[str, GoldFiling], manifest_ids: list[str], eval_set: str,
                  out_of_scope: dict[str, str] | None = None) -> RunScore:
    """Score a run folder against the gold set (`read_gold`).

    `out_of_scope` maps the ids of the filings a baseline leaves out to the reason. They are never listed as not run."""
    record = read_run(run_dir)
    return score_run(run_dir.name, read_artefacts(run_dir), gold, manifest_ids, eval_set,
                     pipeline_version=record.get("pipeline_version"), prompt_version=record.get("prompt_version"),
                     model=record.get("model"), out_of_scope_ids=list(out_of_scope or {}))


def score_xbrl_run_dir(run_dir: Path, gold: dict[str, GoldFiling], manifest_ids: list[str], eval_set: str,
                       out_of_scope: dict[str, str] | None = None) -> RunScore:
    """Score an XBRL run folder against the gold set, as `score_run_dir` does a PDF run's."""
    return score_xbrl_run(run_dir.name, read_artefacts(run_dir), gold, manifest_ids, eval_set, read_run(run_dir),
                          list(out_of_scope or {}))


def _cell(value: object) -> str:
    """A table cell: one line, no bare pipe, and a dash for nothing. A label read from a filing may hold a pipe or a line break."""
    text = "" if value is None else " ".join(str(value).split())
    return text.replace("|", "\\|") or "—"


def _row(cells: list) -> str:
    return "| " + " | ".join(_cell(cell) for cell in cells) + " |"


def _code(value: str | None) -> str:
    """A version or a model name in code style, or "unknown" when the run did not record it (a run stopped early has no model)."""
    return "unknown" if value is None else f"`{value}`"


def _num(value: float | int | None) -> str:
    return "—" if value is None else (f"{value:.1f}" if isinstance(value, float) else str(value))


def _summary_table(s: Summary) -> list[str]:
    rows = [
        ("Filings", str(s.filings), ""), ("Read", str(s.extracted), s.rate("extracted")), ("Failed", str(s.failed), s.rate("failed")),
        ("Gold facts", str(s.gold_facts), ""),
    ]
    rows += [(label, f"{s.page_match} of {s.page_checked}" if name == "page_match" else str(getattr(s, name)), s.rate(name))
             for name, label in RATES]
    rows += [
        ("Checks not checked", str(s.checks_not_checked), s.rate("checks_not_checked")),
        ("Seconds per filing, median / max", f"{_num(s.seconds_median)} / {_num(s.seconds_max)}", ""),
        ("Model calls per filing, median / max", f"{_num(s.model_calls_median)} / {_num(s.model_calls_max)}", ""),
    ]
    return ["| Measure | Count | Rate |", "| --- | --- | --- |"] + [f"| {a} | {b} | {c} |" for a, b, c in rows]


def _strata_table(title: str, strata: dict[str, Summary]) -> list[str]:
    lines = [f"## By {title}", "", "| Value | Filings | Gold facts | Exact match | Missing | Page match |", "| --- | --- | --- | --- | --- | --- |"]
    for value, s in strata.items():
        lines.append(_row([value, s.filings or None, s.gold_facts, s.rate("match"), s.rate("missing"), s.rate("page_match")]))
    return lines + [""]


def pp_change(a: int | None, b: int | None) -> str:
    """The change from rate `b` to rate `a`, both in tenths of a percent, in percentage points, such as `+33.3 pp`; a
    dash when either is None."""
    if a is None or b is None:
        return "—"
    change = a - b
    return f"{'−' if change < 0 else '+'}{abs(change) // 10}.{abs(change) % 10} pp"


def _pp(now: Summary, before: Summary, name: str) -> str:
    """The change in a rate from one run to another in percentage points, such as `+33.3 pp`; a dash when either has no denominator."""
    return pp_change(now.tenths(name), before.tenths(name))


def _delta_table(now: Summary, before: Summary, earlier_run: str) -> list[str]:
    lines = [f"## Against {earlier_run}", "", "| Rate | This run | Earlier | Change |", "| --- | --- | --- | --- |"]
    lines += [f"| {label} | {now.rate(name)} | {before.rate(name)} | {_pp(now, before, name)} |" for name, label in RATES]
    return lines + [""]


def count_change(a: int, b: int) -> str:
    """The change from count `b` to count `a` with its sign, such as `+3` or `−2`; `0` for none."""
    change = a - b
    return f"{'−' if change < 0 else '+'}{abs(change)}" if change else "0"


def denominator_counts(score: RunScore) -> list[tuple[str, int]]:
    """What decides the denominator of an `xbrl` or `shown` score: the gold facts it scored, those it did not (Outside,
    Not placed), the filings with no used instance and the instances not used. A map or reader change that drops a
    slot's facts, or makes an instance unusable, moves gold facts out of the rates; these counts show it."""
    return [("Gold facts scored", score.summary().gold_facts),
            ("Outside", sum(f.outside_slots for f in score.filings)),
            ("Not placed", sum(sum(f.not_placed.values()) for f in score.filings)),
            ("Filings with no used instance", len(score.unusable)),
            ("Instances not used", len(score.unused_instances))]


def _source_delta_table(now: RunScore, before: RunScore) -> list[str]:
    """`## Against <earlier run>` for an `xbrl` or `shown` score: the rates of `_delta_table`, then the counts that
    decide their denominator. A rate that holds while gold facts leave the denominator is not a rate that held."""
    lines = _delta_table(now.summary(), before.summary(), before.run)
    lines += ["| Count | This run | Earlier | Change |", "| --- | --- | --- | --- |"]
    lines += [_row([label, a, b, count_change(a, b)])
              for (label, a), (_, b) in zip(denominator_counts(now), denominator_counts(before))]
    return lines + [""]


# --- The element map -----------------------------------------------------------------------------------------------


@functools.cache
def _map_concepts(format_id: str) -> frozenset[str]:
    path = resources.files("pdf_financial_qa.xbrl") / "maps" / f"{format_id.replace('/', '.')}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise MapFileError(f"no element map for {format_id}") from None
    concepts: set[str | None] = set()
    for entry in data["elements"]:
        concepts.add(entry.get("concept"))
        balance = entry.get("cash_balance") or {}
        concepts.update((balance.get("opening_concept"), balance.get("closing_concept")))
    return frozenset(c for c in concepts if c is not None)


def map_concepts(format_id: str) -> set[str]:
    """The non-null concepts of a format's element map, the cash balance's opening and closing concepts included.

    Read from the map file the parser was given (`maps/<family>.<kind>.json`): phase 4's `ElementMap` has no accessor
    for its entries. An `ElementMap.elements` accessor would replace this."""
    return set(_map_concepts(format_id))


_FORMAT_OUTCOMES = ("match", "match_at_precision", "match_dash_zero", "wrong_sign", "wrong_value", "wrong_scale",
                    "wrong_status", "ambiguous", "missing")


def map_against_gold(xbrl: RunScore) -> dict:
    """What an XBRL run says about the element map, from the gold facts it was scored on: counts by format id, the
    elements that hold a gold figure under another concept, the elements that differ from gold only in sign, the gold
    concepts no element of the format gives, and the filings with no order or no used instance.

    A slot pooled from instances of two formats has a format id of both joined by "+": a gold concept is lacking only
    when no map of either has it."""
    facts = [fact for filing in xbrl.filings for fact in filing.facts]
    formats: dict[str, Counter] = {}
    for fact in facts:
        formats.setdefault(fact.format or "no format", Counter())[fact.outcome] += 1
    suspects: Counter = Counter(
        (element, concept or "none", fact.concept) for fact in facts for element, concept in fact.suspects)
    sign_only = Counter(fact.element or "—" for fact in facts if fact.outcome == "wrong_sign")
    lacking: Counter = Counter()
    for fact in facts:
        if fact.format is not None:
            known = set().union(*(map_concepts(part) for part in fact.format.split("+")))
            if fact.concept not in known:
                lacking[(fact.format, fact.concept)] += 1
    return {
        "formats": {name: {"gold_facts": sum(counts.values()), **{o: counts.get(o, 0) for o in _FORMAT_OUTCOMES}}
                    for name, counts in sorted(formats.items())},
        "suspects": [{"element": e, "read_concept": read, "gold_concept": gold, "gold_facts": n}
                     for (e, read, gold), n in sorted(suspects.items(), key=lambda item: (-item[1], item[0]))],
        "sign_only": [{"element": e, "gold_facts": n} for e, n in sorted(sign_only.items(), key=lambda item: (-item[1], item[0]))],
        "without_element": [{"format": f, "concept": c, "gold_facts": n} for (f, c), n in sorted(lacking.items())],
        "pooled": dict(xbrl.pooled), "unusable": dict(xbrl.unusable),
        "partly_used": [u.model_dump() for u in xbrl.unused_instances if u.filing_id not in xbrl.unusable],
    }


def _map_lines(xbrl: RunScore) -> list[str]:
    """`## The element map against gold`."""
    found = map_against_gold(xbrl)
    lines = ["## The element map against gold", "",
             "Each gold fact placed in an XBRL slot is looked for by its concept. A gold fact the instances do not place in "
             "a slot is not scored here.", "", "### Per format", "",
             "| Format | Gold facts | Exact match | At precision | Dash as 0 | Wrong sign | Wrong value | Wrong scale "
             "| Wrong status | Ambiguous | Missing |", _row(["---"] * 11)]
    for name, counts in found["formats"].items():
        summary = Summary(gold_facts=counts["gold_facts"], match=counts["match"], missing=counts["missing"])
        lines.append(_row([name, counts["gold_facts"], summary.rate("match"), counts["match_at_precision"],
                           counts["match_dash_zero"], counts["wrong_sign"], counts["wrong_value"], counts["wrong_scale"],
                           counts["wrong_status"], counts["ambiguous"], summary.rate("missing")]))
    lines += ["", "### Map suspects", "",
              "An element of the slot holds the gold figure under another concept, or under none: the map may need the "
              "gold concept for it.", ""]
    if found["suspects"]:
        lines += ["| Element | Its concept as read | The gold concept | Gold facts |", _row(["---"] * 4)]
        lines += [_row([s["element"], s["read_concept"], s["gold_concept"], s["gold_facts"]]) for s in found["suspects"]]
    else:
        lines.append("None.")
    lines += ["", "### Sign only", "",
              "The instance holds the gold figure with the opposite sign. This is a convention of the element, "
              "not a misread.", ""]
    if found["sign_only"]:
        lines += ["| Element | Gold facts |", _row(["---"] * 2)]
        lines += [_row([s["element"], s["gold_facts"]]) for s in found["sign_only"]]
    else:
        lines.append("None.")
    lines += ["", "### Concepts no element gives", ""]
    if found["without_element"]:
        lines += ["| Format | Gold concept | Gold facts |", _row(["---"] * 3)]
        lines += [_row([w["format"], w["concept"], w["gold_facts"]]) for w in found["without_element"]]
    else:
        lines.append("None.")
    lines += ["", "### Refilings with no order", ""]
    if found["pooled"]:
        lines += ["| Filing | Slots with no order |", _row(["---"] * 2)]
        lines += [_row([filing, n]) for filing, n in found["pooled"].items()]
    else:
        lines.append("None.")
    lines += ["", "### XBRL not used", ""]
    if found["unusable"]:
        lines += ["| Filing | Reason |", _row(["---"] * 2)]
        lines += [_row([filing, reason]) for filing, reason in found["unusable"].items()]
    else:
        lines.append("None.")
    lines += ["", "### XBRL partly used", "",
              "A filing scored on its other instances. The instance named here was not read, so its slots are not "
              "scored.", ""]
    if found["partly_used"]:
        lines += ["| Filing | Instance not used | Reason |", _row(["---"] * 3)]
        lines += [_row([u["filing_id"], PurePosixPath(u["file"]).name, u["reason"]]) for u in found["partly_used"]]
    else:
        lines.append("None.")
    return lines + [""]


# --- By source and by format tag -----------------------------------------------------------------------------------


def _by_source_lines(scores: list[RunScore]) -> list[str]:
    lines = ["## By source", "",
             "| Source | Filings | Gold facts | Exact match | At precision | Dash as 0 | Wrong sign | Missing | Outside | Not placed |",
             _row(["---"] * 10)]
    for score in scores:
        s = score.summary()
        pdf = score.source == "pdf"
        lines.append(_row([
            score.source, s.filings, s.gold_facts, s.rate("match"), s.match_at_precision, s.match_dash_zero, s.wrong_sign,
            s.rate("missing"), None if pdf else sum(f.outside_slots for f in score.filings),
            None if pdf else sum(sum(f.not_placed.values()) for f in score.filings)]))
    runs = ", ".join(f"{score.source} `{score.run}`" for score in scores)
    return lines + ["", f"Runs: {runs}.", "",
                    "Outside is the gold facts not scored because the source holds no such slot. For `xbrl` it is gold facts "
                    "in a slot no used instance holds. For `shown` it is gold facts of another period than the filing's own. "
                    "Not placed is the gold facts with no span or no date.", ""]


def _tag_of(tags: dict[str, dict[str, str]], filing_id: str, dimension: str) -> str:
    """A filing's tag word; a filing `tags` does not hold is not tagged."""
    return tags.get(filing_id, {}).get(dimension, NOT_TAGGED)


def format_tag_table(scores: list[RunScore], tags: dict[str, dict[str, str]]) -> dict[str, dict[str, dict]]:
    """For each tag dimension and each value, the filings of the first score and each source's exact matches over its
    gold facts. A filing is under every dimension, because the tags are not a partition. A source with no gold fact
    under the value has `None`. Banks and NBFCs tagged `yes` are out of scope: their row counts them from `tags`
    (every filing of the set, scored or not) and each source present reads `out_of_scope`."""
    first = scores[0]
    by_source = {score.source: score for score in scores}
    order = (*UNITS, "yes", "no", NOT_TAGGED)
    table: dict[str, dict[str, dict]] = {}
    for dimension in TAG_DIMENSIONS:
        values = {_tag_of(tags, f.filing_id, dimension) for score in scores for f in score.filings}
        if dimension == "financials" and any(_tag_of(tags, i, dimension) == "yes" for i in tags):
            values.add("yes")
        rows: dict[str, dict] = {}
        for value in sorted(values, key=lambda v: (order.index(v) if v in order else len(order), v)):
            if dimension == "financials" and value == "yes":
                n = sum(1 for i in tags if _tag_of(tags, i, dimension) == "yes")
                rows[value] = {"filings": n, **{source: ({"out_of_scope": n} if source in by_source else None) for source in SOURCES}}
                continue
            row: dict = {"filings": sum(1 for f in first.filings if _tag_of(tags, f.filing_id, dimension) == value)}
            for source in SOURCES:
                score = by_source.get(source)
                facts = [] if score is None else [x for f in score.filings if _tag_of(tags, f.filing_id, dimension) == value
                                                  for x in f.facts]
                row[source] = {"gold_facts": len(facts), "match": sum(1 for x in facts if x.outcome == "match")} if facts else None
            rows[value] = row
        table[dimension] = rows
    return table


def _tag_cell(cell: dict | None) -> str | None:
    if cell is None:
        return None
    if "out_of_scope" in cell:
        return f"out of scope ({cell['out_of_scope']} filing(s))"
    return f"{cell['match']} of {cell['gold_facts']} ({Summary(gold_facts=cell['gold_facts'], match=cell['match']).rate('match')})"


UNIT_ANSWERS = (("agrees", "agree"), ("disagrees", "disagree"), ("mixed", "mixed"), ("no_monetary_gold", "no monetary gold"),
                ("not_tagged", "not tagged"))


def _unit_lines(tags: dict[str, dict[str, str]], unit_checks: dict[str, str], gold_units: dict[str, list[str]]) -> list[str]:
    counts = Counter(unit_checks.values())
    lines = ["Unit tag against gold: " + ", ".join(f"{counts.get(answer, 0)} {words}" for answer, words in UNIT_ANSWERS) + ".", ""]
    listed = [i for i in sorted(unit_checks) if unit_checks[i] in ("disagrees", "mixed")]
    for filing_id in listed:
        units = " and ".join(gold_units.get(filing_id) or ["a unit not recorded"])
        lines.append(f"- {filing_id}: tagged {_tag_of(tags, filing_id, 'unit')}, gold {units}")
    return lines + [""] if listed else lines


def _tag_lines(scores: list[RunScore], tags: dict[str, dict[str, str]], unit_checks: dict[str, str] | None,
               gold_units: dict[str, list[str]]) -> list[str]:
    lines = ["## By format tag", "",
             "Filings counts the filings of the first run. A cell is the exact matches over the gold facts of the filings "
             "with that value. A filing counts under every dimension, because the tags are not a partition. A filing nobody "
             "tagged is not tagged, never no.", ""]
    for dimension, rows in format_tag_table(scores, tags).items():
        lines += [f"### {TAG_TITLES[dimension]}", "", "| Value | Filings | pdf | xbrl | shown |", _row(["---"] * 5)]
        lines += [_row([value, row["filings"], *(_tag_cell(row[source]) for source in SOURCES)]) for value, row in rows.items()]
        lines.append("")
        if dimension == "unit" and unit_checks is not None:
            lines += _unit_lines(tags, unit_checks, gold_units)
    return lines


def _settled_lines(settled: list[RunScore]) -> list[str]:
    lines = ["## Settled disagreements", "",
             "Gold facts frozen from settled disagreements. They exist only where the model and XBRL disagreed, so they are "
             "scored apart from every rate above.", "",
             "| Source | Filings | Settled facts | Exact match | Not in this run |", _row(["---"] * 5)]
    for score in settled:
        s = score.summary()
        lines.append(_row([score.source, s.filings, s.gold_facts, s.rate("match"), len(score.not_run)]))
    return lines + [""]


def rule_versions(xbrl: RunScore | None) -> dict:
    """The versions of the rules this report applies (`span_rule` to `source_rule`, those of today's code, which scored
    it), and the versions of the XBRL reader and map the run was read under, from its `run.json`: None with no XBRL run,
    or when its record names none."""
    return {"span_rule": SPAN_RULE_VERSION, "compare_rule": COMPARE_RULE_VERSION, "concept_carry": CONCEPT_CARRY_VERSION,
            "owner_rule": OWNER_RULE_VERSION, "source_rule": SOURCE_RULE_VERSION,
            "xbrl_parser": None if xbrl is None else xbrl.parser_version, "xbrl_map": None if xbrl is None else xbrl.map_version}


def _version_lines(xbrl: RunScore | None) -> list[str]:
    versions = rule_versions(xbrl)
    lines = ["## Rule versions", "",
             f"- span rule {versions['span_rule']}", f"- compare rule {versions['compare_rule']}",
             f"- concept carry rule {versions['concept_carry']}", f"- owner rule {versions['owner_rule']}",
             f"- source rule {versions['source_rule']}"]
    if xbrl is not None:
        lines += [f"- XBRL parser {versions['xbrl_parser'] or 'unknown'}", f"- XBRL element map {versions['xbrl_map'] or 'unknown'}"]
    return lines + [""]


def render_markdown(score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None,
                    out_of_scope_reasons: dict[str, str] | None = None, others: list[RunScore] | None = None,
                    others_against: list[RunScore] | None = None, tags: dict[str, dict[str, str]] | None = None,
                    settled: list[RunScore] | None = None, unit_checks: dict[str, str] | None = None,
                    gold_units: dict[str, list[str]] | None = None) -> str:
    """The report of `score`, the PDF run on the `sheet` view of gold.

    `others` are the runs of the other sources on the same view (`xbrl`, `shown`); `others_against` are earlier runs of
    those sources; `tags` maps a filing id to its `manifest.tag_values`; `settled` holds the `pdf` and `xbrl` runs scored
    on the `settled` view; `unit_checks` maps a filing id to `tags.unit_against_gold`'s answer and `gold_units` to the
    units its gold facts are in. With none of `others`, `tags` and `settled`, this is the phase 0 report."""
    s = score.summary()
    when = to_utc(generated_at).strftime("%Y-%m-%d %H:%M UTC")
    scores = [score, *(others or [])]
    xbrl = next((o for o in scores if o.source == "xbrl"), None)
    extended = bool(others) or tags is not None or bool(settled)
    lines = [
        f"# Evaluation report: {score.run}", "",
        f"Set `{score.eval_set}` · {when} · pipeline {_code(score.pipeline_version)} · prompt {_code(score.prompt_version)}"
        f" · model {_code(score.model)}.",
        "", "An exact match means value, sign, scale, basis and period all agree with the gold set. Rates are over the gold facts of the scored filings.", "",
        "## Summary", "", *_summary_table(s), "",
    ]
    if against is not None:
        lines += _delta_table(s, against.summary(), against.run)
    if extended:
        lines += _by_source_lines(scores)
    if tags is not None:
        lines += _tag_lines(scores, tags, unit_checks, gold_units or {})
    if xbrl is not None:
        lines += _map_lines(xbrl)
    if settled:
        lines += _settled_lines(settled)
    for other in others or []:
        earlier = next((a for a in others_against or [] if a.source == other.source), None)
        if earlier is not None:
            lines += _source_delta_table(other, earlier)
    if extended:
        lines += _version_lines(xbrl)
    for title, strata in score.strata().items():
        if strata:
            lines += _strata_table(title, strata)
    lines += ["## Filings", "", "| Filing | Kind | Scanned | Outcome | Gold facts | Exact match | Seconds | Model calls | Size (MB) | Stratum |",
              _row(["---"] * 10)]
    for f in score.filings:
        outcome = f.state if f.extracted else f.error_code
        exact = sum(1 for x in f.facts if x.outcome == "match")
        lines.append(_row([f.filing_id, f.kind, "yes" if f.scanned else "no", outcome, len(f.facts), exact, f.seconds,
                           f.model_calls, f"{f.bytes / 1_000_000:.1f}", f.stratum or "none"]))
    lines.append("")
    if score.not_run:
        lines += ["## Not run", ""] + [f"- {i}" for i in score.not_run] + [""]
    if score.gold_missing:
        lines += ["## No gold yet", ""] + [f"- {i}" for i in score.gold_missing] + [""]
    if score.out_of_scope:
        reasons = out_of_scope_reasons or {}
        lines += ["## Out of scope", ""] + [f"- {i} — {reasons[i]}" if reasons.get(i) else f"- {i}" for i in score.out_of_scope] + [""]
    mismatches = _mismatches(score)
    lines += ["## Mismatches", ""]
    if not mismatches:
        lines.append("None.")
    else:
        lines += ["| Filing | Statement | Basis | Label | Period | Outcome | Gold | Read |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for filing_id, x in mismatches:
            lines.append(_row([filing_id, x.statement, x.basis, x.label, x.period_label, x.outcome, x.gold_printed, x.read_printed]))
    for other in others or []:
        lines += _source_mismatch_lines(other)
    return "\n".join(lines) + "\n"


def _mismatches(score: RunScore) -> list[tuple[str, FactScore]]:
    """Each gold fact of the score that is not a match, with its filing id, in order."""
    return [(f.filing_id, x) for f in score.filings for x in f.facts if x.outcome not in MATCHES]


def _gold_index(position: int, x: FactScore) -> int:
    """The gold fact's place in its gold file: the XBRL scorer and `shown` set it; a PDF score holds every gold fact
    in order, so there it is the fact's place in the filing's scores."""
    return position if x.gold_index is None else x.gold_index


def mismatch_records(score: RunScore) -> list[dict]:
    """`_mismatches` as `report.json` keeps them: the gold fact's identity (filing, place in the gold file, concept,
    statement, basis, period label, span and period end), the outcome, where the scored figure came from, and the
    element and detail for an XBRL figure. No figure: `score` and the gold file hold those."""
    return [{"filing_id": f.filing_id, "gold_index": _gold_index(position, x), "concept": x.concept,
             "statement": x.statement, "basis": x.basis, "period_label": x.period_label, "span": x.span,
             "period_end": x.period_end, "outcome": x.outcome, "source": x.source, "element": x.element,
             "detail": x.detail}
            for f in score.filings for position, x in enumerate(f.facts) if x.outcome not in MATCHES]


def _source_mismatch_lines(score: RunScore) -> list[str]:
    """`## Mismatches: <source>` for an `xbrl` or `shown` score, with the figures as the PDF run's Mismatches shows them."""
    lines = ["", f"## Mismatches: {score.source}", ""]
    found = _mismatches(score)
    if not found:
        return lines + ["None."]
    lines += ["| Filing | Statement | Basis | Concept | Period | Span | Period end | Outcome | From | Element | Detail | Gold | Read |",
              _row(["---"] * 13)]
    for filing_id, x in found:
        lines.append(_row([filing_id, x.statement, x.basis, x.concept, x.period_label, x.span, x.period_end, x.outcome,
                           x.source, x.element, x.detail, x.gold_printed, x.read_printed]))
    return lines


def write_report(run_dir: Path, score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None,
                 out_of_scope_reasons: dict[str, str] | None = None, others: list[RunScore] | None = None,
                 others_against: list[RunScore] | None = None, tags: dict[str, dict[str, str]] | None = None,
                 settled: list[RunScore] | None = None, unit_checks: dict[str, str] | None = None,
                 gold_units: dict[str, list[str]] | None = None) -> tuple[Path, Path]:
    generated_at = to_utc(generated_at)
    md = run_dir / "report.md"
    js = run_dir / "report.json"
    scores = [score, *(others or [])]
    xbrl = next((o for o in scores if o.source == "xbrl"), None)
    data: dict = {
        "generated_at": generated_at.isoformat(), "against": against.run if against else None,
        "summary": score.summary().model_dump(), "strata": {k: {v: s.model_dump() for v, s in d.items()} for k, d in score.strata().items()},
        "score": score.model_dump(mode="json"), "rule_versions": rule_versions(xbrl),
    }
    if others:
        data["sources"] = {o.source: {"summary": o.summary().model_dump(),
                                      "strata": {k: {v: s.model_dump() for v, s in d.items()} for k, d in o.strata().items()},
                                      "mismatches": mismatch_records(o)}
                           for o in scores}
    if tags is not None:
        data["format_tags"] = format_tag_table(scores, tags)
        if unit_checks is not None:
            data["unit_tags"] = {i: {"tagged": _tag_of(tags, i, "unit"), "against_gold": answer,
                                     "gold": (gold_units or {}).get(i)} for i, answer in sorted(unit_checks.items())}
    if xbrl is not None:
        data["map"] = map_against_gold(xbrl)
    if settled:
        data["settled"] = {o.source: {"summary": o.summary().model_dump()} for o in settled}
    write_text_atomically(md, render_markdown(score, against, generated_at, out_of_scope_reasons, others, others_against, tags,
                                              settled, unit_checks, gold_units))
    write_text_atomically(js, json.dumps(data, ensure_ascii=False, indent=1))
    return md, js
