import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from huggingface_hub.utils import filter_repo_objects

from maester_indexer import fetch_models
from maester_indexer.fetch_models import EMBED_ALLOW_PATTERNS, EMBED_IGNORE_PATTERNS, main

# The files of Snowflake/snowflake-arctic-embed-l-v2.0 at the revision in models.lock.json.
ARCTIC_FILES = [
    ".gitattributes", "1_Pooling/config.json", "README.MD", "README.md", "config.json",
    "config_sentence_transformers.json", "model.safetensors", "modules.json", "onnx/model.onnx",
    "onnx/model.onnx_data", "onnx/model_O4.onnx", "onnx/model_bnb4.onnx", "onnx/model_fp16.onnx",
    "onnx/model_int8.onnx", "onnx/model_q4.onnx", "onnx/model_q4f16.onnx", "onnx/model_quantized.onnx",
    "onnx/model_uint8.onnx", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json",
    "tokenizer_config.json",
]


class EmbedPatterns(unittest.TestCase):
    def test_fetches_what_tei_and_the_tokenizer_load_and_no_onnx(self):
        kept = set(filter_repo_objects(ARCTIC_FILES, allow_patterns=list(EMBED_ALLOW_PATTERNS),
                                       ignore_patterns=list(EMBED_IGNORE_PATTERNS)))
        self.assertEqual(kept, {
            "1_Pooling/config.json", "config.json", "config_sentence_transformers.json", "model.safetensors",
            "modules.json", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json",
            "tokenizer_config.json",
        })

    def test_an_onnx_json_is_left_out_too(self):
        kept = list(filter_repo_objects(["onnx/config.json", "config.json"], allow_patterns=list(EMBED_ALLOW_PATTERNS),
                                        ignore_patterns=list(EMBED_IGNORE_PATTERNS)))
        self.assertEqual(kept, ["config.json"])

    def test_snapshot_download_is_given_the_patterns(self):
        lock = {"embedding": {"id": "Example/model", "revision": "a" * 40}}
        with mock.patch("huggingface_hub.snapshot_download") as download:
            fetch_models.fetch_embedding(Path("/models"), lock)
        download.assert_called_once_with(
            repo_id="Example/model", revision="a" * 40, local_dir=Path("/models/embed/Example/model"),
            allow_patterns=list(EMBED_ALLOW_PATTERNS), ignore_patterns=list(EMBED_IGNORE_PATTERNS),
        )


ARCTIC = "Snowflake/snowflake-arctic-embed-l-v2.0"
QWEN = "Qwen/Qwen3-Embedding-0.6B"
VOYAGE = "voyageai/voyage-4-nano"
GRANITE = "ibm-granite/granite-embedding-english-r2"


def fetched_ids(download: mock.MagicMock, out: Path) -> list[str]:
    """The repositories snapshot_download was asked for under <out>/embed/. Docling's own download
    calls snapshot_download too, into <out>/docling/, and is not counted."""
    embed = out / "embed"
    return [
        call.kwargs["repo_id"]
        for call in download.call_args_list
        if embed in Path(call.kwargs["local_dir"]).parents
    ]


class Candidates(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.out = Path(folder.name) / "models"
        self.lock = Path(folder.name) / "models.lock.json"
        self.lock.write_text(json.dumps({
            "embedding": {"id": ARCTIC, "revision": "a" * 40},
            "candidates": [
                {"id": QWEN, "revision": "b" * 40},
                {"id": VOYAGE, "revision": "c" * 40},
                {"id": GRANITE, "revision": "d" * 40},
            ],
            "docling": {},
        }), encoding="utf-8")

    def _main(self, *extra: str) -> int:
        return main(["--out", str(self.out), "--lock", str(self.lock), *extra])

    def test_candidates_are_fetched_only_when_asked(self):
        # fetch_docling is patched too: Docling's download_hf_model calls snapshot_download as well, and
        # RapidOcrModel.download_models goes to the network.
        with mock.patch("maester_indexer.fetch_models.fetch_docling"), mock.patch("huggingface_hub.snapshot_download") as download:
            self._main("--candidates")
            self.assertEqual(fetched_ids(download, self.out), [ARCTIC, QWEN, VOYAGE, GRANITE])
            download.reset_mock()
            self._main()
            self.assertEqual(fetched_ids(download, self.out), [ARCTIC])

    def test_each_candidate_is_fetched_at_its_revision_with_the_patterns(self):
        with mock.patch("maester_indexer.fetch_models.fetch_docling"), mock.patch("huggingface_hub.snapshot_download") as download:
            self._main("--candidates")
        download.assert_any_call(
            repo_id=VOYAGE, revision="c" * 40, local_dir=self.out / "embed" / VOYAGE,
            allow_patterns=list(EMBED_ALLOW_PATTERNS), ignore_patterns=list(EMBED_IGNORE_PATTERNS),
        )

    def test_the_lock_is_copied_last_and_not_at_all_when_a_candidate_fails(self):
        seen: list[bool] = []

        def download(**kwargs):
            seen.append((self.out / "models.lock.json").exists())
            if kwargs["repo_id"] == GRANITE:
                raise OSError("network")

        with mock.patch("maester_indexer.fetch_models.fetch_docling"), mock.patch("huggingface_hub.snapshot_download", side_effect=download):
            with self.assertRaises(OSError):
                self._main("--candidates")
        self.assertEqual(seen, [False] * 4)
        self.assertFalse((self.out / "models.lock.json").exists())
        with mock.patch("maester_indexer.fetch_models.fetch_docling"), mock.patch("huggingface_hub.snapshot_download"):
            self._main("--candidates")
        self.assertTrue((self.out / "models.lock.json").is_file())

    def test_a_lock_with_no_candidates_fetches_none(self):
        self.lock.write_text(json.dumps({"embedding": {"id": ARCTIC, "revision": "a" * 40}, "docling": {}}), encoding="utf-8")
        with mock.patch("maester_indexer.fetch_models.fetch_docling"), mock.patch("huggingface_hub.snapshot_download") as download:
            self._main("--candidates")
        self.assertEqual(fetched_ids(download, self.out), [ARCTIC])


if __name__ == "__main__":
    unittest.main()
