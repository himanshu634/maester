"""Multi-step, self-correcting financial-statement extraction (F05).

The workflow locates statements in a PDF, extracts each from its own pages,
checks the arithmetic deterministically and re-reads only the sections whose
checks fail. Model calls sit behind ``ExtractionModel`` so tests run offline.
"""

from pdf_financial_qa.workflow.contracts import ExtractionResult
from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.workflow.model import ExtractionModel
from pdf_financial_qa.workflow.runner import PIPELINE_VERSION, WorkflowSettings, run_extraction

__all__ = [
    "PIPELINE_VERSION",
    "ExtractionError",
    "ExtractionModel",
    "ExtractionResult",
    "WorkflowSettings",
    "run_extraction",
]
