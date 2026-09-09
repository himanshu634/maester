"""Legacy extraction schema; portfolio domain contracts are specified in docs."""

from pydantic import BaseModel, Field


class PeriodValue(BaseModel):
    period: str  # e.g. "FY2024", "As at 31 Mar 2024"
    value: float | None = None  # None when this line item isn't disclosed for this period


class LineItem(BaseModel):
    label: str
    values: list[PeriodValue]
    is_subtotal: bool = False
    # Labels of the other line items in the same section that sum to this
    # subtotal, e.g. "Total Assets" -> ["Cash and equivalents", "Inventory", ...].
    # Only populated when is_subtotal is True.
    component_labels: list[str] = Field(default_factory=list)


class StatementSection(BaseModel):
    # e.g. "Balance Sheet - Assets", "Balance Sheet - Liabilities and Equity",
    # "Income Statement", "Cash Flow - Operating Activities"
    name: str
    line_items: list[LineItem]


class FinancialStatement(BaseModel):
    company_name: str | None = None
    currency: str | None = None  # e.g. "INR", "USD"
    units: str | None = None  # e.g. "lakhs", "thousands", "millions", "actuals"
    # Multiply extracted numbers by this to get actual currency units.
    # e.g. units="lakhs" -> scale_factor=100000.
    scale_factor: float = 1.0
    periods: list[str] = Field(default_factory=list)
    sections: list[StatementSection]


class GeminiExtractionOutput(BaseModel):
    """Schema Gemini is asked to fill in directly."""

    statement: FinancialStatement
    # Full text/markdown rendition of the entire document (including notes,
    # accounting policies, MD&A) for questions the structured schema can't answer.
    full_text: str


class ExtractionResult(BaseModel):
    """What gets cached to disk."""

    source_pdf_hash: str
    source_pdf_name: str
    statement: FinancialStatement
    full_text: str
    validation_warnings: list[str] = Field(default_factory=list)
