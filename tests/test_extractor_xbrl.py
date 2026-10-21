"""The extractor's /v1/xbrl: auth, limits and the NDJSON stream, over synthetic instances. Offline: no model is called."""

import json
import time
import unittest
from unittest import mock

from fastapi.testclient import TestClient
from xbrl_fixtures import ind_as, instance

from maester_extractor import app as extractor_app
from maester_extractor.app import create_app
from maester_extractor.settings import Settings
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION
from pdf_financial_qa.xbrl.contracts import XBRL_EVENT

SECRET = "test-extractor-secret"
TEXT_FACT = ("DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock", "OneD", None, None, "<p>Notes to results</p>")
INSTANCE = instance(facts=ind_as() + [TEXT_FACT])


def client(**overrides):
    return TestClient(create_app(Settings(secret=SECRET, heartbeat_seconds=0.05, **overrides)))


def post(c, body=INSTANCE, mode="classify", headers=None):
    return c.post("/v1/xbrl", content=body, headers={"x-extractor-secret": SECRET, "content-type": "application/xml",
                                                      "x-xbrl-mode": mode, "x-document-id": "doc-1", **(headers or {})})


def events(response):
    return [XBRL_EVENT.validate_python(json.loads(line)) for line in response.text.splitlines() if line.strip()]


def kinds(stream):
    return [e.type for e in stream if e.type != "heartbeat"]


class XbrlRouteTests(unittest.TestCase):
    def test_classify_streams_started_then_one_classification(self):
        response = post(client(), mode="classify")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("application/x-ndjson"))
        stream = events(response)
        self.assertEqual(kinds(stream), ["started", "classification"])
        self.assertEqual(stream[0].mode, "classify")
        self.assertEqual((stream[0].parser_version, stream[0].map_version), (XBRL_PARSER_VERSION, XBRL_MAP_VERSION))
        self.assertEqual(stream[-1].result.kind, "financial_results")
        self.assertEqual(stream[-1].result.format.kind, "ind_as")
        self.assertEqual(stream[-1].result.nse_symbol, "SYNCEM")

    def test_read_streams_started_then_one_read(self):
        stream = events(post(client(), mode="read"))
        self.assertEqual(kinds(stream), ["started", "read"])
        self.assertEqual(stream[0].mode, "read")
        result = stream[-1].result
        self.assertEqual((result.pipeline_version, result.model), ("xbrl-1", "xbrl-parser-1"))
        self.assertTrue(result.facts)

    def test_text_streams_started_then_one_text(self):
        stream = events(post(client(), mode="text"))
        self.assertEqual(kinds(stream), ["started", "text"])
        self.assertEqual(stream[0].mode, "text")
        result = stream[-1].result
        self.assertEqual(result.text_version, "1")
        self.assertEqual(result.basis, "consolidated")
        self.assertEqual([b.text for b in result.blocks], ["Notes to results"])

    def test_a_wrong_secret_is_401(self):
        response = post(client(), headers={"x-extractor-secret": "wrong"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "EXTRACTOR_UNAUTHORIZED")

    def test_an_unknown_or_missing_mode_is_400(self):
        response = post(client(), mode="nope")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "BAD_REQUEST")
        response = client().post("/v1/xbrl", content=INSTANCE, headers={"x-extractor-secret": SECRET})
        self.assertEqual(response.status_code, 400)

    def test_an_empty_body_is_400(self):
        response = post(client(), body=b"")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "EMPTY_BODY")

    def test_a_doctype_is_a_permanent_unreadable_error(self):
        body = instance(doctype='<!DOCTYPE xbrli:xbrl [<!ENTITY x "y">]>', facts=ind_as())
        stream = events(post(client(), body=body, mode="read"))
        self.assertEqual(kinds(stream), ["started", "error"])
        self.assertEqual((stream[-1].code, stream[-1].retryable), ("XBRL_UNREADABLE", False))

    def test_a_body_over_the_limit_is_a_200_with_too_large_not_a_413(self):
        body = instance(facts=ind_as(), comment="<!--" + "x" * (21 * 1024 * 1024) + "-->")
        response = post(client(), body=body)
        self.assertEqual(response.status_code, 200)
        stream = events(response)
        self.assertEqual(kinds(stream), ["started", "error"])
        self.assertEqual((stream[-1].code, stream[-1].retryable, stream[-1].message), ("XBRL_UNREADABLE", False, "TOO_LARGE"))

    def test_a_chunked_body_over_the_limit_is_cut_off_the_same_way(self):
        def chunks():
            yield INSTANCE
            for _ in range(21):
                yield b"x" * (1024 * 1024)

        stream = events(post(client(), body=chunks()))
        self.assertEqual(kinds(stream), ["started", "error"])
        self.assertEqual((stream[-1].code, stream[-1].retryable, stream[-1].message), ("XBRL_UNREADABLE", False, "TOO_LARGE"))

    def test_the_byte_limit_is_a_setting(self):
        stream = events(post(client(xbrl_max_bytes=100)))
        self.assertEqual((stream[-1].code, stream[-1].message), ("XBRL_UNREADABLE", "TOO_LARGE"))

    def test_the_fact_limit_is_a_setting(self):
        stream = events(post(client(xbrl_max_facts=3)))
        self.assertEqual((stream[-1].code, stream[-1].retryable, stream[-1].message), ("XBRL_UNREADABLE", False, "TOO_MANY_FACTS"))

    def test_a_crash_is_a_retryable_failure_naming_only_the_type_and_logging_no_text(self):
        with mock.patch.object(extractor_app, "parse_instance", side_effect=RuntimeError("SYNTHETIC CEMENTS 1234")):
            with self.assertLogs("maester_extractor", level="DEBUG") as logs:
                response = post(client())
        stream = events(response)
        self.assertEqual(kinds(stream), ["started", "error"])
        self.assertEqual((stream[-1].code, stream[-1].retryable), ("XBRL_FAILED", True))
        self.assertIn("RuntimeError", stream[-1].message)
        self.assertNotIn("SYNTHETIC", response.text)
        self.assertNotIn("SYNTHETIC", "\n".join(logs.output))
        self.assertIn("doc-1", "\n".join(logs.output))

    def test_a_slow_parse_sends_heartbeats(self):
        real = extractor_app.parse_instance

        def slow(*args, **kwargs):
            time.sleep(0.4)
            return real(*args, **kwargs)

        with mock.patch.object(extractor_app, "parse_instance", side_effect=slow):
            stream = events(post(client()))
        self.assertTrue(any(e.type == "heartbeat" for e in stream))
        self.assertEqual(stream[-1].type, "classification")
        self.assertEqual(sum(e.type in ("classification", "read", "text", "error") for e in stream), 1)

    def test_a_finished_read_logs_counts_and_no_values_or_names(self):
        with self.assertLogs("maester_extractor", level="INFO") as logs:
            post(client(), mode="read")
        text = "\n".join(logs.output)
        self.assertIn("doc-1", text)
        self.assertIn("mode=read", text)
        self.assertIn("facts=", text)
        self.assertNotIn("SYNTHETIC", text)
        self.assertNotIn("300000000", text)

    def test_settings_read_the_environment(self):
        settings = Settings.from_env({"XBRL_MAX_BYTES": "5", "XBRL_MAX_FACTS": "6", "XBRL_DEADLINE_SECONDS": "7"})
        self.assertEqual((settings.xbrl_max_bytes, settings.xbrl_max_facts, settings.xbrl_deadline_seconds), (5, 6, 7.0))
        defaults = Settings.from_env({})
        self.assertEqual((defaults.xbrl_max_bytes, defaults.xbrl_max_facts, defaults.xbrl_deadline_seconds),
                         (20971520, 100000, 30.0))


if __name__ == "__main__":
    unittest.main()
