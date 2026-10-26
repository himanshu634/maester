"""The instance parser: structure out, hard limits in, no document text in an error. Offline."""

import os
import unittest
from datetime import date
from unittest import mock

from lxml import etree

from xbrl_fixtures import (
    BSE_FIN,
    CAPMKT_2025,
    CAPMKT_2026,
    IND_AS_MARKERS,
    ContextSpec,
    UnitSpec,
    f,
    identity_facts,
    instance,
    parse,
    real_instances,
    real_instances_with_token,
)

from pdf_financial_qa.workflow.errors import ExtractionError
from pdf_financial_qa.xbrl import (
    INSTANCE_NS,
    XBRL_MAP_VERSION,
    XBRL_PARSER_VERSION,
    XBRL_PDF_CHECK_VERSION,
    XBRL_TEXT_VERSION,
)
from pdf_financial_qa.xbrl.parser import REASONS

BOMB = '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
ONE_FACT = ("OtherIncome", "OneD", "INR", "-5", "1")


class ParserTests(unittest.TestCase):
    def assertUnreadable(self, data, reason, **limits):
        self.assertIn(reason, REASONS)
        with self.assertRaises(ExtractionError) as raised:
            parse(data, **limits)
        error = raised.exception
        self.assertEqual(
            (error.code, str(error), error.message, error.retryable), ("XBRL_UNREADABLE", reason, reason, False)
        )
        self.assertIsNone(error.__cause__)
        self.assertIsNone(error.__context__)  # nothing chained that could hold document text

    def test_the_versions(self):
        self.assertEqual(
            (XBRL_PARSER_VERSION, XBRL_MAP_VERSION, XBRL_TEXT_VERSION, XBRL_PDF_CHECK_VERSION), ("1", "2", "1", 1)
        )
        self.assertEqual(INSTANCE_NS, "http://www.xbrl.org/2003/instance")

    # --- structure -------------------------------------------------------------------------------

    def test_contexts_units_and_facts(self):
        inst = parse(instance(facts=[("RevenueFromOperations", "OneD", "INR", "-5", "1234500000"),
                                     ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "OneD", "INRPerShare", "INF", "12.34")]))
        self.assertEqual(inst.contexts["OneD"].start, date(2025, 7, 1))
        self.assertEqual(inst.contexts["OneI"].instant, date(2025, 9, 30))
        self.assertTrue(inst.contexts["OneExpenses1D"].dimensional)
        self.assertEqual(inst.units["INRPerShare"].denominator, ("xbrli:shares",))
        self.assertEqual([(f.element, f.decimals, f.text) for f in inst.facts if f.unit_id],
                         [("RevenueFromOperations", "-5", "1234500000"),
                          ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "INF", "12.34")])

    def test_every_context_and_unit_of_the_fixture(self):
        inst = parse(instance())
        self.assertEqual(
            {c.id: (c.start, c.end, c.instant, c.dimensional) for c in inst.contexts.values()},
            {
                "OneD": (date(2025, 7, 1), date(2025, 9, 30), None, False),
                "FourD": (date(2025, 4, 1), date(2025, 9, 30), None, False),
                "OneI": (None, None, date(2025, 9, 30), False),
                "PY_I": (None, None, date(2025, 3, 31), False),
                "OneExpenses1D": (date(2025, 7, 1), date(2025, 9, 30), None, True),
            },
        )
        self.assertEqual(
            {u.id: (u.numerator, u.denominator) for u in inst.units.values()},
            {
                "INR": (("iso4217:INR",), ()),
                "INRPerShare": (("iso4217:INR",), ("xbrli:shares",)),
                "pure": (("xbrli:pure",), ()),
            },
        )

    def test_facts_keep_their_element_namespace_unit_and_document_order(self):
        facts = parse(instance(facts=[f("OtherIncome"), f("OtherExpenses", "FourD", "INR", None, "7")])).facts
        self.assertEqual([x.order for x in facts], [0, 1, 2])
        self.assertEqual(
            [(x.element, x.namespace, x.context_id, x.unit_id, x.decimals, x.text, x.nil) for x in facts],
            [
                ("LevelOfRounding", CAPMKT_2025, "OneD", None, None, "Lakhs", False),
                ("OtherIncome", CAPMKT_2025, "OneD", "INR", "-5", "100000", False),
                ("OtherExpenses", CAPMKT_2025, "FourD", "INR", None, "7", False),
            ],
        )

    def test_the_rounding_fact_follows_the_family(self):
        self.assertEqual(parse(instance(namespace=CAPMKT_2026)).facts[0].element, "LevelOfRounding")
        bse = parse(instance(namespace=BSE_FIN, rounding="Crores")).facts[0]
        self.assertEqual((bse.element, bse.namespace, bse.text), ("LevelOfRoundingUsedInFinancialStatements", BSE_FIN, "Crores"))
        self.assertEqual(parse(instance(rounding=None)).facts, [])

    def test_the_root_namespaces_and_the_schema_references(self):
        inst = parse(instance(schema_ref="in-capmkt-ent-2025-01-31.xsd"))
        self.assertEqual(inst.schema_refs, ["in-capmkt-ent-2025-01-31.xsd"])
        self.assertEqual(inst.root_namespaces["xbrli"], INSTANCE_NS)
        self.assertEqual(inst.root_namespaces["in-capmkt"], CAPMKT_2025)
        self.assertEqual(inst.root_namespaces["iso4217"], "http://www.xbrl.org/2003/iso4217")

    def test_the_default_namespace_is_kept_under_an_empty_prefix(self):
        data = (
            f'<xbrl xmlns="{INSTANCE_NS}" xmlns:v="urn:v"><context id="c"><entity/><period><forever/></period></context>'
            '<v:Item contextRef="c">1</v:Item></xbrl>'
        ).encode()
        inst = parse(data)
        self.assertEqual(inst.root_namespaces, {"": INSTANCE_NS, "v": "urn:v"})
        self.assertEqual([(x.element, x.namespace) for x in inst.facts], [("Item", "urn:v")])

    def test_contexts_with_a_segment_a_forever_period_or_a_time(self):
        inst = parse(instance(contexts=[
            ContextSpec("Seg", "2025-07-01", "2025-09-30", dimension="segment"),
            ContextSpec("Plain", "2025-07-01", "2025-09-30"),
            ContextSpec("Forever"),
        ]))
        self.assertTrue(inst.contexts["Seg"].dimensional)
        self.assertFalse(inst.contexts["Plain"].dimensional)
        forever = inst.contexts["Forever"]
        self.assertEqual((forever.start, forever.end, forever.instant, forever.dimensional), (None, None, None, False))
        timed = instance(contexts=[ContextSpec("T", instant="2025-09-30")]).replace(
            b"<xbrli:instant>2025-09-30<", b"<xbrli:instant>2025-09-30T00:00:00+05:30<"
        )
        self.assertEqual(parse(timed).contexts["T"].instant, date(2025, 9, 30))

    def test_a_measure_is_written_with_the_prefix_of_its_namespace(self):
        data = instance().replace(b"xmlns:iso4217=", b"xmlns:cur=").replace(b">iso4217:", b">cur:")
        self.assertEqual(parse(data).units["INR"].numerator, ("iso4217:INR",))
        other = instance(units=[UnitSpec("X", ("xbrli:shares",), ("xbrli:pure",))]).replace(b"<xbrli:measure>xbrli:pure", b"<xbrli:measure>zz:odd")
        self.assertEqual(parse(other).units["X"].denominator, ("zz:odd",))

    def test_a_unit_with_several_measures_and_white_space_is_read(self):
        data = instance(units=[UnitSpec("M", ("iso4217:INR", "xbrli:shares"))]).replace(
            b"<xbrli:measure>iso4217:INR</xbrli:measure>", b"<xbrli:measure>\r\n  iso4217:INR\r\n</xbrli:measure>"
        )
        self.assertEqual(parse(data).units["M"].numerator, ("iso4217:INR", "xbrli:shares"))

    def test_nil_is_kept_as_nil(self):
        fact = parse(instance(facts=[("OtherIncome", "OneD", "INR", "-5", None)])).facts[-1]   # the rounding fact comes first
        self.assertEqual((fact.nil, fact.text), (True, ""))

    def test_nil_is_not_zero_and_a_one_means_nil_too(self):
        data = instance(facts=[("OtherIncome", "OneD", "INR", "-5", None)]).replace(
            b'xsi:nil="true"/>', b'xsi:nil="1"> 9 </in-capmkt:OtherIncome>'
        )
        fact = parse(data).facts[-1]
        self.assertEqual((fact.nil, fact.text), (True, ""))
        not_nil = parse(instance(facts=[("OtherIncome", "OneD", "INR", "-5", "0")])).facts[-1]
        self.assertEqual((not_nil.nil, not_nil.text), (False, "0"))

    def test_text_is_not_changed(self):
        padded = parse(instance(facts=[f("OtherIncome", text=" 12.50 "), f("DisclosureX", unit=None, decimals=None,
                                       text="<p>Notes &amp; more</p>\n  <p>Line two</p>")])).facts
        self.assertEqual(padded[-2].text, " 12.50 ")
        self.assertEqual(padded[-1].text, "<p>Notes &amp; more</p>\n  <p>Line two</p>")  # escaped markup stays text

    def test_a_fact_that_holds_markup_gives_its_text_content(self):
        data = instance().replace(
            b"</xbrli:xbrl>", b'<in-capmkt:Notes contextRef="OneD">One <b>two</b> three</in-capmkt:Notes></xbrli:xbrl>'
        )
        self.assertEqual(parse(data).facts[-1].text, "One two three")

    def test_what_is_not_a_fact_is_left_out(self):
        data = instance().replace(
            b"</xbrli:xbrl>",
            b'<link:footnoteLink xlink:type="extended"/><in-capmkt:Group><in-capmkt:Inner contextRef="OneD">1</in-capmkt:Inner>'
            b'</in-capmkt:Group></xbrli:xbrl>',
        )
        self.assertEqual([x.element for x in parse(data).facts], ["LevelOfRounding"])

    def test_the_file_may_start_with_a_byte_order_mark_and_a_comment_that_names_a_doctype(self):
        data = b"\xef\xbb\xbf" + instance(comment="<!-- <!DOCTYPE not one> -->")
        self.assertEqual(len(parse(data).contexts), 5)

    def test_the_real_shape_of_a_results_instance(self):
        inst = parse(instance(facts=[*identity_facts(), *IND_AS_MARKERS]))
        self.assertEqual(
            [x.element for x in inst.facts if x.unit_id is None],
            ["LevelOfRounding", "NameOfTheCompany", "ScripCode", "Symbol", "ISIN", "NatureOfReportStandaloneConsolidated",
             "DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod", "ReportingQuarter"],
        )
        self.assertEqual(
            [x.text for x in inst.facts if x.element in ("Symbol", "NatureOfReportStandaloneConsolidated")], ["SYNCEM", "Consolidated"]
        )
        self.assertNotIn("NatureOfReportStandaloneConsolidated", [x.element for x in parse(instance(facts=identity_facts(basis=None))).facts])

    # --- refusals --------------------------------------------------------------------------------

    def test_a_doctype_is_refused_before_any_entity_is_read(self):
        bomb = '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
        self.assertUnreadable(instance(doctype=bomb), "DOCTYPE")

    def test_every_kind_of_doctype_is_refused(self):
        for doctype in ('<!DOCTYPE xbrli:xbrl SYSTEM "http://example.invalid/x.dtd">', "<!DOCTYPE xbrli:xbrl>", "<!doctype x>"):
            with self.subTest(doctype=doctype):
                self.assertUnreadable(instance(doctype=doctype), "DOCTYPE")
        # after a comment and a processing instruction, and after a byte order mark
        self.assertUnreadable(instance(comment="<!--a--><?pi x?>\n<!-- b -->" + BOMB), "DOCTYPE")
        self.assertUnreadable(b"\xef\xbb\xbf" + instance(doctype=BOMB), "DOCTYPE")

    def test_a_doctype_in_a_wide_encoding_is_refused_from_the_parsed_tree(self):
        # The prolog scan reads ASCII; a UTF-16 prolog hides from it, so the tree's doctype refuses it.
        data = instance(doctype=BOMB, comment="").decode().replace("UTF-8", "UTF-16").encode("utf-16")
        self.assertUnreadable(data, "DOCTYPE")

    def test_a_doctype_and_a_size_are_refused_before_the_parser_is_started(self):
        with mock.patch("pdf_financial_qa.xbrl.parser.etree.iterparse", side_effect=AssertionError("parsed")):
            self.assertUnreadable(instance(doctype=BOMB), "DOCTYPE")
            self.assertUnreadable(b"\xef\xbb\xbf" + instance(doctype=BOMB), "DOCTYPE")
            self.assertUnreadable(instance(), "TOO_LARGE", max_bytes=100)

    def test_the_parser_is_started_without_entities_dtd_network_or_huge_trees(self):
        with mock.patch("pdf_financial_qa.xbrl.parser.etree.iterparse", side_effect=etree.iterparse) as iterparse:
            parse(instance())
        options = iterparse.call_args.kwargs
        self.assertEqual(
            {key: options[key] for key in ("resolve_entities", "no_network", "load_dtd", "huge_tree")},
            {"resolve_entities": False, "no_network": True, "load_dtd": False, "huge_tree": False},
        )

    def test_an_entity_is_never_expanded(self):
        # With no DOCTYPE there is no entity to declare, so a reference to one is malformed.
        data = instance().replace(b"</xbrli:xbrl>", b'<in-capmkt:Note contextRef="OneD">&boom;</in-capmkt:Note></xbrli:xbrl>')
        self.assertUnreadable(data, "MALFORMED")

    def test_limits(self):
        self.assertUnreadable(instance(), "TOO_LARGE", max_bytes=100)
        self.assertUnreadable(instance(facts=[("OtherIncome", "OneD", "INR", "-5", "1")] * 11), "TOO_MANY_FACTS", max_facts=10)
        ticks = iter(range(0, 10_000, 31))
        self.assertUnreadable(instance(facts=[("OtherIncome", "OneD", "INR", "-5", "1")] * 3000), "TIMED_OUT", clock=lambda: next(ticks))

    def test_the_limits_are_inclusive(self):
        data = instance(facts=[ONE_FACT] * 9)  # nine facts and the rounding fact
        self.assertEqual(len(parse(data, max_bytes=len(data), max_facts=10).facts), 10)
        self.assertUnreadable(data, "TOO_LARGE", max_bytes=len(data) - 1)
        self.assertUnreadable(instance(facts=[ONE_FACT] * 10), "TOO_MANY_FACTS", max_facts=10)

    def test_the_clock_is_read_every_thousand_elements(self):
        reads = []

        def clock():
            reads.append(1)
            return 0.0

        # About 3,040 elements (3,000 facts and the rounding fact, the contexts, units and the root):
        # one read at the start and one for each full thousand.
        parse(instance(facts=[ONE_FACT] * 3000), clock=clock)
        self.assertEqual(len(reads), 4)

    def test_the_deadline_is_the_time_after_the_start(self):
        data = instance(facts=[ONE_FACT] * 3000)
        times = iter([100.0, 129.9, 129.9, 130.0])  # exactly the deadline is still in time
        self.assertEqual(len(parse(data, clock=lambda: next(times)).facts), 3001)
        times = iter([100.0, 130.1])
        self.assertUnreadable(data, "TIMED_OUT", clock=lambda: next(times))

    def test_not_an_instance_and_malformed(self):
        self.assertUnreadable(b"<?xml version='1.0'?><html/>", "NOT_AN_INSTANCE")
        self.assertUnreadable(instance()[:-40], "MALFORMED")

    def test_other_things_that_are_not_an_instance_or_not_xml(self):
        self.assertUnreadable(f'<xbrl xmlns="{INSTANCE_NS}x"/>'.encode(), "NOT_AN_INSTANCE")
        self.assertUnreadable(b"<xbrl/>", "NOT_AN_INSTANCE")
        self.assertUnreadable(b"", "MALFORMED")
        self.assertUnreadable(b"%PDF-1.4\n1 0 obj\n", "MALFORMED")
        self.assertUnreadable(b"\xff\xfe<\x00", "MALFORMED")
        self.assertUnreadable(instance() + b"<extra/>", "MALFORMED")

    def test_a_very_deep_document_is_malformed_not_a_crash(self):
        data = instance().replace(b"</xbrli:xbrl>", b"<a>" * 3000 + b"</a>" * 3000 + b"</xbrli:xbrl>")
        self.assertUnreadable(data, "MALFORMED")

    def test_a_context_or_unit_without_an_id_or_with_a_repeated_one_is_malformed(self):
        self.assertUnreadable(instance().replace(b'<xbrli:context id="OneD">', b"<xbrli:context>"), "MALFORMED")
        self.assertUnreadable(instance().replace(b'<xbrli:unit id="pure">', b"<xbrli:unit>"), "MALFORMED")
        self.assertUnreadable(instance().replace(b'id="FourD"', b'id="OneD"'), "MALFORMED")
        self.assertUnreadable(instance().replace(b'id="pure"', b'id="INR"'), "MALFORMED")

    def test_a_date_that_is_not_a_date_is_malformed(self):
        for bad in (b"2025-13-01", b"30-09-2025", b"20250930", b"2025-09-30 junk"):
            with self.subTest(bad=bad):
                self.assertUnreadable(instance().replace(b"2025-09-30", bad, 1), "MALFORMED")

    def test_the_error_carries_no_document_text(self):
        with self.assertRaises(ExtractionError) as e: parse(b"<x>SYNTHETIC CEMENTS</y>")
        self.assertNotIn("SYNTHETIC", str(e.exception))

    def test_no_error_names_the_text_that_caused_it(self):
        secret = "SYNTHETIC CEMENTS LIMITED"
        cases = [
            (instance(facts=[("NameOfTheCompany", "OneD", None, None, secret)])[:-40], {}),
            (instance(doctype=BOMB.replace("aaaaaaaaaa", secret)), {}),
            (instance(facts=[("NameOfTheCompany", "OneD", None, None, secret)]), {"max_bytes": 100}),
            (instance(facts=[("NameOfTheCompany", "OneD", None, None, secret)] * 5), {"max_facts": 2}),
            (instance(facts=[("NameOfTheCompany", "OneD", None, None, secret)]).replace(b"2025-09-30", secret.encode(), 1), {}),
        ]
        for data, limits in cases:
            with self.assertRaises(ExtractionError) as raised:
                parse(data, **limits)
            error = raised.exception
            self.assertNotIn("SYNTHETIC", repr(error) + str(error.args))
            self.assertIsNone(error.__context__)


@unittest.skipUnless(os.environ.get("MAESTER_XBRL_DIR"), "set MAESTER_XBRL_DIR to read the real instances")
class RealInstanceTests(unittest.TestCase):
    def test_real_instances_parse(self):  # skipped unless MAESTER_XBRL_DIR is set
        count = 0
        for path in real_instances():
            inst = parse(path.read_bytes())   # all of them, within the default limits
            self.assertTrue(inst.facts and inst.contexts and inst.units and inst.schema_refs, path.name)
            count += 1
        self.assertGreater(count, 0)

    def test_every_real_file_name_has_one_of_the_seven_format_tokens(self):
        tokens = {token for _, token in real_instances_with_token()}
        self.assertLessEqual(
            tokens, {"Integrated_Finance_Ind_As", "Main_Ind_As", "IFBanking", "Banking", "Integrated_Finance_NBFC", "NBFC", "IFOtherthan"}
        )
        self.assertEqual(len(list(real_instances_with_token())), len(list(real_instances())))


if __name__ == "__main__":
    unittest.main()
