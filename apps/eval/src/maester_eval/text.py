"""Label normalisation, the same as apps/api/src/financials/stitch.ts `normalise`."""

import re

_NOT_WORD = re.compile(r"[^\w\s]|_")
_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    """Lower-case, "&" as "and", punctuation dropped, whitespace collapsed."""
    return _SPACES.sub(" ", _NOT_WORD.sub(" ", text.lower().replace("&", " and "))).strip()
