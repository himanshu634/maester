"""The taxonomy file the gold set is labelled with. Offline."""

import json
import re
import unittest

from maester_eval.concepts import CONCEPTS_PATH, load_taxonomy

SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")
FAMILIES = {"income_statement", "balance_sheet", "cash_flow", "segment_note", "borrowings_note",
            "share_capital_note", "dividend_note", "related_party_note"}


class TaxonomyTests(unittest.TestCase):
    def test_file_parses_with_version_one(self):
        taxonomy = load_taxonomy()
        self.assertEqual(taxonomy.taxonomy_version, 1)
        self.assertGreaterEqual(len(taxonomy.concepts), 60)

    def test_ids_are_unique_snake_case(self):
        ids = [c.id for c in load_taxonomy().concepts]
        self.assertEqual(len(ids), len(set(ids)))
        for concept_id in ids:
            self.assertRegex(concept_id, SNAKE)

    def test_fields_are_within_the_vocabularies(self):
        for concept in load_taxonomy().concepts:
            with self.subTest(concept=concept.id):
                self.assertIn(concept.family, FAMILIES)
                self.assertIn(concept.kind, {"monetary", "per_share", "count"})
                self.assertIn(concept.period_type, {"duration", "instant"})
                self.assertTrue(concept.label.strip())

    def test_the_lines_the_summary_needs_exist(self):
        ids = load_taxonomy().ids()
        for needed in ("revenue_from_operations", "profit_after_tax", "eps_basic", "total_assets",
                       "total_equity", "net_cash_from_operating_activities", "cash_and_cash_equivalents"):
            self.assertIn(needed, ids)

    def test_per_share_lines_are_per_share(self):
        taxonomy = load_taxonomy()
        self.assertEqual(taxonomy.get("eps_basic").kind, "per_share")
        self.assertEqual(taxonomy.get("eps_diluted").kind, "per_share")
        self.assertIsNone(taxonomy.get("no_such_concept"))

    def test_raw_json_has_no_other_top_level_keys(self):
        self.assertEqual(set(json.loads(CONCEPTS_PATH.read_text())), {"taxonomy_version", "concepts"})


if __name__ == "__main__":
    unittest.main()
