"""The extractor's /v1/xbrl Pydantic wire models accept the same golden fixtures as the Zod schemas.

packages/contracts/test/xbrl-fixtures.test.ts validates these files with Zod. Offline, except the test gated on
``MAESTER_XBRL_DIR``, which reads the real instances and writes nothing.
"""

import json
import os
import unittest
from pathlib import Path

from pydantic import ValidationError

from xbrl_fixtures import ind_as, instance, parse, real_instances

from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION, XBRL_PDF_CHECK_VERSION
from pdf_financial_qa.xbrl.classify import classify_instance
from pdf_financial_qa.xbrl.contracts import (
    XBRL_EVENT,
    XBRL_PDF_CHECK_REQUEST,
    XBRL_PDF_CHECK_RESULT,
    XbrlClassification,
    XbrlClassificationEvent,
    XbrlErrorEvent,
    XbrlReadEvent,
    XbrlReadResult,
    XbrlTextEvent,
    to_xbrl_classification,
    to_xbrl_read_result,
)
from pdf_financial_qa.xbrl.read import read_instance

FIXTURES = Path(__file__).resolve().parents[1] / "packages" / "contracts" / "fixtures" / "xbrl"
TERMINAL = (XbrlClassificationEvent, XbrlReadEvent, XbrlTextEvent, XbrlErrorEvent)
GATED = unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")


def _lines(name: str) -> list[dict]:
    return [json.loads(line) for line in (FIXTURES / name).read_text().splitlines() if line.strip()]


def _json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


class StreamFixtureTests(unittest.TestCase):
    def test_the_four_streams_exist(self):
        self.assertEqual(
            sorted(p.name for p in FIXTURES.glob("*.ndjson")),
            ["stream-classify.ndjson", "stream-error.ndjson", "stream-read.ndjson", "stream-text.ndjson"],
        )

    def test_every_line_parses_and_round_trips(self):
        for path in sorted(FIXTURES.glob("*.ndjson")):
            lines = _lines(path.name)
            events = [XBRL_EVENT.validate_python(line) for line in lines]
            with self.subTest(file=path.name):
                terminal = [e for e in events if isinstance(e, TERMINAL)]
                self.assertEqual(len(terminal), 1)
                self.assertIs(events[-1], terminal[0])
                for raw, event in zip(lines, events):
                    self.assertEqual(event.to_wire(), raw)

    def test_the_read_stream_holds_a_per_share_fact_a_nil_fact_and_a_cash_balance(self):
        facts = XBRL_EVENT.validate_python(_lines("stream-read.ndjson")[-1]).result.facts
        self.assertTrue(any(f.unit_label == "₹ a share" for f in facts))
        self.assertTrue(any(f.nil and f.reported_value is None and f.value_status == "unparsed" for f in facts))
        self.assertTrue(any(f.element == "CashAndCashEquivalentsCashFlowStatement" and f.as_of_date is None for f in facts))

    def test_the_classify_stream_carries_the_unmapped_format_warning(self):
        result = XBRL_EVENT.validate_python(_lines("stream-classify.ndjson")[-1]).result
        self.assertEqual([w.code for w in result.warnings], ["XBRL_FORMAT_UNMAPPED"])


class PdfCheckFixtureTests(unittest.TestCase):
    def test_the_request_round_trips(self):
        raw = _json("pdf-check-request.json")
        request = XBRL_PDF_CHECK_REQUEST.validate_python(raw)
        self.assertEqual(request.to_wire(), raw)
        self.assertEqual(len(request.facts), 4)
        self.assertEqual(sum(f.per_share for f in request.facts), 1)
        self.assertEqual(sum(f.value is None for f in request.facts), 1)

    def test_the_result_round_trips(self):
        raw = _json("pdf-check-result.json")
        result = XBRL_PDF_CHECK_RESULT.validate_python(raw)
        self.assertEqual(result.to_wire(), raw)
        self.assertEqual(
            [(r.status, r.page_index, r.reason) for r in result.results],
            [("passed", 3, None), ("failed", None, None), ("not_checked", None, "no_value"), ("not_checked", None, "scanned")],
        )


class RefusalTests(unittest.TestCase):
    def test_a_read_whose_check_is_xbrl_in_pdf(self):
        line = _lines("stream-read.ndjson")[-1]
        line["result"]["checks"][0]["checkType"] = "xbrl_in_pdf"
        with self.assertRaises(ValidationError):
            XBRL_EVENT.validate_python(line)

    def test_a_fact_with_the_span_full_year(self):
        line = _lines("stream-read.ndjson")[-1]
        line["result"]["facts"][0]["span"] = "full_year"
        with self.assertRaises(ValidationError):
            XBRL_EVENT.validate_python(line)

    def test_a_result_with_check_version_2(self):
        raw = _json("pdf-check-result.json")
        raw["checkVersion"] = 2
        with self.assertRaises(ValidationError):
            XBRL_PDF_CHECK_RESULT.validate_python(raw)

    def test_unknown_fields_and_exponent_decimals_are_refused(self):
        line = _lines("stream-read.ndjson")[-1]
        line["result"]["facts"][0]["normalizedValue"] = "1E+5"
        with self.assertRaises(ValidationError):
            XBRL_EVENT.validate_python(line)
        line = _lines("stream-error.ndjson")[-1]
        line["unexpected"] = True
        with self.assertRaises(ValidationError):
            XBRL_EVENT.validate_python(line)

    def test_a_decimal_with_a_non_ascii_digit_is_refused_as_zod_refuses_it(self):
        raw = _json("pdf-check-request.json")
        raw["scale"] = "١٠٠٠٠٠"  # Arabic-Indic digits: \d would accept them, [0-9] does not
        with self.assertRaises(ValidationError):
            XBRL_PDF_CHECK_REQUEST.validate_python(raw)

    def test_a_fact_id_that_is_not_a_uuid(self):
        raw = _json("pdf-check-result.json")
        raw["results"][0]["factId"] = "not-a-uuid"
        with self.assertRaises(ValidationError):
            XBRL_PDF_CHECK_RESULT.validate_python(raw)

    def test_a_negative_page_index_and_negative_places(self):
        raw = _json("pdf-check-result.json")
        raw["results"][0]["pageIndex"] = -1
        with self.assertRaises(ValidationError):
            XBRL_PDF_CHECK_RESULT.validate_python(raw)
        raw = _json("pdf-check-request.json")
        raw["places"] = -1
        with self.assertRaises(ValidationError):
            XBRL_PDF_CHECK_REQUEST.validate_python(raw)

    def test_the_check_version_is_the_one_constant(self):
        self.assertEqual(_json("pdf-check-result.json")["checkVersion"], XBRL_PDF_CHECK_VERSION)


class ConversionTests(unittest.TestCase):
    def test_a_classification_converts_to_its_wire_model(self):
        data = classify_instance(parse(instance(facts=ind_as())))
        wire = to_xbrl_classification(data)
        self.assertIsInstance(wire, XbrlClassification)
        self.assertEqual((wire.parser_version, wire.map_version), (XBRL_PARSER_VERSION, XBRL_MAP_VERSION))
        self.assertEqual((wire.format.id, wire.format.kind, wire.format.mapped), ("in-capmkt/ind_as", "ind_as", True))
        self.assertEqual((wire.kind, wire.results_span, wire.basis, wire.isin), ("financial_results", "quarter", "consolidated", "INE999Z01011"))
        self.assertEqual(
            [(e.field, e.rule_id) for e in wire.evidence][:2], [("kind", "xbrl.family"), ("company", "xbrl.identity.name")]
        )
        self.assertEqual(XBRL_EVENT.validate_python({"type": "classification", "result": wire.to_wire()}).result, wire)

    def test_a_read_converts_to_its_wire_model(self):
        data = read_instance(parse(instance(rounding="Lakhs", facts=ind_as(revenue=("1234500000", "-3")))))
        wire = to_xbrl_read_result(data)
        self.assertIsInstance(wire, XbrlReadResult)
        self.assertEqual((wire.pipeline_version, wire.model, wire.prompt_version), ("xbrl-1", "xbrl-parser-1", "in-capmkt/ind_as@1"))
        self.assertEqual((wire.rounding.word, wire.rounding.unit_label, wire.rounding.scale, wire.rounding.exponent), ("Lakhs", "₹ lakh", "100000", -5))
        self.assertEqual((wire.coarsest_decimals, wire.finest_decimals, wire.state), (-5, -3, "complete"))
        revenue = next(f for f in wire.facts if f.element == "RevenueFromOperations" and f.context_id == "OneD")
        self.assertEqual((revenue.reported_value, revenue.normalized_value, revenue.span), ("12345.00", "1234500000", "quarter"))
        self.assertEqual(XBRL_EVENT.validate_python({"type": "read", "result": wire.to_wire()}).result, wire)

    def test_an_unmapped_format_has_no_map_version_in_its_prompt_version(self):
        data = read_instance(parse(instance(facts=ind_as()[:0] + [("CET1Ratio", "OneD", "pure", "4", "0.12"), ("AdditionalTier1Ratio", "OneD", "pure", "4", "0.01")])))
        wire = to_xbrl_read_result(data)
        self.assertEqual((wire.format.id, wire.format.mapped, wire.prompt_version), ("in-capmkt/banking", False, "in-capmkt/banking@-"))
        self.assertEqual(wire.facts, [])

    def test_the_wire_format_is_a_new_object_not_the_dataclass(self):
        data = classify_instance(parse(instance(facts=ind_as())))
        self.assertIsNot(to_xbrl_classification(data).format, data.format)

    @GATED
    def test_every_real_instance_converts_and_validates(self):
        for path in real_instances():
            instance_ = parse(path.read_bytes())
            with self.subTest(file=path.name):
                classification = to_xbrl_classification(classify_instance(instance_))
                XBRL_EVENT.validate_python({"type": "classification", "result": classification.to_wire()})
                read = to_xbrl_read_result(read_instance(instance_))
                XBRL_EVENT.validate_python({"type": "read", "result": read.to_wire()})


if __name__ == "__main__":
    unittest.main()
