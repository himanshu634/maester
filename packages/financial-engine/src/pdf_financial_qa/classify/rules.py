"""Deterministic rules that work out what a filing is from its text layer.

Every hit records the rule, the page and the line it matched, so each answer can
show where it came from. Rules never guess: rules that disagree about the kind
leave it for the model.
"""

import re
from dataclasses import dataclass, field
from datetime import date

from pdf_financial_qa.workflow.values import parse_label_date

RULES_VERSION = "classify-rules-1"
TITLE_PAGES = 5
QUOTE_MAX = 300
READ_KINDS = ("annual_report", "financial_results")

_I = re.IGNORECASE
DATE = r"(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})"

CIN = re.compile(r"\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b")
BSE = re.compile(r"(?i:scrip\s+code|security\s+code|bse(?:\s+(?:scrip\s+)?code)?)\s*(?:no\.?)?\s*[:\-–]?\s*(\d{6})\b")
NSE = re.compile(r"(?i:nse\s+symbol|symbol|nse)\s*[:\-–]\s*([A-Z][A-Z0-9&\-]{1,19})\b")
COMPANY = re.compile(r"^\s*([A-Z][A-Za-z0-9&.,'()\- ]{1,80}?\s(?:Limited|LIMITED|Ltd\.?|LTD\.?))\s*$", re.MULTILINE)
NOT_A_COMPANY = re.compile(r"stock\s+exchange|\bbse\s+limited\b|depository|registrar|link\s+intime|kfin", _I)

# (value, rule_id, pattern). A value is a kind, or "other:<other_type>".
KIND_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    ("annual_report", "title.annual_report", re.compile(
        r"\b(?:integrated\s+)?annual\s+report(?:\s+and\s+accounts)?\s+(?:20\d{2}\s*[-–/]\s*(?:20)?\d{2}|fy\s*'?\d{2,4})", _I)),
    ("annual_report", "title.integrated_annual_report", re.compile(r"\bintegrated\s+annual\s+report\b", _I)),
    # The heading form only: a board-meeting letter that mentions "the financial results for the
    # quarter" in a sentence is not a results document.
    ("financial_results", "title.financial_results", re.compile(
        r"^\s*statement\s+of\s+(?:audited|unaudited|reviewed)?\s*(?:standalone|consolidated)?\s*"
        r"(?:and\s+(?:standalone|consolidated)\s+)?financial\s+results\s+for\s+the\s+"
        r"(?:quarter|half[\s-]year|six\s+months|nine\s+months|year|period)", _I | re.M)),
    ("financial_results", "title.regulation_33", re.compile(r"\bregulation\s+33\b", _I)),
    ("financial_results", "title.integrated_filing_financial", re.compile(r"\bintegrated\s+filing\s*\(?\s*financial", _I)),
    ("other:shareholding_pattern", "title.shareholding_pattern", re.compile(r"\bshareholding\s+pattern\b|\bregulation\s+31\b", _I)),
    ("other:shareholder_notice", "title.shareholder_notice", re.compile(
        r"\bnotice\s+is\s+hereby\s+given\b.{0,200}?\b(?:annual\s+general\s+meeting|extra[\s-]?ordinary\s+general\s+meeting|postal\s+ballot)",
        _I | re.DOTALL)),
    ("other:board_meeting", "title.board_meeting_intimation", re.compile(
        r"\bintimation\s+of\s+(?:the\s+)?board\s+meeting\b|\bregulation\s+29\b", _I)),
    ("other:board_meeting", "title.board_meeting_outcome", re.compile(r"\boutcome\s+of\s+(?:the\s+)?board\s+meeting\b", _I)),
    ("other:investor_presentation", "title.investor_presentation", re.compile(r"\binvestor\s+presentation\b", _I)),
    ("other:earnings_call", "title.earnings_call", re.compile(
        r"\btranscript\b.{0,80}?\b(?:earnings|conference)\s+call\b|\b(?:earnings|conference)\s+call\s+transcript\b", _I | re.DOTALL)),
    ("other:governance_filing", "title.governance_filing", re.compile(
        r"\bcorporate\s+governance\s+report\b|\bintegrated\s+filing\s*\(?\s*governance|\bregulation\s+27\b", _I)),
    ("other:announcement", "title.press_release", re.compile(r"\bpress\s+release\b", _I)),
    ("other:offer_document", "title.offer_document", re.compile(
        r"\b(?:draft\s+)?red\s+herring\s+prospectus\b|\bletter\s+of\s+offer\b|\bprospectus\b", _I)),
]

STATEMENT_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    ("balance_sheet", "statement.balance_sheet", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?(?:balance\s+sheet\s+as\s+at|statement\s+of\s+assets\s+and\s+liabilities)\b", _I | re.M)),
    ("income_statement", "statement.profit_and_loss", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?statement\s+of\s+profit\s+and\s+loss\b", _I | re.M)),
    ("cash_flow", "statement.cash_flow", re.compile(
        r"^\s*(?:(standalone|consolidated)\s+)?(?:statement\s+of\s+cash\s+flows?|cash\s+flow\s+statement)\s+for\s+the\b", _I | re.M)),
]
MAX_STATEMENT_PAGES = 6

SPAN = re.compile(
    rf"\b(quarter\s+and\s+(?:financial\s+)?year|quarter|half[\s-]year|six\s+months|nine\s+months|(?:financial\s+)?year)\s+ended\s+(?:on\s+)?({DATE})", _I)
SPAN_VALUES = {"quarter": "quarter", "half year": "half_year", "six months": "half_year",
               "nine months": "nine_months", "year": "full_year", "financial year": "full_year"}
AS_AT = re.compile(rf"\bas\s+at\s+({DATE})", _I)


@dataclass(frozen=True)
class Hit:
    field: str
    value: str
    rule_id: str
    page_index: int
    quote: str


@dataclass
class RuleAnswers:
    kind: str | None = None
    kind_conflict: bool = False
    other_type: str | None = None
    results_span: str | None = None
    period_label: str | None = None
    period_end: date | None = None
    company_name: str | None = None
    cin: str | None = None
    bse_code: str | None = None
    nse_symbol: str | None = None
    statements: dict[tuple[str, str], list[int]] = field(default_factory=dict)
    evidence: list[Hit] = field(default_factory=list)

    @property
    def pointed_pages(self) -> list[int]:
        return sorted({h.page_index for h in self.evidence})


def normalise(text: str) -> str:
    """Whitespace-collapsed, case-folded text, for comparing a quote with its page."""
    return " ".join(text.split()).casefold()


def _quote(text: str, match: re.Match[str]) -> str:
    """The line the match sits on, whitespace collapsed; the match alone if the line is too long."""
    start = text.rfind("\n", 0, match.start()) + 1
    end = text.find("\n", match.end())
    line = " ".join(text[start:end if end != -1 else len(text)].split())
    if len(line) > QUOTE_MAX:
        line = " ".join(match.group(0).split())[:QUOTE_MAX]
    return line


def _basis(match: re.Match[str], page: str) -> str:
    word = (match.group(1) or "").lower() if match.lastindex else ""
    if word:
        return word
    lowered = page.lower()
    has_standalone, has_consolidated = "standalone" in lowered, "consolidated" in lowered
    if has_standalone != has_consolidated:
        return "standalone" if has_standalone else "consolidated"
    return "unknown"


def _span_value(words: str) -> str:
    key = re.sub(r"[\s-]+", " ", words.lower()).strip()
    if key.startswith("quarter and"):
        return "full_year"
    return SPAN_VALUES[key]


def _label(text: str) -> str:
    text = " ".join(text.split())
    return text[:1].upper() + text[1:]


def _identifiers(pages: list[str], a: RuleAnswers) -> None:
    for attr, rule_id, pattern in (("cin", "identifier.cin", CIN), ("bse_code", "identifier.bse", BSE),
                                   ("nse_symbol", "identifier.nse", NSE)):
        for index, page in enumerate(pages):
            match = pattern.search(page)
            if match:
                setattr(a, attr, match.group(1))
                a.evidence.append(Hit("identifier", match.group(1), rule_id, index, _quote(page, match)))
                break


def _company(pages: list[str], a: RuleAnswers) -> None:
    title = pages[:TITLE_PAGES]
    cin_pages = [h.page_index for h in a.evidence if h.rule_id == "identifier.cin" and h.page_index < TITLE_PAGES]
    order = cin_pages + [i for i in range(len(title)) if i not in cin_pages]
    for index in order:
        for match in COMPANY.finditer(title[index]):
            name = " ".join(match.group(1).split())
            if NOT_A_COMPANY.search(name):
                continue
            a.company_name = name
            a.evidence.append(Hit("company", name, "company.cover_line", index, _quote(title[index], match)))
            return


def _statements(pages: list[str], a: RuleAnswers) -> None:
    first_hit: dict[tuple[str, str], Hit] = {}
    for index, page in enumerate(pages):
        for statement, rule_id, pattern in STATEMENT_RULES:
            for match in pattern.finditer(page):
                key = (statement, _basis(match, page))
                found = a.statements.setdefault(key, [])
                if index not in found and len(found) < MAX_STATEMENT_PAGES:
                    found.append(index)
                first_hit.setdefault(key, Hit("statements", f"{key[0]}:{key[1]}", rule_id, index, _quote(page, match)))
    a.evidence.extend(first_hit.values())


def _kind(pages: list[str], a: RuleAnswers) -> list[Hit]:
    hits: list[Hit] = []
    for index, page in enumerate(pages[:TITLE_PAGES]):
        for value, rule_id, pattern in KIND_RULES:
            match = pattern.search(page)
            if match:
                hits.append(Hit("kind", value, rule_id, index, _quote(page, match)))
                if value == "financial_results" and rule_id == "title.financial_results":
                    key = ("income_statement", _basis(match, page))
                    if index not in a.statements.setdefault(key, []):
                        a.statements[key].append(index)
    return hits


def _resolve_kind(hits: list[Hit], a: RuleAnswers) -> None:
    chosen: str | None = None
    if a.statements:
        read = {h.value for h in hits if h.value in READ_KINDS}
        if len(read) == 1:
            chosen = read.pop()
        else:
            a.kind_conflict = True
    elif hits:
        first_page = min(h.page_index for h in hits)
        on_first = {h.value for h in hits if h.page_index == first_page}
        if len(on_first) == 1:
            chosen = on_first.pop()
        else:
            a.kind_conflict = True
    if chosen is None:
        return
    support = next(h for h in hits if h.value == chosen)
    if chosen.startswith("other:"):
        a.kind, a.other_type = "other", chosen.split(":", 1)[1]
        a.evidence.append(Hit("kind", "other", support.rule_id, support.page_index, support.quote))
        a.evidence.append(Hit("other_type", a.other_type, support.rule_id, support.page_index, support.quote))
    else:
        a.kind = chosen
        a.evidence.append(Hit("kind", chosen, support.rule_id, support.page_index, support.quote))


def _period(pages: list[str], a: RuleAnswers) -> None:
    if a.kind not in READ_KINDS:
        return
    scope = pages[:TITLE_PAGES] if a.kind == "financial_results" else pages
    matches = [(index, m) for index, page in enumerate(scope) for m in SPAN.finditer(page)]
    if a.kind == "annual_report":
        matches = [(i, m) for i, m in matches if _span_value(m.group(1)) == "full_year"]
    else:
        full = [(i, m) for i, m in matches if m.group(1).lower().startswith("quarter and")]
        matches = full or matches
    if matches:
        index, match = matches[0]
        label = _label(f"{match.group(1)} ended {match.group(2)}")
        a.period_label, a.period_end = label, parse_label_date(label)
        a.evidence.append(Hit("period", label, "period.span", index, _quote(scope[index], match)))
        if a.kind == "financial_results":
            a.results_span = _span_value(match.group(1))
            a.evidence.append(Hit("results_span", a.results_span, "period.span", index, _quote(scope[index], match)))
        return
    for index, page in enumerate(pages):
        match = AS_AT.search(page)
        if match:
            label = _label(f"as at {match.group(1)}")
            a.period_label, a.period_end = label, parse_label_date(label)
            a.evidence.append(Hit("period", label, "period.as_at", index, _quote(page, match)))
            return


def classify_text(page_texts: list[str]) -> RuleAnswers:
    """Answer what the rules can from the page texts; leave the rest open."""
    a = RuleAnswers()
    _identifiers(page_texts, a)
    _company(page_texts, a)
    _statements(page_texts, a)
    _resolve_kind(_kind(page_texts, a), a)
    _period(page_texts, a)
    return a
