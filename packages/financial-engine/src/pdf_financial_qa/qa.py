"""Question answering over a cached financial statement."""

from pdf_financial_qa.config import Settings
from pdf_financial_qa.schema import ExtractionResult
from pdf_financial_qa.workflow.model import claude_client

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
    context = (
        f"STRUCTURED DATA (JSON):\n{result.statement.model_dump_json(indent=2)}\n\n"
        f"VALIDATION WARNINGS:\n{result.validation_warnings or 'none'}\n\n"
        f"FULL DOCUMENT TEXT:\n{result.full_text}"
    )

    response = claude_client(timeout_seconds=600).messages.create(
        model=settings.model,
        max_tokens=16000,
        system=SYSTEM_INSTRUCTION,
        output_config={"effort": settings.effort},
        messages=[{"role": "user", "content": f"{context}\n\nQuestion: {question}"}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to answer")
    return "".join(block.text for block in response.content if block.type == "text")
