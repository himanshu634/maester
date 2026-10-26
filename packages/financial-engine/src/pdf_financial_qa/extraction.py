"""Claude-backed extraction shared by Maester application entry points."""

from pathlib import Path

from pdf_financial_qa.config import MAX_INLINE_PDF_BYTES, Settings
from pdf_financial_qa.schema import ExtractionResult, ModelExtractionOutput
from pdf_financial_qa.storage import hash_pdf
from pdf_financial_qa.validation import validate_statement
from pdf_financial_qa.workflow.model import claude_client, structured_call

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


def _check_size(pdf_bytes: bytes) -> None:
    if len(pdf_bytes) > MAX_INLINE_PDF_BYTES:
        raise ValueError(
            f"PDF is {len(pdf_bytes) / 1024 / 1024:.1f} MB, over the "
            f"{MAX_INLINE_PDF_BYTES / 1024 / 1024:.0f} MB inline limit this tool "
            "enforces. Larger files need the Files API, which isn't wired up yet."
        )


def extract(pdf_path: Path, settings: Settings) -> ExtractionResult:
    pdf_bytes = pdf_path.read_bytes()
    pdf_hash = hash_pdf(pdf_bytes)

    _check_size(pdf_bytes)
    # The full-text rendition of a long report is large, so the answer gets the model's whole output budget.
    parsed = structured_call(
        claude_client(timeout_seconds=1800), model=settings.model, effort=settings.effort, max_tokens=128000,
        schema=ModelExtractionOutput, system=SYSTEM_INSTRUCTION,
        text="Extract this financial statement per the system instructions.", pdf=pdf_bytes,
    )
    warnings = validate_statement(parsed.statement)

    result = ExtractionResult(
        source_pdf_hash=pdf_hash,
        source_pdf_name=pdf_path.name,
        statement=parsed.statement,
        full_text=parsed.full_text,
        validation_warnings=warnings,
    )
    return result
