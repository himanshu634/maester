"""The `xbrl-elements` survey: element names and counts per format, never a value. Offline."""

import csv
import tempfile
import unittest
from pathlib import Path

from typer.testing import CliRunner
from xbrl_fixtures import BSE_FIN, IND_AS_MARKERS, f, identity_facts, instance

from maester_eval.cli import app
from maester_eval.xbrl_survey import COLUMNS, XbrlSurveyError, survey_instances, write_survey

# Figures of the synthetic instances. Each is unlike any other digit string in the files, so a leak into an
# output file or the console shows as a plain substring.
FIGURES = ("7654321", "1357913", "2468024", "9753108", "8642097")
COMPANY = "SYNTHETIC CEMENTS LIMITED"

FIRST = instance(
    facts=[
        *identity_facts(),
        *IND_AS_MARKERS,
        f("RevenueFromOperations", "OneD", text=FIGURES[0]),
        f("RevenueFromOperations", "FourD", text=FIGURES[1]),
        f("Assets", "OneI", text=FIGURES[2]),
        f("Assets", "PY_I", text=FIGURES[3]),
        # A fact with a member is a detail of a line, not a line: the survey leaves it out.
        f("OtherExpenses", "OneExpenses1D", text=FIGURES[4]),
        f("CashAndCashEquivalentsCashFlowStatement", "OneI", text=FIGURES[4]),
    ]
)
SECOND = instance(
    facts=[
        *identity_facts(),
        *IND_AS_MARKERS,
        f("RevenueFromOperations", "OneD", text=FIGURES[3]),
        f("OtherExpenses", "OneD", text=FIGURES[0]),
    ]
)
BSE = instance(
    namespace=BSE_FIN,
    schema_ref="in-bse-fin-2020-03-31.xsd",
    facts=[*identity_facts(), *IND_AS_MARKERS, f("Assets", "OneI", text=FIGURES[1])],
)
HOSTILE = instance(
    facts=[*identity_facts(), *IND_AS_MARKERS],
    doctype='<!DOCTYPE xbrli:xbrl [<!ENTITY lol "lol">]>',
)
BANKING = instance(
    facts=[*identity_facts(), f("CET1Ratio", "OneD", unit="pure", text="0.1234"), f("CapitalAndLiabilities", "OneI")],
)


def rows_of(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


class SurveyCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.instances = Path(tmp.name) / "instances"
        self.out = Path(tmp.name) / "out"
        (self.instances / "small").mkdir(parents=True)
        (self.instances / "first.xml").write_bytes(FIRST)
        (self.instances / "small" / "second.xml").write_bytes(SECOND)
        (self.instances / "small" / "third.xml").write_bytes(BSE)
        # Neither an instance nor a file with an .xml name is read as one.
        (self.instances / "notes.txt").write_text(FIGURES[0], encoding="utf-8")

    def run_command(self, *extra):
        return CliRunner().invoke(
            app, ["xbrl-elements", "--instances", str(self.instances), "--out", str(self.out), *extra]
        )


class SurveyTests(SurveyCase):
    def test_a_csv_per_detected_format_with_its_columns(self):
        response = self.run_command()
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertEqual(
            sorted(path.name for path in self.out.iterdir()),
            ["elements-in-bse-fin-ind_as.csv", "elements-in-capmkt-ind_as.csv"],
        )
        header = (self.out / "elements-in-capmkt-ind_as.csv").read_text(encoding="utf-8").splitlines()[0]
        self.assertEqual(header, "element,files,contexts,statement_guess")
        self.assertEqual(COLUMNS, ("element", "files", "contexts", "statement_guess"))

    def test_the_rows_and_their_counts(self):
        self.run_command()
        self.assertEqual(
            rows_of(self.out / "elements-in-capmkt-ind_as.csv"),
            [
                {"element": "Assets", "files": "1", "contexts": "2", "statement_guess": "balance_sheet"},
                {
                    "element": "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
                    "files": "2",
                    "contexts": "1",
                    "statement_guess": "duration",
                },
                {
                    "element": "CashAndCashEquivalentsCashFlowStatement",
                    "files": "1",
                    "contexts": "1",
                    "statement_guess": "balance_sheet",
                },
                {
                    "element": "ComprehensiveIncomeForThePeriod",
                    "files": "2",
                    "contexts": "1",
                    "statement_guess": "duration",
                },
                {"element": "OtherExpenses", "files": "1", "contexts": "1", "statement_guess": "duration"},
                {"element": "RevenueFromOperations", "files": "2", "contexts": "2", "statement_guess": "duration"},
            ],
        )
        self.assertEqual(
            [(row["element"], row["files"]) for row in rows_of(self.out / "elements-in-bse-fin-ind_as.csv")],
            [
                ("Assets", "1"),
                ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "1"),
                ("ComprehensiveIncomeForThePeriod", "1"),
            ],
        )

    def test_an_element_with_a_duration_fact_is_a_duration(self):
        (self.instances / "mixed.xml").write_bytes(
            instance(facts=[*IND_AS_MARKERS, f("Assets", "OneD", text=FIGURES[0])])
        )
        self.run_command()
        guess = {row["element"]: row["statement_guess"] for row in rows_of(self.out / "elements-in-capmkt-ind_as.csv")}
        self.assertEqual(guess["Assets"], "duration")

    def test_the_format_counts_are_printed(self):
        response = self.run_command()
        self.assertIn("in-capmkt/ind_as: 2", response.output)
        self.assertIn("in-bse-fin/ind_as: 1", response.output)
        self.assertIn("unreadable: 0", response.output)

    def test_no_value_is_in_any_output(self):
        (self.instances / "hostile.xml").write_bytes(HOSTILE)
        response = self.run_command()
        texts = [response.output] + [path.read_text(encoding="utf-8") for path in self.out.iterdir()]
        self.assertEqual(len(texts), 3)
        for text in texts:
            for secret in (*FIGURES, COMPANY, "500999", "INE999Z01011", "SYNCEM"):
                self.assertNotIn(secret, text)

    def test_a_doctype_file_is_unreadable_and_does_not_stop_the_run(self):
        (self.instances / "hostile.xml").write_bytes(HOSTILE)
        response = self.run_command()
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("unreadable: 1", response.output)
        self.assertIn("DOCTYPE: 1", response.output)
        self.assertIn("in-capmkt/ind_as: 2", response.output)  # the hostile file is in no format's count
        self.assertEqual(len(rows_of(self.out / "elements-in-capmkt-ind_as.csv")), 6)

    def test_a_file_that_is_not_xml_is_unreadable_too(self):
        (self.instances / "broken.xml").write_bytes(b"%PDF-1.7 not an instance")
        response = self.run_command()
        self.assertEqual(response.exit_code, 0, response.output)
        self.assertIn("unreadable: 1", response.output)
        self.assertIn("MALFORMED: 1", response.output)

    def test_an_unmapped_format_has_its_csv_too(self):
        (self.instances / "bank.xml").write_bytes(BANKING)
        response = self.run_command()
        self.assertIn("in-capmkt/banking: 1", response.output)
        self.assertEqual(
            [row["element"] for row in rows_of(self.out / "elements-in-capmkt-banking.csv")],
            ["CET1Ratio", "CapitalAndLiabilities"],
        )

    def test_an_instance_in_no_family_is_counted_and_has_no_csv(self):
        (self.instances / "stranger.xml").write_bytes(instance(namespace="http://example.org/other", facts=IND_AS_MARKERS))
        response = self.run_command()
        self.assertIn("no format: 1", response.output)
        self.assertEqual(len(list(self.out.iterdir())), 2)

    def test_a_second_run_writes_the_same_files(self):
        self.run_command()
        first = {path.name: path.read_bytes() for path in self.out.iterdir()}
        self.run_command()
        self.assertEqual({path.name: path.read_bytes() for path in self.out.iterdir()}, first)

    def test_a_folder_with_no_instances_stops_the_command(self):
        empty = self.instances / "empty"
        empty.mkdir()
        response = CliRunner().invoke(app, ["xbrl-elements", "--instances", str(empty), "--out", str(self.out)])
        self.assertEqual(response.exit_code, 1)
        self.assertIn("no .xml files", response.output)
        self.assertFalse(self.out.exists())

    def test_a_missing_folder_stops_the_command(self):
        response = CliRunner().invoke(
            app, ["xbrl-elements", "--instances", str(self.instances / "nowhere"), "--out", str(self.out)]
        )
        self.assertEqual(response.exit_code, 1)
        self.assertIn("is not a folder", response.output)


class SurveyApiTests(SurveyCase):
    def test_survey_counts_files_by_format_and_unreadable_by_reason(self):
        (self.instances / "hostile.xml").write_bytes(HOSTILE)
        survey = survey_instances(sorted(self.instances.rglob("*.xml")))
        self.assertEqual(survey.formats, {"in-capmkt/ind_as": 2, "in-bse-fin/ind_as": 1})
        self.assertEqual(survey.unreadable, {"DOCTYPE": 1})
        self.assertEqual(survey.no_format, 0)

    def test_write_survey_returns_the_files_it_wrote(self):
        survey = survey_instances(sorted(self.instances.rglob("*.xml")))
        written = write_survey(survey, self.out)
        self.assertEqual(sorted(path.name for path in written), sorted(path.name for path in self.out.iterdir()))

    def test_an_error_is_an_eval_error(self):
        from maester_eval.errors import EvalError

        self.assertTrue(issubclass(XbrlSurveyError, EvalError))


if __name__ == "__main__":
    unittest.main()
