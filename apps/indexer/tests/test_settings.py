import unittest

from maester_indexer.settings import Settings
from maester_indexer.versions import reader_options


class FromEnv(unittest.TestCase):
    def test_defaults(self):
        settings = Settings.from_env({})
        self.assertEqual(
            settings,
            Settings(
                secret=None,
                max_bytes=52428800,
                threads=6,
                page_batch=4,
                table_cell_matching=True,
                tokenizer_path=None,
                artifacts_path=None,
                ocr_engine="rapidocr",
                embedding_model="Snowflake/snowflake-arctic-embed-l-v2.0",
            ),
        )
        self.assertEqual(reader_options(settings), "table=accurate;cell_matching=true;ocr=rapidocr")

    def test_values_from_the_environment(self):
        settings = Settings.from_env(
            {
                "INDEXER_SECRET": "s3",
                "INDEX_MAX_BYTES": "1024",
                "INDEX_THREADS": "2",
                "INDEX_PAGE_BATCH": "1",
                "INDEX_TABLE_CELL_MATCHING": "false",
                "INDEX_TOKENIZER_PATH": "/models/tokenizer",
                "DOCLING_ARTIFACTS_PATH": "/models/docling",
                "OCR_ENGINE": "rapidocr",
                "EMBEDDING_MODEL": "Qwen/Qwen3-Embedding-0.6B",
            }
        )
        self.assertEqual(
            (settings.secret, settings.max_bytes, settings.threads, settings.page_batch, settings.table_cell_matching),
            ("s3", 1024, 2, 1, False),
        )
        self.assertEqual(
            (settings.tokenizer_path, settings.artifacts_path, settings.embedding_model),
            ("/models/tokenizer", "/models/docling", "Qwen/Qwen3-Embedding-0.6B"),
        )

    def test_empty_values_mean_unset(self):
        settings = Settings.from_env({"INDEXER_SECRET": "", "DOCLING_ARTIFACTS_PATH": "", "INDEX_THREADS": ""})
        self.assertEqual((settings.secret, settings.artifacts_path, settings.threads), (None, None, 6))

    def test_a_switch_takes_true_or_false_only(self):
        self.assertTrue(Settings.from_env({"INDEX_TABLE_CELL_MATCHING": "TRUE"}).table_cell_matching)
        with self.assertRaises(ValueError):
            Settings.from_env({"INDEX_TABLE_CELL_MATCHING": "no"})

    def test_counts_must_be_positive(self):
        for name in ("INDEX_MAX_BYTES", "INDEX_THREADS", "INDEX_PAGE_BATCH"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                Settings.from_env({name: "0"})

    def test_tesseract_is_an_ocr_engine(self):
        self.assertEqual(Settings.from_env({"OCR_ENGINE": "tesseract"}).ocr_engine, "tesseract")

    def test_other_ocr_engines_are_refused(self):
        # Claude OCR (spec 8.1) is not built; naming it must not silently read with RapidOCR.
        for engine in ("claude", "easyocr"):
            with self.subTest(engine=engine), self.assertRaisesRegex(
                ValueError, "OCR_ENGINE must be one of rapidocr, tesseract"
            ):
                Settings.from_env({"OCR_ENGINE": engine})


if __name__ == "__main__":
    unittest.main()
