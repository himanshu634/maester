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
import os
import shutil
import sys
from pathlib import Path

LOCK_FILE = "models.lock.json"
# Docling's artifact folders: a repository id with "/" written "--".
DOCLING_REPOS = (
    "docling-project/docling-layout-heron",
    "docling-project/docling-layout-heron-onnx",
    "docling-project/docling-models",
)


def find_lock(explicit: str | None) -> Path:
    """--lock, else INDEXER_MODELS_LOCK, else the lock in the image (/app) or beside pyproject.toml."""
    candidates = [explicit, os.environ.get("INDEXER_MODELS_LOCK"), "/app/" + LOCK_FILE,
                  str(Path(__file__).resolve().parents[2] / LOCK_FILE)]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise SystemExit(f"{LOCK_FILE} not found; pass --lock")


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
    snapshot_download(repo_id=model["id"], revision=model["revision"], local_dir=out / "embed" / model["id"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="maester-indexer-fetch-models", description="Fetch the models the indexer runs on.")
    parser.add_argument("--out", required=True, type=Path, help="the models folder, e.g. /models")
    parser.add_argument("--lock", help=f"the {LOCK_FILE} to fetch at (default: the one shipped with the indexer)")
    parser.add_argument("--docling-only", action="store_true", help="skip the embedding model (for CI)")
    args = parser.parse_args(argv)

    lock_path = find_lock(args.lock)
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)
    fetch_docling(args.out, lock)
    if not args.docling_only:
        fetch_embedding(args.out, lock)
    # Last, so a lock beside the models means the fetch finished.
    shutil.copyfile(lock_path, args.out / LOCK_FILE)
    print(f"models are in {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
