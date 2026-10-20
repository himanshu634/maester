import asyncio
import base64
import json
import threading
import time
import unittest
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message=".*starlette.testclient.*", category=Warning)  # Starlette's TestClient

from fastapi.testclient import TestClient  # noqa: E402

from maester_indexer.app import create_app
from maester_indexer.chunker import chunk_range
from maester_indexer.contracts import INDEXER_EVENT, ChunkEvent, IndexerVersions, PageEvent, ResultEvent
from maester_indexer.errors import IndexingError
from maester_indexer.settings import DEFAULT_EMBEDDING_MODEL, Settings
from tests.helpers import fixture_read, whitespace_tokenizer

CHUNK_REQUEST = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/index/chunk-request.json"
SECRET = "test-secret"
PDF = b"%PDF-1.7 not read by the fake"
VERSIONS = IndexerVersions(
    docling_version="2.134.0", ocr_engine="rapidocr-onnxruntime 3.9.2",
    reader_options="table=accurate;cell_matching=true;ocr=rapidocr", chunker_version="1",
    tokenizer=DEFAULT_EMBEDDING_MODEL)


class FakeReader:
    def __init__(self, read=None, delay=0.0, error=None, page_count=3):
        self.versions = VERSIONS
        self.read = read or fixture_read("two-sections")
        self.delay, self.error, self._page_count = delay, error, page_count
        self.calls: list[tuple] = []
        self.cancel: threading.Event | None = None

    def page_count(self, pdf):
        return self._page_count

    def read_range(self, pdf, first, last, ocr_pages_left, cancel):
        self.calls.append((first, last, ocr_pages_left))
        self.cancel = cancel
        if self.delay:
            cancel.wait(self.delay)
        if self.error:
            raise self.error
        return self.read


def headers(**extra):
    base = {
        "x-indexer-secret": SECRET, "x-document-id": "doc-1", "x-page-range": "1-3",
        "x-ocr-pages-left": "10", "x-embedding-model": DEFAULT_EMBEDDING_MODEL,
    }
    return {**base, **extra}


def make(reader, **settings):
    return TestClient(create_app(Settings(secret=SECRET, **settings), reader, whitespace_tokenizer(448)))


def events(response):
    return [INDEXER_EVENT.validate_python(json.loads(line)) for line in response.text.splitlines()]


class Service(unittest.TestCase):
    def test_a_full_stream_matches_the_chunker(self):
        reader = FakeReader()
        response = make(reader).post("/v1/index", content=PDF, headers=headers())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("application/x-ndjson"))
        got = events(response)
        self.assertEqual(got[0].type, "started")
        self.assertEqual((got[0].page_count, got[0].first_page, got[0].last_page), (3, 1, 3))
        self.assertEqual(got[-1].type, "result")
        pages, chunks = chunk_range(reader.read, [], whitespace_tokenizer(448))
        self.assertEqual([e for e in got if isinstance(e, PageEvent)], pages)
        self.assertEqual([e for e in got if isinstance(e, ChunkEvent)], chunks)
        self.assertEqual(got[-1].read, reader.read)
        self.assertEqual(got[-1].ocr_pages, sum(1 for p in reader.read.pages if p.items_ocr > 0))
        self.assertEqual(reader.calls, [(1, 3, 10)])

    def test_the_range_is_clamped_to_the_page_count(self):
        reader = FakeReader(page_count=2)
        got = events(make(reader).post("/v1/index", content=PDF, headers=headers(**{"x-page-range": "1-9"})))
        self.assertEqual(got[0].last_page, 2)
        self.assertEqual(reader.calls, [(1, 2, 10)])

    def test_a_range_past_the_end_is_an_error(self):
        reader = FakeReader(page_count=2)
        got = events(make(reader).post("/v1/index", content=PDF, headers=headers(**{"x-page-range": "5-9"})))
        self.assertEqual([e.type for e in got], ["error"])
        self.assertEqual(got[0].code, "INDEX_FAILED")
        self.assertEqual(reader.calls, [])

    def test_the_section_path_before_is_used(self):
        path = base64.urlsafe_b64encode(json.dumps(["Directors’ report"]).encode()).decode().rstrip("=")
        reader = FakeReader()
        got = events(make(reader).post("/v1/index", content=PDF, headers=headers(**{"x-section-path": path})))
        _, chunks = chunk_range(reader.read, ["Directors’ report"], whitespace_tokenizer(448))
        self.assertEqual([e for e in got if isinstance(e, ChunkEvent)], chunks)

    def test_a_wrong_secret_is_refused(self):
        client = make(FakeReader())
        for given in ({"x-indexer-secret": "nope"}, {"x-indexer-secret": ""}):
            response = client.post("/v1/index", content=PDF, headers=headers(**given))
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["detail"]["code"], "INDEXER_UNAUTHORIZED")
        self.assertEqual(client.get("/v1/versions").status_code, 401)
        self.assertEqual(client.get("/healthz").json(), {"status": "ok"})

    def test_versions(self):
        response = make(FakeReader()).get("/v1/versions", headers={"x-indexer-secret": SECRET})
        self.assertEqual(response.json(), VERSIONS.to_wire())

    def test_a_model_mismatch_is_one_error_and_no_read(self):
        reader = FakeReader()
        response = make(reader).post("/v1/index", content=PDF, headers=headers(**{"x-embedding-model": "other/model"}))
        got = events(response)
        self.assertEqual([e.type for e in got], ["error"])
        self.assertEqual((got[0].code, got[0].retryable), ("INDEXER_MODEL_MISMATCH", False))
        self.assertEqual(reader.calls, [])

    def test_a_missing_tokenizer_fails_before_the_read(self):
        reader = FakeReader()
        client = TestClient(create_app(Settings(secret=SECRET), reader))
        got = events(client.post("/v1/index", content=PDF, headers=headers()))
        self.assertEqual([(e.type, e.code) for e in got], [("error", "INDEXER_NOT_CONFIGURED")])
        self.assertEqual(reader.calls, [])

    def test_a_body_over_the_limit_is_413(self):
        response = make(FakeReader(), max_bytes=10).post("/v1/index", content=PDF, headers=headers())
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"]["code"], "TOO_LARGE_FOR_INDEX")

    def test_an_empty_body_and_bad_headers_are_400(self):
        client = make(FakeReader())
        self.assertEqual(client.post("/v1/index", content=b"", headers=headers()).json()["detail"]["code"], "EMPTY_BODY")
        for bad in ({"x-page-range": "3-1"}, {"x-page-range": "abc"}, {"x-page-range": "0-4"},
                    {"x-section-path": "not base64 json"}, {"x-ocr-pages-left": "many"}, {"x-ocr-pages-left": "-1"}):
            response = client.post("/v1/index", content=PDF, headers=headers(**bad))
            self.assertEqual((response.status_code, response.json()["detail"]["code"]), (400, "BAD_REQUEST"), bad)

    def test_a_slow_reader_yields_heartbeats(self):
        reader = FakeReader(delay=0.3)
        client = TestClient(create_app(Settings(secret=SECRET), reader, whitespace_tokenizer(448), heartbeat_seconds=0.05))
        got = events(client.post("/v1/index", content=PDF, headers=headers()))
        self.assertGreaterEqual(sum(e.type == "heartbeat" for e in got), 2)
        self.assertEqual(got[-1].type, "result")

    def test_an_indexing_error_ends_the_stream_with_that_error(self):
        reader = FakeReader(error=IndexingError("UNREADABLE_PDF", "The file could not be read.", False))
        got = events(make(reader).post("/v1/index", content=PDF, headers=headers()))
        self.assertEqual([e.type for e in got], ["started", "error"])
        self.assertEqual((got[-1].code, got[-1].retryable), ("UNREADABLE_PDF", False))

    def test_a_crash_is_index_failed_and_leaks_no_text(self):
        reader = FakeReader(error=RuntimeError("Revenue 1,234"))
        with self.assertLogs("maester_indexer", level="INFO") as logs:
            response = make(reader).post("/v1/index", content=PDF, headers=headers())
        got = events(response)
        self.assertEqual((got[-1].type, got[-1].code, got[-1].retryable), ("error", "INDEX_FAILED", True))
        self.assertNotIn("Revenue", response.text)
        self.assertNotIn("Revenue", "\n".join(logs.output))
        self.assertIn("RuntimeError", "\n".join(logs.output))

    def test_chunk_streams_pages_and_chunks_with_no_read(self):
        reader = FakeReader()
        request = json.loads(CHUNK_REQUEST.read_text(encoding="utf-8"))
        client = make(reader)
        response = client.post("/v1/chunk", content=json.dumps(request), headers=headers())
        got = events(response)
        self.assertEqual(got[0].type, "started")
        self.assertIsInstance(got[-1], ResultEvent)
        self.assertIsNone(got[-1].read)
        self.assertTrue(any(isinstance(e, PageEvent) for e in got))
        self.assertEqual(reader.calls, [])
        mismatch = client.post("/v1/chunk", content=json.dumps({**request, "embeddingModel": "x/y"}), headers=headers())
        self.assertEqual(events(mismatch)[0].code, "INDEXER_MODEL_MISMATCH")
        self.assertEqual(client.post("/v1/chunk", content=b'{"read": 1}', headers=headers()).status_code, 400)

    def test_a_client_that_disconnects_cancels_the_reader(self):
        reader = FakeReader(delay=30)
        app = create_app(Settings(secret=SECRET), reader, whitespace_tokenizer(448), heartbeat_seconds=0.05)

        async def run():
            incoming: asyncio.Queue = asyncio.Queue()
            outgoing: asyncio.Queue = asyncio.Queue()
            await incoming.put({"type": "http.request", "body": PDF, "more_body": False})
            scope = {
                "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
                "path": "/v1/index", "raw_path": b"/v1/index", "query_string": b"", "scheme": "http",
                "server": ("test", 80), "client": ("test", 1),
                "headers": [(k.encode(), v.encode()) for k, v in {**headers(), "content-length": str(len(PDF))}.items()],
            }
            task = asyncio.ensure_future(app(scope, incoming.get, outgoing.put))
            while True:  # wait for the first body chunk, so the reader is running
                message = await asyncio.wait_for(outgoing.get(), 5)
                if message["type"] == "http.response.body" and message.get("body"):
                    break
            await incoming.put({"type": "http.disconnect"})
            await asyncio.wait_for(task, 5)

        asyncio.run(run())
        self.assertIsNotNone(reader.cancel)
        deadline = time.monotonic() + 2
        while not reader.cancel.is_set() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(reader.cancel.is_set())


if __name__ == "__main__":
    unittest.main()
