"""The model boundary of the workflow: structured outputs and the Claude implementation."""

import base64
import json
import threading
from dataclasses import dataclass, field
from typing import Literal, NamedTuple, Protocol, TypeVar

from pydantic import BaseModel, Field, ValidationError

from pdf_financial_qa.workflow import prompts
from pdf_financial_qa.workflow.errors import ExtractionError, ModelOutputError


class LocatedStatement(BaseModel):
    statement: Literal["balance_sheet", "income_statement", "cash_flow"]
    basis: Literal["consolidated", "standalone", "unknown"]
    pages: list[int] = Field(description="1-based page numbers within the given PDF")


class LocateOutput(BaseModel):
    company_name: str | None = None
    statements: list[LocatedStatement] = Field(default_factory=list)


class ExtractedValue(BaseModel):
    period: str
    text: str = Field(description="the cell exactly as printed")


class ExtractedLine(BaseModel):
    label: str
    page: int = Field(description="1-based page number within the given PDF")
    is_subtotal: bool = False
    component_labels: list[str] = Field(default_factory=list)
    values: list[ExtractedValue] = Field(default_factory=list)


class ExtractedSection(BaseModel):
    name: str
    lines: list[ExtractedLine] = Field(default_factory=list)


class StatementOutput(BaseModel):
    currency: str | None = None
    unit_label: str | None = None
    periods: list[str] = Field(default_factory=list)
    sections: list[ExtractedSection] = Field(default_factory=list)


class ExtractionModel(Protocol):
    """The three model calls the workflow makes. Implementations must be thread-safe:
    statement branches run in parallel."""

    name: str

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput: ...

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput: ...

    def correct(self, pdf: bytes, page_count: int, statement: str, basis: str,
                section: ExtractedSection, problems: list[str]) -> ExtractedSection: ...


DEFAULT_MODEL = "claude-opus-5-5"
Effort = Literal["low", "medium", "high", "xhigh", "max"]
T = TypeVar("T", bound=BaseModel)


class Tokens(NamedTuple):
    input: int
    cache_write: int
    cache_read: int
    output: int

    def __sub__(self, other: "Tokens") -> "Tokens":  # type: ignore[override]
        return Tokens(*(a - b for a, b in zip(self, other)))


@dataclass
class TokenUsage:
    """Tokens a model has spent, summed over its calls. Thread-safe: statement branches run in parallel."""

    input: int = 0
    cache_write: int = 0
    cache_read: int = 0
    output: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    def add(self, usage) -> None:
        with self._lock:
            self.input += usage.input_tokens or 0
            self.cache_write += usage.cache_creation_input_tokens or 0
            self.cache_read += usage.cache_read_input_tokens or 0
            self.output += usage.output_tokens or 0

    def snapshot(self) -> Tokens:
        with self._lock:
            return Tokens(self.input, self.cache_write, self.cache_read, self.output)


def claude_client(timeout_seconds: float):
    """An Anthropic client that makes one attempt per call: the workflow and the classifier retry a
    transient failure themselves, so SDK retries would multiply both spend and the deadline."""
    import anthropic

    return anthropic.Anthropic(timeout=timeout_seconds, max_retries=0)


def pdf_content(text: str, pdf: bytes, *, cache: bool = False) -> list[dict]:
    """The PDF as a base64 document block, then the instruction. ``cache`` marks the document for
    reuse by a later call on the same pages with the same output schema: a changed schema breaks the
    cache, so only corrections, which re-send their statement's pages one section at a time, use it."""
    document: dict = {"type": "document",
                      "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(pdf).decode()}}
    if cache:
        document["cache_control"] = {"type": "ephemeral"}
    return [document, {"type": "text", "text": text}]


def structured_call(client, *, model: str, effort: Effort, max_tokens: int, schema: type[T], text: str, pdf: bytes,
                    cache: bool = False, system: str | None = None, usage: TokenUsage | None = None) -> T:
    """One streamed request whose answer is constrained to ``schema`` and validated against it.

    A refusal or an answer cut off at ``max_tokens`` would come back the same on a retry, so both are
    permanent; JSON that does not validate is a ``ModelOutputError``, which the callers retry."""
    import anthropic

    output_config = {"effort": effort, "format": {"type": "json_schema", "schema": anthropic.transform_schema(schema)}}
    extra = {"system": system} if system else {}
    with client.messages.stream(model=model, max_tokens=max_tokens, output_config=output_config, **extra,
                                messages=[{"role": "user", "content": pdf_content(text, pdf, cache=cache)}]) as stream:
        message = stream.get_final_message()
    if usage is not None:
        usage.add(message.usage)
    if message.stop_reason == "refusal":
        raise ExtractionError("MODEL_REFUSED", "the model declined to read the document", retryable=False)
    if message.stop_reason == "max_tokens":
        raise ExtractionError("MODEL_OUTPUT_TOO_LONG", f"the answer did not fit in {max_tokens} tokens", retryable=False)
    text_out = next((block.text for block in message.content if block.type == "text"), None)
    if text_out is None:
        raise ModelOutputError(f"model returned no {schema.__name__}")
    try:
        return schema.model_validate_json(text_out)
    except ValidationError as exc:
        raise ModelOutputError(f"model returned an invalid {schema.__name__}") from exc


class ClaudeExtractionModel:
    """Claude through the Anthropic SDK, with structured outputs.

    Retries are left to the workflow's retry policy, so the client makes one attempt.
    """

    def __init__(self, *, model: str = DEFAULT_MODEL, effort: Effort = "high", timeout_seconds: float = 300,
                 max_tokens: int = 64000) -> None:
        self.name = model
        self._effort, self._max_tokens = effort, max_tokens
        self._client = claude_client(timeout_seconds)
        self.usage = TokenUsage()

    def _structured(self, schema: type[T], text: str, pdf: bytes, *, cache: bool = False) -> T:
        return structured_call(self._client, model=self.name, effort=self._effort, max_tokens=self._max_tokens,
                               schema=schema, text=text, pdf=pdf, cache=cache, usage=self.usage)

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput:
        text = f"{prompts.LOCATE}\nThe PDF has {page_count} pages."
        return self._structured(LocateOutput, text, pdf)

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput:
        text = prompts.EXTRACT.format(statement=statement, basis=basis) + f"\nThe PDF has {page_count} pages."
        return self._structured(StatementOutput, text, pdf)

    def correct(self, pdf: bytes, page_count: int, statement: str, basis: str,
                section: ExtractedSection, problems: list[str]) -> ExtractedSection:
        text = prompts.CORRECT.format(
            section=section.name, statement=statement, basis=basis,
            problems="\n".join(f"- {p}" for p in problems),
            previous=json.dumps(section.model_dump(), ensure_ascii=False, indent=1),
        ) + f"\nThe PDF has {page_count} pages."
        return self._structured(ExtractedSection, text, pdf, cache=True)
