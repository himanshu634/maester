"""The report: Markdown for people and JSON for the next comparison.

The Markdown holds labels and figures from public filings, which is why a report is a file and never console output.
A rate is a ratio of whole numbers (`Summary.rate`), and so is the change between two of them: it is worked out in
tenths of a percent, with no float.
"""

from datetime import datetime
import json
from pathlib import Path

from maester_eval.artefacts import read_artefacts, read_run
from maester_eval.files import write_text_atomically
from maester_eval.gold import GoldFiling
from maester_eval.paths import to_utc
from maester_eval.scoring import RunScore, Summary, score_run

LABELS = {"match": "Exact match", "wrong_value": "Wrong value", "wrong_scale": "Wrong scale",
          "wrong_status": "Wrong status", "ambiguous": "Ambiguous", "missing": "Missing"}
RATES = [*LABELS.items(), ("page_match", "Page match"), ("checks_passed", "Checks passed"), ("checks_failed", "Checks failed")]


def score_run_dir(run_dir: Path, gold: dict[str, GoldFiling], manifest_ids: list[str], eval_set: str,
                  out_of_scope: dict[str, str] | None = None) -> RunScore:
    """Score a run folder against the gold set (`read_gold`).

    `out_of_scope` maps the ids of the filings a baseline leaves out to the reason. They are never listed as not run."""
    record = read_run(run_dir)
    return score_run(run_dir.name, read_artefacts(run_dir), gold, manifest_ids, eval_set,
                     pipeline_version=record.get("pipeline_version"), prompt_version=record.get("prompt_version"),
                     model=record.get("model"), out_of_scope_ids=list(out_of_scope or {}))


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


def _pp(now: Summary, before: Summary, name: str) -> str:
    """The change in a rate from one run to another in percentage points, such as `+33.3 pp`; a dash when either has no denominator."""
    a, b = now.tenths(name), before.tenths(name)
    if a is None or b is None:
        return "—"
    change = a - b
    return f"{'−' if change < 0 else '+'}{abs(change) // 10}.{abs(change) % 10} pp"


def render_markdown(score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None,
                    out_of_scope_reasons: dict[str, str] | None = None) -> str:
    s = score.summary()
    when = to_utc(generated_at).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# Evaluation report: {score.run}", "",
        f"Set `{score.eval_set}` · {when} · pipeline {_code(score.pipeline_version)} · prompt {_code(score.prompt_version)}"
        f" · model {_code(score.model)}.",
        "", "An exact match means value, sign, scale, basis and period all agree with the gold set. Rates are over the gold facts of the scored filings.", "",
        "## Summary", "", *_summary_table(s), "",
    ]
    if against is not None:
        a = against.summary()
        lines += [f"## Against {against.run}", "", "| Rate | This run | Earlier | Change |", "| --- | --- | --- | --- |"]
        lines += [f"| {label} | {s.rate(name)} | {a.rate(name)} | {_pp(s, a, name)} |" for name, label in RATES]
        lines.append("")
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
    mismatches = [(f.filing_id, x) for f in score.filings for x in f.facts if x.outcome != "match"]
    lines += ["## Mismatches", ""]
    if not mismatches:
        lines.append("None.")
    else:
        lines += ["| Filing | Statement | Basis | Label | Period | Outcome | Gold | Read |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for filing_id, x in mismatches:
            lines.append(_row([filing_id, x.statement, x.basis, x.label, x.period_label, x.outcome, x.gold_printed, x.read_printed]))
    return "\n".join(lines) + "\n"


def write_report(run_dir: Path, score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None,
                 out_of_scope_reasons: dict[str, str] | None = None) -> tuple[Path, Path]:
    generated_at = to_utc(generated_at)
    md = run_dir / "report.md"
    js = run_dir / "report.json"
    write_text_atomically(md, render_markdown(score, against, generated_at, out_of_scope_reasons))
    write_text_atomically(js, json.dumps({
        "generated_at": generated_at.isoformat(), "against": against.run if against else None,
        "summary": score.summary().model_dump(), "strata": {k: {v: s.model_dump() for v, s in d.items()} for k, d in score.strata().items()},
        "score": score.model_dump(mode="json"),
    }, ensure_ascii=False, indent=1))
    return md, js
