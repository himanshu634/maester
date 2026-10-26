"""`maester-eval xbrl-read`: the paired instances read in-process into an XBRL run. Offline, synthetic instances only."""

import json
import os
import re
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from typer.testing import CliRunner
from xbrl_fixtures import ind_as, instance

from maester_eval import cli
from maester_eval.artefacts import read_artefacts, read_run
from maester_eval.manifest import Manifest
from maester_eval.paths import EvalPaths, RunNotFoundError
from maester_eval.xbrl_read import read_filing_xbrl, run_xbrl
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION

SYNTHETIC = "Synthetic Cements Limited"
# The pair of an NBFC instance, a format with no map: it outranks Ind AS when the rules are tried in order.
NBFC = [("InterestEarned", "OneD", "INR", "-5", "100000"), ("FeesAndCommissionIncome", "OneD", "INR", "-5", "100000")]
IDENTITY_KEYS = {"NatureOfReportStandaloneConsolidated", "DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod"}


def pair(name, basis="consolidated", period="SQ2025-2026", folder="synthetic-cements"):
    return {"file": f"{folder}/xbrl/{name}", "basis": basis, "period": period, "filed": "2025-10-17", "format": None}


def filing(folder, name, company, eval_set, pairs):
    return {"file": f"{folder}/{name}.pdf", "company": company, "kind": "financial_results", "period_end": "2025-09-30",
            "set": eval_set, "bse_code": "500999" if pairs else None, "xbrl": pairs}


Q2 = filing("synthetic-cements", "results-2025-09", SYNTHETIC, "dev",
            [pair("a.xml"), pair("b.xml", "standalone"), pair("c.xml"), pair("d.xml")])
# e.xml says the quarter ended on 30 June: it is not the instance of a September filing.
Q1_WRONG = filing("other-metals", "results-2025-09", "Other Metals Limited", "heldout",
                  [pair("e.xml", folder="other-metals")])
NO_PAIRS = filing("plain-works", "results-2025-09", "Plain Works Limited", "dev", [])


def standalone(facts):
    return [x for x in facts if x[0] != "NatureOfReportStandaloneConsolidated"] + [
        ("NatureOfReportStandaloneConsolidated", "OneD", None, None, "Standalone")]


def ended_in_june(facts):
    dates = {"DateOfStartOfReportingPeriod": "2025-04-01", "DateOfEndOfReportingPeriod": "2025-06-30"}
    return [(e, c, u, d, dates.get(e, t)) for e, c, u, d, t in facts]


BODIES = {
    ("synthetic-cements", "a.xml"): instance(facts=ind_as(revenue=("1234500000", "-3"))),
    ("synthetic-cements", "b.xml"): instance(facts=standalone(ind_as())),
    ("synthetic-cements", "c.xml"): instance(facts=ind_as() + NBFC),
    ("synthetic-cements", "d.xml"): instance(facts=ind_as(), doctype="<!DOCTYPE note>"),
    ("other-metals", "e.xml"): instance(facts=ended_in_june(ind_as())),
}


class Corpus(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name) / "data")
        for (folder, name), body in BODIES.items():
            target = self.paths.corpus / folder / "xbrl" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        self.manifest = Manifest.model_validate({"filings": [Q2, Q1_WRONG, NO_PAIRS]})
        self.q2, self.q1_wrong, self.no_pairs = self.manifest.filings


class ReadTests(Corpus):
    def test_instances_are_read_checked_and_recorded(self):
        a = read_filing_xbrl(self.q2, self.paths.corpus)
        self.assertEqual([(i.file.rsplit("/", 1)[1], i.used, i.reason) for i in a.instances],
                         [("a.xml", True, None), ("b.xml", True, None), ("c.xml", False, "XBRL_FORMAT_UNMAPPED"),
                          ("d.xml", False, "XBRL_UNREADABLE:DOCTYPE")])
        self.assertEqual((a.source, a.pipeline_version, a.model, a.prompt_version),
                         ("xbrl", "xbrl-1", "xbrl-parser-1", f"in-capmkt/ind_as@{XBRL_MAP_VERSION}"))
        rev = next(f for f in a.result["facts"] if f["element"] == "RevenueFromOperations" and f["contextId"] == "OneD"
                   and f["basis"] == "consolidated")
        self.assertEqual((rev["normalizedValue"], rev["span"], rev["concept"], rev["instance"]),
                         ("1234500000", "quarter", "revenue_from_operations", "synthetic-cements/xbrl/a.xml"))

    def test_the_maps_concepts_for_the_lines_the_later_tasks_use(self):
        a = read_filing_xbrl(self.q2, self.paths.corpus)
        concepts = {f["element"]: f["concept"] for f in a.result["facts"]}
        self.assertEqual((concepts["RevenueFromOperations"], concepts["OtherIncome"], concepts["Income"]),
                         ("revenue_from_operations", "other_income", "total_income"))

    def test_the_artefact_holds_what_the_brief_names(self):
        a = read_filing_xbrl(self.q2, self.paths.corpus)
        used = [i for i in a.instances if i.used]
        self.assertEqual((a.model_calls.total, a.seconds, a.pages_without_text, a.error), (0, 0, [], None))
        self.assertEqual(a.bytes, sum((self.paths.corpus / i.file).stat().st_size for i in a.instances))
        self.assertEqual(set(a.result), {"state", "facts", "checks", "warnings"})
        self.assertEqual(a.result["state"], "complete")
        # Facts of both used instances, each one tagged with the file it came from.
        self.assertEqual({f["instance"] for f in a.result["facts"]},
                         {"synthetic-cements/xbrl/a.xml", "synthetic-cements/xbrl/b.xml"})
        self.assertEqual({f["basis"] for f in a.result["facts"]}, {"consolidated", "standalone"})
        self.assertEqual(sum(i.facts for i in used), len(a.result["facts"]))
        self.assertTrue(all(re.fullmatch("[0-9a-f]{64}", i.sha256) for i in a.instances))
        self.assertEqual([(i.basis, i.period, i.filed) for i in a.instances][:2],
                         [("consolidated", "SQ2025-2026", "2025-10-17"), ("standalone", "SQ2025-2026", "2025-10-17")])
        self.assertEqual((a.instances[0].format, a.instances[0].mapped, a.instances[0].state),
                         ("in-capmkt/ind_as", True, "complete"))
        # An instance that is not used has no state and no facts; one that cannot be read has no format.
        self.assertEqual([(i.format, i.mapped, i.state, i.facts) for i in a.instances[2:]],
                         [("in-capmkt/nbfc", False, None, 0), (None, False, None, 0)])
        # The warnings of an instance are codes, never a message.
        self.assertTrue(all(re.fullmatch("[A-Z_]+", code) for i in a.instances for code in i.warnings))

    def test_a_pairing_that_does_not_hold_is_not_used(self):
        a = read_filing_xbrl(self.q1_wrong, self.paths.corpus)
        self.assertEqual([(i.used, i.reason, i.facts) for i in a.instances], [(False, "XBRL_PAIR_PERIOD", 0)])
        self.assertEqual((a.result["facts"], a.prompt_version, a.result["state"]), ([], "-", "complete"))

    def test_a_company_or_a_basis_that_does_not_hold_is_not_used(self):
        for filing_ in (
                {**Q2, "bse_code": "500998", "xbrl": [pair("a.xml")]},
                {**Q2, "xbrl": [pair("a.xml", "standalone")]}):
            with self.subTest(basis=filing_["xbrl"][0]["basis"], code=filing_["bse_code"]):
                a = read_filing_xbrl(Manifest.model_validate({"filings": [filing_]}).filings[0], self.paths.corpus)
                expected = "XBRL_PAIR_COMPANY" if filing_["bse_code"] == "500998" else "XBRL_PAIR_BASIS"
                self.assertEqual([(i.used, i.reason) for i in a.instances], [(False, expected)])

    def test_a_partial_instance_makes_the_run_partial(self):
        body = instance(facts=ind_as(), rounding=None)  # no level of rounding is declared
        (self.paths.corpus / "synthetic-cements" / "xbrl" / "a.xml").write_bytes(body)
        a = read_filing_xbrl(self.q2, self.paths.corpus)
        self.assertEqual((a.instances[0].used, a.instances[0].state, a.result["state"]), (True, "partial", "partial"))
        self.assertIn("XBRL_ROUNDING_MISSING", a.instances[0].warnings)

    def test_the_artefact_round_trips_through_the_run_folder(self):
        run_dir = self.paths.new_run("xbrl")
        written = run_xbrl([self.q2, self.q1_wrong], self.paths.corpus, run_dir, "all", log=lambda line: None)
        self.assertEqual(read_artefacts(run_dir), sorted(written, key=lambda x: x.filing_id))


class RunTests(Corpus):
    def test_the_run_records_its_versions_and_source(self):
        run_dir = self.paths.new_run("xbrl")
        lines = []
        artefacts = run_xbrl([self.q2, self.q1_wrong, self.no_pairs], self.paths.corpus, run_dir, "all", lines.append)
        record = read_run(run_dir)
        self.assertEqual({k: record[k] for k in ("run", "set", "source", "pipeline_version", "model", "parser_version",
                                                 "map_version", "filings")},
                         {"run": run_dir.name, "set": "all", "source": "xbrl", "pipeline_version": "xbrl-1",
                          "model": "xbrl-parser-1", "parser_version": XBRL_PARSER_VERSION,
                          "map_version": XBRL_MAP_VERSION, "filings": [self.q2.id, self.q1_wrong.id]})
        self.assertTrue(record["started_at"] and record["finished_at"])
        self.assertEqual([a.filing_id for a in artefacts], [self.q2.id, self.q1_wrong.id])
        self.assertEqual(sorted(p.name for p in (run_dir / "artefacts").rglob("*.json")),
                         ["results-2025-09.json", "results-2025-09.json"])
        self.assertEqual(len(lines), 2)  # one line per filing with pairs, none for the one without

    def test_a_run_of_the_older_kind_still_reads(self):
        old = self.paths.new_run("old")
        (old / "run.json").write_text(json.dumps({"run": old.name, "set": "dev"}), encoding="utf-8")
        self.assertEqual(read_run(old), {"run": old.name, "set": "dev"})


class ResolveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        at = lambda hour: datetime(2026, 10, 20, hour, 0, 0, tzinfo=timezone.utc)
        self.pdf_run = self.paths.new_run(now=at(9))
        (self.pdf_run / "run.json").write_text(json.dumps({"run": self.pdf_run.name}), encoding="utf-8")  # no source key
        self.xbrl_run = self.paths.new_run("xbrl", now=at(10))
        (self.xbrl_run / "run.json").write_text(json.dumps({"run": self.xbrl_run.name, "source": "xbrl"}), encoding="utf-8")
        # Phase 4's xbrl-map writes a folder named like a run, with a report and no run.json.
        self.map_folder = self.paths.new_run("xbrl-map", now=at(11))
        (self.map_folder / "report.json").write_text("{}", encoding="utf-8")
        (self.map_folder / "report.md").write_text("", encoding="utf-8")

    def test_latest_by_source_skips_a_folder_with_no_run_json(self):
        self.assertEqual(self.paths.resolve_run("latest", "pdf"), self.pdf_run)
        self.assertEqual(self.paths.resolve_run("latest", "xbrl"), self.xbrl_run)
        self.assertEqual(self.paths.resolve_run("latest"), self.map_folder)  # phase 0 behaviour, unchanged
        with self.assertRaisesRegex(RunNotFoundError, f"run {self.xbrl_run.name} is not a pdf run"):
            self.paths.resolve_run(self.xbrl_run.name, "pdf")
        with self.assertRaisesRegex(RunNotFoundError, "no runs under .* with source xbrl"):
            EvalPaths(Path(self.temp.name) / "empty").resolve_run("latest", "xbrl")

    def test_a_named_run_is_read_as_named(self):
        self.assertEqual(self.paths.resolve_run(self.xbrl_run.name, "xbrl"), self.xbrl_run)
        self.assertEqual(self.paths.resolve_run(str(self.xbrl_run), "xbrl"), self.xbrl_run)
        self.assertEqual(self.paths.resolve_run(self.pdf_run.name, "pdf"), self.pdf_run)
        with self.assertRaisesRegex(RunNotFoundError, f"run {self.pdf_run.name} is not a xbrl run"):
            self.paths.resolve_run(self.pdf_run.name, "xbrl")
        # A folder with no run.json cannot be told by source: it stays phase 0's, and the command that reads it says so.
        self.assertEqual(self.paths.resolve_run(self.map_folder.name, "pdf"), self.map_folder)

    def test_the_settle_folder(self):
        self.assertEqual(self.paths.settle, self.paths.base / "settle")


class CommandCase(Corpus):
    def setUp(self):
        super().setUp()
        self.paths.manifest.write_text(json.dumps(self.manifest.model_dump(mode="json")), encoding="utf-8")
        for patcher in (mock.patch.dict(os.environ, {"EXTRACT_DEADLINE_SECONDS": "60"}),
                        mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_command(self, *args):
        return CliRunner().invoke(cli.app, list(args), env={"COLUMNS": "500"})

    def run_dirs(self):
        return sorted(self.paths.runs.iterdir()) if self.paths.runs.exists() else []


class XbrlReadCommandTests(CommandCase):
    def test_the_console_and_the_artefact_names_hold_no_figure(self):
        result = self.run_command("xbrl-read", "--set", "dev")
        self.assertEqual(result.exit_code, 0, result.output)
        (run_dir,) = self.run_dirs()
        self.assertTrue(run_dir.name.endswith("-xbrl"))
        self.assertIn(f"{self.q2.id}: 2/4 instance(s), ", result.output)
        self.assertIn("XBRL_FORMAT_UNMAPPED", result.output)
        self.assertIn("XBRL_UNREADABLE:DOCTYPE", result.output)
        self.assertIn(f"done: 1 filing(s) → {run_dir}", result.output)
        for text in ("1234500000", "12345", "SYNTHETIC"):
            self.assertNotIn(text, result.output)
        self.assertEqual([a.filing_id for a in read_artefacts(run_dir)], [self.q2.id])

    def test_only_and_label(self):
        result = self.run_command("xbrl-read", "--set", "all", "--gate", "--only", self.q1_wrong.id, "--label", "one")
        self.assertEqual(result.exit_code, 0, result.output)
        (run_dir,) = self.run_dirs()
        self.assertTrue(run_dir.name.endswith("-one"))
        self.assertIn(f"{self.q1_wrong.id}: 0/1 instance(s), 0 fact(s), XBRL_PAIR_PERIOD", result.output)

    def test_a_selection_with_no_pairs_is_a_message_and_makes_no_run_folder(self):
        result = self.run_command("xbrl-read", "--only", self.no_pairs.id)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("nothing to read", result.output)
        self.assertEqual(self.run_dirs(), [])

    def test_a_missing_instance_is_a_message_and_makes_no_run_folder(self):
        (self.paths.corpus / "synthetic-cements" / "xbrl" / "b.xml").unlink()
        result = self.run_command("xbrl-read", "--set", "dev")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("missing under data", result.output)
        self.assertIn("synthetic-cements/xbrl/b.xml", result.output)
        self.assertEqual(self.run_dirs(), [])

    def test_held_out_needs_the_gate(self):
        message = "held-out is read only to decide whether a change lands; pass --gate"
        for chosen in ("heldout", "all"):
            with self.subTest(chosen=chosen):
                result = self.run_command("xbrl-read", "--set", chosen)
                self.assertEqual(result.exit_code, 1, result.output)
                self.assertIn(message, result.output)
                self.assertEqual(self.run_dirs(), [])
        result = self.run_command("xbrl-read", "--set", "heldout", "--gate")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(len(self.run_dirs()), 1)

    def test_a_bad_set_is_a_message(self):
        result = self.run_command("xbrl-read", "--set", "nope")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("--set must be dev, heldout or all", result.output)


class XbrlRunIsNotAPdfRunTests(CommandCase):
    def setUp(self):
        super().setUp()
        self.assertEqual(self.run_command("xbrl-read", "--set", "dev").exit_code, 0)
        (self.xbrl_run,) = self.run_dirs()

    def test_an_xbrl_run_cannot_be_exported_or_frozen_from(self):
        for args in (["export", "--run", self.xbrl_run.name], ["freeze", self.q2.id, "--run", self.xbrl_run.name]):
            with self.subTest(command=args[0]):
                result = self.run_command(*args)
                self.assertEqual(result.exit_code, 1, result.output)
                self.assertIn(f"{self.xbrl_run.name} is an XBRL run; label the PDF run", result.output)
        self.assertFalse(self.paths.sheets.exists())
        self.assertFalse(self.paths.gold.exists())

    def test_latest_export_refuses_when_the_newest_run_is_xbrl(self):
        result = self.run_command("export")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("is an XBRL run; label the PDF run", result.output)

    def test_report_is_made_on_a_pdf_run(self):
        # An XBRL run may be named, with a PDF run beside it (Task 9); named alone, there is no PDF run to report on.
        result = self.run_command("report", "--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("name a pdf run", result.output)
        result = self.run_command("report")  # `latest` is the newest pdf run, and there is none
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("no runs under", result.output)
        self.assertIn("with source pdf", result.output)


if __name__ == "__main__":
    unittest.main()
