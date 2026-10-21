"""The `maester-eval` command line.

Console output is filing ids, codes, counts and seconds. Labels, printed values
and figures go only into files under data/eval and the report.

Every command stops the same way: an `EvalError` or an `OSError` becomes its text in red and exit code 1
(`_reports_errors`). Any other exception is a fault of the harness and shows its traceback.
"""

from collections.abc import Callable
from datetime import datetime, timezone
import functools
import json
from pathlib import Path
from typing import Annotated, NoReturn, Optional, ParamSpec, get_args

import typer
from dotenv import load_dotenv
from rich.console import Console

from maester_eval.artefacts import artefact_path, read_artefact, read_artefacts, read_run
from maester_eval.compare import (
    SETTLE_COLUMNS, agreement_tenths, compare_runs, exact_agreement_tenths, settle_rows, write_compare,
)
from maester_eval.concepts import load_taxonomy
from maester_eval.errors import EvalError
from maester_eval.files import write_text_atomically
from maester_eval.gold import (
    SettledRecord, count_unverified, freeze_sheet, gold_of_origin, read_gold, read_gold_filing, read_sheet, write_gold,
)
from maester_eval.manifest import SetChoice, load_manifest, missing_files, tag_values, write_manifest
from maester_eval.paths import DEFAULT
from maester_eval.report import score_run_dir, score_xbrl_run_dir, write_report
from maester_eval.runner import gemini_model_factory, run_live, workflow_settings_from_env
from maester_eval.settle import check_provenance, merge_gold
from maester_eval.sheets import export_run, sheet_path, write_sheet
from maester_eval.scoring import RunScore, rate_text, score_shown
from maester_eval.tags import gold_coverage, gold_units, pick_gold, propose_units, set_tags, unit_against_gold
from maester_eval.xbrl_pair import apply_pairs, check_copies, plan_pairs, read_xbrl_manifest, summary_lines
from maester_eval.xbrl_map import render_markdown, run_xbrl_map
from maester_eval.xbrl_read import run_xbrl
from maester_eval.xbrl_survey import find_instances, survey_instances, write_survey

app = typer.Typer(
    help="Maester evaluation harness: run the extraction workflow over real filings and score it against the gold set.",
    pretty_exceptions_enable=False,
    no_args_is_help=True,
)
# soft_wrap: a path or an id stays on one line, also where no terminal gives a width (`live` in the background).
console = Console(soft_wrap=True)
Params = ParamSpec("Params")
tags_app = typer.Typer(help="The format tags: how a filing prints its figures, and which filings to label first.",
                       pretty_exceptions_enable=False, no_args_is_help=True)
app.add_typer(tags_app, name="tags")


@app.callback()
def _main() -> None:
    load_dotenv()


def _fail(message: str) -> NoReturn:
    console.print(message, style="red", markup=False)
    raise typer.Exit(1)


def _reports_errors(command: Callable[Params, None]) -> Callable[Params, None]:
    """`command`, with an `EvalError` or an `OSError` shown as its text and exit code 1 instead of a traceback.

    The text of an `OSError` names its file and the reason. A failed write is a `WriteError`, `cannot write <path>:
    <reason>`, so what reaches here as an `OSError` is a read, such as a run folder with no `run.json`, or the run
    folder `live` could not make."""
    @functools.wraps(command)
    def wrapper(*args: Params.args, **kwargs: Params.kwargs) -> None:
        try:
            command(*args, **kwargs)
        except (EvalError, OSError) as exc:
            _fail(str(exc))
    return wrapper


def _refuse_xbrl_run(run_dir: Path) -> None:
    """Stops a command that turns a run into labelling sheets or gold: only a PDF run has a PDF's lines to label."""
    if (run_dir / "run.json").is_file() and read_run(run_dir).get("source") == "xbrl":
        _fail(f"{run_dir.name} is an XBRL run; label the PDF run")


def _gate(eval_set: str, gate: bool) -> None:
    """The held-out set is read only to decide whether a change lands. `heldout` and `all` hold it."""
    if eval_set in ("heldout", "all") and not gate:
        _fail("held-out is read only to decide whether a change lands; pass --gate")


def _set_choice(value: str) -> SetChoice:
    """`--set` as the set it names. Any other value stops the command."""
    if value not in get_args(SetChoice):
        _fail("--set must be dev, heldout or all")
    return value  # type: ignore[return-value]


@app.command()
@_reports_errors
def live(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "dev",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    label: Annotated[Optional[str], typer.Option(help="A word for the run folder's name: letters, digits, dot, dash or underscore.")] = None,
    paired: Annotated[bool, typer.Option(
        "--paired", help="Read only the selected filings that have XBRL instances paired with them.")] = False,
) -> None:
    """Read the set's filings with the real model and keep an artefact per filing. Costs model calls.

    With --paired, only the selected filings that `xbrl-pair` paired with XBRL instances are read, so that every filing
    read can be compared with XBRL. It prints `paired: <n> of <m>` before the run."""
    chosen = _set_choice(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    filings = manifest.select(chosen, only)
    if not only:
        left_out = len(manifest.out_of_scope(chosen))
        if left_out:
            console.print(f"left out as out of scope: {left_out}")
    if paired:
        selected = len(filings)
        filings = [f for f in filings if f.xbrl]
        console.print(f"paired: {len(filings)} of {selected}", markup=False)
    absent = missing_files(filings, DEFAULT.corpus)
    if absent:
        _fail("missing under data/eval/corpus: " + ", ".join(absent))
    if not filings:
        _fail("nothing to read: the selection is empty")
    factory = gemini_model_factory()
    settings = workflow_settings_from_env()  # before the run folder exists: a bad setting must not leave an empty one
    run_dir = DEFAULT.new_run(label)
    console.print(f"run {run_dir.name}: {len(filings)} filing(s), set {chosen}", markup=False)
    artefacts = run_live(filings, DEFAULT.corpus, run_dir, factory, settings, chosen,
                         log=lambda line: console.print(line, markup=False))
    read = sum(1 for a in artefacts if a.result)
    console.print(f"done: {read} read, {len(artefacts) - read} failed → {run_dir}", markup=False)


@app.command("xbrl-read")
@_reports_errors
def xbrl_read(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all. The held-out set needs --gate.")] = "dev",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    label: Annotated[str, typer.Option(help="A word for the run folder's name: letters, digits, dot, dash or underscore.")] = "xbrl",
    gate: Annotated[bool, typer.Option(help="Read the held-out set: only to decide whether a change lands.")] = False,
) -> None:
    """Read the XBRL instances paired with each selected results filing into an XBRL run. No model, no cost."""
    chosen = _set_choice(eval_set)
    _gate(chosen, gate)
    filings = [f for f in load_manifest(DEFAULT.manifest).select(chosen, only) if f.xbrl]
    if not filings:
        _fail("nothing to read: no selected filing has XBRL instances")
    absent = [pair.file for f in filings for pair in f.xbrl if not (DEFAULT.corpus / pair.file).is_file()]
    if absent:
        _fail("missing under data/eval/corpus: " + ", ".join(absent))
    run_dir = DEFAULT.new_run(label)
    artefacts = run_xbrl(filings, DEFAULT.corpus, run_dir, chosen, log=lambda line: console.print(line, markup=False))
    console.print(f"done: {len(artefacts)} filing(s) → {run_dir}", markup=False)


@app.command()
@_reports_errors
def export(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    force: Annotated[bool, typer.Option(help="Overwrite a sheet that exists.")] = False,
) -> None:
    """Write a labelling sheet per filing of a run to data/eval/sheets. Never overwrites without --force."""
    run_dir = DEFAULT.resolve_run(run)
    _refuse_xbrl_run(run_dir)
    artefacts = read_artefacts(run_dir)
    if not artefacts:
        _fail("no artefacts in this run")
    missing = set(only or []) - {artefact.filing_id for artefact in artefacts}
    if missing:
        _fail("not in this run: " + ", ".join(sorted(missing)))
    written, skipped = export_run(artefacts, DEFAULT.sheets, only, force)
    for path in written:
        console.print(f"wrote {path.relative_to(DEFAULT.base)}", markup=False)
    for path in skipped:
        console.print(f"kept  {path.relative_to(DEFAULT.base)} (exists; --force to overwrite)", markup=False)
    console.print(f"{len(written)} written, {len(skipped)} kept")


@app.command()
@_reports_errors
def freeze(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    run: Annotated[Optional[str], typer.Option(
        help="Read the machine columns back from the run's artefact (a spreadsheet may have retyped them); a cell you "
             "edited must still agree with it, or the row is refused. The run's record goes into the gold file.")] = None,
    force: Annotated[bool, typer.Option(help="Replace a gold file that exists.")] = False,
) -> None:
    """Turn a checked sheet into data/eval/gold/<filing-id>.json. Only rows marked verified are kept; each needs a concept."""
    filing = load_manifest(DEFAULT.manifest).by_id().get(filing_id)
    if filing is None:
        _fail(f"{filing_id} is not in the manifest")
    run_dir = None if run is None else DEFAULT.resolve_run(run)
    if run_dir is not None:
        _refuse_xbrl_run(run_dir)
    path = sheet_path(DEFAULT.sheets, filing_id)
    if not path.is_file():
        _fail(f"no sheet at {path}; run `maester-eval export` first")
    exported_from = artefact = None
    if run_dir is not None:
        record = read_run(run_dir)
        # The filing's own artefact only: one that cannot be read, of another filing of the run, does not stop this one.
        found = artefact_path(run_dir, filing_id)
        if not found.is_file():
            _fail(f"run {run_dir.name} has no artefact for {filing_id}")
        artefact = read_artefact(found)
        exported_from = {k: record.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
    rows = read_sheet(path)
    # A gold file this replaces keeps the cells the investor settled: they are not on this sheet.
    keep = read_gold_filing(DEFAULT.gold, filing_id) if force else None
    gold = freeze_sheet(rows, filing, load_taxonomy(), datetime.now(timezone.utc), exported_from, artefact, keep)
    written = write_gold(DEFAULT.gold, gold, force)
    shown = written.relative_to(DEFAULT.base)
    console.print(f"froze {len(gold.facts)} fact(s), {len(gold.expected_checks)} expected check(s); "
                  f"{count_unverified(rows)} row(s) not verified → {shown}", markup=False)


@app.command()
@_reports_errors
def settle(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    run: Annotated[str, typer.Option(
        help="The PDF run `compare` ran on: a run folder's name, a path, or `latest` (the latest PDF run).")] = "latest",
) -> None:
    """Add the cells the investor settled to the filing's gold file. Only rows of data/eval/settle marked verified count.

    Each becomes a gold fact of origin `settled`. A cell gold holds already with the same figure is skipped; one with
    another figure stops the command and nothing is written. Held-out gold is sealed."""
    filing = load_manifest(DEFAULT.manifest).by_id().get(filing_id)
    if filing is None:
        _fail(f"{filing_id} is not in the manifest")
    if filing.set == "heldout":
        _fail("held-out gold is sealed")
    run_dir = DEFAULT.resolve_run(run, "pdf")
    compared = run_dir / "compare-xbrl.json"
    if not compared.is_file():
        _fail(f"{run_dir.name} has no compare-xbrl.json; run compare first")
    now = datetime.now(timezone.utc)
    try:
        data = json.loads(compared.read_text(encoding="utf-8"))
        xbrl_run, versions = data["xbrl_run"], data["versions"]
        was_compared = any(f["filing_id"] == filing_id and f["compared"] is True for f in data["filings"])
        record = SettledRecord(pdf_run=run_dir.name, xbrl_run=xbrl_run, map_version=versions["map"],
                               compare_rule=versions["compare_rule"], settled_at=now.isoformat(), facts=0)
    except (ValueError, KeyError, TypeError):  # no text of the file: it holds figures
        _fail(f"{compared} is not a readable compare-xbrl.json; run compare again")
    if not was_compared:
        _fail(f"{run_dir.name}/compare-xbrl.json did not compare {filing_id}; run compare first")
    path = sheet_path(DEFAULT.settle, filing_id)
    if not path.is_file():
        _fail(f"no settle sheet at {path}; run `maester-eval compare` first")
    found = artefact_path(run_dir, filing_id)
    if not found.is_file():
        _fail(f"run {run_dir.name} has no artefact for {filing_id}")
    artefact = read_artefact(found)
    rows = read_sheet(path)
    check_provenance(rows, xbrl_run, record.map_version, f"{run_dir.name}/compare-xbrl.json")
    taken = read_run(run_dir)
    exported_from = {k: taken.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
    frozen = freeze_sheet(rows, filing, load_taxonomy(), now, exported_from, artefact)
    existing = read_gold_filing(DEFAULT.gold, filing_id)
    merged, skipped = merge_gold(existing, frozen, record)
    written = write_gold(DEFAULT.gold, merged, force=existing is not None)
    console.print(f"settled {len(merged.facts) - (len(existing.facts) if existing else 0)} fact(s) into "
                  f"{written.relative_to(DEFAULT.base)}; {skipped} already in gold", markup=False)


def _resolve_runs(names: list[str]) -> dict[str, tuple[Path, dict]]:
    """Each named run's folder and record, by the source its `run.json` names (a run with none is a PDF run).

    `latest` is the latest PDF run. A named run may be of any source, but two of one source are refused: a report
    holds one run per source."""
    found: dict[str, tuple[Path, dict]] = {}
    for name in names:
        run_dir = DEFAULT.resolve_run(name, "pdf") if name == "latest" else DEFAULT.resolve_run(name)
        record = read_run(run_dir)
        source = record.get("source") or "pdf"
        if source in found:
            _fail(f"two {source} runs; name one run per source")
        found[source] = (run_dir, record)
    return found


@app.command()
@_reports_errors
def report(
    run: Annotated[Optional[list[str]], typer.Option(
        help="A run folder's name, a path, or `latest` (the latest PDF run). Repeat it for a run of another source: one per "
             "source, and a PDF run among them. The files go into the first run's folder.")] = None,
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "all",
    against: Annotated[Optional[list[str]], typer.Option(
        help="An earlier run to show the change against; repeat it for each source.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-16-baseline.md.")] = None,
) -> None:
    """Score runs against the gold set; write report.md and report.json into the first run's folder.

    A PDF run alone gives the phase 0 report. With an XBRL run too, the report adds the XBRL figures, the `shown` mix of
    the two, and the figures by source, by format tag and for the element map. Facts frozen from settled disagreements
    are scored apart. Every headline is scored on the gold a person labelled from a sheet."""
    chosen = _set_choice(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    ids = [f.id for f in manifest.filings]
    out_of_scope = {f.id: f.out_of_scope or "" for f in manifest.out_of_scope(chosen)}
    names = run or ["latest"]
    runs = _resolve_runs(names)
    earlier_runs = _resolve_runs(against) if against else {}
    if "pdf" not in runs:
        _fail("name a pdf run: the report is made on the PDF run")
    for source, (earlier_dir, _) in earlier_runs.items():
        if source not in runs:
            _fail(f"{earlier_dir.name} is {source}, but no {source} run is scored; add --run for it")
    first_dir = next(iter(runs.values()))[0]  # `runs` keeps the order of `--run`
    gold = read_gold(DEFAULT.gold)
    sheet, settled_view = gold_of_origin(gold, "sheet"), gold_of_origin(gold, "settled")
    in_set = {f.id: f for f in (*manifest.select(chosen), *manifest.out_of_scope(chosen))}
    settled_facts = sum(len(g.facts) for g in settled_view.values() if chosen == "all" or g.set == chosen)

    def scored(source: str, run_dir: Path, view: dict) -> RunScore:
        if source == "xbrl":
            return score_xbrl_run_dir(run_dir, view, ids, chosen, out_of_scope)
        return score_run_dir(run_dir, view, ids, chosen, out_of_scope)

    pdf_dir = runs["pdf"][0]
    score = scored("pdf", pdf_dir, sheet)
    # A filing with settled facts only has gold; it is scored apart, so the headline does not call it "no gold yet".
    score = score.model_copy(update={"gold_missing": [i for i in score.gold_missing if i not in settled_view]})
    others: list[RunScore] = []
    xbrl_score = None
    if "xbrl" in runs:
        xbrl_score = scored("xbrl", runs["xbrl"][0], sheet)
        others.append(xbrl_score)
        others.append(score_shown(sheet, score, xbrl_score, read_artefacts(pdf_dir), read_artefacts(runs["xbrl"][0])))
    # The earlier runs are read and scored before anything is written, on the gold set as it is now.
    earlier = {source: scored(source, d, sheet) for source, (d, _) in earlier_runs.items()}
    others_against = [earlier["xbrl"]] if "xbrl" in earlier else []
    if xbrl_score is not None and earlier.keys() & {"pdf", "xbrl"}:
        before_pdf, before_xbrl = earlier.get("pdf", score), earlier.get("xbrl", xbrl_score)
        before_pdf_dir, before_xbrl_dir = earlier_runs.get("pdf", runs["pdf"])[0], earlier_runs.get("xbrl", runs["xbrl"])[0]
        others_against.append(score_shown(sheet, before_pdf, before_xbrl, read_artefacts(before_pdf_dir),
                                          read_artefacts(before_xbrl_dir)))
    settled = []
    if settled_facts:
        settled = [scored(source, d, settled_view) for source, (d, _) in runs.items()]
    taxonomy = load_taxonomy()
    tags = {i: tag_values(f) for i, f in in_set.items()}
    unit_checks = {i: unit_against_gold(in_set[i], g, taxonomy) for i, g in sheet.items() if i in in_set}
    units = {i: gold_units(sheet[i], taxonomy) for i, answer in unit_checks.items() if answer in ("disagrees", "mixed")}
    extended = bool(others) or bool(settled)
    md, _ = write_report(first_dir, score, earlier.get("pdf"), out_of_scope_reasons=out_of_scope,
                         others=others or None, others_against=others_against or None, tags=tags if extended else None,
                         settled=settled or None, unit_checks=unit_checks if extended else None, gold_units=units)
    s = score.summary()
    console.print(f"{pdf_dir.name} ({chosen}): {s.filings} filing(s), {s.gold_facts} gold fact(s), "
                  f"exact match {s.rate('match')}, missing {s.rate('missing')}", markup=False)
    if others:
        for each in (score, *others):
            console.print(f"{each.source}: {each.summary().gold_facts} gold fact(s), exact match {each.summary().rate('match')}",
                          markup=False)
    if settled:
        console.print(f"settled: {settled_facts} gold fact(s), scored apart", markup=False)
    if score.not_run or score.gold_missing:
        console.print(f"not run: {len(score.not_run)}; no gold yet: {len(score.gold_missing)}", markup=False)
    if score.out_of_scope:
        console.print(f"out of scope: {len(score.out_of_scope)}", markup=False)
    console.print(f"report → {md}", markup=False)
    if to is not None:
        write_text_atomically(to, md.read_text(encoding="utf-8"))
        console.print(f"published → {to}", markup=False)


@app.command()
@_reports_errors
def compare(
    run: Annotated[str, typer.Option(help="The PDF run: a run folder's name, a path, or `latest` (the latest PDF run).")] = "latest",
    xbrl: Annotated[str, typer.Option(help="The XBRL run: a run folder's name, a path, or `latest` (the latest XBRL run).")] = "latest",
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all. The held-out set needs --gate.")] = "dev",
    gate: Annotated[bool, typer.Option(help="Compare the held-out set: only to decide whether a change lands.")] = False,
    against: Annotated[Optional[list[str]], typer.Option(
        help="An earlier run to show the change against, in place of the run of its source; repeat it for each source.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-21-compare.md.")] = None,
    force: Annotated[bool, typer.Option(help="Overwrite a settle sheet that exists.")] = False,
) -> None:
    """Set Gemini against XBRL, cell by cell, on every selected results filing that has both. No model, no cost.

    Writes compare-xbrl.md and compare-xbrl.json into the PDF run's folder, and a settle sheet per dev filing with a
    disagreement to data/eval/settle. A settle sheet that exists is a person's work: kept unless --force. A held-out
    filing never gets one."""
    chosen = _set_choice(eval_set)
    _gate(chosen, gate)
    pdf_dir = DEFAULT.resolve_run(run, "pdf")
    xbrl_dir = DEFAULT.resolve_run(xbrl, "xbrl")
    earlier_runs = _resolve_runs(against) if against else {}
    manifest = load_manifest(DEFAULT.manifest)
    taxonomy = load_taxonomy()
    generated_at = datetime.now(timezone.utc)

    def compared(pdf_run: Path, xbrl_run: Path):
        return compare_runs(read_artefacts(pdf_run), read_artefacts(xbrl_run), manifest, DEFAULT.sheets, taxonomy, chosen,
                            pdf_run.name, xbrl_run.name, read_run(xbrl_run), generated_at)

    pdf_artefacts = {a.filing_id: a for a in read_artefacts(pdf_dir)}
    result = compared(pdf_dir, xbrl_dir)
    earlier = None
    if earlier_runs:
        # Each earlier run in place of its source, compared on today's sheets, before anything is written.
        earlier = compared(earlier_runs.get("pdf", (pdf_dir, {}))[0], earlier_runs.get("xbrl", (xbrl_dir, {}))[0])
    md, _ = write_compare(pdf_dir, result, earlier)
    written = kept = 0
    for filing in result.filings:
        if filing.set != "dev" or not filing.compared:
            continue
        rows = settle_rows(filing, pdf_artefacts[filing.filing_id], result.xbrl_run, result.versions["map"])
        if not rows:
            continue
        path = sheet_path(DEFAULT.settle, filing.filing_id)
        if path.exists() and not force:
            kept += 1
            continue
        write_sheet(path, rows, columns=SETTLE_COLUMNS)
        written += 1
    counts = result.counts()
    done = sum(1 for f in result.filings if f.compared)
    console.print(f"compared {done} filing(s), not compared {len(result.filings) - done}", markup=False)
    agree = counts["agree"] + counts["agree_at_precision"] + counts["agree_dash_zero"]
    disagree = counts["disagree_value"] + counts["disagree_scale"] + counts["disagree_status"]
    console.print(f"cells: agree {agree}, disagree {disagree}, sign only {counts['disagree_sign']}, "
                  f"instances differ {counts['instances_differ']}, PDF only {counts['pdf_only']}, "
                  f"XBRL only {counts['xbrl_only']}, unlabelled {counts['unlabelled']}, "
                  f"span unknown {counts['span_unknown']}, not read {counts['not_read']}", markup=False)
    console.print(f"agreement {rate_text(agreement_tenths(counts))}, exact {rate_text(exact_agreement_tenths(counts))}",
                  markup=False)
    console.print(f"settle sheets: {written} written, {kept} kept", markup=False)
    console.print(f"compare → {md}", markup=False)
    if to is not None:
        write_text_atomically(to, md.read_text(encoding="utf-8"))
        console.print(f"published → {to}", markup=False)


@app.command("xbrl-elements")
@_reports_errors
def xbrl_elements(
    instances: Annotated[Path, typer.Option(help="A folder of XBRL instances; every .xml under it is read.")],
    out: Annotated[Path, typer.Option(help="Where the CSVs go, e.g. data/eval/xbrl/ (ignored by version control).")],
) -> None:
    """List the numeric elements each XBRL format holds, as element names and counts only (never a value)."""
    survey = survey_instances(find_instances(instances))
    for format_id in sorted(survey.formats):
        console.print(f"{format_id}: {survey.formats[format_id]}", markup=False)
    console.print(f"no format: {survey.no_format}", markup=False)
    console.print(f"unreadable: {sum(survey.unreadable.values())}", markup=False)
    for reason in sorted(survey.unreadable):
        console.print(f"  {reason}: {survey.unreadable[reason]}", markup=False)
    for path in write_survey(survey, out):
        console.print(f"wrote {path}", markup=False)
    console.print(f"{survey.files} file(s) read", markup=False)


@app.command("xbrl-pair")
@_reports_errors
def xbrl_pair(
    xbrl_manifest: Annotated[Path, typer.Option(help="The investor's xbrl-manifest.csv.")],
    source: Annotated[Path, typer.Option("--from", help="The folder the CSV's file paths are relative to.")],
    dry_run: Annotated[bool, typer.Option(help="Check and count; copy nothing and write nothing.")] = False,
) -> None:
    """Pair each results filing with the XBRL instances BSE filed for it and copy them into the corpus."""
    manifest = load_manifest(DEFAULT.manifest)
    plan = plan_pairs(manifest, read_xbrl_manifest(xbrl_manifest))
    if dry_run:
        copies = check_copies(manifest, plan, source, DEFAULT.corpus)
    else:
        paired, copied = apply_pairs(manifest, plan, source, DEFAULT.corpus)
        write_manifest(DEFAULT.manifest, paired)
    for line in summary_lines(manifest, plan):
        console.print(line, markup=False)
    if dry_run:
        console.print(f"dry run: {sum(1 for c in copies if c.needed)} instance(s) would be copied; nothing written",
                      markup=False)
    else:
        console.print(f"copied {copied} instance(s) into the corpus; manifest written", markup=False)


def _one_set(value: str) -> SetChoice:
    """`--set` as dev or heldout. `all` is refused: a pick or a count over both sets would mix them."""
    if value not in ("dev", "heldout"):
        _fail("--set must be dev or heldout")
    return value  # type: ignore[return-value]


def _ids(ids: list[str]) -> str:
    return f"{len(ids)} ({', '.join(ids)})" if ids else "0"


@tags_app.command("propose")
@_reports_errors
def tags_propose(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "all",
) -> None:
    """Set each results filing's unit from the rounding its XBRL instances declare. The investor's units stay."""
    chosen = _set_choice(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    proposal = propose_units(manifest, chosen, DEFAULT.corpus)
    if proposal.manifest != manifest:
        write_manifest(DEFAULT.manifest, proposal.manifest)
    console.print(f"unit from XBRL: {len(proposal.set)}", markup=False)
    console.print(f"instances disagree: {_ids(proposal.disagree)}", markup=False)
    console.print(f"no rounding: {_ids(proposal.no_rounding)}", markup=False)
    console.print(f"no instance: {len(proposal.no_instance)}", markup=False)
    console.print(f"unreadable: {len(proposal.unreadable)}", markup=False)


@tags_app.command("set")
@_reports_errors
def tags_set(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    unit: Annotated[Optional[str], typer.Option(help="crore, lakh, million, thousand or rupees.")] = None,
    brackets: Annotated[Optional[str], typer.Option(help="yes or no: negatives are printed in brackets.")] = None,
    restated: Annotated[Optional[str], typer.Option(help="yes or no: the filing restates earlier columns.")] = None,
) -> None:
    """Set a filing's tags as the investor reads them. A unit set here is never overwritten by `tags propose`."""
    manifest = set_tags(load_manifest(DEFAULT.manifest), filing_id, unit, brackets, restated)
    write_manifest(DEFAULT.manifest, manifest)
    tags = manifest.by_id()[filing_id].tags
    assert tags is not None
    console.print(f"{filing_id}: " + ", ".join(
        f"{name} {word}" for name, word in (
            ("unit", tags.unit), ("brackets", None if tags.negatives_in_brackets is None
                                  else "yes" if tags.negatives_in_brackets else "no"),
            ("restated", None if tags.restated_columns is None else "yes" if tags.restated_columns else "no"))
        if word is not None), markup=False)


@tags_app.command("pick")
@_reports_errors
def tags_pick(
    eval_set: Annotated[str, typer.Option("--set", help="dev or heldout.")] = "dev",
    count: Annotated[int, typer.Option(help="How many filings, 10 to 15.")] = 12,
    include: Annotated[Optional[list[str]], typer.Option("--include", help="A filing id to take first; repeatable.")] = None,
    exclude: Annotated[Optional[list[str]], typer.Option("--exclude", help="A filing id never to take; repeatable.")] = None,
) -> None:
    """Pick the filings to label first, so that every tag value has one. Writes nothing."""
    chosen = _one_set(eval_set)
    if not 10 <= count <= 15:
        _fail("--count must be 10 to 15")
    manifest = load_manifest(DEFAULT.manifest)
    result = pick_gold([f for f in manifest.filings if f.set == chosen], count, include=include or [],
                       exclude=exclude or [])
    for number, (filing_id, pairs) in enumerate(zip(result.picked, result.advanced), start=1):
        console.print(f"{number}. {filing_id}  " + " ".join(f"{d}={v}" for d, v in pairs), markup=False)
    if result.unmet:
        console.print("unmet: " + ", ".join(f"{d}={v} short by {n}" for d, v, n in result.unmet), markup=False)
    else:
        console.print("every requirement met")


@tags_app.command("coverage")
@_reports_errors
def tags_coverage(
    eval_set: Annotated[str, typer.Option("--set", help="dev or heldout.")] = "dev",
) -> None:
    """Count the gold filings and gold facts by tag value, and check the unit tag against the gold's scales."""
    chosen = _one_set(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    filings = manifest.select(chosen)
    gold = gold_of_origin(read_gold(DEFAULT.gold), "sheet")
    by_id = {f.id: f for f in filings}
    for dimension, values in gold_coverage(filings, gold).items():
        for value, (held, facts) in values.items():
            console.print(f"{dimension} {value}: {held} gold filing(s), {facts} gold fact(s)", markup=False)
    held = [by_id[i] for i in gold if i in by_id]
    for dimension, name in (("unit", "unit"), ("brackets", "brackets"), ("restated", "restated")):
        untagged = [f.id for f in held if tag_values(f)[dimension] == "not tagged"]
        if untagged:
            console.print(f"gold filings not tagged: {name} {_ids(untagged)}", markup=False)
    taxonomy = load_taxonomy()
    outcomes: dict[str, list[str]] = {}
    for filing in held:
        outcomes.setdefault(unit_against_gold(filing, gold[filing.id], taxonomy), []).append(filing.id)

    def said(outcome: str, words: str, with_ids: bool = False) -> str:
        ids = outcomes.get(outcome, [])
        return f"{len(ids)} {words}" + (f" ({', '.join(ids)})" if with_ids and ids else "")
    console.print("unit tag against gold: " + ", ".join((
        said("agrees", "agree"), said("disagrees", "disagree", True), said("mixed", "mixed", True),
        said("no_monetary_gold", "no monetary gold"), said("not_tagged", "not tagged"))), markup=False)


@app.command("xbrl-map")
@_reports_errors
def xbrl_map(
    instances: Annotated[Path, typer.Option(help="A folder of XBRL instances; every .xml under it is read.")],
    manifest: Annotated[Optional[Path], typer.Option(help="xbrl-manifest.csv (bse_code, filed, file): says which BSE code and day an instance has.")] = None,
    pdfs: Annotated[Optional[Path], typer.Option(help="The folder the manifests' file paths start from. With --pdf-manifest it switches on the paired-PDF run of `xbrl_in_pdf`.")] = None,
    pdf_manifest: Annotated[Optional[Path], typer.Option(help="manifest.csv (bse_code, date, category, subcategory, status, file): the results PDFs.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-21-xbrl-map-v1.md.")] = None,
    against: Annotated[Optional[Path], typer.Option(help="An earlier report.json to show the change in each count against.")] = None,
) -> None:
    """Run the XBRL element maps, and with --pdfs the `xbrl_in_pdf` check, over a folder of instances. Offline, no model call.

    Writes report.json and report.md into data/eval/runs/<time>-xbrl-map/: element names, ids and counts, never a value."""
    earlier = None
    if against is not None:
        try:
            earlier = json.loads(against.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            _fail(f"{against} is not a readable report.json")
    report_data = run_xbrl_map(instances, manifest, pdfs, pdf_manifest)
    run_dir = DEFAULT.new_run("xbrl-map")
    text = render_markdown(report_data, run_dir.name, earlier, against.name if against is not None else None)
    write_text_atomically(run_dir / "report.json", json.dumps(report_data, indent=2, sort_keys=True) + "\n")
    write_text_atomically(run_dir / "report.md", text)
    files = report_data["files"]
    console.print(f"{run_dir.name}: {files['read']} of {files['found']} file(s) read, {files['unreadable_total']} unreadable", markup=False)
    console.print(f"report → {run_dir / 'report.md'}", markup=False)
    if to is not None:
        write_text_atomically(to, text)
        console.print(f"published → {to}", markup=False)
