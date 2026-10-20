"""Export: artefacts become labelling sheets. Offline."""

import csv
from datetime import datetime, timezone
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import plain
from test_extraction_workflow import FAST, PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import read_artefacts, write_artefact
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.runner import run_filing
from maester_eval.sheets import SHEET_COLUMNS, export_run, sheet_path, sheet_rows, write_sheet
from pdf_financial_qa.workflow.model import LocateOutput

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")
OTHER = Filing(file="other-industries/ar-2025-26.pdf", company="Other Industries Limited",
               kind="annual_report", period_end="2026-03-31", set="dev")
# The same report printed as spreads: PDF page N holds printed pages 2N-1 and 2N.
SPREAD = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev", printed_pages_per_page=2)


def failed_artefact(filing):
    """A filing the model finds no statements in: an error and no result."""
    return run_filing(filing, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)


def with_first_fact(artefact, **changes):
    """The artefact with the first fact's wire fields changed: facts the scripted model cannot produce."""
    facts = artefact.result["facts"]
    return artefact.model_copy(update={"result": dict(artefact.result, facts=[dict(facts[0], **changes), *facts[1:]])})


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

    def test_material_hint_covers_the_lines_the_column_promises(self):
        flagged = ("Total income", "Revenue", "Revenue from operations", "Profit before tax", "Loss for the year",
                   "Basic earnings per share (₹)", "Cash", "Cash and cash equivalents",
                   "Net cash from operating activities", "Non-current borrowings", "Finance costs", "Dividend paid")
        unflagged = ("Inventories", "Trade payables", "Goodwill", "Other equity", "Property, plant and equipment")
        for label in (*flagged, *unflagged):
            with self.subTest(label=label):
                row = sheet_rows(with_first_fact(self.artefact, reportedLabel=label))[0]
                self.assertEqual(row["material"], "yes" if label in flagged else "")

    def test_a_failed_filing_gives_one_note_row(self):
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        rows = sheet_rows(failed)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["note"], "extraction failed: NO_STATEMENTS_FOUND")
        self.assertEqual(rows[0]["label"], "")

    def test_the_columns_run_in_the_order_a_person_works_down_them(self):
        self.assertEqual(SHEET_COLUMNS, [
            "row", "statement", "basis", "section", "label", "period_label", "period_end",
            "printed", "value", "unit_label", "scale_factor", "normalized_value", "page", "printed_pages",
            "text_layer_match", "is_subtotal", "material",
            "concept", "gold_text", "gold_scale", "gold_page", "gold_period_end", "adds_up", "verified", "note",
        ])

    def test_printed_pages_equal_the_page_when_a_pdf_page_is_one_printed_page(self):
        rows = sheet_rows(self.artefact)
        self.assertEqual(rows[0]["printed_pages"], "2")
        for row in rows:
            self.assertEqual(row["printed_pages"], row["page"], row["label"])

    def test_printed_pages_name_both_pages_of_a_spread(self):
        rows = {row["label"]: row for row in sheet_rows(run_filing(SPREAD, PDF, lambda: ScriptedModel(), FAST))}
        # PDF page N holds printed pages 2N-1 and 2N, joined by an en dash (U+2013). `page` stays the PDF page.
        for label, page, printed in (("Cash", "2", "3\u20134"), ("Profit", "3", "5\u20136"),
                                     ("Net cash from operations", "4", "7\u20138")):
            self.assertEqual((rows[label]["page"], rows[label]["printed_pages"]), (page, printed), label)

    def test_period_end_is_the_facts_one_date_whichever_field_holds_it(self):
        facts = {fact["reportedLabel"]: fact for fact in self.artefact.result["facts"]}
        # The premise: the pipeline keeps a balance sheet date in asOfDate and a profit and loss date in periodEnd.
        self.assertEqual((facts["Total assets"]["periodEnd"], facts["Total assets"]["asOfDate"]), (None, "2026-03-31"))
        self.assertEqual((facts["Expenses"]["periodEnd"], facts["Expenses"]["asOfDate"]), ("2026-03-31", None))
        by_label = {r["label"]: r["period_end"] for r in sheet_rows(self.artefact)}
        self.assertEqual(by_label["Total assets"], "2026-03-31")  # from asOfDate
        self.assertEqual(by_label["Expenses"], "2026-03-31")  # from periodEnd
        # "FY2026" is not a date, so neither field holds one and the cell stays blank for gold_period_end.
        self.assertEqual(by_label["Net cash from operations"], "")
        # No fact has both, but were both set the period end would win.
        both = with_first_fact(self.artefact, periodEnd="2026-03-31", asOfDate="2025-03-31")
        self.assertEqual(sheet_rows(both)[0]["period_end"], "2026-03-31")

    def test_flags_are_words_and_missing_figures_are_blank(self):
        rows = sheet_rows(with_first_fact(
            self.artefact, reportedText="-", reportedValue=None, valueStatus="dash", unitLabel=None, scaleFactor=None,
            normalizedValue=None, periodEnd=None, asOfDate=None, textLayerMatch=False))
        picked = ("printed", "value", "unit_label", "scale_factor", "normalized_value", "period_end",
                  "text_layer_match", "is_subtotal")
        self.assertEqual({column: rows[0][column] for column in picked},
                         {"printed": "-", "value": "", "unit_label": "", "scale_factor": "", "normalized_value": "",
                          "period_end": "", "text_layer_match": "no", "is_subtotal": "no"})
        by_label = {row["label"]: row for row in rows}
        self.assertEqual(by_label["Total assets"]["is_subtotal"], "yes")
        self.assertEqual(by_label["Net cash from operations"]["text_layer_match"], "")  # a scan has no text to check

    def test_a_failed_filing_row_is_blank_but_for_its_note(self):
        (row,) = sheet_rows(failed_artefact(SPREAD))
        self.assertEqual(list(row), SHEET_COLUMNS)
        self.assertEqual({column: value for column, value in row.items() if value},
                         {"note": "extraction failed: NO_STATEMENTS_FOUND"})
        # Not something a run produces, but a result-less artefact with no error still says it failed.
        unexplained = failed_artefact(SPREAD).model_copy(update={"error": None})
        self.assertEqual(sheet_rows(unexplained)[0]["note"], "extraction failed: unknown")


class SheetPathTests(unittest.TestCase):
    def test_a_sheet_is_the_filing_id_as_a_csv_file_under_the_sheets_folder(self):
        self.assertEqual(sheet_path(Path("sheets"), "synthetic-industries/ar-2025-26"),
                         Path("sheets") / "synthetic-industries" / "ar-2025-26.csv")


class WriteSheetTests(unittest.TestCase):
    def test_awkward_text_reads_back_as_written(self):
        blank = {column: "" for column in SHEET_COLUMNS}
        rows = [
            dict(blank, row="1", label='Profit, "net" of tax\n(₹ in crores)', printed="(3,000)", note="Nestlé – café"),
            dict(blank, row="2", label="Total assets", printed="2,000", material="yes"),
        ]
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "synthetic-industries" / "ar-2025-26.csv"  # the folder does not exist yet
            write_sheet(path, rows)
            raw = path.read_bytes()
            with path.open(encoding="utf-8-sig", newline="") as handle:
                self.assertEqual(list(csv.DictReader(handle)), rows)
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf\xef\xbb\xbf"))  # one BOM, not two
        self.assertEqual(raw.decode("utf-8-sig").splitlines()[0], ",".join(SHEET_COLUMNS))
        self.assertTrue(raw.endswith(b"\r\n"))  # the CSV writer's line ends, written as they are
        self.assertNotIn(b"\r\r\n", raw)


class ExportRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.run_dir = self.paths.new_run("test")
        write_artefact(self.run_dir, run_filing(FILING, PDF, lambda: ScriptedModel(), FAST))

    def test_writes_a_sheet_with_a_bom_and_never_overwrites_without_force(self):
        written, skipped = export_run(read_artefacts(self.run_dir), self.paths.sheets)
        path = sheet_path(self.paths.sheets, FILING.id)
        self.assertEqual((written, skipped), ([path], []))
        self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"))
        with path.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(list(rows[0]), SHEET_COLUMNS)
        path.write_text("edited by a person", encoding="utf-8")
        self.assertEqual(export_run(read_artefacts(self.run_dir), self.paths.sheets), ([], [path]))
        self.assertEqual(path.read_text(encoding="utf-8"), "edited by a person")
        self.assertEqual(export_run(read_artefacts(self.run_dir), self.paths.sheets, force=True), ([path], []))
        self.assertNotEqual(path.read_text(encoding="utf-8"), "edited by a person")

    def test_only_limits_the_export(self):
        self.assertEqual(export_run(read_artefacts(self.run_dir), self.paths.sheets, only=["someone/else"]), ([], []))

    def test_each_sheet_is_written_or_kept_on_its_own(self):
        write_artefact(self.run_dir, run_filing(OTHER, PDF, lambda: ScriptedModel(), FAST))
        kept = sheet_path(self.paths.sheets, FILING.id)
        kept.parent.mkdir(parents=True)
        kept.write_text("edited by a person", encoding="utf-8")
        written, skipped = export_run(read_artefacts(self.run_dir), self.paths.sheets)
        self.assertEqual((written, skipped), ([sheet_path(self.paths.sheets, OTHER.id)], [kept]))
        self.assertEqual(kept.read_text(encoding="utf-8"), "edited by a person")

    def test_only_names_the_filings_to_export(self):
        write_artefact(self.run_dir, run_filing(OTHER, PDF, lambda: ScriptedModel(), FAST))
        written, skipped = export_run(read_artefacts(self.run_dir), self.paths.sheets, only=[OTHER.id])
        self.assertEqual((written, skipped), ([sheet_path(self.paths.sheets, OTHER.id)], []))
        self.assertFalse(sheet_path(self.paths.sheets, FILING.id).exists())

    def test_a_failed_filing_gets_a_sheet_with_its_note(self):
        write_artefact(self.run_dir, failed_artefact(OTHER))
        export_run(read_artefacts(self.run_dir), self.paths.sheets, only=[OTHER.id])
        with sheet_path(self.paths.sheets, OTHER.id).open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual([row["note"] for row in rows], ["extraction failed: NO_STATEMENTS_FOUND"])


class ExportCommandTests(unittest.TestCase):
    """`maester-eval export` over a temporary data folder. Offline; the real .env and data/eval stay untouched."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.run_dir = self.paths.new_run("test")
        write_artefact(self.run_dir, run_filing(FILING, PDF, lambda: ScriptedModel(), FAST))
        self.sheet = sheet_path(self.paths.sheets, FILING.id)
        self.shown = self.sheet.relative_to(self.paths.base)  # how the command names it
        # `_main` loads the repository's real .env before every command, and DEFAULT is the real data/eval. Nothing
        # here may read the one, write into the other or leave a variable behind for the tests that run after this one.
        for patcher in (
            mock.patch.dict(os.environ),
            mock.patch.object(cli, "load_dotenv"),
            mock.patch.object(cli, "DEFAULT", self.paths),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def export(self, *args):
        # A wide terminal, so Rich never wraps a line the assertions look for.
        return CliRunner().invoke(cli.app, ["export", *args], env={"COLUMNS": "200"})

    def test_writes_the_sheet_and_says_where(self):
        result = self.export()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue(self.sheet.is_file())
        self.assertIn(f"wrote {self.shown}", result.output)
        self.assertIn("1 written, 0 kept", result.output)
        for text in ("Total assets", "1,200", "Revenue"):  # never a label or a figure
            self.assertNotIn(text, result.output)

    def test_a_sheet_that_exists_is_kept_until_forced(self):
        self.assertEqual(self.export().exit_code, 0)
        self.sheet.write_text("edited by a person", encoding="utf-8")
        kept = self.export()
        self.assertEqual(kept.exit_code, 0, kept.output)
        self.assertIn(f"kept  {self.shown} (exists; --force to overwrite)", kept.output)
        self.assertIn("0 written, 1 kept", kept.output)
        self.assertEqual(self.sheet.read_text(encoding="utf-8"), "edited by a person")
        forced = self.export("--force")
        self.assertEqual(forced.exit_code, 0, forced.output)
        self.assertIn(f"wrote {self.shown}", forced.output)
        self.assertIn("1 written, 0 kept", forced.output)
        self.assertNotEqual(self.sheet.read_text(encoding="utf-8"), "edited by a person")

    def test_only_limits_the_sheets(self):
        write_artefact(self.run_dir, run_filing(OTHER, PDF, lambda: ScriptedModel(), FAST))
        result = self.export("--only", OTHER.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("1 written, 0 kept", result.output)
        self.assertTrue(sheet_path(self.paths.sheets, OTHER.id).is_file())
        self.assertFalse(self.sheet.exists())

    def test_an_id_that_is_not_in_the_run_is_refused_before_anything_is_written(self):
        result = self.export("--only", "someone/else", "--only", FILING.id, "--only", "a/b[c]")
        self.assertEqual(result.exit_code, 1)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        self.assertIn("not in this run: a/b[c], someone/else", result.output)
        self.assertFalse(self.paths.sheets.exists())  # not even the id that is in the run

    def test_the_artefacts_are_read_once(self):
        with mock.patch.object(cli, "read_artefacts", wraps=read_artefacts) as in_command:
            result = self.export("--only", FILING.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(in_command.call_count, 1)

    def test_a_filing_id_is_printed_as_written(self):
        # Rich would read `[final]` as a style tag and drop it, from the wrote line and from the kept line.
        odd = Filing(file="synthetic-industries/ar[final]-2025-26.pdf", company=FILING.company, kind=FILING.kind,
                     period_end=FILING.period_end, set=FILING.set)
        write_artefact(self.run_dir, run_filing(odd, PDF, lambda: ScriptedModel(), FAST))
        shown = sheet_path(self.paths.sheets, odd.id).relative_to(self.paths.base)
        self.assertIn(f"wrote {shown}", self.export("--only", odd.id).output)
        self.assertIn(f"kept  {shown} (exists; --force to overwrite)", self.export("--only", odd.id).output)

    def test_the_latest_run_is_the_default_and_a_named_run_can_be_chosen(self):
        older = self.paths.new_run("older", now=datetime(2020, 1, 1, tzinfo=timezone.utc))
        write_artefact(older, run_filing(OTHER, PDF, lambda: ScriptedModel(), FAST))
        self.assertEqual(self.export().exit_code, 0)
        self.assertTrue(self.sheet.is_file())
        self.assertFalse(sheet_path(self.paths.sheets, OTHER.id).exists())
        self.assertEqual(self.export("--run", older.name).exit_code, 0)
        self.assertTrue(sheet_path(self.paths.sheets, OTHER.id).is_file())

    def test_no_runs_is_a_message_not_a_traceback(self):
        empty = EvalPaths(Path(self.temp.name) / "empty")
        with mock.patch.object(cli, "DEFAULT", empty):
            result = self.export()
        self.assertEqual(result.exit_code, 1)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        self.assertIn("no runs under", result.output)
        self.assertFalse(empty.sheets.exists())

    def test_a_missing_run_is_named_as_written(self):
        result = self.export("--run", "no[/b]")
        self.assertEqual(result.exit_code, 1)
        self.assertIsInstance(result.exception, SystemExit)
        self.assertIn("no run 'no[/b]' under", result.output)
        self.assertFalse(self.paths.sheets.exists())

    def test_the_help_names_the_options(self):
        result = self.export("--help")
        self.assertEqual(result.exit_code, 0, result.output)
        for text in ("--run", "--only", "--force", "latest"):
            self.assertIn(text, plain(result.output))


if __name__ == "__main__":
    unittest.main()
