"""`maester-eval xbrl-pair`: results filings paired with the XBRL instances BSE filed for them. Offline."""

import csv
import dataclasses
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from typer.testing import CliRunner
from xbrl_fixtures import ind_as, instance

from maester_eval import cli
from maester_eval.manifest import Manifest, load_manifest, write_manifest
from maester_eval.paths import EvalPaths
from maester_eval.xbrl_limits import XBRL_LIMITS
from maester_eval.xbrl_pair import XbrlPairError, XbrlRow, apply_pairs, plan_pairs, read_xbrl_manifest

Q2 = {"file": "synthetic-cements/results-2025-09.pdf", "company": "Synthetic Cements Limited",
      "kind": "financial_results", "period_end": "2025-09-30", "set": "dev"}
AR = {"file": "synthetic-cements/ar-2025-26.pdf", "company": "Synthetic Cements Limited",
      "kind": "annual_report", "period_end": "2026-03-31", "set": "dev"}
OTHER = {"file": "other-metals/results-2025-09.pdf", "company": "Other Metals Limited",
         "kind": "financial_results", "period_end": "2025-09-30", "set": "heldout"}

FOLDER = "xbrl/mid/500999_Synthetic Cements"
NAMES = {
    "a": f"{FOLDER}/2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_1710202510000.xml",
    "b": f"{FOLDER}/2025-10-17_SQ2025-2026_standalone_Integrated_Finance_Ind_As_500999_1710202510001.xml",
    "c": f"{FOLDER}/2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_27102025.xml",
    "d": f"{FOLDER}/2026-05-20_MC2025-2026_consolidated_Integrated_Finance_Ind_As_500999_2052026100000.xml",
}
COMPANY = "Synthetic Cements Limited"


def row(key, period, basis, filed):
    return XbrlRow(bse_code="500999", company=COMPANY, period=period, basis=basis, filed=filed,
                   file=NAMES[key], status="exists")


ROWS = [row("a", "SQ2025-2026", "consolidated", "2025-10-17"),
        row("b", "SQ2025-2026", "standalone", "2025-10-17"),
        row("c", "SQ2025-2026", "consolidated", "2025-10-17"),
        row("d", "MC2025-2026", "consolidated", "2026-05-20")]
HEADER = ["tier", "bse_code", "company", "period", "audited", "basis", "filed", "file", "status"]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.paths = EvalPaths(root / "data")
        self.source = root / "filings"
        self.corpus = self.paths.corpus
        self.manifest = Manifest.model_validate({"filings": [Q2, AR, OTHER]})
        self.rows = list(ROWS)
        self.bodies = {}
        for index, (key, name) in enumerate(NAMES.items()):
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            # Each file differs by its rounding fact's text only, so two files never share bytes.
            self.bodies[key] = instance(facts=ind_as(), comment=f"<!--synthetic {index}-->")
            path.write_bytes(self.bodies[key])

    def write_csv(self, rows, header=HEADER):
        path = Path(self.temp.name) / "xbrl-manifest.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle, quoting=csv.QUOTE_ALL)
            writer.writerow(header)
            for r in rows:
                values = {"tier": "mid", "audited": "Unaudited", **dataclasses.asdict(r)}
                writer.writerow([values[column] for column in header])
        return path


class PlanTests(Fixture):
    def test_plan(self):
        plan = plan_pairs(self.manifest, self.rows)
        self.assertEqual(plan.codes, {"synthetic-cements": "500999"})
        self.assertEqual([r.basis for r in plan.pairs["synthetic-cements/results-2025-09"]],
                         ["consolidated", "standalone", "consolidated"])
        self.assertEqual(plan.pairs.get("synthetic-cements/ar-2025-26", []), [])  # annual reports are never paired
        self.assertEqual([r.period for r in plan.no_filing], ["MC2025-2026"])  # only an annual report ends 31 Mar 2026
        self.assertEqual((plan.no_code, plan.none),
                         (["other-metals/results-2025-09"], ["other-metals/results-2025-09"]))
        self.assertEqual(plan.skipped, 0)

    def test_a_company_with_two_codes_stops(self):
        with self.assertRaisesRegex(XbrlPairError, "Synthetic Cements Limited"):
            plan_pairs(self.manifest, self.rows + [dataclasses.replace(self.rows[0], bse_code="500998")])

    def test_a_row_that_does_not_exist_is_skipped_and_counted(self):
        rows = [dataclasses.replace(self.rows[1], status="missing")] + self.rows[:1]
        plan = plan_pairs(self.manifest, rows)
        self.assertEqual(plan.skipped, 1)
        self.assertEqual([r.basis for r in plan.pairs["synthetic-cements/results-2025-09"]], ["consolidated"])

    def test_a_company_is_told_by_its_normalised_name(self):
        rows = [dataclasses.replace(r, company="SYNTHETIC cements, LIMITED") for r in self.rows]
        self.assertEqual(plan_pairs(self.manifest, rows).codes, {"synthetic-cements": "500999"})


class ReadTests(Fixture):
    def test_the_csv_is_read_with_or_without_a_bom(self):
        path = self.write_csv(self.rows)
        self.assertEqual(read_xbrl_manifest(path), self.rows)
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        self.assertEqual(read_xbrl_manifest(path), self.rows)

    def test_a_missing_column_is_named(self):
        path = self.write_csv(self.rows, header=[c for c in HEADER if c != "basis"])
        with self.assertRaisesRegex(XbrlPairError, "basis"):
            read_xbrl_manifest(path)

    def test_a_bad_period_token_or_basis_stops_naming_the_line(self):
        for bad in (dataclasses.replace(self.rows[0], period="XX2025-2026"),
                    dataclasses.replace(self.rows[0], basis="group")):
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(XbrlPairError, "line 2"):
                    read_xbrl_manifest(self.write_csv([bad]))


class ApplyTests(Fixture):
    def test_apply_copies_into_the_corpus_and_writes_the_pairs(self):
        out, copied = apply_pairs(self.manifest, plan_pairs(self.manifest, self.rows), self.source, self.corpus)
        f = out.by_id()["synthetic-cements/results-2025-09"]
        self.assertEqual((f.bse_code, copied, f.xbrl[0].format), ("500999", 3, "in-capmkt/ind_as"))
        self.assertEqual((self.corpus / f.xbrl[0].file).read_bytes(), (self.source / self.rows[0].file).read_bytes())
        self.assertEqual(f.xbrl[0].file, "synthetic-cements/xbrl/" + Path(NAMES["a"]).name)
        self.assertEqual(out.by_id()["synthetic-cements/ar-2025-26"].bse_code, "500999")
        self.assertEqual(out.by_id()["synthetic-cements/ar-2025-26"].xbrl, [])
        self.assertIsNone(out.by_id()["other-metals/results-2025-09"].bse_code)

    def test_a_second_run_copies_nothing_and_changes_nothing(self):
        plan = plan_pairs(self.manifest, self.rows)
        first, _ = apply_pairs(self.manifest, plan, self.source, self.corpus)
        again, copied = apply_pairs(first, plan, self.source, self.corpus)
        self.assertEqual((again, copied), (first, 0))

    def test_an_unreadable_instance_has_a_null_format(self):
        (self.source / NAMES["b"]).write_bytes(b"not xml at all")
        out, _ = apply_pairs(self.manifest, plan_pairs(self.manifest, self.rows), self.source, self.corpus)
        self.assertEqual([p.format for p in out.by_id()["synthetic-cements/results-2025-09"].xbrl],
                         ["in-capmkt/ind_as", None, "in-capmkt/ind_as"])

    def test_a_corpus_file_is_never_overwritten(self):
        plan = plan_pairs(self.manifest, self.rows)
        target = self.corpus / "synthetic-cements" / "xbrl" / Path(NAMES["b"]).name
        target.parent.mkdir(parents=True)
        target.write_bytes(b"someone else's bytes")
        with self.assertRaisesRegex(XbrlPairError, "synthetic-cements/xbrl/"):
            apply_pairs(self.manifest, plan, self.source, self.corpus)
        self.assertEqual(target.read_bytes(), b"someone else's bytes")
        # Nothing else was copied before the refusal.
        self.assertEqual([p.name for p in target.parent.iterdir()], [target.name])

    def test_the_same_bytes_at_the_destination_are_skipped(self):
        plan = plan_pairs(self.manifest, self.rows)
        target = self.corpus / "synthetic-cements" / "xbrl" / Path(NAMES["a"]).name
        target.parent.mkdir(parents=True)
        target.write_bytes(self.bodies["a"])
        _, copied = apply_pairs(self.manifest, plan, self.source, self.corpus)
        self.assertEqual(copied, 2)

    def test_a_missing_source_stops_before_any_copy(self):
        for key in ("a", "b", "c"):
            (self.source / NAMES[key]).unlink()
        with self.assertRaisesRegex(XbrlPairError, r"3 .*missing") as caught:
            apply_pairs(self.manifest, plan_pairs(self.manifest, self.rows), self.source, self.corpus)
        self.assertIn(NAMES["a"], str(caught.exception))
        self.assertFalse((self.corpus / "synthetic-cements").exists())

    def test_the_first_three_missing_paths_are_named(self):
        rows = [dataclasses.replace(self.rows[0], file=f"{FOLDER}/gone-{i}.xml") for i in range(5)]
        with self.assertRaises(XbrlPairError) as caught:
            apply_pairs(self.manifest, plan_pairs(self.manifest, rows), self.source, self.corpus)
        text = str(caught.exception)
        self.assertIn("5", text)
        self.assertIn("gone-0.xml", text)
        self.assertIn("gone-2.xml", text)
        self.assertNotIn("gone-3.xml", text)


class CommandTests(Fixture):
    def setUp(self):
        super().setUp()
        write_manifest(self.paths.manifest, self.manifest)
        self.csv = self.write_csv(self.rows)
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_command(self, *extra):
        return CliRunner().invoke(cli.app, ["xbrl-pair", "--xbrl-manifest", str(self.csv), "--from", str(self.source),
                                            *extra], env={"COLUMNS": "500"})

    def test_the_command_prints_counts_only_and_writes_the_manifest(self):
        result = self.run_command()
        self.assertEqual(result.exit_code, 0, result.output)
        for line in ("paired 1 results filing(s) (1 dev, 0 heldout) with 3 instance(s)",
                     "1 refiled: one period token and basis paired twice",
                     "1 results filing(s) with none: other-metals/results-2025-09",
                     "1 instance(s) with no results filing of their period",
                     "1 annual report(s) given a BSE code, never paired",
                     "no BSE code: other-metals/results-2025-09"):
            self.assertIn(line, result.output)
        for text in (COMPANY, ".xml", "500999_"):
            self.assertNotIn(text, result.output)
        written = load_manifest(self.paths.manifest).by_id()["synthetic-cements/results-2025-09"]
        self.assertEqual(len(written.xbrl), 3)
        self.assertEqual(len(list((self.corpus / "synthetic-cements" / "xbrl").iterdir())), 3)

    def test_dry_run_writes_nothing(self):
        before = self.paths.manifest.read_bytes()
        result = self.run_command("--dry-run")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("paired 1 results filing(s) (1 dev, 0 heldout) with 3 instance(s)", result.output)
        self.assertEqual(self.paths.manifest.read_bytes(), before)
        self.assertFalse((self.corpus / "synthetic-cements").exists())

    def test_dry_run_still_stops_on_a_missing_source(self):
        (self.source / NAMES["a"]).unlink()
        result = self.run_command("--dry-run")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("missing", result.output)

    def test_a_two_code_company_is_a_message_not_a_traceback(self):
        self.csv = self.write_csv(self.rows + [dataclasses.replace(self.rows[0], bse_code="500998")])
        result = self.run_command()
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)
        self.assertIn(COMPANY, result.output)


class LimitsTests(unittest.TestCase):
    def test_the_limits_are_the_extractors_defaults(self):
        self.assertEqual(XBRL_LIMITS, {"max_bytes": 20971520, "max_facts": 100000, "deadline_seconds": 30.0})
        self.assertEqual(json.loads(json.dumps(XBRL_LIMITS)), XBRL_LIMITS)


if __name__ == "__main__":
    unittest.main()
