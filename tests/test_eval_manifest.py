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

    def test_stratum_scope_and_spreads(self):
        bank = dict(OTHER, stratum="financials", out_of_scope="bank statements are outside taxonomy v1",
                    printed_pages_per_page=2)
        manifest = load_manifest(self.write([ONE, bank]))
        plain, marked = manifest.filings
        self.assertEqual((plain.stratum, plain.out_of_scope, plain.printed_pages_per_page), (None, None, 1))
        self.assertEqual((marked.stratum, marked.printed_pages_per_page), ("financials", 2))
        self.assertEqual(marked.out_of_scope, "bank statements are outside taxonomy v1")
        for bad in (dict(ONE, stratum="banks"), dict(ONE, printed_pages_per_page=3)):
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
