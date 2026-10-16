"""The evaluation harness's command line. Offline."""

import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import sysconfig
import tempfile
import unittest
from unittest import mock

from eval_fixtures import FILING
from test_extraction_workflow import PDF, ScriptedModel
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.cli import app
from maester_eval.paths import EvalPaths


class HelpTests(unittest.TestCase):
    def test_help_names_the_harness(self):
        response = CliRunner().invoke(app, ["--help"])
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("evaluation harness", response.output)

    def test_help_lists_the_four_commands(self):
        response = CliRunner().invoke(app, ["--help"])
        for command in ("live", "export", "freeze", "report"):
            self.assertIn(command, response.output)


class EntryPointTests(unittest.TestCase):
    """The harness starts the way a person starts it: as the installed script, and as `python -m maester_eval`."""

    def run_help(self, command):
        # A wide terminal, so Rich never wraps the words the assertions look for.
        return subprocess.run(command, capture_output=True, text=True, timeout=20, env={**os.environ, "COLUMNS": "200"})

    def test_the_installed_script_runs(self):
        script = Path(sysconfig.get_path("scripts")) / "maester-eval"
        completed = self.run_help([str(script), "--help"])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("evaluation harness", completed.stdout)

    def test_module_entry_point(self):
        completed = self.run_help([sys.executable, "-m", "maester_eval", "--help"])
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("evaluation harness", completed.stdout)


class SourceTests(unittest.TestCase):
    def test_the_imports_are_one_block_at_the_top(self):
        tree = ast.parse(Path(cli.__file__).read_text(encoding="utf-8"))
        # The module docstring is no code. Everything else is an import or code.
        kinds = ["import" if isinstance(node, (ast.Import, ast.ImportFrom)) else "code" for node in tree.body
                 if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant))]
        self.assertIn("code", kinds)
        self.assertNotIn("import", kinds[kinds.index("code"):], "an import below the first line of code")


class CommandCase(unittest.TestCase):
    """The commands over a temporary data folder, a scripted model and no .env. Offline."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # The brackets: Rich would read `[final]` as a style tag and drop it from a line that is not printed as written.
        self.paths = EvalPaths(Path(self.temp.name) / "data[final]")
        (self.paths.corpus / "synthetic-industries").mkdir(parents=True)
        (self.paths.corpus / FILING.file).write_bytes(PDF)
        self.paths.manifest.write_text(json.dumps({"filings": [FILING.model_dump(mode="json")]}), encoding="utf-8")
        # `_main` loads the repository's real .env before every command, and DEFAULT is the real data/eval. Nothing
        # here may read the one, write into the other, reach Vertex AI or leave a variable behind for the tests after this one.
        for patcher in (
            mock.patch.dict(os.environ, {"EXTRACT_DEADLINE_SECONDS": "60"}),
            mock.patch.object(cli, "load_dotenv"),
            mock.patch.object(cli, "DEFAULT", self.paths),
            mock.patch.object(cli, "gemini_model_factory", return_value=lambda: ScriptedModel()),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_command(self, *args, **env):
        # A wide terminal, so Rich never wraps a line the assertions look for.
        return CliRunner().invoke(cli.app, list(args), env={"COLUMNS": "500", **env})

    def assert_refused(self, result, *messages):
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)  # a crash would leave the exception itself here
        for message in messages:
            self.assertIn(message, result.output)


class LiveTests(CommandCase):
    def test_a_bad_deadline_is_a_message_and_leaves_no_run_folder(self):
        result = self.run_command("live", EXTRACT_DEADLINE_SECONDS="abc")
        self.assert_refused(result, "EXTRACT_DEADLINE_SECONDS: could not convert string to float: 'abc'")
        self.assertFalse(self.paths.runs.exists())

    def test_the_finished_line_names_the_run_folder_as_written(self):
        result = self.run_command("live")
        self.assertEqual(result.exit_code, 0, result.output)
        (run_dir,) = self.paths.runs.iterdir()
        self.assertIn(f"done: 1 read, 0 failed → {run_dir}", result.output)
        self.assertIn("data[final]", result.output)

    def test_a_path_longer_than_the_terminal_stays_on_one_line(self):
        # `live` in the background has no terminal to give a width; a path cut in two cannot be copied back.
        result = self.run_command("live", COLUMNS="40")
        self.assertEqual(result.exit_code, 0, result.output)
        (run_dir,) = self.paths.runs.iterdir()
        self.assertGreater(len(str(run_dir)), 40)
        self.assertIn(f"done: 1 read, 0 failed → {run_dir}", result.output)


class ExportTests(CommandCase):
    def test_a_run_with_no_artefacts_is_a_message_and_writes_nothing(self):
        self.paths.new_run("empty")
        self.assert_refused(self.run_command("export"), "no artefacts in this run")
        self.assert_refused(self.run_command("export", "--only", "someone/else"), "no artefacts in this run")
        self.assertFalse(self.paths.sheets.exists())


if __name__ == "__main__":
    unittest.main()
