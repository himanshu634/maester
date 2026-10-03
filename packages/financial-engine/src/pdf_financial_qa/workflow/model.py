"""The model boundary of the workflow: structured outputs and the Gemini implementation."""

import base64
import json
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from pdf_financial_qa.workflow import prompts
from pdf_financial_qa.workflow.errors import ModelOutputError


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


def pdf_message(text: str, pdf: bytes) -> list:
    """System-free human message carrying the instruction and the PDF as a v1 file block."""
    from langchain_core.messages import HumanMessage

    return [
        HumanMessage(content=[
            {"type": "text", "text": text},
            {"type": "file", "base64": base64.b64encode(pdf).decode(), "mime_type": "application/pdf"},
        ])
    ]


class GeminiExtractionModel:
    """Gemini on Vertex AI through LangChain's ``ChatGoogleGenerativeAI``.

    Retries are left to the workflow's retry policy, so the client makes one attempt.
    """

    def __init__(self, *, project: str, location: str, model: str, timeout_seconds: float = 300) -> None:
        from langchain_google_genai import ChatGoogleGenerativeAI

        self.name = model
        self._llm = ChatGoogleGenerativeAI(
            model=model, vertexai=True, project=project, location=location,
            temperature=0, max_retries=1, timeout=timeout_seconds,
        )

    def _structured(self, schema: type[BaseModel], text: str, pdf: bytes) -> BaseModel:
        result = self._llm.with_structured_output(schema).invoke(pdf_message(text, pdf))
        if not isinstance(result, schema):
            raise ModelOutputError(f"model returned no {schema.__name__}")
        return result

    def locate(self, pdf: bytes, page_count: int) -> LocateOutput:
        text = f"{prompts.LOCATE}\nThe PDF has {page_count} pages."
        return self._structured(LocateOutput, text, pdf)  # type: ignore[return-value]

    def extract(self, pdf: bytes, page_count: int, statement: str, basis: str) -> StatementOutput:
        text = prompts.EXTRACT.format(statement=statement, basis=basis) + f"\nThe PDF has {page_count} pages."
        return self._structured(StatementOutput, text, pdf)  # type: ignore[return-value]

    def correct(self, pdf: bytes, page_count: int, statement: str, basis: str,
                section: ExtractedSection, problems: list[str]) -> ExtractedSection:
        text = prompts.CORRECT.format(
            section=section.name, statement=statement, basis=basis,
            problems="\n".join(f"- {p}" for p in problems),
            previous=json.dumps(section.model_dump(), ensure_ascii=False, indent=1),
        ) + f"\nThe PDF has {page_count} pages."
        return self._structured(ExtractedSection, text, pdf)  # type: ignore[return-value]
