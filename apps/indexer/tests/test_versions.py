import json
import tempfile
import unittest
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace

from maester_indexer.lockfile import shipped_lock
from maester_indexer.versions import (
    CHUNKER_VERSION,
    DOCLING_VERSION,
    OCR_ENGINE,
    models_hash,
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


class Versions(unittest.TestCase):
    def test_versions_come_from_the_installed_packages_and_the_shipped_lock(self):
        lock = json.loads(shipped_lock().read_text(encoding="utf-8"))
        self.assertEqual(
            DOCLING_VERSION,
            f"docling={version('docling')};docling-core={version('docling-core')};"
            f"docling-ibm-models={version('docling-ibm-models')};docling-parse={version('docling-parse')};"
            f"models={models_hash(lock)}",
        )
        self.assertEqual(OCR_ENGINE, f"rapidocr-onnxruntime {version('rapidocr')}")
        self.assertEqual(CHUNKER_VERSION, "1")

    def test_the_shipped_lock_is_the_one_beside_pyproject(self):
        self.assertEqual(shipped_lock(), Path(__file__).resolve().parents[1] / "models.lock.json")

    def test_reader_options(self):
        settings = SimpleNamespace(table_cell_matching=True, ocr_engine="rapidocr")
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=true;ocr=rapidocr")
        settings.table_cell_matching = False
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=false;ocr=rapidocr")


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
