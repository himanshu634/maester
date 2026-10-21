"""The indexer's Pydantic wire models accept the same golden fixtures as the Zod schemas.

packages/contracts/test/index-fixtures.test.ts validates these files with Zod.
"""

import json
from pathlib import Path
import unittest

from pydantic import ValidationError

from maester_indexer.contracts import (
    INDEXER_EVENT,
    ChunkRequest,
    ChunkTextRequest,
    ChunkTextResponse,
    ErrorEvent,
    ResultEvent,
    contextualize,
)

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures" / "index"


def lines(name: str) -> list[dict]:
    return [json.loads(line) for line in (FIXTURES / name).read_text().splitlines() if line.strip()]


class StreamFixtureTests(unittest.TestCase):
    def test_every_line_parses_and_round_trips(self):
        for name in ("stream-range.ndjson", "stream-error.ndjson"):
            raw_lines = lines(name)
            events = [INDEXER_EVENT.validate_python(raw) for raw in raw_lines]
            with self.subTest(file=name):
                terminal = [e for e in events if isinstance(e, (ResultEvent, ErrorEvent))]
                self.assertEqual(len(terminal), 1)
                self.assertIs(events[-1], terminal[0])
                for raw, event in zip(raw_lines, events):
                    self.assertEqual(event.to_wire(), raw)

    def test_refuses_a_bad_text_source_page_zero_and_unknown_fields(self):
        raw = lines("stream-range.ndjson")
        chunk = next(r for r in raw if r["type"] == "chunk")
        page = next(r for r in raw if r["type"] == "page")
        for bad in (
            {**chunk, "textSource": "scan"},
            {**chunk, "seq": -1},
            {**page, "pageNumber": 0},
            {**page, "unexpected": True},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                INDEXER_EVENT.validate_python(bad)

    def test_takes_page_unreadable_for_a_page_docling_could_not_read(self):
        page = next(r for r in lines("stream-range.ndjson") if r["type"] == "page")
        self.assertEqual(INDEXER_EVENT.validate_python({**page, "text": "", "noneReason": "PAGE_UNREADABLE"}).none_reason, "PAGE_UNREADABLE")


class ChunkRequestTests(unittest.TestCase):
    def test_fixture_round_trips(self):
        raw = json.loads((FIXTURES / "chunk-request.json").read_text())
        self.assertEqual(ChunkRequest.from_wire(raw).to_wire(), raw)


class ChunkTextFixtureTests(unittest.TestCase):
    def test_request_and_response_round_trip(self):
        for name, model in (("chunk-text-request.json", ChunkTextRequest), ("chunk-text-response.json", ChunkTextResponse)):
            raw = json.loads((FIXTURES / name).read_text())
            self.assertEqual(model.from_wire(raw).to_wire(), raw, name)

    def test_an_unknown_field_and_a_negative_seq_are_refused(self):
        raw = json.loads((FIXTURES / "chunk-text-response.json").read_text())
        with self.assertRaises(ValidationError):
            ChunkTextResponse.from_wire({**raw, "extra": 1})
        with self.assertRaises(ValidationError):
            ChunkTextResponse.from_wire({**raw, "chunks": [{**raw["chunks"][0], "seq": -1}]})
        with self.assertRaises(ValidationError):
            ChunkTextResponse.from_wire({**raw, "chunks": [{**raw["chunks"][0], "basis": "unknown"}]})


class ContextualizeTests(unittest.TestCase):
    def test_every_case_in_the_shared_fixture(self):
        cases = json.loads((FIXTURES / "contextualize.json").read_text())
        self.assertEqual([len(c["sectionPath"]) for c in cases], [0, 1, 3])
        for case in cases:
            with self.subTest(path=case["sectionPath"]):
                self.assertEqual(contextualize(case["sectionPath"], case["text"]), case["expected"])


if __name__ == "__main__":
    unittest.main()
