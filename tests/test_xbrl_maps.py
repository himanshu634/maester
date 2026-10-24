"""The element maps: their shape, their concepts and the statements an instance shows. Offline, except
the class gated on ``MAESTER_XBRL_DIR``, which reads the real instances and writes nothing."""

import os
import re
import unittest
from collections import defaultdict
from functools import lru_cache
from unittest import mock

from xbrl_fixtures import (
    BSE_FIN,
    IND_AS_MARKERS,
    f,
    identity_facts,
    instance,
    named_real_instances,
    parse,
    real_instances,
    real_instances_with_token,
)

from maester_eval.concepts import load_taxonomy
from pdf_financial_qa.classify.contracts import StatementFound
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION
from pdf_financial_qa.xbrl.classify import classify_instance
from pdf_financial_qa.xbrl.formats import MAPPED_FORMATS as DETECTED_AS_MAPPED
from pdf_financial_qa.xbrl.formats import detect_format
from pdf_financial_qa.xbrl.identity import read_identity
from pdf_financial_qa.xbrl.maps import MAPPED_FORMATS, STATEMENTS, ElementMap, load_map, map_file_name
from pdf_financial_qa.xbrl.units import rounding_of, unit_of

# Stitch's rule for a per-share line (apps/api/src/financials/stitch.ts), and the text it is matched on.
PER_SHARE = re.compile(r"earnings? per (equity )?share|\beps\b")
SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")
# The one proper noun a label holds: the banking results print "Cash and balances with the Reserve Bank of India".
PROPER_NOUN = "Reserve Bank of India"

CAPMKT, BSE = "in-capmkt/ind_as", "in-bse-fin/ind_as"
CAPMKT_BANKING, BSE_BANKING = "in-capmkt/banking", "in-bse-fin/banking"


def normalise(text: str) -> str:
    """``normalise`` of stitch.ts: lower case, ``&`` as a word, anything but a letter, a digit or a space as a space."""
    text = text.lower().replace("&", " and ")
    return " ".join("".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text).split())


def all_maps() -> dict[str, ElementMap]:
    """Every map: the rules of shape hold for each."""
    loaded = {format_id: load_map(format_id) for format_id in MAPPED_FORMATS}
    assert all(m is not None for m in loaded.values())
    return loaded  # type: ignore[return-value]


def maps() -> dict[str, ElementMap]:
    """The two Ind AS maps, which the Ind AS tests below are about. The banking maps have their own tests
    (``test_xbrl_banking.py``)."""
    return {format_id: element_map for format_id, element_map in all_maps().items() if format_id in (CAPMKT, BSE)}


def every_concept(element_map: ElementMap) -> list[str]:
    """The concepts a map gives, a cash balance's two included."""
    found = []
    for entry in element_map.elements:
        if entry.concept is not None:
            found.append(entry.concept)
        if entry.cash_balance is not None:
            found += [entry.cash_balance.opening_concept, entry.cash_balance.closing_concept]
    return found


class LoadTests(unittest.TestCase):
    def test_every_map_loads(self):
        self.assertEqual(MAPPED_FORMATS, (CAPMKT, BSE, CAPMKT_BANKING, BSE_BANKING))
        least = {CAPMKT: 150, BSE: 150, CAPMKT_BANKING: 100, BSE_BANKING: 100}
        for format_id, element_map in all_maps().items():
            self.assertEqual(element_map.format, format_id)
            self.assertGreater(len(element_map.elements), least[format_id], format_id)

    def test_a_map_is_read_from_a_file_named_for_its_format(self):
        self.assertEqual(map_file_name(CAPMKT), "in-capmkt.ind_as.json")
        self.assertEqual(map_file_name(BSE), "in-bse-fin.ind_as.json")
        self.assertEqual(map_file_name(CAPMKT_BANKING), "in-capmkt.banking.json")

    def test_a_map_is_read_once(self):
        self.assertIs(load_map(CAPMKT), load_map(CAPMKT))

    def test_a_format_with_no_map_has_none(self):
        for format_id in ("in-capmkt/nbfc", "in-bse-fin/nbfc", "in-capmkt/other_than_ind_as", "in-capmkt/unknown", "x/y"):
            self.assertIsNone(load_map(format_id), format_id)

    def test_the_formats_that_have_a_map_are_the_formats_detection_calls_mapped(self):
        self.assertEqual(set(MAPPED_FORMATS), set(DETECTED_AS_MAPPED))

    def test_the_maps_are_at_the_parsers_map_version(self):
        for format_id, element_map in all_maps().items():
            self.assertEqual(element_map.map_version, XBRL_MAP_VERSION, format_id)

    def test_the_entry_points_are_the_ones_the_maps_were_checked_on(self):
        self.assertEqual(maps()[CAPMKT].entry_points, ("in-capmkt-ent-2025-01-31.xsd", "in-capmkt-ent-2026-01-31.xsd"))
        self.assertEqual(maps()[BSE].entry_points, ("Ind-AS_entry_point_2020-03-31.xsd",))
        self.assertEqual(all_maps()[CAPMKT_BANKING].entry_points, ("in-capmkt-ent-2025-01-31.xsd", "in-capmkt-ent-2026-01-31.xsd"))
        self.assertEqual(all_maps()[BSE_BANKING].entry_points, ("banking_entry_point_2019-09-30.xsd",))

    def test_every_difference_between_entry_points_names_a_line_and_an_entry_point(self):
        for format_id, element_map in all_maps().items():
            for difference in element_map.entry_point_differences:
                self.assertIsNotNone(element_map.entry(difference.element), difference.element)
                self.assertIn(difference.only_in, element_map.entry_points)
                self.assertTrue(difference.note.strip())
        self.assertEqual(maps()[BSE].entry_point_differences, ())  # one entry point, nothing to differ from


class ShapeTests(unittest.TestCase):
    def test_every_concept_is_in_the_taxonomy_and_of_the_lines_statement(self):
        taxonomy = load_taxonomy()
        for format_id, element_map in all_maps().items():
            for entry in element_map.elements:
                concepts = [entry.concept] if entry.concept is not None else []
                if entry.cash_balance is not None:
                    concepts += [entry.cash_balance.opening_concept, entry.cash_balance.closing_concept]
                for concept_id in concepts:
                    concept = taxonomy.get(concept_id)
                    self.assertIsNotNone(concept, f"{format_id} {entry.element}: {concept_id}")
                    self.assertEqual(concept.family, entry.statement, f"{format_id} {entry.element}")

    def test_a_concept_is_given_to_one_element_only(self):
        for format_id, element_map in all_maps().items():
            concepts = every_concept(element_map)
            self.assertEqual(len(concepts), len(set(concepts)), format_id)

    def test_a_per_share_concept_is_on_a_per_share_element_and_the_other_way_round(self):
        taxonomy = load_taxonomy()
        for format_id, element_map in all_maps().items():
            for entry in element_map.elements:
                per_share_element = "PerShare" in entry.element
                per_share_concept = entry.concept is not None and taxonomy.get(entry.concept).kind == "per_share"
                if per_share_concept:
                    self.assertTrue(per_share_element, f"{format_id} {entry.element}")
                if entry.concept is not None and not per_share_element:
                    self.assertNotEqual(taxonomy.get(entry.concept).kind, "per_share", entry.element)

    def test_the_cash_balance_is_the_one_instant_the_cash_flow_prints_twice(self):
        for format_id, element_map in all_maps().items():
            balances = [entry for entry in element_map.elements if entry.cash_balance is not None]
            self.assertEqual([entry.element for entry in balances], ["CashAndCashEquivalentsCashFlowStatement"], format_id)
            (balance,) = balances
            self.assertEqual(balance.statement, "cash_flow")
            self.assertIsNone(balance.concept)
            self.assertEqual(balance.cash_balance.opening_concept, "cash_at_beginning_of_period")
            self.assertEqual(balance.cash_balance.closing_concept, "cash_at_end_of_period")
            lines = [entry.order for entry in element_map.elements if entry.statement == "cash_flow" and entry is not balance]
            self.assertLess(balance.cash_balance.opening_order, min(lines), format_id)
            self.assertGreater(balance.cash_balance.closing_order, max(lines), format_id)

    def test_a_statement_has_each_place_once(self):
        for format_id, element_map in all_maps().items():
            places = defaultdict(list)
            for entry in element_map.elements:
                if entry.cash_balance is None:
                    places[entry.statement].append(entry.order)
                else:
                    places[entry.statement] += [entry.cash_balance.opening_order, entry.cash_balance.closing_order]
            for statement, orders in places.items():
                self.assertEqual(len(orders), len(set(orders)), f"{format_id} {statement}")
                self.assertGreater(min(orders), 0, f"{format_id} {statement}")
            self.assertEqual(set(places), set(STATEMENTS), format_id)

    def test_the_lines_are_listed_in_the_order_of_their_places(self):
        for format_id, element_map in all_maps().items():
            for statement in STATEMENTS:
                orders = [entry.order for entry in element_map.elements if entry.statement == statement and entry.cash_balance is None]
                self.assertEqual(orders, sorted(orders), f"{format_id} {statement}")

    def test_an_element_is_a_line_or_ignored_and_never_both(self):
        for format_id, element_map in all_maps().items():
            elements = {entry.element for entry in element_map.elements}
            self.assertEqual(len(elements), len(element_map.elements), format_id)
            self.assertEqual(elements & element_map.ignored, set(), format_id)

    def test_a_line_has_one_label_in_its_statement(self):
        for format_id, element_map in all_maps().items():
            labels = [(entry.statement, entry.label) for entry in element_map.elements]
            self.assertEqual(len(labels), len(set(labels)), format_id)

    def test_labels_are_in_sentence_case(self):
        for format_id, element_map in all_maps().items():
            for entry in element_map.elements:
                labels = [entry.label]
                if entry.cash_balance is not None:
                    labels += [entry.cash_balance.opening_label, entry.cash_balance.closing_label]
                for label in labels:
                    self.assertTrue(label[0].isupper(), f"{format_id} {entry.element}")
                    # Only the first word of a label is capitalised: no title case, no all-caps words. A proper
                    # noun keeps its capitals.
                    words = label.replace(PROPER_NOUN, "").split()[1:]
                    self.assertFalse(any(word[0].isupper() for word in words), f"{format_id} {label}")

    def test_every_per_share_label_is_found_by_stitchs_per_share_rule(self):
        count = 0
        for format_id, element_map in maps().items():
            for entry in element_map.elements:
                if "PerShare" in entry.element:
                    self.assertIsNotNone(PER_SHARE.search(normalise(entry.label)), f"{format_id} {entry.label}")
                    self.assertIsNotNone(PER_SHARE.search(normalise(entry.section)), f"{format_id} {entry.section}")
                    count += 1
                else:
                    self.assertIsNone(PER_SHARE.search(normalise(entry.label)), f"{format_id} {entry.label}")
        self.assertEqual(count, 12)  # six per-share lines in each Ind AS map

    def test_the_headline_lines_have_their_concepts(self):
        for format_id, element_map in maps().items():
            concept_of = {entry.element: entry.concept for entry in element_map.elements}
            self.assertEqual(concept_of["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations"], "eps_basic")
            self.assertEqual(concept_of["DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations"], "eps_diluted")
            self.assertEqual(concept_of["RevenueFromOperations"], "revenue_from_operations")
            self.assertEqual(concept_of["ProfitLossForPeriod"], "profit_after_tax")
            self.assertEqual(concept_of["Assets"], "total_assets")
            self.assertEqual(concept_of["EquityAndLiabilities"], "total_equity_and_liabilities")
            self.assertEqual(concept_of["CashFlowsFromUsedInOperatingActivities"], "net_cash_from_operating_activities")
            # the lines that are one fact printed twice have a concept once: the net-of-tax line, and interest paid
            # as the financing line, which 268 of 285 cash flows fill
            self.assertEqual(concept_of["OtherComprehensiveIncomeNetOfTaxes"], "other_comprehensive_income")
            self.assertEqual(concept_of["InterestPaidClassifiedAsFinancingActivities"], "interest_paid")
            self.assertIsNone(concept_of["InterestPaidClassifiedAsOperatingActivities"])
            self.assertIn("OtherComprehensiveIncome", maps()[CAPMKT].ignored)

    def test_the_two_maps_differ_by_what_each_format_holds(self):
        capmkt, bse = maps()[CAPMKT], maps()[BSE]
        capmkt_lines = {entry.element for entry in capmkt.elements}
        bse_lines = {entry.element for entry in bse.elements}
        self.assertEqual(bse_lines - capmkt_lines, {
            # in-bse-fin spells two tax elements with a typo, and has a lease line the other lacks
            "IncomeTaxRelatingToItmesThatWillBeReclassifiedToProfitOrLoss",
            "IncomeTaxRelatingToItmesThatWillNotBeReclassifiedToProfitOrLoss",
            "PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities",
        })
        self.assertEqual(capmkt_lines - bse_lines, {
            "IncomeTaxRelatingToItemsThatWillBeReclassifiedToProfitOrLoss",
            "IncomeTaxRelatingToItemsThatWillNotBeReclassifiedToProfitOrLoss",
            "ReserveExcludingRevaluationReserves",
            "TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterpriseCurrent",
            "TotalOutstandingDuesOfMicroEnterpriseAndSmallEnterpriseNoncurrent",
            "TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseCurrent",
            "TotalOutstandingDuesOfCreditorsOtherThanMicroEnterpriseAndSmallEnterpriseNoncurrent",
        })
        self.assertEqual(capmkt.ignored - bse.ignored, {
            "AmountOfDefaultOutOfTotalOutstandingAmountOfLoansOrRevolvingFacilitiesAtTheEndOfPeriod",
            "AmountOfDefaultOutOfTotalOutstandingAmountOfUnlistedDebtSecuritiesAtTheEndOfPeriod",
            "AmountOfRelatedPartyTransactionDuringTheReportingPeriod",
            "AmountOfTotalFinancialIndebtednessOfTheListedEntityIncludingShortTermAndLongTermDebtAtTheEndOfPeriod",
            "NumberOfStatementsOfDeviationForTheCurrentQuarter",
            "OtherComprehensiveIncome",
            "TotalOutstandingAmountOfLoansOrRevolvingFacilitiesAtTheEndOfPeriod",
            "TotalOutstandingAmountOfUnlistedDebtSecuritiesAtTheEndOfPeriod",
        })
        self.assertEqual(bse.ignored - capmkt.ignored, set())

    def test_the_ratios_and_the_face_value_are_ignored_in_both(self):
        for format_id, element_map in maps().items():
            for element in ("FaceValueOfEquityShareCapital", "DebtEquityRatio", "DebtServiceCoverageRatio", "InterestServiceCoverageRatio"):
                self.assertIn(element, element_map.ignored, f"{format_id} {element}")


def required_sums() -> dict[str, tuple[str, list[tuple[str, int]]]]:
    """The sums the brief names, by id: total and parts with signs."""
    return {
        "income": ("Income", [("RevenueFromOperations", 1), ("OtherIncome", 1)]),
        "expenses": ("Expenses", [
            ("CostOfMaterialsConsumed", 1), ("PurchasesOfStockInTrade", 1),
            ("ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade", 1), ("EmployeeBenefitExpense", 1),
            ("FinanceCosts", 1), ("DepreciationDepletionAndAmortisationExpense", 1), ("OtherExpenses", 1)]),
        "profit_before_exceptional_items_and_tax": ("ProfitBeforeExceptionalItemsAndTax", [("Income", 1), ("Expenses", -1)]),
        "equity_and_liabilities": ("EquityAndLiabilities", [("Equity", 1), ("Liabilities", 1)]),
        "net_change_in_cash": ("IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges", [
            ("CashFlowsFromUsedInOperatingActivities", 1), ("CashFlowsFromUsedInInvestingActivities", 1),
            ("CashFlowsFromUsedInFinancingActivities", 1)]),
    }


class SumTests(unittest.TestCase):
    def test_the_sums_the_maps_must_hold(self):
        for format_id, element_map in maps().items():
            by_id = {total.id: total for total in element_map.sums}
            for sum_id, (total, parts) in required_sums().items():
                self.assertIn(sum_id, by_id, f"{format_id} {sum_id}")
                self.assertEqual(by_id[sum_id].total, total, f"{format_id} {sum_id}")
                self.assertEqual([(part.element, part.sign) for part in by_id[sum_id].parts], parts, f"{format_id} {sum_id}")

    def test_assets_are_the_two_halves_and_what_sits_outside_them(self):
        for format_id, element_map in maps().items():
            (assets,) = [total for total in element_map.sums if total.id == "assets"]
            self.assertEqual(assets.total, "Assets")
            parts = [part.element for part in assets.parts]
            self.assertEqual(parts[:2], ["NoncurrentAssets", "CurrentAssets"], format_id)
            # held for sale and the regulatory deferral balance are in neither half: with the two halves alone 59 of the 284
            # in-capmkt balance sheets do not add up, with held for sale added 6 do not, and with all four none
            self.assertEqual(parts[2:], ["NoncurrentAssetsClassifiedAsHeldForSale",
                                         "RegulatoryDeferralAccountDebitBalancesAndRelatedDeferredTaxAssets"], format_id)

    def test_the_balance_identity(self):
        for format_id, element_map in maps().items():
            self.assertEqual([(i.id, i.left, i.right) for i in element_map.identities],
                             [("balance", "Assets", "EquityAndLiabilities")], format_id)
            for identity in element_map.identities:
                self.assertIsNotNone(element_map.entry(identity.left))
                self.assertIsNotNone(element_map.entry(identity.right))

    def test_every_element_of_a_sum_is_a_line_of_the_map(self):
        for format_id, element_map in all_maps().items():
            for total in element_map.sums:
                self.assertIsNotNone(element_map.entry(total.total), f"{format_id} {total.id}")
                self.assertTrue(total.parts, f"{format_id} {total.id}")
                for part in total.parts:
                    self.assertIsNotNone(element_map.entry(part.element), f"{format_id} {total.id}: {part.element}")
                    self.assertIn(part.sign, (1, -1))
                    self.assertNotIn(part.element, element_map.ignored)

    def test_a_sum_has_a_snake_case_id_a_total_of_its_own_and_parts_listed_once(self):
        for format_id, element_map in all_maps().items():
            ids = [total.id for total in element_map.sums]
            totals = [total.total for total in element_map.sums]
            self.assertEqual(len(ids), len(set(ids)), format_id)
            self.assertEqual(len(totals), len(set(totals)), f"{format_id}: a total has one sum")
            for total in element_map.sums:
                self.assertRegex(total.id, SNAKE)
                parts = [part.element for part in total.parts]
                self.assertEqual(len(parts), len(set(parts)), f"{format_id} {total.id}")
                self.assertNotIn(total.total, parts)

    def test_a_sum_adds_lines_of_one_statement(self):
        for format_id, element_map in all_maps().items():
            for total in element_map.sums:
                statements = {element_map.entry(total.total).statement} | {element_map.entry(p.element).statement for p in total.parts}
                self.assertEqual(len(statements), 1, f"{format_id} {total.id}")

    def test_the_bse_sums_use_the_spelling_the_bse_instances_use(self):
        (oci,) = [total for total in maps()[BSE].sums if total.id == "other_comprehensive_income"]
        self.assertEqual([part.element for part in oci.parts], [
            "AmountOfItemThatWillNotBeReclassifiedToProfitAndLoss",
            "IncomeTaxRelatingToItmesThatWillNotBeReclassifiedToProfitOrLoss",
            "AmountOfItemThatWillBeReclassifiedToProfitAndLoss",
            "IncomeTaxRelatingToItmesThatWillBeReclassifiedToProfitOrLoss"])
        (oci,) = [total for total in maps()[CAPMKT].sums if total.id == "other_comprehensive_income"]
        self.assertIn("IncomeTaxRelatingToItemsThatWillBeReclassifiedToProfitOrLoss", [part.element for part in oci.parts])

    def test_the_sums_of_the_lines_a_format_lacks_leave_those_lines_out(self):
        self.assertIn("trade_payables_current", {total.id for total in maps()[CAPMKT].sums})
        self.assertNotIn("trade_payables_current", {total.id for total in maps()[BSE].sums})
        (financing,) = [t for t in maps()[BSE].sums if t.id == "net_cash_from_financing_activities"]
        self.assertIn("PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities", [p.element for p in financing.parts])
        (financing,) = [t for t in maps()[CAPMKT].sums if t.id == "net_cash_from_financing_activities"]
        self.assertNotIn("PaymentsOfFinanceLeaseLiabilitiesClassifiedAsFinancingActivities", [p.element for p in financing.parts])

    def test_a_paid_amount_is_taken_off_in_each_cash_flow_total(self):
        for element_map in maps().values():
            sign_of = {part.element: part.sign for total in element_map.sums for part in total.parts if total.id.startswith("net_cash_from")}
            self.assertEqual(sign_of["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], -1)
            self.assertEqual(sign_of["ProceedsFromSalesOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], 1)
            self.assertEqual(sign_of["IncomeTaxesPaidRefundClassifiedAsOperatingActivities"], -1)
            self.assertEqual(sign_of["InterestPaidClassifiedAsFinancingActivities"], -1)
            self.assertEqual(sign_of["DividendsPaidClassifiedAsFinancingActivities"], -1)


class LookupTests(unittest.TestCase):
    def test_entry(self):
        entry = maps()[CAPMKT].entry("RevenueFromOperations")
        self.assertEqual(
            (entry.statement, entry.section, entry.label, entry.concept, entry.cash_balance),
            ("income_statement", "Income", "Revenue from operations", "revenue_from_operations", None),
        )
        self.assertEqual(maps()[CAPMKT].entry("Assets").statement, "balance_sheet")
        self.assertEqual(maps()[CAPMKT].entry("CashFlowsFromUsedInOperatingActivities").statement, "cash_flow")

    def test_an_ignored_element_and_an_unknown_one_are_no_entry(self):
        self.assertIsNone(maps()[CAPMKT].entry("FaceValueOfEquityShareCapital"))
        self.assertIsNone(maps()[CAPMKT].entry("NoSuchElement"))

    def test_sums_with_total(self):
        (total,) = maps()[CAPMKT].sums_with_total("Income")
        self.assertEqual((total.id, total.total), ("income", "Income"))
        self.assertEqual(maps()[CAPMKT].sums_with_total("RevenueFromOperations"), [])

    def test_parts_of_and_their_labels(self):
        self.assertEqual(maps()[CAPMKT].parts_of("Income"), ["RevenueFromOperations", "OtherIncome"])
        self.assertEqual(maps()[CAPMKT].labels_of_parts("Income"), ["Revenue from operations", "Other income"])
        self.assertEqual(maps()[CAPMKT].parts_of("Equity"), ["EquityAttributableToOwnersOfParent", "NonControllingInterest"])
        self.assertEqual(maps()[CAPMKT].parts_of("RevenueFromOperations"), [])
        self.assertEqual(maps()[CAPMKT].labels_of_parts("RevenueFromOperations"), [])
        self.assertEqual(len(maps()[CAPMKT].parts_of("Expenses")), 7)

    def test_a_map_is_frozen(self):
        with self.assertRaises(Exception):
            maps()[CAPMKT].format = "other"  # type: ignore[misc]


class StatementsFoundTests(unittest.TestCase):
    def classify(self, facts, **kwargs):
        return classify_instance(parse(instance(facts=facts, **kwargs)))

    def found(self, *lines, basis="Consolidated", **kwargs):
        c = self.classify(identity_facts(basis=basis) + IND_AS_MARKERS + list(lines), **kwargs)
        return [(s.statement, s.basis, s.pages) for s in c.statements_found]

    def test_profit_and_loss_and_balance_sheet_lines_with_no_cash_flow_line(self):
        c = self.classify(identity_facts() + IND_AS_MARKERS + [f("RevenueFromOperations"), f("Assets", "OneI"), f("Equity", "OneI")])
        self.assertEqual(c.statements_found, [
            StatementFound(statement="income_statement", basis="consolidated", pages=[]),
            StatementFound(statement="balance_sheet", basis="consolidated", pages=[]),
        ])

    def test_the_order_is_income_statement_balance_sheet_cash_flow_whatever_the_order_of_the_facts(self):
        found = self.found(f("CashFlowsFromUsedInOperatingActivities"), f("Assets", "OneI"), f("RevenueFromOperations"))
        self.assertEqual([statement for statement, _, _ in found], ["income_statement", "balance_sheet", "cash_flow"])

    def test_a_cash_balance_is_a_cash_flow_line(self):
        found = self.found(f("CashAndCashEquivalentsCashFlowStatement", "OneI"))
        self.assertEqual([statement for statement, _, _ in found], ["income_statement", "cash_flow"])

    def test_the_statements_have_the_basis_of_the_instance_and_no_pages(self):
        self.assertEqual(self.found(f("Assets", "OneI"), basis="Standalone"),
                         [("income_statement", "standalone", []), ("balance_sheet", "standalone", [])])
        self.assertEqual(self.found(f("Assets", "OneI"), basis=None),
                         [("income_statement", "unknown", []), ("balance_sheet", "unknown", [])])

    def test_a_fact_with_a_member_is_no_line(self):
        self.assertEqual(self.found(f("Assets", "OneExpenses1D")), [("income_statement", "consolidated", [])])

    def test_an_ignored_element_is_no_line(self):
        found = self.found(f("SegmentAssets", "OneI"), f("DebtEquityRatio"), f("FaceValueOfEquityShareCapital"))
        self.assertEqual(found, [("income_statement", "consolidated", [])])

    def test_a_nil_fact_a_text_fact_and_an_empty_one_are_no_figure(self):
        self.assertEqual(self.found(f("Assets", "OneI", text=None)), [("income_statement", "consolidated", [])])
        self.assertEqual(self.found(("Assets", "OneI", None, None, "a note")), [("income_statement", "consolidated", [])])
        self.assertEqual(self.found(f("Assets", "OneI", text="  ")), [("income_statement", "consolidated", [])])

    def test_a_fact_in_a_context_the_file_does_not_declare_is_no_line(self):
        self.assertEqual(self.found(f("Assets", "NoSuchContext")), [("income_statement", "consolidated", [])])

    def test_the_bse_family_finds_statements_the_same_way(self):
        c = self.classify(identity_facts() + IND_AS_MARKERS + [f("Assets", "OneI")], namespace=BSE_FIN, schema_ref="x.xsd")
        self.assertEqual([s.statement for s in c.statements_found], ["income_statement", "balance_sheet"])

    def test_a_format_with_no_map_finds_none(self):
        nbfc = self.classify(identity_facts() + [f("InterestEarned"), f("FeesAndCommissionIncome"), f("Assets", "OneI")])
        self.assertEqual((nbfc.format.id, nbfc.statements_found), ("in-capmkt/nbfc", []))
        unknown = self.classify(identity_facts() + [f("Assets", "OneI")])
        self.assertEqual((unknown.format.id, unknown.statements_found), ("in-capmkt/unknown", []))
        no_family = self.classify(identity_facts() + IND_AS_MARKERS + [f("Assets", "OneI")], namespace="http://example.org/x")
        self.assertEqual((no_family.format.id, no_family.statements_found), (None, []))


class NamedInstanceTests(unittest.TestCase):
    def test_without_a_folder_there_are_none(self):
        with mock.patch.dict(os.environ, {"MAESTER_XBRL_DIR": ""}):
            self.assertEqual(named_real_instances(), {CAPMKT: [], BSE: []})

    @unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
    def test_the_named_instances_are_the_ones_the_brief_asks_for_and_the_same_every_time(self):
        named = named_real_instances()
        self.assertEqual(named, named_real_instances())
        self.assertEqual([re.search(r"_(MC|SH|JQ|MQ)\d{4}", p.name).group(1) for p in named[CAPMKT]], ["MC", "SH", "JQ", "MQ"])
        self.assertEqual([re.search(r"_(SQ|DQ)\d{4}", p.name).group(1) for p in named[BSE]], ["SQ", "SQ", "DQ"])
        self.assertEqual(len({p for paths in named.values() for p in paths}), 7)
        for format_id, paths in named.items():
            for path in paths:
                self.assertEqual(detect_format(parse(path.read_bytes())).id, format_id, path.name)


@lru_cache(maxsize=1)
def real_facts() -> tuple[dict[str, set[str]], dict[str, list[str]], dict[str, int]]:
    """Over every real instance of a mapped format, once: the numeric elements without a member by format, the
    mapped elements whose unit is neither money nor money per share (as ``element in file name``), and how many
    facts of mapped elements were looked at."""
    elements: dict[str, set[str]] = {format_id: set() for format_id in MAPPED_FORMATS}
    bad_units: dict[str, list[str]] = {format_id: [] for format_id in MAPPED_FORMATS}
    looked_at = {format_id: 0 for format_id in MAPPED_FORMATS}
    for path in real_instances():
        inst = parse(path.read_bytes())
        format_id = detect_format(inst).id
        if format_id not in MAPPED_FORMATS:
            continue
        element_map = load_map(format_id)
        rounding = rounding_of(read_identity(inst, detect_format(inst).family).rounding_word)
        for fact in inst.facts:
            context = inst.contexts.get(fact.context_id)
            if fact.unit_id is None or context is None or context.dimensional:
                continue
            elements[format_id].add(fact.element)
            if element_map.entry(fact.element) is not None:
                looked_at[format_id] += 1
                if unit_of(inst.units[fact.unit_id], rounding).kind == "other":
                    bad_units[format_id].append(f"{fact.element} in {path.name}")
    return elements, bad_units, looked_at


@unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
class RealInstanceTests(unittest.TestCase):
    def test_every_element_of_a_map_occurs_in_a_real_instance_of_its_format(self):
        elements, _, _ = real_facts()
        for format_id, element_map in all_maps().items():
            self.assertGreater(len(elements[format_id]), 0, format_id)  # a gated test that read nothing proves nothing
            mentioned = {entry.element for entry in element_map.elements} | set(element_map.ignored)
            mentioned |= {t.total for t in element_map.sums} | {p.element for t in element_map.sums for p in t.parts}
            mentioned |= {i.left for i in element_map.identities} | {i.right for i in element_map.identities}
            self.assertEqual(sorted(mentioned - elements[format_id]), [], format_id)

    def test_every_numeric_element_of_a_real_instance_is_a_line_or_ignored(self):
        # So XBRL_ELEMENT_UNMAPPED fires on none of the files on hand.
        elements, _, _ = real_facts()
        for format_id, element_map in all_maps().items():
            known = {entry.element for entry in element_map.elements} | set(element_map.ignored)
            self.assertEqual(sorted(elements[format_id] - known), [], format_id)

    def test_every_fact_of_a_mapped_element_has_a_monetary_or_per_share_unit(self):
        # So XBRL_UNIT_UNSUPPORTED fires on none of the files on hand.
        _, bad_units, looked_at = real_facts()
        for format_id in MAPPED_FORMATS:
            self.assertGreater(looked_at[format_id], 1000, format_id)
            self.assertEqual(bad_units[format_id][:5], [], format_id)

    def test_every_real_instance_of_a_mapped_format_shows_its_income_statement(self):
        count = 0
        for path, _ in real_instances_with_token():
            c = classify_instance(parse(path.read_bytes()))
            if c.format.mapped:
                self.assertEqual(c.statements_found[0].statement, "income_statement", path.name)
                self.assertEqual({s.basis for s in c.statements_found}, {c.basis}, path.name)
                count += 1
            else:
                self.assertEqual(c.statements_found, [], path.name)
        self.assertEqual(count, 789)  # 550 in-capmkt and 174 in-bse-fin Ind AS instances, 49 and 16 banking

    def test_the_named_instances_show_the_statements_their_period_has(self):
        named = named_real_instances()
        for format_id, paths in named.items():
            self.assertTrue(paths, format_id)
        shown = {p.name: [s.statement for s in classify_instance(parse(p.read_bytes())).statements_found] for ps in named.values() for p in ps}
        by_token = {re.search(r"_(MC|SH|JQ|MQ|SQ|DQ)\d{4}", name).group(1) + ("-bse" if "Main_Ind_As" in name else ""): s for name, s in shown.items()}
        for token in ("MC", "SH", "MQ", "SQ-bse"):
            self.assertEqual(by_token[token], ["income_statement", "balance_sheet", "cash_flow"], token)
        # the first quarter and the 3-month DQ file hold the profit and loss only
        self.assertEqual(by_token["JQ"], ["income_statement"])
        self.assertEqual(by_token["DQ-bse"], ["income_statement"])


if __name__ == "__main__":
    unittest.main()
