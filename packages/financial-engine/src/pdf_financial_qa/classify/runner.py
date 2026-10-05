"""Work out what a filing is: rules first, the model only for what they leave open.

A model answer is kept only when its value is allowed, its page is one it was
shown and its quote appears in that page's text layer (or the page has none).
"""

import time
from collections.abc import Callable
from dataclasses import dataclass

from pdf_financial_qa.classify import rules
from pdf_financial_qa.classify.contracts import ClassificationResult, Evidence, StatementFound
from pdf_financial_qa.classify.model import Answer, ClassificationModel, ClassifyOutput, Question
from pdf_financial_qa.classify.prompts import PROMPT_VERSION
from pdf_financial_qa.workflow.contracts import ExtractionWarning
from pdf_financial_qa.workflow.errors import ExtractionError, is_transient
from pdf_financial_qa.workflow.pdf import PdfDocument
from pdf_financial_qa.workflow.values import parse_label_date

MAX_MODEL_PAGES = 10
KINDS = ["annual_report", "financial_results", "other"]
OTHER_TYPES = ["shareholding_pattern", "shareholder_notice", "board_meeting", "investor_presentation",
               "earnings_call", "governance_filing", "announcement", "offer_document", "unlisted_type"]
SPANS = ["quarter", "half_year", "nine_months", "full_year"]

ModelFactory = Callable[[], ClassificationModel]


@dataclass(frozen=True)
class ClassifySettings:
    retry_interval: float = 1.0


def _questions(a: rules.RuleAnswers) -> list[Question]:
    questions = []
    if a.kind is None:
        questions.append(Question(field="kind", allowed=KINDS))
    if a.kind in (None, "other") and a.other_type is None:
        questions.append(Question(field="other_type", allowed=OTHER_TYPES))
    if a.company_name is None:
        questions.append(Question(field="company"))
    if a.kind in (None, *rules.READ_KINDS) and a.period_label is None:
        questions.append(Question(field="period"))
    if a.kind in (None, "financial_results") and a.results_span is None:
        questions.append(Question(field="results_span", allowed=SPANS))
    return questions


def _checked(answer: Answer, pages: list[int], texts: list[str]) -> tuple[int, str, bool | None] | None:
    if not 1 <= answer.page <= len(pages):
        return None
    index = pages[answer.page - 1]
    quote = " ".join(answer.quote.split())[:rules.QUOTE_MAX]
    if not quote:
        return None
    if not texts[index].strip():
        return index, quote, None
    if rules.normalise(quote) not in rules.normalise(texts[index]):
        return None
    return index, quote, True


def _apply(a: rules.RuleAnswers, output: ClassifyOutput, asked: list[Question], pages: list[int],
           texts: list[str]) -> tuple[list[Evidence], int]:
    allowed = {q.field: q.allowed for q in asked}
    kept: list[Evidence] = []
    settled: set[str] = set()
    dropped = 0
    for answer in output.answers:
        if answer.field not in allowed or answer.field in settled:
            dropped += 1  # not asked, or already answered: the first valid answer wins
            continue
        value = " ".join(answer.value.split())
        checked = _checked(answer, pages, texts)
        options = allowed[answer.field]
        valid = bool(value) and (options is None or value in options)
        if answer.field in ("company", "period") and checked:
            valid = valid and rules.normalise(value) in rules.normalise(checked[1])
        if not (checked and valid):
            dropped += 1
            continue
        index, quote, match = checked
        settled.add(answer.field)
        if answer.field == "kind":
            a.kind = value
        elif answer.field == "other_type":
            a.other_type = value
        elif answer.field == "company":
            a.company_name = value
        elif answer.field == "period":
            a.period_label, a.period_end = value, parse_label_date(value)
        else:
            a.results_span = value
        kept.append(Evidence(field=answer.field, source="model", rule_id=None, page_index=index, quote=quote,
                             text_layer_match=match))
    return kept, dropped


def _call(model: ClassificationModel, pdf: bytes, page_count: int, questions: list[Question],
          settings: ClassifySettings) -> ClassifyOutput:
    try:
        return model.classify(pdf, page_count, questions)
    except Exception as exc:
        if not is_transient(exc):
            raise
        time.sleep(settings.retry_interval)
        return model.classify(pdf, page_count, questions)


def _reason(exc: Exception) -> str:
    return exc.code if isinstance(exc, ExtractionError) else type(exc).__name__


def run_classification(pdf: bytes, *, model_factory: ModelFactory | None,
                       settings: ClassifySettings = ClassifySettings()) -> ClassificationResult:
    doc = PdfDocument.load(pdf)  # UNREADABLE_PDF is a permanent ExtractionError
    a = rules.classify_text(doc.page_texts)
    questions = _questions(a)
    warnings: list[ExtractionWarning] = []
    model_evidence: list[Evidence] = []
    model_name = prompt_version = None
    if questions and model_factory is None:
        warnings.append(ExtractionWarning(code="MODEL_UNAVAILABLE",
                                          message="no model is configured; answers the rules could not settle are left open"))
    elif questions:
        pages = sorted(set(range(min(rules.TITLE_PAGES, doc.page_count))) | set(a.pointed_pages))[:MAX_MODEL_PAGES]
        try:
            model = model_factory()
            name = model.name
            output = _call(model, doc.subset(pages), len(pages), questions, settings)
        except Exception as exc:  # a model problem never fails classification
            warnings.append(ExtractionWarning(code="MODEL_UNAVAILABLE", message=f"the model could not be used: {_reason(exc)}"))
        else:
            model_name, prompt_version = name, PROMPT_VERSION
            model_evidence, dropped = _apply(a, output, questions, pages, doc.page_texts)
            if dropped:
                warnings.append(ExtractionWarning(
                    code="MODEL_ANSWER_DROPPED",
                    message=f"{dropped} answer(s) could not be checked against the document and were left open"))

    kind = a.kind or "not_sure"
    other_type = (a.other_type or "unlisted_type") if kind == "other" else None
    read = kind in rules.READ_KINDS
    evidence = [Evidence(field=h.field, source="rule", rule_id=h.rule_id, page_index=h.page_index, quote=h.quote,
                         text_layer_match=True) for h in a.evidence] + model_evidence
    if not read:
        evidence = [e for e in evidence if e.field not in ("period", "results_span")]
    if kind != "other":
        evidence = [e for e in evidence if e.field != "other_type"]
    if kind != "financial_results":
        evidence = [e for e in evidence if e.field != "results_span"]
    return ClassificationResult(
        rules_version=rules.RULES_VERSION, model=model_name, prompt_version=prompt_version, page_count=doc.page_count,
        kind=kind, other_type=other_type,
        results_span=a.results_span if kind == "financial_results" else None,
        period_end=a.period_end if read else None, period_label=a.period_label if read else None,
        company_name_as_printed=a.company_name, cin=a.cin, bse_code=a.bse_code, nse_symbol=a.nse_symbol,
        statements_found=[StatementFound(statement=s, basis=b, pages=p) for (s, b), p in sorted(a.statements.items())],
        evidence=evidence, warnings=warnings,
    )
