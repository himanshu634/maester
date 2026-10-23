"""Settled disagreements join the filing's gold file.

`compare` writes a settle sheet of the cells where the model and XBRL disagree. The investor checks each against the PDF,
types the figure the page prints in `gold_text` and marks the row verified. `settle` freezes those rows with
`freeze_sheet`, and merges them into the filing's gold file as facts of `origin "settled"`.

A settled fact never replaces a gold fact:

- a cell gold holds already with the same figure is skipped and counted;
- a cell gold holds with another figure stops the merge, and nothing is written.

A gold fact is the same cell as a settled one when `gold.fact_keys` share a key. A message names the concept, the basis
and the period end, never a figure, a label or a period label.
"""

from decimal import Decimal

from maester_eval.errors import EvalError
from maester_eval.gold import GoldFact, GoldFiling, SettledRecord, fact_keys

__all__ = ["SettleError", "check_provenance", "merge_gold"]


class SettleError(EvalError):
    pass


def _same_figure(a: GoldFact, b: GoldFact) -> bool:
    """The same status and, for a figure, the same `Decimal`. A dash is no figure, and no figure equals a dash."""
    if a.value_status != b.value_status:
        return False
    if a.normalized_value is None or b.normalized_value is None:  # both dashes
        return True
    return Decimal(a.normalized_value) == Decimal(b.normalized_value)


def check_provenance(rows: list[dict[str, str]], xbrl_run: str, map_version: str | None, compared: str) -> None:
    """Refuse a settle sheet that another compare wrote: each row must name the XBRL run and the map version that
    `compared` (the PDF run's `compare-xbrl.json`) names, or the settled facts would be recorded against an XBRL side
    the investor never saw. A row with neither, from a sheet written before rows carried them, is refused too. The
    message names runs and versions only."""
    expected = (xbrl_run, map_version or "")
    for row in rows:
        found = (row.get("xbrl_run", ""), row.get("map_version", ""))
        if found != expected:
            raise SettleError(f"the settle sheet is from XBRL run {found[0] or 'none'} with map {found[1] or 'none'}, but "
                              f"{compared} is from XBRL run {expected[0]} with map {expected[1] or 'none'}; settle against "
                              "the compare that wrote the sheet")


def merge_gold(existing: GoldFiling | None, settled: GoldFiling, record: SettledRecord) -> tuple[GoldFiling, int]:
    """`existing` with the facts of `settled` added as `origin "settled"`, and the number of facts skipped.

    The settled facts come from `freeze_sheet` and are frozen from a settle sheet's rows, so they carry no expected
    checks: the checks of a gold file are the sheet's. With no `existing` file, the settled facts are the file. With
    one, its facts, checks and frozen record stay, and `record` is added to its settled records, with the count of
    facts this run added. A run that adds none leaves the file as it was."""
    held = {key: fact for fact in (existing.facts if existing else []) for key in fact_keys(fact)}
    added: list[GoldFact] = []
    skipped = 0
    for fact in settled.facts:
        taken = [held[key] for key in fact_keys(fact) if key in held]
        if not taken:
            fact = fact.model_copy(update={"origin": "settled"})
            added.append(fact)
            held.update({key: fact for key in fact_keys(fact)})  # two rows of one cell are not added twice
        elif all(_same_figure(fact, other) for other in taken):
            skipped += 1
        else:
            raise SettleError(f"gold already has {fact.concept} for {fact.basis} {fact.period_end or 'no date'} "
                              "with another figure; nothing was written")
    if existing is not None and not added:
        return existing, skipped
    run = record.model_copy(update={"facts": len(added)})
    if existing is None:
        return settled.model_copy(update={"facts": added, "expected_checks": [], "settled": [run]}), skipped
    return existing.model_copy(update={"facts": [*existing.facts, *added], "settled": [*existing.settled, run]}), skipped
