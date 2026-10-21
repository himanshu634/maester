"""Chunking XBRL text blocks: no models, a whitespace tokenizer built in code."""

import unittest

from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer

from maester_indexer.chunker import MAX_EMBED_TOKENS, embed_budget
from maester_indexer.contracts import ChunkTextBlock, contextualize
from maester_indexer.text_chunker import chunk_text_blocks
from tests.helpers import whitespace_tokenizer

ELEMENT = "DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock"


def block(heading: str, text: str, element: str = ELEMENT) -> ChunkTextBlock:
    return ChunkTextBlock(element=element, heading=heading, text=text)


def words(n: int, prefix: str = "w") -> str:
    return " ".join(f"{prefix}{i}" for i in range(n))


class CharacterTokenizer(HuggingFaceTokenizer):
    """One token per character, so a single long word can be over the budget."""

    def count_tokens(self, text: str) -> int:
        return len(text)


def character_tokenizer(max_tokens: int) -> CharacterTokenizer:
    return CharacterTokenizer(tokenizer=whitespace_tokenizer(max_tokens).get_tokenizer(), max_tokens=max_tokens)


class TextChunker(unittest.TestCase):
    def test_two_short_blocks_give_two_chunks_with_their_headings(self):
        chunks = chunk_text_blocks(
            [block("Notes on results", "The results were reviewed.", "A"), block("Segments", "Two segments.", "B")],
            None,
            whitespace_tokenizer(448),
        )
        self.assertEqual([c.seq for c in chunks], [0, 1])
        self.assertEqual([c.element for c in chunks], ["A", "B"])
        self.assertEqual([c.section_path for c in chunks], [["Notes on results"], ["Segments"]])
        self.assertEqual([c.text for c in chunks], ["The results were reviewed.", "Two segments."])
        self.assertEqual([c.kind for c in chunks], ["prose", "prose"])
        self.assertEqual([c.basis for c in chunks], [None, None])
        # The count is of what is embedded: the path, its newline and the text.
        self.assertEqual([c.token_count for c in chunks], [3 + 4, 1 + 2])

    def test_a_block_of_2000_words_splits_into_chunks_within_the_budget(self):
        tokenizer = whitespace_tokenizer(448)
        text = words(2000)
        chunks = chunk_text_blocks([block("Long note", text)], "standalone", tokenizer)
        self.assertGreater(len(chunks), 4)
        self.assertEqual([c.seq for c in chunks], list(range(len(chunks))))
        for chunk in chunks:
            embedded = tokenizer.count_tokens(contextualize(chunk.section_path, chunk.text))
            self.assertLessEqual(embedded, 448)
            self.assertEqual(chunk.token_count, embedded)
            self.assertEqual(chunk.section_path, ["Long note"])
        self.assertEqual(" ".join(c.text for c in chunks).split(), text.split())

    def test_the_embedding_budget_binds_when_the_tokenizer_allows_more(self):
        tokenizer = whitespace_tokenizer(2000, special_tokens=True)
        chunks = chunk_text_blocks([block("Long note", words(2000))], None, tokenizer)
        self.assertGreater(len(chunks), 3)
        self.assertEqual(embed_budget(tokenizer), MAX_EMBED_TOKENS - 2)
        for chunk in chunks:
            self.assertLessEqual(tokenizer.count_tokens(contextualize(chunk.section_path, chunk.text)), embed_budget(tokenizer))

    def test_paragraphs_pack_in_order_until_the_budget(self):
        tokenizer = whitespace_tokenizer(20)
        paragraphs = [words(8, "a"), words(8, "b"), words(8, "c")]
        chunks = chunk_text_blocks([block("H", "\n\n".join(paragraphs))], None, tokenizer)
        # One heading token, then 8 + 8 words fit in 20; a third paragraph would make 25.
        self.assertEqual([c.text for c in chunks], [f"{paragraphs[0]}\n\n{paragraphs[1]}", paragraphs[2]])

    def test_an_oversize_paragraph_splits_by_lines_then_by_words(self):
        tokenizer = whitespace_tokenizer(20)
        lines = [words(8, "a"), words(8, "b"), words(40, "c")]
        chunks = chunk_text_blocks([block("H", "\n".join(lines))], None, tokenizer)
        for chunk in chunks:
            self.assertLessEqual(tokenizer.count_tokens(contextualize(chunk.section_path, chunk.text)), 20)
        # Lines are kept whole while they fit; the 40-word line is cut by words.
        self.assertEqual(chunks[0].text, lines[0] + "\n" + lines[1])
        self.assertEqual(" ".join(c.text for c in chunks).split(), " ".join(lines).split())

    def test_a_word_longer_than_the_budget_is_cut_by_characters(self):
        tokenizer = character_tokenizer(30)
        chunks = chunk_text_blocks([block("H", "x" * 100)], None, tokenizer)
        self.assertGreater(len(chunks), 3)
        for chunk in chunks:
            self.assertLessEqual(tokenizer.count_tokens(contextualize(chunk.section_path, chunk.text)), 30)
        self.assertEqual("".join(c.text for c in chunks), "x" * 100)

    def test_a_table_block_is_kind_table(self):
        chunks = chunk_text_blocks(
            [block("Segments", "Segment | Plants\nCement | Two\nSteel | One")], None, whitespace_tokenizer(448)
        )
        self.assertEqual([c.kind for c in chunks], ["table"])

    def test_a_chunk_is_a_table_only_when_every_paragraph_is(self):
        tokenizer = whitespace_tokenizer(448)
        mixed = "Segment | Plants\nCement | Two\n\nSee the notes."
        [chunk] = chunk_text_blocks([block("Segments", mixed)], None, tokenizer)
        self.assertEqual(chunk.kind, "prose")
        # A paragraph with a line that has no bar is prose.
        [chunk] = chunk_text_blocks([block("Segments", "Segment | Plants\nCement two")], None, tokenizer)
        self.assertEqual(chunk.kind, "prose")

    def test_a_table_and_a_prose_paragraph_that_do_not_fit_together_are_cut_apart(self):
        text = "A | b\nC | d\n\n" + words(10)
        chunks = chunk_text_blocks([block("H", text)], None, whitespace_tokenizer(14))
        self.assertEqual([c.kind for c in chunks], ["table", "prose"])

    def test_the_basis_carries_through(self):
        chunks = chunk_text_blocks([block("A", "one"), block("B", "two")], "consolidated", whitespace_tokenizer(448))
        self.assertEqual([c.basis for c in chunks], ["consolidated", "consolidated"])

    def test_seq_counts_across_blocks(self):
        chunks = chunk_text_blocks([block("A", words(1000)), block("B", "short")], None, whitespace_tokenizer(448))
        self.assertEqual([c.seq for c in chunks], list(range(len(chunks))))
        self.assertGreater(len(chunks), 2)
        self.assertEqual(chunks[-1].section_path, ["B"])

    def test_an_empty_block_gives_no_chunk_and_blank_lines_are_not_paragraphs(self):
        chunks = chunk_text_blocks(
            [block("A", " \n\n  \n"), block("B", "text\n\n\n\nmore")], None, whitespace_tokenizer(448)
        )
        self.assertEqual([(c.seq, c.section_path, c.text) for c in chunks], [(0, ["B"], "text\n\nmore")])

    def test_a_heading_too_long_for_a_path_is_dropped_and_a_blank_one_is_not_a_path(self):
        chunks = chunk_text_blocks(
            [block(words(100, "h"), "text"), block("  ", "text")], None, whitespace_tokenizer(448)
        )
        self.assertEqual([c.section_path for c in chunks], [[], []])


if __name__ == "__main__":
    unittest.main()
