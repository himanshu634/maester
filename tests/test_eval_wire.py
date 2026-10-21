"""The JSON the harness hands to the worker's commands (`maester-eval ocr request`), and the fixtures both sides read. Offline."""

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from pydantic import ValidationError

from maester_eval.errors import EvalError
from maester_eval.eval_wire import DocumentRef, EvalRequestModel, RequestQuestion, document_refs
from maester_eval.manifest import Filing
from maester_eval.ocr import DisagreementFile
from maester_eval.paths import ROOT

FIXTURES = ROOT / "packages" / "contracts" / "fixtures" / "eval"
SHA = "a" * 64


def filing(name: str, company: str = "Aether Industries Limited", **values) -> Filing:
    return Filing(**{"file": f"aether-industries/{name}.pdf", "company": company, "kind": "annual_report",
                     "period_end": "2025-03-31", "set": "dev", **values})


class SharedFixtureTests(unittest.TestCase):
    def test_the_shared_request_fixture_round_trips(self):
        data = json.loads(FIXTURES.joinpath("request.json").read_text(encoding="utf-8"))
        self.assertEqual(EvalRequestModel.model_validate(data).model_dump(mode="json"), data)

    def test_the_request_fixture_is_two_documents_and_one_question(self):
        # Task 6's Zod test reads the same file; a change of its size is a change both sides must see.
        request = EvalRequestModel.model_validate_json(FIXTURES.joinpath("request.json").read_text(encoding="utf-8"))
        self.assertEqual((len(request.documents), len(request.questions)), (2, 1))
        self.assertTrue(set(request.questions[0].scope) <= {d.filing for d in request.documents})

    def test_the_shared_disagreements_fixture_round_trips(self):  # Task 2's fixture, read by this side's twin
        data = json.loads(FIXTURES.joinpath("ocr-disagreements.json").read_text(encoding="utf-8"))
        self.assertEqual(DisagreementFile.model_validate(data).model_dump(mode="json"), data)


class RequestModelTests(unittest.TestCase):
    def request(self, **values):
        base = {"version": 1, "documents": [{"filing": "a/b", "sha256": SHA}],
                "questions": [{"id": "q001", "query": "What?", "scope": ["a/b"]}]}
        return {**base, **values}

    def test_a_request_with_no_questions_is_valid(self):
        self.assertEqual(EvalRequestModel.model_validate(self.request(questions=[])).questions, [])

    def test_only_version_1_is_read(self):
        with self.assertRaises(ValidationError):
            EvalRequestModel.model_validate(self.request(version=2))

    def test_a_field_the_twin_does_not_know_is_refused(self):
        with self.assertRaises(ValidationError):
            EvalRequestModel.model_validate(self.request(extra=1))
        with self.assertRaises(ValidationError):
            DocumentRef.model_validate({"filing": "a/b", "sha256": SHA, "bytes": 1})

    def test_a_sha256_is_64_lower_case_hex_digits(self):
        for bad in ("a" * 63, "a" * 65, "A" * 64, "g" * 64, ("a" * 64) + "\n", ""):
            with self.subTest(sha256=bad), self.assertRaises(ValidationError):
                DocumentRef(filing="a/b", sha256=bad)

    def test_a_question_id_is_q_and_three_ascii_digits(self):
        for bad in ("q1", "q0001", "Q001", "q00a", "q٠٠١", "q001\n", ""):  # q٠٠١ is Arabic-Indic digits
            with self.subTest(id=bad), self.assertRaises(ValidationError):
                RequestQuestion(id=bad, query="What?", scope=["a/b"])

    def test_a_query_is_1_to_500_characters(self):
        RequestQuestion(id="q001", query="x", scope=["a/b"])
        RequestQuestion(id="q001", query="x" * 500, scope=["a/b"])
        for bad in ("", "x" * 501):
            with self.subTest(length=len(bad)), self.assertRaises(ValidationError):
                RequestQuestion(id="q001", query=bad, scope=["a/b"])

    def test_a_question_needs_a_scope(self):
        with self.assertRaises(ValidationError):
            RequestQuestion(id="q001", query="What?", scope=[])


class DocumentRefsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.corpus = Path(self.temp.name)
        (self.corpus / "aether-industries").mkdir()

    def write(self, name: str, content: bytes) -> None:
        (self.corpus / "aether-industries" / f"{name}.pdf").write_bytes(content)

    def test_each_ref_holds_the_sha256_of_its_pdf_in_the_order_given(self):
        self.write("ar-2024-25", b"abc")
        self.write("ar-2023-24", b"")
        refs = document_refs([filing("ar-2024-25"), filing("ar-2023-24")], self.corpus)
        self.assertEqual(refs, [
            DocumentRef(filing="aether-industries/ar-2024-25",
                        sha256="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),  # FIPS 180-2 test vector for "abc"
            DocumentRef(filing="aether-industries/ar-2023-24",
                        sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),  # sha256 of nothing
        ])

    def test_a_file_larger_than_one_read_is_hashed_whole(self):
        content = bytes(range(256)) * 20_000  # 5 MB
        self.write("ar-2024-25", content)
        (ref,) = document_refs([filing("ar-2024-25")], self.corpus)
        self.assertEqual(ref.sha256, hashlib.sha256(content).hexdigest())

    def test_a_missing_pdf_is_an_error_that_names_it(self):
        self.write("ar-2024-25", b"abc")
        with self.assertRaisesRegex(EvalError, "aether-industries/ar-2023-24.pdf") as caught:
            document_refs([filing("ar-2024-25"), filing("ar-2023-24")], self.corpus)
        self.assertNotIn("ar-2024-25", str(caught.exception))  # the one that is there is not named

    def test_no_filings_give_no_refs(self):
        self.assertEqual(document_refs([], self.corpus), [])


if __name__ == "__main__":
    unittest.main()
