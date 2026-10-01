"""HTTP sidecar over the extraction workflow.

``POST /v1/extract`` takes a PDF body and answers ``200`` immediately with an
NDJSON stream: ``started``, then ``progress`` and ``heartbeat`` lines, then
exactly one ``result`` or ``error``. The service stores nothing.
"""

import asyncio
import hmac
import json
import logging
import os
import threading
import time
from collections.abc import AsyncIterator, Callable
from typing import Annotated
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from maester_extractor.settings import Settings
from pdf_financial_qa.workflow import PIPELINE_VERSION, ExtractionError, ExtractionModel, WorkflowSettings, run_extraction
from pdf_financial_qa.workflow.contracts import ErrorEvent, HeartbeatEvent, ProgressEvent, ResultEvent, StartedEvent, WireModel
from pdf_financial_qa.workflow.prompts import PROMPT_VERSION

log = logging.getLogger("maester_extractor")

ModelFactory = Callable[[], ExtractionModel]


class NDJSONResponse(StreamingResponse):
    media_type = "application/x-ndjson"


def _line(event: WireModel) -> bytes:
    return (json.dumps(event.to_wire(), ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def vertex_model_factory(settings: Settings) -> ModelFactory:
    """Build the Gemini model on first use and reuse it; report missing configuration
    as a permanent, typed error rather than failing at startup."""
    cached: list[ExtractionModel] = []
    lock = threading.Lock()

    def factory() -> ExtractionModel:
        with lock:
            if cached:
                return cached[0]
            if not settings.project:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "GOOGLE_CLOUD_PROJECT is not set", retryable=False)
            import google.auth
            from google.auth.exceptions import DefaultCredentialsError

            from pdf_financial_qa.workflow.model import GeminiExtractionModel

            try:
                google.auth.default()
            except DefaultCredentialsError as exc:
                raise ExtractionError("EXTRACTOR_NOT_CONFIGURED", "no Google Cloud credentials are available",
                                      retryable=False) from exc
            cached.append(GeminiExtractionModel(project=settings.project, location=settings.location, model=settings.model))
            return cached[0]

    return factory


def create_app(settings: Settings | None = None, model_factory: ModelFactory | None = None,
               workflow: WorkflowSettings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    model_factory = model_factory or vertex_model_factory(settings)
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
            log.warning("extraction refused", extra={"document_id": x_document_id, "code": err.code})
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
                log.info("extraction failed", extra={"document_id": x_document_id, "code": err.code,
                                                     "seconds": round(time.monotonic() - started, 1)})
                yield _line(ErrorEvent(code=err.code, retryable=err.retryable, message=err.message))
                return
            except Exception as exc:  # a bug, not a document problem; the job system retries
                log.exception("extraction crashed", extra={"document_id": x_document_id})
                yield _line(ErrorEvent(code="EXTRACTION_FAILED", retryable=True, message=f"unexpected {type(exc).__name__}"))
                return
            log.info("extraction finished", extra={"document_id": x_document_id, "state": result.state,
                                                   "facts": len(result.facts), "seconds": round(time.monotonic() - started, 1)})
            yield _line(ResultEvent(result=result))
        finally:
            # The client went away or the stream ended: stop any further model calls.
            cancel.set()
            getter.cancel()

    return app


app = create_app()
