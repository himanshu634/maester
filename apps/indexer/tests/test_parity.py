import importlib.util
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from maester_indexer.lockfile import shipped_lock
from maester_indexer.parity import ParityResult, check, compare, prompts_match_card, stored, summary_line


class Stored(unittest.TestCase):
    def test_stored_cuts_and_renormalises(self):
        self.assertEqual(stored([0.6, 0.0, 0.8], 2), [1.0, 0.0])

    def test_stored_keeps_a_whole_vector_as_it_is(self):
        self.assertEqual(stored([0.6, 0.8], 2), [0.6, 0.8])

    def test_stored_refuses_more_than_it_has(self):
        with self.assertRaises(ValueError):
            stored([1.0, 0.0], 3)

    def test_stored_refuses_a_cut_with_no_length(self):
        with self.assertRaises(ValueError):
            stored([0.0, 0.0, 1.0], 2)


class Compare(unittest.TestCase):
    def test_compare_fails_below_the_threshold(self):
        r = compare([[1.0, 0.0], [1.0, 0.0]], [[1.0, 0.0], [0.6, 0.8]])
        self.assertEqual((r.passed, r.failures), (False, [1]))
        self.assertAlmostEqual(r.min_cosine, 0.6)

    def test_compare_passes_at_the_threshold(self):
        r = compare([[1.0, 0.0]], [[1.0, 0.0]])
        self.assertEqual(r, ParityResult(min_cosine=1.0, passed=True, failures=[]))

    def test_compare_takes_cosine_not_the_dot_product(self):
        r = compare([[2.0, 0.0]], [[0.5, 0.0]])
        self.assertTrue(r.passed)
        self.assertTrue(math.isclose(r.min_cosine, 1.0))

    def test_compare_refuses_lists_of_different_lengths(self):
        with self.assertRaises(ValueError):
            compare([[1.0]], [[1.0], [1.0]])
        with self.assertRaises(ValueError):
            compare([[1.0, 0.0]], [[1.0]])

    def test_compare_refuses_nothing_to_compare(self):
        with self.assertRaises(ValueError):
            compare([], [])


VOYAGE = {
    "id": "voyageai/voyage-4-nano", "servedDimensions": 4, "dimensions": 2,
    "queryPrefix": "Q: ", "documentPrefix": "D: ", "promptsFrom": "card",
}
STRINGS = {"queries": ["a", "b"], "documents": ["c"]}


class Check(unittest.TestCase):
    def test_prefixes_go_before_queries_and_documents(self):
        asked: list[list[str]] = []

        def encode(texts):
            asked.append(texts)
            return [[0.6, 0.0, 0.8, 0.0]] * len(texts)

        record = check(VOYAGE, "r" * 40, STRINGS, encode, encode, {"query": "Q: ", "document": "D: "})
        self.assertEqual(asked[0], ["Q: a", "Q: b", "D: c"])
        self.assertEqual(asked[0], asked[1])
        self.assertEqual(record["model"], "voyageai/voyage-4-nano")
        self.assertEqual((record["passed"], record["promptsMatchCard"], record["revision"]), (True, True, "r" * 40))
        self.assertAlmostEqual(record["minCosine"], 1.0)

    def test_the_cut_vectors_are_compared_not_the_whole_ones(self):
        # The two models differ only after the first 2 values, which Maester does not keep.
        reference = lambda texts: [[1.0, 0.0, 0.0, 1.0]] * len(texts)
        served = lambda texts: [[1.0, 0.0, 1.0, 0.0]] * len(texts)
        self.assertTrue(check(VOYAGE, "r", STRINGS, reference, served, None)["passed"])

    def test_a_different_served_vector_fails(self):
        reference = lambda texts: [[1.0, 0.0, 0.0, 0.0]] * len(texts)
        served = lambda texts: [[0.0, 1.0, 0.0, 0.0]] * len(texts)
        record = check(VOYAGE, "r", STRINGS, reference, served, None)
        self.assertEqual((record["passed"], record["minCosine"]), (False, 0.0))

    def test_a_server_that_does_not_serve_the_registry_dimensions_is_refused(self):
        # A TEI that loads voyage without its head answers 1024 values, not 2048.
        reference = lambda texts: [[1.0, 0.0, 0.0, 0.0]] * len(texts)
        served = lambda texts: [[1.0, 0.0]] * len(texts)
        with self.assertRaisesRegex(ValueError, "served vectors"):
            check(VOYAGE, "r", STRINGS, reference, served, None)

    def test_prompts_are_compared_only_when_they_come_from_the_card(self):
        card = {**VOYAGE, "promptsFrom": "card"}
        self.assertTrue(prompts_match_card(card, {"query": "Q: ", "document": "D: "}))
        self.assertFalse(prompts_match_card(card, {"query": "Q: ", "document": "other"}))
        self.assertFalse(prompts_match_card(card, None))
        self.assertTrue(prompts_match_card({**card, "queryPrefix": "Q: ", "documentPrefix": ""}, {"query": "Q: "}))
        self.assertTrue(prompts_match_card({**card, "promptsFrom": "ours"}, {"query": "a different one"}))
        self.assertTrue(prompts_match_card({**card, "promptsFrom": "none"}, None))

    def test_the_summary_line(self):
        record = {"model": "m", "revision": "r", "minCosine": 0.99994, "passed": True, "promptsMatchCard": True}
        self.assertEqual(summary_line(record), "m: passed, min cosine 0.9999, prompts match")
        record = {**record, "minCosine": 0.5, "passed": False, "promptsMatchCard": False}
        self.assertEqual(summary_line(record), "m: failed, min cosine 0.5000, prompts differ")


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "embedding_parity.py"
MODEL = "ibm-granite/granite-embedding-english-r2"  # 768 served and kept, prompts "none"


def load_script():
    spec = importlib.util.spec_from_file_location("embedding_parity", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Script(unittest.TestCase):
    """The command, with sentence-transformers and TEI replaced: no model is downloaded."""

    def run_script(self, reference_value: float, served_value: float, prompts: dict | None = None,
                   model: str = MODEL, dimensions: int = 768):
        script = load_script()
        asked: dict[str, list[str]] = {}

        class FakeModel:
            def __init__(self, name, revision=None, trust_remote_code=False):
                asked["init"] = [name, revision, trust_remote_code]
                self.prompts = prompts or {}

            def encode(self, texts, normalize_embeddings=False):
                asked["normalize"] = [normalize_embeddings]
                return FakeArray([[1.0] + [reference_value] * (dimensions - 1) for _ in texts])

        class FakeArray(list):
            def tolist(self):
                return list(self)

        def tei(url, texts):
            asked["tei"] = [url]
            return [[1.0] + [served_value] * (dimensions - 1) for _ in texts]

        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "parity.json"
            with mock.patch.dict(sys.modules, {"sentence_transformers": mock.Mock(SentenceTransformer=FakeModel)}), \
                    mock.patch.object(script, "tei_embed", tei), mock.patch("builtins.print") as printed:
                code = script.main(["--model", model, "--tei", "http://tei:80", "--out", str(out)])
            return code, json.loads(out.read_text(encoding="utf-8")), printed.call_args.args[0], asked

    def test_agreeing_vectors_pass_and_write_the_record(self):
        code, record, line, asked = self.run_script(0.5, 0.5)
        lock = json.loads(shipped_lock().read_text(encoding="utf-8"))
        revision = next(c["revision"] for c in lock["candidates"] if c["id"] == MODEL)
        self.assertEqual(code, 0)
        self.assertEqual(record["model"], MODEL)
        self.assertEqual(record["revision"], revision)
        self.assertEqual((record["passed"], record["promptsMatchCard"]), (True, True))
        self.assertEqual(set(record), {"model", "revision", "minCosine", "passed", "promptsMatchCard"})
        self.assertEqual(line, f"{MODEL}: passed, min cosine 1.0000, prompts match")
        self.assertEqual(asked["init"], [MODEL, revision, False])
        self.assertEqual(asked["normalize"], [True])

    def test_disagreeing_vectors_exit_1(self):
        code, record, line, _ = self.run_script(0.5, -0.5)
        self.assertEqual((code, record["passed"]), (1, False))
        self.assertIn("failed", line)

    def test_voyage_alone_runs_the_models_own_code(self):
        _, _, _, asked = self.run_script(
            0.5, 0.5, {"query": "Represent the query for retrieving supporting documents: ",
                       "document": "Represent the document for retrieval: "},
            model="voyageai/voyage-4-nano", dimensions=2048)
        self.assertTrue(asked["init"][2])

    def test_prompts_that_differ_from_the_registry_exit_1_even_when_the_vectors_agree(self):
        code, record, line, _ = self.run_script(
            0.5, 0.5, {"query": "something else"}, model="voyageai/voyage-4-nano", dimensions=2048)
        self.assertEqual((code, record["passed"], record["promptsMatchCard"]), (1, True, False))
        self.assertTrue(line.endswith("prompts differ"))

    def test_a_server_of_another_width_is_refused_with_no_record(self):
        script = load_script()

        class Reference:
            prompts: dict = {}

            def __init__(self, *args, **kwargs):
                pass

            def encode(self, texts, normalize_embeddings=False):
                return mock.Mock(tolist=lambda: [[1.0] * 768 for _ in texts])

        with tempfile.TemporaryDirectory() as folder, \
                mock.patch.dict(sys.modules, {"sentence_transformers": mock.Mock(SentenceTransformer=Reference)}), \
                mock.patch.object(script, "tei_embed", lambda url, texts: [[1.0, 0.0]] * len(texts)):
            out = Path(folder) / "parity.json"
            with self.assertRaises(SystemExit):
                script.main(["--model", MODEL, "--tei", "http://tei:80", "--out", str(out)])
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
