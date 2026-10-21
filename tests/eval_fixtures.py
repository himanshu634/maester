"""Fixtures the evaluation harness tests share: one filing and the sheet rows that freeze, scoring and the report read."""

from datetime import datetime, timezone
import re

from maester_eval.manifest import Filing
from maester_eval.sheets import SHEET_COLUMNS

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
# A Q2 FY26 results filing with its BSE code, the one the XBRL pairing, cells and compare tests read.
RESULTS_Q2 = Filing(file="synthetic-cements/results-2025-09.pdf", company="Synthetic Cements Limited",
                    kind="financial_results", period_end="2025-09-30", set="dev", bse_code="500999")

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def plain(text):
    """The text without terminal styles. Typer colours help under GitHub Actions, which splits "--run" into "-" and "-run"."""
    return _ANSI.sub("", text)


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


def pdf_fact(**values):
    """A Gemini fact as the extractor's wire result holds it (every key of `ExtractedFact.to_wire()`): the Q2 FY26
    quarter's consolidated revenue, printed in lakh."""
    base = dict(statement="income_statement", basis="consolidated", section="Income", lineOrder=1,
                reportedLabel="Revenue from operations", isSubtotal=False, componentLabels=[],
                periodLabel="Quarter ended 30.09.2025", periodEnd="2025-09-30", asOfDate=None,
                reportedText="12,345.00", reportedValue="12345.00", valueStatus="value",
                unitLabel="₹ in lakh", scaleFactor="100000", currency="INR",
                normalizedValue="1234500000", pageIndex=1, textLayerMatch=True)
    base.update(values)
    return base


def xbrl_fact(**values):
    """The same line as an XBRL run holds it: phase 4's `XbrlFact` wire dict (an `ExtractedFact` without a page),
    with the instance it came from."""
    base = {key: value for key, value in pdf_fact().items() if key not in ("pageIndex", "textLayerMatch")}
    base.update(span="quarter", periodStart="2025-07-01", element="RevenueFromOperations", contextId="OneD",
                decimals="-3", nil=False, concept="revenue_from_operations",
                instance="synthetic-cements/xbrl/a.xml", reportedText="1234500000", unitLabel="₹ lakh")
    base.update(values)
    return base
