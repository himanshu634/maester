"""The retrieval set: the question sheet, the corpus of dev companies, and the request the ranker reads. Offline."""

import csv
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from eval_fixtures import plain
from typer.testing import CliRunner

from maester_eval import cli
from maester_eval.cli import app
from maester_eval.errors import EvalError
from maester_eval.eval_wire import EvalBenchModel, EvalRankingsModel
from maester_eval.manifest import Filing, Manifest
from maester_eval.paths import DEFAULT, EvalPaths, ROOT
from maester_eval.retrieval import (RetrievalCorpus, RetrievalQuestion, RetrievalSetError, build_request, check_set,
                                    corpus_filings, read_corpus, read_questions)

FIXTURES = ROOT / "packages" / "contracts" / "fixtures" / "eval"
AR = "aether-industries/ar-2024-25"
Q1 = "aether-industries/q1-2025-26"
BHARAT = "bharat-paints/ar-2024-25"
HEADER = "id,filing,query,pages,status,notes"


def filing(file: str, company: str, kind: str = "annual_report", set: str = "dev", **values) -> Filing:
    return Filing(file=f"{file}.pdf", company=company, kind=kind, period_end="2025-03-31", set=set, **values)


# The quarter is out of scope for a baseline; it stays in the retrieval corpus as a hard negative.
MANIFEST = Manifest(filings=[
    filing(AR, "Aether Industries Limited"),
    filing(Q1, "Aether Industries Limited", kind="financial_results", out_of_scope="no statements the taxonomy covers"),
    filing(BHARAT, "Bharat Paints Limited"),
    filing("cobalt-steel/ar-2024-25", "Cobalt Steel Limited", set="heldout"),
])
CORPUS = RetrievalCorpus(companies=["Aether Industries Limited", "Bharat Paints Limited"])


def q(**values) -> RetrievalQuestion:
    base = dict(id="q001", filing=AR, query="Who audits the company?", answers=((AR, 1),), status="verified")
    return RetrievalQuestion(**{**base, **values})


def verified(count: int) -> list[RetrievalQuestion]:
    return [q(id=f"q{number:03d}") for number in range(1, count + 1)]


def sheet(*rows: str) -> str:
    return "\n".join([HEADER, *rows]) + "\n"


def row(**values) -> str:
    cells = {"id": "q001", "filing": AR, "query": "Who audits the company?", "pages": "12", "status": "verified", "notes": "", **values}
    return ",".join(cells[name] for name in ("id", "filing", "query", "pages", "status", "notes"))


class TempCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def write(self, text: str, name: str = "questions.csv") -> Path:
        path = self.dir / name
        path.write_text(text, encoding="utf-8", newline="")
        return path


class ReadQuestionsTests(TempCase):
    def test_a_sheet_saved_by_a_spreadsheet(self):
        text = "﻿id,filing,query,pages,status,notes\nq001,aether-industries/ar-2024-25,Who audits the company?,12.0,verified,\n" \
               "q002,aether-industries/ar-2024-25,What are the borrowings?,40; 41,draft,\n,,,,,\n"
        qs = read_questions(self.write(text))
        self.assertEqual([(q.id, q.answers, q.status) for q in qs],
                         [("q001", ((AR, 12),), "verified"), ("q002", ((AR, 40), (AR, 41)), "draft")])

    def test_a_question_answered_in_two_filings(self):
        qs = read_questions(self.write(sheet(row(pages=f"3; {Q1}:3.0; {AR}:3"))))
        self.assertEqual(qs[0].answers, ((AR, 3), (Q1, 3)))

    def test_a_bare_page_and_the_same_page_with_its_filing_are_one_answer(self):
        qs = read_questions(self.write(sheet(row(pages=f"12; {AR}:12;12.0"))))
        self.assertEqual(qs[0].answers, ((AR, 12),))

    def test_answers_are_sorted_by_filing_and_then_page(self):
        qs = read_questions(self.write(sheet(row(pages=f"9;{Q1}:2;2;{BHARAT}:1"))))
        self.assertEqual(qs[0].answers, ((AR, 2), (AR, 9), (Q1, 2), (BHARAT, 1)))

    def test_a_filing_id_with_dashes_is_split_on_the_last_colon(self):
        qs = read_questions(self.write(sheet(row(pages=f"{Q1}:7"))))
        self.assertEqual(qs[0].answers, ((Q1, 7),))

    def test_the_query_may_hold_a_comma_in_quotes(self):
        qs = read_questions(self.write(sheet(row(query='"Net debt, at the year end?"'))))
        self.assertEqual(qs[0].query, "Net debt, at the year end?")

    def test_notes_are_not_read(self):
        qs = read_questions(self.write(sheet(row(notes="the auditor signs on page 3"))))
        self.assertNotIn("auditor", repr(qs[0]))

    def test_a_page_range_a_spreadsheet_might_read_as_a_date_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages '12-13'"):
            read_questions(self.write(sheet(row(pages="12-13"))))
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages 'aether-industries/q1-2025-26:12-13'"):
            read_questions(self.write(sheet(row(pages=f"{Q1}:12-13"))))

    def test_a_page_below_one_is_refused(self):
        for bad in ("0", "0.0", f"{AR}:0"):
            with self.subTest(pages=bad), self.assertRaisesRegex(RetrievalSetError, "sheet row 2: .*page"):
                read_questions(self.write(sheet(row(pages=bad))))

    def test_what_is_not_a_whole_page_number_is_refused(self):
        for bad in ("-1", "1.5", "p12", "1e1", "٣", "12.", ".5"):  # ٣ is an Arabic-Indic digit
            with self.subTest(pages=bad), self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages"):
                read_questions(self.write(sheet(row(pages=bad))))

    def test_an_empty_filing_part_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages ':3'"):
            read_questions(self.write(sheet(row(pages=":3"))))

    def test_empty_pages_are_refused(self):
        for bad in ("", " ", ";"):
            with self.subTest(pages=bad), self.assertRaisesRegex(RetrievalSetError, "sheet row 2: pages"):
                read_questions(self.write(sheet(row(pages=bad))))

    def test_an_empty_query_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: query is blank"):
            read_questions(self.write(sheet(row(query=""))))

    def test_a_query_over_500_characters_is_refused_before_a_request_would_choke(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: query is over 500 characters") as caught:
            read_questions(self.write(sheet(row(query="x" * 501))))
        self.assertNotIn("xxxx", str(caught.exception))

    def test_a_filing_is_needed(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: filing is blank"):
            read_questions(self.write(sheet(row(filing=""))))

    def test_a_duplicate_id_is_refused_at_its_second_row(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 3: duplicate id q001"):
            read_questions(self.write(sheet(row(), row())))

    def test_an_id_is_q_and_three_ascii_digits(self):
        for bad in ("q1", "q0001", "Q001", "q00a", "q٠٠١", ""):
            with self.subTest(id=bad), self.assertRaisesRegex(RetrievalSetError, "sheet row 2: id"):
                read_questions(self.write(sheet(row(id=bad))))

    def test_an_unknown_status_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 2: status 'maybe'"):
            read_questions(self.write(sheet(row(status="maybe"))))

    def test_a_status_in_capitals_is_read(self):
        self.assertEqual(read_questions(self.write(sheet(row(status="Verified"))))[0].status, "verified")

    def test_a_sheet_with_another_delimiter_is_named(self):
        with self.assertRaisesRegex(RetrievalSetError, "no .* 'pages'.* column"):
            read_questions(self.write("id;filing;query;pages;status;notes\n"))

    def test_a_sheet_that_is_not_utf8_is_refused(self):
        path = self.dir / "questions.csv"
        path.write_bytes(HEADER.encode() + b"\nq001,a/b,caf\xe9,1,draft,\n")
        with self.assertRaisesRegex(RetrievalSetError, "not UTF-8"):
            read_questions(path)

    def test_the_row_number_counts_a_blank_row(self):
        with self.assertRaisesRegex(RetrievalSetError, "sheet row 4: status 'maybe'"):
            read_questions(self.write(sheet(row(), ",,,,,", row(id="q002", status="maybe"))))


class CorpusTests(TempCase):
    def test_the_corpus_is_the_dev_filings_of_its_companies_in_manifest_order_out_of_scope_ones_too(self):
        self.assertEqual([f.id for f in corpus_filings(CORPUS, MANIFEST)], [AR, Q1, BHARAT])

    def test_a_company_is_told_by_its_name_with_case_and_punctuation_ignored(self):
        corpus = RetrievalCorpus(companies=["aether industries LIMITED."])
        self.assertEqual([f.id for f in corpus_filings(corpus, MANIFEST)], [AR, Q1])

    def test_a_company_that_is_not_in_the_manifest_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "Zenith Ltd is not in the manifest"):
            corpus_filings(RetrievalCorpus(companies=["Zenith Ltd"]), MANIFEST)

    def test_a_company_with_no_dev_filing_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "Cobalt Steel Limited has no dev filing"):
            corpus_filings(RetrievalCorpus(companies=["Cobalt Steel Limited"]), MANIFEST)

    def test_read_corpus(self):
        path = self.write(json.dumps({"companies": ["Aether Industries Limited"]}), "corpus.json")
        self.assertEqual(read_corpus(path), RetrievalCorpus(companies=["Aether Industries Limited"]))

    def test_a_corpus_file_that_is_not_one_is_refused_without_echoing_it(self):
        for text in ("{", json.dumps({"companies": []}), json.dumps({"companies": ["A"], "extra": 1}), json.dumps({"companies": "A"})):
            with self.subTest(text=text), self.assertRaisesRegex(RetrievalSetError, "is not a readable retrieval corpus"):
                read_corpus(self.write(text, "corpus.json"))

    def test_a_missing_corpus_file_is_a_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            read_corpus(self.dir / "corpus.json")


class CheckSetTests(unittest.TestCase):
    def test_a_set_of_forty_verified_questions_passes(self):
        check_set(verified(40), CORPUS, MANIFEST)

    def test_an_answer_in_another_companys_filing_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "q001: answer bharat-paints/ar-2024-25:3 is not in its company's filings"):
            check_set([q(answers=((BHARAT, 3),))] + verified(40), CORPUS, MANIFEST)

    def test_an_answer_in_a_filing_outside_the_corpus_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "q001: answer cobalt-steel/ar-2024-25:3 is not in its company's filings"):
            check_set([q(answers=(("cobalt-steel/ar-2024-25", 3),))] + verified(40), CORPUS, MANIFEST)

    def test_an_answer_in_another_filing_of_the_same_company_is_fine(self):
        check_set([q(answers=((AR, 3), (Q1, 3)))] + verified(40), CORPUS, MANIFEST)

    def test_the_set_needs_forty_verified_questions(self):
        with self.assertRaisesRegex(RetrievalSetError, "39 verified questions; the set needs at least 40"):
            check_set(verified(39), CORPUS, MANIFEST)

    def test_drafts_do_not_count_toward_forty(self):
        drafts = [q(id=f"q{number:03d}", status="draft") for number in range(41, 60)]
        with self.assertRaisesRegex(RetrievalSetError, "39 verified questions"):
            check_set(verified(39) + drafts, CORPUS, MANIFEST)

    def test_a_question_outside_the_corpus_is_refused(self):
        with self.assertRaisesRegex(RetrievalSetError, "q001: .* is not in the retrieval corpus"):
            check_set([q(filing="other/ar-2024-25")] + verified(40), CORPUS, MANIFEST)

    def test_a_draft_is_checked_too(self):
        with self.assertRaisesRegex(RetrievalSetError, "q099: answer bharat-paints/ar-2024-25:3 is not"):
            check_set(verified(40) + [q(id="q099", status="draft", answers=((BHARAT, 3),))], CORPUS, MANIFEST)


class BuildRequestTests(TempCase):
    def setUp(self):
        super().setUp()
        self.corpus_dir = self.dir / "corpus"
        for name, content in ((AR, b"%PDF-1.7 a"), (Q1, b"%PDF-1.7 b"), (BHARAT, b"%PDF-1.7 c")):
            path = self.corpus_dir / f"{name}.pdf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)

    def test_request_scopes_each_question_to_its_company(self):
        # MANIFEST marks aether-industries/q1-2025-26 out_of_scope; it stays in the corpus as a hard negative
        req = build_request(verified(40), CORPUS, MANIFEST, self.corpus_dir)
        self.assertEqual([d.filing for d in req.documents], [AR, Q1, BHARAT])
        self.assertEqual(req.questions[0].scope, [AR, Q1])
        self.assertEqual(req.documents[0].sha256, hashlib.sha256(b"%PDF-1.7 a").hexdigest())

    def test_a_question_of_another_company_has_that_companys_scope(self):
        req = build_request([q(filing=BHARAT, answers=((BHARAT, 2),))], CORPUS, MANIFEST, self.corpus_dir)
        self.assertEqual(req.questions[0].scope, [BHARAT])

    def test_only_verified_questions_are_asked_in_sheet_order(self):
        questions = [q(id="q003"), q(id="q001", status="draft"), q(id="q002")]
        req = build_request(questions, CORPUS, MANIFEST, self.corpus_dir)
        self.assertEqual([x.id for x in req.questions], ["q003", "q002"])

    def test_the_request_holds_the_query_and_is_version_1(self):
        req = build_request([q(query="Net debt?")], CORPUS, MANIFEST, self.corpus_dir)
        self.assertEqual((req.version, req.questions[0].query), (1, "Net debt?"))

    def test_a_missing_pdf_is_an_error_that_names_it(self):
        (self.corpus_dir / f"{Q1}.pdf").unlink()
        with self.assertRaisesRegex(RetrievalSetError, "aether-industries/q1-2025-26.pdf") as caught:
            build_request(verified(1), CORPUS, MANIFEST, self.corpus_dir)
        self.assertNotIn("bharat-paints", str(caught.exception))

    def test_a_retrieval_error_is_an_eval_error(self):
        self.assertTrue(issubclass(RetrievalSetError, EvalError))


class SharedFixtureTests(unittest.TestCase):
    def test_the_shared_rankings_and_bench_fixtures_round_trip(self):
        for name, model in (("rankings.json", EvalRankingsModel), ("bench.json", EvalBenchModel)):
            data = json.loads(FIXTURES.joinpath(name).read_text(encoding="utf-8"))
            with self.subTest(name=name):
                self.assertEqual(model.model_validate(data).model_dump(mode="json", by_alias=True), data)

    def test_the_twins_refuse_what_the_zod_side_refuses(self):
        rankings = json.loads(FIXTURES.joinpath("rankings.json").read_text(encoding="utf-8"))
        bench = json.loads(FIXTURES.joinpath("bench.json").read_text(encoding="utf-8"))
        negative_chunks = json.loads(json.dumps(rankings))
        negative_chunks["documents"][0]["chunks"] = -1
        bad_uuid = json.loads(json.dumps(rankings))
        bad_uuid["documents"][0]["documentId"] = "not-a-uuid"
        zero_page = json.loads(json.dumps(rankings))
        zero_page["rankings"][0]["vector"][0]["page"] = 0
        for what, model, data in (("chunks below 0", EvalRankingsModel, negative_chunks), ("uuid", EvalRankingsModel, bad_uuid),
                                  ("page 0", EvalRankingsModel, zero_page), ("extra", EvalBenchModel, {**bench, "extra": 1}),
                                  ("batch 0", EvalBenchModel, {**bench, "batch": 0}), ("seconds below 0", EvalBenchModel, {**bench, "seconds": -1}),
                                  ("fractional chunks", EvalBenchModel, {**bench, "chunks": 1.5})):
            with self.subTest(what=what), self.assertRaises(ValueError):
                model.model_validate(data)


def sheet_text(rows: list[dict[str, str]]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=HEADER.split(","), lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def question_rows(count: int = 40, **values) -> list[dict[str, str]]:
    return [{"id": f"q{number:03d}", "filing": AR, "query": f"Secret question {number}?", "pages": "3", "status": "verified",
             "notes": "", **values} for number in range(1, count + 1)]


class RetrievalCommandCase(TempCase):
    def setUp(self):
        super().setUp()
        self.base = self.dir / "data[final]"
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", EvalPaths(self.base))):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.base.mkdir()
        self.base.joinpath("manifest.json").write_text(MANIFEST.model_dump_json(), encoding="utf-8")
        for name in (AR, Q1, BHARAT):
            path = self.base / "corpus" / f"{name}.pdf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(name.encode())
        self.retrieval = self.base / "retrieval"
        self.retrieval.mkdir()
        self.retrieval.joinpath("corpus.json").write_text(json.dumps({"companies": CORPUS.companies}), encoding="utf-8")
        self.set_questions(question_rows())

    def set_questions(self, rows):
        self.retrieval.joinpath("questions.csv").write_text(sheet_text(rows), encoding="utf-8", newline="")

    def run_command(self, *args):
        return CliRunner().invoke(app, list(args), env={"COLUMNS": "500"})

    def assert_refused(self, result, *messages):
        self.assertEqual(result.exit_code, 1, result.output)
        self.assertIsInstance(result.exception, SystemExit)
        for message in messages:
            self.assertIn(message, plain(result.output))


class PathsTests(unittest.TestCase):
    def test_retrieval_is_a_folder_of_the_base(self):
        self.assertEqual(EvalPaths(Path("/x/eval")).retrieval, Path("/x/eval/retrieval"))

    def test_the_retrieval_runs_are_apart_from_the_extraction_runs(self):
        with tempfile.TemporaryDirectory() as folder:
            paths = EvalPaths(EvalPaths(Path(folder)).retrieval)
            self.assertEqual(paths.runs, Path(folder) / "retrieval" / "runs")

    def test_the_default_retrieval_folder_is_ignored_by_git(self):
        self.assertIn("data/eval/retrieval/", ROOT.joinpath(".gitignore").read_text(encoding="utf-8").splitlines())
        self.assertEqual(DEFAULT.retrieval, DEFAULT.base / "retrieval")


class RetrievalCheckCommandTests(RetrievalCommandCase):
    def test_check_prints_counts_by_kind_and_no_question_text(self):
        rows = question_rows(38) + [{**question_rows(1)[0], "id": "q039", "filing": Q1, "pages": "1"},
                                    {**question_rows(1)[0], "id": "q040", "filing": Q1, "pages": "1"},
                                    {**question_rows(1)[0], "id": "q041", "status": "draft"}]
        self.set_questions(rows)
        result = self.run_command("retrieval", "check")
        out = plain(result.output)
        self.assertEqual(result.exit_code, 0, out)
        self.assertIn("questions: 41", out)
        self.assertIn("verified: 40", out)
        self.assertIn("annual_report 38", out)
        self.assertIn("financial_results 2", out)
        self.assertIn("corpus filings: 3", out)
        self.assertNotIn("Secret", out)

    def test_check_refuses_a_set_with_too_few_verified_questions(self):
        self.set_questions(question_rows(39))
        self.assert_refused(self.run_command("retrieval", "check"), "39 verified questions; the set needs at least 40")

    def test_check_names_the_sheet_row_and_not_the_question(self):
        self.set_questions(question_rows(2, status="maybe"))
        result = self.run_command("retrieval", "check")
        self.assert_refused(result, "sheet row 2: status 'maybe'")
        self.assertNotIn("Secret", plain(result.output))

    def test_check_with_no_sheet_is_a_message_and_not_a_traceback(self):
        self.retrieval.joinpath("questions.csv").unlink()
        self.assert_refused(self.run_command("retrieval", "check"), "questions.csv")


class RetrievalRequestCommandTests(RetrievalCommandCase):
    def runs(self):
        return sorted(p for p in (self.retrieval / "runs").glob("*"))

    def test_request_writes_request_json_under_the_retrieval_runs_and_prints_the_folder(self):
        result = self.run_command("retrieval", "request")
        self.assertEqual(result.exit_code, 0, result.output)
        (run,) = self.runs()
        self.assertIn(str(run), plain(result.output))
        request = json.loads((run / "request.json").read_text(encoding="utf-8"))
        self.assertEqual((request["version"], len(request["documents"]), len(request["questions"])), (1, 3, 40))
        self.assertEqual(request["questions"][0]["scope"], [AR, Q1])
        self.assertFalse((self.base / "runs").exists())  # never beside the extraction runs

    def test_the_console_has_no_question_text(self):
        self.assertNotIn("Secret", plain(self.run_command("retrieval", "request").output))

    def test_a_label_goes_into_the_folder_name(self):
        self.run_command("retrieval", "request", "--label", "arctic")
        (run,) = self.runs()
        self.assertTrue(run.name.endswith("-arctic"), run.name)

    def test_a_bad_label_is_refused_before_a_folder_exists(self):
        self.assert_refused(self.run_command("retrieval", "request", "--label", "a/b"), "run label")
        self.assertEqual(self.runs(), [])

    def test_the_latest_retrieval_run_is_found_by_the_retrieval_paths(self):
        self.run_command("retrieval", "request", "--label", "one")
        self.assertEqual(EvalPaths(self.retrieval).resolve_run("latest"), self.runs()[-1])

    def test_a_missing_pdf_is_named_and_leaves_no_run_folder(self):
        (self.base / "corpus" / f"{BHARAT}.pdf").unlink()
        self.assert_refused(self.run_command("retrieval", "request"), "bharat-paints/ar-2024-25.pdf")
        self.assertEqual(self.runs(), [])

    def test_a_set_that_does_not_check_makes_no_request(self):
        self.set_questions(question_rows(39))
        self.assert_refused(self.run_command("retrieval", "request"), "39 verified questions")
        self.assertEqual(self.runs(), [])


class HelpTests(unittest.TestCase):
    def test_help_lists_the_retrieval_commands(self):
        response = CliRunner().invoke(app, ["retrieval", "--help"], env={"COLUMNS": "200"})
        self.assertEqual(response.exit_code, 0, response.output)
        for word in ("check", "request"):
            self.assertIn(word, plain(response.output))


if __name__ == "__main__":
    unittest.main()
