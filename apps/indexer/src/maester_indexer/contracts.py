"""The indexer's wire contract: NDJSON events, the cached range read and the chunk request.

The Zod twins are in packages/contracts/src/document-index.ts; both are tested against the files in
packages/contracts/fixtures/index. The wire is camelCase.
"""

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic.alias_generators import to_camel

TextSource = Literal["text_layer", "ocr", "mixed", "xbrl"]
ChunkKind = Literal["prose", "table"]
PageNoneReason = Literal["NO_TEXT", "OCR_FAILED", "OCR_BUDGET"]
PageNumber = Annotated[int, Field(ge=1)]  # 1-based
Count = Annotated[int, Field(ge=0)]


class WireModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def to_wire(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)

    @classmethod
    def from_wire(cls, data: dict) -> Self:
        return cls.model_validate(data)


class IndexerVersions(WireModel):
    docling_version: str
    ocr_engine: str
    reader_options: str
    chunker_version: str
    tokenizer: str  # the model id whose tokenizer the indexer loaded


class RangePage(WireModel):
    page_number: PageNumber
    text: str
    items_text_layer: Count
    items_ocr: Count
    none_reason: PageNoneReason | None


class RangeRead(WireModel):
    first_page: PageNumber
    last_page: PageNumber
    page_count: PageNumber  # the whole PDF's
    ocr_on: bool
    versions: IndexerVersions
    document: dict[str, Any]  # Docling's export_to_dict(), opaque on the wire
    item_sources: dict[str, TextSource]  # by item self_ref
    pages: list[RangePage]


class ChunkRequest(WireModel):
    read: RangeRead
    section_path_before: list[str]
    embedding_model: str


class StartedEvent(WireModel):
    type: Literal["started"] = "started"
    versions: IndexerVersions
    page_count: PageNumber
    first_page: PageNumber
    last_page: PageNumber


class PageEvent(WireModel):
    type: Literal["page"] = "page"
    page_number: PageNumber
    text: str
    items_text_layer: Count
    items_ocr: Count
    none_reason: PageNoneReason | None
    section_path_after: list[str]


class ChunkEvent(WireModel):
    type: Literal["chunk"] = "chunk"
    page_number: PageNumber
    seq: Count
    kind: ChunkKind
    text_source: TextSource
    section_path: list[str]
    basis: Literal["consolidated", "standalone"] | None
    text: str
    token_count: Count


class ProgressEvent(WireModel):
    type: Literal["progress"] = "progress"
    stage: str
    percent: Annotated[float, Field(ge=0, le=100)]


class HeartbeatEvent(WireModel):
    type: Literal["heartbeat"] = "heartbeat"


class ResultEvent(WireModel):
    type: Literal["result"] = "result"
    read: RangeRead | None  # None from /v1/chunk, which reads nothing
    ocr_pages: Count


class ErrorEvent(WireModel):
    type: Literal["error"] = "error"
    code: str
    retryable: bool
    message: str


IndexerEvent = Annotated[
    StartedEvent | PageEvent | ChunkEvent | ProgressEvent | HeartbeatEvent | ResultEvent | ErrorEvent,
    Field(discriminator="type"),
]
INDEXER_EVENT = TypeAdapter(IndexerEvent)


def contextualize(section_path: list[str], text: str) -> str:
    """The text that is embedded for a chunk: the path's entries one per line, then the text.

    Just the text when the path is empty. The TypeScript twin is in @maester/contracts."""
    return "\n".join([*section_path, text])
