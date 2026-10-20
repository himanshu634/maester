"""Fetch the models the indexer runs on: ``maester-indexer-fetch-models --out /models``.

This is the only code that downloads anything; the service itself runs offline. It writes

    <out>/models.lock.json
    <out>/docling/...                  Docling's layout, TableFormer and RapidOCR artifacts
    <out>/embed/<embedding model id>   the embedding model, at the revision in models.lock.json

Docling is asked for each artifact at the revision models.lock.json records, not at `main`.
RapidOCR's weights come through Docling's own download, which takes them from ModelScope at
the tag that matches the pinned `rapidocr` version (recorded in the lock).
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

from maester_indexer.lockfile import LOCK_FILE, shipped_lock

# Docling's artifact folders: a repository id with "/" written "--".
DOCLING_REPOS = (
    "docling-project/docling-layout-heron",
    "docling-project/docling-layout-heron-onnx",
    "docling-project/docling-models",
)
# What text-embeddings-inference and the chunker's tokenizer load from the embedding model's
# repository: its configuration (config.json, the sentence-transformers files and
# 1_Pooling/config.json, which "*.json" matches because the match crosses "/"), the tokenizer
# files and the safetensors weights. The ONNX variants under onnx/ (several GB) are left out.
EMBED_ALLOW_PATTERNS = ("*.json", "*.safetensors", "sentencepiece.bpe.model", "vocab.txt", "merges.txt")
EMBED_IGNORE_PATTERNS = ("onnx/*", "openvino/*")


def find_lock(explicit: str | None) -> Path:
    """--lock, else INDEXER_MODELS_LOCK, else the lock in the image (/app) or beside pyproject.toml."""
    path = shipped_lock(explicit)
    if path is None:
        raise SystemExit(f"{LOCK_FILE} not found; pass --lock")
    return path


def fetch_docling(out: Path, lock: dict) -> None:
    from docling.models.stages.ocr.rapid_ocr_model import RapidOcrModel
    from docling.models.utils.hf_model_download import download_hf_model

    for repo in DOCLING_REPOS:
        revision = lock["docling"].get(repo)
        if not revision:
            raise SystemExit(f"{LOCK_FILE} has no revision for {repo}")
        download_hf_model(repo_id=repo, revision=revision, local_dir=out / "docling" / repo.replace("/", "--"))
    RapidOcrModel.download_models(backend="onnxruntime", local_dir=out / "docling" / RapidOcrModel._model_repo_folder)


def fetch_embedding(out: Path, lock: dict) -> None:
    from huggingface_hub import snapshot_download

    model = lock["embedding"]
    snapshot_download(
        repo_id=model["id"],
        revision=model["revision"],
        local_dir=out / "embed" / model["id"],
        allow_patterns=list(EMBED_ALLOW_PATTERNS),
        ignore_patterns=list(EMBED_IGNORE_PATTERNS),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="maester-indexer-fetch-models", description="Fetch the models the indexer runs on.")
    parser.add_argument("--out", required=True, type=Path, help="the models folder, e.g. /models")
    parser.add_argument("--lock", help=f"the {LOCK_FILE} to fetch at (default: the one shipped with the indexer)")
    parser.add_argument("--docling-only", action="store_true", help="skip the embedding model (for CI)")
    args = parser.parse_args(argv)

    lock_path = find_lock(args.lock)
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / LOCK_FILE).unlink(missing_ok=True)  # a fetch that fails partway must not read as finished
    fetch_docling(args.out, lock)
    if not args.docling_only:
        fetch_embedding(args.out, lock)
    # Last, so a lock beside the models means the fetch finished.
    shutil.copyfile(lock_path, args.out / LOCK_FILE)
    print(f"models are in {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
