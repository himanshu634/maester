"""The corpus manifest, the run folders and label normalisation. Offline."""

from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest

from pydantic import ValidationError

from maester_eval.manifest import (Filing, FormatTags, ManifestError, XbrlPair, load_manifest, missing_files,
                                   period_end_of_token, tag_values, write_manifest)
from maester_eval.paths import DEFAULT, EvalPaths, RunLabelError, RunNotFoundError
from maester_eval.text import normalise

ONE = {"file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
       "kind": "annual_report", "period_end": "2026-03-31", "set": "dev"}
TWO = {"file": "synthetic-cements/q1-2026-27.pdf", "company": "Synthetic Cements Limited",
       "kind": "financial_results", "period_end": "2026-06-30", "set": "dev"}
OTHER = {"file": "other-metals/ar-2025-26.pdf", "company": "Other Metals Limited",
         "kind": "annual_report", "period_end": "2026-03-31", "set": "heldout"}
BANK = {"file": "synthetic-bank/ar-2025-26.pdf", "company": "Synthetic Bank Limited",
        "kind": "annual_report", "period_end": "2026-03-31", "set": "dev", "stratum": "financials",
        "out_of_scope": "bank: statements not in the taxonomy yet", "printed_pages_per_page": 2}


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))

    def write(self, filings):
        self.paths.manifest.parent.mkdir(parents=True, exist_ok=True)
        self.paths.manifest.write_text(json.dumps({"filings": filings}), encoding="utf-8")
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

    def test_an_id_outside_the_chosen_set_is_an_error(self):
        manifest = load_manifest(self.write([ONE, OTHER]))
        with self.assertRaisesRegex(ManifestError, "other-metals/ar-2025-26 is in set heldout, not dev"):
            manifest.select("dev", only=["other-metals/ar-2025-26"])

    def test_duplicate_ids_are_refused(self):
        with self.assertRaisesRegex(ManifestError, "duplicate filing ids"):
            load_manifest(self.write([ONE, dict(ONE, company="Someone Else Limited")]))

    def test_a_company_is_in_one_set_only(self):
        with self.assertRaisesRegex(ManifestError, "one set only.*Synthetic Cements Limited"):
            load_manifest(self.write([ONE, dict(TWO, set="heldout")]))

    def test_a_company_is_in_one_set_only_however_its_name_is_written(self):
        elsewhere = dict(OTHER, company=" SYNTHETIC cements, limited ", set="heldout")  # another folder
        with self.assertRaisesRegex(ManifestError, "one set only.*Synthetic Cements Limited"):
            load_manifest(self.write([ONE, elsewhere]))

    def test_a_corpus_folder_is_in_one_set_only(self):
        # normalise() keeps "Limited" and "Ltd" apart, so it is the shared folder that ties these two together.
        limited = dict(ONE, company="Synthetic Cements Limited", set="dev")
        ltd = dict(TWO, company="Synthetic Cements Ltd ", set="heldout")
        with self.assertRaisesRegex(ManifestError, "one set only.*synthetic-cements"):
            load_manifest(self.write([limited, ltd]))

    def test_bad_fields_are_refused(self):
        for bad in (dict(ONE, kind="brochure"), dict(ONE, set="test"), dict(ONE, extra="x"),
                    dict(ONE, period_end="31/03/2026"), dict(ONE, period_end="20260331"),
                    dict(ONE, period_end="2026-W13-2"), dict(ONE, period_end="2026-02-30"),
                    dict(ONE, file="/abs/ar.pdf"), dict(ONE, file="../ar.pdf"),
                    dict(ONE, file="./synthetic-cements/ar-2025-26.pdf"),
                    dict(ONE, file="synthetic-cements//ar-2025-26.pdf")):
            with self.subTest(bad=bad), self.assertRaises(ManifestError):
                load_manifest(self.write([bad]))

    def test_missing_manifest_and_missing_files(self):
        with self.assertRaisesRegex(ManifestError, "no manifest at"):
            load_manifest(self.paths.manifest)
        manifest = load_manifest(self.write([ONE, OTHER]))
        self.paths.corpus.joinpath("synthetic-cements").mkdir(parents=True)
        self.paths.corpus.joinpath("synthetic-cements/ar-2025-26.pdf").write_bytes(b"%PDF-")
        self.assertEqual(missing_files(manifest.filings, self.paths.corpus), ["other-metals/ar-2025-26.pdf"])

    def test_truncated_json_is_a_manifest_error(self):
        self.paths.manifest.write_text('{"filings": [', encoding="utf-8")
        with self.assertRaisesRegex(ManifestError, "not valid JSON"):
            load_manifest(self.paths.manifest)

    def test_bytes_that_are_not_utf8_are_a_manifest_error(self):
        self.paths.manifest.write_bytes(b"\xff\xfe")
        with self.assertRaisesRegex(ManifestError, "not valid JSON"):
            load_manifest(self.paths.manifest)

    def test_an_empty_manifest_file_names_the_file_and_is_a_manifest_error(self):
        self.paths.manifest.write_text("", encoding="utf-8")
        with self.assertRaises(ManifestError) as caught:
            load_manifest(self.paths.manifest)
        self.assertIn(str(self.paths.manifest), str(caught.exception))
        self.assertIn("not valid JSON", str(caught.exception))

    def test_a_filing_may_carry_a_stratum_a_scope_note_and_a_page_spread(self):
        manifest = load_manifest(self.write([ONE, BANK]))
        plain, bank = manifest.filings
        self.assertEqual((plain.stratum, plain.out_of_scope, plain.printed_pages_per_page), (None, None, 1))
        self.assertEqual(manifest.by_id()["synthetic-bank/ar-2025-26"].stratum, "financials")
        self.assertEqual((bank.out_of_scope, bank.printed_pages_per_page),
                         ("bank: statements not in the taxonomy yet", 2))

    def test_a_stratum_or_page_spread_outside_the_vocabulary_is_refused(self):
        for bad in (dict(ONE, stratum="huge"), dict(ONE, printed_pages_per_page=3)):
            with self.subTest(bad=bad), self.assertRaises(ManifestError):
                load_manifest(self.write([bad]))

    def test_select_leaves_out_of_scope_filings_out_unless_named(self):
        manifest = load_manifest(self.write([ONE, BANK, OTHER]))
        one, bank, other = "synthetic-cements/ar-2025-26", "synthetic-bank/ar-2025-26", "other-metals/ar-2025-26"
        self.assertEqual([f.id for f in manifest.select("dev")], [one])
        self.assertEqual([f.id for f in manifest.select("all")], [one, other])
        self.assertEqual([f.id for f in manifest.select("dev", only=[bank])], [bank])
        self.assertEqual([f.id for f in manifest.select("all", only=[bank, one])], [one, bank])

    def test_out_of_scope_lists_the_left_out_filings_of_the_set_in_manifest_order(self):
        held_back = dict(OTHER, out_of_scope="bank: statements not in the taxonomy yet")
        manifest = load_manifest(self.write([ONE, BANK, held_back]))
        self.assertEqual([f.id for f in manifest.out_of_scope("dev")], ["synthetic-bank/ar-2025-26"])
        self.assertEqual([f.id for f in manifest.out_of_scope("heldout")], ["other-metals/ar-2025-26"])
        self.assertEqual([f.id for f in manifest.out_of_scope()],
                         ["synthetic-bank/ar-2025-26", "other-metals/ar-2025-26"])
        self.assertEqual(load_manifest(self.write([ONE, OTHER])).out_of_scope(), [])


Q2 = dict(file="synthetic-cements/results-2025-09.pdf", company="Synthetic Cements Limited", kind="financial_results",
          period_end="2025-09-30", set="dev")
PAIR = dict(file="synthetic-cements/xbrl/a.xml", basis="consolidated", period="SQ2025-2026", filed="2025-10-17",
            format="in-capmkt/ind_as")


class PairedManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))

    def fixture_with_pairs_and_tags(self) -> Path:
        # Every optional field, written the way the committed manifest is written, with a non-ASCII name.
        filings = [
            {"file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
             "kind": "annual_report", "period_end": "2026-03-31", "set": "dev", "stratum": "financials",
             "out_of_scope": "bank: statements not in the taxonomy yet", "printed_pages_per_page": 2,
             "tags": {"unit": "lakh", "unit_from": "investor", "negatives_in_brackets": False,
                      "restated_columns": True}},
            dict(Q2, bse_code="500999",
                 xbrl=[PAIR, dict(PAIR, file="synthetic-cements/xbrl/b.xml", basis="standalone", format=None)],
                 tags={"unit": "crore", "unit_from": "xbrl"}),
            {"file": "café-metals/ar-2025-26.pdf", "company": "Café Metals Limited", "kind": "annual_report",
             "period_end": "2026-03-31", "set": "heldout"},
        ]
        path = Path(self.temp.name) / "fixture.json"
        path.write_text(json.dumps({"filings": filings}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return path

    def test_period_tokens(self):
        tokens = ("JQ2025-2026", "SQ2025-2026", "SH2025-2026", "DQ2025-2026", "DN2025-2026", "MQ2025-2026",
                  "MH2025-2026", "MC2025-2026")
        self.assertEqual([period_end_of_token(t) for t in tokens],
                         [date(2025, 6, 30), date(2025, 9, 30), date(2025, 9, 30), date(2025, 12, 31),
                          date(2025, 12, 31), date(2026, 3, 31), date(2026, 3, 31), date(2026, 3, 31)])
        for bad in ("SQ2025-2027", "XQ2025-2026", "SQ25-26", "sq2025-2026", "SQ2025-2026\n", "SQ٢٠٢٥-٢٠٢٦"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                period_end_of_token(bad)

    def test_a_results_filing_takes_its_code_and_instances(self):
        f = Filing(**Q2, bse_code="500999", xbrl=[XbrlPair(**PAIR)])
        self.assertEqual((f.company_folder, f.xbrl[0].basis), ("synthetic-cements", "consolidated"))

    def test_pairs_are_refused_where_they_cannot_belong(self):
        for bad in (dict(Q2, kind="annual_report", file="synthetic-cements/ar-2025-26.pdf", period_end="2026-03-31",
                         bse_code="500999", xbrl=[dict(PAIR, period="MC2025-2026")]),   # annual reports are never paired
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, period="JQ2025-2026")]),   # ends 30 Jun, the filing 30 Sep
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="other-metals/xbrl/a.xml")]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="synthetic-cements/a.xml")]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="synthetic-cements/xbrl/a.pdf")]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, file="synthetic-cements/xbrl/x/a.xml")]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, basis="group")]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, filed="17/10/2025")]),
                    dict(Q2, bse_code="500999", xbrl=[{k: v for k, v in PAIR.items() if k != "format"}]),
                    dict(Q2, bse_code="500999", xbrl=[dict(PAIR, extra=1)]),
                    dict(Q2, xbrl=[PAIR]),                                                  # no BSE code
                    dict(Q2, bse_code="50099"),
                    dict(Q2, bse_code="٥٠٠٩٩٩"),
                    dict(Q2, tags={"unit": "billion"}),
                    dict(Q2, tags={"unit_from": "guess"})):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                Filing(**bad)

    def test_tag_values(self):
        f = Filing(**Q2, tags=FormatTags(unit="crore", unit_from="xbrl", negatives_in_brackets=True))
        self.assertEqual(tag_values(f), {"unit": "crore", "brackets": "yes", "restated": "not tagged",
                                         "spreads": "no", "financials": "no"})
        self.assertEqual(tag_values(Filing(**Q2, stratum="financials", printed_pages_per_page=2)),
                         {"unit": "not tagged", "brackets": "not tagged", "restated": "not tagged",
                          "spreads": "yes", "financials": "yes"})
        no = Filing(**Q2, tags=FormatTags(negatives_in_brackets=False, restated_columns=False))
        self.assertEqual((tag_values(no)["brackets"], tag_values(no)["restated"]), ("no", "no"))

    def test_the_manifest_round_trips_byte_for_byte(self):
        # A fixture with every optional field, and the committed corpus manifest, are written back unchanged.
        for path in (self.fixture_with_pairs_and_tags(), DEFAULT.manifest):
            with self.subTest(path=path.name):
                out = Path(self.temp.name) / "m.json"
                write_manifest(out, load_manifest(path))
                self.assertEqual(out.read_bytes(), path.read_bytes())

    def test_an_unpaired_manifest_loads_with_the_new_fields_empty(self):
        f = load_manifest(self.fixture_with_pairs_and_tags()).filings[2]
        self.assertEqual((f.bse_code, f.xbrl, f.tags), (None, [], None))


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

    def test_an_aware_time_is_stamped_in_utc(self):
        india = timezone(timedelta(hours=5, minutes=30))
        run = self.paths.new_run(now=datetime(2026, 10, 16, 15, 0, 5, tzinfo=india))
        self.assertEqual(run.name, "20261016T093005Z")

    def test_a_naive_time_is_taken_as_utc(self):
        run = self.paths.new_run(now=datetime(2026, 10, 16, 9, 30, 5))
        self.assertEqual(run.name, "20261016T093005Z")

    def test_a_label_that_would_nest_the_folder_is_refused_and_nothing_is_created(self):
        with self.assertRaisesRegex(RunLabelError, "run label 'a/b'"):
            self.paths.new_run("a/b")
        self.assertFalse(self.paths.runs.exists())

    def test_a_label_may_use_letters_digits_dot_dash_and_underscore(self):
        run = self.paths.new_run("v1.2_try-3", now=datetime(2026, 10, 16, 9, 30, 5, tzinfo=timezone.utc))
        self.assertEqual(run, self.paths.runs / "20261016T093005Z-v1.2_try-3")
        self.assertTrue(run.is_dir())

    def test_resolve_latest_name_and_path(self):
        first = self.paths.new_run(now=datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
        second = self.paths.new_run(now=datetime(2026, 10, 16, 10, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(self.paths.resolve_run("latest"), second)
        self.assertEqual(self.paths.resolve_run(first.name), first)
        self.assertEqual(self.paths.resolve_run(str(first)), first)
        with self.assertRaises(RunNotFoundError):
            self.paths.resolve_run("20000101T000000Z")

    def test_latest_ignores_folders_that_are_not_runs(self):
        run = self.paths.new_run(now=datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
        (self.paths.runs / "archive").mkdir()
        self.assertEqual(self.paths.resolve_run("latest"), run)

    def test_latest_with_only_folders_that_are_not_runs(self):
        (self.paths.runs / "archive").mkdir(parents=True)
        with self.assertRaises(RunNotFoundError):
            self.paths.resolve_run("latest")

    def test_a_name_must_be_a_folder_directly_inside_runs(self):
        run = self.paths.new_run(now=datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
        (run / "inside").mkdir()
        for name in ("", ".", "..", f"{run.name}/inside", f"{run.name}/.."):
            with self.subTest(name=name), self.assertRaises(RunNotFoundError):
                self.paths.resolve_run(name)

    def test_a_path_may_point_at_a_run_folder_anywhere(self):
        elsewhere = self.paths.base / "archive" / "20260101T000000Z-old"
        elsewhere.mkdir(parents=True)
        self.assertEqual(self.paths.resolve_run(str(elsewhere)), elsewhere)

    def stray_folders(self):
        """Make the current folder one that holds a folder named like a run and one called `archive`."""
        here = Path(self.temp.name) / "here"
        (here / "20260101T000000Z-old").mkdir(parents=True)
        (here / "archive" / "20250101T000000Z-older").mkdir(parents=True)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(here)

    def test_a_bare_name_is_looked_up_under_runs_only(self):
        run = self.paths.new_run(now=datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
        self.stray_folders()
        with self.assertRaises(RunNotFoundError):
            self.paths.resolve_run("20260101T000000Z-old")
        self.assertEqual(self.paths.resolve_run(run.name), run)
        self.assertEqual(self.paths.resolve_run(str(run)), run)
        self.assertEqual(self.paths.resolve_run("archive/20250101T000000Z-older"),
                         Path("archive/20250101T000000Z-older"))

    def test_a_path_must_end_in_a_real_name(self):
        self.stray_folders()
        for path in ("archive/..", "/"):
            with self.subTest(path=path), self.assertRaises(RunNotFoundError):
                self.paths.resolve_run(path)

    def test_latest_with_no_runs(self):
        with self.assertRaises(RunNotFoundError):
            self.paths.resolve_run("latest")


class NormaliseTests(unittest.TestCase):
    def test_matches_the_api_normalisation(self):
        # apps/api/src/financials/stitch.ts normalise(): lower-case, & → and, drop punctuation, collapse spaces.
        self.assertEqual(normalise("  Property, Plant & Equipment  "), "property plant and equipment")
        self.assertEqual(normalise("Profit/(Loss) for the year (XI + XIV)"), "profit loss for the year xi xiv")
        self.assertEqual(normalise("Earnings per share – Basic (₹)"), "earnings per share basic")


if __name__ == "__main__":
    unittest.main()
