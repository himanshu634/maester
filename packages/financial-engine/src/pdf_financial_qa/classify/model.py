"""The model behind classification, behind a protocol so tests run offline."""

from typing import Literal, Protocol

from pydantic import BaseModel, Field

from pdf_financial_qa.classify import prompts
from pdf_financial_qa.workflow.errors import ModelOutputError
from pdf_financial_qa.workflow.model import pdf_message

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


class GeminiClassificationModel:
    """Gemini on Vertex AI. One attempt per call; the runner retries a transient failure once."""

    def __init__(self, *, project: str, location: str, model: str, timeout_seconds: float = 60) -> None:
        from langchain_google_genai import ChatGoogleGenerativeAI

        self.name = model
        self._llm = ChatGoogleGenerativeAI(model=model, vertexai=True, project=project, location=location,
                                           temperature=0, max_retries=1, timeout=timeout_seconds)

    def classify(self, pdf: bytes, page_count: int, questions: list[Question]) -> ClassifyOutput:
        text = prompts.CLASSIFY.format(questions=render_questions(questions)) + f"\nThe PDF has {page_count} pages."
        result = self._llm.with_structured_output(ClassifyOutput).invoke(pdf_message(text, pdf))
        if not isinstance(result, ClassifyOutput):
            raise ModelOutputError("model returned no ClassifyOutput")
        return result
