"""A Gemini fact's concept from its company's labelling sheets, by section and label. Offline."""

from pathlib import Path
import tempfile
import unittest

from eval_fixtures import row

from maester_eval.concepts import load_taxonomy
from maester_eval.sheet_concepts import CONCEPT_CARRY_VERSION, ConceptPick, load_company_concepts
from maester_eval.sheets import sheet_path, write_sheet

C = "synthetic-cements"
Q2, Q1, Q3 = f"{C}/results-2025-09", f"{C}/results-2025-06", f"{C}/results-2025-12"


def line(concept, label, section="Income", statement="income_statement", verified=""):
    return row(statement=statement, section=section, label=label, concept=concept, verified=verified)


class SheetConceptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.sheets = Path(self.temp.name)
        self.taxonomy = load_taxonomy()

    def sheet(self, filing_id, *rows):
        write_sheet(sheet_path(self.sheets, filing_id), list(rows))

    def load(self, company=C):
        return load_company_concepts(self.sheets, company, self.taxonomy)

    def test_the_version(self):
        self.assertEqual(CONCEPT_CARRY_VERSION, 1)

    def test_own_row_then_carried_to_another_filing(self):
        # Verified or not does not matter: the first row is unverified.
        self.sheet(Q2, line("revenue_from_operations", "Revenue from operations"))
        cc = self.load()
        self.assertEqual(cc.lookup(Q2, "income_statement", "Income", "Revenue from operations"),
                         ConceptPick("revenue_from_operations", "own"))
        # Another filing of the company: case and punctuation of section and label are ignored.
        self.assertEqual(cc.lookup(Q3, "income_statement", "INCOME", "Revenue from Operations"),
                         ConceptPick("revenue_from_operations", "company"))
        # Another sheet of the company is "company" too.
        self.assertEqual(cc.lookup(Q1, "income_statement", "Income", "Revenue from operations").source, "company")

    def test_a_label_with_two_concepts_maps_to_nothing(self):
        self.sheet(Q2,
                   line("non_current_borrowings", "Borrowings", "Non-current liabilities", "balance_sheet"),
                   line("current_borrowings", "Borrowings", "Current liabilities", "balance_sheet"))
        cc = self.load()
        self.assertEqual(cc.lookup(Q2, "balance_sheet", "Non-current liabilities", "Borrowings"),
                         ConceptPick("non_current_borrowings", "own"))
        self.assertEqual(cc.lookup(Q3, "balance_sheet", "Current liabilities", "Borrowings"),
                         ConceptPick("current_borrowings", "company"))
        # Another section name: the label alone carries two concepts, so nothing.
        self.assertIsNone(cc.lookup(Q3, "balance_sheet", "Liabilities", "Borrowings"))
        self.assertIsNone(cc.lookup(Q2, "balance_sheet", "Liabilities", "Borrowings"))

    def test_the_label_alone_when_it_is_unique(self):
        self.sheet(Q2, line("revenue_from_operations", "Revenue from operations", "Revenue"))
        cc = self.load()
        self.assertEqual(cc.lookup(Q3, "income_statement", "Income", "Revenue from operations"),
                         ConceptPick("revenue_from_operations", "company"))
        # The statement still has to match.
        self.assertIsNone(cc.lookup(Q3, "balance_sheet", "Income", "Revenue from operations"))
        # The filing's own row gave the label, so it is "own" through the label alone.
        self.assertEqual(cc.lookup(Q2, "income_statement", "Income", "Revenue from operations").source, "own")
        # An unknown label is no concept, never a guess.
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Revenue", "Sale of products"))

    def test_a_concept_of_another_statement_and_another_company_are_never_used(self):
        self.sheet(Q2, line("total_assets", "Total income"), line("", "Blank"),
                   line("not_a_concept", "Invented"), line("total_assets", "Total assets", "Assets", "balance_sheet"))
        self.sheet("other-metals/results-2025-09", line("revenue_from_operations", "Sales"))
        cc = self.load()
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Income", "Total income"))
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Income", "Blank"))
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Income", "Invented"))
        self.assertEqual(cc.lookup(Q2, "balance_sheet", "Assets", "Total assets"), ConceptPick("total_assets", "own"))
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Income", "Sales"))
        self.assertEqual(self.load("other-metals").lookup("other-metals/results-2025-09", "income_statement", "Income", "Sales"),
                         ConceptPick("revenue_from_operations", "own"))

    def test_a_conflict_within_one_key(self):
        self.sheet(Q2, line("other_income", "Other income"))
        self.sheet(Q1, line("total_income", "Other income"))
        cc = self.load()
        self.assertIsNone(cc.lookup(Q2, "income_statement", "Income", "Other income"))
        self.assertIsNone(cc.lookup(Q3, "income_statement", "Income", "Other income"))

    def test_a_company_with_no_sheets_has_no_concepts(self):
        self.assertIsNone(self.load("nobody").lookup("nobody/x", "income_statement", "Income", "Revenue from operations"))

    def test_only_the_company_folder_csv_files_are_read(self):
        self.sheet(Q2, line("other_income", "Other income"))
        (self.sheets / C / "notes.txt").write_text("not a sheet")
        self.assertEqual(self.load().lookup(Q2, "income_statement", "Income", "Other income").concept, "other_income")


if __name__ == "__main__":
    unittest.main()
