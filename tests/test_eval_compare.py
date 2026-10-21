"""`maester-eval compare`: Gemini against XBRL, cell by cell, within the instances' own slots. Offline.

Every expected outcome is worked out by hand in the comment beside it."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import RESULTS_Q2, instance_read, pdf_artefact, pdf_fact, row, xbrl_artefact, xbrl_fact
from test_eval_owners import FIRST, NEWER, OLDER, SECOND
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.artefacts import write_artefact, write_run
from maester_eval.cells import COMPARE_RULE_VERSION
from maester_eval.compare import (
    COMPARE_OUTCOMES, compare_filing, compare_runs, agreement_tenths, exact_agreement_tenths, render_compare_markdown,
    settle_rows, write_compare,
)
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import read_sheet
from maester_eval.manifest import Filing, Manifest, XbrlPair, tag_values
from maester_eval.owners import OWNER_RULE_VERSION
from maester_eval.paths import EvalPaths
from maester_eval.periods import SPAN_RULE_VERSION
from maester_eval.sheet_concepts import CONCEPT_CARRY_VERSION, load_company_concepts
from maester_eval.sheets import sheet_path, write_sheet
from maester_eval.source_rule import SOURCE_RULE_VERSION

TAXONOMY = load_taxonomy()
A, B, C = (f"synthetic-cements/xbrl/{name}" for name in ("a.xml", "b.xml", "c.xml"))
COMPANY = "synthetic-cements"
WHEN = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
HALF_YEAR = dict(span="half_year", periodStart="2025-04-01", contextId="FourD", periodLabel="Half year ended 30.09.2025")

# The PDF facts: 1 revenue, consolidated quarter, read right; 2 the same standalone, read as 10,500.00 lakh against
# XBRL's 10,000.00; 3 the consolidated quarter a year before, a comparative; 4 other income, consolidated quarter.
REVENUE = pdf_fact()
REVENUE_STANDALONE = pdf_fact(basis="standalone", reportedText="10,500.00", reportedValue="10500.00",
                              normalizedValue="1050000000")
COMPARATIVE = pdf_fact(periodLabel="Quarter ended 30.09.2024", periodEnd="2024-09-30", reportedText="11,000.00",
                       reportedValue="11000.00", normalizedValue="1100000000")
OTHER_INCOME_PDF = pdf_fact(reportedLabel="Other income", lineOrder=2, reportedText="234.50", reportedValue="234.50",
                            normalizedValue="23450000")
PDF_FACTS = [REVENUE, REVENUE_STANDALONE, COMPARATIVE, OTHER_INCOME_PDF]


def other_income(instance=A, **values):
    """XBRL's consolidated other income of the quarter, 234.50 lakh."""
    return xbrl_fact(element="OtherIncome", concept="other_income", reportedLabel="Other income",
                     normalizedValue="23450000", reportedValue="234.50", instance=instance, **values)


XBRL_FACTS = [xbrl_fact(), other_income(),
              xbrl_fact(basis="standalone", normalizedValue="1000000000", reportedValue="10000.00", instance=B)]


def label(label_text="Revenue from operations", concept="revenue_from_operations", number="1", section="Income"):
    """A labelling sheet row for an income statement line, as a person filled its concept (not verified)."""
    return row(row=number, statement="income_statement", basis="consolidated", section=section, label=label_text,
               concept=concept, period_label="Quarter ended 30.09.2025", period_end="2025-09-30")


def nonzero(counts):
    return {k: v for k, v in counts.items() if v}


def unused(file, reason):
    return instance_read(file, used=False, reason=reason, format=None, mapped=False, state=None)


class CompareCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sheets = Path(self.temp.name) / "sheets"
        self.label_sheet(label())
        self.pdf = pdf_artefact(RESULTS_Q2, PDF_FACTS)
        self.xbrl = xbrl_artefact(RESULTS_Q2, XBRL_FACTS)
        self.tags = tag_values(RESULTS_Q2)

    def label_sheet(self, *rows):
        write_sheet(sheet_path(self.sheets, RESULTS_Q2.id), list(rows))
        self.concepts = load_company_concepts(self.sheets, COMPANY, TAXONOMY)

    def compare(self, pdf_facts, xbrl_facts=None, xbrl=None):
        xbrl = xbrl if xbrl is not None else xbrl_artefact(RESULTS_Q2, xbrl_facts)
        return compare_filing(pdf_artefact(RESULTS_Q2, pdf_facts), xbrl, self.concepts, self.tags)

    def one_cell(self, gemini, xbrl):
        """The revenue cell of a filing of one Gemini fact against a.xml holding `xbrl` (when given) and other income
        of the same slot, so the slot is read whatever `xbrl` is."""
        facts = [other_income()] if xbrl is None else [xbrl, other_income()]
        fc = self.compare([gemini], facts)
        (cell,) = [c for c in fc.cells if c.concept == "revenue_from_operations"]
        return cell


class CellTests(CompareCase):
    def test_the_outcomes(self):
        self.assertEqual(len(COMPARE_OUTCOMES), 16)
        self.assertEqual(COMPARE_RULE_VERSION, 1)

    def test_cells_by_outcome(self):
        fc = compare_filing(self.pdf, self.xbrl, self.concepts, self.tags)
        # Fact 4 has no concept and sits in other_income's slot, so XBRL's other income is "unlabelled", not "XBRL only".
        # Fact 3 is a comparative: outside the instance, so its concept is never looked up.
        self.assertEqual(nonzero(fc.counts), {"agree": 1, "disagree_value": 1, "unlabelled": 1, "outside_instance": 1,
                                              "no_concept": 1, "concept_own": 2})
        self.assertEqual(agreement_tenths(fc.counts), 500)                  # 1 of 2
        self.assertEqual(exact_agreement_tenths(fc.counts), 500)
        self.assertEqual((fc.compared, fc.reason, fc.filing_id, fc.set), (True, None, RESULTS_Q2.id, "dev"))
        self.assertEqual(len(COMPARE_OUTCOMES) + 6, len(fc.counts))          # every outcome and every Gemini count, zero or not

    def test_a_cell_carries_both_sides(self):
        fc = compare_filing(self.pdf, self.xbrl, self.concepts, self.tags)
        (cell,) = [c for c in fc.cells if c.outcome == "disagree_value"]
        self.assertEqual(
            (cell.statement, cell.basis, cell.span, cell.period_end, cell.period_label, cell.concept, cell.concept_from),
            ("income_statement", "standalone", "quarter", "2025-09-30", "Quarter ended 30.09.2025", "revenue_from_operations", "own"))
        self.assertEqual((cell.pdf_row, cell.pdf_printed, cell.pdf_page, cell.pdf_unit, cell.pdf_normalized),
                         (2, "10,500.00", 2, "₹ in lakh", "1050000000"))
        self.assertEqual((cell.xbrl_element, cell.xbrl_value, cell.xbrl_unit, cell.xbrl_normalized),
                         ("RevenueFromOperations", "10000.00", "₹ lakh", "1000000000"))
        self.assertEqual(cell.slot, "synthetic-cements|financial_results|income_statement|standalone|2025-09-30|quarter")

    def test_a_concept_carried_from_another_filing_is_company(self):
        write_sheet(sheet_path(self.sheets, f"{COMPANY}/results-2025-06"), [label()])
        self.label_sheet(label("Other income", "other_income", "2"))
        fc = compare_filing(self.pdf, self.xbrl, load_company_concepts(self.sheets, COMPANY, TAXONOMY), self.tags)
        # Revenue now comes from the June sheet, other income from the filing's own.
        self.assertEqual(nonzero(fc.counts), {"agree": 2, "disagree_value": 1, "outside_instance": 1, "concept_own": 1,
                                              "concept_company": 2})

    def test_xbrl_only_needs_every_gemini_line_of_the_slot_labelled(self):
        # The same filing with fact 4 labelled other_expenses: XBRL's other income is xbrl_only and Gemini's other expenses pdf_only.
        self.label_sheet(label(), label("Other income", "other_expenses", "2"))
        fc = compare_filing(self.pdf, self.xbrl, self.concepts, self.tags)
        self.assertEqual(nonzero(fc.counts), {"agree": 1, "disagree_value": 1, "xbrl_only": 1, "pdf_only": 1,
                                              "outside_instance": 1, "concept_own": 3})

    def test_a_filing_with_no_concepts_is_not_compared(self):
        # No sheet for the company: compared False, reason no_concepts, no cell and no not_read.
        empty = load_company_concepts(Path(self.temp.name) / "none", COMPANY, TAXONOMY)
        fc = compare_filing(self.pdf, self.xbrl, empty, self.tags)
        self.assertEqual((fc.compared, fc.reason, fc.cells, nonzero(fc.counts), fc.instances_differ),
                         (False, "no_concepts", [], {}, []))

    def test_a_header_with_no_span_makes_its_slot_span_unknown(self):
        # Gemini "Current period ended 30.09.2025" (no_span); XBRL FourD half-year facts:
        # each XBRL half-year cell is span_unknown, none not_read.
        fc = self.compare([pdf_fact(periodLabel="Current period ended 30.09.2025")],
                          [xbrl_fact(**HALF_YEAR, normalizedValue="2469000000"), other_income(**HALF_YEAR)])
        self.assertEqual(nonzero(fc.counts), {"span_unknown": 2, "no_span": 1})
        self.assertEqual({c.span for c in fc.cells}, {"half_year"})

    def test_a_no_span_fact_of_another_basis_leaves_the_slot_not_read(self):
        fc = self.compare([pdf_fact(basis="standalone", periodLabel="Current period ended 30.09.2025")],
                          [xbrl_fact(**HALF_YEAR, normalizedValue="2469000000")])
        self.assertEqual(nonzero(fc.counts), {"not_read": 1, "no_span": 1})

    def test_a_quarter_never_meets_its_half_year(self):
        # Gemini: quarter 1234500000 and "Half year ended 30.09.2025" 2469000000; XBRL OneD 1234500000, FourD 2469000000.
        fc = self.compare([pdf_fact(), pdf_fact(periodLabel="Half year ended 30.09.2025", reportedText="24,690.00",
                                                reportedValue="24690.00", normalizedValue="2469000000")],
                          [xbrl_fact(), xbrl_fact(**HALF_YEAR, normalizedValue="2469000000", reportedValue="24690.00")])
        self.assertEqual(sorted((c.span, c.outcome) for c in fc.cells), [("half_year", "agree"), ("quarter", "agree")])

    def test_a_fact_with_no_date_is_not_placed(self):
        fc = self.compare([pdf_fact(), pdf_fact(periodEnd=None)], [xbrl_fact()])
        self.assertEqual(nonzero(fc.counts), {"agree": 1, "no_period": 1, "concept_own": 1})

    def test_two_instances_of_one_slot(self):
        # Two consolidated instances filed the same day, "…_29052026075158.xml" (revenue 1234500000) and "…_1572026202819.xml"
        # (1234600000); Gemini 1234600000: agree (the owner is the later stamp, the smaller name).
        gemini = pdf_fact(reportedText="12,346.00", reportedValue="12346.00", normalizedValue="1234600000")
        fc = self.compare([gemini], [xbrl_fact(instance=OLDER),
                                     xbrl_fact(normalizedValue="1234600000", reportedValue="12346.00", instance=NEWER)])
        self.assertEqual([(c.concept, c.outcome) for c in fc.cells], [("revenue_from_operations", "agree")])
        (differ,) = fc.instances_differ
        self.assertEqual((differ.element, differ.owner, differ.others), ("RevenueFromOperations", NEWER, [OLDER]))
        # The same two with the stamps "…_1062025211739.xml" and "…_1062025221059.xml" (no order): the cell is
        # instances_differ, outside agreement, and no settle row.
        pdf = pdf_artefact(RESULTS_Q2, [gemini])
        pooled = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=FIRST),
                                            xbrl_fact(normalizedValue="1234600000", reportedValue="12346.00", instance=SECOND)])
        fc = compare_filing(pdf, pooled, self.concepts, self.tags)
        (cell,) = fc.cells
        self.assertEqual((cell.outcome, cell.xbrl_element, cell.xbrl_value, cell.xbrl_normalized),
                         ("instances_differ", "RevenueFromOperations", None, None))
        self.assertIsNone(agreement_tenths(fc.counts))
        self.assertEqual(settle_rows(fc, pdf), [])
        (differ,) = fc.instances_differ
        self.assertEqual((differ.owner, differ.others), (None, [FIRST, SECOND]))

    def test_dash_zero_nil_status_sign_scale_and_precision(self):
        dash = dict(reportedText="-", reportedValue=None, valueStatus="dash", normalizedValue=None)
        cases = [  # (Gemini fact, XBRL fact or None, outcome)
            (pdf_fact(**dash), xbrl_fact(normalizedValue="0", reportedValue="0"), "agree_dash_zero"),
            (pdf_fact(**dash), xbrl_fact(), "disagree_status"),
            (pdf_fact(**dash), xbrl_fact(valueStatus="unparsed", nil=True, normalizedValue=None, reportedValue=None), "xbrl_unknown"),
            (pdf_fact(), xbrl_fact(normalizedValue="0", reportedValue="0"), "disagree_status"),
            (pdf_fact(**dash), None, "pdf_only"),
            (pdf_fact(), None, "pdf_only"),
            (pdf_fact(), xbrl_fact(valueStatus="unparsed", nil=True, normalizedValue=None, reportedValue=None), "xbrl_unknown"),
            (pdf_fact(valueStatus="unparsed", reportedValue=None, normalizedValue=None), xbrl_fact(), "pdf_unknown"),
            (pdf_fact(scaleFactor=None, normalizedValue=None), xbrl_fact(), "pdf_unknown"),     # no scale
            (pdf_fact(scaleFactor="10000000", normalizedValue="123450000000"), xbrl_fact(reportedValue="12345.00"), "disagree_scale"),
            # 1,235 crore is known to 10^7; 1234.5 crore at decimals -6 rounds half up to 1,235 crore.
            (pdf_fact(reportedText="1,235", reportedValue="1235", scaleFactor="10000000", normalizedValue="12350000000"),
             xbrl_fact(normalizedValue="12345000000", reportedValue="1234.5", decimals="-6"), "agree_at_precision"),
            # 1,234 crore against the same: apart at 10^7.
            (pdf_fact(reportedText="1,234", reportedValue="1234", scaleFactor="10000000", normalizedValue="12340000000"),
             xbrl_fact(normalizedValue="12345000000", reportedValue="1234.5", decimals="-6"), "disagree_value"),
            (pdf_fact(reportedText="(12,345.00)", reportedValue="-12345.00", normalizedValue="-1234500000"), xbrl_fact(), "disagree_sign"),
            # Opposite in sign and apart in size is a value disagreement.
            (pdf_fact(reportedText="(12,346.00)", reportedValue="-12346.00", normalizedValue="-1234600000"), xbrl_fact(), "disagree_value"),
            (pdf_fact(reportedText="0", reportedValue="0", normalizedValue="0"), xbrl_fact(normalizedValue="0", reportedValue="0"), "agree"),
        ]
        for gemini, xbrl, outcome in cases:
            with self.subTest(gemini=gemini["reportedText"], xbrl=None if xbrl is None else xbrl["normalizedValue"], outcome=outcome):
                self.assertEqual(self.one_cell(gemini, xbrl).outcome, outcome)
        self.assertEqual(agreement_tenths({"agree_dash_zero": 1, "disagree_status": 1, "disagree_sign": 5}), 500)   # sign only is outside
        self.assertEqual(exact_agreement_tenths({"agree": 1, "agree_at_precision": 2}), 333)                       # 1 of 3
        self.assertIsNone(agreement_tenths({"disagree_sign": 1, "instances_differ": 2, "pdf_only": 3}))

    def test_a_column_gemini_did_not_read(self):
        # XBRL cash_flow consolidated half_year facts; no Gemini cash-flow fact at all: each is not_read, none xbrl_only.
        cash = dict(statement="cash_flow", **HALF_YEAR)
        fc = self.compare([pdf_fact()], [
            xbrl_fact(),
            xbrl_fact(element="NetCashFlowsFromUsedInOperatingActivities", concept="net_cash_from_operating_activities",
                      normalizedValue="500000000", **cash),
            xbrl_fact(element="NetCashFlowsFromUsedInInvestingActivities", concept="net_cash_from_investing_activities",
                      normalizedValue="-200000000", **cash)])
        self.assertEqual(nonzero(fc.counts), {"agree": 1, "not_read": 2, "concept_own": 1})

    def test_ambiguous_and_not_compared(self):
        # Two Gemini facts, one cell, two figures: ambiguous, with no Gemini figure picked.
        fc = self.compare([pdf_fact(), pdf_fact(lineOrder=5, reportedText="12,346.00", reportedValue="12346.00",
                                                normalizedValue="1234600000")], [xbrl_fact()])
        (cell,) = fc.cells
        self.assertEqual((cell.outcome, cell.pdf_row, cell.pdf_printed), ("ambiguous", None, None))
        self.assertEqual(agreement_tenths(fc.counts), 0)                     # ambiguous is in the denominator
        # The same figure twice is one candidate.
        self.assertEqual([c.outcome for c in self.compare([pdf_fact(), pdf_fact(lineOrder=5)], [xbrl_fact()]).cells], ["agree"])
        # Two XBRL elements of one concept with two figures: ambiguous too, never a pick.
        fc = self.compare([pdf_fact()], [xbrl_fact(), xbrl_fact(element="RevenueFromOperationsOther", normalizedValue="1")])
        self.assertEqual([(c.outcome, c.xbrl_element) for c in fc.cells], [("ambiguous", None)])
        # A filing whose instances are all unmapped: compared False, reason no_mapped_instance.
        for reason, expected in (("XBRL_FORMAT_UNMAPPED", "no_mapped_instance"), ("XBRL_UNREADABLE:DOCTYPE", "no_mapped_instance"),
                                 ("XBRL_PAIR_BASIS", "pair_mismatch")):
            with self.subTest(reason=reason):
                fc = self.compare(PDF_FACTS, xbrl=xbrl_artefact(RESULTS_Q2, [], instances=[unused(C, reason)]))
                self.assertEqual((fc.compared, fc.reason, fc.cells, nonzero(fc.counts)), (False, expected, [], {}))
        failed = pdf_artefact(RESULTS_Q2, []).model_copy(update={"result": None})
        fc = compare_filing(failed, self.xbrl, self.concepts, self.tags)
        self.assertEqual((fc.compared, fc.reason), (False, "pdf_failed"))

    def test_settle_rows(self):
        rows = settle_rows(compare_filing(self.pdf, self.xbrl, self.concepts, self.tags), self.pdf)
        self.assertEqual([(r["row"], r["concept"], r["concept_from"], r["span"], r["printed"], r["xbrl_value"], r["xbrl_unit"],
                           r["xbrl_normalized"], r["outcome"]) for r in rows],
                         [("2", "revenue_from_operations", "own", "quarter", "10,500.00", "10000.00", "₹ lakh", "1000000000",
                           "disagree_value")])
        self.assertEqual(rows[0]["xbrl_element"], "RevenueFromOperations")

    def test_no_sign_only_cell_gets_a_settle_row(self):
        pdf = pdf_artefact(RESULTS_Q2, [pdf_fact(reportedText="(12,345.00)", reportedValue="-12345.00", normalizedValue="-1234500000")])
        fc = compare_filing(pdf, xbrl_artefact(RESULTS_Q2, [xbrl_fact()]), self.concepts, self.tags)
        self.assertEqual(([c.outcome for c in fc.cells], settle_rows(fc, pdf)), (["disagree_sign"], []))


def paired(filing, *bases):
    pairs = [XbrlPair(file=f"{filing.company_folder}/xbrl/{name}.xml", basis=basis, period="SQ2025-2026", filed="2025-10-17",
                      format="in-capmkt/ind_as") for name, basis in zip(("a", "b"), bases)]
    return filing.model_copy(update={"xbrl": pairs})


Q2_PAIRED = paired(RESULTS_Q2, "consolidated", "standalone")
NO_PDF = paired(RESULTS_Q2.model_copy(update={"file": "synthetic-cements/results-2025-06.pdf", "period_end": "2025-06-30"}),
                "consolidated").model_copy(update={"xbrl": [XbrlPair(file="synthetic-cements/xbrl/june.xml", basis="consolidated",
                                                                       period="JQ2025-2026", filed="2025-07-17", format=None)]})
UNPAIRED = RESULTS_Q2.model_copy(update={"file": "synthetic-cements/results-2024-09.pdf", "period_end": "2024-09-30"})
HELD_OUT = paired(Filing(file="synthetic-steels/results-2025-09.pdf", company="Synthetic Steels Limited", kind="financial_results",
                         period_end="2025-09-30", set="heldout", bse_code="500998"), "consolidated")


class RunTests(CompareCase):
    def run_of(self, manifest, pdf_artefacts, xbrl_artefacts, eval_set="dev"):
        return compare_runs(pdf_artefacts, xbrl_artefacts, manifest, self.sheets, TAXONOMY, eval_set, "p", "x",
                            {"parser_version": "xbrl-parser-1", "map_version": "map-3"}, WHEN)

    def test_compare_runs_lists_every_paired_filing_of_the_set(self):
        manifest = Manifest(filings=[Q2_PAIRED, NO_PDF, UNPAIRED, HELD_OUT])
        run = self.run_of(manifest, [self.pdf], [self.xbrl])
        self.assertEqual([(f.filing_id, f.compared, f.reason) for f in run.filings],
                         [(RESULTS_Q2.id, True, None), (NO_PDF.id, False, "no_pdf_artefact")])
        self.assertEqual(run.versions, {"span_rule": SPAN_RULE_VERSION, "compare_rule": COMPARE_RULE_VERSION,
                                        "concept_carry": CONCEPT_CARRY_VERSION, "owner_rule": OWNER_RULE_VERSION,
                                        "source_rule": SOURCE_RULE_VERSION, "parser": "xbrl-parser-1", "map": "map-3"})
        self.assertEqual((run.pdf_run, run.xbrl_run, run.eval_set, run.generated_at), ("p", "x", "dev", WHEN))
        self.assertEqual(run.filings[0].tags, tag_values(Q2_PAIRED))
        run = self.run_of(Manifest(filings=[Q2_PAIRED]), [self.pdf], [])
        self.assertEqual([(f.compared, f.reason) for f in run.filings], [(False, "no_xbrl_artefact")])

    def test_the_markdown(self):
        manifest = Manifest(filings=[Q2_PAIRED, NO_PDF])
        sign = pdf_fact(reportedLabel="Other income", reportedText="(234.50)", reportedValue="-234.50", normalizedValue="-23450000")
        self.label_sheet(label(), label("Other income", "other_income", "2"))
        pdf = pdf_artefact(RESULTS_Q2, [REVENUE, REVENUE_STANDALONE, COMPARATIVE, sign])
        run = self.run_of(manifest, [pdf], [self.xbrl])
        md = render_compare_markdown(run, None)
        self.assertIn("# Gemini against XBRL: p and x", md)
        for text in ("compare rule 1", "concept carry rule 1", "owner rule 1", "span rule 1", f"source rule {SOURCE_RULE_VERSION}",
                     "XBRL parser xbrl-parser-1", "XBRL element map map-3"):
            self.assertIn(text, md)
        self.assertIn("Compared: 1 filing(s). Not compared: 1.", md)
        self.assertIn(f"- {NO_PDF.id}: no_pdf_artefact", md)
        self.assertIn("| Agreement | 50.0% |", md)          # agree 1 of agree 1 + disagree_value 1
        self.assertIn("| Sign only (outside agreement) | 1 |", md)
        self.assertIn("## By format tag", md)
        self.assertIn("## By statement", md)
        self.assertIn(f"| {RESULTS_Q2.id} | income_statement | standalone | Quarter ended 30.09.2025 | revenue_from_operations "
                      "| 10,500.00 (2) | 10000.00 ₹ lakh | disagree_value |", md)
        self.assertIn("| OtherIncome | 1 |", md)              # sign only, by element
        self.assertNotIn("## Against", md)

    def test_the_instances_that_differ_and_against(self):
        pooled = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=FIRST),
                                            xbrl_fact(normalizedValue="1234600000", reportedValue="12346.00", instance=SECOND)])
        manifest = Manifest(filings=[Q2_PAIRED])
        run = self.run_of(manifest, [pdf_artefact(RESULTS_Q2, [pdf_fact()])], [pooled])
        earlier = self.run_of(manifest, [pdf_artefact(RESULTS_Q2, [pdf_fact()])], [xbrl_artefact(RESULTS_Q2, [xbrl_fact()])])
        earlier = earlier.model_copy(update={"pdf_run": "p0", "xbrl_run": "x0"})
        md = render_compare_markdown(run, earlier)
        self.assertIn("| RevenueFromOperations | no order (pooled) |", md)
        self.assertIn("## Against p0 and x0", md)
        self.assertIn("| Agreement | — | 100.0% | — |", md)
        self.assertIn("| instances_differ | 1 | 0 | +1 |", md)

    def test_write_compare(self):
        run = self.run_of(Manifest(filings=[Q2_PAIRED]), [self.pdf], [self.xbrl])
        md, js = write_compare(Path(self.temp.name), run, None)
        self.assertEqual((md.name, js.name), ("compare-xbrl.md", "compare-xbrl.json"))
        data = json.loads(js.read_text(encoding="utf-8"))
        self.assertEqual(data["versions"]["map"], "map-3")
        self.assertEqual(data["filings"][0]["counts"]["agree"], 1)
        self.assertEqual(data["against"], None)
        self.assertEqual(data["agreement_tenths"], 500)


class CompareCommandTests(unittest.TestCase):
    """`maester-eval compare` over one PDF run, one XBRL run, their sheets and a manifest, in a temporary data folder."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name))
        for patcher in (mock.patch.dict(os.environ), mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.paths.manifest.write_text(json.dumps({"filings": [f.model_dump(mode="json") for f in (Q2_PAIRED, HELD_OUT)]}),
                                       encoding="utf-8")
        write_sheet(sheet_path(self.paths.sheets, RESULTS_Q2.id), [label()])
        write_sheet(sheet_path(self.paths.sheets, HELD_OUT.id), [label()])
        held_pdf = pdf_artefact(HELD_OUT, [REVENUE_STANDALONE.copy() | {"basis": "consolidated"}])
        held_xbrl = xbrl_artefact(HELD_OUT, [xbrl_fact(instance="synthetic-steels/xbrl/a.xml")])
        self.pdf_run = self.make_run("pdf1", datetime(2026, 10, 20, tzinfo=timezone.utc), [pdf_artefact(RESULTS_Q2, PDF_FACTS), held_pdf])
        self.xbrl_run = self.make_run("xbrl1", datetime(2026, 10, 20, 1, tzinfo=timezone.utc),
                                      [xbrl_artefact(RESULTS_Q2, XBRL_FACTS), held_xbrl],
                                      source="xbrl", parser_version="xbrl-parser-1", map_version="map-3")
        self.settle = self.paths.settle / f"{RESULTS_Q2.id}.csv"

    def make_run(self, label_word, now, artefacts, **record):
        folder = self.paths.new_run(label_word, now=now)
        write_run(folder, {"run": folder.name, "set": "dev", **record})
        for artefact in artefacts:
            write_artefact(folder, artefact)
        return folder

    def invoke(self, *args):
        return CliRunner().invoke(cli.app, ["compare", *args], env={"COLUMNS": "500"})

    def test_the_command(self):
        result = self.invoke("--run", self.pdf_run.name, "--xbrl", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue((self.pdf_run / "compare-xbrl.md").is_file())
        self.assertTrue((self.pdf_run / "compare-xbrl.json").is_file())
        self.assertFalse((self.xbrl_run / "compare-xbrl.md").exists())
        self.assertIn("compared 1 filing(s), not compared 0", result.output)
        self.assertIn("cells: agree 1, disagree 1, sign only 0, instances differ 0, PDF only 0, XBRL only 0, unlabelled 1, "
                      "span unknown 0, not read 0", result.output)
        self.assertIn("agreement 50.0%, exact 50.0%", result.output)
        self.assertIn("settle sheets: 1 written, 0 kept", result.output)
        for figure in ("12345", "12,345", "1234500000", "10,500", "10500", "1050000000", "10000.00"):
            self.assertNotIn(figure, result.output)
        rows = read_sheet(self.settle)
        self.assertEqual([(r["row"], r["outcome"]) for r in rows], [("2", "disagree_value")])
        self.assertTrue(self.settle.read_bytes().startswith(b"\xef\xbb\xbf"))
        # A second call keeps the sheet a person may be settling.
        self.settle.write_text("being settled", encoding="utf-8")
        result = self.invoke("--run", self.pdf_run.name, "--xbrl", self.xbrl_run.name)
        self.assertIn("settle sheets: 0 written, 1 kept", result.output)
        self.assertEqual(self.settle.read_text(encoding="utf-8"), "being settled")
        result = self.invoke("--run", self.pdf_run.name, "--xbrl", self.xbrl_run.name, "--force")
        self.assertIn("settle sheets: 1 written, 0 kept", result.output)

    def test_the_defaults_are_the_latest_runs_of_each_source(self):
        result = self.invoke()
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertTrue((self.pdf_run / "compare-xbrl.md").is_file())

    def test_a_run_of_the_wrong_source_is_refused(self):
        result = self.invoke("--run", self.xbrl_run.name)
        self.assertEqual(result.exit_code, 1, result.output)
        result = self.invoke("--xbrl", self.pdf_run.name)
        self.assertEqual(result.exit_code, 1, result.output)

    def test_held_out_is_gated_and_never_gets_a_settle_sheet(self):
        result = self.invoke("--set", "heldout")
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIn("pass --gate", result.output)
        self.assertFalse((self.pdf_run / "compare-xbrl.md").exists())
        result = self.invoke("--set", "all", "--gate")
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertIn("compared 2 filing(s), not compared 0", result.output)
        self.assertIn("settle sheets: 1 written, 0 kept", result.output)        # the dev filing's only
        self.assertTrue(self.settle.is_file())
        self.assertFalse((self.paths.settle / f"{HELD_OUT.id}.csv").exists())

    def test_against_an_earlier_xbrl_run(self):
        earlier = self.make_run("xbrl0", datetime(2026, 10, 19, tzinfo=timezone.utc), [xbrl_artefact(RESULTS_Q2, [xbrl_fact()])],
                                source="xbrl", parser_version="xbrl-parser-1", map_version="map-2")
        result = self.invoke("--run", self.pdf_run.name, "--xbrl", self.xbrl_run.name, "--against", earlier.name)
        self.assertEqual(result.exit_code, 0, result.output)
        md = (self.pdf_run / "compare-xbrl.md").read_text(encoding="utf-8")
        self.assertIn(f"## Against {self.pdf_run.name} and {earlier.name}", md)
        self.assertFalse((earlier / "compare-xbrl.md").exists())
        data = json.loads((self.pdf_run / "compare-xbrl.json").read_text(encoding="utf-8"))
        self.assertEqual(data["against"], {"pdf_run": self.pdf_run.name, "xbrl_run": earlier.name})

    def test_to_publishes_the_markdown(self):
        target = Path(self.temp.name) / "docs" / "compare.md"
        result = self.invoke("--to", str(target))
        self.assertEqual(result.exit_code, 0, result.output)
        self.assertEqual(target.read_text(encoding="utf-8"), (self.pdf_run / "compare-xbrl.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
