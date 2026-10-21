"""The retrieval run folder and the report that chooses the embedding model.

A run folder, `data/eval/retrieval/runs/<run>/`, holds `request.json` (`maester-eval retrieval request`) and, per model,
`<slug>.rankings.json`, `<slug>.bench.json` and `<slug>.parity.json`, where `<slug>` is the model id with `/` written
`--` (`Qwen--Qwen3-Embedding-0.6B`). `run.json` is written by hand:

    { "current": "<live model id>", "excluded": { "<id>": "<reason>" }, "memoryMiB": { "<id>": <peak> } }

`excluded` and `memoryMiB` may be empty. `current` is required: the model rule keeps the current model inside the band.
A model the file excludes needs no other file. The parity file is optional and shows as "—" when the check was not run.

The report names questions by id and never shows a query: the sheet and the request are git-ignored, the report is committed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal
from fractions import Fraction
import json
from pathlib import Path
from typing import Annotated, get_args

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from maester_eval.errors import EvalError
from maester_eval.eval_wire import EvalBenchModel, EvalParityModel, EvalRankingsModel, EvalRequestModel, EvalVersionsModel
from maester_eval.files import read_model
from maester_eval.manifest import FilingKind
from maester_eval.ocr import _table, format_rate
from maester_eval.paths import ROOT, to_utc
from maester_eval.retrieval import RetrievalQuestion
from maester_eval.retrieval_scoring import (GRANITE_CHUNKS, METHODS, STRATA, ModelChoice, ModelScore, PageSource,
                                            RetrievalScoreError, check_same_reads, score_model, seconds_per_1000)

LOCK_PATH = ROOT / "apps" / "indexer" / "models.lock.json"
_SOURCES: tuple[PageSource, ...] = ("text_layer", "ocr", "mixed")


class RetrievalReportError(EvalError):
    """The run folder cannot be reported on. The text names a file, a model, a filing or a question id, never a query."""


class RunJson(BaseModel):
    """`run.json`, written by hand."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    current: Annotated[str, Field(min_length=1)]
    excluded: dict[str, str] = {}
    memory_mib: dict[str, Annotated[Decimal, Field(ge=0)]] = Field(default={}, alias="memoryMiB")

    @model_validator(mode="after")
    def _current_is_measured(self) -> "RunJson":
        if self.current in self.excluded:
            raise ValueError("the current model is excluded")
        return self


@dataclass(frozen=True)
class RetrievalRun:
    """Everything the report needs from a run folder, with the models in the order of the lock."""

    run_json: RunJson
    scores: list[ModelScore]
    benches: dict[str, EvalBenchModel]
    parities: dict[str, EvalParityModel]


class _LockEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    revision: str


class _Lock(BaseModel):
    model_config = ConfigDict(extra="ignore")

    embedding: _LockEntry
    candidates: list[_LockEntry] = []


def slug(model: str) -> str:
    return model.replace("/", "--")


def read_lock_revisions(path: Path = LOCK_PATH) -> dict[str, str]:
    """Each embedding model's id and pinned revision in `models.lock.json`: the live model first, then the candidates."""
    lock = read_model(path, _Lock, RetrievalReportError, "models lock")
    return {entry.id: entry.revision for entry in [lock.embedding, *lock.candidates]}


def _read_run_json(run: Path) -> RunJson:
    """`run.json`. A refusal names the field and the rule, never the value: the file is written by hand but may name a path."""
    path = run / "run.json"
    try:
        return RunJson.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        raise RetrievalReportError(f"{run.name} has no run.json; write it by hand, with the current model") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise RetrievalReportError(f"{path} is not readable JSON") from None
    except ValidationError as error:
        why = "; ".join(f"{'.'.join(str(part) for part in issue['loc']) or 'the file'}: {issue['msg'].removeprefix('Value error, ')}"
                        for issue in error.errors())
        raise RetrievalReportError(f"{path} is not a readable run.json ({why})") from None


def _check_request(run: Path, questions: Sequence[RetrievalQuestion]) -> None:
    """The questions the rankings answer are the sheet's verified questions as they were asked: a sheet edited after the
    request would score answers against other text. Only ids are named."""
    try:
        request = read_model(run / "request.json", EvalRequestModel, RetrievalReportError, "request")
    except FileNotFoundError:
        raise RetrievalReportError(f"{run.name} has no request.json") from None
    asked = {question.id: question.query for question in request.questions}
    sheet = {question.id: question.query for question in questions}
    differ = sorted(set(asked) ^ set(sheet))
    if differ:
        raise RetrievalReportError(f"{', '.join(differ)}: the sheet and request.json hold different questions")
    edited = sorted(qid for qid in sheet if sheet[qid] != asked[qid])
    if edited:
        raise RetrievalReportError(f"{', '.join(edited)} was edited after the request")


def read_retrieval_run(run: Path, questions: Sequence[RetrievalQuestion], revisions: Mapping[str, str]) -> RetrievalRun:
    """Read, score and cross-check a run folder. `questions` are the sheet's verified questions and `revisions` the lock.

    Nothing is returned while any model that is not excluded fails: every such model's problem is named at once, with the
    filings, so that the run is fixed in one pass."""
    run_json = _read_run_json(run)
    _check_request(run, questions)
    excluded = {slug(model) for model in run_json.excluded}
    by_slug = {slug(model): model for model in revisions}
    files = sorted(path for path in run.glob("*.rankings.json") if path.name.removesuffix(".rankings.json") not in excluded)
    rankings: dict[str, EvalRankingsModel] = {}
    for path in files:
        name = path.name.removesuffix(".rankings.json")
        if name not in by_slug:
            raise RetrievalReportError(f"{name} is not in models.lock.json")
        model = by_slug[name]
        ranked = read_model(path, EvalRankingsModel, RetrievalReportError, "rankings file")
        if ranked.model != model:
            raise RetrievalReportError(f"{path.name} names another model")
        rankings[model] = ranked
    if not rankings:
        raise RetrievalReportError(f"{run.name} has no rankings of a model that is not excluded")
    ordered = [model for model in revisions if model in rankings]

    benches: dict[str, EvalBenchModel] = {}
    parities: dict[str, EvalParityModel] = {}
    for model in ordered:
        benches[model] = _read_sibling(run, model, "bench", EvalBenchModel, required=True)  # type: ignore[assignment]
        parity = _read_sibling(run, model, "parity", EvalParityModel, required=False)
        if parity is not None:
            parities[model] = parity  # type: ignore[assignment]

    problems: list[str] = []
    scores: list[ModelScore] = []
    for model in ordered:
        try:
            scores.append(score_model(questions, rankings[model]))
        except RetrievalScoreError as error:
            problems.append(str(error))
    if problems:
        raise RetrievalReportError("; ".join(problems))
    try:
        check_same_reads({model: rankings[model] for model in ordered})
    except RetrievalScoreError as error:
        raise RetrievalReportError(str(error)) from None
    return RetrievalRun(run_json, scores, benches, parities)


def _read_sibling(run: Path, model: str, kind: str, shape: type[BaseModel], required: bool) -> BaseModel | None:
    name = f"{slug(model)}.{kind}.json"
    try:
        found = read_model(run / name, shape, RetrievalReportError, f"{kind} file")
    except FileNotFoundError:
        if required:
            raise RetrievalReportError(f"{model}: no {name}") from None
        return None
    if found.model != model:  # type: ignore[attr-defined]
        raise RetrievalReportError(f"{name} names another model")
    return found


# ---- the report

def _decimal(value: Decimal, places: str = "0.1") -> str:
    return format(value.quantize(Decimal(places), rounding=ROUND_HALF_EVEN), "f")


def _ratio(value: Fraction) -> str:
    return format_rate(value.numerator, value.denominator)


def _reader(versions: Sequence[EvalVersionsModel]) -> str:
    if not versions:
        return "—"
    return " / ".join(f"index {v.index_version}, docling {v.docling_version}, OCR `{v.ocr_engine}`, "
                      f"`{v.reader_options}`, chunker {v.chunker_version}" for v in versions)


def _minutes(bench: EvalBenchModel) -> Decimal:
    return seconds_per_1000(bench) * GRANITE_CHUNKS / 1000 / 60


_REASONS = {
    "best_recall": "it has the best hybrid recall@10 and no other model is within the band",
    "tie_kept_current": "it is the current model and it is within the band of the best, so it is kept whatever its CPU time",
    "tie_broken_by_cpu_time": "the current model is outside the band, and of the models within it this one takes the "
                              "fewest seconds per 1,000 chunks",
}


def render_retrieval_report(run: str, questions: Sequence[RetrievalQuestion], scores: Sequence[ModelScore],
                            benches: Mapping[str, EvalBenchModel], parities: Mapping[str, EvalParityModel],
                            run_json: RunJson, choice: ModelChoice, granite_needed: bool, *,
                            revisions: Mapping[str, str] | None = None, kinds: Mapping[str, str] | None = None,
                            generated_at: datetime | None = None) -> str:
    """The report as Markdown, with no question text: the run and its date, the revision and reader of each model, the set,
    a table per model, the cost, the excluded models, the rule, the decision and, last, the first answering rank by question id.

    `revisions` is the lock's id-to-revision map (read from `models.lock.json` when absent) and `kinds` maps a filing id to
    its kind, for the set's count by kind (left out when absent)."""
    revisions = read_lock_revisions() if revisions is None else revisions
    when = to_utc(generated_at).strftime("%Y-%m-%d")
    first = scores[0].by_method["hybrid"]
    n = first["all"].n
    lines = [
        f"# Retrieval model choice: {run}", "",
        f"{when} · current model `{run_json.current}`. Recall and MRR are shares of the verified questions, from the first "
        "ranked chunk on an answering page; ranks count chunks.", "",
        "## The set", "",
        f"- {len(questions)} verified questions.",
        "- By answering-page source: " + ", ".join(f"{source} {first[source].n if source in first else 0}" for source in _SOURCES) + ".",
    ]
    if kinds is not None:
        counts = {kind: sum(1 for q in questions if kinds.get(q.filing) == kind) for kind in get_args(FilingKind)}
        lines.append("- By filing kind: " + ", ".join(f"{kind} {count}" for kind, count in counts.items() if count) + ".")
    lines += ["", "## Models", ""]
    for score in scores:
        lines.append(f"- `{score.model}`: revision `{revisions.get(score.model, '—')}`; read with {_reader(score.versions)}.")
    lines += ["", "## Results by model", ""]
    for score in scores:
        body = [[method, stratum, metrics.n, _ratio(metrics.recall_at_5), _ratio(metrics.recall_at_10), _ratio(metrics.mrr)]
                for method in METHODS for stratum in STRATA if (metrics := score.by_method[method].get(stratum))]
        lines += [f"### `{score.model}`", "", *_table(["method", "source", "n", "recall@5", "recall@10", "MRR"], body), ""]

    cost = []
    for score in scores:
        bench, parity = benches[score.model], parities.get(score.model)
        memory = run_json.memory_mib.get(score.model)
        cosine = "—" if parity is None else _decimal(Decimal(str(parity.min_cosine)), "0.0001") + ("" if parity.passed else " (failed)")
        prompts = "—" if parity is None else ("match" if parity.prompts_match_card else "differ")
        cost.append([f"`{score.model}`", _decimal(seconds_per_1000(bench)), _decimal(_minutes(bench)),
                     _decimal(Decimal(str(bench.query_millis_median))), "—" if memory is None else format(memory.normalize(), "f"),
                     cosine, prompts])
    lines += ["## Cost on this machine", "",
              "Seconds to embed 1,000 chunks on the bench, the minutes that comes to for 1,500 chunks (a 300-page report), the "
              "median of one query, the peak memory a person read off the container, and whether TEI's vectors match the "
              "reference model's (the lowest cosine, and whether the registry's prompts are the model card's).", "",
              *_table(["model", "seconds per 1,000 chunks", "minutes for 1,500 chunks", "query median (ms)", "peak memory (MiB)",
                       "parity min cosine", "parity prompts"], cost), "",
              "## Excluded models", ""]
    lines += [f"- `{model}`: {reason}" for model, reason in run_json.excluded.items()] or ["None."]

    band = choice.band
    lines += [
        "", "## The rule", "",
        "The rule was fixed before the models were run. Changing the model embeds every chunk again, which takes days, so "
        "the model in use stays unless another wins by more than a band.", "",
        f"- The band is one question of the verified set: 1/{band.denominator}.",
        "- The tied models are those whose hybrid recall@10 over all questions is behind the best by the band or less. A model "
        "exactly one question behind is tied.",
        "- One tied model wins on recall. Otherwise the current model is kept when it is tied, whatever its CPU time. Otherwise "
        "(the current model is outside the band) the tied challenger with the lowest seconds per 1,000 chunks wins, and equal "
        "times go to the model listed first in models.lock.json.",
        "- A model is scored only when every filing of the corpus has a current revision for it, and the models are compared "
        "only when they read every filing alike (the same reader versions and the same source on each page).",
        "- Granite is measured only when the rule chooses a challenger that takes more than 3,600 s to embed 1,500 chunks. A "
        "kept current model never needs it.", "",
        "## The decision", "",
        f"- Hybrid recall@10 over all {n} questions: " + "; ".join(
            f"`{s.model}` {s.by_method['hybrid']['all'].recall_at_10 * n}/{n} ({_ratio(s.by_method['hybrid']['all'].recall_at_10)})"
            for s in scores) + f". Band {band.numerator}/{band.denominator}.",
    ]
    stays = choice.model == run_json.current
    head = f"`{choice.model}` stays as EMBEDDING_MODEL" if stays else f"EMBEDDING_MODEL becomes `{choice.model}`"
    lines.append(f"- {head}: {_REASONS[choice.reason]}.")
    if granite_needed:
        lines.append(f"- Granite is measured: the chosen model takes {_decimal(_minutes(benches[choice.model]))} minutes for "
                     f"{GRANITE_CHUNKS:,} chunks, more than 60.")
    elif stays:
        lines.append("- Granite is not measured: the current model is kept, so granite could not replace it.")
    else:
        lines.append(f"- Granite is not measured: the chosen model takes {_decimal(_minutes(benches[choice.model]))} minutes for "
                     f"{GRANITE_CHUNKS:,} chunks, not more than 60.")

    lines += ["", "## Appendix: first answering rank", "",
              "The place of the first chunk on an answering page, by question id, model and method. A dash is no answering "
              "page in the ranked list.", ""]
    rows = [[qid, f"`{s.model}`", *("—" if (rank := s.first_ranks[qid][method]) is None else rank for method in METHODS)]
            for qid in sorted(scores[0].first_ranks) for s in scores]
    lines += _table(["question", "model", *METHODS], rows)
    return "\n".join(lines) + "\n"
