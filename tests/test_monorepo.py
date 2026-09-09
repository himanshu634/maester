"""Offline behavior checks for the CLI/engine split; never call cloud services."""

from importlib.metadata import distribution
from pathlib import Path
import subprocess
import sys
import sysconfig
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from typer.testing import CliRunner

from maester_cli.cli import app
from pdf_financial_qa.config import MAX_INLINE_PDF_BYTES, Settings
from pdf_financial_qa.extraction import _build_pdf_part, extract
from pdf_financial_qa.qa import ask
from pdf_financial_qa.schema import (
    ExtractionResult, FinancialStatement, GeminiExtractionOutput, LineItem,
    PeriodValue, StatementSection,
)
from pdf_financial_qa import storage
from pdf_financial_qa.validation import validate_statement


def statement(asset_value: float = 150) -> FinancialStatement:
    return FinancialStatement(
        company_name="Synthetic Company", currency="INR", units="millions",
        scale_factor=1_000_000, periods=["FY2026"],
        sections=[StatementSection(name="Balance sheet", line_items=[
            LineItem(label="Total Assets", is_subtotal=True,
                     values=[PeriodValue(period="FY2026", value=asset_value)]),
            LineItem(label="Total Liabilities", is_subtotal=True,
                     values=[PeriodValue(period="FY2026", value=100)]),
            LineItem(label="Total Equity", is_subtotal=True,
                     values=[PeriodValue(period="FY2026", value=50)]),
        ])],
    )


def result(pdf_hash: str = "synthetic") -> ExtractionResult:
    return ExtractionResult(source_pdf_hash=pdf_hash, source_pdf_name="synthetic.pdf",
                            statement=statement(), full_text="Synthetic source text")


class PackageTests(unittest.TestCase):
    def test_cli_distribution_depends_on_engine(self):
        requirements = distribution("maester-cli").requires
        self.assertTrue(any(r.startswith("maester-financial-engine") for r in requirements))

    def test_both_installed_console_commands_work(self):
        scripts = Path(sysconfig.get_path("scripts"))
        for command in ("maester", "pdf-financial-qa"):
            with self.subTest(command=command):
                completed = subprocess.run([str(scripts / command), "--help"],
                                           capture_output=True, text=True, timeout=20)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                for subcommand in ("ingest", "ask", "list-docs"):
                    self.assertIn(subcommand, completed.stdout)

    def test_module_entry_point(self):
        completed = subprocess.run([sys.executable, "-m", "maester_cli", "--help"],
                                   capture_output=True, text=True, timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("Maester", completed.stdout)


class LocalWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache_patch = patch.object(storage, "CACHE_DIR", self.temp.name)
        self.cache_patch.start()
        self.addCleanup(self.cache_patch.stop)
        self.runner = CliRunner()

    def test_cache_round_trip_retains_legacy_shape(self):
        expected = result()
        path = storage.save(expected)
        self.assertEqual(path.name, "synthetic.json")
        self.assertEqual(storage.load("synthetic"), expected)
        self.assertEqual(storage.list_cached(), [expected])
        self.assertIsNone(storage.load("missing"))

    def test_legacy_json_without_optional_warnings_is_readable(self):
        legacy = '{"source_pdf_hash":"old","source_pdf_name":"old.pdf",' \
                 '"statement":{"sections":[]},"full_text":"old text"}'
        parsed = ExtractionResult.model_validate_json(legacy)
        self.assertEqual(parsed.validation_warnings, [])
        self.assertEqual(storage.load(storage.save(parsed).stem), parsed)

    def test_list_docs_needs_no_cloud_settings(self):
        with patch("maester_cli.cli.Settings.load", side_effect=AssertionError("cloud settings loaded")):
            response = self.runner.invoke(app, ["list-docs"])
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("No documents ingested", response.output)

    def test_missing_file_is_reported_before_settings(self):
        response = self.runner.invoke(app, ["ingest", str(Path(self.temp.name) / "absent.pdf")])
        self.assertEqual(response.exit_code, 1)
        self.assertIn("No such file", response.output)

    def test_ingest_reuses_existing_cache(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
            cached = result(storage.hash_pdf(b""))
            storage.save(cached)
            with patch("maester_cli.cli._load_settings", return_value=Settings("test", "test", "test")), \
                 patch("maester_cli.cli.extract") as model_extract:
                response = self.runner.invoke(app, ["ingest", pdf.name])
            self.assertEqual(response.exit_code, 0, response.output)
            self.assertIn("Already ingested", response.output)
            model_extract.assert_not_called()

    def test_ask_requires_document_selection_for_multiple_documents(self):
        storage.save(result("first"))
        storage.save(result("second"))
        with patch("maester_cli.cli._load_settings", return_value=Settings("test", "test", "test")), \
             patch("maester_cli.cli.ask_question") as model_ask:
            response = self.runner.invoke(app, ["ask", "What changed?"])
        self.assertEqual(response.exit_code, 1)
        self.assertIn("Multiple documents", response.output)
        model_ask.assert_not_called()


class EngineTests(unittest.TestCase):
    def test_balanced_statement_has_no_identity_warning(self):
        self.assertEqual(validate_statement(statement()), [])

    def test_unbalanced_statement_reports_identity(self):
        warnings = validate_statement(statement(200))
        self.assertTrue(any("Balance sheet identity fails" in warning for warning in warnings))

    def test_bad_subtotal_with_negative_component_is_reported(self):
        document = FinancialStatement(sections=[StatementSection(name="Cash flow", line_items=[
            LineItem(label="Cash in", values=[PeriodValue(period="FY2026", value=100)]),
            LineItem(label="Cash out", values=[PeriodValue(period="FY2026", value=-40)]),
            LineItem(label="Net", values=[PeriodValue(period="FY2026", value=90)],
                     is_subtotal=True, component_labels=["Cash in", "Cash out"]),
        ])])
        self.assertTrue(any("components sum to 60" in w for w in validate_statement(document)))

    def test_local_pdf_limit_remains_enforced(self):
        with self.assertRaisesRegex(ValueError, "over the"):
            _build_pdf_part(b"x" * (MAX_INLINE_PDF_BYTES + 1))

    def test_extraction_composes_sdk_and_shared_validation_offline(self):
        parsed = GeminiExtractionOutput(statement=statement(200), full_text="Synthetic")
        with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf, \
             patch("pdf_financial_qa.extraction.genai.Client") as client:
            client.return_value.models.generate_content.return_value = SimpleNamespace(parsed=parsed)
            extracted = extract(Path(pdf.name), Settings("test", "test", "fake-model"))
        self.assertEqual(extracted.source_pdf_hash, storage.hash_pdf(b""))
        self.assertTrue(extracted.validation_warnings)
        self.assertEqual(extracted.statement.scale_factor, 1_000_000)

    def test_qa_passes_cached_context_and_returns_response_offline(self):
        with patch("pdf_financial_qa.qa.genai.Client") as client:
            client.return_value.models.generate_content.return_value = SimpleNamespace(text="Synthetic answer")
            answer = ask("What changed?", result(), Settings("test", "test", "fake-model"))
            call = client.return_value.models.generate_content.call_args.kwargs
        self.assertEqual(answer, "Synthetic answer")
        self.assertIn("Synthetic source text", call["contents"][0])
        self.assertIn("scale_factor", call["contents"][0])


if __name__ == "__main__":
    unittest.main()
