"""`maester-eval tags`: the unit from the declared rounding, the investor's tags, a greedy gold pick and gold
coverage by tag. Offline; nothing here reads a figure of a filing."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from eval_fixtures import plain
from typer.testing import CliRunner
from xbrl_fixtures import ind_as, instance

from maester_eval import cli
from maester_eval.concepts import load_taxonomy
from maester_eval.gold import GoldFact, GoldFiling, write_gold
from maester_eval.manifest import Filing, FormatTags, Manifest, XbrlPair, load_manifest, write_manifest
from maester_eval.paths import EvalPaths
from maester_eval.tags import (
    REQUIREMENTS, TagsError, eligible, gold_coverage, pick_gold, propose_unit, requirement_keys, unit_against_gold,
    unit_of_exponent, unit_of_scale,
)

Q2 = {"file": "synthetic-cements/results-2025-09.pdf", "company": "Synthetic Cements Limited",
      "kind": "financial_results", "period_end": "2025-09-30", "set": "dev"}


def pair(folder, name, token="SQ2025-2026", basis="consolidated", fmt="in-capmkt/ind_as", filed="2025-10-17"):
    return XbrlPair(file=f"{folder}/xbrl/{name}.xml", basis=basis, period=token, filed=filed, format=fmt)


def results(folder, name, token="SQ2025-2026", period_end="2025-09-30", fmt="in-capmkt/ind_as", **more):
    """A results filing of `<folder>/<name>.pdf` with one consolidated pair, unless `xbrl` is given."""
    update = {"file": f"{folder}/{name}.pdf", "company": f"Company {folder}", "kind": "financial_results",
              "period_end": period_end, "set": "dev", "bse_code": "500999",
              "xbrl": [pair(folder, name, token, fmt=fmt)]}
    return Filing(**{**update, **more})


A = results("co1", "a", "JQ2025-2026", "2025-06-30")
B = results("co2", "b", "SQ2025-2026", "2025-09-30", fmt="in-bse-fin/ind_as")
C = results("co1", "c", "JQ2024-2025", "2024-06-30")
D = Filing(file="co3/d.pdf", company="Company co3", kind="annual_report", period_end="2026-03-31", set="dev",
           printed_pages_per_page=2)
E = results("co4", "e", out_of_scope="bank")
F = results("co5", "f", fmt="in-capmkt/banking")
REQ = (("kind", "financial_results", 2), ("quarter", "Q1", 1), ("quarter", "Q2", 1), ("spread", "yes", 1))


class UnitTests(unittest.TestCase):
    def test_units_from_exponents(self):
        self.assertEqual([unit_of_exponent(e) for e in (-7, -5, -6, -3, 0, -9)],
                         ["crore", "lakh", "million", "thousand", "rupees", None])

    def test_units_from_scales(self):
        self.assertEqual([unit_of_scale(s) for s in ("10000000", "100000", "1000000", "1000", "1")],
                         ["crore", "lakh", "million", "thousand", "rupees"])
        self.assertEqual([unit_of_scale(s) for s in (None, "", "7", "1000000000", "lakh", "NaN")], [None] * 6)


class ProposeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.corpus = Path(self.temp.name)

    def filing(self, *bodies):
        pairs = []
        for index, body in enumerate(bodies):
            name = f"i{index}"
            path = self.corpus / "co1" / "xbrl" / f"{name}.xml"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            pairs.append(pair("co1", name, basis="consolidated" if index == 0 else "standalone"))
        return Filing(**{**Q2, "file": "co1/a.pdf", "bse_code": "500999", "xbrl": pairs})

    def test_propose_unit_needs_every_instance_to_agree(self):
        def body(rounding):
            return instance(facts=ind_as(), rounding=rounding)
        self.assertEqual(propose_unit(self.filing(body("Lakhs"), body("Lakhs")), self.corpus), ("lakh", "xbrl"))
        self.assertEqual(propose_unit(self.filing(body("Lakhs"), body("Crores")), self.corpus),
                         (None, "instances_disagree"))
        self.assertEqual(propose_unit(self.filing(), self.corpus), (None, "no_instance"))
        bomb = instance(facts=ind_as(), doctype='<!DOCTYPE x [<!ENTITY a "b">]>')
        self.assertEqual(propose_unit(self.filing(bomb), self.corpus), (None, "unreadable"))
        self.assertEqual(propose_unit(self.filing(body("Billions")), self.corpus), (None, "no_rounding"))
        self.assertEqual(propose_unit(self.filing(body("Hundreds")), self.corpus), (None, "no_rounding"))
        self.assertEqual(propose_unit(self.filing(body(None)), self.corpus), (None, "no_rounding"))
        self.assertEqual(propose_unit(self.filing(body("Lakhs"), body(None)), self.corpus), (None, "no_rounding"))
        self.assertEqual(propose_unit(self.filing(body("Crores")), self.corpus), ("crore", "xbrl"))


class PickTests(unittest.TestCase):
    def test_pick_is_greedy_spread_over_companies_and_in_manifest_order(self):
        r = pick_gold([A, B, C, D], 3, requirements=REQ)
        # A gains 2 (ties with B and C; first in order); then B gains 2 (C only 1); then D gains 1 (C 0).
        self.assertEqual((r.picked, r.unmet), (["co1/a", "co2/b", "co3/d"], []))
        self.assertEqual(r.advanced[0], [("kind", "financial_results"), ("quarter", "Q1")])

    def test_include_comes_first_and_unmet_is_reported(self):
        r = pick_gold([A, B, C, D], 1, requirements=REQ, include=["co1/c"])
        self.assertEqual((r.picked, r.unmet),
                         (["co1/c"], [("kind", "financial_results", 1), ("quarter", "Q2", 1), ("spread", "yes", 1)]))

    def test_a_company_already_picked_loses_a_tie(self):
        tie = (("kind", "financial_results", 5),)
        self.assertEqual(pick_gold([A, C, B], 2, requirements=tie, include=["co1/a"]).picked, ["co1/a", "co2/b"])
        # A filing that still gains something beats a company that has none picked.
        self.assertEqual(pick_gold([A, C, B], 2, requirements=(("quarter", "Q1", 5),), include=["co1/a"]).picked,
                         ["co1/a", "co1/c"])

    def test_out_of_scope_and_unmapped_results_are_never_picked(self):
        self.assertEqual(pick_gold([E, F, B], 3, requirements=REQ).picked, ["co2/b"])
        for bad in (["co4/e"], ["co5/f"], ["co9/x"]):  # not eligible, not eligible, not in the list
            with self.subTest(bad=bad), self.assertRaises(TagsError) as caught:
                pick_gold([E, F, B], 1, requirements=REQ, include=bad)
            self.assertIn(bad[0], str(caught.exception))
        with self.assertRaises(TagsError):
            pick_gold([B], 1, requirements=REQ, include=["co2/b"], exclude=["co2/b"])

    def test_exclude_leaves_a_filing_out_and_too_many_includes_are_refused(self):
        self.assertEqual(pick_gold([A, B], 2, requirements=REQ, exclude=["co1/a"]).picked, ["co2/b"])
        with self.assertRaises(TagsError):
            pick_gold([A, B], 1, requirements=REQ, include=["co1/a", "co2/b"])

    def test_eligibility(self):
        self.assertEqual([eligible(f) for f in (A, D, E, F)], [True, True, False, False])
        mixed = results("co6", "m", xbrl=[pair("co6", "m1", fmt="in-capmkt/banking"), pair("co6", "m2", basis="standalone")])
        self.assertTrue(eligible(mixed))
        self.assertFalse(eligible(results("co7", "n", xbrl=[])))

    def test_requirement_keys(self):
        self.assertEqual(requirement_keys(A), {("kind", "financial_results"), ("quarter", "Q1"), ("token", "JQ"),
                                               ("family", "in-capmkt")})
        spread = D.model_copy(update={"stratum": "large", "tags": FormatTags(unit="crore", unit_from="investor")})
        self.assertEqual(requirement_keys(spread), {("kind", "annual_report"), ("spread", "yes"), ("stratum", "large"),
                                                    ("unit", "crore")})
        standalone = results("co8", "s", xbrl=[pair("co8", "s", basis="standalone", token="SH2025-2026")])
        self.assertEqual(requirement_keys(standalone), {("kind", "financial_results"), ("quarter", "Q2"),
                                                        ("token", "SH"), ("family", "in-capmkt"),
                                                        ("bases", "standalone_only")})
        refiled = results("co9", "r", xbrl=[pair("co9", "r1"), pair("co9", "r2")])
        self.assertIn(("instances", "refiled"), requirement_keys(refiled))
        # Two tokens for one period end are different instances, not a refiling.
        halves = results("co9", "h", period_end="2026-03-31", token="MQ2025-2026",
                         xbrl=[pair("co9", "h1", token="MQ2025-2026"), pair("co9", "h2", token="MH2025-2026")])
        keys = requirement_keys(halves)
        self.assertNotIn(("instances", "refiled"), keys)
        self.assertEqual({k for k in keys if k[0] == "token"}, {("token", "MQ"), ("token", "MH")})
        self.assertEqual({k for k in keys if k[0] == "quarter"}, {("quarter", "Q4")})
        # A basis is not a refiling either.
        both = results("co9", "b", xbrl=[pair("co9", "b1"), pair("co9", "b2", basis="standalone")])
        self.assertNotIn(("instances", "refiled"), requirement_keys(both))
        self.assertNotIn(("bases", "standalone_only"), requirement_keys(both))

    def test_the_requirements_are_the_specs(self):
        self.assertEqual(len(REQUIREMENTS), 19)
        self.assertEqual(sum(1 for d, _, _ in REQUIREMENTS if d == "quarter"), 4)


def gold_fact(concept="revenue_from_operations", scale="100000", status="value"):
    value = None if status == "dash" else "1"
    return GoldFact(concept=concept, statement="income_statement", basis="consolidated", section="Income",
                    label="L", period_label="P", period_end="2025-09-30", span="quarter", printed="1",
                    value_status=status, value=value, scale=scale, normalized_value=value, page_index=0)


def gold_of_facts(filing, facts):
    return GoldFiling(filing_id=filing.id, file=filing.file, company=filing.company, kind=filing.kind,
                      period_end=filing.period_end, set=filing.set, stratum=filing.stratum,
                      printed_pages_per_page=filing.printed_pages_per_page, taxonomy_version=1,
                      frozen_at="2026-10-20T00:00:00+00:00", exported_from=None, facts=facts, expected_checks=[])


def gold_with(scales, per_share=0, filing=None):
    facts = [gold_fact(scale=s) for s in scales] + [gold_fact("eps_basic", "1") for _ in range(per_share)]
    return gold_of_facts(filing or Filing(**Q2), facts)


def gold_with_facts(n, filing=A):
    return gold_of_facts(filing, [gold_fact() for _ in range(n)])


class CoverageTests(unittest.TestCase):
    def test_coverage_shows_values_with_no_gold_and_leaves_out_not_tagged(self):
        cov = gold_coverage([A, D], {"co1/a": gold_with_facts(3)})
        self.assertEqual(cov["spreads"], {"no": (1, 3), "yes": (0, 0)})
        self.assertEqual(cov["brackets"], {})  # neither is tagged: no row "not tagged"
        self.assertEqual(cov["unit"], {})

    def test_a_tagged_value_counts_its_gold_filings_and_facts(self):
        tagged = A.model_copy(update={"tags": FormatTags(unit="lakh", unit_from="xbrl", negatives_in_brackets=True)})
        other = tagged.model_copy(update={"file": "co2/z.pdf"})
        cov = gold_coverage([tagged, other, D], {"co1/a": gold_with_facts(3, tagged), "co2/z": gold_with_facts(2, other)})
        self.assertEqual(cov["unit"], {"lakh": (2, 5)})
        self.assertEqual(cov["brackets"], {"yes": (2, 5)})
        self.assertEqual(cov["financials"], {"no": (2, 5)})

    def test_the_unit_tag_is_checked_against_the_gold_scales(self):
        lakh = Filing(**Q2, tags=FormatTags(unit="lakh", unit_from="xbrl"))
        t = load_taxonomy()
        self.assertEqual(unit_against_gold(lakh, gold_with(["100000", "100000"]), t), "agrees")
        self.assertEqual(unit_against_gold(lakh, gold_with(["10000000"]), t), "disagrees")
        self.assertEqual(unit_against_gold(lakh, gold_with(["100000", "10000000"]), t), "mixed")
        self.assertEqual(unit_against_gold(lakh, gold_with([], per_share=1), t), "no_monetary_gold")  # EPS has scale 1
        self.assertEqual(unit_against_gold(Filing(**Q2), gold_with(["100000"]), t), "not_tagged")
        dash = gold_of_facts(Filing(**Q2), [gold_fact(status="dash", scale=None)])
        self.assertEqual(unit_against_gold(lakh, dash, t), "no_monetary_gold")
        self.assertEqual(unit_against_gold(lakh, gold_with(["7"]), t), "disagrees")  # a scale no unit has


class CommandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.paths = EvalPaths(Path(self.temp.name) / "data")
        for patcher in (mock.patch.object(cli, "load_dotenv"), mock.patch.object(cli, "DEFAULT", self.paths)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, *filings):
        write_manifest(self.paths.manifest, Manifest(filings=list(filings)))

    def write_instance(self, filing, rounding, name="i0"):
        path = self.paths.corpus / "co1" / "xbrl" / f"{name}.xml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(instance(facts=ind_as(), rounding=rounding))
        return pair("co1", name)

    def run_tags(self, *args):
        result = CliRunner().invoke(cli.app, ["tags", *args], env={"COLUMNS": "500"})
        return result.exit_code, plain(result.output)

    def tags_of(self, filing_id):
        return load_manifest(self.paths.manifest).by_id()[filing_id].tags

    def test_set_and_propose_never_overwrite_the_investors_unit(self):
        a = Filing(**{**Q2, "file": "co1/a.pdf", "bse_code": "500999", "xbrl": [self.write_instance(None, "Lakhs")]})
        b = Filing(**{**Q2, "file": "co1/b.pdf", "period_end": "2025-09-30", "bse_code": "500999",
                      "xbrl": [self.write_instance(None, "Lakhs", "i1")]})
        self.save(a, b)
        code, text = self.run_tags("set", "co1/a", "--unit", "crore")
        self.assertEqual(code, 0, text)
        code, text = self.run_tags("propose")
        self.assertEqual(code, 0, text)
        self.assertEqual(self.tags_of("co1/a"), FormatTags(unit="crore", unit_from="investor"))
        self.assertEqual(self.tags_of("co1/b"), FormatTags(unit="lakh", unit_from="xbrl"))
        self.assertIn("unit from XBRL: 1", text)

    def test_propose_prints_counts_and_ids_and_leaves_an_unproposable_unit_alone(self):
        a = Filing(**{**Q2, "file": "co1/a.pdf", "bse_code": "500999", "xbrl": [self.write_instance(None, "Billions")],
                      "tags": FormatTags(unit="lakh", unit_from="xbrl")})
        none = Filing(**{**Q2, "file": "co2/n.pdf"})
        annual = Filing(**{**Q2, "file": "co3/ar.pdf", "kind": "annual_report", "period_end": "2026-03-31"})
        self.save(a, none, annual)
        code, text = self.run_tags("propose")
        self.assertEqual(code, 0, text)
        self.assertEqual(text.splitlines(), ["unit from XBRL: 0", "instances disagree: 0", "no rounding: 1 (co1/a)",
                                             "no instance: 1", "unreadable: 0"])
        self.assertEqual(self.tags_of("co1/a"), FormatTags(unit="lakh", unit_from="xbrl"))

    def test_set_sets_the_investors_tags_and_refuses_nothing_to_set(self):
        self.save(Filing(**Q2))
        code, text = self.run_tags("set", "synthetic-cements/results-2025-09")
        self.assertEqual(code, 1)
        self.assertIn("nothing to set", text)
        self.assertEqual(self.tags_of("synthetic-cements/results-2025-09"), None)
        code, text = self.run_tags("set", "synthetic-cements/results-2025-09", "--brackets", "yes", "--restated", "no")
        self.assertEqual(code, 0, text)
        self.assertEqual(self.tags_of("synthetic-cements/results-2025-09"),
                         FormatTags(negatives_in_brackets=True, restated_columns=False))
        for args in (["--unit", "billion"], ["--brackets", "maybe"], ["--restated", "1"]):
            code, text = self.run_tags("set", "synthetic-cements/results-2025-09", *args)
            self.assertEqual(code, 1, args)
        code, text = self.run_tags("set", "nope/x", "--unit", "lakh")
        self.assertEqual(code, 1)
        self.assertIn("nope/x", text)

    def test_pick_prints_the_picks_and_writes_nothing(self):
        self.save(A, B, C, D)
        before = self.paths.manifest.read_bytes()
        code, text = self.run_tags("pick", "--count", "10")
        self.assertEqual(code, 0, text)
        self.assertIn("co1/a", text)
        self.assertIn("kind=financial_results", text)
        self.assertIn("unmet:", text)
        self.assertEqual(self.paths.manifest.read_bytes(), before)
        for count in ("9", "16"):
            code, text = self.run_tags("pick", "--count", count)
            self.assertEqual(code, 1)
            self.assertIn("10 to 15", text)
        code, text = self.run_tags("pick", "--set", "all")
        self.assertEqual(code, 1)
        code, text = self.run_tags("pick", "--include", "co4/e")
        self.assertEqual(code, 1)
        self.assertIn("co4/e", text)

    def test_coverage_prints_the_table_and_what_is_not_tagged(self):
        tagged = A.model_copy(update={"tags": FormatTags(unit="lakh", unit_from="xbrl")})
        bad = B.model_copy(update={"tags": FormatTags(unit="crore", unit_from="xbrl")})
        self.save(tagged, bad, D)
        write_gold(self.paths.gold, gold_with_facts(3, tagged))
        write_gold(self.paths.gold, gold_with(["100000"], filing=bad))
        write_gold(self.paths.gold, gold_with_facts(1, D))
        code, text = self.run_tags("coverage")
        self.assertEqual(code, 0, text)
        self.assertIn("unit lakh: 1 gold filing(s), 3 gold fact(s)", text)
        self.assertIn("spreads yes: 1 gold filing(s), 1 gold fact(s)", text)
        self.assertIn("gold filings not tagged: unit 1 (co3/d)", text)
        self.assertIn("gold filings not tagged: brackets 3", text)
        self.assertIn("unit tag against gold: 1 agree, 1 disagree (co2/b), 0 mixed, 0 no monetary gold, 1 not tagged", text)


if __name__ == "__main__":
    unittest.main()
