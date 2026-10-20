import unittest
from importlib.metadata import version
from types import SimpleNamespace

from maester_indexer.versions import CHUNKER_VERSION, DOCLING_VERSION, OCR_ENGINE, reader_options


class Versions(unittest.TestCase):
    def test_versions_come_from_the_installed_packages(self):
        self.assertEqual(DOCLING_VERSION, version("docling"))
        self.assertEqual(OCR_ENGINE, f"rapidocr-onnxruntime {version('rapidocr')}")
        self.assertEqual(CHUNKER_VERSION, "1")

    def test_reader_options(self):
        settings = SimpleNamespace(table_cell_matching=True, ocr_engine="rapidocr")
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=true;ocr=rapidocr")
        settings.table_cell_matching = False
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=false;ocr=rapidocr")


if __name__ == "__main__":
    unittest.main()
