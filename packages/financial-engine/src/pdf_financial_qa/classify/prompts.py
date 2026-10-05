"""The classify prompt. PROMPT_VERSION changes whenever its text does."""

import hashlib

CLASSIFY = """You are reading the first pages of a document published by an Indian listed company.
Answer only the questions listed below. For each answer give the 1-based page number in this PDF
and copy the exact words from that page that show it (at most 300 characters).
If the pages do not show an answer, leave that question out. Never give a company name that is not printed.

Meanings:
- kind: annual_report (a full year's annual report), financial_results (quarterly, half-year,
  nine-month or year-end results), other (any other company document).
- other_type: the type of an "other" document.
- company: the company's name exactly as printed.
- period: the period the document covers, as printed, for example "Quarter ended 30 June 2026".
- results_span: quarter, half_year, nine_months or full_year. Results for "the quarter and year ended
  31 March" are full_year.

Questions (field: allowed values):
{questions}
"""

PROMPT_VERSION = "classify-" + hashlib.sha256(CLASSIFY.encode()).hexdigest()[:12]
