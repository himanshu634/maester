# tests/test_eval_cli.py
"""The evaluation harness's command line. Offline."""

import unittest

from typer.testing import CliRunner

from maester_eval.cli import app


class HelpTests(unittest.TestCase):
    def test_help_names_the_harness(self):
        response = CliRunner().invoke(app, ["--help"])
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("evaluation harness", response.output)


if __name__ == "__main__":
    unittest.main()
