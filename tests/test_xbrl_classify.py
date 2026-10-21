"""Format, identity, periods and units: the answers of a classify read. Offline, except the gated class."""

import os
import unittest
from datetime import date
from decimal import Decimal

from xbrl_fixtures import (
    BSE_FIN,
    IND_AS_MARKERS,
    ContextSpec,
    f,
    identity_facts,
    instance,
    parse,
    real_instances_with_period_token,
    real_instances_with_token,
)

from pdf_financial_qa.classify.contracts import StatementFound
from pdf_financial_qa.xbrl.classify import XbrlClassificationData, XbrlEvidenceData, classify_instance
from pdf_financial_qa.xbrl.formats import XbrlFormat, detect_format, family_of
from pdf_financial_qa.xbrl.identity import read_identity
from pdf_financial_qa.xbrl.parser import Unit
from pdf_financial_qa.xbrl.periods import period_label, span_of, to_results_span
from pdf_financial_qa.xbrl.units import Rounding, UnitInfo, rounding_of, unit_of

# The file-name token of a real instance, and the format its elements must give.
EXPECTED = {
    "Integrated_Finance_Ind_As": "in-capmkt/ind_as",
    "Main_Ind_As": "in-bse-fin/ind_as",
    "IFBanking": "in-capmkt/banking",
    "Banking": "in-bse-fin/banking",
    "Integrated_Finance_NBFC": "in-capmkt/nbfc",
    "NBFC": "in-bse-fin/nbfc",
    "IFOtherthan": "in-capmkt/other_than_ind_as",
}


def only(facts, element, **changes):
    """``facts`` with the one fact named ``element`` changed: its text, context or unit."""
    out = []
    for fact in facts:
        if fact[0] == element:
            name, context, unit, decimals, text = fact
            fact = (name, changes.get("context", context), unit, decimals, changes.get("text", text))
        out.append(fact)
    return out


class PeriodTests(unittest.TestCase):
    def test_span_of(self):
        self.assertEqual([span_of(date(2025, 7, 1), date(2025, 9, 30)), span_of(date(2025, 4, 1), date(2025, 9, 30)),
                          span_of(date(2025, 4, 1), date(2025, 12, 31)), span_of(date(2025, 4, 1), date(2026, 3, 31)),
                          span_of(date(2025, 1, 1), date(2025, 12, 31)), span_of(date(2025, 4, 1), date(2025, 7, 31)),
                          span_of(date(2025, 4, 2), date(2025, 6, 30))],
                         ["quarter", "half_year", "nine_months", "year", "year", "other", "other"])

    def test_span_of_counts_whole_calendar_months(self):
        self.assertEqual(span_of(date(2024, 1, 1), date(2024, 3, 31)), "quarter")
        self.assertEqual(span_of(date(2023, 12, 1), date(2024, 2, 29)), "quarter")  # ends on a leap day
        self.assertEqual(span_of(date(2023, 12, 1), date(2024, 2, 28)), "other")    # 28 Feb 2024 is not a month end
        self.assertEqual(span_of(date(2025, 4, 1), date(2025, 4, 30)), "other")     # one month
        self.assertEqual(span_of(date(2025, 4, 1), date(2027, 3, 31)), "other")     # twenty-four months
        self.assertEqual(span_of(date(2025, 10, 1), date(2025, 9, 30)), "other")    # ends before it starts

    def test_period_label(self):
        self.assertEqual(period_label("quarter", date(2025, 9, 30)), "Quarter ended 30 Sep 2025")
        self.assertEqual(period_label("year", date(2026, 3, 31)), "Year ended 31 Mar 2026")
        self.assertEqual(period_label(None, date(2025, 3, 1)), "As at 1 Mar 2025")

    def test_every_period_label(self):
        self.assertEqual(period_label("half_year", date(2025, 9, 30)), "Half year ended 30 Sep 2025")
        self.assertEqual(period_label("nine_months", date(2025, 12, 31)), "Nine months ended 31 Dec 2025")
        self.assertEqual(period_label("other", date(2025, 9, 30)), "Period ended 30 Sep 2025")
        months = [period_label(None, date(2025, month, 5)) for month in range(1, 13)]
        self.assertEqual([m.split()[3] for m in months],
                         ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])

    def test_to_results_span(self):
        self.assertEqual([to_results_span(s) for s in ("quarter", "half_year", "nine_months", "year", "other", None)],
                         ["quarter", "half_year", "nine_months", "full_year", None, None])


class UnitTests(unittest.TestCase):
    def test_rounding_words(self):
        self.assertEqual(rounding_of("Crores"), Rounding("Crores", "₹ crore", Decimal("10000000"), -7))
        self.assertEqual(rounding_of("lakhs").exponent, -5)
        self.assertIsNone(rounding_of("Hundreds"))

    def test_every_rounding_word(self):
        table = {"Crores": ("₹ crore", "10000000", -7), "Lakhs": ("₹ lakh", "100000", -5),
                 "Millions": ("₹ million", "1000000", -6), "Thousands": ("₹ thousand", "1000", -3),
                 "Billions": ("₹ billion", "1000000000", -9), "Actual": ("₹", "1", 0)}
        for word, (label, scale, exponent) in table.items():
            self.assertEqual(rounding_of(word), Rounding(word, label, Decimal(scale), exponent), word)
            self.assertEqual(rounding_of(word.upper()), rounding_of(word))

    def test_rounding_of_trims_and_refuses_what_is_not_a_word(self):
        self.assertEqual(rounding_of("  lakhs\n"), rounding_of("Lakhs"))
        self.assertEqual([rounding_of(w) for w in (None, "", "  ", "Lakh", "In Crores")], [None] * 5)

    def test_units(self):
        lakh = rounding_of("Lakhs")
        self.assertEqual(unit_of(Unit("INR", ("iso4217:INR",), ()), lakh), UnitInfo("monetary", "₹ lakh", Decimal("100000"), "INR"))
        self.assertEqual(unit_of(Unit("INRPerShare", ("iso4217:INR",), ("xbrli:shares",)), lakh), UnitInfo("per_share", "₹ a share", Decimal("1"), "INR"))
        self.assertEqual(unit_of(Unit("INR", ("iso4217:INR",), ()), None), UnitInfo("monetary", None, None, "INR"))
        self.assertEqual(unit_of(Unit("pure", ("xbrli:pure",), ()), lakh), UnitInfo("other", None, None, None))

    def test_a_per_share_unit_needs_no_rounding(self):
        self.assertEqual(unit_of(Unit("INRPerShare", ("iso4217:INR",), ("xbrli:shares",)), None),
                         UnitInfo("per_share", "₹ a share", Decimal("1"), "INR"))

    def test_another_currency_starts_its_label_with_the_iso_code(self):
        crore = rounding_of("Crores")
        self.assertEqual(unit_of(Unit("USD", ("iso4217:USD",), ()), crore), UnitInfo("monetary", "USD crore", Decimal("10000000"), "USD"))
        self.assertEqual(unit_of(Unit("USD", ("iso4217:USD",), ()), rounding_of("Actual")), UnitInfo("monetary", "USD", Decimal("1"), "USD"))
        self.assertEqual(unit_of(Unit("USDps", ("iso4217:USD",), ("xbrli:shares",)), crore), UnitInfo("per_share", "USD a share", Decimal("1"), "USD"))

    def test_any_other_shape_of_unit_is_other(self):
        lakh = rounding_of("Lakhs")
        other = UnitInfo("other", None, None, None)
        for unit in (Unit("shares", ("xbrli:shares",), ()),
                     Unit("INRsq", ("iso4217:INR", "iso4217:INR"), ()),
                     Unit("INRPerPure", ("iso4217:INR",), ("xbrli:pure",)),
                     Unit("INRPerTwo", ("iso4217:INR",), ("xbrli:shares", "xbrli:shares")),
                     Unit("PerINR", ("xbrli:shares",), ("iso4217:INR",)),
                     Unit("none", (), ())):
            self.assertEqual(unit_of(unit, lakh), other, unit.id)


class FormatTests(unittest.TestCase):
    def test_formats_from_elements(self):
        self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS))).id, "in-capmkt/ind_as")
        self.assertEqual(detect_format(parse(instance(namespace=BSE_FIN, facts=IND_AS_MARKERS))).id, "in-bse-fin/ind_as")
        self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS + [("CET1Ratio", "OneI", "pure", "INF", "0.15")]))).kind, "banking")
        self.assertEqual(detect_format(parse(instance(facts=[f("InterestEarned"), f("FeesAndCommissionIncome")]))).kind, "nbfc")
        self.assertEqual(detect_format(parse(instance(namespace="http://example.com/x", facts=IND_AS_MARKERS))), XbrlFormat(None, "unknown", None, False))

    def test_only_the_two_ind_as_formats_are_mapped(self):
        self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS))), XbrlFormat("in-capmkt", "ind_as", "in-capmkt/ind_as", True))
        self.assertEqual(detect_format(parse(instance(namespace=BSE_FIN, facts=IND_AS_MARKERS))), XbrlFormat("in-bse-fin", "ind_as", "in-bse-fin/ind_as", True))
        banking = detect_format(parse(instance(facts=[f("AdditionalTier1Ratio", unit="pure")])))
        self.assertEqual(banking, XbrlFormat("in-capmkt", "banking", "in-capmkt/banking", False))

    def test_the_rules_are_ordered_and_the_first_match_wins(self):
        both = [f("CET1Ratio", unit="pure"), f("InterestEarned"), f("FeesAndCommissionIncome")] + IND_AS_MARKERS
        self.assertEqual(detect_format(parse(instance(facts=both))).kind, "banking")
        other = [f("AdjustmentsForWorkingCapital")] + IND_AS_MARKERS
        self.assertEqual(detect_format(parse(instance(facts=other))).kind, "other_than_ind_as")

    def test_a_family_with_no_matching_rule_is_unknown_and_unmapped(self):
        self.assertEqual(detect_format(parse(instance(facts=[f("OtherIncome")]))), XbrlFormat("in-capmkt", "unknown", "in-capmkt/unknown", False))
        # one of the two Ind AS markers is not enough, and nor is half of the NBFC pair
        self.assertEqual(detect_format(parse(instance(facts=IND_AS_MARKERS[:1]))).kind, "unknown")
        self.assertEqual(detect_format(parse(instance(facts=[f("InterestEarned")]))).kind, "unknown")

    def test_rules_look_at_numeric_facts_only(self):
        # an element of a rule that is written as text (no unit) says nothing about the shape
        facts = [("CET1Ratio", "OneD", None, None, "0.15")] + IND_AS_MARKERS
        self.assertEqual(detect_format(parse(instance(facts=facts))).kind, "ind_as")

    def test_family_of(self):
        self.assertEqual(family_of(parse(instance(facts=IND_AS_MARKERS))), "in-capmkt")
        self.assertEqual(family_of(parse(instance(namespace=BSE_FIN))), "in-bse-fin")
        self.assertEqual(family_of(parse(instance(namespace="http://www.sebi.gov.in/xbrl/2026-01-31/in-capmkt"))), "in-capmkt")
        self.assertIsNone(family_of(parse(instance(namespace="http://example.com/x"))))
        self.assertIsNone(family_of(parse(instance(namespace="http://www.sebi.gov.in/xbrl/2025-01-31/in-capmkt-x"))))

    def test_facts_in_two_namespaces_have_no_family(self):
        data = instance(facts=IND_AS_MARKERS).replace(
            b"<in-capmkt:ComprehensiveIncomeForThePeriod", b"<xbrli:ComprehensiveIncomeForThePeriod", 1
        ).replace(b"</in-capmkt:ComprehensiveIncomeForThePeriod", b"</xbrli:ComprehensiveIncomeForThePeriod", 1)
        inst = parse(data)
        self.assertEqual(len({fact.namespace for fact in inst.facts}), 2)
        self.assertIsNone(family_of(inst))
        self.assertEqual(detect_format(inst), XbrlFormat(None, "unknown", None, False))

    def test_an_instance_with_no_facts_has_no_family(self):
        self.assertIsNone(family_of(parse(instance(rounding=None))))


class IdentityTests(unittest.TestCase):
    def read(self, facts, **kwargs):
        inst = parse(instance(facts=facts, **kwargs))
        return read_identity(inst, family_of(inst))

    def test_the_identity(self):
        identity = self.read(identity_facts())
        self.assertEqual((identity.name, identity.scrip_code, identity.symbol, identity.isin),
                         ("SYNTHETIC CEMENTS LIMITED", "500999", "SYNCEM", "INE999Z01011"))
        self.assertEqual((identity.basis, identity.mixed_basis, identity.audited), ("consolidated", False, None))
        self.assertEqual((identity.period_start, identity.period_end, identity.rounding_word), (date(2025, 7, 1), date(2025, 9, 30), "Lakhs"))

    def test_the_rounding_element_follows_the_family(self):
        self.assertEqual(self.read(identity_facts(), namespace=BSE_FIN).rounding_word, "Lakhs")
        self.assertIsNone(self.read(identity_facts(), rounding=None).rounding_word)
        # the other family's rounding element is not read
        wrong = [("LevelOfRoundingUsedInFinancialStatements", "OneD", None, None, "Crores")]
        self.assertEqual(self.read(wrong + identity_facts()).rounding_word, "Lakhs")
        self.assertIsNone(self.read(wrong, rounding=None).rounding_word)

    def test_no_family_has_no_rounding(self):
        inst = parse(instance(namespace="http://example.com/x", facts=identity_facts()))
        self.assertIsNone(read_identity(inst, None).rounding_word)
        self.assertEqual(read_identity(inst, None).scrip_code, "500999")  # the other elements are still read

    def test_text_is_trimmed_and_an_empty_fact_is_not_taken(self):
        facts = [("NameOfTheCompany", "OneD", None, None, "   "),
                 ("NameOfTheCompany", "OneD", None, None, None),
                 ("NameOfTheCompany", "OneD", None, None, "  SYNTHETIC CEMENTS LIMITED \n"),
                 ("ScripCode", "OneD", None, None, " 500999 "),
                 ("DateOfEndOfReportingPeriod", "OneD", None, None, " 2025-09-30 ")]
        identity = self.read(facts)
        self.assertEqual((identity.name, identity.scrip_code, identity.period_end), ("SYNTHETIC CEMENTS LIMITED", "500999", date(2025, 9, 30)))

    def test_the_first_fact_in_document_order_is_taken(self):
        facts = [("ScripCode", "OneD", None, None, "500111"), ("ScripCode", "FourD", None, None, "500222")]
        self.assertEqual(self.read(facts).scrip_code, "500111")

    def test_dimensional_facts_are_not_identity(self):
        facts = [("ScripCode", "OneExpenses1D", None, None, "500111"), ("ScripCode", "OneD", None, None, "500222")]
        self.assertEqual(self.read(facts).scrip_code, "500222")
        self.assertIsNone(self.read(facts[:1]).scrip_code)

    def test_a_fact_in_a_context_the_file_does_not_declare_is_skipped(self):
        facts = [("ScripCode", "Nowhere", None, None, "500111"), ("ScripCode", "OneD", None, None, "500222")]
        self.assertEqual(self.read(facts).scrip_code, "500222")
        self.assertIsNone(self.read(facts[:1]).scrip_code)

    def test_basis_is_taken_over_every_basis_fact(self):
        both_contexts = [("NatureOfReportStandaloneConsolidated", c, None, None, "Standalone") for c in ("OneD", "FourD")]
        identity = self.read(both_contexts)
        self.assertEqual((identity.basis, identity.mixed_basis), ("standalone", False))
        disagree = [("NatureOfReportStandaloneConsolidated", "OneD", None, None, "Standalone"),
                    ("NatureOfReportStandaloneConsolidated", "FourD", None, None, "Consolidated")]
        identity = self.read(disagree)
        self.assertEqual((identity.basis, identity.mixed_basis), ("unknown", True))

    def test_basis_is_read_without_regard_to_case_or_padding(self):
        for text, basis in (("CONSOLIDATED", "consolidated"), (" standalone ", "standalone"), ("Consolidated results", "consolidated")):
            identity = self.read([("NatureOfReportStandaloneConsolidated", "OneD", None, None, text)])
            self.assertEqual((identity.basis, identity.mixed_basis), (basis, False), text)

    def test_no_basis_fact_is_neither_basis(self):
        for facts in ([], [("NatureOfReportStandaloneConsolidated", "OneD", None, None, None)],
                      [("NatureOfReportStandaloneConsolidated", "OneD", None, None, "  ")],
                      [("NatureOfReportStandaloneConsolidated", "OneExpenses1D", None, None, "Consolidated")]):
            identity = self.read(facts)
            self.assertEqual((identity.basis, identity.mixed_basis), ("unknown", True))

    def test_a_basis_text_that_is_not_one_basis_is_neither(self):
        for text in ("Standalone and Consolidated", "Consolidated / Standalone", "Non-consolidated", "Unconsolidated", "Group", "Yes"):
            identity = self.read([("NatureOfReportStandaloneConsolidated", "OneD", None, None, text)])
            self.assertEqual((identity.basis, identity.mixed_basis), ("unknown", True), text)

    def test_audited_is_an_exact_word(self):
        for text, audited in (("Audited", True), ("audited", True), (" Unaudited ", False), ("UNAUDITED", False),
                              ("Reviewed", None), ("Not audited", None), ("", None)):
            identity = self.read([("WhetherResultsAreAuditedOrUnaudited", "OneD", None, None, text)])
            self.assertIs(identity.audited, audited, text)
        self.assertIsNone(self.read([]).audited)

    def test_period_dates_are_dates_or_unknown(self):
        for text in ("30/09/2025", "2025-13-01", "2025-02-30", "September 2025", "2025-09-30T00:00:00"):
            identity = self.read([("DateOfEndOfReportingPeriod", "OneD", None, None, text),
                                  ("DateOfStartOfReportingPeriod", "OneD", None, None, text)], contexts=[ContextSpec("OneD")])
            self.assertEqual((identity.period_start, identity.period_end), (None, None), text)

    def test_period_end_falls_back_to_the_latest_end_or_instant_of_a_numeric_fact(self):
        facts = [f("RevenueFromOperations", "OneD"), f("RevenueFromOperations", "FourD"), f("Assets", "OneI"), f("Assets", "PY_I")]
        identity = self.read(facts)
        self.assertEqual((identity.period_start, identity.period_end), (None, date(2025, 9, 30)))
        later = [ContextSpec("OneD", "2025-07-01", "2025-09-30"), ContextSpec("Later", instant="2025-12-31"),
                 ContextSpec("Dim", "2026-01-01", "2026-03-31", dimension="scenario"), ContextSpec("Unused", instant="2027-03-31")]
        facts = [f("RevenueFromOperations", "OneD"), f("Assets", "Later"), f("Expenses", "Dim")]
        self.assertEqual(self.read(facts, contexts=later).period_end, date(2025, 12, 31))  # not dimensional, not unused

    def test_period_end_has_no_fallback_without_a_numeric_fact(self):
        self.assertIsNone(self.read([]).period_end)
        self.assertIsNone(self.read([("DateOfStartOfReportingPeriod", "OneD", None, None, "2025-07-01")]).period_end)

    def test_the_fact_wins_over_the_fallback(self):
        facts = [("DateOfEndOfReportingPeriod", "OneD", None, None, "2025-06-30"), f("Assets", "OneI")]
        self.assertEqual(self.read(facts).period_end, date(2025, 6, 30))


class ClassifyTests(unittest.TestCase):
    def classify(self, facts, **kwargs) -> XbrlClassificationData:
        return classify_instance(parse(instance(facts=facts, **kwargs)))

    def test_identity_and_answers(self):
        c = classify_instance(parse(instance(facts=identity_facts() + IND_AS_MARKERS)))
        self.assertEqual((c.kind, c.results_span, c.period_end, c.period_label), ("financial_results", "quarter", date(2025, 9, 30), "Quarter ended 30 Sep 2025"))
        self.assertEqual((c.bse_code, c.nse_symbol, c.isin, c.basis), ("500999", "SYNCEM", "INE999Z01011", "consolidated"))
        self.assertIn(XbrlEvidenceData("identifier", "xbrl.identity.scrip_code", "ScripCode", "OneD", "500999"), c.evidence)

    def test_the_other_answers(self):
        c = self.classify(identity_facts() + IND_AS_MARKERS + [("WhetherResultsAreAuditedOrUnaudited", "OneD", None, None, "Unaudited")])
        self.assertEqual((c.company_name_as_printed, c.cin, c.audited), ("SYNTHETIC CEMENTS LIMITED", None, False))
        self.assertEqual(c.format, XbrlFormat("in-capmkt", "ind_as", "in-capmkt/ind_as", True))
        # The two Ind AS marker lines are lines of the income statement in the format's map.
        self.assertEqual(c.statements_found, [StatementFound(statement="income_statement", basis="consolidated", pages=[])])
        self.assertEqual(c.warnings, [])

    def test_every_answer_has_its_evidence(self):
        c = self.classify(identity_facts() + IND_AS_MARKERS)
        self.assertEqual(c.evidence, [
            XbrlEvidenceData("kind", "xbrl.family", None, None, "in-capmkt"),
            XbrlEvidenceData("company", "xbrl.identity.name", "NameOfTheCompany", "OneD", "SYNTHETIC CEMENTS LIMITED"),
            XbrlEvidenceData("identifier", "xbrl.identity.scrip_code", "ScripCode", "OneD", "500999"),
            XbrlEvidenceData("identifier", "xbrl.identity.symbol", "Symbol", "OneD", "SYNCEM"),
            XbrlEvidenceData("identifier", "xbrl.identity.isin", "ISIN", "OneD", "INE999Z01011"),
            XbrlEvidenceData("statements", "xbrl.identity.basis", "NatureOfReportStandaloneConsolidated", "OneD", "Consolidated"),
            XbrlEvidenceData("period", "xbrl.identity.period_end", "DateOfEndOfReportingPeriod", "OneD", "2025-09-30"),
            XbrlEvidenceData("results_span", "xbrl.identity.period_start", "DateOfStartOfReportingPeriod", "OneD", "2025-07-01"),
        ])

    def test_the_family_is_the_kinds_evidence(self):
        c = classify_instance(parse(instance(namespace=BSE_FIN, facts=identity_facts() + IND_AS_MARKERS)))
        self.assertEqual(c.evidence[0], XbrlEvidenceData("kind", "xbrl.family", None, None, "in-bse-fin"))
        self.assertEqual(c.format.id, "in-bse-fin/ind_as")

    def test_a_quote_is_the_trimmed_text_cut_to_300_characters(self):
        long_name = "N" * 400
        c = self.classify(only(identity_facts(), "NameOfTheCompany", text="  " + long_name + "  ") + IND_AS_MARKERS)
        quote = next(e.quote for e in c.evidence if e.field == "company")
        self.assertEqual(quote, "N" * 300)
        self.assertEqual(c.company_name_as_printed, long_name)  # the answer is whole; only the quote is cut
        self.assertTrue(all(1 <= len(e.quote) <= 300 for e in c.evidence))

    def test_notlisted_symbol_is_no_symbol(self):
        self.assertIsNone(classify_instance(parse(instance(facts=identity_facts(symbol="NOTLISTED") + IND_AS_MARKERS))).nse_symbol)

    def test_a_rejected_answer_has_no_evidence(self):
        c = self.classify(identity_facts(symbol="NOTLISTED") + IND_AS_MARKERS)
        self.assertEqual([e.rule_id for e in c.evidence if e.field == "identifier"], ["xbrl.identity.scrip_code", "xbrl.identity.isin"])

    def test_codes_have_the_shapes_the_contracts_ask_for(self):
        for scrip in ("50099", "5009999", "50099A", "5009 99"):
            self.assertIsNone(self.classify(only(identity_facts(), "ScripCode", text=scrip) + IND_AS_MARKERS).bse_code, scrip)
        for symbol in ("syncem", "1SYNCEM", "SYN CEM", "A" * 21, "&A"):
            self.assertIsNone(self.classify(identity_facts(symbol=symbol) + IND_AS_MARKERS).nse_symbol, symbol)
        for symbol in ("S", "A" * 20, "M&M", "BAJAJ-AUTO", "L&TFH"):
            self.assertEqual(self.classify(identity_facts(symbol=symbol) + IND_AS_MARKERS).nse_symbol, symbol)
        for isin in ("INE999Z0101", "INE999Z010111", "ine999z01011", "INE999Z0101X", ""):
            self.assertIsNone(self.classify(only(identity_facts(), "ISIN", text=isin) + IND_AS_MARKERS).isin, isin)

    def test_padded_codes_are_trimmed(self):
        c = self.classify(only(only(identity_facts(), "ScripCode", text=" 500999\n"), "ISIN", text=" INE999Z01011 ") + IND_AS_MARKERS)
        self.assertEqual((c.bse_code, c.isin), ("500999", "INE999Z01011"))

    def test_mixed_basis_is_not_sure(self):
        c = classify_instance(parse(instance(facts=identity_facts() + [("NatureOfReportStandaloneConsolidated", "OneD", None, None, "Standalone")] + IND_AS_MARKERS)))
        self.assertEqual((c.kind, c.basis, [w.code for w in c.warnings]), ("not_sure", "unknown", ["XBRL_MIXED_BASIS"]))

    def test_no_basis_is_not_sure(self):
        c = classify_instance(parse(instance(facts=identity_facts(basis=None) + IND_AS_MARKERS)))
        self.assertEqual((c.kind, c.basis, [w.code for w in c.warnings]), ("not_sure", "unknown", ["XBRL_MIXED_BASIS"]))

    def test_no_basis_has_no_basis_evidence(self):
        c = self.classify(identity_facts(basis=None) + IND_AS_MARKERS)
        self.assertNotIn("xbrl.identity.basis", [e.rule_id for e in c.evidence])
        # the rest of the identity is still answered
        self.assertEqual((c.bse_code, c.isin, c.period_end), ("500999", "INE999Z01011", date(2025, 9, 30)))

    def test_an_unmapped_format_is_still_financial_results_with_a_warning(self):
        c = self.classify(identity_facts() + [f("CET1Ratio", unit="pure")])
        self.assertEqual((c.kind, c.format.id, c.basis), ("financial_results", "in-capmkt/banking", "consolidated"))
        self.assertEqual([(w.code, w.message) for w in c.warnings], [("XBRL_FORMAT_UNMAPPED", "in-capmkt/banking")])

    def test_an_unknown_family_is_not_sure_with_a_warning_and_no_family_evidence(self):
        c = self.classify(identity_facts() + IND_AS_MARKERS, namespace="http://example.com/x")
        self.assertEqual((c.kind, c.format), ("not_sure", XbrlFormat(None, "unknown", None, False)))
        self.assertEqual([(w.code, w.message) for w in c.warnings], [("XBRL_FORMAT_UNMAPPED", "unknown")])
        self.assertNotIn("kind", [e.field for e in c.evidence])
        self.assertEqual(c.bse_code, "500999")  # the identity is still read

    def test_both_warnings_come_mixed_basis_first(self):
        c = self.classify(identity_facts(basis=None), namespace="http://example.com/x")
        self.assertEqual([w.code for w in c.warnings], ["XBRL_MIXED_BASIS", "XBRL_FORMAT_UNMAPPED"])

    def test_warnings_carry_no_document_text(self):
        c = self.classify(identity_facts(basis=None) + [f("CET1Ratio", unit="pure")])
        text = " ".join(f"{w.code} {w.message}" for w in c.warnings)
        self.assertNotIn("SYNTHETIC", text)
        self.assertNotIn("500999", text)

    def test_the_results_span_comes_from_the_dates(self):
        # ReportingQuarter says "Second quarter" in the fixture; it is not read
        c = self.classify(only(identity_facts(), "DateOfStartOfReportingPeriod", text="2025-04-01") + IND_AS_MARKERS)
        self.assertEqual((c.results_span, c.period_label), ("half_year", "Half year ended 30 Sep 2025"))
        c = self.classify(only(only(identity_facts(), "DateOfStartOfReportingPeriod", text="2025-04-01"),
                               "DateOfEndOfReportingPeriod", text="2026-03-31") + IND_AS_MARKERS)
        self.assertEqual((c.results_span, c.period_label), ("full_year", "Year ended 31 Mar 2026"))
        c = self.classify(only(identity_facts(), "DateOfStartOfReportingPeriod", text="2025-07-02") + IND_AS_MARKERS)
        self.assertEqual((c.results_span, c.period_label), (None, "Period ended 30 Sep 2025"))

    def test_without_a_start_date_the_span_and_label_are_unknown(self):
        facts = [fact for fact in identity_facts() if fact[0] != "DateOfStartOfReportingPeriod"]
        c = self.classify(facts + IND_AS_MARKERS)
        self.assertEqual((c.results_span, c.period_label, c.period_end), (None, None, date(2025, 9, 30)))

    def test_a_fallback_period_end_says_where_it_came_from(self):
        facts = [fact for fact in identity_facts() if fact[0] != "DateOfEndOfReportingPeriod"]
        c = self.classify(facts + [f("Assets", "OneI")])
        self.assertEqual(c.period_end, date(2025, 9, 30))
        self.assertIn(XbrlEvidenceData("period", "xbrl.period_end.context", None, "OneI", "2025-09-30"), c.evidence)

    def test_no_period_has_no_period_evidence(self):
        c = self.classify([fact for fact in identity_facts() if not fact[0].startswith("DateOf")])
        self.assertEqual((c.period_end, c.period_label, c.results_span), (None, None, None))
        self.assertNotIn("period", [e.field for e in c.evidence])

    def test_an_instance_with_nothing_in_it_is_not_sure(self):
        c = classify_instance(parse(instance(rounding=None)))
        self.assertEqual((c.kind, c.basis, c.format.id, c.evidence), ("not_sure", "unknown", None, []))
        self.assertEqual([w.code for w in c.warnings], ["XBRL_MIXED_BASIS", "XBRL_FORMAT_UNMAPPED"])


@unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
class RealInstanceTests(unittest.TestCase):
    def test_real_instances_detect_the_token_format(self):  # gated on MAESTER_XBRL_DIR
        # The file-name token decides the expectation: Integrated_Finance_Ind_As → in-capmkt/ind_as,
        # Main_Ind_As → in-bse-fin/ind_as, *Banking → banking, *NBFC → nbfc, IFOtherthan → other_than_ind_as.
        count = 0
        for path, token in real_instances_with_token():
            self.assertEqual(detect_format(parse(path.read_bytes())).id, EXPECTED[token], path.name)
            count += 1
        self.assertGreater(count, 0)  # a gated test that read nothing proves nothing

    def test_real_instances_results_span_follows_the_dates(self):  # gated: 807 of 807 (Departure 17)
        # resultsSpan is OneD's own span in every file, whatever ReportingQuarter says (SQ's "Half yearly" included).
        count = 0
        for path, period_token in real_instances_with_period_token():
            inst = parse(path.read_bytes()); one = inst.contexts["OneD"]
            c = classify_instance(inst)
            self.assertEqual(c.results_span, to_results_span(span_of(one.start, one.end)), path.name)
            if period_token == "MQ": self.assertEqual(c.results_span, "quarter", path.name)      # 18 files: Q4 results
            if period_token == "MH": self.assertEqual(c.results_span, "half_year", path.name)    # 10 files
            count += 1
        self.assertGreater(count, 0)

    def test_real_instances_answer_what_a_results_instance_must(self):
        # Every real file is a results instance with a basis, a period, a scrip code and a declared rounding.
        count = 0
        for path, _ in real_instances_with_token():
            inst = parse(path.read_bytes())
            c = classify_instance(inst)
            identity = read_identity(inst, c.format.family)
            self.assertEqual(c.kind, "financial_results", path.name)
            self.assertIn(c.basis, ("consolidated", "standalone"), path.name)
            self.assertIsNotNone(c.period_end, path.name)
            self.assertIsNotNone(c.bse_code, path.name)
            self.assertIsNotNone(c.isin, path.name)
            self.assertIsNotNone(rounding_of(identity.rounding_word), path.name)
            self.assertEqual([w.code for w in c.warnings], [] if c.format.mapped else ["XBRL_FORMAT_UNMAPPED"], path.name)
            count += 1
        self.assertGreater(count, 0)


if __name__ == "__main__":
    unittest.main()
