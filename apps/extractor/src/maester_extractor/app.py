"""HTTP sidecar over the extraction workflow.

``POST /v1/extract`` takes a PDF body and answers ``200`` immediately with an
NDJSON stream: ``started``, then ``progress`` and ``heartbeat`` lines, then
exactly one ``result`` or ``error``. ``POST /v1/classify`` takes a PDF body and
answers one JSON document: ``{"type":"result",...}`` or ``{"type":"error",...}``.
``POST /v1/xbrl`` takes an XBRL instance and answers ``200`` immediately with an NDJSON stream: ``started``,
``heartbeat`` lines while the parse runs, then exactly one ``classification``, ``read``, ``text`` or ``error``.
The service stores nothing.
"""

import asyncio
import hmac
import json
import logging
import os
import threading
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Annotated, Literal, TypeVar, get_args
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from maester_extractor.settings import Settings
from pdf_financial_qa.classify import ClassificationModel, ClassifySettings, run_classification
from pdf_financial_qa.classify.contracts import ClassifyError, ClassifyResult
from pdf_financial_qa.workflow import PIPELINE_VERSION, ExtractionError, ExtractionModel, WorkflowSettings, run_extraction
from pdf_financial_qa.workflow.contracts import ErrorEvent, HeartbeatEvent, ProgressEvent, ResultEvent, StartedEvent, WireModel
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION
from pdf_financial_qa.xbrl import XBRL_MAP_VERSION, XBRL_PARSER_VERSION, XBRL_TEXT_VERSION
from pdf_financial_qa.xbrl.classify import classify_instance
from pdf_financial_qa.xbrl.contracts import (
    XbrlClassificationEvent,
    XbrlErrorEvent,
    XbrlHeartbeatEvent,
    XbrlReadEvent,
    XbrlStartedEvent,
    XbrlTextEvent,
    XbrlTextResult,
    to_xbrl_classification,
    to_xbrl_read_result,
)
from pdf_financial_qa.xbrl.parser import parse_instance
from pdf_financial_qa.xbrl.read import read_instance
from pdf_financial_qa.xbrl.text import text_blocks

log = logging.getLogger("maester_extractor")

ModelFactory = Callable[[], ExtractionModel]
ClassifyModelFactory = Callable[[], ClassificationModel]
T = TypeVar("T")
XbrlMode = Literal["classify", "read", "text"]


@dataclass(frozen=True, slots=True)
class XbrlOutcome:
    """What a worker thread hands back: the answer line and the counts that are safe to log."""

    event: XbrlClassificationEvent | XbrlReadEvent | XbrlTextEvent
    format_id: str | None
    facts: int
    warnings: int


class NDJSONResponse(StreamingResponse):
    media_type = "application/x-ndjson"


def read_xbrl(data: bytes, mode: XbrlMode, settings: Settings) -> XbrlOutcome:
    """Parse the instance and answer in the given mode. Raises ``ExtractionError`` for a document problem."""
    instance = parse_instance(data, max_bytes=settings.xbrl_max_bytes, max_facts=settings.xbrl_max_facts,
                              deadline_seconds=settings.xbrl_deadline_seconds)
    facts = len(instance.facts)
    if mode == "read":
        read = read_instance(instance)
        return XbrlOutcome(XbrlReadEvent(result=to_xbrl_read_result(read)), read.format.id, facts, len(read.warnings))
    classification = classify_instance(instance)
    if mode == "classify":
        return XbrlOutcome(XbrlClassificationEvent(result=to_xbrl_classification(classification)),
                           classification.format.id, facts, len(classification.warnings))
    result = XbrlTextResult(text_version=XBRL_TEXT_VERSION, basis=classification.basis, blocks=text_blocks(instance))
    return XbrlOutcome(XbrlTextEvent(result=result), classification.format.id, facts, 0)


def _line(event: WireModel) -> bytes:
    return (json.dumps(event.to_wire(), ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def _vertex_factory(settings: Settings, build: Callable[[], T]) -> Callable[[], T]:
    """Build a Vertex model on first use and reuse it; report missing configuration
    as a permanent, typed error rather than failing at startup."""
    cached: list[T] = []
    lock = threading.Lock()

    def factory() -> T:
        with lock:
            if cached:
                return cached[0]
            if not settings.project:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
            import google.auth
            from google.auth.exceptions import DefaultCredentialsError

            try:
                google.auth.default()
            except DefaultCredentialsError as exc:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "no Google Cloud credentials are available",
                                      retryable=False) from exc
            cached.append(build())
            return cached[0]

    return factory


def vertex_model_factory(settings: Settings) -> ModelFactory:
    def build() -> ExtractionModel:
        from pdf_financial_qa.workflow.model import GeminiExtractionModel
        return GeminiExtractionModel(project=settings.project, location=settings.location, model=settings.model)
    return _vertex_factory(settings, build)


def vertex_classify_factory(settings: Settings) -> ClassifyModelFactory:
    def build() -> ClassificationModel:
        from pdf_financial_qa.classify.model import GeminiClassificationModel
        return GeminiClassificationModel(project=settings.project, location=settings.location,
                                         model=settings.classify_model, timeout_seconds=settings.classify_model_seconds)
    return _vertex_factory(settings, build)


def create_app(settings: Settings | None = None, model_factory: ModelFactory | None = None,
               workflow: WorkflowSettings | None = None, classify_model_factory: ClassifyModelFactory | None = None,
               classify_settings: ClassifySettings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    model_factory = model_factory or vertex_model_factory(settings)
    classify_model_factory = classify_model_factory or vertex_classify_factory(settings)
    classify_settings = classify_settings or ClassifySettings()
    workflow = workflow or WorkflowSettings(deadline_seconds=settings.deadline_seconds)
    # LangSmith tracing would send document contents to a third party.
    os.environ["LANGSMITH_TRACING"] = "false"
    os.environ["LANGCHAIN_TRACING_V2"] = "false"
    if not settings.secret:
        log.warning("EXTRACTOR_SECRET is not set; requests are not authenticated by this service")

    app = FastAPI(title="Maester extractor", docs_url=None, redoc_url=None, openapi_url=None)

    def authenticate(x_extractor_secret: Annotated[str | None, Header()] = None) -> None:
        if settings.secret and not hmac.compare_digest((x_extractor_secret or "").encode(), settings.secret.encode()):
            raise HTTPException(status_code=401, detail={"code": "EXTRACTOR_UNAUTHORIZED"})

    async def pdf_body(request: Request, content_length: Annotated[int | None, Header()] = None) -> bytes:
        if content_length is not None and content_length > settings.max_bytes:
            raise HTTPException(status_code=413, detail={"code": "TOO_LARGE_FOR_EXTRACTION"})
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > settings.max_bytes:
                raise HTTPException(status_code=413, detail={"code": "TOO_LARGE_FOR_EXTRACTION"})
        if not body:
            raise HTTPException(status_code=400, detail={"code": "EMPTY_BODY"})
        return bytes(body)

    def xbrl_mode(x_xbrl_mode: Annotated[str | None, Header()] = None) -> XbrlMode:
        if x_xbrl_mode not in get_args(XbrlMode):
            raise HTTPException(status_code=400, detail={"code": "BAD_REQUEST"})
        return x_xbrl_mode  # type: ignore[return-value]

    async def xbrl_body(request: Request, content_length: Annotated[int | None, Header()] = None) -> bytes | None:
        """The instance, or None when it is over the limit. It is read no further then, and the route answers
        ``TOO_LARGE`` as a document fault (a 200), not as a transport fault."""
        if content_length is not None and content_length > settings.xbrl_max_bytes:
            return None
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > settings.xbrl_max_bytes:
                return None
        if not body:
            raise HTTPException(status_code=400, detail={"code": "EMPTY_BODY"})
        return bytes(body)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/extract", response_class=NDJSONResponse, dependencies=[Depends(authenticate)])
    async def extract(
        pdf: Annotated[bytes, Depends(pdf_body)],
        x_document_id: Annotated[str | None, Header()] = None,
        x_company_name: Annotated[str | None, Header()] = None,
    ) -> AsyncIterator[bytes]:
        company_name = unquote(x_company_name) if x_company_name else None
        started = time.monotonic()

        try:
            model = model_factory()
        except ExtractionError as err:
            yield _line(StartedEvent(pipeline_version=PIPELINE_VERSION, model=settings.model, prompt_version=PROMPT_VERSION))
            log.warning("extraction refused document=%s code=%s", x_document_id, err.code)
            yield _line(ErrorEvent(code=err.code, retryable=err.retryable, message=err.message))
            return
        yield _line(StartedEvent(pipeline_version=PIPELINE_VERSION, model=model.name, prompt_version=PROMPT_VERSION))

        loop = asyncio.get_running_loop()
        progress: asyncio.Queue[tuple[str, float]] = asyncio.Queue()
        cancel = threading.Event()

        def on_progress(stage: str, percent: float) -> None:
            loop.call_soon_threadsafe(progress.put_nowait, (stage, percent))

        run = asyncio.ensure_future(asyncio.to_thread(
            run_extraction, pdf, model=model, company_name=company_name, on_progress=on_progress,
            settings=workflow, cancel=cancel))
        getter = asyncio.ensure_future(progress.get())
        try:
            while True:
                done, _ = await asyncio.wait({run, getter}, timeout=settings.heartbeat_seconds,
                                             return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    stage, percent = getter.result()
                    yield _line(ProgressEvent(stage=stage, percent=percent))
                    getter = asyncio.ensure_future(progress.get())
                elif run in done:
                    break
                else:
                    yield _line(HeartbeatEvent())
            getter.cancel()
            while not progress.empty():
                stage, percent = progress.get_nowait()
                yield _line(ProgressEvent(stage=stage, percent=percent))
            try:
                result = run.result()
            except ExtractionError as err:
                log.info("extraction failed document=%s code=%s retryable=%s seconds=%.1f",
                         x_document_id, err.code, err.retryable, time.monotonic() - started)
                yield _line(ErrorEvent(code=err.code, retryable=err.retryable, message=err.message))
                return
            except Exception as exc:  # a bug, not a document problem; the job system retries
                # The type only: an exception's message or traceback can carry the document's text.
                log.error("extraction crashed document=%s error=%s", x_document_id, type(exc).__name__)
                yield _line(ErrorEvent(code="EXTRACTION_FAILED", retryable=True, message=f"unexpected {type(exc).__name__}"))
                return
            log.info("extraction finished document=%s state=%s facts=%d warnings=%d seconds=%.1f", x_document_id,
                     result.state, len(result.facts), len(result.warnings), time.monotonic() - started)
            yield _line(ResultEvent(result=result))
        finally:
            # The client went away or the stream ended: stop any further model calls.
            cancel.set()
            getter.cancel()

    @app.post("/v1/classify", dependencies=[Depends(authenticate)])
    async def classify(pdf: Annotated[bytes, Depends(pdf_body)],
                       x_document_id: Annotated[str | None, Header()] = None) -> JSONResponse:
        started = time.monotonic()
        try:
            result = await asyncio.to_thread(run_classification, pdf, model_factory=classify_model_factory,
                                             settings=classify_settings)
        except ExtractionError as err:
            log.info("classification failed document=%s code=%s", x_document_id, err.code)
            return JSONResponse(ClassifyError(code=err.code, retryable=err.retryable, message=err.message).to_wire())
        except Exception as exc:  # a bug, not a document problem; the job system retries
            # The type only: an exception's message or traceback can carry the document's text.
            log.error("classification crashed document=%s error=%s", x_document_id, type(exc).__name__)
            return JSONResponse(ClassifyError(code="CLASSIFICATION_FAILED", retryable=True,
                                              message=f"unexpected {type(exc).__name__}").to_wire())
        log.info("classification finished document=%s kind=%s evidence=%d warnings=%d seconds=%.1f", x_document_id,
                 result.kind, len(result.evidence), len(result.warnings), time.monotonic() - started)
        return JSONResponse(ClassifyResult(result=result).to_wire())

    @app.post("/v1/xbrl", response_class=NDJSONResponse, dependencies=[Depends(authenticate)])
    async def xbrl(
        mode: Annotated[XbrlMode, Depends(xbrl_mode)],
        body: Annotated[bytes | None, Depends(xbrl_body)],
        x_document_id: Annotated[str | None, Header()] = None,
    ) -> AsyncIterator[bytes]:
        started = time.monotonic()
        yield _line(XbrlStartedEvent(parser_version=XBRL_PARSER_VERSION, map_version=XBRL_MAP_VERSION, mode=mode))

        def fail(code: str, retryable: bool, message: str) -> bytes:
            return _line(XbrlErrorEvent(code=code, retryable=retryable, message=message))

        if body is None:
            log.info("xbrl refused document=%s mode=%s code=XBRL_UNREADABLE reason=TOO_LARGE", x_document_id, mode)
            yield fail("XBRL_UNREADABLE", False, "TOO_LARGE")
            return

        run = asyncio.ensure_future(asyncio.to_thread(read_xbrl, body, mode, settings))
        # If the client goes away the stream is cancelled and nobody awaits this future. Retrieve its outcome anyway,
        # so a later crash in the thread is not logged by asyncio with a traceback that may hold document text.
        run.add_done_callback(lambda future: future.cancelled() or future.exception())
        while True:
            await asyncio.wait({run}, timeout=settings.heartbeat_seconds)
            if run.done():
                break
            yield _line(XbrlHeartbeatEvent())
        try:
            outcome = run.result()
        except ExtractionError as err:
            log.info("xbrl failed document=%s mode=%s code=%s retryable=%s seconds=%.1f",
                     x_document_id, mode, err.code, err.retryable, time.monotonic() - started)
            yield fail(err.code, err.retryable, err.message)
            return
        except Exception as exc:  # a bug, not a document problem; the job system retries
            # The type only: an exception's message or traceback can carry the document's text.
            log.error("xbrl crashed document=%s mode=%s error=%s", x_document_id, mode, type(exc).__name__)
            yield fail("XBRL_FAILED", True, f"unexpected {type(exc).__name__}")
            return
        log.info("xbrl finished document=%s mode=%s format=%s facts=%d warnings=%d seconds=%.1f", x_document_id, mode,
                 outcome.format_id, outcome.facts, outcome.warnings, time.monotonic() - started)
        yield _line(outcome.event)

    return app


app = create_app()
