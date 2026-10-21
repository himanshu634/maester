"""Fixtures the evaluation harness tests share: one filing and the sheet rows that freeze, scoring and the report read."""

from datetime import datetime, timezone
import re

from maester_eval.artefacts import Artefact, InstanceRead, ModelCalls
from maester_eval.gold import GoldFact, GoldFiling
from maester_eval.manifest import Filing
from maester_eval.sheets import SHEET_COLUMNS

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
# A Q2 FY26 results filing with its BSE code, the one the XBRL pairing, cells and compare tests read.
RESULTS_Q2 = Filing(file="synthetic-cements/results-2025-09.pdf", company="Synthetic Cements Limited",
                    kind="financial_results", period_end="2025-09-30", set="dev", bse_code="500999")
# The same company's Q4 FY26 results: its March tokens pair a quarter (MQ) and a half year (MH), both ending 31 March.
RESULTS_Q4 = RESULTS_Q2.model_copy(update={"file": "synthetic-cements/results-2026-03.pdf", "period_end": "2026-03-31"})
# RESULTS_Q2's consolidated income-statement quarter slot (`source_rule.slot_key`).
QUARTER = "synthetic-cements|financial_results|income_statement|consolidated|2025-09-30|quarter"

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


def gold_fact(**values):
    """A gold fact as `freeze` writes one: the Q2 FY26 quarter's consolidated revenue, 12,345.00 lakh, from a sheet."""
    base = dict(concept="revenue_from_operations", statement="income_statement", basis="consolidated", section="Income",
                label="Revenue from operations", period_label="Quarter ended 30.09.2025", period_end="2025-09-30",
                span="quarter", printed="12,345.00", value_status="value", value="12345.00", scale="100000",
                normalized_value="1234500000.00", page_index=1, origin="sheet")
    base.update(values)
    return GoldFact(**base)


def gold_of(*facts, filing=RESULTS_Q2):
    """The gold file of `filing` (RESULTS_Q2 unless named) holding `facts` in that order."""
    return GoldFiling(filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
                      period_end=filing.period_end, set=filing.set, stratum=filing.stratum,
                      printed_pages_per_page=filing.printed_pages_per_page, taxonomy_version=1,
                      frozen_at=WHEN.isoformat(), exported_from=None, facts=list(facts), expected_checks=[])


def _artefact(filing, result, **values):
    base = dict(filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
                period_end=filing.period_end, set=filing.set, stratum=filing.stratum,
                printed_pages_per_page=filing.printed_pages_per_page, pipeline_version="test", prompt_version="test",
                model="test", started_at=WHEN.isoformat(), seconds=0.0, bytes=0, model_calls=ModelCalls(),
                pages_without_text=[], result=result, error=None)
    base.update(values)
    return Artefact(**base)


def pdf_artefact(filing, facts, coverage=(("income_statement", "consolidated"), ("income_statement", "standalone"))):
    """A Gemini artefact of `filing` holding `facts`, each `(statement, basis)` of `coverage` extracted on the first page."""
    return _artefact(filing, {"state": "complete", "facts": list(facts), "checks": [], "warnings": [],
                              "coverage": [{"statement": statement, "basis": basis, "pages": [0], "status": "extracted"}
                                           for statement, basis in coverage]})


def instance_read(file, **values):
    """What `xbrl-read` records of an instance it used: a consolidated SQ2025-2026 `in-capmkt/ind_as` file filed 2025-10-17."""
    base = dict(file=file, basis="consolidated", period="SQ2025-2026", filed="2025-10-17", sha256="0" * 64,
                format="in-capmkt/ind_as", mapped=True, used=True, reason=None, state="complete", facts=0, warnings=[])
    base.update(values)
    return InstanceRead(**base)


def xbrl_artefact(filing, facts, instances=None):
    """An XBRL artefact of `filing` holding `facts`. Without `instances`, each instance the facts name is recorded as
    used, with the basis of its first fact, in the order the facts first name them."""
    if instances is None:
        first = {}
        for fact in facts:
            first.setdefault(fact["instance"], fact)
        instances = [instance_read(file, basis=fact["basis"], facts=sum(1 for f in facts if f["instance"] == file))
                     for file, fact in first.items()]
    return _artefact(filing, {"state": "complete", "facts": list(facts), "checks": [], "warnings": []},
                     pipeline_version="xbrl-1", prompt_version="in-capmkt/ind_as@1", model="xbrl-parser-1",
                     source="xbrl", instances=list(instances))
