"""The JSON the harness hands to the worker's commands, and the shared fixtures that pin it.

`maester-eval ocr request` writes an `EvalRequestModel`: the filings the worker's eval commands read and, once the
retrieval set exists, the questions to rank. The worker reads it with a Zod twin of these models, and both sides read
`packages/contracts/fixtures/eval/request.json`, so a change to one shows as a failure in the other.

`maester-eval retrieval request` fills the questions. The worker's `eval sources`, `eval rank` and `eval bench` write
`EvalRankingsModel` and `EvalBenchModel` (the twins of `retrieval-eval.ts`), and the shared fixtures `rankings.json` and
`bench.json` pin them the same way. Their fields are camelCase on the wire.
`EvalParityModel` reads the record the indexer's parity check writes for a candidate model.

A question holds text from a filing's reader, so a request is a file under data/eval and never console output.
"""

import hashlib
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from maester_eval.errors import EvalError
from maester_eval.manifest import Filing, missing_files

# `[0-9]` and not `\d`: the pattern runs in Rust's regex engine here and in JavaScript's in the Zod twin, and `\d` is
# a Unicode class in the first only.
Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
QuestionId = Annotated[str, Field(pattern=r"^q[0-9]{3}$")]
# Zod's `z.uuid()`: a version 1 to 8 and an RFC 4122 variant. Not the nil and max UUIDs, which no row of ours holds.
Uuid = Annotated[str, Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")]
# `z.number().int()` refuses 1.5 and `1.0` is a whole number to JavaScript; strict mode takes the JSON integers and no bool.
WholeNumber = Annotated[int, Field(ge=0, strict=True)]
Page = Annotated[int, Field(ge=1, strict=True)]
Seconds = Annotated[float, Field(ge=0, allow_inf_nan=False)]
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


class _WireModel(BaseModel):
    """A model of what the worker writes: camelCase on the wire, snake_case in code, and no field the twin lacks."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


class EvalVersionsModel(_WireModel):
    index_version: str
    docling_version: str
    ocr_engine: str
    reader_options: str
    chunker_version: str


class EvalPageModel(_WireModel):
    page: Page
    source: Literal["text_layer", "ocr", "mixed", "none"]


class EvalDocumentModel(_WireModel):
    """A filing of the request as the workspace holds it for one model; a filing that is not stored has no ids."""

    filing: str
    sha256: Sha256
    document_id: Uuid | None
    revision_id: Uuid | None
    state: Literal["complete", "partial"] | None
    versions: EvalVersionsModel | None
    chunks: WholeNumber
    pages: list[EvalPageModel]


class EvalPageRefModel(_WireModel):
    filing: str
    page: Page


class EvalQuestionRankingModel(_WireModel):
    question_id: str
    vector: list[EvalPageRefModel]
    keyword: list[EvalPageRefModel]
    hybrid: list[EvalPageRefModel]


class EvalSourcesModel(_WireModel):
    version: Literal[1]
    model: str
    documents: list[EvalDocumentModel]


class EvalRankingsModel(EvalSourcesModel):
    """What `eval rank` writes: the sources, and each question's three rankings as page references with no text."""

    rankings: list[EvalQuestionRankingModel]


class EvalBenchModel(_WireModel):
    """What `eval bench` writes: seconds to embed `chunks` chunks in batches of `batch`, and the median of one query."""

    version: Literal[1]
    model: str
    batch: Annotated[int, Field(ge=1, strict=True)]
    chunks: WholeNumber
    warmup_chunks: WholeNumber
    seconds: Seconds
    queries: WholeNumber
    query_millis_median: Seconds


class EvalParityModel(_WireModel):
    """What the indexer's `scripts/embedding_parity.py` writes: the lowest cosine between TEI's vectors and the
    reference's, whether every cosine reached 0.999, and whether the registry's prefixes are the model card's prompts."""

    model: str
    revision: str
    min_cosine: Annotated[float, Field(allow_inf_nan=False)]
    passed: bool
    prompts_match_card: bool
