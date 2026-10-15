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
