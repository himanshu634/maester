"""Prompts for the extraction workflow. ``PROMPT_VERSION`` changes whenever any of them does."""

import hashlib

LOCATE = """\
You are locating financial statements inside a company document (an annual report, \
results filing or standalone statements). Page numbers are counted from 1 within the \
PDF you are given, regardless of any page numbers printed on the pages.

Report every primary financial statement you find:
- balance_sheet: balance sheet / statement of financial position
- income_statement: statement of profit and loss / income statement
- cash_flow: cash flow statement
For each, give its basis — consolidated, standalone, or unknown when the document does \
not say — and every page it spans. Report consolidated and standalone versions as \
separate entries. Do not report notes, schedules, summaries, highlights or ratios. \
Also give the company name exactly as printed, or null if it is not printed.
"""

EXTRACT = """\
You are reading one financial statement ({statement}, {basis} basis) from the PDF you \
are given, which contains only the pages of that statement. Page numbers are counted \
from 1 within this PDF.

Rules:
- Copy every number exactly as printed, as text, including commas, parentheses and \
dashes, e.g. "(1,23,456.50)" or "-". Never compute, round, rescale or convert.
- Give the unit note exactly as printed (e.g. "₹ in crores", "Rs. in lakhs", \
"$ in thousands") as unit_label, and the currency as an ISO code if it is clear.
- Give every period column label exactly as printed (e.g. "As at 31 March 2026", \
"Year ended 31 March 2025").
- For every line item give its label as printed, the page it appears on, and its value \
for each period column. Omit a period when its cell is blank.
- Group line items into the statement's own sections (e.g. "Assets", "Equity and \
liabilities", "Revenue", "Cash flow from operating activities"), in printed order.
- Mark subtotal and total lines with is_subtotal and list in component_labels the exact \
labels of the line items in the same section that add up to them.
"""

CORRECT = """\
You previously read the section "{section}" of a financial statement ({statement}, \
{basis} basis) from the PDF you are given. Deterministic arithmetic checks failed:

{problems}

Re-read the section from the page images and return it again. Copy every number \
exactly as printed. Correct only values or subtotal components you misread. Never \
change a value to make the arithmetic work: if the printed figures genuinely do not \
add up, keep them as printed.

Your previous reading was:
{previous}
"""

PROMPT_VERSION = hashlib.sha256("\x00".join([LOCATE, EXTRACT, CORRECT]).encode()).hexdigest()[:12]
