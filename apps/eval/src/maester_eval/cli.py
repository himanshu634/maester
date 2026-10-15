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
