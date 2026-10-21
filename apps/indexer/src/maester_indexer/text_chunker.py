"""Chunking XBRL text blocks (spec section 8.1).

A text block is plain text the extractor made from an instance's explanatory HTML, with a
heading. It is split on blank lines into paragraphs; a paragraph whose every line holds
" | " is a table paragraph (the extractor writes a table row as cells joined by " | ").
Paragraphs are packed in order into chunks while the embedded text, the heading and the
chunk, fits the budget the PDF chunker uses: the tokenizer's `get_max_tokens()` (CHUNK_TOKENS
in production) and, in all, the most the embedding model takes. A paragraph over it is cut
by lines, then by words, then, for one word that alone is over it, by characters.

A chunk never crosses a block, so each has one element and one heading. `seq` counts from 0
across all the blocks. The section path is the heading; a heading over PATH_TOKENS is left
out, as the PDF chunker leaves out an outer heading that does not fit, and a blank heading
is no path.
"""

from collections.abc import Callable

from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer

from maester_indexer.chunker import cut_path, embed_budget, fit_path
from maester_indexer.contracts import ChunkTextBlock, TextChunk, contextualize
from maester_indexer.errors import IndexingError

TABLE_CELL_SEPARATOR = " | "
_Fits = Callable[[str], bool]
_Unit = tuple[str, bool]  # a paragraph (or a cut of one) and whether it is a table paragraph


def chunk_text_blocks(
    blocks: list[ChunkTextBlock], basis: str | None, tokenizer: BaseTokenizer
) -> list[TextChunk]:
    """The chunks of the blocks, in order. `tokenizer` carries the chunker's budget (`get_max_tokens()`)."""
    budget = min(tokenizer.get_max_tokens(), embed_budget(tokenizer))
    chunks: list[TextChunk] = []
    for block in blocks:
        heading = block.heading.strip()
        path = cut_path([heading] if heading else [], tokenizer)
        # A path that leaves no room for a word cannot head any chunk.
        while path and tokenizer.count_tokens(contextualize(path, "x")) > budget:
            path = path[1:]

        def fits(text: str, path: list[str] = path) -> bool:
            return tokenizer.count_tokens(contextualize(path, text)) <= budget

        for text, kind in _pack(_units(block.text, fits), fits):
            shown = fit_path(path, text, tokenizer)
            token_count = tokenizer.count_tokens(contextualize(shown, text))
            if token_count > budget:
                # A tokenizer that counts a cut piece over its parts; no text in the message.
                raise IndexingError(
                    "INDEX_FAILED", f"A text chunk came to {token_count} tokens, over the {budget} allowed.", False
                )
            chunks.append(
                TextChunk(
                    element=block.element,
                    seq=len(chunks),
                    kind=kind,
                    section_path=shown,
                    basis=basis,
                    text=text,
                    token_count=token_count,
                )
            )
    return chunks


def _paragraphs(text: str) -> list[str]:
    """The text's paragraphs: runs of lines between blank lines, each line stripped."""
    paragraphs: list[list[str]] = [[]]
    for line in text.splitlines():
        if line.strip():
            paragraphs[-1].append(line.strip())
        elif paragraphs[-1]:
            paragraphs.append([])
    return ["\n".join(lines) for lines in paragraphs if lines]


def _is_table(paragraph: str) -> bool:
    return all(TABLE_CELL_SEPARATOR in line for line in paragraph.split("\n"))


def _units(text: str, fits: _Fits) -> list[_Unit]:
    """Each paragraph that fits as it is, and each cut of one that does not; a cut keeps its paragraph's kind."""
    units: list[_Unit] = []
    for paragraph in _paragraphs(text):
        table = _is_table(paragraph)
        units.extend((piece, table) for piece in _cut_to_fit(paragraph, fits))
    return units


def _cut_to_fit(paragraph: str, fits: _Fits) -> list[str]:
    if fits(paragraph):
        return [paragraph]
    return _greedy(paragraph.split("\n"), "\n", fits, lambda line: _greedy(line.split(), " ", fits, lambda word: _cut_chars(word, fits)))


def _greedy(parts: list[str], separator: str, fits: _Fits, cut: Callable[[str], list[str]]) -> list[str]:
    """The parts joined by `separator` in groups that fit; a part that does not fit alone goes through `cut`."""
    out: list[str] = []
    current: list[str] = []
    for part in parts:
        if not fits(part):
            if current:
                out.append(separator.join(current))
                current = []
            out.extend(cut(part))
        elif current and not fits(separator.join([*current, part])):
            out.append(separator.join(current))
            current = [part]
        else:
            current.append(part)
    if current:
        out.append(separator.join(current))
    return out


def _cut_chars(word: str, fits: _Fits) -> list[str]:
    """A word cut into the longest prefixes that fit (at least one character each, so it ends)."""
    out: list[str] = []
    rest = word
    while rest:
        low, high = 1, len(rest)
        while low < high:
            middle = (low + high + 1) // 2
            if fits(rest[:middle]):
                low = middle
            else:
                high = middle - 1
        out.append(rest[:low])
        rest = rest[low:]
    return out


def _pack(units: list[_Unit], fits: _Fits) -> list[tuple[str, str]]:
    """The units joined by a blank line in groups that fit, each with its kind: `table` when every unit is."""
    out: list[tuple[str, str]] = []
    current: list[_Unit] = []

    def flush() -> None:
        if current:
            kind = "table" if all(table for _, table in current) else "prose"
            out.append(("\n\n".join(text for text, _ in current), kind))
            current.clear()

    for unit in units:
        if current and not fits("\n\n".join([*(text for text, _ in current), unit[0]])):
            flush()
        current.append(unit)
    flush()
    return out
