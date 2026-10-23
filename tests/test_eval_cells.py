"""Cells: the source rule's slot for a PDF, XBRL or gold fact, and figures that agree exactly or at the coarser
precision. Offline. Every expected value is worked out by hand in the comment beside it."""

from decimal import Decimal
import unittest

from eval_fixtures import RESULTS_Q2, pdf_fact, xbrl_fact

from maester_eval.artefacts import Artefact, ModelCalls
from maester_eval.cells import (
    COMPARE_RULE_VERSION,
    Placed,
    pdf_slot,
    gold_slot,
    printed_exponent,
    same_figure,
    xbrl_exponent,
    xbrl_slot,
)
from maester_eval.gold import GoldFact
from maester_eval.sheets import sheet_rows
from pdf_financial_qa.workflow.contracts import ExtractedFact
from pdf_financial_qa.xbrl.contracts import XbrlFact

C, K = "synthetic-cements", "financial_results"


def artefact_of(facts):
    return Artefact(filing_id=RESULTS_Q2.id, file=RESULTS_Q2.file, company=RESULTS_Q2.company, kind=RESULTS_Q2.kind,
                    period_end=RESULTS_Q2.period_end, set=RESULTS_Q2.set, stratum=None, printed_pages_per_page=1,
                    pipeline_version="test", prompt_version="test", model="test", started_at="2026-10-21T00:00:00Z",
                    seconds=0.0, bytes=0, model_calls=ModelCalls(), pages_without_text=[],
                    result={"facts": facts}, error=None)


def gold_fact(**values):
    base = dict(concept="revenue_from_operations", statement="income_statement", basis="consolidated", section="Income",
                label="Revenue from operations", period_label="Quarter ended 30.09.2025", period_end="2025-09-30",
                span="quarter", printed="12,345.00", value_status="value", value="12345.00", scale="100000",
                normalized_value="1234500000.00", page_index=1)
    base.update(values)
    return GoldFact(**base)


class FixtureTests(unittest.TestCase):
    def test_the_fixtures_are_the_wire_facts(self):
        self.assertEqual(set(xbrl_fact()), set(pdf_fact()) - {"pageIndex", "textLayerMatch"}
                         | {"span", "periodStart", "element", "contextId", "decimals", "nil", "concept", "instance"})
        # Every key of the wire form, and no other: the contract models forbid extra keys.
        self.assertEqual(set(ExtractedFact.model_validate(pdf_fact()).to_wire()), set(pdf_fact()))
        wire = {key: value for key, value in xbrl_fact().items() if key != "instance"}
        self.assertEqual(set(XbrlFact.model_validate(wire).to_wire()), set(wire))
        self.assertEqual((RESULTS_Q2.kind, RESULTS_Q2.period_end, RESULTS_Q2.bse_code), (K, "2025-09-30", "500999"))

    def test_sheet_rows_read_pdf_facts(self):
        dash = pdf_fact(reportedText="-", reportedValue=None, valueStatus="dash", normalizedValue=None)
        balance = pdf_fact(statement="balance_sheet", periodLabel="As at 30.09.2025", periodEnd=None, asOfDate="2025-09-30")
        rows = sheet_rows(artefact_of([pdf_fact(), dash, balance]))
        self.assertEqual([(r["span"], r["value"], r["period_end"], r["page"]) for r in rows],
                         [("quarter", "12345.00", "2025-09-30", "2"), ("quarter", "", "2025-09-30", "2"),
                          ("", "12345.00", "2025-09-30", "2")])


class SlotTests(unittest.TestCase):
    def test_a_quarter_and_its_half_year_never_share_a_slot(self):
        q = pdf_slot(C, K, pdf_fact())
        h = pdf_slot(C, K, pdf_fact(periodLabel="Six months ended 30.09.2025"))
        self.assertNotEqual(q.key, h.key)
        self.assertEqual(q.key, xbrl_slot(C, K, xbrl_fact()))
        self.assertEqual(h.key, xbrl_slot(C, K, xbrl_fact(span="half_year", periodStart="2025-04-01", contextId="FourD")))

    def test_a_header_with_no_span_or_no_date_is_not_placed(self):
        self.assertEqual(pdf_slot(C, K, pdf_fact(periodLabel="Current period ended 30.09.2025")), Placed(None, "no_span"))
        ytd = pdf_slot(C, K, pdf_fact(periodLabel="Year to date figures for current period ended 30.09.2025"))
        self.assertEqual(ytd.key, xbrl_slot(C, K, xbrl_fact(span="half_year", periodStart="2025-04-01", contextId="FourD")))
        self.assertEqual(pdf_slot(C, K, pdf_fact(periodEnd=None)), Placed(None, "no_period"))

    def test_balance_sheet_has_no_span_and_opening_cash_keys_on_the_column(self):
        bs = pdf_slot(C, K, pdf_fact(statement="balance_sheet", periodLabel="Half year ended 30.09.2025", periodEnd=None,
                                        asOfDate="2025-09-30"))
        self.assertEqual(bs.key, xbrl_slot(C, K, xbrl_fact(statement="balance_sheet", span=None, periodEnd=None,
                                                           asOfDate="2025-09-30")))
        opening = xbrl_fact(statement="cash_flow", span="half_year", periodEnd="2025-09-30", asOfDate="2025-03-31",
                            contextId="PY_I")
        self.assertEqual(xbrl_slot(C, K, opening),
                         pdf_slot(C, K, pdf_fact(statement="cash_flow", periodLabel="Half year ended 30.09.2025")).key)

    def test_bases_never_share_a_slot(self):
        self.assertNotEqual(xbrl_slot(C, K, xbrl_fact()), xbrl_slot(C, K, xbrl_fact(basis="standalone")))

    def test_the_key_is_the_source_rules_slot(self):
        # The fields of the slot joined by "|", a balance sheet line as an instant (phase 4's `slot_key`).
        self.assertEqual(pdf_slot(C, K, pdf_fact()),
                         Placed("synthetic-cements|financial_results|income_statement|consolidated|2025-09-30|quarter", None))
        self.assertEqual(xbrl_slot(C, K, xbrl_fact(statement="balance_sheet", span="quarter")),
                         "synthetic-cements|financial_results|balance_sheet|consolidated|2025-09-30|instant")

    def test_an_xbrl_fact_with_no_date_has_no_slot(self):
        self.assertIsNone(xbrl_slot(C, K, xbrl_fact(periodEnd=None, asOfDate=None)))

    def test_gold_facts_take_the_same_slot(self):
        self.assertEqual(gold_slot(C, K, gold_fact()), pdf_slot(C, K, pdf_fact()))
        self.assertEqual(gold_slot(C, K, gold_fact(span="half_year")).key,
                         xbrl_slot(C, K, xbrl_fact(span="half_year", periodStart="2025-04-01", contextId="FourD")))
        # A gold file from before gold facts carried a span: the header's words give it.
        self.assertEqual(gold_slot(C, K, gold_fact(span=None)), pdf_slot(C, K, pdf_fact()))
        self.assertEqual(gold_slot(C, K, gold_fact(span=None, period_label="Current period ended 30.09.2025")),
                         Placed(None, "no_span"))
        self.assertEqual(gold_slot(C, K, gold_fact(period_end=None)), Placed(None, "no_period"))
        # A balance sheet line is an instant whatever span it carries.
        self.assertEqual(gold_slot(C, K, gold_fact(statement="balance_sheet", span="half_year")).key,
                         xbrl_slot(C, K, xbrl_fact(statement="balance_sheet", span=None, periodEnd=None,
                                                   asOfDate="2025-09-30")))


class FigureTests(unittest.TestCase):
    def test_the_rule_has_a_version(self):
        self.assertEqual(COMPARE_RULE_VERSION, 1)

    def test_exponents(self):
        self.assertEqual(printed_exponent("12345.67", "10000000"), 5)    # crore to two places: known to 10^(7-2) rupees
        self.assertEqual(printed_exponent("1235", "10000000"), 7)
        self.assertEqual(printed_exponent("12.34", "1"), -2)            # a share's rupees to the paisa
        self.assertIsNone(printed_exponent("12.34", "2500")); self.assertIsNone(printed_exponent("12.34", None))
        self.assertEqual((xbrl_exponent("-6", "12345000000"), xbrl_exponent("INF", "12.345"), xbrl_exponent(None, "1")),
                         (6, -3, None))

    def test_exponents_as_written(self):
        self.assertEqual(printed_exponent("12345.00", "100000"), 3)     # lakh to two places: 10^(5-2)
        self.assertEqual(printed_exponent("1200", "100000.00"), 5)      # a scale written with places is still 10^5
        self.assertEqual(printed_exponent("-12345.00", "100000"), 3)    # the sign does not change the precision
        self.assertIsNone(printed_exponent(None, "100000"))             # a dash has no precision
        self.assertIsNone(printed_exponent("12.34", "0"))
        self.assertEqual(xbrl_exponent("INF", "12345000000"), 0)        # exact, to the rupee as written
        self.assertEqual(xbrl_exponent("2", "12.34"), -2)

    def test_a_hostile_decimals_gives_an_unknown_exponent(self):
        # Phase 4's bounded reader takes three digits at most: a longer `decimals` is unknown, never a huge exponent.
        self.assertIsNone(xbrl_exponent("-9999999", "12345000000"))
        self.assertIsNone(xbrl_exponent("9" * 5000, "12345000000"))
        self.assertIsNone(xbrl_exponent("six", "12345000000"))
        self.assertEqual(xbrl_exponent("-999", "12345000000"), 999)

    def test_same_figure(self):
        D = Decimal
        self.assertEqual(same_figure(D("12350000000"), 7, D("12345000000"), 6), "at_precision")    # 1,235 crore; 1,234.5 crore rounds away from zero to 1,235
        self.assertEqual(same_figure(D("12340000000"), 7, D("12345000000"), 6), "different")       # 1,234 crore
        self.assertEqual(same_figure(D("-12350000000"), 7, D("-12345000000"), 6), "at_precision")  # −1,234.5 → −1,235
        self.assertEqual(same_figure(D("1235000"), 3, D("1234567"), 0), "at_precision")           # 12.35 lakh; 12,34,567 → 12,35,000 at 10^3
        self.assertEqual(same_figure(D("123400000"), 5, D("123400000.0"), 5), "exact")
        self.assertEqual(same_figure(D("12350000000"), None, D("12345000000"), 6), "different")    # an unknown precision compares exactly only

    def test_same_figure_takes_the_coarser_precision_whichever_side_holds_it(self):
        D = Decimal
        self.assertEqual(same_figure(D("12345000000"), 6, D("12350000000"), 7), "at_precision")    # the arguments swapped
        self.assertEqual(same_figure(D("12345000000"), 6, D("12350000000"), None), "different")
        self.assertEqual(same_figure(D("12345000000"), None, D("12345000000"), None), "exact")
        # 1,234.49 crore at 10^5 rupees rounds to 1,234 crore at 10^7, not 1,235.
        self.assertEqual(same_figure(D("12344900000"), 5, D("12350000000"), 7), "different")
        # A sign apart is not the same figure: 1,235 crore against −1,235 crore.
        self.assertEqual(same_figure(D("12350000000"), 7, D("-12345000000"), 6), "different")


if __name__ == "__main__":
    unittest.main()
