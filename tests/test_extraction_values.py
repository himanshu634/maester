"""Deterministic parts of the extraction workflow: values, units, dates, checks. Offline."""

from datetime import date
from decimal import Decimal
import unittest

from pdf_financial_qa.workflow.drafts import DraftLine, DraftSection, DraftValue, StatementDraft, check_statement
from pdf_financial_qa.workflow.errors import ModelOutputError, is_transient
from pdf_financial_qa.workflow.values import (
    format_decimal, parse_label_date, parse_reported, same_company, scale_for, text_layer_match,
)


class ParseReportedTests(unittest.TestCase):
    def test_values_as_printed(self):
        cases = {
            "1,23,456.50": Decimal("123456.50"),
            "123,456": Decimal("123456"),
            "(1,234)": Decimal("-1234"),
            "-45.5": Decimal("-45.5"),
            "−12": Decimal("-12"),
            "₹ 1,000": Decimal("1000"),
            "Rs. 2,500": Decimal("2500"),
            "0": Decimal("0"),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(parse_reported(text), ("value", expected))

    def test_dashes_are_not_zero(self):
        for text in ("-", "–", "—", "nil", "Nil"):
            with self.subTest(text=text):
                self.assertEqual(parse_reported(text), ("dash", None))

    def test_unparseable_text_is_kept_as_unparsed(self):
        for text in ("n.a.", "12 Cr", "see note 4", "1.2.3"):
            with self.subTest(text=text):
                self.assertEqual(parse_reported(text), ("unparsed", None))

    def test_format_never_uses_exponents(self):
        self.assertEqual(format_decimal(Decimal("1E+5")), "100000")
        self.assertEqual(format_decimal(Decimal("125.4") * Decimal(10) ** 7), "1254000000.0")
        self.assertEqual(format_decimal(Decimal("-0")), "0")


class UnitAndDateTests(unittest.TestCase):
    def test_scales(self):
        cases = {
            "₹ in crores": Decimal(10) ** 7, "Rs. in Lakhs": Decimal(10) ** 5, "(Rs. in lacs)": Decimal(10) ** 5,
            "$ in millions": Decimal(10) ** 6, "USD thousands": Decimal(10) ** 3, "INR '000": Decimal(10) ** 3,
            "in billions": Decimal(10) ** 9, "Amount in Rupees": Decimal(1), "INR": Decimal(1),
        }
        for label, scale in cases.items():
            with self.subTest(label=label):
                self.assertEqual(scale_for(label), scale)

    def test_unknown_or_ambiguous_units(self):
        for label in (None, "", "in units of account", "crores and lakhs", "something else"):
            with self.subTest(label=label):
                expected = Decimal(1) if label == "in units of account" else None
                self.assertEqual(scale_for(label), expected)

    def test_unambiguous_dates_only(self):
        self.assertEqual(parse_label_date("As at 31 March 2026"), date(2026, 3, 31))
        self.assertEqual(parse_label_date("Year ended March 31, 2025"), date(2025, 3, 31))
        self.assertEqual(parse_label_date("31st Mar. 2024"), date(2024, 3, 31))
        self.assertEqual(parse_label_date("30 Sept 2025"), date(2025, 9, 30))
        self.assertIsNone(parse_label_date("FY2026"))
        self.assertIsNone(parse_label_date("31.03.2026"))
        self.assertIsNone(parse_label_date("1 April 2025 to 31 March 2026"))
        self.assertIsNone(parse_label_date("31 February 2026"))

    def test_text_layer_match(self):
        page = "Cash and cash equivalents 1,23,456.50\nInventories (2,500)\nTotal 1, 25,956.50"
        self.assertTrue(text_layer_match(page, Decimal("123456.5")))
        self.assertTrue(text_layer_match(page, Decimal("-2500")))
        self.assertTrue(text_layer_match(page, Decimal("125956.50")))
        self.assertFalse(text_layer_match(page, Decimal("9999")))
        self.assertIsNone(text_layer_match("   ", Decimal("1")))
        self.assertIsNone(text_layer_match(page, None))

    def test_company_names(self):
        self.assertTrue(same_company("SYNTHETIC INDUSTRIES LIMITED", "Synthetic Industries Ltd."))
        self.assertTrue(same_company("Synthetic Industries", "Synthetic Industries Private Limited"))
        self.assertFalse(same_company("Another Corp", "Synthetic Industries Ltd"))


def line(label, values, *, page=0, subtotal=False, components=()):
    return DraftLine(label=label, page_index=page, is_subtotal=subtotal, component_labels=tuple(components),
                     values=tuple(DraftValue.from_text(p, t) for p, t in values.items()))


def balance_sheet(*sections):
    return StatementDraft(statement="balance_sheet", basis="consolidated", pages=(0,), currency="INR",
                          unit_label="crores", sections=tuple(DraftSection(name, tuple(lines)) for name, lines in sections))


class CheckTests(unittest.TestCase):
    def test_subtotal_passed_failed_and_not_checked(self):
        draft = balance_sheet(("Assets", [
            line("Cash", {"FY26": "100", "FY25": "90"}),
            line("Inventory", {"FY26": "50", "FY25": "-"}),
            line("Total assets", {"FY26": "150", "FY25": "95"}, subtotal=True, components=["Cash", "Inventory"]),
            line("Odd total", {"FY26": "10"}, subtotal=True, components=["Missing line"]),
        ]))
        checks = {(c.subject, c.period): c for c in check_statement(draft) if c.check_type == "subtotal"}
        self.assertEqual(checks[("Total assets", "FY26")].status, "passed")
        self.assertEqual(checks[("Total assets", "FY26")].actual, Decimal(150))
        self.assertEqual(checks[("Total assets", "FY25")].status, "not_checked")
        self.assertIsNone(checks[("Total assets", "FY25")].actual)
        self.assertEqual(checks[("Odd total", "FY26")].status, "not_checked")

    def test_tolerance_absorbs_rounding(self):
        draft = balance_sheet(("Assets", [
            line("A", {"FY26": "100000"}), line("B", {"FY26": "200000"}),
            line("Total", {"FY26": "300400"}, subtotal=True, components=["A", "B"]),
        ]))
        self.assertEqual(check_statement(draft)[0].status, "passed")

    def test_identity_with_combined_line_ignores_current_subtotals(self):
        draft = balance_sheet(
            ("Assets", [line("Total non-current assets", {"FY26": "40"}), line("Total current assets", {"FY26": "60"}),
                        line("Total assets", {"FY26": "100"})]),
            ("Equity and liabilities", [line("Total equity", {"FY26": "70"}), line("Total current liabilities", {"FY26": "30"}),
                                        line("Total equity and liabilities", {"FY26": "100"})]),
        )
        identity = [c for c in check_statement(draft) if c.check_type == "balance_identity"]
        self.assertEqual([(c.subject, c.status) for c in identity], [("Total assets", "passed")])

    def test_identity_from_liabilities_plus_equity_flags_failure_and_sections(self):
        draft = balance_sheet(
            ("Assets", [line("Total assets", {"FY26": "100"})]),
            ("Liabilities", [line("Total liabilities", {"FY26": "40"})]),
            ("Equity", [line("Total equity", {"FY26": "50"})]),
        )
        [identity] = [c for c in check_statement(draft) if c.check_type == "balance_identity"]
        self.assertEqual(identity.status, "failed")
        self.assertEqual(identity.actual, Decimal(90))
        self.assertEqual(identity.sections_involved, ("Assets", "Liabilities", "Equity"))


class ModelMessageTests(unittest.TestCase):
    def test_pdf_travels_as_a_base64_file_block(self):
        import base64

        from pdf_financial_qa.workflow.model import pdf_message

        [message] = pdf_message("read this", b"%PDF-1.4 bytes")
        text, file = message.content
        self.assertEqual(text, {"type": "text", "text": "read this"})
        self.assertEqual((file["type"], file["mime_type"]), ("file", "application/pdf"))
        self.assertEqual(base64.b64decode(file["base64"]), b"%PDF-1.4 bytes")


class TransientTests(unittest.TestCase):
    def test_classification(self):
        from google.genai import errors

        self.assertTrue(is_transient(errors.ServerError(503, {"error": {"message": "unavailable"}})))
        self.assertTrue(is_transient(errors.ClientError(429, {"error": {"message": "quota"}})))
        self.assertFalse(is_transient(errors.ClientError(400, {"error": {"message": "bad request"}})))
        self.assertTrue(is_transient(ModelOutputError("bad page")))
        self.assertFalse(is_transient(ValueError("bug")))


if __name__ == "__main__":
    unittest.main()
