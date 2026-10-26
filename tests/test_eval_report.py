"""The Markdown and JSON report, with a delta against an earlier run, and the `report` command. Offline."""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from eval_fixtures import (
    FILING, RESULTS_Q2, WHEN, gold_fact, gold_of, instance_read, pdf_artefact, plain, scored_row as row, xbrl_artefact,
    xbrl_fact,
)
from test_eval_scoring_xbrl import A, B, G1, G2, G3, PDF_FACTS, STANDALONE
from test_extraction_workflow import FAST, PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.files import write_text_atomically
from maester_eval.gold import freeze_sheet, gold_of_origin, read_gold, write_gold
from maester_eval.manifest import Filing, FormatTags
from maester_eval.paths import EvalPaths
from maester_eval.report import LABELS, RATES, map_concepts, render_markdown, score_run_dir, write_report
from maester_eval.runner import run_filing
from maester_eval.scoring import OUTCOMES, score_run, score_shown, score_xbrl_run
from pdf_financial_qa.workflow.model import LocateOutput

TAXONOMY = load_taxonomy()


def another(name: str, **changes) -> Filing:
    return Filing(file=f"{name}/ar-2025-26.pdf", company=f"{name.title()} Limited", kind="annual_report",
                  period_end="2026-03-31", set="dev", **changes)


OTHER = another("other-metals")
SMALL = another("small-co", stratum="small")
SKIPPED = another("skipped-bank", out_of_scope="bank: statements not in the taxonomy yet")
NO_GOLD = another("no-gold-co")


def section(text: str, heading: str) -> str | None:
    """What stands under `## heading` up to the next `## `, or None when the report has no such section."""
    marker = f"## {heading}\n"
    if marker not in text:
        return None
    return text.split(marker, 1)[1].split("\n## ", 1)[0].strip()


def with_outcomes(score, *outcomes):
    """A copy of `score` whose one filing has a fact per outcome, so that a rate has the denominator a test needs."""
    copy = score.model_copy(deep=True)
    template = copy.filings[0].facts[0]
    copy.filings[0].facts = [template.model_copy(update={"outcome": outcome}) for outcome in outcomes]
    return copy


class ReportCase(unittest.TestCase):
    """A run of the fixture filing with two gold facts: Total assets, read right, and Inventories, which gold says is 801."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        self.run_dir = self.paths.new_run("baseline", now=datetime(2026, 10, 16, 9, 0, tzinfo=timezone.utc))
        write_run(self.run_dir, {"run": self.run_dir.name, "set": "dev", "pipeline_version": "extract-2",
                                 "prompt_version": "abc123", "model": "scripted-model", "filings": [FILING.id]})
        write_artefact(self.run_dir, run_filing(FILING, PDF, lambda: ScriptedModel(), FAST))
        gold = freeze_sheet([row(), row(row="2", label="Inventories", concept="inventories", printed="800", gold_text="801")],
                            FILING, TAXONOMY, WHEN)
        write_gold(self.paths.gold, gold)

    def read(self, filing: Filing, model=None) -> None:
        """Add the filing's artefact to the run, read by the scripted model unless `model` is given."""
        write_artefact(self.run_dir, run_filing(filing, PDF, lambda: model or ScriptedModel(), FAST))

    def freeze(self, filing: Filing) -> None:
        """Add gold for the filing: its Total assets line."""
        write_gold(self.paths.gold, freeze_sheet([row()], filing, TAXONOMY, WHEN))

    def score(self, ids=None, eval_set="dev", out_of_scope=None):
        return score_run_dir(self.run_dir, read_gold(self.paths.gold), ids or [FILING.id], eval_set, out_of_scope)


class ReportTests(ReportCase):
    def test_markdown_carries_the_summary_strata_filings_and_mismatches(self):
        score = score_run_dir(self.run_dir, read_gold(self.paths.gold), [FILING.id], "dev")
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
        score = score_run_dir(self.run_dir, read_gold(self.paths.gold), [FILING.id], "dev")
        earlier = score.model_copy(deep=True)
        earlier.filings[0].facts[1].outcome = "match"  # the earlier run had both right
        text = render_markdown(score, against=earlier, generated_at=WHEN)
        self.assertIn("## Against 20261016T090000Z-baseline", text)
        self.assertIn("| Exact match | 50.0% | 100.0% | −50.0 pp |", text)

    def test_write_report_produces_markdown_and_json(self):
        score = score_run_dir(self.run_dir, read_gold(self.paths.gold), [FILING.id], "dev")
        md, js = write_report(self.run_dir, score, generated_at=WHEN)
        self.assertEqual((md.name, js.name), ("report.md", "report.json"))
        data = json.loads(js.read_text(encoding="utf-8"))
        self.assertEqual(data["summary"]["gold_facts"], 2)
        self.assertEqual(data["score"]["filings"][0]["facts"][1]["outcome"], "wrong_value")
        self.assertEqual(data["generated_at"], WHEN.isoformat())

    def test_not_run_and_no_gold_sections(self):
        extra = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                       kind="annual_report", period_end="2026-03-31", set="dev")
        write_gold(self.paths.gold, freeze_sheet([row()], extra, load_taxonomy(), WHEN))
        score = score_run_dir(self.run_dir, read_gold(self.paths.gold), [FILING.id, extra.id], "dev")
        text = render_markdown(score, generated_at=WHEN)
        self.assertIn("## Not run\n\n- other-metals/ar-2025-26", text)

    def test_the_header_names_the_set_the_time_and_what_ran(self):
        text = render_markdown(self.score(), generated_at=WHEN)
        self.assertIn("Set `dev` · 2026-10-16 12:00 UTC · pipeline `extract-2` · prompt `abc123` · model `scripted-model`.", text)

    def test_the_header_says_unknown_for_what_the_run_did_not_record(self):
        # A run stopped before it finished has no model in its record.
        write_run(self.run_dir, {"run": self.run_dir.name, "set": "dev"})
        text = render_markdown(self.score(), generated_at=WHEN)
        self.assertIn("Set `dev` · 2026-10-16 12:00 UTC · pipeline unknown · prompt unknown · model unknown.", text)
        self.assertNotIn("None", text)

    def test_the_summary_table_has_every_measure(self):
        summary = section(render_markdown(self.score(), generated_at=WHEN), "Summary").splitlines()
        self.assertEqual(summary[:2], ["| Measure | Count | Rate |", "| --- | --- | --- |"])
        measures = [line.split(" | ")[0].removeprefix("| ") for line in summary[2:]]
        self.assertEqual(measures, [
            "Filings", "Read", "Failed", "Gold facts", "Exact match", "Wrong value", "Wrong scale", "Wrong status",
            "Ambiguous", "Missing", "Page match", "Checks passed", "Checks failed", "Checks not checked",
            "Seconds per filing, median / max", "Model calls per filing, median / max"])
        self.assertIn("| Read | 1 | 100.0% |", summary)
        self.assertIn("| Model calls per filing, median / max | 4.0 / 4 |  |", summary)  # one locate and three statements
        self.assertIn("| Page match | 2 of 2 | 100.0% |", summary)
        self.assertIn("| Checks passed | 3 | 100.0% |", summary)

    def test_every_outcome_has_a_label_and_a_row_in_the_delta(self):
        # Every outcome the PDF path gives. The three only an XBRL figure gives are not phase 0's table.
        pdf_outcomes = set(OUTCOMES) - {"match_at_precision", "match_dash_zero", "wrong_sign"}
        self.assertEqual(set(LABELS), pdf_outcomes)
        self.assertLessEqual(pdf_outcomes, {name for name, _ in RATES})

    def test_the_strata_tables_are_kind_scanned_basis_statement_and_stratum(self):
        text = render_markdown(self.score(), generated_at=WHEN)
        headings = [line for line in text.splitlines() if line.startswith("## ")]
        self.assertEqual(headings, ["## Summary", "## By kind", "## By scanned", "## By basis", "## By statement",
                                    "## By stratum", "## Filings", "## Mismatches"])
        self.assertEqual(section(text, "By kind").splitlines()[:3], [
            "| Value | Filings | Gold facts | Exact match | Missing | Page match |", "| --- | --- | --- | --- | --- | --- |",
            "| annual_report | 1 | 2 | 50.0% | 0.0% | 100.0% |"])
        # Facts, not filings, are grouped by basis and statement, so there is no count of filings to give.
        self.assertIn("| consolidated | — | 2 | 50.0% | 0.0% | 100.0% |", section(text, "By basis"))
        self.assertIn("| balance_sheet | — | 2 | 50.0% | 0.0% | 100.0% |", section(text, "By statement"))

    def test_a_stratum_has_its_own_table_and_a_last_column_in_the_filings_table(self):
        self.read(SMALL)
        self.freeze(SMALL)
        text = render_markdown(self.score([FILING.id, SMALL.id]), generated_at=WHEN)
        by_stratum = section(text, "By stratum")
        self.assertIn("| small | 1 | 1 | 100.0% | 0.0% | 100.0% |", by_stratum)
        self.assertIn("| none | 1 | 2 | 50.0% | 0.0% | 100.0% |", by_stratum)  # the fixture filing has no stratum
        filings = section(text, "Filings").splitlines()
        self.assertEqual(filings[0], "| Filing | Kind | Scanned | Outcome | Gold facts | Exact match | Seconds | Model calls "
                                     "| Size (MB) | Stratum |")
        self.assertEqual(filings[1], "| " + " | ".join(["---"] * 10) + " |")
        by_id = {line.split(" | ")[0].removeprefix("| "): line for line in filings[2:]}
        self.assertTrue(by_id["small-co/ar-2025-26"].startswith("| small-co/ar-2025-26 | annual_report | yes | complete | 1 | 1 | "), by_id)
        self.assertTrue(by_id["small-co/ar-2025-26"].endswith(" | small |"), by_id)
        self.assertTrue(by_id["synthetic-industries/ar-2025-26"].endswith(" | none |"), by_id)
        for line in filings:  # one cell per column, in every row
            self.assertEqual(line.count(" | "), 9, line)

    def test_a_filing_that_could_not_be_read_shows_its_error_code_and_each_gold_fact_as_missing(self):
        self.read(FILING, ScriptedModel(locate=[LocateOutput(statements=[])]))
        text = render_markdown(self.score(), generated_at=WHEN)
        self.assertIn("| synthetic-industries/ar-2025-26 | annual_report | yes | NO_STATEMENTS_FOUND | 2 | 0 |", text)
        self.assertIn("| Total assets | As at 31 March 2026 | missing | 2,000 | — |", text)
        self.assertIn("| Failed | 1 | 100.0% |", text)
        self.assertIn("| Page match | 0 of 0 | — |", text)  # a fact that was not found has no page to check

    def test_a_run_with_nothing_scored_has_no_strata_tables(self):
        text = render_markdown(self.score(eval_set="heldout"), generated_at=WHEN)  # the fixture filing is a dev filing
        self.assertEqual([line for line in text.splitlines() if line.startswith("## ")], ["## Summary", "## Filings", "## Mismatches"])
        self.assertEqual(section(text, "Mismatches"), "None.")

    def test_a_filing_with_no_mismatch_says_none(self):
        write_gold(self.paths.gold, freeze_sheet([row()], FILING, TAXONOMY, WHEN), force=True)  # Total assets only
        self.assertEqual(section(render_markdown(self.score(), generated_at=WHEN), "Mismatches"), "None.")

    def test_a_label_cannot_break_a_table(self):
        score = self.score()
        score.filings[0].facts[1].label = "Profit | loss\nafter tax"
        score.filings[0].facts[1].gold_printed = "8|1"
        text = render_markdown(score, generated_at=WHEN)
        self.assertIn("| Profit \\| loss after tax | As at 31 March 2026 | wrong_value | 8\\|1 | 800 |", text)
        for line in section(text, "Mismatches").splitlines():
            self.assertEqual(line.replace("\\|", "").count("|"), 9, line)

    def test_a_filing_with_neither_a_result_nor_an_error_has_a_dash_not_none(self):
        score = self.score()
        score.filings[0].extracted, score.filings[0].error_code, score.filings[0].state = False, None, None
        self.assertNotIn("None", render_markdown(score, generated_at=WHEN))

    def test_the_lists_come_in_order_not_run_no_gold_out_of_scope(self):
        self.freeze(OTHER)
        self.freeze(SKIPPED)
        self.read(NO_GOLD)
        reasons = {SKIPPED.id: SKIPPED.out_of_scope}
        score = self.score([FILING.id, OTHER.id, SKIPPED.id], out_of_scope=reasons)
        text = render_markdown(score, generated_at=WHEN, out_of_scope_reasons=reasons)
        headings = [line for line in text.splitlines() if line.startswith("## ")]
        self.assertEqual(headings[-5:], ["## Filings", "## Not run", "## No gold yet", "## Out of scope", "## Mismatches"])
        self.assertEqual(section(text, "Not run"), f"- {OTHER.id}")
        self.assertEqual(section(text, "No gold yet"), f"- {NO_GOLD.id}")


class OutOfScopeTests(ReportCase):
    def setUp(self):
        super().setUp()
        self.freeze(SKIPPED)
        self.reasons = {SKIPPED.id: SKIPPED.out_of_scope}

    def test_a_gold_filing_named_out_of_scope_is_listed_with_its_reason_and_is_not_not_run(self):
        score = self.score([FILING.id, SKIPPED.id], out_of_scope=self.reasons)
        self.assertEqual((score.not_run, score.out_of_scope), ([], [SKIPPED.id]))
        text = render_markdown(score, generated_at=WHEN, out_of_scope_reasons=self.reasons)
        self.assertIn(f"## Out of scope\n\n- {SKIPPED.id} — bank: statements not in the taxonomy yet\n", text)
        self.assertIsNone(section(text, "Not run"))
        # The same filing, not named out of scope, is not run.
        plain = self.score([FILING.id, SKIPPED.id])
        self.assertEqual(plain.not_run, [SKIPPED.id])
        self.assertIsNone(section(render_markdown(plain, generated_at=WHEN), "Out of scope"))

    def test_a_reason_the_manifest_did_not_give_leaves_the_id_alone(self):
        score = self.score([FILING.id, SKIPPED.id], out_of_scope={SKIPPED.id: ""})
        self.assertEqual(section(render_markdown(score, generated_at=WHEN, out_of_scope_reasons={SKIPPED.id: ""}),
                                 "Out of scope"), f"- {SKIPPED.id}")
        self.assertEqual(section(render_markdown(score, generated_at=WHEN), "Out of scope"), f"- {SKIPPED.id}")

    def test_the_reasons_pass_through_write_report(self):
        score = self.score([FILING.id, SKIPPED.id], out_of_scope=self.reasons)
        md, js = write_report(self.run_dir, score, generated_at=WHEN, out_of_scope_reasons=self.reasons)
        self.assertIn(f"- {SKIPPED.id} — bank: statements not in the taxonomy yet", md.read_text(encoding="utf-8"))
        self.assertEqual(json.loads(js.read_text(encoding="utf-8"))["score"]["out_of_scope"], [SKIPPED.id])


class DeltaTests(ReportCase):
    def test_a_change_is_in_percentage_points_with_its_sign(self):
        score = self.score()
        now, earlier = with_outcomes(score, "match", "match", "wrong_value"), with_outcomes(score, "match", "wrong_value", "wrong_value")
        up = render_markdown(now, against=earlier, generated_at=WHEN)
        self.assertIn("| Rate | This run | Earlier | Change |", up)
        self.assertIn("| Exact match | 66.6% | 33.3% | +33.3 pp |", up)
        self.assertIn("| Wrong value | 33.3% | 66.6% | −33.3 pp |", up)
        self.assertIn("| Missing | 0.0% | 0.0% | +0.0 pp |", up)
        down = render_markdown(earlier, against=now, generated_at=WHEN)
        self.assertIn("| Exact match | 33.3% | 66.6% | −33.3 pp |", down)

    def test_a_rate_without_a_denominator_has_no_change(self):
        score = self.score()
        text = render_markdown(score, against=with_outcomes(score), generated_at=WHEN)  # the earlier run scored no gold fact
        self.assertIn("| Exact match | 50.0% | — | — |", text)
        text = render_markdown(with_outcomes(score), against=score, generated_at=WHEN)
        self.assertIn("| Exact match | — | 50.0% | — |", text)

    def test_the_delta_table_has_a_row_for_each_rate(self):
        score = self.score()
        delta = section(render_markdown(score, against=score, generated_at=WHEN), f"Against {score.run}").splitlines()
        self.assertEqual([line.split(" | ")[0].removeprefix("| ") for line in delta[2:]], [
            "Exact match", "Wrong value", "Wrong scale", "Wrong status", "Ambiguous", "Missing", "Page match", "Checks passed",
            "Checks failed"])
        self.assertEqual(delta[2], "| Exact match | 50.0% | 50.0% | +0.0 pp |")

    def test_there_is_no_delta_without_an_earlier_run(self):
        self.assertNotIn("## Against", render_markdown(self.score(), generated_at=WHEN))


class WriteReportTests(ReportCase):
    def test_the_json_carries_the_summary_the_strata_the_score_and_the_run_it_was_set_against(self):
        score = self.score()
        _, js = write_report(self.run_dir, score, against=score, generated_at=WHEN)
        data = json.loads(js.read_text(encoding="utf-8"))
        self.assertEqual(data["against"], score.run)
        self.assertEqual(data["summary"]["match"], 1)
        self.assertEqual(data["strata"]["kind"]["annual_report"]["gold_facts"], 2)
        self.assertEqual(sorted(data["strata"]), ["basis", "kind", "scanned", "statement", "stratum"])
        self.assertEqual(data["score"]["run"], score.run)
        _, js = write_report(self.run_dir, score, generated_at=WHEN)
        self.assertIsNone(json.loads(js.read_text(encoding="utf-8"))["against"])

    def test_the_files_are_rewritten_into_the_run_folder(self):
        score = self.score()
        md, js = write_report(self.run_dir, score, generated_at=WHEN)
        self.assertEqual((md.parent, js.parent), (self.run_dir, self.run_dir))
        self.assertEqual(md.read_text(encoding="utf-8"), render_markdown(score, generated_at=WHEN))
        md.write_text("stale", encoding="utf-8")
        write_report(self.run_dir, score, generated_at=WHEN)
        self.assertEqual(md.read_text(encoding="utf-8"), render_markdown(score, generated_at=WHEN))

    def test_a_label_with_a_rupee_sign_survives_both_files(self):
        score = self.score()
        score.filings[0].facts[1].label = "Receipts (₹ crore) and café"
        md, js = write_report(self.run_dir, score, generated_at=WHEN)
        self.assertIn("Receipts (₹ crore) and café", md.read_text(encoding="utf-8"))
        self.assertEqual(json.loads(js.read_text(encoding="utf-8"))["score"]["filings"][0]["facts"][1]["label"],
                         "Receipts (₹ crore) and café")
        self.assertIn("₹", js.read_text(encoding="utf-8"))  # written as text, not as ₹

    def test_both_files_are_written_as_utf8_whatever_the_machine_default_is(self):
        # A machine whose default encoding is not UTF-8 cannot write the `·` and `—` of any report without it.
        encodings = {}

        def spy(path, text, encoding="utf-8"):
            encodings[path.name] = encoding
            return write_text_atomically(path, text, encoding)

        with mock.patch("maester_eval.report.write_text_atomically", spy):
            write_report(self.run_dir, self.score(), generated_at=WHEN)
        self.assertEqual(encodings, {"report.md": "utf-8", "report.json": "utf-8"})

    def test_the_time_is_shown_and_kept_in_utc(self):
        india = timezone(timedelta(hours=5, minutes=30))
        for moment in (datetime(2026, 10, 16, 17, 30, tzinfo=india), datetime(2026, 10, 16, 12, 0)):  # the second is naive
            with self.subTest(moment=moment):
                self.assertIn(" · 2026-10-16 12:00 UTC · ", render_markdown(self.score(), generated_at=moment))
                _, js = write_report(self.run_dir, self.score(), generated_at=moment)
                self.assertEqual(json.loads(js.read_text(encoding="utf-8"))["generated_at"], "2026-10-16T12:00:00+00:00")

    def test_the_time_is_now_when_none_is_given(self):
        before = datetime.now(timezone.utc).replace(second=0, microsecond=0)
        text = render_markdown(self.score())
        _, js = write_report(self.run_dir, self.score())
        stamp = datetime.fromisoformat(json.loads(js.read_text(encoding="utf-8"))["generated_at"])
        self.assertEqual(stamp.utcoffset(), timedelta(0))
        self.assertGreaterEqual(stamp, before)
        self.assertRegex(text, r" · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · ")


class ScoreRunDirTests(ReportCase):
    def test_a_run_is_scored_under_its_own_name_and_versions(self):
        score = self.score()
        self.assertEqual((score.run, score.pipeline_version, score.prompt_version, score.model),
                         ("20261016T090000Z-baseline", "extract-2", "abc123", "scripted-model"))
        self.assertEqual((score.eval_set, [f.filing_id for f in score.filings]), ("dev", [FILING.id]))

    def test_the_keys_of_the_out_of_scope_mapping_are_the_filings_left_out(self):
        self.assertEqual(self.score(out_of_scope=None).out_of_scope, [])
        self.assertEqual(self.score(out_of_scope={}).out_of_scope, [])
        self.assertEqual(self.score(out_of_scope={"b/x": "why", "a/y": ""}).out_of_scope, ["a/y", "b/x"])


class ReportCommandTests(ReportCase):
    """`maester-eval report` over a temporary data folder. Offline; the real .env and data/eval stay untouched."""

    def setUp(self):
        super().setUp()
        self.write_manifest(FILING)
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

    def report(self, *args):
        # A wide terminal, so Rich never wraps a path or a line the assertions look for.
        return CliRunner().invoke(cli.app, ["report", *args], env={"COLUMNS": "500"})

    def assert_refused(self, result, *messages):
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        for message in messages:
            self.assertIn(message, result.output)

    def test_scores_the_latest_run_writes_both_files_and_prints_counts_and_rates_only(self):
        result = self.report()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn(f"{self.run_dir.name} (all): 1 filing(s), 2 gold fact(s), exact match 50.0%, missing 0.0%", result.output)
        self.assertIn(f"report → {self.run_dir / 'report.md'}", result.output)
        self.assertTrue((self.run_dir / "report.md").is_file())
        self.assertTrue((self.run_dir / "report.json").is_file())
        for text in ("not run", "no gold", "out of scope", "published"):  # nothing to say, so silent
            self.assertNotIn(text, result.output)
        for text in ("Total assets", "Inventories", "2,000", "As at 31 March", "wrong_value", FILING.id):  # never a label or a figure
            self.assertNotIn(text, result.output)
        # The files are the report of the run: the same text `render_markdown` gives, and its figures are in it.
        self.assertIn("| Inventories | As at 31 March 2026 | wrong_value | 801 | 800 |", (self.run_dir / "report.md").read_text(encoding="utf-8"))

    def test_a_named_run_is_scored_and_the_set_chooses_the_filings(self):
        older = self.paths.new_run("older", now=datetime(2026, 10, 1, tzinfo=timezone.utc))
        write_run(older, {"run": older.name, "set": "dev", "pipeline_version": "extract-1", "prompt_version": "p1", "model": "m"})
        self.assertIn(f"{older.name} (all): 0 filing(s), 0 gold fact(s), exact match —, missing —", self.report("--run", older.name).output)
        self.assertTrue((older / "report.md").is_file())
        self.assertFalse((self.run_dir / "report.md").exists())
        result = self.report("--set", "heldout")  # the fixture filing is a dev filing
        self.assertIn(f"{self.run_dir.name} (heldout): 0 filing(s), 0 gold fact(s), exact match —, missing —", result.output)
        self.assertIn("Set `heldout`", (self.run_dir / "report.md").read_text(encoding="utf-8"))

    def test_against_shows_the_change_with_the_earlier_run_scored_on_the_gold_set_as_it_is(self):
        earlier = self.paths.new_run("older", now=datetime(2026, 10, 1, tzinfo=timezone.utc))  # not the latest run
        write_run(earlier, {"run": earlier.name, "set": "dev", "pipeline_version": "extract-1", "prompt_version": "p1", "model": "m"})
        write_artefact(earlier, run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST))
        result = self.report("--against", earlier.name)
        self.assertEqual(result.exit_code, 0, result.output)
        text = (self.run_dir / "report.md").read_text(encoding="utf-8")
        self.assertIn(f"## Against {earlier.name}", text)
        self.assertIn("| Exact match | 50.0% | 0.0% | +50.0 pp |", text)  # the earlier run read nothing
        self.assertIn("| Missing | 0.0% | 100.0% | −100.0 pp |", text)
        self.assertEqual(json.loads((self.run_dir / "report.json").read_text(encoding="utf-8"))["against"], earlier.name)
        self.assertFalse((earlier / "report.md").exists())  # the earlier run is read, not written

    def test_to_copies_the_markdown_and_makes_its_folder(self):
        target = Path(self.temp.name) / "docs" / "eval" / "2026-10-16-baseline.md"
        result = self.report("--to", str(target))
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(target.read_text(encoding="utf-8"), (self.run_dir / "report.md").read_text(encoding="utf-8"))
        self.assertIn(f"published → {target}", result.output)
        self.assertIn(f"report → {self.run_dir / 'report.md'}", result.output)
        self.assertFalse((Path(self.temp.name) / "docs" / "eval" / "report.json").exists())  # the Markdown only

    def test_out_of_scope_filings_are_counted_and_listed_with_their_reason(self):
        self.freeze(SKIPPED)
        self.write_manifest(FILING, SKIPPED)
        result = self.report()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("out of scope: 1", result.output)
        self.assertNotIn("not run", result.output)  # it has gold and no artefact, and is left out on purpose
        text = (self.run_dir / "report.md").read_text(encoding="utf-8")
        self.assertEqual(section(text, "Out of scope"), f"- {SKIPPED.id} — bank: statements not in the taxonomy yet")
        self.assertIsNone(section(text, "Not run"))
        self.assertNotIn(SKIPPED.id, result.output)  # counts only

    def test_out_of_scope_is_counted_for_the_set_asked_for(self):
        heldout = another("heldout-bank", out_of_scope="bank").model_copy(update={"set": "heldout"})
        self.write_manifest(FILING, heldout)
        self.assertNotIn("out of scope", self.report("--set", "dev").output)
        self.assertIn("out of scope: 1", self.report("--set", "heldout").output)
        self.assertIn("out of scope: 1", self.report().output)

    def test_a_filing_with_gold_and_no_artefact_is_counted_as_not_run(self):
        self.freeze(OTHER)
        self.write_manifest(FILING, OTHER)
        self.assertIn("not run: 1; no gold yet: 0", self.report().output)

    def test_a_filing_read_and_with_no_gold_is_counted_even_when_none_is_not_run(self):
        self.read(NO_GOLD)
        self.assertIn("not run: 0; no gold yet: 1", self.report().output)

    def test_a_bad_set_is_refused_and_writes_nothing(self):
        self.assert_refused(self.report("--set", "some"), "--set must be dev, heldout or all")
        self.assertFalse((self.run_dir / "report.md").exists())

    def test_no_run_is_a_message(self):
        empty = EvalPaths(Path(self.temp.name) / "empty")
        empty.manifest.parent.mkdir(parents=True)
        empty.manifest.write_text('{"filings": []}', encoding="utf-8")
        with mock.patch.object(cli, "DEFAULT", empty):
            self.assert_refused(self.report(), "no runs under")
        self.assert_refused(self.report("--run", "no[/b]"), "no run 'no[/b]' under")  # named as written, not read as markup

    def test_a_run_folder_with_no_record_is_a_message_and_is_not_written_into(self):
        bare = self.paths.new_run("bare", now=datetime(2026, 10, 2, tzinfo=timezone.utc))
        self.assert_refused(self.report("--run", bare.name), "run.json")
        self.assertEqual(list(bare.iterdir()), [])

    def test_a_missing_manifest_is_a_message(self):
        self.paths.manifest.unlink()
        self.assert_refused(self.report(), "no manifest at")
        self.assertFalse((self.run_dir / "report.md").exists())

    def test_an_earlier_run_that_cannot_be_read_writes_nothing(self):
        self.assert_refused(self.report("--against", "no[/b]"), "no run 'no[/b]' under")
        self.assert_refused(self.report("--against", ""), "no run '' under")  # an empty value is not "no delta"
        bare = self.paths.new_run("bare", now=datetime(2026, 10, 2, tzinfo=timezone.utc))
        self.assert_refused(self.report("--against", bare.name), "run.json")
        self.assertFalse((self.run_dir / "report.md").exists())
        self.assertFalse((self.run_dir / "report.json").exists())

    def test_a_report_that_cannot_be_written_is_a_message(self):
        (self.run_dir / "report.md").mkdir()  # a folder where the report goes
        result = self.report()
        self.assert_refused(result, f"cannot write {self.run_dir / 'report.md'}: ")
        for text in (".tmp", "Traceback", "report →"):
            self.assertNotIn(text, result.output)
        self.assertFalse((self.run_dir / "report.json").exists())

    def test_a_copy_that_cannot_be_made_is_a_message_after_the_report_is_written(self):
        result = self.report("--to", self.temp.name)  # a folder, not a file
        self.assert_refused(result, "cannot write", self.temp.name)
        self.assertIn(f"report → {self.run_dir / 'report.md'}", result.output)
        self.assertTrue((self.run_dir / "report.md").is_file())
        blocker = Path(self.temp.name) / "blocker"
        blocker.write_text("a file where a folder should be", encoding="utf-8")
        self.assert_refused(self.report("--to", str(blocker / "report.md")), "cannot write")

    def test_names_and_paths_are_printed_as_written(self):
        # Rich would read `[final]` as a style tag and drop it.
        folder = Path(self.temp.name) / "archive" / f"{self.run_dir.name}[final]"
        shutil.copytree(self.run_dir, folder)
        target = Path(self.temp.name) / "docs" / "baseline[final].md"
        result = self.report("--run", str(folder), "--to", str(target))
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn(f"{folder.name} (all):", result.output)
        self.assertIn(f"report → {folder / 'report.md'}", result.output)
        self.assertIn(f"published → {target}", result.output)

    def test_the_help_names_the_options(self):
        result = self.report("--help")
        self.assertEqual(result.exit_code, 0, result.output)
        for text in ("--run", "--set", "--against", "--to", "latest"):
            self.assertIn(text, plain(result.output))


Q2 = RESULTS_Q2.id
RESULTS_Q1 = RESULTS_Q2.model_copy(update={"file": "synthetic-cements/results-2025-06.pdf", "period_end": "2025-06-30"})
TAGS = {Q2: {"unit": "lakh", "brackets": "yes", "restated": "not tagged", "spreads": "no", "financials": "no"}}
# The one fact of results-2025-06, frozen from a settled disagreement: the June quarter's consolidated revenue.
SETTLED_Q1 = dict(period_label="Quarter ended 30.06.2025", period_end="2025-06-30", origin="settled")
NEGATIVE = dict(printed="(12,345.00)", value="-12345.00", normalized_value="-1234500000.00")


class NumbersCase(unittest.TestCase):
    """Task 8's scores, as `RunScore`s: Q2 FY26 results with three gold facts. The PDF read G1 and G3 right and G2 as
    10,500.00 lakh, so it matches 2 of 3; XBRL holds G1 and G2 and G3 is a comparative outside its slots; `shown` is
    XBRL's, own period only."""

    def setUp(self):
        self.gold = {Q2: gold_of(G1, G2, G3)}
        self.pdf_art = pdf_artefact(RESULTS_Q2, PDF_FACTS)
        self.xbrl_art = xbrl_artefact(RESULTS_Q2, [xbrl_fact(), xbrl_fact(**STANDALONE)])
        self.pdf = score_run("p", [self.pdf_art], self.gold, [Q2], "dev")
        self.xbrl = self.xbrl_score(self.xbrl_art, self.gold)
        self.shown = score_shown(self.gold, self.pdf, self.xbrl, [self.pdf_art], [self.xbrl_art])
        self.tags = TAGS

    @staticmethod
    def xbrl_score(artefact, gold, ids=(Q2,)):
        return score_xbrl_run("x", [artefact], gold, list(ids), "dev", {"map_version": "1", "parser_version": "1"}, None)

    def render(self, *others, **options):
        return render_markdown(self.pdf, others=list(others), tags=self.tags, generated_at=WHEN, **options)


class BySourceTests(NumbersCase):
    def test_by_source(self):
        md = self.render(self.xbrl, self.shown)
        self.assertIn("| pdf | 1 | 3 | 66.6% | 0 | 0 | 0 | 0.0% | — | — |", md)  # 2 of 3; 2000 // 3 = 666 tenths
        self.assertIn("| xbrl | 1 | 2 | 100.0% | 0 | 0 | 0 | 0.0% | 1 | 0 |", md)  # G3 is outside the instances' slots
        self.assertIn("| shown | 1 | 2 | 100.0% | 0 | 0 | 0 | 0.0% | 1 | 0 |", md)  # G3 is another period
        by_source = section(md, "By source").splitlines()
        self.assertEqual(by_source[0:2], [
            "| Source | Filings | Gold facts | Exact match | At precision | Dash as 0 | Wrong sign | Missing | Outside | Not placed |",
            "| " + " | ".join(["---"] * 10) + " |"])
        self.assertIn("Outside", by_source[-1])  # a line saying what Outside means, for xbrl and for shown

    def test_the_sources_are_listed_in_the_order_given(self):
        rows = [line.split(" | ")[0].removeprefix("| ") for line in section(self.render(self.xbrl, self.shown), "By source").splitlines()[2:5]]
        self.assertEqual(rows, ["pdf", "xbrl", "shown"])

    def test_not_placed_is_the_sum_of_every_filing_and_every_reason(self):
        gold = {Q2: gold_of(G1, gold_fact(period_label="Current period ended 30.09.2025", span=None), gold_fact(period_end=None))}
        xbrl = self.xbrl_score(self.xbrl_art, gold)
        self.assertIn("| xbrl | 1 | 1 | 100.0% | 0 | 0 | 0 | 0.0% | 0 | 2 |", self.render(xbrl))

    def test_sign_only_is_counted_and_listed_by_element(self):
        # One gold fact printed in brackets; the instance holds "SyntheticPayments" as a non-negative amount.
        gold = {Q2: gold_of(gold_fact(**NEGATIVE))}
        sign = self.xbrl_score(xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="SyntheticPayments")]), gold)
        md = self.render(sign)
        self.assertIn("| SyntheticPayments | 1 |", md.split("### Sign only")[1])
        self.assertIn("| xbrl | 1 | 1 | 0.0% | 0 | 0 | 1 | 0.0% |", md)

    def test_a_pdf_only_report_is_unchanged(self):
        md = render_markdown(self.pdf, generated_at=WHEN)
        for heading in ("## By source", "## By format tag", "## The element map against gold", "## Settled disagreements",
                        "## Rule versions", "## Mismatches: "):
            self.assertNotIn(heading, md)
        self.assertEqual([line for line in md.splitlines() if line.startswith("## ")][0], "## Summary")

    def test_the_mismatches_appendix_leaves_out_the_three_matches(self):
        pdf = self.pdf.model_copy(deep=True)
        template = pdf.filings[0].facts[0]
        pdf.filings[0].facts = [template.model_copy(update={"outcome": o}) for o in
                                ("match", "match_at_precision", "match_dash_zero", "wrong_sign", "missing")]
        appendix = section(render_markdown(pdf, generated_at=WHEN), "Mismatches")
        self.assertEqual(len(appendix.splitlines()), 2 + 2)  # a header, a rule and the two rows that are not matches
        self.assertIn("| wrong_sign |", appendix)
        self.assertIn("| missing |", appendix)
        self.assertNotIn("| match_at_precision |", appendix)
        self.assertNotIn("| match_dash_zero |", appendix)

    def test_a_section_for_each_other_source_against_an_earlier_run(self):
        earlier_filing = self.xbrl.filings[0].model_copy(update={"facts": self.xbrl.filings[0].facts[:1]})
        earlier = self.xbrl.model_copy(update={"run": "x-earlier", "filings": [earlier_filing]})
        md = self.render(self.xbrl, self.shown, others_against=[earlier])
        self.assertEqual(section(md, "Against x-earlier").splitlines()[0], "| Rate | This run | Earlier | Change |")
        self.assertIn("| Exact match | 100.0% | 100.0% | +0.0 pp |", section(md, "Against x-earlier"))
        self.assertEqual(md.count("## Against "), 1)  # the first score has no earlier run, and `shown` none either


def partly_used():
    """RESULTS_Q2's XBRL with its consolidated instance a.xml unreadable and its standalone b.xml used: the
    consolidated quarter slot is held by no used instance, so G1 leaves the xbrl denominator for Outside."""
    return xbrl_artefact(RESULTS_Q2, [xbrl_fact(**STANDALONE)], instances=[
        instance_read(A, used=False, reason="XBRL_UNREADABLE:MALFORMED", format=None, mapped=False, state=None),
        instance_read(B, basis="standalone", facts=1)])


class GateDenominatorTests(NumbersCase):
    """A map or reader change that moves gold facts out of the xbrl denominator shows in the --against counts, though
    the exact-match rate holds."""

    def setUp(self):
        super().setUp()
        self.now_art = partly_used()
        self.now = self.xbrl_score(self.now_art, self.gold)
        self.shown_now = score_shown(self.gold, self.pdf, self.now, [self.pdf_art], [self.now_art])
        self.before = self.xbrl.model_copy(update={"run": "x0"})
        self.shown_before = self.shown.model_copy(update={"run": "p+x0"})

    def test_the_xbrl_delta_counts_the_gold_facts_scored_outside_not_placed_and_instances_not_used(self):
        part = section(self.render(self.now, self.shown_now, others_against=[self.before, self.shown_before]), "Against x0")
        self.assertIn("| Exact match | 100.0% | 100.0% | +0.0 pp |", part)    # the rate alone would hide the change
        self.assertIn("| Count | This run | Earlier | Change |", part)
        self.assertIn("| Gold facts scored | 1 | 2 | −1 |", part)             # G2 only; G1 and G2 before
        self.assertIn("| Outside | 2 | 1 | +1 |", part)                       # G1 and the comparative G3; G3 before
        self.assertIn("| Not placed | 0 | 0 | 0 |", part)
        self.assertIn("| Filings with no used instance | 0 | 0 | 0 |", part)
        self.assertIn("| Instances not used | 1 | 0 | +1 |", part)

    def test_the_shown_delta_carries_the_xbrl_runs_instances_not_used(self):
        part = section(self.render(self.now, self.shown_now, others_against=[self.before, self.shown_before]), "Against p+x0")
        self.assertIn("| Instances not used | 1 | 0 | +1 |", part)
        self.assertIn("| Outside | 1 | 1 | 0 |", part)                        # shown's Outside is another period: G3

    def test_the_pdf_delta_is_unchanged(self):
        earlier = self.pdf.model_copy(update={"run": "p0"})
        part = section(render_markdown(self.pdf, earlier, generated_at=WHEN), "Against p0")
        self.assertNotIn("| Count |", part)

    def test_a_filing_with_one_used_and_one_unused_instance_is_named(self):
        part = section(self.render(self.now), "The element map against gold")
        self.assertIn(f"| {Q2} | a.xml | XBRL_UNREADABLE:MALFORMED |", part.split("### XBRL partly used")[1])
        self.assertTrue(part.split("### XBRL not used")[1].split("###")[0].strip().endswith("None."))

    def test_the_json_holds_the_instances_not_used(self):
        with tempfile.TemporaryDirectory() as folder:
            _, js = write_report(Path(folder), self.pdf, generated_at=WHEN, others=[self.now, self.shown_now], tags=self.tags)
            data = json.loads(js.read_text(encoding="utf-8"))
        self.assertEqual(data["map"]["partly_used"], [{"filing_id": Q2, "file": A, "reason": "XBRL_UNREADABLE:MALFORMED"}])


class PerSourceMismatchTests(NumbersCase):
    def setUp(self):
        super().setUp()
        # One gold fact printed in brackets; the instance holds it as a non-negative amount: wrong_sign for xbrl and shown.
        self.sign_gold = {Q2: gold_of(gold_fact(**NEGATIVE))}
        art = xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="SyntheticPayments")])
        self.sign = self.xbrl_score(art, self.sign_gold)
        pdf = score_run("p", [self.pdf_art], self.sign_gold, [Q2], "dev")
        self.sign_shown = score_shown(self.sign_gold, pdf, self.sign, [self.pdf_art], [art])

    def test_each_other_source_lists_its_mismatches(self):
        md = render_markdown(self.pdf, others=[self.sign, self.sign_shown], tags=self.tags, generated_at=WHEN)
        header = ("| Filing | Statement | Basis | Concept | Period | Span | Period end | Outcome | From | Element | Detail "
                  "| Gold | Read |")
        for source in ("xbrl", "shown"):
            part = section(md, f"Mismatches: {source}")
            self.assertEqual(part.splitlines()[0], header, source)
            self.assertIn(f"| {Q2} | income_statement | consolidated | revenue_from_operations | Quarter ended 30.09.2025 "
                          "| quarter | 2025-09-30 | wrong_sign | xbrl | SyntheticPayments | — | (12,345.00) | 12345.00 ₹ lakh |",
                          part, source)
        self.assertIn("## Mismatches\n", md)                                    # the PDF run's, as in phase 0

    def test_a_source_with_none_says_so(self):
        md = self.render(self.xbrl, self.shown)
        self.assertEqual(section(md, "Mismatches: xbrl"), "None.")
        self.assertEqual(section(md, "Mismatches: shown"), "None.")

    def test_the_json_holds_each_sources_mismatches_by_gold_fact(self):
        with tempfile.TemporaryDirectory() as folder:
            _, js = write_report(Path(folder), self.pdf, generated_at=WHEN, others=[self.sign, self.sign_shown], tags=self.tags)
            data = json.loads(js.read_text(encoding="utf-8"))
        expected = {"filing_id": Q2, "gold_index": 0, "concept": "revenue_from_operations", "statement": "income_statement",
                    "basis": "consolidated", "period_label": "Quarter ended 30.09.2025", "span": "quarter",
                    "period_end": "2025-09-30", "outcome": "wrong_sign", "source": "xbrl", "element": "SyntheticPayments",
                    "detail": None}
        self.assertEqual(data["sources"]["xbrl"]["mismatches"], [expected])
        self.assertEqual(data["sources"]["shown"]["mismatches"], [expected])
        # The PDF run read G2 as 10,500.00 lakh: its one mismatch, at its place in the gold file.
        self.assertEqual([(m["gold_index"], m["basis"], m["outcome"], m["source"]) for m in data["sources"]["pdf"]["mismatches"]],
                         [(1, "standalone", "wrong_value", "pdf")])


class ByFormatTagTests(NumbersCase):
    def test_by_format_tag(self):
        md = self.render(self.xbrl, self.shown, unit_checks={Q2: "agrees"})
        self.assertIn("### Unit", md)
        self.assertIn("| lakh | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | 2 of 2 (100.0%) |", md)
        self.assertIn("Unit tag against gold: 1 agree, 0 disagree, 0 mixed, 0 no monetary gold, 0 not tagged.", md)
        self.assertIn("| not tagged | 1 |", md.split("### Restated columns")[1])

    def test_the_dimensions_are_the_five_tags_in_order(self):
        part = section(self.render(self.xbrl, self.shown), "By format tag")
        self.assertEqual([line for line in part.splitlines() if line.startswith("### ")],
                         ["### Unit", "### Negatives in brackets", "### Restated columns", "### Two-page spreads",
                          "### Banks and NBFCs"])
        self.assertIn("| Value | Filings | pdf | xbrl | shown |", part)

    def test_a_filing_counts_under_every_dimension(self):
        part = section(self.render(self.xbrl, self.shown), "By format tag")
        self.assertEqual(part.count("| 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | 2 of 2 (100.0%) |"), 5)  # one row in each table

    def test_a_source_without_a_filing_of_the_value_is_a_dash(self):
        part = section(self.render(self.xbrl), "By format tag")  # no shown run
        self.assertIn("| lakh | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | — |", part)

    def test_banks_and_nbfcs_read_out_of_scope(self):
        tags = {**TAGS, "synthetic-bank/results-2025-09": {**TAGS[Q2], "financials": "yes"}}
        pdf = self.pdf.model_copy(update={"out_of_scope": ["synthetic-bank/results-2025-09"]})
        md = render_markdown(pdf, others=[self.xbrl], tags=tags, generated_at=WHEN)
        banks = md.split("### Banks and NBFCs")[1].split("\n## ")[0]
        self.assertIn("| yes | 1 | out of scope (1 filing(s)) | out of scope (1 filing(s)) | — |", banks)
        self.assertIn("| no | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | — |", banks)

    def test_a_filing_with_no_tags_is_not_tagged_in_every_dimension(self):
        md = render_markdown(self.pdf, others=[self.xbrl], tags={}, generated_at=WHEN)
        self.assertIn("| not tagged | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | — |", md.split("### Unit")[1])

    def test_unit_tags_that_disagree_with_gold_are_listed(self):
        tags = {Q2: {**TAGS[Q2], "unit": "crore"}}
        md = render_markdown(self.pdf, others=[self.xbrl], tags=tags, generated_at=WHEN, unit_checks={Q2: "disagrees"},
                             gold_units={Q2: ["lakh"]})
        self.assertIn("Unit tag against gold: 0 agree, 1 disagree, 0 mixed, 0 no monetary gold, 0 not tagged.", md)
        self.assertIn(f"- {Q2}: tagged crore, gold lakh", md)
        mixed = render_markdown(self.pdf, others=[self.xbrl], tags=TAGS, generated_at=WHEN, unit_checks={Q2: "mixed"},
                                gold_units={Q2: ["lakh", "crore"]})
        self.assertIn(f"- {Q2}: tagged lakh, gold lakh and crore", mixed)


class MapAgainstGoldTests(NumbersCase):
    def suspect(self):
        xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="SyntheticOthersIncome", concept=None, normalizedValue="1250000000")])
        gold = {Q2: gold_of(gold_fact(concept="total_income", printed="12,500.00", value="12500.00", normalized_value="1250000000.00"))}
        return self.xbrl_score(xbrl, gold)

    def test_the_map_section_names_suspects_by_element(self):
        md = self.render(self.suspect())
        self.assertIn("| Element | Its concept as read | The gold concept | Gold facts |", md)
        self.assertIn("| SyntheticOthersIncome | none | total_income | 1 |", md)

    def test_per_format_counts(self):
        part = section(self.render(self.xbrl), "The element map against gold")
        self.assertIn("| Format | Gold facts | Exact match | At precision | Dash as 0 | Wrong sign | Wrong value | Wrong scale "
                      "| Wrong status | Ambiguous | Missing |", part)
        self.assertIn("| in-capmkt/ind_as | 2 | 100.0% | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0% |", part)

    def test_concepts_no_element_gives(self):
        # `synthetic_unmapped_concept` is not an id any map holds, and `revenue_from_operations` is.
        gold = {Q2: gold_of(G1, gold_fact(concept="synthetic_unmapped_concept", label="Nothing", printed="5", value="5",
                                          normalized_value="500000.00"))}
        md = self.render(self.xbrl_score(self.xbrl_art, gold))
        part = md.split("### Concepts no element gives")[1].split("\n###")[0]
        self.assertIn("| in-capmkt/ind_as | synthetic_unmapped_concept | 1 |", part)
        self.assertNotIn("revenue_from_operations", part)

    def test_no_suspect_no_sign_only_none_says_so(self):
        part = section(self.render(self.xbrl), "The element map against gold")
        for heading in ("Map suspects", "Sign only", "Concepts no element gives", "Refilings with no order", "XBRL not used",
                        "XBRL partly used"):
            self.assertTrue(part.split(f"### {heading}")[1].split("###")[0].rstrip().endswith("None."), heading)

    def test_refilings_with_no_order_and_xbrl_not_used(self):
        xbrl = self.xbrl.model_copy(update={"pooled": {Q2: 2}, "unusable": {"synthetic-cements/results-2026-03": "format_unmapped"}})
        part = section(self.render(xbrl), "The element map against gold")
        self.assertIn(f"| {Q2} | 2 |", part.split("### Refilings with no order")[1])
        self.assertIn("| synthetic-cements/results-2026-03 | format_unmapped |", part.split("### XBRL not used")[1])

    def test_without_an_xbrl_score_there_is_no_map_section(self):
        self.assertNotIn("## The element map against gold", self.render())

    def test_map_concepts_reads_the_formats_file(self):
        concepts = map_concepts("in-capmkt/ind_as")
        self.assertIn("revenue_from_operations", concepts)
        self.assertIn("cash_at_beginning_of_period", concepts)  # from the cash balance block
        self.assertIn("cash_at_end_of_period", concepts)
        self.assertNotIn(None, concepts)
        self.assertIn("revenue_from_operations", map_concepts("in-bse-fin/ind_as"))


class SettledTests(NumbersCase):
    def setUp(self):
        super().setUp()
        both = {**self.gold, RESULTS_Q1.id: gold_of(gold_fact(**SETTLED_Q1), filing=RESULTS_Q1)}
        settled_gold = gold_of_origin(both, "settled")
        q1_art = xbrl_artefact(RESULTS_Q1, [xbrl_fact(periodLabel="Quarter ended 30.06.2025", periodEnd="2025-06-30",
                                                      periodStart="2025-04-01")])
        ids = [Q2, RESULTS_Q1.id]
        self.pdf_settled = score_run("p", [self.pdf_art], settled_gold, ids, "dev")
        self.xbrl_settled = score_xbrl_run("x", [q1_art], settled_gold, ids, "dev", {}, None)

    def test_settled_facts_are_scored_apart(self):
        md = self.render(self.xbrl, self.shown, settled=[self.pdf_settled, self.xbrl_settled])
        self.assertIn("| pdf | 1 | 3 | 66.6% | 0 | 0 | 0 | 0.0% | — | — |", md)
        after = md.split("## Settled disagreements")[1]
        self.assertIn("| pdf | 0 | 0 | — | 1 |", after)
        self.assertIn("| xbrl | 1 | 1 | 100.0% | 0 |", after)
        self.assertIn("They exist only where the model and XBRL disagreed", after)
        self.assertNotIn("results-2025-06", md.split("## Settled disagreements")[0])  # never "Not run" in the headline
        self.assertIn("| Source | Filings | Settled facts | Exact match | Not in this run |", after)

    def test_no_settled_runs_no_section(self):
        self.assertNotIn("## Settled disagreements", self.render(self.xbrl))


class WriteNumbersTests(NumbersCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def written(self, *others, **options):
        _, js = write_report(self.folder, self.pdf, generated_at=WHEN, others=list(others) or None, tags=self.tags, **options)
        return json.loads(js.read_text(encoding="utf-8"))

    def test_the_json_gains_a_section_per_source_the_tags_the_map_and_the_settled(self):
        data = self.written(self.xbrl, self.shown, unit_checks={Q2: "agrees"},
                            settled=[score_run("p", [self.pdf_art], {}, [], "dev")])
        self.assertEqual(sorted(data["sources"]), ["pdf", "shown", "xbrl"])
        self.assertEqual(data["sources"]["xbrl"]["summary"]["gold_facts"], 2)
        self.assertEqual(sorted(data["sources"]["pdf"]["strata"]), ["basis", "kind", "scanned", "statement", "stratum"])
        self.assertEqual(data["format_tags"]["unit"]["lakh"]["pdf"], {"gold_facts": 3, "match": 2})
        self.assertEqual(data["unit_tags"][Q2]["against_gold"], "agrees")
        self.assertEqual(sorted(data["map"]), ["formats", "partly_used", "pooled", "sign_only", "suspects", "unusable",
                                               "without_element"])
        self.assertEqual(sorted(data["settled"]), ["pdf"])
        self.assertEqual(sorted(data["settled"]["pdf"]), ["summary"])

    def test_a_pdf_only_json_has_no_new_section_but_always_the_rule_versions(self):
        _, js = write_report(self.folder, self.pdf, generated_at=WHEN)
        data = json.loads(js.read_text(encoding="utf-8"))
        for key in ("sources", "format_tags", "unit_tags", "map", "settled"):
            self.assertNotIn(key, data)
        self.assertEqual(data["rule_versions"], {
            "span_rule": 2, "compare_rule": 1, "concept_carry": 1, "owner_rule": 1, "source_rule": 1,
            "xbrl_parser": None, "xbrl_map": None})

    def test_the_xbrl_runs_own_versions_are_recorded_not_todays(self):
        xbrl = self.xbrl.model_copy(update={"parser_version": "7", "map_version": "9"})
        data = self.written(xbrl)
        self.assertEqual((data["rule_versions"]["xbrl_parser"], data["rule_versions"]["xbrl_map"]), ("7", "9"))
        versions = section((self.folder / "report.md").read_text(encoding="utf-8"), "Rule versions")
        for words in ("XBRL parser 7", "XBRL element map 9", "span rule 2", "compare rule 1", "concept carry rule 1",
                      "owner rule 1", "source rule 1"):
            self.assertIn(words, versions)

    def test_an_xbrl_run_that_recorded_no_version_says_unknown(self):
        md = render_markdown(self.pdf, others=[self.xbrl.model_copy(update={"parser_version": None, "map_version": None})],
                             tags=self.tags, generated_at=WHEN)
        self.assertIn("XBRL parser unknown", section(md, "Rule versions"))

    def test_the_scored_xbrl_run_carries_the_versions_its_record_names(self):
        self.assertEqual((self.xbrl.parser_version, self.xbrl.map_version), ("1", "1"))


class NumbersCommandTests(ReportCase):
    """`maester-eval report` over one pdf run, one xbrl run, their gold and a manifest, in a temporary data folder."""

    def setUp(self):
        super().setUp()
        for patcher in (mock.patch.dict(os.environ), mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)
        tagged = RESULTS_Q2.model_copy(update={"tags": FormatTags(unit="lakh", unit_from="investor")})
        self.filings = [tagged]
        self.write_manifest(tagged)
        write_gold(self.paths.gold, gold_of(G1, G2, G3))
        self.pdf_run = self.make_run("pdf1", datetime(2026, 10, 17, tzinfo=timezone.utc), pdf_artefact(RESULTS_Q2, PDF_FACTS))
        self.xbrl_run = self.make_xbrl("xbrl1", datetime(2026, 10, 17, 1, tzinfo=timezone.utc), "1")

    def write_manifest(self, *filings):
        self.paths.manifest.write_text(json.dumps({"filings": [f.model_dump(mode="json") for f in filings]}), encoding="utf-8")

    def make_run(self, label, now, artefact, **record):
        folder = self.paths.new_run(label, now=now)
        write_run(folder, {"run": folder.name, "set": "dev", "pipeline_version": "extract-2", "prompt_version": "p", "model": "m", **record})
        write_artefact(folder, artefact)
        return folder

    def make_xbrl(self, label, now, map_version, facts=None):
        artefact = xbrl_artefact(RESULTS_Q2, facts or [xbrl_fact(), xbrl_fact(**STANDALONE)])
        return self.make_run(label, now, artefact, source="xbrl", parser_version="1", map_version=map_version)

    def numbers(self, *args):
        return CliRunner().invoke(cli.app, ["report", *args], env={"COLUMNS": "500"})

    def test_the_command_takes_one_run_per_source(self):
        result = self.numbers("--run", self.pdf_run.name, "--run", self.xbrl_run.name, "--set", "dev")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("xbrl: 2 gold fact(s), exact match 100.0%", result.output)
        self.assertIn("shown: 2 gold fact(s), exact match 100.0%", result.output)
        self.assertIn(f"report → {self.pdf_run / 'report.md'}", result.output)
        for figure in ("12345", "12,345", "1234500000", "10,500"):
            self.assertNotIn(figure, result.output)
        md = (self.pdf_run / "report.md").read_text(encoding="utf-8")
        self.assertIn("| xbrl | 1 | 2 | 100.0% | 0 | 0 | 0 | 0.0% | 1 | 0 |", md)
        self.assertIn("| lakh | 1 | 2 of 3 (66.6%) | 2 of 2 (100.0%) | 2 of 2 (100.0%) |", md)
        self.assertIn("Unit tag against gold: 1 agree, 0 disagree, 0 mixed, 0 no monetary gold, 0 not tagged.", md)
        self.assertFalse((self.xbrl_run / "report.md").exists())  # the files go into the first run's folder
        data = json.loads((self.pdf_run / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(data["sources"]), ["pdf", "shown", "xbrl"])
        self.assertEqual(data["rule_versions"]["xbrl_map"], "1")

    def test_the_first_run_may_be_the_xbrl_one(self):
        result = self.numbers("--run", self.xbrl_run.name, "--run", self.pdf_run.name)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue((self.xbrl_run / "report.md").is_file())

    def test_two_runs_of_one_source_are_refused(self):
        other = self.make_run("pdf2", datetime(2026, 10, 18, tzinfo=timezone.utc), pdf_artefact(RESULTS_Q2, PDF_FACTS))
        result = self.numbers("--run", self.pdf_run.name, "--run", other.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("two pdf runs; name one run per source", result.output)
        self.assertFalse((self.pdf_run / "report.md").exists())
        result = self.numbers("--run", self.pdf_run.name, "--run", self.xbrl_run.name, "--against", self.pdf_run.name,
                              "--against", other.name)
        self.assertIn("two pdf runs; name one run per source", result.output)

    def test_a_run_list_with_no_pdf_run_is_refused(self):
        result = self.numbers("--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("name a pdf run", result.output)

    def test_against_per_source_adds_a_section_for_each(self):
        old_pdf = self.make_run("pdfold", datetime(2026, 10, 10, tzinfo=timezone.utc),
                                pdf_artefact(RESULTS_Q2, PDF_FACTS[:1] + PDF_FACTS[2:]))
        old_xbrl = self.make_xbrl("xbrlold", datetime(2026, 10, 10, 1, tzinfo=timezone.utc), "0",
                               facts=[xbrl_fact(), xbrl_fact(**{**STANDALONE, "element": "OtherIncome", "concept": "other_income"})])
        result = self.numbers("--run", self.pdf_run.name, "--run", self.xbrl_run.name, "--against", old_pdf.name,
                              "--against", old_xbrl.name)
        self.assertEqual(result.exit_code, 0, result.output)
        md = (self.pdf_run / "report.md").read_text(encoding="utf-8")
        self.assertIn(f"## Against {old_pdf.name}", md)
        self.assertIn(f"## Against {old_xbrl.name}", md)
        self.assertIn(f"## Against {old_pdf.name}+{old_xbrl.name}", md)  # the shown mix, each earlier run in place of its source
        self.assertIn("| Missing | 0.0% | 50.0% | −50.0 pp |", section(md, f"Against {old_xbrl.name}"))
        self.assertFalse((old_xbrl / "report.md").exists())
        data = json.loads((self.pdf_run / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(data["against"], old_pdf.name)

    def test_an_against_run_of_a_source_not_scored_is_refused(self):
        result = self.numbers("--against", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("no xbrl run", result.output)

    def test_a_newer_map_report_folder_is_not_the_default_pdf_run(self):
        self.paths.new_run("xbrl-map", now=datetime(2026, 10, 19, tzinfo=timezone.utc))  # no run.json, like phase 4's report folder
        result = self.numbers("--run", "latest", "--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue((self.pdf_run / "report.md").is_file())

    def test_the_default_run_is_the_latest_pdf_run_and_one_source_keeps_the_phase_0_console(self):
        result = self.numbers()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("pdf:", result.output)
        self.assertNotIn("xbrl:", result.output)
        self.assertNotIn("## By source", (self.pdf_run / "report.md").read_text(encoding="utf-8"))

    def test_settled_facts_are_scored_apart_and_said_on_the_console(self):
        write_gold(self.paths.gold, gold_of(gold_fact(**SETTLED_Q1), filing=RESULTS_Q1))
        self.write_manifest(*self.filings, RESULTS_Q1)
        # The model read the June filing too, but its only gold fact is a settled one: the headline has no gold for it.
        write_artefact(self.pdf_run, pdf_artefact(RESULTS_Q1, PDF_FACTS[:1]))
        result = self.numbers("--run", self.pdf_run.name, "--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("settled: 1 gold fact(s), scored apart", result.output)
        md = (self.pdf_run / "report.md").read_text(encoding="utf-8")
        self.assertIn("| pdf | 1 | 1 | 0.0% | 0 |", md.split("## Settled disagreements")[1])  # read, but not as the settled figure
        self.assertIn("| xbrl | 0 | 0 | — | 1 |", md.split("## Settled disagreements")[1])  # the XBRL run lacks the filing
        self.assertNotIn("## No gold yet", md)
        self.assertNotIn("no gold yet", result.output)
        self.assertNotIn("results-2025-06", md.split("## Settled disagreements")[0])
        self.assertNotIn("results-2025-06", result.output)

    def test_a_unit_tag_that_disagrees_with_gold_is_listed_with_its_ids_in_the_file_only(self):
        wrong = RESULTS_Q2.model_copy(update={"tags": FormatTags(unit="crore", unit_from="investor")})
        self.write_manifest(wrong)
        result = self.numbers("--run", self.pdf_run.name, "--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 0, result.output)
        md = (self.pdf_run / "report.md").read_text(encoding="utf-8")
        self.assertIn("0 agree, 1 disagree", md)
        self.assertIn(f"- {Q2}: tagged crore, gold lakh", md)
        self.assertNotIn(Q2, result.output)


if __name__ == "__main__":
    unittest.main()
