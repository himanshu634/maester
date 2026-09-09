"""Maester's local document application, built on the shared financial engine."""

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from pdf_financial_qa.config import Settings
from pdf_financial_qa.extraction import extract
from pdf_financial_qa.qa import ask as ask_question
from pdf_financial_qa.storage import hash_pdf, list_cached, load, save

app = typer.Typer(
    help="Maester: extract financial statement PDFs and ask questions grounded in them.",
    pretty_exceptions_enable=False,
)
console = Console()


def _load_settings() -> Settings:
    try:
        return Settings.load()
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from None


@app.command()
def ingest(pdf_path: Path, force: bool = typer.Option(False, help="Re-extract even if cached.")):
    """Extract a financial statement PDF and cache the structured result."""
    if not pdf_path.exists():
        console.print(f"[red]No such file: {pdf_path}[/red]")
        raise typer.Exit(1)

    settings = _load_settings()

    if not force:
        existing_hash = hash_pdf(pdf_path.read_bytes())
        cached = load(existing_hash)
        if cached is not None:
            console.print(
                f"[yellow]Already ingested as {existing_hash} — use --force to re-extract.[/yellow]"
            )
            _print_warnings(cached)
            return

    with console.status(f"Extracting {pdf_path.name} via {settings.model}..."):
        result = extract(pdf_path, settings)

    path = save(result)
    console.print(f"[green]Extracted and cached:[/green] {path} (hash={result.source_pdf_hash})")
    _print_warnings(result)


@app.command()
def ask(
    question: str,
    doc: str | None = typer.Option(
        None, "--doc", help="Cache hash of the document to ask against (see `list-docs`)."
    ),
):
    """Ask a question grounded in a previously ingested PDF."""
    settings = _load_settings()

    cached_docs = list_cached()
    if not cached_docs:
        console.print("[red]No documents ingested yet. Run `ingest <pdf>` first.[/red]")
        raise typer.Exit(1)

    if doc:
        result = load(doc)
        if result is None:
            console.print(f"[red]No cached document with hash {doc!r}.[/red]")
            raise typer.Exit(1)
    elif len(cached_docs) == 1:
        result = cached_docs[0]
    else:
        console.print(
            "[red]Multiple documents are cached — pass --doc <hash> to pick one.[/red]"
        )
        _print_doc_table(cached_docs)
        raise typer.Exit(1)

    with console.status("Thinking..."):
        answer = ask_question(question, result, settings)

    console.print(answer)


@app.command("list-docs")
def list_docs():
    """List cached (ingested) documents."""
    docs = list_cached()
    if not docs:
        console.print("No documents ingested yet.")
        return
    _print_doc_table(docs)


def _print_doc_table(docs: list) -> None:
    table = Table("Hash", "File", "Warnings")
    for d in docs:
        table.add_row(d.source_pdf_hash, d.source_pdf_name, str(len(d.validation_warnings)))
    console.print(table)


def _print_warnings(result) -> None:
    if not result.validation_warnings:
        console.print("[green]Consistency checks passed (balance sheet identity, subtotals).[/green]")
        return
    console.print(f"[yellow]{len(result.validation_warnings)} consistency warning(s):[/yellow]")
    for w in result.validation_warnings:
        console.print(f"  - {w}")


if __name__ == "__main__":
    app()
