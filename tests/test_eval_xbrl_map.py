"""`maester-eval xbrl-map`: the evaluation of the element maps and of `xbrl_in_pdf`, counts and names only. Offline."""

import csv
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from pdf_fixtures import make_pdf
from typer.testing import CliRunner
from xbrl_fixtures import BSE_FIN, IND_AS_MARKERS, f, identity_facts, ind_as, instance

from pdf_financial_qa.xbrl.parser import parse_instance
from pdf_financial_qa.xbrl.read import read_instance

from maester_eval import cli
from maester_eval.paths import EvalPaths
from maester_eval.xbrl_map import (
    Tally,
    XbrlMapError,
    _count_file,
    deltas,
    flatten,
    read_instance_manifest,
    read_pdf_manifest,
    run_xbrl_map,
    share,
    token_of,
)

# Figures of the synthetic instances and the company they are in: none may reach a file the command writes.
FIGURES = ("1234500000", "5500000", "24690", "12345", "400000000", "12,345.00")
COMPANY = "SYNTHETIC CEMENTS"

CAPMKT = "2025-11-12_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500001_1112025101010.xml"
BSE = "2025-11-12_SQ2025-2026_standalone_Main_Ind_As_500002_1112025101011.xml"
BANKING = "2025-11-12_SQ2025-2026_consolidated_IFBanking_500003_1112025101012.xml"
NBFC = "2025-11-12_SQ2025-2026_consolidated_Integrated_Finance_NBFC_500003_1112025101012.xml"
HOSTILE = "2025-11-12_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500004_1112025101013.xml"
LONE = "2025-11-13_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500005_1112025101014.xml"

CAPMKT_DATA = instance(facts=ind_as(), rounding="Lakhs")
BSE_DATA = instance(namespace=BSE_FIN, schema_ref="Ind-AS_entry_point_2020-03-31.xsd", facts=ind_as(), rounding="Lakhs")
# A loss on other income: negative in the instance, printed in brackets on the PDF.
NEGATIVE_DATA = instance(facts=ind_as(other_income=("-5500000", "-5")), rounding="Lakhs")
# A format with no map: read, and no fact written.
NBFC_DATA = instance(facts=[*identity_facts(), f("InterestEarned", "OneD"), f("FeesAndCommissionIncome", "OneD")])
HOSTILE_DATA = instance(facts=[*identity_facts(), *IND_AS_MARKERS], doctype='<!DOCTYPE xbrli:xbrl [<!ENTITY lol "lol">]>')

TITLE = "Statement of Unaudited Consolidated Financial Results for the quarter ended 30 September 2025"


def write_csv(path: Path, header: list[str], rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)


class StampedPaths(EvalPaths):
    """Each run folder gets its own second, so two runs of a test never meet in one folder."""

    def new_run(self, label=None, now=None):
        StampedPaths.calls += 1
        return super().new_run(label, datetime(2026, 10, 21, tzinfo=timezone.utc) + timedelta(seconds=StampedPaths.calls))

    calls = 0


class Case(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.instances = self.root / "filings" / "xbrl" / f"500001_{COMPANY} LIMITED"
        self.instances.mkdir(parents=True)
        self.paths = StampedPaths(self.root / "data")
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def put(self, name, data):
        (self.instances / name).write_bytes(data)

    def command(self, *args):
        return CliRunner().invoke(cli.app, ["xbrl-map", *args], env={"COLUMNS": "500"})

    def run_dirs(self):
        return sorted(self.paths.runs.iterdir())

    def assert_clean(self, *paths):
        for path in paths:
            text = path.read_text(encoding="utf-8")
            for secret in (*FIGURES, COMPANY, "NameOfTheCompany"):
                self.assertNotIn(secret, text, f"{secret} in {path.name}")


class MapReportTests(Case):
    def setUp(self):
        super().setUp()
        self.put(CAPMKT, CAPMKT_DATA)
        self.put(BSE, BSE_DATA)
        self.put(NBFC, NBFC_DATA)
        self.put(HOSTILE, HOSTILE_DATA)

    def test_a_fact_in_a_context_the_instance_does_not_define_is_refused_by_the_read_and_counted(self):
        self.put(LONE, instance(facts=[*ind_as(), f("Revenue", "NoSuchContext")], rounding="Lakhs"))
        report = run_xbrl_map(self.instances.parent)
        self.assertEqual(report["files"]["unreadable"]["MALFORMED"], 1)
        self.assertEqual(report["files"]["read"], 3)

    def test_counting_a_file_does_not_crash_on_a_fact_in_an_undefined_context(self):
        dangling = parse_instance(instance(facts=[*ind_as(), f("Revenue", "NoSuchContext")], rounding="Lakhs"),
                                  max_bytes=10**7, max_facts=10**5, deadline_seconds=30.0)
        clean = read_instance(parse_instance(CAPMKT_DATA, max_bytes=10**7, max_facts=10**5, deadline_seconds=30.0))
        _count_file(Tally(), Path(CAPMKT), dangling, clean)  # the read refuses such a file first: this guards the count

    def test_a_file_that_cannot_be_read_is_counted_not_a_crash(self):
        (self.instances / LONE).write_bytes(CAPMKT_DATA)
        real = Path.read_bytes

        def read_bytes(path):
            if path.name == LONE:
                raise PermissionError("denied")
            return real(path)

        with mock.patch.object(Path, "read_bytes", read_bytes):
            report = run_xbrl_map(self.instances.parent)
        self.assertEqual(report["files"]["unreadable"]["UNREADABLE_FILE"], 1)
        self.assertEqual(report["files"]["read"], 3)

    def test_counts_of_files_formats_and_sums(self):
        response = self.command("--instances", str(self.instances.parent))
        self.assertEqual(response.exit_code, 0, response.output)
        [run] = self.run_dirs()
        self.assertTrue(run.name.endswith("-xbrl-map"))
        report = json.loads((run / "report.json").read_text(encoding="utf-8"))

        self.assertEqual((report["files"]["found"], report["files"]["read"]), (4, 3))
        self.assertEqual(report["files"]["unreadable"], {"DOCTYPE": 1})
        self.assertEqual({k: v["files"] for k, v in report["formats"].items()},
                         {"in-bse-fin/ind_as": 1, "in-capmkt/nbfc": 1, "in-capmkt/ind_as": 1})
        self.assertEqual(report["warnings_files"]["XBRL_FORMAT_UNMAPPED"], 1)  # one unmapped format, two mapped
        self.assertEqual(report["format_tokens"]["as_the_token_says"], 3)
        self.assertEqual(report["format_tokens"]["matrix"]["Main_Ind_As"], {"in-bse-fin/ind_as": 1})
        self.assertEqual(report["format_tokens"]["matrix"]["Integrated_Finance_NBFC"], {"in-capmkt/nbfc": 1})
        # Two mapped files, each with two periods (OneD, FourD): the values add up, so every sum passes.
        self.assertEqual(report["sums"]["income"], {"passed": 4, "failed": 0, "not_checked": 0})
        self.assertEqual(report["sums"]["expenses"], {"passed": 4, "failed": 0, "not_checked": 0})
        self.assertEqual(report["rounding"], {"files_pass": 3, "files_missing": 0, "files_mismatch": 0})
        capmkt = report["formats"]["in-capmkt/ind_as"]
        self.assertGreater(capmkt["mapped"], 0)
        self.assertEqual(capmkt["unmapped"], 0)
        self.assertEqual(report["formats"]["in-capmkt/nbfc"]["facts_written"], 0)
        self.assertEqual(report["concepts"]["facts_written"], report["concepts"]["with_concept"])
        self.assertEqual(report["entry_points"]["files"], {"Ind-AS_entry_point_2020-03-31.xsd": 1,
                                                           "in-capmkt-ent-2025-01-31.xsd": 2})
        self.assertNotIn("pdf_check", report)

        markdown = (run / "report.md").read_text(encoding="utf-8")
        self.assertIn("3", markdown)
        self.assertIn("`DOCTYPE`", markdown)
        self.assert_clean(run / "report.json", run / "report.md")

    def test_a_published_copy_with_to(self):
        target = self.root / "out" / "report.md"
        response = self.command("--instances", str(self.instances.parent), "--to", str(target))
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertEqual(target.read_text(encoding="utf-8"), (self.run_dirs()[0] / "report.md").read_text(encoding="utf-8"))

    def test_the_console_holds_counts_and_paths_only(self):
        response = self.command("--instances", str(self.instances.parent))
        self.assert_clean_output(response.output)

    def assert_clean_output(self, output):
        for secret in (*FIGURES, "SYNTHETIC"):
            self.assertNotIn(secret, output)

    def test_against_an_earlier_report_shows_the_change_of_each_count(self):
        self.command("--instances", str(self.instances.parent))
        [first] = self.run_dirs()
        self.put(LONE, CAPMKT_DATA)
        response = self.command("--instances", str(self.instances.parent), "--against", str(first / "report.json"))
        self.assertEqual(response.exit_code, 0, response.output)
        second = self.run_dirs()[-1]
        markdown = (second / "report.md").read_text(encoding="utf-8")
        self.assertIn("## Change against report.json", markdown)
        self.assertIn("| `files.read` | 3 | 4 | +1 |", markdown)
        self.assertIn("| `sums.income.passed` | 4 | 6 | +2 |", markdown)
        self.assert_clean(second / "report.md")

    def test_a_report_that_is_not_json_stops_the_command(self):
        bad = self.root / "bad.json"
        bad.write_text("not json", encoding="utf-8")
        response = self.command("--instances", str(self.instances.parent), "--against", str(bad))
        self.assertEqual(response.exit_code, 1)
        self.assertIn("is not a readable report.json", response.output)
        self.assertFalse(self.paths.runs.exists())


class TokenTests(unittest.TestCase):
    def test_a_token_is_matched_whole(self):
        self.assertEqual(token_of(BANKING), "IFBanking")
        self.assertEqual(token_of("2025-06-12_SQ2024-2025_consolidated_Banking_500003_1262025.xml"), "Banking")
        self.assertEqual(token_of("2025-06-12_SQ2024-2025_consolidated_Integrated_Finance_NBFC_500003_1262025_IFNBFC.xml"),
                         "Integrated_Finance_NBFC")
        self.assertEqual(token_of("2025-06-12_SQ2024-2025_consolidated_NBFC_500003_1262025.xml"), "NBFC")
        self.assertEqual(token_of("elsewhere.xml"), "no token")

    def test_a_file_in_another_format_than_its_token_is_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "company"
            folder.mkdir()
            (folder / "2025-11-12_SQ2025-2026_consolidated_NBFC_500009_1112025101010.xml").write_bytes(CAPMKT_DATA)
            report = run_xbrl_map(Path(tmp))
        tokens = report["format_tokens"]
        self.assertEqual((tokens["as_the_token_says"], tokens["disagreeing_total"]), (0, 1))
        self.assertEqual(tokens["disagreeing"], ["2025-11-12_SQ2025-2026_consolidated_NBFC_500009_1112025101010.xml"])
        self.assertEqual(tokens["matrix"], {"NBFC": {"in-capmkt/ind_as": 1}})


class HelperTests(unittest.TestCase):
    def test_share_is_integer_arithmetic(self):
        self.assertEqual(share(1, 3), "33.3%")
        self.assertEqual(share(2, 3), "66.7%")
        self.assertEqual(share(807, 807), "100.0%")
        self.assertEqual(share(0, 0), "-")

    def test_flatten_and_deltas(self):
        before = {"a": {"b": 1, "c": [{"element": "X", "files": 2}], "names": ["f.xml"]}, "sum_failures": {"s": [{"x": 9}]}}
        now = {"a": {"b": 3, "c": [{"element": "X", "files": 2}, {"element": "Y", "files": 1}], "names": []}}
        self.assertEqual(flatten(before), {"a.b": 1, "a.c[X].files": 2})
        self.assertEqual(deltas(now, before), [("a.b", 1, 3), ("a.c[Y].files", 0, 1)])


class PdfRunTests(Case):
    """The paired-PDF run: three PDFs, each announced the day of an instance of its BSE code."""

    def setUp(self):
        super().setUp()
        self.pdf_root = self.root / "filings"
        for name, data in ((CAPMKT, NEGATIVE_DATA), (BSE, BSE_DATA), (NBFC, NBFC_DATA), (LONE, CAPMKT_DATA)):
            self.put(name, data)
        pdf_dir = self.pdf_root / "filings" / "results"
        pdf_dir.mkdir(parents=True)
        # In the instance's unit (lakh), with two places, and its period: the pair is made.
        (pdf_dir / "agrees.pdf").write_bytes(make_pdf([
            [TITLE],
            ["Consolidated Statement of Profit and Loss for the quarter ended 30 September 2025", "Revenue from operations 12,345.00", "Other income (55.00)", "Revenue for the half year 2,469,000,000"],
        ]))
        # Another period: the pair is counted and left out.
        (pdf_dir / "disagrees.pdf").write_bytes(make_pdf([
            ["Statement of Unaudited Standalone Financial Results for the quarter ended 30 June 2025"],
        ]))
        # No period: the pair is kept.
        (pdf_dir / "unread.pdf").write_bytes(make_pdf([["Statement of Unaudited Consolidated Financial Results for the period"]]))
        write_csv(self.pdf_root / "xbrl-manifest.csv", ["bse_code", "basis", "filed", "file"], [
            ["500001", "consolidated", "2025-11-12", f"xbrl/x/{CAPMKT}"],
            ["500002", "standalone", "2025-11-12", f"xbrl/x/{BSE}"],
            ["500003", "consolidated", "2025-11-12", f"xbrl/x/{NBFC}"],
            ["500005", "consolidated", "2025-11-13", f"xbrl/x/{LONE}"],
        ])
        head = ["bse_code", "date", "category", "subcategory", "status", "file"]
        write_csv(self.pdf_root / "manifest.csv", head, [
            ["500001", "2025-11-12", "Result", "Financial Results", "ok", "filings/results/agrees.pdf"],
            ["500002", "2025-11-12", "Result", "Financial Results", "ok", "filings/results/disagrees.pdf"],
            ["500003", "2025-11-12", "Result", "Financial Results", "ok", "filings/results/unread.pdf"],
            # Not a results PDF, not read, and a PDF of another day: none pairs with LONE (500005, 13 November).
            ["500005", "2025-11-13", "Company Update", "Credit Rating", "ok", "filings/results/agrees.pdf"],
            ["500005", "2025-11-12", "Result", "Financial Results", "ok", "filings/results/agrees.pdf"],
            ["500001", "2025-11-12", "Result", "Financial Results", "failed", "filings/results/missing.pdf"],
        ])

    def args(self):
        return ["--instances", str(self.instances.parent), "--manifest", str(self.pdf_root / "xbrl-manifest.csv"),
                "--pdfs", str(self.pdf_root), "--pdf-manifest", str(self.pdf_root / "manifest.csv")]

    def report(self):
        response = self.command(*self.args())
        self.assertEqual(response.exit_code, 0, response.output)
        [run] = self.run_dirs()
        return run, json.loads((run / "report.json").read_text(encoding="utf-8"))

    def test_the_pairs_and_what_is_left_out(self):
        _, report = self.report()
        pairing = report["pdf_check"]["pairing"]
        self.assertEqual(pairing["period_agrees"], 1)
        self.assertEqual(pairing["period_disagrees"], 1)
        self.assertEqual(pairing["period_unread"], 1)
        self.assertEqual(pairing["unpaired_no_pdf"], 1)
        self.assertEqual(pairing["paired"], 2)  # the pair that agrees and the one with no period; one without facts
        self.assertEqual(pairing["paired_without_facts"], 1)
        self.assertNotIn("not_in_manifest", pairing)

    def test_the_revenue_is_counted_passed_under_lakh(self):
        run, report = self.report()
        check = report["pdf_check"]
        lakh = check["by_unit"]["₹ lakh"]
        self.assertEqual((lakh["passed"], lakh["passed_exact"], lakh["passed_rounded"]), (2, 2, 0))  # revenue, and the loss
        self.assertGreater(lakh["failed"], 0)  # every other line is not on the page
        self.assertEqual(check["by_statement"]["income_statement"]["passed"], 2)
        self.assertEqual(check["by_basis"]["consolidated"]["passed"], 2)
        self.assertEqual(check["by_pairing"]["period agrees"]["passed"], 2)
        # Revenue is on the page in the quarter and not in the half year: the half year's value fails.
        failing = {i["element"]: i["files"] for i in check["top_failing_elements"]}
        self.assertEqual(failing["RevenueFromOperations"], 1)
        # The half year's revenue is on the page in rupees, not in lakh: it fails, and the report finds it in another unit.
        other = check["failed_in_another_unit"]["₹ lakh"]
        self.assertEqual(other["as ₹"], 1)
        self.assertGreaterEqual(other["found_in_another_unit"], 1)  # a small number can match by chance, as 30 does here
        # The revenue is printed plain, as the instance holds it. The loss is negative in the instance and printed in
        # brackets: the check, which compares absolute values, passes both, and the report sees the difference.
        self.assertEqual(check["sign"]["other"]["passed"], 1)
        self.assertEqual(check["sign"]["other"]["printed_signed_somewhere"], 0)
        self.assertEqual(check["sign"]["negative"], {"passed": 1, "printed_signed_somewhere": 1, "printed_plain_only": 0})
        # A decoy a unit away is not on the page.
        self.assertEqual(check["decoy"]["₹ lakh"]["passed"], 0)
        self.assertGreater(check["decoy"]["₹ lakh"]["checked"], 0)
        self.assert_clean(run / "report.json", run / "report.md")

    def test_the_statement_the_instance_holds_has_its_page(self):
        # The synthetic instance holds profit and loss lines only, and the PDF has that page: no "no_statement_pages".
        _, report = self.report()
        self.assertEqual(report["pdf_check"]["by_statement"]["income_statement"]["not_checked_by_reason"], {})
        self.assertNotIn("cash_flow", report["pdf_check"]["by_statement"])

    def test_a_pdf_that_cannot_be_read_is_counted_under_its_reason(self):
        (self.pdf_root / "filings" / "results" / "agrees.pdf").write_bytes(b"not a pdf")
        _, report = self.report()
        pairing = report["pdf_check"]["pairing"]
        self.assertEqual(pairing["pdf_unreadable_UNREADABLE_PDF"], 1)
        self.assertEqual(pairing["unpaired_pdf_unreadable"], 1)

    def test_pdfs_without_both_manifests_is_refused(self):
        response = self.command("--instances", str(self.instances.parent), "--pdfs", str(self.pdf_root))
        self.assertEqual(response.exit_code, 1)
        self.assertIn("--pdfs needs --pdf-manifest and --manifest", response.output)

    def test_a_manifest_without_its_columns_is_refused(self):
        write_csv(self.pdf_root / "bad.csv", ["code"], [["1"]])
        with self.assertRaises(XbrlMapError):
            read_instance_manifest(self.pdf_root / "bad.csv")
        with self.assertRaises(XbrlMapError):
            read_pdf_manifest(self.pdf_root / "bad.csv")

    def test_the_manifests_are_read_as_the_brief_says(self):
        self.assertEqual(read_instance_manifest(self.pdf_root / "xbrl-manifest.csv")[CAPMKT], ("500001", "2025-11-12"))
        groups = read_pdf_manifest(self.pdf_root / "manifest.csv")
        self.assertEqual(groups[("500001", "2025-11-12")], ["filings/results/agrees.pdf"])  # the failed row is left out
        self.assertNotIn(("500005", "2025-11-13"), groups)  # not a result


@unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
class RealInstanceTests(unittest.TestCase):
    def test_every_instance_is_read_in_the_format_its_token_says(self):
        report = run_xbrl_map(Path(os.environ["MAESTER_XBRL_DIR"]).expanduser())
        self.assertEqual(report["files"]["unreadable_total"], 0)
        self.assertEqual(report["format_tokens"]["disagreeing_total"], 0)
        self.assertEqual(report["rounding"]["files_missing"], 0)
