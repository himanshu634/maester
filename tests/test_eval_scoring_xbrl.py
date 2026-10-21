"""Scoring by source: XBRL against gold by concept within its own slots, and the `shown` mix the source rule picks.
Offline. Every expected outcome is worked out by hand in the comment beside it."""

import unittest

from eval_fixtures import (
    FILING, RESULTS_Q2, gold_fact, gold_of, instance_read, pdf_artefact, pdf_fact, xbrl_artefact, xbrl_fact,
)

from maester_eval.scoring import compare_xbrl, score_run, score_shown, score_xbrl_filing, score_xbrl_run

A, B, C, E = (f"synthetic-cements/xbrl/{name}" for name in ("a.xml", "b.xml", "c.xml", "e.xml"))
Q2 = RESULTS_Q2.id

# G1, revenue, consolidated, quarter, 2025-09-30: 12,345.00 lakh. G2, the same standalone: 10,000.00 lakh.
# G3, consolidated revenue of the quarter a year before, a comparative: 11,000.00 lakh.
G1 = gold_fact()
G2 = gold_fact(basis="standalone", printed="10,000.00", value="10000.00", normalized_value="1000000000.00")
G3 = gold_fact(period_label="Quarter ended 30.09.2024", period_end="2024-09-30", printed="11,000.00", value="11000.00",
               normalized_value="1100000000.00")
STANDALONE = dict(basis="standalone", normalizedValue="1000000000", reportedValue="10000.00", instance=B)
HALF_YEAR = dict(span="half_year", periodStart="2025-04-01", contextId="FourD", normalizedValue="2469000000")
# The PDF read G1 and G3 right and G2 as 10,500.00 lakh.
PDF_FACTS = [pdf_fact(),
             pdf_fact(basis="standalone", reportedText="10,500.00", reportedValue="10500.00", normalizedValue="1050000000"),
             pdf_fact(periodLabel="Quarter ended 30.09.2024", periodEnd="2024-09-30", reportedText="11,000.00",
                      reportedValue="11000.00", normalizedValue="1100000000")]


def one(score):
    (fact,) = score.facts
    return fact


def gold_set(*facts):
    return {Q2: gold_of(*facts)}


def xbrl_run(artefacts, gold, ids=(Q2,), eval_set="dev"):
    return score_xbrl_run("x", artefacts, gold, list(ids), eval_set, {"map_version": "1"}, None)


def unused(file, reason):
    return instance_read(file, used=False, reason=reason, format=None, mapped=False, state=None)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(), xbrl_fact(**STANDALONE)])
        self.gold = gold_of(G1, G2, G3)
        self.gold_set = {Q2: self.gold}
        self.pdf = pdf_artefact(RESULTS_Q2, PDF_FACTS)
        self.pdf_score = score_run("p", [self.pdf], self.gold_set, [Q2], "dev")
        self.xbrl_score = xbrl_run([self.xbrl], self.gold_set)
        self.xbrl_cons_only = xbrl_artefact(RESULTS_Q2, [xbrl_fact()])
        self.xbrl_score_cons_only = xbrl_run([self.xbrl_cons_only], self.gold_set)
        self.xbrl_unmapped = xbrl_artefact(RESULTS_Q2, [], instances=[unused(C, "XBRL_FORMAT_UNMAPPED")])
        self.xbrl_unmapped_score = xbrl_run([self.xbrl_unmapped], self.gold_set)


class XbrlScoringTests(Fixture):
    def test_xbrl_scores_by_concept_span_and_period(self):
        s = score_xbrl_filing(self.xbrl, self.gold)
        self.assertEqual([(f.basis, f.outcome, f.element, f.gold_index, f.format) for f in s.facts],
                         [("consolidated", "match", "RevenueFromOperations", 0, "in-capmkt/ind_as"),
                          ("standalone", "match", "RevenueFromOperations", 1, "in-capmkt/ind_as")])
        self.assertEqual((s.source, s.outside_slots, s.not_placed), ("xbrl", 1, {}))      # G3 is a comparative: outside the instances' slots

    def test_a_matched_fact_shows_what_xbrl_holds_and_no_page(self):
        f = score_xbrl_filing(self.xbrl, self.gold).facts[0]
        self.assertEqual((f.source, f.read_printed, f.read_normalized, f.page_match, f.xbrl_concept, f.suspects, f.detail),
                         ("xbrl", "12345.00 ₹ lakh", "1234500000", None, "revenue_from_operations", [], None))

    def test_an_unplaced_gold_fact_keeps_its_reason(self):
        # A gold file frozen before Task 3: "Current period ended 30.09.2025" with span null; and a fact with period_end null.
        s = score_xbrl_filing(self.xbrl, gold_of(gold_fact(period_label="Current period ended 30.09.2025", span=None), gold_fact(period_end=None)))
        self.assertEqual((s.facts, s.outside_slots, s.not_placed), ([], 0, {"no_span": 1, "no_period": 1}))

    def test_a_value_on_another_element_marks_the_map_suspect(self):
        # Gold total_income 1250000000. XBRL has no total_income, but "SyntheticOthersIncome" (a name no map holds) read with concept
        # null and 1250000000. The concept shown is the fact's as read, never a map lookup, so the real map cannot change this test.
        xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="SyntheticOthersIncome", concept=None, normalizedValue="1250000000")])
        gold = gold_of(gold_fact(concept="total_income", printed="12,500.00", value="12500.00", normalized_value="1250000000.00"))
        f = one(score_xbrl_filing(xbrl, gold))
        self.assertEqual((f.outcome, f.detail, f.suspects), ("missing", "map_suspect:SyntheticOthersIncome", [("SyntheticOthersIncome", None)]))

    def test_a_wrong_value_with_its_figure_on_other_elements_names_them_sorted(self):
        # Revenue reads 1234600000 against gold 1234500000 (apart at 10^3: a wrong value). "Zed" and "Alpha", of other
        # concepts or none, hold 1234500000, the gold figure exactly, so both are suspects, sorted by element; "Far" is not.
        xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(normalizedValue="1234600000", reportedValue="12346.00"),
                                          xbrl_fact(element="Zed", concept="other_income"),
                                          xbrl_fact(element="Alpha", concept=None),
                                          xbrl_fact(element="Far", concept=None, normalizedValue="99000")])
        f = one(score_xbrl_filing(xbrl, gold_of(G1)))
        self.assertEqual((f.outcome, f.detail, f.suspects),
                         ("wrong_value", "map_suspect:Alpha,Zed", [("Alpha", None), ("Zed", "other_income")]))

    def test_a_line_xbrl_does_not_carry_is_missing(self):
        # Finance costs 345.00 lakh: no fact of the slot holds that figure, so there is no suspect either.
        costs = gold_fact(concept="finance_costs", label="Finance costs", printed="345.00", value="345.00", normalized_value="34500000.00")
        f = one(score_xbrl_filing(self.xbrl, gold_of(costs)))
        self.assertEqual((f.outcome, f.detail, f.element, f.format, f.read_printed), ("missing", None, None, "in-capmkt/ind_as", None))

    def test_two_facts_of_one_concept_with_different_figures_are_ambiguous(self):
        xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(), xbrl_fact(element="RevenueFromOperationsOther", normalizedValue="1")])
        f = one(score_xbrl_filing(xbrl, gold_of(G1)))
        self.assertEqual((f.outcome, f.element, f.read_printed), ("ambiguous", None, None))

    def test_dash_zero_nil_sign_and_precision(self):
        dash = gold_fact(printed="-", value_status="dash", value=None, scale=None, normalized_value=None)
        nil = xbrl_fact(valueStatus="unparsed", nil=True, normalizedValue=None, reportedValue=None)
        self.assertEqual(compare_xbrl(dash, xbrl_fact(normalizedValue="0", reportedValue="0")), "match_dash_zero")
        self.assertEqual(compare_xbrl(dash, xbrl_fact()), "wrong_status")           # a figure where a dash is printed, as phase 0
        self.assertEqual(compare_xbrl(dash, nil), "wrong_status")
        self.assertEqual(compare_xbrl(gold_fact(), nil), "wrong_status")
        self.assertEqual(compare_xbrl(gold_fact(), xbrl_fact()), "match")
        self.assertEqual(compare_xbrl(gold_fact(printed="1,235", value="1235", scale="10000000", normalized_value="12350000000"),
                                      xbrl_fact(normalizedValue="12345000000", reportedValue="1234.5", decimals="-6")), "match_at_precision")
        self.assertEqual(compare_xbrl(gold_fact(printed="(12,345.00)", value="-12345.00", normalized_value="-1234500000.00"), xbrl_fact()),
                         "wrong_sign")                                                # brackets on the page, a non-negative XBRL amount
        self.assertEqual(compare_xbrl(gold_fact(), xbrl_fact(normalizedValue="123450000000", reportedValue="12345.00")), "wrong_scale")

    def test_wrong_value_and_the_edges_of_sign_and_precision(self):
        # 1,234 crore against 1,234.5 crore at 10^6: different at 10^7, so a wrong value.
        self.assertEqual(compare_xbrl(gold_fact(printed="1,234", value="1234", scale="10000000", normalized_value="12340000000"),
                                      xbrl_fact(normalizedValue="12345000000", reportedValue="1234.5", decimals="-6")), "wrong_value")
        # Opposite in sign and apart in size is a wrong value, not a sign convention.
        self.assertEqual(compare_xbrl(gold_fact(value="-12346.00", normalized_value="-1234600000.00"), xbrl_fact()), "wrong_value")
        # A printed 0 against an XBRL 0 is an exact match, never a sign question.
        self.assertEqual(compare_xbrl(gold_fact(printed="0", value="0", normalized_value="0"),
                                      xbrl_fact(normalizedValue="0", reportedValue="0")), "match")

    def test_a_scored_dash_against_a_tagged_zero(self):
        dash = gold_fact(printed="-", value_status="dash", value=None, scale=None, normalized_value=None)
        xbrl = xbrl_artefact(RESULTS_Q2, [xbrl_fact(normalizedValue="0", reportedValue="0")])
        f = one(score_xbrl_filing(xbrl, gold_of(dash)))
        self.assertEqual((f.outcome, f.detail), ("match_dash_zero", None))
        # A dash no XBRL fact holds is missing, with no suspect: a dash has no figure to look for.
        self.assertEqual((one(score_xbrl_filing(xbrl_artefact(RESULTS_Q2, [xbrl_fact(element="X", concept=None, normalizedValue="0")]),
                                                gold_of(dash))).detail), None)


class XbrlRunTests(Fixture):
    def test_a_filing_with_no_used_instance_is_listed_not_scored(self):
        self.assertEqual((self.xbrl_unmapped_score.unusable, self.xbrl_unmapped_score.filings),
                         ({"synthetic-cements/results-2025-09": "format_unmapped"}, []))
        wrong_period = xbrl_artefact(RESULTS_Q2, [], instances=[unused(E, "XBRL_PAIR_PERIOD")])
        score = xbrl_run([wrong_period], self.gold_set)
        self.assertEqual((score.unusable, score.filings), ({"synthetic-cements/results-2025-09": "pair_mismatch"}, []))
        self.assertEqual(score.not_run, [])                                          # it was read: it is not "not run"

    def test_the_reason_is_the_first_unused_pairs(self):
        unreadable = xbrl_artefact(RESULTS_Q2, [], instances=[unused(A, "XBRL_UNREADABLE:DOCTYPE"), unused(C, "XBRL_FORMAT_UNMAPPED")])
        self.assertEqual(xbrl_run([unreadable], self.gold_set).unusable, {Q2: "unreadable"})

    def test_the_run_scores_its_filings_and_counts_pooled_slots(self):
        score = xbrl_run([self.xbrl], self.gold_set)
        self.assertEqual((score.source, score.run, score.unusable, score.pooled), ("xbrl", "x", {}, {}))
        summary = score.summary()
        self.assertEqual((summary.gold_facts, summary.match, summary.filings), (2, 2, 1))
        pooled = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=A), xbrl_fact(instance=B)])   # a.xml and b.xml tie and have no stamp
        self.assertEqual(xbrl_run([pooled], {}).pooled, {Q2: 1})                     # counted with no gold for the filing

    def test_new_outcomes_are_counted_in_the_summary(self):
        neg = gold_fact(printed="(12,345.00)", value="-12345.00", normalized_value="-1234500000.00")
        summary = xbrl_run([self.xbrl_cons_only], gold_set(neg)).summary()
        self.assertEqual((summary.gold_facts, summary.wrong_sign, summary.match), (1, 1, 0))
        self.assertEqual(summary.rate("wrong_sign"), "100.0%")


class ShownTests(Fixture):
    def test_shown_takes_xbrl_where_it_owns_and_the_pdf_elsewhere_when_read(self):
        # XBRL with a.xml only (consolidated): the plan is read, uncovered [income_statement/standalone].
        shown = score_shown(self.gold_set, self.pdf_score, self.xbrl_score_cons_only, [self.pdf], [self.xbrl_cons_only])
        self.assertEqual(shown.source, "shown")
        self.assertEqual([(f.basis, f.outcome, f.source) for f in shown.filings[0].facts],
                         [("consolidated", "match", "xbrl"), ("standalone", "wrong_value", "pdf")])
        self.assertEqual(shown.filings[0].outside_slots, 1)                           # G3 is another period

    def test_a_slot_xbrl_does_not_own_takes_the_pdf_when_the_pdf_is_read(self):
        # a.xml (consolidated) holds FourD half-year facts only, and there is no standalone instance: the plan is read.
        # G1's consolidated quarter slot has no owner, so it is the PDF's figure, which is right.
        half_year_only = xbrl_artefact(RESULTS_Q2, [xbrl_fact(**HALF_YEAR)])
        gold = gold_set(G1)
        pdf_score = score_run("p", [self.pdf], gold, [Q2], "dev")
        shown = score_shown(gold, pdf_score, xbrl_run([half_year_only], gold), [self.pdf], [half_year_only])
        self.assertEqual([(f.outcome, f.source, f.detail) for f in shown.filings[0].facts], [("match", "pdf", None)])

    def test_a_slot_xbrl_does_not_own_is_missing_when_the_pdf_is_skipped(self):
        # a.xml (consolidated) holds FourD half-year facts only and b.xml the standalone quarter. The PDF's coverage is
        # income_statement for both bases, both covered: the plan is skip, and the PDF is never read.
        both = xbrl_artefact(RESULTS_Q2, [xbrl_fact(**HALF_YEAR), xbrl_fact(**STANDALONE)])
        gold = gold_set(G1, G2)
        pdf_score = score_run("p", [self.pdf], gold, [Q2], "dev")
        shown = score_shown(gold, pdf_score, xbrl_run([both], gold), [self.pdf], [both])
        self.assertEqual([(f.basis, f.outcome, f.source, f.detail) for f in shown.filings[0].facts],
                         [("consolidated", "missing", "xbrl", "not_in_xbrl"), ("standalone", "match", "xbrl", None)])

    def test_shown_leaves_out_comparatives_and_reads_an_annual_report_from_the_pdf(self):
        # RESULTS_Q2 as in the fixture (a.xml and b.xml: the plan is skip), and FILING, an annual report with two gold facts of
        # 2026-03-31 that its PDF read right and no XBRL artefact.
        year = dict(periodLabel="Year ended 31 March 2026", periodEnd="2026-03-31", reportedText="50,000.00",
                    reportedValue="50000.00", normalizedValue="5000000000")
        ar_pdf = pdf_artefact(FILING, [pdf_fact(**year), pdf_fact(basis="standalone", **year)])
        ar_year = dict(period_label="Year ended 31 March 2026", period_end="2026-03-31", span="year", printed="50,000.00",
                       value="50000.00", normalized_value="5000000000.00")
        gold_with_ar = {**self.gold_set, FILING.id: gold_of(gold_fact(**ar_year), gold_fact(basis="standalone", **ar_year), filing=FILING)}
        pdf_score_with_ar = score_run("p", [self.pdf, ar_pdf], gold_with_ar, list(gold_with_ar), "dev")
        shown = score_shown(gold_with_ar, pdf_score_with_ar, self.xbrl_score, [self.pdf, ar_pdf], [self.xbrl])
        by_id = {f.filing_id: f for f in shown.filings}
        self.assertEqual([(f.basis, f.outcome, f.source) for f in by_id[RESULTS_Q2.id].facts],
                         [("consolidated", "match", "xbrl"), ("standalone", "match", "xbrl")])
        self.assertEqual(by_id[RESULTS_Q2.id].outside_slots, 1)
        self.assertEqual([(f.outcome, f.source) for f in by_id[FILING.id].facts], [("match", "pdf"), ("match", "pdf")])

    def test_an_unmapped_only_filing_takes_the_pdf_throughout(self):
        # The XBRL artefact holds only c.xml (XBRL_FORMAT_UNMAPPED): xbrl.unusable names the filing, and shown is the PDF's own score.
        shown = score_shown(self.gold_set, self.pdf_score, self.xbrl_unmapped_score, [self.pdf], [self.xbrl_unmapped])
        self.assertEqual([(f.basis, f.outcome, f.source) for f in shown.filings[0].facts],
                         [("consolidated", "match", "pdf"), ("standalone", "wrong_value", "pdf")])

    def test_with_no_xbrl_run_every_own_period_fact_is_the_pdfs(self):
        shown = score_shown(self.gold_set, self.pdf_score, None, [self.pdf], [])
        filing = shown.filings[0]
        self.assertEqual([(f.outcome, f.source, f.gold_index) for f in filing.facts], [("match", "pdf", 0), ("wrong_value", "pdf", 1)])
        self.assertEqual((filing.source, filing.outside_slots, filing.not_placed), ("shown", 1, {}))

    def test_an_own_period_fact_with_no_span_or_no_date_is_not_placed(self):
        gold = gold_set(G1, gold_fact(period_label="Current period ended 30.09.2025", span=None), gold_fact(period_end=None))
        pdf_score = score_run("p", [self.pdf], gold, [Q2], "dev")
        filing = score_shown(gold, pdf_score, xbrl_run([self.xbrl], gold), [self.pdf], [self.xbrl]).filings[0]
        self.assertEqual([(f.outcome, f.source) for f in filing.facts], [("match", "xbrl")])
        self.assertEqual((filing.outside_slots, filing.not_placed), (0, {"no_span": 1, "no_period": 1}))


if __name__ == "__main__":
    unittest.main()
