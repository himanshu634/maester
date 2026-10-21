"""Scoring a run against gold: outcomes, strata, the lists of what was not scored. Offline."""

import unittest

from eval_fixtures import FILING, WHEN, scored_row as row
from test_extraction_workflow import FAST, PDF, ScriptedModel, balance_sheet, cash_flow, income_statement, lines_section

from maester_eval.artefacts import ModelCalls
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import freeze_sheet
from maester_eval.manifest import Filing
from maester_eval.runner import run_filing
from maester_eval.scoring import OUTCOMES, Summary, score_filing, score_run
from pdf_financial_qa.workflow.errors import ModelOutputError
from pdf_financial_qa.workflow.model import (
    ExtractedLine, ExtractedSection, ExtractedValue, LocatedStatement, LocateOutput, StatementOutput,
)

TAXONOMY = load_taxonomy()
OTHER = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
               kind="annual_report", period_end="2026-03-31", set="heldout")
NOTHING_LOCATED = LocateOutput(statements=[])


def gold(*rows):
    return freeze_sheet(list(rows), FILING, TAXONOMY, WHEN)


def read(filing=FILING, model=None):
    """The artefact of a run over the fixture PDF; the scripted model answers as the fixture says unless `model` is given."""
    return run_filing(filing, PDF, lambda: model or ScriptedModel(), FAST)


def balance(*sections, unit_label="Rs. in crores"):
    """A balance sheet at 31 March 2026 made of the given sections."""
    return StatementOutput(currency="INR", unit_label=unit_label, periods=["As at 31 March 2026"], sections=list(sections))


def read_balance_sheet(statement):
    """The fixture filing read with `statement` as the model's balance sheet; the other statements are the fixture's."""
    return read(model=ScriptedModel(extract={"balance_sheet": [statement], "income_statement": [income_statement()],
                                             "cash_flow": [cash_flow()]}))


class ScoreFilingTests(unittest.TestCase):
    def setUp(self):
        self.artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)

    def outcome(self, *rows):
        return [f.outcome for f in score_filing(self.artefact, gold(*rows)).facts]

    def test_match_wrong_value_scale_status_and_missing(self):
        self.assertEqual(self.outcome(row()), ["match"])
        self.assertEqual(self.outcome(row(gold_text="2,001")), ["wrong_value"])
        self.assertEqual(self.outcome(row(gold_scale="100000")), ["wrong_scale"])
        self.assertEqual(self.outcome(row(gold_text="-")), ["wrong_status"])
        self.assertEqual(self.outcome(row(label="Goodwill", concept="goodwill")), ["missing"])

    def test_page_match_is_reported_for_found_facts(self):
        scored = score_filing(self.artefact, gold(row(), row(row="2", gold_page="9", label="Inventories", concept="inventories", printed="800")))
        self.assertEqual([f.page_match for f in scored.facts], [True, False])
        missing = score_filing(self.artefact, gold(row(label="Goodwill", concept="goodwill"))).facts[0]
        self.assertIsNone(missing.page_match)

    def test_same_label_in_two_sections_and_ambiguous_duplicates(self):
        two_totals = StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["As at 31 March 2026"], sections=[
            lines_section("Assets", [("Total", "2,000", ())]),
            lines_section("Equity and liabilities", [("Total", "2,100", ()), ("Other", "5", ()), ("Other", "7", ())]),
        ])
        model = ScriptedModel(extract={"balance_sheet": [two_totals], "income_statement": [income_statement()],
                                       "cash_flow": [cash_flow()]})
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        scored = score_filing(artefact, gold(
            row(label="Total", section="Equity and liabilities", concept="total_equity_and_liabilities", printed="2,100"),
            row(row="2", label="Other", section="Equity and liabilities", concept="other_equity", printed="7"),
            row(row="3", label="Total", section="", concept="total_assets"),  # no section typed: both totals qualify
        ))
        self.assertEqual([f.outcome for f in scored.facts], ["match", "ambiguous", "ambiguous"])

    def test_matches_by_period_label_when_no_date_was_read(self):
        # A cash flow column headed "FY2026": no date to read, but the label matches.
        cash = StatementOutput(currency="INR", unit_label="Rs. in crores", periods=["FY2026"], sections=[
            lines_section("Operating activities", [("Net cash from operations", "1,750", ())], period="FY2026", page=1)])
        locate = LocateOutput(statements=[LocatedStatement(statement="cash_flow", basis="consolidated", pages=[2])])
        model = ScriptedModel(locate=[locate], extract={"cash_flow": [cash]})
        artefact = run_filing(FILING, PDF, lambda: model, FAST)
        scored = score_filing(artefact, gold(row(statement="cash_flow", section="Operating activities", label="Net cash from operations",
                                                period_label="FY2026", period_end="", printed="1,750", concept="net_cash_from_operating_activities")))
        self.assertEqual(scored.facts[0].outcome, "match")
        self.assertIn(scored.facts[0].page_match, (True, False))  # found, so the page was checked

    def test_failed_filing_scores_all_gold_as_missing(self):
        failed = run_filing(FILING, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        scored = score_filing(failed, gold(row(), row(row="2", label="Inventories", concept="inventories", printed="800")))
        self.assertFalse(scored.extracted)
        self.assertEqual(scored.error_code, "NO_STATEMENTS_FOUND")
        self.assertEqual([f.outcome for f in scored.facts], ["missing", "missing"])
        self.assertEqual(scored.fact_count, 0)

    def test_filing_level_counts(self):
        scored = score_filing(self.artefact, gold(row()))
        self.assertTrue(scored.extracted)
        self.assertEqual(scored.state, "complete")
        self.assertTrue(scored.scanned)  # the fixture's cash flow page has no text layer
        self.assertEqual(scored.coverage, {"extracted": 3})
        # Two subtotal checks (total assets; profit) and the balance identity all pass in the fixture.
        self.assertEqual(scored.checks["passed"], 3)
        self.assertEqual(scored.model_calls, self.artefact.model_calls.total)
        self.assertEqual(scored.bytes, len(PDF))

    def test_a_found_fact_carries_what_the_report_shows_of_it(self):
        found, missing = score_filing(self.artefact, gold(row(gold_text="2,001"), row(row="2", label="Goodwill", concept="goodwill"))).facts
        self.assertEqual((found.concept, found.statement, found.basis, found.label, found.period_label),
                         ("total_assets", "balance_sheet", "consolidated", "Total assets", "As at 31 March 2026"))
        self.assertEqual((found.gold_printed, found.read_printed, found.gold_normalized, found.read_normalized),
                         ("2,001", "2,000", "20010000000", "20000000000"))
        self.assertEqual((missing.gold_printed, missing.read_printed, missing.read_normalized), ("2,000", None, None))

    def test_a_filing_is_scored_with_the_stratum_it_was_read_under(self):
        self.assertIsNone(score_filing(self.artefact, gold(row())).stratum)
        banded = self.artefact.model_copy(update={"stratum": "mid"})
        self.assertEqual(score_filing(banded, gold(row())).stratum, "mid")

    def test_figures_are_compared_as_exact_decimals(self):
        self.assertEqual(self.outcome(row(gold_text="2,000.00")), ["match"])  # the same figure, with its decimals
        self.assertEqual(self.outcome(row(gold_text="2,000.00", gold_scale="100000")), ["wrong_scale"])
        self.assertEqual(self.outcome(row(gold_text="(2,000)")), ["wrong_value"])  # the sign counts

    def test_section_label_and_period_label_are_compared_as_normalised_text(self):
        self.assertEqual(self.outcome(row(section="ASSETS", label="TOTAL  ASSETS.", period_label="as at 31 March, 2026")), ["match"])
        # Two lines of one label, told apart by the section alone: it is found as written in the filing, not as typed.
        totals = read_balance_sheet(balance(lines_section("Assets", [("Total", "2,000", ())]),
                                            lines_section("Equity and liabilities", [("Total", "2,100", ())])))
        typed = row(section="EQUITY & LIABILITIES", label="Total", concept="total_equity_and_liabilities", printed="2,100")
        self.assertEqual(score_filing(totals, gold(typed)).facts[0].outcome, "match")

    def test_statement_and_basis_are_part_of_the_match(self):
        self.assertEqual(self.outcome(row(basis="standalone")), ["missing"])  # only the consolidated statements were read
        self.assertEqual(self.outcome(row(statement="income_statement")), ["missing"])

    def test_a_dash_matches_a_dash_and_a_figure_that_could_not_be_read_matches_nothing(self):
        cash = dict(label="Cash", concept="cash_and_cash_equivalents")
        printed_figure, printed_dash = row(printed="1,200", **cash), row(gold_text="-", **cash)
        for printed, expected in (("-", ["wrong_status", "match"]), ("n.a.", ["wrong_status", "wrong_status"])):
            with self.subTest(printed=printed):
                artefact = read_balance_sheet(balance(lines_section("Assets", [("Cash", printed, ())])))
                self.assertEqual([score_filing(artefact, gold(g)).facts[0].outcome for g in (printed_figure, printed_dash)], expected)

    def test_a_section_no_fact_has_is_dropped_so_that_a_hand_typed_one_does_not_lose_the_match(self):
        self.assertEqual(self.outcome(row(section="Current assets")), ["match"])
        self.assertEqual(self.outcome(row(section="")), ["match"])

    def test_an_untyped_section_means_any_section_even_beside_a_section_the_pipeline_left_unnamed(self):
        # One section came back with no name. A gold row with no section typed is not a row of that section.
        artefact = read_balance_sheet(balance(lines_section("", [("Total", "2,000", ())]),
                                              lines_section("Equity and liabilities", [("Total", "2,100", ())])))
        untyped = row(label="Total", section="", concept="total_equity_and_liabilities", printed="2,100")
        self.assertEqual(score_filing(artefact, gold(untyped)).facts[0].outcome, "ambiguous")
        typed = row(label="Total", section="Equity and liabilities", concept="total_equity_and_liabilities", printed="2,100")
        self.assertEqual(score_filing(artefact, gold(typed)).facts[0].outcome, "match")

    def test_a_line_not_read_in_its_section_is_missing_even_when_another_section_prints_the_label(self):
        # "Borrowings" is printed under non-current and under current liabilities; only the non-current line was read.
        artefact = read_balance_sheet(balance(
            lines_section("Non-current liabilities", [("Borrowings", "300", ())]),
            lines_section("Current liabilities", [("Trade payables", "150", ())]),
        ))
        scored = score_filing(artefact, gold(
            row(section="Current liabilities", label="Borrowings", concept="current_borrowings", printed="300"),
            row(row="2", section="Non-current liabilities", label="Borrowings", concept="non_current_borrowings", printed="300"),
            row(row="3", section="Current liabilities", label="Trade payables", concept="trade_payables", printed="150"),
        ))
        self.assertEqual([f.outcome for f in scored.facts], ["missing", "match", "match"])

    def test_lines_with_the_same_figure_written_differently_are_not_ambiguous(self):
        # "5" and "5.0" are one figure as decimals: the first line is the one scored.
        artefact = read_balance_sheet(balance(lines_section("Equity and liabilities", [("Other", "5", ()), ("Other", "5.0", ())])))
        fact = score_filing(artefact, gold(row(section="Equity and liabilities", label="Other", concept="other_equity", printed="5"))).facts[0]
        self.assertEqual((fact.outcome, fact.read_printed, fact.page_match), ("match", "5", True))

    def test_a_dash_and_a_cell_that_could_not_be_read_are_not_one_figure(self):
        artefact = read_balance_sheet(balance(lines_section("Equity and liabilities", [("Other", "-", ()), ("Other", "n.a.", ())])))
        fact = score_filing(artefact, gold(row(section="Equity and liabilities", label="Other", concept="other_equity", gold_text="-"))).facts[0]
        self.assertEqual(fact.outcome, "ambiguous")

    def test_the_figure_of_a_line_is_the_one_of_the_period_asked_for(self):
        columns = ["As at 31 March 2026", "As at 31 March 2025"]
        cash = ExtractedLine(label="Cash", page=1, values=[ExtractedValue(period=columns[0], text="1,200"),
                                                           ExtractedValue(period=columns[1], text="1,100")])
        artefact = read_balance_sheet(StatementOutput(currency="INR", unit_label="Rs. in crores", periods=columns,
                                                      sections=[ExtractedSection(name="Assets", lines=[cash])]))
        cash_row = dict(label="Cash", concept="cash_and_cash_equivalents")
        scored = score_filing(artefact, gold(
            row(printed="1,200", **cash_row),
            row(row="2", printed="1,100", period_label=columns[1], period_end="2025-03-31", **cash_row),
            row(row="3", printed="1,200", period_label="As at 31 March 2024", period_end="2024-03-31", **cash_row),
        ))
        self.assertEqual([f.outcome for f in scored.facts], ["match", "match", "missing"])
        wrong = score_filing(artefact, gold(row(printed="1,200", period_label=columns[1], period_end="2025-03-31", **cash_row)))
        self.assertEqual(wrong.facts[0].outcome, "wrong_value")  # the 2026 figure is not the 2025 one

    def test_an_ambiguous_fact_shows_no_figure_because_no_line_was_picked(self):
        totals = read_balance_sheet(balance(lines_section("Assets", [("Total", "2,000", ())]),
                                            lines_section("Equity and liabilities", [("Total", "2,100", ())])))
        fact = score_filing(totals, gold(row(label="Total", section="", concept="total_assets"))).facts[0]
        self.assertEqual((fact.outcome, fact.read_printed, fact.read_normalized, fact.page_match), ("ambiguous", None, None, None))
        self.assertEqual((fact.gold_printed, fact.gold_normalized), ("2,000", "20000000000"))  # what the gold says is still shown

    def test_without_a_unit_lines_with_different_figures_are_still_ambiguous(self):
        # No unit, so no scale and no normalised value to tell the two lines apart by.
        other = row(section="Equity and liabilities", label="Other", concept="other_equity", printed="7")
        two = read_balance_sheet(balance(lines_section("Equity and liabilities", [("Other", "5", ()), ("Other", "7", ())]), unit_label=None))
        self.assertIsNone(two.result["facts"][0]["normalizedValue"])
        fact = score_filing(two, gold(other)).facts[0]
        self.assertEqual((fact.outcome, fact.page_match), ("ambiguous", None))
        # One line with the right figure and no scale is a scale that is wrong, not a figure that is wrong.
        one = read_balance_sheet(balance(lines_section("Equity and liabilities", [("Other", "7", ())]), unit_label=None))
        self.assertEqual(score_filing(one, gold(other)).facts[0].outcome, "wrong_scale")

    def test_scanned_means_a_statement_page_without_a_text_layer(self):
        def scanned(artefact):
            return score_filing(artefact, gold(row())).scanned

        self.assertTrue(scanned(self.artefact))  # the cash flow is on page 4 (index 3), which has no text
        self.assertFalse(scanned(self.artefact.model_copy(update={"pages_without_text": []})))
        self.assertFalse(scanned(self.artefact.model_copy(update={"pages_without_text": [0]})))  # the cover is no statement
        failed = read(model=ScriptedModel(locate=[NOTHING_LOCATED]))  # nothing was located, so any page without text counts
        self.assertTrue(scanned(failed))
        self.assertFalse(scanned(failed.model_copy(update={"pages_without_text": []})))

    def test_a_failed_filing_has_its_error_and_its_cost_and_no_state_facts_checks_or_coverage(self):
        failed = score_filing(read(model=ScriptedModel(locate=[NOTHING_LOCATED])), gold(row()))
        self.assertEqual((failed.state, failed.fact_count, failed.checks, failed.warnings, failed.coverage), (None, 0, {}, 0, {}))
        self.assertEqual((failed.error_code, failed.model_calls, failed.bytes), ("NO_STATEMENTS_FOUND", 1, len(PDF)))  # it did locate

    def test_checks_warnings_and_coverage_are_counted_by_status(self):
        wrong = balance_sheet(total="2,100")  # the page prints 2,000; the re-reads cannot fix it
        model = ScriptedModel(extract={"balance_sheet": [wrong], "income_statement": [income_statement()], "cash_flow": [cash_flow()]},
                              correct=[wrong.sections[0]])
        artefact = read(model=model)
        checked = score_filing(artefact, gold(row()))
        self.assertEqual(checked.checks, {"failed": 2, "passed": 1})  # the subtotal and the balance identity fail
        # How many re-reads and warnings the workflow makes is its own business: the score carries what the artefact holds.
        self.assertGreater(artefact.model_calls.correct, 0)
        self.assertGreater(len(artefact.result["warnings"]), 0)
        self.assertEqual((checked.warnings, checked.model_calls), (len(artefact.result["warnings"]), artefact.model_calls.total))
        model = ScriptedModel(extract={"balance_sheet": [balance_sheet()], "income_statement": [income_statement()],
                                       "cash_flow": [ModelOutputError("unusable")]})
        partial = score_filing(read(model=model), gold(row()))
        self.assertEqual((partial.state, partial.coverage), ("partial", {"extracted": 2, "failed": 1}))


class SummaryTests(unittest.TestCase):
    def test_every_outcome_has_a_count_in_the_summary(self):
        # Phase 0's six, then the three only an XBRL figure gives, which the PDF path never does.
        self.assertEqual(OUTCOMES, ("match", "wrong_value", "wrong_scale", "wrong_status", "ambiguous", "missing",
                                    "match_at_precision", "match_dash_zero", "wrong_sign"))
        self.assertLessEqual(set(OUTCOMES), set(Summary.model_fields))  # a count for an outcome the summary lacks would be dropped

    def test_rates_are_rounded_down_to_one_decimal_so_only_everything_reads_100(self):
        self.assertEqual(Summary(gold_facts=3, match=2).rate("match"), "66.6%")
        self.assertEqual(Summary(gold_facts=2000, match=1999).rate("match"), "99.9%")
        self.assertEqual(Summary(gold_facts=3, match=3).rate("match"), "100.0%")
        self.assertEqual(Summary(gold_facts=3).rate("match"), "0.0%")

    def test_each_rate_is_over_its_own_denominator(self):
        summary = Summary(filings=4, extracted=3, failed=1, gold_facts=8, missing=2, page_checked=6, page_match=3,
                          checks_passed=2, checks_failed=1, checks_not_checked=1)
        names = ("extracted", "failed", "missing", "page_match", "checks_passed", "checks_failed", "checks_not_checked")
        self.assertEqual([summary.rate(name) for name in names], ["75.0%", "25.0%", "25.0%", "50.0%", "50.0%", "25.0%", "25.0%"])

    def test_a_rate_with_nothing_to_divide_by_is_a_dash(self):
        for name in ("match", "missing", "page_match", "checks_passed", "extracted", "failed"):
            with self.subTest(name=name):
                self.assertEqual(Summary().rate(name), "—")
        self.assertEqual(Summary(gold_facts=2).rate("page_match"), "—")  # facts to score, but none was found to check a page of


class ScoreRunTests(unittest.TestCase):
    def test_not_run_and_gold_missing_are_listed_not_scored(self):
        artefact = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        other = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                       kind="annual_report", period_end="2026-03-31", set="heldout")
        other_gold = freeze_sheet([row()], other, TAXONOMY, WHEN)
        unlabelled = run_filing(other.model_copy(update={"file": "other-metals/q1.pdf"}), PDF, lambda: ScriptedModel(), FAST)
        score = score_run("r", [artefact, unlabelled], {FILING.id: gold(row()), other.id: other_gold},
                          manifest_ids=[FILING.id, other.id, "other-metals/q1"], eval_set="all")
        self.assertEqual([f.filing_id for f in score.filings], [FILING.id])
        self.assertEqual(score.not_run, [other.id])
        self.assertEqual(score.gold_missing, ["other-metals/q1"])
        summary = score.summary()
        self.assertEqual((summary.filings, summary.gold_facts, summary.match), (1, 1, 1))
        self.assertEqual(summary.rate("match"), "100.0%")

    def test_set_filter_and_strata(self):
        dev = run_filing(FILING, PDF, lambda: ScriptedModel(), FAST)
        held = Filing(file="other-metals/ar-2025-26.pdf", company="Other Metals Limited",
                      kind="annual_report", period_end="2026-03-31", set="heldout")
        held_artefact = run_filing(held, PDF, lambda: ScriptedModel(locate=[LocateOutput(statements=[])]), FAST)
        golds = {FILING.id: gold(row()), held.id: freeze_sheet([row()], held, TAXONOMY, WHEN)}
        both = score_run("r", [dev, held_artefact], golds, [FILING.id, held.id], eval_set="all")
        self.assertEqual(both.summary().failed, 1)
        self.assertEqual(both.strata()["scanned"]["yes"].filings, 2)
        self.assertEqual(both.strata()["kind"]["annual_report"].match, 1)
        self.assertEqual(both.strata()["basis"]["consolidated"].gold_facts, 2)
        only_dev = score_run("r", [dev, held_artefact], golds, [FILING.id, held.id], eval_set="dev")
        self.assertEqual([f.filing_id for f in only_dev.filings], [FILING.id])
        self.assertEqual(only_dev.summary().rate("page_match"), "100.0%")

    def test_rates_with_no_denominator_are_a_dash(self):
        score = score_run("r", [], {}, [], eval_set="dev")
        self.assertEqual(score.summary().rate("match"), "—")
        self.assertEqual(score.summary().seconds_median, None)

    def test_strata_by_size_band_with_none_for_a_filing_that_has_no_stratum(self):
        banded = FILING.model_copy(update={"stratum": "small"})
        golds = {banded.id: freeze_sheet([row()], banded, TAXONOMY, WHEN), OTHER.id: freeze_sheet([row()], OTHER, TAXONOMY, WHEN)}
        score = score_run("r", [read(banded), read(OTHER)], golds, list(golds), eval_set="all")
        self.assertEqual([f.stratum for f in score.filings], [None, "small"])
        strata = score.strata()
        self.assertEqual(list(strata), ["kind", "scanned", "basis", "statement", "stratum"])
        self.assertEqual({value: summary.filings for value, summary in strata["stratum"].items()}, {"none": 1, "small": 1})
        self.assertEqual(strata["stratum"]["small"].match, 1)
        self.assertEqual(score_run("r", [], {}, [], eval_set="all").strata()["stratum"], {})

    def test_strata_count_each_group_by_its_own_attribute(self):
        year = dict(statement="income_statement", section="Profit and loss", period_label="Year ended 31 March 2026", page="3")
        score = score_run("r", [read()], {FILING.id: gold(
            row(),  # balance sheet, consolidated: matches
            row(row="2", label="Revenue", concept="revenue_from_operations", printed="5,000", **year),  # income statement: matches
            row(row="3", label="Profit", concept="profit_after_tax", printed="2,001", **year),  # income statement: the figure is wrong
            row(row="4", basis="standalone"),  # balance sheet, standalone: only the consolidated statements were read
        )}, [FILING.id], eval_set="dev")
        strata = score.strata()

        def counts(group, name):
            return {value: getattr(summary, name) for value, summary in strata[group].items()}

        self.assertEqual(counts("statement", "gold_facts"), {"balance_sheet": 2, "income_statement": 2})
        self.assertEqual(counts("statement", "match"), {"balance_sheet": 1, "income_statement": 1})
        self.assertEqual(counts("statement", "wrong_value"), {"balance_sheet": 0, "income_statement": 1})
        self.assertEqual(counts("basis", "gold_facts"), {"consolidated": 3, "standalone": 1})
        self.assertEqual(counts("basis", "match"), {"consolidated": 2, "standalone": 0})
        self.assertEqual(counts("basis", "missing"), {"consolidated": 0, "standalone": 1})

    def test_filings_with_a_scanned_statement_page_are_told_from_the_rest(self):
        golds = {FILING.id: gold(row()), OTHER.id: freeze_sheet([row()], OTHER, TAXONOMY, WHEN)}
        artefacts = [read(FILING), read(OTHER).model_copy(update={"pages_without_text": []})]
        strata = score_run("r", artefacts, golds, list(golds), eval_set="all").strata()["scanned"]
        self.assertEqual({value: summary.filings for value, summary in strata.items()}, {"yes": 1, "no": 1})

    def test_out_of_scope_ids_are_kept_sorted_and_are_never_listed_as_not_run(self):
        golds = {FILING.id: gold(row()), OTHER.id: freeze_sheet([row()], OTHER, TAXONOMY, WHEN)}
        ids = [FILING.id, OTHER.id]
        plain = score_run("r", [], golds, ids, eval_set="all")
        self.assertEqual((plain.not_run, plain.out_of_scope), ([OTHER.id, FILING.id], []))
        skipped = score_run("r", [], golds, ids, eval_set="all", out_of_scope_ids=[OTHER.id, "a-co/ar-2025-26"])
        self.assertEqual(skipped.not_run, [FILING.id])
        self.assertEqual(skipped.out_of_scope, ["a-co/ar-2025-26", OTHER.id])
        # Out of scope is a note about the manifest: a filing that was read anyway is scored.
        read_anyway = score_run("r", [read(FILING)], golds, ids, eval_set="all", out_of_scope_ids=[FILING.id])
        self.assertEqual([f.filing_id for f in read_anyway.filings], [FILING.id])

    def test_not_run_is_the_gold_of_the_chosen_set_that_the_manifest_lists(self):
        golds = {FILING.id: gold(row()), OTHER.id: freeze_sheet([row()], OTHER, TAXONOMY, WHEN)}
        ids = [FILING.id, OTHER.id]
        self.assertEqual(score_run("r", [], golds, ids, eval_set="dev").not_run, [FILING.id])
        self.assertEqual(score_run("r", [], golds, ids, eval_set="heldout").not_run, [OTHER.id])
        self.assertEqual(score_run("r", [], golds, [FILING.id], eval_set="all").not_run, [FILING.id])  # the manifest dropped OTHER

    def test_timings_cover_the_filings_that_were_read_and_model_calls_all_of_them(self):
        filings = [Filing(file=f"{name}/ar-2025-26.pdf", company=f"{name} Limited", kind="annual_report",
                          period_end="2026-03-31", set="dev") for name in ("a-co", "b-co", "c-co")]
        first = read(filings[0]).model_copy(update={"seconds": 10.0})
        second = read(filings[1]).model_copy(update={"seconds": 20.0, "model_calls": ModelCalls(locate=1, extract=3, correct=2)})
        third = read(filings[2], ScriptedModel(locate=[NOTHING_LOCATED])).model_copy(update={"seconds": 99.0})
        golds = {f.id: freeze_sheet([row()], f, TAXONOMY, WHEN) for f in filings}
        summary = score_run("r", [first, second, third], golds, list(golds), eval_set="dev").summary()
        self.assertEqual((summary.filings, summary.extracted, summary.failed), (3, 2, 1))
        self.assertEqual((summary.seconds_median, summary.seconds_max), (15.0, 20.0))  # the failed read is left out
        self.assertEqual((summary.model_calls_median, summary.model_calls_max), (4, 6))  # calls 4, 6 and 1
        self.assertEqual((summary.gold_facts, summary.match, summary.missing, summary.page_checked, summary.page_match), (3, 2, 1, 2, 2))
        self.assertEqual((summary.checks_passed, summary.checks_failed, summary.checks_not_checked), (6, 0, 0))
        self.assertEqual((summary.rate("failed"), summary.rate("checks_passed")), ("33.3%", "100.0%"))

    def test_a_pdf_run_is_scored_as_before(self):
        # The XBRL work adds a source and three outcomes; a PDF run keeps phase 0's counts and gives none of the three.
        filings = [Filing(file=f"{name}/ar-2025-26.pdf", company=f"{name} Limited", kind="annual_report",
                          period_end="2026-03-31", set="dev") for name in ("a-co", "b-co", "c-co")]
        first = read(filings[0]).model_copy(update={"seconds": 10.0})
        second = read(filings[1]).model_copy(update={"seconds": 20.0, "model_calls": ModelCalls(locate=1, extract=3, correct=2)})
        third = read(filings[2], ScriptedModel(locate=[NOTHING_LOCATED])).model_copy(update={"seconds": 99.0})
        golds = {f.id: freeze_sheet([row()], f, TAXONOMY, WHEN) for f in filings}
        timed = score_run("r", [first, second, third], golds, list(golds), eval_set="dev")
        one = score_run("r", [read()], {FILING.id: gold(row())}, [FILING.id], eval_set="dev")
        new = {"match_at_precision": 0, "match_dash_zero": 0, "wrong_sign": 0}
        expected = {
            "timed": {"filings": 3, "extracted": 2, "failed": 1, "gold_facts": 3, "match": 2, "wrong_value": 0, "wrong_scale": 0,
                      "wrong_status": 0, "ambiguous": 0, "missing": 1, "page_checked": 2, "page_match": 2, "checks_passed": 6,
                      "checks_failed": 0, "checks_not_checked": 0, "seconds_median": 15.0, "seconds_max": 20.0,
                      "model_calls_median": 4, "model_calls_max": 6, **new},
            "one": {"filings": 1, "extracted": 1, "failed": 0, "gold_facts": 1, "match": 1, "wrong_value": 0, "wrong_scale": 0,
                    "wrong_status": 0, "ambiguous": 0, "missing": 0, "page_checked": 1, "page_match": 1, "checks_passed": 3,
                    "checks_failed": 0, "checks_not_checked": 0, "seconds_median": one.filings[0].seconds,
                    "seconds_max": one.filings[0].seconds, "model_calls_median": one.filings[0].model_calls,
                    "model_calls_max": one.filings[0].model_calls, **new},
        }
        for name, score in (("timed", timed), ("one", one)):
            with self.subTest(run=name):
                self.assertEqual(score.source, "pdf")
                self.assertEqual(list(score.strata()), ["kind", "scanned", "basis", "statement", "stratum"])
                self.assertEqual(score.summary().model_dump(), expected[name])
                self.assertTrue(all(f.source == "pdf" and f.outside_slots == 0 and f.not_placed == {} for f in score.filings))
                self.assertEqual([f.gold_index for filing in score.filings for f in filing.facts], [None] * score.summary().gold_facts)

    def test_the_run_and_the_versions_it_was_made_with_are_carried(self):
        score = score_run("20261016T093005Z-baseline", [read()], {FILING.id: gold(row())}, [FILING.id], "dev",
                          pipeline_version="extract-2", prompt_version="abc123", model="scripted-model")
        self.assertEqual((score.run, score.eval_set, score.pipeline_version, score.prompt_version, score.model),
                         ("20261016T093005Z-baseline", "dev", "extract-2", "abc123", "scripted-model"))
        bare = score_run("r", [], {}, [], "dev")
        self.assertEqual((bare.pipeline_version, bare.prompt_version, bare.model), (None, None, None))


if __name__ == "__main__":
    unittest.main()
