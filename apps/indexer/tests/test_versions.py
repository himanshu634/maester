import json
import tempfile
import unittest
from importlib.metadata import version
from pathlib import Path
from subprocess import CompletedProcess
from types import SimpleNamespace
from unittest import mock

from maester_indexer.lockfile import shipped_lock
from maester_indexer.versions import (
    CHUNKER_VERSION,
    DOCLING_VERSION,
    _run,
    models_hash,
    ocr_engine_version,
    reader_options,
    reader_version,
)

LOCK = {
    "embedding": {"id": "Snowflake/snowflake-arctic-embed-l-v2.0", "revision": "a" * 40},
    "docling": {
        "docling-project/docling-layout-heron": "1" * 40,
        "docling-project/docling-models": "2" * 40,
        "RapidAI/RapidOCR": "v3.9.2",
    },
}


FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures" / "index" / "embedding-models.json"


class Versions(unittest.TestCase):
    def test_candidates_do_not_change_the_reader_hash(self):  # live page_read keys stay valid
        self.assertEqual(
            models_hash({**LOCK, "candidates": [{"id": "Qwen/Qwen3-Embedding-0.6B", "revision": "b" * 40}]}),
            models_hash(LOCK),
        )

    def test_the_lock_names_every_registry_model(self):
        lock = json.loads(shipped_lock().read_text(encoding="utf-8"))
        ids = [lock["embedding"]["id"], *[c["id"] for c in lock["candidates"]]]
        self.assertEqual(sorted(ids), sorted(m["id"] for m in json.loads(FIXTURE.read_text(encoding="utf-8"))))
        for entry in [lock["embedding"], *lock["candidates"]]:
            self.assertRegex(entry["revision"], r"^[0-9a-f]{40}$")

    def test_versions_come_from_the_installed_packages_and_the_shipped_lock(self):
        lock = json.loads(shipped_lock().read_text(encoding="utf-8"))
        self.assertEqual(
            DOCLING_VERSION,
            f"docling={version('docling')};docling-core={version('docling-core')};"
            f"docling-ibm-models={version('docling-ibm-models')};docling-parse={version('docling-parse')};"
            f"models={models_hash(lock)}",
        )
        self.assertEqual(CHUNKER_VERSION, "1")

    def test_rapidocr_string_is_unchanged(self):
        # The live page_read keys depend on it, so a change here would read every page again.
        self.assertEqual(ocr_engine_version("rapidocr"), f"rapidocr-onnxruntime {version('rapidocr')}")

    def test_the_shipped_lock_is_the_one_beside_pyproject(self):
        self.assertEqual(shipped_lock(), Path(__file__).resolve().parents[1] / "models.lock.json")

    def test_reader_options(self):
        settings = SimpleNamespace(table_cell_matching=True, ocr_engine="rapidocr")
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=true;ocr=rapidocr")
        settings.table_cell_matching = False
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=false;ocr=rapidocr")

    def test_reader_options_name_the_engine(self):
        # Passes before the Tesseract change: a guard that the page_read key keeps naming the engine.
        self.assertEqual(
            reader_options(SimpleNamespace(table_cell_matching=True, ocr_engine="tesseract")),
            "table=accurate;cell_matching=true;ocr=tesseract",
        )


class OcrEngineVersion(unittest.TestCase):
    def test_tesseract_string_from_the_binary_and_its_language_data(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "eng.traineddata").write_bytes(b"eng")
            out = {
                "--version": "tesseract 5.5.0\n leptonica-1.84.1\n",
                "--list-langs": f'List of available languages in "{d}/" (1):\neng\n',
            }
            self.assertEqual(
                ocr_engine_version("tesseract", run=lambda a: out[a[1]]), "tesseract-cli 5.5.0 eng:82fe032bd933"
            )

    def test_the_language_data_changes_the_string(self):
        with tempfile.TemporaryDirectory() as d:
            out = {
                "--version": "tesseract 5.5.0\n",
                "--list-langs": f'List of available languages in "{d}/" (1):\neng\n',
            }
            Path(d, "eng.traineddata").write_bytes(b"eng")
            before = ocr_engine_version("tesseract", run=lambda a: out[a[1]])
            Path(d, "eng.traineddata").write_bytes(b"eng v2")
            self.assertNotEqual(ocr_engine_version("tesseract", run=lambda a: out[a[1]]), before)

    def test_a_missing_command_is_named(self):
        def missing(args):
            raise FileNotFoundError(args[0])

        with self.assertRaisesRegex(RuntimeError, "^tesseract is not installed$"):
            ocr_engine_version("tesseract", run=missing)

    def test_a_tesseract_with_no_readable_version_or_language_folder_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            cases = {
                "no version": {"--version": "\n", "--list-langs": f'List of available languages in "{d}/" (1):\neng\n'},
                "no folder in the header": {"--version": "tesseract 5.5.0\n", "--list-langs": "List of available languages (1):\neng\n"},
                "no eng.traineddata there": {"--version": "tesseract 5.5.0\n", "--list-langs": f'List of available languages in "{d}/" (1):\nosd\n'},
            }
            for name, out in cases.items():
                with self.subTest(name), self.assertRaises(RuntimeError):
                    ocr_engine_version("tesseract", run=lambda a, out=out: out[a[1]])

    def test_an_unknown_engine_is_refused(self):
        with self.assertRaises(ValueError):
            ocr_engine_version("claude")

    def test_run_returns_stdout(self):
        done = CompletedProcess([], 0, stdout="tesseract 5.5.0\n", stderr="noise\n")
        with mock.patch("maester_indexer.versions.subprocess.run", return_value=done):
            self.assertEqual(_run(["tesseract", "--version"]), "tesseract 5.5.0\n")

    def test_run_falls_back_to_stderr(self):
        # A Linux tesseract prints --version to stderr (Docling reads both for the same reason).
        done = CompletedProcess([], 0, stdout="", stderr="tesseract 5.3.0\n")
        with mock.patch("maester_indexer.versions.subprocess.run", return_value=done):
            self.assertEqual(_run(["tesseract", "--version"]), "tesseract 5.3.0\n")


class ModelsHash(unittest.TestCase):
    def test_is_twelve_hex_characters(self):
        self.assertRegex(models_hash(LOCK), r"^[0-9a-f]{12}$")

    def test_changes_with_any_docling_artifact(self):
        for repo in LOCK["docling"]:
            changed = {**LOCK, "docling": {**LOCK["docling"], repo: "3" * 40}}
            self.assertNotEqual(models_hash(changed), models_hash(LOCK), repo)
        added = {**LOCK, "docling": {**LOCK["docling"], "docling-project/another": "4" * 40}}
        self.assertNotEqual(models_hash(added), models_hash(LOCK))

    def test_ignores_key_order_spacing_and_the_embedding_model(self):
        reordered = json.loads(json.dumps({"docling": dict(reversed(list(LOCK["docling"].items())))}, indent=4))
        self.assertEqual(models_hash(reordered), models_hash(LOCK))
        other_model = {**LOCK, "embedding": {"id": "Example/other", "revision": "b" * 40}}
        self.assertEqual(models_hash(other_model), models_hash(LOCK))

    def test_refuses_a_lock_with_no_docling_section(self):
        for lock in ({"embedding": LOCK["embedding"]}, {**LOCK, "docling": {}}):
            with self.assertRaises(RuntimeError):
                models_hash(lock)


class ReaderVersion(unittest.TestCase):
    def test_a_changed_lock_alone_changes_the_reader_version(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "models.lock.json"
            path.write_text(json.dumps(LOCK), encoding="utf-8")
            before = reader_version(path)
            changed = {**LOCK, "docling": {**LOCK["docling"], "RapidAI/RapidOCR": "v3.9.3"}}
            path.write_text(json.dumps(changed), encoding="utf-8")
            self.assertNotEqual(reader_version(path), before)
            self.assertEqual(reader_version(path).rsplit(";", 1)[0], before.rsplit(";", 1)[0])

    def test_names_each_reader_package(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "models.lock.json"
            path.write_text(json.dumps(LOCK), encoding="utf-8")
            value = reader_version(path)
        for name in ("docling", "docling-core", "docling-ibm-models", "docling-parse"):
            self.assertIn(f"{name}={version(name)};", value)

    def test_refuses_no_lock(self):
        with self.assertRaises(RuntimeError):
            reader_version(None)


if __name__ == "__main__":
    unittest.main()
