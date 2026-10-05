"""Deterministic classification rules over page texts. Offline; synthetic text only."""

import unittest
from datetime import date

from pdf_financial_qa.classify.rules import RULES_VERSION, classify_text, normalise


def evidence_for(answers, field):
    return [h for h in answers.evidence if h.field == field]


class RulesTests(unittest.TestCase):
    def test_annual_report(self):
        pages = [
            "Synthetic Cements Limited\nIntegrated Annual Report 2025-26\nCIN: L26940MH2001PLC123456",
            "Contents",
            "Standalone Balance Sheet as at 31 March 2026\nStatement of Profit and Loss for the year ended 31 March 2026",
        ]
        a = classify_text(pages)
        self.assertEqual(RULES_VERSION, "classify-rules-1")
        self.assertEqual(a.kind, "annual_report")
        self.assertFalse(a.kind_conflict)
        self.assertEqual(a.company_name, "Synthetic Cements Limited")
        self.assertEqual(a.cin, "L26940MH2001PLC123456")
        self.assertEqual(a.period_label, "Year ended 31 March 2026")
        self.assertEqual(a.period_end, date(2026, 3, 31))
        self.assertIsNone(a.results_span)
        self.assertEqual(a.statements[("balance_sheet", "standalone")], [2])
        kind = evidence_for(a, "kind")[0]
        self.assertEqual((kind.rule_id, kind.page_index), ("title.annual_report", 0))
        self.assertIn(normalise(kind.quote), normalise(pages[0]))

    def test_quarterly_results_with_exchange_codes(self):
        pages = ["Synthetic Power Limited\nScrip Code: 532123\nSymbol: SYNPOWER\n"
                 "Statement of Unaudited Standalone Financial Results for the Quarter ended 30 June 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "financial_results")
        self.assertEqual(a.results_span, "quarter")
        self.assertEqual(a.period_end, date(2026, 6, 30))
        self.assertEqual(a.period_label, "Quarter ended 30 June 2026")
        self.assertEqual((a.bse_code, a.nse_symbol), ("532123", "SYNPOWER"))
        self.assertEqual(a.statements[("income_statement", "standalone")], [0])

    def test_quarter_and_year_is_full_year(self):
        a = classify_text(["Statement of Audited Financial Results for the Quarter and Year ended 31 March 2026"])
        self.assertEqual((a.kind, a.results_span, a.period_end), ("financial_results", "full_year", date(2026, 3, 31)))

    def test_shareholding_pattern_is_kept_as_other(self):
        a = classify_text(["Synthetic Foods Limited\nShareholding Pattern under Regulation 31\nQuarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "shareholding_pattern"))
        self.assertIsNone(a.period_label)

    def test_outcome_letter_with_results_attached(self):
        pages = ["Outcome of Board Meeting held on 12 August 2026",
                 "Statement of Unaudited Consolidated Financial Results for the Quarter ended 30 June 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "financial_results")
        self.assertIsNone(a.other_type)

    def test_intimation_letter_without_results_is_kept(self):
        a = classify_text(["Synthetic Foods Limited\nIntimation of Board Meeting\n"
                           "The Board will meet to consider and approve the Unaudited Financial Results "
                           "for the quarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "board_meeting"))
        self.assertEqual(a.statements, {})

    def test_annual_report_with_bound_agm_notice(self):
        pages = ["Synthetic Cements Limited\nAnnual Report 2025-26",
                 "Notice is hereby given that the 25th Annual General Meeting of the members",
                 "Consolidated Balance Sheet as at 31 March 2026"]
        a = classify_text(pages)
        self.assertEqual(a.kind, "annual_report")

    def test_two_titles_on_one_page_are_a_conflict(self):
        a = classify_text(["Investor Presentation\nPress Release"])
        self.assertIsNone(a.kind)
        self.assertTrue(a.kind_conflict)
        self.assertEqual(evidence_for(a, "kind"), [])

    def test_nothing_recognised_leaves_the_kind_open(self):
        a = classify_text(["A page of prose with no title we know."])
        self.assertIsNone(a.kind)
        self.assertFalse(a.kind_conflict)

    def test_statements_without_a_title_are_a_conflict(self):
        a = classify_text(["Standalone Balance Sheet as at 31 March 2026"])
        self.assertIsNone(a.kind)
        self.assertTrue(a.kind_conflict)

    def test_exchange_names_are_not_the_company(self):
        a = classify_text(["To\nBSE Limited\nNational Stock Exchange of India Limited\nSynthetic Foods Limited\nPress Release"])
        self.assertEqual(a.company_name, "Synthetic Foods Limited")

    def test_titles_after_page_five_are_ignored(self):
        pages = ["Cover", "", "", "", "", "Shareholding Pattern"]
        self.assertIsNone(classify_text(pages).kind)

    def test_pointed_pages_are_the_pages_with_evidence(self):
        a = classify_text(["Annual Report 2025-26", "x", "Standalone Balance Sheet as at 31 March 2026"])
        self.assertEqual(a.pointed_pages, [0, 2])

    def test_quotes_are_single_lines_at_most_300_characters(self):
        a = classify_text(["Synthetic Cements Limited " + "word " * 100 + "\nAnnual Report 2025-26"])
        for hit in a.evidence:
            self.assertLessEqual(len(hit.quote), 300)
            self.assertNotIn("\n", hit.quote)

    def test_board_meeting_notice_citing_regulation_33_is_kept(self):
        a = classify_text(["Synthetic Foods Limited\nSub: Board Meeting Notice\nPursuant to Regulation 33 of SEBI (LODR), "
                           "the Board will meet to consider the unaudited financial results for the quarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "board_meeting"))
        self.assertEqual(a.statements, {})

    def test_wrapped_sentence_is_not_a_results_heading(self):
        a = classify_text(["Notice of Board Meeting\nThe Board will meet to approve the\n"
                           "Statement of Unaudited Financial Results for the quarter ended 30 June 2026"])
        self.assertEqual((a.kind, a.other_type), ("other", "board_meeting"))
        self.assertEqual(a.statements, {})

    def test_exchange_ltd_variants_are_not_the_company(self):
        a = classify_text(["To,\nBSE Ltd.\nNSE Limited\nSynthetic Foods Limited\nPress Release"])
        self.assertEqual(a.company_name, "Synthetic Foods Limited")

    def test_nse_needs_a_word_boundary(self):
        a = classify_text(["Synthetic Foods Limited\nTotal Expense: INR 500 crore\nPress Release"])
        self.assertIsNone(a.nse_symbol)


if __name__ == "__main__":
    unittest.main()
