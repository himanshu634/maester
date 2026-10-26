"""OCR spot check scoring: the sheet, the engine and cell-matching rules, the report and its commands. Offline."""

import ast
import csv
import dataclasses
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from typer.testing import CliRunner

from eval_fixtures import plain
from maester_eval import cli
from maester_eval.cli import app
from maester_eval.errors import EvalError
from maester_eval.eval_wire import EvalRequestModel
from maester_eval.manifest import Filing, Manifest
from maester_eval.ocr import (
    CONFIGS, DIGITAL_CONFIGS, SCORE_COLUMNS, CellMatchingChoice, DisagreementFile, EngineChoice, OcrPages, OcrScoreError,
    PageRef, ScoreRow, Totals, check_scores, choose_cell_matching, choose_engine, format_rate, read_pages, read_run,
    read_scores, render_ocr_report, totals,
)
from maester_eval.paths import ROOT, EvalPaths

FIXTURES = ROOT / "packages" / "contracts" / "fixtures" / "eval"
FILING = "aether-industries/ar-2024-25"
SLUG = "aether-industries--ar-2024-25"
NOW = datetime(2026, 10, 21, 9, 30, tzinfo=timezone.utc)

MANIFEST = Manifest(filings=[Filing(file=f"{FILING}.pdf", company="Aether Industries Limited", kind="annual_report",
                                    period_end="2025-03-31", set="dev")])
# A and B are scanned, C is digital.
A, B, C = 12, 40, 7
PAGES = OcrPages(scanned=[PageRef(filing=FILING, page=A), PageRef(filing=FILING, page=B)],
                 digital=[PageRef(filing=FILING, page=C)])
ENGINES = {"rapidocr-cm": "rapidocr-onnxruntime 3.9.2", "rapidocr-nocm": "rapidocr-onnxruntime 3.9.2",
           "tesseract-cm": "tesseract-cli 5.5.0 eng:82fe032bd933", "tesseract-nocm": "tesseract-cli 5.5.0 eng:82fe032bd933"}
KIND = {A: "scanned", B: "scanned", C: "digital"}
PRINTED = {A: (300, 25, 40), B: (300, 25, 40), C: (200, 5, 30)}  # numbers, headings, table rows


def score_row(config, page, wrong, missing, extra, headings_wrong, headings_missing, table_rows_wrong, seconds):
    numbers, headings, table_rows = PRINTED[page]
    return ScoreRow(filing=FILING, page=page, kind=KIND[page], config=config, seconds=Decimal(seconds),
                    numbers_printed=numbers, numbers_wrong=wrong, numbers_missing=missing, numbers_extra=extra,
                    headings_printed=headings, headings_wrong=headings_wrong, headings_missing=headings_missing,
                    table_rows_printed=table_rows, table_rows_wrong=table_rows_wrong)


# config, page, numbers_wrong, numbers_missing, numbers_extra, headings_wrong, headings_missing, table_rows_wrong, seconds
ROWS = [score_row(*cells) for cells in [
    ("rapidocr-cm", A, 5, 2, 1, 1, 0, 3, "8.0"),
    ("rapidocr-cm", B, 4, 3, 0, 0, 1, 2, "8.0"),
    ("rapidocr-cm", C, 0, 0, 0, 0, 0, 6, "1.0"),
    ("rapidocr-nocm", A, 6, 2, 1, 1, 0, 1, "7.0"),
    ("rapidocr-nocm", B, 5, 3, 0, 0, 1, 1, "7.0"),
    ("rapidocr-nocm", C, 1, 0, 0, 0, 0, 2, "1.0"),
    ("tesseract-cm", A, 3, 2, 0, 0, 0, 2, "12.0"),
    ("tesseract-cm", B, 2, 2, 1, 0, 0, 2, "12.0"),
    ("tesseract-nocm", A, 4, 2, 0, 0, 0, 1, "11.0"),
    ("tesseract-nocm", B, 3, 2, 1, 0, 0, 2, "11.0"),
]]


def changed(rows, config, pages, **values):
    """A copy of `rows` with `values` set on the rows of `config` that are on one of `pages`."""
    return [dataclasses.replace(row, **values) if row.config == config and row.page in pages else row for row in rows]


def with_number_errors(rows, config, a, b):
    rows = changed(rows, config, [A], numbers_wrong=a, numbers_missing=0)
    return changed(rows, config, [B], numbers_wrong=b, numbers_missing=0)


def with_seconds(rows, config, seconds):
    return changed(rows, config, [A, B], seconds=Decimal(seconds))


def with_table_rows_wrong(rows, config, a, b, c):
    for page, value in ((A, a), (B, b), (C, c)):
        rows = changed(rows, config, [page], table_rows_wrong=value)
    return rows


def with_printed(rows, config, numbers):
    return changed(rows, config, [A, B], numbers_printed=numbers)


def sheet_text(rows=ROWS, edits=None, newline="\n", leave_out=()):
    """The text of a scores sheet: `edits` maps a sheet row number (the header is row 1) to cells that replace the row's."""
    columns = [column for column in SCORE_COLUMNS if column not in leave_out]
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=columns, lineterminator=newline)
    writer.writeheader()
    for offset, row in enumerate(rows):
        engine, cell_matching = CONFIGS[row.config]
        cells = {
            "filing": row.filing, "page": str(row.page), "kind": row.kind, "config": row.config, "engine": engine,
            "cell_matching": "true" if cell_matching else "false", "seconds": str(row.seconds),
            "numbers_printed": row.numbers_printed, "numbers_wrong": row.numbers_wrong, "numbers_missing": row.numbers_missing,
            "numbers_extra": row.numbers_extra, "headings_printed": row.headings_printed, "headings_wrong": row.headings_wrong,
            "headings_missing": row.headings_missing, "table_rows_printed": row.table_rows_printed,
            "table_rows_wrong": row.table_rows_wrong, "checked": "yes",
        }
        cells.update((edits or {}).get(offset + 2, {}))
        writer.writerow({column: cells[column] for column in columns})
    return out.getvalue()


class TempCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def sheet(self, unchecked_line=None, encoding="utf-8", **options):
        if unchecked_line is not None:
            options["edits"] = {unchecked_line: {"checked": ""}}
        path = self.dir / "scores.csv"
        path.write_text(sheet_text(**options), encoding=encoding, newline="")
        return path


class ConstantsTests(unittest.TestCase):
    """apps/eval does not import apps/indexer, so its copies of the sheet's shape are held to the original's source."""

    def test_the_copies_match_the_indexers_constants(self):
        source = (ROOT / "apps" / "indexer" / "src" / "maester_indexer" / "ocr_sample.py").read_text(encoding="utf-8")
        wanted = {"CONFIGS", "DIGITAL_CONFIGS", "SCORE_COLUMNS"}
        found = {}
        for node in ast.parse(source).body:
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id in wanted:
                found[node.target.id] = ast.literal_eval(node.value)
            elif isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in wanted:
                found[node.targets[0].id] = ast.literal_eval(node.value)
        self.assertEqual(set(found), wanted)
        self.assertEqual(CONFIGS, found["CONFIGS"])
        self.assertEqual(list(CONFIGS), list(found["CONFIGS"]))  # the order is the order a run reads them in
        self.assertEqual(DIGITAL_CONFIGS, found["DIGITAL_CONFIGS"])
        self.assertEqual(SCORE_COLUMNS, found["SCORE_COLUMNS"])

    def test_a_score_error_is_an_error_a_command_shows_as_a_message(self):
        self.assertTrue(issubclass(OcrScoreError, EvalError))


class ReadScoresTests(TempCase):
    def test_the_sheet_reads_back_as_the_rows_it_was_made_from(self):
        self.assertEqual(read_scores(self.sheet()), ROWS)

    def test_unchecked_row_is_refused_with_its_line(self):
        with self.assertRaisesRegex(OcrScoreError, "sheet row 3: checked must be yes"):
            read_scores(self.sheet(unchecked_line=3))

    def test_a_row_that_says_no_or_something_else_is_refused(self):
        for value in ("no", "y", "x"):
            with self.subTest(checked=value), self.assertRaisesRegex(OcrScoreError, "sheet row 4: checked must be yes"):
                read_scores(self.sheet(edits={4: {"checked": value}}))

    def test_a_row_is_checked_before_its_counts_are_read(self):
        # The sheet the indexer writes has every count blank, so "checked" is the first thing a person must do.
        edits = {2: {"checked": "", "numbers_wrong": "", "numbers_printed": ""}}
        with self.assertRaisesRegex(OcrScoreError, "sheet row 2: checked must be yes"):
            read_scores(self.sheet(edits=edits))

    def test_yes_in_any_case_or_with_spaces_is_yes(self):
        self.assertEqual(read_scores(self.sheet(edits={2: {"checked": " YES "}})), ROWS)

    def test_what_a_spreadsheet_writes_is_read(self):
        # A BOM, Windows line ends, counts as `7.0`, a page as `12.0`, and blank rows at the end.
        edits = {2: {"numbers_wrong": "5.0", "page": "12.0", "table_rows_wrong": "3.00"}}
        text = sheet_text(edits=edits, newline="\r\n") + ",".join([""] * len(SCORE_COLUMNS)) + "\r\n\r\n"
        path = self.dir / "scores.csv"
        path.write_text(text, encoding="utf-8-sig", newline="")
        self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertEqual(read_scores(path), ROWS)

    def test_a_count_that_is_blank_is_refused_with_its_row_and_column(self):
        with self.assertRaisesRegex(OcrScoreError, "sheet row 5: numbers_missing is blank"):
            read_scores(self.sheet(edits={5: {"numbers_missing": " "}}))

    def test_every_count_column_must_be_filled_in(self):
        for column in ("numbers_printed", "numbers_wrong", "numbers_missing", "numbers_extra", "headings_printed",
                       "headings_wrong", "headings_missing", "table_rows_printed", "table_rows_wrong", "seconds", "page"):
            with self.subTest(column=column), self.assertRaisesRegex(OcrScoreError, f"sheet row 2: {column} is blank"):
                read_scores(self.sheet(edits={2: {column: ""}}))

    def test_a_count_that_is_not_a_whole_number_is_refused(self):
        for value in ("7.5", "-1", "1e2", "seven", "7,000", "٧"):
            with self.subTest(value=value), self.assertRaisesRegex(OcrScoreError, "sheet row 3: numbers_wrong .* is not a whole number"):
                read_scores(self.sheet(edits={3: {"numbers_wrong": value}}))

    def test_more_wrong_and_missing_numbers_than_printed_is_refused(self):
        edits = {2: {"numbers_wrong": "299", "numbers_missing": "2"}}   # 301 of the 300 printed
        with self.assertRaisesRegex(OcrScoreError, "sheet row 2: numbers_wrong \\+ numbers_missing is more than numbers_printed"):
            read_scores(self.sheet(edits=edits))

    def test_all_the_printed_numbers_wrong_is_allowed(self):
        edits = {2: {"numbers_wrong": "298", "numbers_missing": "2"}}
        self.assertEqual(read_scores(self.sheet(edits=edits))[0].numbers_wrong, 298)

    def test_a_config_that_is_not_one_of_the_four_is_refused(self):
        with self.assertRaisesRegex(OcrScoreError, "sheet row 2: config 'paddle-cm' is not one of rapidocr-cm, rapidocr-nocm"):
            read_scores(self.sheet(edits={2: {"config": "paddle-cm"}}))

    def test_the_engine_and_cell_matching_come_from_the_config_not_from_the_cells(self):
        # A spreadsheet writes `true` as TRUE and a person may have retyped either cell.
        edits = {2: {"engine": "TESSERACT", "cell_matching": "TRUE"}, 3: {"cell_matching": "nonsense"}}
        self.assertEqual(read_scores(self.sheet(edits=edits)), ROWS)

    def test_seconds_that_are_not_a_finite_number_are_a_message_and_not_a_traceback(self):
        for value in ("NaN", "Infinity", "fast", "1,5"):
            with self.subTest(value=value), self.assertRaisesRegex(OcrScoreError, "sheet row 2: seconds .* is not a number of seconds"):
                read_scores(self.sheet(edits={2: {"seconds": value}}))

    def test_a_sheet_missing_a_column_is_refused_with_the_likely_cause(self):
        with self.assertRaisesRegex(OcrScoreError, "no 'checked' column.*different delimiter"):
            read_scores(self.sheet(leave_out=("checked",)))
        with self.assertRaisesRegex(OcrScoreError, "no 'table_rows_wrong' column"):
            read_scores(self.sheet(leave_out=("table_rows_wrong",)))

    def test_a_sheet_that_is_not_utf8_is_refused(self):
        with self.assertRaisesRegex(OcrScoreError, "scores.csv is not UTF-8 text; save it as CSV UTF-8"):
            read_scores(self.sheet(encoding="utf-16"))

    def test_a_sheet_that_does_not_exist_is_a_file_error(self):
        with self.assertRaises(FileNotFoundError):
            read_scores(self.dir / "nothing.csv")


class ReadPagesTests(TempCase):
    def test_the_page_list_the_indexer_reads_is_read(self):
        path = self.dir / "pages.json"
        path.write_text(json.dumps({"scanned": [{"filing": FILING, "page": 12}], "digital": [{"filing": FILING, "page": 7}]}), encoding="utf-8")
        pages = read_pages(path)
        self.assertEqual((pages.scanned, pages.digital), ([PageRef(filing=FILING, page=12)], [PageRef(filing=FILING, page=7)]))

    def test_the_counts_of_the_indexers_list_are_not_copied(self):
        # The indexer holds its list to 10 and 5 before it reads anything; the scoring fixture has 2 and 1.
        path = self.dir / "pages.json"
        path.write_text(json.dumps({"scanned": [], "digital": []}), encoding="utf-8")
        self.assertEqual(read_pages(path), OcrPages(scanned=[], digital=[]))

    def test_a_page_before_the_first_or_an_unknown_field_is_refused_without_the_text(self):
        path = self.dir / "pages.json"
        for body in ({"scanned": [{"filing": "secret words", "page": 0}], "digital": []},
                     {"scanned": [], "digital": [], "other": 1}):
            path.write_text(json.dumps(body), encoding="utf-8")
            with self.subTest(body=body), self.assertRaisesRegex(OcrScoreError, "pages.json is not a readable page list") as caught:
                read_pages(path)
            self.assertNotIn("secret", str(caught.exception))


class CheckScoresTests(unittest.TestCase):
    def test_scores_pass_the_check_as_given(self):
        check_scores(ROWS, PAGES, MANIFEST)  # every config of every page, printed counts equal

    def test_printed_counts_must_agree_between_configs(self):
        with self.assertRaisesRegex(OcrScoreError, "page 12 of aether-industries/ar-2024-25: numbers_printed differs between configs"):
            check_scores(with_printed(ROWS, "tesseract-cm", numbers=301), PAGES, MANIFEST)

    def test_each_printed_count_is_compared(self):
        for column in ("headings_printed", "table_rows_printed"):
            with self.subTest(column=column):
                rows = changed(ROWS, "tesseract-nocm", [B], **{column: 99})
                with self.assertRaisesRegex(OcrScoreError, f"page 40 of aether-industries/ar-2024-25: {column} differs between configs"):
                    check_scores(rows, PAGES, MANIFEST)

    def test_a_scanned_page_owes_four_configs(self):
        for config in CONFIGS:
            with self.subTest(config=config):
                rows = [row for row in ROWS if not (row.config == config and row.page == B)]
                with self.assertRaisesRegex(OcrScoreError, f"page 40 of aether-industries/ar-2024-25: no row for {config}"):
                    check_scores(rows, PAGES, MANIFEST)

    def test_a_digital_page_owes_two(self):
        for config in DIGITAL_CONFIGS:
            with self.subTest(config=config):
                rows = [row for row in ROWS if not (row.config == config and row.page == C)]
                with self.assertRaisesRegex(OcrScoreError, f"page 7 of aether-industries/ar-2024-25: no row for {config}"):
                    check_scores(rows, PAGES, MANIFEST)

    def test_a_filing_that_is_not_in_the_manifest_is_refused(self):
        with self.assertRaisesRegex(OcrScoreError, "aether-industries/ar-2024-25 is not in the dev set of the manifest"):
            check_scores(ROWS, PAGES, Manifest(filings=[]))

    def test_a_heldout_filing_is_refused(self):
        heldout = Manifest(filings=[MANIFEST.filings[0].model_copy(update={"set": "heldout"})])
        with self.assertRaisesRegex(OcrScoreError, "aether-industries/ar-2024-25 is not in the dev set of the manifest"):
            check_scores(ROWS, PAGES, heldout)

    def test_a_dev_filing_that_is_out_of_scope_is_a_candidate(self):
        # The extraction baseline leaves such a filing out; its pages are still candidates for the spot check.
        out_of_scope = Manifest(filings=[MANIFEST.filings[0].model_copy(update={"out_of_scope": "bank statements"})])
        check_scores(ROWS, PAGES, out_of_scope)


class TotalsTests(unittest.TestCase):
    def test_errors_are_wrong_plus_missing_for_numbers_and_headings(self):
        self.assertEqual(totals(ROWS, "rapidocr-cm", "scanned", "numbers"), Totals(14, 600, Decimal("8.0")))
        self.assertEqual(totals(ROWS, "rapidocr-cm", "scanned", "headings"), Totals(2, 50, Decimal("8.0")))
        self.assertEqual(totals(ROWS, "tesseract-cm", "scanned", "numbers"), Totals(9, 600, Decimal("12.0")))

    def test_the_errors_of_table_rows_are_the_wrong_ones(self):
        self.assertEqual(totals(ROWS, "rapidocr-cm", "scanned", "table_rows"), Totals(5, 80, Decimal("8.0")))
        self.assertEqual(totals(ROWS, "rapidocr-cm", "digital", "table_rows"), Totals(6, 30, Decimal("1.0")))

    def test_a_kind_is_counted_on_its_own(self):
        self.assertEqual(totals(ROWS, "rapidocr-nocm", "digital", "numbers"), Totals(1, 200, Decimal("1.0")))

    def test_seconds_are_the_mean_of_the_pages_read(self):
        rows = changed(ROWS, "rapidocr-cm", [A], seconds=Decimal("7.5"))
        self.assertEqual(totals(rows, "rapidocr-cm", "scanned", "numbers").seconds_mean, Decimal("7.75"))

    def test_a_config_with_no_rows_of_that_kind_is_an_error_not_a_zero(self):
        with self.assertRaisesRegex(OcrScoreError, "no digital rows for tesseract-cm"):
            totals(ROWS, "tesseract-cm", "digital", "numbers")


class FormatRateTests(unittest.TestCase):
    def test_three_decimals_rounded_half_to_even_with_no_float(self):
        self.assertEqual(format_rate(14, 600), "0.023")   # 0.02333…
        self.assertEqual(format_rate(0, 200), "0.000")
        self.assertEqual(format_rate(1, 8), "0.125")
        self.assertEqual(format_rate(1, 16), "0.062")      # 0.0625 is half way: the even digit
        self.assertEqual(format_rate(3, 16), "0.188")      # 0.1875 is half way: the even digit
        self.assertEqual(format_rate(5, 3), "1.667")
        self.assertEqual(format_rate(2, 1_000_000_000_000_000_001), "0.000")

    def test_nothing_printed_has_no_rate(self):
        self.assertEqual(format_rate(0, 0), "—")


class EngineRuleTests(unittest.TestCase):
    def test_engine_tie_keeps_rapidocr(self):
        # bands: numbers max(1, 600/100) = 6, diff 14 - 9 = 5; headings max(1, 50*5/100) = 5/2, diff 2
        self.assertEqual(choose_engine(ROWS), EngineChoice("rapidocr", "tie"))

    def test_tesseract_wins_on_numbers_beyond_the_band(self):
        rows = with_number_errors(ROWS, "tesseract-cm", a=4, b=3)   # 7: diff 7 > 6
        self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_numbers"))

    def test_a_difference_of_exactly_the_band_is_a_tie(self):
        rows = with_number_errors(ROWS, "tesseract-cm", a=4, b=4)   # 8: diff 6 is not more than 6
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "tie"))

    def test_a_winner_more_than_twice_as_slow_goes_to_the_investor(self):
        rows = with_seconds(with_number_errors(ROWS, "tesseract-cm", a=4, b=3), "tesseract-cm", "17.0")  # 17.0 > 2 * 8.0
        self.assertEqual(choose_engine(rows), EngineChoice(None, "slower_than_twice"))

    def test_exactly_twice_as_slow_is_not_more_than_twice(self):
        rows = with_seconds(with_number_errors(ROWS, "tesseract-cm", a=4, b=3), "tesseract-cm", "16.0")
        self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_numbers"))

    def test_slowness_is_compared_on_exact_means_not_rounded_ones(self):
        # Three scanned pages: RapidOCR's mean is 10/3 s and Tesseract's 20/3 s, exactly twice, though neither is a
        # finite decimal. A mean rounded to 28 digits would put Tesseract's above twice RapidOCR's.
        def scanned(config, wrong, seconds):
            return [dataclasses.replace(ROWS[0], config=config, page=page, numbers_wrong=wrong, numbers_missing=0,
                                        seconds=Decimal(value)) for page, value in zip((11, 12, 13), seconds)]
        rows = scanned("rapidocr-cm", 4, ("3.3", "3.3", "3.4")) + scanned("tesseract-cm", 0, ("6.6", "6.7", "6.7"))
        self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_numbers"))   # 12 - 0 > 900/100
        slower = scanned("rapidocr-cm", 4, ("3.3", "3.3", "3.4")) + scanned("tesseract-cm", 0, ("6.6", "6.7", "6.8"))
        self.assertEqual(choose_engine(slower), EngineChoice(None, "slower_than_twice"))

    def test_a_slow_rapidocr_win_keeps_rapidocr(self):         # the slowness rule is for a switch only
        rows = with_seconds(with_number_errors(ROWS, "tesseract-cm", a=10, b=11), "rapidocr-cm", "25.0")  # 21 - 14 = 7 > 6; 25.0 > 2 * 12.0
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "fewer_wrong_numbers"))

    def test_tesseract_wins_on_headings_when_the_numbers_are_within_the_band(self):
        rows = changed(ROWS, "rapidocr-cm", [A], headings_wrong=3)     # rapidocr headings 3 + 1 = 4; tesseract 0; 4 > 5/2
        self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_headings"))

    def test_the_heading_difference_must_be_more_than_its_band(self):
        # The band of headings is max(1, 5% of the 50 printed) = 5/2: the difference of 2 in ROWS is within it, 3 is beyond.
        rows = changed(ROWS, "rapidocr-cm", [A], headings_wrong=2)     # rapidocr headings 2 + 1 = 3, tesseract 0
        self.assertEqual(choose_engine(rows), EngineChoice("tesseract", "fewer_wrong_headings"))
        self.assertEqual(choose_engine(ROWS), EngineChoice("rapidocr", "tie"))

    def test_the_heading_band_has_a_floor_of_one(self):
        # 10 headings printed: 5% is 0.5, so the band is 1. Tesseract's one fewer error is within it.
        few = changed(changed(ROWS, "rapidocr-cm", [A, B], headings_printed=5), "tesseract-cm", [A, B], headings_printed=5)
        few = changed(few, "rapidocr-cm", [A], headings_wrong=0)         # rapidocr headings: 0 + (0 + 1) = 1; tesseract 0
        self.assertEqual(choose_engine(few), EngineChoice("rapidocr", "tie"))
        worse = changed(few, "rapidocr-cm", [A], headings_wrong=1)        # 2: one more than the floor
        self.assertEqual(choose_engine(worse), EngineChoice("tesseract", "fewer_wrong_headings"))

    def test_a_rapidocr_win_stands_even_when_tesseract_is_more_than_twice_as_slow(self):
        rows = with_seconds(with_number_errors(ROWS, "tesseract-cm", a=10, b=11), "tesseract-cm", "40.0")  # 21 - 14 = 7 > 6; 40 > 2 * 8
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "fewer_wrong_numbers"))

    def test_a_heading_win_that_is_too_slow_also_goes_to_the_investor(self):
        rows = with_seconds(changed(ROWS, "rapidocr-cm", [A], headings_wrong=3), "tesseract-cm", "17.0")
        self.assertEqual(choose_engine(rows), EngineChoice(None, "slower_than_twice"))

    def test_numbers_decide_before_headings(self):
        # Tesseract is better on headings, but RapidOCR is better on numbers by more than the band: RapidOCR wins on numbers.
        rows = with_number_errors(ROWS, "tesseract-cm", a=10, b=11)
        self.assertEqual(choose_engine(changed(rows, "rapidocr-cm", [A], headings_wrong=3)),
                         EngineChoice("rapidocr", "fewer_wrong_numbers"))

    def test_rapidocr_wins_on_headings_when_the_numbers_are_within_the_band(self):
        rows = changed(ROWS, "tesseract-cm", [A], headings_wrong=4)   # tesseract headings 4; rapidocr 2; 2 is not more than 5/2
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "tie"))
        rows = changed(ROWS, "tesseract-cm", [A], headings_wrong=6)   # 6 - 2 = 4 > 5/2
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "fewer_wrong_headings"))

    def test_the_band_is_a_percent_of_the_numbers_printed(self):
        # 3,000 numbers printed: the band is 30, not 6, so Tesseract's 7 fewer errors are a tie.
        big = changed(changed(ROWS, "rapidocr-cm", [A, B], numbers_printed=1500), "tesseract-cm", [A, B], numbers_printed=1500)
        self.assertEqual(choose_engine(with_number_errors(big, "tesseract-cm", a=4, b=3)), EngineChoice("rapidocr", "tie"))

    def test_the_band_has_a_floor_of_one(self):
        # 40 numbers printed: 1% is 0.4, so the band is 1. One fewer error is within it, two fewer are beyond it.
        small = changed(changed(ROWS, "rapidocr-cm", [A, B], numbers_printed=20), "tesseract-cm", [A, B], numbers_printed=20)
        self.assertEqual(choose_engine(with_number_errors(small, "tesseract-cm", a=7, b=6)), EngineChoice("rapidocr", "tie"))    # 13 against 14
        self.assertEqual(choose_engine(with_number_errors(small, "tesseract-cm", a=6, b=6)),
                         EngineChoice("tesseract", "fewer_wrong_numbers"))                                                         # 12 against 14

    def test_the_other_configs_do_not_enter_the_choice(self):
        # Wild numbers on the no-cell-matching and digital rows change nothing.
        rows = with_number_errors(ROWS, "tesseract-nocm", a=0, b=0)
        rows = with_number_errors(rows, "rapidocr-nocm", a=250, b=250)
        self.assertEqual(choose_engine(rows), EngineChoice("rapidocr", "tie"))

    def test_a_sheet_with_no_scanned_rows_of_an_engine_is_an_error(self):
        with self.assertRaisesRegex(OcrScoreError, "no scanned rows for tesseract-cm"):
            choose_engine([row for row in ROWS if row.config != "tesseract-cm"])


class CellMatchingRuleTests(unittest.TestCase):
    def test_cell_matching_off_wins_beyond_the_band(self):
        # table rows printed 40 + 40 + 30 = 110; band max(1, 110*2/100) = 11/5; on wrong 11, off wrong 4
        self.assertEqual(choose_cell_matching(ROWS, "rapidocr"), CellMatchingChoice(False, "fewer_broken_rows"))

    def test_cell_matching_tie_keeps_it_on(self):
        self.assertEqual(choose_cell_matching(with_table_rows_wrong(ROWS, "rapidocr-nocm", a=4, b=3, c=2), "rapidocr"),
                         CellMatchingChoice(True, "tie"))      # 9: diff 2 <= 11/5

    def test_a_difference_just_beyond_the_band_is_enough(self):
        rows = with_table_rows_wrong(ROWS, "rapidocr-nocm", a=4, b=3, c=1)  # off wrong 8: diff 3 > 11/5
        self.assertEqual(choose_cell_matching(rows, "rapidocr"), CellMatchingChoice(False, "fewer_broken_rows"))

    def test_the_band_has_a_floor_of_one_row(self):
        rows = [dataclasses.replace(row, table_rows_printed=10) for row in ROWS]   # 30 printed: 2% is 0.6, the band is 1
        rows = with_table_rows_wrong(rows, "rapidocr-nocm", a=3, b=3, c=3)         # off 9, on 11: diff 2 > 1
        self.assertEqual(choose_cell_matching(rows, "rapidocr"), CellMatchingChoice(False, "fewer_broken_rows"))
        rows = with_table_rows_wrong(rows, "rapidocr-nocm", a=3, b=3, c=4)         # off 10, on 11: diff 1 is not more than 1
        self.assertEqual(choose_cell_matching(rows, "rapidocr"), CellMatchingChoice(True, "tie"))

    def test_cell_matching_on_winning_is_not_a_reason_to_change_anything(self):
        rows = with_table_rows_wrong(ROWS, "rapidocr-nocm", a=9, b=9, c=9)
        self.assertEqual(choose_cell_matching(rows, "rapidocr"), CellMatchingChoice(True, "tie"))

    def test_the_chosen_engines_scanned_rows_and_the_digital_rows_are_judged(self):
        # Tesseract's pages: on 2 + 2, off 6 + 6; the digital rows are RapidOCR's, on 6, off 2. On 10, off 14.
        rows = with_table_rows_wrong(ROWS, "tesseract-nocm", a=6, b=6, c=0)
        self.assertEqual(choose_cell_matching(rows, "tesseract"), CellMatchingChoice(True, "tie"))
        self.assertEqual(choose_cell_matching(rows, "rapidocr"), CellMatchingChoice(False, "fewer_broken_rows"))

    def test_no_engine_yet_reads_as_rapidocr(self):
        self.assertEqual(choose_cell_matching(ROWS, None), choose_cell_matching(ROWS, "rapidocr"))

    def test_an_engine_that_is_not_one_of_the_two_is_a_mistake_of_the_caller(self):
        with self.assertRaises(ValueError):
            choose_cell_matching(ROWS, "paddle")


def write_run(run: Path, engines=None, disagreements=None, md=None, rows=ROWS, scores=True):
    """A run folder as `maester-indexer-ocr-sample` leaves it, with only the fields of a page read that the scorer reads."""
    run.mkdir(parents=True)
    for row in rows:
        name = f"{SLUG}_p{row.page}_{row.config}.json"
        body = {"document": {"texts": ["a page's words"]}, "seconds": float(row.seconds), "ocrEngine": (engines or ENGINES)[row.config]}
        (run / name).write_text(json.dumps(body), encoding="utf-8")
    if md is not None:
        (run / f"{SLUG}_p{A}.md").write_bytes(md)
        (run / f"{SLUG}_p{A}.png").write_bytes(b"\x89PNG not a picture")
    source = FIXTURES / "ocr-disagreements.json" if disagreements is None else disagreements
    (run / "disagreements.json").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    if scores:
        (run / "scores.csv").write_text(sheet_text(rows), encoding="utf-8")
    return run


class ReadRunTests(TempCase):
    def test_read_run_takes_engines_from_the_json_and_disagreements_from_their_file(self):
        engines = {**ENGINES, "rapidocr-cm": "rapidocr-onnxruntime 3.9.2", "tesseract-cm": "tesseract-cli 5.5.0 eng:82fe032bd933"}
        # A page's .md that read_run must not open: it is not text.
        run = write_run(self.dir / "r", engines=engines, md=b"\xff\xfe not UTF-8 text")
        got = read_run(run)
        self.assertEqual(got.engines["tesseract-cm"], "tesseract-cli 5.5.0 eng:82fe032bd933")
        self.assertEqual(list(got.engines), list(CONFIGS))
        self.assertEqual(len(got.disagreements), 2)
        self.assertEqual(got.disagreements[0].pairs, [("(45)", "45"), ("", "7")])

    def test_two_files_of_one_config_that_name_different_engines_are_refused(self):
        run = write_run(self.dir / "r")
        other = {"ocrEngine": "rapidocr-onnxruntime 4.0.0"}
        (run / f"{SLUG}_p{B}_rapidocr-cm.json").write_text(json.dumps(other), encoding="utf-8")
        with self.assertRaisesRegex(OcrScoreError, "rapidocr-cm: the page reads name more than one engine"):
            read_run(run)

    def test_a_config_with_no_page_read_has_no_engine(self):
        run = write_run(self.dir / "r", rows=[row for row in ROWS if not row.config.startswith("tesseract")])
        self.assertEqual(list(read_run(run).engines), ["rapidocr-cm", "rapidocr-nocm"])

    def test_a_page_read_without_an_engine_is_refused_by_name(self):
        run = write_run(self.dir / "r")
        (run / f"{SLUG}_p{A}_rapidocr-cm.json").write_text(json.dumps({"seconds": 1}), encoding="utf-8")
        with self.assertRaisesRegex(OcrScoreError, f"{SLUG}_p{A}_rapidocr-cm.json has no ocrEngine"):
            read_run(run)

    def test_a_page_read_that_is_not_json_is_refused_by_name_without_its_text(self):
        run = write_run(self.dir / "r")
        (run / f"{SLUG}_p{A}_rapidocr-cm.json").write_text("{ the words of a page", encoding="utf-8")
        with self.assertRaisesRegex(OcrScoreError, f"{SLUG}_p{A}_rapidocr-cm.json is not a readable page read") as caught:
            read_run(run)
        self.assertNotIn("words", str(caught.exception))

    def test_files_that_are_not_page_reads_are_left_alone(self):
        run = write_run(self.dir / "r")
        (run / "notes_p3_rapidocr-cm.txt").write_text("not json", encoding="utf-8")
        (run / "scores.json").write_text("not json", encoding="utf-8")
        (run / "x_pq_rapidocr-cm.json").write_text("not json", encoding="utf-8")
        self.assertEqual(read_run(run).engines, ENGINES)

    def test_a_disagreements_file_that_is_not_the_agreed_shape_is_refused_without_its_text(self):
        run = write_run(self.dir / "r")
        (run / "disagreements.json").write_text('[{"filing": "secret words", "page": 0}]', encoding="utf-8")
        with self.assertRaisesRegex(OcrScoreError, "disagreements.json is not a readable disagreements file") as caught:
            read_run(run)
        self.assertNotIn("secret", str(caught.exception))

    def test_a_run_with_no_disagreements_file_is_an_error(self):
        run = write_run(self.dir / "r")
        (run / "disagreements.json").unlink()
        with self.assertRaisesRegex(OcrScoreError, "r has no disagreements.json"):
            read_run(run)


DISAGREEMENTS = DisagreementFile.model_validate_json((FIXTURES / "ocr-disagreements.json").read_text(encoding="utf-8")).root


def report(engine=EngineChoice("rapidocr", "tie"), cell=CellMatchingChoice(False, "fewer_broken_rows"), rows=ROWS,
           engines=ENGINES, disagreements=DISAGREEMENTS):
    return render_ocr_report(rows, PAGES, engines, disagreements, engine, cell, "20261021T040005Z", NOW)


class ReportTests(unittest.TestCase):
    def test_report_states_the_rule_the_bands_and_the_decision(self):
        md = render_ocr_report(ROWS, PAGES, ENGINES, DISAGREEMENTS, EngineChoice("rapidocr", "tie"),
                               CellMatchingChoice(False, "fewer_broken_rows"), "r", NOW)
        self.assertIn("| rapidocr-cm | scanned | 14 | 600 | 0.023 |", md)   # 14/600 = 0.02333…
        self.assertIn("| rapidocr-cm | digital | 0 | 200 | 0.000 |", md)
        self.assertIn("| aether-industries/ar-2024-25 | 12 | rapidocr-cm, tesseract-cm | (45) → 45; (none) → 7 |", md)
        self.assertIn("RapidOCR stays the engine (tie)", md)
        self.assertIn("INDEX_TABLE_CELL_MATCHING becomes false", md)

    def test_the_header_names_the_run_the_date_and_each_configs_engine(self):
        md = report()
        self.assertTrue(md.startswith("# OCR spot check: 20261021T040005Z\n"), md[:80])
        self.assertIn("2026-10-21 09:30 UTC", md)
        for config, engine in ENGINES.items():
            self.assertIn(f"- `{config}`: `{engine}`", md)

    def test_a_config_with_no_page_reads_says_so(self):
        md = report(engines={"rapidocr-cm": "rapidocr-onnxruntime 3.9.2"})
        self.assertIn("- `tesseract-cm`: no page read in the run folder", md)

    def test_the_table_has_a_row_per_config_and_kind_and_none_for_what_was_not_read(self):
        md = report()
        header = ("| config | kind | number errors | numbers printed | rate | heading errors | headings printed "
                  "| table rows wrong | table rows printed | seconds per page |")
        self.assertIn(header, md)
        self.assertIn("| rapidocr-cm | scanned | 14 | 600 | 0.023 | 2 | 50 | 5 | 80 | 8.0 |", md)
        self.assertIn("| rapidocr-cm | digital | 0 | 200 | 0.000 | 0 | 5 | 6 | 30 | 1.0 |", md)
        self.assertIn("| rapidocr-nocm | digital | 1 | 200 | 0.005 | 0 | 5 | 2 | 30 | 1.0 |", md)
        self.assertIn("| tesseract-cm | scanned | 9 | 600 | 0.015 | 0 | 50 | 4 | 80 | 12.0 |", md)
        self.assertIn("| tesseract-nocm | scanned | 11 | 600 | 0.018 | 0 | 50 | 3 | 80 | 11.0 |", md)   # (4 + 2) + (3 + 2) = 11
        self.assertNotIn("| tesseract-cm | digital |", md)
        self.assertNotIn("| tesseract-nocm | digital |", md)

    def test_the_per_page_table_has_every_row_of_the_sheet(self):
        md = report()
        header = ("| filing | page | kind | config | number errors | numbers printed | numbers extra | heading errors "
                  "| headings printed | table rows wrong | table rows printed | seconds |")
        self.assertIn(header, md)
        self.assertIn("| aether-industries/ar-2024-25 | 40 | scanned | tesseract-cm | 4 | 300 | 1 | 0 | 25 | 2 | 40 | 12.0 |", md)
        self.assertIn("| aether-industries/ar-2024-25 | 7 | digital | rapidocr-nocm | 1 | 200 | 0 | 0 | 5 | 2 | 30 | 1.0 |", md)
        per_page = [line for line in md.splitlines() if line.startswith(f"| {FILING} | ") and (" | scanned | " in line or " | digital | " in line)]
        self.assertEqual(len(per_page), len(ROWS))

    def test_the_rule_gives_the_bands_worked_out_from_what_was_printed(self):
        md = report()
        self.assertIn("## The rule", md)
        self.assertIn("1% of the numbers printed, at least 1: 6", md)
        self.assertIn("5% of the headings printed, at least 1: 2.5", md)
        self.assertIn("2% of the table rows printed, at least 1: 2.2", md)
        self.assertIn("more than twice", md)

    def test_the_decision_shows_the_figures_behind_each_choice(self):
        md = report()
        self.assertIn("## The decision", md)
        self.assertIn("Number errors: RapidOCR 14, Tesseract 9 (band 6)", md)
        self.assertIn("Heading errors: RapidOCR 2, Tesseract 0 (band 2.5)", md)
        self.assertIn("Seconds per page: RapidOCR 8.0, Tesseract 12.0", md)
        self.assertIn("Table rows wrong: cell matching on 11, off 4 (band 2.2)", md)

    def test_each_engine_decision_is_worded(self):
        self.assertIn("RapidOCR stays the engine (fewer wrong numbers)", report(EngineChoice("rapidocr", "fewer_wrong_numbers")))
        self.assertIn("RapidOCR stays the engine (fewer wrong headings)", report(EngineChoice("rapidocr", "fewer_wrong_headings")))
        won = report(EngineChoice("tesseract", "fewer_wrong_numbers"))
        self.assertIn("Tesseract replaces RapidOCR: OCR_ENGINE becomes tesseract (fewer wrong numbers)", won)
        won = report(EngineChoice("tesseract", "fewer_wrong_headings"))
        self.assertIn("Tesseract replaces RapidOCR: OCR_ENGINE becomes tesseract (fewer wrong headings)", won)

    def test_an_engine_too_slow_to_choose_is_left_to_the_investor(self):
        md = report(EngineChoice(None, "slower_than_twice"))
        self.assertIn("No engine is named (slower than twice)", md)
        self.assertIn("The investor decides", md)
        self.assertIn("judged on RapidOCR", md)  # cell matching, until the engine is chosen

    def test_each_cell_matching_decision_is_worded(self):
        self.assertIn("INDEX_TABLE_CELL_MATCHING stays true (tie)", report(cell=CellMatchingChoice(True, "tie")))
        self.assertIn("INDEX_TABLE_CELL_MATCHING becomes false (fewer broken rows)", report())

    def test_cell_matching_is_shown_on_the_chosen_engines_rows(self):
        rows = with_table_rows_wrong(ROWS, "tesseract-nocm", a=6, b=6, c=0)
        md = report(EngineChoice("tesseract", "fewer_wrong_numbers"), CellMatchingChoice(True, "tie"), rows=rows)
        self.assertIn("Table rows wrong: cell matching on 10, off 14 (band 2.2)", md)

    def test_disagreements_are_an_appendix_that_says_they_are_not_errors(self):
        md = report()
        self.assertIn("## Appendix: Disagreements", md)
        self.assertIn("not checked errors", md)
        self.assertIn("| filing | page | configs | numbers (first → second) |", md)
        self.assertIn("| aether-industries/ar-2024-25 | 12 | rapidocr-cm, rapidocr-nocm | 1,200 300 → 1,200300 |", md)

    def test_no_disagreements_is_said(self):
        self.assertIn("None.", report(disagreements=[]).split("## Appendix: Disagreements")[1])

    def test_a_pipe_in_a_cell_does_not_break_the_table(self):
        odd = DisagreementFile.model_validate([{"filing": FILING, "page": 12, "a": "rapidocr-cm", "b": "tesseract-cm",
                                                "pairs": [["1|2", "3\n4"]]}]).root
        self.assertIn("| 1\\|2 → 3 4 |", report(disagreements=odd))

    def test_the_report_ends_with_one_newline(self):
        md = report()
        self.assertTrue(md.endswith("\n") and not md.endswith("\n\n"))


# `complete_ocr_run(name)` is a run folder with ROWS as its scores.csv; `tmp_eval_base` is the eval base around it.
def complete_ocr_run(base: Path, name: str) -> Path:
    return write_run(base / "ocr" / "runs" / name)


def tmp_eval_base(base: Path, extraction_run=None, ocr_run=None) -> Path:
    """MANIFEST as manifest.json and PAGES as ocr/pages.json in `base`, with an extraction run and an OCR run if named."""
    base.mkdir(parents=True, exist_ok=True)
    (base / "manifest.json").write_text(MANIFEST.model_dump_json(), encoding="utf-8")
    (base / "ocr").mkdir(exist_ok=True)
    (base / "ocr" / "pages.json").write_text(PAGES.model_dump_json(), encoding="utf-8")
    if extraction_run:
        (base / "runs" / extraction_run).mkdir(parents=True)
    if ocr_run:
        complete_ocr_run(base, ocr_run)
    return base


class OcrCommandCase(TempCase):
    def setUp(self):
        super().setUp()
        # `_main` loads the repository's real .env before every command, and DEFAULT is the real data/eval.
        self.base = self.dir / "data[final]"
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", EvalPaths(self.base))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_command(self, *args):
        # A wide terminal, so Rich never wraps a line the assertions look for.
        return CliRunner().invoke(app, list(args), env={"COLUMNS": "500"})

    def assert_refused(self, result, *messages):
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        for message in messages:
            self.assertIn(message, plain(result.output))


class OcrReportCommandTests(OcrCommandCase):
    def test_ocr_report_latest_is_the_newest_ocr_run(self):
        # an extraction run under runs/ and an OCR run under ocr/runs/, the extraction one newer
        tmp_eval_base(self.base, extraction_run="20261022T000000Z", ocr_run="20261021T040005Z")
        result = self.run_command("ocr", "report", "--run", "latest")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue((self.base / "ocr" / "runs" / "20261021T040005Z" / "report.md").is_file())
        self.assertFalse((self.base / "runs" / "20261022T000000Z" / "report.md").exists())

    def test_the_report_in_the_run_folder_holds_the_decision(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        self.assertEqual(self.run_command("ocr", "report").exit_code, 0)
        md = (self.base / "ocr" / "runs" / "20261021T040005Z" / "report.md").read_text(encoding="utf-8")
        self.assertTrue(md.startswith("# OCR spot check: 20261021T040005Z\n"))
        self.assertIn("RapidOCR stays the engine (tie)", md)
        self.assertIn("INDEX_TABLE_CELL_MATCHING becomes false", md)
        self.assertIn("tesseract-cli 5.5.0 eng:82fe032bd933", md)
        self.assertIn("(45) → 45; (none) → 7", md)

    def test_the_console_shows_the_run_and_the_decision_and_no_page_text(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        result = self.run_command("ocr", "report")
        out = plain(result.output)
        self.assertIn("20261021T040005Z", out)
        self.assertIn("engine: rapidocr (tie)", out)
        self.assertIn("cell matching: false (fewer_broken_rows)", out)
        self.assertIn("data[final]", out)
        for text in ("(45)", "1,200"):  # tokens read from a page
            self.assertNotIn(text, out)

    def test_the_run_can_be_named(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        complete_ocr_run(self.base, "20261023T000000Z")
        (self.base / "ocr" / "runs" / "20261023T000000Z" / "scores.csv").write_text(sheet_text(), encoding="utf-8")
        self.assertEqual(self.run_command("ocr", "report", "--run", "20261021T040005Z").exit_code, 0)
        self.assertTrue((self.base / "ocr" / "runs" / "20261021T040005Z" / "report.md").is_file())
        self.assertFalse((self.base / "ocr" / "runs" / "20261023T000000Z" / "report.md").exists())

    def test_to_copies_the_report_where_it_is_published(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        target = self.dir / "docs" / "eval" / "2026-10-21-ocr-spot-check.md"
        result = self.run_command("ocr", "report", "--to", str(target))
        self.assertEqual(result.exit_code, 0, result.output)
        run_report = self.base / "ocr" / "runs" / "20261021T040005Z" / "report.md"
        self.assertEqual(target.read_text(encoding="utf-8"), run_report.read_text(encoding="utf-8"))
        self.assertIn(f"published → {target}", plain(result.output))

    def test_an_unchecked_sheet_is_a_message_and_writes_no_report(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        sheet = self.base / "ocr" / "runs" / "20261021T040005Z" / "scores.csv"
        sheet.write_text(sheet_text(edits={3: {"checked": ""}}), encoding="utf-8")
        target = self.dir / "published.md"
        self.assert_refused(self.run_command("ocr", "report", "--to", str(target)), "sheet row 3: checked must be yes")
        self.assertFalse((sheet.parent / "report.md").exists())
        self.assertFalse(target.exists())

    def test_a_sheet_that_does_not_fit_the_page_list_is_a_message(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        sheet = self.base / "ocr" / "runs" / "20261021T040005Z" / "scores.csv"
        sheet.write_text(sheet_text([row for row in ROWS if row.config != "tesseract-cm"]), encoding="utf-8")
        self.assert_refused(self.run_command("ocr", "report"), "no row for tesseract-cm")

    def test_a_filing_that_is_not_dev_is_a_message(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        heldout = MANIFEST.filings[0].model_copy(update={"set": "heldout"})
        (self.base / "manifest.json").write_text(Manifest(filings=[heldout]).model_dump_json(), encoding="utf-8")
        self.assert_refused(self.run_command("ocr", "report"), "is not in the dev set of the manifest")

    def test_no_ocr_run_is_a_message_even_when_there_is_an_extraction_run(self):
        tmp_eval_base(self.base, extraction_run="20261022T000000Z")
        self.assert_refused(self.run_command("ocr", "report"), f"no runs under {self.base / 'ocr' / 'runs'}")

    def test_no_page_list_is_a_message(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        (self.base / "ocr" / "pages.json").unlink()
        self.assert_refused(self.run_command("ocr", "report"), "pages.json")

    def test_a_report_that_cannot_be_written_is_a_message(self):
        tmp_eval_base(self.base, ocr_run="20261021T040005Z")
        (self.base / "ocr" / "runs" / "20261021T040005Z" / "report.md").mkdir()  # a folder where the file should be
        self.assert_refused(self.run_command("ocr", "report"), "cannot write")

    def test_the_ocr_commands_are_listed(self):
        result = self.run_command("--help")
        self.assertIn("ocr", plain(result.output))
        result = self.run_command("ocr", "--help")
        for command in ("request", "report"):
            self.assertIn(command, plain(result.output))


class OcrRequestCommandTests(OcrCommandCase):
    def setUp(self):
        super().setUp()
        self.out = self.dir / "request.json"

    def filings(self, *specs):
        """Write a manifest and, for the specs that are `present`, a PDF. A spec is (folder, set, present, out_of_scope)."""
        filings = []
        for folder, eval_set, present, out_of_scope in specs:
            filing = Filing(file=f"{folder}/ar-2024-25.pdf", company=f"{folder} Limited", kind="annual_report",
                            period_end="2025-03-31", set=eval_set, out_of_scope="bank statements" if out_of_scope else None)
            filings.append(filing)
            if present:
                (self.base / "corpus" / folder).mkdir(parents=True, exist_ok=True)
                (self.base / "corpus" / filing.file).write_bytes(f"pdf of {folder}".encode())
        self.base.mkdir(parents=True, exist_ok=True)
        (self.base / "manifest.json").write_text(Manifest(filings=filings).model_dump_json(), encoding="utf-8")

    def test_the_request_holds_every_dev_filing_that_is_in_the_corpus_and_no_questions(self):
        self.filings(("alpha", "dev", True, False), ("beta", "dev", True, True), ("gamma", "dev", False, False),
                     ("delta", "heldout", True, False))
        result = self.run_command("ocr", "request", "--out", str(self.out))
        self.assertEqual(result.exit_code, 0, result.output)
        request = json.loads(self.out.read_text(encoding="utf-8"))
        # beta is out of scope for the baseline, and still a candidate; gamma has no PDF; delta is held out.
        self.assertEqual([d["filing"] for d in request["documents"]], ["alpha/ar-2024-25", "beta/ar-2024-25"])
        self.assertEqual(request["questions"], [])
        self.assertEqual(request["version"], 1)
        self.assertIn("2 of 3 dev filing(s)", plain(result.output))

    def test_each_document_carries_the_sha256_of_its_pdf(self):
        self.filings(("alpha", "dev", True, False))
        self.assertEqual(self.run_command("ocr", "request", "--out", str(self.out)).exit_code, 0)
        (document,) = json.loads(self.out.read_text(encoding="utf-8"))["documents"]
        self.assertEqual(document["sha256"], hashlib.sha256(b"pdf of alpha").hexdigest())

    def test_a_request_with_no_dev_filing_in_the_corpus_is_a_message_and_writes_nothing(self):
        self.filings(("gamma", "dev", False, False), ("delta", "heldout", True, False))
        self.assert_refused(self.run_command("ocr", "request", "--out", str(self.out)), "no dev filing is under")
        self.assertFalse(self.out.exists())

    def test_the_request_is_a_valid_request_the_worker_reads(self):
        self.filings(("alpha", "dev", True, False))
        self.run_command("ocr", "request", "--out", str(self.out))
        EvalRequestModel.model_validate_json(self.out.read_text(encoding="utf-8"))

    def test_out_is_required(self):
        self.filings(("alpha", "dev", True, False))
        self.assertNotEqual(self.run_command("ocr", "request").exit_code, 0)

    def test_a_request_that_cannot_be_written_is_a_message(self):
        self.filings(("alpha", "dev", True, False))
        self.out.mkdir()  # a folder where the file should be
        self.assert_refused(self.run_command("ocr", "request", "--out", str(self.out)), "cannot write")

    def test_a_missing_manifest_is_a_message(self):
        self.assert_refused(self.run_command("ocr", "request", "--out", str(self.out)), "no manifest at")


if __name__ == "__main__":
    unittest.main()
