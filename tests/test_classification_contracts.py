"""The classifier's Pydantic wire models accept the same golden fixtures as the Zod schemas.

packages/contracts/test/classification-fixtures.test.ts validates these files with Zod.
"""

import json
import unittest
from pathlib import Path

from pydantic import ValidationError

from pdf_financial_qa.classify.contracts import CLASSIFY_RESPONSE

FIXTURES = Path(__file__).resolve().parents[1] / "packages" / "contracts" / "fixtures" / "classification"


class ClassificationFixtureTests(unittest.TestCase):
    def test_every_fixture_parses_and_round_trips(self):
        paths = sorted(FIXTURES.glob("*.json"))
        self.assertEqual(len(paths), 3)
        for path in paths:
            raw = json.loads(path.read_text())
            with self.subTest(file=path.name):
                self.assertEqual(CLASSIFY_RESPONSE.validate_python(raw).to_wire(), raw)

    def test_unknown_fields_and_bad_values_are_rejected(self):
        raw = json.loads((FIXTURES / "result-annual-report.json").read_text())
        raw["result"]["kind"] = "brochure"
        with self.assertRaises(ValidationError):
            CLASSIFY_RESPONSE.validate_python(raw)
        raw = json.loads((FIXTURES / "error-unreadable.json").read_text())
        raw["extra"] = 1
        with self.assertRaises(ValidationError):
            CLASSIFY_RESPONSE.validate_python(raw)


if __name__ == "__main__":
    unittest.main()
