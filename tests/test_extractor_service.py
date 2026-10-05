"""The extractor HTTP service: auth, limits and the NDJSON stream. Offline."""

import json
import time
import unittest
from urllib.parse import quote

from fastapi.testclient import TestClient
from pdf_fixtures import make_pdf
from test_extraction_workflow import PAGES, ScriptedModel

from maester_extractor.app import create_app
from maester_extractor.settings import Settings
from pdf_financial_qa.classify import ClassifySettings
from pdf_financial_qa.classify.contracts import CLASSIFY_RESPONSE, ClassifyError, ClassifyResult
from pdf_financial_qa.classify.model import Answer, ClassifyOutput
from pdf_financial_qa.workflow import ExtractionError, WorkflowSettings
from pdf_financial_qa.workflow.contracts import EXTRACTOR_EVENT, ErrorEvent, HeartbeatEvent, ResultEvent

PDF = make_pdf(PAGES)
SECRET = "test-extractor-secret"
FAST = WorkflowSettings(retry_initial_interval=0.0)


class SlowModel(ScriptedModel):
    def locate(self, pdf, page_count):
        time.sleep(0.4)
        return super().locate(pdf, page_count)


def client(model=None, factory=None, **overrides):
    settings = Settings(secret=SECRET, heartbeat_seconds=0.1, **overrides)
    return TestClient(create_app(settings, factory or (lambda: model or ScriptedModel()), workflow=FAST))


def post(c, body=PDF, headers=None):
    return c.post("/v1/extract", content=body, headers={"x-extractor-secret": SECRET, "content-type": "application/pdf",
                                                         "x-document-id": "doc-1", **(headers or {})})


def events(response):
    return [EXTRACTOR_EVENT.validate_python(json.loads(line)) for line in response.text.splitlines() if line.strip()]


class ExtractorServiceTests(unittest.TestCase):
    def test_streams_started_progress_and_a_result(self):
        response = post(client(), headers={"x-company-name": quote("Synthetic Industries Ltd")})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("application/x-ndjson"))
        stream = events(response)
        self.assertEqual(stream[0].type, "started")
        self.assertEqual(stream[0].model, "scripted-model")
        self.assertIn("progress", [e.type for e in stream])
        self.assertIsInstance(stream[-1], ResultEvent)
        self.assertEqual(stream[-1].result.state, "complete")
        self.assertNotIn("COMPANY_NAME_MISMATCH", [w.code for w in stream[-1].result.warnings])
        self.assertEqual(sum(isinstance(e, (ResultEvent, ErrorEvent)) for e in stream), 1)

    def test_sends_heartbeats_while_a_model_call_is_running(self):
        stream = events(post(client(SlowModel())))
        self.assertTrue(any(isinstance(e, HeartbeatEvent) for e in stream))
        self.assertIsInstance(stream[-1], ResultEvent)

    def test_document_problems_are_reported_as_permanent_error_events(self):
        stream = events(post(client(), body=b"%PDF-1.4 broken"))
        self.assertIsInstance(stream[-1], ErrorEvent)
        self.assertEqual((stream[-1].code, stream[-1].retryable), ("UNREADABLE_PDF", False))

    def test_missing_vertex_configuration_is_a_permanent_error(self):
        def not_configured():
            raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)

        stream = events(post(client(factory=not_configured)))
        self.assertEqual([e.type for e in stream], ["started", "error"])
        self.assertEqual((stream[-1].code, stream[-1].retryable), ("EXTRACTOR_NOT_CONFIGURED", False))

    def test_default_factory_without_a_project_is_not_configured(self):
        app = create_app(Settings(secret=SECRET, project=None), workflow=FAST)
        stream = events(post(TestClient(app)))
        self.assertEqual(stream[-1].code, "EXTRACTOR_NOT_CONFIGURED")

    def test_unexpected_crashes_are_retryable(self):
        class Broken(ScriptedModel):
            def locate(self, pdf, page_count):
                raise ValueError("bug")

        stream = events(post(client(Broken())))
        self.assertEqual((stream[-1].code, stream[-1].retryable), ("EXTRACTION_FAILED", True))

    def test_rejects_a_wrong_or_missing_secret(self):
        c = client()
        self.assertEqual(post(c, headers={"x-extractor-secret": "wrong"}).status_code, 401)
        response = c.post("/v1/extract", content=PDF)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "EXTRACTOR_UNAUTHORIZED")

    def test_rejects_oversized_and_empty_bodies(self):
        c = client(max_bytes=len(PDF) - 1)
        response = post(c)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "TOO_LARGE_FOR_EXTRACTION")
        self.assertEqual(post(client(), body=b"").status_code, 400)

    def test_health(self):
        self.assertEqual(client().get("/healthz").json(), {"status": "ok"})


CLASSIFY_PDF = make_pdf([["Synthetic Textiles Limited", "Kind words about the year gone by"]])


class FixedClassifier:
    name = "fixed-classifier"

    def classify(self, pdf, page_count, questions):
        return ClassifyOutput(answers=[Answer(field="kind", value="other", page=1, quote="Kind words about the year gone by")])


def classify_client(factory=None, **overrides):
    settings = Settings(secret=SECRET, **overrides)
    return TestClient(create_app(settings, lambda: ScriptedModel(), workflow=FAST,
                                 classify_model_factory=factory or (lambda: FixedClassifier()),
                                 classify_settings=ClassifySettings(retry_interval=0.0)))


def classify_post(c, body=CLASSIFY_PDF, secret=SECRET):
    return c.post("/v1/classify", content=body, headers={"x-extractor-secret": secret, "content-type": "application/pdf",
                                                          "x-document-id": "doc-1"})


class ClassifyEndpointTests(unittest.TestCase):
    def test_answers_one_json_result(self):
        response = classify_post(classify_client())
        self.assertEqual(response.status_code, 200)
        body = CLASSIFY_RESPONSE.validate_python(response.json())
        self.assertIsInstance(body, ClassifyResult)
        self.assertEqual((body.result.kind, body.result.model), ("other", "fixed-classifier"))

    def test_an_unreadable_pdf_is_an_error_body(self):
        body = CLASSIFY_RESPONSE.validate_python(classify_post(classify_client(), body=b"%PDF-1.4 broken").json())
        self.assertIsInstance(body, ClassifyError)
        self.assertEqual((body.code, body.retryable), ("UNREADABLE_PDF", False))

    def test_a_missing_model_still_classifies_with_a_warning(self):
        def missing():
            raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
        body = CLASSIFY_RESPONSE.validate_python(classify_post(classify_client(missing)).json())
        self.assertEqual((body.result.kind, [w.code for w in body.result.warnings]), ("not_sure", ["MODEL_UNAVAILABLE"]))

    def test_wrong_secret_is_401_and_too_large_is_413(self):
        self.assertEqual(classify_post(classify_client(), secret="wrong").status_code, 401)
        self.assertEqual(classify_post(classify_client(max_bytes=10)).status_code, 413)

    def test_default_limit_is_50_mib(self):
        self.assertEqual(Settings().max_bytes, 50 * 1024 * 1024)
        self.assertEqual(Settings.from_env({}).max_bytes, 50 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
