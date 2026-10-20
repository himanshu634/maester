"""The Markdown and JSON report, with a delta against an earlier run, and the `report` command. Offline."""

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from eval_fixtures import FILING, WHEN, plain, scored_row as row
from test_extraction_workflow import FAST, PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import write_artefact, write_run
from maester_eval.concepts import load_taxonomy
from maester_eval.files import write_text_atomically
from maester_eval.gold import freeze_sheet, read_gold, write_gold
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.report import LABELS, RATES, render_markdown, score_run_dir, write_report
from maester_eval.runner import run_filing
from maester_eval.scoring import OUTCOMES
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
        self.assertEqual(set(LABELS), set(OUTCOMES))
        self.assertLessEqual(set(OUTCOMES), {name for name, _ in RATES})

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


if __name__ == "__main__":
    unittest.main()
