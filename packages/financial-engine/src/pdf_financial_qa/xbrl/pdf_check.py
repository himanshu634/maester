"""``xbrl_in_pdf``: is each XBRL value printed on the PDF's statement pages?

The check reads the PDF's own text layer with ``text_layer_match`` and calls no model. It assumes the PDF prints in
the unit the instance declares (``scale``), so a value is looked for as ``value / scale``. A match anywhere on a
statement page counts, and the sign is not compared: ``text_layer_match`` takes absolute values, so a cash-flow
outflow printed in brackets matches the instance's positive element value. A change here bumps
``XBRL_PDF_CHECK_VERSION``.
"""

from decimal import ROUND_HALF_UP, Decimal, localcontext

from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.values import text_layer_match

from . import XBRL_PDF_CHECK_VERSION
from .contracts import XbrlPdfCheckFact, XbrlPdfCheckOutcome, XbrlPdfCheckRequest, XbrlPdfCheckResult, XbrlPdfNotChecked


def check_candidates(value: Decimal, per_share: bool, scale: Decimal | None, places: int | None) -> list[Decimal]:
    """The numbers to look for, in the order they are tried.

    A per-share value is looked for as it is. A monetary value is looked for as ``value / scale`` and, when the PDF's
    places are known, as that rounded half up to ``places`` (a value can carry finer digits than the page prints). The
    rounded number is left out when it equals the exact one, so a caller can count the passes that needed it.
    """
    if per_share:
        return [value]
    if scale is None or scale <= 0:
        raise ValueError("a monetary value needs a positive scale")
    with localcontext() as context:
        context.prec = 60
        exact = value / scale
        candidates = [exact]
        if places is not None:
            rounded = exact.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
            if rounded != exact:
                candidates.append(rounded)
    return candidates


def _outcome(fact: XbrlPdfCheckFact, status: str, page_index: int | None = None,
             reason: XbrlPdfNotChecked | None = None) -> XbrlPdfCheckOutcome:
    return XbrlPdfCheckOutcome(fact_id=fact.fact_id, status=status, page_index=page_index, reason=reason)  # type: ignore[arg-type]


def check_xbrl_in_pdf(pdf: bytes, request: XbrlPdfCheckRequest) -> XbrlPdfCheckResult:
    """One outcome per fact, in the request's order. An unreadable PDF raises the ``ExtractionError`` ``PdfDocument.load`` does."""
    document = PdfDocument.load(pdf)
    pages_of: dict[tuple[str, str], list[int]] = {}
    for found in request.statement_pages:
        pages_of.setdefault((found.statement, found.basis), []).extend(found.pages)
    scale = Decimal(request.scale) if request.scale is not None and Decimal(request.scale) > 0 else None
    results = [_check_fact(document, fact, scale, request.places, pages_of.get((fact.statement, fact.basis), []))
               for fact in request.facts]
    return XbrlPdfCheckResult(check_version=XBRL_PDF_CHECK_VERSION, results=results)


def _check_fact(document: PdfDocument, fact: XbrlPdfCheckFact, scale: Decimal | None, places: int | None,
                pages: list[int]) -> XbrlPdfCheckOutcome:
    if fact.value is None:
        return _outcome(fact, "not_checked", reason="no_value")
    if not fact.per_share and scale is None:
        return _outcome(fact, "not_checked", reason="no_unit")
    if not pages:
        return _outcome(fact, "not_checked", reason="no_statement_pages")
    candidates = check_candidates(Decimal(fact.value), fact.per_share, scale, places)
    some_page_without_text = False
    for index in pages:
        # A page past the end of the PDF has no text to read: a miss next to it is not proof.
        text = document.page_texts[index] if index < document.page_count else ""
        if not text.strip():
            some_page_without_text = True
            continue
        if any(text_layer_match(text, candidate) is True for candidate in candidates):
            return _outcome(fact, "passed", page_index=index)
    if some_page_without_text:
        return _outcome(fact, "not_checked", reason="scanned")
    return _outcome(fact, "failed")
