"""The report: Markdown for people and JSON for the next comparison.

The Markdown holds labels and figures from public filings, which is why a report is a file and never console output.
A rate is a ratio of whole numbers (`Summary.rate`), and so is the change between two of them: it is worked out in
tenths of a percent, with no float.
"""

from datetime import datetime, timezone
import json
from pathlib import Path

from maester_eval.artefacts import read_artefacts, read_run
from maester_eval.gold import read_gold
from maester_eval.scoring import OUTCOMES, RunScore, Summary, score_run

LABELS = {"match": "Exact match", "wrong_value": "Wrong value", "wrong_scale": "Wrong scale",
          "wrong_status": "Wrong status", "ambiguous": "Ambiguous", "missing": "Missing"}
RATES = [("match", "Exact match"), ("wrong_value", "Wrong value"), ("wrong_scale", "Wrong scale"),
         ("wrong_status", "Wrong status"), ("ambiguous", "Ambiguous"), ("missing", "Missing"),
         ("page_match", "Page match"), ("checks_passed", "Checks passed"), ("checks_failed", "Checks failed")]


def score_run_dir(run_dir: Path, gold_dir: Path, manifest_ids: list[str], eval_set: str,
                  out_of_scope: dict[str, str] | None = None) -> RunScore:
    """Score a run folder against the gold set.

    `out_of_scope` maps the ids of the filings a baseline leaves out to the reason. They are never listed as not run."""
    record = read_run(run_dir)
    return score_run(run_dir.name, read_artefacts(run_dir), read_gold(gold_dir), manifest_ids, eval_set,
                     pipeline_version=record.get("pipeline_version"), prompt_version=record.get("prompt_version"),
                     model=record.get("model"), out_of_scope_ids=list(out_of_scope or {}))


def _utc(moment: datetime | None) -> datetime:
    """`moment` in UTC, or now when there is none. A naive time is taken as UTC already, as `EvalPaths.new_run` takes it."""
    if moment is None:
        return datetime.now(timezone.utc)
    if moment.utcoffset() is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


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
    rows += [(LABELS[name], str(getattr(s, name)), s.rate(name)) for name in OUTCOMES]
    rows += [
        ("Page match", f"{s.page_match} of {s.page_checked}", s.rate("page_match")),
        ("Checks passed", str(s.checks_passed), s.rate("checks_passed")),
        ("Checks failed", str(s.checks_failed), s.rate("checks_failed")),
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


def _tenths(rate: str) -> int | None:
    """A rate as `Summary.rate` writes it, such as `66.6%`, in tenths of a percent (666); None for the dash."""
    return None if rate == "—" else int(rate.rstrip("%").replace(".", ""))


def _pp(now: str, before: str) -> str:
    """The change from one rate to another in percentage points, such as `+33.3 pp`; a dash when either has no denominator."""
    a, b = _tenths(now), _tenths(before)
    if a is None or b is None:
        return "—"
    change = a - b
    return f"{'−' if change < 0 else '+'}{abs(change) // 10}.{abs(change) % 10} pp"


def render_markdown(score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None,
                    out_of_scope_reasons: dict[str, str] | None = None) -> str:
    s = score.summary()
    when = _utc(generated_at).strftime("%Y-%m-%d %H:%M UTC")
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
        lines += [f"| {label} | {s.rate(name)} | {a.rate(name)} | {_pp(s.rate(name), a.rate(name))} |" for name, label in RATES]
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
    generated_at = _utc(generated_at)
    md = run_dir / "report.md"
    js = run_dir / "report.json"
    md.write_text(render_markdown(score, against, generated_at, out_of_scope_reasons), encoding="utf-8")
    js.write_text(json.dumps({
        "generated_at": generated_at.isoformat(), "against": against.run if against else None,
        "summary": score.summary().model_dump(), "strata": {k: {v: s.model_dump() for v, s in d.items()} for k, d in score.strata().items()},
        "score": score.model_dump(mode="json"),
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    return md, js
