"""`maester-eval settle`: the investor's settled disagreements join the filing's gold file, never replacing a gold fact.
Offline. The fixture is compare's: the model read the standalone revenue as 10,500.00 lakh, XBRL holds 10,000.00, and the
investor settles it at 10,000.00 (scale 100000, so 1000000000.00)."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import RESULTS_Q2, gold_fact, gold_of, pdf_artefact, plain, xbrl_artefact
from test_eval_compare import HELD_OUT, PDF_FACTS, Q2_PAIRED, XBRL_FACTS, label
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import SettledRecord, freeze_sheet, gold_path, read_gold, read_sheet, write_gold
from maester_eval.paths import EvalPaths
from maester_eval.settle import SettleError, merge_gold
from maester_eval.sheets import sheet_path, sheet_rows, write_sheet
from maester_eval.compare import SETTLE_COLUMNS

TAXONOMY = load_taxonomy()
WHEN = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
STANDALONE = dict(basis="standalone", printed="10,500.00", value="10500.00", normalized_value="1050000000.00")
# The settled standalone revenue: 10,000.00 lakh, as the investor typed it in `gold_text`.
SETTLED_STANDALONE = dict(basis="standalone", printed="10,000.00", value="10000.00", normalized_value="1000000000.00")


def record(**values):
    base = dict(pdf_run="p", xbrl_run="x", map_version="map-3", compare_rule=1, settled_at=WHEN.isoformat(), facts=0)
    base.update(values)
    return SettledRecord(**base)


def settle_row(**values):
    """The settle sheet's row 2 as compare writes it for the standalone revenue, after the investor settled it."""
    pdf = pdf_artefact(RESULTS_Q2, PDF_FACTS)
    base = {column: "" for column in SETTLE_COLUMNS}
    base.update(sheet_rows(pdf)[1], concept="revenue_from_operations", concept_from="own", xbrl_element="RevenueFromOperations",
                xbrl_value="10000.00", xbrl_unit="₹ lakh", xbrl_normalized="1000000000", outcome="disagree_value",
                xbrl_run="x", map_version="map-3", gold_text="10,000.00", verified="yes")
    base.update(values)
    return base


class MergeTests(unittest.TestCase):
    def setUp(self):
        self.pdf = pdf_artefact(RESULTS_Q2, PDF_FACTS)
        self.rows = [settle_row()]
        self.existing = gold_of(gold_fact())     # G1: the consolidated revenue, from a sheet
        self.record = record()

    def settled(self, **values):
        return freeze_sheet([settle_row(**values)], RESULTS_Q2, TAXONOMY, WHEN, None, self.pdf)

    def test_settled_facts_join_the_gold_file(self):
        gold, skipped = merge_gold(self.existing, freeze_sheet(self.rows, RESULTS_Q2, TAXONOMY, WHEN, None, self.pdf), self.record)
        self.assertEqual([(f.concept, f.basis, f.normalized_value, f.span, f.origin) for f in gold.facts],
                         [("revenue_from_operations", "consolidated", "1234500000.00", "quarter", "sheet"),
                          ("revenue_from_operations", "standalone", "1000000000.00", "quarter", "settled")])
        # 10,000.00 x 100000 is worked out by hand: one thousand million rupees.
        self.assertEqual((skipped, gold.settled[0].facts, gold.settled[0].pdf_run), (0, 1, "p"))
        # The file's own record of how it was frozen stays, and the existing file is not changed in place.
        self.assertEqual((gold.frozen_at, len(self.existing.facts), self.existing.settled), (self.existing.frozen_at, 1, []))

    def test_with_no_gold_file_the_settled_facts_are_the_file(self):
        gold, skipped = merge_gold(None, self.settled(), self.record)
        self.assertEqual([(f.basis, f.origin) for f in gold.facts], [("standalone", "settled")])
        self.assertEqual((skipped, gold.filing_id, gold.expected_checks, [r.facts for r in gold.settled]),
                         (0, RESULTS_Q2.id, [], [1]))

    def test_a_settled_cell_never_replaces_gold(self):
        taken = gold_of(gold_fact(), gold_fact(**STANDALONE, section="Income", label="Revenue from operations"))
        with self.assertRaises(SettleError) as raised:
            merge_gold(taken, self.settled(), self.record)
        message = str(raised.exception)
        self.assertIn("revenue_from_operations", message)
        self.assertIn("standalone", message)
        self.assertIn("2025-09-30", message)
        for figure in ("10,000", "10,500", "1000000000", "1050000000"):
            self.assertNotIn(figure, message)
        same = gold_of(gold_fact(), gold_fact(**SETTLED_STANDALONE))
        gold, skipped = merge_gold(same, self.settled(), self.record)
        self.assertEqual((skipped, len(gold.facts), gold.settled), (1, 2, []))

    def test_a_cell_is_in_gold_by_either_key(self):
        # The same concept, basis, span and period end under another period label is the same cell.
        other_words = gold_of(gold_fact(), gold_fact(**SETTLED_STANDALONE, period_label="Three months ended 30 Sep 2025"))
        _, skipped = merge_gold(other_words, self.settled(), self.record)
        self.assertEqual(skipped, 1)
        # A figure written with one zero fewer is the same figure, as a Decimal.
        zeros = gold_of(gold_fact(), gold_fact(**{**SETTLED_STANDALONE, "normalized_value": "1000000000.0"}))
        self.assertEqual(merge_gold(zeros, self.settled(), self.record)[1], 1)

    def test_a_dash_in_gold_is_another_figure(self):
        dash = gold_fact(basis="standalone", printed="-", value_status="dash", value=None, scale=None, normalized_value=None)
        with self.assertRaises(SettleError):
            merge_gold(gold_of(gold_fact(), dash), self.settled(), self.record)


class SettleCommandTests(unittest.TestCase):
    """`maester-eval settle` and `freeze --force` over a data folder in which `compare` has run."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        for patcher in (mock.patch.dict(os.environ), mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.paths.manifest.write_text(json.dumps({"filings": [f.model_dump(mode="json") for f in (Q2_PAIRED, HELD_OUT)]}),
                                       encoding="utf-8")
        write_sheet(sheet_path(self.paths.sheets, RESULTS_Q2.id), [label()])
        self.pdf = pdf_artefact(RESULTS_Q2, PDF_FACTS)
        self.pdf_run = self.make_run("pdf1", datetime(2026, 10, 20, tzinfo=timezone.utc), [self.pdf])
        self.xbrl_run = self.make_run("xbrl1", datetime(2026, 10, 20, 1, tzinfo=timezone.utc), [xbrl_artefact(RESULTS_Q2, XBRL_FACTS)],
                                      source="xbrl", parser_version="xbrl-parser-1", map_version="map-3")
        self.compare = self.invoke("compare", "--run", self.pdf_run.name, "--xbrl", self.xbrl_run.name)
        self.assertEqual(self.compare.exit_code, 0, self.compare.output)
        self.settle_sheet = self.paths.settle / f"{RESULTS_Q2.id}.csv"
        self.gold = gold_path(self.paths.gold, RESULTS_Q2.id)

    def make_run(self, label_word, now, artefacts, **record_):
        folder = self.paths.new_run(label_word, now=now)
        write_run(folder, {"run": folder.name, "set": "dev", **record_})
        for artefact in artefacts:
            write_artefact(folder, artefact)
        return folder

    def invoke(self, *args):
        return CliRunner().invoke(cli.app, list(args), env={"COLUMNS": "500"})

    def settle_it(self, **values):
        """The investor settles row 2 of the settle sheet at 10,000.00."""
        rows = [{**r, "gold_text": "10,000.00", "verified": "yes", **values} for r in read_sheet(self.settle_sheet)]
        write_sheet(self.settle_sheet, rows, columns=SETTLE_COLUMNS)

    def settle(self, *extra):
        return self.invoke("settle", RESULTS_Q2.id, "--run", self.pdf_run.name, *extra)

    def test_the_command_prints_counts_only(self):
        self.settle_it()
        result = self.settle()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("settled 1 fact(s) into gold/synthetic-cements/results-2025-09.json; 0 already in gold", plain(result.output))
        for text in ("10,000.00", "10000.00", "1000000000", "10,500", "Revenue from operations"):
            self.assertNotIn(text, result.output)
        (gold,) = read_gold(self.paths.gold).values()
        (fact,) = gold.facts
        self.assertEqual((fact.origin, fact.basis, fact.normalized_value, fact.span, fact.period_end, fact.page_index),
                         ("settled", "standalone", "1000000000.00", "quarter", "2025-09-30", 1))
        self.assertEqual((gold.settled[0].pdf_run, gold.settled[0].xbrl_run, gold.settled[0].map_version,
                          gold.settled[0].compare_rule, gold.settled[0].facts),
                         (self.pdf_run.name, self.xbrl_run.name, "map-3", 1, 1))
        self.assertEqual(gold.exported_from["run"], self.pdf_run.name)

    def test_a_second_call_adds_nothing(self):
        self.settle_it()
        self.assertEqual(self.settle().exit_code, 0)
        first = self.gold.read_text(encoding="utf-8")
        result = self.settle()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("settled 0 fact(s) into gold/synthetic-cements/results-2025-09.json; 1 already in gold", plain(result.output))
        self.assertEqual(self.gold.read_text(encoding="utf-8"), first)

    def test_a_settled_cell_that_differs_from_gold_writes_nothing(self):
        write_gold(self.paths.gold, gold_of(gold_fact(), gold_fact(**STANDALONE)))
        before = self.gold.read_text(encoding="utf-8")
        self.settle_it()
        result = self.settle()
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("standalone", result.output)
        self.assertEqual(self.gold.read_text(encoding="utf-8"), before)

    def test_held_out_gold_is_sealed(self):
        write_sheet(sheet_path(self.paths.settle, HELD_OUT.id), [settle_row(basis="consolidated")], columns=SETTLE_COLUMNS)
        result = self.invoke("settle", HELD_OUT.id, "--run", self.pdf_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("held-out gold is sealed", result.output)
        self.assertFalse(gold_path(self.paths.gold, HELD_OUT.id).exists())

    def test_a_run_without_compare_is_refused(self):
        other = self.make_run("pdf2", datetime(2026, 10, 22, tzinfo=timezone.utc), [self.pdf])
        self.settle_it()
        result = self.invoke("settle", RESULTS_Q2.id, "--run", other.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn(f"{other.name} has no compare-xbrl.json; run compare first", plain(result.output))
        self.assertFalse(self.gold.exists())

    def test_a_sheet_another_compare_wrote_is_refused(self):
        # The sheet was written from xbrl1 under map-3. A later compare against xbrl2 (map-4) keeps the sheet a person
        # is settling and rewrites compare-xbrl.json: settle must not stamp the sheet's rows with xbrl2.
        self.settle_it()
        newer = self.make_run("xbrl2", datetime(2026, 10, 20, 2, tzinfo=timezone.utc), [xbrl_artefact(RESULTS_Q2, XBRL_FACTS)],
                              source="xbrl", parser_version="xbrl-parser-1", map_version="map-4")
        self.assertEqual(self.invoke("compare", "--run", self.pdf_run.name, "--xbrl", newer.name).exit_code, 0)
        result = self.settle()
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn(f"the settle sheet is from XBRL run {self.xbrl_run.name} with map map-3, but "
                      f"{self.pdf_run.name}/compare-xbrl.json is from XBRL run {newer.name} with map map-4; "
                      "settle against the compare that wrote the sheet", " ".join(plain(result.output).split()))
        for text in ("10,000.00", "10000.00", "1000000000", "10,500"):
            self.assertNotIn(text, result.output)
        self.assertFalse(self.gold.exists())

    def test_a_sheet_with_no_provenance_is_refused(self):
        columns = [c for c in SETTLE_COLUMNS if c not in ("xbrl_run", "map_version")]
        rows = [{**{c: r.get(c, "") for c in columns}, "gold_text": "10,000.00", "verified": "yes"}
                for r in read_sheet(self.settle_sheet)]
        write_sheet(self.settle_sheet, rows, columns=columns)
        result = self.settle()
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("the settle sheet is from XBRL run none with map none", " ".join(plain(result.output).split()))
        self.assertFalse(self.gold.exists())

    def test_a_filing_the_compare_did_not_compare_is_refused(self):
        self.settle_it()
        compared = self.pdf_run / "compare-xbrl.json"
        data = json.loads(compared.read_text(encoding="utf-8"))
        for change in (lambda d: d["filings"][0].update(compared=False, reason="no_concepts"), lambda d: d["filings"].clear()):
            with self.subTest():
                copy = json.loads(json.dumps(data))
                change(copy)
                compared.write_text(json.dumps(copy), encoding="utf-8")
                result = self.settle()
                self.assertEqual(result.exit_code, 1, result.output)
                self.assertIn(f"{self.pdf_run.name}/compare-xbrl.json did not compare {RESULTS_Q2.id}; run compare first",
                              " ".join(plain(result.output).split()))
                self.assertFalse(self.gold.exists())

    def test_a_filing_not_in_the_manifest_and_a_missing_sheet_are_refused(self):
        result = self.invoke("settle", "nobody/results-2025-09", "--run", self.pdf_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.settle_sheet.unlink()
        result = self.settle()
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("no settle sheet", result.output)

    def test_an_xbrl_run_is_not_a_pdf_run(self):
        result = self.invoke("settle", RESULTS_Q2.id, "--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 1, result.output)

    def freeze_sheet_of(self, *standalone_verified):
        """The labelling sheet: row 1 the consolidated revenue, verified; row 2 the standalone, verified when asked."""
        rows = [{**sheet_rows(self.pdf)[0], "concept": "revenue_from_operations", "verified": "yes"},
                {**sheet_rows(self.pdf)[1], "concept": "revenue_from_operations", "verified": "yes" if standalone_verified else ""}]
        write_sheet(sheet_path(self.paths.sheets, RESULTS_Q2.id), rows)

    def test_freeze_force_keeps_settled_facts_and_refuses_a_clash(self):
        self.settle_it()
        self.assertEqual(self.settle().exit_code, 0)
        gold = read_gold(self.paths.gold)[RESULTS_Q2.id]
        write_gold(self.paths.gold, gold.model_copy(update={"facts": [gold_fact(), *gold.facts]}), force=True)
        self.freeze_sheet_of()
        result = self.invoke("freeze", RESULTS_Q2.id, "--run", self.pdf_run.name, "--force")
        self.assertEqual(result.exit_code, 0, result.output)
        kept = read_gold(self.paths.gold)[RESULTS_Q2.id]
        self.assertEqual([(f.basis, f.origin) for f in kept.facts], [("consolidated", "sheet"), ("standalone", "settled")])
        self.assertEqual([(r.pdf_run, r.facts) for r in kept.settled], [(self.pdf_run.name, 1)])
        # A sheet that also verifies the standalone revenue clashes with the settled one, and the file stays.
        before = self.gold.read_text(encoding="utf-8")
        self.freeze_sheet_of(True)
        result = self.invoke("freeze", RESULTS_Q2.id, "--run", self.pdf_run.name, "--force")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("sheet row 3: gold already has revenue_from_operations for standalone 2025-09-30 from a settled disagreement",
                      plain(result.output))
        self.assertEqual(self.gold.read_text(encoding="utf-8"), before)


if __name__ == "__main__":
    unittest.main()
