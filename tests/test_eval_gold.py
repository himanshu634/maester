"""Freeze: a checked sheet becomes a gold file. Offline."""

import csv
from datetime import datetime, timezone
import errno
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

from eval_fixtures import FILING, WHEN, plain, row, scored_row
from test_extraction_workflow import FAST, PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli, files
from maester_eval.artefacts import artefact_path, write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import (
    ExpectedCheck, FreezeError, GoldFact, GoldFiling, GoldSealedError, count_unverified, freeze_sheet, gold_path,
    read_gold, read_sheet, write_gold,
)
from maester_eval.paths import EvalPaths
from maester_eval.runner import run_filing
from maester_eval.sheets import SHEET_COLUMNS, sheet_path, sheet_rows, write_sheet
from pdf_financial_qa.workflow.model import LocateOutput

TAXONOMY = load_taxonomy()
OTHER = FILING.model_copy(update={"file": "other-industries/ar-2025-26.pdf", "company": "Other Industries Limited"})


def gold_of(*rows, **keywords):
    """The gold file of `rows` for the fixture filing."""
    return freeze_sheet(list(rows), FILING, TAXONOMY, WHEN, **keywords)


def reread(artefact, label, **changes):
    """The artefact of a second run over the same filing, in which the line `label` was read differently."""
    facts = [dict(fact, **changes) if fact["reportedLabel"] == label else fact for fact in artefact.result["facts"]]
    return artefact.model_copy(update={"result": dict(artefact.result, facts=facts)})


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
        # Decimal keeps the printed decimals, so -2100.5 × 100000 is -210050000.0, as 1200.0 stays 1200.0 in the test below.
        self.assertEqual((fact.printed, fact.value, fact.scale, fact.normalized_value, fact.page_index, fact.period_end),
                         ("(2,100.5)", "-2100.5", "100000", "-210050000.0", 6, "2026-03-30"))

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

    def test_adds_up_is_yes_no_or_not_said(self):
        rows = [scored_row(adds_up="yes"),
                scored_row(row="2", concept="total_equity_and_liabilities", adds_up="NO"),
                scored_row(row="3", concept="inventories", adds_up="")]
        checks = gold_of(*rows).expected_checks
        self.assertEqual([(c.concept, c.basis, c.period_label, c.adds_up) for c in checks],
                         [("total_assets", "consolidated", "As at 31 March 2026", True),
                          ("total_equity_and_liabilities", "consolidated", "As at 31 March 2026", False)])

    def test_an_adds_up_that_is_not_yes_or_no_is_refused(self):
        for adds_up in ("Y", "TRUE", "1", "maybe"):
            with self.subTest(adds_up=adds_up):
                with self.assertRaises(FreezeError) as caught:
                    gold_of(scored_row(adds_up=adds_up))
                self.assertEqual(str(caught.exception), "sheet row 2: adds_up must be yes, no or empty")
        self.assertEqual(len(gold_of(scored_row(), row(row="2", adds_up="Y")).facts), 1)  # a row not kept is not read

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

    def test_one_concept_in_another_period_or_basis_is_another_fact(self):
        rows = [scored_row(),
                scored_row(row="2", period_label="As at 31 March 2025", period_end="2025-03-31"),
                scored_row(row="3", basis="standalone")]
        self.assertEqual([(f.basis, f.period_label) for f in gold_of(*rows).facts],
                         [("consolidated", "As at 31 March 2026"), ("consolidated", "As at 31 March 2025"),
                          ("standalone", "As at 31 March 2026")])

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

    def test_a_page_is_digits_or_the_float_a_spreadsheet_made_of_them(self):
        for page in ("7.5", "NaN", "Infinity", "1E+3", "seven"):
            with self.subTest(page=page), self.assertRaisesRegex(
                    FreezeError, rf"sheet row 2: page '{re.escape(page)}' is not a whole number"):
                gold_of(scored_row(gold_page=page))
        for page in ("0", "-3"):
            with self.subTest(page=page), self.assertRaisesRegex(
                    FreezeError, rf"sheet row 2: page '{page}' must be 1 or more \(gold_page\)"):
                gold_of(scored_row(gold_page=page))
        for page in ("7", "07", "7.0", "7.00"):
            with self.subTest(page=page):
                self.assertEqual(gold_of(scored_row(gold_page=page)).facts[0].page_index, 6)

    def test_a_statement_or_basis_outside_the_vocabulary_names_its_column(self):
        for column, value in (("statement", "balance sheet"), ("basis", "Consolidated")):
            with self.subTest(column=column), self.assertRaisesRegex(FreezeError, rf"^sheet row 2: {column}: Input should be "):
                gold_of(scored_row(**{column: value}))

    def test_errors_never_carry_the_text_of_the_filing(self):
        # The messages reach the console, which holds ids, codes and counts only.
        problems = (
            [scored_row(gold_text="two thousand", label="Total assets (₹ in crores)")],
            [scored_row(statement="balance sheet")],
            [scored_row(), scored_row(row="2")],  # the same line twice
        )
        for rows in problems:
            with self.assertRaises(FreezeError) as caught:
                gold_of(*rows)
            for text in ("two thousand", "Total assets", "As at 31 March 2026", "Assets", "₹"):
                self.assertNotIn(text, str(caught.exception))

    def test_a_sheet_with_nothing_verified_is_refused_so_no_empty_gold_is_sealed(self):
        blank = {column: "" for column in SHEET_COLUMNS}
        nothing_verified = (
            [],
            [row(concept="total_assets"), row(row="2", concept="total_assets", verified="no"), row(row="3", verified="y")],
            [dict(blank, note="extraction failed: NO_STATEMENTS_FOUND")],  # the sheet of a filing that failed
        )
        for rows in nothing_verified:
            with self.subTest(rows=len(rows)):
                with self.assertRaises(FreezeError) as caught:
                    gold_of(*rows)
                self.assertEqual(str(caught.exception), "no row is marked verified=yes; nothing to freeze")

    def test_the_rows_freeze_leaves_out_are_those_with_something_in_them_that_are_not_marked_yes(self):
        blank = {column: "" for column in SHEET_COLUMNS}
        rows = [
            scored_row(),  # kept
            scored_row(row="2", verified="YES"),  # kept: case does not matter
            row(row="3"),  # not marked
            row(row="4", verified="y"),  # marked, but not with "yes"
            dict(blank, verified="no"),  # only a verdict in it
            dict(blank, note="extraction failed: NO_STATEMENTS_FOUND"),  # the one row of a filing that failed
            blank, blank,  # the empty lines a spreadsheet leaves at the end of a sheet
        ]
        self.assertEqual(count_unverified(rows), 4)
        self.assertEqual(count_unverified([]), 0)

    def test_the_row_number_is_read_only_when_the_artefact_is_given(self):
        self.assertEqual(gold_of(scored_row(row="x")).facts[0].concept, "total_assets")

    def test_the_gold_file_carries_the_filings_stratum_and_page_spread(self):
        plain = gold_of(scored_row())
        self.assertEqual((plain.stratum, plain.printed_pages_per_page), (None, 1))
        spread = FILING.model_copy(update={"stratum": "mid", "printed_pages_per_page": 2})
        gold = freeze_sheet([scored_row()], spread, TAXONOMY, WHEN)
        self.assertEqual((gold.stratum, gold.printed_pages_per_page, gold.set, gold.kind), ("mid", 2, "dev", "annual_report"))


class RetypedCellsTests(unittest.TestCase):
    """Without the artefact: a spreadsheet may have turned `2026-03-31` into `31/03/2026` and `10000000` into `1E+07`."""

    RUN_HINT = "(a spreadsheet may have retyped it; pass --run to read it from the artefact)"
    TEXT_HINT = "(a spreadsheet may have retyped it; keep the column as text)"

    def refusal(self, **changes):
        with self.assertRaises(FreezeError) as caught:
            gold_of(scored_row(**changes))
        return str(caught.exception)

    def test_a_date_that_is_not_iso_is_refused_and_points_at_the_artefact(self):
        self.assertEqual(self.refusal(period_end="31/03/2026"),
                         f"sheet row 2: period_end '31/03/2026' is not a date written YYYY-MM-DD {self.RUN_HINT}")

    def test_a_scale_that_is_not_a_whole_number_is_refused_and_points_at_the_artefact(self):
        self.assertEqual(self.refusal(scale_factor="1E+07"),
                         f"sheet row 2: scale_factor '1E+07' is not a whole number {self.RUN_HINT}")
        self.assertEqual(self.refusal(scale_factor="10000000.0"),
                         f"sheet row 2: scale_factor '10000000.0' is not a whole number {self.RUN_HINT}")

    def test_a_gold_column_that_was_retyped_gets_a_message_that_does_not_point_at_the_artefact(self):
        # `--run` never reads gold_scale or gold_period_end, so it cannot repair them.
        self.assertEqual(self.refusal(gold_period_end="30/03/2026"),
                         f"sheet row 2: gold_period_end '30/03/2026' is not a date written YYYY-MM-DD {self.TEXT_HINT}")
        self.assertEqual(self.refusal(gold_scale="1E+05"), f"sheet row 2: gold_scale '1E+05' is not a whole number {self.TEXT_HINT}")

    def test_a_scale_of_zero_or_with_a_leading_zero_is_refused(self):
        for column in ("scale_factor", "gold_scale"):
            for scale in ("0", "00", "007", "010000000"):
                with self.subTest(column=column, scale=scale):
                    self.assertEqual(
                        self.refusal(**{column: scale}),
                        f"sheet row 2: {column} '{scale}' is not a scale: use a whole number from 1 without a leading zero")
        for scale in ("1", "1000", "10000000"):
            self.assertEqual(gold_of(scored_row(scale_factor=scale)).facts[0].scale, scale)

    def test_a_row_added_by_hand_is_not_pointed_at_the_artefact(self):
        # `--run` has no fact behind a row with no `row` number, so it cannot give that row anything back.
        self.assertEqual(self.refusal(row="", period_end="31/03/2026"),
                         f"sheet row 2: period_end '31/03/2026' is not a date written YYYY-MM-DD {self.TEXT_HINT}")
        self.assertEqual(self.refusal(row="", scale_factor="1E+07"),
                         f"sheet row 2: scale_factor '1E+07' is not a whole number {self.TEXT_HINT}")

    def test_a_date_must_be_a_real_calendar_date_in_iso_form(self):
        for text in ("2026-02-30", "2026-13-01", "20260331", "2026-3-31", "31-03-2026", "2026-03-31T00:00", "March 2026"):
            with self.subTest(date=text):
                self.assertIn("is not a date written YYYY-MM-DD", self.refusal(gold_period_end=text))

    def test_the_column_a_person_filled_in_decides_so_the_one_beside_it_may_stay_retyped(self):
        fact = gold_of(scored_row(period_end="31/03/2026", gold_period_end="2026-03-31",
                                  scale_factor="1E+07", gold_scale="10000000")).facts[0]
        self.assertEqual((fact.period_end, fact.scale), ("2026-03-31", "10000000"))

    def test_a_blank_date_is_no_date_and_a_blank_scale_is_a_missing_one(self):
        self.assertIsNone(gold_of(scored_row(period_end="")).facts[0].period_end)
        self.assertIn("no scale (fill gold_scale", self.refusal(scale_factor=""))

    def test_a_scale_matters_only_for_a_monetary_figure(self):
        dash = scored_row(printed="-", scale_factor="1E+07")
        per_share = scored_row(row="2", concept="eps_basic", statement="income_statement", printed="12.50",
                               scale_factor="1E+07", gold_scale="1E+07")
        dash_fact, per_share_fact = gold_of(dash, per_share).facts
        self.assertEqual((dash_fact.scale, per_share_fact.scale), (None, "1"))


class FreezeFromTheArtefactTests(unittest.TestCase):
    """A sheet exported from a run, saved by a spreadsheet application, and frozen with that run's artefact."""

    def setUp(self):
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        self.exported = {r["label"]: r for r in sheet_rows(self.artefact)}

    def checked(self, exported_label, concept, **changes):
        """The row exported for the line `exported_label`, labelled and verified by a person, then changed by `changes`."""
        return dict(self.exported[exported_label], concept=concept, verified="yes", **changes)

    def freeze(self, *rows):
        return gold_of(*rows, artefact=self.artefact)

    def test_the_cells_a_spreadsheet_retyped_are_read_again_from_the_artefact(self):
        # What a spreadsheet makes of the pipeline's cells: 2,000 as 2,000.00, (3,000) as -3000, 10000000 as 1E+07,
        # a date as the machine's locale writes it, 2 as 2.0.
        retyped = dict(scale_factor="1E+07", period_end="31/03/2026")
        total = self.checked("Total assets", "total_assets", printed="2,000.00", page="2.0", **retyped)
        expenses = self.checked("Expenses", "total_expenses", printed="-3000", page="3.0", **retyped)
        with self.assertRaises(FreezeError):  # the same sheet, without the artefact
            gold_of(total, expenses)
        assets_fact, expenses_fact = self.freeze(total, expenses).facts
        # A balance sheet line is placed by its as-at date (asOfDate), a profit and loss line by its period end (periodEnd).
        self.assertEqual((assets_fact.printed, assets_fact.value, assets_fact.scale, assets_fact.normalized_value,
                          assets_fact.period_end, assets_fact.page_index),
                         ("2,000", "2000", "10000000", "20000000000", "2026-03-31", 1))
        self.assertEqual((expenses_fact.printed, expenses_fact.value, expenses_fact.scale, expenses_fact.normalized_value,
                          expenses_fact.period_end, expenses_fact.page_index),
                         ("(3,000)", "-3000", "10000000", "-30000000000", "2026-03-31", 2))
        self.assertEqual((assets_fact.statement, assets_fact.basis, assets_fact.section, assets_fact.label,
                          assets_fact.period_label),
                         ("balance_sheet", "consolidated", "Assets", "Total assets", "As at 31 March 2026"))

    def test_a_cell_that_only_looks_different_still_agrees(self):
        looks_different = (
            ("statement", "Balance sheet"), ("basis", "CONSOLIDATED"), ("section", "assets"),
            ("period_label", "AS AT 31 MARCH 2026"), ("period_label", "31/03/2026"),  # the same words, or the same date
            ("period_end", "2026-03-31"), ("period_end", "31/03/2026"), ("period_end", "31/3/2026"),
            ("printed", "2000"), ("printed", "2,000.00"), ("printed", "₹ 2,000"),
            ("scale_factor", "1E+07"), ("scale_factor", "10000000.0"), ("page", "2.0"), ("page", "02"),
        )
        for column, value in looks_different:
            with self.subTest(column=column, value=value):
                fact = self.freeze(self.checked("Total assets", "total_assets", **{column: value})).facts[0]
                self.assertEqual((fact.statement, fact.basis, fact.section, fact.period_label, fact.period_end,
                                  fact.printed, fact.scale, fact.page_index),
                                 ("balance_sheet", "consolidated", "Assets", "As at 31 March 2026", "2026-03-31",
                                  "2,000", "10000000", 1))

    def test_an_edited_cell_is_refused_naming_its_column_and_never_dropped(self):
        edited = (
            ("statement", "income_statement"), ("basis", "standalone"), ("section", "Liabilities"),
            ("statement", "balance"), ("basis", "consolidate"), ("section", "Asset"), ("section", "ssets"),  # a part of it
            ("statement", "balance sheet notes"), ("basis", "consolidated and standalone"), ("section", "Assets held"),  # more
            ("period_label", "As at 31 March 2025"), ("period_label", "As at 31 March"), ("period_label", "FY2026"),
            ("period_end", "2025-03-31"), ("period_end", "31/03/2025"), ("period_end", "03/31/2026"), ("period_end", "March"),
            ("printed", "2,100"), ("printed", "-2,000"), ("printed", "-"), ("printed", "two thousand"),
            ("scale_factor", "100000"), ("scale_factor", "crore"), ("scale_factor", "sNaN"),
            ("page", "3"), ("page", "2.5"), ("page", "NaN"), ("page", "Infinity"), ("page", "x"),
        )
        for column, value in edited:
            with self.subTest(column=column, value=value):
                with self.assertRaises(FreezeError) as caught:
                    self.freeze(self.checked("Total assets", "total_assets", **{column: value}))
                self.assertEqual(str(caught.exception), f"sheet row 2: {column} no longer matches the artefact")

    def test_an_edited_cell_of_a_line_with_no_date_is_refused_too(self):
        # "FY2026" and the blank period_end read as no date on either side, and no date on both sides is not agreement.
        flow = "net_cash_from_operating_activities"
        for column, value in (("period_label", "FY2025"), ("period_end", "March"), ("period_end", "31-03-2026")):
            with self.subTest(column=column, value=value):
                with self.assertRaises(FreezeError) as caught:
                    self.freeze(self.checked("Net cash from operations", flow, **{column: value}))
                self.assertEqual(str(caught.exception), f"sheet row 2: {column} no longer matches the artefact")
        undated = self.freeze(self.checked("Net cash from operations", flow, period_label="fy2026")).facts[0]
        self.assertEqual(undated.period_label, "FY2026")  # the same words, written another way

    def test_a_date_typed_where_the_pipeline_read_none_is_refused_and_belongs_in_gold_period_end(self):
        flow = self.checked("Net cash from operations", "net_cash_from_operating_activities", period_end="2026-03-31")
        with self.assertRaises(FreezeError) as caught:
            self.freeze(flow)
        self.assertEqual(str(caught.exception), "sheet row 2: period_end no longer matches the artefact")

    def test_the_printed_cell_is_not_compared_when_the_person_gave_gold_text(self):
        corrected = self.checked("Total assets", "total_assets", printed="9,999", gold_text="2,001")
        self.assertEqual(self.freeze(corrected).facts[0].printed, "2,001")

    def test_a_second_read_of_the_filing_is_refused_where_it_differs_from_the_sheet(self):
        # The sheet was exported from the first run; the second read the Total assets line differently. The label
        # still matches, so only the figure the person saw can tell them apart.
        second = reread(self.artefact, "Total assets", reportedText="2,100", reportedValue="2100", normalizedValue="21000000000")
        total = self.checked("Total assets", "total_assets")
        with self.assertRaises(FreezeError) as caught:
            gold_of(total, artefact=second)
        self.assertEqual(str(caught.exception), "sheet row 2: printed no longer matches the artefact")
        elsewhere = reread(self.artefact, "Cash", reportedText="1,300", reportedValue="1300", normalizedValue="13000000000")
        self.assertEqual(gold_of(total, artefact=elsewhere).facts[0].printed, "2,000")  # a line the sheet row does not name

    def test_a_figure_the_pipeline_could_not_read_is_not_called_an_edit(self):
        # The sheet shows the same text the artefact holds, so the row is stopped by the figure, not by a mismatch.
        unread = reread(self.artefact, "Total assets", reportedText="n.a.", reportedValue=None, valueStatus="unparsed",
                        normalizedValue=None)
        total = dict(sheet_rows(unread)[2], concept="total_assets", verified="yes")
        self.assertEqual((total["label"], total["printed"]), ("Total assets", "n.a."))
        with self.assertRaises(FreezeError) as caught:
            gold_of(total, artefact=unread)
        self.assertEqual(str(caught.exception), "sheet row 2: cannot read printed as a figure")
        self.assertEqual(gold_of(dict(total, gold_text="2,000"), artefact=unread).facts[0].printed, "2,000")
        with self.assertRaises(FreezeError) as caught:  # a figure typed over it is an edit
            gold_of(dict(total, printed="2,100"), artefact=unread)
        self.assertEqual(str(caught.exception), "sheet row 2: printed no longer matches the artefact")

    def test_a_fact_with_no_date_read_stays_undated_until_the_person_dates_it(self):
        flow = self.checked("Net cash from operations", "net_cash_from_operating_activities")  # its column is headed "FY2026"
        undated = self.freeze(flow).facts[0]
        self.assertEqual((undated.period_label, undated.period_end, undated.page_index), ("FY2026", None, 3))
        self.assertEqual(self.freeze(dict(flow, gold_period_end="2026-03-31")).facts[0].period_end, "2026-03-31")

    def test_a_numbered_row_needs_only_its_row_its_label_and_what_the_person_added(self):
        bare = {column: "" for column in SHEET_COLUMNS}
        bare.update(row=self.exported["Total assets"]["row"], label="total  ASSETS.", concept="total_assets", verified="yes")
        fact = self.freeze(bare).facts[0]  # labels match as the product matches them: case, spacing and punctuation apart
        self.assertEqual((fact.statement, fact.label, fact.printed, fact.scale, fact.period_end, fact.page_index),
                         ("balance_sheet", "Total assets", "2,000", "10000000", "2026-03-31", 1))

    def test_a_row_number_a_spreadsheet_turned_into_a_float_still_finds_its_fact(self):
        number = self.exported["Total assets"]["row"]
        fact = self.freeze(self.checked("Total assets", "total_assets", row=f"{number}.0")).facts[0]
        self.assertEqual(fact.label, "Total assets")

    def test_gold_columns_still_override_what_the_artefact_read(self):
        total = self.checked("Total assets", "total_assets", gold_text="2,001", gold_scale="100000", gold_page="9",
                             gold_period_end="2026-03-30")
        fact = self.freeze(total).facts[0]
        self.assertEqual((fact.printed, fact.value, fact.scale, fact.normalized_value, fact.page_index, fact.period_end),
                         ("2,001", "2001", "100000", "200100000", 8, "2026-03-30"))

    def test_a_gold_column_a_spreadsheet_retyped_is_refused_even_with_the_artefact(self):
        # The artefact never held gold_period_end or gold_scale, so a bad one must not reach the gold file.
        with self.assertRaises(FreezeError) as caught:
            self.freeze(self.checked("Total assets", "total_assets", gold_period_end="30/03/2026"))
        self.assertEqual(str(caught.exception), "sheet row 2: gold_period_end '30/03/2026' is not a date written YYYY-MM-DD "
                                                "(a spreadsheet may have retyped it; keep the column as text)")
        with self.assertRaisesRegex(FreezeError, r"sheet row 2: gold_scale '1E\+05' is not a whole number"):
            self.freeze(self.checked("Total assets", "total_assets", gold_scale="1E+05"))

    def test_a_label_edited_since_the_export_is_refused_with_its_sheet_row(self):
        number = self.exported["Total assets"]["row"]
        cash = self.checked("Cash", "cash_and_cash_equivalents")
        edited = self.checked("Total assets", "total_assets", label="Total assetz")
        with self.assertRaises(FreezeError) as caught:
            self.freeze(cash, edited)
        self.assertEqual(str(caught.exception),
                         f"sheet row 3: row {number} no longer matches the artefact; re-export or fix `row`")

    def test_a_row_number_with_no_fact_behind_it_is_refused(self):
        count = len(self.artefact.result["facts"])
        for number in ("0", "-1", str(count + 1), "99"):
            with self.subTest(row=number):
                with self.assertRaises(FreezeError) as caught:
                    self.freeze(self.checked("Total assets", "total_assets", row=number))
                self.assertEqual(str(caught.exception),
                                 f"sheet row 2: row {int(number)} no longer matches the artefact; re-export or fix `row`")
        with self.assertRaisesRegex(FreezeError, "sheet row 2: row 'x' is not a whole number"):
            self.freeze(self.checked("Total assets", "total_assets", row="x"))

    def test_only_the_rows_that_are_kept_are_matched(self):
        gone = dict(self.exported["Cash"], row="99", label="Removed since the export")  # not verified: skipped, not matched
        gold = self.freeze(gone, self.checked("Total assets", "total_assets"))
        self.assertEqual([fact.concept for fact in gold.facts], ["total_assets"])

    def test_a_failed_extraction_has_no_rows_to_match_but_a_hand_added_row_stands(self):
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        self.assertIsNone(failed.result)
        with self.assertRaisesRegex(FreezeError, "sheet row 2: row 1 no longer matches the artefact"):
            gold_of(scored_row(), artefact=failed)
        added = scored_row(row="", concept="trade_payables", label="Trade payables", gold_text="1,23,456", gold_page="3")
        self.assertEqual(gold_of(added, artefact=failed).facts[0].value, "123456")

    def test_a_hand_added_row_uses_its_own_columns_and_is_checked_like_any_other(self):
        added = scored_row(row="", concept="trade_payables", label="Trade payables", gold_text="1,23,456", gold_page="3")
        self.assertEqual(self.freeze(added).facts[0].period_end, "2026-03-31")
        with self.assertRaises(FreezeError) as caught:
            self.freeze(dict(added, period_end="31/03/2026"))
        # `--run` was passed and cannot help a row the pipeline never wrote.
        self.assertEqual(str(caught.exception), "sheet row 2: period_end '31/03/2026' is not a date written YYYY-MM-DD "
                                                "(a spreadsheet may have retyped it; keep the column as text)")

    def test_two_rows_for_one_key_are_still_refused(self):
        with self.assertRaisesRegex(FreezeError, "sheet row 3: sheet row 2 already has total_assets"):
            self.freeze(self.checked("Total assets", "total_assets"), self.checked("Total assets", "total_assets"))


class ReadSheetTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "sheet.csv"

    def test_cells_are_stripped_and_cells_beyond_the_header_are_dropped(self):
        self.path.write_text("row,verified\n 1 , yes ,stray\n2\n", encoding="utf-8")
        self.assertEqual(read_sheet(self.path), [{"row": "1", "verified": "yes"}, {"row": "2", "verified": ""}])

    def test_a_sheet_with_no_verified_column_is_a_message_about_the_delimiter(self):
        message = "the sheet has no 'verified' column; was it saved with a different delimiter?"
        for content in ("row;verified;concept\n1;yes;total_assets\n", "row\tverified\n1\tyes\n", "row,concept\n1,total_assets\n", ""):
            self.path.write_text(content, encoding="utf-8")
            with self.subTest(content=content):
                with self.assertRaises(FreezeError) as caught:
                    read_sheet(self.path)
                self.assertEqual(str(caught.exception), message)
        self.path.write_text("row,verified\n", encoding="utf-8")
        self.assertEqual(read_sheet(self.path), [])  # a header and no rows is a sheet

    def test_a_sheet_that_is_not_utf8_is_a_message_not_a_traceback(self):
        # What a spreadsheet's plain "CSV" save does to the en dash of a printed-pages cell.
        self.path.write_bytes("row,printed_pages\n1,3–4\n".encode("cp1252"))
        with self.assertRaisesRegex(FreezeError, "sheet.csv is not UTF-8 text; save it as CSV UTF-8"):
            read_sheet(self.path)
        self.path.write_bytes("row,verified\n".encode("utf-16"))  # "Unicode Text"
        with self.assertRaisesRegex(FreezeError, "not UTF-8 text"):
            read_sheet(self.path)


class GoldFilesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.gold_dir = Path(temp.name)

    def test_write_refuses_to_overwrite_and_read_keys_by_id(self):
        gold_dir = self.gold_dir
        gold = freeze_sheet([row(concept="total_assets", verified="yes")], FILING, TAXONOMY, WHEN,
                            exported_from={"run": "20261016T093005Z-baseline", "pipeline_version": "extract-2"})
        path = write_gold(gold_dir, gold)
        self.assertEqual(path, gold_path(gold_dir, FILING.id))
        self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["exported_from"]["run"], "20261016T093005Z-baseline")
        with self.assertRaises(GoldSealedError):
            write_gold(gold_dir, gold)
        write_gold(gold_dir, gold, force=True)
        loaded = read_gold(gold_dir)
        self.assertEqual(list(loaded), [FILING.id])
        self.assertEqual(loaded[FILING.id].facts[0].normalized_value, "20000000000")

    def test_a_sealed_file_is_left_as_it_was(self):
        path = write_gold(self.gold_dir, gold_of(scored_row()))
        path.write_text("sealed", encoding="utf-8")
        with self.assertRaisesRegex(GoldSealedError, "gold is sealed, pass --force to replace it"):
            write_gold(self.gold_dir, gold_of(scored_row()))
        self.assertEqual(path.read_text(encoding="utf-8"), "sealed")

    def test_a_gold_file_reads_back_as_written_in_utf8(self):
        gold = gold_of(scored_row(label="Total assets (₹ in crores) – net", adds_up="yes"), exported_from={"run": "r"})
        path = write_gold(self.gold_dir, gold)
        self.assertIn("Total assets (₹ in crores) – net".encode("utf-8"), path.read_bytes())  # not escaped to ₹
        self.assertEqual(read_gold(self.gold_dir), {FILING.id: gold})
        self.assertEqual(read_gold(self.gold_dir / "nowhere"), {})

    def test_the_gold_files_of_every_filing_are_found_by_id(self):
        for filing in (FILING, OTHER):
            write_gold(self.gold_dir, freeze_sheet([scored_row()], filing, TAXONOMY, WHEN))
        self.assertEqual(sorted(read_gold(self.gold_dir)), [OTHER.id, FILING.id])

    def test_a_gold_file_with_a_key_the_models_do_not_know_is_refused(self):
        data = gold_of(scored_row(adds_up="yes")).model_dump(mode="json")
        for model, where in ((GoldFiling, data), (GoldFact, data["facts"][0]), (ExpectedCheck, data["expected_checks"][0])):
            with self.subTest(model=model.__name__), self.assertRaises(ValueError):
                model.model_validate(dict(where, surprise="x"))


class FreezeCommandTests(unittest.TestCase):
    """`maester-eval freeze` over a temporary data folder. Offline; the real .env and data/eval stay untouched."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.write_manifest(FILING)
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        self.run_dir = self.paths.new_run("test")
        write_artefact(self.run_dir, self.artefact)
        self.record = {"run": self.run_dir.name, "pipeline_version": self.artefact.pipeline_version,
                       "prompt_version": self.artefact.prompt_version, "model": self.artefact.model}
        write_run(self.run_dir, dict(self.record, started_at="2026-10-16T09:30:05+00:00"))
        self.sheet = sheet_path(self.paths.sheets, FILING.id)
        self.gold = gold_path(self.paths.gold, FILING.id)
        self.write_checked_sheet()
        # `_main` loads the repository's real .env before every command, and DEFAULT is the real data/eval. Nothing
        # here may read the one, write into the other or leave a variable behind for the tests that run after this one.
        for patcher in (
            mock.patch.dict(os.environ),
            mock.patch.object(cli, "load_dotenv"),
            mock.patch.object(cli, "DEFAULT", self.paths),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_manifest(self, *filings):
        manifest = {"filings": [filing.model_dump(mode="json") for filing in filings]}
        self.paths.manifest.write_text(json.dumps(manifest), encoding="utf-8")

    def write_checked_sheet(self, **changes):
        """The run's sheet with its Total assets line labelled and verified, and `changes` made to that line."""
        rows = sheet_rows(self.artefact)
        position = [line["label"] for line in rows].index("Total assets")
        rows[position].update(concept="total_assets", verified="yes", **changes)
        write_sheet(self.sheet, rows)
        return position + 2  # its line in the sheet: the header is line 1

    def freeze(self, *args):
        # A wide terminal, so Rich never wraps a line the assertions look for.
        return CliRunner().invoke(cli.app, ["freeze", *args], env={"COLUMNS": "500"})

    def assert_refused(self, result, *messages):
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        for message in messages:
            self.assertIn(message, result.output)

    def test_freezes_the_verified_rows_and_says_where_without_naming_a_figure(self):
        result = self.freeze(FILING.id)
        self.assertEqual(result.exit_code, 0, result.output)
        left_out = len(self.artefact.result["facts"]) - 1  # every line of the sheet but Total assets
        self.assertIn(f"froze 1 fact(s), 0 expected check(s); {left_out} row(s) not verified → "
                      f"{self.gold.relative_to(self.paths.base)}", result.output)
        gold = read_gold(self.paths.gold)[FILING.id]
        self.assertEqual([fact.concept for fact in gold.facts], ["total_assets"])
        self.assertIsNone(gold.exported_from)
        self.assertEqual((gold.stratum, gold.printed_pages_per_page), (None, 1))
        for text in ("Total assets", "2,000", "As at 31 March"):  # never a label or a figure
            self.assertNotIn(text, result.output)

    def test_the_summary_counts_the_rows_it_left_out(self):
        write_sheet(self.sheet, [row(label="Cash"), scored_row(row="2"), row(row="3", label="Inventories")])
        result = self.freeze(FILING.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn(f"froze 1 fact(s), 0 expected check(s); 2 row(s) not verified → "
                      f"{self.gold.relative_to(self.paths.base)}", result.output)

    def test_blank_lines_are_not_counted_and_the_note_of_a_failed_filing_is_one_row(self):
        blank = {column: "" for column in SHEET_COLUMNS}
        note = dict(blank, note="extraction failed: NO_STATEMENTS_FOUND")
        added = scored_row(row="", concept="trade_payables", label="Trade payables", gold_text="1,23,456", gold_page="3")
        write_sheet(self.sheet, [note, added, blank, blank])
        result = self.freeze(FILING.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("froze 1 fact(s), 0 expected check(s); 1 row(s) not verified → ", result.output)

    def test_a_sheet_with_nothing_verified_is_refused_and_seals_nothing(self):
        message = "no row is marked verified=yes; nothing to freeze"
        write_sheet(self.sheet, sheet_rows(self.artefact))  # exported, not checked yet
        self.assert_refused(self.freeze(FILING.id), message)
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        write_sheet(self.sheet, sheet_rows(failed))  # the one note row of a filing that failed
        self.assert_refused(self.freeze(FILING.id), message)
        self.assertFalse(self.gold.exists())
        self.write_checked_sheet()
        self.assertEqual(self.freeze(FILING.id).exit_code, 0)  # nothing was sealed, so no --force is needed

    def test_a_run_gives_back_what_a_spreadsheet_retyped_and_is_recorded(self):
        self.write_checked_sheet(scale_factor="1E+07", period_end="31/03/2026")
        self.assert_refused(self.freeze(FILING.id), "pass --run to read it from the artefact")
        self.assertFalse(self.gold.exists())
        result = self.freeze(FILING.id, "--run", "latest")
        self.assertEqual(result.exit_code, 0, result.output)
        gold = read_gold(self.paths.gold)[FILING.id]
        self.assertEqual((gold.facts[0].scale, gold.facts[0].period_end), ("10000000", "2026-03-31"))
        self.assertEqual(gold.exported_from, self.record)  # the run, the versions and the model; not the run's other keys

    def test_latest_after_a_second_read_of_the_filing_cannot_replace_what_the_sheet_showed(self):
        line = self.write_checked_sheet()
        second = self.paths.new_run("reread", now=datetime(2099, 1, 1, tzinfo=timezone.utc))  # the latest run
        write_run(second, self.record)
        write_artefact(second, reread(self.artefact, "Total assets", reportedText="2,100", reportedValue="2100",
                                      normalizedValue="21000000000"))
        result = self.freeze(FILING.id, "--run", "latest")
        self.assert_refused(result, f"sheet row {line}: printed no longer matches the artefact")
        for text in ("2,100", "2,000"):  # never a figure
            self.assertNotIn(text, result.output)
        self.assertFalse(self.gold.exists())
        self.assertEqual(self.freeze(FILING.id, "--run", self.run_dir.name).exit_code, 0)  # the run it came from still works

    def test_a_cell_edited_since_the_export_is_refused_with_its_column(self):
        line = self.write_checked_sheet(basis="standalone")
        self.assert_refused(self.freeze(FILING.id, "--run", self.run_dir.name),
                            f"sheet row {line}: basis no longer matches the artefact")
        self.assertFalse(self.gold.exists())

    def test_a_sheet_saved_with_another_delimiter_is_a_message_not_nothing_to_freeze(self):
        self.sheet.write_text("row;verified;concept\n1;yes;total_assets\n", encoding="utf-8")
        result = self.freeze(FILING.id)
        self.assert_refused(result, "the sheet has no 'verified' column; was it saved with a different delimiter?")
        self.assertNotIn("nothing to freeze", result.output)

    def test_a_run_that_lacks_the_filing_is_named(self):
        elsewhere = self.paths.new_run("elsewhere", now=datetime(2099, 1, 1, tzinfo=timezone.utc))  # the latest run
        write_run(elsewhere, self.record)
        write_artefact(elsewhere, run_filing(OTHER, PDF, lambda: ScriptedModel(), FAST))
        # `latest` is a word, not a run: the message names the folder it stood for.
        self.assert_refused(self.freeze(FILING.id, "--run", "latest"), f"run {elsewhere.name} has no artefact for {FILING.id}")
        self.assertFalse(self.gold.exists())

    def test_only_the_filings_own_artefact_is_read(self):
        # Another filing's artefact, torn, does not stop this filing's freeze: `freeze --run` reads one file.
        torn = artefact_path(self.run_dir, OTHER.id)
        torn.parent.mkdir(parents=True)
        torn.write_text('{"filing_id": "other-industries/ar-2025-26", "result": {"facts": [{"reportedLabel": "Cash', encoding="utf-8")
        result = self.freeze(FILING.id, "--run", self.run_dir.name)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(read_gold(self.paths.gold)[FILING.id].exported_from, self.record)

    def test_an_artefact_or_run_json_that_cannot_be_read_is_named_and_nothing_in_it_is_shown(self):
        line = self.write_checked_sheet()
        artefact = artefact_path(self.run_dir, FILING.id)
        record = self.run_dir / "run.json"
        for path, content, message in (
            (artefact, artefact.read_text(encoding="utf-8")[:900], f"{artefact} is not a readable artefact"),  # torn
            (artefact, json.dumps(dict(self.artefact.model_dump(mode="json"), result="Total assets 2,000")),
             f"{artefact} is not a readable artefact"),
            (record, '{"run": "', f"{record} is not a readable run.json"),
            (record, json.dumps(dict(self.record, set="Total assets 2,000")), f"{record} is not a readable run.json"),
        ):
            with self.subTest(path=path.name, content=content[:20]):
                kept = path.read_text(encoding="utf-8")
                path.write_text(content, encoding="utf-8")
                result = self.freeze(FILING.id, "--run", self.run_dir.name)
                self.assert_refused(result, message)
                for text in ("Total assets", "2,000"):
                    self.assertNotIn(text, result.output)
                self.assertFalse(self.gold.exists())
                path.write_text(kept, encoding="utf-8")
        self.assertEqual(self.freeze(FILING.id, "--run", self.run_dir.name).exit_code, 0, line)

    def test_a_run_folder_with_no_record_and_a_missing_run_are_messages(self):
        bare = self.paths.new_run("bare")
        self.assert_refused(self.freeze(FILING.id, "--run", bare.name), "run.json")
        self.assert_refused(self.freeze(FILING.id, "--run", "no[/b]"), "no run 'no[/b]' under")
        self.assert_refused(self.freeze(FILING.id, "--run", ""), "no run '' under")  # an empty value is not "no run"
        self.assertFalse(self.gold.exists())

    def test_a_row_that_no_longer_matches_the_run_is_refused_with_its_sheet_row(self):
        line = self.write_checked_sheet(label="Total assetz")
        self.assert_refused(self.freeze(FILING.id, "--run", self.run_dir.name),
                            f"sheet row {line}: row 3 no longer matches the artefact; re-export or fix `row`")
        self.assertFalse(self.gold.exists())

    def assert_write_refused(self, result):
        """Refused with `cannot write <the gold file>: <reason>`, never the temporary file or a figure of the filing."""
        self.assert_refused(result, f"cannot write {self.gold}: ")
        for text in (".tmp", "Traceback", "Total assets", "2,000"):
            self.assertNotIn(text, result.output)

    def test_a_gold_file_that_cannot_be_written_is_a_message(self):
        self.paths.gold.write_text("a file where the folder should be", encoding="utf-8")
        self.assert_write_refused(self.freeze(FILING.id))

    def test_a_forced_gold_file_that_cannot_be_replaced_is_a_message_and_stays_as_it_was(self):
        self.assertEqual(self.freeze(FILING.id).exit_code, 0)
        sealed = self.gold.read_text(encoding="utf-8")
        refused = PermissionError(errno.EACCES, "Permission denied", "x")
        with mock.patch.object(files.os, "replace", side_effect=refused):
            result = self.freeze(FILING.id, "--force")
        self.assert_write_refused(result)
        self.assertIn("Permission denied", result.output)
        self.assertEqual(self.gold.read_text(encoding="utf-8"), sealed)
        self.assertEqual(list(self.gold.parent.iterdir()), [self.gold])  # the temporary file is gone

    def test_gold_is_sealed_until_forced(self):
        self.assertEqual(self.freeze(FILING.id).exit_code, 0)
        first = self.gold.read_text(encoding="utf-8")
        self.assert_refused(self.freeze(FILING.id), "gold is sealed, pass --force to replace it")
        self.assertEqual(self.gold.read_text(encoding="utf-8"), first)
        self.write_checked_sheet(adds_up="no")
        forced = self.freeze(FILING.id, "--force")
        self.assertEqual(forced.exit_code, 0, forced.output)
        self.assertIn("froze 1 fact(s), 1 expected check(s)", forced.output)
        self.assertEqual(len(read_gold(self.paths.gold)[FILING.id].expected_checks), 1)

    def test_an_id_outside_the_manifest_and_a_filing_with_no_sheet_are_messages(self):
        self.assert_refused(self.freeze("someone/else"), "someone/else is not in the manifest")
        self.sheet.unlink()
        self.assert_refused(self.freeze(FILING.id), "no sheet at", "maester-eval export")
        self.paths.manifest.unlink()
        self.assert_refused(self.freeze(FILING.id), "no manifest at")
        self.assertFalse(self.paths.gold.exists())

    def test_a_bad_row_is_a_message_that_names_the_row_and_no_figure(self):
        line = self.write_checked_sheet(gold_text="two thousand")
        result = self.freeze(FILING.id)
        self.assert_refused(result, f"sheet row {line}: cannot read gold_text as a figure")
        for text in ("two thousand", "Total assets"):
            self.assertNotIn(text, result.output)
        self.assertFalse(self.gold.exists())

    def test_a_sheet_that_is_not_utf8_is_a_message(self):
        self.sheet.write_bytes("row,label\n1,Cash – net\n".encode("cp1252"))
        self.assert_refused(self.freeze(FILING.id), "not UTF-8 text; save it as CSV UTF-8")

    def test_a_filing_id_is_printed_as_written(self):
        # Rich would read `[final]` as a style tag and drop it, from the path in the froze line and from a refusal.
        odd = FILING.model_copy(update={"file": "synthetic-industries/ar[final]-2025-26.pdf"})
        self.write_manifest(odd)
        write_sheet(sheet_path(self.paths.sheets, odd.id), [scored_row()])
        result = self.freeze(odd.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn(f"→ {gold_path(self.paths.gold, odd.id).relative_to(self.paths.base)}", result.output)
        self.assert_refused(self.freeze(odd.id), "ar[final]-2025-26.json exists; gold is sealed")

    def test_the_help_names_the_options(self):
        result = self.freeze("--help")
        self.assertEqual(result.exit_code, 0, result.output)
        for text in ("--run", "--force", "verified",
                     "Read the machine columns back from the run's artefact (a spreadsheet may have retyped them); "
                     "a cell you edited must still agree with it, or the row is refused."):
            self.assertIn(text, plain(result.output))


if __name__ == "__main__":
    unittest.main()
