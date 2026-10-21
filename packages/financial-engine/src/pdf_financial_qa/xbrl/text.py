"""The text blocks of an instance: long notes written as escaped HTML, turned into plain text for the index.

A text block is a non-numeric fact whose element ends in one of the format rules' ``text_suffixes``
(``TextBlock`` or ``Explanatory``), with or without a dimension. ``html_to_text`` keeps the lines and the table
rows and nothing else; ``element_heading`` gives the block a heading from its element's name. The text is document
content: it is never logged.
"""

import re
from html.parser import HTMLParser

from .contracts import XbrlTextBlock
from .formats import TEXT_SUFFIXES
from .parser import Instance

# A tag that ends the line it is on. ``br`` is handled apart: it always breaks, so ``<br><br>`` is a blank line.
_LINE_TAGS = frozenset({"p", "div", "li", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6"})
_CELL_TAGS = frozenset({"td", "th"})
_SKIPPED = frozenset({"script", "style"})
_CELL_JOIN = " | "


class _TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)  # entities are unescaped in the data it hands over
        self.lines: list[str] = []
        self._line: list[str] = []
        self._cells = 0  # cells already seen in the current row
        self._skipped = 0  # depth inside script or style

    def _end_line(self, *, force: bool = False) -> None:
        text = "".join(self._line)
        if force or text.strip():
            self.lines.append(text)
        self._line = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in _SKIPPED:
            self._skipped += 1
        elif tag == "br":
            self._end_line(force=True)
        elif tag in _CELL_TAGS:
            if self._cells:
                self._line.append(_CELL_JOIN)
            self._cells += 1
        elif tag in _LINE_TAGS:
            self._end_line()
            if tag in ("tr", "table"):
                self._cells = 0

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        # ``<br/>`` and ``<td/>`` are a start and an end in one; a skipped tag has no content to skip.
        if tag not in _SKIPPED:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED:
            self._skipped = max(0, self._skipped - 1)
        elif tag in _LINE_TAGS:
            self._end_line()
            if tag in ("tr", "table"):
                self._cells = 0

    def handle_data(self, data: str) -> None:
        if self._skipped:
            return
        first, *rest = data.replace("\r\n", "\n").replace("\r", "\n").split("\n")
        self._line.append(first)
        for part in rest:  # a line break in the text is a line break
            self._end_line(force=True)
            self._line.append(part)

    def finish(self) -> list[str]:
        self.close()
        self._end_line()
        return self.lines


def html_to_text(html: str) -> str:
    """Plain text from escaped HTML. ``p``, ``div``, ``br``, ``li``, ``tr``, ``h1`` to ``h6`` and ``table`` end a
    line, ``td`` and ``th`` are joined by `` | ``, ``script`` and ``style`` are dropped, entities are unescaped,
    spaces collapse within a line, blank lines collapse to one, and the result is stripped."""
    parser = _TextParser()
    parser.feed(html)
    out: list[str] = []
    for line in parser.finish():
        text = re.sub(r"\s+", " ", line).strip()
        if text or (out and out[-1]):
            out.append(text)
    return "\n".join(out).strip()


# The longest suffix first, so ``ExplanatoryTextBlock`` goes whole and not as ``TextBlock``.
_HEADING_SUFFIXES = ("ExplanatoryTextBlock", "TextBlock", "Explanatory")
# A new word starts at a capital after a lower-case letter or a digit, and at the last capital of a run before a
# lower-case letter ("IndASAnd" is Ind, AS, And).
_WORD_START = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def element_heading(element: str) -> str:
    """A heading from an element's name: the suffix goes (when nothing else would be left), CamelCase splits into
    words, and the first word keeps its capital while the rest are lower case:
    ``DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock`` is ``Disclosure of notes on financial results``."""
    name = element
    for suffix in _HEADING_SUFFIXES:
        if element.endswith(suffix) and len(element) > len(suffix):
            name = element[: -len(suffix)]
            break
    words = _WORD_START.sub(" ", name).split()
    return " ".join([words[0], *(word.lower() for word in words[1:])]) if words else element


def text_blocks(instance: Instance) -> list[XbrlTextBlock]:
    """The instance's text blocks in document order. A block with no text is dropped, and so is a repeat of an
    ``(element, text)`` pair that came before it, whatever its context."""
    blocks: list[XbrlTextBlock] = []
    seen: set[tuple[str, str]] = set()
    for fact in instance.facts:
        if fact.unit_id is not None or not fact.element.endswith(TEXT_SUFFIXES):
            continue
        text = html_to_text(fact.text)
        if not text or (fact.element, text) in seen:
            continue
        seen.add((fact.element, text))
        blocks.append(XbrlTextBlock(element=fact.element, context_id=fact.context_id, heading=element_heading(fact.element), text=text))
    return blocks
