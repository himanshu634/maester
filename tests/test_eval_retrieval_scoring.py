"""Retrieval scoring, the model rule and the report. Offline: every ranking is a small hand-made fixture."""

from datetime import datetime, timezone
from decimal import Decimal
from fractions import Fraction
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import plain
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.cli import app
from maester_eval.eval_wire import (EvalBenchModel, EvalParityModel, EvalPageModel, EvalRankingsModel, EvalVersionsModel)
from maester_eval.manifest import Filing, Manifest
from maester_eval.paths import EvalPaths
from maester_eval.retrieval import RetrievalQuestion
from maester_eval.retrieval_report import RetrievalReportError, RunJson, read_retrieval_run, render_retrieval_report
from maester_eval.retrieval_scoring import (IncompleteIndexError, Metrics, ModelChoice, ModelScore, RetrievalScoreError,
                                            check_same_reads, choose_model, needs_granite, question_source, score_model,
                                            seconds_per_1000)

ARCTIC = "Snowflake/snowflake-arctic-embed-l-v2.0"
QWEN = "Qwen/Qwen3-Embedding-0.6B"
VOYAGE = "voyageai/voyage-4-nano"
F = "aether-industries/ar-2024-25"
G = "aether-industries/ar-2023-24"
UUID = "6f1c2a52-2d0e-4c53-9a6b-0d7f1b3e8a11"
SHA = "0" * 64
VERSIONS = EvalVersionsModel(index_version="1", docling_version="2.134.0", ocr_engine="rapidocr-onnxruntime 3.9.2",
                             reader_options="table=accurate;cell_matching=true;ocr=rapidocr", chunker_version="1")


def question(id: str = "q001", filing: str = F, answers=((F, 12),), query: str = "Secret query?") -> RetrievalQuestion:
    return RetrievalQuestion(id=id, filing=filing, query=query, answers=tuple(sorted(answers)), status="verified")


def document(filing: str, pages: dict[int, str], revised: bool = True, versions=VERSIONS) -> dict:
    return dict(filing=filing, sha256=SHA, document_id=UUID if revised else None, revision_id=UUID if revised else None,
                state="complete" if revised else None, versions=versions if revised else None,
                chunks=10 if revised else 0, pages=[EvalPageModel(page=p, source=s) for p, s in sorted(pages.items())])


def rankings(model: str = ARCTIC, hybrid=None, sources=None, vector=None, keyword=None,
             revised: tuple[str, ...] = (F, G)) -> EvalRankingsModel:
    """`hybrid`, `vector` and `keyword` are `{question id: [(filing, page), ...]}`; `sources` is `{(filing, page): source}`."""
    sources = sources or {}
    documents = []
    for filing in (F, G):
        pages = {page: source for (name, page), source in sources.items() if name == filing}
        documents.append(document(filing, pages, filing in revised))
    entries = []
    for qid in sorted({*(hybrid or {}), *(vector or {}), *(keyword or {})}):
        lists = {name: [dict(filing=f, page=p) for f, p in (given or {}).get(qid, [])]
                 for name, given in (("vector", vector), ("keyword", keyword), ("hybrid", hybrid))}
        entries.append(dict(question_id=qid, **lists))
    return EvalRankingsModel.model_validate(dict(version=1, model=model, documents=documents, rankings=entries))


def filler(count: int, start: int = 100) -> list[tuple[str, int]]:
    return [(G, start + i) for i in range(count)]


QUESTIONS = [
    question("q001", answers=((F, 12),)),
    question("q002", answers=((F, 40), (F, 41))),
    question("q003", answers=((F, 5),)),
]
SOURCES = {(F, 12): "text_layer", (F, 40): "ocr", (F, 41): "text_layer", (F, 5): "ocr", (G, 12): "text_layer"}
HYBRID = {
    "q001": [(G, 12), (F, 12), (F, 12), *filler(7)],
    "q002": [*filler(7), (F, 41), (F, 40), (G, 1)],
    "q003": filler(10),
}
RANKINGS = rankings(hybrid=HYBRID, sources=SOURCES)


def without_revision(base: EvalRankingsModel, filing: str) -> EvalRankingsModel:
    documents = [d.model_copy(update=dict(revision_id=None, document_id=None, state=None, versions=None, chunks=0, pages=[]))
                 if d.filing == filing else d for d in base.documents]
    return base.model_copy(update=dict(documents=documents))


def with_page_source(base: EvalRankingsModel, filing: str, page: int, source: str, model: str | None = None) -> EvalRankingsModel:
    documents = [d.model_copy(update=dict(pages=[p.model_copy(update=dict(source=source)) if p.page == page else p for p in d.pages]))
                 if d.filing == filing else d for d in base.documents]
    return base.model_copy(update=dict(documents=documents, model=model or base.model))


def metrics(hits: int, n: int = 40) -> dict:
    value = Metrics(n=n, recall_at_5=Fraction(hits, n), recall_at_10=Fraction(hits, n), mrr=Fraction(hits, n))
    return {"vector": {"all": value}, "keyword": {"all": value}, "hybrid": {"all": value}}


def s(model: str, hits: int) -> ModelScore:
    return ModelScore(model=model, by_method=metrics(hits), first_ranks={})


def b(seconds: float, model: str = ARCTIC) -> EvalBenchModel:
    return EvalBenchModel(version=1, model=model, batch=16, chunks=1000, warmup_chunks=16, seconds=seconds, queries=40,
                          query_millis_median=140.5)


def choice(model: str) -> ModelChoice:
    return ModelChoice(model=model, reason="best_recall", band=Fraction(1, 40))


class ScoreModelTests(unittest.TestCase):
    def test_hand_worked_metrics(self):
        m = score_model(QUESTIONS, RANKINGS).by_method["hybrid"]["all"]
        self.assertEqual((m.n, m.recall_at_5, m.recall_at_10, m.mrr), (3, Fraction(1, 3), Fraction(2, 3), Fraction(5, 24)))  # (1/2 + 1/8 + 0) / 3

    def test_page_12_of_a_filing_the_answers_do_not_name_does_not_count(self):
        ranks = score_model(QUESTIONS, RANKINGS).first_ranks
        self.assertEqual((ranks["q001"]["hybrid"], ranks["q002"]["hybrid"], ranks["q003"]["hybrid"]), (2, 8, None))

    def test_strata_by_answering_page_source(self):
        s = score_model(QUESTIONS, RANKINGS).by_method["hybrid"]
        self.assertEqual({k: v.n for k, v in s.items()}, {"all": 3, "text_layer": 1, "ocr": 1, "mixed": 1})
        self.assertEqual(s["text_layer"].mrr, Fraction(1, 2))
        self.assertEqual(s["ocr"].recall_at_10, Fraction(0))

    def test_a_stratum_with_no_question_is_left_out_and_not_scored_zero(self):
        only = [QUESTIONS[0]]
        strata = score_model(only, rankings(hybrid={"q001": [(F, 12)]}, sources=SOURCES)).by_method["hybrid"]
        self.assertEqual(set(strata), {"all", "text_layer"})

    def test_the_methods_are_scored_apart(self):
        ranks = rankings(hybrid={"q001": [(F, 12)]}, vector={"q001": filler(5) + [(F, 12)]}, keyword={"q001": filler(3)},
                         sources=SOURCES)
        scored = score_model([QUESTIONS[0]], ranks)
        self.assertEqual([scored.by_method[m]["all"].recall_at_5 for m in ("vector", "keyword", "hybrid")],
                         [Fraction(0), Fraction(0), Fraction(1)])
        self.assertEqual([scored.by_method[m]["all"].recall_at_10 for m in ("vector", "keyword", "hybrid")],
                         [Fraction(1), Fraction(0), Fraction(1)])
        self.assertEqual(scored.first_ranks["q001"], {"vector": 6, "keyword": None, "hybrid": 1})

    def test_a_hit_in_any_answering_filing_counts(self):
        both = [question("q004", filing=F, answers=((F, 3), (G, 3)))]
        ranks = rankings(hybrid={"q004": [(G, 3), (F, 3)]}, sources={(F, 3): "text_layer", (G, 3): "text_layer"})
        self.assertEqual(score_model(both, ranks).first_ranks["q004"]["hybrid"], 1)

    def test_a_scope_document_with_no_revision_refuses_the_model(self):
        with self.assertRaisesRegex(IncompleteIndexError, f"{ARCTIC}: no current revision for {F}"):
            score_model(QUESTIONS, without_revision(RANKINGS, F))

    def test_every_document_without_a_revision_is_named(self):
        both = without_revision(without_revision(RANKINGS, F), G)
        with self.assertRaisesRegex(IncompleteIndexError, f"no current revision for {F}, {G}"):
            score_model(QUESTIONS, both)

    def test_no_rankings_refuses_the_model(self):
        empty = RANKINGS.model_copy(update=dict(rankings=[]))
        with self.assertRaisesRegex(IncompleteIndexError, "no rankings"):
            score_model(QUESTIONS, empty)

    def test_a_question_that_was_not_ranked_is_refused_and_not_scored_zero(self):
        with self.assertRaisesRegex(RetrievalScoreError, "q003: no ranking"):
            score_model(QUESTIONS, rankings(hybrid={k: v for k, v in HYBRID.items() if k != "q003"}, sources=SOURCES))

    def test_a_ranking_for_a_question_outside_the_set_is_refused(self):
        with self.assertRaisesRegex(RetrievalScoreError, "q009 is not a question of the set"):
            score_model(QUESTIONS, rankings(hybrid={**HYBRID, "q009": []}, sources=SOURCES))

    def test_the_reader_versions_of_the_model_are_kept(self):
        self.assertEqual(score_model(QUESTIONS, RANKINGS).versions, (VERSIONS,))


class QuestionSourceTests(unittest.TestCase):
    def test_the_source_of_the_answering_pages(self):
        self.assertEqual([question_source(q, RANKINGS) for q in QUESTIONS], ["text_layer", "mixed", "ocr"])

    def test_an_answering_page_with_no_text_is_refused(self):
        ranks = with_page_source(RANKINGS, F, 12, "none")
        with self.assertRaisesRegex(RetrievalScoreError, f"q001: page 12 of {F} has no text"):
            question_source(QUESTIONS[0], ranks)

    def test_an_answering_page_the_document_lacks_is_refused(self):
        with self.assertRaisesRegex(RetrievalScoreError, f"q001: page 13 of {F} has no text"):
            question_source(question(answers=((F, 13),)), RANKINGS)

    def test_an_answer_in_a_filing_the_rankings_lack_is_refused(self):
        with self.assertRaisesRegex(RetrievalScoreError, "q001: other/filing is not in the rankings"):
            question_source(question(answers=(("other/filing", 1),)), RANKINGS)

    def test_each_answer_is_looked_up_in_its_own_filing(self):
        ranks = rankings(sources={(F, 3): "text_layer", (G, 3): "ocr"})
        self.assertEqual(question_source(question(answers=((F, 3), (G, 3))), ranks), "mixed")
        self.assertEqual(question_source(question(answers=((G, 3),)), ranks), "ocr")

    def test_a_page_that_is_itself_mixed_is_a_mixed_question(self):
        self.assertEqual(question_source(question(answers=((F, 3),)), rankings(sources={(F, 3): "mixed"})), "mixed")


class CheckSameReadsTests(unittest.TestCase):
    def test_models_that_read_a_document_differently_are_not_compared(self):
        qwen = with_page_source(RANKINGS, F, page=40, source="none", model=QWEN)  # OCR_BUDGET in Qwen's re-read
        with self.assertRaisesRegex(RetrievalScoreError, f"{F}: the models read it differently \\(pages\\)"):
            check_same_reads({ARCTIC: RANKINGS, QWEN: qwen})

    def test_a_different_reader_version_is_named(self):
        other = VERSIONS.model_copy(update=dict(ocr_engine="tesseract-cli 5.3.0 eng:abcdef012345"))
        qwen = RANKINGS.model_copy(update=dict(model=QWEN, documents=[
            d.model_copy(update=dict(versions=other)) if d.filing == G else d for d in RANKINGS.documents]))
        with self.assertRaisesRegex(RetrievalScoreError, f"{G}: the models read it differently \\(versions\\)"):
            check_same_reads({ARCTIC: RANKINGS, QWEN: qwen})

    def test_chunk_counts_may_differ_between_models(self):
        qwen = RANKINGS.model_copy(update=dict(model=QWEN, documents=[d.model_copy(update=dict(chunks=99)) for d in RANKINGS.documents]))
        check_same_reads({ARCTIC: RANKINGS, QWEN: qwen})

    def test_models_that_read_alike_pass(self):
        check_same_reads({ARCTIC: RANKINGS, QWEN: RANKINGS.model_copy(update=dict(model=QWEN))})


class ChooseModelTests(unittest.TestCase):
    def test_the_current_model_inside_the_band_is_kept(self):
        # 40 questions, band 1/40: qwen 31/40, arctic 30/40 (tied: exactly one question behind), voyage 29/40 (out)
        c = choose_model([s(ARCTIC, 30), s(QWEN, 31), s(VOYAGE, 29)], {ARCTIC: b(1200), QWEN: b(1800), VOYAGE: b(700)}, ARCTIC)
        self.assertEqual((c.model, c.reason, c.band), (ARCTIC, "tie_kept_current", Fraction(1, 40)))

    def test_a_faster_tied_challenger_does_not_replace_the_current_model(self):
        c = choose_model([s(ARCTIC, 30), s(QWEN, 31)], {ARCTIC: b(1800), QWEN: b(1200)}, ARCTIC)
        self.assertEqual((c.model, c.reason), (ARCTIC, "tie_kept_current"))

    def test_cpu_time_chooses_between_tied_challengers_when_the_current_model_is_out(self):
        # arctic 28/40 is 3/40 behind the best; qwen 31/40 and voyage 30/40 are tied; voyage is faster
        c = choose_model([s(ARCTIC, 28), s(QWEN, 31), s(VOYAGE, 30)], {ARCTIC: b(1200), QWEN: b(1800), VOYAGE: b(700)}, ARCTIC)
        self.assertEqual((c.model, c.reason, c.band), (VOYAGE, "tie_broken_by_cpu_time", Fraction(1, 40)))

    def test_equal_times_go_to_the_model_listed_first(self):
        c = choose_model([s(ARCTIC, 28), s(QWEN, 31), s(VOYAGE, 30)], {ARCTIC: b(1200), QWEN: b(900), VOYAGE: b(900)}, ARCTIC)
        self.assertEqual((c.model, c.reason), (QWEN, "tie_broken_by_cpu_time"))

    def test_a_clear_winner(self):
        c = choose_model([s(ARCTIC, 30), s(QWEN, 33), s(VOYAGE, 29)], {ARCTIC: b(1200), QWEN: b(1800), VOYAGE: b(700)}, ARCTIC)
        self.assertEqual((c.model, c.reason), (QWEN, "best_recall"))

    def test_an_exact_tie_keeps_the_current_model(self):
        c = choose_model([s(QWEN, 30), s(ARCTIC, 30)], {ARCTIC: b(1500), QWEN: b(1500)}, ARCTIC)
        self.assertEqual((c.model, c.reason), (ARCTIC, "tie_kept_current"))

    def test_the_band_is_one_question_of_the_verified_set(self):
        scores = [ModelScore(model=m, by_method=metrics(hits, n=50), first_ranks={}) for m, hits in ((ARCTIC, 30), (QWEN, 31))]
        self.assertEqual(choose_model(scores, {ARCTIC: b(1), QWEN: b(1)}, ARCTIC).band, Fraction(1, 50))

    def test_a_current_model_that_was_not_scored_is_refused(self):
        with self.assertRaisesRegex(RetrievalScoreError, f"the current model {ARCTIC} is not among the scored models"):
            choose_model([s(QWEN, 31), s(VOYAGE, 30)], {QWEN: b(1), VOYAGE: b(1)}, ARCTIC)

    def test_models_scored_over_different_sets_are_refused(self):
        other = ModelScore(model=QWEN, by_method=metrics(31, n=41), first_ranks={})
        with self.assertRaisesRegex(RetrievalScoreError, "different numbers of questions"):
            choose_model([s(ARCTIC, 30), other], {ARCTIC: b(1), QWEN: b(1)}, ARCTIC)

    def test_a_tied_model_with_no_bench_is_refused(self):
        with self.assertRaisesRegex(RetrievalScoreError, f"{QWEN}: no bench"):
            choose_model([s(ARCTIC, 28), s(QWEN, 31), s(VOYAGE, 30)], {ARCTIC: b(1), VOYAGE: b(1)}, ARCTIC)


class SecondsAndGraniteTests(unittest.TestCase):
    def test_seconds_per_1000_is_exact(self):
        bench = EvalBenchModel(version=1, model=ARCTIC, batch=16, chunks=464, warmup_chunks=16, seconds=187.25, queries=40,
                               query_millis_median=142.5)
        # 187.25 s * 1000 / 464 chunks: 464 * 403 = 186,992, and 258 / 464 is 0.5560...
        self.assertEqual(seconds_per_1000(bench).quantize(Decimal("0.0001")), Decimal("403.5560"))

    def test_a_bench_of_no_chunks_is_refused(self):
        empty = b(10).model_copy(update=dict(chunks=0))
        with self.assertRaisesRegex(RetrievalScoreError, f"{ARCTIC}: the bench embedded no chunks"):
            seconds_per_1000(empty)

    def test_granite_is_needed_only_past_an_hour_for_1500_chunks(self):
        self.assertTrue(needs_granite(choice(QWEN), {QWEN: b(2600)}, ARCTIC))   # 3900 s
        self.assertFalse(needs_granite(choice(QWEN), {QWEN: b(2400)}, ARCTIC))  # 3600 s

    def test_a_kept_current_model_never_needs_granite(self):
        self.assertFalse(needs_granite(choice(ARCTIC), {ARCTIC: b(3000)}, ARCTIC))  # 4500 s, but granite could not replace it


REVISIONS = {ARCTIC: "ac6544c8a46e", QWEN: "97b0c614be4d"}
WHEN = datetime(2026, 10, 24, 9, 30, tzinfo=timezone.utc)
KINDS = {F: "annual_report", G: "annual_report"}


class ReportTests(unittest.TestCase):
    def render(self, excluded=None, parities=None, memory=None, granite=False, current=ARCTIC):
        scores = [score_model(QUESTIONS, RANKINGS), score_model(QUESTIONS, RANKINGS.model_copy(update=dict(model=QWEN)))]
        benches = {ARCTIC: b(1200), QWEN: b(1800, QWEN)}
        run_json = RunJson(current=current, excluded=excluded or {}, memory_mib=memory or {})
        parities = {} if parities is None else parities
        return render_retrieval_report("20261024T093000Z-all", QUESTIONS, scores, benches, parities, run_json,
                                       ModelChoice(ARCTIC, "tie_kept_current", Fraction(1, 3)), granite,
                                       revisions=REVISIONS, kinds=KINDS, generated_at=WHEN)

    def test_the_report_has_no_question_text(self):
        md = self.render()
        for q in QUESTIONS:
            self.assertNotIn(q.query, md)
        self.assertIn("| hybrid | all | 3 | 0.333 | 0.667 | 0.208 |", md)
        self.assertIn("| method | source | n | recall@5 | recall@10 | MRR |", md)

    def test_the_header_names_the_run_the_date_the_revisions_and_the_reader(self):
        md = self.render()
        self.assertIn("20261024T093000Z-all", md)
        self.assertIn("2026-10-24", md)
        self.assertIn("ac6544c8a46e", md)
        self.assertIn("rapidocr-onnxruntime 3.9.2", md)
        self.assertIn("docling 2.134.0", md)

    def test_the_set_by_source_and_kind(self):
        md = self.render()
        self.assertIn("3 verified questions", md)
        self.assertIn("text_layer 1, ocr 1, mixed 1", md)
        self.assertIn("annual_report 3", md)

    def test_one_table_per_model(self):
        md = self.render()
        self.assertIn(f"### `{ARCTIC}`", md)
        self.assertIn(f"### `{QWEN}`", md)
        self.assertEqual(md.count("| hybrid | all |"), 2)

    def test_the_cpu_table_projects_1500_chunks_and_shows_unknowns_as_dashes(self):
        md = self.render(memory={ARCTIC: 1536})
        self.assertIn(f"| `{ARCTIC}` | 1200.0 | 30.0 | 140.5 | 1536 | — | — |", md)
        self.assertIn(f"| `{QWEN}` | 1800.0 | 45.0 | 140.5 | — | — | — |", md)

    def test_parity_is_shown_when_it_was_run(self):
        parity = EvalParityModel(model=ARCTIC, revision="a" * 40, min_cosine=0.99987654, passed=True, prompts_match_card=True)
        self.assertIn(f"| `{ARCTIC}` | 1200.0 | 30.0 | 140.5 | — | 0.9999 | match |", self.render(parities={ARCTIC: parity}))

    def test_a_failed_parity_is_said(self):
        parity = EvalParityModel(model=ARCTIC, revision="a" * 40, min_cosine=0.97, passed=False, prompts_match_card=False)
        md = self.render(parities={ARCTIC: parity})
        self.assertIn("| 0.9700 (failed) | differ |", md)

    def test_excluded_models_are_listed_with_their_reasons(self):
        md = self.render(excluded={VOYAGE: "TEI cannot serve it"})
        self.assertIn(f"`{VOYAGE}`: TEI cannot serve it", md)
        self.assertIn("## Excluded models\n\nNone.", self.render())

    def test_the_rule_comes_before_the_decision(self):
        md = self.render()
        self.assertLess(md.index("## The rule"), md.index("## The decision"))
        self.assertIn("band", md[md.index("## The rule"):md.index("## The decision")])

    def test_the_decision_names_the_model_and_the_reason(self):
        decision = self.render()[self.render().index("## The decision"):]
        self.assertIn(f"`{ARCTIC}` stays", decision)
        self.assertIn("within the band", decision)

    def test_the_decision_says_whether_granite_is_measured(self):
        self.assertIn("Granite is not measured", self.render(granite=False))
        self.assertIn("Granite is measured", self.render(granite=True))

    def test_the_appendix_lists_the_first_answering_rank_by_question_id(self):
        md = self.render()
        self.assertIn("| q001 | `" + ARCTIC + "` | — | — | 2 |", md)
        self.assertIn("| q002 | `" + ARCTIC + "` | — | — | 8 |", md)
        self.assertIn("| q003 | `" + ARCTIC + "` | — | — | — |", md)


# ---- the run folder and the command


FILING_F = Filing(file=f"{F}.pdf", company="Aether Industries Limited", kind="annual_report", period_end="2025-03-31", set="dev")
FILING_G = Filing(file=f"{G}.pdf", company="Aether Industries Limited", kind="annual_report", period_end="2024-03-31", set="dev")
MANIFEST = Manifest(filings=[FILING_F, FILING_G])


def slug(model: str) -> str:
    return model.replace("/", "--")


def forty_questions() -> list[RetrievalQuestion]:
    return [question(f"q{n:03d}", answers=((F, 3),), query=f"Secret question {n}?") for n in range(1, 41)]


def forty_rankings(model: str, hit_every: int = 2) -> EvalRankingsModel:
    hybrid = {f"q{n:03d}": ([(F, 3)] if n % hit_every == 0 else filler(10)) for n in range(1, 41)}
    return rankings(model=model, hybrid=hybrid, sources={(F, 3): "text_layer", (G, 1): "text_layer"})


class RunFolderCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / "eval"
        self.retrieval = self.base / "retrieval"
        self.run = self.retrieval / "runs" / "20261024T093000Z-all"
        self.run.mkdir(parents=True)
        self.base.joinpath("manifest.json").write_text(MANIFEST.model_dump_json(), encoding="utf-8")
        self.retrieval.joinpath("corpus.json").write_text(json.dumps({"companies": ["Aether Industries Limited"]}), encoding="utf-8")
        self.write_sheet(forty_questions())
        for model, every in ((ARCTIC, 2), (QWEN, 2)):
            self.write_model(model, forty_rankings(model, every))
        self.write_json("run.json", {"current": ARCTIC, "excluded": {}, "memoryMiB": {}})

    def write_sheet(self, questions):
        lines = ["id,filing,query,pages,status,notes", *(f"{q.id},{q.filing},{q.query},{q.answers[0][1]},verified," for q in questions)]
        self.retrieval.joinpath("questions.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
        request = {"version": 1, "documents": [], "questions": [{"id": q.id, "query": q.query, "scope": [F, G]} for q in questions]}
        self.write_json("request.json", request)

    def write_json(self, name: str, data) -> None:
        self.run.joinpath(name).write_text(json.dumps(data), encoding="utf-8")

    def write_model(self, model: str, ranks: EvalRankingsModel, seconds: float = 1200, parity: bool = False) -> None:
        self.run.joinpath(f"{slug(model)}.rankings.json").write_text(ranks.model_dump_json(by_alias=True), encoding="utf-8")
        self.run.joinpath(f"{slug(model)}.bench.json").write_text(b(seconds, model).model_dump_json(by_alias=True), encoding="utf-8")
        if parity:
            record = dict(model=model, revision="a" * 40, minCosine=0.9995, passed=True, promptsMatchCard=True)
            self.run.joinpath(f"{slug(model)}.parity.json").write_text(json.dumps(record), encoding="utf-8")


class ReadRunTests(RunFolderCase):
    def read(self):
        return read_retrieval_run(self.run, forty_questions(), REVISIONS)

    def test_the_models_are_listed_in_the_order_of_the_lock(self):
        found = self.read()
        self.assertEqual([score.model for score in found.scores], [ARCTIC, QWEN])
        self.assertEqual(found.run_json.current, ARCTIC)

    def test_a_run_without_run_json_is_refused(self):
        self.run.joinpath("run.json").unlink()
        with self.assertRaisesRegex(RetrievalReportError, "run.json"):
            self.read()

    def test_run_json_must_name_the_current_model(self):
        self.write_json("run.json", {"excluded": {}})
        with self.assertRaisesRegex(RetrievalReportError, "run.json"):
            self.read()

    def test_the_current_model_cannot_be_excluded(self):
        self.write_json("run.json", {"current": ARCTIC, "excluded": {ARCTIC: "no"}})
        with self.assertRaisesRegex(RetrievalReportError, "the current model is excluded"):
            self.read()

    def test_a_missing_bench_is_refused_for_a_scored_model(self):
        self.run.joinpath(f"{slug(QWEN)}.bench.json").unlink()
        with self.assertRaisesRegex(RetrievalReportError, f"{QWEN}: no {slug(QWEN)}.bench.json"):
            self.read()

    def test_an_excluded_model_needs_no_files_and_is_not_scored(self):
        self.write_json("run.json", {"current": ARCTIC, "excluded": {QWEN: "TEI cannot serve it"}})
        self.run.joinpath(f"{slug(QWEN)}.bench.json").unlink()
        self.assertEqual([score.model for score in self.read().scores], [ARCTIC])

    def test_a_bench_that_names_another_model_is_refused(self):
        self.write_model(QWEN, forty_rankings(QWEN))
        self.run.joinpath(f"{slug(QWEN)}.bench.json").write_text(b(1, ARCTIC).model_dump_json(by_alias=True), encoding="utf-8")
        with self.assertRaisesRegex(RetrievalReportError, f"{slug(QWEN)}.bench.json names another model"):
            self.read()

    def test_a_model_not_in_the_lock_is_refused(self):
        self.write_model(VOYAGE, forty_rankings(VOYAGE))
        with self.assertRaisesRegex(RetrievalReportError, f"{slug(VOYAGE)} is not in models.lock.json"):
            self.read()

    def test_parity_is_read_when_it_is_there(self):
        self.write_model(ARCTIC, forty_rankings(ARCTIC), parity=True)
        self.assertEqual(list(self.read().parities), [ARCTIC])

    def test_rankings_for_other_questions_than_the_sheets_are_refused_by_id(self):
        self.write_sheet(forty_questions()[:39])
        with self.assertRaisesRegex(RetrievalReportError, "q040"):
            read_retrieval_run(self.run, forty_questions()[:39], REVISIONS)

    def test_a_sheet_edited_after_ranking_is_refused_by_id(self):
        edited = [question(q.id, answers=q.answers, query="A different question?" if q.id == "q007" else q.query)
                  for q in forty_questions()]
        with self.assertRaisesRegex(RetrievalReportError, "q007 was edited after the request"):
            read_retrieval_run(self.run, edited, REVISIONS)

    def test_every_failing_model_is_named_at_once(self):
        self.write_model(ARCTIC, without_revision(forty_rankings(ARCTIC), F))
        self.write_model(QWEN, without_revision(forty_rankings(QWEN), G))
        with self.assertRaises(RetrievalReportError) as raised:
            self.read()
        text = str(raised.exception)
        self.assertIn(f"{ARCTIC}: no current revision for {F}", text)
        self.assertIn(f"{QWEN}: no current revision for {G}", text)

    def test_models_that_read_differently_are_refused(self):
        self.write_model(QWEN, with_page_source(forty_rankings(QWEN), F, 3, "ocr"))
        with self.assertRaisesRegex(RetrievalReportError, f"{F}: the models read it differently \\(pages\\)"):
            self.read()


class RetrievalReportCommandTests(RunFolderCase):
    def setUp(self):
        super().setUp()
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", EvalPaths(self.base))):
            patcher.start()
            self.addCleanup(patcher.stop)
        for name in (F, G):
            path = self.base / "corpus" / f"{name}.pdf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())

    def invoke(self, *args):
        return CliRunner().invoke(app, ["retrieval", "report", *args], env={"COLUMNS": "500"})

    def test_it_writes_report_md_into_the_run_folder_and_prints_the_decision_without_question_text(self):
        result = self.invoke("--run", self.run.name)
        out = plain(result.output)
        self.assertEqual(result.exit_code, 0, out)
        md = (self.run / "report.md").read_text(encoding="utf-8")
        self.assertIn("## The decision", md)
        self.assertIn("hybrid | all | 40 |", md)
        self.assertNotIn("Secret", md + out)
        self.assertIn(f"{ARCTIC} (tie_kept_current)", out)

    def test_to_copies_the_report(self):
        target = self.base / "docs" / "report.md"
        self.assertEqual(self.invoke("--run", "latest", "--to", str(target)).exit_code, 0)
        self.assertEqual(target.read_text(encoding="utf-8"), (self.run / "report.md").read_text(encoding="utf-8"))

    def test_a_refused_run_writes_no_report(self):
        self.write_model(ARCTIC, without_revision(forty_rankings(ARCTIC), F))
        result = self.invoke("--run", "latest")
        self.assertEqual(result.exit_code, 1)
        self.assertIn(f"no current revision for {F}", plain(result.output))
        self.assertFalse((self.run / "report.md").exists())


class HelpTests(unittest.TestCase):
    def test_help_lists_the_report_command(self):
        response = CliRunner().invoke(app, ["retrieval", "--help"], env={"COLUMNS": "200"})
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("report", plain(response.output))


if __name__ == "__main__":
    unittest.main()
