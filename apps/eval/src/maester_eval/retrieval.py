"""The retrieval set: questions a person wrote about filings, the pages that answer them, and the request the ranker reads.

`data/eval/retrieval/corpus.json` names the companies whose `dev` filings are searched. `questions.csv` holds the
questions, one row each, with the pages that answer it. A question is searched within the filings of its company, so an
answer may sit in any of them: text every year prints (the CIN, the auditor's report, a policy) counts wherever it is
found. Filings a baseline leaves out as out of scope stay in the corpus as hard negatives.

The text of a question is a person's own words about a filing. It goes into the sheet and the request and nowhere else:
the messages here name a sheet row, an id, a filing or a count, never a query.
"""

import csv
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from maester_eval.errors import EvalError
from maester_eval.eval_wire import EvalRequestModel, RequestQuestion, document_refs
from maester_eval.files import read_model
from maester_eval.manifest import Filing, Manifest, missing_files
from maester_eval.text import normalise

MIN_VERIFIED = 40
# What the request's `query` allows (`RequestQuestion`, and the Zod twin, which counts UTF-16 code units).
_MAX_QUERY = 500
_COLUMNS = ("id", "filing", "query", "pages", "status")
_QUESTION_ID = re.compile(r"q[0-9]{3}")
# `[0-9]` and not `\d`, which also takes the digits of other scripts. A spreadsheet writes 12 as `12.0`.
_PAGE = re.compile(r"[0-9]+(\.0+)?")
Status = Literal["draft", "verified"]
_STATUSES: tuple[Status, ...] = ("draft", "verified")


class RetrievalSetError(EvalError):
    """The sheet, the corpus or the request is wrong. The text names a row, an id, a filing or a count, never a query."""


@dataclass(frozen=True)
class RetrievalQuestion:
    """One row of the sheet.

    `filing` is the filing the question was drafted from. `answers` is the set of `(filing, page)` pairs that answer it,
    sorted and without repeats, and pages count from 1."""

    id: str
    filing: str
    query: str
    answers: tuple[tuple[str, int], ...]
    status: Status


class RetrievalCorpus(BaseModel):
    """`corpus.json`: every `dev` filing of these companies, by the name the manifest gives them, is searched."""

    model_config = ConfigDict(extra="forbid")

    companies: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=1)]


# ---- the sheet

def read_questions(path: Path) -> list[RetrievalQuestion]:
    """The sheet's questions in row order. It reads `utf-8-sig`, so a BOM a spreadsheet wrote is not part of a column's name.

    `pages` is entries separated by `;`. An entry is a whole number (`12` or `12.0`), a page of the row's own `filing`, or
    `<filing id>:<page>`, a page of another filing, split on the last `:` because a filing id holds dashes and a slash.
    A bare page is resolved to the row's filing before the answers are sorted, so `12; <own filing>:12` is one answer.

    A row is refused, by its row number in the sheet (the header is row 1), for a bad id, a duplicate id, a blank filing
    or query, a query over 500 characters, an unknown status, or `pages` that are empty, hold a page below 1, or hold
    anything but whole pages, such as the `12-13` a spreadsheet may read as a date. A row with nothing in it is left out."""
    try:
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            absent = [column for column in _COLUMNS if column not in (reader.fieldnames or ())]
            if absent:
                raise RetrievalSetError(f"the sheet has no {', '.join(repr(column) for column in absent)} column; "
                                        "was it saved with a different delimiter?")
            questions: list[RetrievalQuestion] = []
            seen: set[str] = set()
            for offset, record in enumerate(reader):
                cells = {key: (value or "").strip() for key, value in record.items() if key is not None}
                if not any(cells.values()):
                    continue
                question = _question(cells, offset + 2)
                if question.id in seen:
                    raise RetrievalSetError(f"sheet row {offset + 2}: duplicate id {question.id}")
                seen.add(question.id)
                questions.append(question)
            return questions
    except UnicodeDecodeError:
        raise RetrievalSetError(f"{path.name} is not UTF-8 text; save it as CSV UTF-8") from None


def _question(cells: dict[str, str], line: int) -> RetrievalQuestion:
    question_id = cells["id"]
    if not _QUESTION_ID.fullmatch(question_id):
        raise RetrievalSetError(f"sheet row {line}: id {question_id!r} is not q and three digits, such as q007")
    filing = cells["filing"]
    if not filing:
        raise RetrievalSetError(f"sheet row {line}: filing is blank")
    query = cells["query"]
    if not query:
        raise RetrievalSetError(f"sheet row {line}: query is blank")
    if len(query.encode("utf-16-le")) // 2 > _MAX_QUERY:
        raise RetrievalSetError(f"sheet row {line}: query is over {_MAX_QUERY} characters")
    status = cells["status"].lower()
    if status not in _STATUSES:
        raise RetrievalSetError(f"sheet row {line}: status {cells['status']!r} is not draft or verified")
    return RetrievalQuestion(id=question_id, filing=filing, query=query, answers=_answers(cells["pages"], filing, line),
                             status=status)  # type: ignore[arg-type]


def _answers(pages: str, own_filing: str, line: int) -> tuple[tuple[str, int], ...]:
    if not pages:
        raise RetrievalSetError(f"sheet row {line}: pages is blank")
    answers: set[tuple[str, int]] = set()
    for entry in (part.strip() for part in pages.split(";")):
        if not entry:
            raise RetrievalSetError(f"sheet row {line}: pages has an empty entry")
        filing_part, colon, page_part = entry.rpartition(":")
        filing = filing_part.strip() if colon else own_filing
        page_part = page_part.strip()
        if colon and not filing:
            raise RetrievalSetError(f"sheet row {line}: pages {entry!r} has no filing before the colon")
        # The page part alone is read: a filing id holds dashes, a page range such as 12-13 must still be refused.
        if not _PAGE.fullmatch(page_part):
            raise RetrievalSetError(f"sheet row {line}: pages {entry!r} is not a whole page number")
        page = int(page_part.partition(".")[0])
        if page < 1:
            raise RetrievalSetError(f"sheet row {line}: pages {entry!r} is below page 1")
        answers.add((filing, page))
    return tuple(sorted(answers))


# ---- the corpus

def read_corpus(path: Path) -> RetrievalCorpus:
    """`corpus.json`. A file that does not exist is a `FileNotFoundError`."""
    return read_model(path, RetrievalCorpus, RetrievalSetError, "retrieval corpus")


def corpus_filings(corpus: RetrievalCorpus, manifest: Manifest) -> list[Filing]:
    """The `dev` filings of the corpus companies, in manifest order, the out-of-scope ones included.

    `Manifest.select("dev")` is not used: it drops the filings a baseline leaves out, and those stay here as hard
    negatives. A company is told by its name with case and punctuation ignored, as the manifest tells them. A company
    that is not in the manifest, or has no `dev` filing, is a `RetrievalSetError`."""
    wanted = {normalise(name) for name in corpus.companies}
    for name in corpus.companies:
        filings = [f for f in manifest.filings if normalise(f.company) == normalise(name)]
        if not filings:
            raise RetrievalSetError(f"{name} is not in the manifest")
        if not any(f.set == "dev" for f in filings):
            raise RetrievalSetError(f"{name} has no dev filing")
    return [f for f in manifest.filings if f.set == "dev" and normalise(f.company) in wanted]


def _scope(question: RetrievalQuestion, filings: list[Filing]) -> list[str]:
    """The ids of the corpus filings of the question's company, in manifest order."""
    own = next((f for f in filings if f.id == question.filing), None)
    if own is None:
        raise RetrievalSetError(f"{question.id}: {question.filing} is not in the retrieval corpus")
    company = normalise(own.company)
    return [f.id for f in filings if normalise(f.company) == company]


def check_set(questions: list[RetrievalQuestion], corpus: RetrievalCorpus, manifest: Manifest) -> None:
    """Refuse a set the ranker cannot be scored on.

    Every question's filing is in the corpus, and every answer is a page of a corpus filing of that question's company.
    At least 40 questions are `verified`: the drafts are not asked."""
    filings = corpus_filings(corpus, manifest)
    for question in questions:
        scope = set(_scope(question, filings))
        for filing, page in question.answers:
            if filing not in scope:
                raise RetrievalSetError(f"{question.id}: answer {filing}:{page} is not in its company's filings")
    count = sum(1 for question in questions if question.status == "verified")
    if count < MIN_VERIFIED:
        raise RetrievalSetError(f"{count} verified questions; the set needs at least {MIN_VERIFIED}")


def build_request(questions: list[RetrievalQuestion], corpus: RetrievalCorpus, manifest: Manifest,
                  corpus_dir: Path) -> EvalRequestModel:
    """What the ranker reads: every corpus filing with the sha256 of its PDF under `corpus_dir`, and the verified questions
    in sheet order, each scoped to the corpus filings of its company. A PDF the corpus lacks is a `RetrievalSetError`
    that names it."""
    filings = corpus_filings(corpus, manifest)
    absent = missing_files(filings, corpus_dir)
    if absent:
        raise RetrievalSetError(f"missing under {corpus_dir}: " + ", ".join(absent))
    asked = [RequestQuestion(id=q.id, query=q.query, scope=_scope(q, filings)) for q in questions if q.status == "verified"]
    return EvalRequestModel(version=1, documents=document_refs(filings, corpus_dir), questions=asked)
