"""The text blocks of an instance: HTML to plain text, a heading from the element's name, and the blocks."""

import os
import unittest

from xbrl_fixtures import instance, parse, real_instances

from pdf_financial_qa.xbrl.text import element_heading, html_to_text, text_blocks


class HtmlToTextTests(unittest.TestCase):
    def test_paragraphs_entities_bold_and_a_table(self):
        html = "<p>Notes&nbsp;to <b>results</b></p><table><tr><td>Segment</td><td>Cement</td></tr></table>"
        self.assertEqual(html_to_text(html), "Notes to results\nSegment | Cement")

    def test_block_tags_end_a_line_and_br_breaks_one(self):
        self.assertEqual(html_to_text("<div>one<div>two</div></div><ul><li>three</li><li>four</li></ul>"), "one\ntwo\nthree\nfour")
        self.assertEqual(html_to_text("<h2>Heading</h2>text<br>more"), "Heading\ntext\nmore")

    def test_cells_are_joined_by_a_bar_and_an_empty_cell_keeps_its_place(self):
        self.assertEqual(
            html_to_text("<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td></td><td>3</td></tr></table>"),
            "A | B | C\n1 | | 3",
        )

    def test_script_and_style_are_dropped(self):
        self.assertEqual(html_to_text("<style>p{color:red}</style><p>kept</p><script>alert(1)</script>"), "kept")

    def test_spaces_collapse_within_a_line_and_blank_lines_collapse_to_one(self):
        self.assertEqual(html_to_text("<p>a   \t b</p>\n\n\n<p>c</p>"), "a b\n\nc")
        self.assertEqual(html_to_text("a<br><br><br><br>b"), "a\n\nb")

    def test_entities_are_unescaped_and_the_result_is_stripped(self):
        self.assertEqual(html_to_text("  <p>Rs &amp; Co &lt;ltd&gt;</p>  "), "Rs & Co <ltd>")

    def test_plain_text_with_line_breaks_keeps_them(self):
        self.assertEqual(html_to_text("first line\nsecond line"), "first line\nsecond line")

    def test_nothing_in_gives_nothing_out(self):
        self.assertEqual(html_to_text(""), "")
        self.assertEqual(html_to_text("<p> </p><br>"), "")


class HeadingTests(unittest.TestCase):
    def test_a_text_block_element(self):
        self.assertEqual(
            element_heading("DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock"), "Disclosure of notes on financial results"
        )

    def test_the_other_suffixes(self):
        self.assertEqual(element_heading("DisclosureOfNotesOnSegmentsTextBlock"), "Disclosure of notes on segments")
        self.assertEqual(element_heading("RelatedPartyTransactionExplanatory"), "Related party transaction")

    def test_an_element_that_is_only_a_suffix_keeps_its_own_words(self):
        self.assertEqual(element_heading("TextBlock"), "Text block")

    def test_digits_and_acronyms_split_into_words(self):
        self.assertEqual(element_heading("NotesOnIndASAndEPS2TextBlock"), "Notes on ind as and eps2")


def _facts(*facts):
    return text_blocks(parse(instance(facts=list(facts))))


class TextBlocksTests(unittest.TestCase):
    BLOCK = "DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock"

    def test_a_block_in_document_order_with_its_heading_and_plain_text(self):
        blocks = _facts(
            (self.BLOCK, "OneD", None, None, "<p>First note</p><p>Second note</p>"),
            ("DisclosureOfNotesOnSegmentsExplanatoryTextBlock", "OneD", None, None, "<p>Segments</p>"),
        )
        self.assertEqual(
            [(b.element, b.context_id, b.heading, b.text) for b in blocks],
            [
                (self.BLOCK, "OneD", "Disclosure of notes on financial results", "First note\nSecond note"),
                ("DisclosureOfNotesOnSegmentsExplanatoryTextBlock", "OneD", "Disclosure of notes on segments", "Segments"),
            ],
        )

    def test_a_dimensional_explanatory_fact_is_kept(self):
        blocks = _facts(("RelatedPartyTransactionExplanatory", "OneExpenses1D", None, None, "Rent paid to a director."))
        self.assertEqual([(b.element, b.context_id, b.text) for b in blocks], [("RelatedPartyTransactionExplanatory", "OneExpenses1D", "Rent paid to a director.")])

    def test_an_empty_block_and_a_duplicate_are_dropped(self):
        blocks = _facts(
            (self.BLOCK, "OneD", None, None, "<p> &nbsp; </p>"),
            (self.BLOCK, "OneD", None, None, None),
            (self.BLOCK, "OneD", None, None, "<p>Same</p>"),
            (self.BLOCK, "FourD", None, None, "Same"),  # the same element and text in another context
            ("RelatedPartyTransactionExplanatory", "OneD", None, None, "Same"),  # the same text under another element
        )
        self.assertEqual([(b.element, b.context_id, b.text) for b in blocks], [
            (self.BLOCK, "OneD", "Same"),
            ("RelatedPartyTransactionExplanatory", "OneD", "Same"),
        ])

    def test_a_numeric_fact_and_a_fact_of_another_name_are_not_blocks(self):
        blocks = _facts(
            ("NameOfTheCompany", "OneD", None, None, "SYNTHETIC CEMENTS LIMITED"),
            ("RevenueFromOperationsTextBlock", "OneD", "INR", "-5", "100"),  # numeric: it has a unit
            ("OtherIncome", "OneD", "INR", "-5", "100"),
        )
        self.assertEqual(blocks, [])


class RealInstanceTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
    def test_every_real_instance_gives_clean_blocks(self):
        """Reads the files and writes nothing; it checks shapes and counts, and never prints a text."""
        elements: set[str] = set()
        for path in real_instances():
            with self.subTest(file=path.name):
                blocks = text_blocks(parse(path.read_bytes()))
                keys = [(b.element, b.text) for b in blocks]
                self.assertEqual(len(keys), len(set(keys)))
                for block in blocks:
                    self.assertTrue(block.text)
                    self.assertEqual(block.text, block.text.strip())
                    elements.add(block.element)
        self.assertIn("DisclosureOfNotesOnFinancialResultsExplanatoryTextBlock", elements)


if __name__ == "__main__":
    unittest.main()
