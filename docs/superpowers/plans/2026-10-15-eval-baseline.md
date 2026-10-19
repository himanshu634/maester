# Evaluation baseline (phase 0) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A harness, `maester-eval`, that runs today's extraction workflow over the investor's real filings, keeps one artefact per filing, turns a run into labelling sheets, freezes checked sheets into a gold set, and scores any run against that gold set in a committed report, so that the first report is the baseline every later change is measured against.

**Architecture:** A new Python app, `apps/eval` (uv workspace member, Typer CLI), that depends only on the engine package. `live` runs `run_extraction` in-process with the same Gemini model the extractor builds, wrapped in a call counter, and writes the extractor's wire result plus timings as a JSON artefact per filing under a timestamped run folder. `export` turns artefacts into CSV sheets a person corrects against the PDF; `freeze` turns a checked sheet into a gold JSON file keyed by concept; `report` matches a run's facts to gold by statement, basis, section, label and period label (phase 1 adds matching by concept), compares exact decimals, and writes a Markdown and JSON report with strata and a delta against an earlier run. The taxonomy file the gold set labels against, `packages/contracts/concepts.json`, is created here with the statement concepts; phase 1 extends it.

**Tech Stack:** Python 3.11+, uv workspace, Typer + Rich, Pydantic v2, `pdf_financial_qa.workflow` (`run_extraction`, `PdfDocument`, `parse_reported`, `format_decimal`), `decimal.Decimal`, `unittest`, `csv`, `json`.

**Spec:** `docs/superpowers/specs/2026-10-15-financial-data-layer-design.md` (§9 Evaluation, §11 phase 0, §5.1 taxonomy v1, §10 rules). Decision: `docs/decisions/0006-concepts-calculations-agent-access.md`. Rules: `CLAUDE.md` "Financial figures" and `.claude/skills/financial-figures/SKILL.md`.

## Global Constraints

- Python `>=3.11`; tests are `unittest` under `tests/`, run with `uv run --locked python -m unittest discover -s tests -v`; everything in CI is offline (no model calls, no network). `uv build --all-packages` must build the new member.
- `scripts/check_workspace.py` must pass: every uv member has `pyproject.toml` and Python under `src/`; packages never import applications; every local Markdown link resolves.
- Applications depend on packages and never on another application: `apps/eval` imports `pdf_financial_qa` only, never `maester_extractor` or `maester_cli`.
- Figures are compared as `decimal.Decimal` and carried as decimal strings; never `float` for a value, a scale or a comparison. Percentages of counts in the report are ratios of integers, formatted with one decimal.
- No document text on the console or in logs: the console shows filing ids, codes, counts and seconds. Labels, printed values and figures go only into files under `data/eval/` and the report the operator chooses to commit.
- Only public filings go into the corpus. `data/eval/corpus/` and `data/eval/runs/` are git-ignored; `data/eval/manifest.json`, `data/eval/gold/` and `docs/eval/` are committed.
- The harness builds the model from the same variables as the extractor (`GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` default `us-central1`, `GEMINI_MODEL` default `gemini-2.5-pro`, `EXTRACT_DEADLINE_SECONDS` default `840`), so a live run measures the configuration the product runs.
- Nothing in the pipeline changes in this phase: no prompt, rule, check or version. The baseline is `extract-2` as it stands.
- Docs: sentence case, British spelling ("artefact", "normalise"), plain words; `docs/systems/*` in Simplified Technical English like the existing descriptions.
- Commit on `staging` after each task, message in the repo's style (`feat(eval): …`, `test(eval): …`, `docs: …`), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No branches, no pull requests.

## Review Focus

1. A filing whose extraction failed (an `error` artefact, no `result`): the report counts it as failed with its code, its gold facts as `missing`, and finishes. Test: Task 7, `test_failed_filing_scores_all_gold_as_missing`.
2. The same printed label in two sections, or twice in one section ("Total" under Assets and under Equity and liabilities; two "Other" lines): matching uses the section, and two candidates in one section with different values are `ambiguous`, never a silent pick. Test: Task 7, `test_same_label_in_two_sections_and_ambiguous_duplicates`.
3. A column whose header the pipeline could not date (`period_end` null, "FY2026"): matching is by the printed period label, so such a fact still scores. Test: Task 7, `test_matches_by_period_label_when_no_date_was_read`.
4. A sheet saved by a spreadsheet application: a BOM at the start, `gold_text` such as `1,200.0`, a page typed as `7.0`: freeze reads text as text, parses figures with `parse_reported`, reads pages as whole numbers and refuses anything else with the row number. Test: Task 6, `test_sheet_saved_by_a_spreadsheet_app`.
5. A run that lacks artefacts for some manifest filings, or has artefacts with no gold yet: both are listed (`not_run`, `gold_missing`) and the summary is over the scored filings only. Test: Task 7, `test_not_run_and_gold_missing_are_listed_not_scored`.

---

## File structure

```
apps/eval/
  LICENSE                      copied from apps/cli
  README.md                    what it is, the four commands, the layout, the privacy note
  pyproject.toml               maester-eval; depends on the engine, typer, rich, pydantic, python-dotenv
  src/maester_eval/
    __init__.py
    __main__.py                `python -m maester_eval`
    cli.py                     the Typer app: live, export, freeze, report; console output is ids and counts only
    paths.py                   repo root, data/eval layout, run folders, "latest"
    text.py                    normalise(): the same normalisation as apps/api/src/financials/stitch.ts
    concepts.py                loads packages/contracts/concepts.json (the gold vocabulary)
    manifest.py                the corpus manifest and its validation
    artefacts.py               the per-filing artefact model, write and read
    runner.py                  live mode: CountingModel, run_filing, run_live, the Gemini factory
    sheets.py                  export: artefact → CSV labelling sheet
    gold.py                    GoldFact/GoldFiling models; freeze: sheet → gold JSON
    scoring.py                 match a run against gold: outcomes, strata, summary
    report.py                  Markdown and JSON report; delta against an earlier run
packages/contracts/concepts.json   taxonomy v1: the three statements' concepts (phase 1 adds sum_of, cross_check, dimensions, the TS loader)
data/eval/
  manifest.json                committed; starts empty
  gold/.gitkeep                committed
  sheets/.gitkeep              committed; the operator's labelling sheets (commit them or not)
  corpus/                      git-ignored: the PDFs
  runs/                        git-ignored: artefacts and reports per run
docs/eval/                     committed reports (created by the first `report --to`)
tests/
  test_concepts_json.py, test_eval_cli.py, test_eval_manifest.py, test_eval_live.py,
  test_eval_sheets.py, test_eval_gold.py, test_eval_scoring.py, test_eval_report.py
```

Wire-format field names in artefacts are the extractor's camelCase (`reportedLabel`, `periodLabel`, `normalizedValue`, `pageIndex`, `textLayerMatch`), because the artefact is `ExtractionResult.to_wire()` unchanged, so phase 1's replay mode and the worker read the same shape.

---

### Task 1: The `apps/eval` workspace member and CLI skeleton

**Files:**
- Create: `apps/eval/pyproject.toml`, `apps/eval/LICENSE`, `apps/eval/README.md`, `apps/eval/src/maester_eval/__init__.py`, `apps/eval/src/maester_eval/__main__.py`, `apps/eval/src/maester_eval/cli.py`
- Modify: `pyproject.toml` (root), `.gitignore`
- Create: `data/eval/manifest.json`, `data/eval/gold/.gitkeep`, `data/eval/sheets/.gitkeep`
- Test: `tests/test_eval_cli.py`

**Interfaces:**
- Produces: the Typer app `maester_eval.cli:app`; the console command `maester-eval`; the folders under `data/eval/`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_eval_cli.py
"""The evaluation harness's command line. Offline."""

import unittest

from typer.testing import CliRunner

from maester_eval.cli import app


class HelpTests(unittest.TestCase):
    def test_help_names_the_harness(self):
        response = CliRunner().invoke(app, ["--help"])
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("evaluation harness", response.output)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --locked python -m unittest tests.test_eval_cli -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval'`

- [ ] **Step 3: Create the member**

`apps/eval/pyproject.toml`:

```toml
[project]
name = "maester-eval"
version = "0.1.0"
description = "Maester's evaluation harness: runs the extraction workflow over real filings and scores it against a hand-checked gold set."
license = "AGPL-3.0-or-later"
license-files = ["LICENSE"]
requires-python = ">=3.11"
dependencies = [
    "maester-financial-engine==0.1.0",
    "typer>=0.12",
    "rich>=13.7",
    "pydantic>=2.7",
    "python-dotenv>=1.0",
]

[project.scripts]
maester-eval = "maester_eval.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/maester_eval"]
```

Copy the licence: `cp apps/cli/LICENSE apps/eval/LICENSE`.

`apps/eval/src/maester_eval/__init__.py`:

```python
"""Maester's evaluation harness: real filings in, a scored report out."""
```

`apps/eval/src/maester_eval/__main__.py`:

```python
from maester_eval.cli import app


def main() -> None:
    app()


if __name__ == "__main__":
    main()
```

`apps/eval/src/maester_eval/cli.py` (commands are added by later tasks):

```python
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
```

Root `pyproject.toml`: add the member, the dependency and the source.

```toml
dependencies = ["maester-cli==0.1.0", "maester-extractor==0.1.0", "maester-eval==0.1.0"]
```

```toml
[tool.uv.workspace]
members = ["apps/cli", "apps/extractor", "apps/eval", "packages/financial-engine"]

[tool.uv.sources]
maester-cli = { workspace = true }
maester-extractor = { workspace = true }
maester-eval = { workspace = true }
maester-financial-engine = { workspace = true }
```

`.gitignore`: after the `data/gcloud/` line add

```
data/eval/corpus/
data/eval/runs/
```

Create the data layout:

```bash
mkdir -p data/eval/gold data/eval/sheets
printf '{\n  "filings": []\n}\n' > data/eval/manifest.json
touch data/eval/gold/.gitkeep data/eval/sheets/.gitkeep
```

`apps/eval/README.md`:

```markdown
# Maester evaluation harness

`maester-eval` runs the extraction workflow over real filings and scores it against a gold set a person has checked against the PDFs. It is how a change to a prompt, a rule, a check, the taxonomy or the text-layer reader is shown to help or hurt before it lands. The design is [financial data layer](../../docs/superpowers/specs/2026-10-15-financial-data-layer-design.md), §9.

## Commands

| Command | What it does |
| --- | --- |
| `maester-eval live --set dev` | Reads every filing of the set with the real model, exactly as the extractor would, and writes one artefact per filing under `data/eval/runs/<timestamp>/`. Costs model calls. |
| `maester-eval export --run latest` | Writes a labelling sheet per filing to `data/eval/sheets/`, pre-filled with what the pipeline read. Never overwrites a sheet without `--force`. |
| `maester-eval freeze <filing-id>` | Turns a checked sheet into `data/eval/gold/<filing-id>.json`. Only rows marked `verified` with a concept from the taxonomy are kept. |
| `maester-eval report --run latest` | Scores the run against the gold set and writes `report.md` and `report.json` into the run folder; `--to docs/eval/<date>-<label>.md` publishes the Markdown; `--against <run>` adds the delta. |

A filing id is its path under the corpus without `.pdf`: `synthetic-cements/ar-2025-26`.

## Layout

~~~
data/eval/manifest.json   which filings exist, whose they are, annual report or results, dev or held-out (committed)
data/eval/corpus/         the PDFs (git-ignored)
data/eval/sheets/         labelling sheets (yours to commit or not)
data/eval/gold/           the gold set (committed)
data/eval/runs/           artefacts and reports per run (git-ignored)
docs/eval/                published reports (committed)
packages/contracts/concepts.json   the concepts the gold set is labelled with
~~~

## Rules

- Public filings only. Never put a private document in the corpus.
- A company is in one set only, `dev` or `heldout`. Tune on `dev`; run `heldout` only to decide whether a change lands.
- The console never shows a label or a figure; the files do.
- Figures are compared as exact decimals. A match means value, sign, scale, basis and period all agree.

## Configuration

The same variables as the extractor: `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` (default `us-central1`), `GEMINI_MODEL` (default `gemini-2.5-pro`), `EXTRACT_DEADLINE_SECONDS` (default `840`), read from `.env`.
```

(The `~~~` fence inside the README is a triple-backtick fence in the file; it is tildes here only so this plan's own fence does not end early.)

- [ ] **Step 4: Lock, sync and run the test**

```bash
uv lock
uv sync --locked
uv run --locked python -m unittest tests.test_eval_cli -v
uv run --locked python scripts/check_workspace.py
uv run --locked maester-eval --help
```

Expected: the test passes; the workspace check prints `Workspace OK: 4 members, …`; the help shows "Maester evaluation harness".

- [ ] **Step 5: Commit**

```bash
git add apps/eval pyproject.toml uv.lock .gitignore data/eval tests/test_eval_cli.py
git commit -m "feat(eval): the maester-eval workspace member and command skeleton" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Taxonomy v1 and its loader

**Files:**
- Create: `packages/contracts/concepts.json`, `apps/eval/src/maester_eval/concepts.py`
- Test: `tests/test_concepts_json.py`

**Interfaces:**
- Produces: `load_taxonomy(path=CONCEPTS_PATH) -> Taxonomy` with `Taxonomy.taxonomy_version: int`, `Taxonomy.concepts: list[Concept]`, `Taxonomy.ids() -> set[str]`, `Taxonomy.get(id) -> Concept | None`; `Concept.id`, `.label`, `.family`, `.kind` (`monetary | per_share | count`), `.period_type` (`duration | instant`). `CONCEPTS_PATH` comes from `maester_eval.paths` (Task 3 creates that module; this task creates `paths.py` with only `ROOT` and `CONCEPTS_PATH`, and Task 3 adds the rest).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_concepts_json.py
"""The taxonomy file the gold set is labelled with. Offline."""

import json
import re
import unittest

from maester_eval.concepts import CONCEPTS_PATH, load_taxonomy

SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")
FAMILIES = {"income_statement", "balance_sheet", "cash_flow", "segment_note", "borrowings_note",
            "share_capital_note", "dividend_note", "related_party_note"}


class TaxonomyTests(unittest.TestCase):
    def test_file_parses_with_version_one(self):
        taxonomy = load_taxonomy()
        self.assertEqual(taxonomy.taxonomy_version, 1)
        self.assertGreaterEqual(len(taxonomy.concepts), 60)

    def test_ids_are_unique_snake_case(self):
        ids = [c.id for c in load_taxonomy().concepts]
        self.assertEqual(len(ids), len(set(ids)))
        for concept_id in ids:
            self.assertRegex(concept_id, SNAKE)

    def test_fields_are_within_the_vocabularies(self):
        for concept in load_taxonomy().concepts:
            with self.subTest(concept=concept.id):
                self.assertIn(concept.family, FAMILIES)
                self.assertIn(concept.kind, {"monetary", "per_share", "count"})
                self.assertIn(concept.period_type, {"duration", "instant"})
                self.assertTrue(concept.label.strip())

    def test_the_lines_the_summary_needs_exist(self):
        ids = load_taxonomy().ids()
        for needed in ("revenue_from_operations", "profit_after_tax", "eps_basic", "total_assets",
                       "total_equity", "net_cash_from_operating_activities", "cash_and_cash_equivalents"):
            self.assertIn(needed, ids)

    def test_per_share_lines_are_per_share(self):
        taxonomy = load_taxonomy()
        self.assertEqual(taxonomy.get("eps_basic").kind, "per_share")
        self.assertEqual(taxonomy.get("eps_diluted").kind, "per_share")
        self.assertIsNone(taxonomy.get("no_such_concept"))

    def test_raw_json_has_no_other_top_level_keys(self):
        self.assertEqual(set(json.loads(CONCEPTS_PATH.read_text())), {"taxonomy_version", "concepts"})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --locked python -m unittest tests.test_concepts_json -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.concepts'`

- [ ] **Step 3: Write `paths.py` (root and the taxonomy path) and `concepts.py`**

`apps/eval/src/maester_eval/paths.py`:

```python
"""Where the harness reads and writes. Everything lives under the repository's data/eval."""

from pathlib import Path

# apps/eval/src/maester_eval/paths.py → the repository root.
ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_PATH = ROOT / "packages" / "contracts" / "concepts.json"
```

`apps/eval/src/maester_eval/concepts.py`:

```python
"""The taxonomy, packages/contracts/concepts.json, as the gold set's vocabulary.

Phase 1 gives the taxonomy a TypeScript loader and a generated Python copy in the
engine; until then the harness reads the JSON file directly.
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from maester_eval.paths import CONCEPTS_PATH

Family = Literal[
    "income_statement", "balance_sheet", "cash_flow",
    "segment_note", "borrowings_note", "share_capital_note", "dividend_note", "related_party_note",
]
ConceptKind = Literal["monetary", "per_share", "count"]
PeriodType = Literal["duration", "instant"]


class Concept(BaseModel):
    # Phase 1 adds sum_of, cross_check, dimensions and notes; the harness ignores what it does not know.
    model_config = ConfigDict(extra="allow")

    id: str
    label: str
    family: Family
    kind: ConceptKind
    period_type: PeriodType


class Taxonomy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    taxonomy_version: int
    concepts: list[Concept]

    def ids(self) -> set[str]:
        return {c.id for c in self.concepts}

    def get(self, concept_id: str) -> Concept | None:
        return next((c for c in self.concepts if c.id == concept_id), None)


def load_taxonomy(path: Path = CONCEPTS_PATH) -> Taxonomy:
    return Taxonomy.model_validate(json.loads(path.read_text()))
```

`packages/contracts/concepts.json` (the whole file; labels are the Ind AS Schedule III names in plain words):

```json
{
  "taxonomy_version": 1,
  "concepts": [
    { "id": "revenue_from_operations", "label": "Revenue from operations", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "other_income", "label": "Other income", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "total_income", "label": "Total income", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "cost_of_materials_consumed", "label": "Cost of materials consumed", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "purchases_of_stock_in_trade", "label": "Purchases of stock-in-trade", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "changes_in_inventories", "label": "Changes in inventories of finished goods, work-in-progress and stock-in-trade", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "employee_benefits_expense", "label": "Employee benefits expense", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "finance_costs", "label": "Finance costs", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "depreciation_and_amortisation", "label": "Depreciation and amortisation expense", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "other_expenses", "label": "Other expenses", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "total_expenses", "label": "Total expenses", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "profit_before_exceptional_items_and_tax", "label": "Profit before exceptional items and tax", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "exceptional_items", "label": "Exceptional items", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "profit_before_tax", "label": "Profit before tax", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "current_tax", "label": "Current tax", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "deferred_tax", "label": "Deferred tax", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "total_tax_expense", "label": "Total tax expense", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "profit_after_tax", "label": "Profit for the period", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "other_comprehensive_income", "label": "Other comprehensive income", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "total_comprehensive_income", "label": "Total comprehensive income for the period", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "profit_attributable_to_owners", "label": "Profit attributable to owners of the parent", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "profit_attributable_to_non_controlling_interests", "label": "Profit attributable to non-controlling interests", "family": "income_statement", "kind": "monetary", "period_type": "duration" },
    { "id": "eps_basic", "label": "Earnings per equity share, basic", "family": "income_statement", "kind": "per_share", "period_type": "duration" },
    { "id": "eps_diluted", "label": "Earnings per equity share, diluted", "family": "income_statement", "kind": "per_share", "period_type": "duration" },

    { "id": "property_plant_and_equipment", "label": "Property, plant and equipment", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "capital_work_in_progress", "label": "Capital work-in-progress", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "right_of_use_assets", "label": "Right-of-use assets", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "goodwill", "label": "Goodwill", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "other_intangible_assets", "label": "Other intangible assets", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "non_current_investments", "label": "Non-current investments", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "deferred_tax_assets", "label": "Deferred tax assets (net)", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_non_current_assets", "label": "Total non-current assets", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "inventories", "label": "Inventories", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "current_investments", "label": "Current investments", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "trade_receivables", "label": "Trade receivables", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "cash_and_cash_equivalents", "label": "Cash and cash equivalents", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "other_bank_balances", "label": "Bank balances other than cash and cash equivalents", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_current_assets", "label": "Total current assets", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_assets", "label": "Total assets", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "equity_share_capital", "label": "Equity share capital", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "other_equity", "label": "Other equity", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "equity_attributable_to_owners", "label": "Equity attributable to owners of the parent", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "non_controlling_interests", "label": "Non-controlling interests", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_equity", "label": "Total equity", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "non_current_borrowings", "label": "Non-current borrowings", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "non_current_lease_liabilities", "label": "Non-current lease liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "deferred_tax_liabilities", "label": "Deferred tax liabilities (net)", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_non_current_liabilities", "label": "Total non-current liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "current_borrowings", "label": "Current borrowings", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "current_lease_liabilities", "label": "Current lease liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "trade_payables", "label": "Trade payables", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_current_liabilities", "label": "Total current liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_liabilities", "label": "Total liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },
    { "id": "total_equity_and_liabilities", "label": "Total equity and liabilities", "family": "balance_sheet", "kind": "monetary", "period_type": "instant" },

    { "id": "cash_flow_opening_profit_before_tax", "label": "Profit before tax, as the cash flow statement opens", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "cash_flow_opening_profit_after_tax", "label": "Profit for the period, as the cash flow statement opens", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "net_cash_from_operating_activities", "label": "Net cash from operating activities", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "net_cash_from_investing_activities", "label": "Net cash from investing activities", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "net_cash_from_financing_activities", "label": "Net cash from financing activities", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "effect_of_exchange_rate_changes_on_cash", "label": "Effect of exchange rate changes on cash and cash equivalents", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "net_change_in_cash", "label": "Net increase or decrease in cash and cash equivalents", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "cash_at_beginning_of_period", "label": "Cash and cash equivalents at the beginning of the period", "family": "cash_flow", "kind": "monetary", "period_type": "instant" },
    { "id": "cash_at_end_of_period", "label": "Cash and cash equivalents at the end of the period", "family": "cash_flow", "kind": "monetary", "period_type": "instant" },
    { "id": "income_taxes_paid", "label": "Income taxes paid", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "interest_paid", "label": "Interest paid", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "purchase_of_property_plant_and_equipment", "label": "Purchase of property, plant and equipment", "family": "cash_flow", "kind": "monetary", "period_type": "duration" },
    { "id": "dividends_paid", "label": "Dividends paid", "family": "cash_flow", "kind": "monetary", "period_type": "duration" }
  ]
}
```

- [ ] **Step 4: Run the test**

Run: `uv run --locked python -m unittest tests.test_concepts_json -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/concepts.json apps/eval/src/maester_eval/paths.py apps/eval/src/maester_eval/concepts.py tests/test_concepts_json.py
git commit -m "feat(contracts): taxonomy v1, the statement concepts the gold set is labelled with" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Paths, run folders and the corpus manifest

**Files:**
- Modify: `apps/eval/src/maester_eval/paths.py`
- Create: `apps/eval/src/maester_eval/manifest.py`, `apps/eval/src/maester_eval/text.py`
- Test: `tests/test_eval_manifest.py`

**Interfaces:**
- Produces:
  - `EvalPaths(base: Path)` with `.manifest`, `.corpus`, `.gold`, `.sheets`, `.runs` (Paths), `.new_run(label: str | None = None, now: datetime | None = None) -> Path` (creates `runs/<YYYYMMDDTHHMMSSZ>[-label]`), `.resolve_run(name_or_path: str) -> Path` (`latest`, a run name under `runs/`, or a path; raises `FileNotFoundError`); `DEFAULT = EvalPaths(ROOT / "data" / "eval")`.
  - `Filing` (Pydantic): `file`, `company`, `kind` (`annual_report | financial_results`), `period_end` (ISO date string), `set` (`dev | heldout`); property `id` (the file path without `.pdf`).
  - `Manifest` with `filings: list[Filing]`, `select(eval_set="all", only=None) -> list[Filing]`, `by_id() -> dict[str, Filing]`.
  - `load_manifest(path) -> Manifest`; `ManifestError(ValueError)`; `missing_files(manifest, corpus) -> list[str]`.
  - `normalise(text: str) -> str`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_manifest.py
"""The corpus manifest, the run folders and label normalisation. Offline."""

from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from maester_eval.manifest import ManifestError, load_manifest, missing_files
from maester_eval.paths import EvalPaths
from maester_eval.text import normalise

ONE = {"file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
       "kind": "annual_report", "period_end": "2026-03-31", "set": "dev"}
TWO = {"file": "synthetic-cements/q1-2026-27.pdf", "company": "Synthetic Cements Limited",
       "kind": "financial_results", "period_end": "2026-06-30", "set": "dev"}
OTHER = {"file": "other-metals/ar-2025-26.pdf", "company": "Other Metals Limited",
         "kind": "annual_report", "period_end": "2026-03-31", "set": "heldout"}


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))

    def write(self, filings):
        self.paths.manifest.parent.mkdir(parents=True, exist_ok=True)
        self.paths.manifest.write_text(json.dumps({"filings": filings}))
        return self.paths.manifest

    def test_ids_selection_and_lookup(self):
        manifest = load_manifest(self.write([ONE, TWO, OTHER]))
        self.assertEqual([f.id for f in manifest.filings],
                         ["synthetic-cements/ar-2025-26", "synthetic-cements/q1-2026-27", "other-metals/ar-2025-26"])
        self.assertEqual([f.id for f in manifest.select("dev")], ["synthetic-cements/ar-2025-26", "synthetic-cements/q1-2026-27"])
        self.assertEqual([f.id for f in manifest.select("heldout")], ["other-metals/ar-2025-26"])
        self.assertEqual([f.id for f in manifest.select("all", only=["other-metals/ar-2025-26"])], ["other-metals/ar-2025-26"])
        self.assertEqual(manifest.by_id()["synthetic-cements/q1-2026-27"].kind, "financial_results")

    def test_unknown_only_id_is_an_error(self):
        manifest = load_manifest(self.write([ONE]))
        with self.assertRaisesRegex(ManifestError, "not in the manifest: nope"):
            manifest.select("all", only=["nope"])

    def test_duplicate_ids_are_refused(self):
        with self.assertRaisesRegex(ManifestError, "duplicate filing ids"):
            load_manifest(self.write([ONE, dict(ONE, company="Someone Else Limited")]))

    def test_a_company_is_in_one_set_only(self):
        with self.assertRaisesRegex(ManifestError, "one set only.*Synthetic Cements Limited"):
            load_manifest(self.write([ONE, dict(TWO, set="heldout")]))

    def test_bad_fields_are_refused(self):
        for bad in (dict(ONE, kind="brochure"), dict(ONE, set="test"), dict(ONE, period_end="31/03/2026"),
                    dict(ONE, file="/abs/ar.pdf"), dict(ONE, file="../ar.pdf"), dict(ONE, extra="x")):
            with self.subTest(bad=bad), self.assertRaises(ManifestError):
                load_manifest(self.write([bad]))

    def test_missing_manifest_and_missing_files(self):
        with self.assertRaisesRegex(ManifestError, "no manifest at"):
            load_manifest(self.paths.manifest)
        manifest = load_manifest(self.write([ONE, OTHER]))
        self.paths.corpus.joinpath("synthetic-cements").mkdir(parents=True)
        self.paths.corpus.joinpath("synthetic-cements/ar-2025-26.pdf").write_bytes(b"%PDF-")
        self.assertEqual(missing_files(manifest, self.paths.corpus), ["other-metals/ar-2025-26.pdf"])


class RunFolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))

    def test_new_run_is_timestamped_and_labelled(self):
        when = datetime(2026, 10, 16, 9, 30, 5, tzinfo=timezone.utc)
        run = self.paths.new_run("baseline", now=when)
        self.assertEqual(run, self.paths.runs / "20261016T093005Z-baseline")
        self.assertTrue(run.is_dir())
        with self.assertRaises(FileExistsError):
            self.paths.new_run("baseline", now=when)

    def test_resolve_latest_name_and_path(self):
        first = self.paths.new_run(now=datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
        second = self.paths.new_run(now=datetime(2026, 10, 16, 10, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(self.paths.resolve_run("latest"), second)
        self.assertEqual(self.paths.resolve_run(first.name), first)
        self.assertEqual(self.paths.resolve_run(str(first)), first)
        with self.assertRaises(FileNotFoundError):
            self.paths.resolve_run("20000101T000000Z")

    def test_latest_with_no_runs(self):
        with self.assertRaises(FileNotFoundError):
            self.paths.resolve_run("latest")


class NormaliseTests(unittest.TestCase):
    def test_matches_the_api_normalisation(self):
        # apps/api/src/financials/stitch.ts normalise(): lower-case, & → and, drop punctuation, collapse spaces.
        self.assertEqual(normalise("  Property, Plant & Equipment  "), "property plant and equipment")
        self.assertEqual(normalise("Profit/(Loss) for the year (XI + XIV)"), "profit loss for the year xi xiv")
        self.assertEqual(normalise("Earnings per share – Basic (₹)"), "earnings per share basic")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_manifest -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.manifest'`

- [ ] **Step 3: Write the modules**

`apps/eval/src/maester_eval/paths.py` (replace the whole file):

```python
"""Where the harness reads and writes. Everything lives under the repository's data/eval."""

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# apps/eval/src/maester_eval/paths.py → the repository root.
ROOT = Path(__file__).resolve().parents[4]
CONCEPTS_PATH = ROOT / "packages" / "contracts" / "concepts.json"


@dataclass(frozen=True)
class EvalPaths:
    base: Path

    @property
    def manifest(self) -> Path:
        return self.base / "manifest.json"

    @property
    def corpus(self) -> Path:
        return self.base / "corpus"

    @property
    def gold(self) -> Path:
        return self.base / "gold"

    @property
    def sheets(self) -> Path:
        return self.base / "sheets"

    @property
    def runs(self) -> Path:
        return self.base / "runs"

    def new_run(self, label: str | None = None, now: datetime | None = None) -> Path:
        """A fresh run folder named by UTC time, `20261016T093005Z[-label]`. Never reuses one."""
        stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
        path = self.runs / (f"{stamp}-{label}" if label else stamp)
        path.mkdir(parents=True, exist_ok=False)
        return path

    def resolve_run(self, name_or_path: str) -> Path:
        """`latest`, a run folder's name, or a path to one."""
        if name_or_path == "latest":
            runs = sorted(p for p in self.runs.glob("*") if p.is_dir()) if self.runs.is_dir() else []
            if not runs:
                raise FileNotFoundError(f"no runs under {self.runs}")
            return runs[-1]
        candidate = self.runs / name_or_path
        if candidate.is_dir():
            return candidate
        given = Path(name_or_path)
        if given.is_dir():
            return given
        raise FileNotFoundError(f"no run {name_or_path!r} under {self.runs}")


DEFAULT = EvalPaths(ROOT / "data" / "eval")
```

`apps/eval/src/maester_eval/text.py`:

```python
"""Label normalisation, the same as apps/api/src/financials/stitch.ts `normalise`."""

import re

_NOT_WORD = re.compile(r"[^\w\s]|_")
_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Lower-case, "&" as "and", punctuation dropped, whitespace collapsed."""
    return _SPACES.sub(" ", _NOT_WORD.sub(" ", text.lower().replace("&", " and "))).strip()
```

`apps/eval/src/maester_eval/manifest.py`:

```python
"""The corpus manifest: which filings exist, whose they are, and which set each belongs to.

A company is in one set only, so nothing tuned on `dev` has seen a `heldout` filing.
"""

from datetime import date
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

FilingKind = Literal["annual_report", "financial_results"]
EvalSet = Literal["dev", "heldout"]
SetChoice = Literal["dev", "heldout", "all"]


class ManifestError(ValueError):
    pass


class Filing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet

    @property
    def id(self) -> str:
        return re.sub(r"\.pdf$", "", self.file, flags=re.IGNORECASE)

    @field_validator("file")
    @classmethod
    def _relative_pdf(cls, value: str) -> str:
        parts = Path(value).parts
        if value.startswith("/") or ".." in parts or len(parts) < 2 or not value.lower().endswith(".pdf"):
            raise ValueError("file must be `<company-folder>/<name>.pdf`, relative to the corpus")
        return value

    @field_validator("period_end")
    @classmethod
    def _iso_date(cls, value: str) -> str:
        date.fromisoformat(value)
        return value


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filings: list[Filing]

    def by_id(self) -> dict[str, Filing]:
        return {f.id: f for f in self.filings}

    def select(self, eval_set: SetChoice = "all", only: list[str] | None = None) -> list[Filing]:
        chosen = [f for f in self.filings if eval_set == "all" or f.set == eval_set]
        if only:
            known = self.by_id()
            unknown = [i for i in only if i not in known]
            if unknown:
                raise ManifestError(f"not in the manifest: {', '.join(unknown)}")
            chosen = [f for f in chosen if f.id in set(only)]
        return chosen


def load_manifest(path: Path) -> Manifest:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        raise ManifestError(f"no manifest at {path}") from None
    try:
        manifest = Manifest.model_validate(data)
    except ValidationError as exc:
        raise ManifestError(str(exc)) from None
    ids = [f.id for f in manifest.filings]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ManifestError(f"duplicate filing ids: {', '.join(duplicates)}")
    sets: dict[str, set[str]] = {}
    for filing in manifest.filings:
        sets.setdefault(filing.company, set()).add(filing.set)
    mixed = sorted(company for company, members in sets.items() if len(members) > 1)
    if mixed:
        raise ManifestError(f"a company must be in one set only: {', '.join(mixed)}")
    return manifest


def missing_files(manifest: Manifest, corpus: Path) -> list[str]:
    return [f.file for f in manifest.filings if not (corpus / f.file).is_file()]
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked python -m unittest tests.test_eval_manifest tests.test_concepts_json -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/paths.py apps/eval/src/maester_eval/manifest.py apps/eval/src/maester_eval/text.py tests/test_eval_manifest.py
git commit -m "feat(eval): the corpus manifest, run folders and label normalisation" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Artefacts, the counting model and `live`

**Files:**
- Create: `apps/eval/src/maester_eval/artefacts.py`, `apps/eval/src/maester_eval/runner.py`
- Modify: `apps/eval/src/maester_eval/cli.py`
- Test: `tests/test_eval_live.py`

**Interfaces:**
- Consumes: `Filing`, `Manifest`, `EvalPaths` (Task 3); `run_extraction`, `ExtractionError`, `WorkflowSettings`, `PIPELINE_VERSION` from `pdf_financial_qa.workflow`; `PROMPT_VERSION` from `pdf_financial_qa.workflow.prompts`; `PdfDocument` from `pdf_financial_qa.workflow.pdf`.
- Produces:
  - `ModelCalls(locate, extract, correct)` with `.total`; `ArtefactError(code, retryable, message)`; `Artefact(filing_id, file, company, kind, period_end, set, pipeline_version, prompt_version, model, started_at, seconds, bytes, model_calls, pages_without_text, result: dict | None, error: ArtefactError | None)`.
  - `artefact_path(run_dir, filing_id) -> Path` (`run_dir/artefacts/<filing_id>.json`), `write_artefact(run_dir, artefact) -> Path`, `read_artefacts(run_dir) -> list[Artefact]` (sorted by filing id), `read_run(run_dir) -> dict` (`run.json`).
  - `CountingModel(inner)`; `pages_without_text(pdf: bytes) -> list[int]`; `run_filing(filing, pdf, model_factory, settings) -> Artefact`; `run_live(filings, corpus, run_dir, model_factory, settings, eval_set, log=print) -> list[Artefact]`; `gemini_model_factory() -> Callable[[], ExtractionModel]`; `EvalConfigError(RuntimeError)`.
  - CLI: `maester-eval live [--set dev|heldout|all] [--only ID ...] [--label NAME]`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_live.py
"""Live mode with a scripted model: artefacts, counts, timings, failures. Offline."""

import json
from pathlib import Path
import tempfile
import unittest

from test_extraction_workflow import FAST, PDF, ScriptedModel

from maester_eval.artefacts import artefact_path, read_artefacts, read_run
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.runner import CountingModel, pages_without_text, run_filing, run_live
from pdf_financial_qa.workflow import PIPELINE_VERSION
from pdf_financial_qa.workflow.model import LocateOutput
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")


class RunFilingTests(unittest.TestCase):
    def test_a_read_filing_keeps_the_wire_result_counts_and_pages(self):
        model = ScriptedModel()
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        self.assertEqual(artefact.filing_id, "synthetic-industries/ar-2025-26")
        self.assertEqual((artefact.pipeline_version, artefact.prompt_version, artefact.model),
                         (PIPELINE_VERSION, PROMPT_VERSION, "scripted-model"))
        self.assertIsNone(artefact.error)
        self.assertEqual(artefact.result["state"], "complete")  # the scanned cash flow still reads; only its text check is null
        self.assertIn("reportedLabel", artefact.result["facts"][0])  # the extractor's wire names, unchanged
        self.assertEqual(artefact.model_calls.locate, 1)
        self.assertEqual(artefact.model_calls.extract, model.count("extract"))
        self.assertEqual(artefact.pages_without_text, [3])  # page 4 of the fixture has no text layer
        self.assertEqual(artefact.bytes, len(PDF))
        self.assertGreaterEqual(artefact.seconds, 0)

    def test_a_failed_filing_keeps_the_code_and_no_result(self):
        model = ScriptedModel(locate=[LocateOutput(statements=[])])
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        self.assertIsNone(artefact.result)
        self.assertEqual(artefact.error.code, "NO_STATEMENTS_FOUND")
        self.assertFalse(artefact.error.retryable)
        self.assertEqual(artefact.model_calls.total, 1)

    def test_an_unreadable_pdf_is_an_error_artefact(self):
        artefact = run_filing(FILING, b"not a pdf", lambda: ScriptedModel(), FAST)
        self.assertEqual(artefact.error.code, "UNREADABLE_PDF")
        self.assertEqual(artefact.pages_without_text, [])


class CountingModelTests(unittest.TestCase):
    def test_counts_each_kind_and_keeps_the_name(self):
        inner = ScriptedModel()
        counting = CountingModel(inner)
        counting.locate(PDF, 4)
        counting.extract(PDF, 1, "balance_sheet", "consolidated")
        counting.extract(PDF, 1, "income_statement", "consolidated")
        self.assertEqual(counting.name, "scripted-model")
        self.assertEqual((counting.calls.locate, counting.calls.extract, counting.calls.correct), (1, 2, 0))
        self.assertEqual(counting.calls.total, 3)


class PagesWithoutTextTests(unittest.TestCase):
    def test_lists_scanned_pages(self):
        self.assertEqual(pages_without_text(PDF), [3])
        self.assertEqual(pages_without_text(b"garbage"), [])


class RunLiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        (self.paths.corpus / "synthetic-industries").mkdir(parents=True)
        (self.paths.corpus / FILING.file).write_bytes(PDF)
        self.second = Filing(file="synthetic-industries/ar-2024-25.pdf", company="Synthetic Industries Limited",
                             kind="annual_report", period_end="2025-03-31", set="dev")
        (self.paths.corpus / self.second.file).write_bytes(b"not a pdf")
        self.log: list[str] = []

    def test_writes_an_artefact_per_filing_and_a_run_record(self):
        run_dir = self.paths.new_run("test")
        artefacts = run_live([FILING, self.second], self.paths.corpus, run_dir, lambda: ScriptedModel(), FAST,
                             eval_set="dev", log=self.log.append)
        self.assertEqual([a.filing_id for a in artefacts], [FILING.id, self.second.id])
        self.assertTrue(artefact_path(run_dir, FILING.id).is_file())
        saved = read_artefacts(run_dir)
        self.assertEqual([a.filing_id for a in saved], sorted([FILING.id, self.second.id]))
        self.assertEqual(saved[0].error.code, "UNREADABLE_PDF")  # ar-2024-25 sorts first
        record = read_run(run_dir)
        self.assertEqual(record["set"], "dev")
        self.assertEqual(record["pipeline_version"], PIPELINE_VERSION)
        self.assertEqual(record["filings"], [FILING.id, self.second.id])
        self.assertIn("finished_at", record)
        self.assertEqual(json.loads(artefact_path(run_dir, FILING.id).read_text())["filing_id"], FILING.id)

    def test_console_lines_carry_ids_codes_and_counts_only(self):
        run_dir = self.paths.new_run("test")
        run_live([FILING, self.second], self.paths.corpus, run_dir, lambda: ScriptedModel(), FAST,
                 eval_set="dev", log=self.log.append)
        joined = "\n".join(self.log)
        self.assertIn(f"{FILING.id}: complete", joined)
        self.assertIn(f"{self.second.id}: UNREADABLE_PDF", joined)
        self.assertIn("model calls", joined)
        for text in ("Total assets", "1,200", "Revenue"):  # never a label or a figure
            self.assertNotIn(text, joined)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_live -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.artefacts'`

- [ ] **Step 3: Write `artefacts.py`**

```python
# apps/eval/src/maester_eval/artefacts.py
"""One filing's extraction as the harness keeps it: the extractor's wire result or its
error, with timings and model call counts. Phase 1's replay mode reads these, so the
result is `ExtractionResult.to_wire()` unchanged (camelCase field names)."""

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from maester_eval.manifest import EvalSet, FilingKind


class ModelCalls(BaseModel):
    locate: int = 0
    extract: int = 0
    correct: int = 0

    @property
    def total(self) -> int:
        return self.locate + self.extract + self.correct


class ArtefactError(BaseModel):
    code: str
    retryable: bool
    message: str


class Artefact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing_id: str
    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet
    pipeline_version: str
    prompt_version: str
    model: str
    started_at: str
    seconds: float
    bytes: int
    model_calls: ModelCalls
    # 0-based pages of the PDF with no text layer (scans). Empty for an unreadable file.
    pages_without_text: list[int]
    result: dict | None
    error: ArtefactError | None


def artefact_path(run_dir: Path, filing_id: str) -> Path:
    return run_dir / "artefacts" / f"{filing_id}.json"


def write_artefact(run_dir: Path, artefact: Artefact) -> Path:
    path = artefact_path(run_dir, artefact.filing_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(artefact.model_dump(mode="json"), ensure_ascii=False, indent=1))
    return path


def read_artefacts(run_dir: Path) -> list[Artefact]:
    folder = run_dir / "artefacts"
    if not folder.is_dir():
        return []
    return [Artefact.model_validate(json.loads(p.read_text())) for p in sorted(folder.rglob("*.json"))]


def write_run(run_dir: Path, record: dict) -> None:
    (run_dir / "run.json").write_text(json.dumps(record, indent=1))


def read_run(run_dir: Path) -> dict:
    return json.loads((run_dir / "run.json").read_text())
```

- [ ] **Step 4: Write `runner.py`**

```python
# apps/eval/src/maester_eval/runner.py
"""Live mode: run the extraction workflow over corpus filings and keep an artefact per filing.

The workflow runs in-process with the same model the extractor builds from the same
variables, so a run measures the configuration the product runs, and the harness can
count model calls, which the wire format does not carry.
"""

from collections.abc import Callable
from datetime import datetime, timezone
import os
from pathlib import Path
import threading
import time

from pdf_financial_qa.workflow import PIPELINE_VERSION, ExtractionError, ExtractionModel, WorkflowSettings, run_extraction
from pdf_financial_qa.workflow.model import ExtractedSection, LocateOutput, StatementOutput
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

from maester_eval.artefacts import Artefact, ArtefactError, ModelCalls, write_artefact, write_run
from maester_eval.manifest import Filing, SetChoice

ModelFactory = Callable[[], ExtractionModel]
Log = Callable[[str], None]


class EvalConfigError(RuntimeError):
    pass


class CountingModel:
    """Counts the workflow's calls on the real model. Thread-safe: statement branches run in parallel."""

    def __init__(self, inner: ExtractionModel) -> None:
        self._inner = inner
        self.name = inner.name
        self.calls = ModelCalls()
        self._lock = threading.Lock()

    def _count(self, kind: str) -> None:
        with self._lock:
            setattr(self.calls, kind, getattr(self.calls, kind) + 1)

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput:
        self._count("locate")
        return self._inner.locate(pdf, page_count)

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput:
        self._count("extract")
        return self._inner.extract(pdf, page_count, statement, basis)

    def correct(self, pdf: bytes, page_count: int, statement: str, basis: str,
                section: ExtractedSection, problems: list[str]) -> ExtractedSection:
        self._count("correct")
        return self._inner.correct(pdf, page_count, statement, basis, section, problems)


def pages_without_text(pdf: bytes) -> list[int]:
    """0-based pages with no text layer; empty when the file cannot be opened at all."""
    try:
        doc = PdfDocument.load(pdf)
    except ExtractionError:
        return []
    return [i for i, text in enumerate(doc.page_texts) if not text.strip()]


def run_filing(filing: Filing, pdf: bytes, model_factory: ModelFactory, settings: WorkflowSettings) -> Artefact:
    started = datetime.now(timezone.utc)
    clock = time.monotonic()
    model = CountingModel(model_factory())
    result = error = None
    try:
        result = run_extraction(pdf, model=model, company_name=filing.company, settings=settings).to_wire()
    except ExtractionError as exc:
        error = ArtefactError(code=exc.code, retryable=exc.retryable, message=exc.message)
    return Artefact(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
        period_end=filing.period_end, set=filing.set,
        pipeline_version=PIPELINE_VERSION, prompt_version=PROMPT_VERSION, model=model.name,
        started_at=started.isoformat(), seconds=round(time.monotonic() - clock, 1), bytes=len(pdf),
        model_calls=model.calls, pages_without_text=pages_without_text(pdf), result=result, error=error,
    )


def run_live(filings: list[Filing], corpus: Path, run_dir: Path, model_factory: ModelFactory,
             settings: WorkflowSettings, eval_set: SetChoice, log: Log = print) -> list[Artefact]:
    """Reads each filing in turn and writes its artefact as soon as it is done, so a run
    stopped half-way keeps what it read. The console gets ids, outcomes and counts only."""
    record = {
        "run": run_dir.name, "started_at": datetime.now(timezone.utc).isoformat(), "set": eval_set,
        "pipeline_version": PIPELINE_VERSION, "prompt_version": PROMPT_VERSION,
        "settings": {"deadline_seconds": settings.deadline_seconds, "max_model_calls": settings.max_model_calls},
        "filings": [f.id for f in filings],
    }
    write_run(run_dir, record)
    artefacts: list[Artefact] = []
    for filing in filings:
        log(f"{filing.id}: reading…")
        artefact = run_filing(filing, (corpus / filing.file).read_bytes(), model_factory, settings)
        write_artefact(run_dir, artefact)
        outcome = artefact.result["state"] if artefact.result else artefact.error.code
        log(f"{filing.id}: {outcome} in {artefact.seconds}s, {artefact.model_calls.total} model calls")
        artefacts.append(artefact)
    record["finished_at"] = datetime.now(timezone.utc).isoformat()
    record["model"] = artefacts[0].model if artefacts else None
    write_run(run_dir, record)
    return artefacts


def gemini_model_factory() -> ModelFactory:
    """The model the extractor runs, from the same variables (apps/extractor settings.py)."""
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise EvalConfigError("GOOGLE_CLOUD_PROJECT is not set; copy .env.example to .env and fill it in")
    location = os.environ.get("VERTEX_LOCATION") or "us-central1"
    model_name = os.environ.get("GEMINI_MODEL") or "gemini-2.5-pro"
    from pdf_financial_qa.workflow.model import GeminiExtractionModel

    instance = GeminiExtractionModel(project=project, location=location, model=model_name)
    return lambda: instance


def workflow_settings_from_env() -> WorkflowSettings:
    return WorkflowSettings(deadline_seconds=float(os.environ.get("EXTRACT_DEADLINE_SECONDS", "840")))
```

- [ ] **Step 5: Add the `live` command to `cli.py`**

Append to `apps/eval/src/maester_eval/cli.py`:

```python
from typing import Annotated, Optional

from maester_eval.manifest import ManifestError, load_manifest
from maester_eval.paths import DEFAULT
from maester_eval.runner import EvalConfigError, gemini_model_factory, run_live, workflow_settings_from_env


def _fail(message: str) -> None:
    console.print(f"[red]{message}[/red]")
    raise typer.Exit(1)


@app.command()
def live(
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "dev",
    only: Annotated[Optional[list[str]], typer.Option("--only", help="A filing id; repeatable.")] = None,
    label: Annotated[Optional[str], typer.Option(help="A word for the run folder's name.")] = None,
) -> None:
    """Read the set's filings with the real model and keep an artefact per filing. Costs model calls."""
    if eval_set not in ("dev", "heldout", "all"):
        _fail("--set must be dev, heldout or all")
    try:
        manifest = load_manifest(DEFAULT.manifest)
        filings = manifest.select(eval_set, only)  # type: ignore[arg-type]
    except ManifestError as exc:
        _fail(str(exc))
    absent = [f.file for f in filings if not (DEFAULT.corpus / f.file).is_file()]
    if absent:
        _fail("missing under data/eval/corpus: " + ", ".join(absent))
    if not filings:
        _fail("nothing to read: the selection is empty")
    try:
        factory = gemini_model_factory()
    except EvalConfigError as exc:
        _fail(str(exc))
    run_dir = DEFAULT.new_run(label)
    console.print(f"run {run_dir.name}: {len(filings)} filing(s), set {eval_set}")
    artefacts = run_live(filings, DEFAULT.corpus, run_dir, factory, workflow_settings_from_env(), eval_set, log=console.print)  # type: ignore[arg-type]
    read = sum(1 for a in artefacts if a.result)
    console.print(f"done: {read} read, {len(artefacts) - read} failed → {run_dir}")
```

- [ ] **Step 6: Run the tests**

Run: `uv run --locked python -m unittest tests.test_eval_live tests.test_eval_cli -v`
Expected: PASS. Then `uv run --locked maester-eval live --help` shows `--set`, `--only`, `--label`.

- [ ] **Step 7: Commit**

```bash
git add apps/eval/src/maester_eval/artefacts.py apps/eval/src/maester_eval/runner.py apps/eval/src/maester_eval/cli.py tests/test_eval_live.py
git commit -m "feat(eval): live mode writes one artefact per filing with counts and timings" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `export`: labelling sheets from a run

**Files:**
- Create: `apps/eval/src/maester_eval/sheets.py`
- Modify: `apps/eval/src/maester_eval/cli.py`
- Test: `tests/test_eval_sheets.py`

**Interfaces:**
- Consumes: `Artefact`, `read_artefacts` (Task 4), `normalise` (Task 3).
- Produces: `SHEET_COLUMNS: list[str]`; `sheet_rows(artefact) -> list[dict[str, str]]`; `sheet_path(sheets_dir, filing_id) -> Path`; `write_sheet(path, rows) -> None` (UTF-8 with BOM); `export_run(run_dir, sheets_dir, only=None, force=False) -> tuple[list[Path], list[Path]]` (written, skipped); `MATERIAL_HINT`.
- CLI: `maester-eval export --run RUN [--only ID ...] [--force]`.

The sheet is what a person corrects against the PDF. Columns, in order:

| Column | Filled by export | The person |
| --- | --- | --- |
| `row` | 1-based index of the fact in the artefact | leave blank on a row added by hand |
| `statement`, `basis`, `section`, `label`, `period_label` | as read | required on a hand-added row |
| `period_end` | as read (may be blank) | `gold_period_end` overrides |
| `printed`, `value`, `unit_label`, `scale_factor`, `normalized_value` | as read | read-only; corrections go in `gold_text` and `gold_scale` |
| `page` | 1-based page, as a person counts | `gold_page` overrides |
| `text_layer_match`, `is_subtotal` | as read | read-only |
| `material` | `yes` when the label looks like a total, revenue, profit, cash, borrowings or earnings per share: a hint to find the rows worth labelling first, nothing more | tick or untick freely |
| `concept` | blank | a taxonomy id; required to keep the row |
| `gold_text` | blank | the figure exactly as the page prints it, when `printed` is wrong |
| `gold_scale` | blank | the scale factor when the unit was misread (`10000000` for crore, `100000` for lakh, `1` for actuals) |
| `gold_page` | blank | the 1-based page when `page` is wrong |
| `gold_period_end` | blank | ISO date when `period_end` is blank or wrong |
| `adds_up` | blank | `yes` or `no` on a subtotal row, when checked by hand |
| `verified` | blank | `yes` once the row is checked against the PDF; only these rows are frozen |
| `note` | blank, or `extraction failed: CODE` on the single row of a failed filing | anything |

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_sheets.py
"""Export: artefacts become labelling sheets. Offline."""

import csv
from pathlib import Path
import tempfile
import unittest

from test_extraction_workflow import FAST, PDF, ScriptedModel

from maester_eval.artefacts import write_artefact
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.runner import run_filing
from maester_eval.sheets import SHEET_COLUMNS, export_run, sheet_path, sheet_rows

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")


class SheetRowTests(unittest.TestCase):
    def setUp(self):
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)

    def test_one_row_per_fact_in_order_with_pages_counted_from_one(self):
        rows = sheet_rows(self.artefact)
        self.assertEqual(len(rows), len(self.artefact.result["facts"]))
        self.assertEqual([r["row"] for r in rows][:3], ["1", "2", "3"])
        first = rows[0]
        self.assertEqual(list(first), SHEET_COLUMNS)
        self.assertEqual(first["label"], "Cash")
        self.assertEqual(first["printed"], "1,200")
        self.assertEqual(first["value"], "1200")
        self.assertEqual(first["scale_factor"], "10000000")
        self.assertEqual(first["normalized_value"], "12000000000")
        self.assertEqual(first["page"], "2")  # page_index 1 → page 2
        self.assertEqual(first["text_layer_match"], "yes")
        for blank in ("concept", "gold_text", "gold_scale", "gold_page", "gold_period_end", "adds_up", "verified"):
            self.assertEqual(first[blank], "")

    def test_material_hint_marks_totals_and_profit(self):
        by_label = {r["label"]: r["material"] for r in sheet_rows(self.artefact)}
        self.assertEqual(by_label["Total assets"], "yes")
        self.assertEqual(by_label["Profit"], "yes")
        self.assertEqual(by_label["Inventories"], "")

    def test_a_failed_filing_gives_one_note_row(self):
        from pdf_financial_qa.workflow.model import LocateOutput
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        rows = sheet_rows(failed)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["note"], "extraction failed: NO_STATEMENTS_FOUND")
        self.assertEqual(rows[0]["label"], "")


class ExportRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.run_dir = self.paths.new_run("test")
        write_artefact(self.run_dir, run_filing(FILING, PDF, lambda: ScriptedModel(), FAST))

    def test_writes_a_sheet_with_a_bom_and_never_overwrites_without_force(self):
        written, skipped = export_run(self.run_dir, self.paths.sheets)
        path = sheet_path(self.paths.sheets, FILING.id)
        self.assertEqual((written, skipped), ([path], []))
        self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"))
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(list(rows[0]), SHEET_COLUMNS)
        path.write_text("edited by a person")
        self.assertEqual(export_run(self.run_dir, self.paths.sheets), ([], [path]))
        self.assertEqual(path.read_text(), "edited by a person")
        self.assertEqual(export_run(self.run_dir, self.paths.sheets, force=True), ([path], []))
        self.assertNotEqual(path.read_text(), "edited by a person")

    def test_only_limits_the_export(self):
        self.assertEqual(export_run(self.run_dir, self.paths.sheets, only=["someone/else"]), ([], []))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_sheets -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.sheets'`

- [ ] **Step 3: Write `sheets.py`**

```python
# apps/eval/src/maester_eval/sheets.py
"""Export: an artefact becomes a CSV sheet a person corrects against the PDF.

The sheet carries what the pipeline read, one row per fact, with blank columns for the
person's concept, corrections and verdict. `material` is only a hint for where to start:
every kept row is checked by a person, and phase 1's mapping replaces the hint."""

import csv
from pathlib import Path
import re

from maester_eval.artefacts import Artefact, read_artefacts
from maester_eval.text import normalise

SHEET_COLUMNS = [
    "row", "statement", "basis", "section", "label", "period_label", "period_end",
    "printed", "value", "unit_label", "scale_factor", "normalized_value", "page",
    "text_layer_match", "is_subtotal", "material",
    "concept", "gold_text", "gold_scale", "gold_page", "gold_period_end", "adds_up", "verified", "note",
]

# Labelling aid only: rows worth checking first. Not a mapping; see the module docstring.
MATERIAL_HINT = re.compile(
    r"\btotal\b|revenue from operations|\bprofit\b|\bloss\b|earnings? per|cash and cash equivalents"
    r"|\bborrowings?\b|net cash|finance costs?|\bdividend"
)


def _yes(value: bool | None) -> str:
    return "" if value is None else ("yes" if value else "no")


def sheet_rows(artefact: Artefact) -> list[dict[str, str]]:
    blank = {column: "" for column in SHEET_COLUMNS}
    if artefact.result is None:
        code = artefact.error.code if artefact.error else "unknown"
        return [dict(blank, note=f"extraction failed: {code}")]
    rows = []
    for index, fact in enumerate(artefact.result["facts"], start=1):
        rows.append(dict(
            blank,
            row=str(index), statement=fact["statement"], basis=fact["basis"], section=fact["section"],
            label=fact["reportedLabel"], period_label=fact["periodLabel"], period_end=fact["periodEnd"] or "",
            printed=fact["reportedText"], value=fact["reportedValue"] or "", unit_label=fact["unitLabel"] or "",
            scale_factor=fact["scaleFactor"] or "", normalized_value=fact["normalizedValue"] or "",
            page=str(fact["pageIndex"] + 1), text_layer_match=_yes(fact["textLayerMatch"]),
            is_subtotal=_yes(fact["isSubtotal"]),
            material="yes" if MATERIAL_HINT.search(normalise(fact["reportedLabel"])) else "",
        ))
    return rows


def sheet_path(sheets_dir: Path, filing_id: str) -> Path:
    return sheets_dir / f"{filing_id}.csv"


def write_sheet(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # A BOM so spreadsheet applications read the UTF-8 (₹ in unit notes) correctly.
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SHEET_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def export_run(run_dir: Path, sheets_dir: Path, only: list[str] | None = None, force: bool = False) -> tuple[list[Path], list[Path]]:
    """Writes a sheet per artefact. A sheet that exists is a person's work: skipped unless `force`."""
    written: list[Path] = []
    skipped: list[Path] = []
    for artefact in read_artefacts(run_dir):
        if only and artefact.filing_id not in only:
            continue
        path = sheet_path(sheets_dir, artefact.filing_id)
        if path.exists() and not force:
            skipped.append(path)
            continue
        write_sheet(path, sheet_rows(artefact))
        written.append(path)
    return written, skipped
```

- [ ] **Step 4: Add the `export` command**

Append to `cli.py`:

```python
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
    written, skipped = export_run(run_dir, DEFAULT.sheets, only, force)
    for path in written:
        console.print(f"wrote {path.relative_to(DEFAULT.base)}")
    for path in skipped:
        console.print(f"kept  {path.relative_to(DEFAULT.base)} (exists; --force to overwrite)")
    console.print(f"{len(written)} written, {len(skipped)} kept")
```

- [ ] **Step 5: Run the tests**

Run: `uv run --locked python -m unittest tests.test_eval_sheets -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/eval/src/maester_eval/sheets.py apps/eval/src/maester_eval/cli.py tests/test_eval_sheets.py
git commit -m "feat(eval): export labelling sheets from a run" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `freeze`: a checked sheet becomes gold

**Files:**
- Create: `apps/eval/src/maester_eval/gold.py`
- Modify: `apps/eval/src/maester_eval/cli.py`
- Test: `tests/test_eval_gold.py`

**Interfaces:**
- Consumes: `Taxonomy`, `load_taxonomy` (Task 2); `Filing` (Task 3); `SHEET_COLUMNS`, `sheet_path` (Task 5); `parse_reported`, `format_decimal` from `pdf_financial_qa.workflow.values`.
- Produces:
  - `GoldFact(concept, statement, basis, section, label, period_label, period_end: str | None, span: str | None = None, printed, value_status: "value" | "dash", value: str | None, scale: str | None, normalized_value: str | None, page_index: int, dimensions: dict[str, str] = {})`.
  - `ExpectedCheck(concept, basis, period_label, adds_up: bool)`.
  - `GoldFiling(filing_id, file, company, kind, period_end, set, taxonomy_version, frozen_at, exported_from: dict | None, facts, expected_checks)`.
  - `FreezeError(ValueError)` with the row number in its message; `freeze_sheet(rows, filing, taxonomy, frozen_at, exported_from=None) -> GoldFiling`; `read_sheet(path) -> list[dict[str, str]]`; `gold_path(gold_dir, filing_id) -> Path`; `write_gold(gold_dir, gold, force=False) -> Path`; `read_gold(gold_dir) -> dict[str, GoldFiling]` keyed by filing id.
  - CLI: `maester-eval freeze FILING_ID [--run RUN] [--force]`.

Freeze rules (each is a test below): a row is kept only when `verified` is `yes`; a kept row needs `concept` in the taxonomy, `statement`, `basis`, `label`, `period_label` and a figure (`gold_text`, else `printed`); the figure is parsed with `parse_reported` (`unparsed` is an error naming the row); the scale is `gold_scale`, else `scale_factor`, and must be a whole number string (a `monetary` concept with a `value` and no scale is an error); a `per_share` or `count` concept is always scale `1`; `normalized_value` is `value × scale`, exact; `page_index` is `gold_page`, else `page`, 1-based in the sheet, whole; `period_end` is `gold_period_end`, else `period_end`, else null; two kept rows with the same (concept, basis, period_label, dimensions) are an error; a row with no `row` value is a hand-added row and follows the same rules.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_gold.py
"""Freeze: a checked sheet becomes a gold file. Offline."""

import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from maester_eval.concepts import load_taxonomy
from maester_eval.gold import FreezeError, freeze_sheet, gold_path, read_gold, read_sheet, write_gold
from maester_eval.manifest import Filing
from maester_eval.sheets import SHEET_COLUMNS

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
TAXONOMY = load_taxonomy()


def row(**values):
    base = {column: "" for column in SHEET_COLUMNS}
    base.update(row="1", statement="balance_sheet", basis="consolidated", section="Assets", label="Total assets",
                period_label="As at 31 March 2026", period_end="2026-03-31", printed="2,000", value="2000",
                scale_factor="10000000", page="2")
    base.update(values)
    return base


class FreezeTests(unittest.TestCase):
    def test_keeps_verified_rows_only_and_computes_the_normalised_value(self):
        rows = [row(concept="total_assets", verified="yes"), row(row="2", label="Inventories", printed="800", value="800")]
        gold = freeze_sheet(rows, FILING, TAXONOMY, WHEN)
        self.assertEqual(gold.filing_id, FILING.id)
        self.assertEqual(gold.taxonomy_version, 1)
        self.assertEqual(len(gold.facts), 1)
        fact = gold.facts[0]
        self.assertEqual((fact.concept, fact.value_status, fact.value, fact.scale, fact.normalized_value, fact.page_index),
                         ("total_assets", "value", "2000", "10000000", "20000000000", 1))
        self.assertEqual(fact.period_end, "2026-03-31")

    def test_gold_columns_override_what_was_read(self):
        rows = [row(concept="total_assets", verified="yes", gold_text="(2,100.5)", gold_scale="100000",
                    gold_page="7", gold_period_end="2026-03-30")]
        fact = freeze_sheet(rows, FILING, TAXONOMY, WHEN).facts[0]
        self.assertEqual((fact.printed, fact.value, fact.scale, fact.normalized_value, fact.page_index, fact.period_end),
                         ("(2,100.5)", "-2100.5", "100000", "-210050000", 6, "2026-03-30"))

    def test_a_dash_is_kept_as_a_dash(self):
        fact = freeze_sheet([row(concept="total_assets", verified="yes", printed="-", value="")], FILING, TAXONOMY, WHEN).facts[0]
        self.assertEqual((fact.value_status, fact.value, fact.normalized_value), ("dash", None, None))

    def test_per_share_lines_are_always_scale_one(self):
        rows = [row(concept="eps_basic", verified="yes", statement="income_statement", section="Earnings per share",
                    label="Basic", printed="12.50", value="12.50")]
        fact = freeze_sheet(rows, FILING, TAXONOMY, WHEN).facts[0]
        # format_decimal keeps the printed decimals: "12.50" stays "12.50"; Decimal compares it equal to 12.5.
        self.assertEqual((fact.scale, fact.normalized_value), ("1", "12.50"))

    def test_adds_up_becomes_an_expected_check(self):
        gold = freeze_sheet([row(concept="total_assets", verified="yes", adds_up="no")], FILING, TAXONOMY, WHEN)
        self.assertEqual(len(gold.expected_checks), 1)
        self.assertEqual((gold.expected_checks[0].concept, gold.expected_checks[0].adds_up), ("total_assets", False))

    def test_hand_added_rows_follow_the_same_rules(self):
        added = row(row="", concept="trade_payables", verified="yes", section="Current liabilities", label="Trade payables",
                    printed="", gold_text="1,23,456", page="", gold_page="3")
        fact = freeze_sheet([added], FILING, TAXONOMY, WHEN).facts[0]
        self.assertEqual((fact.value, fact.page_index), ("123456", 2))

    def test_errors_name_the_sheet_row(self):
        cases = {
            "unknown concept": row(concept="net_worth", verified="yes"),
            "cannot read": row(concept="total_assets", verified="yes", gold_text="two thousand"),
            "no scale": row(concept="total_assets", verified="yes", scale_factor=""),
            "no figure": row(concept="total_assets", verified="yes", printed="", gold_text=""),
            "page": row(concept="total_assets", verified="yes", gold_page="0"),
            "period label": row(concept="total_assets", verified="yes", period_label=""),
        }
        for expected, bad in cases.items():
            with self.subTest(expected=expected), self.assertRaisesRegex(FreezeError, rf"sheet row 2: .*{expected}"):
                freeze_sheet([bad], FILING, TAXONOMY, WHEN)

    def test_two_rows_for_one_key_are_refused(self):
        rows = [row(concept="total_assets", verified="yes"), row(row="2", concept="total_assets", verified="yes", page="3")]
        with self.assertRaisesRegex(FreezeError, "sheet row 3: .*already has total_assets"):
            freeze_sheet(rows, FILING, TAXONOMY, WHEN)

    def test_sheet_saved_by_a_spreadsheet_app(self):
        # A BOM, a figure the application reformatted, a page it turned into a float.
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "sheet.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=SHEET_COLUMNS)
            writer.writeheader()
            writer.writerow(row(concept="total_assets", verified="YES", gold_text="1,200.0", page="7.0"))
        rows = read_sheet(path)
        self.assertEqual(rows[0]["row"], "1")  # the BOM did not stick to the first column's name
        fact = freeze_sheet(rows, FILING, TAXONOMY, WHEN).facts[0]
        # The trailing ".0" the application added stays in the strings; scoring compares as Decimal, so it is equal.
        self.assertEqual((fact.value, fact.normalized_value, fact.page_index), ("1200.0", "12000000000.0", 6))
        with self.assertRaisesRegex(FreezeError, "sheet row 2: .*page"):
            freeze_sheet([row(concept="total_assets", verified="yes", page="7.5")], FILING, TAXONOMY, WHEN)


class GoldFilesTests(unittest.TestCase):
    def test_write_refuses_to_overwrite_and_read_keys_by_id(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        gold_dir = Path(temp.name)
        gold = freeze_sheet([row(concept="total_assets", verified="yes")], FILING, TAXONOMY, WHEN,
                            exported_from={"run": "20261016T093005Z-baseline", "pipeline_version": "extract-2"})
        path = write_gold(gold_dir, gold)
        self.assertEqual(path, gold_path(gold_dir, FILING.id))
        self.assertEqual(json.loads(path.read_text())["exported_from"]["run"], "20261016T093005Z-baseline")
        with self.assertRaises(FileExistsError):
            write_gold(gold_dir, gold)
        write_gold(gold_dir, gold, force=True)
        loaded = read_gold(gold_dir)
        self.assertEqual(list(loaded), [FILING.id])
        self.assertEqual(loaded[FILING.id].facts[0].normalized_value, "20000000000")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_gold -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.gold'`

- [ ] **Step 3: Write `gold.py`**

```python
# apps/eval/src/maester_eval/gold.py
"""The gold set: facts a person checked against the PDF, keyed by concept.

Freeze reads a sheet (Task 5's columns) and keeps the rows marked verified. Every figure
is text parsed by the engine's own `parse_reported`, never a number a spreadsheet made.
"""

import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from maester_eval.concepts import Taxonomy
from maester_eval.manifest import EvalSet, Filing, FilingKind
from pdf_financial_qa.workflow.values import format_decimal, parse_reported

StatementKind = Literal["balance_sheet", "income_statement", "cash_flow"]
ReportingBasis = Literal["consolidated", "standalone", "unknown"]
_WHOLE = re.compile(r"^\d+$")


class FreezeError(ValueError):
    pass


class GoldFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    concept: str
    statement: StatementKind
    basis: ReportingBasis
    section: str
    label: str
    period_label: str
    period_end: str | None
    span: str | None = None
    printed: str
    value_status: Literal["value", "dash"]
    value: str | None
    scale: str | None
    normalized_value: str | None
    page_index: int
    dimensions: dict[str, str] = Field(default_factory=dict)


class ExpectedCheck(BaseModel):
    concept: str
    basis: ReportingBasis
    period_label: str
    adds_up: bool


class GoldFiling(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filing_id: str
    file: str
    company: str
    kind: FilingKind
    period_end: str
    set: EvalSet
    taxonomy_version: int
    frozen_at: str
    exported_from: dict | None
    facts: list[GoldFact]
    expected_checks: list[ExpectedCheck]


def read_sheet(path: Path) -> list[dict[str, str]]:
    """utf-8-sig: a BOM a spreadsheet application wrote is not part of the first column's name."""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return [{k: (v or "").strip() for k, v in r.items() if k is not None} for r in csv.DictReader(handle)]


def _whole(text: str, what: str, line: int) -> int:
    try:
        number = Decimal(text)
    except InvalidOperation:
        raise FreezeError(f"sheet row {line}: {what} {text!r} is not a whole number") from None
    if number != number.to_integral_value():
        raise FreezeError(f"sheet row {line}: {what} {text!r} is not a whole number")
    return int(number)


def freeze_sheet(rows: list[dict[str, str]], filing: Filing, taxonomy: Taxonomy, frozen_at: datetime,
                 exported_from: dict | None = None) -> GoldFiling:
    facts: list[GoldFact] = []
    checks: list[ExpectedCheck] = []
    seen: dict[tuple, int] = {}
    for offset, row in enumerate(rows):
        line = offset + 2  # the sheet's header is line 1
        if row.get("verified", "").lower() != "yes":
            continue
        concept = taxonomy.get(row.get("concept", ""))
        if concept is None:
            raise FreezeError(f"sheet row {line}: unknown concept {row.get('concept', '')!r}")
        for field in ("statement", "basis", "label", "period label"):
            if not row.get(field.replace(" ", "_"), ""):
                raise FreezeError(f"sheet row {line}: no {field}")
        printed = row.get("gold_text") or row.get("printed") or ""
        if not printed:
            raise FreezeError(f"sheet row {line}: no figure (printed or gold_text)")
        status, value = parse_reported(printed)
        if status == "unparsed":
            raise FreezeError(f"sheet row {line}: cannot read {printed!r} as a figure")
        if concept.kind in ("per_share", "count"):
            scale_text = "1"
        else:
            scale_text = row.get("gold_scale") or row.get("scale_factor") or ""
        if status == "value" and not _WHOLE.match(scale_text):
            raise FreezeError(f"sheet row {line}: no scale (fill gold_scale: 10000000 for crore, 100000 for lakh, 1 for actuals)")
        page_text = row.get("gold_page") or row.get("page") or ""
        page = _whole(page_text, "page", line) if page_text else 0
        if page < 1:
            raise FreezeError(f"sheet row {line}: page {page_text!r} must be 1 or more (gold_page)")
        key = (concept.id, row["basis"], row["period_label"])
        if key in seen:
            raise FreezeError(f"sheet row {line}: sheet row {seen[key]} already has {concept.id} for {row['basis']} {row['period_label']!r}")
        seen[key] = line
        normalized = format_decimal(value * Decimal(scale_text)) if value is not None else None
        try:
            facts.append(GoldFact(
                concept=concept.id, statement=row["statement"], basis=row["basis"], section=row.get("section", ""),
                label=row["label"], period_label=row["period_label"],
                period_end=row.get("gold_period_end") or row.get("period_end") or None,
                printed=printed, value_status=status, value=format_decimal(value) if value is not None else None,
                scale=scale_text if status == "value" else None, normalized_value=normalized, page_index=page - 1,
            ))
        except ValidationError as exc:  # a statement or basis outside the vocabulary, a date that is not ISO
            raise FreezeError(f"sheet row {line}: {exc.errors()[0]['msg']}") from None
        adds_up = row.get("adds_up", "").lower()
        if adds_up in ("yes", "no"):
            checks.append(ExpectedCheck(concept=concept.id, basis=row["basis"], period_label=row["period_label"], adds_up=adds_up == "yes"))
    return GoldFiling(
        filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind, period_end=filing.period_end,
        set=filing.set, taxonomy_version=taxonomy.taxonomy_version, frozen_at=frozen_at.isoformat(),
        exported_from=exported_from, facts=facts, expected_checks=checks,
    )


def gold_path(gold_dir: Path, filing_id: str) -> Path:
    return gold_dir / f"{filing_id}.json"


def write_gold(gold_dir: Path, gold: GoldFiling, force: bool = False) -> Path:
    path = gold_path(gold_dir, gold.filing_id)
    if path.exists() and not force:
        raise FileExistsError(f"{path} exists; gold is sealed, pass --force to replace it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(gold.model_dump(mode="json"), ensure_ascii=False, indent=1) + "\n")
    return path


def read_gold(gold_dir: Path) -> dict[str, GoldFiling]:
    if not gold_dir.is_dir():
        return {}
    loaded = [GoldFiling.model_validate(json.loads(p.read_text())) for p in sorted(gold_dir.rglob("*.json"))]
    return {g.filing_id: g for g in loaded}
```

- [ ] **Step 4: Add the `freeze` command**

Append to `cli.py`:

```python
from datetime import datetime, timezone

from maester_eval.artefacts import read_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import FreezeError, freeze_sheet, read_sheet, write_gold
from maester_eval.sheets import sheet_path


@app.command()
def freeze(
    filing_id: Annotated[str, typer.Argument(help="The filing id, `<company-folder>/<name>`.")],
    run: Annotated[Optional[str], typer.Option(help="The run the sheet was exported from, for provenance.")] = None,
    force: Annotated[bool, typer.Option(help="Replace a gold file that exists.")] = False,
) -> None:
    """Turn a checked sheet into data/eval/gold/<filing-id>.json. Only verified rows with a concept are kept."""
    try:
        filing = load_manifest(DEFAULT.manifest).by_id().get(filing_id)
    except ManifestError as exc:
        _fail(str(exc))
    if filing is None:
        _fail(f"{filing_id} is not in the manifest")
    path = sheet_path(DEFAULT.sheets, filing_id)
    if not path.is_file():
        _fail(f"no sheet at {path}; run `maester-eval export` first")
    exported_from = None
    if run:
        try:
            record = read_run(DEFAULT.resolve_run(run))
            exported_from = {k: record.get(k) for k in ("run", "pipeline_version", "prompt_version", "model")}
        except FileNotFoundError as exc:
            _fail(str(exc))
    try:
        gold = freeze_sheet(read_sheet(path), filing, load_taxonomy(), datetime.now(timezone.utc), exported_from)
        written = write_gold(DEFAULT.gold, gold, force)
    except (FreezeError, FileExistsError) as exc:
        _fail(str(exc))
    console.print(f"froze {len(gold.facts)} fact(s), {len(gold.expected_checks)} expected check(s) → {written.relative_to(DEFAULT.base)}")
```

- [ ] **Step 5: Run the tests**

Run: `uv run --locked python -m unittest tests.test_eval_gold -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/eval/src/maester_eval/gold.py apps/eval/src/maester_eval/cli.py tests/test_eval_gold.py
git commit -m "feat(eval): freeze a checked sheet into the gold set" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Scoring a run against the gold set

**Files:**
- Create: `apps/eval/src/maester_eval/scoring.py`
- Test: `tests/test_eval_scoring.py`

**Interfaces:**
- Consumes: `Artefact` (Task 4), `GoldFiling`, `GoldFact` (Task 6), `normalise` (Task 3).
- Produces:
  - `Outcome = Literal["match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing"]`.
  - `FactScore(concept, statement, basis, label, period_label, outcome, gold_printed, read_printed: str | None, gold_normalized: str | None, read_normalized: str | None, page_match: bool | None)`.
  - `FilingScore(filing_id, company, kind, set, scanned: bool, extracted: bool, error_code: str | None, state: str | None, facts: list[FactScore], fact_count: int, checks: dict[str, int], warnings: int, coverage: dict[str, int], seconds: float, bytes: int, model_calls: int)`.
  - `RunScore(run: str, pipeline_version: str | None, prompt_version: str | None, model: str | None, eval_set: str, filings: list[FilingScore], not_run: list[str], gold_missing: list[str])` with `.summary() -> Summary` and `.strata() -> dict[str, dict[str, Summary]]` (keys `kind`, `scanned`, `basis`, `statement`).
  - `Summary(filings, extracted, failed, gold_facts, match, wrong_value, wrong_scale, wrong_status, ambiguous, missing, page_checked, page_match, checks_passed, checks_failed, checks_not_checked, seconds_median, seconds_max, model_calls_median, model_calls_max)` with `.rate(name) -> str` ("98.1%", or "—" when the denominator is 0).
  - `score_filing(artefact, gold) -> FilingScore`; `score_run(run_name, artefacts, gold: dict[str, GoldFiling], manifest_ids: list[str], eval_set: str) -> RunScore`.

Matching, in this phase, is by statement, basis, normalised section, normalised label and normalised period label (phase 1 adds matching by concept). When no fact has the gold row's section, the section is dropped from the key, so a hand-typed section does not lose the match; two candidates with different figures are `ambiguous`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_scoring.py
"""Scoring a run against gold: outcomes, strata, the lists of what was not scored. Offline."""

from datetime import datetime, timezone
import unittest

from test_extraction_workflow import FAST, PDF, ScriptedModel

from maester_eval.concepts import load_taxonomy
from maester_eval.gold import freeze_sheet
from maester_eval.manifest import Filing
from maester_eval.runner import run_filing
from maester_eval.scoring import score_filing, score_run
from maester_eval.sheets import SHEET_COLUMNS
from pdf_financial_qa.workflow.model import LocateOutput

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
TAXONOMY = load_taxonomy()


def row(**values):
    base = {column: "" for column in SHEET_COLUMNS}
    base.update(row="1", statement="balance_sheet", basis="consolidated", section="Assets", label="Total assets",
                period_label="As at 31 March 2026", period_end="2026-03-31", printed="2,000", value="2000",
                scale_factor="10000000", page="2", verified="yes", concept="total_assets")
    base.update(values)
    return base


def gold(*rows):
    return freeze_sheet(list(rows), FILING, TAXONOMY, WHEN)


class ScoreFilingTests(unittest.TestCase):
    def setUp(self):
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)

    def outcome(self, *rows):
        return [f.outcome for f in score_filing(self.artefact, gold(*rows)).facts]

    def test_match_wrong_value_scale_status_and_missing(self):
        self.assertEqual(self.outcome(row()), ["match"])
        self.assertEqual(self.outcome(row(gold_text="2,001")), ["wrong_value"])
        self.assertEqual(self.outcome(row(gold_scale="100000")), ["wrong_scale"])
        self.assertEqual(self.outcome(row(gold_text="-")), ["wrong_status"])
        self.assertEqual(self.outcome(row(label="Goodwill", concept="goodwill")), ["missing"])

    def test_page_match_is_reported_for_found_facts(self):
        scored = score_filing(self.artefact, gold(row(), row(row="2", gold_page="9", label="Inventories", concept="inventories", printed="800")))
        self.assertEqual([f.page_match for f in scored.facts], [True, False])
        missing = score_filing(self.artefact, gold(row(label="Goodwill", concept="goodwill"))).facts[0]
        self.assertIsNone(missing.page_match)

    def test_same_label_in_two_sections_and_ambiguous_duplicates(self):
        from pdf_financial_qa.workflow.model import StatementOutput
        from test_extraction_workflow import cash_flow, income_statement, lines_section
        two_totals = StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["As at 31 March 2026"], sections=[
            lines_section("Assets", [("Total", "2,000", ())]),
            lines_section("Equity and liabilities", [("Total", "2,100", ()), ("Other", "5", ()), ("Other", "7", ())]),
        ])
        model = ScriptedModel(extract={"balance_sheet": [two_totals], "income_statement": [income_statement()],
                                       "cash_flow": [cash_flow()]})
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        scored = score_filing(artefact, gold(
            row(label="Total", section="Equity and liabilities", concept="total_equity_and_liabilities", printed="2,100"),
            row(row="2", label="Other", section="Equity and liabilities", concept="other_equity", printed="7"),
            row(row="3", label="Total", section="", concept="total_assets"),  # no section typed: both totals qualify
        ))
        self.assertEqual([f.outcome for f in scored.facts], ["match", "ambiguous", "ambiguous"])

    def test_matches_by_period_label_when_no_date_was_read(self):
        # A cash flow column headed "FY2026": no date to read, but the label matches.
        from pdf_financial_qa.workflow.model import LocatedStatement, StatementOutput
        from test_extraction_workflow import lines_section
        cash = StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["FY2026"], sections=[
            lines_section("Operating activities", [("Net cash from operations", "1,750", ())], period="FY2026", page=1)])
        locate = LocateOutput(statements=[LocatedStatement(statement="cash_flow", basis="consolidated", pages=[2])])
        model = ScriptedModel(locate=[locate], extract={"cash_flow": [cash]})
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        scored = score_filing(artefact, gold(row(statement="cash_flow", section="Operating activities", label="Net cash from operations",
                                                period_label="FY2026", period_end="", printed="1,750", concept="net_cash_from_operating_activities")))
        self.assertEqual(scored.facts[0].outcome, "match")
        self.assertIn(scored.facts[0].page_match, (True, False))  # found, so the page was checked

    def test_failed_filing_scores_all_gold_as_missing(self):
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        scored = score_filing(failed, gold(row(), row(row="2", label="Inventories", concept="inventories", printed="800")))
        self.assertFalse(scored.extracted)
        self.assertEqual(scored.error_code, "NO_STATEMENTS_FOUND")
        self.assertEqual([f.outcome for f in scored.facts], ["missing", "missing"])
        self.assertEqual(scored.fact_count, 0)

    def test_filing_level_counts(self):
        scored = score_filing(self.artefact, gold(row()))
        self.assertTrue(scored.extracted)
        self.assertEqual(scored.state, "complete")
        self.assertTrue(scored.scanned)  # the fixture's cash flow page has no text layer
        self.assertEqual(scored.coverage, {"extracted": 3})
        # Two subtotal checks (total assets; profit) and the balance identity all pass in the fixture.
        self.assertEqual(scored.checks["passed"], 3)
        self.assertEqual(scored.model_calls, self.artefact.model_calls.total)
        self.assertEqual(scored.bytes, len(PDF))


class ScoreRunTests(unittest.TestCase):
    def test_not_run_and_gold_missing_are_listed_not_scored(self):
        artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        other = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                       kind="annual_report", period_end="2026-03-31", set="heldout")
        other_gold = freeze_sheet([row()], other, TAXONOMY, WHEN)
        unlabelled = run_filing(other.model_copy(update={"file": "other-metals/q1.pdf"}), PDF, lambda: ScriptedModel(), FAST)
        score = score_run("r", [artefact, unlabelled], {FILING.id: gold(row()), other.id: other_gold},
                          manifest_ids=[FILING.id, other.id, "other-metals/q1"], eval_set="all")
        self.assertEqual([f.filing_id for f in score.filings], [FILING.id])
        self.assertEqual(score.not_run, [other.id])
        self.assertEqual(score.gold_missing, ["other-metals/q1"])
        summary = score.summary()
        self.assertEqual((summary.filings, summary.gold_facts, summary.match), (1, 1, 1))
        self.assertEqual(summary.rate("match"), "100.0%")

    def test_set_filter_and_strata(self):
        dev = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        held = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                      kind="annual_report", period_end="2026-03-31", set="heldout")
        held_artefact = run_filing(held, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        golds = {FILING.id: gold(row()), held.id: freeze_sheet([row()], held, TAXONOMY, WHEN)}
        both = score_run("r", [dev, held_artefact], golds, [FILING.id, held.id], eval_set="all")
        self.assertEqual(both.summary().failed, 1)
        self.assertEqual(both.strata()["scanned"]["yes"].filings, 2)
        self.assertEqual(both.strata()["kind"]["annual_report"].match, 1)
        self.assertEqual(both.strata()["basis"]["consolidated"].gold_facts, 2)
        only_dev = score_run("r", [dev, held_artefact], golds, [FILING.id, held.id], eval_set="dev")
        self.assertEqual([f.filing_id for f in only_dev.filings], [FILING.id])
        self.assertEqual(only_dev.summary().rate("page_match"), "100.0%")

    def test_rates_with_no_denominator_are_a_dash(self):
        score = score_run("r", [], {}, [], eval_set="dev")
        self.assertEqual(score.summary().rate("match"), "—")
        self.assertEqual(score.summary().seconds_median, None)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_scoring -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.scoring'`

- [ ] **Step 3: Write `scoring.py`**

```python
# apps/eval/src/maester_eval/scoring.py
"""Score a run against the gold set.

A gold fact is found by statement, basis, normalised section, normalised label and
normalised period label (phase 1 adds matching by concept). Figures are compared as
exact decimals: a match means value, sign, scale, basis and period all agree.
"""

from collections import Counter
from decimal import Decimal
import statistics
from typing import Literal

from pydantic import BaseModel

from maester_eval.artefacts import Artefact
from maester_eval.gold import GoldFact, GoldFiling
from maester_eval.text import normalise

Outcome = Literal["match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing"]
OUTCOMES: tuple[Outcome, ...] = ("match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing")


class FactScore(BaseModel):
    concept: str
    statement: str
    basis: str
    label: str
    period_label: str
    outcome: Outcome
    gold_printed: str
    read_printed: str | None
    gold_normalized: str | None
    read_normalized: str | None
    page_match: bool | None


class FilingScore(BaseModel):
    filing_id: str
    company: str
    kind: str
    set: str
    scanned: bool
    extracted: bool
    error_code: str | None
    state: str | None
    facts: list[FactScore]
    fact_count: int
    checks: dict[str, int]
    warnings: int
    coverage: dict[str, int]
    seconds: float
    bytes: int
    model_calls: int


class Summary(BaseModel):
    filings: int = 0
    extracted: int = 0
    failed: int = 0
    gold_facts: int = 0
    match: int = 0
    wrong_value: int = 0
    wrong_scale: int = 0
    wrong_status: int = 0
    ambiguous: int = 0
    missing: int = 0
    page_checked: int = 0
    page_match: int = 0
    checks_passed: int = 0
    checks_failed: int = 0
    checks_not_checked: int = 0
    seconds_median: float | None = None
    seconds_max: float | None = None
    model_calls_median: float | None = None
    model_calls_max: int | None = None

    def rate(self, name: str) -> str:
        """`name` over its denominator as a percentage with one decimal; "—" with nothing to divide by."""
        numerator = getattr(self, name)
        if name == "page_match":
            denominator = self.page_checked
        elif name in ("checks_passed", "checks_failed", "checks_not_checked"):
            denominator = self.checks_passed + self.checks_failed + self.checks_not_checked
        elif name in ("extracted", "failed"):
            denominator = self.filings
        else:
            denominator = self.gold_facts
        if not denominator:
            return "—"
        return f"{numerator * 1000 // denominator / 10:.1f}%"


def _key(statement: str, basis: str, section: str, label: str, period_label: str) -> tuple:
    return (statement, basis, normalise(section), normalise(label), normalise(period_label))


def _compare(gold: GoldFact, fact: dict) -> Outcome:
    if gold.value_status == "dash" or fact["valueStatus"] != "value":
        return "match" if gold.value_status == "dash" and fact["valueStatus"] == "dash" else "wrong_status"
    if fact["normalizedValue"] is not None and Decimal(fact["normalizedValue"]) == Decimal(gold.normalized_value):
        return "match"
    if fact["reportedValue"] is not None and Decimal(fact["reportedValue"]) == Decimal(gold.value):
        return "wrong_scale"
    return "wrong_value"


def _candidates(index: dict[tuple, list[dict]], gold: GoldFact) -> list[dict]:
    exact = index.get(_key(gold.statement, gold.basis, gold.section, gold.label, gold.period_label))
    if exact:
        return exact
    # No fact in that section (or no section typed): any section, same statement, basis, label and period.
    loose = _key(gold.statement, gold.basis, "", gold.label, gold.period_label)
    return [f for key, facts in index.items() if (key[0], key[1], key[3], key[4]) == (loose[0], loose[1], loose[3], loose[4]) for f in facts]


def score_filing(artefact: Artefact, gold: GoldFiling) -> FilingScore:
    result = artefact.result or {"facts": [], "checks": [], "warnings": [], "coverage": [], "state": None}
    index: dict[tuple, list[dict]] = {}
    for fact in result["facts"]:
        index.setdefault(_key(fact["statement"], fact["basis"], fact["section"], fact["reportedLabel"], fact["periodLabel"]), []).append(fact)
    scores: list[FactScore] = []
    for g in gold.facts:
        found = _candidates(index, g)
        base = dict(concept=g.concept, statement=g.statement, basis=g.basis, label=g.label, period_label=g.period_label,
                    gold_printed=g.printed, gold_normalized=g.normalized_value)
        if not found:
            scores.append(FactScore(**base, outcome="missing", read_printed=None, read_normalized=None, page_match=None))
            continue
        figures = {(f["valueStatus"], f["normalizedValue"]) for f in found}
        fact = min(found, key=lambda f: f["lineOrder"])
        outcome: Outcome = "ambiguous" if len(figures) > 1 else _compare(g, fact)
        scores.append(FactScore(**base, outcome=outcome, read_printed=fact["reportedText"], read_normalized=fact["normalizedValue"],
                                page_match=None if outcome == "ambiguous" else fact["pageIndex"] == g.page_index))
    located = {p for entry in result["coverage"] for p in entry["pages"]}
    return FilingScore(
        filing_id=artefact.filing_id, company=artefact.company, kind=artefact.kind, set=artefact.set,
        scanned=bool(located & set(artefact.pages_without_text)) or (artefact.result is None and bool(artefact.pages_without_text)),
        extracted=artefact.result is not None, error_code=artefact.error.code if artefact.error else None, state=result["state"],
        facts=scores, fact_count=len(result["facts"]),
        checks=dict(Counter(c["status"] for c in result["checks"])), warnings=len(result["warnings"]),
        coverage=dict(Counter(e["status"] for e in result["coverage"])), seconds=artefact.seconds, bytes=artefact.bytes,
        model_calls=artefact.model_calls.total,
    )


def _summarise(filings: list[FilingScore], facts: list[FactScore] | None = None) -> Summary:
    facts = [f for filing in filings for f in filing.facts] if facts is None else facts
    counts = Counter(f.outcome for f in facts)
    checks = Counter()
    for filing in filings:
        checks.update(filing.checks)
    seconds = [f.seconds for f in filings if f.extracted]
    calls = [f.model_calls for f in filings]
    found = [f for f in facts if f.page_match is not None]
    return Summary(
        filings=len(filings), extracted=sum(1 for f in filings if f.extracted), failed=sum(1 for f in filings if not f.extracted),
        gold_facts=len(facts), **{name: counts.get(name, 0) for name in OUTCOMES},
        page_checked=len(found), page_match=sum(1 for f in found if f.page_match),
        checks_passed=checks.get("passed", 0), checks_failed=checks.get("failed", 0), checks_not_checked=checks.get("not_checked", 0),
        seconds_median=statistics.median(seconds) if seconds else None, seconds_max=max(seconds) if seconds else None,
        model_calls_median=statistics.median(calls) if calls else None, model_calls_max=max(calls) if calls else None,
    )


class RunScore(BaseModel):
    run: str
    pipeline_version: str | None
    prompt_version: str | None
    model: str | None
    eval_set: str
    filings: list[FilingScore]
    not_run: list[str]
    gold_missing: list[str]

    def summary(self) -> Summary:
        return _summarise(self.filings)

    def strata(self) -> dict[str, dict[str, Summary]]:
        out: dict[str, dict[str, Summary]] = {"kind": {}, "scanned": {}, "basis": {}, "statement": {}}
        for value in sorted({f.kind for f in self.filings}):
            out["kind"][value] = _summarise([f for f in self.filings if f.kind == value])
        for value in ("yes", "no"):
            chosen = [f for f in self.filings if f.scanned == (value == "yes")]
            if chosen:
                out["scanned"][value] = _summarise(chosen)
        facts = [f for filing in self.filings for f in filing.facts]
        for value in sorted({f.basis for f in facts}):
            out["basis"][value] = _summarise([], [f for f in facts if f.basis == value])
        for value in sorted({f.statement for f in facts}):
            out["statement"][value] = _summarise([], [f for f in facts if f.statement == value])
        return out


def score_run(run_name: str, artefacts: list[Artefact], gold: dict[str, GoldFiling], manifest_ids: list[str],
              eval_set: str, pipeline_version: str | None = None, prompt_version: str | None = None,
              model: str | None = None) -> RunScore:
    by_id = {a.filing_id: a for a in artefacts if eval_set == "all" or a.set == eval_set}
    scored = [score_filing(by_id[i], gold[i]) for i in sorted(by_id) if i in gold]
    chosen_gold = {i for i, g in gold.items() if eval_set == "all" or g.set == eval_set}
    return RunScore(
        run=run_name, pipeline_version=pipeline_version, prompt_version=prompt_version, model=model, eval_set=eval_set,
        filings=scored,
        not_run=sorted(i for i in chosen_gold if i not in by_id and i in manifest_ids),
        gold_missing=sorted(i for i in by_id if i not in gold),
    )
```

- [ ] **Step 4: Run the tests**

Run: `uv run --locked python -m unittest tests.test_eval_scoring -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/eval/src/maester_eval/scoring.py tests/test_eval_scoring.py
git commit -m "feat(eval): score a run against the gold set with exact decimals" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The report, its delta, and the `report` command

**Files:**
- Create: `apps/eval/src/maester_eval/report.py`
- Modify: `apps/eval/src/maester_eval/cli.py`, `tests/test_eval_cli.py`
- Test: `tests/test_eval_report.py`

**Interfaces:**
- Consumes: `RunScore`, `Summary`, `score_run` (Task 7); `read_artefacts`, `read_run` (Task 4); `read_gold` (Task 6); `load_manifest` (Task 3).
- Produces: `render_markdown(score: RunScore, against: RunScore | None = None, generated_at: datetime) -> str`; `write_report(run_dir, score, against=None, generated_at=None) -> tuple[Path, Path]` (`report.md`, `report.json`); `score_run_dir(run_dir, gold_dir, manifest_ids, eval_set) -> RunScore`.
- CLI: `maester-eval report --run RUN [--set dev|heldout|all] [--against RUN] [--to PATH]`.

The Markdown report, top to bottom: a heading with the run name; a line with the set, the date, `pipeline_version`, `prompt_version` and the model; a summary table (filings read and failed; gold facts; exact match, wrong value, wrong scale, wrong status, ambiguous, missing as counts and rates; page match; checks passed, failed, not checked; median and maximum seconds and model calls per filing); when `against` is given, a delta table of the same rates in percentage points; strata tables for kind, scanned, basis and statement; a per-filing table (id, kind, scanned, outcome or error code, gold facts, exact match, seconds, model calls); "Not run" and "No gold yet" lists; and a "Mismatches" appendix listing every fact that did not match (filing, statement, basis, label, period, gold figure as printed, what was read). The appendix holds figures from public filings; that is why reports live in files, not on the console.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_eval_report.py
"""The Markdown and JSON report, with a delta against an earlier run. Offline."""

from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from test_extraction_workflow import FAST, PDF, ScriptedModel

from maester_eval.artefacts import write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import freeze_sheet, write_gold
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.report import render_markdown, score_run_dir, write_report
from maester_eval.runner import run_filing
from maester_eval.sheets import SHEET_COLUMNS

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
WHEN = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


def row(**values):
    base = {column: "" for column in SHEET_COLUMNS}
    base.update(row="1", statement="balance_sheet", basis="consolidated", section="Assets", label="Total assets",
                period_label="As at 31 March 2026", period_end="2026-03-31", printed="2,000", value="2000",
                scale_factor="10000000", page="2", verified="yes", concept="total_assets")
    base.update(values)
    return base


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.run_dir = self.paths.new_run("baseline", now=datetime(2026, 10, 16, 9, 0, tzinfo=timezone.utc))
        write_run(self.run_dir, {"run": self.run_dir.name, "set": "dev", "pipeline_version": "extract-2",
                                 "prompt_version": "abc123", "model": "scripted-model", "filings": [FILING.id]})
        write_artefact(self.run_dir, run_filing(FILING, PDF, lambda: ScriptedModel(), FAST))
        gold = freeze_sheet([row(), row(row="2", label="Inventories", concept="inventories", printed="800", gold_text="801")],
                            FILING, load_taxonomy(), WHEN)
        write_gold(self.paths.gold, gold)

    def test_markdown_carries_the_summary_strata_filings_and_mismatches(self):
        score = score_run_dir(self.run_dir, self.paths.gold, [FILING.id], "dev")
        text = render_markdown(score, generated_at=WHEN)
        self.assertIn("# Evaluation report: 20261016T090000Z-baseline", text)
        self.assertIn("extract-2", text)
        self.assertIn("| Exact match | 1 | 50.0% |", text)
        self.assertIn("| Wrong value | 1 | 50.0% |", text)
        self.assertIn("## By kind", text)
        self.assertIn("| annual_report |", text)
        self.assertIn("## Filings", text)
        self.assertIn("| synthetic-industries/ar-2025-26 | annual_report | yes | complete | 2 | 1 |", text)
        self.assertIn("## Mismatches", text)
        self.assertIn("| Inventories | As at 31 March 2026 | wrong_value | 801 | 800 |", text)

    def test_delta_against_an_earlier_run(self):
        score = score_run_dir(self.run_dir, self.paths.gold, [FILING.id], "dev")
        earlier = score.model_copy(deep=True)
        earlier.filings[0].facts[1].outcome = "match"  # the earlier run had both right
        text = render_markdown(score, against=earlier, generated_at=WHEN)
        self.assertIn("## Against 20261016T090000Z-baseline", text)
        self.assertIn("| Exact match | 50.0% | 100.0% | −50.0 pp |", text)

    def test_write_report_produces_markdown_and_json(self):
        score = score_run_dir(self.run_dir, self.paths.gold, [FILING.id], "dev")
        md, js = write_report(self.run_dir, score, generated_at=WHEN)
        self.assertEqual((md.name, js.name), ("report.md", "report.json"))
        data = json.loads(js.read_text())
        self.assertEqual(data["summary"]["gold_facts"], 2)
        self.assertEqual(data["score"]["filings"][0]["facts"][1]["outcome"], "wrong_value")
        self.assertEqual(data["generated_at"], WHEN.isoformat())

    def test_not_run_and_no_gold_sections(self):
        extra = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                       kind="annual_report", period_end="2026-03-31", set="dev")
        write_gold(self.paths.gold, freeze_sheet([row()], extra, load_taxonomy(), WHEN))
        score = score_run_dir(self.run_dir, self.paths.gold, [FILING.id, extra.id], "dev")
        text = render_markdown(score, generated_at=WHEN)
        self.assertIn("## Not run\n\n- other-metals/ar-2025-26", text)


if __name__ == "__main__":
    unittest.main()
```

Add to `tests/test_eval_cli.py`:

```python
    def test_help_lists_the_four_commands(self):
        response = CliRunner().invoke(app, ["--help"])
        for command in ("live", "export", "freeze", "report"):
            self.assertIn(command, response.output)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run --locked python -m unittest tests.test_eval_report tests.test_eval_cli -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'maester_eval.report'`, and the CLI test fails on `report`.

- [ ] **Step 3: Write `report.py`**

```python
# apps/eval/src/maester_eval/report.py
"""The report: Markdown for people and JSON for the next comparison."""

from datetime import datetime, timezone
import json
from pathlib import Path

from maester_eval.artefacts import read_artefacts, read_run
from maester_eval.gold import read_gold
from maester_eval.scoring import OUTCOMES, RunScore, Summary, score_run

LABELS = {"match": "Exact match", "wrong_value": "Wrong value", "wrong_scale": "Wrong scale",
          "wrong_status": "Wrong status", "ambiguous": "Ambiguous", "missing": "Missing"}
RATES = [("match", "Exact match"), ("wrong_value", "Wrong value"), ("wrong_scale", "Wrong scale"),
         ("wrong_status", "Wrong status"), ("ambiguous", "Ambiguous"), ("missing", "Missing"),
         ("page_match", "Page match"), ("checks_passed", "Checks passed"), ("checks_failed", "Checks failed")]


def score_run_dir(run_dir: Path, gold_dir: Path, manifest_ids: list[str], eval_set: str) -> RunScore:
    record = read_run(run_dir)
    return score_run(run_dir.name, read_artefacts(run_dir), read_gold(gold_dir), manifest_ids, eval_set,
                     pipeline_version=record.get("pipeline_version"), prompt_version=record.get("prompt_version"),
                     model=record.get("model"))


def _num(value: float | int | None) -> str:
    return "—" if value is None else (f"{value:.1f}" if isinstance(value, float) else str(value))


def _summary_table(s: Summary) -> list[str]:
    rows = [
        ("Filings", str(s.filings), ""), ("Read", str(s.extracted), s.rate("extracted")), ("Failed", str(s.failed), s.rate("failed")),
        ("Gold facts", str(s.gold_facts), ""),
    ]
    rows += [(LABELS[name], str(getattr(s, name)), s.rate(name)) for name in OUTCOMES]
    rows += [
        ("Page match", f"{s.page_match} of {s.page_checked}", s.rate("page_match")),
        ("Checks passed", str(s.checks_passed), s.rate("checks_passed")),
        ("Checks failed", str(s.checks_failed), s.rate("checks_failed")),
        ("Checks not checked", str(s.checks_not_checked), s.rate("checks_not_checked")),
        ("Seconds per filing, median / max", f"{_num(s.seconds_median)} / {_num(s.seconds_max)}", ""),
        ("Model calls per filing, median / max", f"{_num(s.model_calls_median)} / {_num(s.model_calls_max)}", ""),
    ]
    return ["| Measure | Count | Rate |", "| --- | --- | --- |"] + [f"| {a} | {b} | {c} |" for a, b, c in rows]


def _strata_table(title: str, strata: dict[str, Summary]) -> list[str]:
    lines = [f"## By {title}", "", "| Value | Filings | Gold facts | Exact match | Missing | Page match |", "| --- | --- | --- | --- | --- | --- |"]
    for value, s in strata.items():
        lines.append(f"| {value} | {s.filings or '—'} | {s.gold_facts} | {s.rate('match')} | {s.rate('missing')} | {s.rate('page_match')} |")
    return lines + [""]


def _pp(now: str, before: str) -> str:
    if now == "—" or before == "—":
        return "—"
    delta = round(float(now.rstrip("%")) - float(before.rstrip("%")), 1)
    sign = "−" if delta < 0 else "+"
    return f"{sign}{abs(delta):.1f} pp"


def render_markdown(score: RunScore, against: RunScore | None = None, generated_at: datetime | None = None) -> str:
    s = score.summary()
    when = (generated_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"# Evaluation report: {score.run}", "",
        f"Set `{score.eval_set}` · {when} · pipeline `{score.pipeline_version}` · prompt `{score.prompt_version}` · model `{score.model}`.",
        "", "An exact match means value, sign, scale, basis and period all agree with the gold set. Rates are over the gold facts of the scored filings.", "",
        "## Summary", "", *_summary_table(s), "",
    ]
    if against is not None:
        a = against.summary()
        lines += [f"## Against {against.run}", "", "| Rate | This run | Earlier | Change |", "| --- | --- | --- | --- |"]
        lines += [f"| {label} | {s.rate(name)} | {a.rate(name)} | {_pp(s.rate(name), a.rate(name))} |" for name, label in RATES]
        lines.append("")
    for title, strata in score.strata().items():
        if strata:
            lines += _strata_table(title, strata)
    lines += ["## Filings", "", "| Filing | Kind | Scanned | Outcome | Gold facts | Exact match | Seconds | Model calls | Size (MB) |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for f in score.filings:
        outcome = f.state if f.extracted else f.error_code
        exact = sum(1 for x in f.facts if x.outcome == "match")
        lines.append(f"| {f.filing_id} | {f.kind} | {'yes' if f.scanned else 'no'} | {outcome} | {len(f.facts)} | {exact} | {f.seconds} | {f.model_calls} | {f.bytes / 1_000_000:.1f} |")
    lines.append("")
    if score.not_run:
        lines += ["## Not run", ""] + [f"- {i}" for i in score.not_run] + [""]
    if score.gold_missing:
        lines += ["## No gold yet", ""] + [f"- {i}" for i in score.gold_missing] + [""]
    mismatches = [(f.filing_id, x) for f in score.filings for x in f.facts if x.outcome != "match"]
    lines += ["## Mismatches", ""]
    if not mismatches:
        lines.append("None.")
    else:
        lines += ["| Filing | Statement | Basis | Label | Period | Outcome | Gold | Read |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
        for filing_id, x in mismatches:
            lines.append(f"| {filing_id} | {x.statement} | {x.basis} | {x.label} | {x.period_label} | {x.outcome} | {x.gold_printed} | {x.read_printed or '—'} |")
    return "\n".join(lines) + "\n"


def write_report(run_dir: Path, score: RunScore, against: RunScore | None = None,
                 generated_at: datetime | None = None) -> tuple[Path, Path]:
    generated_at = generated_at or datetime.now(timezone.utc)
    md = run_dir / "report.md"
    js = run_dir / "report.json"
    md.write_text(render_markdown(score, against, generated_at))
    js.write_text(json.dumps({
        "generated_at": generated_at.isoformat(), "against": against.run if against else None,
        "summary": score.summary().model_dump(), "strata": {k: {v: s.model_dump() for v, s in d.items()} for k, d in score.strata().items()},
        "score": score.model_dump(mode="json"),
    }, ensure_ascii=False, indent=1))
    return md, js
```

- [ ] **Step 4: Add the `report` command**

Append to `cli.py`:

```python
import shutil

from maester_eval.report import score_run_dir, write_report


@app.command()
def report(
    run: Annotated[str, typer.Option(help="A run folder's name, a path, or `latest`.")] = "latest",
    eval_set: Annotated[str, typer.Option("--set", help="dev, heldout or all.")] = "all",
    against: Annotated[Optional[str], typer.Option(help="An earlier run to show the change against.")] = None,
    to: Annotated[Optional[Path], typer.Option(help="Also copy the Markdown here, e.g. docs/eval/2026-10-16-baseline.md.")] = None,
) -> None:
    """Score a run against the gold set; write report.md and report.json into the run folder."""
    if eval_set not in ("dev", "heldout", "all"):
        _fail("--set must be dev, heldout or all")
    try:
        ids = [f.id for f in load_manifest(DEFAULT.manifest).filings]
        run_dir = DEFAULT.resolve_run(run)
        earlier = score_run_dir(DEFAULT.resolve_run(against), DEFAULT.gold, ids, eval_set) if against else None
    except (ManifestError, FileNotFoundError) as exc:
        _fail(str(exc))
    score = score_run_dir(run_dir, DEFAULT.gold, ids, eval_set)
    md, _ = write_report(run_dir, score, earlier)
    s = score.summary()
    console.print(f"{run_dir.name} ({eval_set}): {s.filings} filing(s), {s.gold_facts} gold fact(s), exact match {s.rate('match')}, missing {s.rate('missing')}")
    if score.not_run:
        console.print(f"not run: {len(score.not_run)}; no gold yet: {len(score.gold_missing)}")
    if to:
        to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(md, to)
        console.print(f"published → {to}")
    console.print(f"report → {md}")
```

- [ ] **Step 5: Tidy `cli.py` into one import block**

The commands were appended task by task with their imports beside them. Move every import to the top of the file so it reads:

```python
"""The `maester-eval` command line.

Console output is filing ids, codes, counts and seconds. Labels, printed values
and figures go only into files under data/eval and the report.
"""

from datetime import datetime, timezone
from pathlib import Path
import shutil
from typing import Annotated, Optional

import typer
from dotenv import load_dotenv
from rich.console import Console

from maester_eval.artefacts import read_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import FreezeError, freeze_sheet, read_sheet, write_gold
from maester_eval.manifest import ManifestError, load_manifest
from maester_eval.paths import DEFAULT
from maester_eval.report import score_run_dir, write_report
from maester_eval.runner import EvalConfigError, gemini_model_factory, run_live, workflow_settings_from_env
from maester_eval.sheets import export_run, sheet_path
```

followed by `app`, `console`, `_main`, `_fail` and the four commands in the order `live`, `export`, `freeze`, `report`, their bodies unchanged.

- [ ] **Step 6: Run all the harness tests and the workspace check**

```bash
uv run --locked python -m unittest tests.test_eval_report tests.test_eval_cli tests.test_eval_scoring tests.test_eval_gold tests.test_eval_sheets tests.test_eval_live tests.test_eval_manifest tests.test_concepts_json -v
uv run --locked python scripts/check_workspace.py
uv run --locked maester-eval report --help
```

Expected: all pass; `--help` shows `--run`, `--set`, `--against`, `--to`.

- [ ] **Step 7: Commit**

```bash
git add apps/eval/src/maester_eval/report.py apps/eval/src/maester_eval/cli.py tests/test_eval_report.py tests/test_eval_cli.py
git commit -m "feat(eval): the report, its delta against an earlier run, and publishing to docs/eval" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Documentation

**Files:**
- Create: `docs/systems/eval.md`
- Modify: `docs/README.md`, `docs/DEVELOPMENT.md`, `docs/QUALITY.md`, `docs/systems/maester.md`, `docs/systems/packages.md`, `CONTRIBUTING.md`
- Test: `scripts/check_workspace.py` (local links)

**Interfaces:** none; words only.

- [ ] **Step 1: Write `docs/systems/eval.md`** (Simplified Technical English, like the other system descriptions; load the `writing-ste` skill and keep to its rules while writing)

```markdown
# Maester evaluation harness: system description

This document describes the Python application in `apps/eval`. For the full system, read the [Maester overview](maester.md). For the extraction workflow it runs, read [Extractor](extractor.md). For the design, read [financial data layer](../superpowers/specs/2026-10-15-financial-data-layer-design.md), section 9.

## Terms

| Term | Meaning in this document |
| --- | --- |
| harness | The application in `apps/eval`. Its distribution name is `maester-eval`. Its command is `maester-eval`. |
| corpus | The folder `data/eval/corpus`. It holds the PDFs of public filings. Git does not track it. |
| manifest | The file `data/eval/manifest.json`. It lists each filing of the corpus with its company, its kind, its period end and its set. |
| filing id | The path of a PDF under the corpus without `.pdf`, for example `synthetic-cements/ar-2025-26`. |
| set | `dev` or `heldout`. A company is in one set only. |
| run | One folder under `data/eval/runs`, named by the UTC time it started. It holds `run.json`, one artefact per filing, and the report. |
| artefact | One JSON file under `runs/<run>/artefacts`. It holds the extractor's result for one filing, or its error, with the time and the number of model calls. |
| sheet | One CSV file under `data/eval/sheets`. A person corrects it against the PDF. |
| gold | One JSON file under `data/eval/gold`. It holds the facts of one filing that a person checked, each with a concept. |
| concept | An id from `packages/contracts/concepts.json`, for example `profit_after_tax`. |
| report | `report.md` and `report.json` in a run folder. `report --to` copies the Markdown to `docs/eval`. |
| exact match | A read fact whose value, sign, scale, basis and period agree with the gold fact. |

## Function

The harness measures the extraction workflow on real filings. `live` reads the filings of a set with the real model and keeps an artefact per filing. `export` writes a sheet per filing. A person corrects the sheets. `freeze` turns a corrected sheet into gold. `report` compares a run with the gold and writes the result. The first report is the baseline. Each later report shows the change against an earlier run.

## Parts

| Part | File | Function |
| --- | --- | --- |
| Command line | `src/maester_eval/cli.py` | The four commands. It prints filing ids, codes, counts and seconds. It does not print labels or figures. |
| Paths | `src/maester_eval/paths.py` | The folders under `data/eval` and the run folders. |
| Manifest | `src/maester_eval/manifest.py` | Reads and validates the manifest. |
| Concepts | `src/maester_eval/concepts.py` | Reads `packages/contracts/concepts.json`. |
| Runner | `src/maester_eval/runner.py` | `live`: runs `run_extraction` with a model that counts its calls. |
| Artefacts | `src/maester_eval/artefacts.py` | Writes and reads artefacts and `run.json`. |
| Sheets | `src/maester_eval/sheets.py` | `export`: writes the sheets. |
| Gold | `src/maester_eval/gold.py` | `freeze`: turns a sheet into gold. |
| Scoring | `src/maester_eval/scoring.py` | Finds each gold fact among the read facts and compares the figures as exact decimals. |
| Report | `src/maester_eval/report.py` | Writes `report.md` and `report.json`. |

## Operation

### The `live` command

1. The harness reads the manifest and selects the filings of the set (`--set`, default `dev`), or the filings named with `--only`.
2. It stops if a selected PDF is not in the corpus.
3. It builds the Gemini model from `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` and `GEMINI_MODEL`, as the extractor does. It stops if `GOOGLE_CLOUD_PROJECT` is not set.
4. It makes a new run folder and writes `run.json`.
5. For each filing, in order, it runs `run_extraction` with the company name from the manifest and writes the artefact. A failed filing gets an artefact with the error code. The run continues.
6. It writes the finish time in `run.json`.

Each filing costs model calls. An annual report with two bases costs about ten calls of the extraction model.

### The `export` command

1. The harness opens the run (`--run`, default `latest`).
2. For each artefact, it writes `data/eval/sheets/<filing id>.csv` with one row per read fact. A failed filing gets one row with the error code in `note`.
3. It does not replace a sheet that exists. `--force` replaces it.

### The `freeze` command

1. The harness reads the sheet of the filing id and the manifest entry.
2. It keeps the rows whose `verified` column is `yes`.
3. For each kept row, it reads the concept, the figure (`gold_text`, or `printed`), the scale (`gold_scale`, or `scale_factor`), the page (`gold_page`, or `page`) and the period end (`gold_period_end`, or `period_end`). It parses the figure with the engine's `parse_reported`.
4. It stops with the sheet row number if a row has an unknown concept, a figure it cannot read, no scale, a page below 1, or the same concept, basis and period as an earlier row.
5. It writes `data/eval/gold/<filing id>.json`. It does not replace a gold file that exists. `--force` replaces it.

### The `report` command

1. The harness opens the run and reads the gold files of the set (`--set`, default `all`).
2. For each artefact that has gold, it finds each gold fact among the read facts by statement, basis, section, label and period label, and compares the figures.
3. It writes `report.md` and `report.json` in the run folder. With `--against`, it adds the change against the earlier run. With `--to`, it copies the Markdown to the given path.

## States and errors

| State or error | Cause | Result |
| --- | --- | --- |
| Outcome `match` | The read figure agrees with gold in value, sign, scale, basis and period. | Counted as an exact match. |
| Outcome `wrong_value` | The figures differ. | Listed under Mismatches. |
| Outcome `wrong_scale` | The printed figure agrees but the scale differs. | Listed under Mismatches. |
| Outcome `wrong_status` | One side is a dash and the other a figure. | Listed under Mismatches. |
| Outcome `ambiguous` | Two read lines have the same label, section and period with different figures. | Listed under Mismatches. Not counted as a match. |
| Outcome `missing` | No read line has the label. | Listed under Mismatches. |
| Filing failed | The artefact holds an error. | The filing's gold facts are `missing`. The error code is in the report. |
| Not run | Gold exists but the run has no artefact for the filing. | Listed under Not run. Not scored. |
| No gold yet | The run has an artefact but no gold file exists. | Listed under No gold yet. Not scored. |
| `ManifestError` | The manifest is missing or not valid. | The command stops with the reason. |
| Sheet or gold file exists | A second `export` or `freeze`. | The file is kept. `--force` replaces it. |

## Data

The harness reads `data/eval/manifest.json`, the PDFs under `data/eval/corpus`, the sheets under `data/eval/sheets`, the gold files under `data/eval/gold` and `packages/contracts/concepts.json`. It writes the run folders under `data/eval/runs`, the sheets, the gold files and, with `--to`, a Markdown file under `docs/eval`.

Git tracks the manifest, the gold files and `docs/eval`. Git does not track the corpus or the runs.

## Procedures

### To run the tests

1. Run `uv run --locked python -m unittest discover -s tests -v`.
2. The tests in `tests/test_eval_*.py` and `tests/test_concepts_json.py` run without a model.

### To take a baseline

Read the plan [evaluation baseline](../superpowers/plans/2026-10-15-eval-baseline.md), Task 10.

## Warnings and cautions

WARNING: Put only public filings in the corpus. The sheets, the gold files and the reports hold figures from the filings.

CAUTION: `live` costs model calls on your Google Cloud project. Use `--only` to read one filing first.

CAUTION: Do not tune a prompt or a rule on the `heldout` set. Run it only to decide if a change lands.

## Limits

- The harness matches a gold fact by its printed label. A read line with a different label is `missing`, also when its figure is right. Phase 1 adds matching by concept.
- The harness scores the three statements. Notes and quarterly columns come with their phases.
- The harness does not run classification. The kind of a filing comes from the manifest.
- `live` reads the filings one at a time.

## Sources

- [apps/eval/src/maester_eval/cli.py](../../apps/eval/src/maester_eval/cli.py)
- [apps/eval/src/maester_eval/runner.py](../../apps/eval/src/maester_eval/runner.py)
- [apps/eval/src/maester_eval/scoring.py](../../apps/eval/src/maester_eval/scoring.py)
- [apps/eval/src/maester_eval/gold.py](../../apps/eval/src/maester_eval/gold.py)
- [apps/eval/README.md](../../apps/eval/README.md)
- [packages/contracts/concepts.json](../../packages/contracts/concepts.json)
```

- [ ] **Step 2: Add the rows and sections to the existing docs**

`docs/README.md`, after the "System: shared packages" row:

```markdown
| [System: evaluation harness](systems/eval.md) | The `maester-eval` app: live runs over real filings, labelling sheets, the gold set and the report | Engineering and data |
```

`docs/systems/maester.md`, in the Parts table after the CLI row:

```markdown
| [Evaluation harness](eval.md) | `apps/eval` | Python command `maester-eval` with `live`, `export`, `freeze` and `report`. It runs the extraction workflow over the public filings in `data/eval/corpus` and scores a run against the gold set in `data/eval/gold`. It does not use the API or the database. |
```

and in the sentence "The uv workspace holds `apps/cli`, `apps/extractor` and `packages/financial-engine`." add `apps/eval`: "The uv workspace holds `apps/cli`, `apps/eval`, `apps/extractor` and `packages/financial-engine`."

`docs/systems/packages.md`, in the table under "Which apps use each package", add the evaluation harness as a user of `maester-financial-engine` (one cell: "Evaluation harness: `run_extraction`, `PdfDocument`, `parse_reported`, `format_decimal`"). Keep the table's existing shape; add a row or a cell as its layout allows.

`docs/DEVELOPMENT.md`, a new section at the end, before "## 13. Known limitations", numbered to follow the section before it (renumber "Known limitations" and nothing else; check `grep -rn "DEVELOPMENT.md#" docs README.md CONTRIBUTING.md` first and update any anchor to the renumbered heading):

```markdown
## 13. The evaluation harness

`maester-eval` measures the extraction workflow on real filings; nothing about how figures are read changes without a run (`CLAUDE.md`, "Financial figures"). Public filings go under `data/eval/corpus/<company-folder>/<name>.pdf` and are listed in `data/eval/manifest.json`:

~~~json
{
  "filings": [
    { "file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
      "kind": "annual_report", "period_end": "2026-03-31", "set": "dev" }
  ]
}
~~~

`kind` is `annual_report` or `financial_results`; `set` is `dev` or `heldout`, and a company is in one set only. Then:

~~~bash
uv run --locked maester-eval live --set dev --label baseline   # costs model calls; --only <id> for one filing
uv run --locked maester-eval export --run latest               # sheets to data/eval/sheets/, never overwritten without --force
# correct the sheets against the PDFs: concept, gold_text, gold_scale, gold_page, verified=yes
uv run --locked maester-eval freeze synthetic-cements/ar-2025-26 --run latest
uv run --locked maester-eval report --run latest --set dev --to docs/eval/2026-10-16-baseline.md
~~~

The model comes from the same variables as the extractor (`GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION`, `GEMINI_MODEL`). The console shows ids, codes and counts; figures are only in the files. The full description is [System: evaluation harness](systems/eval.md).
```

(The two `~~~` fences inside the section are triple-backtick fences in the file; they are tildes here only so this plan's own fence does not end early.)

`docs/QUALITY.md` §2, after the first paragraph, add:

```markdown
The corpus, its manifest, the labelling sheets and the gold set live under `data/eval/`, and `apps/eval` (`maester-eval`) scores a run against them; the reports are committed under `docs/eval/`. The design is [financial data layer](superpowers/specs/2026-10-15-financial-data-layer-design.md), §9.
```

`CONTRIBUTING.md`: under "What exists today" add a bullet "An evaluation harness, `maester-eval` (`apps/eval`), that runs the extraction workflow over public filings in `data/eval/corpus` and scores it against a hand-checked gold set."; under "Repository layout" add `apps/eval/` with "Evaluation harness: live runs, labelling sheets, gold set, report"; under "Development commands" add `uv run --locked maester-eval --help`.

- [ ] **Step 3: Check the links and the Python tests**

```bash
uv run --locked python scripts/check_workspace.py
uv run --locked python -m unittest discover -s tests -v
```

Expected: `Workspace OK`; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/systems/eval.md docs/README.md docs/DEVELOPMENT.md docs/QUALITY.md docs/systems/maester.md docs/systems/packages.md CONTRIBUTING.md
git commit -m "docs: the evaluation harness, in the system descriptions, development guide and contributing guide" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The baseline run, the gold set and the sealed held-out set

This task is operated by the investor with the harness; the agent prepares, runs the commands the investor asks for, and commits. Steps marked **You** need the investor's hands or eyes.

**Files:**
- Create: `data/eval/manifest.json` (filled), `data/eval/gold/<company>/<filing>.json` for every filing, `docs/eval/<date>-baseline.md`
- Modify: nothing in code

- [ ] **Step 1: You: load the corpus**

Copy the PDFs into `data/eval/corpus/<company-folder>/<name>.pdf` (one folder per company, short lowercase names: `synthetic-cements/ar-2025-26.pdf`, `synthetic-cements/q1-2026-27.pdf`). Aim for 10–30 filings: annual reports and quarterly or half-year results of companies you hold, both digital and scanned where you have them. Put at least three companies, and about a third of the filings, in `heldout`; the rest in `dev`. A company's filings are all in one set.

- [ ] **Step 2: Write the manifest**

Fill `data/eval/manifest.json` with one entry per PDF (`file`, `company` as printed on the filing, `kind`, `period_end` as `YYYY-MM-DD`, `set`). Add `stratum` (`large`, `mid`, `small` or `financials`) to a filing, `out_of_scope` (the reason) to a filing the baseline should leave out, such as a bank, and `printed_pages_per_page: 2` to a PDF of two-page spreads. Check it:

```bash
uv run --locked python -c "from maester_eval.manifest import load_manifest, missing_files; from maester_eval.paths import DEFAULT; m = load_manifest(DEFAULT.manifest); print(len(m.filings), 'filings;', 'missing:', missing_files(m.filings, DEFAULT.corpus))"
```

Expected: the count, and `missing: []`.

- [ ] **Step 3: One filing first**

```bash
uv run --locked maester-eval live --only <a small digital annual report's id> --label smoke
uv run --locked maester-eval export --run latest
```

Expected: an artefact and a sheet; the console shows `<id>: complete in …s, N model calls` (or `partial`, or an error code). If the code is `EXTRACTOR_NOT_CONFIGURED` or `MODEL_REQUEST_REJECTED`, fix `.env` or the Google credentials before going on.

- [ ] **Step 4: The development set**

```bash
uv run --locked maester-eval live --set dev --label baseline
uv run --locked maester-eval export --run latest --force
```

`--force` matters when the smoke filing of Step 3 is in `dev`: without it its sheet from the smoke run is kept, and the baseline sheet must come from the baseline run. Nothing is labelled yet, so nothing is lost; never repeat the command with `--force` after Step 5 starts.

This costs about ten model calls for a report under 60 pages, more for a long one (one `locate` call per 30 pages, plus corrections), and takes minutes per filing; run it in the background and read the console afterwards.

- [ ] **Step 5: You: label the sheets**

Keep every column as text in your spreadsheet application (import as text, or use Numbers/LibreOffice with no auto-conversion); dates stay `YYYY-MM-DD`.

For each sheet under `data/eval/sheets/`, open the PDF beside it. For the rows marked `material` first, and any other line you care about (aim for 15–25 facts per annual report: the totals, revenue, profit before and after tax, EPS, cash, borrowings, net cash from operating activities, and the same for standalone where it exists):

1. Put the concept id in `concept` (the ids are in `packages/contracts/concepts.json`).
2. Compare `printed` with the page. If it is wrong, type the figure exactly as the page prints it in `gold_text`.
3. Check the unit note of the statement. If `scale_factor` is wrong or blank, put `10000000` (crore), `100000` (lakh), `1000` (thousand) or `1` (actuals) in `gold_scale`.
4. Check `page` (counted from 1). If it is wrong, put the right page in `gold_page`. For a filing whose PDF pages are spreads of two printed pages (`printed_pages_per_page` 2 in the manifest), the `printed_pages` column shows the printed pages on that PDF page, such as `3–4`; `page` and `gold_page` stay PDF page numbers.
5. `period_end` is the line's one date (the as-at date on a balance-sheet line). A blank one means an undated column: the workflow could not read a date from the column header. If it is blank or wrong, put the ISO date in `gold_period_end`.
6. For a subtotal you checked by hand, put `yes` or `no` in `adds_up`.
7. Put `yes` in `verified`.
8. A line the pipeline missed, or one whose `statement`, `basis`, `section`, `label` or `period_label` is wrong (these five have no `gold_` column, so leave that row unverified): add a row at the end with `statement`, `basis`, `section`, `label`, `period_label`, `gold_text`, `gold_scale`, `gold_page`, `concept`, `verified`.

Material values (totals, PAT, revenue, cash, borrowings, EPS) get a second look on another day before freezing, as `QUALITY.md` §2 asks.

- [ ] **Step 6: Freeze the development set and take the baseline**

```bash
for id in $(uv run --locked python -c "from maester_eval.manifest import load_manifest; from maester_eval.paths import DEFAULT; print(' '.join(f.id for f in load_manifest(DEFAULT.manifest).select('dev')))"); do uv run --locked maester-eval freeze "$id" --run latest || break; done
uv run --locked maester-eval report --run latest --set dev --to docs/eval/$(date -u +%F)-baseline-dev.md
```

Expected: a gold file per dev filing; the report on the console as `exact match N%`, and the Markdown under `docs/eval/`. Read the Mismatches appendix once: a mismatch that is a labelling slip goes back to the sheet (`freeze --force` after the fix); a real misread stays, that is the baseline.

A row refused as "no longer matches the artefact" means a machine column was edited (`statement`, `basis`, `section`, `label`, `period_label`, `period_end`, `printed`, `scale_factor` or `page`). Put the cell back as it was and move the correction to its `gold_` column (`gold_text`, `gold_scale`, `gold_page` or `gold_period_end`); the first five have none, so restore them, and if the value was wrong leave the row unverified and add the corrected row by hand (Step 5, point 8). If you ran `live` again after the export, give the export's run folder name in place of `latest`.

- [ ] **Step 7: The held-out set, then seal it**

```bash
uv run --locked maester-eval live --set heldout --label baseline-heldout
uv run --locked maester-eval export --run latest
# You: label the held-out sheets the same way, once.
for id in $(uv run --locked python -c "from maester_eval.manifest import load_manifest; from maester_eval.paths import DEFAULT; print(' '.join(f.id for f in load_manifest(DEFAULT.manifest).select('heldout')))"); do uv run --locked maester-eval freeze "$id" --run latest || break; done
uv run --locked maester-eval report --run latest --set heldout --to docs/eval/$(date -u +%F)-baseline-heldout.md
```

A row refused as "no longer matches the artefact" here means a machine column was edited: move the correction to its `gold_` column, as in Step 6.

From here on, `heldout` is run only to decide whether a change lands, never while tuning.

- [ ] **Step 8: Commit the gold set and the baseline**

```bash
git add data/eval/manifest.json data/eval/gold docs/eval
git status --short   # the corpus and the runs must not appear
git commit -m "eval: gold set v1 and the extract-2 baseline on the development and held-out sets" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin staging
```

Phase 0 is done when this commit is on `staging`: the baseline report exists, and the held-out set is sealed.

---

## Self-review notes

- Spec §9 coverage: corpus and git-ignore (Task 1), gold format with concepts and expected checks (Task 6), `live` (Task 4), labelling flow `export` → correct → `freeze` (Tasks 5–6, 10), strata and the measures (Tasks 7–8), the delta against an earlier run and publishing under `docs/eval/` (Task 8), baseline before any change and the sealed held-out set (Task 10). `replay` and `calc` modes are phase 1's, as §9 and §11 state; the artefacts are the wire format so replay can read them.
- One refinement of §9's words: `live` runs the workflow in-process with the extractor's own model configuration rather than over HTTP, because the harness needs the model call count, which the wire format does not carry, and the worker's tests already cover the HTTP layer with a fake extractor. The numbers measured are the same reading.
- Matching by printed label is a phase 0 limit (Review Focus 2 and 3 pin its behaviour); phase 1 adds matching by concept and the mapping accuracy measures.
- Type names used across tasks: `Filing`, `Manifest`, `EvalPaths`, `Artefact`, `ModelCalls`, `ArtefactError`, `GoldFact`, `GoldFiling`, `ExpectedCheck`, `FactScore`, `FilingScore`, `Summary`, `RunScore`; functions `run_filing`, `run_live`, `sheet_rows`, `export_run`, `freeze_sheet`, `write_gold`, `read_gold`, `score_filing`, `score_run`, `score_run_dir`, `render_markdown`, `write_report`. Each is defined in the task its Interfaces block names and used with the same signature afterwards.
