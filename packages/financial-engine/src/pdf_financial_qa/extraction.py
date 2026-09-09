"""Gemini-backed extraction shared by Maester application entry points."""

from pathlib import Path

from google import genai
from google.genai import types

from pdf_financial_qa.config import MAX_INLINE_PDF_BYTES, Settings
from pdf_financial_qa.schema import ExtractionResult, GeminiExtractionOutput
from pdf_financial_qa.storage import hash_pdf
from pdf_financial_qa.validation import validate_statement

SYSTEM_INSTRUCTION = """\
You are extracting structured data from a company's financial statement PDF \
(balance sheet, income statement, cash flow statement, and notes).

Rules:
- Every statement has a units/scale note (e.g. "amounts in Rs. lakhs", \
"$ in thousands"). Read it carefully and set `statement.units` and \
`statement.scale_factor` accordingly (e.g. units="lakhs" -> scale_factor=100000; \
units="thousands" -> scale_factor=1000; if amounts are already actuals, \
scale_factor=1). Record the numbers as printed in the document — do not \
pre-multiply them yourself; scale_factor is for downstream consumers to apply.
- Statements are almost always comparative (multiple periods/columns). Extract \
every period's value for every line item; use `value: null` only when a period \
truly has no disclosed figure for that line item.
- Numbers in parentheses represent negative values, e.g. "(1,234)" -> -1234.
- For each section (Balance Sheet - Assets, Balance Sheet - Liabilities and \
Equity, Income Statement, Cash Flow - Operating/Investing/Financing, etc.), \
mark subtotal/total lines with `is_subtotal: true` and list the exact labels \
of the line items in that same section that sum to it in `component_labels`.
- Also produce `full_text`: a complete markdown rendition of the ENTIRE \
document, including every table (as markdown tables) and all narrative text \
(accounting policies, notes, MD&A, auditor's report if present). This is the \
fallback source for questions the structured schema doesn't cover, so it must \
be complete, not a summary.
"""


def _build_pdf_part(pdf_bytes: bytes) -> types.Part:
    if len(pdf_bytes) > MAX_INLINE_PDF_BYTES:
        raise ValueError(
            f"PDF is {len(pdf_bytes) / 1024 / 1024:.1f} MB, over the "
            f"{MAX_INLINE_PDF_BYTES / 1024 / 1024:.0f} MB inline limit this tool "
            "enforces. Larger files need a GCS-backed upload (Part.from_uri), "
            "which isn't wired up yet."
        )
    return types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")


def extract(pdf_path: Path, settings: Settings) -> ExtractionResult:
    pdf_bytes = pdf_path.read_bytes()
    pdf_hash = hash_pdf(pdf_bytes)

    client = genai.Client(vertexai=True, project=settings.project, location=settings.location)

    response = client.models.generate_content(
        model=settings.model,
        contents=[
            _build_pdf_part(pdf_bytes),
            "Extract this financial statement per the system instructions.",
        ],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=GeminiExtractionOutput,
        ),
    )

    parsed: GeminiExtractionOutput = response.parsed
    warnings = validate_statement(parsed.statement)

    result = ExtractionResult(
        source_pdf_hash=pdf_hash,
        source_pdf_name=pdf_path.name,
        statement=parsed.statement,
        full_text=parsed.full_text,
        validation_warnings=warnings,
    )
    return result
