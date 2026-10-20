import unittest
from pathlib import Path
from unittest import mock

from huggingface_hub.utils import filter_repo_objects

from maester_indexer import fetch_models
from maester_indexer.fetch_models import EMBED_ALLOW_PATTERNS, EMBED_IGNORE_PATTERNS

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


if __name__ == "__main__":
    unittest.main()
