"""The arithmetic of the embedding parity check (scripts/embedding_parity.py).

A candidate embedding model is served by text-embeddings-inference (TEI). The check encodes
fixed strings with sentence-transformers, the reference, and through TEI, then compares the
vectors Maester would store. A model whose TEI vectors differ from the reference (a pooling or a
tokenizer that TEI does not load the way the model card does) must not be measured through TEI.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

THRESHOLD = 0.999


@dataclass(frozen=True)
class ParityResult:
    min_cosine: float
    passed: bool
    failures: list[int]  # the positions whose cosine is below the threshold


def stored(vector: list[float], dimensions: int) -> list[float]:
    """The first `dimensions` values, cut to unit length again when any were cut. It mirrors
    `toStored` in packages/document-index/src/embedder.ts, without the padding with zeros
    (padding changes no cosine)."""
    if dimensions > len(vector):
        raise ValueError(f"cannot keep {dimensions} values of a vector of {len(vector)}")
    if dimensions == len(vector):
        return list(vector)
    kept = vector[:dimensions]
    norm = math.sqrt(sum(x * x for x in kept))
    if norm == 0:
        raise ValueError("the kept values have no length")
    return [x / norm for x in kept]


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"vectors of {len(a)} and {len(b)} values cannot be compared")
    norms = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    if norms == 0:
        raise ValueError("a vector has no length")
    return sum(x * y for x, y in zip(a, b, strict=True)) / norms


def compare(reference: list[list[float]], served: list[list[float]], threshold: float = THRESHOLD) -> ParityResult:
    """The lowest cosine between each reference vector and the vector at the same position."""
    if len(reference) != len(served):
        raise ValueError(f"{len(reference)} reference vectors and {len(served)} served vectors")
    if not reference:
        raise ValueError("nothing to compare")
    cosines = [_cosine(a, b) for a, b in zip(reference, served, strict=True)]
    failures = [i for i, cosine in enumerate(cosines) if cosine < threshold]
    return ParityResult(min_cosine=min(cosines), passed=not failures, failures=failures)


def prompts_match_card(entry: dict[str, Any], prompts: dict[str, str] | None) -> bool:
    """True when the registry takes its prefixes from somewhere other than the model card, or
    when the card's `query` and `document` prompts (none being the empty string) are the
    registry's prefixes."""
    if entry["promptsFrom"] != "card":
        return True
    prompts = prompts or {}
    return prompts.get("query", "") == entry["queryPrefix"] and prompts.get("document", "") == entry["documentPrefix"]


def summary_line(record: dict[str, Any]) -> str:
    """The one line the check prints, from the record it writes."""
    verdict = "passed" if record["passed"] else "failed"
    prompts = "match" if record["promptsMatchCard"] else "differ"
    return f"{record['model']}: {verdict}, min cosine {record['minCosine']:.4f}, prompts {prompts}"


def check(
    entry: dict[str, Any],
    revision: str,
    parity: dict[str, list[str]],
    reference: Callable[[list[str]], list[list[float]]],
    served: Callable[[list[str]], list[list[float]]],
    prompts: dict[str, str] | None,
) -> dict[str, Any]:
    """The record the check writes. The registry's prefixes go before each string, queries and
    documents alike, and `stored` is applied to both vectors before they are compared."""
    texts = [entry["queryPrefix"] + q for q in parity["queries"]] + [entry["documentPrefix"] + d for d in parity["documents"]]
    reference_vectors, served_vectors = reference(texts), served(texts)
    for name, vectors in (("reference", reference_vectors), ("served", served_vectors)):
        if len(vectors) != len(texts) or any(len(v) != entry["servedDimensions"] for v in vectors):
            raise ValueError(
                f"the {name} vectors are not {len(texts)} of {entry['servedDimensions']} values: "
                "the model is not served as the registry says"
            )
    dimensions = entry["dimensions"]
    result = compare([stored(v, dimensions) for v in reference_vectors], [stored(v, dimensions) for v in served_vectors])
    return {
        "model": entry["id"],
        "revision": revision,
        "minCosine": result.min_cosine,
        "passed": result.passed,
        "promptsMatchCard": prompts_match_card(entry, prompts),
    }
