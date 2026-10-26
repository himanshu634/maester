"""The span rule: a column header says how long the period is. Offline."""

import unittest

from maester_eval.periods import SPAN_RULE_VERSION, span_of_label

CASES = [
    ("Quarter ended 30.09.2025", "quarter"), ("3 months ended 30/09/2025", "quarter"), ("Three Months Ended September 30, 2025", "quarter"),
    ("Corresponding 3 months ended in the previous year 30.09.2024", "quarter"), ("Preceding quarter ended 30.06.2025", "quarter"),
    ("Half year ended 30.09.2025", "half_year"), ("Six months ended 30.09.2025", "half_year"), ("Half-yearly 30.09.2025", "half_year"),
    ("Nine months ended 31.12.2025", "nine_months"), ("9 months ended 31-Dec-25", "nine_months"),
    ("Year ended 31.03.2026", "year"), ("For the year ended 31 March 2026", "year"), ("Twelve months ended 31.03.2026", "year"),
    ("Previous year ended 31.03.2025", "year"), ("FY 2025-26", "year"), ("Q1 FY 2026-27", "quarter"),
    ("As at 31 March 2026", None), ("Year to date figures for current period ended 30.09.2025", None),   # no date given
    ("31.03.2026 (Audited)", None), ("Current period", None), ("2025-26", None), ("", None),
]


class SpanOfLabelTests(unittest.TestCase):
    def test_the_rule_has_a_version(self):
        self.assertEqual(SPAN_RULE_VERSION, 2)

    def test_a_half_or_nine_month_token_beside_fy_is_not_the_year(self):
        # Version 2: "FY" names the financial year a column falls in, not its length, when another span token is there.
        cases = [("H1 FY 2025-26", "half_year"), ("H2 FY 2025-26", "half_year"), ("9M FY 2025-26", "nine_months"),
                 ("H1 FY 26", "half_year"), ("Half year FY 2025-26", "half_year"), ("Q3 FY 2025-26", "quarter"),
                 ("9M ended 31.12.2025", "nine_months"), ("FY 2025-26", "year")]
        for label, span in cases:
            self.assertEqual(span_of_label(label), span, label)

    def test_short_month_and_half_tokens_beside_fy_name_their_span(self):
        # Version 2: 3M, 6M, 9M, 12M, 1H, 2H and HY are span words; FY beside one is the financial year, not the length.
        cases = [("3M FY 2025-26", "quarter"), ("6M FY 2025-26", "half_year"), ("9M FY 2025-26", "nine_months"), ("12M FY 2025-26", "year"),
                 ("1H FY 2025-26", "half_year"), ("2H FY 2025-26", "half_year"), ("HY FY 2025-26", "half_year"),
                 ("6M FY26", "half_year"), ("1H FY26", "half_year"), ("3 M FY26", "quarter"), ("6 M FY 2025-26", "half_year")]
        for label, span in cases:
            self.assertEqual(span_of_label(label), span, label)

    def test_an_unclear_span_token_beside_fy_is_not_the_year(self):
        # A span-like token the rule does not recognise (4M, 10M, a lone "3H") must not fall through to the FY year rule.
        for label in ("4M FY 2025-26", "10M FY 2025-26", "3H FY 2025-26", "5M FY26"):
            self.assertIsNone(span_of_label(label), label)

    def test_tokens_run_together_stay_unknown(self):
        for label in ("9MFY26", "H1FY26", "H1FY2025-26"):
            self.assertIsNone(span_of_label(label), label)

    def test_span_of_label(self):
        for label, span in CASES:
            self.assertEqual(span_of_label(label), span, label)

    def test_year_to_date_takes_its_span_from_the_month(self):
        ytd = "Year to date figures for current period ended"
        self.assertEqual([span_of_label(f"{ytd} 30.06.2025", "2025-06-30"), span_of_label(f"{ytd} 30.09.2025", "2025-09-30"),
                          span_of_label(f"{ytd} 31.12.2025", "2025-12-31"), span_of_label("Year to date figures for the previous year ended 31.03.2025", "2025-03-31"),
                          span_of_label(f"{ytd} 31.08.2025", "2025-08-31")],
                         ["quarter", "half_year", "nine_months", "year", None])
        self.assertEqual(span_of_label("Half year ended 30.09.2025", "2025-12-31"), "half_year")   # the words win; the month is read for year to date only

    def test_year_to_date_reads_a_date_or_its_text_and_never_guesses(self):
        from datetime import date
        self.assertEqual(span_of_label("YTD 30.09.2025", date(2025, 9, 30)), "half_year")
        self.assertEqual(span_of_label("ytd", "2025-12-31"), "nine_months")
        for end in (None, "", "September", "2025-13-45"):
            self.assertIsNone(span_of_label("Year to date figures", end), end)

    def test_the_first_rule_that_matches_wins(self):
        # "as at" beats everything, and a quarter word beats a year word.
        self.assertIsNone(span_of_label("As at 30 September 2025 (six months)"))
        self.assertEqual(span_of_label("Quarter ended 31.03.2026 (year ended)"), "quarter")
        self.assertEqual(span_of_label("Nine  months\tended  31.12.2025"), "nine_months")  # spaces collapse

    def test_the_rule_never_gives_other(self):
        self.assertNotIn("other", {span_of_label(label) for label, _ in CASES})


if __name__ == "__main__":
    unittest.main()
