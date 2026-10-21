"""Scoring a ranker against the retrieval set, and the rule that picks the embedding model.

`maester-eval retrieval request` writes the questions; the worker's `eval rank` ranks the chunks of each candidate model
and writes page references with no text (`EvalRankingsModel`). Here a question is scored on those references alone.

- An answering page is any `(filing, page)` among the question's `answers`, whichever of its company's filings it is in.
- Recall@k is the share of questions with an answering page among the pages of the top k chunks, and the reciprocal rank
  is `1/r` for the first chunk on an answering page, 0 when none is in the list. k counts chunks, as the product's
  `limit` does, so a page that two chunks come from takes two places.
- Every ratio is a `Fraction` of whole numbers. Seconds are measurements, read as `Decimal(str(x))`.

The rule that chooses the model is departure 7 of the plan: the current model wins a tie, and a challenger replaces it
only by more than one question of the verified set.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from fractions import Fraction
from typing import Literal, get_args

from maester_eval.errors import EvalError
from maester_eval.eval_wire import EvalBenchModel, EvalRankingsModel, EvalVersionsModel
from maester_eval.retrieval import RetrievalQuestion

Method = Literal["vector", "keyword", "hybrid"]
PageSource = Literal["text_layer", "ocr", "mixed"]
Stratum = Literal["all", "text_layer", "ocr", "mixed"]
Reason = Literal["best_recall", "tie_broken_by_cpu_time", "tie_kept_current"]
METHODS: tuple[Method, ...] = get_args(Method)
STRATA: tuple[Stratum, ...] = get_args(Stratum)
# Departure 4: granite is measured only when the chosen challenger takes more than an hour to embed a 300-page report.
GRANITE_CHUNKS = 1500
GRANITE_SECONDS = Decimal(3600)


class RetrievalScoreError(EvalError):
    """A ranking cannot be scored: an answering page has no text, a question was not ranked, or the models differ in
    what they read. The text names a question id, a filing, a model or a count, never a query."""


class IncompleteIndexError(RetrievalScoreError):
    """A filing has no current revision for the model, or the model ranked nothing. Such a filing is never counted as
    "not retrieved": the model is not scored."""


@dataclass(frozen=True)
class Metrics:
    n: int
    recall_at_5: Fraction
    recall_at_10: Fraction
    mrr: Fraction


@dataclass(frozen=True)
class ModelScore:
    """A model's metrics by method and by the source of the answering pages. A stratum with no question is absent, not zero.

    `first_ranks` is the place of the first answering chunk per question and method (None: not in the list), for the
    report's appendix. `versions` are the distinct reader versions the model's documents were indexed with."""

    model: str
    by_method: dict[Method, dict[Stratum, Metrics]]
    first_ranks: dict[str, dict[str, int | None]]
    versions: tuple[EvalVersionsModel, ...] = field(default=())


@dataclass(frozen=True)
class ModelChoice:
    model: str
    reason: Reason
    band: Fraction


# ---- scoring

def question_source(question: RetrievalQuestion, rankings: EvalRankingsModel) -> PageSource:
    """The source of the answering pages when they all agree, otherwise `mixed`. Each answer is looked up in its own filing."""
    documents = {document.filing: document for document in rankings.documents}
    sources: set[str] = set()
    for filing, page in question.answers:
        document = documents.get(filing)
        if document is None:
            raise RetrievalScoreError(f"{question.id}: {filing} is not in the rankings")
        source = next((p.source for p in document.pages if p.page == page), "none")
        if source == "none":
            raise RetrievalScoreError(f"{question.id}: page {page} of {filing} has no text")
        sources.add(source)
    return sources.pop() if len(sources) == 1 else "mixed"  # type: ignore[return-value]


def _first_rank(ranking: Sequence[object], answers: set[tuple[str, int]]) -> int | None:
    for place, reference in enumerate(ranking, start=1):
        if (reference.filing, reference.page) in answers:  # type: ignore[attr-defined]
            return place
    return None


def _metrics(ranks: Sequence[int | None]) -> Metrics:
    n = len(ranks)
    return Metrics(
        n=n,
        recall_at_5=Fraction(sum(1 for r in ranks if r is not None and r <= 5), n),
        recall_at_10=Fraction(sum(1 for r in ranks if r is not None and r <= 10), n),
        mrr=sum((Fraction(1, r) for r in ranks if r is not None), Fraction(0)) / n,
    )


def score_model(questions: Sequence[RetrievalQuestion], rankings: EvalRankingsModel) -> ModelScore:
    """Recall@5, recall@10 and MRR for each method, over all questions and over each source of the answering pages.

    Every document of the rankings is in scope (they are the request's corpus), so a document with no current revision,
    a model that ranked nothing, a question with no ranking or a ranking of a question outside the set refuses the model."""
    model = rankings.model
    unrevised = [document.filing for document in rankings.documents if document.revision_id is None]
    if unrevised:
        raise IncompleteIndexError(f"{model}: no current revision for {', '.join(unrevised)}")
    if not rankings.rankings:
        raise IncompleteIndexError(f"{model}: no rankings")
    by_id = {ranking.question_id: ranking for ranking in rankings.rankings}
    if len(by_id) != len(rankings.rankings):
        raise RetrievalScoreError(f"{model}: a question is ranked twice")
    ids = {question.id for question in questions}
    outside = sorted(set(by_id) - ids)
    if outside:
        raise RetrievalScoreError(f"{model}: {', '.join(outside)} is not a question of the set")
    unranked = [question.id for question in questions if question.id not in by_id]
    if unranked:
        raise RetrievalScoreError(f"{model}: {', '.join(unranked)}: no ranking")

    first_ranks: dict[str, dict[str, int | None]] = {}
    sources: dict[str, PageSource] = {}
    for question in questions:
        sources[question.id] = question_source(question, rankings)
        answers = set(question.answers)
        ranking = by_id[question.id]
        first_ranks[question.id] = {method: _first_rank(getattr(ranking, method), answers) for method in METHODS}

    by_method: dict[Method, dict[Stratum, Metrics]] = {}
    for method in METHODS:
        strata: dict[Stratum, Metrics] = {}
        for stratum in STRATA:
            ranks = [first_ranks[q.id][method] for q in questions if stratum == "all" or sources[q.id] == stratum]
            if ranks:
                strata[stratum] = _metrics(ranks)
        by_method[method] = strata
    versions: list[EvalVersionsModel] = []
    for document in rankings.documents:
        if document.versions is not None and document.versions not in versions:
            versions.append(document.versions)
    return ModelScore(model=model, by_method=by_method, first_ranks=first_ranks, versions=tuple(versions))


def check_same_reads(rankings_by_model: Mapping[str, EvalRankingsModel]) -> None:
    """Refuse models that read a filing differently: another reader version or another source on a page.

    A re-read with another OCR budget or reader default would compare the models on different text. The chunk counts
    are not compared: each model's indexer holds its own tokenizer, so they differ with no difference in what was read."""
    runs = list(rankings_by_model.values())
    filings = list(dict.fromkeys(document.filing for run in runs for document in run.documents))
    for filing in filings:
        found = [next((d for d in run.documents if d.filing == filing), None) for run in runs]
        versions = [None if d is None else d.versions for d in found]
        if any(v != versions[0] for v in versions):
            raise RetrievalScoreError(f"{filing}: the models read it differently (versions)")
        pages = [None if d is None else sorted((p.page, p.source) for p in d.pages) for d in found]
        if any(p != pages[0] for p in pages):
            raise RetrievalScoreError(f"{filing}: the models read it differently (pages)")


# ---- the model rule

def seconds_per_1000(bench: EvalBenchModel) -> Decimal:
    """Seconds to embed 1,000 chunks: the bench's seconds, read as a decimal, over its chunks."""
    if bench.chunks == 0:
        raise RetrievalScoreError(f"{bench.model}: the bench embedded no chunks")
    return Decimal(str(bench.seconds)) * 1000 / bench.chunks


def _hybrid_recall(score: ModelScore) -> Metrics:
    found = score.by_method.get("hybrid", {}).get("all")
    if found is None:
        raise RetrievalScoreError(f"{score.model}: no hybrid score over all questions")
    return found


def choose_model(scores: Sequence[ModelScore], benches: Mapping[str, EvalBenchModel], current: str) -> ModelChoice:
    """Departure 7. The band is one question of the verified set. The models within the band of the best hybrid
    recall@10 are tied, and a model exactly one question behind is tied.

    1. One tied model wins on recall.
    2. Otherwise the current model is kept when it is tied, whatever its CPU time.
    3. Otherwise (the current model is outside the band) the tied challenger with the lowest seconds per 1,000 chunks wins;
       equal times go to the model listed first."""
    if not scores:
        raise RetrievalScoreError("no model was scored")
    if current not in {score.model for score in scores}:
        raise RetrievalScoreError(f"the current model {current} is not among the scored models")
    counts = {_hybrid_recall(score).n for score in scores}
    if len(counts) != 1:
        raise RetrievalScoreError("the models were scored over different numbers of questions")
    band = Fraction(1, counts.pop())
    best = max(_hybrid_recall(score).recall_at_10 for score in scores)
    tied = [score.model for score in scores if best - _hybrid_recall(score).recall_at_10 <= band]
    if len(tied) == 1:
        return ModelChoice(tied[0], "best_recall", band)
    if current in tied:
        return ModelChoice(current, "tie_kept_current", band)
    for model in tied:
        if model not in benches:
            raise RetrievalScoreError(f"{model}: no bench")
    fastest = min(tied, key=lambda model: seconds_per_1000(benches[model]))  # min keeps the first of equal times
    return ModelChoice(fastest, "tie_broken_by_cpu_time", band)


def needs_granite(choice: ModelChoice, benches: Mapping[str, EvalBenchModel], current: str) -> bool:
    """Departure 4. Granite is measured only when the rule chose a challenger that takes more than an hour to embed 1,500
    chunks. A kept current model never needs it, whatever its CPU time: granite could not replace it."""
    if choice.model == current:
        return False
    if choice.model not in benches:
        raise RetrievalScoreError(f"{choice.model}: no bench")
    return seconds_per_1000(benches[choice.model]) * GRANITE_CHUNKS / 1000 > GRANITE_SECONDS
