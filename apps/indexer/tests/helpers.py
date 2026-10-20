"""Helpers shared by the indexer's tests."""

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
