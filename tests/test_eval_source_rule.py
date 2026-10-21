"""The source rule's Python twin against the fixture it shares with `@maester/financial-engine`. Offline."""

import copy
import json
import re
import unittest
from pathlib import Path

from maester_eval.source_rule import (
    SOURCE_RULE_VERSION, annual_slot_of, covering_xbrl, plan_pdf_numbers, rank_slot_candidates, slot_key, slot_owner,
)

FIXTURE = Path(__file__).resolve().parents[1] / "packages" / "financial-engine-ts" / "fixtures" / "source-rule.json"


def snake(value):
    """`value` with every dictionary key in snake_case (`waitingOn` → `waiting_on`). Values are left as they are."""
    if isinstance(value, dict):
        return {re.sub(r"(?<!^)(?=[A-Z])", "_", key).lower(): snake(item) for key, item in value.items()}
    if isinstance(value, list):
        return [snake(item) for item in value]
    return value


class SourceRuleFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = snake(json.loads(FIXTURE.read_text(encoding="utf-8")))

    def test_version_is_the_fixtures(self):
        self.assertEqual(SOURCE_RULE_VERSION, self.fixture["version"])

    def test_slot_key(self):
        slot = {
            "company_id": "co-cem", "filing_kind": "annual_report", "statement": "income_statement",
            "basis": "consolidated", "period_end": "2026-03-31", "span": "year",
        }
        self.assertEqual(slot_key(slot), "co-cem|annual_report|income_statement|consolidated|2026-03-31|year")
        instant = {**slot, "statement": "balance_sheet", "span": None}
        self.assertEqual(slot_key(instant), "co-cem|annual_report|balance_sheet|consolidated|2026-03-31|instant")

    def test_rank(self):
        for case in self.fixture["rank"]:
            with self.subTest(case["name"]):
                candidates = copy.deepcopy(case["candidates"])
                self.assertEqual([c["revision_id"] for c in rank_slot_candidates(candidates)], case["expected"])
                owner = slot_owner(candidates)
                self.assertEqual(owner["revision_id"] if owner else None, case["expected"][0] if case["expected"] else None)
                self.assertEqual(candidates, case["candidates"])  # the input is not reordered

    def test_annual(self):
        for case in self.fixture["annual"]:
            with self.subTest(case["name"]):
                self.assertEqual(annual_slot_of(case["filing"], case["fact"]), case["expected"])

    def test_plan(self):
        for case in self.fixture["plan"]:
            with self.subTest(case["name"]):
                self.assertEqual(plan_pdf_numbers(case["pdf"], case["xbrl"]), case["expected"])

    def test_covering(self):
        for case in self.fixture["covering"]:
            with self.subTest(case["name"]):
                self.assertEqual(covering_xbrl(case["pdf"], case["xbrl"]), case["expected"])

    def test_every_section_has_cases(self):
        for section in ("rank", "annual", "plan", "covering"):
            with self.subTest(section):
                self.assertTrue(self.fixture[section])


if __name__ == "__main__":
    unittest.main()
