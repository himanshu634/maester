"""Helpers shared by the indexer's tests."""

import logging
import warnings

from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import WhitespaceSplit
from transformers import PreTrainedTokenizerFast


def whitespace_tokenizer(max_tokens: int) -> HuggingFaceTokenizer:
    """A tokenizer built in code, with no download: one token per run of non-space characters.

    Every word is the unknown token, which is all a chunker needs to count."""
    model = Tokenizer(WordLevel(vocab={"[UNK]": 0}, unk_token="[UNK]"))
    model.pre_tokenizer = WhitespaceSplit()
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
