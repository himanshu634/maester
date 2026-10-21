"""The JSON the harness hands to the worker's commands, and the shared fixtures that pin it.

`maester-eval ocr request` writes an `EvalRequestModel`: the filings the worker's eval commands read and, once the
retrieval set exists, the questions to rank. The worker reads it with a Zod twin of these models, and both sides read
`packages/contracts/fixtures/eval/request.json`, so a change to one shows as a failure in the other.

A question holds text from a filing's reader, so a request is a file under data/eval and never console output.
"""

import hashlib
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from maester_eval.errors import EvalError
from maester_eval.manifest import Filing, missing_files

# `[0-9]` and not `\d`: the pattern runs in Rust's regex engine here and in JavaScript's in the Zod twin, and `\d` is
# a Unicode class in the first only.
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
QuestionId = Annotated[str, Field(pattern=r"^q[0-9]{3}$")]
_CHUNK = 1 << 20


class DocumentRef(BaseModel):
    """A filing of the corpus, by the id the manifest gives it and the sha256 of its PDF."""

    model_config = ConfigDict(extra="forbid")

    filing: str
    sha256: Sha256


class RequestQuestion(BaseModel):
    """A question and the filings it is searched within."""

    model_config = ConfigDict(extra="forbid")

    id: QuestionId
    query: Annotated[str, Field(min_length=1, max_length=500)]
    scope: Annotated[list[str], Field(min_length=1)]


class EvalRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    documents: list[DocumentRef]
    questions: list[RequestQuestion]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def document_refs(filings: list[Filing], corpus_dir: Path) -> list[DocumentRef]:
    """The sha256 of each filing's PDF, in the order given. A PDF the corpus lacks is an `EvalError` that names it.

    Every missing file is named at once, so the corpus is fixed in one pass."""
    absent = missing_files(filings, corpus_dir)
    if absent:
        raise EvalError(f"missing under {corpus_dir}: " + ", ".join(absent))
    return [DocumentRef(filing=f.id, sha256=_sha256(corpus_dir / f.file)) for f in filings]
