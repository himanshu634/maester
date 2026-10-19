"""The `maester-eval` command line.

Console output is filing ids, codes, counts and seconds. Labels, printed values
and figures go only into files under data/eval and the report.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, NoReturn, Optional, get_args

import typer
from dotenv import load_dotenv
from rich.console import Console

from maester_eval.artefacts import ArtefactReadError, artefact_path, read_artefact, read_artefacts, read_run
from maester_eval.concepts import load_taxonomy
from maester_eval.files import write_text_atomically
from maester_eval.gold import FreezeError, GoldError, count_unverified, freeze_sheet, read_gold, read_sheet, write_gold
from maester_eval.manifest import ManifestError, SetChoice, load_manifest, missing_files
from maester_eval.paths import DEFAULT
from maester_eval.report import score_run_dir, write_report
from maester_eval.runner import EvalConfigError, gemini_model_factory, run_live, workflow_settings_from_env
from maester_eval.sheets import export_run, sheet_path

app = typer.Typer(
    help="Maester evaluation harness: run the extraction workflow over real filings and score it against the gold set.",
    pretty_exceptions_enable=False,
    no_args_is_help=True,
)
# soft_wrap: a path or an id stays on one line, also where no terminal gives a width (`live` in the background).
console = Console(soft_wrap=True)


@app.callback()
def _main() -> None:
    load_dotenv()


def _fail(message: str) -> NoReturn:
    console.print(message, style="red", markup=False)
    raise typer.Exit(1)


def _set_choice(value: str) -> SetChoice:
    """`--set` as the set it names. Any other value stops the command."""
    if value not in get_args(SetChoice):
        _fail("--set must be dev, heldout or all")
    return value  # type: ignore[return-value]


@app.command()
def live(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "dev",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    label: Annotated[Optional[str], typer.Option(help="A word for the run folder's name: letters, digits, dot, dash or underscore.")] = None,
) -> None:
    """Read the set's filings with the real model and keep an artefact per filing. Costs model calls."""
    chosen = _set_choice(eval_set)
    try:
        manifest = load_manifest(DEFAULT.manifest)
        filings = manifest.select(chosen, only)
    except ManifestError as exc:
        _fail(str(exc))
    if not only:
        left_out = len(manifest.out_of_scope(chosen))
        if left_out:
            console.print(f"left out as out of scope: {left_out}")
    absent = missing_files(filings, DEFAULT.corpus)
    if absent:
        _fail("missing under data/eval/corpus: " + ", ".join(absent))
    if not filings:
        _fail("nothing to read: the selection is empty")
    try:
        factory = gemini_model_factory()
        settings = workflow_settings_from_env()  # before the run folder exists: a bad setting must not leave an empty one
    except EvalConfigError as exc:
        _fail(str(exc))
    try:
        run_dir = DEFAULT.new_run(label)
    except ValueError as exc:
        _fail(str(exc))
    console.print(f"run {run_dir.name}: {len(filings)} filing(s), set {chosen}", markup=False)
    artefacts = run_live(filings, DEFAULT.corpus, run_dir, factory, settings, chosen,
                         log=lambda line: console.print(line, markup=False))
    read = sum(1 for a in artefacts if a.result)
    console.print(f"done: {read} read, {len(artefacts) - read} failed → {run_dir}", markup=False)


@app.command()
def export(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    force: Annotated[bool, typer.Option(help="Overwrite a sheet that exists.")] = False,
) -> None:
    """Write a labelling sheet per filing of a run to data/eval/sheets. Never overwrites without --force."""
    try:
        run_dir = DEFAULT.resolve_run(run)
        artefacts = read_artefacts(run_dir)
    except (FileNotFoundError, ArtefactReadError) as exc:
        _fail(str(exc))
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
def freeze(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    run: Annotated[Optional[str], typer.Option(
        help="Read the machine columns back from the run's artefact (a spreadsheet may have retyped them); a cell you "
             "edited must still agree with it, or the row is refused. The run's record goes into the gold file.")] = None,
    force: Annotated[bool, typer.Option(help="Replace a gold file that exists.")] = False,
) -> None:
    """Turn a checked sheet into data/eval/gold/<filing-id>.json. Only rows marked verified are kept; each needs a concept."""
    try:
        filing = load_manifest(DEFAULT.manifest).by_id().get(filing_id)
    except ManifestError as exc:
        _fail(str(exc))
    if filing is None:
        _fail(f"{filing_id} is not in the manifest")
    path = sheet_path(DEFAULT.sheets, filing_id)
    if not path.is_file():
        _fail(f"no sheet at {path}; run `maester-eval export` first")
    exported_from = artefact = None
    if run is not None:
        try:
            run_dir = DEFAULT.resolve_run(run)
            record = read_run(run_dir)
        except (FileNotFoundError, ArtefactReadError) as exc:
            _fail(str(exc))
        # The filing's own artefact only: one that cannot be read, of another filing of the run, does not stop this one.
        found = artefact_path(run_dir, filing_id)
        if not found.is_file():
            _fail(f"run {run_dir.name} has no artefact for {filing_id}")
        try:
            artefact = read_artefact(found)
        except ArtefactReadError as exc:
            _fail(str(exc))
        exported_from = {k: record.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
    try:
        rows = read_sheet(path)
        gold = freeze_sheet(rows, filing, load_taxonomy(), datetime.now(timezone.utc), exported_from, artefact)
        written = write_gold(DEFAULT.gold, gold, force)
    except (FreezeError, FileExistsError) as exc:
        _fail(str(exc))
    shown = written.relative_to(DEFAULT.base)
    console.print(f"froze {len(gold.facts)} fact(s), {len(gold.expected_checks)} expected check(s); "
                  f"{count_unverified(rows)} row(s) not verified → {shown}", markup=False)


@app.command()
def report(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "all",
    against: Annotated[Optional[str], typer.Option(help="An earlier run to show the change against.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-16-baseline.md.")] = None,
) -> None:
    """Score a run against the gold set; write report.md and report.json into the run folder."""
    chosen = _set_choice(eval_set)
    try:
        manifest = load_manifest(DEFAULT.manifest)
        ids = [f.id for f in manifest.filings]
        out_of_scope = {f.id: f.out_of_scope or "" for f in manifest.out_of_scope(chosen)}
        run_dir = DEFAULT.resolve_run(run)
        gold = read_gold(DEFAULT.gold)
        score = score_run_dir(run_dir, gold, ids, chosen, out_of_scope)
        # The earlier run is read and scored before anything is written, and against the gold set as it is now.
        earlier = None if against is None else score_run_dir(DEFAULT.resolve_run(against), gold, ids, chosen, out_of_scope)
    except (ManifestError, FileNotFoundError, ArtefactReadError, GoldError) as exc:
        _fail(str(exc))
    try:
        md, _ = write_report(run_dir, score, earlier, out_of_scope_reasons=out_of_scope)
    except OSError as exc:
        _fail(f"cannot write {exc.filename or run_dir}: {exc.strerror or exc}")
    s = score.summary()
    console.print(f"{run_dir.name} ({chosen}): {s.filings} filing(s), {s.gold_facts} gold fact(s), "
                  f"exact match {s.rate('match')}, missing {s.rate('missing')}", markup=False)
    if score.not_run or score.gold_missing:
        console.print(f"not run: {len(score.not_run)}; no gold yet: {len(score.gold_missing)}", markup=False)
    if score.out_of_scope:
        console.print(f"out of scope: {len(score.out_of_scope)}", markup=False)
    console.print(f"report → {md}", markup=False)
    if to is not None:
        try:
            write_text_atomically(to, md.read_text(encoding="utf-8"))
        except OSError as exc:
            _fail(f"cannot write {to}: {exc.strerror or exc}")
        console.print(f"published → {to}", markup=False)
