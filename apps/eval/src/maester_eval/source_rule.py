"""The source rule, version 1: the Python twin of `sources.ts` in `@maester/financial-engine`.

Which revision owns a statement slot, which facts may fill an annual column, and whether a results PDF is read,
skipped or held for XBRL. The fields are the TypeScript ones in snake_case; both are tested against
`packages/financial-engine-ts/fixtures/source-rule.json`, and a change to one is a change to both.

Pure: no I/O, no clock, no numbers. Dates are ISO strings compared as text, so every date is `YYYY-MM-DD` and
every timestamp is UTC in the `toISOString()` shape (`2026-05-01T09:00:00.000Z`); a mix of shapes would misorder.
"""

from functools import cmp_to_key
from typing import Literal, NotRequired, TypedDict

SOURCE_RULE_VERSION = 1

FilingKind = Literal["annual_report", "financial_results"]
Basis = Literal["consolidated", "standalone", "unknown"]
Statement = Literal["income_statement", "balance_sheet", "cash_flow"]
Span = Literal["quarter", "half_year", "nine_months", "year", "other"]
Source = Literal["xbrl", "pdf"]


class Slot(TypedDict):
    """One column of one statement: a duration (`span` set) or an instant (`span` None)."""

    company_id: str
    filing_kind: FilingKind
    statement: Statement
    basis: Basis
    period_end: str
    span: Span | None


class SlotCandidate(TypedDict):
    revision_id: str
    document_id: str
    source: Source
    filing_period_end: str | None
    revision_created_at: str


class AnnualFiling(TypedDict):
    company_id: str
    kind: FilingKind
    source: Source
    period_end: str | None


class AnnualFact(TypedDict):
    statement: Statement
    basis: Basis
    span: Span | None
    period_end: str | None
    as_of_date: str | None


class CompanyIdentity(TypedDict):
    cin: str | None
    bse_code: str | None
    nse_symbol: str | None
    isin: str | None


class StatementBasis(TypedDict):
    statement: Statement
    basis: Basis


class XbrlDocInput(TypedDict):
    document_id: str
    state: Literal["unsettled", "held", "settled"]
    company_id: str | None
    identity: CompanyIdentity
    period_end: str | None
    coverage: list[StatementBasis]


class PdfNumbersInput(TypedDict):
    company_id: str
    company_identity: CompanyIdentity
    kind: FilingKind
    period_end: str | None
    statements_found: list[StatementBasis]


class PdfNumbersPlan(TypedDict):
    """`wait` carries `waiting_on`; `skip` carries `covered_by`; `read` carries `covered_by` and `uncovered`."""

    action: Literal["wait", "skip", "read"]
    waiting_on: NotRequired[list[str]]
    covered_by: NotRequired[list[str]]
    uncovered: NotRequired[list[StatementBasis]]


def slot_key(s: Slot) -> str:
    span = s["span"] if s["span"] is not None else "instant"
    return "|".join((s["company_id"], s["filing_kind"], s["statement"], s["basis"], s["period_end"], span))


def _newer_first(a: str, b: str) -> int:
    """Descending text order: the larger string first, by code point, as TypeScript's `<` orders them."""
    return 0 if a == b else (1 if a < b else -1)


def _owner_first(a: SlotCandidate, b: SlotCandidate) -> int:
    if a["source"] != b["source"]:
        return -1 if a["source"] == "xbrl" else 1
    if a["filing_period_end"] != b["filing_period_end"]:
        if a["filing_period_end"] is None:
            return 1
        if b["filing_period_end"] is None:
            return -1
        return _newer_first(a["filing_period_end"], b["filing_period_end"])
    if a["revision_created_at"] != b["revision_created_at"]:
        return _newer_first(a["revision_created_at"], b["revision_created_at"])
    return _newer_first(a["revision_id"], b["revision_id"])


def rank_slot_candidates(cs: list[SlotCandidate]) -> list[SlotCandidate]:
    """The candidates for one slot, owner first: XBRL before PDF, then the newer filing period (None last), then
    the newer revision, then the larger revision id. The input is not reordered."""
    return sorted(cs, key=cmp_to_key(_owner_first))


def slot_owner(cs: list[SlotCandidate]) -> SlotCandidate | None:
    ranked = rank_slot_candidates(cs)
    return ranked[0] if ranked else None


def annual_slot_of(filing: AnnualFiling, fact: AnnualFact) -> Slot | None:
    """The annual-table slot a fact fills, or None. The one place the investor's open Q4 question is answered:
    a results filing's full-year facts do not fill an annual column.

    1. A `financial_results` filing gives None.
    2. A PDF fact gives its slot at its period end, else its as-of date (comparative years included); with
       neither, there is nothing to key it by, and it gives None.
    3. An XBRL fact gives its slot when its span is `year`, or when it is an instant on the filing's own period
       end (both known). Anything else gives None.
    """
    if filing["kind"] == "financial_results":
        return None

    def slot(period_end: str | None) -> Slot | None:
        if period_end is None:
            return None
        return {
            "company_id": filing["company_id"], "filing_kind": "annual_report", "statement": fact["statement"],
            "basis": fact["basis"], "period_end": period_end, "span": fact["span"],
        }

    if filing["source"] == "pdf":
        return slot(fact["period_end"] if fact["period_end"] is not None else fact["as_of_date"])
    if fact["span"] == "year":
        return slot(fact["period_end"])
    if fact["span"] is None and fact["as_of_date"] is not None and fact["as_of_date"] == filing["period_end"]:
        return slot(fact["as_of_date"])
    return None


_IDENTITY_CODES = ("cin", "bse_code", "nse_symbol", "isin")


def _could_match(pdf: PdfNumbersInput, x: XbrlDocInput) -> bool:
    """Rule 2: an XBRL document that may yet turn out to be this PDF's company and period. Codes match exactly."""
    company = x["company_id"] == pdf["company_id"] or (
        x["company_id"] is None
        and (
            all(x["identity"][k] is None for k in _IDENTITY_CODES)
            or any(x["identity"][k] is not None and x["identity"][k] == pdf["company_identity"][k] for k in _IDENTITY_CODES)
        )
    )
    return company and (x["period_end"] is None or x["period_end"] == pdf["period_end"])


def _coverable(p: StatementBasis) -> bool:
    return p["basis"] != "unknown"


def _same_pair(a: StatementBasis, b: StatementBasis) -> bool:
    return a["statement"] == b["statement"] and a["basis"] == b["basis"]


def _settled_of_same_filing(pdf: PdfNumbersInput, xbrl: list[XbrlDocInput]) -> list[XbrlDocInput]:
    return [
        x for x in xbrl
        if x["state"] == "settled" and x["company_id"] == pdf["company_id"]
        and pdf["period_end"] is not None and x["period_end"] == pdf["period_end"]
    ]


def _is_covered(p: StatementBasis, by: list[XbrlDocInput]) -> bool:
    return _coverable(p) and any(_coverable(c) and _same_pair(c, p) for x in by for c in x["coverage"])


def covering_xbrl(pdf: PdfNumbersInput, xbrl: list[XbrlDocInput]) -> list[str]:
    """Rule 4 alone: the ids, in input order, of the settled XBRL documents of the PDF's company and period whose
    coverage holds at least one of the PDF's statement pairs (basis `unknown` never matches). A None period end
    matches nothing. Unsettled and held documents are ignored."""
    return [
        x["document_id"] for x in _settled_of_same_filing(pdf, xbrl)
        if any(_is_covered(p, [x]) for p in pdf["statements_found"])
    ]


def plan_pdf_numbers(pdf: PdfNumbersInput, xbrl: list[XbrlDocInput]) -> PdfNumbersPlan:
    """Whether a PDF's numbers are read, skipped because XBRL covers them, or held for XBRL that could match.
    The rules are those of `planPdfNumbers`, in the same order."""
    if pdf["kind"] == "annual_report" or pdf["period_end"] is None:
        return {"action": "read", "covered_by": [], "uncovered": list(pdf["statements_found"])}
    waiting_on = [x["document_id"] for x in xbrl if x["state"] != "settled" and _could_match(pdf, x)]
    if waiting_on:
        return {"action": "wait", "waiting_on": waiting_on}
    settled = _settled_of_same_filing(pdf, xbrl)
    uncovered = [p for p in pdf["statements_found"] if not _is_covered(p, settled)]
    covered_by = covering_xbrl(pdf, xbrl)
    if pdf["statements_found"] and not uncovered:
        return {"action": "skip", "covered_by": covered_by}
    return {"action": "read", "covered_by": covered_by, "uncovered": uncovered}
