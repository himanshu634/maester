"""Fixtures the evaluation harness tests share: one filing and the sheet rows that freeze, scoring and the report read."""

from datetime import datetime, timezone

from maester_eval.manifest import Filing
from maester_eval.sheets import SHEET_COLUMNS

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


def row(**values):
    """The sheet row of the fixture's Total assets line as the pipeline wrote it: no concept, nothing verified."""
    base = {column: "" for column in SHEET_COLUMNS}
    base.update(row="1", statement="balance_sheet", basis="consolidated", section="Assets", label="Total assets",
                period_label="As at 31 March 2026", period_end="2026-03-31", printed="2,000", value="2000",
                scale_factor="10000000", page="2")
    base.update(values)
    return base


def scored_row(**values):
    """`row` after a person labelled it and marked it verified, so that it freezes into a gold fact."""
    return row(**{"verified": "yes", "concept": "total_assets", **values})
