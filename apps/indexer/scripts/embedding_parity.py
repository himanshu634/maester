"""Check that TEI serves a candidate embedding model the way the model card says.

    uv run --group parity python scripts/embedding_parity.py \\
        --model Qwen/Qwen3-Embedding-0.6B --tei http://localhost:8080 --out parity-qwen.json

It encodes the strings of packages/contracts/fixtures/index/embedding-parity.json, with the
registry's prefixes before them, with sentence-transformers (the reference, at the revision in
models.lock.json) and through TEI's /embed. It keeps the vectors Maester would store (the first
`dimensions` values, renormalised when cut) and compares them. Exit 0 only when every cosine is
at least 0.999 and the model card's prompts are the registry's prefixes.

The sentence-transformers group is for development only: it is not in the image. The model is
downloaded from Hugging Face by sentence-transformers, so run this on a machine that may do so.
voyageai/voyage-4-nano runs the repository's own modeling code (trust_remote_code); that code
was read at the pinned revision first (apps/indexer/README.md).
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from maester_indexer.lockfile import shipped_lock
from maester_indexer.parity import check, summary_line

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "fixtures" / "index"
TRUSTS_REMOTE_CODE = "voyageai/voyage-4-nano"


def locked_revision(model: str) -> str:
    path = shipped_lock()
    if path is None:
        raise SystemExit("models.lock.json not found; set INDEXER_MODELS_LOCK")
    lock = json.loads(path.read_text(encoding="utf-8"))
    for entry in [lock["embedding"], *lock.get("candidates", [])]:
        if entry["id"] == model:
            return entry["revision"]
    raise SystemExit(f"{model} is not in models.lock.json")


def tei_embed(url: str, texts: list[str]) -> list[list[float]]:
    body = json.dumps({"inputs": texts, "normalize": True, "truncate": False}).encode("utf-8")
    request = urllib.request.Request(
        url.rstrip("/") + "/embed", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as answer:
            return json.loads(answer.read())
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise SystemExit(f"TEI did not answer /embed at {url}: {type(error).__name__}") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare TEI's vectors for a candidate model with sentence-transformers'.")
    parser.add_argument("--model", required=True, help="a model id in the registry and in models.lock.json")
    parser.add_argument("--tei", required=True, help="the base URL of the TEI serving that model")
    parser.add_argument("--out", required=True, type=Path, help="where to write the record (JSON)")
    args = parser.parse_args(argv)

    entries = {m["id"]: m for m in json.loads((FIXTURES / "embedding-models.json").read_text(encoding="utf-8"))}
    if args.model not in entries:
        raise SystemExit(f"{args.model} is not in the registry")
    entry = entries[args.model]
    revision = locked_revision(args.model)
    parity = json.loads((FIXTURES / "embedding-parity.json").read_text(encoding="utf-8"))

    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(
        args.model, revision=revision, trust_remote_code=(args.model == TRUSTS_REMOTE_CODE)
    )

    def reference(texts: list[str]) -> list[list[float]]:
        return model.encode(texts, normalize_embeddings=True).tolist()

    try:
        record = check(entry, revision, parity, reference, lambda texts: tei_embed(args.tei, texts), model.prompts)
    except ValueError as error:
        raise SystemExit(f"{args.model}: {error}") from None
    args.out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(summary_line(record))
    return 0 if record["passed"] and record["promptsMatchCard"] else 1


if __name__ == "__main__":
    sys.exit(main())
