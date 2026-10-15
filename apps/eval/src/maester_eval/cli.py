"""The `maester-eval` command line.

Console output is filing ids, codes, counts and seconds. Labels, printed values
and figures go only into files under data/eval and the report.
"""

import typer
from dotenv import load_dotenv
from rich.console import Console

app = typer.Typer(
    help="Maester evaluation harness: run the extraction workflow over real filings and score it against the gold set.",
    pretty_exceptions_enable=False,
    no_args_is_help=True,
)
console = Console()


@app.callback()
def _main() -> None:
    load_dotenv()


from typing import Annotated, Optional

from maester_eval.manifest import ManifestError, load_manifest
from maester_eval.paths import DEFAULT
from maester_eval.runner import EvalConfigError, gemini_model_factory, run_live, workflow_settings_from_env


def _fail(message: str) -> None:
    console.print(message, style="red", markup=False)
    raise typer.Exit(1)


@app.command()
def live(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "dev",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    label: Annotated[Optional[str], typer.Option(help="A word for the run folder's name: letters, digits, dot, dash or underscore.")] = None,
) -> None:
    """Read the set's filings with the real model and keep an artefact per filing. Costs model calls."""
    if eval_set not in ("dev", "heldout", "all"):
        _fail("--set must be dev, heldout or all")
    try:
        manifest = load_manifest(DEFAULT.manifest)
        filings = manifest.select(eval_set, only)  # type: ignore[arg-type]
    except ManifestError as exc:
        _fail(str(exc))
    if not only:
        left_out = len(manifest.out_of_scope(eval_set))  # type: ignore[arg-type]
        if left_out:
            console.print(f"left out as out of scope: {left_out}")
    absent = [f.file for f in filings if not (DEFAULT.corpus / f.file).is_file()]
    if absent:
        _fail("missing under data/eval/corpus: " + ", ".join(absent))
    if not filings:
        _fail("nothing to read: the selection is empty")
    try:
        factory = gemini_model_factory()
    except EvalConfigError as exc:
        _fail(str(exc))
    try:
        run_dir = DEFAULT.new_run(label)
    except ValueError as exc:
        _fail(str(exc))
    console.print(f"run {run_dir.name}: {len(filings)} filing(s), set {eval_set}")
    artefacts = run_live(filings, DEFAULT.corpus, run_dir, factory, workflow_settings_from_env(), eval_set,  # type: ignore[arg-type]
                         log=lambda line: console.print(line, markup=False))
    read = sum(1 for a in artefacts if a.result)
    console.print(f"done: {read} read, {len(artefacts) - read} failed → {run_dir}")


from maester_eval.artefacts import read_artefacts
from maester_eval.sheets import export_run


@app.command()
def export(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    force: Annotated[bool, typer.Option(help="Overwrite a sheet that exists.")] = False,
) -> None:
    """Write a labelling sheet per filing of a run to data/eval/sheets. Never overwrites without --force."""
    try:
        run_dir = DEFAULT.resolve_run(run)
    except FileNotFoundError as exc:
        _fail(str(exc))
    artefacts = read_artefacts(run_dir)
    missing = set(only or []) - {artefact.filing_id for artefact in artefacts}
    if missing:
        _fail("not in this run: " + ", ".join(sorted(missing)))
    written, skipped = export_run(run_dir, DEFAULT.sheets, only, force, artefacts=artefacts)
    for path in written:
        console.print(f"wrote {path.relative_to(DEFAULT.base)}", markup=False)
    for path in skipped:
        console.print(f"kept  {path.relative_to(DEFAULT.base)} (exists; --force to overwrite)", markup=False)
    console.print(f"{len(written)} written, {len(skipped)} kept")


from datetime import datetime, timezone

from maester_eval.artefacts import read_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import FreezeError, freeze_sheet, read_sheet, write_gold
from maester_eval.sheets import sheet_path


@app.command()
def freeze(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    run: Annotated[Optional[str], typer.Option(
        help="The run the sheet was exported from. Its record goes into the gold file, and its artefact gives back the "
             "columns a spreadsheet may have retyped, such as dates and scales.")] = None,
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
        except FileNotFoundError as exc:
            _fail(str(exc))
        artefact = next((a for a in read_artefacts(run_dir) if a.filing_id == filing_id), None)
        if artefact is None:
            _fail(f"no artefact for {filing_id} in {run_dir.name}")
        exported_from = {k: record.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
    try:
        gold = freeze_sheet(read_sheet(path), filing, load_taxonomy(), datetime.now(timezone.utc), exported_from, artefact)
        written = write_gold(DEFAULT.gold, gold, force)
    except (FreezeError, FileExistsError) as exc:
        _fail(str(exc))
    shown = written.relative_to(DEFAULT.base)
    console.print(f"froze {len(gold.facts)} fact(s), {len(gold.expected_checks)} expected check(s) → {shown}", markup=False)
