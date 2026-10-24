"""The banking element maps and the read of a banking instance. Offline, except the class gated on
``MAESTER_XBRL_DIR``, which reads the real instances and writes nothing."""

import os
import re
import unittest
from collections import Counter
from decimal import Decimal

from xbrl_fixtures import BSE_FIN, check, codes, f, fact, identity_facts, instance, parse, read, real_instances

from pdf_financial_qa.xbrl.classify import classify_instance
from pdf_financial_qa.xbrl.formats import detect_format
from pdf_financial_qa.xbrl.maps import ElementMap, load_map

CAPMKT, BSE = "in-capmkt/banking", "in-bse-fin/banking"
# Stitch's rule for a per-share line (apps/api/src/financials/stitch.ts), as test_xbrl_maps.py has it.
PER_SHARE = re.compile(r"earnings? per (equity )?share|\beps\b")


def banking_maps() -> dict[str, ElementMap]:
    loaded = {format_id: load_map(format_id) for format_id in (CAPMKT, BSE)}
    assert all(m is not None for m in loaded.values())
    return loaded  # type: ignore[return-value]


def lakh(amount: str) -> str:
    """Rupees of an amount in lakh, as an instance writes it at ``decimals`` −5."""
    return str(Decimal(amount) * 100000)


# A bank's quarter, in lakh. Worked by hand, in the order the results print the lines:
#   interest earned   6,000 + 1,400 + 90 + 140 = 7,630
#   total income      7,630 + 1,300            = 8,930
#   operating exp.      600 + 1,200            = 1,800
#   expenditure       4,300 + 1,800            = 6,100
#   operating profit  8,930 − 6,100            = 2,830
#   before tax        2,830 − 260 + (−80)      = 2,490   (the exceptional charge is filed negative)
#   after tax         2,490 − 600              = 1,890
#   for the period    1,890 + 0                = 1,890
#   to the owners     1,890 + 30 − 20          = 1,900
PROFIT_AND_LOSS = {
    "InterestOrDiscountOnAdvancesOrBills": "6000", "RevenueOnInvestments": "1400",
    "InterestOnBalancesWithReserveBankOfIndiaAndOtherInterBankFunds": "90", "OtherInterest": "140",
    "InterestEarned": "7630", "OtherIncome": "1300", "Income": "8930",
    "InterestExpended": "4300", "EmployeesCost": "600", "OtherOperatingExpenses": "1200", "OperatingExpenses": "1800",
    "ExpenditureExcludingProvisionsAndContingencies": "6100", "OperatingProfitBeforeProvisionAndContingencies": "2830",
    "ProvisionsOtherThanTaxAndContingencies": "260", "ExceptionalItems": "-80",
    "ProfitLossFromOrdinaryActivitiesBeforeTax": "2490", "TaxExpense": "600",
    "ProfitLossFromOrdinaryActivitiesAfterTax": "1890", "ExtraordinaryItems": "0", "ProfitLossForThePeriod": "1890",
    "ShareOfProfitLossOfAssociates": "30", "ProfitLossOfMinorityInterest": "20",
    "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates": "1900",
}
# The balance sheet at the quarter's end, in lakh:
#   capital and liabilities  150 + 5,500 + 30,000 + 4,900 + 2,100       = 42,650
#   assets                   2,000 + 950 + 8,800 + 29,300 + 150 + 1,450 = 42,650
BALANCE_SHEET = {
    "Capital": "150", "ReservesAndSurplus": "5500", "Deposits": "30000", "Borrowings": "4900",
    "OtherLiabilitiesAndProvisions": "2100", "CapitalAndLiabilities": "42650",
    "CashAndBalancesWithReserveBankOfIndia": "2000", "BalancesWithBanksAndMoneyAtCallAndShortNotice": "950",
    "Investments": "8800", "Advances": "29300", "FixedAssets": "150", "OtherAssets": "1450", "Assets": "42650",
}


def bank_facts(**changed: str) -> list:
    """A bank's quarter: identity, the profit and loss in ``OneD``, the balance sheet in ``OneI``, earnings per share
    and the ratios the results print beside them. ``changed`` replaces a line's amount in lakh."""
    lines = {**PROFIT_AND_LOSS, **BALANCE_SHEET, **changed}
    facts = list(identity_facts())
    facts += [f(element, "OneD", text=lakh(lines[element])) for element in PROFIT_AND_LOSS]
    facts += [f(element, "OneI", text=lakh(lines[element])) for element in BALANCE_SHEET]
    facts += [
        f("BasicEarningsPerShareAfterExtraordinaryItems", unit="INRPerShare", decimals="INF", text="12.34"),
        f("DilutedEarningsPerShareAfterExtraordinaryItems", unit="INRPerShare", decimals="INF", text="12.30"),
        f("CET1Ratio", unit="pure", decimals="INF", text="0.1971"),
        f("GrossNonPerformingAssets", text=lakh("3400")),
    ]
    return facts


class MapTests(unittest.TestCase):
    def test_both_maps_hold_the_same_lines_but_what_one_format_lacks(self):
        capmkt, bse = banking_maps()[CAPMKT], banking_maps()[BSE]
        capmkt_lines = {entry.element for entry in capmkt.elements}
        bse_lines = {entry.element for entry in bse.elements}
        self.assertEqual(capmkt_lines - bse_lines, {"ReserveExcludingRevaluationReserves"})
        self.assertEqual(bse_lines - capmkt_lines, set())
        self.assertEqual(capmkt.ignored - bse.ignored, {"AmountOfRelatedPartyTransactionDuringTheReportingPeriod",
                                                        "NumberOfStatementsOfDeviationForTheCurrentQuarter"})
        self.assertEqual(bse.ignored - capmkt.ignored, set())

    def test_the_sums_are_the_arithmetic_the_results_print(self):
        for format_id, element_map in banking_maps().items():
            by_total = {total.total: [(part.element, part.sign) for part in total.parts] for total in element_map.sums}
            self.assertEqual(by_total["InterestEarned"], [
                ("InterestOrDiscountOnAdvancesOrBills", 1), ("RevenueOnInvestments", 1),
                ("InterestOnBalancesWithReserveBankOfIndiaAndOtherInterBankFunds", 1), ("OtherInterest", 1)], format_id)
            self.assertEqual(by_total["Income"], [("InterestEarned", 1), ("OtherIncome", 1)])
            self.assertEqual(by_total["OperatingExpenses"], [("EmployeesCost", 1), ("OtherOperatingExpenses", 1)])
            self.assertEqual(by_total["ExpenditureExcludingProvisionsAndContingencies"],
                             [("InterestExpended", 1), ("OperatingExpenses", 1)])
            self.assertEqual(by_total["OperatingProfitBeforeProvisionAndContingencies"],
                             [("Income", 1), ("ExpenditureExcludingProvisionsAndContingencies", -1)])
            # Exceptional items keep the sign the filer gave them, a charge negative, as in the Ind AS map.
            self.assertEqual(by_total["ProfitLossFromOrdinaryActivitiesBeforeTax"], [
                ("OperatingProfitBeforeProvisionAndContingencies", 1), ("ProvisionsOtherThanTaxAndContingencies", -1),
                ("ExceptionalItems", 1)])
            self.assertEqual(by_total["ProfitLossFromOrdinaryActivitiesAfterTax"],
                             [("ProfitLossFromOrdinaryActivitiesBeforeTax", 1), ("TaxExpense", -1)])
            self.assertEqual(by_total["ProfitLossForThePeriod"],
                             [("ProfitLossFromOrdinaryActivitiesAfterTax", 1), ("ExtraordinaryItems", 1)])
            self.assertEqual(by_total["ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates"], [
                ("ProfitLossForThePeriod", 1), ("ShareOfProfitLossOfAssociates", 1), ("ProfitLossOfMinorityInterest", -1)])
            self.assertEqual(by_total["CapitalAndLiabilities"], [
                ("Capital", 1), ("ReservesAndSurplus", 1), ("Deposits", 1), ("Borrowings", 1), ("OtherLiabilitiesAndProvisions", 1)])
            self.assertEqual(by_total["Assets"], [
                ("CashAndBalancesWithReserveBankOfIndia", 1), ("BalancesWithBanksAndMoneyAtCallAndShortNotice", 1),
                ("Investments", 1), ("Advances", 1), ("FixedAssets", 1), ("OtherAssets", 1)])
            self.assertEqual([(i.id, i.left, i.right) for i in element_map.identities],
                             [("balance", "Assets", "CapitalAndLiabilities")])

    def test_the_cash_flow_totals_add_their_extraordinary_items_to_the_lines_before_them(self):
        for element_map in banking_maps().values():
            by_total = {total.total: [(part.element, part.sign) for part in total.parts] for total in element_map.sums}
            for activity in ("Operating", "Investing", "Financing"):
                self.assertEqual(by_total[f"CashFlowsFromUsedIn{activity}Activities"], [
                    (f"CashFlowsFromUsedIn{activity}ActivitiesBeforeExtraordinaryItems", 1),
                    (f"ProceedsFromExtraordinaryItemsClassifiedAs{activity}Activities", 1),
                    (f"PaymentForExtraordinaryItemsClassifiedAs{activity}Activities", -1)])
            self.assertEqual(by_total["AdjustmentsForReconcileProfitLoss"],
                             [("AdjustmentsToProfitLoss", 1), ("AdjustmentsForWorkingCapital", 1)])
            self.assertEqual(by_total["CashFlowsFromUsedInOperations"],
                             [("ProfitBeforeExtraordinaryItemsAndTax", 1), ("AdjustmentsForReconcileProfitLoss", 1)])
            sign_of = {part.element: part.sign for total in element_map.sums for part in total.parts}
            self.assertEqual(sign_of["PurchaseOfTangibleAssetsClassifiedAsInvestingActivities"], -1)
            self.assertEqual(sign_of["ProceedsFromIssuingShares"], 1)
            self.assertEqual(sign_of["IncomeTaxesPaidRefundClassifiedAsOperatingActivities"], -1)

    def test_the_headline_lines_have_their_concepts(self):
        for format_id, element_map in banking_maps().items():
            concept_of = {entry.element: entry.concept for entry in element_map.elements}
            expected = {
                "InterestEarned": "interest_earned", "InterestExpended": "interest_expended", "Income": "total_income",
                "OperatingProfitBeforeProvisionAndContingencies": "operating_profit_before_provisions",
                "ProvisionsOtherThanTaxAndContingencies": "provisions_and_contingencies",
                "ExceptionalItems": "exceptional_items", "ProfitLossFromOrdinaryActivitiesBeforeTax": "profit_before_tax",
                "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates": "profit_attributable_to_owners",
                "BasicEarningsPerShareAfterExtraordinaryItems": "eps_basic",
                "DilutedEarningsPerShareAfterExtraordinaryItems": "eps_diluted",
                "Deposits": "deposits", "Advances": "advances", "Investments": "investments", "Borrowings": "borrowings",
                "Capital": "equity_share_capital", "ReservesAndSurplus": "reserves_and_surplus",
                "CapitalAndLiabilities": "total_equity_and_liabilities", "Assets": "total_assets",
                "CashFlowsFromUsedInOperatingActivities": "net_cash_from_operating_activities",
            }
            for element, concept in expected.items():
                self.assertEqual(concept_of[element], concept, f"{format_id} {element}")
            # A bank's interest expended is not a company's finance costs.
            self.assertNotIn("finance_costs", concept_of.values())
            # The bank's net profit leaves out the associates' share that an Ind AS profit for the period holds, so
            # it is not profit_after_tax; the line after minority interest and associates is the owners' profit.
            self.assertIsNone(concept_of["ProfitLossForThePeriod"])
            self.assertNotIn("profit_after_tax", concept_of.values())
            # Earnings per share before extraordinary items is the second of two per-share pairs.
            self.assertIsNone(concept_of["BasicEarningsPerShareBeforeExtraordinaryItems"])

    def test_an_element_the_ind_as_map_also_has_reads_the_same_in_both(self):
        ind_as = load_map("in-capmkt/ind_as")
        for format_id, element_map in banking_maps().items():
            for entry in element_map.elements:
                shared = ind_as.entry(entry.element)
                if shared is not None:
                    self.assertEqual((entry.label, entry.concept, entry.statement),
                                     (shared.label, shared.concept, shared.statement), f"{format_id} {entry.element}")

    def test_every_per_share_label_is_found_by_stitchs_per_share_rule(self):
        for format_id, element_map in banking_maps().items():
            per_share = [entry for entry in element_map.elements if "PerShare" in entry.element]
            self.assertEqual(len(per_share), 4, format_id)
            for entry in element_map.elements:
                found = PER_SHARE.search(entry.label.lower()) is not None
                self.assertEqual(found, "PerShare" in entry.element, f"{format_id} {entry.label}")

    def test_the_ratios_the_bad_loans_and_the_segments_are_ignored(self):
        for format_id, element_map in banking_maps().items():
            for element in ("CET1Ratio", "AdditionalTier1Ratio", "ReturnOnAssets", "PercentageOfGrossNpa", "GrossNonPerformingAssets",
                            "NonPerformingAssets", "FaceValueOfEquityShareCapital", "SegmentRevenue"):
                self.assertIn(element, element_map.ignored, f"{format_id} {element}")


class ReadTests(unittest.TestCase):
    def test_a_banks_quarter_is_read_to_facts_and_every_sum_passes(self):
        r = read(instance(facts=bank_facts()))
        self.assertEqual((r.format.id, r.mapped, r.state, codes(r)), (CAPMKT, True, "complete", []))
        interest = fact(r, "InterestEarned", "OneD")
        self.assertEqual((interest.concept, interest.statement, interest.reported_label, interest.unit_label, interest.reported_value,
                          interest.normalized_value, interest.span), (
            "interest_earned", "income_statement", "Interest earned", "₹ lakh", "7630", "763000000", "quarter"))
        self.assertEqual(fact(r, "Deposits", "OneI").concept, "deposits")
        self.assertEqual(fact(r, "Deposits", "OneI").as_of_date.isoformat(), "2025-09-30")
        eps = fact(r, "BasicEarningsPerShareAfterExtraordinaryItems", "OneD")
        self.assertEqual((eps.concept, eps.unit_label, eps.normalized_value), ("eps_basic", "₹ a share", "12.34"))
        # the ratios and the bad loans are no line
        self.assertEqual({x.element for x in r.facts} & {"CET1Ratio", "GrossNonPerformingAssets"}, set())
        self.assertEqual(Counter(c.status for c in r.checks), Counter(passed=12))
        self.assertEqual(check(r, "Assets", "As at 30 Sep 2025", "balance_identity").status, "passed")
        before_tax = check(r, "ProfitLossFromOrdinaryActivitiesBeforeTax", "Quarter ended 30 Sep 2025")
        self.assertEqual((before_tax.status, before_tax.expected, before_tax.actual), ("passed", "2490", "2490"))

    def test_an_exceptional_charge_filed_positive_fails_the_sum_and_names_its_numbers(self):
        r = read(instance(facts=bank_facts(ExceptionalItems="80")))
        before_tax = check(r, "ProfitLossFromOrdinaryActivitiesBeforeTax", "Quarter ended 30 Sep 2025")
        # 2,830 − 260 + 80 = 2,650 against the 2,490 printed
        self.assertEqual((before_tax.status, before_tax.expected, before_tax.actual), ("failed", "2490", "2650"))

    def test_a_balance_sheet_that_does_not_balance_fails_the_identity(self):
        r = read(instance(facts=bank_facts(OtherAssets="1460", Assets="42660")))
        self.assertEqual(check(r, "Assets", "As at 30 Sep 2025").status, "passed")
        self.assertEqual(check(r, "Assets", "As at 30 Sep 2025", "balance_identity").status, "failed")

    def test_the_bse_family_reads_a_bank_the_same_way(self):
        r = read(instance(namespace=BSE_FIN, schema_ref="banking_entry_point_2019-09-30.xsd", facts=bank_facts()))
        self.assertEqual((r.format.id, r.mapped, codes(r)), (BSE, True, []))
        self.assertEqual(fact(r, "Advances", "OneI").reported_value, "29300")
        self.assertEqual({c.status for c in r.checks}, {"passed"})

    def test_a_banks_statements_are_found_and_no_unmapped_warning_is_given(self):
        c = classify_instance(parse(instance(facts=bank_facts())))
        self.assertEqual((c.kind, c.format.id, c.format.mapped), ("financial_results", CAPMKT, True))
        self.assertEqual([(s.statement, s.basis) for s in c.statements_found],
                         [("income_statement", "consolidated"), ("balance_sheet", "consolidated")])
        self.assertNotIn("XBRL_FORMAT_UNMAPPED", [w.code for w in c.warnings])


def banking_instances():
    return [path for path in real_instances() if detect_format(parse(path.read_bytes())).kind == "banking"]


@unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
class RealInstanceTests(unittest.TestCase):
    def test_every_banking_instance_reads_with_no_warning_and_no_failed_sum(self):
        paths = banking_instances()
        self.assertEqual(len(paths), 65)  # 49 in-capmkt and 16 in-bse-fin, four banks
        for path in paths:
            r = read(path.read_bytes())
            self.assertTrue(r.mapped, path.name)
            self.assertEqual(codes(r), [], path.name)
            self.assertGreater(len(r.facts), 0, path.name)
            self.assertEqual([c.subject_label for c in r.checks if c.status != "passed"], [], path.name)

    def test_every_banking_quarter_reads_its_interest_its_profit_and_its_earnings_per_share(self):
        for path in banking_instances():
            r = read(path.read_bytes())
            quarter = {x.concept for x in r.facts if x.span == "quarter"}
            for concept in ("interest_earned", "interest_expended", "total_income", "operating_profit_before_provisions",
                            "profit_before_tax", "profit_attributable_to_owners", "eps_basic"):
                self.assertIn(concept, quarter, f"{path.name}: {concept}")


if __name__ == "__main__":
    unittest.main()
