"""Who owns an XBRL slot: the later filed date, then the later stamp read as a date and time, never the larger name;
a slot with no order is pooled. Offline, file names and synthetic facts only."""

from datetime import datetime
import unittest

from eval_fixtures import QUARTER, RESULTS_Q2, RESULTS_Q4, gold_fact, gold_of, instance_read, xbrl_artefact, xbrl_fact

from maester_eval.owners import OWNER_RULE_VERSION, SlotOwner, differing_cells, owned_facts, slot_owners, stamp_readings
from maester_eval.scoring import score_xbrl_filing

XBRL = "synthetic-cements/xbrl/"
# 500820's stamps on a synthetic company: 29 May 2026 07:51:58, and 15 Jul 2026 20:28:19. As text the first is larger.
OLDER = XBRL + "2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_29052026075158.xml"
NEWER = XBRL + "2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_1572026202819.xml"
# 500233's stamps: 1 or 10 Jun 2025 at 21:17:39, and 1 or 10 Jun 2025 at 22:10:59. Neither is later than every reading of the other.
FIRST = XBRL + "2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_1062025211739.xml"
SECOND = XBRL + "2025-10-17_SQ2025-2026_consolidated_Integrated_Finance_Ind_As_500999_1062025221059.xml"
MQ, MH = XBRL + "mq.xml", XBRL + "mh.xml"


def one(score):
    (fact,) = score.facts
    return fact


def other_income(value, instance):
    return xbrl_fact(element="OtherIncome", concept="other_income", reportedLabel="Other income",
                     normalizedValue=value, reportedValue=str(int(value) // 100000), instance=instance)


def march(span, start, value, instance):
    """A consolidated revenue fact of RESULTS_Q4's period end, 31 March 2026."""
    return xbrl_fact(span=span, periodStart=start, periodEnd="2026-03-31", normalizedValue=value, instance=instance,
                     periodLabel="", contextId={"quarter": "OneD", "half_year": "OneD", "year": "FourD"}[span])


class StampTests(unittest.TestCase):
    def test_the_rule_has_a_version(self):
        self.assertEqual(OWNER_RULE_VERSION, 1)

    def test_stamp_readings(self):
        self.assertEqual(stamp_readings("2026-07-15_MC2025-2026_consolidated_Integrated_Finance_Ind_As_500820_29052026075158.xml"),
                         [datetime(2026, 5, 29, 7, 51, 58)])
        self.assertEqual(stamp_readings("x_1572026202819.xml"), [datetime(2026, 7, 15, 20, 28, 19)])
        self.assertEqual(stamp_readings("x_1062025211739.xml"), [datetime(2025, 6, 1, 21, 17, 39), datetime(2025, 6, 10, 21, 17, 39)])
        self.assertEqual(stamp_readings("x_2112026181822.xml"), [datetime(2026, 1, 21, 18, 18, 22), datetime(2026, 11, 2, 18, 18, 22)])
        self.assertEqual(stamp_readings("x_IFNBFC.xml"), [])

    def test_a_name_with_no_stamp_has_no_reading(self):
        self.assertEqual(stamp_readings("synthetic-cements/xbrl/mq.xml"), [])     # no "_" at all
        self.assertEqual(stamp_readings("x_12345.xml"), [])                        # too short for a date and a time
        self.assertEqual(stamp_readings("x_3122026250000.xml"), [])                # 31 Dec 2026, hour 25: no real time
        self.assertEqual(stamp_readings("x_1511999101010.xml"), [])                # 1999 is before 2000
        # Only the part after the last "_": the folder of a path is not read.
        self.assertEqual(stamp_readings("a_1/x_1572026202819.xml"), [datetime(2026, 7, 15, 20, 28, 19)])


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.refiled = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=OLDER),
                                                  xbrl_fact(normalizedValue="1234600000", reportedValue="12346.00", instance=NEWER)])
        self.pooled = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=FIRST), other_income("23450000", FIRST),
                                                 xbrl_fact(instance=SECOND), other_income("23460000", SECOND)])
        self.march = xbrl_artefact(RESULTS_Q4, [
            march("quarter", "2026-01-01", "1300000000", MQ), march("year", "2025-04-01", "4938000000", MQ),
            march("half_year", "2025-10-01", "2600000000", MH), march("year", "2025-04-01", "4938100000", MH),
        ], instances=[instance_read(MQ, period="MQ2025-2026", filed="2026-05-28", facts=2),
                      instance_read(MH, period="MH2025-2026", filed="2026-05-21", facts=2)])

    def test_a_refiling_is_owned_by_its_later_stamp_never_by_the_larger_name(self):
        # Two consolidated SQ2025-2026 instances filed 2025-10-17 with 500820's stamps: "…_29052026075158.xml" (29 May 2026) and
        # "…_1572026202819.xml" (15 Jul 2026). The larger name is the older file. Revenue 1234500000 and 1234600000.
        owner = slot_owners(self.refiled)[QUARTER].owner
        self.assertTrue(owner.endswith("_1572026202819.xml"))
        gold = gold_of(gold_fact(printed="12,346.00", value="12346.00", normalized_value="1234600000.00"))
        self.assertEqual(one(score_xbrl_filing(self.refiled, gold)).outcome, "match")
        self.assertEqual([(c.element, c.owner == owner, [o.rsplit("_", 1)[1] for o in c.others]) for c in differing_cells(self.refiled)],
                         [("RevenueFromOperations", True, ["29052026075158.xml"])])

    def test_a_refiling_whose_stamps_overlap_is_pooled(self):
        # 500233's stamps: "…_1062025211739.xml" and "…_1062025221059.xml" (1 or 10 Jun 2025, at 21:17 and 22:10): no order.
        # Both hold revenue 1234500000; other income is 23450000 in one and 23460000 in the other.
        self.assertIsNone(slot_owners(self.pooled)[QUARTER].owner)
        other = gold_fact(concept="other_income", label="Other income", printed="234.50", value="234.50", normalized_value="23450000.00")
        s = score_xbrl_filing(self.pooled, gold_of(gold_fact(), other))
        self.assertEqual([(f.concept, f.outcome, f.detail) for f in s.facts],
                         [("revenue_from_operations", "match", None), ("other_income", "ambiguous", "instances_differ")])
        self.assertEqual([(c.element, c.owner) for c in differing_cells(self.pooled)], [("OtherIncome", None)])

    def test_a_pooled_slot_keeps_a_cell_its_instances_agree_on_once_from_the_first(self):
        facts = owned_facts(self.pooled)
        self.assertEqual([(f["element"], f["instance"]) for f in facts], [("RevenueFromOperations", FIRST)])
        self.assertEqual(slot_owners(self.pooled)[QUARTER], SlotOwner(QUARTER, None, [FIRST, SECOND]))
        (cell,) = differing_cells(self.pooled)
        self.assertEqual((cell.concept, cell.others), ("other_income", [FIRST, SECOND]))

    def test_a_line_one_pooled_instance_lacks_is_a_cell_they_differ_on(self):
        lacking = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=FIRST), other_income("23450000", FIRST), xbrl_fact(instance=SECOND)])
        self.assertEqual([f["element"] for f in owned_facts(lacking)], ["RevenueFromOperations"])
        self.assertEqual([(c.element, c.others) for c in differing_cells(lacking)], [("OtherIncome", [FIRST, SECOND])])

    def test_a_tie_with_a_name_that_has_no_stamp_is_pooled(self):
        # "a.xml" has no reading, so it orders nothing: neither file is later than the other.
        tied = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=XBRL + "a.xml"), xbrl_fact(instance=NEWER)])
        self.assertIsNone(slot_owners(tied)[QUARTER].owner)
        self.assertEqual(differing_cells(tied), [])

    def test_the_later_filed_date_owns_the_slot_before_any_stamp(self):
        # The older stamp, filed a day later, owns the slot: the filed date is ranked first.
        later = xbrl_artefact(RESULTS_Q2, [xbrl_fact(instance=OLDER), xbrl_fact(instance=NEWER)],
                              instances=[instance_read(OLDER, filed="2025-10-18"), instance_read(NEWER)])
        self.assertEqual(slot_owners(later)[QUARTER].owner, OLDER)

    def test_one_instance_owns_its_slots_and_owns_every_fact_in_them(self):
        a = xbrl_artefact(RESULTS_Q2, [xbrl_fact(), other_income("23450000", "synthetic-cements/xbrl/a.xml")])
        self.assertEqual(slot_owners(a), {QUARTER: SlotOwner(QUARTER, XBRL + "a.xml", [XBRL + "a.xml"])})
        self.assertEqual(len(owned_facts(a)), 2)
        self.assertEqual(differing_cells(a), [])

    def test_two_tokens_of_one_march(self):
        # RESULTS_Q4 (period end 2026-03-31) pairs mq.xml, MQ2025-2026 (OneD the quarter, FourD the year), filed 2026-05-28, and
        # mh.xml, MH2025-2026 (OneD the half year, FourD the year), filed 2026-05-21; consolidated; the year's revenue is
        # 4938000000 in mq.xml and 4938100000 in mh.xml.
        owners = slot_owners(self.march)
        self.assertEqual({k.rsplit("|", 1)[1]: (o.owner.rsplit("/", 1)[1], len(o.instances)) for k, o in owners.items()},
                         {"quarter": ("mq.xml", 1), "half_year": ("mh.xml", 1), "year": ("mq.xml", 2)})
        self.assertEqual([(c.element, c.owner.rsplit("/", 1)[1], [o.rsplit("/", 1)[1] for o in c.others]) for c in differing_cells(self.march)],
                         [("RevenueFromOperations", "mq.xml", ["mh.xml"])])
        # The year is mq.xml's figure only.
        year = [f for f in owned_facts(self.march) if f["span"] == "year"]
        self.assertEqual([(f["instance"], f["normalizedValue"]) for f in year], [(MQ, "4938000000")])

    def test_an_unused_instance_owns_nothing(self):
        a = xbrl_artefact(RESULTS_Q2, [xbrl_fact()], instances=[
            instance_read(XBRL + "a.xml", facts=1), instance_read(XBRL + "c.xml", used=False, reason="XBRL_FORMAT_UNMAPPED")])
        self.assertEqual(slot_owners(a)[QUARTER].instances, [XBRL + "a.xml"])


if __name__ == "__main__":
    unittest.main()
