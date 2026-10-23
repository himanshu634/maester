"""Live mode with a scripted model: artefacts, counts, timings, failures. Offline."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import plain
from test_extraction_workflow import FAST, PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import artefact_path, read_artefacts, read_run, write_artefact
from maester_eval.manifest import Filing
from maester_eval.paths import EvalPaths
from maester_eval.runner import (
    CountingModel, EvalConfigError, claude_model_factory, pages_without_text, run_filing, run_live,
    workflow_settings_from_env,
)
from pdf_financial_qa.workflow import PIPELINE_VERSION
from pdf_financial_qa.workflow.model import LocateOutput
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

FILING = Filing(file="synthetic-industries/ar-2025-26.pdf", company="Synthetic Industries Limited",
                kind="annual_report", period_end="2026-03-31", set="dev")


class RunFilingTests(unittest.TestCase):
    def test_a_read_filing_keeps_the_wire_result_counts_and_pages(self):
        model = ScriptedModel()
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        self.assertEqual(artefact.filing_id, "synthetic-industries/ar-2025-26")
        self.assertEqual((artefact.pipeline_version, artefact.prompt_version, artefact.model),
                         (PIPELINE_VERSION, PROMPT_VERSION, "scripted-model"))
        self.assertIsNone(artefact.error)
        self.assertEqual(artefact.result["state"], "complete")  # the scanned cash flow still reads; only its text check is null
        self.assertIn("reportedLabel", artefact.result["facts"][0])  # the extractor's wire names, unchanged
        self.assertEqual(artefact.model_calls.locate, 1)
        self.assertEqual(artefact.model_calls.extract, model.count("extract"))
        self.assertEqual(artefact.pages_without_text, [3])  # page 4 of the fixture has no text layer
        self.assertEqual(artefact.bytes, len(PDF))
        self.assertGreaterEqual(artefact.seconds, 0)
        self.assertEqual((artefact.stratum, artefact.printed_pages_per_page), (None, 1))

    def test_a_failed_filing_keeps_the_code_and_no_result(self):
        model = ScriptedModel(locate=[LocateOutput(statements=[])])
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        self.assertIsNone(artefact.result)
        self.assertEqual(artefact.error.code, "NO_STATEMENTS_FOUND")
        self.assertFalse(artefact.error.retryable)
        self.assertEqual(artefact.model_calls.total, 1)
        self.assertEqual(artefact.pages_without_text, [3])  # a filing that fails after opening still lists its scans

    def test_an_unreadable_pdf_is_an_error_artefact(self):
        artefact = run_filing(FILING, b"not a pdf", lambda: ScriptedModel(), FAST)
        self.assertEqual(artefact.error.code, "UNREADABLE_PDF")
        self.assertEqual(artefact.pages_without_text, [])


class LoadOnceTests(unittest.TestCase):
    """The text layer of a 300-page report takes seconds to read; a filing is read once, inside the timed span."""

    def setUp(self):
        patcher = mock.patch.object(PdfDocument, "load", side_effect=PdfDocument.load)
        self.load = patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_read_filing_loads_its_pdf_once(self):
        run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        self.load.assert_called_once_with(PDF)

    def test_a_failed_filing_loads_its_pdf_once(self):
        run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        self.load.assert_called_once_with(PDF)

    def test_an_unreadable_filing_tries_once(self):
        run_filing(FILING, b"not a pdf", lambda: ScriptedModel(), FAST)
        self.load.assert_called_once_with(b"not a pdf")


class CountingModelTests(unittest.TestCase):
    def test_counts_each_kind_and_keeps_the_name(self):
        inner = ScriptedModel()
        counting = CountingModel(inner)
        counting.locate(PDF, 4)
        counting.extract(PDF, 1, "balance_sheet", "consolidated")
        counting.extract(PDF, 1, "income_statement", "consolidated")
        self.assertEqual(counting.name, "scripted-model")
        self.assertEqual((counting.calls.locate, counting.calls.extract, counting.calls.correct), (1, 2, 0))
        self.assertEqual(counting.calls.total, 3)


class PagesWithoutTextTests(unittest.TestCase):
    def test_lists_scanned_pages(self):
        self.assertEqual(pages_without_text(PdfDocument.load(PDF)), [3])


class RunLiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        (self.paths.corpus / "synthetic-industries").mkdir(parents=True)
        (self.paths.corpus / FILING.file).write_bytes(PDF)
        self.second = Filing(file="synthetic-industries/ar-2024-25.pdf", company="Synthetic Industries Limited",
                             kind="annual_report", period_end="2025-03-31", set="dev")
        (self.paths.corpus / self.second.file).write_bytes(b"not a pdf")
        self.log: list[str] = []

    def test_writes_an_artefact_per_filing_and_a_run_record(self):
        run_dir = self.paths.new_run("test")
        artefacts = run_live([FILING, self.second], self.paths.corpus, run_dir, lambda: ScriptedModel(), FAST,
                             eval_set="dev", log=self.log.append)
        self.assertEqual([a.filing_id for a in artefacts], [FILING.id, self.second.id])
        self.assertTrue(artefact_path(run_dir, FILING.id).is_file())
        saved = read_artefacts(run_dir)
        self.assertEqual([a.filing_id for a in saved], sorted([FILING.id, self.second.id]))
        self.assertEqual(saved[0].error.code, "UNREADABLE_PDF")  # ar-2024-25 sorts first
        record = read_run(run_dir)
        self.assertEqual(record["set"], "dev")
        self.assertEqual(record["pipeline_version"], PIPELINE_VERSION)
        self.assertEqual(record["filings"], [FILING.id, self.second.id])
        self.assertIn("finished_at", record)
        self.assertEqual(json.loads(artefact_path(run_dir, FILING.id).read_text(encoding="utf-8"))["filing_id"], FILING.id)

    def test_each_filing_is_loaded_once(self):
        with mock.patch.object(PdfDocument, "load", side_effect=PdfDocument.load) as load:
            run_live([FILING, self.second], self.paths.corpus, self.paths.new_run("test"), lambda: ScriptedModel(), FAST,
                     eval_set="dev", log=self.log.append)
        self.assertEqual(load.call_args_list, [mock.call(PDF), mock.call(b"not a pdf")])

    def test_console_lines_carry_ids_codes_and_counts_only(self):
        run_dir = self.paths.new_run("test")
        run_live([FILING, self.second], self.paths.corpus, run_dir, lambda: ScriptedModel(), FAST,
                 eval_set="dev", log=self.log.append)
        joined = "\n".join(self.log)
        self.assertIn(f"{FILING.id}: complete", joined)
        self.assertIn(f"{self.second.id}: UNREADABLE_PDF", joined)
        self.assertIn("model calls", joined)
        for text in ("Total assets", "1,200", "Revenue"):  # never a label or a figure
            self.assertNotIn(text, joined)


class ArtefactFileTests(unittest.TestCase):
    def test_artefacts_come_back_in_filing_id_order(self):
        # By id, not by path: as text `tata-steel/…` sorts before `tata/…` ("-" is below "/"); as path parts it sorts after.
        ids = ["tata/ar-2025-26", "tata-steel/ar-2025-26", "acme/ar-2025-26"]
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            read = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
            for filing_id in ids:
                write_artefact(run_dir, read.model_copy(update={"filing_id": filing_id}))
            self.assertEqual([a.filing_id for a in read_artefacts(run_dir)], sorted(ids))

    def test_copies_the_filings_stratum_and_page_spread_and_survives_a_round_trip(self):
        filing = Filing(file="nestle-india/ar-2025-26.pdf", company="Nestlé India Limited", kind="annual_report",
                        period_end="2026-03-31", set="dev", stratum="large", printed_pages_per_page=2)
        artefact = run_filing(filing, PDF, lambda: ScriptedModel(), FAST)
        self.assertEqual((artefact.stratum, artefact.printed_pages_per_page), ("large", 2))
        with tempfile.TemporaryDirectory() as temp:
            write_artefact(Path(temp), artefact)
            self.assertEqual(read_artefacts(Path(temp)), [artefact])


IN_SCOPE = FILING.model_dump(exclude_none=True)
OUT_OF_SCOPE = dict(IN_SCOPE, file="skipped-bank/ar-2025-26.pdf", company="Skipped Bank Limited", stratum="financials",
                    out_of_scope="bank: statements not in the taxonomy yet")


class LiveCommandTests(unittest.TestCase):
    """`maester-eval live` over a scripted model and a temporary data folder. Offline; the real .env is never read."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        (self.paths.corpus / "synthetic-industries").mkdir(parents=True)
        (self.paths.corpus / FILING.file).write_bytes(PDF)
        self.write_manifest(IN_SCOPE, OUT_OF_SCOPE)
        # `_main` loads the repository's real .env before every command. Nothing here may read it, reach the Anthropic API
        # or leave a variable behind for the tests that run after this one.
        for patcher in (
            mock.patch.dict(os.environ),
            mock.patch.object(cli, "load_dotenv"),
            mock.patch.object(cli, "DEFAULT", self.paths),
            mock.patch.object(cli, "claude_model_factory", return_value=lambda: ScriptedModel()),
            mock.patch.object(cli, "workflow_settings_from_env", return_value=FAST),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def write_manifest(self, *filings):
        self.paths.manifest.write_text(json.dumps({"filings": list(filings)}), encoding="utf-8")

    def live(self, *args):
        # A wide terminal, so Rich never wraps a line the assertions look for.
        return CliRunner().invoke(cli.app, ["live", *args], env={"COLUMNS": "200"})

    def test_reads_the_set_and_says_what_it_did(self):
        result = self.live("--label", "smoke")
        self.assertEqual(result.exit_code, 0, result.output)
        (run_dir,) = self.paths.runs.iterdir()
        self.assertTrue(run_dir.name.endswith("-smoke"))
        self.assertEqual([a.filing_id for a in read_artefacts(run_dir)], [FILING.id])
        for line in ("1 filing(s), set dev", f"{FILING.id}: complete", "done: 1 read, 0 failed"):
            self.assertIn(line, result.output)
        for text in ("Total assets", "1,200", "Revenue"):  # never a label or a figure
            self.assertNotIn(text, result.output)

    def test_a_filing_id_is_printed_as_written(self):
        # Rich would read `[final]` as a style tag and drop it.
        odd = dict(IN_SCOPE, file="synthetic-industries/ar[final]-2025-26.pdf")
        (self.paths.corpus / odd["file"]).write_bytes(PDF)
        self.write_manifest(odd)
        result = self.live()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("synthetic-industries/ar[final]-2025-26: complete", result.output)

    def test_counts_the_filings_left_out_as_out_of_scope(self):
        result = self.live()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("left out as out of scope: 1", result.output)

    def test_says_nothing_about_scope_when_a_filing_is_named(self):
        result = self.live("--only", FILING.id)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("left out", result.output)

    def test_says_nothing_about_scope_when_none_is_left_out(self):
        self.write_manifest(IN_SCOPE)
        result = self.live()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertNotIn("left out", result.output)

    def test_a_set_of_only_out_of_scope_filings_says_why_it_is_empty(self):
        self.write_manifest(OUT_OF_SCOPE)
        result = self.live()
        self.assertEqual(result.exit_code, 1)
        self.assertLess(result.output.index("left out as out of scope: 1"), result.output.index("nothing to read"))
        self.assertFalse(self.paths.runs.exists())

    def test_a_bad_label_is_a_message_not_a_traceback(self):
        result = self.live("--label", "no[/b]")
        self.assertEqual(result.exit_code, 1)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        self.assertIn("run label 'no[/b]': use letters, digits, dot, dash or underscore", result.output)
        self.assertFalse(self.paths.runs.exists())

    def test_the_label_help_names_the_alphabet(self):
        result = CliRunner().invoke(cli.app, ["live", "--help"], env={"COLUMNS": "200"})
        self.assertEqual(result.exit_code, 0, result.output)
        for text in ("--set", "--only", "--label", "letters, digits, dot, dash or underscore"):
            self.assertIn(text, plain(result.output))


class EnvConfigTests(unittest.TestCase):
    """The model and the settings come from the extractor's variables, with the extractor's defaults."""

    def test_a_missing_api_key_is_a_config_error(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(EvalConfigError, "ANTHROPIC_API_KEY is not set"):
                claude_model_factory()

    def test_one_model_is_built_with_the_defaults(self):
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "a-key"}, clear=True), \
                mock.patch("pdf_financial_qa.workflow.model.ClaudeExtractionModel") as claude:
            factory = claude_model_factory()
            self.assertIs(factory(), factory())
            self.assertEqual(workflow_settings_from_env().deadline_seconds, 840)
        claude.assert_called_once_with(model="claude-opus-5-5", effort="high")

    def test_the_variables_override_the_defaults(self):
        env = {"ANTHROPIC_API_KEY": "a-key", "EXTRACTOR_MODEL": "claude-x", "EXTRACTOR_EFFORT": "medium",
               "EXTRACT_DEADLINE_SECONDS": "30"}
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("pdf_financial_qa.workflow.model.ClaudeExtractionModel") as claude:
            claude_model_factory()
            self.assertEqual(workflow_settings_from_env().deadline_seconds, 30)
        claude.assert_called_once_with(model="claude-x", effort="medium")

if __name__ == "__main__":
    unittest.main()
