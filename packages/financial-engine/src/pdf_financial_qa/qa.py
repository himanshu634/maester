"""Question answering over a cached financial statement."""

from google import genai
from google.genai import types

from pdf_financial_qa.config import Settings
from pdf_financial_qa.schema import ExtractionResult

SYSTEM_INSTRUCTION = """\
You answer questions about a company's financial statements using ONLY the \
structured data and document text provided below. Do not use outside \
knowledge about the company.

- The structured JSON's `scale_factor` and `units` apply to every numeric \
value in it — state amounts in real terms (apply the scale factor) when you \
answer, and say what unit you're reporting in.
- Prefer the structured JSON for any numeric line item. Use the full document \
text for narrative questions (accounting policies, notes, commentary) or when \
a figure isn't present in the structured data.
- If the data needed to answer isn't present in either source, say so plainly \
instead of guessing.
- If `validation_warnings` is non-empty, those line items failed an arithmetic \
consistency check during extraction — flag it if your answer touches one of \
them.
"""


def ask(question: str, result: ExtractionResult, settings: Settings) -> str:
    client = genai.Client(vertexai=True, project=settings.project, location=settings.location)

    context = (
        f"STRUCTURED DATA (JSON):\n{result.statement.model_dump_json(indent=2)}\n\n"
        f"VALIDATION WARNINGS:\n{result.validation_warnings or 'none'}\n\n"
        f"FULL DOCUMENT TEXT:\n{result.full_text}"
    )

    response = client.models.generate_content(
        model=settings.model,
        contents=[context, f"Question: {question}"],
        config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
    )
    return response.text
