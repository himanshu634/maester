"""Helpers shared by the indexer's tests."""

import json
import logging
import warnings
from pathlib import Path

from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from docling_core.types.doc import DoclingDocument
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import WhitespaceSplit
from tokenizers.processors import TemplateProcessing
from transformers import PreTrainedTokenizerFast

from maester_indexer.contracts import RangeRead


def whitespace_tokenizer(max_tokens: int, special_tokens: bool = False) -> HuggingFaceTokenizer:
    """A tokenizer built in code, with no download: one token per run of non-space characters.

    Every word is the unknown token, which is all a chunker needs to count. With
    `special_tokens`, the model adds a start and an end token to each text, as a real
    embedding model's does."""
    model = Tokenizer(WordLevel(vocab={"[UNK]": 0, "[CLS]": 1, "[SEP]": 2}, unk_token="[UNK]"))
    model.pre_tokenizer = WhitespaceSplit()
    if special_tokens:
        model.post_processor = TemplateProcessing(single="[CLS] $A [SEP]", special_tokens=[("[CLS]", 1), ("[SEP]", 2)])
    return HuggingFaceTokenizer(
        tokenizer=PreTrainedTokenizerFast(tokenizer_object=model, unk_token="[UNK]"),
        max_tokens=max_tokens,
    )


def quiet_docling() -> None:
    """Keep the test output to the results: Docling reads its own deprecated fields,
    RapidOCR logs each model it loads, and transformers draws a progress bar."""
    from rapidocr.utils.log import logger as rapidocr_logger
    from transformers.utils.logging import disable_progress_bar

    for message in (
        "`force_full_page_ocr` is deprecated",
        "This field is deprecated. Use `generate_page_images=True`",
        "deprecated",
    ):
        warnings.filterwarnings("ignore", message=message, category=DeprecationWarning, module=r"(docling|pydantic)\.")
    # RapidOCR resets its logger's level each time it loads a model, so filter instead.
    rapidocr_logger.addFilter(lambda record: record.levelno >= logging.WARNING)
    logging.getLogger("torch.distributed.elastic.multiprocessing.redirects").setLevel(logging.ERROR)
    disable_progress_bar()


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def fixture_read(name: str, pages: tuple[int, int] | None = None) -> RangeRead:
    """A saved range read (`tests/fixtures/<name>.read.json`), or a part of it as if only
    pages first..last had been read: the document filtered to them, its item sources
    renumbered with it, and only those pages' page reads."""
    read = RangeRead.from_wire(json.loads((FIXTURES / f"{name}.read.json").read_text(encoding="utf-8")))
    return read if pages is None else restrict_read(read, pages)


def restrict_read(read: RangeRead, pages: tuple[int, int]) -> RangeRead:
    """The read as if only pages first..last had been read (see `fixture_read`)."""
    from maester_indexer.chunker import filter_document

    first, last = pages
    document, original_refs = filter_document(
        DoclingDocument.model_validate(read.document), set(range(first, last + 1))
    )
    return read.model_copy(
        update={
            "first_page": first,
            "last_page": last,
            "document": document.export_to_dict(),
            "item_sources": {
                ref: read.item_sources[original]
                for ref, original in original_refs.items()
                if original in read.item_sources
            },
            "pages": [page for page in read.pages if first <= page.page_number <= last],
        }
    )
