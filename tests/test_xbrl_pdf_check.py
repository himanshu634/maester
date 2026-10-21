"""The xbrl_in_pdf check and its route, over synthetic text-layer and scanned PDFs. Offline: no model is called."""

import asyncio
import contextlib
import gc
import json
import threading
import unittest
from unittest import mock
from decimal import Decimal

from fastapi.testclient import TestClient
from pdf_fixtures import make_pdf

from maester_extractor import app as extractor_app
from maester_extractor.app import create_app
from maester_extractor.settings import Settings
from pdf_financial_qa.workflow import ExtractionError
from pdf_financial_qa.xbrl import XBRL_PDF_CHECK_VERSION
from pdf_financial_qa.xbrl.contracts import XBRL_PDF_CHECK_RESULT, XbrlPdfCheckRequest
from pdf_financial_qa.xbrl.pdf_check import check_candidates, check_xbrl_in_pdf

# Index 0 is a cover, index 1 a lakh table, index 2 a scan of the same table.
PDF = make_pdf([
    ["Synthetic Cements Limited", "Annual report"],
    ["Statement of profit and loss", "Revenue from operations 12,345.00", "Finance costs (234.50)", "Earnings per share 12.34"],
    [],
])
FACT_ID = "0b6f1c1e-6d1a-4c52-9a53-0f3a2d1f7a%02d"
_counter = [0]


def fact(value, per_share=False, statement="income_statement", basis="consolidated"):
    _counter[0] += 1
    return {"factId": FACT_ID % (_counter[0] % 100), "value": value, "perShare": per_share, "statement": statement,
            "basis": basis}


def request(pages, facts, scale="100000", places=2, statement_pages=None):
    entries = statement_pages if statement_pages is not None else [
        {"statement": "income_statement", "basis": "consolidated", "pages": pages}]
    return XbrlPdfCheckRequest.model_validate(
        {"scale": scale, "places": places, "statementPages": entries, "facts": facts})


def run(pages, facts, scale="100000", places=2, pdf=PDF):
    return check_xbrl_in_pdf(pdf, request(pages, facts, scale, places))


def one(result):
    first = result.results[0]
    return (first.status, first.page_index, first.reason)


class CheckTests(unittest.TestCase):
    def test_found_on_the_second_statement_page(self):
        r = run(pages=[0, 1], facts=[fact("1234500000"), fact("-23450000")], scale="100000", places=2)
        # 1234500000/1e5 = 12345.00; |-23450000/1e5| = 234.50
        self.assertEqual([(x.status, x.page_index) for x in r.results], [("passed", 1), ("passed", 1)])
        self.assertEqual(r.check_version, 1)
        self.assertEqual(r.check_version, XBRL_PDF_CHECK_VERSION)

    def test_each_result_names_its_fact_in_order(self):
        facts = [fact("1234500000"), fact("999900000"), fact(None)]
        r = run(pages=[1], facts=facts)
        self.assertEqual([x.fact_id for x in r.results], [f["factId"] for f in facts])

    def test_a_value_with_finer_digits_matches_its_printed_rounding(self):
        # 1234500400/1e5 = 12345.004 is not printed; rounded half up to 2 places it is 12345.00, which index 1 prints.
        self.assertEqual(one(run(pages=[1], facts=[fact("1234500400")], scale="100000", places=2)), ("passed", 1, None))
        self.assertEqual(one(run(pages=[1], facts=[fact("1234500400")], scale="100000", places=None)),
                         ("failed", None, None))
        self.assertEqual(check_candidates(Decimal("1234500400"), False, Decimal("100000"), 2),
                         [Decimal("12345.004"), Decimal("12345.00")])

    def test_rounding_is_half_up_and_a_candidate_equal_to_the_exact_value_is_not_listed_twice(self):
        self.assertEqual(check_candidates(Decimal("1234500500"), False, Decimal("100000"), 2)[1], Decimal("12345.01"))
        self.assertEqual(check_candidates(Decimal("1234500000"), False, Decimal("100000"), 2), [Decimal("12345")])
        self.assertEqual(check_candidates(Decimal("12.345"), True, None, 2), [Decimal("12.345")])
        self.assertEqual(check_candidates(Decimal("12.345"), False, Decimal("1"), None), [Decimal("12.345")])

    def test_no_declared_unit_is_not_checked(self):
        self.assertEqual(one(run(pages=[1], facts=[fact("1234500000")], scale=None, places=None)),
                         ("not_checked", None, "no_unit"))
        self.assertEqual(one(run(pages=[1], facts=[fact("12.34", per_share=True)], scale=None, places=None))[0], "passed")

    def test_a_value_not_printed_fails_without_a_page(self):
        self.assertEqual(one(run(pages=[0, 1], facts=[fact("999900000")])), ("failed", None, None))

    def test_scanned_and_missing_pages_are_not_checked_with_their_reason(self):
        self.assertEqual(one(run(pages=[2], facts=[fact("1234500000")])), ("not_checked", None, "scanned"))
        self.assertEqual(one(run(pages=[], facts=[fact("1234500000")])), ("not_checked", None, "no_statement_pages"))
        self.assertEqual(one(run(pages=[1], facts=[fact(None)])), ("not_checked", None, "no_value"))

    def test_a_miss_next_to_a_scan_is_not_proof(self):
        self.assertEqual(one(run(pages=[1, 2], facts=[fact("999900000")])), ("not_checked", None, "scanned"))
        # A hit on a text page still passes even with a scan beside it.
        self.assertEqual(one(run(pages=[2, 1], facts=[fact("1234500000")])), ("passed", 1, None))

    def test_a_page_past_the_end_counts_as_a_page_without_text(self):
        self.assertEqual(one(run(pages=[9], facts=[fact("1234500000")])), ("not_checked", None, "scanned"))
        self.assertEqual(one(run(pages=[1, 9], facts=[fact("999900000")])), ("not_checked", None, "scanned"))

    def test_per_share_is_not_scaled(self):
        self.assertEqual(one(run(pages=[1], facts=[fact("12.34", per_share=True)]))[0], "passed")  # index 1 prints 12.34 as EPS
        self.assertEqual(one(run(pages=[1], facts=[fact("12.35", per_share=True)]))[0], "failed")

    def test_the_rules_apply_in_order_no_value_before_no_unit_before_no_pages(self):
        self.assertEqual(one(run(pages=[], facts=[fact(None)], scale=None)), ("not_checked", None, "no_value"))
        self.assertEqual(one(run(pages=[], facts=[fact("1234500000")], scale=None)), ("not_checked", None, "no_unit"))

    def test_a_scale_that_is_not_positive_is_no_unit(self):
        self.assertEqual(one(run(pages=[1], facts=[fact("1234500000")], scale="0")), ("not_checked", None, "no_unit"))

    def test_pages_are_taken_per_statement_and_basis(self):
        pages = [
            {"statement": "income_statement", "basis": "consolidated", "pages": [1]},
            {"statement": "income_statement", "basis": "standalone", "pages": []},
            {"statement": "cash_flow", "basis": "consolidated", "pages": [0]},
        ]
        facts = [fact("1234500000"), fact("1234500000", basis="standalone"), fact("1234500000", statement="cash_flow"),
                 fact("1234500000", statement="balance_sheet")]
        r = check_xbrl_in_pdf(PDF, request(None, facts, statement_pages=pages))
        self.assertEqual([(x.status, x.page_index, x.reason) for x in r.results], [
            ("passed", 1, None),
            ("not_checked", None, "no_statement_pages"),
            ("failed", None, None),
            ("not_checked", None, "no_statement_pages"),
        ])

    def test_the_first_page_that_matches_wins(self):
        pdf = make_pdf([["Total 12,345.00"], ["Total 12,345.00"]])
        self.assertEqual(one(run(pages=[1, 0], facts=[fact("1234500000")], pdf=pdf)), ("passed", 1, None))

    def test_an_unreadable_pdf_passes_its_error_through(self):
        with self.assertRaises(ExtractionError) as caught:
            run(pages=[1], facts=[fact("1234500000")], pdf=b"not a pdf")
        self.assertEqual((caught.exception.code, caught.exception.retryable), ("UNREADABLE_PDF", False))


SECRET = "test-extractor-secret"


def client(**overrides):
    return TestClient(create_app(Settings(secret=SECRET, **overrides)))


def post(c, files, secret=SECRET):
    return c.post("/v1/xbrl/pdf-check", files=files, headers={"x-extractor-secret": secret, "x-document-id": "doc-1"})


def request_part(facts, pages=(1,)):
    body = {"scale": "100000", "places": 2, "facts": facts,
            "statementPages": [{"statement": "income_statement", "basis": "consolidated", "pages": list(pages)}]}
    return json.dumps(body)


class RouteTests(unittest.TestCase):
    def test_a_multipart_request_answers_the_result(self):
        facts = [fact("1234500000"), fact("999900000"), fact(None)]
        response = post(client(), {"pdf": ("statement.pdf", PDF, "application/pdf"), "request": (None, request_part(facts))})
        self.assertEqual(response.status_code, 200)
        result = XBRL_PDF_CHECK_RESULT.validate_python(response.json())
        self.assertEqual([(x.status, x.page_index, x.reason) for x in result.results],
                         [("passed", 1, None), ("failed", None, None), ("not_checked", None, "no_value")])
        self.assertEqual(response.json()["checkVersion"], XBRL_PDF_CHECK_VERSION)

    def test_no_pdf_part_is_400(self):
        response = post(client(), {"request": (None, request_part([fact("1")]))})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "BAD_REQUEST")

    def test_no_request_part_or_a_bad_one_is_400(self):
        pdf = ("statement.pdf", PDF, "application/pdf")
        self.assertEqual(post(client(), {"pdf": pdf}).status_code, 400)
        self.assertEqual(post(client(), {"pdf": pdf, "request": (None, "{not json")}).status_code, 400)
        self.assertEqual(post(client(), {"pdf": pdf, "request": (None, json.dumps({"scale": "1"}))}).status_code, 400)

    def test_a_wrong_secret_is_401(self):
        response = post(client(), {"pdf": ("s.pdf", PDF, "application/pdf"), "request": (None, request_part([fact("1")]))},
                        secret="wrong")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"]["code"], "EXTRACTOR_UNAUTHORIZED")

    def test_an_unreadable_pdf_is_an_error_object_like_classify(self):
        response = post(client(), {"pdf": ("s.pdf", b"not a pdf", "application/pdf"),
                                   "request": (None, request_part([fact("1")]))})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual((body["type"], body["code"], body["retryable"]), ("error", "UNREADABLE_PDF", False))

    def test_a_pdf_over_the_limit_is_413(self):
        response = post(client(max_bytes=len(PDF) - 1),
                        {"pdf": ("s.pdf", PDF, "application/pdf"), "request": (None, request_part([fact("1")]))})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "TOO_LARGE_FOR_EXTRACTION")

    def test_a_chunked_body_over_the_limit_is_cut_off_with_413(self):
        def chunks():
            yield b"--x\r\n"
            for _ in range(17):
                yield b"x" * (1024 * 1024)

        response = client(max_bytes=1024).post(
            "/v1/xbrl/pdf-check", content=chunks(),
            headers={"x-extractor-secret": SECRET, "content-type": "multipart/form-data; boundary=x"})
        self.assertEqual(response.status_code, 413)

    def test_a_body_that_is_not_multipart_is_400(self):
        response = client().post("/v1/xbrl/pdf-check", content=PDF,
                                 headers={"x-extractor-secret": SECRET, "content-type": "application/pdf"})
        self.assertEqual(response.status_code, 400)

    def test_a_client_that_goes_away_mid_check_leaves_no_unretrieved_exception_in_the_asyncio_log(self):
        release, finished = threading.Event(), threading.Event()

        def crash_late(*args, **kwargs):
            try:
                release.wait(5)
                raise RuntimeError("SYNTHETIC CEMENTS 1234")
            finally:
                finished.set()

        boundary = b"xbrlboundary"
        body = (b"--" + boundary + b'\r\nContent-Disposition: form-data; name="pdf"; filename="s.pdf"\r\n'
                b"Content-Type: application/pdf\r\n\r\n" + PDF + b"\r\n--" + boundary +
                b'\r\nContent-Disposition: form-data; name="request"\r\n\r\n' + request_part([fact("1")]).encode() +
                b"\r\n--" + boundary + b"--\r\n")

        async def drive():
            app = create_app(Settings(secret=SECRET))
            entered, requests = asyncio.Event(), [{"type": "http.request", "body": body, "more_body": False}]
            loop = asyncio.get_running_loop()

            async def receive():
                if requests:
                    return requests.pop()
                await asyncio.Event().wait()

            async def send(message):
                pass

            def entering(*args, **kwargs):
                loop.call_soon_threadsafe(entered.set)
                return crash_late()

            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
                     "scheme": "http", "path": "/v1/xbrl/pdf-check", "raw_path": b"/v1/xbrl/pdf-check",
                     "query_string": b"", "root_path": "", "server": ("test", 80), "client": ("test", 1),
                     "headers": [(b"x-extractor-secret", SECRET.encode()),
                                 (b"content-type", b"multipart/form-data; boundary=" + boundary)]}
            with mock.patch.object(extractor_app, "check_xbrl_in_pdf", side_effect=entering):
                task = asyncio.ensure_future(app(scope, receive, send))
                await asyncio.wait_for(entered.wait(), 5)
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
                release.set()
                while not finished.is_set():
                    await asyncio.sleep(0.01)
                await asyncio.sleep(0.2)
                gc.collect()

        with self.assertNoLogs("asyncio", level="WARNING"):
            asyncio.run(drive())
            gc.collect()


if __name__ == "__main__":
    unittest.main()
