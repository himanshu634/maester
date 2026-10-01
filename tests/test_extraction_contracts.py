"""The extractor's Pydantic wire models accept the same golden fixtures as the Zod schemas.

packages/contracts/test/extraction-fixtures.test.ts validates these files with Zod.
"""

import json
from pathlib import Path
import unittest

from pydantic import ValidationError

from pdf_financial_qa.workflow.contracts import EXTRACTOR_EVENT, ErrorEvent, ResultEvent

FIXTURES = Path(__file__).resolve().parents[1] / "packages" / "contracts" / "fixtures" / "extraction"


class GoldenFixtureTests(unittest.TestCase):
    def test_fixtures_exist(self):
        self.assertTrue(list(FIXTURES.glob("*.ndjson")))

    def test_every_line_parses_and_round_trips(self):
        for path in FIXTURES.glob("*.ndjson"):
            lines = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
            events = [EXTRACTOR_EVENT.validate_python(line) for line in lines]
            with self.subTest(file=path.name):
                terminal = [e for e in events if isinstance(e, (ResultEvent, ErrorEvent))]
                self.assertEqual(len(terminal), 1)
                self.assertIs(events[-1], terminal[0])
                for raw, event in zip(lines, events):
                    self.assertEqual(event.to_wire(), raw)

    def test_unknown_fields_and_exponent_decimals_are_rejected(self):
        line = json.loads((FIXTURES / "stream-result.ndjson").read_text().splitlines()[-1])
        line["result"]["facts"][0]["normalizedValue"] = "1E+5"
        with self.assertRaises(ValidationError):
            EXTRACTOR_EVENT.validate_python(line)
        line = json.loads((FIXTURES / "stream-error.ndjson").read_text().splitlines()[-1])
        line["unexpected"] = True
        with self.assertRaises(ValidationError):
            EXTRACTOR_EVENT.validate_python(line)


if __name__ == "__main__":
    unittest.main()
