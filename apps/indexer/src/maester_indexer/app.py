"""HTTP service over the reader and the chunker.

``POST /v1/index`` takes a PDF body and answers ``200`` at once with an NDJSON stream:
``started``, ``heartbeat`` lines while Docling reads, the range's ``page`` and ``chunk``
lines, ``progress`` and one ``result`` or one ``error``. ``POST /v1/chunk`` takes a
``ChunkRequest`` and streams the same without reading. The service stores nothing.

Logs and ``error`` messages never hold document text: ids, ranges, counts, seconds,
error codes and exception type names only.
"""

import asyncio
import base64
import binascii
import hmac
import json
import logging
import re
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Annotated, Any

from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from maester_indexer.chunker import chunk_range, load_tokenizer
from maester_indexer.contracts import (
    ChunkRequest,
    ErrorEvent,
    HeartbeatEvent,
    IndexerVersions,
    ProgressEvent,
    RangeRead,
    ResultEvent,
    StartedEvent,
    WireModel,
)
from maester_indexer.errors import IndexingError
from maester_indexer.reader import Reader, ReadCancelled
from maester_indexer.settings import Settings

log = logging.getLogger("maester_indexer")

HEARTBEAT_SECONDS = 15.0
_PAGE_RANGE = re.compile(r"^(\d{1,9})-(\d{1,9})$")


class NDJSONResponse(StreamingResponse):
    media_type = "application/x-ndjson"


def _line(event: WireModel) -> bytes:
    return (json.dumps(event.to_wire(), ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def _bad_request() -> HTTPException:
    return HTTPException(status_code=400, detail={"code": "BAD_REQUEST"})


def _safe_id(value: str | None) -> str:
    """A caller-supplied id, safe to put in a log line."""
    return re.sub(r"[^\w.:-]", "?", value or "-")[:64]


@dataclass(frozen=True)
class IndexParams:
    document_id: str
    first: int
    last: int
    section_path: list[str]
    ocr_pages_left: int
    embedding_model: str


def _section_path(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        path = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
    except (binascii.Error, ValueError):
        raise _bad_request() from None
    if not isinstance(path, list) or not all(isinstance(entry, str) for entry in path):
        raise _bad_request()
    return path


def index_params(
    x_document_id: Annotated[str | None, Header()] = None,
    x_page_range: Annotated[str | None, Header()] = None,
    x_section_path: Annotated[str | None, Header()] = None,
    x_ocr_pages_left: Annotated[str | None, Header()] = None,
    x_embedding_model: Annotated[str | None, Header()] = None,
) -> IndexParams:
    match = _PAGE_RANGE.match(x_page_range or "")
    if not match or not x_embedding_model or not x_document_id:
        raise _bad_request()
    first, last = int(match.group(1)), int(match.group(2))
    if first < 1 or last < first:
        raise _bad_request()
    try:
        ocr_pages_left = int(x_ocr_pages_left or 0)
    except ValueError:
        raise _bad_request() from None
    if ocr_pages_left < 0:
        raise _bad_request()
    return IndexParams(x_document_id, first, last, _section_path(x_section_path), ocr_pages_left, x_embedding_model)


async def _beats(task: "asyncio.Future[Any]", seconds: float) -> AsyncIterator[bytes]:
    """A heartbeat line every `seconds` until the task is done."""
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=seconds)
            if done:
                return
            yield _line(HeartbeatEvent())
    finally:
        # Whoever stopped listening still must not leave an unretrieved exception behind.
        task.add_done_callback(lambda finished: finished.cancelled() or finished.exception())


def create_app(settings: Settings | None = None, reader: Reader | None = None, tokenizer: BaseTokenizer | None = None,
               heartbeat_seconds: float = HEARTBEAT_SECONDS) -> FastAPI:
    settings = settings or Settings.from_env()
    reader = reader or Reader(settings)
    if not settings.secret:
        log.warning("INDEXER_SECRET is not set; requests are not authenticated by this service")

    loaded: list[BaseTokenizer] = [tokenizer] if tokenizer is not None else []
    tokenizer_lock = threading.Lock()

    def get_tokenizer() -> BaseTokenizer:
        with tokenizer_lock:
            if not loaded:
                if not settings.tokenizer_path:
                    raise IndexingError("INDEXER_NOT_CONFIGURED", "INDEX_TOKENIZER_PATH is not set.", False)
                loaded.append(load_tokenizer(settings.tokenizer_path, settings.embedding_model))
            return loaded[0]

    app = FastAPI(title="Maester indexer", docs_url=None, redoc_url=None, openapi_url=None)

    def authenticate(x_indexer_secret: Annotated[str | None, Header()] = None) -> None:
        if settings.secret and not hmac.compare_digest((x_indexer_secret or "").encode(), settings.secret.encode()):
            raise HTTPException(status_code=401, detail={"code": "INDEXER_UNAUTHORIZED"})

    async def body(request: Request, content_length: Annotated[int | None, Header()] = None) -> bytes:
        if content_length is not None and content_length > settings.max_bytes:
            raise HTTPException(status_code=413, detail={"code": "TOO_LARGE_FOR_INDEX"})
        data = bytearray()
        async for part in request.stream():
            data += part
            if len(data) > settings.max_bytes:
                raise HTTPException(status_code=413, detail={"code": "TOO_LARGE_FOR_INDEX"})
        if not data:
            raise HTTPException(status_code=400, detail={"code": "EMPTY_BODY"})
        return bytes(data)

    def mismatch(model: str) -> bytes | None:
        if model == settings.embedding_model:
            return None
        message = "The indexer's tokenizer is for another embedding model than the one asked for."
        return _line(ErrorEvent(code="INDEXER_MODEL_MISMATCH", retryable=False, message=message))

    def failure(document_id: str, error: BaseException, started: float) -> bytes:
        seconds = time.monotonic() - started
        if isinstance(error, IndexingError):
            log.info("index failed document=%s code=%s retryable=%s seconds=%.1f",
                     document_id, error.code, error.retryable, seconds)
            return _line(ErrorEvent(code=error.code, retryable=error.retryable, message=error.message))
        # A bug, not a document problem; the job system retries. The type only: an
        # exception's message or traceback can carry the document's text.
        log.error("index crashed document=%s error=%s seconds=%.1f", document_id, type(error).__name__, seconds)
        return _line(ErrorEvent(code="INDEX_FAILED", retryable=True, message=f"unexpected {type(error).__name__}"))

    async def chunked(read: RangeRead, section_path_before: list[str], beat: float) -> AsyncIterator[Any]:
        """Heartbeat lines, then the (pages, chunks) of the range."""

        def work() -> Any:
            return chunk_range(read, section_path_before, get_tokenizer())

        task = asyncio.ensure_future(asyncio.to_thread(work))
        async for line in _beats(task, beat):
            yield line
        yield task.result()

    def stream_chunks(pages: list, chunks: list) -> list[bytes]:
        lines: list[bytes] = []
        for page in pages:
            lines.append(_line(page))
            lines.extend(_line(chunk) for chunk in chunks if chunk.page_number == page.page_number)
        lines.append(_line(ProgressEvent(stage="chunking", percent=100.0)))
        return lines

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/versions", dependencies=[Depends(authenticate)])
    def versions() -> dict:
        versions: IndexerVersions = reader.versions
        return versions.to_wire()

    @app.post("/v1/index", response_class=NDJSONResponse, dependencies=[Depends(authenticate)])
    async def index(params: Annotated[IndexParams, Depends(index_params)],
                    pdf: Annotated[bytes, Depends(body)]) -> AsyncIterator[bytes]:
        document_id = _safe_id(params.document_id)
        started = time.monotonic()
        if refused := mismatch(params.embedding_model):
            log.info("index refused document=%s code=INDEXER_MODEL_MISMATCH", document_id)
            yield refused
            return
        cancel = threading.Event()
        try:
            # Before the read, so a missing tokenizer fails at once, not after the minutes a read takes.
            await asyncio.to_thread(get_tokenizer)
            page_count = await asyncio.to_thread(reader.page_count, pdf)
            if params.first > page_count:
                raise IndexingError("INDEX_FAILED", "The page range does not start on a page of the file.", False)
            last = min(params.last, page_count)
            yield _line(StartedEvent(versions=reader.versions, page_count=page_count, first_page=params.first,
                                     last_page=last))
            read_task = asyncio.ensure_future(asyncio.to_thread(
                reader.read_range, pdf, params.first, last, params.ocr_pages_left, cancel))
            async for line in _beats(read_task, heartbeat_seconds):
                yield line
            read: RangeRead = read_task.result()
            result: Any = None
            async for item in chunked(read, params.section_path, heartbeat_seconds):
                if isinstance(item, bytes):
                    yield item
                else:
                    result = item
            pages, chunks = result
            for line in stream_chunks(pages, chunks):
                yield line
            ocr_pages = sum(1 for page in read.pages if page.items_ocr > 0)
            log.info("index finished document=%s range=%d-%d pages=%d chunks=%d ocr_pages=%d seconds=%.1f",
                     document_id, params.first, last, len(pages), len(chunks), ocr_pages, time.monotonic() - started)
            yield _line(ResultEvent(read=read, ocr_pages=ocr_pages))
        except ReadCancelled:
            log.info("index cancelled document=%s", document_id)
        except Exception as error:
            yield failure(document_id, error, started)
        finally:
            # The client went away or the stream ended: tell the reader to stop.
            cancel.set()

    async def chunk_request(data: Annotated[bytes, Depends(body)]) -> ChunkRequest:
        try:
            return ChunkRequest.model_validate_json(data)
        except ValidationError:
            # No detail: the errors would quote the document.
            raise _bad_request() from None

    @app.post("/v1/chunk", response_class=NDJSONResponse, dependencies=[Depends(authenticate)])
    async def chunk(request: Annotated[ChunkRequest, Depends(chunk_request)],
                    x_document_id: Annotated[str | None, Header()] = None) -> AsyncIterator[bytes]:
        document_id = _safe_id(x_document_id)
        started = time.monotonic()
        if refused := mismatch(request.embedding_model):
            log.info("chunk refused document=%s code=INDEXER_MODEL_MISMATCH", document_id)
            yield refused
            return
        read = request.read
        try:
            yield _line(StartedEvent(versions=reader.versions, page_count=read.page_count,
                                     first_page=read.first_page, last_page=read.last_page))
            result: Any = None
            async for item in chunked(read, request.section_path_before, heartbeat_seconds):
                if isinstance(item, bytes):
                    yield item
                else:
                    result = item
            pages, chunks = result
            for line in stream_chunks(pages, chunks):
                yield line
            log.info("chunk finished document=%s range=%d-%d pages=%d chunks=%d seconds=%.1f", document_id,
                     read.first_page, read.last_page, len(pages), len(chunks), time.monotonic() - started)
            yield _line(ResultEvent(read=None, ocr_pages=0))
        except Exception as error:
            yield failure(document_id, error, started)

    return app
