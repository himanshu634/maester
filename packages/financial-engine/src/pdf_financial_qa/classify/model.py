"""The model behind classification, behind a protocol so tests run offline."""

from typing import Literal, Protocol

from pydantic import BaseModel, Field

from pdf_financial_qa.classify import prompts
from pdf_financial_qa.workflow.model import DEFAULT_MODEL, Effort, claude_client, structured_call

QuestionField = Literal["kind", "other_type", "company", "period", "results_span"]


class Question(BaseModel):
    field: QuestionField
    allowed: list[str] | None = None  # None: free text, as printed


class Answer(BaseModel):
    field: QuestionField
    value: str
    page: int = Field(description="1-based page number within the PDF you were given")
    quote: str = Field(description="The exact words on that page that show the answer, at most 300 characters")


class ClassifyOutput(BaseModel):
    answers: list[Answer]


class ClassificationModel(Protocol):
    name: str

    def classify(self, pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput: ...


def render_questions(questions: list[Question]) -> str:
    return "\n".join(f"- {q.field}: {', '.join(q.allowed) if q.allowed else 'as printed'}" for q in questions)


class ClaudeClassificationModel:
    """Claude through the Anthropic SDK. One attempt per call; the runner retries a transient failure once."""

    def __init__(self, *, model: str = DEFAULT_MODEL, effort: Effort = "medium", timeout_seconds: float = 60,
                 max_tokens: int = 16000) -> None:
        self.name = model
        self._effort, self._max_tokens = effort, max_tokens
        self._client = claude_client(timeout_seconds)

    def classify(self, pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput:
        text = prompts.CLASSIFY.format(questions=render_questions(questions)) + f"\nThe PDF has {page_count} pages."
        return structured_call(self._client, model=self.name, effort=self._effort, max_tokens=self._max_tokens,
                               schema=ClassifyOutput, text=text, pdf=pdf)
