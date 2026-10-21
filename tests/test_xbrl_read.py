"""The read: facts with their span, period, declared unit and padded precision, and the map's sums and the balance
identity as checks. Offline, except the tests gated on ``MAESTER_XBRL_DIR``, which read the real instances and
write nothing."""

import os
import unittest
from datetime import date

from xbrl_fixtures import (
    BSE_FIN,
    Q2_CONTEXTS,
    STANDARD_UNITS,
    UnitSpec,
    cash_balances,
    check,
    codes,
    fact,
    ind_as,
    instance,
    known_filer_inconsistencies,
    named_real_instances,
    read,
    real_instances,
    sum_outcomes,
    warning,
)

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl.checks import sum_checks
from pdf_financial_qa.xbrl.maps import load_map

Q2 = "Quarter ended 30 Sep 2025"
H1 = "Half year ended 30 Sep 2025"
GATED = unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")


class ValueTests(unittest.TestCase):
    def test_lakh_values_keep_the_lakh_unit_and_are_padded_never_rounded(self):
        r = read(instance(rounding="Lakhs", facts=ind_as(revenue=("1234500000", "-3"))))  # 1,234,500,000 / 100,000 = 12345; max(0, −3 − (−5)) = 2 places
        f = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((f.reported_value, f.normalized_value, f.unit_label, f.scale_factor, f.currency),
                         ("12345.00", "1234500000", "₹ lakh", "100000", "INR"))
        self.assertEqual((f.span, f.period_start, f.period_end, f.period_label), ("quarter", date(2025, 7, 1), date(2025, 9, 30), Q2))

    def test_the_other_fields_of_a_fact(self):
        r = read(instance(rounding="Lakhs", facts=ind_as()))
        f = fact(r, "Income", "FourD")
        self.assertEqual((f.statement, f.basis, f.section, f.line_order, f.reported_label, f.concept),
                         ("income_statement", "consolidated", "Income", 30, "Total income", "total_income"))
        self.assertEqual((f.is_subtotal, f.component_labels), (True, ["Revenue from operations", "Other income"]))
        self.assertEqual((f.reported_text, f.reported_value, f.value_status, f.decimals, f.nil, f.as_of_date),
                         ("2480000000", "24800", "value", "-5", False, None))  # FourD doubles 1,240,000,000; finest −5 = lakh: 0 places
        self.assertEqual((f.span, f.period_start, f.period_label), ("half_year", date(2025, 4, 1), H1))
        revenue = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((revenue.is_subtotal, revenue.component_labels, revenue.reported_value), (False, [], "12345"))

    def test_an_instant_has_its_day_and_no_span(self):
        r = read(instance(facts=ind_as() + [("Assets", "OneI", "INR", "-5", "900000000")]))
        f = fact(r, "Assets", "OneI")
        self.assertEqual((f.statement, f.as_of_date, f.period_end, f.period_start, f.span, f.period_label),
                         ("balance_sheet", date(2025, 9, 30), None, None, None, "As at 30 Sep 2025"))

    def test_a_crore_file_with_mixed_decimals(self):
        r = read(instance(rounding="Crores", facts=ind_as(revenue=("12345670000000", "-7"), other_income=("123400000", "-5"), income=("12345793400000", "-5"))))
        revenue = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((revenue.reported_value, revenue.unit_label, revenue.scale_factor), ("1234567.00", "₹ crore", "10000000"))  # finest −5: max(0, −5 − (−7)) = 2 places, padded
        self.assertEqual(fact(r, "OtherIncome", "OneD").reported_value, "12.34")
        self.assertEqual((r.coarsest_decimals, r.finest_decimals, r.state), (-7, -5, "complete"))
        self.assertEqual(check(r, "Income", Q2).status, "passed")  # 12345670000000 + 123400000 = 12345793400000

    def test_a_value_with_more_places_than_the_padding_keeps_them(self):
        # 1,234,567 rupees at −5 in lakh: 12.34567, finest −5 gives 0 places, and nothing is rounded away.
        r = read(instance(rounding="Lakhs", facts=ind_as(revenue=("1234567", "-5"))))
        self.assertEqual(fact(r, "RevenueFromOperations", "OneD").reported_value, "12.34567")

    def test_a_negative_value_and_a_value_written_with_places(self):
        r = read(instance(rounding="Crores", facts=ind_as(revenue=("12345670000000", "-7"), other_income=("-120000000.00", "-5"))))
        f = fact(r, "OtherIncome", "OneD")
        self.assertEqual((f.reported_text, f.normalized_value, f.reported_value), ("-120000000.00", "-120000000.00", "-12.00"))  # −120,000,000 / 10^7 = −12, 2 places

    def test_zero_has_the_columns_places_whatever_its_text(self):
        for text in ("0", "0.00", "-0", "-0.000"):
            # finest −3 in lakh: 2 places
            r = read(instance(rounding="Lakhs", facts=ind_as(revenue=("1000000", "-3"), other_income=(text, "-3"), income=("1000000", "-3"))))
            self.assertEqual(fact(r, "OtherIncome", "OneD").reported_value, "0.00", text)
            c = check(r, "Income", Q2)
            self.assertEqual((c.status, c.expected, c.actual), ("passed", "10.00", "10.00"), text)  # 1,000,000 / 10^5 + 0
            # every line at −5 in lakh: no places
            r = read(instance(rounding="Lakhs", facts=ind_as(other_income=(text, "-5"))))
            self.assertEqual(fact(r, "OtherIncome", "OneD").reported_value, "0", text)
            self.assertEqual(check(r, "Income", Q2).actual, "12345", text)  # 1,234,500,000 / 10^5 + 0, against 12400: failed

    def test_eps_keeps_rupees_a_share(self):
        f = fact(read(instance(facts=ind_as(eps=("12.34", "INF")))), "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD")
        self.assertEqual((f.reported_value, f.normalized_value, f.unit_label, f.scale_factor, f.decimals), ("12.34", "12.34", "₹ a share", "1", "INF"))

    def test_nil_is_unknown_never_zero(self):
        r = read(instance(facts=ind_as(other_income=(None, "-5"))))
        f = fact(r, "OtherIncome", "OneD")
        self.assertEqual((f.value_status, f.reported_value, f.normalized_value, f.nil, f.reported_text), ("unparsed", None, None, True, ""))
        self.assertIn("XBRL_NIL", codes(r))
        self.assertEqual(warning(r, "XBRL_NIL").message, "OtherIncome")
        c = check(r, "Income", Q2)
        self.assertEqual((c.status, c.expected, c.actual), ("not_checked", "12400", None))
        self.assertIn("OtherIncome", c.detail)

    def test_text_that_is_not_a_decimal_is_unparsed_and_not_nil(self):
        for text in ("12,345", "1e5", "NaN", "abc", ""):
            r = read(instance(facts=ind_as(other_income=(text, "-5"))))
            f = fact(r, "OtherIncome", "OneD")
            self.assertEqual((f.value_status, f.reported_value, f.normalized_value, f.nil), ("unparsed", None, None, False), text)
            self.assertEqual(check(r, "Income", Q2).status, "not_checked", text)
            self.assertNotIn("XBRL_NIL", codes(r))

    def test_a_number_is_read_whole_with_any_number_of_digits(self):
        digits = "1234567890" * 4 + "00000"  # 45 digits: more than the default 28 of a Decimal context
        r = read(instance(facts=ind_as(revenue=(digits, "-5"), other_income=("0", "-5"), income=(digits, "-5"))))
        f = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((f.normalized_value, f.reported_value), (digits, digits[:-5]))
        self.assertEqual(check(r, "Income", Q2).status, "passed")


class RoundingTests(unittest.TestCase):
    def test_rounding_mismatch(self):
        r = read(instance(rounding="Crores", facts=ind_as(revenue=("1234500000", "-5"))))  # every line at −5: coarsest −5, declared −7
        self.assertEqual((r.state, codes(r)), ("partial", ["XBRL_ROUNDING_MISMATCH"]))
        self.assertEqual(warning(r, "XBRL_ROUNDING_MISMATCH").message, "declared Crores, coarsest decimals -5")

    def test_the_coarsest_decimals_counts_dimensional_facts_too(self):
        r = read(instance(rounding="Crores", facts=ind_as() + [("OtherExpenses", "OneExpenses1D", "INR", "-7", "50000000")]))
        self.assertEqual((r.coarsest_decimals, r.finest_decimals, r.state, codes(r)), (-7, -5, "complete", []))

    def test_no_monetary_fact_with_decimals_gives_no_cross_check(self):
        r = read(instance(facts=ind_as(default_decimals="INF")))
        self.assertEqual((r.coarsest_decimals, r.finest_decimals, r.state, codes(r)), (None, None, "complete", []))
        self.assertEqual({c.status for c in r.checks}, {"not_checked"})  # no tolerance without a finest decimals

    def test_bse_fin_reads_its_own_rounding_element(self):
        r = read(instance(namespace=BSE_FIN, rounding="Lakhs", facts=ind_as()))  # writes LevelOfRoundingUsedInFinancialStatements
        self.assertEqual((r.format.id, r.rounding.word, r.state, codes(r)), ("in-bse-fin/ind_as", "Lakhs", "complete", []))
        self.assertEqual(fact(r, "RevenueFromOperations", "OneD").unit_label, "₹ lakh")

    def test_no_rounding_declared(self):
        r = read(instance(facts=ind_as(), rounding=None))
        f = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((r.state, f.reported_value, f.normalized_value, f.unit_label, f.scale_factor, f.currency),
                         ("partial", None, "1234500000", None, None, "INR"))
        self.assertIn("XBRL_ROUNDING_MISSING", codes(r))
        self.assertIsNone(r.rounding)
        eps = fact(r, "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD")
        self.assertEqual((eps.reported_value, eps.unit_label), ("12.34", "₹ a share"))  # a share's rupees need no declared rounding
        c = check(r, "Income", Q2)
        self.assertEqual((c.status, c.expected, c.actual), ("passed", None, None))  # checked in rupees; no unit to state them in

    def test_a_rounding_word_no_one_can_name_is_no_declared_rounding(self):
        r = read(instance(facts=ind_as(), rounding="Hundreds"))
        self.assertEqual((r.state, r.rounding, codes(r)), ("partial", None, ["XBRL_ROUNDING_MISSING"]))

    def test_a_hostile_decimals_is_not_an_integer(self):
        # A decimals of a billion would pad a billion zeros: only an integer of up to three digits is counted.
        r = read(instance(facts=ind_as(revenue=("1234500000", "999999999"))))
        f = fact(r, "RevenueFromOperations", "OneD")
        self.assertEqual((f.decimals, f.reported_value, r.finest_decimals), ("999999999", "12345", -5))


class SumTests(unittest.TestCase):
    def test_every_sum_present_passes(self):
        r = read(instance(facts=ind_as()))
        self.assertEqual(r.state, "complete")
        for total in ("Income", "Expenses", "ProfitBeforeExceptionalItemsAndTax"):
            for period in (Q2, H1):
                c = check(r, total, period)
                self.assertEqual((c.check_type, c.status, c.statement, c.basis, c.detail), ("subtotal", "passed", "income_statement", "consolidated", ""), (total, period))
        self.assertEqual(check(r, "Income", Q2).section, "Income")
        self.assertEqual((check(r, "Income", Q2).expected, check(r, "Income", Q2).actual), ("12400", "12400"))
        # the comprehensive income has a sum whose parts are all absent
        c = check(r, "ComprehensiveIncomeForThePeriod", Q2)
        self.assertEqual(c.status, "not_checked")
        self.assertIn("ProfitLossForPeriod", c.detail)

    def test_a_crore_total_twenty_lakh_off_its_lakh_parts_fails(self):
        # Per-fact tolerance would be ½×10^7 + 2 × ½×10^5 = 5,100,000 and pass it; the instance's finest (−5) gives 3 × ½ × 10^5 = 150,000.
        r = read(instance(rounding="Crores", facts=ind_as(revenue=("12344600000", "-5"), other_income=("123400000", "-5"), income=("12470000000", "-7"))))
        c = check(r, "Income", Q2)
        self.assertEqual((c.status, c.expected, c.actual), ("failed", "1247.00", "1246.80"))  # 12,470,000,000 − 12,468,000,000 = 2,000,000 > 150,000

    def test_a_failed_sum_names_its_numbers(self):
        c = check(read(instance(facts=ind_as(revenue=("1000000", "-3"), other_income=("2000", "-3"), income=("1004000", "-3")))), "Income", Q2)
        self.assertEqual((c.status, c.expected, c.actual), ("failed", "10.04", "10.02"))  # lakh: 1004000/1e5, (1000000+2000)/1e5; off by 2000 > 3 × ½ × 10^3 = 1500

    def test_rounding_alone_does_not_fail_a_sum(self):
        c = check(read(instance(facts=ind_as(revenue=("1000000", "-3"), other_income=("2000", "-3"), income=("1003000", "-3")))), "Income", Q2)
        self.assertEqual(c.status, "passed")  # off by 1000 ≤ 1500

    def test_the_tolerance_is_exactly_n_halves(self):
        # Three facts at finest −3: 3 × 500 = 1500. Off by exactly 1500 passes; by 1501 fails.
        def status(income):
            return check(read(instance(facts=ind_as(revenue=("1000000", "-3"), other_income=("2000", "-3"), income=(income, "-3")))), "Income", Q2).status
        self.assertEqual((status("1003500"), status("1003501")), ("passed", "failed"))

    def test_a_sign_takes_a_part_off(self):
        # Profit before exceptional items and tax = income − expenses: 1,240,000,000 − 940,000,000 = 300,000,000.
        r = read(instance(facts=ind_as(profit_before_exceptional_items_and_tax=("2180000000", "-5"))))  # income + expenses: wrong
        c = check(r, "ProfitBeforeExceptionalItemsAndTax", Q2)
        self.assertEqual((c.status, c.expected, c.actual), ("failed", "21800", "3000"))

    def test_absent_parts_are_named_and_the_present_ones_checked(self):
        facts = [x for x in ind_as() if not (x[0] == "OtherIncome" and x[1] == "OneD")]
        r = read(instance(facts=facts + [("Income", "OneI", "INR", "-5", "1")]))
        c = check(r, "Income", Q2)
        self.assertEqual((c.status, c.actual, c.detail), ("failed", "12345", "absent: OtherIncome"))  # 12400 against 12345 alone
        self.assertEqual(check(r, "Income", H1).detail, "")
        # an instant total with no part in its period
        alone = check(r, "Income", "As at 30 Sep 2025")
        self.assertEqual((alone.status, alone.actual), ("not_checked", None))
        self.assertIn("RevenueFromOperations", alone.detail)

    def test_the_balance_identity(self):
        lines = [("Assets", "OneI", "INR", "-5", "900000000"), ("EquityAndLiabilities", "OneI", "INR", "-5", "900000000"),
                 ("Assets", "PY_I", "INR", "-5", "800000000"), ("EquityAndLiabilities", "PY_I", "INR", "-5", "800300000"),
                 ("Assets", "FourD", "INR", "-5", "1")]  # a duration total: no equity and liabilities beside it
        r = read(instance(facts=ind_as() + lines))
        good = check(r, "Assets", "As at 30 Sep 2025", "balance_identity")
        self.assertEqual((good.status, good.statement, good.section, good.subject_label, good.expected, good.actual),
                         ("passed", "balance_sheet", None, "Total assets", "9000", "9000"))
        bad = check(r, "Assets", "As at 31 Mar 2025", "balance_identity")
        self.assertEqual((bad.status, bad.expected, bad.actual), ("failed", "8000", "8003"))  # off by 300,000 > 2 × ½ × 10^5
        lone = check(r, "Assets", H1, "balance_identity")
        self.assertEqual((lone.status, lone.actual), ("not_checked", None))
        self.assertIn("EquityAndLiabilities", lone.detail)

    def test_sum_checks_without_a_finest_decimals_check_nothing(self):
        r = read(instance(facts=ind_as()))
        checks = sum_checks(r.facts, load_map(r.format.id), None)
        self.assertTrue(checks)
        self.assertEqual({c.status for c in checks}, {"not_checked"})
        self.assertTrue(all(c.detail for c in checks))


class WhichFactsTests(unittest.TestCase):
    def test_a_mapped_element_in_another_unit_writes_no_fact(self):
        r = read(instance(facts=ind_as() + [("OtherIncome", "OneI", "pure", "INF", "0.15")]))
        self.assertFalse(any(f.context_id == "OneI" and f.element == "OtherIncome" for f in r.facts))
        self.assertEqual(warning(r, "XBRL_UNIT_UNSUPPORTED").message, "OtherIncome")

    def test_an_empty_measure_is_neither_money_nor_a_share(self):
        units = (*STANDARD_UNITS, UnitSpec("blank", ("",)))
        r = read(instance(units=units, facts=ind_as() + [("Assets", "OneI", "blank", "-5", "1"), ("OtherIncome", "OneI", "blank", "-5", "1")]))
        self.assertFalse(any(f.context_id == "OneI" for f in r.facts))
        self.assertEqual(warning(r, "XBRL_UNIT_UNSUPPORTED").message, "Assets, OtherIncome")
        self.assertEqual(r.coarsest_decimals, -5)

    def test_dimensional_and_unmapped(self):
        r = read(instance(facts=ind_as() + [("OtherExpenses", "OneExpenses1D", "INR", "-3", "5000"), ("SomethingNew", "OneD", "INR", "-3", "1")]))
        self.assertFalse(any(f.context_id == "OneExpenses1D" for f in r.facts))
        self.assertEqual(warning(r, "XBRL_ELEMENT_UNMAPPED").message, "SomethingNew")

    def test_an_ignored_element_and_a_text_fact_are_no_fact_and_no_warning(self):
        r = read(instance(facts=ind_as() + [("FaceValueOfEquityShareCapital", "OneD", "INRPerShare", "INF", "10"),
                                            ("DebtEquityRatio", "OneD", "pure", "INF", "0.5")]))
        self.assertEqual(codes(r), [])
        self.assertFalse(any(f.element in ("FaceValueOfEquityShareCapital", "DebtEquityRatio", "NameOfTheCompany") for f in r.facts))

    def test_the_unmapped_and_unit_warnings_list_each_element_once_sorted(self):
        r = read(instance(facts=ind_as() + [("Zeta", "OneD", "INR", "-5", "1"), ("Alpha", "OneD", "INR", "-5", "1"), ("Zeta", "FourD", "INR", "-5", "1")]))
        self.assertEqual(warning(r, "XBRL_ELEMENT_UNMAPPED").message, "Alpha, Zeta")

    def test_unmapped_format_writes_nothing(self):
        r = read(instance(facts=ind_as() + [("CET1Ratio", "OneI", "pure", "INF", "0.15")]))
        self.assertEqual((r.facts, r.checks, codes(r)), ([], [], ["XBRL_FORMAT_UNMAPPED"]))
        self.assertEqual((r.mapped, r.format.id, warning(r, "XBRL_FORMAT_UNMAPPED").message, r.finest_decimals, r.coarsest_decimals),
                         (False, "in-capmkt/banking", "in-capmkt/banking", None, -5))

    def test_a_reference_to_a_context_or_unit_the_file_does_not_declare_is_malformed(self):
        for extra in (("OtherIncome", "NoSuchContext", "INR", "-5", "1"), ("OtherIncome", "OneI", "NoSuchUnit", "-5", "1")):
            with self.assertRaises(ExtractionError) as raised:
                read(instance(facts=ind_as() + [extra]))
            error = raised.exception
            self.assertEqual((error.code, error.message, error.retryable), ("XBRL_UNREADABLE", "MALFORMED", False))
            self.assertIsNone(error.__context__)

    def test_a_basis_the_instance_does_not_state_is_unknown(self):
        facts = [x for x in ind_as() if x[0] != "NatureOfReportStandaloneConsolidated"]
        r = read(instance(facts=facts))
        self.assertEqual((r.basis, fact(r, "Income", "OneD").basis, check(r, "Income", Q2).basis), ("unknown", "unknown", "unknown"))


class CashBalanceTests(unittest.TestCase):
    def test_cash_balance_opens_and_closes_the_half_year(self):
        # One cash-flow line in FourD only, so the half year is the one cash-flow duration: PY_I (31 Mar) opens it, OneI (30 Sep) closes it.
        r = read(instance(facts=ind_as() + [("CashFlowsFromUsedInOperatingActivities", "FourD", "INR", "-5", "200000000"),
                                            ("CashAndCashEquivalentsCashFlowStatement", "PY_I", "INR", "-5", "500000000"),
                                            ("CashAndCashEquivalentsCashFlowStatement", "OneI", "INR", "-5", "700000000")]))
        opening, closing = cash_balances(r)  # sorted by line_order: opening_order before closing_order
        self.assertEqual((opening.context_id, opening.period_start, opening.period_end, opening.span, opening.as_of_date, opening.period_label),
                         ("PY_I", date(2025, 4, 1), date(2025, 9, 30), "half_year", None, H1))
        self.assertEqual((closing.context_id, closing.period_end, closing.span, closing.as_of_date), ("OneI", date(2025, 9, 30), "half_year", None))
        self.assertLess(opening.line_order, closing.line_order)
        self.assertEqual((opening.reported_label, opening.concept, opening.line_order, opening.reported_value, opening.statement),
                         ("Cash and cash equivalents at the beginning of the period", "cash_at_beginning_of_period", 10, "5000", "cash_flow"))
        self.assertEqual((closing.reported_label, closing.concept, closing.line_order, closing.is_subtotal),
                         ("Cash and cash equivalents at the end of the period", "cash_at_end_of_period", 900, False))

    def test_an_instant_that_opens_and_closes_nothing_writes_no_fact(self):
        r = read(instance(facts=ind_as() + [("CashAndCashEquivalentsCashFlowStatement", "OneI", "INR", "-5", "700000000")]))
        self.assertEqual(cash_balances(r), [])

    def test_one_instant_can_close_two_durations(self):
        r = read(instance(facts=ind_as() + [("CashFlowsFromUsedInOperatingActivities", "FourD", "INR", "-5", "200000000"),
                                            ("CashFlowsFromUsedInOperatingActivities", "OneD", "INR", "-5", "100000000"),
                                            ("CashAndCashEquivalentsCashFlowStatement", "OneI", "INR", "-5", "700000000")]))
        self.assertEqual(sorted(x.period_label for x in cash_balances(r)), [H1, Q2])
        self.assertEqual({x.concept for x in cash_balances(r)}, {"cash_at_end_of_period"})


class FixtureTests(unittest.TestCase):
    def test_ind_as_lines_replace_the_quarter_only(self):
        facts = ind_as(revenue=("1", "-3"), eps=("9.99", "INF"))
        self.assertIn(("RevenueFromOperations", "OneD", "INR", "-3", "1"), facts)
        self.assertIn(("RevenueFromOperations", "FourD", "INR", "-5", "2469000000"), facts)
        eps = [x for x in facts if x[0] == "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"]
        self.assertEqual(eps, [("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INRPerShare", "INF", "9.99")])
        with self.assertRaises(ValueError):
            ind_as(no_such_line=("1", "-5"))

    def test_the_known_inconsistencies_table_parses(self):
        self.assertIsInstance(known_filer_inconsistencies(), set)
        for row in known_filer_inconsistencies():
            self.assertEqual(len(row), 3)
            self.assertTrue(row[0].endswith(".xml"), row)

    def test_the_contexts_are_the_second_quarter_ones(self):
        self.assertEqual([c.id for c in Q2_CONTEXTS], ["OneD", "FourD", "OneI", "PY_I", "OneExpenses1D"])


@GATED
class RealInstanceTests(unittest.TestCase):
    def test_real_instances_rounding_cross_check(self):  # 807 of 807 declare a rounding the reader finds, and it agrees (research §4)
        count = 0
        for path in real_instances():
            r = read(path.read_bytes())
            found = codes(r)
            self.assertNotIn("XBRL_ROUNDING_MISMATCH", found, path.name)
            self.assertNotIn("XBRL_ROUNDING_MISSING", found, path.name)  # in-bse-fin's LevelOfRoundingUsedInFinancialStatements is read
            if r.mapped:  # padding and tolerance rest on finest_decimals; the Survey measured 0 to 3 places past the declared unit
                self.assertIn(r.finest_decimals - r.rounding.exponent, {0, 1, 2, 3}, path.name)
                self.assertNotIn("XBRL_ELEMENT_UNMAPPED", found, path.name)
                self.assertNotIn("XBRL_UNIT_UNSUPPORTED", found, path.name)
            count += 1
        self.assertEqual(count, 807)

    def test_real_instances_sums_add_up(self):  # spec §17: every sum adds up on the named real instances
        outcomes = sum_outcomes((p, read(p.read_bytes())) for files in named_real_instances().values() for p in files)
        known = known_filer_inconsistencies()  # parsed from maps/README.md's table: {(file name, sum id, period label)}
        for sum_id, by_status in outcomes.items():
            for name in by_status["failed"]:
                self.assertIn((name, sum_id), {(n, s) for n, s, _ in known}, f"{sum_id} fails on {name}")
        self.assertGreater(len(outcomes["income"]["passed"]), 0)
        self.assertGreater(len(outcomes["balance"]["passed"]), 0)


if __name__ == "__main__":
    unittest.main()
