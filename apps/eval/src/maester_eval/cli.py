"""The `maester-eval` command line.

Console output is filing ids, codes, counts and seconds. Labels, printed values
and figures go only into files under data/eval and the report.

Every command stops the same way: an `EvalError` or an `OSError` becomes its text in red and exit code 1
(`_reports_errors`). Any other exception is a fault of the harness and shows its traceback.
"""

from collections.abc import Callable
from datetime import datetime, timezone
import functools
from pathlib import Path
from typing import Annotated, NoReturn, Optional, ParamSpec, get_args

import typer
from dotenv import load_dotenv
from rich.console import Console

from maester_eval.artefacts import artefact_path, read_artefact, read_artefacts, read_run
from maester_eval.concepts import load_taxonomy
from maester_eval.errors import EvalError
from maester_eval.files import write_text_atomically
from maester_eval.gold import count_unverified, freeze_sheet, read_gold, read_sheet, write_gold
from maester_eval.manifest import SetChoice, load_manifest, missing_files
from maester_eval.paths import DEFAULT
from maester_eval.report import score_run_dir, write_report
from maester_eval.runner import gemini_model_factory, run_live, workflow_settings_from_env
from maester_eval.sheets import export_run, sheet_path
from maester_eval.xbrl_survey import find_instances, survey_instances, write_survey

app = typer.Typer(
    help="Maester evaluation harness: run the extraction workflow over real filings and score it against the gold set.",
    pretty_exceptions_enable=False,
    no_args_is_help=True,
)
# soft_wrap: a path or an id stays on one line, also where no terminal gives a width (`live` in the background).
console = Console(soft_wrap=True)
Params = ParamSpec("Params")


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
) -> None:
    """Read the set's filings with the real model and keep an artefact per filing. Costs model calls."""
    chosen = _set_choice(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    filings = manifest.select(chosen, only)
    if not only:
        left_out = len(manifest.out_of_scope(chosen))
        if left_out:
            console.print(f"left out as out of scope: {left_out}")
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


@app.command()
@_reports_errors
def export(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    force: Annotated[bool, typer.Option(help="Overwrite a sheet that exists.")] = False,
) -> None:
    """Write a labelling sheet per filing of a run to data/eval/sheets. Never overwrites without --force."""
    artefacts = read_artefacts(DEFAULT.resolve_run(run))
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
    path = sheet_path(DEFAULT.sheets, filing_id)
    if not path.is_file():
        _fail(f"no sheet at {path}; run `maester-eval export` first")
    exported_from = artefact = None
    if run is not None:
        run_dir = DEFAULT.resolve_run(run)
        record = read_run(run_dir)
        # The filing's own artefact only: one that cannot be read, of another filing of the run, does not stop this one.
        found = artefact_path(run_dir, filing_id)
        if not found.is_file():
            _fail(f"run {run_dir.name} has no artefact for {filing_id}")
        artefact = read_artefact(found)
        exported_from = {k: record.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
    rows = read_sheet(path)
    gold = freeze_sheet(rows, filing, load_taxonomy(), datetime.now(timezone.utc), exported_from, artefact)
    written = write_gold(DEFAULT.gold, gold, force)
    shown = written.relative_to(DEFAULT.base)
    console.print(f"froze {len(gold.facts)} fact(s), {len(gold.expected_checks)} expected check(s); "
                  f"{count_unverified(rows)} row(s) not verified → {shown}", markup=False)


@app.command()
@_reports_errors
def report(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "all",
    against: Annotated[Optional[str], typer.Option(help="An earlier run to show the change against.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-16-baseline.md.")] = None,
) -> None:
    """Score a run against the gold set; write report.md and report.json into the run folder."""
    chosen = _set_choice(eval_set)
    manifest = load_manifest(DEFAULT.manifest)
    ids = [f.id for f in manifest.filings]
    out_of_scope = {f.id: f.out_of_scope or "" for f in manifest.out_of_scope(chosen)}
    run_dir = DEFAULT.resolve_run(run)
    gold = read_gold(DEFAULT.gold)
    score = score_run_dir(run_dir, gold, ids, chosen, out_of_scope)
    # The earlier run is read and scored before anything is written, and against the gold set as it is now.
    earlier = None if against is None else score_run_dir(DEFAULT.resolve_run(against), gold, ids, chosen, out_of_scope)
    md, _ = write_report(run_dir, score, earlier, out_of_scope_reasons=out_of_scope)
    s = score.summary()
    console.print(f"{run_dir.name} ({chosen}): {s.filings} filing(s), {s.gold_facts} gold fact(s), "
                  f"exact match {s.rate('match')}, missing {s.rate('missing')}", markup=False)
    if score.not_run or score.gold_missing:
        console.print(f"not run: {len(score.not_run)}; no gold yet: {len(score.gold_missing)}", markup=False)
    if score.out_of_scope:
        console.print(f"out of scope: {len(score.out_of_scope)}", markup=False)
    console.print(f"report → {md}", markup=False)
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
