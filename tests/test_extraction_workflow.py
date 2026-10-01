"""The LangGraph extraction workflow driven by a scripted model. Offline: no model calls."""

from datetime import date
import threading
import unittest

from pdf_fixtures import make_pdf

from pdf_financial_qa.workflow import ExtractionError, WorkflowSettings, run_extraction
from pdf_financial_qa.workflow.errors import ModelOutputError
from pdf_financial_qa.workflow.model import (
    ExtractedLine, ExtractedSection, ExtractedValue, LocatedStatement, LocateOutput, StatementOutput,
)
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

FAST = WorkflowSettings(retry_initial_interval=0.0)

# Page 1: cover. Page 2: balance sheet. Page 3: profit and loss. Page 4: a scanned cash flow (no text layer).
PAGES = [
    ["Synthetic Industries Limited", "Annual Report 2025-26"],
    ["Consolidated Balance Sheet", "(Rs. in crores)", "As at 31 March 2026", "Cash 1,200", "Inventories 800",
     "Total assets 2,000", "Total equity 1,500", "Total liabilities 500"],
    ["Consolidated Statement of Profit and Loss", "Revenue 5,000", "Expenses (3,000)", "Profit 2,000"],
    [],
]


def lines_section(name, rows, period="As at 31 March 2026", page=1):
    return ExtractedSection(name=name, lines=[
        ExtractedLine(label=label, page=page, is_subtotal=bool(components), component_labels=list(components),
                      values=[ExtractedValue(period=period, text=text)])
        for label, text, components in rows
    ])


def balance_sheet(cash="1,200", total="2,000"):
    return StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["As at 31 March 2026"], sections=[
        lines_section("Assets", [("Cash", cash, ()), ("Inventories", "800", ()), ("Total assets", total, ("Cash", "Inventories"))]),
        lines_section("Equity and liabilities", [("Total equity", "1,500", ()), ("Total liabilities", "500", ())]),
    ])


def income_statement():
    return StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["Year ended 31 March 2026"], sections=[
        lines_section("Profit and loss", [("Revenue", "5,000", ()), ("Expenses", "(3,000)", ()),
                                          ("Profit", "2,000", ("Revenue", "Expenses"))], period="Year ended 31 March 2026"),
    ])


def cash_flow():
    return StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["FY2026"], sections=[
        lines_section("Operating activities", [("Net cash from operations", "1,750", ())], period="FY2026"),
    ])


LOCATED = LocateOutput(company_name="SYNTHETIC INDUSTRIES LIMITED", statements=[
    LocatedStatement(statement="cash_flow", basis="consolidated", pages=[4]),
    LocatedStatement(statement="balance_sheet", basis="consolidated", pages=[2]),
    LocatedStatement(statement="income_statement", basis="consolidated", pages=[3]),
])


class ScriptedModel:
    """Answers from scripts; a script entry that is an exception is raised instead."""

    name = "scripted-model"

    def __init__(self, *, locate=None, extract=None, correct=None):
        self.locate_script = list(locate or [LOCATED])
        self.extract_script = extract or {"balance_sheet": [balance_sheet()], "income_statement": [income_statement()],
                                          "cash_flow": [cash_flow()]}
        self.correct_script = list(correct or [])
        self.calls: list[tuple] = []
        self._lock = threading.Lock()

    @staticmethod
    def _answer(script):
        item = script.pop(0) if len(script) > 1 else script[0]
        if isinstance(item, Exception):
            raise item
        return item

    def locate(self, pdf, page_count):
        with self._lock:
            self.calls.append(("locate", page_count))
            return self._answer(self.locate_script)

    def extract(self, pdf, page_count, statement, basis):
        with self._lock:
            self.calls.append(("extract", statement, page_count))
            return self._answer(self.extract_script[statement])

    def correct(self, pdf, page_count, statement, basis, section, problems):
        with self._lock:
            self.calls.append(("correct", statement, section.name, tuple(problems)))
            return self._answer(self.correct_script)

    def count(self, kind):
        return sum(1 for call in self.calls if call[0] == kind)


PDF = make_pdf(PAGES)


class HappyPathTests(unittest.TestCase):
    def test_extracts_every_statement_with_page_provenance(self):
        model = ScriptedModel()
        stages = []
        result = run_extraction(PDF, model=model, company_name="Synthetic Industries Ltd", settings=FAST,
                                on_progress=lambda stage, percent: stages.append((stage, percent)))

        self.assertEqual(result.state, "complete")
        self.assertEqual(result.page_count, 4)
        self.assertEqual(result.model, "scripted-model")
        self.assertEqual(result.prompt_version, PROMPT_VERSION)
        self.assertEqual(result.company_name_as_printed, "SYNTHETIC INDUSTRIES LIMITED")
        self.assertEqual([(c.statement, c.pages, c.status) for c in result.coverage],
                         [("balance_sheet", [1], "extracted"), ("income_statement", [2], "extracted"), ("cash_flow", [3], "extracted")])
        self.assertEqual(result.warnings, [])

        cash = next(f for f in result.facts if f.reported_label == "Cash")
        self.assertEqual((cash.page_index, cash.text_layer_match), (1, True))
        self.assertEqual((cash.reported_text, cash.reported_value, cash.scale_factor, cash.normalized_value),
                         ("1,200", "1200", "10000000", "12000000000"))
        self.assertEqual(cash.as_of_date, date(2026, 3, 31))
        self.assertIsNone(cash.period_end)

        expenses = next(f for f in result.facts if f.reported_label == "Expenses")
        self.assertEqual((expenses.reported_value, expenses.period_end, expenses.page_index), ("-3000", date(2026, 3, 31), 2))

        flow = next(f for f in result.facts if f.statement == "cash_flow")
        self.assertIsNone(flow.text_layer_match)  # scanned page
        self.assertIsNone(flow.period_end)  # "FY2026" is not a date

        self.assertEqual({(c.check_type, c.subject_label, c.status) for c in result.checks}, {
            ("subtotal", "Total assets", "passed"), ("subtotal", "Profit", "passed"), ("balance_identity", "Total assets", "passed"),
        })
        self.assertEqual([s for s, _ in stages], ["prepare", "locate", "statement", "statement", "statement", "assemble"])
        self.assertEqual(stages[-1][1], 100)
        self.assertEqual(model.count("correct"), 0)

    def test_line_order_is_per_line_within_a_statement(self):
        result = run_extraction(PDF, model=ScriptedModel(), settings=FAST)
        orders = [(f.reported_label, f.line_order) for f in result.facts if f.statement == "balance_sheet"]
        self.assertEqual(orders, [("Cash", 0), ("Inventories", 1), ("Total assets", 2), ("Total equity", 3), ("Total liabilities", 4)])

    def test_result_round_trips_through_the_wire_format(self):
        from pdf_financial_qa.workflow.contracts import ExtractionResult

        result = run_extraction(PDF, model=ScriptedModel(), settings=FAST)
        self.assertEqual(ExtractionResult.model_validate(result.to_wire()), result)


class SelfCorrectionTests(unittest.TestCase):
    def test_a_misread_value_is_re_read_and_fixed(self):
        misread = balance_sheet(cash="1,300")  # the page prints 1,200
        model = ScriptedModel(extract={"balance_sheet": [misread], "income_statement": [income_statement()], "cash_flow": [cash_flow()]},
                              correct=[balance_sheet().sections[0]])
        result = run_extraction(PDF, model=model, settings=FAST)

        self.assertEqual(model.count("correct"), 1)
        _, statement, section, problems = next(c for c in model.calls if c[0] == "correct")
        self.assertEqual((statement, section), ("balance_sheet", "Assets"))
        self.assertTrue(any("Total assets" in p for p in problems))
        self.assertEqual(next(f.reported_text for f in result.facts if f.reported_label == "Cash"), "1,200")
        self.assertTrue(all(c.status == "passed" for c in result.checks if c.statement == "balance_sheet"))
        self.assertEqual(result.warnings, [])

    def test_a_correction_that_invents_a_number_is_rejected(self):
        # The page prints Cash 1,200 and Total assets 2,000; suppose the extraction read the
        # total as 2,100. A "correction" that changes Cash to 1,300 to make it add up is not on the page.
        wrong_total = balance_sheet(total="2,100")
        fudged = lines_section("Assets", [("Cash", "1,300", ()), ("Inventories", "800", ()),
                                          ("Total assets", "2,100", ("Cash", "Inventories"))])
        model = ScriptedModel(extract={"balance_sheet": [wrong_total], "income_statement": [income_statement()], "cash_flow": [cash_flow()]},
                              correct=[fudged])
        result = run_extraction(PDF, model=model, settings=FAST)

        # The wrong total fails both the subtotal and the balance identity, so each attempt
        # re-reads the assets section and the equity and liabilities section.
        self.assertEqual(model.count("correct"), FAST.max_corrections * 2)
        self.assertEqual(next(f.reported_text for f in result.facts if f.reported_label == "Cash"), "1,200")
        rejected = [w for w in result.warnings if w.code == "CORRECTION_REJECTED"]
        self.assertEqual(len(rejected), FAST.max_corrections * 2)
        self.assertTrue(any("'1,300'" in w.message for w in rejected))
        subtotal = next(c for c in result.checks if c.check_type == "subtotal" and c.subject_label == "Total assets")
        self.assertEqual((subtotal.status, subtotal.expected, subtotal.actual), ("failed", "2100", "2000"))

    def test_corrections_stop_after_the_attempt_cap(self):
        wrong_total = balance_sheet(total="2,100")
        model = ScriptedModel(extract={"balance_sheet": [wrong_total], "income_statement": [income_statement()], "cash_flow": [cash_flow()]},
                              correct=[wrong_total.sections[0]])  # re-reads the same thing every time
        result = run_extraction(PDF, model=model, settings=WorkflowSettings(retry_initial_interval=0.0, max_corrections=3))
        self.assertEqual(model.count("correct"), 3 * 2)  # two sections involved per attempt
        self.assertEqual(result.state, "complete")

    def test_a_failing_correction_call_keeps_the_original_reading(self):
        wrong_total = balance_sheet(total="2,100")
        model = ScriptedModel(extract={"balance_sheet": [wrong_total], "income_statement": [income_statement()], "cash_flow": [cash_flow()]},
                              correct=[ModelOutputError("unusable")])
        result = run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual(result.state, "complete")
        self.assertTrue(any(w.code == "CORRECTION_FAILED" for w in result.warnings))
        self.assertEqual(next(f.reported_text for f in result.facts if f.reported_label == "Total assets"), "2,100")


class FailureTests(unittest.TestCase):
    def test_a_failing_statement_makes_the_result_partial(self):
        model = ScriptedModel(extract={"balance_sheet": [balance_sheet()], "income_statement": [income_statement()],
                                       "cash_flow": [ModelOutputError("unusable")]})
        result = run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual(result.state, "partial")
        failed = next(c for c in result.coverage if c.statement == "cash_flow")
        self.assertEqual(failed.status, "failed")
        self.assertIn("ModelOutputError", failed.message)
        self.assertEqual(sum(1 for c in model.calls if c[:2] == ("extract", "cash_flow")), FAST.retry_attempts)
        self.assertFalse(any(f.statement == "cash_flow" for f in result.facts))

    def test_a_transient_locate_failure_is_retried(self):
        model = ScriptedModel(locate=[ModelOutputError("try again"), LOCATED])
        result = run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual(model.count("locate"), 2)
        self.assertEqual(result.state, "complete")

    def test_persistent_model_failure_is_retryable(self):
        model = ScriptedModel(locate=[ModelOutputError("down")])
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual((ctx.exception.code, ctx.exception.retryable), ("MODEL_UNAVAILABLE", True))

    def test_no_statements_found_is_permanent(self):
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=ScriptedModel(locate=[LocateOutput(company_name=None, statements=[])]), settings=FAST)
        self.assertEqual((ctx.exception.code, ctx.exception.retryable), ("NO_STATEMENTS_FOUND", False))

    def test_unreadable_pdf_is_permanent(self):
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(b"%PDF-1.4 not really", model=ScriptedModel(), settings=FAST)
        self.assertEqual((ctx.exception.code, ctx.exception.retryable), ("UNREADABLE_PDF", False))

    def test_every_statement_failing_is_retryable(self):
        broken = ModelOutputError("unusable")
        model = ScriptedModel(extract={"balance_sheet": [broken], "income_statement": [broken], "cash_flow": [broken]})
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual((ctx.exception.code, ctx.exception.retryable), ("EXTRACTION_FAILED", True))

    def test_the_model_call_budget_is_enforced(self):
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=ScriptedModel(), settings=WorkflowSettings(retry_initial_interval=0.0, max_model_calls=2))
        self.assertEqual((ctx.exception.code, ctx.exception.retryable), ("MODEL_CALL_BUDGET_EXCEEDED", False))

    def test_cancellation_stops_the_run(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=ScriptedModel(), settings=FAST, cancel=cancel)
        self.assertEqual(ctx.exception.code, "CANCELLED")

    def test_a_line_on_a_page_outside_the_excerpt_fails_that_statement(self):
        two_pages = LocateOutput(company_name=None, statements=[LocatedStatement(statement="balance_sheet", basis="consolidated", pages=[2, 3])])
        bad = balance_sheet()
        bad.sections[0].lines[0].page = 7
        model = ScriptedModel(locate=[two_pages], extract={"balance_sheet": [bad]})
        with self.assertRaises(ExtractionError) as ctx:
            run_extraction(PDF, model=model, settings=FAST)
        self.assertEqual(ctx.exception.code, "EXTRACTION_FAILED")


class LocateTests(unittest.TestCase):
    def test_long_documents_are_located_in_chunks_and_mapped_back(self):
        pages = [["filler page"] for _ in range(65)]
        pages[31] = ["Balance Sheet", "Cash 1,200", "Inventories 800", "Total assets 2,000", "Total equity 1,500", "Total liabilities 500"]
        chunk_answers = [
            LocateOutput(company_name=None, statements=[]),
            LocateOutput(company_name="Synthetic", statements=[LocatedStatement(statement="balance_sheet", basis="standalone", pages=[2])]),
            LocateOutput(company_name=None, statements=[]),
        ]
        model = ScriptedModel(locate=chunk_answers, extract={"balance_sheet": [balance_sheet()]})
        result = run_extraction(make_pdf(pages), model=model, settings=FAST)
        self.assertEqual([c[1] for c in model.calls if c[0] == "locate"], [30, 30, 5])
        self.assertEqual([(c.basis, c.pages) for c in result.coverage], [("standalone", [31])])
        self.assertTrue(all(f.page_index == 31 and f.text_layer_match for f in result.facts))

    def test_statements_on_too_many_pages_are_not_extracted(self):
        located = LocateOutput(company_name=None, statements=[
            LocatedStatement(statement="balance_sheet", basis="consolidated", pages=[2]),
            LocatedStatement(statement="cash_flow", basis="consolidated", pages=[1, 2, 3, 4, 5, 6, 7]),
        ])
        many = make_pdf(PAGES + [["x"], ["y"], ["z"]])
        model = ScriptedModel(locate=[located], extract={"balance_sheet": [balance_sheet()]})
        result = run_extraction(many, model=model, settings=FAST)
        self.assertEqual(result.state, "partial")
        rejected = next(c for c in result.coverage if c.statement == "cash_flow")
        self.assertIn("7 pages", rejected.message)
        self.assertFalse(any(c[:2] == ("extract", "cash_flow") for c in model.calls))

    def test_out_of_range_pages_are_dropped_with_a_warning(self):
        located = LocateOutput(company_name=None, statements=[LocatedStatement(statement="balance_sheet", basis="consolidated", pages=[2, 99])])
        result = run_extraction(PDF, model=ScriptedModel(locate=[located], extract={"balance_sheet": [balance_sheet()]}), settings=FAST)
        self.assertEqual(result.coverage[0].pages, [1])
        self.assertEqual([w.code for w in result.warnings], ["LOCATE_PAGE_OUT_OF_RANGE"])

    def test_a_different_printed_company_is_flagged(self):
        result = run_extraction(PDF, model=ScriptedModel(), company_name="Another Corp", settings=FAST)
        self.assertIn("COMPANY_NAME_MISMATCH", [w.code for w in result.warnings])

    def test_an_unknown_unit_leaves_values_unnormalized(self):
        odd = balance_sheet()
        odd.unit_label = "in stones"
        result = run_extraction(PDF, model=ScriptedModel(extract={"balance_sheet": [odd], "income_statement": [income_statement()],
                                                                   "cash_flow": [cash_flow()]}), settings=FAST)
        cash = next(f for f in result.facts if f.reported_label == "Cash")
        self.assertEqual((cash.reported_value, cash.scale_factor, cash.normalized_value), ("1200", None, None))
        self.assertIn("UNKNOWN_UNIT", [w.code for w in result.warnings])


if __name__ == "__main__":
    unittest.main()
